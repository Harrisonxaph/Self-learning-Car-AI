// Comparing two saved models' recorded evaluations (P5-05 step 1, docs/plans/p5-05-plan.md). Synthetic rows and one real entry as the
// template; every figure below is computed by hand. Nothing here is a result about any model.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareEvaluations, spreadOf, NO_EVALUATIONS, type CircuitComparison, type EvaluationComparison } from '../../src/persistence/evaluationCompare';
import type { EvaluationEntry, EvaluationRow } from '../../src/persistence/evaluationEntry';
import type { ModelDocument } from '../../src/persistence/modelFormat';
import { entryWithRows, makeModel, realEntry, row } from '../helpers/evaluationFixtures';

const A = makeModel(5, 'cmp-a');
const B = makeModel(6, 'cmp-b');
const BASE = realEntry(A, 'kidney-loop');

const done = (seed: number, ticks: number): EvaluationRow => row(seed, 'timeout', 10, 10, 1, ticks); // one lap, ticks / 60 seconds
const crash = (seed: number, gates: number): EvaluationRow => row(seed, 'crashed', gates, 10);
const five = (make: (seed: number) => EvaluationRow): EvaluationRow[] => [0, 1, 2, 3, 4].map(make);

/** An entry for `model` on `trackId` with exactly these rows (summary recomputed), the same conditions as BASE unless overridden. */
const entry = (model: ModelDocument, trackId: string, rows: readonly EvaluationRow[], extra: Partial<EvaluationEntry> = {}): EvaluationEntry => ({
  ...entryWithRows(BASE, rows),
  modelId: model.id,
  track: { ...BASE.track, id: trackId },
  ...extra,
});
const ok = (r: ReturnType<typeof compareEvaluations>): EvaluationComparison => {
  if (!r.ok) throw new Error(r.message);
  return r;
};
const circuit = (c: EvaluationComparison, id: string): CircuitComparison => c.circuits.find((x) => x.trackId === id)!;
const withPhysics = (m: ModelDocument, physics: Record<string, number>): ModelDocument => ({
  ...m,
  training: { ...m.training, configuration: { ...m.training.configuration, physics: { ...m.training.configuration.physics, ...physics } } },
});

describe('spreadOf (by hand)', () => {
  it('is null for no values, has no standard deviation for one, and is the population value otherwise', () => {
    expect(spreadOf([])).toBeNull();
    expect(spreadOf([7])).toEqual({ n: 1, min: 7, max: 7, sd: null });
    const s = spreadOf([10, 10, 15, 20])!;
    expect(s).toMatchObject({ n: 4, min: 10, max: 20 });
    expect(s.sd).toBeCloseTo(Math.sqrt(17.1875), 12); // mean 13.75; squared deviations 14.0625, 14.0625, 1.5625, 39.0625; /4
  });
});

describe('the per-circuit comparison', () => {
  it('shows both champions side by side with A minus B, the sample size of the lap time and the spread across the five starts', () => {
    const a = entry(A, 'x', [done(0, 600), done(1, 600), done(2, 900), done(3, 1200), crash(4, 3)]);
    const b = entry(B, 'x', five((s) => crash(s, 2)));
    const c = ok(compareEvaluations(A, B, [a], [b]));
    const x = circuit(c, 'x');
    expect(x.state).toBe('compared');
    expect(x.reasons).toEqual([]);
    expect(x.a).toMatchObject({ episodes: 5, lapCompletion: 4 / 5, collisionRate: 1 / 5, firstLapSamples: 4, olderIgnored: 0 });
    expect(x.a!.meanFirstLapSeconds).toBeCloseTo(13.75, 12);
    expect(x.a!.firstLapSpread).toMatchObject({ n: 4, min: 10, max: 20 });
    expect(x.a!.firstLapSpread!.sd).toBeCloseTo(Math.sqrt(17.1875), 12);
    expect(x.a!.progressSpread).toMatchObject({ n: 5, min: 0.3, max: 1 });
    expect(x.b).toMatchObject({ lapCompletion: 0, collisionRate: 1, firstLapSamples: 0, meanFirstLapSeconds: null, firstLapSpread: null });
    expect(x.difference!.lapCompletion).toBeCloseTo(4 / 5, 12);
    expect(x.difference!.meanFirstLapSeconds).toBeNull(); // B has no lap time: the difference is unavailable, never a made-up number
  });

  it('shows a circuit evaluated for one champion only with no numbers for the other side, never zero', () => {
    const a = entry(A, 'x', five((s) => done(s, 600)));
    const b = entry(B, 'y', five((s) => done(s, 600)));
    const c = ok(compareEvaluations(A, B, [a, entry(A, 'y', five((s) => crash(s, 1)))], [b, entry(B, 'z', five((s) => done(s, 600)))]));
    expect(circuit(c, 'x')).toMatchObject({ state: 'a-only', b: null, difference: null });
    expect(circuit(c, 'z')).toMatchObject({ state: 'b-only', a: null, difference: null });
    expect(circuit(c, 'y').state).toBe('compared');
    expect(c.warnings.join(' ')).toMatch(/x was evaluated for A only/);
    expect(c.warnings.join(' ')).toMatch(/z was evaluated for B only/);
  });

  it('refuses when no circuit can be compared, and when either champion has no recognised evaluation', () => {
    const a = entry(A, 'x', five((s) => done(s, 600)));
    const b = entry(B, 'y', five((s) => done(s, 600)));
    const none = compareEvaluations(A, B, [a], [b]);
    expect(none.ok).toBe(false);
    expect(!none.ok && none.message).toMatch(/share no evaluated circuit/);
    expect(compareEvaluations(A, B, [], [b])).toEqual({ ok: false, message: NO_EVALUATIONS });
    expect(compareEvaluations(A, B, [a], [])).toEqual({ ok: false, message: NO_EVALUATIONS });
  });
});

describe('compatibility: each mismatch alone, with its reason', () => {
  const rows = (): EvaluationRow[] => five((s) => done(s, 600));
  const other = (extra: Partial<EvaluationEntry>) => ok(compareEvaluations(A, B, [entry(A, 'x', rows()), entry(A, 'y', rows())], [entry(B, 'x', rows(), extra), entry(B, 'y', rows())]));
  const reasonsOf = (c: EvaluationComparison) => circuit(c, 'x').reasons.join(' ');
  it('the track version', () => {
    const c = other({ track: { ...BASE.track, id: 'x', version: 'other' } });
    expect(circuit(c, 'x').state).toBe('not-compared');
    expect(reasonsOf(c)).toMatch(/track version differs/);
    expect(circuit(c, 'y').state).toBe('compared');
  });
  it('the track content hash', () => expect(reasonsOf(other({ track: { ...BASE.track, id: 'x', contentHash: `sha256:${'0'.repeat(64)}` } }))).toMatch(/track content differs/));
  it('the evaluation settings (config hash)', () => expect(reasonsOf(other({ configHash: `sha256:${'1'.repeat(64)}` }))).toMatch(/evaluation settings differ/));
  it('the fitness version', () => expect(reasonsOf(other({ fitnessVersion: 2 }))).toMatch(/fitness version differs/));
  it('the timestep', () => expect(reasonsOf(other({ timestepSeconds: 0.02 }))).toMatch(/timestep differs/));
  it('the recorded starts', () => expect(reasonsOf(other({ starts: BASE.starts.map((s, i) => (i === 2 ? { ...s, lateralMetres: s.lateralMetres + 0.5 } : s)) }))).toMatch(/recorded starts differ/));
  it('the two champions’ vehicle physics (the entry records no physics) make every circuit not comparable', () => {
    const r = compareEvaluations(A, withPhysics(B, { maxSpeed: 99 }), [entry(A, 'x', rows())], [entry(B, 'x', rows())]);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toMatch(/vehicle physics differ: maxSpeed/);
  });
  it('lists every reason at once, keeps the circuit visible with both champions’ own numbers, and leaves it out of every aggregate', () => {
    const c = ok(compareEvaluations(A, B, [entry(A, 'x', rows()), entry(A, 'y', rows()), entry(A, 'z', rows())], [entry(B, 'x', rows(), { fitnessVersion: 2, timestepSeconds: 0.02 }), entry(B, 'y', rows()), entry(B, 'z', rows())]));
    const x = circuit(c, 'x');
    expect(x.state).toBe('not-compared');
    expect(x.reasons.length).toBeGreaterThanOrEqual(2);
    expect(x.reasons.join(' ')).toMatch(/fitness version differs/);
    expect(x.reasons.join(' ')).toMatch(/timestep differs/);
    expect(x.a).not.toBeNull();
    expect(x.b).not.toBeNull();
    expect(x.difference).toBeNull();
    expect(c.aggregate!.circuits).toEqual(['y', 'z']);
  });
  it('a brake difference is shown as a note and does not block the comparison', () => {
    const c = ok(compareEvaluations(A, B, [entry(A, 'x', rows())], [entry(B, 'x', rows(), { brakeEnabled: !BASE.brakeEnabled })]));
    expect(circuit(c, 'x').state).toBe('compared');
    expect(c.warnings.join(' ')).toMatch(/brake output masked/);
  });
});

describe('the aggregates', () => {
  const X = (m: ModelDocument, rows: EvaluationRow[]) => entry(m, 'x', rows);
  it('are absent for one compared circuit, present for two or more', () => {
    expect(ok(compareEvaluations(A, B, [X(A, five((s) => done(s, 600)))], [X(B, five((s) => done(s, 600)))])).aggregate).toBeNull();
    const two = ok(compareEvaluations(A, B, [entry(A, 'x', five((s) => done(s, 600))), entry(A, 'y', five((s) => done(s, 600)))], [entry(B, 'x', five((s) => done(s, 600))), entry(B, 'y', five((s) => done(s, 600)))]));
    expect(two.aggregate!.circuits).toEqual(['x', 'y']);
    expect(two.aggregate!.episodesPerCircuit).toBe(5);
  });

  it('take completion, collision and progress over ALL compared circuits, including circuits where a champion never completed', () => {
    // x: A 5/5 laps, B 2/5; y: both 5/5; z: A 0/5 (all crash at gate 4), B 5/5.
    const a = [entry(A, 'x', five((s) => done(s, 600))), entry(A, 'y', five((s) => done(s, 1200))), entry(A, 'z', five((s) => crash(s, 4)))];
    const b = [entry(B, 'x', [done(0, 900), done(1, 900), crash(2, 2), crash(3, 2), crash(4, 2)]), entry(B, 'y', five((s) => done(s, 1800))), entry(B, 'z', five((s) => done(s, 600)))];
    const g = ok(compareEvaluations(A, B, a, b)).aggregate!;
    expect(g.circuits).toEqual(['x', 'y', 'z']);
    expect(g.lapCompletion.a).toBeCloseTo((1 + 1 + 0) / 3, 12);
    expect(g.lapCompletion.b).toBeCloseTo((0.4 + 1 + 1) / 3, 12);
    expect(g.lapCompletion.difference).toBeCloseTo(2 / 3 - 0.8, 12);
    expect(g.collisionRate.a).toBeCloseTo((0 + 0 + 1) / 3, 12);
    expect(g.collisionRate.b).toBeCloseTo((0.6 + 0 + 0) / 3, 12);
    expect(g.meanOrderedProgress.a).toBeCloseTo((1 + 1 + 0.4) / 3, 12);
    expect(g.meanOrderedProgress.b).toBeCloseTo((0.52 + 1 + 1) / 3, 12); // x: (1 + 1 + 0.2 + 0.2 + 0.2) / 5 = 0.52
  });

  describe('the lap time (only over circuits where BOTH completed a lap)', () => {
    it('several eligible circuits: each model’s mean over the same paired set, A minus B, each model’s own sample count, the others named as excluded', () => {
      const a = [entry(A, 'x', five((s) => done(s, 600))), entry(A, 'y', five((s) => done(s, 1200))), entry(A, 'z', five((s) => crash(s, 4)))];
      const b = [entry(B, 'x', [done(0, 900), done(1, 900), crash(2, 2), crash(3, 2), crash(4, 2)]), entry(B, 'y', five((s) => done(s, 1800))), entry(B, 'z', five((s) => done(s, 600)))];
      const t = ok(compareEvaluations(A, B, a, b)).aggregate!.lapTime;
      expect(t.state).toBe('values');
      expect(t.pairedCircuits).toEqual(['x', 'y']);
      expect(t.excludedCircuits).toEqual(['z']); // A completed no lap there: B's 10 s is NOT averaged on its own
      expect(t.a).toBeCloseTo((10 + 20) / 2, 12);
      expect(t.b).toBeCloseTo((15 + 30) / 2, 12);
      expect(t.difference).toBeCloseTo(15 - 22.5, 12);
      expect(t.samplesA).toBe(5 + 5);
      expect(t.samplesB).toBe(2 + 5); // B's x mean uses only its two completed starts
    });
    it('disjoint completions: A completes a lap only on x, B only on y, so there is no paired circuit and the aggregate is unavailable, both rows kept', () => {
      const a = [entry(A, 'x', five((s) => done(s, 600))), entry(A, 'y', five((s) => crash(s, 3)))];
      const b = [entry(B, 'x', five((s) => crash(s, 3))), entry(B, 'y', five((s) => done(s, 600)))];
      const c = ok(compareEvaluations(A, B, a, b));
      const t = c.aggregate!.lapTime;
      expect(t).toMatchObject({ state: 'unavailable', pairedCircuits: [], excludedCircuits: ['x', 'y'], a: null, b: null, difference: null, samplesA: 0, samplesB: 0 });
      expect(t.note).toMatch(/No circuit where both champions completed a lap/);
      expect(circuit(c, 'x').a!.meanFirstLapSeconds).toBeCloseTo(10, 12); // the per-circuit rows are untouched
      expect(circuit(c, 'x').b!.meanFirstLapSeconds).toBeNull();
      expect(circuit(c, 'y').b!.meanFirstLapSeconds).toBeCloseTo(10, 12);
      expect(c.aggregate!.lapCompletion.a).toBeCloseTo(0.5, 12); // the completion aggregate still covers both circuits
    });
    it('one eligible circuit: its own row stands and no aggregate value is shown', () => {
      const a = [entry(A, 'x', five((s) => done(s, 600))), entry(A, 'y', five((s) => crash(s, 3)))];
      const b = [entry(B, 'x', five((s) => done(s, 900))), entry(B, 'y', five((s) => done(s, 600)))];
      const t = ok(compareEvaluations(A, B, a, b)).aggregate!.lapTime;
      expect(t).toMatchObject({ state: 'single', pairedCircuits: ['x'], excludedCircuits: ['y'], a: null, b: null, difference: null, samplesA: 5, samplesB: 5 });
    });
    it('no eligible circuit (neither completed a lap anywhere): unavailable, never zero', () => {
      const a = [entry(A, 'x', five((s) => crash(s, 3))), entry(A, 'y', five((s) => crash(s, 3)))];
      const b = [entry(B, 'x', five((s) => crash(s, 4))), entry(B, 'y', five((s) => crash(s, 4)))];
      const t = ok(compareEvaluations(A, B, a, b)).aggregate!.lapTime;
      expect(t).toMatchObject({ state: 'unavailable', a: null, b: null, difference: null });
    });
    it('asymmetric successful starts: 5 completed starts for A against 1 for B on one circuit, each model’s mean over only its own completed starts and each sample count shown', () => {
      const a = [entry(A, 'x', five((s) => done(s, 600))), entry(A, 'y', five((s) => done(s, 1200)))];
      const b = [entry(B, 'x', [done(0, 1500), crash(1, 2), crash(2, 2), crash(3, 2), crash(4, 2)]), entry(B, 'y', five((s) => done(s, 1800)))];
      const c = ok(compareEvaluations(A, B, a, b));
      expect(circuit(c, 'x').b).toMatchObject({ firstLapSamples: 1, meanFirstLapSeconds: 25 });
      expect(circuit(c, 'x').b!.firstLapSpread).toEqual({ n: 1, min: 25, max: 25, sd: null });
      const t = c.aggregate!.lapTime;
      expect(t.samplesA).toBe(10);
      expect(t.samplesB).toBe(6);
      expect(t.b).toBeCloseTo((25 + 30) / 2, 12);
    });
    it('a missing lap time is never treated as zero or dropped from one side only', () => {
      const a = [entry(A, 'x', five((s) => done(s, 600))), entry(A, 'y', five((s) => done(s, 600))), entry(A, 'z', five((s) => done(s, 600)))];
      const b = [entry(B, 'x', five((s) => done(s, 600))), entry(B, 'y', five((s) => done(s, 600))), entry(B, 'z', five((s) => crash(s, 1)))];
      const t = ok(compareEvaluations(A, B, a, b)).aggregate!.lapTime;
      expect(t.pairedCircuits).toEqual(['x', 'y']);
      expect(t.a).toBeCloseTo(10, 12); // A's z (10 s) is not averaged in on its own: that would compare different circuit sets
      expect(t.b).toBeCloseTo(10, 12);
      expect(t.difference).toBeCloseTo(0, 12);
    });
  });

  it('never produces a spread across circuits (a mean of standard deviations is not a pooled spread)', () => {
    const c = ok(compareEvaluations(A, B, [entry(A, 'x', five((s) => done(s, 600))), entry(A, 'y', five((s) => done(s + 0, 900)))], [entry(B, 'x', five((s) => done(s, 600))), entry(B, 'y', five((s) => done(s, 900)))]));
    expect(JSON.stringify(c.aggregate)).not.toMatch(/spread|sd/i);
  });
});

describe('which entry is used', () => {
  it('the most recent per circuit, with the number of older ones reported; a later position breaks a tie', () => {
    const old = entry(A, 'x', five((s) => crash(s, 1)), { recordedAt: '2026-11-10T00:00:00.000Z' });
    const mid = entry(A, 'x', five((s) => done(s, 600)), { recordedAt: '2026-11-12T00:00:00.000Z' });
    const tied = entry(A, 'x', five((s) => done(s, 900)), { recordedAt: '2026-11-12T00:00:00.000Z' });
    const c = ok(compareEvaluations(A, B, [old, mid, tied], [entry(B, 'x', five((s) => done(s, 600)))]));
    expect(circuit(c, 'x').a).toMatchObject({ olderIgnored: 2, meanFirstLapSeconds: 15 }); // the tied, later entry
    expect(c.warnings.join(' ')).toMatch(/2 older recorded evaluations were not used/);
    const reordered = ok(compareEvaluations(A, B, [tied, old, mid], [entry(B, 'x', five((s) => done(s, 600)))]));
    expect(circuit(reordered, 'x').a!.meanFirstLapSeconds).toBeCloseTo(10, 12); // now `mid` is the later of the tied pair
  });
});

describe('hostile and unreadable input', () => {
  it('ignores entries that belong to another champion, says so, and never throws on garbage', () => {
    const mine = entry(A, 'x', five((s) => done(s, 600)));
    const theirs = entry(B, 'x', five((s) => done(s, 600)));
    const c = ok(compareEvaluations(A, B, [mine, entry(B, 'y', five((s) => done(s, 600)))], [theirs]));
    expect(c.circuits.map((x) => x.trackId)).toEqual(['x']);
    expect(c.warnings.join(' ')).toMatch(/1 evaluation entry of A belong to another champion/);
    expect(() => compareEvaluations(A, B, [null as never], [theirs])).not.toThrow();
    const garbage = compareEvaluations(A, B, [null as never], [theirs]);
    expect(garbage.ok).toBe(false);
    expect(() => compareEvaluations(null as never, B, [mine], [theirs])).not.toThrow();
  });
});

describe('what it never says, and what it never imports', () => {
  it('has no verdict wording anywhere in its output', () => {
    const a = [entry(A, 'x', five((s) => done(s, 600))), entry(A, 'y', five((s) => crash(s, 2)))];
    const b = [entry(B, 'x', five((s) => done(s, 900))), entry(B, 'y', five((s) => done(s, 600)))];
    const text = JSON.stringify(compareEvaluations(A, B, a, b));
    expect(text).not.toMatch(/better|worse|winner|best|outperform|superior|significant|ranked|beats/i);
  });
  it('imports only the evaluation entry, the model format and the model comparison (no simulation, training, study or held-out module)', () => {
    const source = readFileSync('src/persistence/evaluationCompare.ts', 'utf8');
    const imports = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]).sort();
    expect(imports).toEqual(['./evaluationEntry', './modelCompare', './modelFormat']);
    expect(source).not.toMatch(/heldOut|held-out access|\.\.\/(sim|training|ai|sensors|evolution|ui)/);
  });
});
