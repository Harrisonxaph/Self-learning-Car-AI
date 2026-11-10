// Comparing two saved models (P3-08): fitness is ranked only when the two were scored the same way, on the same task, under
// the same conditions, with every reason listed; the combined replay depends on the driving conditions only (a fitness-version
// difference alone does not block it); absent and present evaluation data are shown truthfully; nothing says one is "better".
import { describe, expect, it } from 'vitest';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { loadTrack } from '../../src/sim/track';
import { buildModel, validateModel, type ModelDocument } from '../../src/persistence/modelFormat';
import { compareModels, EVALUATION_ABSENT, evaluationPresent, FITNESS_CAVEAT, type Comparison } from '../../src/persistence/modelCompare';
import { tracksIn } from '../../src/training/trackSplits';
import { createTrainer, DEFAULT_TRAINING_CONFIG } from '../../src/training/trainer';

const ENV = { track: loadTrack(stadiumOval), physics: DEFAULT_VEHICLE_PHYSICS, timestepSeconds: DEFAULT_SIM_CONFIG.timestepSeconds };
const REGISTRY = tracksIn('training');
const make = (seed: number, id: string, generation = 1): ModelDocument => {
  const trainer = createTrainer({ ...DEFAULT_TRAINING_CONFIG, seed, populationSize: 6, eliteCount: 1, maxEpisodeSeconds: 10 }, ENV);
  let stats = trainer.runGeneration();
  for (let g = 1; g < generation; g += 1) stats = trainer.runGeneration();
  return buildModel({ champion: stats.champion, fitness: stats.bestFitness, generation: stats.generation, record: trainer.record(), id, createdAt: '2026-11-10T09:00:00.000Z', codeVersion: 'test', name: `Champion ${id}` });
};
/** A valid, edited copy: the edit runs on a loose copy and the result must still validate. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;
const edited = (m: ModelDocument, fn: (o: Loose) => void): ModelDocument => {
  const o = JSON.parse(JSON.stringify(m)) as Loose;
  fn(o);
  const checked = validateModel(o, REGISTRY);
  if (!checked.ok) throw new Error(checked.errors.join(' '));
  return checked.model;
};
const A = make(3, 'a-1');
const ok = (r: ReturnType<typeof compareModels>): Comparison => {
  if (!r.ok) throw new Error(r.message);
  return r;
};

describe('identical conditions', () => {
  it('two saves of one run are comparable with no reasons, a marker, and a shared replay', () => {
    const later = make(3, 'a-2', 3);
    const c = ok(compareModels(A, later));
    expect(c.fitness).toEqual({ comparable: true, reasons: [] });
    expect(c.sharedReplay).toEqual({ ok: true });
    expect(['a', 'b', 'tie']).toContain(c.marker);
    expect(c.warnings).toEqual([]);
    expect(c.rows.find((r) => r.label === 'Generation')).toMatchObject({ a: '1', b: '3', state: 'different' });
  });
  it('a model compared with itself is the same on every comparable row', () => {
    const c = ok(compareModels(A, A));
    expect(c.marker).toBe('tie');
    expect(c.rows.filter((r) => r.state === 'different')).toEqual([]);
  });
});

describe('each single difference makes fitness not comparable and is listed', () => {
  const cases: [string, (o: Loose) => void, string][] = [
    ['fitness version', (o) => { o.training.configuration.fitness.version = 2; o.training.fitnessVersion = 2; }, 'fitness version'],
    ['a fitness weight', (o) => { o.training.configuration.fitness.lapWeight += 1; }, 'fitness weights differ: lapWeight'],
    ['simulation version', (o) => { o.simulationVersion += 1; }, 'simulation version'],
    ['episode time limit', (o) => { o.training.configuration.maxEpisodeSeconds = 11; o.training.maxEpisodeSeconds = 11; }, 'episode time limit'],
    ['stall limit', (o) => { o.training.configuration.stallSeconds += 1; }, 'stall limit'],
    ['laps per episode', (o) => { o.training.configuration.maxLaps += 1; }, 'laps per episode'],
    ['timestep', (o) => { o.training.configuration.timestepSeconds = 0.02; }, 'timestep'],
    ['a physics field', (o) => { o.training.configuration.physics.wheelbase += 0.1; }, 'physics differ: wheelbase'],
  ];
  for (const [label, fn, expected] of cases) {
    it(label, () => {
      const c = ok(compareModels(A, edited(A, fn)));
      expect(c.fitness.comparable).toBe(false);
      expect(c.marker).toBeNull();
      expect(c.fitness.reasons.join(' ')).toContain(expected);
      expect(c.warnings.join(' ')).toContain('not ranked');
    });
  }
  it('lists every reason when several differ, not only the first', () => {
    const c = ok(compareModels(A, edited(A, (o) => { o.training.configuration.fitness.version = 2; o.training.fitnessVersion = 2; o.training.configuration.timestepSeconds = 0.02; o.training.configuration.stallSeconds += 1; })));
    expect(c.fitness.reasons.length).toBeGreaterThanOrEqual(3);
  });
});

describe('score comparability and replay compatibility are separate questions', () => {
  it('a fitness-version-only difference: not ranked, but the combined replay stays available', () => {
    const other = edited(A, (o) => { o.training.configuration.fitness.version = 2; o.training.fitnessVersion = 2; });
    const c = ok(compareModels(A, other));
    expect(c.fitness.comparable).toBe(false);
    expect(c.marker).toBeNull();
    expect(c.sharedReplay).toEqual({ ok: true });
    expect(c.warnings.join(' ')).toContain('not ranked');
    expect(c.warnings.join(' ')).not.toContain('cannot be replayed together');
  });
  it('a fitness weight difference alone also leaves the combined replay available', () => {
    expect(ok(compareModels(A, edited(A, (o) => { o.training.configuration.fitness.lapWeight += 1; }))).sharedReplay).toEqual({ ok: true });
  });
  it('a timestep difference: not ranked and the combined replay is refused with reasons', () => {
    const c = ok(compareModels(A, edited(A, (o) => { o.training.configuration.timestepSeconds = 0.02; })));
    expect(c.fitness.comparable).toBe(false);
    expect(c.sharedReplay).toMatchObject({ ok: false });
    if (!c.sharedReplay.ok) expect(c.sharedReplay.reasons.join(' ')).toContain('timesteps differ');
    expect(c.warnings.join(' ')).toContain('cannot be replayed together');
  });
  it('a physics difference refuses the combined replay with the field named', () => {
    const c = ok(compareModels(A, edited(A, (o) => { o.training.configuration.physics.wheelbase += 0.1; })));
    if (c.sharedReplay.ok) throw new Error('expected a refusal');
    expect(c.sharedReplay.reasons.join(' ')).toContain('wheelbase');
  });
  it('a simulation version this build cannot drive refuses the combined replay but still compares', () => {
    const c = ok(compareModels(A, edited(A, (o) => { o.simulationVersion = 999; })));
    if (c.sharedReplay.ok) throw new Error('expected a refusal');
    expect(c.sharedReplay.reasons.join(' ')).toContain('cannot be driven');
    expect(c.rows.length).toBeGreaterThan(10);
  });
  it('a different brake mask or population is a difference but not a reason to refuse the replay', () => {
    const other = edited(A, (o) => { o.architecture.brakeEnabled = false; o.training.configuration.brakeEnabled = false; });
    const c = ok(compareModels(A, other));
    expect(c.rows.find((r) => r.label === 'Brake output')?.state).toBe('different');
    expect(c.sharedReplay).toEqual({ ok: true });
  });
});

describe('unavailable and present results are shown truthfully', () => {
  it('an unavailable seed and an absent evaluation are unavailable, never zero', () => {
    const noSeed = edited(A, (o) => { o.training.seed = null; o.training.seedUnavailableReason = 'legacy data'; });
    const c = ok(compareModels(A, noSeed));
    expect(c.rows.find((r) => r.label === 'Seed')).toMatchObject({ state: 'unavailable', b: 'unavailable: legacy data' });
    expect(c.rows.find((r) => r.label === 'Evaluation')).toMatchObject({ state: 'unavailable', a: EVALUATION_ABSENT, b: EVALUATION_ABSENT });
  });
  it('a non-empty evaluation is shown as recorded but unsupported and unverified, with only a count, and never changes ranking', () => {
    const withEvaluation = edited(A, (o) => { o.evaluation = [{ anything: 'at all' }, 7, null]; });
    const c = ok(compareModels(A, withEvaluation));
    const row = c.rows.find((r) => r.label === 'Evaluation')!;
    expect(row.a).toBe(EVALUATION_ABSENT);
    expect(row.b).toBe(evaluationPresent(3));
    expect(row.state).not.toBe('unavailable');
    expect(c.fitness.comparable).toBe(true);
    expect(JSON.stringify(c)).not.toContain('at all');
  });
  it('hostile evaluation entries are never rendered raw and never throw', () => {
    const hostile = edited(A, (o) => { o.evaluation = [{ toString: null }, '<img src=x onerror=1>', Array.from({ length: 50 }, () => ({ nested: [[[[1]]]] })), 'x'.repeat(100_000)]; });
    const c = ok(compareModels(A, hostile));
    const text = JSON.stringify(c);
    expect(text).not.toContain('onerror');
    expect(text.length).toBeLessThan(20_000);
  });
  it('a model with no evaluation field at all is treated as absent', () => {
    const noField = edited(A, (o) => { delete o.evaluation; });
    expect(ok(compareModels(A, noField)).rows.find((r) => r.label === 'Evaluation')?.a).toBe(EVALUATION_ABSENT);
  });
});

describe('symmetry, honesty and safety', () => {
  it('swapping A and B swaps the columns and keeps the verdicts', () => {
    const other = edited(A, (o) => { o.training.configuration.timestepSeconds = 0.02; });
    const ab = ok(compareModels(A, other));
    const ba = ok(compareModels(other, A));
    expect(ba.fitness.comparable).toBe(ab.fitness.comparable);
    expect(ba.sharedReplay.ok).toBe(ab.sharedReplay.ok);
    ab.rows.forEach((row, i) => expect([ba.rows[i]!.a, ba.rows[i]!.b]).toEqual([row.b, row.a]));
  });
  it('the marker follows the higher fitness only when comparable', () => {
    const higher = edited(A, (o) => { o.fitness = A.fitness + 1; });
    expect(ok(compareModels(A, higher)).marker).toBe('b');
    expect(ok(compareModels(higher, A)).marker).toBe('a');
  });
  it('no generated text claims one model is better, improved or generalises', () => {
    const results = [compareModels(A, make(3, 'a-2', 2)), compareModels(A, edited(A, (o) => { o.training.configuration.timestepSeconds = 0.02; o.evaluation = [1]; }))];
    const forbidden = /\b(better|worse|improv\w*|learn\w*|generalis\w*|wins?|winner|best|superior|outperform\w*)\b/i;
    for (const r of results) {
      const c = ok(r);
      const strings = [...c.warnings, ...c.fitness.reasons, ...(c.sharedReplay.ok ? [] : c.sharedReplay.reasons), ...c.rows.flatMap((row) => [row.label, row.a, row.b])];
      for (const s of strings) expect(s, s).not.toMatch(forbidden);
    }
    expect(FITNESS_CAVEAT).not.toMatch(/\b(better|improv\w*|learn\w*|generalis\w*)\b/i);
  });
  it('never throws on anything that is not a validated model', () => {
    for (const hostile of [null, undefined, 3, 'x', {}, [], { training: null }, { architecture: {} }]) {
      expect(() => compareModels(hostile as never, A)).not.toThrow();
      expect(compareModels(hostile as never, A).ok).toBe(false);
      expect(compareModels(A, hostile as never).ok).toBe(false);
    }
    const deep = JSON.parse(`{"x":${'['.repeat(10_000)}${']'.repeat(10_000)}}`);
    expect(() => compareModels({ ...A, extra: deep } as never, A)).not.toThrow();
  });
});
