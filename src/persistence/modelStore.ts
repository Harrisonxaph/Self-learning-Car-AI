// Saved champions in the browser's localStorage (P3-05). The storage is injected, so tests use fakes and the page passes
// `() => window.localStorage` (reading that property can itself throw). Every access is wrapped: a throwing, full or empty
// store gives a message and never an exception, and one damaged entry never hides or deletes another save.
//
// Keys (docs/MODEL_FORMAT.md, "Storage behaviour"): `sdae:model:<id>` per model and `sdae:models:index`, a JSON array of ids
// in saving order. The index is a hint: the store also scans for model keys that are not in it (a save that failed
// between the two writes, or a damaged index), and an index entry whose model is gone is reported as damaged.
import { compatibility, MAX_MODEL_BYTES, MODEL_ID_PATTERN, validateModel, type ModelDocument, type TrackRegistryEntry } from './modelFormat';

export const MODEL_KEY_PREFIX = 'sdae:model:';
export const INDEX_KEY = 'sdae:models:index';
/** The most saves kept; a further save asks the person to delete one. */
export const MAX_SAVES = 20;

/** The part of `Storage` the store uses. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length: number;
  key(index: number): string | null;
}

export interface ModelStoreOptions {
  /** Returns the storage, or throws if the browser denies it. Called on every operation. */
  readonly storage: () => StorageLike | null;
  /** The registered training tracks, for validating stored models. */
  readonly registry: readonly TrackRegistryEntry[];
}

export const MESSAGES = Object.freeze({
  unavailable: 'Browser storage is unavailable here (for example in a private window), so nothing can be saved or listed. Training and replay still work.',
  quota: 'Browser storage is full. Delete a saved champion and try again.',
  partial: 'Some saved champions may not be shown, because browser storage could not be fully read.',
  full: `You have ${MAX_SAVES} saved champions, the most this app keeps. Delete one to save another.`,
});

export interface EntrySummary {
  readonly name: string | null;
  readonly generation: number;
  readonly fitness: number;
  readonly createdAt: string;
  /** False when the run's seed is unavailable (legacy unseeded data), so the run cannot be reproduced. */
  readonly reproducible: boolean;
}

export type StoreEntry =
  | { readonly id: string; readonly status: 'ok'; readonly summary: EntrySummary; readonly warnings: readonly string[]; readonly drivable: boolean }
  | { readonly id: string; readonly status: 'damaged'; readonly problem: string };

/** `partial` is true when part of the storage could not be read (so some saves may be missing from `entries`). */
export type StoreListing = { readonly available: true; readonly entries: readonly StoreEntry[]; readonly partial: boolean } | { readonly available: false; readonly message: string };

export type SaveResult =
  | { readonly ok: true; readonly indexed: boolean }
  | { readonly ok: false; readonly reason: 'unavailable' | 'quota' | 'full' | 'invalid'; readonly message: string };

export type LoadResult =
  | { readonly ok: true; readonly model: ModelDocument; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly message: string };

/** A file to download: the validated v1 document as JSON text, and a plain, safe file name. */
export type ExportResult = { readonly ok: true; readonly filename: string; readonly text: string } | { readonly ok: false; readonly message: string };

export type RemoveResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

export interface ModelStore {
  list(): StoreListing;
  save(model: ModelDocument): SaveResult;
  load(id: string): LoadResult;
  /** The saved champion as a JSON file, so a copy can outlive the browser's storage. Only a valid entry can be exported. */
  exportFile(id: string): ExportResult;
  remove(id: string): RemoveResult;
}

const modelKey = (id: string) => `${MODEL_KEY_PREFIX}${id}`;

/** A file name made of plain letters, digits and dashes, whatever the saved name holds. */
export function exportFilename(model: ModelDocument): string {
  const slug = (model.name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
  const short = model.id.replace(/[^A-Za-z0-9]/g, '').slice(0, 8) || 'model';
  return `sdae-champion-${slug === '' ? 'unnamed' : slug}-gen${model.training.generation + 1}-${short}.json`;
}

function isQuotaError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { name, code } = error as { name?: unknown; code?: unknown };
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014;
}

/** Reads text from a stored entry and validates it; the size cap applies before any parsing. */
function readModel(text: string | null, registry: readonly TrackRegistryEntry[]): { ok: true; model: ModelDocument } | { ok: false; problem: string } {
  if (text === null) return { ok: false, problem: 'It is listed but its data is missing.' };
  if (text.length > MAX_MODEL_BYTES) return { ok: false, problem: 'It is larger than the 1 MiB limit.' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, problem: "This isn't a valid model (the data is not readable)." };
  }
  const result = validateModel(parsed, registry);
  return result.ok ? { ok: true, model: result.model } : { ok: false, problem: result.errors.join(' ') };
}

export function createModelStore(options: ModelStoreOptions): ModelStore {
  const { registry } = options;

  /** The storage, or null if the browser denies it. */
  const open = (): StorageLike | null => {
    try {
      return options.storage();
    } catch {
      return null;
    }
  };

  /** The ids in the index (null if it is missing or damaged), in order; `failed` is true if the storage threw when reading it. */
  const readIndex = (storage: StorageLike): { ids: readonly string[] | null; failed: boolean } => {
    let text: string | null;
    try {
      text = storage.getItem(INDEX_KEY);
    } catch {
      return { ids: null, failed: true };
    }
    if (text === null) return { ids: null, failed: false };
    try {
      const parsed: unknown = JSON.parse(text);
      if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === 'string' && MODEL_ID_PATTERN.test(id))) return { ids: null, failed: false };
      return { ids: [...new Set(parsed as string[])], failed: false };
    } catch {
      return { ids: null, failed: false };
    }
  };

  /** Ids of model keys present in storage, sorted; `failed` is true if the storage could not be enumerated. */
  const scanKeys = (storage: StorageLike): { ids: string[]; failed: boolean } => {
    const ids: string[] = [];
    let failed = false;
    try {
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        if (key !== null && key.startsWith(MODEL_KEY_PREFIX)) {
          const id = key.slice(MODEL_KEY_PREFIX.length);
          if (MODEL_ID_PATTERN.test(id)) ids.push(id);
        }
      }
    } catch {
      // A store that cannot be scanned lists only what the index names, and says so.
      failed = true;
    }
    return { ids: ids.sort(), failed };
  };

  /**
   * Every id the store knows about: the index first (in order), then model keys it does not name. `failed` is true if the
   * storage threw while reading the index or enumerating keys, so a short or empty result may not be the whole truth.
   */
  const knownIds = (storage: StorageLike): { ids: string[]; failed: boolean } => {
    const index = readIndex(storage);
    const indexed = index.ids ?? [];
    const seen = new Set(indexed);
    const scan = scanKeys(storage);
    return { ids: [...indexed, ...scan.ids.filter((id) => !seen.has(id))], failed: index.failed || scan.failed };
  };

  const writeIndex = (storage: StorageLike, ids: readonly string[]): boolean => {
    try {
      storage.setItem(INDEX_KEY, JSON.stringify(ids));
      return true;
    } catch {
      return false;
    }
  };

  const readEntry = (storage: StorageLike, id: string): StoreEntry => {
    try {
      return readEntryUnchecked(storage, id);
    } catch {
      // One unreadable save is listed as damaged and never stops the list, or the page that asked for it.
      return { id, status: 'damaged', problem: 'It could not be read.' };
    }
  };
  const readEntryUnchecked = (storage: StorageLike, id: string): StoreEntry => {
    let text: string | null;
    try {
      text = storage.getItem(modelKey(id));
    } catch {
      return { id, status: 'damaged', problem: 'It could not be read from browser storage.' };
    }
    const read = readModel(text, registry);
    if (!read.ok) return { id, status: 'damaged', problem: read.problem };
    const { model } = read;
    const c = compatibility(model);
    return {
      id,
      status: 'ok',
      summary: { name: model.name ?? null, generation: model.training.generation, fitness: model.fitness, createdAt: model.createdAt, reproducible: model.training.seed !== null },
      warnings: c.drivable ? c.warnings : [...c.reasons],
      drivable: c.drivable,
    };
  };

  return {
    list() {
      const storage = open();
      if (!storage) return { available: false, message: MESSAGES.unavailable };
      const known = knownIds(storage);
      // Nothing found while the storage was throwing is "unavailable", not an ordinary empty list.
      if (known.failed && known.ids.length === 0) return { available: false, message: MESSAGES.unavailable };
      return { available: true, entries: known.ids.map((id) => readEntry(storage, id)), partial: known.failed };
    },

    save(model) {
      const checked = validateModel(JSON.parse(JSON.stringify(model)) as unknown, registry);
      if (!checked.ok) return { ok: false, reason: 'invalid', message: `This champion could not be saved: ${checked.errors.join(' ')}` };
      const text = JSON.stringify(model);
      if (text.length > MAX_MODEL_BYTES) return { ok: false, reason: 'invalid', message: 'This champion could not be saved: it is larger than the 1 MiB limit.' };
      const storage = open();
      if (!storage) return { ok: false, reason: 'unavailable', message: MESSAGES.unavailable };
      const known = knownIds(storage);
      if (known.failed && known.ids.length === 0) return { ok: false, reason: 'unavailable', message: MESSAGES.unavailable };
      const ids = known.ids;
      if (!ids.includes(model.id) && ids.length >= MAX_SAVES) return { ok: false, reason: 'full', message: MESSAGES.full };
      // The model first and the index second: if the second write fails, `list` still finds the model.
      try {
        storage.setItem(modelKey(model.id), text);
      } catch (error) {
        return isQuotaError(error) ? { ok: false, reason: 'quota', message: MESSAGES.quota } : { ok: false, reason: 'unavailable', message: MESSAGES.unavailable };
      }
      const indexed = writeIndex(storage, ids.includes(model.id) ? ids : [...ids, model.id]);
      return { ok: true, indexed };
    },

    load(id) {
      if (!MODEL_ID_PATTERN.test(id)) return { ok: false, message: 'That is not a saved champion.' };
      const storage = open();
      if (!storage) return { ok: false, message: MESSAGES.unavailable };
      let text: string | null;
      try {
        text = storage.getItem(modelKey(id));
      } catch {
        return { ok: false, message: MESSAGES.unavailable };
      }
      const read = readModel(text, registry);
      if (!read.ok) return { ok: false, message: `This saved champion can't be used. ${read.problem}` };
      const c = compatibility(read.model);
      if (!c.drivable) return { ok: false, message: `This saved champion can't be run by this version of the app. ${c.reasons.join(' ')}` };
      return { ok: true, model: read.model, warnings: c.warnings };
    },

    exportFile(id) {
      if (!MODEL_ID_PATTERN.test(id)) return { ok: false, message: 'That is not a saved champion.' };
      const storage = open();
      if (!storage) return { ok: false, message: MESSAGES.unavailable };
      let stored: string | null;
      try {
        stored = storage.getItem(modelKey(id));
      } catch {
        return { ok: false, message: MESSAGES.unavailable };
      }
      const read = readModel(stored, registry);
      if (!read.ok) return { ok: false, message: `This saved champion can't be exported. ${read.problem}` };
      // The validated document, written out again: exactly what a later import will read. Unknown extra fields are ignored
      // by validation, so stored data can hold a value nested too deeply to write out; that is a message, not an exception.
      let text: string;
      try {
        text = JSON.stringify(read.model, null, 2);
      } catch {
        return { ok: false, message: "This saved champion can't be exported: its data is nested too deeply to write out." };
      }
      if (text.length > MAX_MODEL_BYTES) return { ok: false, message: "This saved champion can't be exported: it is larger than the 1 MiB limit." };
      return { ok: true, filename: exportFilename(read.model), text };
    },

    remove(id) {
      if (!MODEL_ID_PATTERN.test(id)) return { ok: false, message: 'That is not a saved champion.' };
      const storage = open();
      if (!storage) return { ok: false, message: MESSAGES.unavailable };
      const ids = knownIds(storage).ids;
      try {
        storage.removeItem(modelKey(id));
      } catch {
        return { ok: false, message: MESSAGES.unavailable };
      }
      // A failed index write is repaired by the next save or list; the model itself is gone.
      writeIndex(storage, ids.filter((other) => other !== id));
      return { ok: true };
    },
  };
}
