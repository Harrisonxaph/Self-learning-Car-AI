// The P4-05 evaluation entry: summary by hand, strict validation (every field), recognition, and that held-out is never a split.
// Synthetic rows and a tiny trained champion; nothing here is a result.
import { describe, expect, it } from 'vitest';
import { EVALUATION_KIND, MAX_EVALUATION_ENTRIES, recogniseEvaluations, summariseRows, validateEvaluationEntry } from '../../src/persistence/evaluationEntry';
import { EVALUATION_TRACKS, entryWithRows, makeModel, realEntry, row } from '../helpers/evaluationFixtures';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const model = makeModel(5, 'ev-1');
const base = realEntry(model, 'kidney-loop');

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

describe('validateEvaluationEntry', () => {
  it('accepts a real entry, with and without the registry', () => {
    expect(validateEvaluationEntry(base).ok).toBe(true);
    expect(validateEvaluationEntry(base, EVALUATION_TRACKS).ok).toBe(true);
  });
  it.each<[string, (e: Json) => void, RegExp]>([
    ['a wrong kind', (e) => { e.kind = 'x'; }, /kind/],
    ['a wrong protocol', (e) => { e.protocol = 'p9'; }, /protocol/],
    ['a held-out split', (e) => { e.track.split = 'held-out'; }, /held-out/],
    ['an unknown split', (e) => { e.track.split = 'test'; }, /split/],
    ['a tampered config hash', (e) => { e.configHash = `sha256:${'0'.repeat(64)}`; }, /configHash/],
    ['a changed configuration', (e) => { e.config.maxLaps = 9; }, /configHash/],
    ['a bad frozen id', (e) => { e.frozenModelId = 'abc'; }, /frozenModelId/],
    ['a missing start', (e) => { e.starts.pop(); }, /same length/],
    ['an out-of-order seed', (e) => { e.starts[1].seed = 7; }, /starts\[1\]/],
    ['a non-finite offset', (e) => { e.starts[2].lateralMetres = Number.POSITIVE_INFINITY; }, /starts\[2\]/],
    ['an unknown outcome', (e) => { e.rows[0].outcome = 'won'; }, /rows\[0\]/],
    ['a fractional count', (e) => { e.rows[1].gatesPassed = 1.5; }, /rows\[1\]/],
    ['a progress that is not gates over gates', (e) => { e.rows[2].orderedProgress = 0.999; }, /rows\[2\]/],
    ['a first-lap time without a lap', (e) => { e.rows[3].firstLapTicks = 100; e.rows[3].firstLapSeconds = 1.6; }, /rows\[3\]/],
    ['a zero lap time', (e) => { e.rows[0].laps = 1; e.rows[0].firstLapTicks = 5; e.rows[0].firstLapSeconds = 0; }, /rows\[0\]/],
    ['a summary that does not match', (e) => { e.summary.lapCompletion = 1; }, /summary/],
    ['a missing time stamp', (e) => { e.recordedAt = ''; }, /recordedAt/],
  ])('refuses %s', (_name, mutate, pattern) => {
    const e = clone(base) as Json;
    mutate(e);
    const result = validateEvaluationEntry(e);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(pattern);
  });
  it('checks the circuit against the registry: a changed hash or version, and an unknown circuit', () => {
    const hash = clone(base) as Json;
    hash.track.contentHash = `sha256:${'1'.repeat(64)}`;
    expect(validateEvaluationEntry(hash, EVALUATION_TRACKS).ok).toBe(false);
    const unknown = clone(base) as Json;
    unknown.track.id = 'hairpin-chicane';
    expect(validateEvaluationEntry(unknown, EVALUATION_TRACKS).ok).toBe(false); // a held-out circuit is not in the registry given
    expect(JSON.stringify((validateEvaluationEntry(unknown, EVALUATION_TRACKS) as unknown as { errors: string[] }).errors)).toMatch(/not a built-in circuit/);
  });
  it.each([null, undefined, 5, 'x', [], {}])('never throws for hostile input %j', (value) => {
    expect(validateEvaluationEntry(value).ok).toBe(false);
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
  it('recognises nothing in an empty array and ignores entries that only look similar', () => {
    expect(recogniseEvaluations([]).entries).toEqual([]);
    expect(recogniseEvaluations([{ kind: 'p4-05-evaluation-v2' }]).entries).toEqual([]);
  });
  it('a real entry with its rows replaced still validates when its summary is recomputed', () => {
    const e = entryWithRows(base, base.rows.map((r) => ({ ...r })));
    expect(validateEvaluationEntry(e).ok).toBe(true);
  });
});
