// The opt-in frame-rate readout (P3-03) against the page's real wiring. Rendered frames (render callbacks) and simulation
// ticks are measured separately, the readout is absent unless asked for, and the measurement starts again whenever
// the conditions change or the page is interrupted. Seeded fake clock only: no device frame rate is claimed here.
import { describe, expect, it } from 'vitest';
import { DEFAULT_SIM_CONFIG } from '../../src/sim/config';
import { startTrainingPage } from '../../src/ui/trainingPage';
import { FakeFrames } from './fakeFrames';
import { fakePage } from './fakeTrainingPage';

const TICK_MS = DEFAULT_SIM_CONFIG.timestepSeconds * 1000;

function setup(options: { fps?: boolean } = { fps: true }) {
  const clock = { ms: 0 };
  // Every read of the clock inside a frame costs half a millisecond, so the Max-speed time budget cuts a frame short.
  let burn = 0;
  const frames = new FakeFrames();
  const made = fakePage(frames, { now: () => clock.ms + (burn += 0.5), fps: options.fps });
  startTrainingPage(made.page);
  /** Fires `count` frames `stepMs` apart, with the page's clock reading the same time as the frame. */
  const run = (count: number, stepMs: number) => {
    for (let i = 0; i < count; i += 1) {
      clock.ms += stepMs;
      burn = 0;
      frames.fire(clock.ms);
    }
  };
  return { ...made, frames, clock, run };
}

describe('frame-rate readout', () => {
  it('is not created or measured unless the page is given the element', () => {
    const { canvas, run, fps } = setup({ fps: false });
    run(120, TICK_MS);
    expect(fps).toBeUndefined();
    expect(canvas.dataset.fpsFrames).toBeUndefined();
    expect(canvas.dataset.fpsTicks).toBeUndefined();
  });

  it('is shown when given, with no rate until enough frames have been seen', () => {
    const { fps, run } = setup();
    expect(fps!.hidden).toBe(false);
    run(1, TICK_MS);
    expect(fps!.textContent).toContain('Render … frames/s · Simulation … ticks/s');
    run(30, TICK_MS);
    expect(fps!.textContent).toMatch(/Render \d+\.\d frames\/s/);
  });

  it('reports about 60 frames and 60 ticks a second at 1×', () => {
    const { canvas, fps, run } = setup();
    run(180, TICK_MS);
    expect(Number(canvas.dataset.fpsFrames)).toBeCloseTo(60, 0);
    expect(Number(canvas.dataset.fpsTicks)).toBeCloseTo(60, 0);
    expect(fps!.textContent).toMatch(/^Render 6\d\.\d frames\/s · Simulation 6\d\.\d ticks\/s · Step [\d.…]+ ms\/tick · Draw [\d.…]+ ms\/frame · normal · 50 cars drawn · population 50 · stadium-oval · build test$/);
  });

  it('reports ticks separately from frames at 4×, and names the configuration', () => {
    const { canvas, controls, fps, run } = setup();
    controls.speeds.fast.click();
    run(180, TICK_MS);
    expect(Number(canvas.dataset.fpsFrames)).toBeCloseTo(60, 0);
    expect(Number(canvas.dataset.fpsTicks)).toBeCloseTo(240, 0);
    expect(fps!.textContent).toContain('fast · 50 cars drawn');
  });

  it('reports the rendered-frame rate, not the tick rate, when frames are slower than ticks', () => {
    const { canvas, run } = setup();
    run(60, 1000 / 30); // 30 frames a second, each running two ticks
    expect(Number(canvas.dataset.fpsFrames)).toBeCloseTo(30, 0);
    expect(Number(canvas.dataset.fpsTicks)).toBeCloseTo(60, 0);
  });

  it('shows many ticks per frame at Max, with at most 10 cars drawn named', () => {
    const { canvas, controls, fps, run } = setup();
    controls.speeds.max.click();
    run(120, TICK_MS);
    expect(Number(canvas.dataset.fpsTicks)).toBeGreaterThan(Number(canvas.dataset.fpsFrames) * 5);
    expect(fps!.textContent).toContain('max · 10 cars drawn');
  });

  it('reports no ticks while paused and names it', () => {
    const { canvas, controls, fps, run } = setup();
    run(60, TICK_MS);
    controls.pause.click();
    run(120, TICK_MS);
    expect(Number(canvas.dataset.fpsFrames)).toBeCloseTo(60, 0);
    expect(Number(canvas.dataset.fpsTicks)).toBe(0);
    expect(fps!.textContent).toContain('paused');
  });

  it.each([
    ['a speed change', (c: ReturnType<typeof setup>['controls']) => c.speeds.fast.click()],
    ['pausing', (c: ReturnType<typeof setup>['controls']) => c.pause.click()],
    ['a cars-drawn change', (c: ReturnType<typeof setup>['controls']) => c.drawCap.choose('10')],
  ])('starts again after %s', (_name, change) => {
    const { canvas, controls, run } = setup();
    run(120, TICK_MS);
    expect(canvas.dataset.fpsFrames).toBeDefined();
    change(controls);
    run(1, TICK_MS);
    expect(canvas.dataset.fpsFrames).toBeUndefined();
    run(60, TICK_MS);
    expect(canvas.dataset.fpsFrames).toBeDefined();
  });

  it('starts again after the page is hidden and shown, and never averages the hidden time', () => {
    const { canvas, frames, clock, run } = setup();
    run(120, TICK_MS);
    frames.setHidden(true);
    clock.ms += 60_000;
    frames.setHidden(false);
    run(1, TICK_MS);
    expect(canvas.dataset.fpsFrames).toBeUndefined();
    run(60, TICK_MS);
    expect(Number(canvas.dataset.fpsFrames)).toBeCloseTo(60, 0);
    expect(Number(canvas.dataset.fpsTicks)).toBeCloseTo(60, 0);
  });

  it('starts again after a stall without a visibility event', () => {
    const { canvas, run, clock } = setup();
    run(120, TICK_MS);
    clock.ms += 3000;
    run(1, TICK_MS);
    expect(canvas.dataset.fpsFrames).toBeUndefined();
  });

  it('does not change what is trained', () => {
    const stats = (fps: boolean) => {
      const clock = { ms: 0 };
      const frames = new FakeFrames();
      const { page, canvas } = fakePage(frames, { clock, fps });
      startTrainingPage(page);
      for (let i = 0; i < 4000; i += 1) {
        clock.ms += TICK_MS;
        frames.fire(clock.ms);
      }
      return [canvas.dataset.tick, canvas.dataset.generation, canvas.dataset.generationTick, canvas.dataset.running, canvas.dataset.lastBest];
    };
    expect(stats(true)).toEqual(stats(false));
  });

  it('reports the mean time of a simulation tick, measured around the step handler only (P3-07)', () => {
    const { canvas, fps, run } = setup();
    run(1, TICK_MS);
    expect(fps!.textContent).toContain('Step … ms/tick · Draw … ms/frame');
    expect(canvas.dataset.fpsStepMs).toBeUndefined();
    run(180, TICK_MS);
    // Each tick costs exactly two reads of the half-millisecond fake clock, whatever else the frame does.
    expect(canvas.dataset.fpsStepMs).toBe('0.5000');
    expect(fps!.textContent).toContain('Step 0.5000 ms/tick');
    expect(Number(canvas.dataset.fpsRenderMs)).toBeGreaterThan(0);
  });

  it('keeps the per-tick figure when several ticks run in a frame, and starts it again after a pause', () => {
    const { canvas, controls, run } = setup();
    controls.speeds.fast.click();
    run(180, TICK_MS);
    expect(canvas.dataset.fpsStepMs).toBe('0.5000');
    controls.pause.click();
    run(30, TICK_MS);
    expect(canvas.dataset.fpsStepMs).toBeUndefined();
    expect(Number(canvas.dataset.fpsTicks)).toBe(0);
  });

  it('names where the figures were measured: population, track and build', () => {
    const { fps, run } = setup();
    run(60, TICK_MS);
    expect(fps!.textContent).toMatch(/population 50 · stadium-oval · build test$/);
  });
});
