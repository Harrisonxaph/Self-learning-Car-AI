// P5-01 step 3: tuning the rule-based driver's five constants (docs/plans/p5-01-plan.md §3 and §4). The grid below is
// PREDECLARED: it is committed before the tuning is run and is never changed after a result has been seen. Candidates
// are scored on the TRAINING track only (stadium-oval) through the shared episode path (evaluateDriver) with the
// trainer's own episode rules; `createEvaluationSetup` still refuses held-out tracks, and nothing here touches a
// validation or held-out track. A3 and A3-nb are tuned separately over the same grid; A3-nb-same (A3's constants with
// only the brake masked) is derived, not tuned. Selection rule (RULE_SELECTION): most ordered checkpoints, then most
// laps, then fastest first lap, then lowest grid index.
//
// Tooling only: it makes no learning claim; it picks constants for a baseline.
import { createRuleBasedDriver, type RuleParams, RULE_BASED_ALGORITHM } from '../ai/ruleBasedDriver';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../sim/config';
import { sha256Hex } from '../utils/sha256';
import { createEvaluationSetup, evaluateDriver } from './evaluation';
import { canonicalJson } from './experiment';
import { trackContentHash, trainingTrack } from './trackSplits';

export const RULE_TUNING_FORMAT = 'self-driving-ai-evolution/p5-01-rule-tuning';
export const RULE_TUNING_VERSION = 1;
/** The only track tuning uses. */
export const TUNING_TRACK_ID = 'stadium-oval';
/** The selection rule, as recorded. */
export const RULE_SELECTION = 'checkpoints-then-laps-then-first-lap-then-grid-index-v1';

export interface TuningGrid {
  readonly steerGain: readonly number[];
  readonly frontClear: readonly number[];
  readonly speedCap: readonly number[];
  /** A3 only: the brake constants are not part of A3-nb's grid. */
  readonly brakeFront: readonly number[];
  readonly brakeSpeed: readonly number[];
}

/** The predeclared grid: A3 has 3 × 2 × 3 × 2 × 2 = 72 variants, A3-nb has 3 × 2 × 3 = 18 (at most 100 each, plan §3). */
export const TUNING_GRID: TuningGrid = Object.freeze({
  steerGain: Object.freeze([1, 2, 4]),
  frontClear: Object.freeze([0.3, 0.6]),
  speedCap: Object.freeze([0.5, 0.75, 1]),
  brakeFront: Object.freeze([0.15, 0.3]),
  brakeSpeed: Object.freeze([0.4, 0.6]),
});

/** The most variants one agent may have. */
export const MAX_VARIANTS = 100;

export type TunedAgent = 'A3' | 'A3-nb' | 'A3-nb-same';

export interface TuningEpisode {
  readonly agent: TunedAgent;
  /** The variant's position in its agent's grid order (steerGain, frontClear, speedCap, brakeFront, brakeSpeed); null for A3-nb-same. */
  readonly index: number | null;
  readonly params: RuleParams;
  readonly outcome: string;
  readonly crashed: boolean;
  readonly gatesPassed: number;
  readonly lapsCompleted: number;
  /** Ticks of the first completed lap, or null if none was completed. */
  readonly firstLapTicks: number | null;
  readonly orderedProgress: number;
  readonly ticks: number;
}

export interface TuningSelection {
  readonly index: number;
  readonly params: RuleParams;
}

export interface TuningRecord {
  readonly format: typeof RULE_TUNING_FORMAT;
  readonly version: typeof RULE_TUNING_VERSION;
  readonly id: 'p5-01-rule-tuning';
  readonly description: string;
  /** True only when the grid is exactly TUNING_GRID. A different grid is for tests and is not the tuning. */
  readonly preregisteredGrid: boolean;
  readonly grid: TuningGrid;
  readonly selectionRule: typeof RULE_SELECTION;
  readonly algorithm: typeof RULE_BASED_ALGORITHM;
  readonly rules: { readonly maxEpisodeSeconds: number; readonly stallSeconds: number; readonly maxLaps: number; readonly fitnessVersion: number; readonly timestepSeconds: number };
  readonly physics: typeof DEFAULT_VEHICLE_PHYSICS;
  /** The single training track; no validation or held-out track appears. */
  readonly track: { readonly split: 'training'; readonly id: string; readonly version: string; readonly contentHash: string };
  readonly engine: Readonly<Record<string, unknown>>;
  readonly source: Readonly<Record<string, unknown>>;
  readonly episodes: readonly TuningEpisode[];
  readonly selected: { readonly A3: TuningSelection; readonly 'A3-nb': TuningSelection };
  /** SHA-256 of the canonical JSON of `episodes`: the same in any engine and at any commit that gives the same results. */
  readonly resultsHash: string;
}

const hashOf = (value: unknown): string => `sha256:${sha256Hex(canonicalJson(value))}`;

function checkGrid(grid: TuningGrid): void {
  for (const key of ['steerGain', 'frontClear', 'speedCap', 'brakeFront', 'brakeSpeed'] as const) {
    const values = grid[key];
    if (!Array.isArray(values) || values.length === 0) throw new RangeError(`Tuning grid "${key}" needs at least one value.`);
  }
  if (variantCount(grid, true) > MAX_VARIANTS) throw new RangeError(`Tuning grid has more than ${MAX_VARIANTS} variants for A3.`);
}

const variantCount = (grid: TuningGrid, brake: boolean): number =>
  grid.steerGain.length * grid.frontClear.length * grid.speedCap.length * (brake ? grid.brakeFront.length * grid.brakeSpeed.length : 1);

/** The variants of one agent in grid order. A3-nb's brake constants are fixed at 0 (they are never used). */
export function variantsOf(grid: TuningGrid, brake: boolean): readonly RuleParams[] {
  const out: RuleParams[] = [];
  for (const steerGain of grid.steerGain) {
    for (const frontClear of grid.frontClear) {
      for (const speedCap of grid.speedCap) {
        for (const brakeFront of brake ? grid.brakeFront : [0]) {
          for (const brakeSpeed of brake ? grid.brakeSpeed : [0]) out.push({ steerGain, frontClear, speedCap, brakeFront, brakeSpeed });
        }
      }
    }
  }
  return out;
}

/** True if `a` is strictly better than `b` by the selection rule (grid index is the caller's final tie-break). */
export function betterEpisode(a: TuningEpisode, b: TuningEpisode): boolean {
  if (a.gatesPassed !== b.gatesPassed) return a.gatesPassed > b.gatesPassed;
  if (a.lapsCompleted !== b.lapsCompleted) return a.lapsCompleted > b.lapsCompleted;
  const x = a.firstLapTicks;
  const y = b.firstLapTicks;
  if (x !== y) {
    if (x === null) return false;
    if (y === null) return true;
    return x < y;
  }
  return false;
}

/** The selected episode of one agent: best by the rule, the lowest index among equals. Throws if there are none. */
export function selectBest(episodes: readonly TuningEpisode[]): TuningEpisode {
  let best: TuningEpisode | null = null;
  for (const e of episodes) if (best === null || betterEpisode(e, best)) best = e;
  if (best === null) throw new RangeError('Selection needs at least one episode.');
  return best;
}

export interface TuningOptions {
  readonly engine: Readonly<Record<string, unknown>>;
  readonly source: Readonly<Record<string, unknown>>;
  /** For tests only: a smaller grid. The record then says `preregisteredGrid: false`. The command line never sets it. */
  readonly grid?: TuningGrid;
}

/**
 * Runs every variant of A3 and of A3-nb once on the training track, selects each agent's best, and evaluates A3-nb-same
 * (A3's selected constants, brake masked). Deterministic: the same code gives the same `episodes` and `resultsHash`.
 */
export function runRuleTuning(options: TuningOptions): TuningRecord {
  const grid = options.grid ?? TUNING_GRID;
  checkGrid(grid);
  const timestepSeconds = DEFAULT_SIM_CONFIG.timestepSeconds;
  const track = trainingTrack(TUNING_TRACK_ID);
  const setup = createEvaluationSetup({}, { track, physics: DEFAULT_VEHICLE_PHYSICS, timestepSeconds });
  const run = (agent: TunedAgent, index: number | null, params: RuleParams, brakeEnabled: boolean): TuningEpisode => {
    const { episode, orderedProgress } = evaluateDriver(createRuleBasedDriver(params, { brakeEnabled }), setup);
    const first = episode.lapTicks[0];
    return {
      agent,
      index,
      params,
      outcome: episode.outcome ?? 'unfinished',
      crashed: episode.crashed,
      gatesPassed: episode.gatesPassed,
      lapsCompleted: episode.lapTicks.length,
      firstLapTicks: first === undefined ? null : first,
      orderedProgress,
      ticks: episode.tick,
    };
  };
  const a3 = variantsOf(grid, true).map((params, index) => run('A3', index, params, true));
  const nb = variantsOf(grid, false).map((params, index) => run('A3-nb', index, params, false));
  const bestA3 = selectBest(a3);
  const bestNb = selectBest(nb);
  const same = run('A3-nb-same', null, bestA3.params, false);
  const episodes = [...a3, ...nb, same];
  return {
    format: RULE_TUNING_FORMAT,
    version: RULE_TUNING_VERSION,
    id: 'p5-01-rule-tuning',
    description: 'P5-01 step 3: training-track-only tuning of the rule-based driver A3 and A3-nb (plan §3 and §4). A baseline is being fixed; this is not a learning result and no validation or held-out track is used.',
    preregisteredGrid: canonicalJson(grid) === canonicalJson(TUNING_GRID),
    grid: { steerGain: [...grid.steerGain], frontClear: [...grid.frontClear], speedCap: [...grid.speedCap], brakeFront: [...grid.brakeFront], brakeSpeed: [...grid.brakeSpeed] },
    selectionRule: RULE_SELECTION,
    algorithm: RULE_BASED_ALGORITHM,
    rules: { maxEpisodeSeconds: setup.config.maxEpisodeSeconds, stallSeconds: setup.config.stallSeconds, maxLaps: setup.config.maxLaps, fitnessVersion: setup.versions.fitnessVersion, timestepSeconds },
    physics: DEFAULT_VEHICLE_PHYSICS,
    track: { split: 'training', id: track.id, version: track.version, contentHash: trackContentHash(track) },
    engine: options.engine,
    source: options.source,
    episodes,
    selected: { A3: { index: bestA3.index!, params: bestA3.params }, 'A3-nb': { index: bestNb.index!, params: bestNb.params } },
    resultsHash: hashOf(episodes),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The report and the files.

const fmt = (p: RuleParams, brake: boolean): string =>
  `steerGain ${p.steerGain}, frontClear ${p.frontClear}, speedCap ${p.speedCap}${brake ? `, brakeFront ${p.brakeFront}, brakeSpeed ${p.brakeSpeed}` : ''}`;
const ticksText = (t: number | null): string => (t === null ? 'none' : `${t} (${(t * DEFAULT_SIM_CONFIG.timestepSeconds).toFixed(3)} s)`);

/** The report for a record, as Markdown. Deterministic: the same record gives the same text. */
export function tuningReport(record: TuningRecord): string {
  const row = (agent: TunedAgent): TuningEpisode => record.episodes.find((e) => e.agent === agent && (agent === 'A3-nb-same' || e.index === record.selected[agent].index))!;
  const lines: string[] = [
    '# P5-01 step 3: tuning the rule-based driver on the training track',
    '',
    '**A baseline is being fixed; this is not a learning result.** Candidates were scored on the training track only (`' + record.track.id + '`), through the shared episode path with the trainer\'s own episode rules. No validation or held-out track was used, and none was needed to choose anything.',
    '',
    `Plan: \`docs/plans/p5-01-plan.md\` §3 and §4. Algorithm \`${record.algorithm}\`. Selection rule \`${record.selectionRule}\`: most ordered checkpoints, then most laps, then fastest first lap, then lowest grid index. Predeclared grid: ${record.preregisteredGrid ? 'yes (exactly the committed `TUNING_GRID`)' : '**no** (a test grid)'}.`,
    '',
    `Results hash: \`${record.resultsHash}\``,
    '',
    '## Selected constants',
    '',
    '| Agent | Constants | Outcome | Checkpoints | Laps | First lap (ticks) |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const agent of ['A3', 'A3-nb', 'A3-nb-same'] as const) {
    const e = row(agent);
    lines.push(`| ${agent} | ${fmt(e.params, agent !== 'A3-nb')} | ${e.outcome} | ${e.gatesPassed} | ${e.lapsCompleted} | ${ticksText(e.firstLapTicks)} |`);
  }
  lines.push('', '**A3-nb-same** is A3\'s selected constants with only the brake masked; it is derived, not tuned, and is the only brake ablation (plan §3). A3-nb was tuned separately over the same grid, so the tuned pair compares two tuned rules.', '');
  for (const agent of ['A3', 'A3-nb'] as const) {
    const all = record.episodes.filter((e) => e.agent === agent);
    const outcomes: Record<string, number> = {};
    for (const e of all) outcomes[e.outcome] = (outcomes[e.outcome] ?? 0) + 1;
    const lapped = all.filter((e) => e.lapsCompleted >= 1).length;
    lines.push(`## ${agent}: ${all.length} variants`, '', `Outcomes: ${Object.entries(outcomes).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k} ${v}`).join(', ')}. Completed at least one lap: ${lapped}/${all.length}.`, '');
  }
  lines.push(
    '## Limitations',
    '',
    '- Hand tuning on a single training circuit may not transfer to other circuits; that is what E3 later asks, and nothing here predicts it.',
    '- A finite predeclared grid: the selected constants are the best of this grid, not the best possible rule.',
    '- Episodes are deterministic, so there are no seeds and no uncertainty estimate; the table is the whole result.',
    '',
  );
  return lines.join('\n');
}

/** The two files the tuning command writes, as `{ name, text }`. Deterministic for a given record. */
export function tuningFiles(record: TuningRecord): readonly { readonly name: string; readonly text: string }[] {
  return [
    { name: 'p5-01-tuning.json', text: `${JSON.stringify(record, null, 2)}\n` },
    { name: 'p5-01-tuning.md', text: tuningReport(record) },
  ];
}
