// The race page's logic in Node (P5-03), against a real model store over a fake storage: choosing a champion, the circuit lists
// (training, validation and saved custom tracks; never a held-out one), the render-time countdown (the simulation does not run
// during it, and a long frame gap is never counted), starting, restarting (the AI repeats exactly), and the true results.
// Seeded and tiny; nothing here is a result about learning or about who drives better.
import { describe, expect, it } from 'vitest';
import { createModelStore } from '../../src/persistence/modelStore';
import { createRaceController, raceClockConfig, COUNTDOWN_SECONDS, MAX_FRAME_SECONDS } from '../../src/ui/raceController';
import { createFixedStepClock } from '../../src/sim/fixedStep';
import { createRaceSetup } from '../../src/training/race';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { loadTrack } from '../../src/sim/track';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { PARAMETER_COUNT } from '../../src/ai/network';
import { entryBelongsTo } from '../../src/ui/modelEvaluation';
import { tracksIn } from '../../src/training/trackSplits';
import type { Controls } from '../../src/sim/vehicle';
import { EVALUATION_TRACKS, MemoryStorage, TRAINING_REGISTRY, makeModel } from '../helpers/evaluationFixtures';

const names = (split: 'training' | 'validation') => tracksIn(split).map((t) => ({ id: t.id, name: t.track.name }));
const HELD_OUT = tracksIn('held-out').map((t) => t.id);
const FULL: Controls = { steering: 0, throttle: 1, brake: 0 };
const IDLE: Controls = { steering: 0, throttle: 0, brake: 0 };

function setup(extra: Partial<Parameters<typeof createRaceController>[0]> = {}) {
  const storage = new MemoryStorage();
  const store = createModelStore({ storage: () => storage, registry: TRAINING_REGISTRY, evaluationTracks: EVALUATION_TRACKS, evaluationBinding: entryBelongsTo });
  expect(store.save(makeModel(21, 'rc-1')).ok).toBe(true);
  const controller = createRaceController({ store, trainingCircuits: names('training'), validationCircuits: names('validation'), ...extra });
  return { storage, store, controller };
}

/** Runs the countdown to its end on a manual render clock at 60 frames a second. */
function countdownToEnd(controller: ReturnType<typeof createRaceController>): number {
  let t = 1000;
  controller.frame(t);
  let frames = 0;
  while (controller.phase() === 'countdown' && frames < 1000) {
    t += 1000 / 60;
    controller.frame(t);
    frames += 1;
  }
  return frames;
}

describe('choosing a race', () => {
  it('lists the saved champions and defaults the circuit to the one it was trained on, 3 laps', () => {
    const { controller } = setup();
    expect(controller.models()).toHaveLength(1);
    expect(controller.canStart()).toBe(false);
    controller.select('rc-1');
    expect(controller.circuit()).toBe(controller.models()[0]!.trainedOn);
    expect(controller.laps()).toBe(3);
    expect(controller.canStart()).toBe(true);
  });

  it('offers training and validation circuits only, never a held-out one, whatever is passed in', () => {
    const { store } = setup();
    const controller = createRaceController({
      store,
      trainingCircuits: [...names('training'), ...HELD_OUT.map((id) => ({ id, name: id }))],
      validationCircuits: [...names('validation'), { id: 'made-up', name: 'Made up' }],
    });
    const ids = controller.circuits().map((c) => c.id);
    expect(ids).toEqual(['stadium-oval', 'kidney-loop', 'rounded-rectangle', 's-sweepers']);
    for (const held of HELD_OUT) expect(ids).not.toContain(held);
    controller.select('rc-1');
    controller.selectCircuit(HELD_OUT[0]!);
    expect(controller.circuit()).not.toBe(HELD_OUT[0]);
  });

  it('only 1 or 3 laps can be chosen', () => {
    const { controller } = setup();
    controller.selectLaps(1);
    expect(controller.laps()).toBe(1);
    for (const bad of [0, 2, 5, NaN, -1]) {
      controller.selectLaps(bad);
      expect(controller.laps()).toBe(1);
    }
  });

  it('refuses to start without a champion, and a damaged or unrunnable one cannot be started', () => {
    const { controller, storage } = setup();
    expect(controller.start()).toBe(false);
    expect(controller.message()).toMatch(/Choose a saved champion/);
    storage.setItem('sdae:model:rc-1', '{"not":"a model"}');
    controller.refresh();
    const bad = controller.models().find((m) => m.id === 'rc-1');
    expect(bad?.usable).toBe(false);
    controller.select('rc-1');
    expect(controller.canStart()).toBe(false);
    expect(controller.start()).toBe(false);
    expect(controller.phase()).toBe('setup');
    expect(controller.message().length).toBeGreaterThan(0);
  });

  it('never starts a race on a held-out circuit even if one were forced in as the chosen id', () => {
    const { controller } = setup();
    controller.select('rc-1');
    // Not offered, so it cannot be chosen; the race still starts on the default circuit only.
    controller.selectCircuit(HELD_OUT[0]!);
    expect(controller.start()).toBe(true);
    expect(HELD_OUT).not.toContain(controller.view()!.setup.context.environment.track.id);
  });

  it('offers the saved custom tracks after the built-in ones, never an ID a built-in circuit uses', () => {
    const { store } = setup();
    const controller = createRaceController({
      store,
      trainingCircuits: names('training'),
      validationCircuits: names('validation'),
      savedTracks: () => [{ id: 'my-track', name: 'Mine' }, { id: 'stadium-oval', name: 'Pretender' }, { id: 'my-track', name: 'Dup' }],
    });
    const custom = controller.circuits().filter((c) => c.split === 'custom');
    expect(custom).toEqual([{ id: 'my-track', name: 'Mine', split: 'custom' }]);
  });
});

describe('the countdown runs on render time and never steps the simulation', () => {
  it('counts 3, 2, 1 then races; no tick runs during it; the cars are at tick 0', () => {
    const { controller } = setup();
    controller.select('rc-1');
    controller.selectLaps(1);
    expect(controller.start()).toBe(true);
    expect(controller.phase()).toBe('countdown');
    expect(controller.countdown()).toBe(COUNTDOWN_SECONDS);
    const before = controller.view()!.state;
    for (let i = 0; i < 50; i += 1) controller.step(FULL);
    expect(controller.view()!.state).toBe(before);
    expect(controller.view()!.state.tick).toBe(0);
    const frames = countdownToEnd(controller);
    expect(frames).toBeGreaterThanOrEqual(COUNTDOWN_SECONDS * 60 - 2);
    expect(controller.phase()).toBe('racing');
    expect(controller.countdown()).toBeNull();
    expect(controller.view()!.state.tick).toBe(0);
    controller.step(FULL);
    expect(controller.view()!.state.tick).toBe(1);
  });

  it('a long gap between frames (a backgrounded tab) never skips the countdown', () => {
    const { controller } = setup();
    controller.select('rc-1');
    controller.start();
    controller.frame(0);
    controller.frame(60_000);
    expect(controller.phase()).toBe('countdown');
    expect(controller.countdown()).toBe(COUNTDOWN_SECONDS);
    controller.frame(60_000 + MAX_FRAME_SECONDS * 1000 * 2);
    expect(controller.phase()).toBe('countdown');
    controller.frame(NaN);
    controller.frame(Infinity);
    expect(controller.phase()).toBe('countdown');
  });

  it('settings cannot change once a race is on, and Back returns to choosing', () => {
    const { controller } = setup();
    controller.select('rc-1');
    controller.start();
    controller.selectLaps(1);
    expect(controller.laps()).toBe(3);
    controller.select(null);
    expect(controller.selected()).toBe('rc-1');
    expect(controller.start()).toBe(false);
    controller.back();
    expect(controller.phase()).toBe('setup');
    expect(controller.view()).toBeNull();
  });
});

describe('racing, restarting and the results', () => {
  const finish = (controller: ReturnType<typeof createRaceController>, controls: Controls, limit = 20_000) => {
    for (let i = 0; i < limit && controller.phase() !== 'finished'; i += 1) controller.step(controls);
  };

  it('ends when both cars have ended and gives results that follow the true outcomes', () => {
    const { controller } = setup();
    controller.select('rc-1');
    controller.selectLaps(1);
    controller.start();
    countdownToEnd(controller);
    expect(controller.result()).toBeNull();
    finish(controller, IDLE);
    expect(controller.phase()).toBe('finished');
    const result = controller.result()!;
    expect(result.human.outcome).toBe('stalled');
    expect(result.ai.outcome).not.toBeNull();
    expect(result.comparison).toMatch(/No winner|tie|faster/);
    if (result.ai.outcome !== 'completed') expect(result.comparison).toMatch(/No winner/);
    expect(result.human.totalSeconds).toBeNull();
    controller.step(FULL);
    expect(controller.result()).toBe(result);
  });

  it('Restart repeats the whole race: the AI takes exactly the same path, the human starts again from the start', () => {
    const { controller } = setup();
    controller.select('rc-1');
    controller.selectLaps(1);
    controller.start();
    countdownToEnd(controller);
    const first: unknown[] = [];
    for (let i = 0; i < 400 && controller.phase() === 'racing'; i += 1) {
      controller.step(FULL);
      first.push(controller.view()!.state.ai);
    }
    // The saved champion really moves, so the repeat below is not a comparison of two parked cars.
    const start = controller.view()!.setup.context.environment.track.start.position;
    const moved = (first[first.length - 1] as { racer: { car: { vehicle: { position: { x: number; y: number } } } } }).racer.car.vehicle.position;
    expect(first.length).toBeGreaterThan(100);
    expect(Math.hypot(moved.x - start.x, moved.y - start.y)).toBeGreaterThan(1);
    expect(controller.restart()).toBe(true);
    expect(controller.phase()).toBe('countdown');
    expect(controller.view()!.state.tick).toBe(0);
    expect(controller.view()!.state.human.racer.progress.gatesPassed).toBe(0);
    countdownToEnd(controller);
    const second: unknown[] = [];
    for (let i = 0; i < first.length; i += 1) {
      controller.step(IDLE);
      second.push(controller.view()!.state.ai);
    }
    expect(second).toEqual(first);
  });

  it('can be restarted from the results, and back to choosing keeps the chosen champion list', () => {
    const { controller } = setup();
    controller.select('rc-1');
    controller.selectLaps(1);
    controller.start();
    countdownToEnd(controller);
    finish(controller, IDLE);
    expect(controller.restart()).toBe(true);
    expect(controller.phase()).toBe('countdown');
    expect(controller.result()).toBeNull();
    controller.back();
    expect(controller.models()).toHaveLength(1);
    expect(controller.restart()).toBe(false);
  });

  it('elapsed seconds are ticks times the champion\'s own timestep', () => {
    const { controller } = setup();
    controller.select('rc-1');
    controller.start();
    countdownToEnd(controller);
    for (let i = 0; i < 120; i += 1) controller.step(FULL);
    const dt = controller.view()!.setup.context.environment.timestepSeconds;
    expect(controller.elapsedSeconds()).toBeCloseTo(120 * dt, 9);
  });

  it('removing the chosen champion while choosing clears the choice', () => {
    const { controller, store } = setup();
    controller.select('rc-1');
    store.remove('rc-1');
    controller.refresh();
    expect(controller.selected()).toBeNull();
    expect(controller.circuit()).toBeNull();
    expect(controller.canStart()).toBe(false);
  });
});

describe('storage trouble', () => {
  it('unavailable storage lists nothing and says why', () => {
    const store = createModelStore({ storage: () => { throw new Error('blocked'); }, registry: TRAINING_REGISTRY });
    const controller = createRaceController({ store, trainingCircuits: names('training'), validationCircuits: names('validation') });
    expect(controller.models()).toEqual([]);
    expect(controller.message().length).toBeGreaterThan(0);
    expect(controller.start()).toBe(false);
  });
});

describe('a champion saved with another training stall limit races under the five-second rule', () => {
  it.each([0.1, 1, 30])('stallSeconds %s in the saved model does not change the race cutoff', (stall) => {
    const storage = new MemoryStorage();
    const store = createModelStore({ storage: () => storage, registry: TRAINING_REGISTRY, evaluationTracks: EVALUATION_TRACKS, evaluationBinding: entryBelongsTo });
    const model = makeModel(21, 'rc-stall') as unknown as { training: { configuration: { stallSeconds: number } } };
    model.training.configuration.stallSeconds = stall;
    expect(store.save(model as never).ok).toBe(true);
    const controller = createRaceController({ store, trainingCircuits: names('training'), validationCircuits: names('validation') });
    controller.select('rc-stall');
    expect(controller.start()).toBe(true);
    const dt = controller.view()!.setup.context.environment.timestepSeconds;
    expect(controller.view()!.setup.context.rules.stallTicks).toBe(Math.ceil(5 / dt - 1e-9));
  });
});

describe("the frame clock follows the champion's own timestep", () => {
  const setupFor = (timestepSeconds: number) =>
    createRaceSetup({ track: loadTrack(stadiumOval), physics: DEFAULT_VEHICLE_PHYSICS, timestepSeconds, laps: 1, genome: new Float64Array(PARAMETER_COUNT), brakeEnabled: true });
  it('a 0.1 s champion gets 10 ticks per real second, not 60 (which would run the race six times too fast)', () => {
    const slow = createFixedStepClock(raceClockConfig(setupFor(0.1)));
    expect(slow.advance(0.5)).toBe(5);
    expect(slow.advance(0.05)).toBe(0);
    expect(slow.advance(0.05)).toBe(1);
    const standard = createFixedStepClock(raceClockConfig(setupFor(DEFAULT_SIM_CONFIG.timestepSeconds)));
    expect(standard.advance(2 / 60)).toBe(2);
  });
  it('keeps the default catch-up limit', () => {
    expect(raceClockConfig(setupFor(0.1)).maxStepsPerFrame).toBe(DEFAULT_SIM_CONFIG.maxStepsPerFrame);
    const fast = createFixedStepClock(raceClockConfig(setupFor(0.1)));
    expect(fast.advance(10)).toBeLessThanOrEqual(DEFAULT_SIM_CONFIG.maxStepsPerFrame);
  });
});
