import { describe, expect, it } from 'vitest';
import { DEFAULT_SIM_CONFIG } from '../../src/sim/config';
import { createFixedStepClock } from '../../src/sim/fixedStep';
import { createWorld, stepWorld, type World } from '../../src/sim/world';
import { startFrameLoop, type FrameEnvironment } from '../../src/ui/frameLoop';

/** A fake browser: tests fire animation frames and visibility changes by hand. */
class FakeFrames implements FrameEnvironment {
  hidden = false;
  private pending = new Map<number, (timeMs: number) => void>();
  private nextHandle = 1;
  private listener: (() => void) | undefined;
  requestFrame(callback: (timeMs: number) => void) {
    const handle = this.nextHandle++;
    this.pending.set(handle, callback);
    return handle;
  }
  cancelFrame(handle: number) {
    this.pending.delete(handle);
  }
  isHidden() {
    return this.hidden;
  }
  onVisibilityChange(onChange: () => void) {
    this.listener = onChange;
    return () => {
      this.listener = undefined;
    };
  }
  get pendingFrames() {
    return this.pending.size;
  }
  /** Runs every pending frame callback at `timeMs`, as the browser does once per frame. */
  fire(timeMs: number) {
    const callbacks = [...this.pending.values()];
    this.pending.clear();
    for (const callback of callbacks) callback(timeMs);
  }
  setHidden(hidden: boolean) {
    this.hidden = hidden;
    this.listener?.();
  }
}

function setup() {
  const env = new FakeFrames();
  let world: World = createWorld();
  let renders = 0;
  const loop = startFrameLoop(env, createFixedStepClock(DEFAULT_SIM_CONFIG), {
    step: () => {
      world = stepWorld(world);
    },
    render: () => {
      renders += 1;
    },
  });
  return { env, loop, world: () => world, renders: () => renders };
}

/** Fires one frame at `startMs` and then `count` more, `intervalMs` apart. */
function runFrames(env: FakeFrames, startMs: number, count: number, intervalMs: number): void {
  for (let i = 0; i <= count; i += 1) env.fire(startMs + i * intervalMs);
}

describe('startFrameLoop', () => {
  it.each([
    ['30 Hz', 30],
    ['60 Hz', 60],
    ['120 Hz', 120],
  ])('gives the same simulation state after ten seconds at %s', (_rate, hertz) => {
    const { env, world } = setup();
    runFrames(env, 0, 10 * hertz, 1000 / hertz);
    expect(world()).toEqual({ tick: 600 });
  });

  it('gives the same state when frame times are uneven', () => {
    const { env, world } = setup();
    // Alternating short and long frames, as on a busy phone; 1600 ms in total.
    let time = 0;
    env.fire(time);
    for (let i = 0; i < 40; i += 1) {
      time += i % 2 === 0 ? 7 : 73;
      env.fire(time);
    }
    expect(time).toBe(1600);
    expect(world()).toEqual({ tick: 96 });
  });

  it('draws once per frame however many ticks ran', () => {
    const { env, renders } = setup();
    runFrames(env, 0, 30, 1000 / 30);
    expect(renders()).toBe(31);
  });

  it('runs no ticks on the first frame, which only records the time', () => {
    const { env, world, renders } = setup();
    env.fire(5000);
    expect(world().tick).toBe(0);
    expect(renders()).toBe(1);
  });

  it('pauses while the page is hidden and resumes without a catch-up jump', () => {
    const { env, world } = setup();
    runFrames(env, 0, 60, 1000 / 60);
    expect(world().tick).toBe(60);

    env.setHidden(true);
    expect(env.pendingFrames).toBe(0);

    // Thirty seconds later the page is shown again (for example after switching apps on an iPhone).
    env.setHidden(false);
    env.fire(31_000);
    expect(world().tick).toBe(60);
    env.fire(31_000 + 1000 / 60);
    expect(world().tick).toBe(61);
  });

  it('drops a part-tick that was pending when the page was hidden', () => {
    const { env, world } = setup();
    env.fire(0);
    env.fire(1000 / 120);
    env.setHidden(true);
    env.setHidden(false);
    env.fire(10_000);
    env.fire(10_000 + 1000 / 120);
    expect(world().tick).toBe(0);
  });

  it('does not start drawing until a page that opened hidden is shown', () => {
    const env = new FakeFrames();
    env.hidden = true;
    startFrameLoop(env, createFixedStepClock(DEFAULT_SIM_CONFIG), { step: () => {}, render: () => {} });
    expect(env.pendingFrames).toBe(0);
    env.setHidden(false);
    expect(env.pendingFrames).toBe(1);
  });

  it('never queues two frames when shown twice in a row', () => {
    const { env } = setup();
    env.setHidden(false);
    env.setHidden(false);
    expect(env.pendingFrames).toBe(1);
  });

  it('stops drawing and listening after stop()', () => {
    const { env, loop, renders } = setup();
    env.fire(0);
    loop.stop();
    expect(env.pendingFrames).toBe(0);
    env.setHidden(false);
    expect(env.pendingFrames).toBe(0);
    expect(renders()).toBe(1);
  });
});
