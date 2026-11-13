// The draw-time instrument behind `?debug=drawtime` (P4-07): the meter's figures by hand, the probe's behaviour with a fake clock and element, the flag, and
// that a seeded training run on the real page is bit-identical with and without the probe (it only reads the clock and writes its own element). A measuring
// instrument for the owner's phone; nothing here is a result, and no phone was measured.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHECKPOINT_KEY } from '../../src/persistence/checkpointStore';
import { DEFAULT_SIM_CONFIG } from '../../src/sim/config';
import { debugDrawTimeEnabled } from '../../src/ui/debugFlags';
import {
  budgetVerdict,
  createDrawTimeMeter,
  DRAW_BUDGET_P95_MS,
  DRAW_TIME_WINDOW_FRAMES,
  formatDrawTimeReadout,
  percentile,
  UPDATE_BUDGET_P95_MS,
  updateBudgetVerdict,
} from '../../src/ui/drawTimeMeter';
import { createDrawTimeProbe, type LongTaskSource } from '../../src/ui/drawTimeProbe';
import { startTrainingPage } from '../../src/ui/trainingPage';
import { FakeFrames } from './fakeFrames';
import { fakePage } from './fakeTrainingPage';

describe('percentile (nearest rank)', () => {
  it('matches hand calculations', () => {
    const v = Array.from({ length: 20 }, (_, i) => i + 1); // 1..20
    expect(percentile(v, 0.5)).toBe(10); // ceil(0.5 * 20) = 10th
    expect(percentile(v, 0.95)).toBe(19); // ceil(0.95 * 20) = 19th
    expect(percentile(v, 1)).toBe(20);
    expect(percentile(v, 0)).toBe(1);
    expect(percentile([5], 0.95)).toBe(5);
    expect(percentile([3, 1, 2], 0.5)).toBe(2);
  });
  it('is null for nothing and for a bad fraction', () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([1, 2], 1.5)).toBeNull();
    expect(percentile([1, 2], NaN)).toBeNull();
  });
});

describe('the draw-time meter', () => {
  it('keeps the newest capacity frames and reports p50, p95 and max of the camera draw', () => {
    const meter = createDrawTimeMeter({ capacity: 20 });
    // 25 frames, 16 ms apart; the draw times are 1..25 ms, so the window holds the last 20: 6..25.
    for (let i = 1; i <= 25; i += 1) meter.record(i * 16, i, i + 1);
    const s = meter.snapshot();
    expect(s.frames).toBe(20);
    expect(s.drawP50).toBe(15); // sorted 6..25, 10th = 15
    expect(s.drawP95).toBe(24); // 19th = 24
    expect(s.drawMax).toBe(25);
    expect(s.renderP95).toBe(25); // renders 7..26, 19th = 25
  });

  it('counts frame gaps and single draws above 50 ms, and nothing at exactly 50', () => {
    const meter = createDrawTimeMeter({ capacity: 600 });
    meter.record(0, 1, 2);
    meter.record(16, 1, 2);
    meter.record(16 + 51, 1, 2); // a 51 ms gap
    meter.record(16 + 51 + 50, 51, 52); // a gap of exactly 50 (not counted), a 51 ms draw
    const s = meter.snapshot();
    expect(s.gapsOver).toBe(1);
    expect(s.drawsOver).toBe(1);
  });

  it('starts again after an interruption (a hidden tab) or a backwards clock, so paused time is never measured', () => {
    const meter = createDrawTimeMeter();
    for (let i = 0; i < 10; i += 1) meter.record(i * 16, 2, 3);
    meter.record(10_000, 2, 3); // a long stall
    expect(meter.snapshot().frames).toBe(1);
    meter.record(10_016, 2, 3);
    meter.record(5, 2, 3); // the clock went backwards
    expect(meter.snapshot().frames).toBe(1);
  });

  it('ignores non-finite or negative figures and never throws', () => {
    const meter = createDrawTimeMeter();
    meter.record(NaN, 1, 1);
    meter.record(0, Infinity, 1);
    meter.record(0, -1, 1);
    meter.record(0, 1, NaN);
    expect(meter.snapshot().frames).toBe(0);
    expect(meter.snapshot().drawP95).toBeNull();
    expect(() => meter.reset()).not.toThrow();
  });

  it('gives the plan verdict only once the window is full: p95 at most 4 ms is within budget, above is over', () => {
    const fill = (draw: number) => {
      const meter = createDrawTimeMeter({ capacity: 600 });
      for (let i = 0; i < 600; i += 1) meter.record(i * 16, draw, draw + 1);
      return meter.snapshot();
    };
    expect(DRAW_BUDGET_P95_MS).toBe(4);
    expect(DRAW_TIME_WINDOW_FRAMES).toBe(600);
    expect(budgetVerdict(fill(4))).toBe('within budget');
    expect(budgetVerdict(fill(4.01))).toBe('over budget');
    const partial = createDrawTimeMeter({ capacity: 600 });
    for (let i = 0; i < 599; i += 1) partial.record(i * 16, 1, 2);
    expect(budgetVerdict(partial.snapshot())).toBe('needs more frames');
    expect(budgetVerdict(createDrawTimeMeter().snapshot())).toBe('needs more frames');
  });

  it('formats a readout that says so when a figure is missing or long tasks are not reported', () => {
    const empty = formatDrawTimeReadout(createDrawTimeMeter().snapshot(), null, 'zoom 1.00x free');
    expect(empty).toContain('p50 … · p95 …');
    expect(empty).toContain('long tasks: not reported by this browser');
    expect(empty).toContain('needs more frames');
    expect(empty).toContain('zoom 1.00x free');
    const meter = createDrawTimeMeter({ capacity: 2 });
    meter.record(0, 1.234, 2);
    meter.record(16, 3.5, 4);
    const text = formatDrawTimeReadout(meter.snapshot(), 2, 'ctx');
    expect(text).toContain('p95 3.50 ms');
    expect(text).toContain('long tasks: 2');
  });
});

describe('the probe', () => {
  const fakeLongTasks = (supported: boolean, n: number): LongTaskSource => ({ supported, count: () => n, reset: () => undefined, stop: () => undefined });
  it('times the wrapped draw with the injected clock, records each frame and refreshes the readout about four times a second', () => {
    let clock = 0;
    const element = { hidden: true, textContent: '' };
    const dataset: Record<string, string | undefined> = {};
    const probe = createDrawTimeProbe({ element, now: () => clock, context: () => 'ctx', dataset, longTasks: fakeLongTasks(false, 0) });
    expect(element.hidden).toBe(false);
    let writes = 0;
    let last = element.textContent;
    for (let frame = 0; frame < 100; frame += 1) {
      const frameStart = clock;
      probe.measure(() => {
        clock += 2;
      });
      clock += 14; // the rest of the render callback and the wait for the next frame
      probe.endFrame(clock, clock - frameStart);
      if (element.textContent !== last) {
        writes += 1;
        last = element.textContent;
      }
    }
    // The dataset and text are written at each refresh (about every 250 ms), so they show the frames up to the latest refresh, not necessarily the last frame.
    expect(Number(dataset.drawFrames)).toBeGreaterThan(80);
    expect(Number(dataset.drawFrames)).toBeLessThanOrEqual(100);
    expect(Number(dataset.drawP95Ms)).toBeCloseTo(2, 6);
    expect(element.textContent).toContain('p95 2.00 ms');
    expect(writes).toBeGreaterThan(3);
    expect(writes).toBeLessThan(10); // 100 frames of 16 ms is 1.6 s: about 7 refreshes, not 100
    probe.stop();
    expect(element.hidden).toBe(true);
  });

  it('reports long tasks only when the browser supports them', () => {
    const run = (supported: boolean) => {
      const element = { hidden: true, textContent: '' };
      const probe = createDrawTimeProbe({ element, now: () => 0, context: () => 'c', longTasks: fakeLongTasks(supported, 3) });
      probe.endFrame(0, 1);
      return element.textContent ?? '';
    };
    expect(run(true)).toContain('long tasks: 3');
    expect(run(false)).toContain('not reported by this browser');
  });
});

describe('the flag', () => {
  it.each([
    ['?debug=drawtime', true],
    ['?debug=fps,drawtime', true],
    ['?debug=rays&debug=drawtime', true],
    ['?debug=drawtimes', false],
    ['?debug=fps', false],
    ['', false],
  ])('%s → %s', (search, expected) => {
    expect(debugDrawTimeEnabled(search)).toBe(expected);
  });
});

describe('a seeded training run is bit-identical with and without the probe', () => {
  const FRAME_MS = DEFAULT_SIM_CONFIG.timestepSeconds * 1000;
  const costlyClock = () => {
    let t = 0;
    return () => (t += 0.5);
  };
  function run(withProbe: boolean) {
    const frames = new FakeFrames();
    const built = fakePage(frames, { now: costlyClock(), drawTime: withProbe, checkpoint: { everyGenerations: 1, minSeconds: 0 } });
    startTrainingPage(built.page);
    const checkpoints: string[] = [];
    for (let frame = 0; frame < 200_000; frame += 1) {
      frames.fire(frame * FRAME_MS);
      built.runDeferred();
      const text = built.checkpointStorage.data.get(CHECKPOINT_KEY);
      if (text !== undefined && text !== checkpoints[checkpoints.length - 1]) checkpoints.push(text);
      if (built.canvas.dataset.lastGeneration === '3') return { checkpoints, frame, drawTime: built.drawTime, dataset: { ...built.canvas.dataset } };
    }
    throw new Error('The generation did not complete.');
  }
  it('records the same checkpoints and takes the same number of frames; the readout is only written when asked for', () => {
    const plain = run(false);
    const probed = run(true);
    expect(probed.checkpoints).toEqual(plain.checkpoints);
    expect(probed.checkpoints.length).toBeGreaterThan(0);
    expect(probed.frame).toBe(plain.frame);
    expect(plain.drawTime).toBeUndefined();
    expect(plain.dataset.drawFrames).toBeUndefined();
    expect(probed.drawTime?.textContent).toContain('Camera draw time');
    expect(probed.drawTime?.hidden).toBe(false);
    expect(Number(probed.dataset.drawFrames)).toBeGreaterThan(0);
  });
});

describe('the instrument stays out of everything that computes a result', () => {
  const ROOT = join(__dirname, '../..');
  const sources = (dir: string): string[] =>
    readdirSync(join(ROOT, dir)).flatMap((name) => {
      const path = `${dir}/${name}`;
      return statSync(join(ROOT, path)).isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : [];
    });
  it('is not imported or named by the simulation, sensors, networks, evolution, training, persistence or rendering code', () => {
    const offenders = ['src/sim', 'src/sensors', 'src/ai', 'src/evolution', 'src/training', 'src/persistence', 'src/render', 'src/utils']
      .flatMap(sources)
      .filter((path) => /drawTime|DrawTime|debug=drawtime/.test(readFileSync(join(ROOT, path), 'utf8')));
    expect(offenders).toEqual([]);
  });
  it('the meter is pure: no DOM, clock, randomness or storage', () => {
    const text = readFileSync(join(ROOT, 'src/ui/drawTimeMeter.ts'), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(/document\.|window\.|performance\.|Date\.now|Math\.random|localStorage/.test(text)).toBe(false);
  });
});

describe('the simulation update figures (P4-06 step 4: the P2-11 budget in the same readout)', () => {
  it('reports p50, p95 and max of the update time over the newest capacity frames, by hand', () => {
    const meter = createDrawTimeMeter({ capacity: 20 });
    // 25 frames, 16 ms apart; update times 1..25 ms, so the window holds 6..25.
    for (let i = 1; i <= 25; i += 1) meter.record(i * 16, 1, 2, i);
    const s = meter.snapshot();
    expect(s.updateFrames).toBe(20);
    expect(s.updateP50).toBe(15); // sorted 6..25, 10th
    expect(s.updateP95).toBe(24); // 19th
    expect(s.updateMax).toBe(25);
  });

  it('a frame without an update time, or with a bad one, leaves the update series alone and still counts as a frame', () => {
    const meter = createDrawTimeMeter({ capacity: 10 });
    meter.record(0, 1, 2);
    meter.record(16, 1, 2, Number.NaN);
    meter.record(32, 1, 2, -1);
    meter.record(48, 1, 2, 3);
    const s = meter.snapshot();
    expect(s.frames).toBe(4);
    expect(s.updateFrames).toBe(1);
    expect(s.updateP50).toBe(3);
    expect(createDrawTimeMeter().snapshot()).toMatchObject({ updateFrames: 0, updateP50: null, updateP95: null, updateMax: null });
  });

  it('update samples leave the window with their own frames: old updates never outlive the frames they belong to (stale verdict)', () => {
    // Capacity 3: three frames with 20 ms updates, then three frames with none. None of the current three frames has an update time.
    const meter = createDrawTimeMeter({ capacity: 3 });
    for (let i = 0; i < 3; i += 1) meter.record(i * 16, 1, 2, 20);
    expect(updateBudgetVerdict(meter.snapshot())).toBe('over budget'); // the full window of 20 ms updates is over 8
    for (let i = 3; i < 6; i += 1) meter.record(i * 16, 1, 2);
    const s = meter.snapshot();
    expect(s.frames).toBe(3);
    expect(s).toMatchObject({ updateFrames: 0, updateP50: null, updateP95: null, updateMax: null });
    expect(updateBudgetVerdict(s)).toBe('needs more frames');
    expect(formatDrawTimeReadout(s, null, 'ctx')).not.toContain('Simulation update');
    // Partly: updates 20, 20, 20 and then a frame without one: the window holds frames 2 to 4, so two samples remain.
    const part = createDrawTimeMeter({ capacity: 3 });
    for (let i = 0; i < 3; i += 1) part.record(i * 16, 1, 2, 20);
    part.record(3 * 16, 1, 2);
    expect(part.snapshot()).toMatchObject({ frames: 3, updateFrames: 2, updateP95: 20 });
    expect(updateBudgetVerdict(part.snapshot())).toBe('needs more frames'); // two of three frames carry an update time, not a full window
    // A bad update time on a later frame also expires the old one.
    const bad = createDrawTimeMeter({ capacity: 2 });
    bad.record(0, 1, 2, 5);
    bad.record(16, 1, 2, Number.NaN);
    bad.record(32, 1, 2, -1);
    expect(bad.snapshot()).toMatchObject({ frames: 2, updateFrames: 0 });
  });

  it('starts again with the frames: a reset, a long gap and a backwards clock clear the update series too', () => {
    const meter = createDrawTimeMeter({ capacity: 10 });
    for (let i = 0; i < 5; i += 1) meter.record(i * 16, 1, 2, 4);
    meter.reset();
    expect(meter.snapshot().updateFrames).toBe(0);
    for (let i = 0; i < 5; i += 1) meter.record(i * 16, 1, 2, 4);
    meter.record(5 * 16 + 1000, 1, 2, 9); // an interruption
    expect(meter.snapshot()).toMatchObject({ frames: 1, updateFrames: 1, updateP95: 9 });
    meter.record(0, 1, 2, 7); // the clock goes backwards
    expect(meter.snapshot()).toMatchObject({ frames: 1, updateFrames: 1, updateP95: 7 });
  });

  it('the verdict needs the full window and compares the p95 with 8 ms, equal being within', () => {
    expect(UPDATE_BUDGET_P95_MS).toBe(8);
    const within = createDrawTimeMeter({ capacity: 20 });
    const over = createDrawTimeMeter({ capacity: 20 });
    for (let i = 0; i < 20; i += 1) {
      within.record(i * 16, 1, 2, 8); // p95 exactly 8
      over.record(i * 16, 1, 2, i === 19 || i === 18 ? 8.01 : 1); // two of 20 above 8: the 19th value is 8.01
    }
    expect(updateBudgetVerdict(within.snapshot())).toBe('within budget');
    expect(updateBudgetVerdict(over.snapshot())).toBe('over budget');
    const partial = createDrawTimeMeter({ capacity: 20 });
    for (let i = 0; i < 19; i += 1) partial.record(i * 16, 1, 2, 1);
    expect(updateBudgetVerdict(partial.snapshot())).toBe('needs more frames');
    expect(updateBudgetVerdict(createDrawTimeMeter().snapshot())).toBe('needs more frames');
  });

  it('the readout gains the update lines only when update times exist, and says the budget is for 1x speed', () => {
    const none = createDrawTimeMeter({ capacity: 2 });
    none.record(0, 1, 2);
    none.record(16, 1, 2);
    expect(formatDrawTimeReadout(none.snapshot(), null, 'ctx')).not.toContain('Simulation update');
    const some = createDrawTimeMeter({ capacity: 2 });
    some.record(0, 1, 2, 1.5);
    some.record(16, 1, 2, 2.5);
    const text = formatDrawTimeReadout(some.snapshot(), null, 'ctx');
    expect(text).toContain('Simulation update per frame: p50 1.50 ms · p95 2.50 ms · max 2.50 ms · frames 2/2');
    expect(text).toContain('P2-11 budget (1x speed only: p95 at most 8 ms, at least 2 frames): within budget');
    expect(text.split('\n').at(-1)).toBe('ctx');
  });

  it('the probe passes the frame update time to the meter and publishes its p95 for the browser tests', () => {
    let clock = 0;
    const element = { hidden: true, textContent: '' };
    const dataset: Record<string, string | undefined> = {};
    const probe = createDrawTimeProbe({ element, now: () => clock, context: () => 'ctx', dataset });
    for (let i = 0; i < 4; i += 1) {
      clock += 100; // each frame is past the 250 ms refresh interval soon enough
      probe.measure(() => undefined);
      probe.endFrame(clock, 1, 2.5);
    }
    expect(dataset.updateP95Ms).toBe('2.500');
    expect(element.textContent).toContain('Simulation update per frame');
    const bare = createDrawTimeProbe({ element: { hidden: true, textContent: '' }, now: () => clock, context: () => 'ctx', dataset: {} });
    bare.endFrame(clock, 1);
    expect(dataset.updateP95Ms).toBe('2.500');
  });
});
