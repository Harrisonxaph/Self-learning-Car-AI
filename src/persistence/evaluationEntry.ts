// The evaluation entry (P4-05, docs/plans/p4-05-plan.md): what a model's `evaluation` array holds for this app's own
// evaluations, and how entries are recognised. Pure: no storage, no simulation.
//
// An entry is RECOGNISED when its `kind` is exactly EVALUATION_KIND and it passes validateEvaluationEntry. Everything else in
// the array (entries of other kinds, and entries that claim this kind but fail validation) is opaque: kept untouched, never
// counted and never shown as a result. The array itself is never validated beyond "is an array" (as before), so no existing
// model file is ever rejected, truncated or rewritten because of what it holds.
import { sha256Hex } from '../utils/sha256';

export const EVALUATION_KIND = 'p4-05-evaluation-v1';
export const EVALUATION_PROTOCOL = 'p4-05-evaluation-v1';
/** At most this many RECOGNISED entries per model; enforced only when appending. */
export const MAX_EVALUATION_ENTRIES = 50;
export const EVALUATION_OUTCOMES = Object.freeze(['completed', 'crashed', 'stalled', 'timeout'] as const);
export type EvaluationOutcome = (typeof EVALUATION_OUTCOMES)[number];
export const EVALUATION_SPLITS = Object.freeze(['training', 'validation'] as const);
export type EvaluationSplit = (typeof EVALUATION_SPLITS)[number];

export interface EvaluationRow {
  /** 0 is the circuit's nominal start; 1 to 4 are the recorded perturbed starts. */
  readonly seed: number;
  readonly outcome: EvaluationOutcome;
  readonly ticks: number;
  readonly gatesPassed: number;
  readonly gates: number;
  readonly laps: number;
  /** Ordered gate credits ÷ gates per lap. */
  readonly orderedProgress: number;
  readonly firstLapTicks: number | null;
  readonly firstLapSeconds: number | null;
}

export interface EvaluationSummary {
  readonly episodes: number;
  /** Episodes that completed at least one full lap ÷ episodes. */
  readonly lapCompletion: number;
  /** Episodes ending in a wall collision ÷ episodes. */
  readonly collisionRate: number;
  readonly outcomes: Readonly<Record<EvaluationOutcome, number>>;
  readonly meanOrderedProgress: number;
  /** Mean simulated seconds of each episode's FIRST completed lap, or null when no lap completed (never zero). */
  readonly meanFirstLapSeconds: number | null;
  /** How many episodes completed a lap: the sample size of the lap time (0 when it is null). */
  readonly firstLapSamples: number;
}

export interface EvaluationStart {
  readonly seed: number;
  /** Offset from the nominal start, metres to the left (negative: right) of its heading. */
  readonly lateralMetres: number;
  /** Heading offset from the nominal start, radians. */
  readonly headingRadians: number;
  readonly x: number;
  readonly y: number;
  readonly heading: number;
}

export interface EvaluationEntry {
  readonly kind: typeof EVALUATION_KIND;
  readonly protocol: typeof EVALUATION_PROTOCOL;
  readonly configHash: string;
  readonly config: { readonly maxEpisodeSeconds: number; readonly stallSeconds: number; readonly maxLaps: number };
  readonly fitnessVersion: number;
  readonly timestepSeconds: number;
  /** The saved model's own id, and the frozen identity (freezeModel's hash) of its parameters. */
  readonly modelId: string;
  readonly frozenModelId: string;
  readonly brakeEnabled: boolean;
  readonly track: { readonly id: string; readonly version: string; readonly split: EvaluationSplit; readonly contentHash: string };
  readonly starts: readonly EvaluationStart[];
  readonly rows: readonly EvaluationRow[];
  readonly summary: EvaluationSummary;
  readonly recordedAt: string;
  readonly appVersion: string;
  readonly codeVersion: string;
  readonly runtime: string;
}

/** The configuration hash recorded with every entry. */
export function evaluationConfigHash(config: EvaluationEntry['config'], fitnessVersion: number, timestepSeconds: number): string {
  return `sha256:${sha256Hex(JSON.stringify({ protocol: EVALUATION_PROTOCOL, config, fitnessVersion, timestepSeconds }))}`;
}

/** The summary of rows: every denominator is the number of episodes, so timeouts and stalls stay in them. */
export function summariseRows(rows: readonly EvaluationRow[]): EvaluationSummary {
  const n = rows.length;
  const outcomes: Record<EvaluationOutcome, number> = { completed: 0, crashed: 0, stalled: 0, timeout: 0 };
  let progress = 0;
  let lapSeconds = 0;
  let samples = 0;
  let withLap = 0;
  for (const row of rows) {
    outcomes[row.outcome] += 1;
    progress += row.orderedProgress;
    if (row.laps >= 1) withLap += 1;
    if (row.firstLapSeconds !== null) {
      lapSeconds += row.firstLapSeconds;
      samples += 1;
    }
  }
  return Object.freeze({
    episodes: n,
    lapCompletion: n === 0 ? 0 : withLap / n,
    collisionRate: n === 0 ? 0 : outcomes.crashed / n,
    outcomes: Object.freeze(outcomes),
    meanOrderedProgress: n === 0 ? 0 : progress / n,
    meanFirstLapSeconds: samples === 0 ? null : lapSeconds / samples,
    firstLapSamples: samples,
  });
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown, low = 0): v is number => typeof v === 'number' && Number.isInteger(v) && v >= low;
const isStr = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const HASH = /^sha256:[0-9a-f]{64}$/;

export type EntryValidation = { readonly ok: true; readonly entry: EvaluationEntry } | { readonly ok: false; readonly errors: readonly string[] };

/**
 * Strict validation of one entry: every field, finite numbers, whole counts, outcomes from the list, a split that is
 * training or validation (never held-out), one row per recorded start in order, and a summary equal to the one recomputed
 * from the rows. `registry` (optional) also checks the circuit's recorded version and content hash against the built-in
 * tracks. Never throws.
 */
export function validateEvaluationEntry(
  value: unknown,
  registry?: readonly { readonly id: string; readonly version: string; readonly split: string; readonly contentHash: string }[],
): EntryValidation {
  const errors: string[] = [];
  const fail = (message: string): void => {
    if (errors.length < 8) errors.push(message);
  };
  try {
    if (!isObject(value)) return { ok: false, errors: ['The entry must be an object.'] };
    if (value.kind !== EVALUATION_KIND) fail(`"kind" must be "${EVALUATION_KIND}".`);
    if (value.protocol !== EVALUATION_PROTOCOL) fail(`"protocol" must be "${EVALUATION_PROTOCOL}".`);
    const config = isObject(value.config) ? value.config : null;
    if (config === null || !isNum(config.maxEpisodeSeconds) || config.maxEpisodeSeconds <= 0 || !isNum(config.stallSeconds) || config.stallSeconds <= 0 || !isInt(config.maxLaps, 1)) {
      fail('"config" must give positive maxEpisodeSeconds and stallSeconds and a whole maxLaps of at least 1.');
    }
    if (!isInt(value.fitnessVersion, 1)) fail('"fitnessVersion" must be a whole number.');
    if (!isNum(value.timestepSeconds) || value.timestepSeconds <= 0 || value.timestepSeconds > 0.1) fail('"timestepSeconds" must be a number above 0 and at most 0.1.');
    if (typeof value.configHash !== 'string' || !HASH.test(value.configHash)) fail('"configHash" must be a sha256 hash.');
    else if (config !== null && isNum(value.timestepSeconds) && isInt(value.fitnessVersion, 1) && value.configHash !== evaluationConfigHash(config as EvaluationEntry['config'], value.fitnessVersion, value.timestepSeconds)) {
      fail('"configHash" does not match the recorded configuration.');
    }
    if (!isStr(value.modelId, 64)) fail('"modelId" must be a short string.');
    if (typeof value.frozenModelId !== 'string' || !HASH.test(value.frozenModelId)) fail('"frozenModelId" must be a sha256 hash.');
    if (typeof value.brakeEnabled !== 'boolean') fail('"brakeEnabled" must be true or false.');
    const track = isObject(value.track) ? value.track : null;
    if (track === null || !isStr(track.id, 64) || !isStr(track.version, 64) || typeof track.contentHash !== 'string' || !HASH.test(track.contentHash)) {
      fail('"track" must give an id, a version and a content hash.');
    } else if (!(EVALUATION_SPLITS as readonly unknown[]).includes(track.split)) {
      fail('"track.split" must be "training" or "validation": a held-out circuit is never evaluated here.');
    } else if (registry !== undefined) {
      const known = registry.find((t) => t.id === track.id);
      if (!known) fail(`"track.id" ${String(track.id)} is not a built-in circuit.`);
      else if (known.version !== track.version || known.contentHash !== track.contentHash || known.split !== track.split) fail('"track" does not match the built-in circuit it names.');
    }
    const starts = Array.isArray(value.starts) ? value.starts : null;
    const rows = Array.isArray(value.rows) ? value.rows : null;
    if (starts === null || rows === null || starts.length === 0 || starts.length > 20 || rows.length !== starts.length) {
      fail('"starts" and "rows" must be arrays of the same length (1 to 20).');
    } else {
      starts.forEach((s, i) => {
        if (!isObject(s) || s.seed !== i || !isNum(s.lateralMetres) || !isNum(s.headingRadians) || !isNum(s.x) || !isNum(s.y) || !isNum(s.heading)) fail(`starts[${i}] must have seed ${i} and finite offsets and pose.`);
      });
      rows.forEach((r, i) => {
        if (
          !isObject(r) ||
          r.seed !== i ||
          !(EVALUATION_OUTCOMES as readonly unknown[]).includes(r.outcome) ||
          !isInt(r.ticks) ||
          !isInt(r.gatesPassed) ||
          !isInt(r.gates, 1) ||
          !isInt(r.laps) ||
          !isNum(r.orderedProgress) ||
          !(r.firstLapTicks === null || isInt(r.firstLapTicks, 1)) ||
          !(r.firstLapSeconds === null || (isNum(r.firstLapSeconds) && r.firstLapSeconds > 0)) ||
          (r.firstLapTicks === null) !== (r.firstLapSeconds === null) ||
          (r.laps >= 1) !== (r.firstLapTicks !== null) ||
          r.orderedProgress !== r.gatesPassed / (r.gates as number)
        ) {
          fail(`rows[${i}] is not a valid row (outcome, whole counts, progress = gates ÷ gates per lap, and a first-lap time only when a lap completed).`);
        }
      });
      if (errors.length === 0) {
        const recomputed = summariseRows(rows as EvaluationRow[]);
        if (JSON.stringify(recomputed) !== JSON.stringify(value.summary)) fail('"summary" does not match the rows.');
      }
    }
    for (const key of ['recordedAt', 'appVersion', 'codeVersion', 'runtime'] as const) if (!isStr(value[key], 300)) fail(`"${key}" must be a short string.`);
    if (errors.length > 0) return { ok: false, errors };
    return { ok: true, entry: value as unknown as EvaluationEntry };
  } catch {
    return { ok: false, errors: ['The entry could not be checked.'] };
  }
}

export interface RecognisedEvaluations {
  readonly entries: readonly EvaluationEntry[];
  /** Entries that claim this app's kind but failed validation: kept untouched, uncounted, never shown as results. */
  readonly invalidClaims: number;
  /** Everything else, including other kinds. */
  readonly opaque: number;
}

/** Splits an `evaluation` array into recognised entries and the rest. The array is never changed. */
export function recogniseEvaluations(evaluation: readonly unknown[]): RecognisedEvaluations {
  const entries: EvaluationEntry[] = [];
  let invalidClaims = 0;
  let opaque = 0;
  for (const item of evaluation) {
    if (isObject(item) && item.kind === EVALUATION_KIND) {
      const checked = validateEvaluationEntry(item);
      if (checked.ok) entries.push(checked.entry);
      else {
        invalidClaims += 1;
        opaque += 1;
      }
    } else opaque += 1;
  }
  return { entries, invalidClaims, opaque };
}
