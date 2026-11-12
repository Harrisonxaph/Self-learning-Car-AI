// P4-03: appending evaluation entries for saved custom tracks to a saved model, through the real model store with the saved-track lookup
// injected. While the track is saved the entry must be for it; after it is deleted the entry stays recognised (structurally checked);
// built-in-circuit entries and the legacy-array rules are unchanged. Synthetic data, not results.
import { describe, expect, it } from 'vitest';
import { addPoint, buildTrack, closeLoop, createEditorState } from '../../src/editor/trackEditor';
import { createModelStore } from '../../src/persistence/modelStore';
import { loadTrack, type Track, type Vec2 } from '../../src/sim/track';
import { trackGeometryHash } from '../../src/training/trackSplits';
import { MODEL_KEY_PREFIX } from '../../src/persistence/modelStore';
import { evaluateModelOnCircuit, entryBelongsTo } from '../../src/ui/modelEvaluation';
import { EVALUATION_TRACKS, MemoryStorage, OPTIONS, TRAINING_REGISTRY, makeModel } from '../helpers/evaluationFixtures';

const ring = (rx: number, ry: number, n = 10): Vec2[] => Array.from({ length: n }, (_, i) => ({ x: Math.round(rx * Math.cos((2 * Math.PI * i) / n)), y: Math.round(ry * Math.sin((2 * Math.PI * i) / n)) }));
function custom(rx: number, ry: number): Track {
  let state = createEditorState({ snap: 0 });
  for (const p of ring(rx, ry)) {
    const r = addPoint(state, p);
    if (!r.ok) throw new Error(r.message);
    state = r.state;
  }
  const c = closeLoop(state);
  if (!c.ok) throw new Error(c.message);
  const built = buildTrack(c.state);
  if ('message' in built) throw new Error(built.message);
  return loadTrack(built.document);
}

const model = makeModel(5, 'ac-1');
const saved: { tracks: Track[] } = { tracks: [custom(90, 45)] };
const lookup = (id: string) => {
  const t = saved.tracks.find((x) => x.id === id);
  return t ? { id: t.id, version: t.version, split: 'custom', contentHash: trackGeometryHash(t), track: t } : null;
};
const storage = () => new MemoryStorage();
const storeOn = (s: MemoryStorage) => createModelStore({ storage: () => s, registry: TRAINING_REGISTRY, evaluationTracks: EVALUATION_TRACKS, evaluationBinding: entryBelongsTo, evaluationCustom: lookup });
const entryFor = (track: Track) => {
  const r = evaluateModelOnCircuit(model, track.id, { ...OPTIONS, customTracks: (id) => saved.tracks.find((t) => t.id === id) ?? null });
  if (!r.ok) throw new Error(r.message);
  return r.entry;
};

describe('appending an entry for a saved custom track', () => {
  it('is accepted while the track is saved, stays recognised after the track is deleted, and is refused if another track now has its id', () => {
    saved.tracks = [custom(90, 45)];
    const entry = entryFor(saved.tracks[0]!);
    const s = storage();
    const store = storeOn(s);
    expect(store.save(model).ok).toBe(true);
    expect(store.appendEvaluation(model.id, entry)).toEqual({ ok: true, recognised: 1 });
    // deleted track: the entry is still recognised and the model loads without a warning about it
    const deleted = saved.tracks;
    saved.tracks = [];
    const loaded = store.load(model.id);
    expect(loaded.ok && loaded.warnings.filter((w) => /evaluation/.test(w))).toEqual([]);
    expect(store.appendEvaluation(model.id, { ...entry, recordedAt: '2026-11-12T12:01:00.000Z' })).toEqual({ ok: true, recognised: 2 });
    // another layout saved under the same id: the old entries no longer match it, so they are claims kept untouched (and a new append of them is refused)
    saved.tracks = [{ ...custom(120, 60), id: deleted[0]!.id }];
    const before = s.data.get(`${MODEL_KEY_PREFIX}${model.id}`);
    expect(store.appendEvaluation(model.id, entry)).toMatchObject({ ok: false, reason: 'invalid' });
    expect(s.data.get(`${MODEL_KEY_PREFIX}${model.id}`)).toBe(before);
    const reloaded = store.load(model.id);
    expect(reloaded.ok && reloaded.warnings.some((w) => /claim/.test(w))).toBe(true);
  });

  it('an entry with an altered hash is refused while the track is saved, and writes nothing', () => {
    saved.tracks = [custom(90, 45)];
    const entry = entryFor(saved.tracks[0]!);
    const s = storage();
    const store = storeOn(s);
    store.save(model);
    const before = s.data.get(`${MODEL_KEY_PREFIX}${model.id}`);
    const forged = { ...entry, track: { ...entry.track, contentHash: `sha256:${'2'.repeat(64)}` } };
    expect(store.appendEvaluation(model.id, forged)).toMatchObject({ ok: false, reason: 'invalid' });
    expect(s.data.get(`${MODEL_KEY_PREFIX}${model.id}`)).toBe(before);
  });

  it('a store with no custom lookup (an older wiring) treats custom entries structurally and built-in ones as before', () => {
    saved.tracks = [custom(90, 45)];
    const entry = entryFor(saved.tracks[0]!);
    const s = storage();
    const plain = createModelStore({ storage: () => s, registry: TRAINING_REGISTRY, evaluationTracks: EVALUATION_TRACKS, evaluationBinding: entryBelongsTo });
    plain.save(model);
    expect(plain.appendEvaluation(model.id, entry)).toEqual({ ok: true, recognised: 1 });
  });
});
