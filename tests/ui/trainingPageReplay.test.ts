// The champion replay (P3-04) on the page's real wiring: `startTrainingPage` runs in Node with fake frames and DOM
// objects. The claims: a replay pauses training and does not change what is trained afterwards; it draws one car in its
// decision state with the rays of that decision, and shows the inputs and outputs of that tick; it ends with the same
// outcome and time as the original evaluation; the controls clamp, restore and exclude each other. Seeded only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { INPUT_COUNT, INPUT_NAMES } from '../../src/ai/inputs';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { loadTrack } from '../../src/sim/track';
import { createChampionReplay } from '../../src/training/championReplay';
import { createTrainer, DEFAULT_TRAINING_CONFIG, evaluateGenome } from '../../src/training/trainer';
import { startTrainingPage } from '../../src/ui/trainingPage';
import { FakeFrames } from './fakeFrames';
import { fakePage } from './fakeTrainingPage';

const calls = vi.hoisted(() => ({
  cars: [] as { x: number; y: number; heading: number; finished: boolean }[][],
  rays: [] as unknown[],
}));
vi.mock('../../src/render/raceView', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/render/raceView')>();
  return {
    ...actual,
    drawCars: (_c: unknown, _s: unknown, _v: unknown, cars: readonly { car: { vehicle: { position: { x: number; y: number }; heading: number } }; finished: boolean }[]) => {
      calls.cars.push(cars.map(({ car, finished }) => ({ x: car.vehicle.position.x, y: car.vehicle.position.y, heading: car.vehicle.heading, finished })));
    },
  };
});
vi.mock('../../src/render/sensorView', () => ({
  drawSensors: (_c: unknown, _s: unknown, _v: unknown, readings: unknown) => {
    calls.rays.push(readings);
  },
}));

const DT = DEFAULT_SIM_CONFIG.timestepSeconds;
const FRAME_MS = DT * 1000;
const ENV = { track: loadTrack(stadiumOval), physics: DEFAULT_VEHICLE_PHYSICS, timestepSeconds: DT };
const STATS = ['lastBest', 'lastMean', 'lastCrashed', 'lastStalled', 'lastLaps'] as const;

beforeEach(() => {
  calls.cars.length = 0;
  calls.rays.length = 0;
});

function setup() {
  let t = 0;
  const frames = new FakeFrames();
  // Each read of the clock costs half a millisecond, so Max speed's time budget bounds a frame.
  const made = fakePage(frames, { now: () => (t += 0.5), drawing: true });
  startTrainingPage(made.page);
  let frame = 0;
  const run = (count = 1) => {
    for (let i = 0; i < count; i += 1) frames.fire((frame++) * FRAME_MS);
  };
  /** Runs at Max until `count` generations have completed, then back to 1×. */
  const completeGenerations = (count: number) => {
    made.controls.speeds.max.click();
    run(); // the first frame writes the data attributes
    for (let i = 0; i < 100_000 && Number(made.canvas.dataset.completedGenerations) < count; i += 1) run();
    expect(Number(made.canvas.dataset.completedGenerations)).toBeGreaterThanOrEqual(count);
    made.controls.speeds.normal.click();
  };
  return { ...made, frames, run, completeGenerations };
}

const independent = () => {
  const trainer = createTrainer(DEFAULT_TRAINING_CONFIG, ENV);
  const stats = trainer.runGeneration();
  return { trainer, stats, original: evaluateGenome(stats.champion, trainer.setup) };
};

describe('the panel before and after the first generation', () => {
  it('is shown, with nothing to replay yet', () => {
    const { replay, run } = setup();
    expect(replay.details.hidden).toBe(false);
    expect(replay.start.disabled).toBe(true);
    expect(replay.stop.disabled).toBe(true);
    expect(replay.generation.disabled).toBe(true);
    expect(replay.note.textContent).toContain('No generation completed yet');
    run(3);
    expect(replay.start.disabled).toBe(true);
  });

  it('enables Replay and sets the range once a generation has completed', () => {
    const { replay, completeGenerations, run } = setup();
    completeGenerations(1);
    run();
    expect(replay.start.disabled).toBe(false);
    expect(replay.generation.disabled).toBe(false);
    expect(replay.generation.attributes.min).toBe('1');
    expect(Number(replay.generation.attributes.max)).toBeGreaterThanOrEqual(1);
    expect(replay.stop.disabled).toBe(true);
  });
});

describe('a replay on the page', () => {
  it('pauses training, runs at 1×, draws one car in its decision state with that decision’s rays, and ends like the original', () => {
    const { replay, canvas, controls, status, completeGenerations, run } = setup();
    completeGenerations(1);
    run();
    const { stats, original, trainer } = independent();
    controls.speeds.fast.click();
    replay.generation.value = '1';
    replay.start.click();
    run();
    expect(canvas.dataset.replay).toBe('running');
    expect(controls.speeds.normal.attributes['aria-pressed']).toBe('true');
    expect(controls.speeds.fast.disabled).toBe(true);
    expect(controls.drawCap.disabled).toBe(true);
    expect(replay.stop.disabled).toBe(false);
    expect(replay.start.textContent).toBe('Restart');

    const trainingBefore = [canvas.dataset.generation, canvas.dataset.generationTick, canvas.dataset.tick];
    const reference = createChampionReplay(stats.champion, trainer.setup);
    calls.cars.length = 0;
    calls.rays.length = 0;
    run(); // the first frame after a start only records time, as after any pause or resume
    let expectedFrame = null as ReturnType<typeof reference.step>;
    let steps = 0;
    for (let guard = 0; guard < 100_000 && canvas.dataset.replay === 'running'; guard += 1) {
      run();
      const ticksNow = Number(canvas.dataset.replayTick);
      while (steps < ticksNow) {
        expectedFrame = reference.step();
        steps += 1;
      }
      if (canvas.dataset.replay === 'running' && expectedFrame && steps >= 5 && steps % 25 === 0) {
        // The drawn car and rays are the decision state of the latest frame, and the text is that decision.
        const drawn = calls.cars[calls.cars.length - 1]!;
        expect(drawn).toHaveLength(1);
        const { position, heading } = expectedFrame.before.racer.car.vehicle;
        expect(drawn[0]).toEqual({ x: position.x, y: position.y, heading, finished: false });
        expect(calls.rays[calls.rays.length - 1]).toEqual(expectedFrame.decision.readings);
        expect(replay.outputs.inputs.map((o) => o.textContent)).toEqual(expectedFrame.decision.inputs.map((v) => v.toFixed(3)));
        expect(replay.outputs.steering.textContent).toBe(expectedFrame.decision.controls.steering.toFixed(3));
        expect(replay.outputs.throttle.textContent).toBe(expectedFrame.decision.controls.throttle.toFixed(3));
        expect(replay.outputs.brake.textContent).toBe(expectedFrame.decision.controls.brake.toFixed(3));
        expect(replay.outputs.decision.textContent).toBe(`Decision ${expectedFrame.tick} at ${((expectedFrame.tick - 1) * DT).toFixed(2)} s`);
        expect(status.textContent).toContain('replaying generation 1');
      }
    }
    // Training waited.
    expect([canvas.dataset.generation, canvas.dataset.generationTick, canvas.dataset.tick]).toEqual(trainingBefore);

    // It ended where the original evaluation ended, with the same outcome and time.
    expect(canvas.dataset.replay).toBe('done');
    expect(canvas.dataset.replayOutcome).toBe(original.episode.outcome);
    expect(Number(canvas.dataset.replayTick)).toBe(reference.ticks());
    expect(reference.state()).toEqual({ racer: original.racer, episode: original.episode });
    expect(replay.outputs.result.textContent).toContain(`${original.episode.outcome} after ${(reference.ticks() * DT).toFixed(2)} s`);
    expect(replay.outputs.status.textContent).toContain('Replay of generation 1 finished');
    expect(replay.outputs.decision.textContent).toContain('(the last)');
    // The finished car is drawn in its result state with no rays.
    calls.cars.length = 0;
    calls.rays.length = 0;
    run(3);
    const end = reference.state().racer.car.vehicle;
    expect(calls.cars[calls.cars.length - 1]![0]).toEqual({ x: end.position.x, y: end.position.y, heading: end.heading, finished: true });
    expect(calls.rays).toHaveLength(0);
  });

  it('goes back to training with the same speed, pause state and statistics as if it had never been watched', () => {
    const watched = setup();
    watched.completeGenerations(1);
    watched.controls.speeds.fast.click();
    watched.controls.pause.click(); // paused at 4× when the replay starts
    watched.run();
    watched.replay.start.click();
    expect(watched.controls.pause.attributes['aria-label']).toBe('Pause training'); // a replay runs
    watched.run(200);
    watched.replay.stop.click();
    watched.run();
    expect(watched.canvas.dataset.replay).toBe('off');
    expect(watched.canvas.dataset.speed).toBe('fast');
    expect(watched.canvas.dataset.paused).toBe('true');
    expect(watched.controls.speeds.fast.disabled).toBe(false);
    expect(watched.controls.drawCap.disabled).toBe(false);
    expect(watched.replay.outputs.result.textContent).toBe('');
    watched.controls.pause.click();
    watched.controls.speeds.max.click();

    const plain = setup();
    plain.completeGenerations(1);
    plain.controls.speeds.max.click();

    for (const run of [watched, plain]) {
      for (let i = 0; i < 100_000 && run.canvas.dataset.lastGeneration !== '3'; i += 1) run.run();
    }
    expect(STATS.map((name) => watched.canvas.dataset[name])).toEqual(STATS.map((name) => plain.canvas.dataset[name]));
    expect(watched.canvas.dataset.lastGeneration).toBe('3');
  });

  it('restarts a running replay from the start with Restart, and picks any completed generation', () => {
    const { replay, canvas, completeGenerations, run } = setup();
    completeGenerations(2);
    run();
    replay.generation.value = '2';
    replay.start.click();
    run(40);
    expect(canvas.dataset.replayGeneration).toBe('2');
    expect(Number(canvas.dataset.replayTick)).toBeGreaterThan(10);
    replay.generation.value = '1';
    replay.start.click();
    run();
    expect(canvas.dataset.replayGeneration).toBe('1');
    expect(Number(canvas.dataset.replayTick)).toBeLessThanOrEqual(1);
  });

  it('replays the champion of the generation that was chosen, not another one', () => {
    const trainer = createTrainer(DEFAULT_TRAINING_CONFIG, ENV);
    const champions = Array.from({ length: 6 }, () => trainer.runGeneration().champion);
    const chosen = champions.findIndex((champion) => champion.some((value, i) => value !== champions[0]![i]));
    expect(chosen).toBeGreaterThan(0);
    const { replay, canvas, completeGenerations, run } = setup();
    completeGenerations(chosen + 1);
    run();
    replay.generation.value = String(chosen + 1);
    replay.start.click();
    run(3);
    const own = createChampionReplay(champions[chosen]!, trainer.setup);
    const first = own.step()!;
    const other = createChampionReplay(champions[0]!, trainer.setup).step()!;
    // The first decision is taken from the start pose, so the inputs match only when the network and genome do.
    expect(replay.outputs.decision.textContent).toMatch(/^Decision \d+ at/);
    const shown = replay.outputs.steering.textContent;
    const frameNow = Number(canvas.dataset.replayTick);
    const mine = createChampionReplay(champions[chosen]!, trainer.setup);
    const theirs = createChampionReplay(champions[0]!, trainer.setup);
    let a = null as ReturnType<typeof mine.step>;
    let b = null as ReturnType<typeof theirs.step>;
    for (let i = 0; i < frameNow; i += 1) {
      a = mine.step();
      b = theirs.step();
    }
    expect(first.decision.inputs).toEqual(other.decision.inputs);
    expect(shown).toBe(a!.decision.controls.steering.toFixed(3));
    expect(a!.decision.controls.steering).not.toBe(b!.decision.controls.steering);
  });

  it('clamps the generation to the completed range and ignores nonsense', () => {
    const { replay, canvas, completeGenerations, run } = setup();
    completeGenerations(2);
    run();
    const count = Number(canvas.dataset.completedGenerations);
    for (const [typed, expected] of [['99999', String(count)], ['0', '1'], ['-4', '1'], ['2.9', '2'], ['abc', String(count)], ['', String(count)]] as const) {
      replay.generation.value = typed;
      replay.generation.fire('change');
      expect(replay.generation.value, JSON.stringify(typed)).toBe(expected);
    }
  });

  it('stops when the panel is closed, and the graph and the replay are never open together', () => {
    const { replay, graph, canvas, completeGenerations, run } = setup();
    completeGenerations(1);
    run();
    graph.details.open = true;
    replay.details.toggle(true);
    expect(graph.details.open).toBe(false);
    replay.start.click();
    run(5);
    expect(canvas.dataset.replay).toBe('running');
    replay.details.toggle(false);
    expect(canvas.dataset.replay).toBe('running'); // until the next frame writes it
    run();
    expect(canvas.dataset.replay).toBe('off');
    expect(replay.stop.disabled).toBe(true);
  });

  it('can be paused and resumed like training, without running ticks while paused', () => {
    const { replay, controls, canvas, completeGenerations, run } = setup();
    completeGenerations(1);
    run();
    replay.start.click();
    run(30);
    controls.pause.click();
    const at = canvas.dataset.replayTick;
    run(60);
    expect(canvas.dataset.replayTick).toBe(at);
    controls.pause.click();
    run(30);
    expect(Number(canvas.dataset.replayTick)).toBeGreaterThan(Number(at));
  });
});

describe('the markup', () => {
  it('labels the nine inputs in the order the network receives them', () => {
    const html = readFileSync(join(__dirname, '../../index.html'), 'utf8');
    const names = [...html.matchAll(/data-input="([^"]+)"/g)].map((m) => m[1]);
    expect(names).toEqual([...INPUT_NAMES]);
    expect(names).toHaveLength(INPUT_COUNT);
  });
});
