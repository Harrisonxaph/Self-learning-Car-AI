// P5-04 step 3a (docs/plans/p5-04-plan.md sections 3.1-3.4): the pure statistics and analysis of E6, "do evolved drivers complete laps on
// held-out circuits at a rate clearly above baselines?". THIS MODULE EVALUATES NOTHING. It takes per-unit lap-completion counts and returns
// the contrasts, the labels, the descriptive summaries and the report; the manifest, the held-out record and the gate come in step 3b.
//
// STATUS: E6 is EXPLORATORY and DESCRIPTIVE. The owner chose the shared-circuit option after E5 had already opened (E5's results on these
// circuits are known), so the plan's "design frozen before E5 opens" protection does not apply; every report says so.
//
// The deciding endpoint is the LAP-COMPLETION RATE: per unit, the share of the five fixed starts in which a lap was completed. Per circuit,
// each evolved class (A5, A4) is compared with each baseline (A1, A7, A2, A3):
//  * A2 is PAIRED with the evolved class by training seed (its representative is the first genome of that seed's generation 0); pairing is
//    by the seed LABEL, never by array order, and a mismatch is refused. One cluster per seed is resampled.
//  * A1 and A7 are INDEPENDENT cohorts (action seeds unrelated to the training seeds): each cohort is resampled on its own.
//  * A3 is a deterministic constant (one fixed five-start summary per circuit): only the evolved cohort is resampled.
// The label comes from the bootstrap rule only (the whole interval beyond zero AND the mean at least the margin); the Wilcoxon (paired) and
// Mann-Whitney (independent) results are descriptive and decide nothing. No multiplicity adjustment; a circuit-level statement for a class
// needs all four of its contrasts to be `evolved-higher`; no pooled headline; a floor is an annotation and never vetoes an endpoint.
import { createRng } from '../utils/rng';
import { bootstrapMeanInterval, iqr, mean, median, nearestRank, wilcoxonSignedRank } from './analysis';
import { canonicalJson } from './experiment';

export const E6_ANALYSIS_FORMAT = 'self-driving-ai-evolution/p5-04-e6-analysis';
export const E6_ANALYSIS_VERSION = 1;
export const E6_STARTS_PER_UNIT = 5;
/** The meaningful difference in lap-completion rate (one start in five): a proposed default, owner-approved with the plan's defaults. */
export const E6_MARGIN = 0.2;
export const E6_BOOTSTRAP = Object.freeze({ resamples: 10_000, seed: 20261115, level: 0.95, method: 'percentile-nearest-rank-v1' });
export const E6_DECISION_RULE = 'p5-04-e6-decision-v1';
/** A floor annotation applies when MORE than this share of every class's units completed no lap. Descriptive only. */
export const E6_FLOOR_SHARE = 0.5;
export const E6_EVOLVED = Object.freeze(['A5', 'A4'] as const);
export const E6_BASELINES = Object.freeze(['A1', 'A7', 'A2', 'A3'] as const);
export type E6Evolved = (typeof E6_EVOLVED)[number];
export type E6Baseline = (typeof E6_BASELINES)[number];
export type E6Label = 'evolved-higher' | 'baseline-higher' | 'no-clear-difference';
export const E6_STATUS =
  'Exploratory and descriptive: E5\'s results on these circuits were already known when E6 was designed, so E6 is not preregistered before the look and its labels are pointwise statements about these champions only.';

const TOLERANCE = 1e-9;

export class E6AnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'E6AnalysisError';
  }
}

/** One unit of a cohort: a training seed (evolved, A2) or an action seed (A1, A7). */
export interface E6Unit {
  readonly seed: number;
  /** Starts (of five) in which a lap was completed. */
  readonly completedStarts: number;
  /** Mean ordered progress in laps over the five starts: descriptive only. */
  readonly progress: number;
}
export interface E6CircuitInput {
  readonly circuit: string;
  readonly evolved: { readonly A5: readonly E6Unit[]; readonly A4: readonly E6Unit[] };
  readonly baselines: { readonly A1: readonly E6Unit[]; readonly A7: readonly E6Unit[]; readonly A2: readonly E6Unit[]; readonly A3: E6Unit };
}

export interface E6Settings {
  readonly margin: number;
  readonly bootstrap: { readonly resamples: number; readonly seed: number; readonly level: number };
}
export const E6_SETTINGS: E6Settings = Object.freeze({ margin: E6_MARGIN, bootstrap: E6_BOOTSTRAP });

const rate = (u: E6Unit): number => u.completedStarts / E6_STARTS_PER_UNIT;

function checkUnits(units: readonly E6Unit[], path: string): void {
  if (units.length === 0) throw new E6AnalysisError(`${path} has no units.`);
  const seen = new Set<number>();
  for (const u of units) {
    if (!Number.isInteger(u.seed)) throw new E6AnalysisError(`${path}: a seed is not an integer.`);
    if (seen.has(u.seed)) throw new E6AnalysisError(`${path}: seed ${u.seed} appears twice.`);
    seen.add(u.seed);
    if (!Number.isInteger(u.completedStarts) || u.completedStarts < 0 || u.completedStarts > E6_STARTS_PER_UNIT) throw new E6AnalysisError(`${path}: completedStarts must be an integer from 0 to ${E6_STARTS_PER_UNIT}.`);
    if (!Number.isFinite(u.progress) || u.progress < 0) throw new E6AnalysisError(`${path}: progress must be a finite number, not negative.`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Bootstrap intervals for a difference of means (evolved minus baseline)
export interface E6Interval {
  readonly lower: number;
  readonly upper: number;
}
function percentileInterval(diffs: Float64Array, settings: E6Settings['bootstrap']): E6Interval {
  diffs.sort();
  const alpha = (1 - settings.level) / 2;
  return { lower: diffs[nearestRank(settings.resamples, alpha) - 1]!, upper: diffs[nearestRank(settings.resamples, 1 - alpha) - 1]! };
}

/** PAIRED: one cluster per index; the same index is drawn for both arms. Stream: `createRng(seed)`. */
export function pairedDifferenceInterval(evolved: readonly number[], baseline: readonly number[], settings: E6Settings['bootstrap']): E6Interval {
  const n = evolved.length;
  if (n === 0 || baseline.length !== n) throw new E6AnalysisError('A paired bootstrap needs two arms of the same non-zero length.');
  const rng = createRng(settings.seed);
  const out = new Float64Array(settings.resamples);
  for (let b = 0; b < settings.resamples; b += 1) {
    let total = 0;
    for (let i = 0; i < n; i += 1) {
      const k = rng.int(0, n);
      total += evolved[k]! - baseline[k]!;
    }
    out[b] = total / n;
  }
  return percentileInterval(out, settings);
}

/** INDEPENDENT: each cohort resampled on its own, the evolved cohort from `createRng(seed)` and the baseline from `createRng(seed + 1)`. */
export function independentDifferenceInterval(evolved: readonly number[], baseline: readonly number[], settings: E6Settings['bootstrap']): E6Interval {
  if (evolved.length === 0 || baseline.length === 0) throw new E6AnalysisError('An independent bootstrap needs two non-empty cohorts.');
  const a = createRng(settings.seed);
  const b = createRng(settings.seed + 1);
  const out = new Float64Array(settings.resamples);
  for (let r = 0; r < settings.resamples; r += 1) {
    let ta = 0;
    for (let i = 0; i < evolved.length; i += 1) ta += evolved[a.int(0, evolved.length)]!;
    let tb = 0;
    for (let i = 0; i < baseline.length; i += 1) tb += baseline[b.int(0, baseline.length)]!;
    out[r] = ta / evolved.length - tb / baseline.length;
  }
  return percentileInterval(out, settings);
}

/** CONSTANT baseline (A3): only the evolved cohort is resampled, from `createRng(seed)`. */
export function constantDifferenceInterval(evolved: readonly number[], constant: number, settings: E6Settings['bootstrap']): E6Interval {
  const { lower, upper } = bootstrapMeanInterval(evolved, settings);
  return { lower: lower - constant, upper: upper - constant };
}

/** The label from the bootstrap rule only; a mean exactly at the margin counts as meeting it (1e-9 tolerance, as E5). */
export function classifyE6(mean_: number, interval: E6Interval, margin: number): E6Label {
  if (interval.lower > 0 && mean_ >= margin - TOLERANCE) return 'evolved-higher';
  if (interval.upper < 0 && mean_ <= -margin + TOLERANCE) return 'baseline-higher';
  return 'no-clear-difference';
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Mann-Whitney U (descriptive, for the independent cohorts)
export interface MannWhitneyResult {
  readonly n1: number;
  readonly n2: number;
  /** U for the first sample: the sum of its midranks minus n1(n1+1)/2. */
  readonly u: number;
  /** Exact two-sided p-value under all C(n1+n2, n1) equally likely assignments (ties by midranks). */
  readonly p: number;
}
/**
 * Exact two-sided Mann-Whitney U. Midranks of the pooled sample are doubled to integers; the null distribution of the first sample's
 * doubled rank sum is counted by dynamic programming over (items chosen, sum), so it equals enumerating every assignment. Each
 * sample is limited to 20 values so the counts stay exact in floating point.
 */
export function mannWhitneyU(a: readonly number[], b: readonly number[]): MannWhitneyResult {
  const n1 = a.length;
  const n2 = b.length;
  if (n1 === 0 || n2 === 0) throw new E6AnalysisError('The Mann-Whitney test needs two non-empty samples.');
  if (n1 > 20 || n2 > 20) throw new RangeError('The exact Mann-Whitney test is limited to 20 values per sample.');
  const N = n1 + n2;
  const pooled = [...a.map((v) => ({ v, first: true })), ...b.map((v) => ({ v, first: false }))].sort((x, y) => x.v - y.v);
  const doubled = new Array<number>(N);
  for (let start = 0; start < N; ) {
    let end = start;
    while (end + 1 < N && pooled[end + 1]!.v === pooled[start]!.v) end += 1;
    for (let k = start; k <= end; k += 1) doubled[k] = start + 1 + end + 1;
    start = end + 1;
  }
  const total = doubled.reduce((s, r) => s + r, 0);
  const observed = pooled.reduce((s, item, k) => s + (item.first ? doubled[k]! : 0), 0);
  // ways[k][s]: the number of subsets of size k with doubled rank sum s.
  const ways: Float64Array[] = Array.from({ length: n1 + 1 }, () => new Float64Array(total + 1));
  ways[0]![0] = 1;
  for (const r of doubled) {
    for (let k = Math.min(n1, N); k >= 1; k -= 1) {
      const from = ways[k - 1]!;
      const to = ways[k]!;
      for (let s = total - r; s >= 0; s -= 1) if (from[s]! !== 0) to[s + r] = to[s + r]! + from[s]!;
    }
  }
  const expected = n1 * (N + 1);
  let tail = 0;
  let all = 0;
  for (let s = 0; s <= total; s += 1) {
    const w = ways[n1]![s]!;
    all += w;
    if (Math.abs(s - expected) >= Math.abs(observed - expected)) tail += w;
  }
  return { n1, n2, u: observed / 2 - (n1 * (n1 + 1)) / 2, p: Math.min(1, tail / all) };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// One contrast, one circuit, one class
export interface E6Contrast {
  readonly evolved: E6Evolved;
  readonly baseline: E6Baseline;
  readonly comparison: 'paired-by-training-seed' | 'independent-cohorts' | 'constant-baseline';
  readonly n: { readonly evolved: number; readonly baseline: number | 'constant' };
  readonly evolvedMeanRate: number;
  readonly baselineMeanRate: number;
  readonly meanDifference: number;
  readonly interval: E6Interval;
  readonly label: E6Label;
  /** Descriptive only; null for the constant baseline. */
  readonly secondary: { readonly test: 'wilcoxon-signed-rank'; readonly m: number; readonly w: number; readonly p: number } | { readonly test: 'mann-whitney-u'; readonly n1: number; readonly n2: number; readonly u: number; readonly p: number } | null;
}

function alignBySeed(evolved: readonly E6Unit[], a2: readonly E6Unit[]): { readonly e: number[]; readonly b: number[] } {
  const bySeed = new Map(a2.map((u) => [u.seed, u] as const));
  if (evolved.length !== a2.length || evolved.some((u) => !bySeed.has(u.seed))) throw new E6AnalysisError('A2 and the evolved class do not cover the same training seeds, so they cannot be paired.');
  return { e: evolved.map(rate), b: evolved.map((u) => rate(bySeed.get(u.seed)!)) };
}

export function contrast(evolvedName: E6Evolved, evolved: readonly E6Unit[], baseline: E6Baseline, input: E6CircuitInput['baselines'], settings: E6Settings): E6Contrast {
  const rates = evolved.map(rate);
  const evolvedMean = mean(rates);
  if (baseline === 'A3') {
    const c = rate(input.A3);
    const interval = constantDifferenceInterval(rates, c, settings.bootstrap);
    const d = evolvedMean - c;
    return { evolved: evolvedName, baseline, comparison: 'constant-baseline', n: { evolved: rates.length, baseline: 'constant' }, evolvedMeanRate: evolvedMean, baselineMeanRate: c, meanDifference: d, interval, label: classifyE6(d, interval, settings.margin), secondary: null };
  }
  if (baseline === 'A2') {
    const { e, b } = alignBySeed(evolved, input.A2);
    const diffs = e.map((v, i) => v - b[i]!);
    const interval = pairedDifferenceInterval(e, b, settings.bootstrap);
    const d = mean(diffs);
    const w = wilcoxonSignedRank(diffs);
    return { evolved: evolvedName, baseline, comparison: 'paired-by-training-seed', n: { evolved: e.length, baseline: b.length }, evolvedMeanRate: evolvedMean, baselineMeanRate: mean(b), meanDifference: d, interval, label: classifyE6(d, interval, settings.margin), secondary: { test: 'wilcoxon-signed-rank', m: w.m, w: w.w, p: w.p } };
  }
  const other = input[baseline].map(rate);
  const interval = independentDifferenceInterval(rates, other, settings.bootstrap);
  const d = evolvedMean - mean(other);
  const mw = mannWhitneyU(rates, other);
  return { evolved: evolvedName, baseline, comparison: 'independent-cohorts', n: { evolved: rates.length, baseline: other.length }, evolvedMeanRate: evolvedMean, baselineMeanRate: mean(other), meanDifference: d, interval, label: classifyE6(d, interval, settings.margin), secondary: { test: 'mann-whitney-u', n1: mw.n1, n2: mw.n2, u: mw.u, p: mw.p } };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// One circuit
type Json = Record<string, unknown>;
const countsOf = (units: readonly E6Unit[]): number[] => [0, 1, 2, 3, 4, 5].map((k) => units.filter((u) => u.completedStarts === k).length);
function describeCohort(units: readonly E6Unit[]): Json {
  const progress = units.map((u) => u.progress);
  return {
    units: units.length,
    meanRate: mean(units.map(rate)),
    unitsByCompletedStarts: countsOf(units),
    unitsCompletingNoLap: units.filter((u) => u.completedStarts === 0).length,
    progressMedian: median(progress),
    progressIqr: iqr(progress),
  };
}

export function analyseE6Circuit(input: E6CircuitInput, settings: E6Settings = E6_SETTINGS): Json {
  checkUnits(input.evolved.A5, `${input.circuit} A5`);
  checkUnits(input.evolved.A4, `${input.circuit} A4`);
  for (const name of ['A1', 'A7', 'A2'] as const) checkUnits(input.baselines[name], `${input.circuit} ${name}`);
  checkUnits([input.baselines.A3], `${input.circuit} A3`);
  const contrasts: E6Contrast[] = [];
  for (const evolved of E6_EVOLVED) for (const baseline of E6_BASELINES) contrasts.push(contrast(evolved, input.evolved[evolved], baseline, input.baselines, settings));
  const cohorts: Record<string, Json> = {
    A5: describeCohort(input.evolved.A5),
    A4: describeCohort(input.evolved.A4),
    A1: describeCohort(input.baselines.A1),
    A7: describeCohort(input.baselines.A7),
    A2: describeCohort(input.baselines.A2),
    A3: describeCohort([input.baselines.A3]),
  };
  const classes = Object.keys(cohorts).map((k) => {
    const c = cohorts[k]!;
    return (c.unitsCompletingNoLap as number) / (c.units as number);
  });
  const floor = classes.every((share) => share > E6_FLOOR_SHARE);
  const statements = E6_EVOLVED.map((evolved) => {
    const mine = contrasts.filter((c) => c.evolved === evolved);
    const all = mine.every((c) => c.label === 'evolved-higher');
    return {
      evolved,
      labels: Object.fromEntries(mine.map((c) => [c.baseline, c.label])),
      circuitLevel: all ? 'evolved-higher-than-all-four-baselines' : 'not-supported',
      statement: all
        ? `${evolved} completed laps at a clearly higher rate than all four baselines on this circuit (all four contrasts evolved-higher; pointwise intervals, no multiplicity adjustment).`
        : `No circuit-level statement for ${evolved} on this circuit: not all four baseline contrasts are evolved-higher.`,
    };
  });
  return {
    circuit: input.circuit,
    cohorts,
    contrasts,
    classStatements: statements,
    floorAnnotation: floor
      ? {
          applies: true,
          note: `On this circuit more than ${E6_FLOOR_SHARE * 100}% of the units of every class completed no lap. This is a descriptive annotation: it does not change any label above, and it is not shown to be the cause of a weak result (an untested possibility).`,
        }
      : { applies: false, note: null },
  };
}

export interface E6AnalysisInput {
  readonly circuits: readonly E6CircuitInput[];
  readonly manifestHash: string | null;
  readonly settings?: E6Settings;
}

export function analyseE6(input: E6AnalysisInput): Json {
  if (input.circuits.length === 0) throw new E6AnalysisError('There are no circuits to analyse.');
  const ids = input.circuits.map((c) => c.circuit);
  if (new Set(ids).size !== ids.length) throw new E6AnalysisError('A circuit is listed twice.');
  const settings = input.settings ?? E6_SETTINGS;
  const circuits = input.circuits.map((c) => analyseE6Circuit(c, settings));
  return {
    format: E6_ANALYSIS_FORMAT,
    version: E6_ANALYSIS_VERSION,
    manifestHash: input.manifestHash,
    status: E6_STATUS,
    decisionRule: E6_DECISION_RULE,
    margin: settings.margin,
    bootstrap: { ...settings.bootstrap },
    startsPerUnit: E6_STARTS_PER_UNIT,
    multiplicity: 'Pointwise 95% intervals with no multiplicity adjustment across the contrasts; some evolved-higher labels would be expected by chance even if nothing were real.',
    claim: 'Per circuit and for these champions only: whether evolved drivers completed laps at a rate clearly above these baselines. No pooled headline, no claim about braking (that is E5), none about other configurations, seeds or circuits, and no equivalence from a null.',
    circuits,
  };
}

export const e6AnalysisJson = (analysis: Json): string => `${canonicalJson(analysis)}\n`;

const f = (v: unknown): string => (typeof v === 'number' ? v.toFixed(3) : String(v));
const rng = (i: unknown): string => `${f((i as E6Interval).lower)} to ${f((i as E6Interval).upper)}`;

export function renderE6Report(analysis: Json): string {
  const circuits = analysis.circuits as Json[];
  const lines: string[] = [
    '# P5-04 E6: do evolved drivers complete laps on held-out circuits above baselines?',
    '',
    `> **${String(analysis.status)}**`,
    '',
    `Decision rule ${String(analysis.decisionRule)}: the deciding endpoint is the lap-completion rate over ${String(analysis.startsPerUnit)} fixed starts, with a meaningful difference of ${String(analysis.margin)}. Manifest \`${String(analysis.manifestHash)}\`.`,
    '',
    `**${String(analysis.claim)}**`,
    '',
    String(analysis.multiplicity),
    '',
  ];
  for (const c of circuits) {
    lines.push(`## ${String(c.circuit)}`, '', '| Evolved | Baseline | Comparison | n | Evolved rate | Baseline rate | Difference, 95% interval | Label | Descriptive test |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const k of c.contrasts as E6Contrast[]) {
      const n = k.n.baseline === 'constant' ? `${k.n.evolved} vs constant` : `${k.n.evolved} vs ${k.n.baseline}`;
      const s = k.secondary === null ? 'none (constant)' : `${k.secondary.test} p = ${f(k.secondary.p)} (descriptive)`;
      lines.push(`| ${k.evolved} | ${k.baseline} | ${k.comparison} | ${n} | ${f(k.evolvedMeanRate)} | ${f(k.baselineMeanRate)} | ${f(k.meanDifference)}, ${rng(k.interval)} | ${k.label} | ${s} |`);
    }
    lines.push('', '| Class | Units | Mean rate | Units by completed starts (0 to 5) | Units completing no lap | Progress median (laps) |', '| --- | --- | --- | --- | --- | --- |');
    for (const [name, d] of Object.entries(c.cohorts as Record<string, Json>)) lines.push(`| ${name} | ${String(d.units)} | ${f(d.meanRate)} | ${(d.unitsByCompletedStarts as number[]).join(', ')} | ${String(d.unitsCompletingNoLap)} | ${f(d.progressMedian)} |`);
    lines.push('');
    for (const s of c.classStatements as Json[]) lines.push(`- ${String(s.statement)}`);
    const floor = c.floorAnnotation as Json;
    lines.push(floor.applies ? `- **Floor annotation (descriptive):** ${String(floor.note)}` : '- No floor annotation on this circuit.', '');
  }
  lines.push('There is no pooled headline: each circuit is reported on its own, and if circuits disagree that is the result.', '');
  return `${lines.join('\n')}`;
}
