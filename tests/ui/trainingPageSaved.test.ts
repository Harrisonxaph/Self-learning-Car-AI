// Saved champions (P3-05) on the page's real wiring: `startTrainingPage` runs in Node with fake frames, a fake localStorage
// and fake DOM nodes. The claims: saving stores a valid model of the chosen generation's champion; a saved champion
// replays exactly as the original did and never reaches the trainer; every storage failure becomes a message while
// training and replay keep working; deleting takes two steps; a reload (a new page on the same storage) finds the saves.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { INDEX_KEY, MODEL_KEY_PREFIX, MAX_SAVES } from '../../src/persistence/modelStore';
import { validateModel } from '../../src/persistence/modelFormat';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS, terminalSpeed } from '../../src/sim/config';
import { loadTrack } from '../../src/sim/track';
import { createChampionReplay } from '../../src/training/championReplay';
import { tracksIn } from '../../src/training/trackSplits';
import { createTrainer, DEFAULT_TRAINING_CONFIG, evaluateGenome } from '../../src/training/trainer';
import { replayForModel } from '../../src/ui/savedReplay';
import { startTrainingPage } from '../../src/ui/trainingPage';
import { FakeFrames } from './fakeFrames';
import { FakeLocalStorage, fakePage, type FakeNode } from './fakeTrainingPage';

const calls = vi.hoisted(() => ({ cars: [] as { x: number; y: number }[][] }));
/** Makes a replay throw from the given tick on, to test that a failing network never escapes the frame. */
const fault = vi.hoisted(() => ({ at: null as number | null }));
vi.mock('../../src/training/championReplay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/training/championReplay')>();
  return {
    ...actual,
    createChampionReplay: (genome: Float64Array, setup: Parameters<typeof actual.createChampionReplay>[1]) => {
      const real = actual.createChampionReplay(genome, setup);
      return {
        ...real,
        step() {
          if (fault.at !== null && real.ticks() >= fault.at) throw new RangeError('Hidden pre-activation 0 is not finite (Infinity).');
          return real.step();
        },
      };
    },
  };
});
vi.mock('../../src/render/raceView', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/render/raceView')>();
  return {
    ...actual,
    drawCars: (_c: unknown, _s: unknown, _v: unknown, cars: readonly { car: { vehicle: { position: { x: number; y: number } } } }[]) => {
      calls.cars.push(cars.map(({ car }) => ({ x: car.vehicle.position.x, y: car.vehicle.position.y })));
    },
  };
});
vi.mock('../../src/render/sensorView', () => ({ drawSensors: () => {} }));

const DT = DEFAULT_SIM_CONFIG.timestepSeconds;
const FRAME_MS = DT * 1000;
const ENV = { track: loadTrack(stadiumOval), physics: DEFAULT_VEHICLE_PHYSICS, timestepSeconds: DT };
const STATS = ['lastBest', 'lastMean', 'lastCrashed', 'lastStalled', 'lastLaps'] as const;
const REGISTRY = tracksIn('training');

beforeEach(() => {
  calls.cars.length = 0;
  fault.at = null;
});

function setup(options: { storage?: () => FakeLocalStorage | null } = {}) {
  let t = 0;
  const frames = new FakeFrames();
  const made = fakePage(frames, { now: () => (t += 0.5), drawing: true, ...(options.storage ? { storage: options.storage } : {}) });
  startTrainingPage(made.page);
  let frame = 0;
  const run = (count = 1) => {
    for (let i = 0; i < count; i += 1) frames.fire((frame++) * FRAME_MS);
  };
  const completeGenerations = (count: number) => {
    made.controls.speeds.max.click();
    run();
    for (let i = 0; i < 100_000 && Number(made.canvas.dataset.completedGenerations) < count; i += 1) run();
    expect(Number(made.canvas.dataset.completedGenerations)).toBeGreaterThanOrEqual(count);
    made.controls.speeds.normal.click();
    run();
  };
  const rows = () => made.saved.list.children;
  const button = (row: FakeNode, text: string) => row.find((n) => n.tag === 'button' && n.textContent === text)[0]!;
  return { ...made, frames, run, completeGenerations, rows, button };
}

const independent = (generations: number) => {
  const trainer = createTrainer(DEFAULT_TRAINING_CONFIG, ENV);
  const stats = Array.from({ length: generations }, () => trainer.runGeneration());
  return { trainer, stats };
};

describe('saving', () => {
  it('cannot save before a generation has completed, and can afterwards', () => {
    const p = setup();
    p.run(2);
    expect(p.saved.save.disabled).toBe(true);
    p.saved.save.click();
    expect(p.savedStorage.data.size).toBe(0);
    p.completeGenerations(1);
    expect(p.saved.save.disabled).toBe(false);
  });

  it("stores a valid model of the chosen generation's champion, names it, lists it and says so", () => {
    const p = setup();
    p.completeGenerations(2);
    const { stats } = independent(2);
    p.replay.generation.value = '2';
    p.saved.name.value = '  My best  ';
    p.saved.save.click();
    expect(p.saved.status.textContent).toBe('Saved "My best" (generation 2).');
    expect(p.saved.name.value).toBe('');
    expect(p.savedStorage.data.size).toBe(2);
    const id = JSON.parse(p.savedStorage.data.get(INDEX_KEY)!)[0] as string;
    expect(id).toBe('saved-1');
    const result = validateModel(JSON.parse(p.savedStorage.data.get(`${MODEL_KEY_PREFIX}${id}`)!), REGISTRY);
    if (!result.ok) throw new Error(result.errors.join('; '));
    expect(result.model.name).toBe('My best');
    expect(result.model.training.generation).toBe(1);
    expect(result.model.fitness).toBe(stats[1]!.bestFitness);
    stats[1]!.champion.forEach((v, i) => expect(Object.is(result.model.parameters.values[i], v === 0 ? 0 : v)).toBe(true));
    expect(p.rows()).toHaveLength(1);
    expect(p.saved.list.attributes['data-count']).toBe('1');
  });

  it('saves the champion of an earlier generation, not whatever is being trained now', () => {
    const p = setup();
    p.completeGenerations(4);
    const count = Number(p.canvas.dataset.completedGenerations);
    const { stats } = independent(count);
    const earlier = stats.findIndex((s) => s.champion.some((v, i) => v !== stats[count - 1]!.champion[i]));
    expect(earlier).toBeGreaterThanOrEqual(0);
    p.replay.generation.value = String(earlier + 1);
    p.saved.save.click();
    const saved = JSON.parse(p.savedStorage.data.get(`${MODEL_KEY_PREFIX}saved-1`)!);
    expect(saved.training.generation).toBe(earlier);
    expect(saved.parameters.values).toEqual(Array.from(stats[earlier]!.champion, (v) => (v === 0 ? 0 : v)));
    expect(saved.parameters.values).not.toEqual(Array.from(stats[count - 1]!.champion));
  });

  it('names an unnamed save after its generation, and caps a long name', () => {
    const p = setup();
    p.completeGenerations(1);
    p.saved.save.click();
    expect(p.saved.status.textContent).toBe('Saved "Generation 1 champion" (generation 1).');
    p.saved.name.value = 'x'.repeat(200);
    p.saved.save.click();
    const second = JSON.parse(p.savedStorage.data.get(`${MODEL_KEY_PREFIX}saved-2`)!);
    expect(second.name).toHaveLength(60);
  });

  it('gives each save its own id and keeps them in order', () => {
    const p = setup();
    p.completeGenerations(1);
    for (let i = 0; i < 3; i += 1) p.saved.save.click();
    expect(JSON.parse(p.savedStorage.data.get(INDEX_KEY)!)).toEqual(['saved-1', 'saved-2', 'saved-3']);
    expect(p.rows()).toHaveLength(3);
  });

  it('asks to delete one at the cap, and writes nothing more', () => {
    const p = setup();
    p.completeGenerations(1);
    for (let i = 0; i < MAX_SAVES; i += 1) p.saved.save.click();
    const size = p.savedStorage.data.size;
    p.saved.save.click();
    expect(p.saved.status.textContent).toContain(`${MAX_SAVES} saved champions`);
    expect(p.savedStorage.data.size).toBe(size);
  });

  it('does not change what is trained', () => {
    const run = (save: boolean) => {
      const p = setup();
      p.completeGenerations(1);
      if (save) {
        p.saved.save.click();
        p.button(p.rows()[0]!, 'Replay').click();
        p.run(100);
        p.replay.stop.click();
      }
      p.controls.speeds.max.click();
      for (let i = 0; i < 100_000 && p.canvas.dataset.lastGeneration !== '3'; i += 1) p.run();
      return STATS.map((name) => p.canvas.dataset[name]);
    };
    expect(run(true)).toEqual(run(false));
  });
});

describe('replaying a saved champion', () => {
  it('replays exactly as the original did, ending with the same outcome and time, without moving training', () => {
    const p = setup();
    p.completeGenerations(1);
    p.saved.name.value = 'Replayable';
    p.saved.save.click();
    const { trainer, stats } = independent(1);
    const original = evaluateGenome(stats[0]!.champion, trainer.setup);
    const reference = createChampionReplay(stats[0]!.champion, trainer.setup);
    const before = [p.canvas.dataset.generation, p.canvas.dataset.generationTick, p.canvas.dataset.tick];
    p.button(p.rows()[0]!, 'Replay').click();
    p.run();
    expect(p.canvas.dataset.replay).toBe('running');
    expect(p.canvas.dataset.replaySource).toBe('saved');
    expect(p.canvas.dataset.replayGeneration).toBeUndefined();
    expect(p.saved.status.textContent).toContain('Replaying "Replayable" from generation 1.');
    expect(p.status.textContent).toContain('replaying saved champion "Replayable"');
    let steps = 0;
    let checked = 0;
    for (let guard = 0; guard < 100_000 && p.canvas.dataset.replay === 'running'; guard += 1) {
      p.run();
      const ticks = Number(p.canvas.dataset.replayTick);
      let frame = null as ReturnType<typeof reference.step>;
      while (steps < ticks) {
        frame = reference.step();
        steps += 1;
      }
      if (frame && p.canvas.dataset.replay === 'running') {
        const { position } = frame.before.racer.car.vehicle;
        expect(calls.cars[calls.cars.length - 1]![0]).toEqual({ x: position.x, y: position.y });
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(20);
    expect(p.canvas.dataset.replay).toBe('done');
    expect(p.canvas.dataset.replayOutcome).toBe(original.episode.outcome);
    expect(Number(p.canvas.dataset.replayTick)).toBe(reference.ticks());
    expect(p.replay.outputs.status.textContent).toContain('Replay of saved champion "Replayable" finished');
    expect([p.canvas.dataset.generation, p.canvas.dataset.generationTick, p.canvas.dataset.tick]).toEqual(before);
  });

  it('is found again after a reload: a new page on the same storage lists and replays it', () => {
    const storage = new FakeLocalStorage();
    const first = setup({ storage: () => storage });
    first.completeGenerations(1);
    first.saved.save.click();
    const second = setup({ storage: () => storage });
    expect(second.rows()).toHaveLength(1);
    expect(second.saved.list.attributes['data-status']).toBeUndefined();
    expect(second.rows()[0]!.attributes['data-status']).toBe('ok');
    second.run();
    second.button(second.rows()[0]!, 'Replay').click();
    second.run(30);
    expect(second.canvas.dataset.replay).toBe('running');
    expect(Number(second.canvas.dataset.replayTick)).toBeGreaterThan(10);
  });

  it('stops being possible for a damaged entry, which can only be deleted', () => {
    const storage = new FakeLocalStorage();
    storage.setItem(`${MODEL_KEY_PREFIX}junk`, '{not json');
    const p = setup({ storage: () => storage });
    const row = p.rows()[0]!;
    expect(row.attributes['data-status']).toBe('damaged');
    expect(row.find((n) => n.tag === 'button').map((b) => b.textContent)).toEqual(['Delete']);
  });
});

describe('deleting', () => {
  it('takes two steps, can be cancelled, and removes only that save', () => {
    const p = setup();
    p.completeGenerations(1);
    p.saved.save.click();
    p.saved.save.click();
    p.button(p.rows()[0]!, 'Delete').click();
    expect(p.savedStorage.data.size).toBe(3); // nothing deleted by the first tap
    expect(p.rows()[0]!.find((n) => n.tag === 'button').map((b) => b.textContent)).toEqual(['Replay', 'Yes, delete', 'Keep']);
    p.button(p.rows()[0]!, 'Keep').click();
    expect(p.savedStorage.data.size).toBe(3);
    expect(p.rows()[0]!.find((n) => n.tag === 'button').map((b) => b.textContent)).toEqual(['Replay', 'Delete']);
    p.button(p.rows()[0]!, 'Delete').click();
    p.button(p.rows()[0]!, 'Yes, delete').click();
    expect(p.saved.status.textContent).toBe('Deleted.');
    expect(p.rows()).toHaveLength(1);
    expect(p.savedStorage.data.has(`${MODEL_KEY_PREFIX}saved-1`)).toBe(false);
    expect(p.savedStorage.data.has(`${MODEL_KEY_PREFIX}saved-2`)).toBe(true);
  });
});

describe('browser storage that fails', () => {
  it('keeps training and replay working and says so when localStorage is denied', () => {
    const p = setup({ storage: () => { throw new Error('SecurityError'); } });
    expect(p.saved.status.textContent).toContain('Browser storage is unavailable');
    p.completeGenerations(1);
    p.saved.save.click();
    expect(p.saved.status.textContent).toContain('Browser storage is unavailable');
    expect(p.rows()).toHaveLength(0);
    // A live champion still replays.
    p.replay.start.click();
    p.run(30);
    expect(p.canvas.dataset.replay).toBe('running');
    p.replay.stop.click();
    p.run();
    expect(Number(p.canvas.dataset.completedGenerations)).toBeGreaterThanOrEqual(1);
  });

  it('reports a full store, and leaves the page working', () => {
    const storage = new FakeLocalStorage();
    const p = setup({ storage: () => storage });
    p.completeGenerations(1);
    storage.setItem = () => {
      throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    };
    p.saved.save.click();
    expect(p.saved.status.textContent).toContain('Browser storage is full');
    p.run(5);
    expect(p.canvas.dataset.mode).toBe('train');
  });

  it('treats a cleared store as empty', () => {
    const storage = new FakeLocalStorage();
    const p = setup({ storage: () => storage });
    p.completeGenerations(1);
    p.saved.save.click();
    storage.data.clear();
    p.replay.details.toggle(true);
    expect(p.rows()).toHaveLength(0);
  });
});

describe('a saved champion keeps its own recorded setup', () => {
  it('replays with the physics and timestep it was saved with while the page trains under its own', () => {
    const storage = new FakeLocalStorage();
    const p = setup({ storage: () => storage });
    p.completeGenerations(1);
    p.saved.save.click();
    const key = `${MODEL_KEY_PREFIX}saved-1`;
    const doc = JSON.parse(storage.data.get(key)!);
    const physics = { ...doc.training.configuration.physics, engineAcceleration: 6 };
    doc.training.configuration.physics = { ...physics, maxSpeed: terminalSpeed(physics) };
    storage.data.set(key, JSON.stringify(doc));
    p.replay.details.toggle(true);
    expect(p.rows()[0]!.attributes['data-status']).toBe('ok');
    expect(p.rows()[0]!.find((n) => n.attributes.class === 'saved-warning')[0]!.textContent).toContain('different vehicle physics');

    // The reference: the same document replayed under its own setup. The live champion's replay differs.
    const { trainer, stats } = independent(1);
    const saved = replayForModel(doc);
    const live = createChampionReplay(stats[0]!.champion, trainer.setup);
    p.button(p.rows()[0]!, 'Replay').click();
    p.run();
    let frames = 0;
    for (let guard = 0; guard < 100_000 && p.canvas.dataset.replay === 'running'; guard += 1) {
      p.run();
      while (frames < Number(p.canvas.dataset.replayTick)) {
        saved.replay.step();
        live.step();
        frames += 1;
      }
    }
    expect(p.canvas.dataset.replay).toBe('done');
    expect(Number(p.canvas.dataset.replayTick)).toBe(saved.replay.ticks());
    expect(saved.replay.state().episode.outcome).toBe(p.canvas.dataset.replayOutcome);
    // Slower acceleration changes the drive, so a replay under the page's own setup would have ended differently.
    expect(saved.replay.state()).not.toEqual(live.state());
    // Training did not take the saved physics.
    expect(trainer.setup.environment.physics.engineAcceleration).toBe(DEFAULT_VEHICLE_PHYSICS.engineAcceleration);
  });
});

/** Opens the panel and returns a page with one saved champion whose stored document was edited by `edit`. */
function withEditedSave(edit: (doc: any) => void) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const storage = new FakeLocalStorage();
  const p = setup({ storage: () => storage });
  p.completeGenerations(1);
  p.saved.save.click();
  const key = `${MODEL_KEY_PREFIX}saved-1`;
  const doc = JSON.parse(storage.data.get(key)!);
  edit(doc);
  storage.data.set(key, JSON.stringify(doc));
  p.replay.details.toggle(true);
  return { p, storage };
}

describe('a replay that fails does not take the page with it', () => {
  it('refuses a finite genome whose network overflows, with a message, before anything starts', () => {
    const { p } = withEditedSave((d) => (d.parameters.values = d.parameters.values.map(() => Number.MAX_VALUE)));
    expect(p.rows()[0]!.attributes['data-status']).toBe('ok'); // it validates: the numbers are finite
    const before = Number(p.canvas.dataset.tick);
    p.button(p.rows()[0]!, 'Replay').click();
    expect(p.saved.status.textContent).toContain('numbers too large to compute');
    p.run(60);
    expect(p.canvas.dataset.replay).toBe('off');
    expect(p.controls.speeds.fast.disabled).toBe(false);
    expect(Number(p.canvas.dataset.tick)).toBeGreaterThan(before);
    expect(p.canvas.dataset.mode).toBe('train');
  });

  it('stops a replay that fails part-way, says so, restores the controls, and keeps training', () => {
    const { p } = withEditedSave(() => {});
    p.controls.speeds.fast.click();
    p.run();
    p.button(p.rows()[0]!, 'Replay').click();
    p.run(40);
    expect(p.canvas.dataset.replay).toBe('running');
    const ticks = Number(p.canvas.dataset.replayTick);
    fault.at = ticks + 3;
    p.run(10); // the failure happens inside the frame handler
    expect(p.canvas.dataset.replay).toBe('off');
    expect(p.saved.status.textContent).toContain('The replay of saved champion');
    expect(p.saved.status.textContent).toContain('Training carries on');
    expect(p.canvas.dataset.speed).toBe('fast');
    expect(p.controls.speeds.max.disabled).toBe(false);
    const tick = Number(p.canvas.dataset.tick);
    p.run(30);
    expect(Number(p.canvas.dataset.tick)).toBeGreaterThan(tick);
  });
});

describe("a saved champion's own timestep sets its pace and its readouts", () => {
  const shorten = (dt: number) => (d: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    d.training.configuration.timestepSeconds = dt;
    d.training.configuration.maxEpisodeSeconds = 1;
    d.training.maxEpisodeSeconds = 1;
  };
  it('runs a 1/30 s recording at 1× against the page clock: about 30 ticks a second, shown as that much time', () => {
    const { p } = withEditedSave(shorten(1 / 30));
    p.button(p.rows()[0]!, 'Replay').click();
    p.run(); // the first frame only records time
    p.run(60); // one second of page time
    expect(Number(p.canvas.dataset.replayTick)).toBeGreaterThanOrEqual(29);
    expect(Number(p.canvas.dataset.replayTick)).toBeLessThanOrEqual(30);
    p.run(10);
    expect(p.canvas.dataset.replay).toBe('done');
    const ticks = Number(p.canvas.dataset.replayTick);
    expect(ticks).toBeLessThanOrEqual(30);
    expect(p.replay.outputs.result.textContent).toContain(`after ${(ticks / 30).toFixed(2)} s`);
    expect(p.replay.outputs.decision.textContent).toContain(`Decision ${ticks} at ${((ticks - 1) / 30).toFixed(2)} s`);
  });
  it('runs a 1/120 s recording two ticks to a page tick', () => {
    const { p } = withEditedSave(shorten(1 / 120));
    p.button(p.rows()[0]!, 'Replay').click();
    p.run();
    p.run(30); // half a second of page time
    expect(Number(p.canvas.dataset.replayTick)).toBeGreaterThanOrEqual(58);
    expect(Number(p.canvas.dataset.replayTick)).toBeLessThanOrEqual(60);
  });
  it('keeps a live champion at one tick to a page tick', () => {
    const p = setup();
    p.completeGenerations(1);
    p.replay.start.click();
    p.run();
    p.run(30);
    expect(Number(p.canvas.dataset.replayTick)).toBeGreaterThanOrEqual(29);
    expect(Number(p.canvas.dataset.replayTick)).toBeLessThanOrEqual(30);
  });
});

describe('restarting', () => {
  it('restarts the saved champion that is running, and never switches to a live generation', () => {
    const { p } = withEditedSave(() => {});
    p.button(p.rows()[0]!, 'Replay').click();
    p.run(60);
    expect(p.replay.start.textContent).toBe('Restart saved');
    expect(p.replay.start.attributes['aria-label']).toBe('Restart saved champion');
    expect(Number(p.canvas.dataset.replayTick)).toBeGreaterThan(20);
    p.replay.start.click();
    p.run();
    expect(p.canvas.dataset.replaySource).toBe('saved');
    expect(p.canvas.dataset.replayGeneration).toBeUndefined();
    expect(Number(p.canvas.dataset.replayTick)).toBeLessThanOrEqual(1);
    p.run(10);
    expect(p.canvas.dataset.replaySource).toBe('saved');
  });
  it('lets a live replay still restart from the generation picked', () => {
    const p = setup();
    p.completeGenerations(2);
    p.replay.generation.value = '1';
    p.replay.start.click();
    p.run(20);
    expect(p.replay.start.textContent).toBe('Restart');
    p.replay.generation.value = '2';
    p.replay.start.click();
    p.run();
    expect(p.canvas.dataset.replaySource).toBe('generation');
    expect(p.canvas.dataset.replayGeneration).toBe('2');
  });
});

describe('storage that cannot be fully read', () => {
  it('says so when the index cannot be read but the saves can, and lists them', () => {
    const storage = new FakeLocalStorage();
    const first = setup({ storage: () => storage });
    first.completeGenerations(1);
    first.saved.save.click();
    const real = storage.getItem.bind(storage);
    storage.getItem = (key: string) => {
      if (key === INDEX_KEY) throw new Error('denied');
      return real(key);
    };
    const second = setup({ storage: () => storage });
    expect(second.rows()).toHaveLength(1);
    expect(second.saved.status.textContent).toContain('could not be fully read');
  });
  it('says storage is unavailable, not that nothing is saved, when every read throws', () => {
    const storage = new FakeLocalStorage();
    storage.getItem = () => {
      throw new Error('denied');
    };
    Object.defineProperty(storage, 'length', { get: () => { throw new Error('denied'); } });
    const p = setup({ storage: () => storage });
    expect(p.saved.status.textContent).toContain('Browser storage is unavailable');
    expect(p.rows()).toHaveLength(0);
  });
});
