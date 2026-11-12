// The saved-tracks panel's logic with no DOM (P4-03): saving the track being drawn, listing, importing a chosen file, exporting,
// opening for editing, and a two-step delete, with the messages. The page (ui/editorPage.ts) only draws it and wires clicks.
// All decisions about what may be stored are in persistence/trackStore.ts and training/trackSplits.ts; this file never names a
// split and never shows more than the store's message, so nothing here can reveal which layouts are reserved.
import { buildTrack, createEditorState, type EditorState } from '../editor/trackEditor';
import { MAX_TRACK_BYTES, TRACK_MESSAGES, type EditorSeed, type TrackListing, type TrackStore } from '../persistence/trackStore';
import type { Track } from '../sim/track';

/** The part of a file chooser's file the import uses (so Node tests can fake it). */
export interface ImportedFile {
  readonly name: string;
  readonly size: number;
  text(): Promise<string>;
}

export interface TrackLibraryDeps {
  readonly store: TrackStore;
  /** Starts a download; may throw if the browser refuses. */
  readonly download: (filename: string, text: string) => void;
}

export interface OpenedTrack {
  readonly track: Track;
  /** The drawing to reopen in the editor, or null when the track has no editor data (it can be driven and evaluated, not edited). */
  readonly state: EditorState | null;
}

export interface TrackLibrary {
  listing(): TrackListing;
  message(): string;
  pendingDelete(): string | null;
  /** Saves the drawing being edited. It must be a valid, closed loop; the track keeps its name and source state. */
  save(state: EditorState): void;
  importFile(files: ArrayLike<ImportedFile> | null): Promise<void>;
  exportTrack(id: string): void;
  /** The saved track, for driving or editing; null (with a message) when it cannot be used. */
  open(id: string): OpenedTrack | null;
  requestDelete(id: string): void;
  confirmDelete(id: string): void;
  cancelDelete(): void;
}

const stateFromSeed = (seed: EditorSeed): EditorState =>
  createEditorState({ points: seed.points.map((p) => ({ x: p.x, y: p.y })), closed: true, width: seed.width, gateSpacing: seed.gateSpacing, startOffset: seed.startOffset, name: seed.name, snap: 1 });

export function createTrackLibrary(deps: TrackLibraryDeps): TrackLibrary {
  const { store } = deps;
  let message = '';
  let pending: string | null = null;
  let importing = false;

  const reportSave = (result: ReturnType<TrackStore['save']>, name: string): void => {
    if (!result.ok) {
      message = result.message;
      return;
    }
    const kept = result.indexed ? '' : ' (The list could not be updated, so it may appear after a reload.)';
    if (result.status === 'unchanged') message = `"${name}" is already saved; nothing changed.`;
    else message = `${result.status === 'updated' ? 'Updated' : 'Saved'} "${name}" in this browser. Export keeps a copy as a file.${result.editable ? '' : ' It has no editing data, so it can be driven and evaluated but not edited.'}${kept}`;
  };

  return {
    listing: () => store.list(),
    message: () => message,
    pendingDelete: () => pending,

    save(state) {
      pending = null;
      const built = buildTrack(state);
      if ('message' in built) {
        message = `This track could not be saved: ${built.message}`;
        return;
      }
      const editor = { points: state.points.map((p) => ({ x: p.x, y: p.y })), width: state.width, gateSpacing: state.gateSpacing, startOffset: state.startOffset, name: state.name };
      reportSave(store.save({ ...built.document, editor }, { replace: true }), state.name);
    },

    async importFile(files) {
      pending = null;
      const count = files ? files.length : 0;
      if (count === 0 || importing) return;
      if (count > 1) {
        message = 'Nothing was imported. Choose one file at a time.';
        return;
      }
      const file = files?.[0];
      if (!file) return;
      if (!(file.size <= MAX_TRACK_BYTES)) {
        message = `Nothing was imported. ${TRACK_MESSAGES.tooLarge}`;
        return;
      }
      importing = true;
      try {
        let text: string;
        try {
          text = await file.text();
        } catch {
          message = 'Nothing was imported. The file could not be read.';
          return;
        }
        const result = store.importText(text);
        if (!result.ok) {
          message = `Nothing was imported. ${result.message}`;
          return;
        }
        message = result.status === 'unchanged' ? 'That track is already saved; nothing changed.' : `Imported ${result.id}.${result.editable ? '' : ' It has no editing data, so it can be driven and evaluated but not edited.'}`;
      } finally {
        importing = false;
      }
    },

    exportTrack(id) {
      pending = null;
      const file = store.exportFile(id);
      if (!file.ok) {
        message = file.message;
        return;
      }
      try {
        deps.download(file.filename, file.text);
        message = `Exported ${file.filename}.`;
      } catch {
        message = 'The browser refused the download.';
      }
    },

    open(id) {
      pending = null;
      const loaded = store.load(id);
      if (!loaded.ok) {
        message = loaded.message;
        return null;
      }
      return { track: loaded.track, state: loaded.editor === null ? null : stateFromSeed(loaded.editor) };
    },

    requestDelete(id) {
      pending = id;
      message = '';
    },
    confirmDelete(id) {
      pending = null;
      const removed = store.remove(id);
      message = removed.ok ? 'Deleted.' : removed.message;
    },
    cancelDelete() {
      pending = null;
      message = '';
    },
  };
}
