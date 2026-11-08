// P3-03: the speed policy, the time-budgeted stepper, the draw cap and the status note, in plain Node.
import { describe, expect, it } from 'vitest';
import { DEFAULT_SIM_CONFIG } from '../../src/sim/config';
import {
  createFrameStepper,
  createSpeedControl,
  defaultDrawCap,
  DRAW_CAPS,
  effectiveDrawCap,
  FAST_MULTIPLIER,
  MAX_FRAME_BUDGET_MS,
  MAX_SPEED_DRAW_CAP,
  MAX_TICKS_PER_FRAME,
  pickCars,
  speedStatus,
} from '../../src/ui/trainingSpeed';

const DT = DEFAULT_SIM_CONFIG.timestepSeconds;
const car = (outcome: unknown, id: number) => ({ id, episode: { outcome } });

describe('createSpeedControl', () => {
  it('runs one tick per 1/60 s at 1×, four at 4×, and a large number at max', () => {
    const run = (mode: 'normal' | 'fast' | 'max', frameSeconds: number, frames: number) => {
      const speed = createSpeedControl(DEFAULT_SIM_CONFIG);
      speed.setMode(mode);
      let total = 0;
      for (let i = 0; i < frames; i += 1) total += speed.advance(frameSeconds);
      return total;
    };
    expect(run('normal', DT, 60)).toBe(60);
    expect(run('fast', DT, 60)).toBe(60 * FAST_MULTIPLIER);
    expect(run('normal', 2 * DT, 30)).toBe(60);
    expect(run('fast', 2 * DT, 30)).toBe(60 * FAST_MULTIPLIER);
    expect(run('max', DT, 3)).toBe(3 * MAX_TICKS_PER_FRAME);
  });

  it('caps a long frame at 5 ticks at 1× and 20 at 4×, dropping the backlog, and adds nothing for bad elapsed times', () => {
    const normal = createSpeedControl(DEFAULT_SIM_CONFIG);
    expect(normal.advance(10)).toBe(DEFAULT_SIM_CONFIG.maxStepsPerFrame);
    const fast = createSpeedControl(DEFAULT_SIM_CONFIG);
    fast.setMode('fast');
    expect(fast.advance(10)).toBe(DEFAULT_SIM_CONFIG.maxStepsPerFrame * FAST_MULTIPLIER);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(normal.advance(bad)).toBe(0);
      const max = createSpeedControl(DEFAULT_SIM_CONFIG);
      max.setMode('max');
      expect(max.advance(bad)).toBe(0);
    }
  });

  it('returns no ticks while paused, banks no time, and resumes without a jump', () => {
    const speed = createSpeedControl(DEFAULT_SIM_CONFIG);
    speed.setPaused(true);
    for (let i = 0; i < 600; i += 1) expect(speed.advance(DT)).toBe(0);
    speed.setPaused(false);
    // Ten seconds of paused frames are not owed: the next frame runs one tick, not a burst.
    expect(speed.advance(DT)).toBe(1);
  });

  it('drops a part-tick when the mode or the pause state changes', () => {
    const speed = createSpeedControl(DEFAULT_SIM_CONFIG);
    expect(speed.advance(0.9 * DT)).toBe(0);
    speed.setMode('fast');
    speed.setMode('normal');
    // Without the reset the 0.9 tick banked above would make this a tick.
    expect(speed.advance(0.2 * DT)).toBe(0);
    expect(speed.advance(0.9 * DT)).toBe(1);
  });

  it('reports its mode and pause state', () => {
    const speed = createSpeedControl(DEFAULT_SIM_CONFIG);
    expect([speed.mode, speed.paused]).toEqual(['normal', false]);
    speed.setMode('max');
    speed.setPaused(true);
    expect([speed.mode, speed.paused]).toEqual(['max', true]);
  });
});

describe('createFrameStepper (the time budget at max speed)', () => {
  const stepper = (mode: 'normal' | 'fast' | 'max', now: () => number) => {
    const ran = { ticks: 0 };
    const s = createFrameStepper({ runTick: () => (ran.ticks += 1), mode: () => mode, now });
    return { s, ran };
  };
  /** Runs a frame the way the loop does: ticks until the stepper says stop, up to the asked-for number. */
  const frame = (s: ReturnType<typeof stepper>['s'], asked: number) => {
    let ran = 0;
    for (let i = 0; i < asked; i += 1) {
      if (s.step() === false) break;
      ran += 1;
    }
    s.endFrame();
    return ran;
  };

  it('stops a max-speed frame once its budget is used, and gives the next frame a fresh budget', () => {
    let t = 0;
    const { s } = stepper('max', () => (t += 1));
    const first = frame(s, MAX_TICKS_PER_FRAME);
    const second = frame(s, MAX_TICKS_PER_FRAME);
    expect(first).toBeGreaterThan(1);
    expect(first).toBeLessThanOrEqual(MAX_FRAME_BUDGET_MS);
    expect(second).toBe(first);
  });

  it('always runs at least one tick, however slow the clock', () => {
    let t = 0;
    const { s } = stepper('max', () => (t += 10_000));
    expect(frame(s, MAX_TICKS_PER_FRAME)).toBe(1);
    expect(frame(s, MAX_TICKS_PER_FRAME)).toBe(1);
  });

  it('runs every tick it is asked for at 1× and 4×, whatever the clock says', () => {
    let t = 0;
    for (const mode of ['normal', 'fast'] as const) {
      const { s } = stepper(mode, () => (t += 10_000));
      expect(frame(s, 20)).toBe(20);
    }
  });

  it('keeps no state between modes: a frame that switches to max starts a fresh budget', () => {
    let t = 0;
    let mode: 'normal' | 'max' = 'normal';
    const ran = { ticks: 0 };
    const s = createFrameStepper({ runTick: () => (ran.ticks += 1), mode: () => mode, now: () => (t += 1) });
    expect(frame(s, 5)).toBe(5);
    mode = 'max';
    expect(frame(s, MAX_TICKS_PER_FRAME)).toBeGreaterThan(1);
  });
});

describe('the drawing cap', () => {
  it('defaults lower on a phone, never above the population, and the choices are 10, 25 and 50', () => {
    expect(defaultDrawCap(false, 50)).toBe(50);
    expect(defaultDrawCap(true, 50)).toBe(25);
    expect(defaultDrawCap(false, 8)).toBe(8);
    expect(defaultDrawCap(true, 8)).toBe(8);
    expect(defaultDrawCap(true, 50)).toBeLessThan(defaultDrawCap(false, 50));
    expect(DRAW_CAPS).toEqual([10, 25, 50]);
  });

  it('draws fewer cars at max speed, and never more than the population', () => {
    expect(effectiveDrawCap('normal', 25, 50)).toBe(25);
    expect(effectiveDrawCap('fast', 50, 50)).toBe(50);
    expect(effectiveDrawCap('max', 50, 50)).toBe(MAX_SPEED_DRAW_CAP);
    expect(effectiveDrawCap('max', 5, 50)).toBe(5);
    expect(effectiveDrawCap('normal', 50, 8)).toBe(8);
  });

  it('picks running cars first, then the others, each in population order, and returns everything when the cap allows', () => {
    const cars = [car('crashed', 0), car(null, 1), car('stalled', 2), car(null, 3), car('completed', 4), car(null, 5)];
    expect(pickCars(cars, 2).map((c) => c.id)).toEqual([1, 3]);
    expect(pickCars(cars, 4).map((c) => c.id)).toEqual([1, 3, 5, 0]);
    expect(pickCars(cars, 6).map((c) => c.id)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(pickCars(cars, 99)).toHaveLength(6);
    expect(pickCars(cars, 0)).toEqual([]);
    // It chooses; it does not copy or change the cars.
    expect(pickCars(cars, 3)[0]).toBe(cars[1]);
  });

  it('never reorders or changes the cars it is given (a frozen array would throw if it tried)', () => {
    const frozen = Object.freeze([car('crashed', 0), car(null, 1), car(null, 2)]);
    expect(pickCars(frozen, 2).map((c) => c.id)).toEqual([1, 2]);
    expect(frozen.map((c) => c.id)).toEqual([0, 1, 2]);
  });
});

describe('speedStatus', () => {
  it('is empty at 1× while running, and short otherwise', () => {
    expect(speedStatus('normal', false)).toBe('');
    expect(speedStatus('fast', false)).toBe(' · 4×');
    expect(speedStatus('max', false)).toBe(' · max');
    expect(speedStatus('normal', true)).toBe(' · paused');
    expect(speedStatus('max', true)).toBe(' · paused · max');
  });
});
