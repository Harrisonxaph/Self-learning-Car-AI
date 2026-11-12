// Saved custom tracks in the browser's localStorage (P4-03), with the model store's safety rules: the storage is injected (tests
// use fakes; the page passes `() => window.localStorage`, since reading that property can itself throw), every access is wrapped,
// a write is all or nothing, and one damaged entry never hides or deletes another save. Nothing here throws.
//
// Keys: `sdae:track:<id>` per track and `sdae:tracks:index`, a JSON array of ids in saving order. The index is a hint: the store
// also scans for track keys that are not in it. The stored text is the track in its published format (docs/TRACK_FORMAT.md) written
// in one canonical key order, plus, for a track drawn in the editor, the editor's source state, so export, import and export again
// give byte-identical text and "Edit again" reopens exactly what was drawn.
//
// The held-out boundary lives outside this file: the page injects `screen`, which refuses any ID or layout of a built-in study
// circuit with one generic message (training/trackSplits.ts `classifyCustomTrack`). This layer never names a split.
import { buildTrack, createEditorState, EDITOR_LIMITS, type EditorState } from '../editor/trackEditor';
import { type Track } from '../sim/track';
import { describeTrackErrors, TRACK_FORMAT, TRACK_LIMITS, TRACK_SCHEMA_VERSION, validateTrack } from '../sim/trackValidation';
import type { StorageLike } from './modelStore';

export const TRACK_KEY_PREFIX = 'sdae:track:';
export const TRACK_INDEX_KEY = 'sdae:tracks:index';
/** The most saved tracks; a further save asks the person to delete one. */
export const MAX_TRACK_SAVES = 20;
/** The largest track document, in bytes of UTF-8. Checked before any parsing work. */
export const MAX_TRACK_BYTES = 256 * 1024;

const ID_PATTERN = /^[a-z0-9-]{1,64}$/;
const trackKey = (id: string): string => `${TRACK_KEY_PREFIX}${id}`;
const bytesOf = (text: string): number => (text.length > MAX_TRACK_BYTES ? text.length : new TextEncoder().encode(text).length);

export const TRACK_MESSAGES = Object.freeze({
  unavailable: 'Browser storage is unavailable here (for example in a private window), so no track can be saved or listed.',
  quota: 'Browser storage is full. Delete a saved track and try again.',
  partial: 'Some saved tracks may not be shown, because browser storage could not be fully read.',
  full: `You have ${MAX_TRACK_SAVES} saved tracks, the most this app keeps. Delete one to save another.`,
  tooLarge: `This track file is larger than the ${MAX_TRACK_BYTES / 1024} KiB limit.`,
  notFound: 'That is not a saved track.',
});

export interface TrackStoreOptions {
  /** Returns the storage, or throws if the browser denies it. Called on every operation. */
  readonly storage: () => StorageLike | null;
  /** A message when this track may not be used (an ID or a layout of a built-in study circuit), otherwise null. Never throws. */
  readonly screen: (track: Track) => string | null;
}

/** What the editor needs to reopen a saved track exactly as it was drawn. */
export interface EditorSeed {
  readonly points: readonly { readonly x: number; readonly y: number }[];
  readonly width: number;
  readonly gateSpacing: number;
  readonly startOffset: number;
  readonly name: string;
}

export interface SavedTrackSummary {
  readonly name: string;
  readonly gates: number;
  /** True when the editor can reopen it (it was drawn here, and its source state matches its geometry). */
  readonly editable: boolean;
}

export type TrackEntry =
  | { readonly id: string; readonly status: 'ok'; readonly summary: SavedTrackSummary }
  | { readonly id: string; readonly status: 'damaged'; readonly problem: string };

export type TrackListing = { readonly available: true; readonly entries: readonly TrackEntry[]; readonly partial: boolean } | { readonly available: false; readonly message: string };

export type ParsedTrack = { readonly ok: true; readonly track: Track; readonly text: string; readonly editor: EditorSeed | null } | { readonly ok: false; readonly message: string };

export type TrackSaveResult =
  | { readonly ok: true; readonly id: string; readonly status: 'saved' | 'updated' | 'unchanged'; readonly indexed: boolean; readonly editable: boolean }
  | { readonly ok: false; readonly reason: 'invalid' | 'conflict' | 'full' | 'quota' | 'unavailable'; readonly message: string };

export type TrackLoadResult = { readonly ok: true; readonly track: Track; readonly editor: EditorSeed | null } | { readonly ok: false; readonly message: string };
export type TrackExportResult = { readonly ok: true; readonly filename: string; readonly text: string } | { readonly ok: false; readonly message: string };
export type TrackRemoveResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

export interface TrackStore {
  list(): TrackListing;
  load(id: string): TrackLoadResult;
  /** Saves a track from the editor or any parsed value. With `replace`, the same layout under the same id takes the new name and source state. */
  save(input: unknown, options?: { readonly replace?: boolean }): TrackSaveResult;
  /** Saves a track from a file's text (an import): the same layout under the same id is "unchanged", never rewritten. */
  importText(text: string): TrackSaveResult;
  exportFile(id: string): TrackExportResult;
  remove(id: string): TrackRemoveResult;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const point = (p: { readonly x: number; readonly y: number }): { x: number; y: number } => ({ x: p.x, y: p.y });

/** Two geometries are the same within a rounding difference between engines (Math.sin and Math.cos), 1e-6 m. */
function sameGeometry(a: Track, b: Track): boolean {
  const near = (x: number, y: number): boolean => Math.abs(x - y) <= 1e-6;
  const pts = (p: readonly { x: number; y: number }[], q: readonly { x: number; y: number }[]): boolean => p.length === q.length && p.every((v, i) => near(v.x, q[i]!.x) && near(v.y, q[i]!.y));
  return (
    pts(a.outer, b.outer) &&
    pts(a.inner, b.inner) &&
    near(a.start.position.x, b.start.position.x) &&
    near(a.start.position.y, b.start.position.y) &&
    near(a.start.heading, b.start.heading) &&
    a.gates.length === b.gates.length &&
    a.gates.every((g, i) => near(g.a.x, b.gates[i]!.a.x) && near(g.a.y, b.gates[i]!.a.y) && near(g.b.x, b.gates[i]!.b.x) && near(g.b.y, b.gates[i]!.b.y))
  );
}

/** The editor source state in a document, or null when it is absent or not usable (the track is then simply not editable). */
function readEditor(value: unknown, track: Track): EditorSeed | null {
  try {
    if (!isObject(value) || !Array.isArray(value.points)) return null;
    const count = value.points.length;
    if (count < EDITOR_LIMITS.minPoints || count > EDITOR_LIMITS.maxPoints) return null;
    const points: { x: number; y: number }[] = [];
    for (const p of value.points as unknown[]) {
      if (!isObject(p) || !finite(p.x) || !finite(p.y)) return null;
      points.push({ x: p.x, y: p.y });
    }
    const { width, gateSpacing, startOffset, name } = value;
    if (!finite(width) || !finite(gateSpacing) || !finite(startOffset) || typeof name !== 'string' || name.length > EDITOR_LIMITS.maxNameLength) return null;
    const state: EditorState = createEditorState({ points, closed: true, width, gateSpacing, startOffset, name, snap: 1 });
    const built = buildTrack(state);
    if ('message' in built) return null;
    const again = validateTrack(built.document);
    // The source state is kept only when rebuilding it gives this very layout, so "Edit again" can never show something else.
    if (!again.ok || !sameGeometry(again.track, track)) return null;
    return { points, width, gateSpacing, startOffset, name };
  } catch {
    return null;
  }
}

/**
 * Validates a track document (a parsed value) and writes its canonical text. The size cap is applied to the text; every
 * `validateTrack` message is reported; an ID or layout the `screen` refuses is refused. Never throws.
 */
export function parseTrackDocument(input: unknown, screen: (track: Track) => string | null): ParsedTrack {
  try {
    if (!isObject(input)) return { ok: false, message: 'This is not a track file (it must be a JSON object).' };
    if (input.format !== TRACK_FORMAT) return { ok: false, message: `This is not a track file: "format" must be "${TRACK_FORMAT}".` };
    if (input.schemaVersion !== TRACK_SCHEMA_VERSION) return { ok: false, message: `This app reads track schema version ${TRACK_SCHEMA_VERSION}, but the file says ${String(input.schemaVersion)}.` };
    // The split label is ignored: a custom track has no split, and a file cannot relabel itself.
    const checked = validateTrack(input);
    if (!checked.ok) return { ok: false, message: describeTrackErrors(checked.errors) };
    const track = checked.track;
    if (!ID_PATTERN.test(track.id) || track.id.length > TRACK_LIMITS.maxIdLength) return { ok: false, message: `The id "${track.id.slice(0, 64)}" must be 1 to 64 characters: lower-case letters, digits and hyphens.` };
    const refused = screen(track);
    if (refused !== null) return { ok: false, message: refused };
    const editor = readEditor(input.editor, track);
    const document: Record<string, unknown> = {
      format: TRACK_FORMAT,
      schemaVersion: TRACK_SCHEMA_VERSION,
      id: track.id,
      version: track.version,
      name: track.name,
      outer: track.outer.map(point),
      inner: track.inner.map(point),
      start: { position: point(track.start.position), heading: track.start.heading },
      gates: track.gates.map((g) => ({ a: point(g.a), b: point(g.b) })),
    };
    if (editor !== null) document.editor = { points: editor.points.map(point), width: editor.width, gateSpacing: editor.gateSpacing, startOffset: editor.startOffset, name: editor.name };
    const text = JSON.stringify(document);
    if (bytesOf(text) > MAX_TRACK_BYTES) return { ok: false, message: TRACK_MESSAGES.tooLarge };
    return { ok: true, track, text, editor };
  } catch {
    return { ok: false, message: 'This track could not be read.' };
  }
}

/** Parses a file's text (the size cap first, then JSON), then validates it as a track document. */
export function parseTrackText(text: string, screen: (track: Track) => string | null): ParsedTrack {
  if (typeof text !== 'string') return { ok: false, message: 'This is not a track file.' };
  if (bytesOf(text) > MAX_TRACK_BYTES) return { ok: false, message: TRACK_MESSAGES.tooLarge };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: "This isn't a track file (the data is not valid JSON)." };
  }
  return parseTrackDocument(parsed, screen);
}

function isQuotaError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { name, code } = error as { name?: unknown; code?: unknown };
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014;
}

export function createTrackStore(options: TrackStoreOptions): TrackStore {
  const { screen } = options;
  const open = (): StorageLike | null => {
    try {
      return options.storage();
    } catch {
      return null;
    }
  };

  const readIndex = (storage: StorageLike): { ids: readonly string[] | null; failed: boolean } => {
    let text: string | null;
    try {
      text = storage.getItem(TRACK_INDEX_KEY);
    } catch {
      return { ids: null, failed: true };
    }
    if (text === null) return { ids: null, failed: false };
    try {
      const parsed: unknown = JSON.parse(text);
      if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === 'string' && ID_PATTERN.test(id))) return { ids: null, failed: false };
      return { ids: [...new Set(parsed as string[])], failed: false };
    } catch {
      return { ids: null, failed: false };
    }
  };

  const scanKeys = (storage: StorageLike): { ids: string[]; failed: boolean } => {
    const ids: string[] = [];
    let failed = false;
    try {
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        if (key !== null && key.startsWith(TRACK_KEY_PREFIX)) {
          const id = key.slice(TRACK_KEY_PREFIX.length);
          if (ID_PATTERN.test(id)) ids.push(id);
        }
      }
    } catch {
      failed = true;
    }
    return { ids: ids.sort(), failed };
  };

  const knownIds = (storage: StorageLike): { ids: string[]; failed: boolean } => {
    const index = readIndex(storage);
    const indexed = index.ids ?? [];
    const seen = new Set(indexed);
    const scan = scanKeys(storage);
    return { ids: [...indexed, ...scan.ids.filter((id) => !seen.has(id))], failed: index.failed || scan.failed };
  };

  const writeIndex = (storage: StorageLike, ids: readonly string[]): boolean => {
    try {
      storage.setItem(TRACK_INDEX_KEY, JSON.stringify(ids));
      return true;
    } catch {
      return false;
    }
  };

  /** Reads one stored track and checks it again from scratch (size, JSON, validator, screen): hand-edited storage is caught here. */
  const readStored = (storage: StorageLike, id: string): { ok: true; parsed: Extract<ParsedTrack, { ok: true }>; stored: string } | { ok: false; problem: string } => {
    let text: string | null;
    try {
      text = storage.getItem(trackKey(id));
    } catch {
      return { ok: false, problem: 'It could not be read from browser storage.' };
    }
    if (text === null) return { ok: false, problem: 'It is listed but its data is missing.' };
    const parsed = parseTrackText(text, screen);
    if (!parsed.ok) return { ok: false, problem: parsed.message };
    if (parsed.track.id !== id) return { ok: false, problem: 'Its stored data is for a different track.' };
    return { ok: true, parsed, stored: text };
  };

  const write = (parsed: Extract<ParsedTrack, { ok: true }>, replace: boolean): TrackSaveResult => {
    const storage = open();
    if (!storage) return { ok: false, reason: 'unavailable', message: TRACK_MESSAGES.unavailable };
    const known = knownIds(storage);
    if (known.failed && known.ids.length === 0) return { ok: false, reason: 'unavailable', message: TRACK_MESSAGES.unavailable };
    const id = parsed.track.id;
    const exists = known.ids.includes(id);
    let status: 'saved' | 'updated' | 'unchanged' = 'saved';
    if (exists) {
      const current = readStored(storage, id);
      // A damaged save under this id is replaced only by an explicit save; an import never overwrites it silently.
      if (current.ok) {
        if (!sameGeometry(current.parsed.track, parsed.track)) return { ok: false, reason: 'conflict', message: `A different track is already saved under the id "${id}". Give this one another name or layout.` };
        if (current.stored === parsed.text) return { ok: true, id, status: 'unchanged', indexed: true, editable: parsed.editor !== null };
        if (!replace) return { ok: true, id, status: 'unchanged', indexed: true, editable: current.parsed.editor !== null };
        status = 'updated';
      } else if (!replace) {
        return { ok: false, reason: 'conflict', message: `A damaged save already uses the id "${id}". Delete it first.` };
      } else status = 'updated';
    } else if (known.ids.length >= MAX_TRACK_SAVES) {
      return { ok: false, reason: 'full', message: TRACK_MESSAGES.full };
    }
    // The track first and the index second: if the second write fails, `list` still finds the track.
    try {
      storage.setItem(trackKey(id), parsed.text);
    } catch (error) {
      return isQuotaError(error) ? { ok: false, reason: 'quota', message: TRACK_MESSAGES.quota } : { ok: false, reason: 'unavailable', message: TRACK_MESSAGES.unavailable };
    }
    const indexed = writeIndex(storage, exists ? known.ids : [...known.ids, id]);
    return { ok: true, id, status, indexed, editable: parsed.editor !== null };
  };

  return {
    list() {
      const storage = open();
      if (!storage) return { available: false, message: TRACK_MESSAGES.unavailable };
      const known = knownIds(storage);
      if (known.failed && known.ids.length === 0) return { available: false, message: TRACK_MESSAGES.unavailable };
      const entries: TrackEntry[] = known.ids.map((id): TrackEntry => {
        try {
          const read = readStored(storage, id);
          if (!read.ok) return { id, status: 'damaged', problem: read.problem };
          const { track, editor } = read.parsed;
          return { id, status: 'ok', summary: { name: track.name, gates: track.gates.length, editable: editor !== null } };
        } catch {
          return { id, status: 'damaged', problem: 'It could not be read.' };
        }
      });
      return { available: true, entries, partial: known.failed };
    },

    load(id) {
      if (typeof id !== 'string' || !ID_PATTERN.test(id)) return { ok: false, message: TRACK_MESSAGES.notFound };
      const storage = open();
      if (!storage) return { ok: false, message: TRACK_MESSAGES.unavailable };
      const read = readStored(storage, id);
      if (!read.ok) return { ok: false, message: `This saved track can't be used. ${read.problem}` };
      return { ok: true, track: read.parsed.track, editor: read.parsed.editor };
    },

    save(input, saveOptions = {}) {
      const parsed = parseTrackDocument(input, screen);
      if (!parsed.ok) return { ok: false, reason: 'invalid', message: `This track could not be saved: ${parsed.message}` };
      return write(parsed, saveOptions.replace === true);
    },

    importText(text) {
      const parsed = parseTrackText(text, screen);
      if (!parsed.ok) return { ok: false, reason: 'invalid', message: parsed.message };
      return write(parsed, false);
    },

    exportFile(id) {
      if (typeof id !== 'string' || !ID_PATTERN.test(id)) return { ok: false, message: TRACK_MESSAGES.notFound };
      const storage = open();
      if (!storage) return { ok: false, message: TRACK_MESSAGES.unavailable };
      const read = readStored(storage, id);
      if (!read.ok) return { ok: false, message: `This saved track can't be exported. ${read.problem}` };
      return { ok: true, filename: `${id}.json`, text: read.parsed.text };
    },

    remove(id) {
      if (typeof id !== 'string' || !ID_PATTERN.test(id)) return { ok: false, message: TRACK_MESSAGES.notFound };
      const storage = open();
      if (!storage) return { ok: false, message: TRACK_MESSAGES.unavailable };
      try {
        storage.removeItem(trackKey(id));
      } catch {
        return { ok: false, message: TRACK_MESSAGES.unavailable };
      }
      const index = readIndex(storage);
      if (index.ids !== null) writeIndex(storage, index.ids.filter((x) => x !== id));
      return { ok: true };
    },
  };
}
