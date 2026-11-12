// The evaluation entry (P4-05, docs/plans/p4-05-plan.md): what a model's `evaluation` array holds for this app's own
// evaluations, and how entries are recognised. Pure: no storage, no simulation.
//
// An entry is RECOGNISED when its `kind` is exactly EVALUATION_KIND and it passes validateEvaluationEntry. Everything else in
// the array (entries of other kinds, and entries that claim this kind but fail validation) is opaque: kept untouched, never
// counted and never shown as a result. The array itself is never validated beyond "is an array" (as before), so no existing
// model file is ever rejected, truncated or rewritten because of what it holds.
import { createRng } from '../utils/rng';
import { sha256Hex } from '../utils/sha256';
import { MODEL_ID_PATTERN } from './modelFormat';

export const EVALUATION_KIND = 'p4-05-evaluation-v1';
export const EVALUATION_PROTOCOL = 'p4-05-evaluation-v1';
/** At most this many RECOGNISED entries per model; enforced only when appending. */
export const MAX_EVALUATION_ENTRIES = 50;
export const EVALUATION_OUTCOMES = Object.freeze(['completed', 'crashed', 'stalled', 'timeout'] as const);
export type EvaluationOutcome = (typeof EVALUATION_OUTCOMES)[number];
/** `custom` is a layout a person drew or imported (P4-03): it is in no built-in split, and it is never held-out. */
export const EVALUATION_SPLITS = Object.freeze(['training', 'validation', 'custom'] as const);
export type EvaluationSplit = (typeof EVALUATION_SPLITS)[number];

/** The protocol's fixed limits (p4-05-evaluation-v1): the trainer's own episode defaults, and the fitness version it scores under. */
export const PROTOCOL_LIMITS = Object.freeze({ maxEpisodeSeconds: 60, stallSeconds: 5, maxLaps: 3, fitnessVersion: 1 });
/** The fixed perturbed-start seeds; seed 0 is the nominal start. */
export const EVALUATION_SEEDS: readonly number[] = Object.freeze([1, 2, 3, 4]);
/** The largest start offsets: 1.0 m sideways and 3 degrees of heading. */
export const START_BOUNDS = Object.freeze({ lateralMetres: 1.0, headingRadians: (3 * Math.PI) / 180 });
/** Numeric slack when comparing recorded poses and times that came from floating-point arithmetic. */
const EPSILON = 1e-6;

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

/** The start of seed `seed` for a nominal start pose: the nominal start for 0, otherwise a bounded offset from the seeded RNG. */
export function evaluationStartFor(nominal: { readonly position: { readonly x: number; readonly y: number }; readonly heading: number }, seed: number): EvaluationStart {
  const { position, heading } = nominal;
  if (seed === 0) return { seed, lateralMetres: 0, headingRadians: 0, x: position.x, y: position.y, heading };
  const rng = createRng(seed);
  const lateral = Math.round(rng.range(-START_BOUNDS.lateralMetres, START_BOUNDS.lateralMetres) * 1000) / 1000;
  const turn = Math.round(rng.range(-START_BOUNDS.headingRadians, START_BOUNDS.headingRadians) * 1e6) / 1e6;
  // To the left of the heading on the y-down screen is (sin h, -cos h).
  return { seed, lateralMetres: lateral, headingRadians: turn, x: position.x + Math.sin(heading) * lateral, y: position.y - Math.cos(heading) * lateral, heading: heading + turn };
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
  // A fixed field order, so the hash does not depend on the key order of the JSON the entry came from.
  return `sha256:${sha256Hex(JSON.stringify([EVALUATION_PROTOCOL, config.maxEpisodeSeconds, config.stallSeconds, config.maxLaps, fitnessVersion, timestepSeconds]))}`;
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

/** A built-in circuit an entry may name. `track` (when given) lets the validator check the recorded starts and the gate count. */
export interface RegistryTrack {
  readonly id: string;
  readonly version: string;
  readonly split: string;
  readonly contentHash: string;
  readonly track?: { readonly start: { readonly position: { readonly x: number; readonly y: number }; readonly heading: number }; readonly gates: readonly unknown[] };
}

export interface EntryContext {
  /** The allowed circuits (the built-in training and validation circuits). When given, the entry's circuit must be one of them. */
  readonly registry?: readonly RegistryTrack[] | undefined;
  /** Whether the entry belongs to the model that holds it (id, frozen identity, driving configuration): a message when it does not, otherwise null. */
  readonly belongsTo?: ((entry: EvaluationEntry) => string | null) | undefined;
  /**
   * The saved custom track an ID names (P4-03), if one is saved. A `custom` entry whose track is saved with the same version and
   * content hash gets the same start and gate checks as a built-in circuit; an entry that names a saved track but disagrees with it is
   * refused; one whose track is no longer saved is checked structurally only (its recorded starts are still bounds-checked).
   */
  readonly custom?: ((id: string) => RegistryTrack | null | 'unreadable') | undefined;
  /**
   * Every ID a built-in circuit uses, whichever split it is in (IDs only: no geometry, and it makes no circuit evaluable). A `custom`
   * entry may not use one. Separate from `registry`, which lists only the circuits eligible for evaluation (never held-out).
   */
  readonly reservedIds?: readonly string[] | undefined;
}

/** JSON text with object keys in sorted order, so two equal structures compare equal whatever their key order. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    typeof v === 'object' && v !== null && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v,
  );
}

const near = (a: number, b: number, tolerance = EPSILON): boolean => Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b));

/** Whether two summaries are the same, by field, whatever the order of their keys. */
export function summariesEqual(a: unknown, b: EvaluationSummary): boolean {
  if (!isObject(a) || !isObject(a.outcomes)) return false;
  const o = a.outcomes;
  return (
    a.episodes === b.episodes &&
    a.lapCompletion === b.lapCompletion &&
    a.collisionRate === b.collisionRate &&
    a.meanOrderedProgress === b.meanOrderedProgress &&
    a.meanFirstLapSeconds === b.meanFirstLapSeconds &&
    a.firstLapSamples === b.firstLapSamples &&
    o.completed === b.outcomes.completed &&
    o.crashed === b.outcomes.crashed &&
    o.stalled === b.outcomes.stalled &&
    o.timeout === b.outcomes.timeout &&
    Object.keys(o).length === 4 &&
    Object.keys(a).length === 7
  );
}

/**
 * Validates one entry against the recorded protocol: every field; the fixed limits; exactly five starts (seed 0 and seeds 1 to 4),
 * with, when the circuit is given, the exact start poses the protocol derives; rows whose numbers are consistent (ticks within the
 * episode budget, laps and gates, a first-lap time equal to its ticks times the timestep, an outcome that fits its numbers); a
 * summary equal to the one recomputed from the rows (whatever the key order); a split that is training or validation, never
 * held-out; and, when given, the allowed circuit and the model the entry belongs to. It does not re-run the simulation. Never throws.
 */
export function validateEvaluationEntry(value: unknown, context: EntryContext = {}): EntryValidation {
  const errors: string[] = [];
  const fail = (message: string): void => {
    if (errors.length < 8) errors.push(message);
  };
  try {
    if (!isObject(value)) return { ok: false, errors: ['The entry must be an object.'] };
    if (value.kind !== EVALUATION_KIND) fail(`"kind" must be "${EVALUATION_KIND}".`);
    if (value.protocol !== EVALUATION_PROTOCOL) fail(`"protocol" must be "${EVALUATION_PROTOCOL}".`);
    const config = isObject(value.config) ? value.config : null;
    if (config === null || config.maxEpisodeSeconds !== PROTOCOL_LIMITS.maxEpisodeSeconds || config.stallSeconds !== PROTOCOL_LIMITS.stallSeconds || config.maxLaps !== PROTOCOL_LIMITS.maxLaps) {
      fail(`"config" must be the protocol's limits (${PROTOCOL_LIMITS.maxEpisodeSeconds} s episodes, ${PROTOCOL_LIMITS.stallSeconds} s stall, ${PROTOCOL_LIMITS.maxLaps} laps).`);
    }
    if (value.fitnessVersion !== PROTOCOL_LIMITS.fitnessVersion) fail(`"fitnessVersion" must be ${PROTOCOL_LIMITS.fitnessVersion}.`);
    const dt = value.timestepSeconds;
    if (!isNum(dt) || dt <= 0 || dt > 0.1) fail('"timestepSeconds" must be a number above 0 and at most 0.1.');
    if (typeof value.configHash !== 'string' || !HASH.test(value.configHash)) fail('"configHash" must be a sha256 hash.');
    else if (config !== null && isNum(dt) && value.configHash !== evaluationConfigHash(PROTOCOL_LIMITS, PROTOCOL_LIMITS.fitnessVersion, dt)) {
      fail('"configHash" does not match the recorded configuration.');
    }
    if (typeof value.modelId !== 'string' || !MODEL_ID_PATTERN.test(value.modelId)) fail('"modelId" must be a saved champion id (1 to 100 letters, digits, dots, dashes or underscores).');
    if (typeof value.frozenModelId !== 'string' || !HASH.test(value.frozenModelId)) fail('"frozenModelId" must be a sha256 hash.');
    if (typeof value.brakeEnabled !== 'boolean') fail('"brakeEnabled" must be true or false.');
    const track = isObject(value.track) ? value.track : null;
    let known: RegistryTrack | undefined;
    if (track === null || !isStr(track.id, 64) || !isStr(track.version, 64) || typeof track.contentHash !== 'string' || !HASH.test(track.contentHash)) {
      fail('"track" must give an id, a version and a content hash.');
    } else if (!(EVALUATION_SPLITS as readonly unknown[]).includes(track.split)) {
      fail('"track.split" must be "training", "validation" or "custom": a held-out circuit is never evaluated here.');
    } else if (track.split === 'custom') {
      // A custom layout never uses a built-in circuit's ID; when its track is still saved unchanged it is checked like a built-in one.
      if (context.registry?.some((t) => t.id === track.id) || context.reservedIds?.includes(track.id as string)) fail('"track.id" is the ID of a built-in circuit, which a custom layout may not use.');
      else {
        const saved = context.custom?.(track.id as string) ?? null;
        // Something is stored under this ID but cannot be read (damaged, hand-edited, reserved, or storage failed): that is NOT a missing track.
        // The claim is refused, never downgraded to the structural check meant for a deleted track.
        if (saved === 'unreadable') fail('"track" names a saved custom track that cannot be read, so this result cannot be verified.');
        else if (saved !== null) {
          // While a track is saved under this ID the entry must be for exactly that track; once it is deleted the entry is checked structurally.
          if (saved.version !== track.version || saved.contentHash !== track.contentHash) fail('"track" does not match the saved custom track it names.');
          else known = saved;
        }
      }
    } else if (context.registry !== undefined) {
      known = context.registry.find((t) => t.id === track.id);
      if (!known) fail(`"track.id" ${String(track.id)} is not a built-in training or validation circuit.`);
      else if (known.version !== track.version || known.contentHash !== track.contentHash || known.split !== track.split) fail('"track" does not match the built-in circuit it names.');
    }
    const starts = Array.isArray(value.starts) ? value.starts : null;
    const rows = Array.isArray(value.rows) ? value.rows : null;
    const wanted = 1 + EVALUATION_SEEDS.length;
    if (starts === null || rows === null || starts.length !== wanted || rows.length !== wanted) {
      fail(`"starts" and "rows" must each hold exactly ${wanted} items (the nominal start and seeds ${EVALUATION_SEEDS.join(', ')}).`);
    } else {
      const maxTicks = isNum(dt) && dt > 0 ? Math.max(1, Math.ceil(PROTOCOL_LIMITS.maxEpisodeSeconds / dt - 1e-9)) : Number.MAX_SAFE_INTEGER;
      const minStallTicks = isNum(dt) && dt > 0 ? Math.max(1, Math.ceil(PROTOCOL_LIMITS.stallSeconds / dt - 1e-9)) : Number.MAX_SAFE_INTEGER;
      starts.forEach((s, i) => {
        if (!isObject(s) || s.seed !== i || !isNum(s.lateralMetres) || !isNum(s.headingRadians) || !isNum(s.x) || !isNum(s.y) || !isNum(s.heading)) {
          fail(`starts[${i}] must have seed ${i} and finite offsets and pose.`);
          return;
        }
        if (Math.abs(s.lateralMetres) > START_BOUNDS.lateralMetres + EPSILON || Math.abs(s.headingRadians) > START_BOUNDS.headingRadians + EPSILON) fail(`starts[${i}] is outside the protocol's start bounds.`);
        if (i === 0 && (s.lateralMetres !== 0 || s.headingRadians !== 0)) fail('starts[0] must be the nominal start (no offsets).');
        if (known?.track) {
          const want = evaluationStartFor(known.track.start, i);
          if (!near(s.x, want.x) || !near(s.y, want.y) || !near(s.heading, want.heading) || !near(s.lateralMetres, want.lateralMetres) || !near(s.headingRadians, want.headingRadians)) {
            fail(`starts[${i}] is not the start the protocol derives for ${String(track?.id)}.`);
          }
        }
      });
      rows.forEach((r, i) => {
        const bad = (why: string): void => fail(`rows[${i}] is not valid: ${why}.`);
        if (!isObject(r) || r.seed !== i) return bad('it must have the matching seed');
        if (!(EVALUATION_OUTCOMES as readonly unknown[]).includes(r.outcome)) return bad('unknown outcome');
        if (!isInt(r.ticks, 1) || r.ticks > maxTicks) return bad(`ticks must be a whole number from 1 to the ${maxTicks}-tick episode budget`);
        if (!isInt(r.gates, 1) || !isInt(r.gatesPassed) || !isInt(r.laps) || !isNum(r.orderedProgress)) return bad('gates, gatesPassed and laps must be whole numbers');
        const gates = r.gates as number;
        if (known?.track && gates !== known.track.gates.length) return bad('the gate count is not the circuit\'s');
        if ((r.laps as number) > PROTOCOL_LIMITS.maxLaps) return bad(`laps cannot exceed ${PROTOCOL_LIMITS.maxLaps}`);
        if ((r.gatesPassed as number) > gates * PROTOCOL_LIMITS.maxLaps + 1) return bad('more gate credits than the lap limit allows');
        if (r.orderedProgress !== (r.gatesPassed as number) / gates) return bad('progress must be gates passed over gates per lap');
        // The checkpoint convention (sim/checkpoints.ts advanceProgress): the first crossing of the start line only starts lap 1; each later crossing completes a lap, so the lap count is fixed by the credits.
        const credits = r.gatesPassed as number;
        const expectedLaps = credits >= 1 ? Math.floor((credits - 1) / gates) : 0;
        if (r.laps !== expectedLaps) return bad(`${credits} gate credits on a ${gates}-gate circuit mean ${expectedLaps} completed laps, not ${String(r.laps)}`);
        if ((r.laps as number) === 0) {
          if (r.firstLapTicks !== null || r.firstLapSeconds !== null) return bad('a first-lap time is only recorded when a lap completed');
        } else {
          if (!isInt(r.firstLapTicks, 1) || (r.firstLapTicks as number) > (r.ticks as number)) return bad('the first lap cannot take more ticks than the episode');
          if (!isNum(r.firstLapSeconds) || !isNum(dt) || !near(r.firstLapSeconds, (r.firstLapTicks as number) * dt, 1e-9)) return bad('the first-lap seconds must equal its ticks times the timestep');
        }
        // Terminal precedence (training/fitness.ts): the lap limit ends the episode as completed before anything else is considered.
        if ((r.outcome === 'completed') !== (r.laps === PROTOCOL_LIMITS.maxLaps)) return bad(`an episode is completed exactly when it reaches ${PROTOCOL_LIMITS.maxLaps} laps`);
        if (r.outcome === 'stalled' && (r.ticks as number) < minStallTicks) return bad(`a stall needs at least ${minStallTicks} ticks (${PROTOCOL_LIMITS.stallSeconds} s) without a new gate credit`);
        if (r.outcome === 'timeout' && r.ticks !== maxTicks) return bad('a timeout uses the whole episode budget');
      });
      if (errors.length === 0 && !summariesEqual(value.summary, summariseRows(rows as EvaluationRow[]))) fail('"summary" does not match the rows.');
    }
    for (const key of ['recordedAt', 'appVersion', 'codeVersion', 'runtime'] as const) if (!isStr(value[key], 300)) fail(`"${key}" must be a short string.`);
    if (errors.length > 0) return { ok: false, errors };
    const entry = value as unknown as EvaluationEntry;
    const mismatch = context.belongsTo?.(entry) ?? null;
    if (mismatch !== null) return { ok: false, errors: [mismatch] };
    return { ok: true, entry };
  } catch {
    return { ok: false, errors: ['The entry could not be checked.'] };
  }
}

export interface RecognisedEvaluations {
  readonly entries: readonly EvaluationEntry[];
  /** Entries that claim this app's kind but failed validation (or belong to another model): kept untouched, uncounted, never shown as results. */
  readonly invalidClaims: number;
  /** Everything else, including other kinds and the invalid claims. */
  readonly opaque: number;
}

/** Splits an `evaluation` array into recognised entries and the rest. The array is never changed. */
export function recogniseEvaluations(evaluation: readonly unknown[], context: EntryContext = {}): RecognisedEvaluations {
  const entries: EvaluationEntry[] = [];
  let invalidClaims = 0;
  let opaque = 0;
  for (const item of evaluation) {
    if (isObject(item) && item.kind === EVALUATION_KIND) {
      const checked = validateEvaluationEntry(item, context);
      if (checked.ok) entries.push(checked.entry);
      else {
        invalidClaims += 1;
        opaque += 1;
      }
    } else opaque += 1;
  }
  return { entries, invalidClaims, opaque };
}
