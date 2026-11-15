// P5-04 step 3a: the pure statistics of E6 (src/training/e6Analysis.ts), against hand-computed cases. Nothing here evaluates a model or a
// circuit: the inputs are synthetic per-unit lap-completion counts.
import { describe, expect, it } from 'vitest';
import {
  analyseE6,
  analyseE6Circuit,
  classifyE6,
  constantDifferenceInterval,
  E6_BOOTSTRAP,
  E6_FLOOR_SHARE,
  E6_MARGIN,
  E6_SETTINGS,
  e6AnalysisJson,
  E6AnalysisError,
  independentDifferenceInterval,
  mannWhitneyU,
  pairedDifferenceInterval,
  renderE6Report,
  type E6CircuitInput,
  type E6Unit,
} from '../../src/training/e6Analysis';

const SEEDS = [2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010];
const units = (counts: readonly number[], seeds: readonly number[] = SEEDS): E6Unit[] => counts.map((c, i) => ({ seed: seeds[i]!, completedStarts: c, progress: c / 5 }));
const all = (n: number): E6Unit[] => units(SEEDS.map(() => n));
const ACTION = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110];
const input = (over: { A5?: E6Unit[]; A4?: E6Unit[]; A1?: E6Unit[]; A7?: E6Unit[]; A2?: E6Unit[]; A3?: number } = {}, circuit = 'c1'): E6CircuitInput => ({
  circuit,
  evolved: { A5: over.A5 ?? all(0), A4: over.A4 ?? all(0) },
  baselines: {
    A1: over.A1 ?? units(SEEDS.map(() => 0), ACTION),
    A7: over.A7 ?? units(SEEDS.map(() => 0), ACTION),
    A2: over.A2 ?? all(0),
    A3: { seed: 0, completedStarts: over.A3 ?? 0, progress: 0 },
  },
});
const contrastOf = (a: ReturnType<typeof analyseE6Circuit>, evolved: string, baseline: string) => (a.contrasts as { evolved: string; baseline: string; label: string; meanDifference: number; interval: { lower: number; upper: number }; comparison: string; secondary: { test: string; p: number } | null }[]).find((c) => c.evolved === evolved && c.baseline === baseline)!;

describe('the exact Mann-Whitney U (hand-computed)', () => {
  it('separated samples: U = 0 and p = 2 / C(6,3) = 0.1', () => {
    const r = mannWhitneyU([1, 2, 3], [4, 5, 6]);
    expect(r).toMatchObject({ n1: 3, n2: 3, u: 0 });
    expect(r.p).toBeCloseTo(0.1, 12);
    expect(mannWhitneyU([4, 5, 6], [1, 2, 3])).toMatchObject({ u: 9 });
    expect(mannWhitneyU([4, 5, 6], [1, 2, 3]).p).toBeCloseTo(0.1, 12);
  });
  it('two against two: p = 2 / 6', () => {
    expect(mannWhitneyU([1, 2], [3, 4]).p).toBeCloseTo(1 / 3, 12);
  });
  it('all values tied: U = n1 n2 / 2 and p = 1', () => {
    const r = mannWhitneyU([1, 1, 1], [1, 1]);
    expect(r.u).toBe(3);
    expect(r.p).toBe(1);
  });
  it('ties use midranks: [1, 2, 2] against [2, 3] gives U = 2 (hand computed)', () => {
    // pooled 1,2,2,2,3 -> ranks 1, 3, 3, 3, 5; first sample ranks 1 + 3 + 3 = 7; U = 7 - 6 = 1... second sample: 3 + 5 = 8, U2 = 8 - 3 = 5; U1 + U2 = 6.
    const r = mannWhitneyU([1, 2, 2], [2, 3]);
    expect(r.u).toBe(1);
    expect(mannWhitneyU([2, 3], [1, 2, 2]).u).toBe(5);
  });
  it('is symmetric in p and refuses an empty or too large sample', () => {
    expect(mannWhitneyU([1, 5, 9, 2], [3, 3, 8]).p).toBeCloseTo(mannWhitneyU([3, 3, 8], [1, 5, 9, 2]).p, 12);
    expect(() => mannWhitneyU([], [1])).toThrow(E6AnalysisError);
    expect(() => mannWhitneyU(Array.from({ length: 21 }, (_, i) => i), [1])).toThrow(RangeError);
  });
});

describe('the three resampling schemes', () => {
  const s = { resamples: 2000, seed: 20261115, level: 0.95 };
  it('PAIRED differs from INDEPENDENT on the same two marginal cohorts: a pairing is defined by design, not by index', () => {
    const e = [1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
    const matched = [1, 1, 1, 1, 1, 0, 0, 0, 0, 0]; // each unit equals its own partner: every paired difference is 0
    const reordered = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1]; // the same marginal cohort, partnered the other way round
    expect(pairedDifferenceInterval(e, matched, s)).toEqual({ lower: 0, upper: 0 });
    const flipped = pairedDifferenceInterval(e, reordered, s);
    expect(flipped.upper - flipped.lower).toBeGreaterThan(0);
    const indep = independentDifferenceInterval(e, matched, s);
    expect(indep.upper - indep.lower).toBeGreaterThan(0.2);
    expect(independentDifferenceInterval(e, reordered, s)).toEqual(indep); // an independent cohort is a multiset: reordering it changes nothing, because the draws are of values, and these two arrays hold the same ones
  });
  it('a constant baseline resamples only the evolved cohort: a constant cohort gives a zero-width interval around e - c', () => {
    expect(constantDifferenceInterval([1, 1, 1], 0.4, s)).toEqual({ lower: 0.6, upper: 0.6 });
    const i = constantDifferenceInterval([1, 0, 1, 0], 0.2, s);
    expect(i.lower).toBeCloseTo(-0.2, 12);
    expect(i.upper).toBeCloseTo(0.8, 12);
  });
  it('is deterministic, and the bootstrap constants are the preregistered ones', () => {
    expect(pairedDifferenceInterval([1, 0, 1], [0, 0, 1], s)).toEqual(pairedDifferenceInterval([1, 0, 1], [0, 0, 1], s));
    expect(E6_BOOTSTRAP).toEqual({ resamples: 10_000, seed: 20261115, level: 0.95, method: 'percentile-nearest-rank-v1' });
    expect(E6_MARGIN).toBe(0.2);
    expect(() => pairedDifferenceInterval([1, 0], [1], s)).toThrow(E6AnalysisError);
  });
});

describe('the label rule', () => {
  it('needs the whole interval beyond zero AND a mean at least the margin; exactly the margin counts despite rounding', () => {
    expect(classifyE6(0.3, { lower: 0.1, upper: 0.5 }, 0.2)).toBe('evolved-higher');
    expect(classifyE6(0.3, { lower: -0.1, upper: 0.5 }, 0.2)).toBe('no-clear-difference');
    expect(classifyE6(0.1, { lower: 0.05, upper: 0.2 }, 0.2)).toBe('no-clear-difference');
    expect(classifyE6(1 - 0.8, { lower: 0.1, upper: 0.5 }, 0.2)).toBe('evolved-higher'); // 0.19999999999999996
    expect(classifyE6(-0.3, { lower: -0.5, upper: -0.1 }, 0.2)).toBe('baseline-higher');
    expect(classifyE6(0, { lower: 0, upper: 0 }, 0.2)).toBe('no-clear-difference');
  });
});

describe('the circuit analysis', () => {
  it('A2 is paired BY SEED LABEL, not by array order: reversing the A2 list changes nothing; a different seed set is refused', () => {
    const a5 = units([5, 5, 5, 5, 5, 0, 0, 0, 0, 0]);
    const a2 = units([5, 5, 5, 5, 5, 0, 0, 0, 0, 0]);
    const ordered = contrastOf(analyseE6Circuit(input({ A5: a5, A2: a2 })), 'A5', 'A2');
    const reversed = contrastOf(analyseE6Circuit(input({ A5: a5, A2: [...a2].reverse() })), 'A5', 'A2');
    expect(reversed).toEqual(ordered);
    expect(ordered.comparison).toBe('paired-by-training-seed');
    expect(ordered.meanDifference).toBe(0);
    expect(ordered.interval).toEqual({ lower: 0, upper: 0 });
    expect(ordered.label).toBe('no-clear-difference');
    expect(ordered.secondary).toMatchObject({ test: 'wilcoxon-signed-rank', p: 1 });
    expect(() => analyseE6Circuit(input({ A5: a5, A2: units([5, 5, 5, 5, 5, 0, 0, 0, 0, 0], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) }))).toThrow(/same training seeds/);
  });
  it('A1 and A7 are independent cohorts (Mann-Whitney), A3 a constant (no test)', () => {
    const a = analyseE6Circuit(input({ A5: all(5), A3: 2 }));
    expect(contrastOf(a, 'A5', 'A1')).toMatchObject({ comparison: 'independent-cohorts', secondary: { test: 'mann-whitney-u' } });
    expect(contrastOf(a, 'A5', 'A7').comparison).toBe('independent-cohorts');
    expect(contrastOf(a, 'A5', 'A3')).toMatchObject({ comparison: 'constant-baseline', secondary: null });
    expect(contrastOf(a, 'A5', 'A3').meanDifference).toBeCloseTo(1 - 0.4, 12);
    expect((a.contrasts as unknown[]).length).toBe(8); // 2 evolved classes x 4 baselines
  });
  it('a supported endpoint stands alongside a floor annotation (four of ten evolved seeds complete every start, everything else completes none)', () => {
    const a = analyseE6Circuit(input({ A5: units([5, 5, 5, 5, 0, 0, 0, 0, 0, 0]) }));
    for (const b of ['A1', 'A7', 'A2', 'A3']) expect(contrastOf(a, 'A5', b).label).toBe('evolved-higher');
    const s = (a.classStatements as { evolved: string; circuitLevel: string }[]).find((x) => x.evolved === 'A5')!;
    expect(s.circuitLevel).toBe('evolved-higher-than-all-four-baselines');
    expect((a.floorAnnotation as { applies: boolean }).applies).toBe(true); // 6 of 10 A5 seeds completed no lap, and so did every other class
    expect((a.floorAnnotation as { note: string }).note).toMatch(/does not change any label/);
  });
  it('a floor with no clear difference: every unit of every class completes nothing', () => {
    const a = analyseE6Circuit(input());
    for (const c of a.contrasts as { label: string }[]) expect(c.label).toBe('no-clear-difference');
    expect((a.floorAnnotation as { applies: boolean }).applies).toBe(true);
    for (const s of a.classStatements as { circuitLevel: string }[]) expect(s.circuitLevel).toBe('not-supported');
  });
  it('every class completing every start: no clear difference and no floor', () => {
    const a = analyseE6Circuit(input({ A5: all(5), A4: all(5), A1: units(SEEDS.map(() => 5), ACTION), A7: units(SEEDS.map(() => 5), ACTION), A2: all(5), A3: 5 }));
    for (const c of a.contrasts as { label: string }[]) expect(c.label).toBe('no-clear-difference');
    expect((a.floorAnnotation as { applies: boolean }).applies).toBe(false);
  });
  it('one baseline above the evolved class gives baseline-higher, and the class has no circuit-level statement', () => {
    const a = analyseE6Circuit(input({ A5: all(0), A1: units(SEEDS.map(() => 5), ACTION) }));
    expect(contrastOf(a, 'A5', 'A1').label).toBe('baseline-higher');
    expect((a.classStatements as { evolved: string; circuitLevel: string }[]).find((x) => x.evolved === 'A5')!.circuitLevel).toBe('not-supported');
  });
  it('the circuit-level statement needs ALL four contrasts: one no-clear-difference among four withholds it', () => {
    const a5 = units([5, 5, 5, 5, 5, 5, 5, 5, 5, 5]);
    const a = analyseE6Circuit(input({ A5: a5, A3: 5 })); // A5 equals A3, so the A3 contrast is no-clear-difference
    expect(contrastOf(a, 'A5', 'A3').label).toBe('no-clear-difference');
    expect((a.classStatements as { evolved: string; circuitLevel: string }[]).find((x) => x.evolved === 'A5')!.circuitLevel).toBe('not-supported');
  });
  it('descriptive cohort summaries carry counts by completed starts, the units completing no lap and the progress median', () => {
    const a = analyseE6Circuit(input({ A5: units([0, 1, 2, 3, 4, 5, 5, 0, 0, 0]) }));
    const c = (a.cohorts as Record<string, { units: number; unitsByCompletedStarts: number[]; unitsCompletingNoLap: number; progressMedian: number }>).A5!;
    expect(c.unitsByCompletedStarts).toEqual([4, 1, 1, 1, 1, 2]);
    expect(c.unitsCompletingNoLap).toBe(4);
    expect(c.units).toBe(10);
  });
  it('refuses malformed units', () => {
    for (const bad of [[], [{ seed: 1, completedStarts: 6, progress: 0 }], [{ seed: 1, completedStarts: 0.5, progress: 0 }], [{ seed: 1, completedStarts: 0, progress: -1 }], [{ seed: 1, completedStarts: 0, progress: 0 }, { seed: 1, completedStarts: 0, progress: 0 }]]) {
      expect(() => analyseE6Circuit(input({ A5: bad as E6Unit[] }))).toThrow(E6AnalysisError);
    }
  });
});

describe('the whole analysis and its report', () => {
  const build = () => analyseE6({ manifestHash: `sha256:${'a'.repeat(64)}`, circuits: [input({ A5: units([5, 5, 5, 5, 0, 0, 0, 0, 0, 0]) }, 'one'), input({}, 'two')] });
  it('is deterministic, canonical JSON, and says it is exploratory and has no pooled headline', () => {
    expect(e6AnalysisJson(build())).toBe(e6AnalysisJson(build()));
    const a = build();
    expect(a.status).toMatch(/Exploratory and descriptive/);
    expect(JSON.stringify(a)).not.toMatch(/pooled-headline|"headline"/);
    expect(a.decisionRule).toBe('p5-04-e6-decision-v1');
    expect(E6_SETTINGS.margin).toBe(0.2);
    expect(E6_FLOOR_SHARE).toBe(0.5);
  });
  it('the report states the status, the multiplicity, the floor as descriptive, and no equivalence or learning claim', () => {
    const r = renderE6Report(build());
    expect(r).toContain('Exploratory and descriptive');
    expect(r).toContain('no multiplicity adjustment');
    expect(r).toContain('There is no pooled headline');
    expect(r).toContain('Floor annotation (descriptive)');
    expect(r).toContain('no equivalence from a null');
    expect(r).not.toMatch(/are equivalent|is equivalent/);
    expect(r).not.toMatch(/proves|learned to|learning is/i);
  });
  it('refuses no circuits and a duplicated circuit', () => {
    expect(() => analyseE6({ manifestHash: null, circuits: [] })).toThrow(E6AnalysisError);
    expect(() => analyseE6({ manifestHash: null, circuits: [input({}, 'x'), input({}, 'x')] })).toThrow(/twice/);
  });
});
