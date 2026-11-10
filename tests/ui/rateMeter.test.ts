import { describe, expect, it } from 'vitest';
import { createRateMeter, formatRateReadout, meanMs } from '../../src/ui/rateMeter';

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

describe('meanMs and the extended readout (P3-07)', () => {
  it('is milliseconds spent per second over events per second, and null while either cannot be said', () => {
    expect(meanMs(30, 60)).toBe(0.5);
    expect(meanMs(null, 60)).toBeNull();
    expect(meanMs(30, null)).toBeNull();
    expect(meanMs(30, 0)).toBeNull();
  });
  it('measures a window the same way as the rates: meters fed the same sample times give the mean cost', () => {
    const cost = createRateMeter();
    const ticks = createRateMeter();
    for (let i = 0; i < 40; i += 1) {
      cost.add(i * 16, 2);
      ticks.add(i * 16, 4);
    }
    expect(meanMs(cost.rate(), ticks.rate())).toBeCloseTo(0.5, 10);
  });
  it('a gap starts both meters again, so a stall is never averaged in', () => {
    const cost = createRateMeter();
    const ticks = createRateMeter();
    for (let i = 0; i < 20; i += 1) {
      cost.add(i * 16, 2);
      ticks.add(i * 16, 4);
    }
    cost.add(10_000, 9_999);
    ticks.add(10_000, 1);
    expect(meanMs(cost.rate(), ticks.rate())).toBeNull();
  });
  it('shows an ellipsis for a figure not yet known and names the context', () => {
    expect(formatRateReadout(60, 60, 'normal · 50 cars drawn', { stepMs: null, renderMs: 2.345, context: 'population 50 · track · build x' })).toBe(
      'Render 60.0 frames/s · Simulation 60.0 ticks/s · Step … ms/tick · Draw 2.35 ms/frame · normal · 50 cars drawn · population 50 · track · build x',
    );
  });
});
