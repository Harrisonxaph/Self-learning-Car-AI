// Built-in track splits (P2-10): which circuits may be used for training, for choosing a model (validation) and
// for the final, frozen-model evaluation (held-out), so held-out data never leaks into training or selection.
// Headless and deterministic. docs/AI_EVALUATION.md §5 describes the protocol; docs/ARCHITECTURE.md "Track splits"
// the contract.
//
// The manifest (src/data/tracks/index.json) lists every built-in track with a stable ID, its content version, its
// split, its file and a content hash: `sha256:` + SHA-256 of JSON.stringify(loadTrack(data)), whose field order is
// fixed by loadTrack. Loading checks the manifest and every file against it, so a track cannot change without its
// hash. A separate geometry hash (boundaries, start and gates only) recognises the same circuit under another ID or
// name, so a track cannot be in two splits under two names, and a renamed copy of a held-out track is still held-out.
//
// The boundaries:
// - training: trainingTrack(), and assertTrainingTrack(), which the trainer applies to every track it is given;
// - selection: validationTrack() and selectByValidation(), which accepts only validation-track scores;
// - held-out: heldOutTrack(), which hands a held-out track only to a frozen model from freezeModel().
import manifestData from '../data/tracks/index.json';
import hairpinChicane from '../data/tracks/hairpin-chicane.json';
import roundedRectangle from '../data/tracks/rounded-rectangle.json';
import stadiumOval from '../data/tracks/stadium-oval.json';
import { loadTrack, type Track } from '../sim/track';
import { sha256Hex } from '../utils/sha256';

export const TRACK_SPLITS_FORMAT = 'self-driving-ai-evolution/track-splits';
export const TRACK_SPLITS_VERSION = 1;
export const SPLITS = Object.freeze(['training', 'validation', 'held-out'] as const);
export type Split = (typeof SPLITS)[number];

/** A malformed or inconsistent manifest or track file. */
export class TrackSplitError extends Error {
  override name = 'TrackSplitError';
}

/** An attempt to use a track outside its split (for example a held-out track for training or selection). */
export class TrackLeakageError extends Error {
  override name = 'TrackLeakageError';
}

/** One built-in track with its split and content hash. */
export interface SplitTrack {
  readonly id: string;
  readonly version: string;
  readonly split: Split;
  readonly contentHash: string;
  /** `sha256:` + SHA-256 of the canonical JSON of the geometry only: outer, inner, start and gates. */
  readonly geometryHash: string;
  readonly track: Track;
}

export interface TrackSplits {
  /** Every track, in manifest order. */
  readonly tracks: readonly SplitTrack[];
}

/** The content hash of a loaded track: `sha256:` + SHA-256 of its canonical JSON. */
export function trackContentHash(track: Track): string {
  return `sha256:${sha256Hex(JSON.stringify(track))}`;
}

/** The geometry hash of a loaded track: the same circuit has the same hash whatever its ID, name or version. */
export function trackGeometryHash(track: Track): string {
  const { outer, inner, start, gates } = track;
  return `sha256:${sha256Hex(JSON.stringify({ outer, inner, start, gates }))}`;
}

/**
 * Checks a manifest and its track files and returns the splits, frozen, in manifest order. Throws TrackSplitError
 * for: a wrong format or version; a missing or malformed entry; a duplicate ID or file; an unknown split; an empty
 * split; a missing file; a file that does not load (TrackFormatError's message is kept); a file whose id or version
 * differs from its entry; a content hash that does not match; or two entries with the same geometry.
 */
export function loadTrackSplits(manifest: unknown, files: Readonly<Record<string, unknown>>): TrackSplits {
  const fail = (message: string): never => {
    throw new TrackSplitError(`Track splits: ${message}`);
  };
  if (manifest === null || typeof manifest !== 'object') fail('the manifest must be an object.');
  const m = manifest as Record<string, unknown>;
  if (m.format !== TRACK_SPLITS_FORMAT) fail(`"format" must be "${TRACK_SPLITS_FORMAT}", got ${String(m.format)}.`);
  if (m.version !== TRACK_SPLITS_VERSION) fail(`"version" must be ${TRACK_SPLITS_VERSION}, got ${String(m.version)}.`);
  if (!Array.isArray(m.tracks)) fail('"tracks" must be an array.');
  const entries = m.tracks as unknown[];
  const ids = new Set<string>();
  const fileNames = new Set<string>();
  const hashes = new Map<string, string>();
  const tracks: SplitTrack[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (entry === null || typeof entry !== 'object') fail(`tracks[${i}] must be an object.`);
    const e = entry as Record<string, unknown>;
    for (const key of ['id', 'version', 'split', 'file', 'contentHash']) {
      if (typeof e[key] !== 'string' || e[key] === '') fail(`tracks[${i}].${key} must be a non-empty string.`);
    }
    const { id, version, split, file, contentHash } = e as Record<string, string>;
    if (!(SPLITS as readonly string[]).includes(split!)) fail(`tracks[${i}] ("${id}") has unknown split "${split}".`);
    if (ids.has(id!)) fail(`track ID "${id}" is listed more than once (each track belongs to exactly one split).`);
    if (fileNames.has(file!)) fail(`file "${file}" is listed more than once.`);
    ids.add(id!);
    fileNames.add(file!);
    if (!Object.prototype.hasOwnProperty.call(files, file!)) fail(`file "${file}" for track "${id}" is missing.`);
    let track: Track;
    try {
      track = loadTrack(files[file!]);
    } catch (error) {
      return fail(`file "${file}" for track "${id}" does not load: ${(error as Error).message}`);
    }
    if (track.id !== id) fail(`file "${file}" has id "${track.id}", but the manifest says "${id}".`);
    if (track.version !== version) fail(`track "${id}" has version "${track.version}", but the manifest says "${version}".`);
    const actual = trackContentHash(track);
    if (actual !== contentHash) {
      fail(`track "${id}" content hash is ${actual}, but the manifest says ${contentHash}. Change the version and the hash together.`);
    }
    const geometryHash = trackGeometryHash(track);
    const same = hashes.get(geometryHash);
    if (same !== undefined) fail(`tracks "${same}" and "${id}" have the same geometry.`);
    hashes.set(geometryHash, id!);
    tracks.push(Object.freeze({ id: id!, version: version!, split: split as Split, contentHash: actual, geometryHash, track }));
  }
  for (const split of SPLITS) {
    if (!tracks.some((t) => t.split === split)) fail(`the "${split}" split has no tracks.`);
  }
  return Object.freeze({ tracks: Object.freeze(tracks) });
}

/** The built-in splits, loaded once from src/data/tracks/index.json and the track files it lists. */
export const BUILT_IN_TRACK_SPLITS: TrackSplits = loadTrackSplits(manifestData, {
  'stadium-oval.json': stadiumOval,
  'rounded-rectangle.json': roundedRectangle,
  'hairpin-chicane.json': hairpinChicane,
});

/** Every track in one split, in manifest order. */
export function tracksIn(split: Split, splits: TrackSplits = BUILT_IN_TRACK_SPLITS): readonly SplitTrack[] {
  if (!(SPLITS as readonly string[]).includes(split)) throw new TrackLeakageError(`Unknown split "${String(split)}".`);
  return splits.tracks.filter((t) => t.split === split);
}

/**
 * Every registered entry that matches a track by ID or by identical geometry, in manifest order, so a renamed copy is
 * still found, including a copy given another registered track's ID. A track whose geometry differs at all (moved,
 * scaled or edited) only matches by ID.
 */
export function findRegistered(track: Track, splits: TrackSplits = BUILT_IN_TRACK_SPLITS): readonly SplitTrack[] {
  const hash = trackGeometryHash(track);
  return splits.tracks.filter((t) => t.id === track.id || t.geometryHash === hash);
}

function requireSplit(id: string, split: Split, purpose: string, splits: TrackSplits): Track {
  const entry = splits.tracks.find((t) => t.id === id);
  if (!entry) throw new TrackLeakageError(`No built-in track "${id}".`);
  if (entry.split !== split) {
    throw new TrackLeakageError(`Track "${id}" is a ${entry.split} track; ${purpose} may only use ${split} tracks.`);
  }
  return entry.track;
}

/** A training track by ID. Throws TrackLeakageError for a validation or held-out track. */
export function trainingTrack(id: string, splits: TrackSplits = BUILT_IN_TRACK_SPLITS): Track {
  return requireSplit(id, 'training', 'training', splits);
}

/** A validation track by ID, for choosing hyperparameters or a champion. Throws TrackLeakageError otherwise. */
export function validationTrack(id: string, splits: TrackSplits = BUILT_IN_TRACK_SPLITS): Track {
  return requireSplit(id, 'validation', 'model selection', splits);
}

/**
 * Checks that a track may be trained on. Throws TrackLeakageError if any registered entry it matches, by ID or by
 * identical geometry, is a validation or held-out track; every match is checked, so a held-out circuit cannot pass
 * under a training track's ID. Returns 'training' when its geometry is a registered training circuit, otherwise
 * 'unregistered' (for example a synthetic unit-test track, or new geometry under a training ID).
 */
export function assertTrainingTrack(track: Track, splits: TrackSplits = BUILT_IN_TRACK_SPLITS): 'training' | 'unregistered' {
  const hash = trackGeometryHash(track);
  const matches = findRegistered(track, splits);
  const leak = matches.find((t) => t.split !== 'training');
  if (leak) {
    const how = leak.geometryHash === hash && leak.id !== track.id ? ` (a copy of "${leak.id}" under the ID "${track.id}")` : '';
    throw new TrackLeakageError(`Track "${leak.id}"${how} is a ${leak.split} track; training may only use training tracks.`);
  }
  return matches.some((t) => t.geometryHash === hash) ? 'training' : 'unregistered';
}

/** A score for one model on one track, as produced by an evaluation. */
export interface TrackScore {
  readonly modelId: string;
  readonly trackId: string;
  readonly score: number;
}

/**
 * The mean of finite numbers without overflow: each value / scale is in [-1, 1], and rounding is monotonic, so the
 * scaled mean stays in [-1, 1] and the result in [-scale, scale].
 */
const finiteMean = (values: readonly number[]): number => {
  const scale = values.reduce((most, value) => Math.max(most, Math.abs(value)), 0);
  if (scale === 0) return 0;
  return (values.reduce((sum, value) => sum + value / scale, 0) / values.length) * scale;
};

/**
 * Chooses a model on validation results only: the model with the highest mean score (ties to the model listed
 * first). Means are taken on scores scaled by their largest magnitude, so finite scores always give a finite mean
 * (a plain sum can overflow and pick the wrong model). Throws TrackLeakageError if any result is for a track that is
 * not a validation track, and RangeError for no results or a non-finite score. It never sees held-out results.
 */
export function selectByValidation(results: readonly TrackScore[], splits: TrackSplits = BUILT_IN_TRACK_SPLITS): string {
  if (!Array.isArray(results) || results.length === 0) throw new RangeError('Selection needs at least one validation result.');
  const scores = new Map<string, number[]>();
  for (const result of results) {
    validationTrack(result.trackId, splits);
    if (typeof result.score !== 'number' || !Number.isFinite(result.score)) {
      throw new RangeError(`Validation score for "${result.modelId}" on "${result.trackId}" must be finite, got ${String(result.score)}.`);
    }
    const list = scores.get(result.modelId);
    if (list) list.push(result.score);
    else scores.set(result.modelId, [result.score]);
  }
  let best: string | undefined;
  let bestMean = 0;
  for (const [modelId, list] of scores) {
    const mean = finiteMean(list);
    if (best === undefined || mean > bestMean) [best, bestMean] = [modelId, mean];
  }
  return best!;
}

/** A model frozen for held-out evaluation: its parameters can no longer change, and its ID is their hash. */
export interface FrozenModel {
  /** `sha256:` + SHA-256 of the canonical JSON of { parameters, provenance }. */
  readonly id: string;
  readonly parameters: readonly number[];
  /** Where the model came from (for example run seed, generation, validation selection); copied and frozen. */
  readonly provenance: Readonly<Record<string, string | number | boolean>>;
}

const isParameter = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isProvenanceValue = (value: unknown): value is string | number | boolean =>
  typeof value === 'string' || typeof value === 'boolean' || isParameter(value);

const frozenModelId = (parameters: readonly number[], provenance: Readonly<Record<string, unknown>>): string => {
  const keys = Object.keys(provenance).sort();
  const canonical = JSON.stringify({ parameters, provenance: keys.map((key) => [key, provenance[key]]) });
  return `sha256:${sha256Hex(canonical)}`;
};

/**
 * Freezes a model for held-out evaluation. Copies the parameters (finite numbers) and the provenance (string,
 * number or boolean values) and freezes both. Throws RangeError for anything else.
 */
export function freezeModel(parameters: ArrayLike<number>, provenance: Readonly<Record<string, string | number | boolean>> = {}): FrozenModel {
  if (parameters === null || typeof parameters !== 'object' || !Number.isSafeInteger(parameters.length) || parameters.length <= 0) {
    throw new RangeError('A frozen model needs a non-empty array of parameters with a positive integer length.');
  }
  const copy: number[] = [];
  for (let i = 0; i < parameters.length; i += 1) {
    const value: unknown = parameters[i];
    if (!isParameter(value)) throw new RangeError(`Parameter ${i} must be finite, got ${String(value)}.`);
    copy.push(value);
  }
  if (provenance === null || typeof provenance !== 'object') throw new RangeError('Model provenance must be an object.');
  const facts: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(provenance)) {
    if (!isProvenanceValue(value)) {
      throw new RangeError(`Provenance "${key}" must be a string, finite number or boolean.`);
    }
    facts[key] = value;
  }
  const frozenParameters = Object.freeze(copy);
  const frozenProvenance = Object.freeze(facts);
  return Object.freeze({ id: frozenModelId(frozenParameters, frozenProvenance), parameters: frozenParameters, provenance: frozenProvenance });
}

/**
 * True if `model` came from freezeModel unchanged: frozen throughout, every parameter index holds a finite number,
 * every provenance value is a string, finite number or boolean, and its ID matches its content.
 */
export function isFrozenModel(model: unknown): model is FrozenModel {
  if (model === null || typeof model !== 'object' || !Object.isFrozen(model)) return false;
  const m = model as Partial<FrozenModel>;
  if (!Array.isArray(m.parameters) || !Object.isFrozen(m.parameters) || m.parameters.length === 0) return false;
  if (m.provenance === null || typeof m.provenance !== 'object' || !Object.isFrozen(m.provenance)) return false;
  for (let i = 0; i < m.parameters.length; i += 1) if (!isParameter(m.parameters[i])) return false;
  if (!Object.values(m.provenance).every(isProvenanceValue)) return false;
  return typeof m.id === 'string' && m.id === frozenModelId(m.parameters, m.provenance);
}

/**
 * A held-out track by ID, for the final evaluation of a frozen model only. Throws TrackLeakageError if the track is
 * not a held-out track or `model` is not an unchanged frozen model (see freezeModel).
 */
export function heldOutTrack(id: string, model: FrozenModel, splits: TrackSplits = BUILT_IN_TRACK_SPLITS): Track {
  if (!isFrozenModel(model)) {
    throw new TrackLeakageError('Held-out tracks are only for frozen models (freezeModel), so they cannot shape training or selection.');
  }
  return requireSplit(id, 'held-out', 'final evaluation', splits);
}
