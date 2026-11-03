// The P2-09 braking feasibility check (docs/experiments/p2-09-plan.md §4, A2): does a scripted driver gain from
// braking on the built-in non-held-out tracks? A fixed, predeclared grid of gate-pursuit driver variants (ai/gatePursuitDriver.ts)
// runs once each in 'brake' and 'coast' mode on the training and validation tracks, through the shared episode path
// (evaluateDriver) with the trainer's own episode rules. Episodes are deterministic, so there are no seeds.
//
// This is physical feasibility only. It is NOT evidence that a network learns to brake (that is E4 here and E5 later).
// Tracks come only from trainingTrack and validationTrack, and createEvaluationSetup refuses a held-out track, so
// held-out data cannot enter. The grid and the usefulness rule below are fixed in the plan and are never changed
// after a result has been seen.
import { BRAKE_MODES, createGatePursuitDriver, GATE_PURSUIT_ALGORITHM, OVERSPEED_MARGIN, STEER_LOOK_AHEAD_METERS, type BrakeMode } from '../ai/gatePursuitDriver';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../sim/config';
import { sha256Hex } from '../utils/sha256';
import { createEvaluationSetup, evaluateDriver } from './evaluation';
import { canonicalJson } from './experiment';
import { trackContentHash, trainingTrack, validationTrack } from './trackSplits';

export const FEASIBILITY_FORMAT = 'self-driving-ai-evolution/p2-09-feasibility';
export const FEASIBILITY_VERSION = 1;
/** The two tracks the check uses: never a held-out track. */
export const FEASIBILITY_TRACKS = Object.freeze({ training: 'stadium-oval', validation: 'rounded-rectangle' });

export interface FeasibilityGrid {
  readonly aLat: readonly number[];
  readonly lookAheadMeters: readonly number[];
  readonly vTop: readonly number[];
}

/** The predeclared grid (plan §4): 5 × 4 × 3 = 60 variants per mode per track. */
export const FEASIBILITY_GRID: FeasibilityGrid = Object.freeze({
  aLat: Object.freeze([4, 5, 6, 7, 8]),
  lookAheadMeters: Object.freeze([10, 20, 30, 40]),
  vTop: Object.freeze([16, 20, 23.7]),
});

/** Braking counts as useful on a track if the best BRAKE lap is faster than the best COAST lap by at least this. */
export const USEFUL_MARGIN = Object.freeze({ seconds: 0.5, fraction: 0.02 });
const EPSILON = 1e-9;

export interface FeasibilityEpisode {
  readonly split: 'training' | 'validation';
  readonly trackId: string;
  readonly mode: BrakeMode;
  readonly aLat: number;
  readonly lookAheadMeters: number;
  readonly vTop: number;
  readonly outcome: string;
  readonly crashed: boolean;
  /** Laps completed. A lap is credited only on a move the collision check accepted, so a completed lap is crash-free. */
  readonly lapsCompleted: number;
  /** Simulated seconds of the first completed lap, or null if no lap was completed. */
  readonly firstLapSeconds: number | null;
  readonly orderedProgress: number;
  readonly gatesPassed: number;
  readonly ticks: number;
}

export interface FeasibilityRecord {
  readonly format: typeof FEASIBILITY_FORMAT;
  readonly version: typeof FEASIBILITY_VERSION;
  readonly id: 'p2-09-feasibility';
  readonly description: string;
  /** True only when the grid is exactly FEASIBILITY_GRID. A different grid is for tests and is not the check. */
  readonly preregisteredGrid: boolean;
  readonly grid: FeasibilityGrid;
  readonly driver: { readonly algorithm: string; readonly steerLookAheadMeters: number; readonly overspeedMarginMetersPerSecond: number; readonly modes: readonly BrakeMode[] };
  readonly rules: { readonly maxEpisodeSeconds: number; readonly stallSeconds: number; readonly maxLaps: number; readonly fitnessVersion: number; readonly timestepSeconds: number };
  readonly physics: typeof DEFAULT_VEHICLE_PHYSICS;
  readonly tracks: readonly { readonly split: 'training' | 'validation'; readonly id: string; readonly version: string; readonly contentHash: string }[];
  readonly engine: Readonly<Record<string, unknown>>;
  readonly source: Readonly<Record<string, unknown>>;
  readonly episodes: readonly FeasibilityEpisode[];
  /** SHA-256 of the canonical JSON of `episodes`: the same in any engine and at any commit that gives the same results. */
  readonly resultsHash: string;
}

const hashOf = (value: unknown): string => `sha256:${sha256Hex(canonicalJson(value))}`;

function checkGrid(grid: FeasibilityGrid): void {
  for (const key of ['aLat', 'lookAheadMeters', 'vTop'] as const) {
    const values = grid[key];
    if (!Array.isArray(values) || values.length === 0) throw new RangeError(`Feasibility grid "${key}" needs at least one value.`);
    for (const value of values) if (typeof value !== 'number' || !Number.isFinite(value) || !(value > 0)) throw new RangeError(`Feasibility grid "${key}" values must be finite numbers greater than 0, got ${String(value)}.`);
  }
}

export interface FeasibilityOptions {
  readonly engine: Readonly<Record<string, unknown>>;
  readonly source: Readonly<Record<string, unknown>>;
  /** For tests only: a smaller grid. The record then says `preregisteredGrid: false`. The command line never sets it. */
  readonly grid?: FeasibilityGrid;
}

/**
 * Runs every variant once in each mode on both tracks, in a fixed order (track, mode, aLat, lookAheadMeters, vTop), and
 * returns the complete record. Deterministic: the same code gives the same `episodes` and `resultsHash`.
 */
export function runFeasibility(options: FeasibilityOptions): FeasibilityRecord {
  const grid = options.grid ?? FEASIBILITY_GRID;
  checkGrid(grid);
  const timestepSeconds = DEFAULT_SIM_CONFIG.timestepSeconds;
  const tracks = [
    { split: 'training' as const, track: trainingTrack(FEASIBILITY_TRACKS.training) },
    { split: 'validation' as const, track: validationTrack(FEASIBILITY_TRACKS.validation) },
  ];
  const episodes: FeasibilityEpisode[] = [];
  let rules: FeasibilityRecord['rules'] | null = null;
  for (const { split, track } of tracks) {
    // The trainer's own episode limits and fitness version 1; createEvaluationSetup refuses a held-out track.
    const setup = createEvaluationSetup({}, { track, physics: DEFAULT_VEHICLE_PHYSICS, timestepSeconds });
    rules ??= { maxEpisodeSeconds: setup.config.maxEpisodeSeconds, stallSeconds: setup.config.stallSeconds, maxLaps: setup.config.maxLaps, fitnessVersion: setup.versions.fitnessVersion, timestepSeconds };
    for (const mode of BRAKE_MODES) {
      for (const aLat of grid.aLat) {
        for (const lookAheadMeters of grid.lookAheadMeters) {
          for (const vTop of grid.vTop) {
            const driver = createGatePursuitDriver(track, DEFAULT_VEHICLE_PHYSICS, { mode, aLat, lookAheadMeters, vTop });
            const { episode, orderedProgress } = evaluateDriver(driver, setup);
            const first = episode.lapTicks[0];
            episodes.push({
              split,
              trackId: track.id,
              mode,
              aLat,
              lookAheadMeters,
              vTop,
              outcome: episode.outcome ?? 'unfinished',
              crashed: episode.crashed,
              lapsCompleted: episode.lapTicks.length,
              firstLapSeconds: first === undefined ? null : first * timestepSeconds,
              orderedProgress,
              gatesPassed: episode.gatesPassed,
              ticks: episode.tick,
            });
          }
        }
      }
    }
  }
  const preregisteredGrid = canonicalJson(grid) === canonicalJson(FEASIBILITY_GRID);
  return {
    format: FEASIBILITY_FORMAT,
    version: FEASIBILITY_VERSION,
    id: 'p2-09-feasibility',
    description: 'P2-09 braking versus coasting feasibility check with a scripted gate-pursuit driver (plan §4). Physical feasibility only; not evidence of learned braking.',
    preregisteredGrid,
    grid: { aLat: [...grid.aLat], lookAheadMeters: [...grid.lookAheadMeters], vTop: [...grid.vTop] },
    driver: { algorithm: GATE_PURSUIT_ALGORITHM, steerLookAheadMeters: STEER_LOOK_AHEAD_METERS, overspeedMarginMetersPerSecond: OVERSPEED_MARGIN, modes: [...BRAKE_MODES] },
    rules: rules!,
    physics: DEFAULT_VEHICLE_PHYSICS,
    tracks: tracks.map(({ split, track }) => ({ split, id: track.id, version: track.version, contentHash: trackContentHash(track) })),
    engine: options.engine,
    source: options.source,
    episodes,
    resultsHash: hashOf(episodes),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The decision (plan §4), computed from the episodes alone.

export interface ModeSummary {
  readonly variants: number;
  /** Variants that completed at least one lap (such a lap is crash-free). */
  readonly crashFree: number;
  readonly outcomes: Readonly<Record<string, number>>;
  /** The fastest crash-free first lap, or null if there is none. The earliest variant wins a tie. */
  readonly best: { readonly seconds: number; readonly aLat: number; readonly lookAheadMeters: number; readonly vTop: number } | null;
}

export interface TrackDecision {
  readonly split: 'training' | 'validation';
  readonly trackId: string;
  readonly brake: ModeSummary;
  readonly coast: ModeSummary;
  /** Which rule showed that braking is useful: (i) only BRAKE completes a lap, (ii) BRAKE is faster by the margin, or neither. */
  readonly rule: 'i' | 'ii' | null;
  readonly useful: boolean;
  /** For rule (ii): t(C*) − t(B*), and the margin it had to reach. Null when both modes do not have a lap. */
  readonly gainSeconds: number | null;
  readonly requiredSeconds: number | null;
}

function summarise(episodes: readonly FeasibilityEpisode[]): ModeSummary {
  const outcomes: Record<string, number> = {};
  let best: ModeSummary['best'] = null;
  let crashFree = 0;
  for (const e of episodes) {
    outcomes[e.outcome] = (outcomes[e.outcome] ?? 0) + 1;
    if (e.lapsCompleted >= 1 && e.firstLapSeconds !== null) {
      crashFree += 1;
      if (best === null || e.firstLapSeconds < best.seconds) best = { seconds: e.firstLapSeconds, aLat: e.aLat, lookAheadMeters: e.lookAheadMeters, vTop: e.vTop };
    }
  }
  const sorted = Object.fromEntries(Object.entries(outcomes).sort(([a], [b]) => (a < b ? -1 : 1)));
  return { variants: episodes.length, crashFree, outcomes: sorted, best };
}

/** Applies the plan's usefulness rule to the episodes of one track. */
export function decideTrack(episodes: readonly FeasibilityEpisode[]): TrackDecision {
  const first = episodes[0];
  if (first === undefined) throw new RangeError('A track decision needs at least one episode.');
  const brake = summarise(episodes.filter((e) => e.mode === 'brake'));
  const coast = summarise(episodes.filter((e) => e.mode === 'coast'));
  let rule: TrackDecision['rule'] = null;
  let gainSeconds: number | null = null;
  let requiredSeconds: number | null = null;
  if (brake.best !== null && coast.best !== null) {
    gainSeconds = coast.best.seconds - brake.best.seconds;
    requiredSeconds = Math.max(USEFUL_MARGIN.seconds, USEFUL_MARGIN.fraction * coast.best.seconds);
    if (gainSeconds + EPSILON >= requiredSeconds) rule = 'ii';
  } else if (brake.best !== null && coast.best === null) {
    rule = 'i';
  }
  return { split: first.split, trackId: first.trackId, brake, coast, rule, useful: rule !== null, gainSeconds, requiredSeconds };
}

export interface FeasibilityAnalysis {
  readonly tracks: readonly TrackDecision[];
  /** Acceptance A2: braking is useful on at least one of the two tracks. */
  readonly brakingUsefulOnAtLeastOneTrack: boolean;
}

export function analyseFeasibility(record: Pick<FeasibilityRecord, 'episodes'>): FeasibilityAnalysis {
  const order: string[] = [];
  for (const e of record.episodes) if (!order.includes(e.trackId)) order.push(e.trackId);
  const tracks = order.map((id) => decideTrack(record.episodes.filter((e) => e.trackId === id)));
  return { tracks, brakingUsefulOnAtLeastOneTrack: tracks.some((t) => t.useful) };
}

// ---------------------------------------------------------------------------------------------------------------
// The report and the files.

const seconds = (value: number): string => value.toFixed(3);
const share = (n: number, of: number): string => `${n}/${of} (${of === 0 ? '0.0' : ((100 * n) / of).toFixed(1)}%)`;
const params = (b: NonNullable<ModeSummary['best']>): string => `aLat ${b.aLat}, look-ahead ${b.lookAheadMeters} m, vTop ${b.vTop} m/s`;
const outcomeText = (o: Readonly<Record<string, number>>): string => Object.entries(o).map(([k, v]) => `${k} ${v}`).join(', ');

function ruleText(t: TrackDecision): string {
  if (t.rule === 'i') return `**useful, rule (i)**: at least one BRAKE variant completed a crash-free lap and no COAST variant did.`;
  if (t.rule === 'ii') return `**useful, rule (ii)**: the best BRAKE lap is ${seconds(t.gainSeconds!)} s faster than the best COAST lap, and the required margin was ${seconds(t.requiredSeconds!)} s.`;
  if (t.gainSeconds !== null) return `**not shown**: the best BRAKE lap is ${seconds(t.gainSeconds)} s faster than the best COAST lap (negative means slower), and the required margin was ${seconds(t.requiredSeconds!)} s.`;
  return `**not shown**: ${t.brake.best === null && t.coast.best === null ? 'neither mode completed a crash-free lap' : 'COAST completed a crash-free lap and BRAKE did not'}.`;
}

/** The report for a record, as Markdown. Deterministic: the same record gives the same text. */
export function feasibilityReport(record: FeasibilityRecord): string {
  const analysis = analyseFeasibility(record);
  const lines: string[] = [
    '# P2-09 feasibility: braking versus coasting (scripted driver)',
    '',
    '**Physical feasibility only.** This shows whether a scripted gate-pursuit driver gains from braking on the built-in training and validation tracks. It is not evidence that a network learns to brake (that is E4, and E5 on held-out tracks later). No held-out track was used.',
    '',
    `Plan: \`docs/experiments/p2-09-plan.md\` §4. Driver: \`${record.driver.algorithm}\`, steering look-ahead ${record.driver.steerLookAheadMeters} m, brake only when over the speed target by more than ${record.driver.overspeedMarginMetersPerSecond} m/s. The two modes differ only in that brake. Episode rules: ${record.rules.maxEpisodeSeconds} s limit, ${record.rules.stallSeconds} s stall limit, ${record.rules.maxLaps} laps maximum, a collision ends the episode, fitness version ${record.rules.fitnessVersion}, step ${record.rules.timestepSeconds.toFixed(5)} s. Deterministic: no seeds.`,
    '',
    `Grid: aLat ${record.grid.aLat.join(', ')} m/s², look-ahead ${record.grid.lookAheadMeters.join(', ')} m, vTop ${record.grid.vTop.join(', ')} m/s, run once per mode per track (${record.episodes.length} episodes). ${record.preregisteredGrid ? 'This is the predeclared grid.' : '**This is NOT the predeclared grid.**'}`,
    '',
    `Results hash: \`${record.resultsHash}\``,
    '',
  ];
  for (const t of analysis.tracks) {
    lines.push(`## ${t.trackId} (${t.split})`, '');
    lines.push('| Mode | Variants | Crash-free first lap | Fastest crash-free first lap (s) | Its parameters | Outcomes |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const [name, m] of [['BRAKE', t.brake], ['COAST', t.coast]] as const) {
      lines.push(`| ${name} | ${m.variants} | ${share(m.crashFree, m.variants)} | ${m.best === null ? 'none' : seconds(m.best.seconds)} | ${m.best === null ? 'none' : params(m.best)} | ${outcomeText(m.outcomes)} |`);
    }
    lines.push('', `Braking on this track: ${ruleText(t)}`, '');
  }
  lines.push('## Acceptance A2', '');
  lines.push(
    analysis.brakingUsefulOnAtLeastOneTrack
      ? '**Met:** braking is useful, by the predeclared rule, on at least one of the two tracks.'
      : '**Not met:** braking was not shown to be useful on either track. By the plan, the limitation is reported and the work stops for the owner\'s decision. No physics or track change is made, and E4 does not start until the owner decides.',
  );
  lines.push(
    '',
    '## Limitations',
    '',
    '- One hand-written driver family and a finite grid: "not shown" means not shown for this driver, not that braking is useless.',
    '- The crash-free share per mode is descriptive. Only the rule above decides.',
    '- Nothing here is a learning result, and it says nothing about held-out tracks.',
    '',
  );
  return lines.join('\n');
}

/** The two files `npm run feasibility` writes, as `{ name, text }`. Deterministic for a given record. */
export function feasibilityFiles(record: FeasibilityRecord): readonly { readonly name: string; readonly text: string }[] {
  return [
    { name: 'feasibility.json', text: `${JSON.stringify(record, null, 2)}\n` },
    { name: 'feasibility.md', text: feasibilityReport(record) },
  ];
}
