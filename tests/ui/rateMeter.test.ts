import { describe, expect, it } from 'vitest';
import { createRateMeter, formatRateReadout } from '../../src/ui/rateMeter';

describe('createRateMeter', () => {
  it('reports nothing until enough time has been seen', () => {
    const meter = createRateMeter();
    expect(meter.rate()).toBeNull();
    meter.add(0);
    expect(meter.rate()).toBeNull();
    meter.add(100);
    expect(meter.rate()).toBeNull();
  });

  it('measures 60 frames a second from callbacks 1/60 s apart', () => {
    const meter = createRateMeter();
    for (let i = 0; i <= 60; i += 1) meter.add((i * 1000) / 60);
    expect(meter.rate()).toBeCloseTo(60, 5);
  });

  it('counts only the window, so an earlier different rate fades out', () => {
    const meter = createRateMeter();
    for (let i = 0; i < 30; i += 1) meter.add(i * 50); // 20 a second, then
    for (let i = 0; i <= 120; i += 1) meter.add(1450 + i * 10); // 100 a second
    expect(meter.rate()).toBeCloseTo(100, 0);
  });

  it('weights counts, so ticks per frame give ticks per second separately from frames per second', () => {
    const frames = createRateMeter();
    const ticks = createRateMeter();
    for (let i = 0; i <= 30; i += 1) {
      frames.add(i * 20);
      ticks.add(i * 20, 1000);
    }
    expect(frames.rate()).toBeCloseTo(50, 5);
    expect(ticks.rate()).toBeCloseTo(50_000, 3);
  });

  it('starts again after a gap instead of averaging across it', () => {
    const meter = createRateMeter();
    for (let i = 0; i <= 30; i += 1) meter.add(i * 20); // 50 a second
    meter.add(600 + 5000); // back after five seconds
    expect(meter.rate()).toBeNull();
    for (let i = 1; i <= 30; i += 1) meter.add(5600 + i * 10); // now 100 a second
    expect(meter.rate()).toBeCloseTo(100, 5);
  });

  it('starts again when the clock goes backwards', () => {
    const meter = createRateMeter();
    for (let i = 0; i <= 30; i += 1) meter.add(10_000 + i * 20);
    meter.add(5);
    expect(meter.rate()).toBeNull();
  });

  it('forgets everything on reset, and ignores non-finite times', () => {
    const meter = createRateMeter();
    for (let i = 0; i <= 30; i += 1) meter.add(i * 20);
    expect(meter.rate()).not.toBeNull();
    meter.reset();
    expect(meter.rate()).toBeNull();
    meter.add(Number.NaN);
    meter.add(Number.POSITIVE_INFINITY);
    expect(meter.rate()).toBeNull();
  });

  it('keeps its memory bounded over a long run', () => {
    const meter = createRateMeter();
    for (let i = 0; i <= 100_000; i += 1) meter.add(i * 10);
    expect(meter.rate()).toBeCloseTo(100, 5);
  });
});

describe('formatRateReadout', () => {
  it('names both rates and the configuration', () => {
    expect(formatRateReadout(59.96, 3597.6, 'max · 10 cars drawn')).toBe('Render 60.0 frames/s · Simulation 3597.6 ticks/s · max · 10 cars drawn');
  });
  it('shows an ellipsis for a rate not yet known', () => {
    expect(formatRateReadout(null, null, 'normal · 50 cars drawn')).toBe('Render … frames/s · Simulation … ticks/s · normal · 50 cars drawn');
  });
});
