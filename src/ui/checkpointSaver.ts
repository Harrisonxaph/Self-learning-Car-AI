// Writing training checkpoints in the right order (P3-07, plan section 4). One saver owns every write, so no code path can
// write around the rules and an older save can never overwrite newer progress:
//  - it holds `latest` (the newest boundary state, in memory), `lastWritten`, a run identity and an epoch;
//  - at most one write is pending and requests are coalesced: the pending write reads `latest` when it runs, never a state
//    captured when it was scheduled, and may be deferred past the frame (an injected scheduler);
//  - immediately before every write (deferred, periodic or at hide time) it checks that the epoch and run are the ones the
//    request was made under and that `latest` is newer than `lastWritten`, so a stale callback does nothing;
//  - a hide-time write cancels the pending one first and then writes `latest` synchronously;
//  - Resume, Discard and Start fresh cancel the pending write and bump the epoch before anything else;
//  - autosave stays off until the person has answered an unanswered stored checkpoint.
// Pure given its injected scheduler, clock and writer, so tests drive it exactly.
export interface SaverOptions<S extends { readonly generationIndex: number }> {
  /** Writes `state` (building and serializing it), returning whether it was stored and, if not, why. */
  readonly write: (state: S) => { readonly ok: true } | { readonly ok: false; readonly message: string };
  /** Runs `callback` later (after the frame) and returns a function that cancels it. */
  readonly defer: (callback: () => void) => () => void;
  /** Page time in milliseconds. */
  readonly now: () => number;
  /** True while training is running (not paused); periodic saves are requested only then. */
  readonly isRunning: () => boolean;
  readonly everyGenerations?: number;
  readonly minSeconds?: number;
  /** Told after every attempt that actually wrote or failed (nothing is reported for a skipped stale write). */
  readonly onResult?: (result: { readonly kind: 'saved'; readonly generationIndex: number } | { readonly kind: 'failed'; readonly generationIndex: number; readonly message: string }) => void;
}

export interface CheckpointSaver<S extends { readonly generationIndex: number }> {
  /** A generation boundary: remembers `state` as the newest and requests a periodic save when one is due. */
  boundary(state: S): void;
  /** Hide-time or page-hide: writes the newest boundary state now if it is newer than the last written one. */
  flush(): void;
  /**
   * Remembers `state` as the newest boundary without requesting a save: used right after Resume so a hide-time write can
   * preserve the chosen run before its first new generation finishes. It is written only if newer than the slot.
   */
  seed(state: S): void;
  /** Allows or blocks automatic saving (blocked while a stored checkpoint is waiting for an answer). */
  setEnabled(enabled: boolean): void;
  /** Resume, Discard or Start fresh: cancels the pending write, forgets `latest`, starts a new run identity and epoch. `lastWritten` is the generation index already in the slot (-1 when none). */
  reset(lastWritten: number): void;
  readonly pending: () => boolean;
  readonly lastWritten: () => number;
}

export const DEFAULT_EVERY_GENERATIONS = 5;
export const DEFAULT_MIN_SECONDS = 30;

export function createCheckpointSaver<S extends { readonly generationIndex: number }>(options: SaverOptions<S>): CheckpointSaver<S> {
  const every = options.everyGenerations ?? DEFAULT_EVERY_GENERATIONS;
  const minMs = (options.minSeconds ?? DEFAULT_MIN_SECONDS) * 1000;
  let latest: S | null = null;
  let lastWritten = -1;
  let epoch = 0;
  let runId = 0;
  let enabled = true;
  let cancelPending: (() => void) | null = null;
  let sinceSave = 0;
  let lastAttemptMs = options.now();

  const attempt = (forEpoch: number, forRun: number): void => {
    // The freshness check, immediately before writing.
    if (forEpoch !== epoch || forRun !== runId || !enabled || latest === null || latest.generationIndex <= lastWritten) return;
    const state = latest;
    let result: ReturnType<SaverOptions<S>['write']>;
    try {
      result = options.write(state);
    } catch {
      result = { ok: false, message: 'The checkpoint could not be written.' };
    }
    sinceSave = 0;
    lastAttemptMs = options.now();
    if (result.ok) {
      lastWritten = state.generationIndex;
      options.onResult?.({ kind: 'saved', generationIndex: state.generationIndex });
    } else {
      options.onResult?.({ kind: 'failed', generationIndex: state.generationIndex, message: result.message });
    }
  };

  const cancel = () => {
    cancelPending?.();
    cancelPending = null;
  };

  return {
    boundary(state) {
      latest = state;
      sinceSave += 1;
      if (!enabled || !options.isRunning() || cancelPending !== null) return;
      if (sinceSave < every && options.now() - lastAttemptMs < minMs) return;
      const forEpoch = epoch;
      const forRun = runId;
      cancelPending = options.defer(() => {
        cancelPending = null;
        attempt(forEpoch, forRun);
      });
    },
    seed(state) {
      latest = state;
    },
    flush() {
      cancel();
      attempt(epoch, runId);
    },
    setEnabled(value) {
      enabled = value;
      if (!value) cancel();
    },
    reset(written) {
      cancel();
      epoch += 1;
      runId += 1;
      latest = null;
      lastWritten = written;
      sinceSave = 0;
      lastAttemptMs = options.now();
    },
    pending: () => cancelPending !== null,
    lastWritten: () => lastWritten,
  };
}
