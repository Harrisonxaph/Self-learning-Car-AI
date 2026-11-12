// P4-03 review: the editor source state in an imported or stored track is untrusted and not covered by the track validator. It is bounded
// by the editor's own limits BEFORE buildTrack runs, so hostile values (1e100 coordinates, scalar extremes) cost nothing and never reach
// the rebuild. buildTrack is spied on to show it is not entered for refused source. Valid editor-made tracks still round trip.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as editor from '../../src/editor/trackEditor';
import { TRACK_KEY_PREFIX, createTrackStore } from '../../src/persistence/trackStore';
import { MemoryStorage } from '../helpers/evaluationFixtures';

const build = vi.spyOn(editor, 'buildTrack');
const ring = (rx: number, ry: number) => Array.from({ length: 10 }, (_, i) => ({ x: Math.round(rx * Math.cos((2 * Math.PI * i) / 10)), y: Math.round(ry * Math.sin((2 * Math.PI * i) / 10)) }));
function drawn(): Record<string, unknown> {
  let state = editor.createEditorState({ snap: 0, name: 'Bounds' });
  for (const p of ring(90, 45)) {
    const r = editor.addPoint(state, p);
    if (!r.ok) throw new Error(r.message);
    state = r.state;
  }
  const c = editor.closeLoop(state);
  if (!c.ok) throw new Error(c.message);
  const built = editor.buildTrack(c.state);
  if ('message' in built) throw new Error(built.message);
  return { ...built.document, editor: { points: c.state.points, width: c.state.width, gateSpacing: c.state.gateSpacing, startOffset: c.state.startOffset, name: c.state.name } };
}
const make = () => {
  const storage = new MemoryStorage();
  return { storage, store: createTrackStore({ storage: () => storage, screen: () => null }) };
};
type Ed = { points: { x: number; y: number }[]; width: number; gateSpacing: number; startOffset: number; name: string };
const withEditor = (mutate: (e: Ed) => void): Record<string, unknown> => {
  const doc = JSON.parse(JSON.stringify(drawn())) as Record<string, unknown> & { editor: Ed };
  mutate(doc.editor);
  return doc;
};

beforeEach(() => {
  build.mockClear();
});

describe('hostile editor source is dropped before anything is built from it', () => {
  const hostile: [string, (e: Ed) => void][] = [
    ['a coordinate of 1e100', (e) => { e.points[3] = { x: 1e100, y: 0 }; }],
    ['a coordinate of -1e308', (e) => { e.points[0] = { x: -1e308, y: 5 }; }],
    ['a coordinate just outside the work area', (e) => { e.points[2] = { x: 150.001, y: 0 }; }],
    ['every coordinate huge', (e) => { e.points = e.points.map((p) => ({ x: p.x * 1e12, y: p.y * 1e12 })); }],
    ['a width of 1e300', (e) => { e.width = 1e300; }],
    ['a width below the editor minimum', (e) => { e.width = 1; }],
    ['a gate spacing of 1e-300', (e) => { e.gateSpacing = 1e-300; }],
    ['a gate spacing above the editor maximum', (e) => { e.gateSpacing = 61; }],
    ['a start offset of 1e300', (e) => { e.startOffset = 1e300; }],
    ['a negative start offset', (e) => { e.startOffset = -5; }],
    ['a start offset far beyond the line', (e) => { e.startOffset = 1e9; }],
    ['a name beyond the editor limit', (e) => { e.name = 'x'.repeat(81); }],
  ];
  for (const [name, mutate] of hostile) {
    it(`${name}: the track stays valid but is not editable, buildTrack is not entered, and it returns at once`, () => {
      const { store } = make();
      const doc = withEditor(mutate);
      const started = performance.now();
      build.mockClear();
      // the rebuild count BEFORE the call is what matters: the document itself is built by the test above this line, not by the store
      const saved = store.save(doc);
      const calls = build.mock.calls.length;
      expect(saved).toMatchObject({ ok: true, editable: false });
      expect(calls).toBe(0);
      expect(performance.now() - started).toBeLessThan(500);
    });
  }

  it('the same hostile source in a STORED entry is dropped on load and in the list, without a rebuild', () => {
    const { store, storage } = make();
    const saved = store.save(drawn());
    const id = (saved as { id: string }).id;
    const text = JSON.parse(storage.data.get(`${TRACK_KEY_PREFIX}${id}`)!) as { editor: Ed };
    text.editor.points[1] = { x: 1e100, y: 1e100 };
    storage.setItem(`${TRACK_KEY_PREFIX}${id}`, JSON.stringify(text));
    build.mockClear();
    const loaded = store.load(id);
    expect(loaded).toMatchObject({ ok: true, editor: null });
    const listing = store.list() as unknown as { entries: { status: string; summary: { editable: boolean } }[] };
    expect(listing.entries[0]).toMatchObject({ status: 'ok', summary: { editable: false } });
    expect(build).not.toHaveBeenCalled();
  });

  it('valid editor source is still accepted, rebuilt once, and round trips', () => {
    const { store } = make();
    const doc = drawn();
    build.mockClear();
    expect(store.save(doc)).toMatchObject({ ok: true, editable: true });
    expect(build).toHaveBeenCalledTimes(1);
  });
});
