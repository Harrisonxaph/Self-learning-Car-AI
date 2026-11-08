// P3-02: the graph controller, driven as the page drives it: one `frame()` per rendered frame, with a fake clock, a
// recording context and a history that grows. Plain Node.
import { describe, expect, it } from 'vitest';
import type { ViewportSize } from '../../src/render/viewport';
import type { HistoryPoint } from '../../src/training/generationHistory';
import { recordingContext } from '../render/recordingContext';
import { createTrainingChart, drawTrainingGraph, layoutPanels, MIN_REDRAW_MS, type GraphContext } from '../../src/ui/trainingChart';

const SIZE: ViewportSize = { cssWidth: 360, cssHeight: 176, pixelRatio: 2, width: 720, height: 352 };
const point = (generation: number): HistoryPoint => ({
  generation,
  bestFitness: generation * 1.5,
  meanFitness: generation * 0.5,
  crashRate: ((generation * 7) % 50) / 50,
  lapCompletionRate: ((generation * 3) % 50) / 50,
});

/** A graph controller wired like the page: a growing history, a drawing context that counts, a clock, an open flag. */
function harness(options: { open?: boolean; size?: ViewportSize | null } = {}) {
  const history: HistoryPoint[] = [];
  const { ctx, ops } = recordingContext();
  const calls = { setTransform: [] as number[][], clearRect: 0 };
  const context = Object.assign(ctx, {
    setTransform: (...args: number[]) => calls.setTransform.push(args),
    clearRect: () => (calls.clearRect += 1),
  }) as unknown as GraphContext;
  const state = { open: options.open ?? true, size: options.size === undefined ? SIZE : options.size, now: 1000 };
  const summary = { textContent: '' as string | null };
  const chart = createTrainingChart({ history: () => history, context, summary, isOpen: () => state.open, size: () => state.size, now: () => state.now });
  return { chart, history, ops, calls, state, summary };
}

describe('layoutPanels', () => {
  it('keeps both plot areas inside the canvas and apart from each other, down to a tiny canvas', () => {
    for (const [width, height] of [[360, 176], [320, 140], [800, 300], [20, 20], [1, 1]] as const) {
      const { fitness, rates } = layoutPanels(width, height);
      for (const area of [fitness, rates]) {
        expect(area.width).toBeGreaterThanOrEqual(1);
        expect(area.height).toBeGreaterThanOrEqual(1);
        expect(area.left).toBeGreaterThanOrEqual(0);
      }
      if (width >= 100 && height >= 100) {
        for (const area of [fitness, rates]) {
          expect(area.left + area.width).toBeLessThanOrEqual(width);
          expect(area.top + area.height).toBeLessThanOrEqual(height);
        }
        expect(fitness.top + fitness.height).toBeLessThan(rates.top);
      }
    }
  });
});

describe('drawTrainingGraph', () => {
  it('scales for the pixel ratio, clears, and draws nothing for an empty history', () => {
    const { ctx, ops } = recordingContext();
    const set: number[][] = [];
    let cleared = 0;
    const context = Object.assign(ctx, { setTransform: (...a: number[]) => set.push(a), clearRect: () => (cleared += 1) }) as unknown as GraphContext;
    drawTrainingGraph(context, SIZE, []);
    expect(set).toEqual([[2, 0, 0, 2, 0, 0]]);
    expect(cleared).toBe(1);
    expect(ops).toEqual([]);
  });

  it('draws four lines, best and mean fitness and the two rates, with distinct colours and dashes', () => {
    const { ctx, ops } = recordingContext();
    const context = Object.assign(ctx, { setTransform: () => {}, clearRect: () => {} }) as unknown as GraphContext;
    drawTrainingGraph(context, SIZE, [1, 2, 3, 4, 5].map(point));
    const lines = new Set(ops.filter((op) => op[0] === 'lineTo' && op[3] !== '#4a5a6a').map((op) => `${op[3]}|${JSON.stringify(op[4])}`));
    expect(lines.size).toBe(4);
    const labels = ops.filter((op) => op[0] === 'fillText').map((op) => op[1]);
    expect(labels).toEqual(expect.arrayContaining(['Best fitness', 'Mean fitness', 'Crashed', 'Completed a lap', '0%', '50%', '100%']));
  });
});

describe('createTrainingChart', () => {
  it('writes the text summary as the history grows, even while the graph is closed, and draws nothing then', () => {
    const h = harness({ open: false });
    h.chart.frame();
    expect(h.summary.textContent).toBe('No generation completed yet, so there is nothing to plot.');
    h.history.push(point(1), point(2));
    h.chart.frame();
    expect(h.summary.textContent).toMatch(/^2 completed generations are plotted\. Latest, generation 2:/);
    expect(h.chart.draws).toBe(0);
    expect(h.ops).toEqual([]);
  });

  it('draws once when opened, and not again while nothing changed, however long it waits', () => {
    const h = harness({ open: false });
    h.history.push(point(1));
    h.chart.frame();
    expect(h.chart.draws).toBe(0);
    h.state.open = true;
    h.chart.invalidate();
    h.chart.frame();
    expect(h.chart.draws).toBe(1);
    for (let i = 0; i < 50; i += 1) {
      h.state.now += 100;
      h.chart.frame();
    }
    expect(h.chart.draws).toBe(1);
  });

  it('redraws at most once per MIN_REDRAW_MS (four times a second) when generations arrive faster than that', () => {
    const h = harness();
    const start = h.state.now;
    // A generation every 20 ms for 5 seconds, a frame every 16 ms: 250 generations, about 312 frames.
    let generation = 0;
    for (let ms = 0; ms <= 5000; ms += 16) {
      h.state.now = start + ms;
      if (ms % 20 < 16) h.history.push(point((generation += 1)));
      h.chart.frame();
    }
    expect(generation).toBeGreaterThan(200);
    expect(MIN_REDRAW_MS).toBe(250);
    expect(h.chart.draws).toBeLessThanOrEqual(Math.floor(5000 / MIN_REDRAW_MS) + 1);
    expect(h.chart.draws).toBeGreaterThanOrEqual(15);
    // The last frames waited for the throttle; one more frame after the interval catches up with the full history.
    h.state.now += MIN_REDRAW_MS;
    h.chart.frame();
    const drawn = h.ops.filter((op) => op[0] === 'fillText' && op[1] === String(generation));
    expect(drawn.length).toBeGreaterThan(0);
  });

  it('redraws after a size change, and not while there is no size', () => {
    const h = harness({ size: null });
    h.history.push(point(1));
    h.chart.frame();
    expect(h.chart.draws).toBe(0);
    h.state.size = { ...SIZE, cssWidth: 0, width: 0 };
    h.state.now += 1000;
    h.chart.frame();
    expect(h.chart.draws).toBe(0);
    h.state.size = SIZE;
    h.chart.invalidate();
    h.state.now += 1000;
    h.chart.frame();
    expect(h.chart.draws).toBe(1);
    h.state.size = { ...SIZE, cssWidth: 500, width: 1000 };
    h.chart.invalidate();
    h.state.now += 1000;
    h.chart.frame();
    expect(h.chart.draws).toBe(2);
  });

  it('stays bounded at 500 generations: one draw costs the same as at 5,000, and its summary names the count', () => {
    const cost = (n: number) => {
      const h = harness();
      for (let g = 1; g <= n; g += 1) h.history.push(point(g));
      h.chart.frame();
      expect(h.chart.draws).toBe(1);
      return { ops: h.ops.length, summary: h.summary.textContent };
    };
    const at500 = cost(500);
    const at5000 = cost(5000);
    expect(at500.summary).toMatch(/^500 completed generations are plotted/);
    // Each of the four lines keeps at most 2 * (plot width / 2) + 2 points, so the work does not grow with training.
    const plotWidth = layoutPanels(SIZE.cssWidth, SIZE.cssHeight).fitness.width;
    expect(at500.ops).toBeLessThanOrEqual(4 * (2 * Math.floor(plotWidth / 2) + 2) + 120);
    expect(at5000.ops).toBeLessThanOrEqual(at500.ops + 10);
  });

  it('plots exactly the recorded values: each drawn vertex is the scaled history point', () => {
    const h = harness();
    const points = [1, 2, 3, 4].map(point);
    h.history.push(...points);
    h.chart.frame();
    const area = layoutPanels(SIZE.cssWidth, SIZE.cssHeight).rates;
    const crash = h.ops.filter((op) => (op[0] === 'moveTo' || op[0] === 'lineTo') && op[3] === '#ff8a8a' && (op[2] as number) >= area.top && (op[2] as number) <= area.top + area.height);
    expect(crash.map((op) => [op[1], op[2]])).toEqual(points.map((p, i) => [area.left + (i / 3) * area.width, area.top + (1 - p.crashRate) * area.height]));
  });
});
