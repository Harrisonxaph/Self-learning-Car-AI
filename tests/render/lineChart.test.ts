// P3-02: the chart's scaling is pure, so it is tested without a canvas; the drawing is checked against a context that
// records what it was asked to draw. Plain Node.
import { describe, expect, it } from 'vitest';
import { recordingContext } from './recordingContext';
import { drawLegend, drawPanel, keptIndices, niceRange, seriesPoints, xAt, yAt, type PlotArea, type ValueRange } from '../../src/render/lineChart';

const AREA: PlotArea = { left: 40, top: 20, width: 300, height: 100 };

describe('niceRange', () => {
  it('contains every value and uses round tick marks', () => {
    const range = niceRange([0.3, 7.2, 3]);
    expect(range.min).toBeLessThanOrEqual(0.3);
    expect(range.max).toBeGreaterThanOrEqual(7.2);
    expect(range.ticks[0]).toBe(range.min);
    expect(range.ticks[range.ticks.length - 1]).toBe(range.max);
    const step = range.ticks[1]! - range.ticks[0]!;
    expect([1, 2, 5].some((f) => Math.abs(Math.log10(step / f) % 1) < 1e-9 || Math.abs((Math.log10(step / f) % 1) - 1) < 1e-9)).toBe(true);
    expect(niceRange([0, 10])).toEqual({ min: 0, max: 10, ticks: [0, 5, 10] });
  });

  it('handles negative, flat, empty and non-finite input without dividing by zero', () => {
    const negative = niceRange([-30, -2]);
    expect(negative.min).toBeLessThanOrEqual(-30);
    expect(negative.max).toBeGreaterThanOrEqual(-2);
    const flat = niceRange([4, 4, 4]);
    expect(flat.max).toBeGreaterThan(flat.min);
    expect(flat.min).toBeLessThan(4);
    expect(flat.max).toBeGreaterThan(4);
    const empty = niceRange([]);
    expect(empty.max).toBeGreaterThan(empty.min);
    const withNaN = niceRange([1, Number.NaN, 3, Number.POSITIVE_INFINITY]);
    expect(Number.isFinite(withNaN.min) && Number.isFinite(withNaN.max)).toBe(true);
  });
});

describe('xAt and yAt', () => {
  const range: ValueRange = { min: -10, max: 30, ticks: [] };

  it('puts the first position at the left edge, the last at the right edge, and a single one in the middle', () => {
    expect(xAt(0, 5, AREA)).toBe(AREA.left);
    expect(xAt(4, 5, AREA)).toBe(AREA.left + AREA.width);
    expect(xAt(2, 5, AREA)).toBe(AREA.left + AREA.width / 2);
    expect(xAt(0, 1, AREA)).toBe(AREA.left + AREA.width / 2);
  });

  it('puts the maximum at the top and the minimum at the bottom, and is linear between', () => {
    expect(yAt(30, range, AREA)).toBe(AREA.top);
    expect(yAt(-10, range, AREA)).toBe(AREA.top + AREA.height);
    expect(yAt(10, range, AREA)).toBe(AREA.top + AREA.height / 2);
    expect(yAt(0, range, AREA) - yAt(10, range, AREA)).toBeCloseTo(yAt(10, range, AREA) - yAt(20, range, AREA), 9);
  });
});

describe('keptIndices', () => {
  it('keeps every position when there are few enough', () => {
    expect(keptIndices([3, 1, 2], 10)).toEqual([0, 1, 2]);
    expect(keptIndices([], 10)).toEqual([]);
  });

  it('keeps the first, the last and the extremes of a long series, in order, within a bound', () => {
    const values = Array.from({ length: 5000 }, (_, i) => Math.sin(i / 30) * 10 + (i === 2345 ? 100 : 0) - (i === 4001 ? 90 : 0));
    const kept = keptIndices(values, 100);
    expect(kept.length).toBeLessThanOrEqual(202);
    expect(kept[0]).toBe(0);
    expect(kept[kept.length - 1]).toBe(4999);
    expect(kept).toEqual([...kept].sort((a, b) => a - b));
    expect(new Set(kept).size).toBe(kept.length);
    expect(kept).toContain(2345);
    expect(kept).toContain(4001);
  });

  it('does not grow with the number of points: 500 and 50,000 points keep about the same', () => {
    const make = (n: number) => Array.from({ length: n }, (_, i) => (i * 7919) % 101);
    expect(keptIndices(make(500), 60).length).toBeLessThanOrEqual(122);
    expect(keptIndices(make(50_000), 60).length).toBeLessThanOrEqual(122);
  });
});

describe('seriesPoints', () => {
  it('maps each value to the pixel position the scaling gives, and skips values that are not finite', () => {
    const range: ValueRange = { min: 0, max: 10, ticks: [] };
    const points = seriesPoints([0, 5, Number.NaN, 10], range, AREA);
    expect(points).toEqual([
      { x: xAt(0, 4, AREA), y: yAt(0, range, AREA) },
      { x: xAt(1, 4, AREA), y: yAt(5, range, AREA) },
      { x: xAt(3, 4, AREA), y: yAt(10, range, AREA) },
    ]);
  });
});

describe('drawPanel (the graph matches the data)', () => {
  const range: ValueRange = { min: 0, max: 20, ticks: [0, 10, 20] };
  const series = (values: number[], colour: string, dash: number[] = []) => ({ label: colour, colour, dash, values });

  it('draws each series as a polyline through exactly the scaled data points, in its colour and dash', () => {
    const { ctx, ops } = recordingContext();
    const best = [1, 4, 9, 16, 20];
    const mean = [0, 1, 2, 3, 4];
    drawPanel(ctx, { area: AREA, range, series: [series(best, '#aaa'), series(mean, '#bbb', [6, 4])], formatValue: String, xLabels: { first: '1', last: '5' } });
    const line = (colour: string) => ops.filter((op) => (op[0] === 'moveTo' || op[0] === 'lineTo') && op[3] === colour);
    expect(line('#aaa').map((op) => [op[1], op[2]])).toEqual(best.map((v, i) => [xAt(i, 5, AREA), yAt(v, range, AREA)]));
    expect(line('#bbb').map((op) => [op[1], op[2]])).toEqual(mean.map((v, i) => [xAt(i, 5, AREA), yAt(v, range, AREA)]));
    expect(line('#aaa')[0]![4]).toEqual([]);
    expect(line('#bbb')[0]![4]).toEqual([6, 4]);
    // Tick labels and the end labels of the x axis are written.
    const labels = ops.filter((op) => op[0] === 'fillText').map((op) => op[1]);
    expect(labels).toEqual(expect.arrayContaining(['0', '10', '20', '1', '5']));
  });

  it('draws a single point as a visible dot and an empty series as nothing', () => {
    const { ctx, ops } = recordingContext();
    drawPanel(ctx, { area: AREA, range, series: [series([7], '#ccc'), series([], '#ddd')], formatValue: String, xLabels: { first: '1', last: '1' } });
    expect(ops.filter((op) => op[0] === 'lineTo' && op[3] === '#ccc')).toHaveLength(1);
    expect(ops.some((op) => op[3] === '#ddd')).toBe(false);
  });

  it('issues about the same number of drawing calls for 500 points as for 5,000, bounded by the plot width', () => {
    const count = (n: number) => {
      const { ctx, ops } = recordingContext();
      const values = Array.from({ length: n }, (_, i) => (i * 37) % 20);
      drawPanel(ctx, { area: AREA, range, series: [series(values, '#aaa'), series(values, '#bbb')], formatValue: String, xLabels: { first: '1', last: String(n) } });
      return ops.length;
    };
    const at500 = count(500);
    const at5000 = count(5000);
    // The plot is 300 px wide, so a series keeps at most 2 * 150 + 2 points.
    expect(at500).toBeLessThanOrEqual(2 * (2 * 150 + 2) + 80);
    expect(at5000).toBeLessThanOrEqual(2 * (2 * 150 + 2) + 80);
    expect(at5000).toBeLessThanOrEqual(at500 + 10);
  });
});

describe('drawLegend', () => {
  it('draws a sample line in each series colour and dash, and its label', () => {
    const { ctx, ops } = recordingContext();
    drawLegend(ctx, [{ label: 'Best', colour: '#aaa', dash: [], values: [] }, { label: 'Mean', colour: '#bbb', dash: [6, 4], values: [] }], 10, 5);
    expect(ops.filter((op) => op[0] === 'fillText').map((op) => op[1])).toEqual(['Best', 'Mean']);
    expect(ops.filter((op) => op[0] === 'lineTo').map((op) => [op[3], op[4]])).toEqual([['#aaa', []], ['#bbb', [6, 4]]]);
  });
});
