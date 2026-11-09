// The checkpoint format (P3-07): a round trip through JSON text that resumes exactly, every invalid case refused with a
// message and nothing allocated or written, a fake `resolveConfig` proving the adapter seam, one UTF-8 byte limit, and the
// store's failure behaviour (a failed write keeps the previous checkpoint; saved champions are never touched).
import { describe, expect, it } from 'vitest';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { loadTrack } from '../../src/sim/track';
import {
  buildCheckpoint,
  checkpointGenomes,
  CHECKPOINT_FORMAT,
  entryChampion,
  MAX_CHECKPOINT_BYTES,
  MAX_CHECKPOINT_GENERATIONS,
  MAX_CHECKPOINT_POPULATION,
  utf8Size,
  validateCheckpoint,
  type CheckpointDocument,
  type ResolveConfig,
} from '../../src/persistence/checkpointFormat';
import { CHECKPOINT_KEY, checkpointFile, createCheckpointStore, parseCheckpointText } from '../../src/persistence/checkpointStore';
import { validateModel } from '../../src/persistence/modelFormat';
import { checkpointFromTrainer, checkpointValidateOptions } from '../../src/ui/checkpointAdapter';
import { createTrainer, DEFAULT_TRAINING_CONFIG } from '../../src/training/trainer';
import { tracksIn } from '../../src/training/trackSplits';
import type { StorageLike } from '../../src/persistence/modelStore';

const ENV = { track: loadTrack(stadiumOval), physics: DEFAULT_VEHICLE_PHYSICS, timestepSeconds: DEFAULT_SIM_CONFIG.timestepSeconds };
const config = (seed = 1, populationSize = 5) => ({ ...DEFAULT_TRAINING_CONFIG, seed, populationSize, eliteCount: 1, maxEpisodeSeconds: 10 });
const OPTIONS = checkpointValidateOptions();
const META = { id: 'cp-test-1', createdAt: '2026-11-09T22:00:00.000Z', codeVersion: 'test', appVersion: '0.0.0' };
const make = (generations = 3, keepLast = 20): CheckpointDocument => {
  const trainer = createTrainer(config(), ENV);
  for (let g = 0; g < generations; g += 1) trainer.runGeneration();
  return checkpointFromTrainer(trainer, META, keepLast);
};
const good = make(4, 2);
const text = JSON.stringify(good);
const clone = () => JSON.parse(text) as Record<string, unknown>;

class Spy implements StorageLike {
  readonly data = new Map<string, string>();
  writes = 0;
  failSet: unknown = null;
  failGet = false;
  getItem(k: string) {
    if (this.failGet) throw new Error('denied');
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (this.failSet) throw this.failSet;
    this.writes += 1;
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.writes += 1;
    this.data.delete(k);
  }
  get length() {
    return this.data.size;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
}
const storeOn = (storage: StorageLike) => createCheckpointStore({ storage: () => storage, ...OPTIONS });

describe('a valid checkpoint', () => {
  it('validates, and its JSON text parses and validates again to an equal document', () => {
    const result = validateCheckpoint(good, OPTIONS);
    if (!result.ok) throw new Error(result.errors.join('; '));
    const parsed = parseCheckpointText(text, OPTIONS);
    if (!parsed.ok) throw new Error(parsed.errors.join('; '));
    expect(parsed.checkpoint).toEqual(good);
    expect(good.format).toBe(CHECKPOINT_FORMAT);
    expect(good.generationIndex).toBe(4);
    expect(good.history).toHaveLength(4);
    // Two generations were compacted (K = 2), the best so far stays full.
    expect(good.history.filter((e) => e.retained).length).toBeGreaterThanOrEqual(2);
  });

  it('accepts a leading byte-order mark, and an indented download is also valid', () => {
    expect(parseCheckpointText(`${String.fromCharCode(0xfeff)}${text}`, OPTIONS).ok).toBe(true);
    const file = checkpointFile(good);
    if (!file.ok) throw new Error(file.message);
    expect(parseCheckpointText(file.text, OPTIONS).ok).toBe(true);
    expect(file.filename).toMatch(/^sdae-checkpoint-gen4-[A-Za-z0-9]{1,8}\.json$/);
  });

  it('keeps negative zero exactly in the population and a champion, which JSON alone would lose', () => {
    const trainer = createTrainer(config(2, 4), ENV);
    trainer.runGeneration();
    const state = trainer.checkpointState();
    state.genomes[1]![5] = -0;
    const champion = state.history.find((e) => e.retained);
    if (!champion || !champion.retained) throw new Error('expected a full entry');
    champion.stats.champion[7] = -0;
    const doc = buildCheckpoint({
      ...META,
      simulationVersion: good.simulationVersion,
      configuration: good.training.configuration,
      physics: good.training.environment.physics,
      timestepSeconds: good.training.environment.timestepSeconds,
      sensors: good.training.environment.sensors,
      trackId: good.training.trackId,
      trackVersion: good.training.trackVersion,
      trackHash: good.training.trackHash,
      rngStreams: good.training.rngStreams,
      rngState: state.runState,
      generationIndex: state.generationIndex,
      genomes: state.genomes,
      history: state.history.map((e) => (e.retained ? { ...e.stats, retained: true as const } : e)),
    });
    // Population count matches the trainer's population (4) but the document's configuration says 5: use a matching one.
    const withConfig = { ...doc, training: { ...doc.training, configuration: { ...(doc.training.configuration as Record<string, unknown>), populationSize: 4 } } };
    const parsed = parseCheckpointText(JSON.stringify(withConfig), OPTIONS);
    if (!parsed.ok) throw new Error(parsed.errors.join('; '));
    expect(Object.is(checkpointGenomes(parsed.checkpoint)[1]![5], -0)).toBe(true);
    const full = parsed.checkpoint.history.find((e) => e.retained);
    if (!full || !full.retained) throw new Error('expected a full entry');
    expect(Object.is(entryChampion(full)[7], -0)).toBe(true);
  });
});

/** A loosely typed copy of a document, for editing it into an invalid one. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Doc = Record<string, any>;

describe('every invalid checkpoint is refused with messages, and nothing is written', () => {
  const mutate = (fn: (o: Doc) => void) => {
    const o = clone() as Doc;
    fn(o);
    return JSON.stringify(o);
  };
  const cases: [string, string][] = [
    ['empty text', ''],
    ['not JSON', 'hello'],
    ['truncated', text.slice(0, 300)],
    ['trailing junk', `${text} x`],
    ['null', 'null'],
    ['an array', '[]'],
    ['a saved champion file given as a checkpoint', JSON.stringify({ format: 'self-driving-ai-evolution/model' })],
    ['an unknown format', mutate((o) => { o.format = 'other'; })],
    ['schema 0', mutate((o) => { o.schemaVersion = 0; })],
    ['a newer schema', mutate((o) => { o.schemaVersion = 2; })],
    ['a fractional schema', mutate((o) => { o.schemaVersion = 1.5; })],
    ['a bad id', mutate((o) => { o.id = '../x'; })],
    ['a bad createdAt', mutate((o) => { o.createdAt = 'yesterday'; })],
    ['no training', mutate((o) => { delete o.training; })],
    ['a configuration the trainer refuses (seed -1)', mutate((o) => { o.training.configuration.seed = -1; })],
    ['an unknown track', mutate((o) => { o.training.trackId = 'nowhere'; })],
    ['a track hash mismatch', mutate((o) => { o.training.trackHash = 'sha256:00'; })],
    ['a wrong rng algorithm', mutate((o) => { o.training.rng.algorithm = 'x'; })],
    ['an invalid uint32 rng word', mutate((o) => { o.training.rng.words[2] = -1; })],
    ['three rng words', mutate((o) => { o.training.rng.words.pop(); })],
    ['a missing physics field', mutate((o) => { delete o.training.environment.physics.wheelbase; })],
    ['a negative generation index', mutate((o) => { o.generationIndex = -1; })],
    ['a generation index not equal to the history length', mutate((o) => { o.generationIndex = 3; })],
    ['an absurd generation index', mutate((o) => { o.generationIndex = MAX_CHECKPOINT_GENERATIONS + 1; })],
    ['an absurd population count (1e9) with no rows', mutate((o) => { o.population.count = 1e9; o.population.values = []; })],
    ['a population count that disagrees with the configuration', mutate((o) => { o.population.count = 4; o.population.values.pop(); })],
    ['a short genome', mutate((o) => { o.population.values[0].pop(); })],
    ['a null parameter', mutate((o) => { o.population.values[1][3] = null; })],
    ['a finite but enormous parameter (1e308) that would overflow inference', mutate((o) => { o.population.values[0][0] = 1e308; })],
    ['an enormous parameter in a champion', mutate((o) => { const e = o.history.find((x: Doc) => x.retained); e.champion[0] = -1e200; })],
    ['an overflowing exponent', text.replace(/"values":\[\[[^,]+,/, '"values":[[1e999,')],
    ['a wrong parameter order', mutate((o) => { o.population.order = 'x'; })],
    ['negativeZeros pointing at a non-zero', mutate((o) => { o.population.negativeZeros = [[0, 0]]; })],
    ['history out of order', mutate((o) => { o.history.reverse(); })],
    ['a compact entry that carries a champion', mutate((o) => { const e = o.history.find((x: Doc) => !x.retained); e.champion = []; })],
    ['a full entry with a short champion', mutate((o) => { const e = o.history.find((x: Doc) => x.retained); e.champion.pop(); })],
    ['outcomes that do not add up to the population', mutate((o) => { o.history[0].outcomes.crashed += 1; })],
    ['a champion index outside the population', mutate((o) => { const e = o.history.find((x: Doc) => x.retained); e.championIndex = 99; })],
    ['the best generation so far compacted', mutate((o) => { for (const e of o.history) { if (e.retained) { delete e.fitness; delete e.champion; delete e.championIndex; e.retained = false; e.populationSize = 5; } } })],
    ['a non-finite aggregate', mutate((o) => { o.history[0].meanFitness = 'x'; })],
  ];
  for (const [label, body] of cases) {
    it(`${label}`, () => {
      const storage = new Spy();
      const result = parseCheckpointText(body, OPTIONS);
      expect(result.ok, label).toBe(false);
      if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
      expect(storage.writes).toBe(0);
    });
  }

  it('reports every error, not only the first', () => {
    const result = validateCheckpoint(JSON.parse(mutate((o) => { o.id = '../x'; o.codeVersion = ''; o.generationIndex = 3; })), OPTIONS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });

  it('a deeply nested hostile value becomes a refusal, never an exception', () => {
    const deep = `${text.slice(0, -1)},"extra":${'['.repeat(12_000)}${']'.repeat(12_000)}}`;
    expect(() => parseCheckpointText(deep, OPTIONS)).not.toThrow();
  });

  it('hostile values in many positions never throw', () => {
    for (const hostile of [null, undefined, Number.POSITIVE_INFINITY, '', {}, [], { toString: null }, Symbol.iterator] as unknown[]) {
      const o = clone() as Doc;
      for (const key of ['id', 'createdAt', 'training', 'generationIndex', 'population', 'history', 'simulationVersion']) {
        const copy = { ...o, [key]: hostile };
        expect(() => validateCheckpoint(copy, OPTIONS), `${key}`).not.toThrow();
        expect(validateCheckpoint(copy, OPTIONS).ok).toBe(false);
      }
    }
  });

  it('a configuration refusal from the injected adapter is reported with its text (the adapter seam)', () => {
    const refuse: ResolveConfig = () => ({ ok: false, errors: ['The seed is on strike.'] });
    const result = validateCheckpoint(good, { registry: tracksIn('training'), resolveConfig: refuse });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toContain('The seed is on strike.');
  });

  it('refuses a model file in a checkpoint importer with a friendly message, and a checkpoint in the model importer', () => {
    const asModel = validateModel(JSON.parse(text), tracksIn('training'));
    expect(asModel.ok).toBe(false);
    if (!asModel.ok) expect(asModel.errors[0]).toContain('training checkpoint');
    const asCheckpoint = validateCheckpoint({ format: 'self-driving-ai-evolution/model' }, OPTIONS);
    expect(asCheckpoint.ok).toBe(false);
    if (!asCheckpoint.ok) expect(asCheckpoint.errors[0]).toContain('saved champion');
  });

  it('the population and history bounds are small enough to refuse before walking arrays', () => {
    expect(MAX_CHECKPOINT_POPULATION).toBeLessThanOrEqual(2_000);
    expect(MAX_CHECKPOINT_GENERATIONS).toBeLessThanOrEqual(20_000);
  });
});

describe('one UTF-8 byte limit', () => {
  it('counts bytes, not code units', () => {
    expect(utf8Size('abc')).toBe(3);
    expect(utf8Size('界')).toBe(3);
    expect(utf8Size('x'.repeat(10), 5)).toBe(10);
  });
  it('text under the limit in code units but over it in bytes is refused before parsing', () => {
    const body = `{"a":"${'界'.repeat(Math.ceil(MAX_CHECKPOINT_BYTES / 3) + 10)}"}`;
    expect(body.length).toBeLessThan(MAX_CHECKPOINT_BYTES);
    const real = JSON.parse;
    let parsed = 0;
    JSON.parse = ((...args: Parameters<typeof JSON.parse>) => {
      parsed += 1;
      return real(...args);
    }) as typeof JSON.parse;
    try {
      const result = parseCheckpointText(body, OPTIONS);
      expect(result).toEqual({ ok: false, errors: ['This file is larger than the 3 MiB limit for a checkpoint.'] });
      expect(parsed).toBe(0);
    } finally {
      JSON.parse = real;
    }
  });
});

describe('the store', () => {
  it('round trips through storage under its own key', () => {
    const storage = new Spy();
    const store = storeOn(storage);
    expect(store.read()).toEqual({ status: 'none' });
    expect(store.write(good)).toEqual({ ok: true });
    expect([...storage.data.keys()]).toEqual([CHECKPOINT_KEY]);
    const read = store.read();
    expect(read.status).toBe('ok');
    if (read.status === 'ok') expect(read.checkpoint).toEqual(good);
  });

  it('a quota failure keeps the previous checkpoint intact and is a message', () => {
    const storage = new Spy();
    const store = storeOn(storage);
    store.write(good);
    const before = storage.data.get(CHECKPOINT_KEY);
    storage.failSet = Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    const result = store.write(make(6, 2));
    expect(result).toMatchObject({ ok: false, reason: 'quota' });
    expect(storage.data.get(CHECKPOINT_KEY)).toBe(before);
    storage.failSet = new Error('denied');
    expect(store.write(make(6, 2))).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(storage.data.get(CHECKPOINT_KEY)).toBe(before);
  });

  it('unavailable storage gives messages and never an exception', () => {
    const denied = createCheckpointStore({ storage: () => { throw new Error('denied'); }, ...OPTIONS });
    expect(denied.read().status).toBe('unavailable');
    expect(denied.write(good)).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(denied.clear()).toMatchObject({ ok: false });
    const throwingGet = new Spy();
    throwingGet.failGet = true;
    expect(storeOn(throwingGet).read().status).toBe('unavailable');
  });

  it('a damaged, newer-version or oversized slot is reported, never silently replaced, and never touches saved champions', () => {
    const storage = new Spy();
    storage.data.set('sdae:model:champ-1', '{"keep":"me"}');
    storage.data.set('sdae:models:index', '["champ-1"]');
    const store = storeOn(storage);
    storage.data.set(CHECKPOINT_KEY, '{broken');
    expect(store.read()).toMatchObject({ status: 'damaged' });
    storage.data.set(CHECKPOINT_KEY, JSON.stringify({ ...clone(), schemaVersion: 2 }));
    const newer = store.read();
    expect(newer).toMatchObject({ status: 'damaged' });
    if (newer.status === 'damaged') expect(newer.problem).toContain('newer version');
    storage.data.set(CHECKPOINT_KEY, ' '.repeat(MAX_CHECKPOINT_BYTES + 1));
    expect(store.read()).toMatchObject({ status: 'damaged' });
    store.clear();
    expect(storage.data.get('sdae:model:champ-1')).toBe('{"keep":"me"}');
    expect(storage.data.get('sdae:models:index')).toBe('["champ-1"]');
  });

  it('a state that cannot be serialized or is too large is refused with a message, nothing is written, the last good one is kept', () => {
    const storage = new Spy();
    const store = storeOn(storage);
    store.write(good);
    const before = storage.data.get(CHECKPOINT_KEY);
    const cyclic = { ...good } as Record<string, unknown>;
    cyclic.self = cyclic;
    expect(store.write(cyclic as unknown as CheckpointDocument)).toMatchObject({ ok: false, reason: 'not-writable' });
    const huge = { ...good, codeVersion: '界'.repeat(Math.ceil(MAX_CHECKPOINT_BYTES / 3) + 5) };
    expect(store.write(huge)).toMatchObject({ ok: false, reason: 'too-large' });
    expect(storage.data.get(CHECKPOINT_KEY)).toBe(before);
    expect(checkpointFile(huge)).toMatchObject({ ok: false });
    expect(checkpointFile(cyclic as unknown as CheckpointDocument)).toMatchObject({ ok: false });
  });

  it('Download is built from the document in memory, so a failing store does not block it', () => {
    const storage = new Spy();
    storage.failSet = new Error('denied');
    storage.failGet = true;
    expect(checkpointFile(good).ok).toBe(true);
  });

  it('a multibyte near-limit checkpoint imports, and its own download imports again', () => {
    const wide = { ...good, codeVersion: '界'.repeat(Math.floor((MAX_CHECKPOINT_BYTES - utf8Size(text) - 60) / 3)) };
    const compact = JSON.stringify(wide);
    expect(utf8Size(compact)).toBeLessThanOrEqual(MAX_CHECKPOINT_BYTES);
    const first = parseCheckpointText(compact, OPTIONS);
    if (!first.ok) throw new Error(first.errors.join('; '));
    const file = checkpointFile(first.checkpoint);
    if (!file.ok) throw new Error(file.message);
    expect(utf8Size(file.text)).toBeLessThanOrEqual(MAX_CHECKPOINT_BYTES);
    expect(parseCheckpointText(file.text, OPTIONS).ok).toBe(true);
  });
});
