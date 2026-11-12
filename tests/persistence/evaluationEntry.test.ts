// The P4-05 evaluation entry: summary by hand, validation against the recorded protocol (adversarial entries that still add up are
// refused), recognition, the supported model-ID range, and independence from JSON key order. Synthetic rows and a tiny trained
// champion; nothing here is a result.
import { describe, expect, it } from 'vitest';
import { EVALUATION_KIND, MAX_EVALUATION_ENTRIES, recogniseEvaluations, summariseRows, validateEvaluationEntry } from '../../src/persistence/evaluationEntry';
import { EVALUATION_REGISTRY } from '../../src/ui/modelEvaluation';
import { bindingFor, entryWithRows, makeModel, realEntry, row } from '../helpers/evaluationFixtures';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const model = makeModel(5, 'ev-1');
const base = realEntry(model, 'kidney-loop');
const REG = { registry: EVALUATION_REGISTRY };
const errorsOf = (e: unknown, context = REG): string => {
  const r = validateEvaluationEntry(e, context);
  return r.ok ? '' : r.errors.join(' ');
};
/** An entry with its rows replaced and its summary recomputed: still internally "adds up". */
const withRows = (mutate: (rows: Json[]) => void): Json => {
  const rows = clone(base.rows) as unknown as Json[];
  mutate(rows);
  return entryWithRows(base, rows as never) as unknown as Json;
};

describe('summariseRows (checked by hand)', () => {
  const rows = [
    row(0, 'completed', 51, 17, 3, 900), // 3 laps, first lap 900 ticks = 15 s
    row(1, 'crashed', 4, 17),
    row(2, 'timeout', 20, 17, 1, 1200), // 1 lap, 20 s
    row(3, 'stalled', 6, 17),
    row(4, 'crashed', 0, 17),
  ];
  it('uses every episode as the denominator, so timeouts and stalls count against completion', () => {
    const s = summariseRows(rows);
    expect(s.episodes).toBe(5);
    expect(s.lapCompletion).toBeCloseTo(2 / 5, 12);
    expect(s.collisionRate).toBeCloseTo(2 / 5, 12);
    expect(s.outcomes).toEqual({ completed: 1, crashed: 2, stalled: 1, timeout: 1 });
    expect(s.meanOrderedProgress).toBeCloseTo((51 + 4 + 20 + 6 + 0) / 17 / 5, 12);
    expect(s.firstLapSamples).toBe(2);
    expect(s.meanFirstLapSeconds).toBeCloseTo((15 + 20) / 2, 9);
  });
  it('has a null lap time and a zero sample count (never zero seconds) when no lap completed', () => {
    const s = summariseRows([row(0, 'crashed', 3, 17), row(1, 'stalled', 5, 17)]);
    expect(s.meanFirstLapSeconds).toBeNull();
    expect(s.firstLapSamples).toBe(0);
    expect(s.lapCompletion).toBe(0);
  });
  it('is defined for no rows', () => {
    expect(summariseRows([])).toMatchObject({ episodes: 0, lapCompletion: 0, collisionRate: 0, meanFirstLapSeconds: null, firstLapSamples: 0 });
  });
});

describe('validateEvaluationEntry: structure', () => {
  it('accepts a real entry, with and without the registry and the model binding', () => {
    expect(validateEvaluationEntry(base).ok).toBe(true);
    expect(validateEvaluationEntry(base, REG).ok).toBe(true);
    expect(validateEvaluationEntry(base, bindingFor(model)).ok).toBe(true);
  });
  it.each<[string, (e: Json) => void, RegExp]>([
    ['a wrong kind', (e) => { e.kind = 'x'; }, /kind/],
    ['a wrong protocol', (e) => { e.protocol = 'p9'; }, /protocol/],
    ['a held-out split', (e) => { e.track.split = 'held-out'; }, /held-out/],
    ['an unknown split', (e) => { e.track.split = 'test'; }, /split/],
    ['a tampered config hash', (e) => { e.configHash = `sha256:${'0'.repeat(64)}`; }, /configHash/],
    ['limits that are not the protocol\'s', (e) => { e.config.maxLaps = 9; }, /protocol's limits/],
    ['another fitness version', (e) => { e.fitnessVersion = 2; }, /fitnessVersion/],
    ['a bad frozen id', (e) => { e.frozenModelId = 'abc'; }, /frozenModelId/],
    ['a non-finite offset', (e) => { e.starts[2].lateralMetres = Number.POSITIVE_INFINITY; }, /starts\[2\]/],
    ['an unknown outcome', (e) => { e.rows[0].outcome = 'won'; }, /rows\[0\]/],
    ['a missing time stamp', (e) => { e.recordedAt = ''; }, /recordedAt/],
  ])('refuses %s', (_name, mutate, pattern) => {
    const e = clone(base) as Json;
    mutate(e);
    expect(errorsOf(e)).toMatch(pattern);
  });
  it.each([null, undefined, 5, 'x', [], {}])('never throws for hostile input %j', (value) => {
    expect(validateEvaluationEntry(value).ok).toBe(false);
    expect(validateEvaluationEntry(value, bindingFor(model)).ok).toBe(false);
  });
});

describe('validateEvaluationEntry: the recorded protocol (entries that still add up are refused)', () => {
  it('exactly five starts and five rows: not 1, not 6, not 20', () => {
    for (const n of [0, 1, 4, 6, 20]) {
      const e = clone(base) as Json;
      e.starts = Array.from({ length: n }, (_, i) => ({ ...clone(base.starts[0]), seed: i }));
      e.rows = Array.from({ length: n }, (_, i) => ({ ...clone(base.rows[0]), seed: i }));
      e.summary = summariseRows(e.rows);
      expect(errorsOf(e), `${n} starts`).toMatch(/exactly 5/);
    }
  });
  it('a nominal start 10,000 m off the track is refused (with the registry), and a start outside the bounds always is', () => {
    const far = clone(base) as Json;
    far.starts[0].x += 10_000;
    expect(errorsOf(far)).toMatch(/not the start the protocol derives/);
    const wide = clone(base) as Json;
    wide.starts[1].lateralMetres = 5;
    expect(errorsOf(wide, {} as never)).toMatch(/outside the protocol's start bounds/);
    const nominal = clone(base) as Json;
    nominal.starts[0].lateralMetres = 0.5;
    expect(errorsOf(nominal, {} as never)).toMatch(/nominal start/);
  });
  it('every perturbed start must be the one the protocol derives for the circuit', () => {
    for (const i of [1, 2, 3, 4]) {
      const e = clone(base) as Json;
      e.starts[i].y += 0.5;
      expect(errorsOf(e), `start ${i}`).toMatch(new RegExp(`starts\\[${i}\\] is not the start the protocol derives`));
    }
  });
  it('100 laps in one tick is refused', () => {
    expect(errorsOf(withRows((r) => { r[0]!.laps = 100; r[0]!.ticks = 1; r[0]!.firstLapTicks = 1; r[0]!.firstLapSeconds = 1 / 60; r[0]!.gatesPassed = 100 * r[0]!.gates + 1; r[0]!.orderedProgress = r[0]!.gatesPassed / r[0]!.gates; }))).toMatch(/laps cannot exceed 3/);
  });
  it('a first lap at tick 9000 / 123 s in an episode that is too short, or with seconds that are not ticks times the timestep, is refused', () => {
    const g = base.rows[0]!.gates;
    expect(errorsOf(withRows((r) => { r[0]!.laps = 1; r[0]!.gatesPassed = g + 1; r[0]!.orderedProgress = (g + 1) / g; r[0]!.ticks = 3000; r[0]!.firstLapTicks = 9000; r[0]!.firstLapSeconds = 150; r[0]!.outcome = 'timeout'; }))).toMatch(/more ticks than the episode/);
    expect(errorsOf(withRows((r) => { r[0]!.laps = 1; r[0]!.gatesPassed = g + 1; r[0]!.orderedProgress = (g + 1) / g; r[0]!.ticks = 3600; r[0]!.outcome = 'timeout'; r[0]!.firstLapTicks = 1000; r[0]!.firstLapSeconds = 123; }))).toMatch(/seconds must equal its ticks times the timestep/);
  });
  it('ticks beyond the episode budget, a timeout that did not use it, and a completed episode without three laps are refused', () => {
    expect(errorsOf(withRows((r) => { r[1]!.ticks = 3601; }))).toMatch(/episode budget/);
    expect(errorsOf(withRows((r) => { r[1]!.outcome = 'timeout'; r[1]!.ticks = 100; }))).toMatch(/whole episode budget/);
    expect(errorsOf(withRows((r) => { r[1]!.outcome = 'completed'; r[1]!.laps = 0; }))).toMatch(/exactly 3 laps/);
  });
  it('a lap count its gate credits cannot support, and a gate count that is not the circuit\'s, are refused', () => {
    expect(errorsOf(withRows((r) => { r[0]!.laps = 1; r[0]!.firstLapTicks = 500; r[0]!.firstLapSeconds = 500 / 60; r[0]!.gatesPassed = 3; r[0]!.orderedProgress = 3 / r[0]!.gates; }))).toMatch(/every gate and the start line/);
    expect(errorsOf(withRows((r) => { r[2]!.gates = 99; r[2]!.orderedProgress = r[2]!.gatesPassed / 99; }))).toMatch(/gate count/);
  });
  it('a track that is not one of the allowed circuits, or has another hash, is refused; with no registry only the structure is checked', () => {
    const unknown = clone(base) as Json;
    unknown.track.id = 'not-a-built-in-circuit';
    expect(errorsOf(unknown)).toMatch(/not a built-in training or validation circuit/);
    expect(validateEvaluationEntry(unknown).ok).toBe(true);
    const hash = clone(base) as Json;
    hash.track.contentHash = `sha256:${'1'.repeat(64)}`;
    expect(errorsOf(hash)).toMatch(/does not match the built-in circuit/);
  });
});

describe('validateEvaluationEntry: JSON key order does not matter', () => {
  const shuffle = (o: Json): Json => Object.fromEntries(Object.entries(o).reverse().map(([k, v]) => [k, v !== null && typeof v === 'object' && !Array.isArray(v) ? shuffle(v as Json) : Array.isArray(v) ? v.map((x) => (x !== null && typeof x === 'object' ? shuffle(x as Json) : x)) : v]));
  it('an entry whose summary, config and every other object have their keys reversed is still valid', () => {
    const reordered = shuffle(clone(base) as Json);
    expect(Object.keys(reordered)[0]).not.toBe(Object.keys(base)[0]);
    expect(validateEvaluationEntry(reordered, bindingFor(model)).ok).toBe(true);
  });
  it('a summary with sorted keys, and a re-parsed copy of the entry, are valid', () => {
    const e = clone(base) as Json;
    e.summary = Object.fromEntries(Object.entries(e.summary).sort(([a], [b]) => (a < b ? -1 : 1)));
    e.summary.outcomes = Object.fromEntries(Object.entries(e.summary.outcomes).sort(([a], [b]) => (a < b ? -1 : 1)));
    expect(validateEvaluationEntry(e, REG).ok).toBe(true);
    expect(validateEvaluationEntry(JSON.parse(JSON.stringify(e)), REG).ok).toBe(true);
  });
});

describe('the supported model ids', () => {
  it.each([1, 64, 65, 100])('accepts a saved champion id of %i characters', (length) => {
    const e = clone(base) as Json;
    e.modelId = 'a'.repeat(length);
    expect(validateEvaluationEntry(e).ok).toBe(true);
  });
  it.each([0, 101])('refuses an id of %i characters', (length) => {
    const e = clone(base) as Json;
    e.modelId = 'a'.repeat(length);
    expect(errorsOf(e)).toMatch(/modelId/);
  });
  it('refuses characters the model format does not allow', () => {
    const e = clone(base) as Json;
    e.modelId = 'a b/c';
    expect(errorsOf(e)).toMatch(/modelId/);
  });
});

describe('recogniseEvaluations', () => {
  it('counts only entries of this kind that validate; everything else is opaque and untouched', () => {
    const broken = { ...clone(base), summary: { episodes: 0 } };
    const list: unknown[] = [base, { kind: 'legacy' }, 7, null, 'text', broken, clone(base)];
    const before = JSON.stringify(list);
    const r = recogniseEvaluations(list);
    expect(r.entries).toHaveLength(2);
    expect(r.invalidClaims).toBe(1);
    expect(r.opaque).toBe(5);
    expect(JSON.stringify(list)).toBe(before);
    expect(MAX_EVALUATION_ENTRIES).toBe(50);
    expect(EVALUATION_KIND).toBe('p4-05-evaluation-v1');
  });
  it('with the registry and the binding, an entry that does not belong is an invalid claim, not a result', () => {
    const other = makeModel(6, 'ev-2');
    const mine = recogniseEvaluations([base], bindingFor(model));
    const theirs = recogniseEvaluations([base], bindingFor(other));
    expect(mine.entries).toHaveLength(1);
    expect(theirs.entries).toHaveLength(0);
    expect(theirs.invalidClaims).toBe(1);
  });
  it('recognises nothing in an empty array and ignores entries that only look similar', () => {
    expect(recogniseEvaluations([]).entries).toEqual([]);
    expect(recogniseEvaluations([{ kind: 'p4-05-evaluation-v2' }]).entries).toEqual([]);
  });
});
