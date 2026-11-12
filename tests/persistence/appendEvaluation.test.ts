// P4-05: appending an evaluation entry to a saved model. The cap of 50 counts RECOGNISED entries only and applies only when
// appending; opaque entries of any number are kept untouched and never block an append; a refusal leaves the stored document
// byte-identical. Includes the legacy fixtures written before the entry format existed. Synthetic data, not results.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_EVALUATION_ENTRIES, recogniseEvaluations } from '../../src/persistence/evaluationEntry';
import { importModelText } from '../../src/persistence/modelImport';
import { MAX_MODEL_BYTES, type ModelDocument } from '../../src/persistence/modelFormat';
import { MODEL_KEY_PREFIX, createModelStore } from '../../src/persistence/modelStore';
import { entryBelongsTo } from '../../src/ui/modelEvaluation';
import { EVALUATION_TRACKS, MemoryStorage, TRAINING_REGISTRY, makeModel, realEntry } from '../helpers/evaluationFixtures';

const legacy = (name: string): string => readFileSync(new URL(`../fixtures/pre-p4-05/${name}`, import.meta.url), 'utf8');
const storeOn = (storage: MemoryStorage) => createModelStore({ storage: () => storage, registry: TRAINING_REGISTRY, evaluationTracks: EVALUATION_TRACKS, evaluationBinding: entryBelongsTo });
const stored = (storage: MemoryStorage, id: string) => storage.data.get(`${MODEL_KEY_PREFIX}${id}`)!;
const base = makeModel(11, 'ap-1');
const entry = realEntry(base, 'kidney-loop');
/** A copy of the base champion under another id, with an entry made FOR that champion (an entry belongs to its model). */
const asModel = (id: string): { model: ModelDocument; own: ReturnType<typeof realEntry> } => {
  const model: ModelDocument = { ...base, id };
  return { model, own: realEntry(model, 'kidney-loop') };
};
const nthOf = (own: ReturnType<typeof realEntry>, n: number) => Array.from({ length: n }, (_, i) => ({ ...own, recordedAt: `2026-11-12T12:00:${String(i).padStart(2, '0')}.000Z` }));
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
    ['a circuit that is not built in', { ...entry, track: { ...entry.track, id: 'not-a-built-in-circuit' } }],
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
    const { model: bigBase, own } = asModel('ap-big');
    // The champion fits under the limit, but not with this entry added (the entry is about half a kilobyte more than the slack).
    const slack = Math.floor(JSON.stringify(own).length / 2);
    const without = JSON.stringify({ ...bigBase, evaluation: [...opaque(120), { kind: 'legacy-blob', filler: '' }] }).length;
    const big: ModelDocument = { ...bigBase, evaluation: [...opaque(120), { kind: 'legacy-blob', filler: 'x'.repeat(MAX_MODEL_BYTES - without - slack) }] };
    expect(JSON.stringify(big).length).toBeLessThanOrEqual(MAX_MODEL_BYTES);
    const { storage, store } = setup(big);
    const text = stored(storage, 'ap-big');
    expect(store.appendEvaluation('ap-big', own)).toMatchObject({ ok: false, reason: 'size' });
    expect(stored(storage, 'ap-big')).toBe(text);
  });
  it('60 recognised entries: append REFUSED with the cap message, stored document byte-identical', () => {
    const { model, own } = asModel('ap-60');
    const { storage, store } = setup({ ...model, evaluation: nthOf(own, 60) });
    const text = stored(storage, 'ap-60');
    expect(store.appendEvaluation('ap-60', own)).toMatchObject({ ok: false, reason: 'cap' });
    expect(stored(storage, 'ap-60')).toBe(text);
    expect(recogniseEvaluations((JSON.parse(text) as ModelDocument).evaluation).entries).toHaveLength(60);
  });
  it('49 recognised + 60 opaque: ACCEPTED (the 50th), then the next is REFUSED; the opaque entries are untouched throughout', () => {
    const { model, own } = asModel('ap-mix');
    const mixed = [...nthOf(own, 49), ...opaque(60)];
    const { storage, store } = setup({ ...model, evaluation: mixed });
    expect(store.appendEvaluation('ap-mix', own)).toEqual({ ok: true, recognised: 50 });
    expect(store.appendEvaluation('ap-mix', own)).toMatchObject({ ok: false, reason: 'cap' });
    const after = (JSON.parse(stored(storage, 'ap-mix')) as ModelDocument).evaluation;
    expect(JSON.stringify(after.slice(0, 109))).toBe(JSON.stringify(mixed));
    expect(after).toHaveLength(110);
  });
  it('50 recognised + 5 opaque: REFUSED (the cap counts the 50 recognised only), byte-identical', () => {
    const { model, own } = asModel('ap-50');
    const { storage, store } = setup({ ...model, evaluation: [...nthOf(own, 50), ...opaque(5)] });
    const text = stored(storage, 'ap-50');
    expect(store.appendEvaluation('ap-50', own)).toMatchObject({ ok: false, reason: 'cap' });
    expect(stored(storage, 'ap-50')).toBe(text);
    expect(MAX_EVALUATION_ENTRIES).toBe(50);
  });
  it('40 entries that claim our kind but fail validation + 3 recognised: import not refused, a warning is shown, append ACCEPTED, nothing counted or shown', () => {
    const broken = Array.from({ length: 40 }, (_, i) => ({ kind: entry.kind, note: `broken ${i}` }));
    const { model: bare, own } = asModel('ap-bad');
    const model: ModelDocument = { ...bare, evaluation: [...broken, ...nthOf(own, 3)] };
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
    expect(store.appendEvaluation('ap-bad', own)).toEqual({ ok: true, recognised: 4 });
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

describe('an entry is stored only for the champion it was made for', () => {
  it('refuses an entry made for another champion, without writing', () => {
    const { storage, store } = setup(base);
    const other = makeModel(14, 'ap-other');
    const foreign = realEntry(other, 'kidney-loop');
    const text = stored(storage, base.id);
    const writes = storage.writes;
    const result = store.appendEvaluation(base.id, foreign);
    expect(result).toMatchObject({ ok: false, reason: 'invalid' });
    if (!result.ok) expect(result.message).toMatch(/was made for champion "ap-other", not this one/);
    expect(stored(storage, base.id)).toBe(text);
    expect(storage.writes).toBe(writes);
  });
  it('refuses an entry made for a champion that has since been replaced under the same id', () => {
    const { storage, store } = setup(base);
    const stale = entry; // made for `base`
    const changed = makeModel(15, base.id); // the same id, different parameters
    expect(store.save(changed).ok).toBe(true);
    const text = stored(storage, base.id);
    const result = store.appendEvaluation(base.id, stale);
    expect(result).toMatchObject({ ok: false, reason: 'invalid' });
    if (!result.ok) expect(result.message).toMatch(/different version of this champion/);
    expect(stored(storage, base.id)).toBe(text);
  });
  it('an existing entry that no longer belongs (an imported or stale one) is kept untouched, warned about and not counted or shown', () => {
    const changed = makeModel(16, 'ap-stale');
    const staleEntry = realEntry({ ...changed, id: 'ap-stale', training: { ...changed.training } }, 'kidney-loop');
    const replaced = makeModel(17, 'ap-stale');
    const { storage, store } = setup({ ...replaced, evaluation: [staleEntry, ...opaque(2)] });
    const loaded = store.load('ap-stale');
    if (!loaded.ok) throw new Error(loaded.message);
    expect(loaded.warnings.join(' ')).toMatch(/1 evaluation entry claims a kind this app recognises but is not valid for this champion/);
    expect(recogniseEvaluations(loaded.model.evaluation, { registry: EVALUATION_TRACKS, belongsTo: (e) => entryBelongsTo(loaded.model, e) }).entries).toHaveLength(0);
    const text = stored(storage, 'ap-stale');
    expect(JSON.parse(text).evaluation).toHaveLength(3); // untouched
    expect(store.appendEvaluation('ap-stale', realEntry(replaced, 'kidney-loop'))).toEqual({ ok: true, recognised: 1 });
  });
  it('a champion with a 100-character id stores and re-reads its entry', () => {
    const id = 'q'.repeat(100);
    const m = { ...base, id };
    const { storage, store } = setup(m);
    expect(store.appendEvaluation(id, realEntry(m, 'kidney-loop'))).toEqual({ ok: true, recognised: 1 });
    expect(JSON.parse(stored(storage, id)).evaluation).toHaveLength(1);
  });
});
