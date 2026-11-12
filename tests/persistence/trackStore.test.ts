// The P4-03 track store: round trip, validation, caps, damaged entries, failing storage, and the held-out boundary (a layout or ID of a
// built-in study circuit is refused with one generic message that names nothing). Synthetic editor tracks; nothing here is a result.
import { describe, expect, it } from 'vitest';
import { addPoint, buildTrack, closeLoop, createEditorState, type EditorState } from '../../src/editor/trackEditor';
import {
  MAX_TRACK_BYTES,
  MAX_TRACK_SAVES,
  TRACK_INDEX_KEY,
  TRACK_KEY_PREFIX,
  TRACK_MESSAGES,
  createTrackStore,
  parseTrackText,
} from '../../src/persistence/trackStore';
import type { Track, Vec2 } from '../../src/sim/track';
import { BUILT_IN_TRACK_SPLITS, RESERVED_LAYOUT_MESSAGE, classifyCustomTrack } from '../../src/training/trackSplits';
import { MemoryStorage } from '../helpers/evaluationFixtures';

const ring = (rx: number, ry: number, n = 10, turn = 0): Vec2[] =>
  Array.from({ length: n }, (_, i) => ({ x: Math.round(rx * Math.cos((2 * Math.PI * i) / n + turn)), y: Math.round(ry * Math.sin((2 * Math.PI * i) / n + turn)) }));

function editorState(points: Vec2[], over: Partial<EditorState> = {}): EditorState {
  let state = createEditorState({ snap: 0, ...over });
  for (const p of points) {
    const r = addPoint(state, p);
    if (!r.ok) throw new Error(r.message);
    state = r.state;
  }
  const c = closeLoop(state);
  if (!c.ok) throw new Error(c.message);
  return c.state;
}

/** A track document as the editor page would send it, with its source state. */
function drawn(rx = 90, ry = 45, name = 'My oval'): Record<string, unknown> {
  const state = editorState(ring(rx, ry), { name });
  const built = buildTrack(state);
  if ('message' in built) throw new Error(built.message);
  return { ...built.document, editor: { points: state.points, width: state.width, gateSpacing: state.gateSpacing, startOffset: state.startOffset, name: state.name } };
}

const screen = (track: Track): string | null => {
  const checked = classifyCustomTrack(track);
  return checked.ok ? null : checked.message;
};
const make = (storage = new MemoryStorage()) => ({ storage, store: createTrackStore({ storage: () => storage, screen }) });
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe('saving, listing, loading and removing', () => {
  it('saves a drawn track, lists it, loads it with its editor state, and removes it', () => {
    const { store } = make();
    const doc = drawn();
    const saved = store.save(doc);
    expect(saved).toMatchObject({ ok: true, status: 'saved', indexed: true, editable: true });
    const id = (saved as { id: string }).id;
    expect(id).toMatch(/^custom-[0-9a-f]{8}$/);
    const listing = store.list();
    expect(listing).toMatchObject({ available: true, partial: false });
    expect((listing as unknown as { entries: unknown[] }).entries).toEqual([{ id, status: 'ok', summary: { name: 'My oval', gates: expect.any(Number), editable: true } }]);
    const loaded = store.load(id);
    expect(loaded.ok && loaded.track.id).toBe(id);
    expect(loaded.ok && loaded.editor?.name).toBe('My oval');
    expect(store.remove(id)).toEqual({ ok: true });
    expect((store.list() as unknown as { entries: unknown[] }).entries).toHaveLength(0);
    expect(store.load(id).ok).toBe(false);
  });

  it('a track without editor state is saved and drivable but not editable', () => {
    const { store } = make();
    const doc = drawn();
    delete doc.editor;
    const saved = store.save(doc);
    expect(saved).toMatchObject({ ok: true, editable: false });
    const id = (saved as { id: string }).id;
    const loaded = store.load(id);
    expect(loaded.ok && loaded.editor).toBeNull();
  });

  it('editor state that does not rebuild this layout is dropped, never trusted', () => {
    const { store } = make();
    const doc = drawn();
    (doc.editor as { width: number }).width = 20;
    expect(store.save(doc)).toMatchObject({ ok: true, editable: false });
  });

  it('unusable editor state is ignored, not an error', () => {
    for (const editor of [null, 5, 'x', {}, { points: [] }, { points: null, width: 12, gateSpacing: 25, startOffset: 0, name: 'x' }, { points: ring(90, 45), width: 'wide', gateSpacing: 25, startOffset: 0, name: 'x' }, { points: ring(90, 45).map((p) => ({ x: Number.NaN, y: p.y })), width: 12, gateSpacing: 25, startOffset: 0, name: 'x' }, { points: ring(90, 45), width: 12, gateSpacing: 25, startOffset: 0, name: 'x'.repeat(200) }, { points: ring(40, 20), width: 12, gateSpacing: 25, startOffset: 0, name: 'unrelated' }, { points: [{ x: 1 }], width: 12, gateSpacing: 25, startOffset: 0, name: 'x' }, { points: new Array(300).fill({ x: 1, y: 1 }), width: 12, gateSpacing: 25, startOffset: 0, name: 'x' }]) {
      const { store } = make();
      const doc = drawn();
      doc.editor = editor;
      expect(store.save(doc), JSON.stringify(editor).slice(0, 40)).toMatchObject({ ok: true, editable: false });
    }
  });

  it('keeps saving order, and removing one leaves the others', () => {
    const { store } = make();
    const ids = [drawn(90, 45, 'a'), drawn(100, 50, 'b'), drawn(110, 55, 'c')].map((d) => (store.save(d) as { id: string }).id);
    expect(new Set(ids).size).toBe(3);
    expect((store.list() as unknown as { entries: { id: string }[] }).entries.map((e) => e.id)).toEqual(ids);
    store.remove(ids[1]!);
    expect((store.list() as unknown as { entries: { id: string }[] }).entries.map((e) => e.id)).toEqual([ids[0], ids[2]]);
  });
});

describe('export, import and the round trip', () => {
  it('export, import and export again is byte-identical, whatever the key order of the file', () => {
    const a = make();
    const id = (a.store.save(drawn()) as { id: string }).id;
    const first = a.store.exportFile(id);
    expect(first).toMatchObject({ ok: true, filename: `${id}.json` });
    const text = (first as { text: string }).text;
    const b = make();
    expect(b.store.importText(text)).toMatchObject({ ok: true, status: 'saved', id });
    const second = b.store.exportFile(id) as { text: string };
    expect(second.text).toBe(text);
    // the same file with its keys in reverse order, and with a split label that must be ignored
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const reversed = Object.fromEntries(Object.entries({ ...parsed, split: 'held-out' }).reverse());
    const c = make();
    expect(c.store.importText(JSON.stringify(reversed))).toMatchObject({ ok: true, id });
    expect((c.store.exportFile(id) as { text: string }).text).toBe(text);
    expect(JSON.parse(text).split).toBeUndefined();
  });

  it('importing the same file again is unchanged and writes nothing; a changed name needs an explicit editor save', () => {
    const { store, storage } = make();
    const id = (store.save(drawn()) as { id: string }).id;
    const text = (store.exportFile(id) as { text: string }).text;
    const writes = storage.writes;
    expect(store.importText(text)).toMatchObject({ ok: true, status: 'unchanged' });
    expect(storage.writes).toBe(writes);
    const renamed = { ...JSON.parse(text), name: 'Renamed' } as Record<string, unknown>;
    expect(store.importText(JSON.stringify(renamed))).toMatchObject({ ok: true, status: 'unchanged' });
    expect(storage.writes).toBe(writes);
    expect(store.save(renamed, { replace: true })).toMatchObject({ ok: true, status: 'updated' });
    expect((store.list() as unknown as { entries: { summary: { name: string } }[] }).entries[0]!.summary.name).toBe('Renamed');
  });

  it('different geometry under a saved id is refused with a message and nothing is written', () => {
    const { store, storage } = make();
    const id = (store.save(drawn()) as { id: string }).id;
    const other = drawn(120, 60);
    other.id = id;
    const writes = storage.writes;
    const result = store.save(other, { replace: true });
    expect(result).toMatchObject({ ok: false, reason: 'conflict' });
    expect(storage.writes).toBe(writes);
  });
});

describe('invalid input is a message and never a write', () => {
  const bad: [string, (d: Record<string, unknown>) => unknown][] = [
    ['not an object', () => 5],
    ['an array', () => []],
    ['wrong format', (d) => ({ ...d, format: 'something-else' })],
    ['no format', (d) => ({ ...d, format: undefined })],
    ['wrong schema version', (d) => ({ ...d, schemaVersion: 2 })],
    ['no schema version', (d) => ({ ...d, schemaVersion: undefined })],
    ['bad id', (d) => ({ ...d, id: 'Bad Id!' })],
    ['an id that is too long', (d) => ({ ...d, id: 'a'.repeat(65) })],
    ['a wrongly typed outer boundary', (d) => ({ ...d, outer: 'no' })],
    ['too few gates', (d) => ({ ...d, gates: (d.gates as unknown[]).slice(0, 1) })],
    ['a gate off the road', (d) => ({ ...d, gates: (d.gates as { a: Vec2; b: Vec2 }[]).map((g, i) => (i === 3 ? { a: { x: g.a.x + 40, y: g.a.y }, b: g.b } : g)) })],
    ['a start off the road', (d) => ({ ...d, start: { position: { x: 1000, y: 1000 }, heading: 0 } })],
    ['a non-finite coordinate', (d) => ({ ...d, outer: [{ x: 'NaN', y: 0 }, ...(d.outer as unknown[]).slice(1)] })],
  ];
  for (const [name, mutate] of bad) {
    it(name, () => {
      const { store, storage } = make();
      const result = store.save(mutate(clone(drawn())));
      expect(result.ok).toBe(false);
      expect(storage.writes).toBe(0);
      expect(storage.data.size).toBe(0);
      expect(typeof (result as { message: string }).message).toBe('string');
    });
  }

  it('a corner too tight shows the validator message', () => {
    const doc = drawn();
    const tight = { ...doc, inner: (doc.inner as Vec2[]).map((p, i) => (i === 5 ? { x: p.x + 30, y: p.y + 30 } : p)) };
    const parsed = parseTrackText(JSON.stringify(tight), () => null);
    expect(parsed.ok).toBe(false);
    expect((parsed as { message: string }).message).toMatch(/^Invalid track:/);
  });

  it('text that is not JSON, empty, or too large is refused before any work', () => {
    const { store, storage } = make();
    for (const text of ['', 'nope', '{"a":', '[]', 'null', 'x'.repeat(MAX_TRACK_BYTES + 1)]) {
      const r = store.importText(text);
      expect(r.ok).toBe(false);
    }
    expect((store.importText('x'.repeat(MAX_TRACK_BYTES + 1)) as { message: string }).message).toBe(TRACK_MESSAGES.tooLarge);
    expect(storage.writes).toBe(0);
  });

  it('the size cap is exact: a document just under it is accepted, one over it is refused', () => {
    const doc = drawn();
    const base = JSON.stringify(doc);
    expect(parseTrackText(base, () => null).ok).toBe(true);
    const filler = (n: number): string => JSON.stringify({ ...doc, padding: 'x'.repeat(n) });
    // padding is a dropped unknown field: the canonical text is not larger, but the raw file text is capped before parsing
    expect(parseTrackText(filler(MAX_TRACK_BYTES - base.length - 20), () => null).ok).toBe(true);
    expect(parseTrackText(filler(MAX_TRACK_BYTES), () => null)).toMatchObject({ ok: false, message: TRACK_MESSAGES.tooLarge });
  });
});

describe('caps, damaged entries and failing storage', () => {
  it('keeps at most 20 tracks, and a re-save of one that is stored is not counted twice', () => {
    const { store } = make();
    for (let i = 0; i < MAX_TRACK_SAVES; i += 1) expect(store.save(drawn(60 + i * 4, 30 + i * 2, `t${i}`)).ok, `save ${i}`).toBe(true);
    expect(store.save(drawn(200, 100, 'one too many'))).toMatchObject({ ok: false, reason: 'full', message: TRACK_MESSAGES.full });
    expect(store.save(drawn(60, 30, 't0'), { replace: true })).toMatchObject({ ok: true });
    expect((store.list() as unknown as { entries: unknown[] }).entries).toHaveLength(MAX_TRACK_SAVES);
  });

  it('a damaged entry is listed with its reason, never loaded, never deleted, and never hides another save', () => {
    const { store, storage } = make();
    const good = (store.save(drawn()) as { id: string }).id;
    storage.setItem(`${TRACK_KEY_PREFIX}broken`, '{not json');
    storage.setItem(`${TRACK_KEY_PREFIX}wrong-id`, JSON.stringify({ ...drawn(), id: 'some-other-id' }));
    const hand = clone(drawn(100, 50));
    (hand.gates as unknown[]).length = 2;
    storage.setItem(`${TRACK_KEY_PREFIX}hand-edited`, JSON.stringify(hand));
    storage.setItem(TRACK_INDEX_KEY, JSON.stringify([good, 'ghost']));
    const entries = (store.list() as unknown as { entries: { id: string; status: string; problem?: string }[] }).entries;
    expect(entries.find((e) => e.id === good)!.status).toBe('ok');
    for (const id of ['broken', 'wrong-id', 'hand-edited', 'ghost']) expect(entries.find((e) => e.id === id)!.status, id).toBe('damaged');
    expect(entries.find((e) => e.id === 'ghost')!.problem).toMatch(/data is missing/);
    expect(store.load('broken').ok).toBe(false);
    expect(storage.data.has(`${TRACK_KEY_PREFIX}broken`)).toBe(true);
    expect(store.load(good).ok).toBe(true);
  });

  it('a damaged index is ignored and the keys are scanned; keys of models and checkpoints are never listed', () => {
    const { store, storage } = make();
    const id = (store.save(drawn()) as { id: string }).id;
    storage.setItem(TRACK_INDEX_KEY, '{{{');
    storage.setItem('sdae:model:abc', '{}');
    storage.setItem('sdae:models:index', '["abc"]');
    storage.setItem('sdae:checkpoint:x', '{}');
    expect((store.list() as unknown as { entries: { id: string }[] }).entries.map((e) => e.id)).toEqual([id]);
  });

  it('unavailable, full and throwing storage give messages, never exceptions, and write nothing', () => {
    const none = createTrackStore({ storage: () => null, screen });
    expect(none.list()).toEqual({ available: false, message: TRACK_MESSAGES.unavailable });
    expect(none.save(drawn())).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(none.load('x').ok).toBe(false);
    const throws = createTrackStore({ storage: () => { throw new Error('denied'); }, screen });
    expect(throws.list()).toMatchObject({ available: false });
    expect(throws.save(drawn())).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(throws.exportFile('x').ok).toBe(false);
    expect(throws.remove('x').ok).toBe(false);
    const { store, storage } = make();
    storage.failSet = Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    expect(store.save(drawn())).toMatchObject({ ok: false, reason: 'quota', message: TRACK_MESSAGES.quota });
    expect(storage.data.size).toBe(0);
    storage.failSet = new Error('nope');
    expect(store.save(drawn())).toMatchObject({ ok: false, reason: 'unavailable' });
  });

  it('a failing index write still saves the track, and the scan finds it', () => {
    const { store, storage } = make();
    const original = storage.setItem.bind(storage);
    storage.setItem = (key: string, value: string) => {
      if (key === TRACK_INDEX_KEY) throw new Error('index write failed');
      original(key, value);
    };
    const saved = store.save(drawn());
    expect(saved).toMatchObject({ ok: true, indexed: false });
    expect((store.list() as unknown as { entries: unknown[] }).entries).toHaveLength(1);
  });

  it('a failed load says why: nothing stored is "missing"; damaged, hand-edited, reserved or unreadable storage is "unreadable"', () => {
    const { store, storage } = make();
    const id = (store.save(drawn()) as { id: string }).id;
    expect(store.load(id).ok).toBe(true);
    expect(store.load('never-saved')).toMatchObject({ ok: false, kind: 'missing' });
    expect(store.load('A')).toMatchObject({ ok: false, kind: 'missing' });
    storage.setItem(`${TRACK_KEY_PREFIX}${id}`, '{not json');
    expect(store.load(id)).toMatchObject({ ok: false, kind: 'unreadable' });
    storage.setItem(`${TRACK_KEY_PREFIX}${id}`, JSON.stringify({ ...drawn(), id: 'some-other-id' }));
    expect(store.load(id)).toMatchObject({ ok: false, kind: 'unreadable' });
    const held = BUILT_IN_TRACK_SPLITS.tracks.find((t) => t.split === 'held-out')!;
    storage.setItem(`${TRACK_KEY_PREFIX}${id}`, JSON.stringify({ format: 'self-driving-ai-evolution/track', schemaVersion: 1, id, version: '1', name: 'x', outer: held.track.outer, inner: held.track.inner, start: held.track.start, gates: held.track.gates }));
    expect(store.load(id)).toMatchObject({ ok: false, kind: 'unreadable' });
    const throwing = createTrackStore({ storage: () => ({ ...storage, length: 0, key: () => null, getItem: () => { throw new Error('denied'); }, setItem: () => undefined, removeItem: () => undefined }), screen });
    expect(throwing.load(id)).toMatchObject({ ok: false, kind: 'unreadable' });
  });

  it('ids that are not valid keys are refused by load, export and remove', () => {
    const { store } = make();
    for (const id of ['', 'A', 'a/b', '../model', 'x'.repeat(65), 5 as unknown as string]) {
      expect(store.load(id).ok).toBe(false);
      expect(store.exportFile(id).ok).toBe(false);
      expect(store.remove(id).ok).toBe(false);
    }
  });
});

describe('the held-out boundary: an ID or layout of a built-in circuit is refused, with one generic message that names nothing', () => {
  const circuits = BUILT_IN_TRACK_SPLITS.tracks;
  const heldOut = circuits.filter((t) => t.split === 'held-out');
  const asDocument = (t: (typeof circuits)[number], over: Record<string, unknown> = {}): Record<string, unknown> => ({
    format: 'self-driving-ai-evolution/track',
    schemaVersion: 1,
    id: t.track.id,
    version: t.track.version,
    name: t.track.name,
    outer: t.track.outer,
    inner: t.track.inner,
    start: t.track.start,
    gates: t.track.gates,
    ...over,
  });

  it('there are held-out circuits to test with', () => {
    expect(heldOut.length).toBeGreaterThanOrEqual(3);
  });

  for (const t of circuits) {
    it(`${t.split} circuit ${t.id}: its own file, a copy under a new id, a relabelled copy and a copy with reversed keys are ALL refused with the one generic message`, () => {
      const { store, storage } = make();
      const variants: Record<string, unknown>[] = [
        asDocument(t),
        asDocument(t, { id: 'my-copy', name: 'My copy' }),
        asDocument(t, { id: 'my-copy', split: 'training' }),
        asDocument(t, { id: 'my-copy', split: 'validation', version: '99' }),
        asDocument(t, { id: 'my-copy', split: 'held-out' }),
        Object.fromEntries(Object.entries(asDocument(t, { id: 'my-copy' })).reverse()),
      ];
      for (const v of variants) {
        expect(store.importText(JSON.stringify(v))).toEqual({ ok: false, reason: 'invalid', message: RESERVED_LAYOUT_MESSAGE });
        expect(store.save(v)).toMatchObject({ ok: false, message: `This track could not be saved: ${RESERVED_LAYOUT_MESSAGE}` });
      }
      expect(storage.data.size).toBe(0);
    });

    it(`${t.split} circuit ${t.id}: the message never names a circuit or a split`, () => {
      const { store } = make();
      const message = (store.importText(JSON.stringify(asDocument(t))) as { message: string }).message;
      for (const c of circuits) expect(message).not.toContain(c.id);
      for (const word of ['held-out', 'validation', 'training']) expect(message.toLowerCase()).not.toContain(word);
    });
  }

  it('the refusal is identical whichever split matched, so trying a layout reveals nothing about which are held out', () => {
    const { store } = make();
    const outcomes = new Set(circuits.map((t) => JSON.stringify(store.importText(JSON.stringify(asDocument(t, { id: 'probe' }))))));
    expect(outcomes.size).toBe(1);
    expect(new Set(circuits.map((t) => t.split)).size).toBe(3);
  });

  it('a hand-edited stored track that has become a held-out layout is listed as damaged and never loaded', () => {
    const { store, storage } = make();
    const t = heldOut[0]!;
    storage.setItem(`${TRACK_KEY_PREFIX}sneaky`, JSON.stringify(asDocument(t, { id: 'sneaky' })));
    const entry = (store.list() as unknown as { entries: { id: string; status: string; problem?: string }[] }).entries[0]!;
    expect(entry).toMatchObject({ id: 'sneaky', status: 'damaged', problem: RESERVED_LAYOUT_MESSAGE });
    expect(store.load('sneaky').ok).toBe(false);
    expect(store.exportFile('sneaky').ok).toBe(false);
  });

  it('classifyCustomTrack never throws, whatever it is given', () => {
    for (const bad of [null, undefined, 5, {}, { id: 'x' }, { id: 'x', outer: 5 }]) expect(() => classifyCustomTrack(bad as never)).not.toThrow();
    // a value with no id is not a track: null and undefined are refused (the validator has already refused such a document before this runs)
    for (const bad of [null, undefined]) expect(classifyCustomTrack(bad as never)).toMatchObject({ ok: false });
  });

  it('a new layout is accepted', () => {
    expect(classifyCustomTrack(JSON.parse(JSON.stringify((buildTrack(editorState(ring(90, 45))) as unknown as { document: Track }).document)) as Track)).toEqual({ ok: true });
  });
});
