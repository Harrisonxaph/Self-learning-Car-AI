// P4-05: the evaluation protocol on a saved model. A tiny trained champion on training and validation circuits only; no
// held-out circuit is ever evaluated here (the refusal tests show the refusal happens before any episode runs). Deterministic,
// seeded, nothing here is a result or evidence of learning.
import { describe, expect, it } from 'vitest';
import { createCar } from '../../src/sim/collision';
import { DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { loadTrack } from '../../src/sim/track';
import { PROTOCOL_LIMITS, evaluationConfigHash, validateEvaluationEntry } from '../../src/persistence/evaluationEntry';
import { modelParameters } from '../../src/persistence/modelFormat';
import { createEvaluationSetup, evaluateDriver } from '../../src/training/evaluation';
import { createNetworkDriver } from '../../src/ai/drivers';
import {
  EVALUATION_REGISTRY,
  EVALUATION_SEEDS,
  SLICE_TICKS,
  START_BOUNDS,
  entryBelongsTo,
  evaluateModel,
  evaluateModelOnCircuit,
  evaluationStart,
  frozenIdentity,
  replayEntry,
  resolveCircuit,
  startEvaluationJob,
} from '../../src/ui/modelEvaluation';
import { BUILT_IN_TRACK_SPLITS, TrackLeakageError, tracksIn } from '../../src/training/trackSplits';
import { EVALUATION_TRACKS, OPTIONS, bindingFor, makeModel } from '../helpers/evaluationFixtures';

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
      expect(validateEvaluationEntry(r.entry, bindingFor(model)).ok).toBe(true);
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
    const spy = { ...OPTIONS, onEpisode: () => { episodes += 1; } };
    expect(evaluateModelOnCircuit(model, id, spy).ok).toBe(false);
    expect(startEvaluationJob(model, id, spy).ok).toBe(false);
    expect(episodes).toBe(0);
    expect(evaluateModel(model, [id, 'kidney-loop'], spy).ok).toBe(false);
    expect(episodes).toBe(0); // a refusal first runs nothing at all
    expect(evaluateModel(model, ['kidney-loop', id], spy).ok).toBe(false);
    expect(episodes).toBe(5); // the permitted circuit ran its five episodes before the refusal
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

describe('the job runs the shared episode path in bounded slices', () => {
  it('gives exactly the rows evaluateDriver gives for the same starts (the slices change nothing)', () => {
    const circuit = resolveCircuit('s-sweepers');
    const driver = createNetworkDriver(modelParameters(model), { brakeEnabled: model.training.configuration.brakeEnabled });
    const setup = createEvaluationSetup({}, { track: circuit.track, physics: { ...DEFAULT_VEHICLE_PHYSICS, ...model.training.configuration.physics }, timestepSeconds: model.training.configuration.timestepSeconds });
    const made = evaluateModelOnCircuit(model, 's-sweepers', OPTIONS);
    if (!made.ok) throw new Error(made.message);
    [0, 1, 2, 3, 4].forEach((seed) => {
      const s0 = evaluationStart(circuit.track, seed);
      const direct = evaluateDriver(driver, setup, { start: { position: { x: s0.x, y: s0.y }, heading: s0.heading } });
      const row = made.entry.rows[seed]!;
      expect(row.outcome).toBe(direct.episode.outcome);
      expect(row.ticks).toBe(direct.episode.tick);
      expect(row.gatesPassed).toBe(direct.episode.gatesPassed);
      expect(row.orderedProgress).toBe(direct.orderedProgress);
      expect(row.laps).toBe(direct.episode.lapTicks.length);
    });
  });
  it('slicing at any size gives the identical entry (1 tick, 7 ticks, a slice, everything)', () => {
    const whole = evaluateModelOnCircuit(model, 'rounded-rectangle', OPTIONS);
    if (!whole.ok) throw new Error(whole.message);
    for (const size of [1, 7, SLICE_TICKS, 1_000_000]) {
      const started = startEvaluationJob(model, 'rounded-rectangle', OPTIONS);
      if (!started.ok) throw new Error(started.message);
      let calls = 0;
      while (!started.job.done()) {
        started.job.step(size);
        calls += 1;
        if (size === 1 && calls > 200_000) throw new Error('did not finish');
      }
      const result = started.job.result();
      if (!result.ok) throw new Error(result.message);
      expect(result.entry).toEqual(whole.entry);
    }
  });
  it('an expensive supported model (a 0.001 s timestep, stalled episodes) takes many bounded slices and reports progress in each', () => {
    const slow = clone(model);
    (slow.training.configuration as { timestepSeconds: number }).timestepSeconds = 0.001;
    const started = startEvaluationJob(slow, 'kidney-loop', OPTIONS);
    if (!started.ok) throw new Error(started.message);
    const seen: string[] = [];
    let slices = 0;
    let longest = 0;
    while (!started.job.done()) {
      const before = started.job.progress();
      started.job.step(SLICE_TICKS);
      slices += 1;
      const after = started.job.progress();
      seen.push(`${after.episode}:${after.tick}`);
      // At most one slice of ticks ran: within one episode the tick advanced by at most SLICE_TICKS.
      if (after.episode === before.episode) longest = Math.max(longest, after.tick - before.tick);
      expect(slices).toBeLessThan(200_000);
    }
    expect(slices).toBeGreaterThan(20); // many yields, not one long block
    expect(longest).toBeLessThanOrEqual(SLICE_TICKS);
    expect(new Set(seen).size).toBeGreaterThan(20); // progress changed between slices (a heartbeat)
    const result = started.job.result();
    expect(result.ok).toBe(true);
  });
  it('a job that is not finished has no entry, and nothing is stored by abandoning it', () => {
    const started = startEvaluationJob(model, 'kidney-loop', OPTIONS);
    if (!started.ok) throw new Error(started.message);
    started.job.step(10);
    expect(started.job.done()).toBe(false);
    expect(started.job.result()).toMatchObject({ ok: false });
  });
});

describe('an entry belongs to the champion that made it', () => {
  const entry = (() => {
    const r = evaluateModelOnCircuit(model, 'kidney-loop', OPTIONS);
    if (!r.ok) throw new Error(r.message);
    return r.entry;
  })();
  it('matches its own champion and no other, and not the same id with different parameters, brake setting or physics', () => {
    expect(entryBelongsTo(model, entry)).toBeNull();
    expect(entryBelongsTo(makeModel(8, 'me-other'), entry)).toMatch(/not this one/);
    const sameId = makeModel(8, 'me-1');
    expect(frozenIdentity(sameId).id).not.toBe(frozenIdentity(model).id);
    expect(entryBelongsTo(sameId, entry)).toMatch(/different version of this champion/);
    const brake = clone(model);
    (brake.training.configuration as { brakeEnabled: boolean }).brakeEnabled = false;
    expect(entryBelongsTo(brake, entry)).not.toBeNull();
    const physics = clone(model);
    (physics.training.configuration.physics as { engineAcceleration: number }).engineAcceleration += 1;
    expect(entryBelongsTo(physics, entry)).toMatch(/different version/);
    const timestep = clone(model);
    (timestep.training.configuration as { timestepSeconds: number }).timestepSeconds = 0.01;
    expect(entryBelongsTo(timestep, entry)).toMatch(/different version/);
  });
  it('binds the recorded timestep to the champion even when the configuration hash and frozen identity are left alone', () => {
    const forged = clone(entry) as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    forged.timestepSeconds = 0.02;
    forged.configHash = evaluationConfigHash(PROTOCOL_LIMITS, PROTOCOL_LIMITS.fitnessVersion, 0.02);
    const context = { registry: EVALUATION_REGISTRY, belongsTo: (e: Parameters<typeof entryBelongsTo>[1]) => entryBelongsTo(model, e) };
    expect(entryBelongsTo(model, forged as never)).toMatch(/different simulation timestep/);
    expect(validateEvaluationEntry(forged, context).ok).toBe(false);
    expect(validateEvaluationEntry(entry, context).ok).toBe(true);
  });
  it('is part of recognition: an entry for another champion is not shown for this one', () => {
    expect(validateEvaluationEntry(entry, bindingFor(makeModel(9, 'me-3'))).ok).toBe(false);
    expect(validateEvaluationEntry(entry, { registry: EVALUATION_REGISTRY, belongsTo: (e) => entryBelongsTo(model, e) }).ok).toBe(true);
  });
});

describe('replay never confirms what it did not compare', () => {
  const made = (() => {
    const r = evaluateModelOnCircuit(model, 'rounded-rectangle', OPTIONS);
    if (!r.ok) throw new Error(r.message);
    return r.entry;
  })();
  const bad = (mutate: (e: Record<string, any>) => void) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const e = clone(made) as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    mutate(e);
    return replayEntry(e as never, model, OPTIONS);
  };
  it('an untouched entry replays identically, whatever the key order of its copy', () => {
    expect(replayEntry(made, model, OPTIONS)).toEqual({ identical: true, differences: [] });
    const reordered = Object.fromEntries(Object.entries(clone(made)).reverse());
    expect(replayEntry(reordered as never, model, OPTIONS).identical).toBe(true);
  });
  it.each<[string, (e: Record<string, any>) => void]>([ // eslint-disable-line @typescript-eslint/no-explicit-any
    ['empty rows with the original starts and summary', (e) => { e.rows = []; }],
    ['one row too few', (e) => { e.rows.pop(); }],
    ['one row too many', (e) => { e.rows.push({ ...e.rows[0], seed: 5 }); }],
    ['fewer starts', (e) => { e.starts.pop(); }],
    ['an altered configuration', (e) => { e.config.maxLaps = 9; }],
    ['another protocol', (e) => { e.protocol = 'p4-05-evaluation-v2'; }],
    ['another circuit hash', (e) => { e.track.contentHash = `sha256:${'2'.repeat(64)}`; }],
    ['another frozen identity', (e) => { e.frozenModelId = `sha256:${'3'.repeat(64)}`; }],
    ['a changed row', (e) => { e.rows[2].ticks += 1; }],
  ])('reports %s', (_name, mutate) => {
    const result = bad(mutate);
    expect(result.identical).toBe(false);
    expect(result.differences.length).toBeGreaterThan(0);
  });
  it('another model and another circuit are reported', () => {
    expect(replayEntry(made, makeModel(8, 'me-other'), OPTIONS).identical).toBe(false);
    expect(replayEntry(made, makeModel(8, 'me-1'), OPTIONS).identical).toBe(false);
  });
});

describe('every supported model id can be evaluated', () => {
  it.each([1, 65, 100])('a saved champion with a %i-character id evaluates and its entry validates', (length) => {
    const id = 'm'.repeat(length);
    const m = makeModel(13, id);
    const r = evaluateModelOnCircuit(m, 'stadium-oval', OPTIONS);
    if (!r.ok) throw new Error(r.message);
    expect(r.entry.modelId).toBe(id);
    expect(validateEvaluationEntry(r.entry, bindingFor(m)).ok).toBe(true);
  });
});
