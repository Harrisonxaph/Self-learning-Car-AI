// Import from file text (P3-06): every invalid case is refused with a message and nothing written, migration is a pure,
// ordered hook (tested with a synthetic registry; the real one is empty), and an exported file re-imports identically.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { loadTrack } from '../../src/sim/track';
import { MAX_MODEL_BYTES, buildModel, modelParameters, type ModelDocument } from '../../src/persistence/modelFormat';
import { describeRefusal, importModelText } from '../../src/persistence/modelImport';
import { MIGRATIONS, migrateToCurrent } from '../../src/persistence/migrations';
import { createModelStore, type StorageLike } from '../../src/persistence/modelStore';
import { tracksIn } from '../../src/training/trackSplits';
import { createTrainer, DEFAULT_TRAINING_CONFIG } from '../../src/training/trainer';

const ENV = { track: loadTrack(stadiumOval), physics: DEFAULT_VEHICLE_PHYSICS, timestepSeconds: DEFAULT_SIM_CONFIG.timestepSeconds };
const REGISTRY = tracksIn('training');
const make = (seed: number, id: string, name = `Champion ${id}`): ModelDocument => {
  const trainer = createTrainer({ ...DEFAULT_TRAINING_CONFIG, seed, populationSize: 8, eliteCount: 2, maxEpisodeSeconds: 15 }, ENV);
  const stats = trainer.runGeneration();
  return buildModel({ champion: stats.champion, fitness: stats.bestFitness, generation: stats.generation, record: trainer.record(), id, createdAt: '2026-11-08T22:00:00.000Z', codeVersion: 'test', name });
};
const text = (m: ModelDocument) => JSON.stringify(m, null, 2);
const good = make(3, 'good-1');

class Spy implements StorageLike {
  readonly data = new Map<string, string>();
  writes = 0;
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.writes += 1; this.data.set(k, v); }
  removeItem(k: string) { this.writes += 1; this.data.delete(k); }
  get length() { return this.data.size; }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
}

describe('importModelText: invalid files are refused', () => {
  const mutate = (fn: (o: Record<string, unknown>) => void) => {
    const o = JSON.parse(text(good)) as Record<string, unknown>;
    fn(o);
    return JSON.stringify(o);
  };
  const cases: [string, string][] = [
    ['empty text', ''],
    ['whitespace only', '  \n '],
    ['not JSON', 'hello'],
    ['trailing junk', `${text(good)} x`],
    ['truncated', text(good).slice(0, 200)],
    ['a number', '3'],
    ['null', 'null'],
    ['an array', '[]'],
    ['a string', '"x"'],
    ['wrong format', mutate((o) => { o.format = 'other'; })],
    ['schema 0', mutate((o) => { o.schemaVersion = 0; })],
    ['schema 2 (newer)', mutate((o) => { o.schemaVersion = 2; })],
    ['fractional schema', mutate((o) => { o.schemaVersion = 1.5; })],
    ['no id', mutate((o) => { delete o.id; })],
    ['bad id', mutate((o) => { o.id = '../x'; })],
    ['no parameters', mutate((o) => { delete o.parameters; })],
    ['null parameter value', mutate((o) => { ((o.parameters as { values: unknown[] }).values)[0] = null; })],
    ['too few parameters', mutate((o) => { ((o.parameters as { values: unknown[] }).values).pop(); })],
    ['overflowing exponent', text(good).replace(/"values": \[\s*[^,]+,/, '"values": [ 1e999,')],
    ['deeply nested', `${'['.repeat(100_000)}${']'.repeat(100_000)}`],
    ['replacement characters', String.fromCharCode(0xfffd).repeat(3)],
  ];
  for (const [label, body] of cases) {
    it(`${label}: refused with a message, and nothing is written`, () => {
      const storage = new Spy();
      const store = createModelStore({ storage: () => storage, registry: REGISTRY });
      const result = importModelText(body, { registry: REGISTRY });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.length).toBeGreaterThan(0);
        expect(describeRefusal(result.errors).startsWith('Nothing was imported.')).toBe(true);
      }
      expect(storage.writes).toBe(0);
      expect(storage.data.size).toBe(0);
      expect(store.list()).toMatchObject({ available: true, entries: [] });
    });
  }

  it('refuses oversized text before parsing it (JSON.parse is never called)', () => {
    const real = JSON.parse;
    let parsed = 0;
    JSON.parse = ((...args: Parameters<typeof JSON.parse>) => { parsed += 1; return real(...args); }) as typeof JSON.parse;
    try {
      const result = importModelText(' '.repeat(MAX_MODEL_BYTES + 1), { registry: REGISTRY });
      expect(result).toEqual({ ok: false, errors: ['This file is larger than the 1 MiB limit for a champion.'] });
      expect(parsed).toBe(0);
    } finally {
      JSON.parse = real;
    }
  });

  it('never throws, whatever the input type', () => {
    for (const v of [undefined, null, 3, {}, [], Symbol('x')]) {
      expect(importModelText(v as unknown as string, { registry: REGISTRY }).ok).toBe(false);
    }
  });

  it('names at most three problems and counts the rest', () => {
    expect(describeRefusal(['a.', 'b.', 'c.', 'd.', 'e.'])).toBe('Nothing was imported. a. b. c. (and 2 more problems)');
    expect(describeRefusal(['a.', 'b.', 'c.', 'd.'])).toBe('Nothing was imported. a. b. c. (and 1 more problem)');
  });
});

describe('importModelText: valid files', () => {
  it('accepts a file with a byte-order mark', () => {
    const result = importModelText(`${String.fromCharCode(0xfeff)}${text(good)}`, { registry: REGISTRY });
    expect(result.ok).toBe(true);
  });

  it('re-imports an exported file identically: deep-equal, bit-for-bit parameters, byte-identical re-export', () => {
    for (const seed of [1, 2, 3, 7]) {
      const original = make(seed, `seed-${seed}`);
      const storage = new Spy();
      const a = createModelStore({ storage: () => storage, registry: REGISTRY });
      expect(a.save(original).ok).toBe(true);
      const exported = a.exportFile(original.id);
      if (!exported.ok) throw new Error(exported.message);
      const result = importModelText(exported.text, { registry: REGISTRY });
      if (!result.ok) throw new Error(result.errors.join(' '));
      expect(result.model).toEqual(original);
      const was = modelParameters(original);
      const now = modelParameters(result.model);
      was.forEach((v, i) => expect(Object.is(v, now[i])).toBe(true));
      const freshStorage = new Spy();
      const fresh = createModelStore({ storage: () => freshStorage, registry: REGISTRY });
      expect(fresh.importModel(result.model, () => 'unused')).toMatchObject({ ok: true, status: 'added', id: original.id });
      const again = fresh.exportFile(original.id);
      if (!again.ok) throw new Error(again.message);
      expect(again.text).toBe(exported.text);
    }
  });

  it('reports a model for another simulation version as importable but not drivable', () => {
    const other = { ...JSON.parse(text(good)), simulationVersion: 999 };
    const result = importModelText(JSON.stringify(other), { registry: REGISTRY });
    if (!result.ok) throw new Error(result.errors.join(' '));
    expect(result.drivable).toBe(false);
    expect(result.warnings.join(' ')).toContain('simulation version');
  });
});

describe('migrateToCurrent (synthetic registry; the real one is empty)', () => {
  it('the real registry has no migrations', () => {
    expect(Object.keys(MIGRATIONS)).toHaveLength(0);
  });

  it('passes current and newer documents through untouched, and non-objects too', () => {
    const doc = { schemaVersion: 1, a: 1 };
    expect(migrateToCurrent(doc, {}, 1)).toEqual({ ok: true, value: doc, migratedFrom: null });
    expect((migrateToCurrent(doc, {}, 1) as { value: unknown }).value).toBe(doc);
    expect(migrateToCurrent({ schemaVersion: 9 }, {}, 1)).toMatchObject({ ok: true, migratedFrom: null });
    for (const v of [3, null, [], 'x', { schemaVersion: 'x' }, { schemaVersion: 0.5 }]) expect(migrateToCurrent(v, {}, 1)).toMatchObject({ ok: true, migratedFrom: null });
  });

  it('runs steps in order, purely, and stamps each version', () => {
    const order: number[] = [];
    const registry = {
      0: (i: Readonly<Record<string, unknown>>) => { order.push(0); return { ...i, steps: [...((i.steps as string[]) ?? []), 'a'] }; },
      1: (i: Readonly<Record<string, unknown>>) => { order.push(1); return { ...i, steps: [...((i.steps as string[]) ?? []), 'b'] }; },
    };
    const input = Object.freeze({ schemaVersion: 0 });
    const out = migrateToCurrent(input, registry, 2);
    expect(order).toEqual([0, 1]);
    expect(out).toEqual({ ok: true, value: { schemaVersion: 2, steps: ['a', 'b'] }, migratedFrom: 0 });
    expect(input).toEqual({ schemaVersion: 0 });
  });

  it('refuses when a step is missing, throws, or returns a non-object', () => {
    expect(migrateToCurrent({ schemaVersion: 0 }, {}, 1)).toMatchObject({ ok: false });
    expect(migrateToCurrent({ schemaVersion: 0 }, { 0: () => { throw new Error('x'); } }, 1)).toMatchObject({ ok: false });
    expect(migrateToCurrent({ schemaVersion: 0 }, { 0: () => 5 as never }, 1)).toMatchObject({ ok: false });
  });

  it('an inherited property is not a migration', () => {
    expect(migrateToCurrent({ schemaVersion: 0 }, Object.create({ 0: (i: object) => i }) as never, 1)).toMatchObject({ ok: false });
  });

  it('a synthetic old document is migrated by importModelText with a synthetic registry, then validated', () => {
    const old = { ...JSON.parse(text(good)), schemaVersion: 0 };
    const unmigrated = importModelText(JSON.stringify(old), { registry: REGISTRY });
    expect(unmigrated.ok).toBe(false);
    const migrated = importModelText(JSON.stringify(old), { registry: REGISTRY, migrations: { 0: (i) => ({ ...i }) } });
    // The validator reads schema 1 only; the synthetic step stamps version 1 and the rest validates as before.
    expect(migrated.ok).toBe(true);
  });
});

describe('store.importModel: id collisions never overwrite', () => {
  const setup = () => {
    const storage = new Spy();
    return { storage, store: createModelStore({ storage: () => storage, registry: REGISTRY }) };
  };
  it('identical content is a no-op', () => {
    const { storage, store } = setup();
    store.save(good);
    const before = new Map(storage.data);
    const writes = storage.writes;
    expect(store.importModel(JSON.parse(JSON.stringify(good)), () => 'x')).toEqual({ ok: true, status: 'already-saved', id: 'good-1', indexed: true });
    expect(storage.writes).toBe(writes);
    expect(storage.data).toEqual(before);
  });
  it('different content under a taken id is saved as a copy under a fresh id', () => {
    const { storage, store } = setup();
    store.save(good);
    const other = { ...make(4, 'good-1'), name: 'Other' };
    const original = storage.data.get('sdae:model:good-1');
    const out = store.importModel(other, () => 'copy-1');
    expect(out).toMatchObject({ ok: true, status: 'saved-as-copy', id: 'copy-1' });
    expect(storage.data.get('sdae:model:good-1')).toBe(original);
    expect(JSON.parse(storage.data.get('sdae:model:copy-1')!).name).toBe('Other');
  });
  it('a damaged save under the id is not overwritten either', () => {
    const { storage, store } = setup();
    storage.data.set('sdae:model:good-1', '{broken');
    expect(store.importModel(good, () => 'copy-2')).toMatchObject({ ok: true, status: 'saved-as-copy', id: 'copy-2' });
    expect(storage.data.get('sdae:model:good-1')).toBe('{broken');
  });
  it('refuses when no free id comes back', () => {
    const { store } = setup();
    store.save(good);
    expect(store.importModel(make(4, 'good-1'), () => 'good-1')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(store.importModel(make(4, 'good-1'), () => { throw new Error('x'); })).toMatchObject({ ok: false });
  });
  it('the cap of 20 applies, and writes nothing more', () => {
    const { storage, store } = setup();
    for (let i = 0; i < 20; i += 1) store.save({ ...good, id: `m-${i}` });
    const writes = storage.writes;
    expect(store.importModel({ ...good, id: 'new-one' }, () => 'n')).toMatchObject({ ok: false, reason: 'full' });
    expect(storage.writes).toBe(writes);
  });
  it('an unavailable store gives a message and no exception', () => {
    const store = createModelStore({ storage: () => { throw new Error('denied'); }, registry: REGISTRY });
    expect(store.importModel(good, () => 'x')).toMatchObject({ ok: false, reason: 'unavailable' });
  });
});

describe('the committed fixture (synthetic test data from a seeded run, not a result)', () => {
  const fixture = readFileSync(new URL('../fixtures/champion-v1.json', import.meta.url), 'utf8');
  it('imports, and a store re-exports it byte for byte, so a format change that breaks old files fails here', () => {
    const result = importModelText(fixture, { registry: REGISTRY });
    if (!result.ok) throw new Error(result.errors.join(' '));
    expect(result.drivable).toBe(true);
    expect(result.migratedFrom).toBeNull();
    const storage = new Spy();
    const store = createModelStore({ storage: () => storage, registry: REGISTRY });
    expect(store.importModel(result.model, () => 'x')).toMatchObject({ ok: true, status: 'added', id: 'fixture-v1' });
    const out = store.exportFile('fixture-v1');
    if (!out.ok) throw new Error(out.message);
    expect(out.text).toBe(fixture);
  });
});
