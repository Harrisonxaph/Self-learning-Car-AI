// The saved-tracks panel's logic in Node (P4-03): saving the drawing, importing a chosen file, exporting, opening for editing or
// driving, the two-step delete, and the messages, against a real track store over a fake storage. Nothing here is a result.
import { describe, expect, it } from 'vitest';
import { addPoint, closeLoop, createEditorState, type EditorState } from '../../src/editor/trackEditor';
import { MAX_TRACK_BYTES, TRACK_MESSAGES, createTrackStore } from '../../src/persistence/trackStore';
import { BUILT_IN_TRACK_SPLITS, RESERVED_LAYOUT_MESSAGE, classifyCustomTrack } from '../../src/training/trackSplits';
import { createTrackLibrary, type ImportedFile } from '../../src/ui/trackLibrary';
import { MemoryStorage } from '../helpers/evaluationFixtures';

const ring = (rx: number, ry: number) => Array.from({ length: 10 }, (_, i) => ({ x: Math.round(rx * Math.cos((2 * Math.PI * i) / 10)), y: Math.round(ry * Math.sin((2 * Math.PI * i) / 10)) }));
function drawing(rx = 90, ry = 45, name = 'My oval'): EditorState {
  let state = createEditorState({ snap: 0, name });
  for (const p of ring(rx, ry)) {
    const r = addPoint(state, p);
    if (!r.ok) throw new Error(r.message);
    state = r.state;
  }
  const c = closeLoop(state);
  if (!c.ok) throw new Error(c.message);
  return c.state;
}
const file = (text: string, name = 'track.json', size = text.length): ImportedFile => ({ name, size, text: async () => text });

function setup() {
  const storage = new MemoryStorage();
  const store = createTrackStore({ storage: () => storage, screen: (t) => { const c = classifyCustomTrack(t); return c.ok ? null : c.message; } });
  const downloads: { filename: string; text: string }[] = [];
  const library = createTrackLibrary({ store, download: (filename, text) => { downloads.push({ filename, text }); } });
  return { storage, store, library, downloads };
}

describe('saving the drawing', () => {
  it('saves a valid drawing, says so, and lists it', () => {
    const { library } = setup();
    library.save(drawing());
    expect(library.message()).toMatch(/^Saved "My oval" in this browser\./);
    const listing = library.listing();
    expect(listing.available && listing.entries.map((e) => e.status)).toEqual(['ok']);
  });
  it('saving the same drawing again is "already saved"; a renamed one is "Updated"; an invalid one is refused with the reason', () => {
    const { library } = setup();
    library.save(drawing());
    library.save(drawing());
    expect(library.message()).toMatch(/already saved; nothing changed/);
    library.save({ ...drawing(), name: 'Renamed' });
    expect(library.message()).toMatch(/^Updated "Renamed"/);
    const open = createEditorState({ snap: 0 });
    library.save(open);
    expect(library.message()).toMatch(/could not be saved/);
    const listing = library.listing();
    expect(listing.available && listing.entries).toHaveLength(1);
  });
  it('reports a full or failing storage in the store\'s words', () => {
    const { library, storage } = setup();
    storage.failSet = Object.assign(new Error('q'), { name: 'QuotaExceededError' });
    library.save(drawing());
    expect(library.message()).toBe(TRACK_MESSAGES.quota);
  });
});

describe('import and export', () => {
  it('exports a saved track as a download and imports it into another browser identically', async () => {
    const a = setup();
    a.library.save(drawing());
    const id = (a.library.listing() as unknown as { entries: { id: string }[] }).entries[0]!.id;
    a.library.exportTrack(id);
    expect(a.downloads).toHaveLength(1);
    expect(a.downloads[0]!.filename).toBe(`${id}.json`);
    expect(a.library.message()).toBe(`Exported ${id}.json.`);
    const b = setup();
    await b.library.importFile([file(a.downloads[0]!.text)]);
    expect(b.library.message()).toMatch(/^Imported /);
    b.library.exportTrack(id);
    expect(b.downloads[0]!.text).toBe(a.downloads[0]!.text);
    await b.library.importFile([file(a.downloads[0]!.text)]);
    expect(b.library.message()).toMatch(/already saved; nothing changed/);
  });
  it('refuses more than one file, an oversized file, an unreadable file and bad text, each with "Nothing was imported" and no write', async () => {
    const { library, storage } = setup();
    await library.importFile([file('{}'), file('{}')]);
    expect(library.message()).toMatch(/Nothing was imported\. Choose one file/);
    await library.importFile([file('x', 'big.json', MAX_TRACK_BYTES + 1)]);
    expect(library.message()).toMatch(/Nothing was imported\..*limit/);
    await library.importFile([{ name: 'x', size: 1, text: async () => { throw new Error('unreadable'); } }]);
    expect(library.message()).toMatch(/could not be read/);
    for (const text of ['', 'nope', '[]', '{"format":"self-driving-ai-evolution/track"}']) {
      await library.importFile([file(text)]);
      expect(library.message(), text).toMatch(/^Nothing was imported\./);
    }
    await library.importFile(null);
    expect(storage.writes).toBe(0);
  });
  it('a built-in circuit\'s file is refused with the one generic message and nothing is written', async () => {
    const { library, storage } = setup();
    for (const t of BUILT_IN_TRACK_SPLITS.tracks) {
      const doc = { format: 'self-driving-ai-evolution/track', schemaVersion: 1, id: 'my-copy', version: t.track.version, name: 'copy', outer: t.track.outer, inner: t.track.inner, start: t.track.start, gates: t.track.gates };
      await library.importFile([file(JSON.stringify(t.split === 'held-out' ? doc : { ...doc, id: t.id }))]);
      expect(library.message()).toBe(`Nothing was imported. ${RESERVED_LAYOUT_MESSAGE}`);
    }
    expect(storage.writes).toBe(0);
  });
  it('a browser that refuses the download gets a message', () => {
    const { store } = setup();
    const library = createTrackLibrary({ store, download: () => { throw new Error('refused'); } });
    library.save(drawing());
    const id = (library.listing() as unknown as { entries: { id: string }[] }).entries[0]!.id;
    library.exportTrack(id);
    expect(library.message()).toBe('The browser refused the download.');
  });
});

describe('opening and deleting', () => {
  it('opens a saved track for editing with exactly the drawn state, and a track with no editing data for driving only', async () => {
    const { library, store } = setup();
    const state = drawing(100, 50, 'Edit me');
    library.save(state);
    const id = (library.listing() as unknown as { entries: { id: string }[] }).entries[0]!.id;
    const opened = library.open(id)!;
    expect(opened.track.id).toBe(id);
    expect(opened.state).toMatchObject({ closed: true, name: 'Edit me', width: state.width, gateSpacing: state.gateSpacing, startOffset: state.startOffset });
    expect(opened.state!.points).toEqual(state.points);
    const text = JSON.parse((store.exportFile(id) as { text: string }).text) as Record<string, unknown>;
    delete text.editor;
    const noEditor = setup();
    await noEditor.library.importFile([file(JSON.stringify(text))]);
    const opened2 = noEditor.library.open(id)!;
    expect(opened2.track.id).toBe(id);
    expect(opened2.state).toBeNull();
    expect(noEditor.library.open('missing')).toBeNull();
    expect(noEditor.library.message()).toMatch(/can't be used/);
  });
  it('deleting takes two steps and can be cancelled', () => {
    const { library } = setup();
    library.save(drawing());
    const id = (library.listing() as unknown as { entries: { id: string }[] }).entries[0]!.id;
    library.requestDelete(id);
    expect(library.pendingDelete()).toBe(id);
    library.cancelDelete();
    expect(library.pendingDelete()).toBeNull();
    expect((library.listing() as unknown as { entries: unknown[] }).entries).toHaveLength(1);
    library.requestDelete(id);
    library.confirmDelete(id);
    expect(library.message()).toBe('Deleted.');
    expect((library.listing() as unknown as { entries: unknown[] }).entries).toHaveLength(0);
  });
});
