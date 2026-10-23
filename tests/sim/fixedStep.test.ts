import { describe, expect, it } from 'vitest';
import { DEFAULT_SIM_CONFIG, type SimConfig } from '../../src/sim/config';
import { createFixedStepClock } from '../../src/sim/fixedStep';

const config: SimConfig = DEFAULT_SIM_CONFIG;
const DT = config.timestepSeconds;

/** Feeds the same frame time repeatedly and returns the total ticks run. */
function totalTicks(frameSeconds: number, frames: number): number {
  const clock = createFixedStepClock(config);
  let ticks = 0;
  for (let i = 0; i < frames; i += 1) ticks += clock.advance(frameSeconds);
  return ticks;
}

describe('createFixedStepClock', () => {
  it('runs 60 ticks for one second of frames at 30, 60, 120 and 144 Hz', () => {
    expect(totalTicks(1 / 30, 30)).toBe(60);
    expect(totalTicks(1 / 60, 60)).toBe(60);
    expect(totalTicks(1 / 120, 120)).toBe(60);
    expect(totalTicks(1 / 144, 144)).toBe(60);
  });

  it('carries part-ticks between frames instead of rounding each frame', () => {
    const clock = createFixedStepClock(config);
    expect(clock.advance(DT / 2)).toBe(0);
    expect(clock.advance(DT / 2)).toBe(1);
    expect(clock.advance(DT * 1.5)).toBe(1);
    expect(clock.advance(DT * 0.5)).toBe(1);
  });

  it(`runs at most ${config.maxStepsPerFrame} ticks in one frame and drops the backlog`, () => {
    const clock = createFixedStepClock(config);
    expect(clock.advance(2)).toBe(config.maxStepsPerFrame);
    // The 115 ticks that did not fit are dropped, not run on later frames.
    expect(clock.advance(DT)).toBe(1);
  });

  it('keeps the part-tick when it drops a backlog', () => {
    const clock = createFixedStepClock(config);
    expect(clock.advance(DT * 10.5)).toBe(config.maxStepsPerFrame);
    expect(clock.advance(DT / 2)).toBe(1);
  });

  it('adds no time for zero, negative, NaN or infinite frame times', () => {
    const clock = createFixedStepClock(config);
    for (const bad of [0, -DT, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(clock.advance(bad)).toBe(0);
    }
    expect(clock.advance(DT)).toBe(1);
  });

  it('forgets part-ticks after reset()', () => {
    const clock = createFixedStepClock(config);
    clock.advance(DT * 0.9);
    clock.reset();
    expect(clock.advance(DT * 0.2)).toBe(0);
  });
});
