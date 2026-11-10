// Import from file text (P3-06): every invalid case is refused with a message and nothing written, migration is a pure,
// ordered hook (tested with a synthetic registry; the real one is empty), and an exported file re-imports identically.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { FAIL_MARKER, installFailingStringify } from '../helpers/failingStringify';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { loadTrack } from '../../src/sim/track';
import { MAX_MODEL_BYTES, buildModel, modelParameters, utf8Bytes, type ModelDocument } from '../../src/persistence/modelFormat';
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
    if (!result.ok) throw new Error(result.errors.join(' '));
    expect(result.model).toEqual(good);
  });

  it('a replacement character inside valid metadata is just a string, and imports unchanged', () => {
    const named = { ...good, name: `a${String.fromCharCode(0xfffd)}b` };
    const result = importModelText(JSON.stringify(named), { registry: REGISTRY });
    if (!result.ok) throw new Error(result.errors.join(' '));
    expect(result.model.name).toBe(named.name);
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

describe('store.importModel: an incomplete inventory never leads to an overwrite', () => {
  class Flaky extends Spy {
    failScan = false;
    override get length(): number {
      if (this.failScan) throw new Error('scan failed');
      return super.length;
    }
  }
  it('refuses, and changes nothing, when keys cannot be enumerated and an orphan holds the id', () => {
    const storage = new Flaky();
    const store = createModelStore({ storage: () => storage, registry: REGISTRY });
    store.save(good);
    store.save(make(5, 'other-1'));
    // The fixture id falls out of the index (a supported state after a failed index write); the other save stays indexed.
    storage.data.set('sdae:models:index', JSON.stringify(['other-1']));
    const snapshot = new Map(storage.data);
    const writes = storage.writes;
    storage.failScan = true;
    const different = { ...make(6, 'good-1'), name: 'Different' };
    const out = store.importModel(different, () => 'copy-x');
    expect(out).toMatchObject({ ok: false });
    expect(storage.writes).toBe(writes);
    expect(storage.data).toEqual(snapshot);
  });
  it('checks the destination key itself, so an orphan is a collision even when the index and listing miss it', () => {
    const storage = new Spy();
    const store = createModelStore({ storage: () => storage, registry: REGISTRY });
    storage.data.set('sdae:model:good-1', JSON.stringify(good));
    // An index that is damaged hides nothing from the scan; a hand-hidden key (not matching the scan) is still found by key.
    const original = storage.data.get('sdae:model:good-1');
    const out = store.importModel({ ...make(7, 'good-1'), name: 'Different' }, () => 'copy-y');
    expect(out).toMatchObject({ ok: true, status: 'saved-as-copy', id: 'copy-y' });
    expect(storage.data.get('sdae:model:good-1')).toBe(original);
  });
  it('a generated copy id that is already taken is skipped, never overwritten', () => {
    const storage = new Spy();
    const store = createModelStore({ storage: () => storage, registry: REGISTRY });
    store.save(good);
    store.save(make(5, 'taken-1'));
    const taken = storage.data.get('sdae:model:taken-1');
    const ids = ['taken-1', 'fresh-1'];
    const out = store.importModel({ ...make(6, 'good-1'), name: 'Different' }, () => ids.shift()!);
    expect(out).toMatchObject({ ok: true, status: 'saved-as-copy', id: 'fresh-1' });
    expect(storage.data.get('sdae:model:taken-1')).toBe(taken);
  });
});

describe('one UTF-8 byte limit for import, save and export', () => {
  /** The fixture with a multibyte extra field sized so the compact JSON is `target` bytes. */
  const withExtra = (target: number): string => {
    const base = JSON.parse(text(good)) as Record<string, unknown>;
    base.extra = '';
    const empty = JSON.stringify(base);
    const room = target - utf8Bytes(empty);
    base.extra = '\u754c'.repeat(Math.floor(room / 3)) + 'x'.repeat(room % 3);
    return JSON.stringify(base);
  };
  it('counts bytes, not code units', () => {
    expect(utf8Bytes('abc')).toBe(3);
    expect(utf8Bytes('\u754c')).toBe(3);
    expect(utf8Bytes('\u{1F600}')).toBe(4);
  });
  it('refuses text that is under the limit in code units but over it in bytes, before parsing', () => {
    const body = withExtra(MAX_MODEL_BYTES + 3);
    expect(body.length).toBeLessThan(MAX_MODEL_BYTES);
    expect(importModelText(body, { registry: REGISTRY })).toEqual({ ok: false, errors: ['This file is larger than the 1 MiB limit for a champion.'] });
  });
  it('a multibyte near-limit file imports, is saved, and its download imports again (the offered backup is always importable)', () => {
    for (const target of [MAX_MODEL_BYTES - 21, MAX_MODEL_BYTES - 1, MAX_MODEL_BYTES]) {
      const compact = withExtra(target);
      expect(utf8Bytes(compact)).toBe(target);
      const first = importModelText(compact, { registry: REGISTRY });
      if (!first.ok) throw new Error(first.errors.join(' '));
      const storage = new Spy();
      const store = createModelStore({ storage: () => storage, registry: REGISTRY });
      expect(store.importModel(first.model, () => 'x')).toMatchObject({ ok: true, status: 'added' });
      const out = store.exportFile(first.model.id);
      if (!out.ok) throw new Error(out.message);
      expect(utf8Bytes(out.text)).toBeLessThanOrEqual(MAX_MODEL_BYTES);
      const again = importModelText(out.text, { registry: REGISTRY });
      if (!again.ok) throw new Error(again.errors.join(' '));
      expect(again.model).toEqual(first.model);
    }
  });
  it('stored text over the byte limit is refused on export with a message', () => {
    const storage = new Spy();
    const store = createModelStore({ storage: () => storage, registry: REGISTRY });
    storage.data.set('sdae:model:big', withExtra(MAX_MODEL_BYTES));
    expect(store.exportFile('big')).toMatchObject({ ok: true });
    storage.data.set('sdae:model:big', `${withExtra(MAX_MODEL_BYTES)} `);
    expect(store.exportFile('big')).toMatchObject({ ok: false, message: expect.stringContaining('1 MiB') as unknown as string });
  });
});

describe('serialization safety through the whole import-and-save path', () => {
  // The failure is injected (tests/helpers/failingStringify.ts), not provoked by nesting depth: whether a deep value
  // overflows the stack depends on the runtime's stack size, so a fixed depth is not a portable way to make it fail.
  let restore: () => void = () => {};
  afterEach(() => restore());
  const unserializable = (): string => JSON.stringify({ ...(JSON.parse(text(good)) as Record<string, unknown>), [FAIL_MARKER]: true });

  it('a valid model that cannot be written out gives a refusal message, not an exception, and writes nothing', () => {
    const parsed = importModelText(unserializable(), { registry: REGISTRY });
    expect(parsed.ok).toBe(true);
    const storage = new Spy();
    const store = createModelStore({ storage: () => storage, registry: REGISTRY });
    store.save(make(9, 'keep-1'));
    const snapshot = new Map(storage.data);
    const writes = storage.writes;
    if (!parsed.ok) return;
    restore = installFailingStringify();
    let out: ReturnType<typeof store.importModel> | undefined;
    expect(() => { out = store.importModel(parsed.model, () => 'n'); }).not.toThrow();
    restore();
    expect(out).toMatchObject({ ok: false, reason: 'invalid' });
    expect(storage.writes).toBe(writes);
    expect(storage.data).toEqual(snapshot);
  });
  it('save itself returns a message for such a model', () => {
    const parsed = importModelText(unserializable(), { registry: REGISTRY });
    if (!parsed.ok) throw new Error('should parse');
    const store = createModelStore({ storage: () => new Spy(), registry: REGISTRY });
    restore = installFailingStringify();
    expect(store.save(parsed.model)).toMatchObject({ ok: false, reason: 'invalid' });
  });
  it('the same model saves normally when serialization works, so the refusal above is the injected failure and nothing else', () => {
    const parsed = importModelText(unserializable(), { registry: REGISTRY });
    if (!parsed.ok) throw new Error('should parse');
    const store = createModelStore({ storage: () => new Spy(), registry: REGISTRY });
    expect(store.save(parsed.model)).toMatchObject({ ok: true });
  });
  it('a deeply nested unknown field never throws, whether or not this runtime can serialize it', () => {
    const base = text(good).trimEnd();
    const parsed = importModelText(`${base.slice(0, -1)},"extra":${'['.repeat(12_000)}${']'.repeat(12_000)}}`, { registry: REGISTRY });
    if (!parsed.ok) throw new Error('should parse');
    const storage = new Spy();
    const store = createModelStore({ storage: () => storage, registry: REGISTRY });
    let out: ReturnType<typeof store.save> | undefined;
    expect(() => { out = store.save(parsed.model); }).not.toThrow();
    // Either outcome is correct; what matters is that a refusal wrote nothing and a success wrote the model.
    if (out?.ok) expect(storage.data.size).toBe(2);
    else expect(storage.data.size).toBe(0);
  });
});
