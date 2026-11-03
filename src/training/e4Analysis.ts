// P2-09 E4 analysis and report (docs/experiments/p2-09-plan.md §5): the paired seed-level contrast A5 − A4 on the
// training track, with a seeded percentile bootstrap, an exact Wilcoxon signed-rank test, the four exhaustive
// outcome labels, descriptive secondary measures on both tracks, and a deterministic report.
// Tooling only: nothing here runs a study or writes a file (the command line is scripts/e4.mjs). Nothing in E4
// decides Phase 2 acceptance, and no held-out track is ever evaluated: held-out generalisation is E5 in P5-02.
import { DEFAULT_SIM_CONFIG } from '../sim/config';
import {
  bootstrapMeanInterval,
  episodeSummary,
  iqr,
  mean,
  median,
  OUTCOMES,
  StudyAnalysisError,
  wilcoxonSignedRank,
  type BootstrapInterval,
  type EpisodeSummary,
  type WilcoxonResult,
} from './analysis';
import { E4_AGENTS, type BrakeUsage, type E4Agent } from './e4Agents';
import { e4ManifestHash, parseE4Manifest, parseE4Record, replayE4Record, E4_DECISION_RULE, type E4Manifest } from './e4Study';
import { canonicalJson, type ExperimentEngine } from './experiment';
import { WILCOXON } from './study';
import { trainingTrack, validationTrack } from './trackSplits';

export const E4_ANALYSIS_FORMAT = 'self-driving-ai-evolution/p2-09-e4-analysis';
export const E4_ANALYSIS_VERSION = 1;
export const E4_TRACKS = Object.freeze(['training', 'validation'] as const);
export type E4Track = (typeof E4_TRACKS)[number];

type Json = Record<string, unknown>;

/** The four exhaustive, mutually exclusive outcome labels (plan §5). */
export const E4_OUTCOME_IDS = Object.freeze({
  a5Meaningful: 'a5-meaningful-advantage',
  a4Meaningful: 'a4-meaningful-advantage',
  belowThreshold: 'below-threshold-direction',
  noDirection: 'no-direction',
} as const);
export type E4OutcomeId = (typeof E4_OUTCOME_IDS)[keyof typeof E4_OUTCOME_IDS];

/** What the analysis needs from one training seed: each agent's frozen champion on each track, and its brake usage. */
export interface E4SeedSummary {
  readonly seed: number;
  /** Gates per lap on each track. */
  readonly gates: Readonly<Record<E4Track, number>>;
  readonly episodes: Readonly<Record<E4Agent, Readonly<Record<E4Track, EpisodeSummary>>>>;
  readonly brakeUsage: Readonly<Record<E4Agent, Readonly<Record<E4Track, BrakeUsage>>>>;
}

const sum = (values: readonly number[]): number => values.reduce((total, v) => total + v, 0);

/** The outcome wording for a label (plan §5), as reported. `direction` is only used by the below-threshold label. */
export function e4OutcomeWording(id: E4OutcomeId, direction: 'A5' | 'A4' | null): string {
  switch (id) {
    case E4_OUTCOME_IDS.a5Meaningful:
      return 'A5 (braking) reached meaningfully more training-track progress than A4';
    case E4_OUTCOME_IDS.a4Meaningful:
      return 'A4 (no braking) reached meaningfully more training-track progress than A5';
    case E4_OUTCOME_IDS.belowThreshold: {
      const [more, other] = direction === 'A4' ? ['A4', 'A5'] : ['A5', 'A4'];
      return `${more} reached more training-track progress than ${other}, but the difference is below the predeclared 0.25-lap meaningful threshold`;
    }
    case E4_OUTCOME_IDS.noDirection:
      return 'no direction established: the interval spans zero';
  }
}

export interface E4Classification {
  readonly id: E4OutcomeId;
  /** The sign of the difference for the below-threshold label; null for the others. */
  readonly direction: 'A5' | 'A4' | null;
  readonly wording: string;
  readonly conditions: {
    readonly intervalAboveZero: boolean;
    readonly intervalBelowZero: boolean;
    readonly meanAtLeastDelta: boolean;
    readonly meanAtMostMinusDelta: boolean;
  };
}

/**
 * The outcome label for a paired contrast, from exact integers: the per-seed differences are whole numbers of units
 * of 1 ÷ unitsPerLap lap, so the mean reaches ±δ when Σ units ≥ δ × n × unitsPerLap (the right side rounded to 1e-9 so
 * a decimal δ compares exactly), and the interval bounds are in the same units.
 *
 * | Condition                                              | Label                 |
 * | interval lower bound > 0 and mean ≥ δ                  | a5-meaningful-advantage |
 * | interval upper bound < 0 and mean ≤ −δ                 | a4-meaningful-advantage |
 * | interval excludes 0 but |mean| < δ                     | below-threshold-direction |
 * | interval includes 0 (lower ≤ 0 ≤ upper)                | no-direction          |
 *
 * An interval bound is always on the mean's side of zero, so the combinations left over (the interval above zero with a
 * mean of −δ or less, or below zero with a mean of δ or more) cannot occur. They throw StudyAnalysisError rather than
 * being given a label, so the four rows stay exhaustive and mutually exclusive.
 */
export function classifyE4Outcome(units: { readonly sum: number; readonly n: number; readonly unitsPerLap: number; readonly lower: number; readonly upper: number }, delta: number): E4Classification {
  const threshold = Math.round(delta * units.n * units.unitsPerLap * 1e9) / 1e9;
  const conditions = {
    intervalAboveZero: units.lower > 0,
    intervalBelowZero: units.upper < 0,
    meanAtLeastDelta: units.sum >= threshold,
    meanAtMostMinusDelta: units.sum <= -threshold,
  };
  const label = (id: E4OutcomeId, direction: 'A5' | 'A4' | null = null): E4Classification => ({ id, direction, wording: e4OutcomeWording(id, direction), conditions });
  if (conditions.intervalAboveZero && conditions.meanAtLeastDelta) return label(E4_OUTCOME_IDS.a5Meaningful);
  if (conditions.intervalBelowZero && conditions.meanAtMostMinusDelta) return label(E4_OUTCOME_IDS.a4Meaningful);
  if (conditions.intervalAboveZero && !conditions.meanAtMostMinusDelta) return label(E4_OUTCOME_IDS.belowThreshold, 'A5');
  if (conditions.intervalBelowZero && !conditions.meanAtLeastDelta) return label(E4_OUTCOME_IDS.belowThreshold, 'A4');
  if (!conditions.intervalAboveZero && !conditions.intervalBelowZero) return label(E4_OUTCOME_IDS.noDirection);
  throw new StudyAnalysisError('The bootstrap interval and the mean disagree in sign (impossible for a percentile interval of the mean); the analysis refuses to label it.');
}

/** Reduces one parsed record to what the analysis reads. The record must already have been parsed (and replayed) against this manifest. */
export function summariseE4Record(record: { readonly seed: number; readonly agents: Json }, manifest: E4Manifest): E4SeedSummary {
  const a = record.agents as Record<E4Agent, Json>;
  const champion = (agent: E4Agent): EpisodeSummary => {
    const generations = a[agent].generations as Json[][];
    return episodeSummary(generations[generations.length - 1]![a[agent].index as number]!.training as Json);
  };
  const episodes = Object.fromEntries(E4_AGENTS.map((agent) => [agent, { training: champion(agent), validation: episodeSummary(a[agent].validation as Json) }])) as unknown as E4SeedSummary['episodes'];
  const brakeUsage = Object.fromEntries(E4_AGENTS.map((agent) => [agent, plainUsage(a[agent].brakeUsage as Json)])) as unknown as E4SeedSummary['brakeUsage'];
  return {
    seed: record.seed,
    gates: { training: trainingTrack(manifest.tracks.training.id).gates.length, validation: validationTrack(manifest.tracks.validation.id).gates.length },
    episodes,
    brakeUsage,
  };
}

const plainUsage = (usage: Json): Record<E4Track, BrakeUsage> => ({
  training: { ticks: (usage.training as BrakeUsage).ticks, brakeTicks: (usage.training as BrakeUsage).brakeTicks },
  validation: { ticks: (usage.validation as BrakeUsage).ticks, brakeTicks: (usage.validation as BrakeUsage).brakeTicks },
});

/** The seed-level value: the champion's ordered progress (gates credited ÷ gates per lap) on that track. */
export const e4SeedProgress = (seed: E4SeedSummary, agent: E4Agent, track: E4Track): number => seed.episodes[agent][track].gatesPassed / seed.gates[track];

export interface E4Contrast {
  readonly contrast: string;
  readonly track: E4Track;
  /** Exact per-seed differences A5 − A4 in units of 1 ÷ unitsPerLap lap (integers), from which every statistic is computed. */
  readonly units: readonly number[];
  readonly unitsPerLap: number;
  /** The per-seed differences in laps. */
  readonly differences: readonly number[];
  readonly mean: number;
  readonly interval: BootstrapInterval;
  readonly median: number;
  readonly iqr: readonly [number, number];
  readonly wilcoxon: WilcoxonResult;
  /** The interval in units, kept for the exact classification. */
  readonly intervalUnits: BootstrapInterval;
}

/**
 * The paired contrast A5 − A4 on one track. Each agent has exactly one champion episode per seed, so each seed's
 * difference gates(A5) − gates(A4) is an exact integer number of units of 1 ÷ (gates per lap) lap. Ranks, sums, the
 * bootstrap and the label use those integers, so equal gate differences are equal and 0.25 lap is exactly 0.25 lap.
 */
function contrast(manifest: E4Manifest, seeds: readonly E4SeedSummary[], track: E4Track): E4Contrast {
  const gates = seeds[0]!.gates[track];
  for (const s of seeds) if (s.gates[track] !== gates) throw new StudyAnalysisError(`Seed ${s.seed} has a different number of gates on the ${track} track.`);
  const units = seeds.map((s) => s.episodes.A5[track].gatesPassed - s.episodes.A4[track].gatesPassed);
  const intervalUnits = bootstrapMeanInterval(units, manifest.analysis.bootstrap);
  const [q1, q3] = iqr(units);
  return {
    contrast: 'A5 - A4',
    track,
    units,
    unitsPerLap: gates,
    differences: units.map((u) => u / gates),
    mean: sum(units) / (units.length * gates),
    interval: { lower: intervalUnits.lower / gates, upper: intervalUnits.upper / gates },
    median: median(units) / gates,
    iqr: [q1 / gates, q3 / gates],
    wilcoxon: wilcoxonSignedRank(units),
    intervalUnits,
  };
}

const OUTCOME_KEYS = OUTCOMES;

function agentTrackSummary(seeds: readonly E4SeedSummary[], agent: E4Agent, track: E4Track): Json {
  const values = seeds.map((s) => e4SeedProgress(s, agent, track));
  const episodes = seeds.map((s) => s.episodes[agent][track]);
  const laps = episodes.filter((e) => e.lapTicks.length > 0);
  const firstLapSeconds = laps.map((e) => e.lapTicks[0]! * DEFAULT_SIM_CONFIG.timestepSeconds);
  return {
    progress: { mean: mean(values), median: median(values), iqr: iqr(values), seeds: values.length },
    episodes: episodes.length,
    lapCompletion: { episodes: laps.length, rate: laps.length / episodes.length },
    collisions: { episodes: episodes.filter((e) => e.crashed).length, rate: episodes.filter((e) => e.crashed).length / episodes.length },
    outcomes: Object.fromEntries(OUTCOME_KEYS.map((o) => [o, episodes.filter((e) => e.outcome === o).length])),
    firstLapSeconds: { mean: firstLapSeconds.length > 0 ? mean(firstLapSeconds) : null, episodes: firstLapSeconds.length },
    meanFitness: mean(episodes.map((e) => e.fitness)),
  };
}

/** First-lap times paired by seed: only the seeds where both A4 and A5 completed a lap, with n (plan §5). */
function pairedFirstLap(seeds: readonly E4SeedSummary[], track: E4Track): Json {
  const pairs = seeds
    .filter((s) => s.episodes.A4[track].lapTicks.length > 0 && s.episodes.A5[track].lapTicks.length > 0)
    .map((s) => ({ seed: s.seed, A4: s.episodes.A4[track].lapTicks[0]! * DEFAULT_SIM_CONFIG.timestepSeconds, A5: s.episodes.A5[track].lapTicks[0]! * DEFAULT_SIM_CONFIG.timestepSeconds }));
  const differences = pairs.map((p) => p.A5 - p.A4);
  return { seeds: pairs.length, of: seeds.length, differences, meanDifference: differences.length > 0 ? mean(differences) : null, pairs };
}

function brakeUsageSummary(seeds: readonly E4SeedSummary[], agent: E4Agent, track: E4Track): Json {
  const usage = seeds.map((s) => s.brakeUsage[agent][track]);
  const ticks = sum(usage.map((u) => u.ticks));
  const brakeTicks = sum(usage.map((u) => u.brakeTicks));
  return { ticks, brakeTicks, share: ticks > 0 ? brakeTicks / ticks : null, perSeed: usage.map((u) => (u.ticks > 0 ? u.brakeTicks / u.ticks : null)) };
}

/**
 * Analyses one summary per manifest seed. Pure and deterministic. Throws StudyAnalysisError for missing, duplicate or
 * extra seeds, or an A4 that braked at all (the mask makes that impossible, so it would mean a corrupt input). The
 * tests call it with synthetic summaries; analyseE4Records calls it with replayed records.
 */
export function analyseE4Summaries(manifestInput: unknown, summaries: readonly E4SeedSummary[]): Json {
  const manifest = parseE4Manifest(manifestInput);
  const bySeed = new Map<number, E4SeedSummary>();
  for (const s of summaries) {
    if (!manifest.seeds.includes(s.seed)) throw new StudyAnalysisError(`Seed ${s.seed} is not one of the manifest's seeds.`);
    if (bySeed.has(s.seed)) throw new StudyAnalysisError(`Seed ${s.seed} is given more than once.`);
    bySeed.set(s.seed, s);
  }
  const missing = manifest.seeds.filter((seed) => !bySeed.has(seed));
  if (missing.length > 0) throw new StudyAnalysisError(`Missing records for seed(s) ${missing.join(', ')}.`);
  const seeds = manifest.seeds.map((seed) => bySeed.get(seed)!);
  for (const s of seeds) {
    for (const track of E4_TRACKS) {
      if (s.brakeUsage.A4[track].brakeTicks !== 0) throw new StudyAnalysisError(`Seed ${s.seed}: A4 braked on the ${track} track, which its brake mask makes impossible.`);
    }
  }

  const primary = contrast(manifest, seeds, 'training');
  const validation = contrast(manifest, seeds, 'validation');
  const classification = classifyE4Outcome({ sum: sum(primary.units), n: primary.units.length, unitsPerLap: primary.unitsPerLap, lower: primary.intervalUnits.lower, upper: primary.intervalUnits.upper }, manifest.analysis.delta);
  // A mechanics analysis is a tooling check, never a result: the label is shown, but no outcome wording is reported.
  const reportable = manifest.label === 'confirmatory';
  const agents = Object.fromEntries(E4_AGENTS.map((agent) => [agent, Object.fromEntries(E4_TRACKS.map((track) => [track, agentTrackSummary(seeds, agent, track)]))]));
  const brakeUsage = Object.fromEntries(E4_AGENTS.map((agent) => [agent, Object.fromEntries(E4_TRACKS.map((track) => [track, brakeUsageSummary(seeds, agent, track)]))]));

  return {
    format: E4_ANALYSIS_FORMAT,
    version: E4_ANALYSIS_VERSION,
    manifestHash: e4ManifestHash(manifest),
    studyId: manifest.id,
    label: manifest.label,
    n: seeds.length,
    seeds: seeds.map((s) => s.seed),
    reportable,
    outcome: {
      rule: E4_DECISION_RULE,
      result: reportable ? classification.id : `not evaluated: a ${manifest.label} analysis is a tooling check, not a result`,
      label: classification.id,
      direction: classification.direction,
      wording: reportable ? classification.wording : null,
      delta: manifest.analysis.delta,
      // Conditions are always computed and shown; they decide nothing when the analysis is not reportable.
      conditions: classification.conditions,
    },
    metric: manifest.metric,
    bootstrap: { ...manifest.analysis.bootstrap },
    wilcoxon: WILCOXON,
    primary,
    validation,
    agents,
    firstLap: Object.fromEntries(E4_TRACKS.map((track) => [track, pairedFirstLap(seeds, track)])),
    brakeUsage,
    a4BrakeTicksZero: true,
  };
}

/**
 * Parses the manifest, parses and replays every record, refuses any record that does not replay identically, and
 * analyses the replayed records. Throws StudyAnalysisError, or the study module's own errors for invalid input.
 */
export function analyseE4Records(manifestInput: unknown, records: readonly unknown[], engine: ExperimentEngine): Json {
  const manifest = parseE4Manifest(manifestInput);
  const summaries = records.map((input, i) => {
    const record = parseE4Record(input, manifest, engine);
    const replay = replayE4Record(input, manifest, engine);
    if (!replay.identical) throw new StudyAnalysisError(`Record ${i} (seed ${record.seed}) does not replay identically; it is not analysed.`);
    return summariseE4Record(record as unknown as { seed: number; agents: Json }, manifest);
  });
  return analyseE4Summaries(manifest, summaries);
}

// ---------------------------------------------------------------------------------------------------------------
// Report

const f = (value: number | null): string => (value === null ? 'unavailable' : value.toFixed(4));
const pct = (value: number | null): string => (value === null ? 'unavailable' : `${(value * 100).toFixed(2)}%`);

/** The canonical JSON text of an analysis, as written to analysis.json. */
export const e4AnalysisJson = (analysis: Json): string => `${canonicalJson(analysis)}\n`;

/** report.md: deterministic, with no dates or timings. */
export function renderE4Report(analysis: Json): string {
  const outcome = analysis.outcome as Json;
  const conditions = outcome.conditions as Record<string, boolean>;
  const primary = analysis.primary as E4Contrast;
  const validation = analysis.validation as E4Contrast;
  const reportable = analysis.reportable as boolean;
  const row = (c: E4Contrast) =>
    `| ${c.contrast} | ${c.track} | ${f(c.mean)} | [${f(c.interval.lower)}, ${f(c.interval.upper)}] | ${f(c.median)} | [${f(c.iqr[0])}, ${f(c.iqr[1])}] | ${c.wilcoxon.m} | ${f(c.wilcoxon.p)} |`;
  const lines: string[] = [
    `# P2-09 E4 analysis: ${analysis.studyId as string}`,
    '',
    `- **Label:** ${analysis.label as string}`,
    `- **Independent n (training seeds):** ${analysis.n as number}`,
    `- **Outcome (${outcome.rule as string}):** ${reportable ? (outcome.label as string) : (outcome.result as string)}`,
    `- **Reported as:** ${(outcome.wording as string | null) ?? 'nothing (not a result)'}`,
    '',
    'Ordered progress is gates credited ÷ gates per lap, for each agent\'s frozen champion. The seed is the independent unit, and A4 and A5 are paired by seed (the same generation-0 population). Nothing here is a claim of general driving ability, and no held-out track was evaluated.',
    '',
    '## Primary measure (A5 − A4, training track)',
    '',
    '| Contrast | Track | Mean | 95% bootstrap interval | Median | IQR | Wilcoxon m | Wilcoxon p (descriptive) |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    row(primary),
    '',
    `Per-seed differences: ${primary.differences.map(f).join(', ')}.`,
    '',
    `Outcome conditions (δ = ${f(outcome.delta as number)} lap), shown whether or not the analysis is reportable:`,
    `- interval lower bound above 0: ${conditions.intervalAboveZero ? 'yes' : 'no'}`,
    `- interval upper bound below 0: ${conditions.intervalBelowZero ? 'yes' : 'no'}`,
    `- mean at least δ: ${conditions.meanAtLeastDelta ? 'yes' : 'no'}`,
    `- mean at most −δ: ${conditions.meanAtMostMinusDelta ? 'yes' : 'no'}`,
    '',
    'A label other than a meaningful advantage means only that a predeclared meaningful advantage was not established. It does not mean "no effect" or "equivalent": the below-threshold label says the evidence shows a direction smaller than 0.25 lap, and the no-direction label says the direction is uncertain.',
    '',
    '## Validation track (A5 − A4, descriptive: it decides nothing)',
    '',
    '| Contrast | Track | Mean | 95% bootstrap interval | Median | IQR | Wilcoxon m | Wilcoxon p |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    row(validation),
    '',
    `Per-seed differences: ${validation.differences.map(f).join(', ')}.`,
    '',
    '## Agents by track (descriptive)',
    '',
    '| Agent | Track | Progress mean | Median | IQR | Lap completion | Collisions | Completed / crashed / stalled / timeout | First lap (s, n) | Mean fitness |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const agent of E4_AGENTS) {
    for (const track of E4_TRACKS) {
      const s = ((analysis.agents as Json)[agent] as Json)[track] as Json;
      const p = s.progress as Json;
      const lap = s.lapCompletion as Json;
      const col = s.collisions as Json;
      const o = s.outcomes as Record<string, number>;
      const first = s.firstLapSeconds as Json;
      const q = p.iqr as number[];
      lines.push(
        `| ${agent} | ${track} | ${f(p.mean as number)} | ${f(p.median as number)} | [${f(q[0]!)}, ${f(q[1]!)}] | ${pct(lap.rate as number)} (${lap.episodes as number}/${s.episodes as number}) | ${pct(col.rate as number)} (${col.episodes as number}/${s.episodes as number}) | ${OUTCOME_KEYS.map((k) => o[k]).join(' / ')} | ${f(first.mean as number | null)} (${first.episodes as number}) | ${f(s.meanFitness as number)} |`,
      );
    }
  }
  lines.push('', '## First-lap time, paired by seed (A5 − A4, seconds; only seeds where both completed a lap)', '', '| Track | Seeds (n of N) | Mean difference |', '| --- | --- | --- |');
  for (const track of E4_TRACKS) {
    const p = (analysis.firstLap as Json)[track] as Json;
    lines.push(`| ${track} | ${p.seeds as number} of ${p.of as number} | ${f(p.meanDifference as number | null)} |`);
  }
  lines.push('', '## Brake usage (share of champion ticks with brake above 0.05)', '', '| Agent | Track | Brake ticks / ticks | Share |', '| --- | --- | --- | --- |');
  for (const agent of E4_AGENTS) {
    for (const track of E4_TRACKS) {
      const u = ((analysis.brakeUsage as Json)[agent] as Json)[track] as Json;
      lines.push(`| ${agent} | ${track} | ${u.brakeTicks as number} / ${u.ticks as number} | ${pct(u.share as number | null)} |`);
    }
  }
  lines.push(
    '',
    'A4 has its brake output masked, so its share is exactly 0 (checked for every seed).',
    '',
    '## Limitations',
    '',
    '- One configuration (C1), one training track and the seeds of this study. Validation-track results are descriptive; no held-out track was evaluated.',
    '- A result here is a statement about the training track only. It is not evidence that learned braking improves driving on unseen tracks (E5, in P5-02) and not evidence from the feasibility check, which concerned a scripted driver.',
    '- The Wilcoxon p-values are descriptive and never replace the bootstrap interval rule.',
    '',
  );
  return lines.join('\n');
}
