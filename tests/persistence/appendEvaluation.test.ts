// P4-05: appending an evaluation entry to a saved model. The cap of 50 counts RECOGNISED entries only and applies only when
// appending; opaque entries of any number are kept untouched and never block an append; a refusal leaves the stored document
// byte-identical. Includes the legacy fixtures written before the entry format existed. Synthetic data, not results.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_EVALUATION_ENTRIES, recogniseEvaluations } from '../../src/persistence/evaluationEntry';
import { importModelText } from '../../src/persistence/modelImport';
import { MAX_MODEL_BYTES, type ModelDocument } from '../../src/persistence/modelFormat';
import { MODEL_KEY_PREFIX, createModelStore } from '../../src/persistence/modelStore';
import { EVALUATION_TRACKS, MemoryStorage, TRAINING_REGISTRY, makeModel, realEntry } from '../helpers/evaluationFixtures';

const legacy = (name: string): string => readFileSync(new URL(`../fixtures/pre-p4-05/${name}`, import.meta.url), 'utf8');
const storeOn = (storage: MemoryStorage) => createModelStore({ storage: () => storage, registry: TRAINING_REGISTRY, evaluationTracks: EVALUATION_TRACKS });
const stored = (storage: MemoryStorage, id: string) => storage.data.get(`${MODEL_KEY_PREFIX}${id}`)!;
const base = makeModel(11, 'ap-1');
const entry = realEntry(base, 'kidney-loop');
const withEvaluation = (id: string, evaluation: unknown[]): ModelDocument => ({ ...base, id, evaluation });
const nth = (n: number) => Array.from({ length: n }, (_, i) => ({ ...entry, recordedAt: `2026-11-12T12:00:${String(i).padStart(2, '0')}.000Z` }));
const opaque = (n: number) => Array.from({ length: n }, (_, i) => ({ kind: 'legacy-note', index: i }));

function setup(model: ModelDocument) {
  const storage = new MemoryStorage();
  const store = storeOn(storage);
  const saved = store.save(model);
  if (!saved.ok) throw new Error(saved.message);
  return { storage, store };
}

describe('appending', () => {
  it('adds a valid entry, keeps everything else as it was, and the model exports and re-imports identically', () => {
    const { storage, store } = setup(base);
    const before = JSON.parse(stored(storage, base.id)) as ModelDocument;
    const result = store.appendEvaluation(base.id, entry);
    expect(result).toEqual({ ok: true, recognised: 1 });
    const after = JSON.parse(stored(storage, base.id)) as ModelDocument;
    expect({ ...after, evaluation: [] }).toEqual({ ...before, evaluation: [] });
    expect(after.evaluation).toEqual([entry]);
    const out = store.exportFile(base.id);
    if (!out.ok) throw new Error(out.message);
    const again = importModelText(out.text, { registry: TRAINING_REGISTRY });
    if (!again.ok) throw new Error(again.errors.join(' '));
    expect(again.model.evaluation).toEqual([entry]);
    expect(recogniseEvaluations(again.model.evaluation).entries).toHaveLength(1);
  });
  it('leaves other saved models untouched', () => {
    const { storage, store } = setup(base);
    const other = makeModel(12, 'ap-2');
    store.save(other);
    const otherText = stored(storage, 'ap-2');
    expect(store.appendEvaluation(base.id, entry).ok).toBe(true);
    expect(stored(storage, 'ap-2')).toBe(otherText);
  });
  it.each<[string, unknown]>([
    ['a held-out split', { ...entry, track: { ...entry.track, split: 'held-out' } }],
    ['a circuit that is not built in', { ...entry, track: { ...entry.track, id: 'hairpin-chicane' } }],
    ['a tampered summary', { ...entry, summary: { ...entry.summary, lapCompletion: 1 } }],
    ['not an object', 'text'],
  ])('refuses an entry with %s and writes nothing', (_name, bad) => {
    const { storage, store } = setup(base);
    const text = stored(storage, base.id);
    const writes = storage.writes;
    const result = store.appendEvaluation(base.id, bad);
    expect(result).toMatchObject({ ok: false, reason: 'invalid' });
    expect(stored(storage, base.id)).toBe(text);
    expect(storage.writes).toBe(writes);
  });
  it('reports a missing model, a damaged storage and a full storage, each leaving the document byte-identical', () => {
    const { storage, store } = setup(base);
    expect(store.appendEvaluation('nope', entry)).toMatchObject({ ok: false, reason: 'missing' });
    const text = stored(storage, base.id);
    storage.failSet = Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    expect(store.appendEvaluation(base.id, entry)).toMatchObject({ ok: false, reason: 'quota' });
    storage.failSet = new Error('denied');
    expect(store.appendEvaluation(base.id, entry)).toMatchObject({ ok: false, reason: 'unavailable' });
    storage.failSet = null;
    expect(stored(storage, base.id)).toBe(text);
    expect(createModelStore({ storage: () => { throw new Error('denied'); }, registry: TRAINING_REGISTRY }).appendEvaluation(base.id, entry)).toMatchObject({ ok: false, reason: 'unavailable' });
  });
});

describe('the cap counts recognised entries only (fixtures round-trip byte for byte)', () => {
  it('51 opaque legacy entries: append ACCEPTED; the 51 stay byte-identical and the array has 52', () => {
    const imported = importModelText(legacy('champion-opaque-51.json'), { registry: TRAINING_REGISTRY });
    if (!imported.ok) throw new Error(imported.errors.join(' '));
    const { storage, store } = setup(imported.model);
    const own = realEntry(imported.model, 'kidney-loop');
    expect(store.appendEvaluation(imported.model.id, own)).toEqual({ ok: true, recognised: 1 });
    const after = (JSON.parse(stored(storage, imported.model.id)) as ModelDocument).evaluation;
    expect(after).toHaveLength(52);
    expect(JSON.stringify(after.slice(0, 51))).toBe(JSON.stringify(imported.model.evaluation));
  });
  it('120 opaque legacy entries: append ACCEPTED', () => {
    const imported = importModelText(legacy('champion-opaque-120.json'), { registry: TRAINING_REGISTRY });
    if (!imported.ok) throw new Error(imported.errors.join(' '));
    const { storage, store } = setup(imported.model);
    expect(store.appendEvaluation(imported.model.id, realEntry(imported.model, 's-sweepers')).ok).toBe(true);
    expect((JSON.parse(stored(storage, imported.model.id)) as ModelDocument).evaluation).toHaveLength(121);
  });
  it('120 opaque entries near the size limit: refused with the size message, stored document byte-identical', () => {
    const filler = 'x'.repeat(MAX_MODEL_BYTES - JSON.stringify({ ...base, id: 'ap-big', evaluation: opaque(120) }).length - 400);
    const big = withEvaluation('ap-big', [...opaque(120), { kind: 'legacy-blob', filler }]);
    const { storage, store } = setup(big);
    const text = stored(storage, 'ap-big');
    expect(store.appendEvaluation('ap-big', entry)).toMatchObject({ ok: false, reason: 'size' });
    expect(stored(storage, 'ap-big')).toBe(text);
  });
  it('60 recognised entries: append REFUSED with the cap message, stored document byte-identical', () => {
    const { storage, store } = setup(withEvaluation('ap-60', nth(60)));
    const text = stored(storage, 'ap-60');
    expect(store.appendEvaluation('ap-60', entry)).toMatchObject({ ok: false, reason: 'cap' });
    expect(stored(storage, 'ap-60')).toBe(text);
    expect(recogniseEvaluations((JSON.parse(text) as ModelDocument).evaluation).entries).toHaveLength(60);
  });
  it('49 recognised + 60 opaque: ACCEPTED (the 50th), then the next is REFUSED; the opaque entries are untouched throughout', () => {
    const mixed = [...nth(49), ...opaque(60)];
    const { storage, store } = setup(withEvaluation('ap-mix', mixed));
    expect(store.appendEvaluation('ap-mix', entry)).toEqual({ ok: true, recognised: 50 });
    expect(store.appendEvaluation('ap-mix', entry)).toMatchObject({ ok: false, reason: 'cap' });
    const after = (JSON.parse(stored(storage, 'ap-mix')) as ModelDocument).evaluation;
    expect(JSON.stringify(after.slice(0, 109))).toBe(JSON.stringify(mixed));
    expect(after).toHaveLength(110);
  });
  it('50 recognised + 5 opaque: REFUSED (the cap counts the 50 recognised only), byte-identical', () => {
    const { storage, store } = setup(withEvaluation('ap-50', [...nth(50), ...opaque(5)]));
    const text = stored(storage, 'ap-50');
    expect(store.appendEvaluation('ap-50', entry)).toMatchObject({ ok: false, reason: 'cap' });
    expect(stored(storage, 'ap-50')).toBe(text);
    expect(MAX_EVALUATION_ENTRIES).toBe(50);
  });
  it('40 entries that claim our kind but fail validation + 3 recognised: import not refused, a warning is shown, append ACCEPTED, nothing counted or shown', () => {
    const broken = Array.from({ length: 40 }, (_, i) => ({ kind: entry.kind, note: `broken ${i}` }));
    const model = withEvaluation('ap-bad', [...broken, ...nth(3)]);
    const text = JSON.stringify(model, null, 2);
    const imported = importModelText(text, { registry: TRAINING_REGISTRY });
    expect(imported.ok).toBe(true);
    const { store } = setup(model);
    const loaded = store.load('ap-bad');
    if (!loaded.ok) throw new Error(loaded.message);
    expect(loaded.warnings.join(' ')).toMatch(/40 evaluation entries claim a kind this app recognises/);
    const r = recogniseEvaluations(loaded.model.evaluation);
    expect(r.entries).toHaveLength(3);
    expect(r.invalidClaims).toBe(40);
    expect(store.appendEvaluation('ap-bad', entry)).toEqual({ ok: true, recognised: 4 });
  });
  it('the legacy fixtures still round-trip byte for byte after an append is refused or accepted elsewhere', () => {
    for (const name of ['champion-opaque-51.json', 'champion-opaque-120.json']) {
      const text = legacy(name);
      const imported = importModelText(text, { registry: TRAINING_REGISTRY });
      if (!imported.ok) throw new Error(imported.errors.join(' '));
      const { store } = setup(imported.model);
      const out = store.exportFile(imported.model.id);
      if (!out.ok) throw new Error(out.message);
      expect(out.text).toBe(text);
    }
  });
});
