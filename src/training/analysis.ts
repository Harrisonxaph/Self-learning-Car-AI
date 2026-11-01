// P2-08 analysis and report (docs/experiments/p2-08-step3-design.md §5 and §5.1, D1): per-seed summaries of replayed
// study records, the paired seed-level contrasts with a seeded percentile bootstrap, type 7 quantiles and an exact
// Wilcoxon signed-rank test, acceptance eligibility, the decision rule, and a deterministic report.
// Tooling only: nothing here runs a study or writes a file (the command line is D2). The only claim it can ever
// produce is "outperforms equal-budget random search", and only for an acceptance-eligible confirmatory analysis in
// which every condition of p2-08-decision-v1 holds. Nothing here is evidence of learning by itself.
import { DEFAULT_SIM_CONFIG } from '../sim/config';
import { createRng } from '../utils/rng';
import { canonicalJson, type ExperimentEngine } from './experiment';
import { trainingTrack, validationTrack } from './trackSplits';
import {
  AGENT_ORDER,
  CONFIRMATORY_SEED_SETS,
  DECISION_RULE,
  manifestHash,
  METRIC,
  parseStudyManifest,
  parseStudyRecord,
  replayStudyRecord,
  WILCOXON,
  type StudyManifest,
} from './study';

export const ANALYSIS_FORMAT = 'self-driving-ai-evolution/p2-08-analysis';
export const ANALYSIS_VERSION = 1;
export const CLAIM = 'outperforms equal-budget random search';
export const TRACKS = Object.freeze(['training', 'validation'] as const);
export type Track = (typeof TRACKS)[number];
export type Agent = (typeof AGENT_ORDER)[number];
export const OUTCOMES = Object.freeze(['completed', 'crashed', 'stalled', 'timeout'] as const);
export const SECONDARY_CONTRASTS = Object.freeze([
  { agent: 'A8', track: 'validation' },
  { agent: 'A9', track: 'training' },
  { agent: 'A9', track: 'validation' },
  { agent: 'A2', track: 'training' },
  { agent: 'A2', track: 'validation' },
  { agent: 'A1', track: 'training' },
  { agent: 'A1', track: 'validation' },
  { agent: 'A7', track: 'training' },
  { agent: 'A7', track: 'validation' },
] as const);

/** The analysis input is incomplete or inconsistent (missing, duplicate or extra seeds, or a record that does not replay). */
export class StudyAnalysisError extends Error {
  override name = 'StudyAnalysisError';
}

/** What the analysis needs from one episode. */
export interface EpisodeSummary {
  readonly outcome: (typeof OUTCOMES)[number];
  /** Gates credited; ordered progress is gatesPassed ÷ the track's gates per lap. Kept as an integer so contrasts stay exact. */
  readonly gatesPassed: number;
  readonly crashed: boolean;
  readonly lapTicks: readonly number[];
  readonly fitness: number;
}

/** One training seed, reduced to what the analysis reads. */
export interface SeedSummary {
  readonly seed: number;
  /** Gates per lap on each track. */
  readonly gates: Readonly<Record<Track, number>>;
  /** The episodes behind each agent's seed-level value, per track: E for A1/A7, P for A2, one for A9/A8/A5. */
  readonly episodes: Readonly<Record<Agent, Readonly<Record<Track, readonly EpisodeSummary[]>>>>;
  /** A5's best and mean training fitness in each recorded generation. */
  readonly a5Generations: readonly { readonly best: number; readonly mean: number }[];
}

type Json = Record<string, unknown>;

// ---------------------------------------------------------------------------------------------------------------
// Statistics

const sum = (values: readonly number[]): number => values.reduce((total, v) => total + v, 0);

/** The arithmetic mean, summed in the given order. */
export function mean(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError('The mean of no values is undefined.');
  return sum(values) / values.length;
}

/** The type 7 (linear interpolation) quantile: position (n − 1)·q of the sorted values. */
export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) throw new RangeError('A quantile of no values is undefined.');
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (position - low);
}

export const median = (values: readonly number[]): number => quantile(values, 0.5);
export const iqr = (values: readonly number[]): [number, number] => [quantile(values, 0.25), quantile(values, 0.75)];

/** Nearest rank ⌈B·p⌉ (1-based), with the product rounded to 1e-9 first so 10,000 × 0.025 is rank 250. */
const nearestRank = (resamples: number, p: number): number => Math.max(1, Math.ceil(Math.round(resamples * p * 1e9) / 1e9));

export interface BootstrapInterval {
  readonly lower: number;
  readonly upper: number;
}

/**
 * The percentile bootstrap interval of the mean: `resamples` resamples of the n values with replacement, each
 * drawing n indices with `int(0, n)` from `createRng(seed)` in order; the sorted means' nearest ranks.
 */
export function bootstrapMeanInterval(values: readonly number[], settings: { readonly resamples: number; readonly seed: number; readonly level: number }): BootstrapInterval {
  const n = values.length;
  if (n === 0) throw new RangeError('The bootstrap needs at least one value.');
  const rng = createRng(settings.seed);
  const means = new Float64Array(settings.resamples);
  for (let b = 0; b < settings.resamples; b += 1) {
    let total = 0;
    for (let i = 0; i < n; i += 1) total += values[rng.int(0, n)]!;
    means[b] = total / n;
  }
  means.sort();
  const alpha = (1 - settings.level) / 2;
  return { lower: means[nearestRank(settings.resamples, alpha) - 1]!, upper: means[nearestRank(settings.resamples, 1 - alpha) - 1]! };
}

export interface WilcoxonResult {
  /** Non-zero differences used. */
  readonly m: number;
  /** The sum of the signed midranks. */
  readonly w: number;
  /** Exact two-sided p-value; 1 when m = 0. */
  readonly p: number;
  readonly note: string | null;
}

/**
 * Exact two-sided Wilcoxon signed-rank test: zeros dropped, midranks, and the exact null distribution of all 2^m
 * equally likely sign assignments. That distribution is built by dynamic programming over the sum of the positive
 * doubled midranks (integers), so it is the same as enumerating every assignment but runs for any seed count a
 * manifest allows (up to 1,000). Each step halves probabilities, which is exact in binary floating point for the
 * small m of a real study.
 */
export function wilcoxonSignedRank(differences: readonly number[]): WilcoxonResult {
  const nonZero = differences.filter((d) => d !== 0);
  const m = nonZero.length;
  if (m === 0) return { m: 0, w: 0, p: 1, note: 'no non-zero differences' };
  // Doubled midranks are integers: tied values at 1-based ranks i..j share (i + j).
  const order = nonZero.map((d, i) => ({ abs: Math.abs(d), i })).sort((a, b) => a.abs - b.abs);
  const doubled = new Array<number>(m);
  for (let start = 0; start < m; ) {
    let end = start;
    while (end + 1 < m && order[end + 1]!.abs === order[start]!.abs) end += 1;
    for (let k = start; k <= end; k += 1) doubled[order[k]!.i] = start + 1 + end + 1;
    start = end + 1;
  }
  const total = sum(doubled);
  const observed = nonZero.reduce((w, d, i) => w + (d > 0 ? doubled[i]! : -doubled[i]!), 0);
  // probability[s]: the chance that the positive doubled ranks sum to s under the null.
  let probability = new Float64Array(total + 1);
  probability[0] = 1;
  let reach = 0;
  for (const rank of doubled) {
    const next = new Float64Array(total + 1);
    for (let s = 0; s <= reach; s += 1) {
      const half = probability[s]! / 2;
      if (half === 0) continue;
      next[s] = next[s]! + half;
      next[s + rank] = next[s + rank]! + half;
    }
    probability = next;
    reach += rank;
  }
  // W (doubled) for a positive sum s is 2s − total; count |2s − total| ≥ |observed|.
  let p = 0;
  for (let s = 0; s <= total; s += 1) if (Math.abs(2 * s - total) >= Math.abs(observed)) p += probability[s]!;
  return { m, w: observed / 2, p: Math.min(1, p), note: null };
}

// ---------------------------------------------------------------------------------------------------------------
// Summaries

const episodeSummary = (episode: Json): EpisodeSummary => ({
  outcome: episode.outcome as EpisodeSummary['outcome'],
  gatesPassed: episode.gatesPassed as number,
  crashed: episode.crashed as boolean,
  lapTicks: [...(episode.lapTicks as number[])],
  fitness: (episode.fitness as Json).total as number,
});

/** Reduces one parsed record to what the analysis reads. The record must already have been parsed (and replayed) against this manifest. */
export function summariseRecord(record: { readonly seed: number; readonly agents: Json }, manifest: StudyManifest): SeedSummary {
  const a = record.agents as Record<string, Json>;
  const list = (episodes: unknown): EpisodeSummary[] => (episodes as Json[]).map(episodeSummary);
  const candidates = a.A2!.candidates as Json[];
  const samples = a.A8!.samples as Json[];
  const generations = a.A5!.generations as Json[][];
  const final = generations[generations.length - 1]!;
  const training = (candidate: Json | undefined): EpisodeSummary => episodeSummary(candidate!.training as Json);
  return {
    seed: record.seed,
    gates: { training: trainingTrack(manifest.tracks.training.id).gates.length, validation: validationTrack(manifest.tracks.validation.id).gates.length },
    episodes: {
      A1: { training: list(a.A1!.training), validation: list(a.A1!.validation) },
      A7: { training: list(a.A7!.training), validation: list(a.A7!.validation) },
      A2: { training: candidates.map(training), validation: list(a.A2!.validation) },
      A9: { training: [training(candidates[a.A9!.index as number])], validation: [episodeSummary(a.A9!.validation as Json)] },
      A8: { training: [training(samples[a.A8!.index as number])], validation: [episodeSummary(a.A8!.validation as Json)] },
      A5: { training: [training(final[a.A5!.index as number])], validation: [episodeSummary(a.A5!.validation as Json)] },
    },
    a5Generations: generations.map((generation) => {
      const totals = generation.map((c) => training(c).fitness);
      return { best: Math.max(...totals), mean: mean(totals) };
    }),
  };
}

const gatesOf = (seed: SeedSummary, agent: Agent, track: Track): number => sum(seed.episodes[agent][track].map((e) => e.gatesPassed));

/** The seed-level value (§7): the mean ordered progress over the agent's episodes on that track. */
export const seedProgress = (seed: SeedSummary, agent: Agent, track: Track): number =>
  gatesOf(seed, agent, track) / (seed.episodes[agent][track].length * seed.gates[track]);

// ---------------------------------------------------------------------------------------------------------------
// Analysis

export interface ContrastResult {
  readonly contrast: string;
  readonly track: Track;
  /** Exact per-seed differences in units of 1 ÷ unitsPerLap lap (integers), from which every statistic is computed. */
  readonly units: readonly number[];
  /** k × gates per lap, where k is the other agent's episode count per seed. */
  readonly unitsPerLap: number;
  /** The per-seed differences in laps (units ÷ unitsPerLap). */
  readonly differences: readonly number[];
  readonly mean: number;
  readonly interval: BootstrapInterval;
  readonly median: number;
  readonly iqr: readonly [number, number];
  readonly wilcoxon: WilcoxonResult;
}

/**
 * A paired contrast A5 − other on one track. The other agent has the same number k of episodes on every seed, so
 * each seed's difference k·gates(A5) − Σ gates(other) is an exact integer number of units of 1 ÷ (k × gates per lap)
 * lap. Ranks, sums, the bootstrap and the decision use those integers, so equal gate differences are equal and
 * 0.25 lap is exactly 0.25 lap (Codex review of 2582fa0).
 */
function contrast(manifest: StudyManifest, seeds: readonly SeedSummary[], other: Agent, track: Track): ContrastResult {
  const k = seeds[0]!.episodes[other][track].length;
  const gates = seeds[0]!.gates[track];
  for (const s of seeds) {
    if (s.episodes[other][track].length !== k || s.episodes.A5[track].length !== 1 || s.gates[track] !== gates) {
      throw new StudyAnalysisError(`Seed ${s.seed} has a different number of ${other} or A5 episodes, or gates, on the ${track} track.`);
    }
  }
  const unitsPerLap = k * gates;
  const units = seeds.map((s) => k * s.episodes.A5[track][0]!.gatesPassed - gatesOf(s, other, track));
  const interval = bootstrapMeanInterval(units, manifest.analysis.bootstrap);
  const [q1, q3] = iqr(units);
  return {
    contrast: `A5 - ${other}`,
    track,
    units,
    unitsPerLap,
    differences: units.map((u) => u / unitsPerLap),
    mean: sum(units) / (units.length * unitsPerLap),
    interval: { lower: interval.lower / unitsPerLap, upper: interval.upper / unitsPerLap },
    median: median(units) / unitsPerLap,
    iqr: [q1 / unitsPerLap, q3 / unitsPerLap],
    wilcoxon: wilcoxonSignedRank(units),
  };
}

/** Whether the mean difference reaches δ: Σ units ≥ δ × n × unitsPerLap, the right side rounded to 1e-9 so a decimal δ compares exactly. */
export const meanReachesDelta = (c: ContrastResult, delta: number): boolean =>
  sum(c.units) >= Math.round(delta * c.units.length * c.unitsPerLap * 1e9) / 1e9;

function agentTrackSummary(seeds: readonly SeedSummary[], agent: Agent, track: Track): Json {
  const values = seeds.map((s) => seedProgress(s, agent, track));
  const episodes = seeds.flatMap((s) => s.episodes[agent][track]);
  const laps = episodes.filter((e) => e.lapTicks.length > 0);
  const firstLapSeconds = laps.map((e) => e.lapTicks[0]! * DEFAULT_SIM_CONFIG.timestepSeconds);
  return {
    progress: { mean: mean(values), median: median(values), iqr: iqr(values), seeds: values.length },
    episodes: episodes.length,
    lapCompletion: { episodes: laps.length, rate: laps.length / episodes.length },
    collisions: { episodes: episodes.filter((e) => e.crashed).length, rate: episodes.filter((e) => e.crashed).length / episodes.length },
    outcomes: Object.fromEntries(OUTCOMES.map((o) => [o, episodes.filter((e) => e.outcome === o).length])),
    firstLapSeconds: { mean: firstLapSeconds.length > 0 ? mean(firstLapSeconds) : null, episodes: firstLapSeconds.length },
    meanFitness: mean(episodes.map((e) => e.fitness)),
  };
}

const sameSeeds = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/** Whether the analysis can count towards acceptance: a confirmatory manifest with exactly 1001–1010 or 1001–1020, every seed present. */
export function acceptanceEligibility(manifest: StudyManifest, seeds: readonly number[]): { readonly eligible: boolean; readonly reason: string | null } {
  if (manifest.label !== 'confirmatory') return { eligible: false, reason: `${manifest.label} analysis is acceptance-ineligible` };
  const sorted = [...seeds].sort((a, b) => a - b);
  if (!CONFIRMATORY_SEED_SETS.some((set) => sameSeeds(set, manifest.seeds)) || !CONFIRMATORY_SEED_SETS.some((set) => sameSeeds(set, sorted))) {
    return { eligible: false, reason: 'confirmatory analysis is acceptance-ineligible: the seeds are not exactly 1001-1010 or 1001-1020' };
  }
  return { eligible: true, reason: null };
}

/**
 * Analyses one summary per manifest seed. Pure and deterministic. Throws StudyAnalysisError for missing, duplicate
 * or extra seeds. The tests call it with synthetic summaries; analyseRecords calls it with replayed records.
 */
export function analyseSummaries(manifestInput: unknown, summaries: readonly SeedSummary[]): Json {
  const manifest = parseStudyManifest(manifestInput);
  const bySeed = new Map<number, SeedSummary>();
  for (const s of summaries) {
    if (!manifest.seeds.includes(s.seed)) throw new StudyAnalysisError(`Seed ${s.seed} is not one of the manifest's seeds.`);
    if (bySeed.has(s.seed)) throw new StudyAnalysisError(`Seed ${s.seed} is given more than once.`);
    bySeed.set(s.seed, s);
  }
  const missing = manifest.seeds.filter((seed) => !bySeed.has(seed));
  if (missing.length > 0) throw new StudyAnalysisError(`Missing records for seed(s) ${missing.join(', ')}.`);
  const seeds = manifest.seeds.map((seed) => bySeed.get(seed)!);

  const primary = contrast(manifest, seeds, 'A8', 'training');
  const secondary = SECONDARY_CONTRASTS.map(({ agent, track }) => contrast(manifest, seeds, agent, track));
  const agents = Object.fromEntries(AGENT_ORDER.map((agent) => [agent, Object.fromEntries(TRACKS.map((track) => [track, agentTrackSummary(seeds, agent, track)]))]));
  const generations = seeds[0]!.a5Generations.map((_, g) => {
    const best = seeds.map((s) => s.a5Generations[g]!.best);
    const means = seeds.map((s) => s.a5Generations[g]!.mean);
    return { generation: g, best: { median: median(best), iqr: iqr(best) }, mean: { median: median(means), iqr: iqr(means) } };
  });

  const eligibility = acceptanceEligibility(manifest, manifest.seeds);
  const a5ValidLap = seeds.some((s) => s.episodes.A5.training.some((e) => e.lapTicks.length > 0));
  const reported = (['A1', 'A7', 'A2', 'A9'] as const).every((agent) => {
    const summary = (agents[agent] as Json).training as Json;
    return summary !== undefined && summary.lapCompletion !== undefined && summary.collisions !== undefined;
  });
  const conditions = {
    intervalAboveZero: primary.interval.lower > 0,
    meanAtLeastDelta: meanReachesDelta(primary, manifest.analysis.delta),
    a5ValidLap,
    resultsReported: reported,
  };
  const allHold = Object.values(conditions).every(Boolean);
  const result = !eligibility.eligible ? `not evaluated: ${eligibility.reason}` : allHold ? 'supported' : 'negative or inconclusive';

  return {
    format: ANALYSIS_FORMAT,
    version: ANALYSIS_VERSION,
    manifestHash: manifestHash(manifest),
    studyId: manifest.id,
    label: manifest.label,
    n: seeds.length,
    seeds: seeds.map((s) => s.seed),
    acceptanceEligible: eligibility.eligible,
    decision: {
      rule: DECISION_RULE,
      result,
      claim: eligibility.eligible && allHold ? CLAIM : null,
      delta: manifest.analysis.delta,
      // Conditions are always computed and shown; they decide nothing when the analysis is ineligible.
      conditions,
    },
    metric: METRIC,
    bootstrap: { ...manifest.analysis.bootstrap },
    wilcoxon: WILCOXON,
    primary,
    secondary,
    agents,
    a5Generations: generations,
  };
}

/**
 * Parses the manifest, parses and replays every record, refuses any record that does not replay identically, and
 * analyses the replayed records. Throws StudyAnalysisError, or the study module's own errors for invalid input.
 */
export function analyseRecords(manifestInput: unknown, records: readonly unknown[], engine: ExperimentEngine): Json {
  const manifest = parseStudyManifest(manifestInput);
  const summaries = records.map((input, i) => {
    const record = parseStudyRecord(input, manifest, engine);
    const replay = replayStudyRecord(input, manifest, engine);
    if (!replay.identical) throw new StudyAnalysisError(`Record ${i} (seed ${record.seed}) does not replay identically; it is not analysed.`);
    return summariseRecord(record as unknown as { seed: number; agents: Json }, manifest);
  });
  return analyseSummaries(manifest, summaries);
}

/**
 * The pilot's configuration choice (plan §8.4): the highest mean A5 validation progress, with the first listed (C0)
 * winning ties. Each candidate gives its A5 models' validation gate counts and the track's gates per lap; means are
 * compared exactly by cross-multiplying integers (Σa × n_b against Σb × n_a), so equal gate totals tie (Codex review
 * of 9df24d4).
 */
export function selectByValidation(candidates: readonly { readonly id: string; readonly a5ValidationGates: readonly number[]; readonly gatesPerLap: number }[]): string {
  if (candidates.length === 0) throw new RangeError('selectByValidation needs at least one candidate.');
  const gatesPerLap = candidates[0]!.gatesPerLap;
  for (const c of candidates) {
    if (c.a5ValidationGates.length === 0) throw new RangeError(`Candidate ${c.id} has no validation episodes.`);
    if (c.gatesPerLap !== gatesPerLap) throw new RangeError('Every candidate must be scored on the same validation track.');
    if (!c.a5ValidationGates.every((g) => Number.isSafeInteger(g) && g >= 0)) throw new RangeError(`Candidate ${c.id} has a gate count that is not a whole number.`);
  }
  let best = 0;
  for (let i = 1; i < candidates.length; i += 1) {
    const a = candidates[i]!.a5ValidationGates;
    const b = candidates[best]!.a5ValidationGates;
    if (sum(a) * b.length > sum(b) * a.length) best = i;
  }
  return candidates[best]!.id;
}

// ---------------------------------------------------------------------------------------------------------------
// Report

const f = (value: number | null): string => (value === null ? 'unavailable' : value.toFixed(4));
const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;

/** The canonical JSON text of an analysis, as written to analysis.json. */
export const analysisJson = (analysis: Json): string => `${canonicalJson(analysis)}\n`;

/** report.md: deterministic, with no dates or timings. */
export function renderReport(analysis: Json): string {
  const decision = analysis.decision as Json;
  const conditions = decision.conditions as Record<string, boolean>;
  const primary = analysis.primary as ContrastResult;
  const row = (c: ContrastResult) =>
    `| ${c.contrast} | ${c.track} | ${f(c.mean)} | [${f(c.interval.lower)}, ${f(c.interval.upper)}] | ${f(c.median)} | [${f(c.iqr[0])}, ${f(c.iqr[1])}] | ${c.wilcoxon.m} | ${f(c.wilcoxon.p)} |`;
  const lines: string[] = [
    `# P2-08 analysis: ${analysis.studyId as string}`,
    '',
    `- **Label:** ${analysis.label as string}`,
    `- **Independent n (training seeds):** ${analysis.n as number}`,
    `- **Acceptance eligible:** ${analysis.acceptanceEligible ? 'yes' : 'no'}`,
    `- **Decision (${decision.rule as string}):** ${decision.result as string}`,
    `- **Claim:** ${(decision.claim as string | null) ?? 'none'}`,
    '',
    'Ordered progress is gates credited ÷ gates per lap. The seed is the independent unit. Nothing here is a claim of general driving ability.',
    '',
    '## Primary contrast (A5 - A8, training track)',
    '',
    '| Contrast | Track | Mean | 95% bootstrap interval | Median | IQR | Wilcoxon m | Wilcoxon p (descriptive) |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    row(primary),
    '',
    `Per-seed differences: ${primary.differences.map(f).join(', ')}.`,
    '',
    `Decision conditions (δ = ${f(decision.delta as number)}), shown whether or not the analysis is eligible:`,
    `- interval lower bound above 0: ${conditions.intervalAboveZero ? 'yes' : 'no'}`,
    `- mean at least δ: ${conditions.meanAtLeastDelta ? 'yes' : 'no'}`,
    `- an A5 frozen model completes a valid lap on the training track: ${conditions.a5ValidLap ? 'yes' : 'no'}`,
    `- A1, A7, A2 and A9 results, lap completion and collisions reported: ${conditions.resultsReported ? 'yes' : 'no'}`,
    '',
    '## Descriptive results (not tested, no claims)',
    '',
    '| Contrast | Track | Mean | 95% bootstrap interval | Median | IQR | Wilcoxon m | Wilcoxon p |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...(analysis.secondary as ContrastResult[]).map(row),
    '',
    '## Agents by track',
    '',
    '| Agent | Track | Progress mean | Median | IQR | Lap completion | Collisions | Completed / crashed / stalled / timeout | First lap (s, n) | Mean fitness |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const agent of AGENT_ORDER) {
    for (const track of TRACKS) {
      const s = ((analysis.agents as Json)[agent] as Json)[track] as Json;
      const p = s.progress as Json;
      const lap = s.lapCompletion as Json;
      const col = s.collisions as Json;
      const o = s.outcomes as Record<string, number>;
      const first = s.firstLapSeconds as Json;
      const q = p.iqr as number[];
      lines.push(
        `| ${agent} | ${track} | ${f(p.mean as number)} | ${f(p.median as number)} | [${f(q[0]!)}, ${f(q[1]!)}] | ${pct(lap.rate as number)} (${lap.episodes as number}/${s.episodes as number}) | ${pct(col.rate as number)} (${col.episodes as number}/${s.episodes as number}) | ${OUTCOMES.map((k) => o[k]).join(' / ')} | ${f(first.mean as number | null)} (${first.episodes as number}) | ${f(s.meanFitness as number)} |`,
      );
    }
  }
  lines.push(
    '',
    '## A5 training fitness by generation (descriptive)',
    '',
    'Rising training fitness is a training signal on one track, never evidence of learning.',
    '',
    '| Generation | Best: median | Best: IQR | Mean: median | Mean: IQR |',
    '| --- | --- | --- | --- | --- |',
  );
  for (const g of analysis.a5Generations as Json[]) {
    const best = g.best as Json;
    const m = g.mean as Json;
    const bi = best.iqr as number[];
    const mi = m.iqr as number[];
    lines.push(`| ${g.generation as number} | ${f(best.median as number)} | [${f(bi[0]!)}, ${f(bi[1]!)}] | ${f(m.median as number)} | [${f(mi[0]!)}, ${f(mi[1]!)}] |`);
  }
  lines.push(
    '',
    '## Limitations',
    '',
    '- Validation-track results are descriptive; no held-out track was evaluated.',
    '- Only the A5 - A8 contrast on the training track is tested, and only for an acceptance-eligible confirmatory analysis.',
    '- The Wilcoxon p-values are descriptive and never replace the bootstrap decision rule.',
    '',
  );
  return lines.join('\n');
}
