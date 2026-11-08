// P3-03 against the page's real wiring: `startTrainingPage` runs in Node with a fake frame source and fake DOM objects,
// and its speed, pause and cars-drawn controls are clicked as a person would. The key claim is that none of them
// changes what is trained: the statistics of a generation are identical at every speed, with any drawing cap, and
// across pausing and speed changes. A seeded run only; nothing here is a study result.
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SIM_CONFIG } from '../../src/sim/config';
import { startTrainingPage } from '../../src/ui/trainingPage';
import { MAX_SPEED_DRAW_CAP } from '../../src/ui/trainingSpeed';
import { FakeFrames } from './fakeFrames';
import { fakePage } from './fakeTrainingPage';

const drawn = vi.hoisted(() => ({ calls: [] as number[] }));
vi.mock('../../src/render/raceView', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/render/raceView')>();
  return {
    ...actual,
    // Records how many cars each frame is asked to draw; the real drawing needs a canvas.
    drawCars: (_ctx: unknown, _size: unknown, _view: unknown, cars: readonly unknown[]) => {
      drawn.calls.push(cars.length);
    },
  };
});

const FRAME_MS = DEFAULT_SIM_CONFIG.timestepSeconds * 1000;

/** A clock for the time budget: every read costs half a millisecond, so a max-speed frame runs a bounded number of ticks. */
function costlyClock() {
  let t = 0;
  return () => (t += 0.5);
}

type Setup = (controls: ReturnType<typeof fakePage>['controls'], frame: number) => void;
const STATS = ['lastBest', 'lastMean', 'lastCrashed', 'lastStalled', 'lastLaps'] as const;

/** Runs the page until generation `target` has just completed and returns that generation's recorded figures. */
function runToGeneration(target: number, setup: Setup, options: { isPhone?: boolean; drawing?: boolean } = {}) {
  const frames = new FakeFrames();
  const { page, canvas, controls } = fakePage(frames, { now: costlyClock(), ...options });
  startTrainingPage(page);
  for (let frame = 0; frame < 200_000; frame += 1) {
    setup(controls, frame);
    frames.fire(frame * FRAME_MS);
    if (canvas.dataset.lastGeneration === String(target)) {
      return { stats: STATS.map((name) => canvas.dataset[name]), ticks: Number(canvas.dataset.tick), frame };
    }
  }
  throw new Error('The generation did not complete.');
}

describe('changing speed does not change results', () => {
  const baseline = runToGeneration(3, () => {});

  it('has recorded figures to compare against', () => {
    expect(baseline.stats.every((value) => value !== undefined && value !== '')).toBe(true);
  });

  it('gives the same statistics at 4× as at 1×, in far fewer frames', () => {
    const fast = runToGeneration(3, (controls, frame) => frame === 0 && controls.speeds.fast.click());
    expect(fast.stats).toEqual(baseline.stats);
    expect(fast.frame).toBeLessThan(baseline.frame / 3);
  });

  it('gives the same statistics at max speed, in far fewer frames still', () => {
    const max = runToGeneration(3, (controls, frame) => frame === 0 && controls.speeds.max.click());
    expect(max.stats).toEqual(baseline.stats);
    expect(max.frame).toBeLessThan(baseline.frame / 8);
  });

  it('gives the same statistics when the speed is changed and the run is paused and resumed along the way', () => {
    const schedule: Record<number, (c: ReturnType<typeof fakePage>['controls']) => void> = {
      30: (c) => c.speeds.max.click(),
      60: (c) => c.pause.click(),
      90: (c) => c.pause.click(),
      120: (c) => c.speeds.fast.click(),
      200: (c) => c.speeds.normal.click(),
      230: (c) => c.speeds.max.click(),
      231: (c) => c.pause.click(),
      300: (c) => c.pause.click(),
    };
    const mixed = runToGeneration(3, (controls, frame) => schedule[frame]?.(controls));
    expect(mixed.stats).toEqual(baseline.stats);
  });

  it('gives the same statistics with any number of cars drawn, including the phone default', () => {
    for (const cap of ['10', '25', '50']) {
      const capped = runToGeneration(3, (controls, frame) => frame === 0 && controls.drawCap.choose(cap), { drawing: true });
      expect(capped.stats, `cap ${cap}`).toEqual(baseline.stats);
    }
    const phone = runToGeneration(3, () => {}, { isPhone: true, drawing: true });
    expect(phone.stats).toEqual(baseline.stats);
  });
});

describe('the speed controls on the actual page', () => {
  it('shows the controls, with 1× selected, the pause button labelled Pause and a cars-drawn default of 50 (25 on a phone)', () => {
    for (const [isPhone, cap] of [[false, '50'], [true, '25']] as const) {
      const frames = new FakeFrames();
      const { page, controls, canvas } = fakePage(frames, { isPhone });
      expect(controls.group.hidden).toBe(true);
      startTrainingPage(page);
      expect(controls.group.hidden).toBe(false);
      expect(controls.speeds.normal.attributes['aria-pressed']).toBe('true');
      expect(controls.speeds.fast.attributes['aria-pressed']).toBe('false');
      expect(controls.speeds.max.attributes['aria-pressed']).toBe('false');
      expect(controls.pause.textContent).toBe('Pause');
      expect(controls.drawCap.value).toBe(cap);
      frames.fire(0);
      expect(canvas.dataset.drawn).toBe(cap);
    }
  });

  /** Runs `frames` frames of 1/60 s from a fresh page after `setup` and returns the ticks run and the page. */
  const ticksOver = (setup: (controls: ReturnType<typeof fakePage>['controls']) => void, frames: number) => {
    const fake = new FakeFrames();
    const made = fakePage(fake, { now: costlyClock() });
    startTrainingPage(made.page);
    setup(made.controls);
    fake.fire(0);
    const before = Number(made.canvas.dataset.tick);
    for (let i = 1; i <= frames; i += 1) fake.fire(i * FRAME_MS);
    return { ticks: Number(made.canvas.dataset.tick) - before, ...made };
  };

  it('runs about one tick per frame at 1×, four at 4×, and many more at max', () => {
    expect(ticksOver(() => {}, 120).ticks).toBe(120);
    expect(ticksOver((c) => c.speeds.fast.click(), 120).ticks).toBe(480);
    const max = ticksOver((c) => c.speeds.max.click(), 120).ticks;
    expect(max).toBeGreaterThan(10 * 120);
    expect(max).toBeLessThanOrEqual(120 * 20);
  });

  it('shows the speed in the status line, in the buttons and in the page data', () => {
    const { status, controls, canvas } = ticksOver((c) => c.speeds.fast.click(), 3);
    expect(status.textContent).toMatch(/^Training · generation 1 · \d+ of 50 cars running · 4×$/);
    expect(controls.speeds.fast.attributes['aria-pressed']).toBe('true');
    expect(controls.speeds.normal.attributes['aria-pressed']).toBe('false');
    expect(canvas.dataset.speed).toBe('fast');
    const max = ticksOver((c) => c.speeds.max.click(), 3);
    expect(max.status.textContent).toMatch(/ · max$/);
    expect(max.canvas.dataset.speed).toBe('max');
  });

  it('pauses and resumes: no ticks while paused, the button says Play, and resuming does not jump', () => {
    const fake = new FakeFrames();
    const { page, canvas, controls, status } = fakePage(fake, { now: costlyClock() });
    startTrainingPage(page);
    let frame = 0;
    const run = (n: number) => {
      for (let i = 0; i < n; i += 1) fake.fire(frame++ * FRAME_MS);
    };
    run(60);
    const running = Number(canvas.dataset.tick);
    expect(running).toBeGreaterThan(50);
    controls.pause.click();
    expect(controls.pause.textContent).toBe('Play');
    expect(controls.pause.attributes['aria-label']).toBe('Play / resume training');
    // The accessible name contains the visible label, in both states.
    expect(controls.pause.attributes['aria-label']!.toLowerCase()).toContain(controls.pause.textContent.toLowerCase());
    run(600); // ten seconds of frames
    expect(Number(canvas.dataset.tick)).toBe(running);
    expect(canvas.dataset.paused).toBe('true');
    expect(status.textContent).toMatch(/ · paused$/);
    controls.pause.click();
    expect(controls.pause.textContent).toBe('Pause');
    expect(controls.pause.attributes['aria-label']).toBe('Pause training');
    expect(controls.pause.attributes['aria-label']!.toLowerCase()).toContain(controls.pause.textContent.toLowerCase());
    run(1);
    expect(Number(canvas.dataset.tick) - running).toBeLessThanOrEqual(1);
    run(59);
    expect(Number(canvas.dataset.tick) - running).toBeLessThanOrEqual(61);
    expect(canvas.dataset.paused).toBe('false');
    expect(status.textContent).not.toMatch(/paused/);
  });

  it.each([
    ['1×', 'normal'],
    ['4×', 'fast'],
    ['max', 'max'],
  ] as const)('does not run the time spent paused when resumed between widely spaced frames, at %s', (_label, mode) => {
    const fake = new FakeFrames();
    const { page, canvas, controls } = fakePage(fake, { now: costlyClock() });
    startTrainingPage(page);
    controls.speeds[mode].click();
    fake.fire(0);
    const before = Number(canvas.dataset.tick);
    controls.pause.click();
    fake.fire(1000); // a paused frame, a second later
    // Resume just before the next frame: that second was spent paused, so none of it is time to run.
    controls.pause.click();
    fake.fire(2000);
    expect(Number(canvas.dataset.tick) - before).toBeLessThanOrEqual(1);
    // Training carries on at its own pace from the frame after that.
    fake.fire(2000 + FRAME_MS);
    const ran = Number(canvas.dataset.tick) - before;
    expect(ran).toBeGreaterThanOrEqual(1);
    expect(ran).toBeLessThanOrEqual(mode === 'max' ? 20 : mode === 'fast' ? 5 : 2);
  });

  it('still draws and updates the dashboard while paused', () => {
    const fake = new FakeFrames();
    const { page, canvas, controls, dashboard } = fakePage(fake, { now: costlyClock() });
    startTrainingPage(page);
    controls.pause.click();
    fake.fire(0);
    fake.fire(FRAME_MS);
    expect(canvas.dataset.mode).toBe('train');
    expect(dashboard.text().running).toBe('50');
  });
});

describe('how many cars are drawn', () => {
  /** Runs 5 frames and returns the number of cars handed to the drawing code on the last one. */
  const carsDrawn = (setup: (controls: ReturnType<typeof fakePage>['controls']) => void, options: { isPhone?: boolean } = {}) => {
    const fake = new FakeFrames();
    const made = fakePage(fake, { now: costlyClock(), drawing: true, ...options });
    startTrainingPage(made.page);
    setup(made.controls);
    drawn.calls.length = 0;
    for (let i = 0; i < 5; i += 1) fake.fire(i * FRAME_MS);
    return { last: drawn.calls[drawn.calls.length - 1], all: [...drawn.calls], canvas: made.canvas };
  };

  it('draws every car by default on a desktop and the lower default on a phone', () => {
    expect(carsDrawn(() => {}).last).toBe(50);
    expect(carsDrawn(() => {}, { isPhone: true }).last).toBe(25);
  });

  it('follows the chosen cap, and ignores a value that is not one of the choices', () => {
    expect(carsDrawn((c) => c.drawCap.choose('10')).last).toBe(10);
    expect(carsDrawn((c) => c.drawCap.choose('25')).last).toBe(25);
    expect(carsDrawn((c) => c.drawCap.choose('7')).last).toBe(50);
  });

  it('draws no more than the max-speed limit at max, whatever the cap, and goes back after leaving max', () => {
    const fake = new FakeFrames();
    const { page, controls } = fakePage(fake, { now: costlyClock(), drawing: true });
    startTrainingPage(page);
    controls.drawCap.choose('50');
    const lastDrawn = () => drawn.calls[drawn.calls.length - 1];
    fake.fire(0);
    expect(lastDrawn()).toBe(50);
    controls.speeds.max.click();
    fake.fire(FRAME_MS);
    expect(lastDrawn()).toBe(MAX_SPEED_DRAW_CAP);
    controls.speeds.normal.click();
    fake.fire(2 * FRAME_MS);
    expect(lastDrawn()).toBe(50);
  });
});
