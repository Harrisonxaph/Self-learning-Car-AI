// P4-05: the evaluation protocol on a saved model. A tiny trained champion on training and validation circuits only; no
// held-out circuit is ever evaluated here (the refusal tests show the refusal happens before any episode runs). Deterministic,
// seeded, nothing here is a result or evidence of learning.
import { describe, expect, it } from 'vitest';
import { createCar } from '../../src/sim/collision';
import { DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { loadTrack } from '../../src/sim/track';
import { validateEvaluationEntry } from '../../src/persistence/evaluationEntry';
import { modelParameters } from '../../src/persistence/modelFormat';
import { evaluateDriver } from '../../src/training/evaluation';
import {
  EVALUATION_SEEDS,
  START_BOUNDS,
  evaluateModel,
  evaluateModelOnCircuit,
  evaluationStart,
  replayEntry,
  resolveCircuit,
} from '../../src/ui/modelEvaluation';
import { BUILT_IN_TRACK_SPLITS, TrackLeakageError, tracksIn } from '../../src/training/trackSplits';
import { EVALUATION_TRACKS, OPTIONS, makeModel } from '../helpers/evaluationFixtures';

const model = makeModel(7, 'me-1');
const TRAINING = tracksIn('training').map((t) => t.id);
const VALIDATION = tracksIn('validation').map((t) => t.id);
const HELD_OUT = tracksIn('held-out').map((t) => t.id);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe('the protocol', () => {
  it('uses the nominal start and four fixed perturbed seeds, with the stated bounds', () => {
    expect([...EVALUATION_SEEDS]).toEqual([1, 2, 3, 4]);
    expect(START_BOUNDS.lateralMetres).toBe(1);
    expect(START_BOUNDS.headingRadians).toBeCloseTo((3 * Math.PI) / 180, 12);
  });
  it('evaluates five episodes per circuit (seed 0 and seeds 1 to 4) and records the starts', () => {
    const result = evaluateModelOnCircuit(model, 'kidney-loop', OPTIONS);
    if (!result.ok) throw new Error(result.message);
    expect(result.entry.rows.map((r) => r.seed)).toEqual([0, 1, 2, 3, 4]);
    expect(result.entry.starts.map((s) => s.seed)).toEqual([0, 1, 2, 3, 4]);
    expect(result.entry.summary.episodes).toBe(5);
    expect(result.entry.protocol).toBe('p4-05-evaluation-v1');
    expect(result.entry.config).toEqual({ maxEpisodeSeconds: 60, stallSeconds: 5, maxLaps: 3 });
  });
});

describe('start perturbations', () => {
  it.each(EVALUATION_TRACKS.map((t) => t.id))('on %s: deterministic, within bounds, on the road without touching a wall, and the track is untouched', (id) => {
    const entry = BUILT_IN_TRACK_SPLITS.tracks.find((t) => t.id === id)!;
    const track = entry.track;
    const frozenCopy = JSON.stringify(track);
    for (const seed of [0, ...EVALUATION_SEEDS, 5, 6, 7, 8, 9, 10, 11, 12]) {
      const a = evaluationStart(track, seed);
      const b = evaluationStart(track, seed);
      expect(a).toEqual(b);
      expect(Math.abs(a.lateralMetres)).toBeLessThanOrEqual(START_BOUNDS.lateralMetres + 1e-9);
      expect(Math.abs(a.headingRadians)).toBeLessThanOrEqual(START_BOUNDS.headingRadians + 1e-6);
      expect(createCar({ position: { x: a.x, y: a.y }, heading: a.heading }, track, DEFAULT_VEHICLE_PHYSICS).crashed).toBe(false);
    }
    expect(evaluationStart(track, 0)).toMatchObject({ x: track.start.position.x, y: track.start.position.y, heading: track.start.heading, lateralMetres: 0, headingRadians: 0 });
    expect(JSON.stringify(track)).toBe(frozenCopy);
    expect(entry.contentHash).toBe(BUILT_IN_TRACK_SPLITS.tracks.find((t) => t.id === id)!.contentHash);
  });
  it('different seeds give different starts', () => {
    const track = BUILT_IN_TRACK_SPLITS.tracks[0]!.track;
    const poses = EVALUATION_SEEDS.map((s) => JSON.stringify(evaluationStart(track, s)));
    expect(new Set(poses).size).toBe(EVALUATION_SEEDS.length);
  });
});

describe('determinism and replay', () => {
  it('evaluating the same model twice gives identical entries but for recordedAt', () => {
    const a = evaluateModelOnCircuit(model, 's-sweepers', OPTIONS);
    const b = evaluateModelOnCircuit(model, 's-sweepers', { ...OPTIONS, recordedAt: '2030-01-01T00:00:00.000Z' });
    if (!a.ok || !b.ok) throw new Error('evaluation failed');
    expect({ ...a.entry, recordedAt: '' }).toEqual({ ...b.entry, recordedAt: '' });
  });
  it('a stored entry replays row for row, and a tampered row, hash or model is reported', () => {
    const made = evaluateModelOnCircuit(model, 'rounded-rectangle', OPTIONS);
    if (!made.ok) throw new Error(made.message);
    expect(replayEntry(made.entry, model, OPTIONS)).toEqual({ identical: true, differences: [] });
    const row = { ...made.entry.rows[1]!, ticks: made.entry.rows[1]!.ticks + 1 };
    const tampered = { ...made.entry, rows: made.entry.rows.map((r, i) => (i === 1 ? row : r)) };
    expect(replayEntry(tampered, model, OPTIONS).identical).toBe(false);
    expect(replayEntry(made.entry, makeModel(8, 'me-other'), OPTIONS).identical).toBe(false);
    expect(replayEntry({ ...made.entry, track: { ...made.entry.track, id: 'stadium-oval' } }, model, OPTIONS).identical).toBe(false);
  });
  it('every produced entry validates against the registry and has a training or validation split', () => {
    for (const id of EVALUATION_TRACKS.map((t) => t.id)) {
      const r = evaluateModelOnCircuit(model, id, OPTIONS);
      if (!r.ok) throw new Error(r.message);
      expect(validateEvaluationEntry(r.entry, EVALUATION_TRACKS).ok).toBe(true);
      expect(['training', 'validation']).toContain(r.entry.track.split);
    }
  });
  it('uses the model\'s own brake flag: a masked model is evaluated with its brake masked', () => {
    const masked = clone(model);
    (masked.training.configuration as { brakeEnabled: boolean }).brakeEnabled = false;
    const a = evaluateModelOnCircuit(model, 'stadium-oval', OPTIONS);
    const b = evaluateModelOnCircuit(masked, 'stadium-oval', OPTIONS);
    if (!a.ok || !b.ok) throw new Error('evaluation failed');
    expect(a.entry.brakeEnabled).toBe(true);
    expect(b.entry.brakeEnabled).toBe(false);
    expect(a.entry.frozenModelId).not.toBe(b.entry.frozenModelId);
  });
});

describe('what may be evaluated: held-out stays out (circuits, not hashes)', () => {
  it('resolves training and validation circuits and refuses everything else with TrackLeakageError', () => {
    for (const id of [...TRAINING, ...VALIDATION]) expect(resolveCircuit(id).id).toBe(id);
    for (const id of [...HELD_OUT, 'nonsense', '', 'copy-of-stadium-oval']) expect(() => resolveCircuit(id)).toThrow(TrackLeakageError);
  });
  it.each([...HELD_OUT, 'renamed-copy-of-a-held-out-circuit'])('refuses %s before any episode runs, even for a valid frozen model', (id) => {
    let episodes = 0;
    const spy: typeof evaluateDriver = (driver, setup, options) => {
      episodes += 1;
      return evaluateDriver(driver, setup, options);
    };
    const result = evaluateModelOnCircuit(model, id, { ...OPTIONS, evaluate: spy });
    expect(result.ok).toBe(false);
    expect(episodes).toBe(0);
    const batch = evaluateModel(model, ['kidney-loop', id], { ...OPTIONS, evaluate: spy });
    expect(batch.ok).toBe(false);
    expect(episodes).toBeGreaterThan(0); // the first, permitted circuit ran...
    const ran = episodes;
    evaluateModel(model, [id, 'kidney-loop'], { ...OPTIONS, evaluate: spy });
    expect(episodes).toBe(ran); // ...but a refusal first runs nothing at all
  });
  it('refuses a held-out geometry under another registered ID or a renamed copy (only IDs are accepted, never a track)', () => {
    const held = BUILT_IN_TRACK_SPLITS.tracks.find((t) => t.split === 'held-out')!.track;
    const copy = loadTrack({ ...clone(held), id: 'stadium-oval' });
    expect(copy.id).toBe('stadium-oval');
    // The module takes no Track: the registered 'stadium-oval' is evaluated, not the copy.
    const r = evaluateModelOnCircuit(model, 'stadium-oval', OPTIONS);
    if (!r.ok) throw new Error(r.message);
    expect(r.entry.track.contentHash).toBe(BUILT_IN_TRACK_SPLITS.tracks.find((t) => t.id === 'stadium-oval')!.contentHash);
  });
});

describe('hostile models are messages, never exceptions', () => {
  it('refuses a model this app cannot drive, wrong parameters and non-finite values', () => {
    const wrongSim = clone(model) as unknown as { simulationVersion: number };
    wrongSim.simulationVersion = 99;
    expect(evaluateModelOnCircuit(wrongSim as never, 'kidney-loop', OPTIONS).ok).toBe(false);
    const short = clone(model);
    (short.parameters as unknown as { values: number[] }).values = [0.1, 0.2];
    const a = evaluateModelOnCircuit(short, 'kidney-loop', OPTIONS);
    expect(a.ok).toBe(false);
    const nan = { ...model, parameters: { ...model.parameters, values: Array.from({ length: modelParameters(model).length }, () => Number.NaN) } };
    expect(evaluateModelOnCircuit(nan, 'kidney-loop', OPTIONS).ok).toBe(false);
  });
});
