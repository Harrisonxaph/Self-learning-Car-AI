// The seeded scenarios from tests/sim/scenarios.ts run through the real frame loop (P1-09): drawing every frame,
// at different frame rates, with frames slow enough to hit the catch-up cap, and with the page hidden and shown.
// Each run is compared tick by tick (window hashes, samples and events) with the same scenario run headless,
// with no frame loop and no drawing, so an early divergence cannot hide behind an identical final state.
import { describe, expect, it } from 'vitest';
import { drawRace, type RaceContext } from '../../src/render/raceView';
import { computeViewportSize } from '../../src/render/viewport';
import { createFixedStepClock } from '../../src/sim/fixedStep';
import { startFrameLoop } from '../../src/ui/frameLoop';
import { hudView, nextFeedback, type Feedback } from '../../src/ui/hud';
import { createRng } from '../../src/utils/rng';
import { CONFIG, CRASHES, LAPS, createScenarioRun, runScenario, type Scenario } from '../sim/scenarios';
import { FakeFrames } from './fakeFrames';

/** A canvas context that accepts every drawing call drawRace makes and keeps nothing. */
function nullContext(): RaceContext {
  const context: Record<string, unknown> = { fillStyle: '', strokeStyle: '', lineWidth: 1, lineJoin: 'miter' };
  for (const name of ['setTransform', 'beginPath', 'moveTo', 'lineTo', 'arc', 'closePath', 'fill', 'stroke']) context[name] = () => {};
  return context as unknown as RaceContext;
}

/**
 * A scenario driven by the real frame loop, stopping after `ticks` ticks. With `draw`, every frame does what the
 * page does: draws the car and gate, and computes the lap display and event message from the world.
 */
function loopRun(scenario: Scenario, ticks: number, draw = true) {
  const env = new FakeFrames();
  const run = createScenarioRun(scenario);
  const context = nullContext();
  const size = computeViewportSize(390, 600, 3);
  const view = { scale: 2.5, offsetX: 195, offsetY: 300 };
  let shown = run.world();
  let feedback: Feedback | null = null;
  const ticksPerFrame: number[] = [];
  let ticksThisFrame = 0;
  startFrameLoop(env, createFixedStepClock(CONFIG), {
    step: () => {
      ticksThisFrame += 1;
      if (run.world().tick < ticks) run.step();
    },
    render: () => {
      ticksPerFrame.push(ticksThisFrame);
      ticksThisFrame = 0;
      if (!draw) return;
      const world = run.world();
      drawRace(context, size, view, world);
      hudView(world, CONFIG.timestepSeconds);
      feedback = nextFeedback(shown, world, feedback, CONFIG.timestepSeconds);
      shown = world;
    },
  });
  return { env, run, ticksPerFrame };
}

/** Fires frames at the given intervals (ms), starting at time 0, until the run reaches `ticks` ticks. */
function fireUntil(env: FakeFrames, done: () => boolean, interval: (frame: number) => number): number {
  let time = 0;
  env.fire(time);
  for (let frame = 0; !done(); frame += 1) {
    time += interval(frame);
    env.fire(time);
  }
  return time;
}

describe('frame schedules, with drawing every frame', () => {
  const jitter = createRng(99);
  const jittered = Array.from({ length: 20_000 }, () => jitter.range(4, 80));
  // Every schedule keeps frames under 5 ticks (83 ms), so the catch-up cap never drops time here.
  const schedules: [string, (frame: number) => number][] = [
    ['30 Hz', () => 1000 / 30],
    ['60 Hz', () => 1000 / 60],
    ['120 Hz', () => 1000 / 120],
    ['144 Hz', () => 1000 / 144],
    ['uneven 7/73 ms', (frame) => (frame % 2 === 0 ? 7 : 73)],
    ['seeded jitter 4–80 ms', (frame) => jittered[frame]!],
  ];
  const cases = [
    [LAPS, 1800],
    [CRASHES, CRASHES.ticks],
  ] as const;

  for (const [scenario, ticks] of cases) {
    const headless = runScenario(scenario, ticks);
    it.each(schedules)(`${scenario.name}: %s matches the headless run tick for tick`, (_name, interval) => {
      const { env, run } = loopRun(scenario, ticks);
      fireUntil(env, () => run.world().tick >= ticks, interval);
      expect(run.world().tick).toBe(ticks);
      expect(run.trace()).toEqual(headless.trace);
      expect(run.world()).toEqual(headless.world);
    });
  }

  it('drawing does not change the simulation: the same frames with and without drawing give the same ticks', () => {
    const drawn = loopRun(LAPS, 600, true);
    const plain = loopRun(LAPS, 600, false);
    for (const { env, run } of [drawn, plain]) fireUntil(env, () => run.world().tick >= 600, (frame) => (frame % 3 === 0 ? 30 : 11));
    expect(drawn.run.trace()).toEqual(plain.run.trace());
    expect(drawn.ticksPerFrame).toEqual(plain.ticksPerFrame);
  });
});

describe('catch-up cap (at most 5 ticks per frame)', () => {
  it('drops exactly the time it cannot catch up, and simulates the rest unchanged', () => {
    // 90 ms frames are 5.4 ticks each. Worked by hand, the clock's backlog runs
    //   5.4 → run 5 (keep 0.4); 5.8 → 5 (0.8); 6.2 → 5, drop 1 (0.2); 5.6 → 5 (0.6); 6.0 → 5, drop 1 (0)
    // and then repeats: every 5 frames, 27 ticks of real time give 25 ticks run and 2 dropped.
    const { env, run, ticksPerFrame } = loopRun(LAPS, Infinity);
    env.fire(0);
    for (let frame = 1; frame <= 100; frame += 1) env.fire(frame * 90);
    const realTicks = (100 * 90) / (1000 * CONFIG.timestepSeconds);
    expect(realTicks).toBeCloseTo(540, 9);
    expect(ticksPerFrame).toEqual([0, ...Array<number>(100).fill(5)]);
    expect(run.world().tick).toBe(500);
    expect(Math.round(realTicks) - run.world().tick).toBe(40);
    // Dropped time is not simulated at all: the 500 ticks that ran are the scenario's first 500 ticks.
    expect(run.trace()).toEqual(runScenario(LAPS, 500).trace);
  });

  it('a one-second stall runs 5 ticks and drops 55, and the car carries on from where it was', () => {
    const { env, run, ticksPerFrame } = loopRun(LAPS, Infinity);
    let time = 0;
    env.fire(time);
    for (let i = 0; i < 60; i += 1) env.fire((time += 1000 / 60));
    env.fire((time += 1000)); // a stalled main thread: 60 ticks due at once
    for (let i = 0; i < 60; i += 1) env.fire((time += 1000 / 60));
    expect(ticksPerFrame.slice(60, 63)).toEqual([1, 5, 1]);
    // 3 s of real time is 180 ticks; 60 + 5 + 60 ran, so 55 were dropped by the stall frame.
    expect(run.world().tick).toBe(125);
    expect(run.trace()).toEqual(runScenario(LAPS, 125).trace);
  });
});

describe('pause and resume', () => {
  it('hiding the page stops ticks, drops a pending part-tick, and resumes on the next tick with no jump', () => {
    const { env, run, ticksPerFrame } = loopRun(LAPS, Infinity);
    let time = 0;
    env.fire(time);
    for (let i = 0; i < 600; i += 1) env.fire((time += 1000 / 60));
    env.fire((time += 1000 / 120)); // half a tick pending
    expect(run.world().tick).toBe(600);
    const atHide = run.world();

    env.setHidden(true);
    expect(env.pendingFrames).toBe(0);
    time += 30_000; // thirty seconds in another app
    env.setHidden(false);
    env.fire(time); // only records the time
    expect(run.world()).toBe(atHide);
    for (let i = 0; i < 600; i += 1) env.fire((time += 1000 / 60));

    // Documented semantics (docs/ARCHITECTURE.md): no ticks while hidden, the half tick is dropped, and the
    // first frame back runs none, so exactly 600 + 600 ticks ran and they are the scenario's first 1200 ticks.
    expect(ticksPerFrame.filter((n) => n > 0)).toHaveLength(1200);
    expect(run.world().tick).toBe(1200);
    expect(run.trace()).toEqual(runScenario(LAPS, 1200).trace);
  });
});
