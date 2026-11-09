// The training checkpoint in the browser's localStorage (P3-07): one slot, `sdae:checkpoint:v1`. The storage is injected
// (so tests use fakes and reading `window.localStorage` can itself throw), and every failure is a message, never an
// exception. A failed write leaves the previous checkpoint in place (localStorage replaces one key's value as a unit, so a
// `setItem` that throws changes nothing). The store never touches `sdae:model:*` keys: saved champions are separate.
import { MAX_CHECKPOINT_BYTES, utf8Size, validateCheckpoint, type CheckpointDocument, type ValidateOptions } from './checkpointFormat';
import type { StorageLike } from './modelStore';

export const CHECKPOINT_KEY = 'sdae:checkpoint:v1';

export const CHECKPOINT_MESSAGES = Object.freeze({
  unavailable: 'Browser storage is unavailable here (for example in a private window), so no checkpoint can be saved. Training continues; Download checkpoint still works.',
  quota: 'Browser storage is full, so this checkpoint was not saved. Training continues; Download checkpoint still works.',
  tooLarge: 'This checkpoint is too large to write out (over 3 MiB), so it was not saved or offered. The last good checkpoint is kept and training continues.',
  notWritable: 'This checkpoint could not be written out, so it was not saved or offered. The last good checkpoint is kept and training continues.',
});

export type ReadResult =
  | { readonly status: 'none' }
  | { readonly status: 'ok'; readonly checkpoint: CheckpointDocument }
  | { readonly status: 'damaged'; readonly problem: string }
  | { readonly status: 'unavailable'; readonly message: string };

export type WriteResult = { readonly ok: true } | { readonly ok: false; readonly reason: 'unavailable' | 'quota' | 'too-large' | 'not-writable'; readonly message: string };
export type ClearResult = { readonly ok: true } | { readonly ok: false; readonly message: string };
/** A file to download: a plain name and the text; or why none can be offered. */
export type FileResult = { readonly ok: true; readonly filename: string; readonly text: string } | { readonly ok: false; readonly message: string };

export type ParseResult = { readonly ok: true; readonly checkpoint: CheckpointDocument } | { readonly ok: false; readonly errors: readonly string[] };

export interface CheckpointStoreOptions extends ValidateOptions {
  /** Returns the storage, or throws if the browser denies it. Called on every operation. */
  readonly storage: () => StorageLike | null;
}

export interface CheckpointStore {
  read(): ReadResult;
  write(checkpoint: CheckpointDocument): WriteResult;
  clear(): ClearResult;
}

function isQuotaError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { name, code } = error as { name?: unknown; code?: unknown };
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014;
}

/**
 * Text of a checkpoint (stored or from a file) to a validated document. The limit is in UTF-8 bytes and is checked before
 * parsing; a leading byte-order mark is accepted. Pure: it writes nothing, so a refusal has no side effect.
 */
export function parseCheckpointText(text: string, options: ValidateOptions): ParseResult {
  try {
    if (typeof text !== 'string') return { ok: false, errors: ["This isn't a valid checkpoint (it is not text)."] };
    if (utf8Size(text) > MAX_CHECKPOINT_BYTES) return { ok: false, errors: ['This file is larger than the 3 MiB limit for a checkpoint.'] };
    const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    if (body.trim() === '') return { ok: false, errors: ['This file is empty.'] };
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return { ok: false, errors: ["This isn't a valid checkpoint (it is not readable JSON)."] };
    }
    const checked = validateCheckpoint(parsed, options);
    return checked.ok ? { ok: true, checkpoint: checked.checkpoint } : { ok: false, errors: checked.errors };
  } catch {
    return { ok: false, errors: ['This file could not be checked.'] };
  }
}

/** One short sentence for a refusal: the first few errors and a count of the rest. */
export function describeCheckpointRefusal(errors: readonly string[]): string {
  const shown = errors.slice(0, 3).join(' ');
  const more = errors.length - 3;
  return `Nothing was loaded. ${shown}${more > 0 ? ` (and ${more} more problem${more === 1 ? '' : 's'})` : ''}`;
}

/** Compact text of a checkpoint, or why it cannot be written out. Serialization is guarded: it never throws. */
function serialize(checkpoint: CheckpointDocument, indent: number | undefined): { ok: true; text: string } | { ok: false; reason: 'too-large' | 'not-writable' } {
  let text: string;
  try {
    text = JSON.stringify(checkpoint, null, indent);
  } catch {
    return { ok: false, reason: 'not-writable' };
  }
  if (typeof text !== 'string') return { ok: false, reason: 'not-writable' };
  return utf8Size(text) > MAX_CHECKPOINT_BYTES ? { ok: false, reason: 'too-large' } : { ok: true, text };
}

/** A file name made of plain letters, digits and dashes. */
export function checkpointFilename(checkpoint: CheckpointDocument): string {
  const short = checkpoint.id.replace(/[^A-Za-z0-9]/g, '').slice(0, 8) || 'checkpoint';
  return `sdae-checkpoint-gen${checkpoint.generationIndex}-${short}.json`;
}

/**
 * A checkpoint as a file, built from the document in memory and so independent of the browser's storage (a full or private
 * store does not block it). The indented text is used when it fits; close to the limit the compact text of the same
 * document is used. A document that does not fit or cannot be serialized gets an accurate refusal, not a file.
 */
export function checkpointFile(checkpoint: CheckpointDocument): FileResult {
  const pretty = serialize(checkpoint, 2);
  if (pretty.ok) return { ok: true, filename: checkpointFilename(checkpoint), text: pretty.text };
  const compact = serialize(checkpoint, undefined);
  if (compact.ok) return { ok: true, filename: checkpointFilename(checkpoint), text: compact.text };
  return { ok: false, message: compact.reason === 'too-large' ? CHECKPOINT_MESSAGES.tooLarge : CHECKPOINT_MESSAGES.notWritable };
}

export function createCheckpointStore(options: CheckpointStoreOptions): CheckpointStore {
  const open = (): StorageLike | null => {
    try {
      return options.storage();
    } catch {
      return null;
    }
  };
  return {
    read() {
      const storage = open();
      if (!storage) return { status: 'unavailable', message: CHECKPOINT_MESSAGES.unavailable };
      let text: string | null;
      try {
        text = storage.getItem(CHECKPOINT_KEY);
      } catch {
        return { status: 'unavailable', message: CHECKPOINT_MESSAGES.unavailable };
      }
      if (text === null) return { status: 'none' };
      const parsed = parseCheckpointText(text, options);
      return parsed.ok ? { status: 'ok', checkpoint: parsed.checkpoint } : { status: 'damaged', problem: parsed.errors.join(' ') };
    },

    write(checkpoint) {
      const serialized = serialize(checkpoint, undefined);
      if (!serialized.ok) return { ok: false, reason: serialized.reason, message: serialized.reason === 'too-large' ? CHECKPOINT_MESSAGES.tooLarge : CHECKPOINT_MESSAGES.notWritable };
      const storage = open();
      if (!storage) return { ok: false, reason: 'unavailable', message: CHECKPOINT_MESSAGES.unavailable };
      try {
        storage.setItem(CHECKPOINT_KEY, serialized.text);
      } catch (error) {
        return isQuotaError(error) ? { ok: false, reason: 'quota', message: CHECKPOINT_MESSAGES.quota } : { ok: false, reason: 'unavailable', message: CHECKPOINT_MESSAGES.unavailable };
      }
      return { ok: true };
    },

    clear() {
      const storage = open();
      if (!storage) return { ok: false, message: CHECKPOINT_MESSAGES.unavailable };
      try {
        storage.removeItem(CHECKPOINT_KEY);
      } catch {
        return { ok: false, message: CHECKPOINT_MESSAGES.unavailable };
      }
      return { ok: true };
    },
  };
}

