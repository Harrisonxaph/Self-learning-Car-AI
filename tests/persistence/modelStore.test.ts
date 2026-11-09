// Saved champions in localStorage (P3-05): round trip, every failure of the browser's storage, damaged and orphan entries,
// the cap, and write order. Fakes only: the real localStorage is exercised by the browser tests.
import { describe, expect, it } from 'vitest';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS, terminalSpeed, type VehiclePhysics } from '../../src/sim/config';
import { loadTrack } from '../../src/sim/track';
import { buildModel, MAX_MODEL_BYTES, modelParameters, validateModel, type ModelDocument } from '../../src/persistence/modelFormat';
import { createModelStore, exportFilename, INDEX_KEY, MAX_SAVES, MESSAGES, MODEL_KEY_PREFIX, type StorageLike } from '../../src/persistence/modelStore';
import { tracksIn } from '../../src/training/trackSplits';
import { createTrainer, DEFAULT_TRAINING_CONFIG } from '../../src/training/trainer';

const ENV = { track: loadTrack(stadiumOval), physics: DEFAULT_VEHICLE_PHYSICS, timestepSeconds: DEFAULT_SIM_CONFIG.timestepSeconds };
const trainer = createTrainer({ ...DEFAULT_TRAINING_CONFIG, seed: 3, populationSize: 8, eliteCount: 2, maxEpisodeSeconds: 15 }, ENV);
const stats = trainer.runGeneration();
const REGISTRY = tracksIn('training');

const model = (id: string, overrides: { name?: string } = {}): ModelDocument =>
  buildModel({ champion: stats.champion, fitness: stats.bestFitness, generation: stats.generation, record: trainer.record(), id, createdAt: '2026-11-08T22:00:00.000Z', codeVersion: 'test', name: overrides.name ?? `Champion ${id}` });

/** A localStorage stand-in that records every write and can fail on demand. */
class FakeStorage implements StorageLike {
  readonly data = new Map<string, string>();
  readonly writes: string[] = [];
  failGet: (key: string) => unknown = () => null;
  failSet: (key: string) => unknown = () => null;
  failRemove: (key: string) => unknown = () => null;
  failScan = false;
  getItem(key: string) {
    const error = this.failGet(key);
    if (error) throw error;
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    const error = this.failSet(key);
    if (error) throw error;
    this.writes.push(key);
    this.data.set(key, value);
  }
  removeItem(key: string) {
    const error = this.failRemove(key);
    if (error) throw error;
    this.data.delete(key);
  }
  get length() {
    if (this.failScan) throw new Error('scan failed');
    return this.data.size;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
}
const quota = (name = 'QuotaExceededError') => Object.assign(new Error('full'), { name });
const setup = () => {
  const storage = new FakeStorage();
  const store = createModelStore({ storage: () => storage, registry: REGISTRY });
  return { storage, store };
};
const ids = (store: ReturnType<typeof setup>['store']) => {
  const listing = store.list();
  if (!listing.available) throw new Error('unavailable');
  return listing.entries.map((e) => e.id);
};

describe('an empty store', () => {
  it('lists nothing, without an error', () => {
    const { store } = setup();
    expect(store.list()).toEqual({ available: true, entries: [], partial: false });
  });
  it('says plainly that an unknown or missing save cannot be used', () => {
    const { store } = setup();
    expect(store.load('nope')).toEqual({ ok: false, message: expect.stringContaining("can't be used") });
    expect(store.load('../evil')).toEqual({ ok: false, message: 'That is not a saved champion.' });
  });
  it('treats a store cleared behind its back as an empty list', () => {
    const { store, storage } = setup();
    store.save(model('a'));
    storage.data.clear();
    expect(store.list()).toEqual({ available: true, entries: [], partial: false });
  });
});

describe('save, list and load', () => {
  it('round-trips a champion bit for bit and lists its summary', () => {
    const { store, storage } = setup();
    const original = model('abc', { name: 'My best' });
    expect(store.save(original)).toEqual({ ok: true, indexed: true });
    expect(JSON.parse(storage.data.get(INDEX_KEY)!)).toEqual(['abc']);
    expect(storage.data.has(`${MODEL_KEY_PREFIX}abc`)).toBe(true);
    const listing = store.list();
    expect(listing).toMatchObject({ available: true, entries: [{ id: 'abc', status: 'ok', summary: { name: 'My best', generation: stats.generation, fitness: stats.bestFitness }, warnings: [], drivable: true }] });
    const loaded = store.load('abc');
    if (!loaded.ok) throw new Error(loaded.message);
    expect(loaded.model).toEqual(original);
    const a = modelParameters(loaded.model);
    stats.champion.forEach((v, i) => expect(Object.is(a[i], v === 0 ? 0 : v)).toBe(true));
  });

  it('writes the model first and the index second', () => {
    const { store, storage } = setup();
    store.save(model('one'));
    expect(storage.writes).toEqual([`${MODEL_KEY_PREFIX}one`, INDEX_KEY]);
  });

  it('keeps saves in the order they were made and does not duplicate an overwritten one', () => {
    const { store } = setup();
    for (const id of ['b', 'a', 'c']) store.save(model(id));
    expect(ids(store)).toEqual(['b', 'a', 'c']);
    store.save(model('a', { name: 'renamed' }));
    expect(ids(store)).toEqual(['b', 'a', 'c']);
    const entry = (store.list() as unknown as { entries: { id: string; summary: { name: string } }[] }).entries[1]!;
    expect(entry.summary.name).toBe('renamed');
  });

  it('ignores keys that are not model keys', () => {
    const { store, storage } = setup();
    storage.data.set('other:thing', 'x');
    storage.data.set(`${MODEL_KEY_PREFIX}bad id`, '{}');
    store.save(model('ok1'));
    expect(ids(store)).toEqual(['ok1']);
    expect(storage.data.get('other:thing')).toBe('x');
  });

  it('refuses to save a model that does not validate, and writes nothing', () => {
    const { store, storage } = setup();
    const bad = model('bad') as unknown as { parameters: { values: number[] } };
    bad.parameters.values.pop();
    const result = store.save(bad as unknown as ModelDocument);
    expect(result).toMatchObject({ ok: false, reason: 'invalid' });
    expect(storage.writes).toEqual([]);
  });

  it('validates what was stored again on load, and changes nothing when it fails', () => {
    const { store, storage } = setup();
    store.save(model('t'));
    const doc = JSON.parse(storage.data.get(`${MODEL_KEY_PREFIX}t`)!);
    doc.parameters.values[5] = null;
    storage.data.set(`${MODEL_KEY_PREFIX}t`, JSON.stringify(doc));
    const before = [...storage.data.entries()];
    const loaded = store.load('t');
    expect(loaded.ok).toBe(false);
    expect(!loaded.ok && loaded.message).toContain('values[5]');
    expect([...storage.data.entries()]).toEqual(before);
  });
});

describe('browser storage that fails', () => {
  it('reports a throwing storage accessor everywhere, never throwing', () => {
    const store = createModelStore({
      storage: () => {
        throw new Error('SecurityError');
      },
      registry: REGISTRY,
    });
    expect(store.list()).toEqual({ available: false, message: MESSAGES.unavailable });
    expect(store.save(model('a'))).toEqual({ ok: false, reason: 'unavailable', message: MESSAGES.unavailable });
    expect(store.load('a')).toEqual({ ok: false, message: MESSAGES.unavailable });
    expect(store.remove('a')).toEqual({ ok: false, message: MESSAGES.unavailable });
  });
  it('reports a missing storage object (null) the same way', () => {
    const store = createModelStore({ storage: () => null, registry: REGISTRY });
    expect(store.list()).toEqual({ available: false, message: MESSAGES.unavailable });
  });
  it('says the browser storage is unavailable when setItem throws, and leaves earlier saves alone', () => {
    const { store, storage } = setup();
    store.save(model('keep'));
    const before = [...storage.data.entries()];
    storage.failSet = () => new Error('denied');
    expect(store.save(model('new'))).toEqual({ ok: false, reason: 'unavailable', message: MESSAGES.unavailable });
    expect([...storage.data.entries()]).toEqual(before);
    storage.failSet = () => null;
    expect(ids(store)).toEqual(['keep']);
  });
  it.each([
    ['QuotaExceededError', quota()],
    ['a Firefox quota error', quota('NS_ERROR_DOM_QUOTA_REACHED')],
    ['code 22', Object.assign(new Error('x'), { code: 22 })],
    ['code 1014', Object.assign(new Error('x'), { code: 1014 })],
  ])('reports %s as a full store', (_name, error) => {
    const { store, storage } = setup();
    storage.failSet = () => error;
    expect(store.save(model('q'))).toEqual({ ok: false, reason: 'quota', message: MESSAGES.quota });
  });
  it('keeps a save whose index write failed, and finds it as a recovered entry', () => {
    const { store, storage } = setup();
    storage.failSet = (key) => (key === INDEX_KEY ? quota() : null);
    expect(store.save(model('orphan'))).toEqual({ ok: true, indexed: false });
    storage.failSet = () => null;
    expect(storage.data.has(INDEX_KEY)).toBe(false);
    expect(ids(store)).toEqual(['orphan']);
    expect(store.load('orphan').ok).toBe(true);
    store.save(model('next'));
    expect(JSON.parse(storage.data.get(INDEX_KEY)!)).toEqual(['orphan', 'next']);
  });
  it('lists from the index alone when the storage cannot be scanned, and from a scan when the index cannot be read', () => {
    const { store, storage } = setup();
    store.save(model('a'));
    store.save(model('b'));
    storage.failScan = true;
    expect(ids(store)).toEqual(['a', 'b']);
    storage.failScan = false;
    storage.failGet = (key) => (key === INDEX_KEY ? new Error('boom') : null);
    expect(ids(store)).toEqual(['a', 'b']);
  });
  it('reports a model that cannot be read as damaged and still lists the others', () => {
    const { store, storage } = setup();
    store.save(model('a'));
    store.save(model('b'));
    storage.failGet = (key) => (key.endsWith('a') ? new Error('read failed') : null);
    const listing = store.list();
    expect(listing).toMatchObject({ entries: [{ id: 'a', status: 'damaged' }, { id: 'b', status: 'ok' }] });
  });
  it('reports a failing removal, and removes nothing else', () => {
    const { store, storage } = setup();
    store.save(model('a'));
    storage.failRemove = () => new Error('denied');
    expect(store.remove('a')).toEqual({ ok: false, message: MESSAGES.unavailable });
    expect(ids(store)).toEqual(['a']);
  });
});

describe('inaccessible storage is not an empty store', () => {
  it('reports unavailable when both the index and the key enumeration throw', () => {
    const { store, storage } = setup();
    store.save(model('a'));
    storage.failGet = () => new Error('denied');
    storage.failScan = true;
    expect(store.list()).toEqual({ available: false, message: MESSAGES.unavailable });
    expect(store.save(model('b'))).toEqual({ ok: false, reason: 'unavailable', message: MESSAGES.unavailable });
  });
  it('reports unavailable when every read throws and nothing can be enumerated either', () => {
    const storage = new FakeStorage();
    storage.failGet = () => new Error('denied');
    storage.failScan = true;
    const store = createModelStore({ storage: () => storage, registry: REGISTRY });
    expect(store.list()).toEqual({ available: false, message: MESSAGES.unavailable });
  });
  it('still lists what it can read, and says it is partial, when only the index read throws', () => {
    const { store, storage } = setup();
    store.save(model('a'));
    store.save(model('b'));
    storage.failGet = (key) => (key === INDEX_KEY ? new Error('boom') : null);
    expect(store.list()).toMatchObject({ available: true, partial: true, entries: [{ id: 'a', status: 'ok' }, { id: 'b', status: 'ok' }] });
  });
  it('still lists the indexed saves, and says it is partial, when only the key enumeration throws', () => {
    const { store, storage } = setup();
    store.save(model('a'));
    storage.failScan = true;
    expect(store.list()).toMatchObject({ available: true, partial: true, entries: [{ id: 'a', status: 'ok' }] });
  });
  it('lists models that cannot be read as damaged, partial only if the index or scan failed', () => {
    const { store, storage } = setup();
    store.save(model('a'));
    storage.failGet = (key) => (key.startsWith(MODEL_KEY_PREFIX) ? new Error('read failed') : null);
    expect(store.list()).toMatchObject({ available: true, partial: false, entries: [{ id: 'a', status: 'damaged' }] });
  });
  it('is not partial for an ordinary empty or healthy store', () => {
    const { store } = setup();
    expect(store.list()).toMatchObject({ available: true, partial: false });
    store.save(model('a'));
    expect(store.list()).toMatchObject({ available: true, partial: false });
  });
});

describe('damaged and recovered entries', () => {
  it.each([
    ['not JSON', 'not json at all'],
    ['JSON but not an object', '[1,2,3]'],
    ['an empty string', ''],
    ['a model that fails validation', JSON.stringify({ format: 'self-driving-ai-evolution/model', schemaVersion: 1 })],
    ['a model from a newer version', JSON.stringify({ format: 'self-driving-ai-evolution/model', schemaVersion: 2 })],
  ])('shows %s as damaged, and keeps every other save usable', (_name, text) => {
    const { store, storage } = setup();
    store.save(model('good1'));
    store.save(model('good2'));
    storage.data.set(`${MODEL_KEY_PREFIX}bad`, text);
    const listing = store.list();
    if (!listing.available) throw new Error('unavailable');
    expect(listing.entries.map((e) => [e.id, e.status])).toEqual([['good1', 'ok'], ['good2', 'ok'], ['bad', 'damaged']]);
    expect(store.load('good1').ok && store.load('good2').ok).toBe(true);
    expect(store.load('bad').ok).toBe(false);
  });
  it('does not parse an oversized entry', () => {
    const { store, storage } = setup();
    storage.data.set(`${MODEL_KEY_PREFIX}huge`, `"${'x'.repeat(MAX_MODEL_BYTES)}"`);
    const entry = (store.list() as unknown as { entries: { problem: string }[] }).entries[0]!;
    expect(entry.problem).toContain('1 MiB');
    const loaded = store.load('huge');
    expect(!loaded.ok && loaded.message).toContain('1 MiB');
  });
  it('shows an index entry whose model is gone as damaged, and can remove it', () => {
    const { store, storage } = setup();
    store.save(model('a'));
    storage.data.set(INDEX_KEY, JSON.stringify(['a', 'ghost']));
    expect(store.list()).toMatchObject({ entries: [{ id: 'a', status: 'ok' }, { id: 'ghost', status: 'damaged', problem: expect.stringContaining('missing') }] });
    expect(store.remove('ghost')).toEqual({ ok: true });
    expect(ids(store)).toEqual(['a']);
  });
  it.each([
    ['not JSON', 'oops'],
    ['not an array', '{"a":1}'],
    ['holding an invalid id', '["a","b c"]'],
  ])('rebuilds a damaged index (%s) from the stored models, and repairs it on the next save', (_name, text) => {
    const { store, storage } = setup();
    store.save(model('b'));
    store.save(model('a'));
    storage.data.set(INDEX_KEY, text);
    expect(ids(store).sort()).toEqual(['a', 'b']);
    store.save(model('c'));
    expect(JSON.parse(storage.data.get(INDEX_KEY)!).sort()).toEqual(['a', 'b', 'c']);
  });
  it('removes a damaged entry without touching the rest', () => {
    const { store, storage } = setup();
    store.save(model('a'));
    storage.data.set(`${MODEL_KEY_PREFIX}junk`, '???');
    const other = storage.data.get(`${MODEL_KEY_PREFIX}a`);
    expect(store.remove('junk')).toEqual({ ok: true });
    expect(ids(store)).toEqual(['a']);
    expect(storage.data.get(`${MODEL_KEY_PREFIX}a`)).toBe(other);
  });
});

describe('the cap on saves', () => {
  it('keeps 20, then asks to delete one without writing or deleting anything', () => {
    const { store, storage } = setup();
    for (let i = 0; i < MAX_SAVES; i += 1) expect(store.save(model(`m${i}`)).ok).toBe(true);
    const before = [...storage.data.entries()];
    const writes = storage.writes.length;
    expect(store.save(model('extra'))).toEqual({ ok: false, reason: 'full', message: MESSAGES.full });
    expect(storage.writes).toHaveLength(writes);
    expect([...storage.data.entries()]).toEqual(before);
    expect(ids(store)).toHaveLength(MAX_SAVES);
  });
  it('allows overwriting a save when full, and saving again after a delete', () => {
    const { store } = setup();
    for (let i = 0; i < MAX_SAVES; i += 1) store.save(model(`m${i}`));
    expect(store.save(model('m3', { name: 'again' })).ok).toBe(true);
    expect(store.remove('m0')).toEqual({ ok: true });
    expect(store.save(model('extra')).ok).toBe(true);
    expect(ids(store)).toHaveLength(MAX_SAVES);
  });
  it('counts damaged entries, which the person can delete', () => {
    const { store, storage } = setup();
    for (let i = 0; i < MAX_SAVES - 1; i += 1) store.save(model(`m${i}`));
    storage.data.set(`${MODEL_KEY_PREFIX}junk`, '???');
    expect(store.save(model('extra'))).toMatchObject({ ok: false, reason: 'full' });
    store.remove('junk');
    expect(store.save(model('extra')).ok).toBe(true);
  });
});

describe('compatibility on load', () => {
  const stored = (store: ReturnType<typeof setup>['store'], storage: FakeStorage, edit: (d: any) => void) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    store.save(model('c'));
    const doc = JSON.parse(storage.data.get(`${MODEL_KEY_PREFIX}c`)!);
    edit(doc);
    storage.data.set(`${MODEL_KEY_PREFIX}c`, JSON.stringify(doc));
  };
  it('loads a model made with other physics, with a warning, and lists the warning', () => {
    const { store, storage } = setup();
    stored(store, storage, (d) => {
      d.training.configuration.physics.engineAcceleration = 9;
      d.training.configuration.physics.maxSpeed = terminalSpeed(d.training.configuration.physics as VehiclePhysics);
    });
    const loaded = store.load('c');
    expect(loaded.ok && loaded.warnings).toHaveLength(1);
    expect(store.list()).toMatchObject({ entries: [{ id: 'c', status: 'ok', drivable: true, warnings: [expect.stringContaining('physics')] }] });
  });
  it('refuses a model for another simulation version, with the reason, and lists it as not drivable', () => {
    const { store, storage } = setup();
    stored(store, storage, (d) => (d.simulationVersion = 2));
    const loaded = store.load('c');
    expect(!loaded.ok && loaded.message).toContain('simulation version 2');
    expect(store.list()).toMatchObject({ entries: [{ id: 'c', status: 'ok', drivable: false }] });
  });
});

describe('seeds and reproducibility', () => {
  it('lists a seeded save as reproducible and a legacy unseeded one as not', () => {
    const { store, storage } = setup();
    store.save(model('seeded'));
    store.save(model('legacy'));
    const doc = JSON.parse(storage.data.get(`${MODEL_KEY_PREFIX}legacy`)!);
    doc.training.seed = null;
    doc.training.seedUnavailableReason = 'imported from an unseeded run';
    storage.data.set(`${MODEL_KEY_PREFIX}legacy`, JSON.stringify(doc));
    expect(store.list()).toMatchObject({ entries: [{ id: 'seeded', summary: { reproducible: true } }, { id: 'legacy', status: 'ok', summary: { reproducible: false } }] });
  });
});

describe('remove', () => {
  it('removes the model and its index entry only', () => {
    const { store, storage } = setup();
    store.save(model('a'));
    store.save(model('b'));
    expect(store.remove('a')).toEqual({ ok: true });
    expect(storage.data.has(`${MODEL_KEY_PREFIX}a`)).toBe(false);
    expect(JSON.parse(storage.data.get(INDEX_KEY)!)).toEqual(['b']);
    expect(ids(store)).toEqual(['b']);
  });
  it('refuses an id that is not a saved champion', () => {
    const { store } = setup();
    expect(store.remove('a/b')).toEqual({ ok: false, message: 'That is not a saved champion.' });
  });
});

describe('exportFile', () => {
  it('writes the validated document as JSON that reads back identically, parameters bit for bit', () => {
    const { store } = setup();
    const original = model('abc', { name: 'My best' });
    store.save(original);
    const file = store.exportFile('abc');
    if (!file.ok) throw new Error(file.message);
    const back = validateModel(JSON.parse(file.text), REGISTRY);
    if (!back.ok) throw new Error(back.errors.join('; '));
    expect(back.model).toEqual(original);
    const a = modelParameters(back.model);
    stats.champion.forEach((v, i) => expect(Object.is(a[i], v === 0 ? 0 : v)).toBe(true));
    expect(file.text.length).toBeLessThan(MAX_MODEL_BYTES);
    expect(file.filename).toBe(`sdae-champion-my-best-gen${stats.generation + 1}-abc.json`);
  });
  it('refuses a damaged, missing or unreadable save, and an id that is not a save, without throwing', () => {
    const { store, storage } = setup();
    storage.data.set(`${MODEL_KEY_PREFIX}bad`, 'not json');
    expect(store.exportFile('bad')).toMatchObject({ ok: false, message: expect.stringContaining("can't be exported") });
    expect(store.exportFile('missing')).toMatchObject({ ok: false });
    expect(store.exportFile('../x')).toEqual({ ok: false, message: 'That is not a saved champion.' });
    storage.failGet = () => new Error('denied');
    expect(store.exportFile('bad')).toEqual({ ok: false, message: MESSAGES.unavailable });
    const none = createModelStore({ storage: () => { throw new Error('denied'); }, registry: REGISTRY });
    expect(none.exportFile('bad')).toEqual({ ok: false, message: MESSAGES.unavailable });
  });
  it('exports a save made for another simulation version too, so a copy can still be kept', () => {
    const { store, storage } = setup();
    store.save(model('old'));
    const doc = JSON.parse(storage.data.get(`${MODEL_KEY_PREFIX}old`)!);
    doc.simulationVersion = 2;
    storage.data.set(`${MODEL_KEY_PREFIX}old`, JSON.stringify(doc));
    expect(store.exportFile('old').ok).toBe(true);
  });
  it.each([
    ['plain letters', 'My Best', 'my-best'],
    ['a path and markup', '../../etc/<script>', 'etc-script'],
    ['control and unicode characters', 'caf\u00e9 \u0000\n\u202e x', 'caf-x'],
    ['nothing usable', '###', 'unnamed'],
    ['a very long name', 'a'.repeat(200), 'a'.repeat(40)],
  ])('makes a plain file name from %s', (_label, name, slug) => {
    const doc = { ...model('id-1'), name } as ModelDocument;
    const filename = exportFilename(doc);
    expect(filename).toBe(`sdae-champion-${slug}-gen${doc.training.generation + 1}-id1.json`);
    expect(filename).toMatch(/^[a-z0-9.-]+$/);
  });
  it('makes a plain file name even when the saved name is missing', () => {
    const doc = { ...model('xyz') } as { name?: string };
    delete doc.name;
    expect(exportFilename(doc as ModelDocument)).toMatch(/^sdae-champion-unnamed-gen\d+-xyz\.json$/);
  });
});
