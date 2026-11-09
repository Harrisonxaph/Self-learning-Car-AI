// "Saved then loaded drives identically" (P3-05): a champion goes through build, JSON, a fake localStorage, load and
// validation, and its replay equals the original's at every tick. Seeded runs of the real trainer and physics.
import { describe, expect, it } from 'vitest';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { runNetwork } from '../../src/ai/network';
import { buildModel, compatibility, modelParameters, validateModel } from '../../src/persistence/modelFormat';
import { createModelStore, type StorageLike } from '../../src/persistence/modelStore';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS, terminalSpeed } from '../../src/sim/config';
import { loadTrack } from '../../src/sim/track';
import { createChampionReplay } from '../../src/training/championReplay';
import { replayForModel, setupForModel } from '../../src/ui/savedReplay';
import { tracksIn } from '../../src/training/trackSplits';
import { createTrainer, DEFAULT_TRAINING_CONFIG, evaluateGenome, carFitness } from '../../src/training/trainer';
import { createRng } from '../../src/utils/rng';

const ENV = { track: loadTrack(stadiumOval), physics: DEFAULT_VEHICLE_PHYSICS, timestepSeconds: DEFAULT_SIM_CONFIG.timestepSeconds };

class MemoryStorage implements StorageLike {
  readonly data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  get length() {
    return this.data.size;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
}

function champions(seed: number, generations: number) {
  const trainer = createTrainer({ ...DEFAULT_TRAINING_CONFIG, seed, populationSize: 8, eliteCount: 2, maxEpisodeSeconds: 15 }, ENV);
  const out = [];
  for (let g = 0; g < generations; g += 1) out.push({ stats: trainer.runGeneration(), record: trainer.record() });
  return { trainer, out };
}

describe('a saved then loaded champion drives identically', () => {
  it.each([1, 7, 23])('equals the original replay at every tick and has the same fitness (seed %i)', (seed) => {
    const { trainer, out } = champions(seed, 3);
    for (const { stats, record } of out) {
      const storage = new MemoryStorage();
      const store = createModelStore({ storage: () => storage, registry: tracksIn('training') });
      const model = buildModel({ champion: stats.champion, fitness: stats.bestFitness, generation: stats.generation, record, id: `m-${seed}-${stats.generation}`, createdAt: '2026-11-08T22:00:00.000Z', codeVersion: 'test' });
      expect(store.save(model)).toEqual({ ok: true, indexed: true });
      const loaded = store.load(model.id);
      if (!loaded.ok) throw new Error(loaded.message);

      // The genome is bit-for-bit the champion.
      const genome = modelParameters(loaded.model);
      stats.champion.forEach((v, i) => expect(Object.is(genome[i], v === 0 ? 0 : v)).toBe(true));

      // Its replay, under the model's own recorded conditions, equals the original's at every tick.
      const saved = replayForModel(loaded.model);
      expect(saved.warnings).toEqual([]);
      const original = createChampionReplay(stats.champion, trainer.setup);
      let ticks = 0;
      for (let a = original.step(), b = saved.replay.step(); a || b; a = original.step(), b = saved.replay.step()) {
        expect(b).toEqual(a);
        ticks += 1;
      }
      expect(ticks).toBeGreaterThan(0);
      expect(saved.replay.state()).toEqual(original.state());
      expect(carFitness({ genome, racer: saved.replay.state().racer, episode: saved.replay.state().episode }, saved.setup)).toBe(stats.bestFitness);
      expect({ racer: saved.replay.state().racer, episode: saved.replay.state().episode }).toEqual({ racer: evaluateGenome(stats.champion, trainer.setup).racer, episode: evaluateGenome(stats.champion, trainer.setup).episode });
    }
  });

  it('gives the same network outputs on a sweep of inputs, for both brake settings', () => {
    const { out } = champions(5, 2);
    const rng = createRng(99);
    for (const brakeEnabled of [true, false]) {
      const { stats, record } = out[1]!;
      const model = buildModel({ champion: stats.champion, fitness: stats.bestFitness, generation: stats.generation, record: { ...record, config: { ...record.config, brakeEnabled } }, id: 'sweep', createdAt: '2026-11-08T22:00:00.000Z', codeVersion: 'test' });
      const back = JSON.parse(JSON.stringify(model)) as typeof model;
      const genome = modelParameters(back);
      for (let i = 0; i < 200; i += 1) {
        const inputs = Array.from({ length: 9 }, () => rng.range(-1, 1));
        expect(runNetwork(genome, inputs, { brakeEnabled: back.architecture.brakeEnabled })).toEqual(runNetwork(stats.champion, inputs, { brakeEnabled }));
      }
    }
  });

  it('replays under the physics and timestep the model was saved with, not the current build', () => {
    const { out } = champions(2, 1);
    const { stats, record } = out[0]!;
    const physics = { ...record.physics, engineAcceleration: 9 };
    const slower = { ...physics, maxSpeed: terminalSpeed(physics) };
    const model = buildModel({ champion: stats.champion, fitness: stats.bestFitness, generation: 0, record: { ...record, physics: slower }, id: 'phys', createdAt: '2026-11-08T22:00:00.000Z', codeVersion: 'test' });
    const { setup } = setupForModel(JSON.parse(JSON.stringify(model)));
    expect(setup.environment.physics.engineAcceleration).toBe(9);
    expect(setup.environment.timestepSeconds).toBe(record.timestepSeconds);
  });

  it('warns when a model was scored under another fitness version, and still replays it', () => {
    const { out } = champions(2, 1);
    const { stats, record } = out[0]!;
    const model = JSON.parse(JSON.stringify(buildModel({ champion: stats.champion, fitness: 1, generation: 0, record, id: 'fit', createdAt: '2026-11-08T22:00:00.000Z', codeVersion: 'test' })));
    model.training.configuration.fitness.version = 2;
    model.training.fitnessVersion = 2;
    const saved = replayForModel(model);
    expect(saved.warnings[0]).toContain('fitness version 2');
    expect(saved.replay.step()).not.toBeNull();
  });

  it('makes no random draws: replaying twice from the same model gives the same frames', () => {
    const { out } = champions(4, 1);
    const { stats, record } = out[0]!;
    const model = buildModel({ champion: stats.champion, fitness: stats.bestFitness, generation: 0, record, id: 'twice', createdAt: '2026-11-08T22:00:00.000Z', codeVersion: 'test' });
    const a = replayForModel(model).replay;
    const b = replayForModel(model).replay;
    for (let i = 0; i < 100; i += 1) expect(a.step()).toEqual(b.step());
  });
});

describe('a model that validates can always be set up', () => {
  // The validator mirrors the trainer's own rules by hand, so this checks the two stay in step: for each edit, if the model
  // validates then building its setup and running its replay throws nothing.
  const { out } = champions(3, 1);
  const base = JSON.parse(JSON.stringify(buildModel({ champion: out[0]!.stats.champion, fitness: 1, generation: 0, record: out[0]!.record, id: 'contract', createdAt: '2026-11-08T22:00:00.000Z', codeVersion: 'test' })));
  const registry = tracksIn('training');
  const edits: [string, (d: any) => void][] = [ // eslint-disable-line @typescript-eslint/no-explicit-any
    ...[0, 1, 2, 50, 100_000, 100_001, 2.5, -1].map((n): [string, (d: any) => void] => [`populationSize ${n}`, (d) => { d.training.configuration.populationSize = n; d.training.populationSize = n; }]), // eslint-disable-line @typescript-eslint/no-explicit-any
    ...[0, 1, 50, 51, -1].map((n): [string, (d: any) => void] => [`eliteCount ${n}`, (d) => { d.training.configuration.eliteCount = n; d.training.eliteCount = n; }]), // eslint-disable-line @typescript-eslint/no-explicit-any
    ...[0, 1, 3, 50, 51].map((n): [string, (d: any) => void] => [`selection.size ${n}`, (d) => { d.training.configuration.selection.size = n; d.training.selection.size = n; }]), // eslint-disable-line @typescript-eslint/no-explicit-any
    ...[0, 0.5, 1, 1.0001, -0.0001].map((n): [string, (d: any) => void] => [`crossover.rate ${n}`, (d) => { d.training.configuration.crossover.rate = n; d.training.crossover.rate = n; }]), // eslint-disable-line @typescript-eslint/no-explicit-any
    ...[0, 0.5, 1, 1.0001].map((n): [string, (d: any) => void] => [`mutation.rate ${n}`, (d) => { d.training.configuration.mutation.rate = n; d.training.mutation.rate = n; }]), // eslint-disable-line @typescript-eslint/no-explicit-any
    ...[0, 1, 1e9, -1].map((n): [string, (d: any) => void] => [`mutation.scale ${n}`, (d) => { d.training.configuration.mutation.scale = n; d.training.mutation.scale = n; }]), // eslint-disable-line @typescript-eslint/no-explicit-any
    ...[0, 1, 2, 3.5, 100].map((n): [string, (d: any) => void] => [`maxLaps ${n}`, (d) => (d.training.configuration.maxLaps = n)]), // eslint-disable-line @typescript-eslint/no-explicit-any
    ...[0.001, 0.01, 0.1, 0.5].map((n): [string, (d: any) => void] => [`timestep ${n}`, (d) => (d.training.configuration.timestepSeconds = n)]), // eslint-disable-line @typescript-eslint/no-explicit-any
    ...[0.001, 1, 1e6, 1e7].map((n): [string, (d: any) => void] => [`maxEpisodeSeconds ${n}`, (d) => { d.training.configuration.maxEpisodeSeconds = n; d.training.maxEpisodeSeconds = n; }]), // eslint-disable-line @typescript-eslint/no-explicit-any
    ...[0.001, 1, 1e6, 1e7].map((n): [string, (d: any) => void] => [`stallSeconds ${n}`, (d) => (d.training.configuration.stallSeconds = n)]), // eslint-disable-line @typescript-eslint/no-explicit-any
    ...[0.1, 1, 10, 100].map((n): [string, (d: any) => void] => [`wheelbase ${n}`, (d) => (d.training.configuration.physics.wheelbase = n)]), // eslint-disable-line @typescript-eslint/no-explicit-any
    ...[-1, 0, 0.5, 1.5].map((n): [string, (d: any) => void] => [`maxSteerRadians ${n}`, (d) => (d.training.configuration.physics.maxSteerRadians = n)]), // eslint-disable-line @typescript-eslint/no-explicit-any
    ...[0.1, 2, 4, 40].map((n): [string, (d: any) => void] => [`vehicleLength ${n}`, (d) => (d.training.configuration.physics.vehicleLength = n)]), // eslint-disable-line @typescript-eslint/no-explicit-any
    ...[0.1, 1, 2, 20].map((n): [string, (d: any) => void] => [`vehicleWidth ${n}`, (d) => (d.training.configuration.physics.vehicleWidth = n)]), // eslint-disable-line @typescript-eslint/no-explicit-any
    ...[0, 1, 100].map((n): [string, (d: any) => void] => [`lapWeight ${n}`, (d) => (d.training.configuration.fitness.lapWeight = n)]), // eslint-disable-line @typescript-eslint/no-explicit-any
    ...[0.1, 30, 1000].map((n): [string, (d: any) => void] => [`referenceLapSeconds ${n}`, (d) => (d.training.configuration.fitness.referenceLapSeconds = n)]), // eslint-disable-line @typescript-eslint/no-explicit-any
  ];
  it.each(edits)('%s: validates only if it can be set up and replayed', (_name, edit) => {
    const doc = JSON.parse(JSON.stringify(base));
    edit(doc);
    const result = validateModel(doc, registry);
    if (!result.ok) return;
    const compat = compatibility(result.model);
    if (!compat.drivable) return;
    expect(() => {
      const { replay } = replayForModel(result.model);
      for (let i = 0; i < 300 && !replay.done(); i += 1) replay.step();
    }).not.toThrow();
  });
});
