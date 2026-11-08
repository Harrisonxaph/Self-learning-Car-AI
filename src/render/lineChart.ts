// Line charts on a canvas (P3-02): the scaling is pure and tested on its own, and the drawing only needs a small
// subset of the 2D context so tests can record it. Rendering reads values and never drives the app.

export interface ChartSeries {
  readonly label: string;
  readonly colour: string;
  /** Alternating dash and gap lengths in CSS pixels; empty for a solid line. Lets lines differ without relying on colour. */
  readonly dash: readonly number[];
  /** One value per x position, in order. */
  readonly values: readonly number[];
}

export interface PlotArea {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface ValueRange {
  readonly min: number;
  readonly max: number;
  readonly ticks: readonly number[];
}

/** A step of 1, 2 or 5 times a power of ten that is at least `rough`. */
function niceStep(rough: number): number {
  const power = 10 ** Math.floor(Math.log10(rough));
  for (const factor of [1, 2, 5, 10]) if (factor * power >= rough) return factor * power;
  return 10 * power;
}

/**
 * A value range that contains every finite value, with round tick marks. A flat or empty set gets a range of one
 * unit around it, so the line is drawn in the middle rather than dividing by zero.
 */
export function niceRange(values: readonly number[], tickCount = 3): ValueRange {
  const finite = values.filter(Number.isFinite);
  let low = finite.length > 0 ? Math.min(...finite) : 0;
  let high = finite.length > 0 ? Math.max(...finite) : 1;
  if (high === low) {
    low -= 0.5;
    high += 0.5;
  }
  const step = niceStep((high - low) / Math.max(1, tickCount - 1));
  const min = Math.floor(low / step) * step;
  const max = Math.ceil(high / step) * step;
  const ticks: number[] = [];
  for (let value = min; value <= max + step / 2; value += step) ticks.push(Number(value.toPrecision(12)));
  return { min: Number(min.toPrecision(12)), max: Number(max.toPrecision(12)), ticks };
}

/** Screen x for the `index`th of `count` positions. One position sits in the middle. */
export function xAt(index: number, count: number, area: PlotArea): number {
  return count <= 1 ? area.left + area.width / 2 : area.left + (index / (count - 1)) * area.width;
}

/** Screen y for `value`; larger values are higher up the screen. */
export function yAt(value: number, range: ValueRange, area: PlotArea): number {
  return area.top + (1 - (value - range.min) / (range.max - range.min)) * area.height;
}

/**
 * The positions to draw when there are more points than the plot can show. Up to `buckets` equal runs each keep their
 * lowest and highest finite value, so peaks and dips survive, and the first and last finite positions are always kept.
 * Values that are not finite (NaN, infinities) are never chosen, so a bucket that starts with one still keeps its finite
 * extremes, and a bucket with no finite value keeps nothing. The result is in increasing order and has at most
 * `2 * buckets + 2` entries. With few enough points, every position is kept (the caller drops those that are not finite).
 */
export function keptIndices(values: readonly number[], buckets: number): number[] {
  const count = values.length;
  if (count <= 2 * buckets + 2) return values.map((_, index) => index);
  const kept = new Set<number>();
  for (let index = 0; index < count; index += 1) {
    if (Number.isFinite(values[index]!)) {
      kept.add(index);
      break;
    }
  }
  for (let index = count - 1; index >= 0; index -= 1) {
    if (Number.isFinite(values[index]!)) {
      kept.add(index);
      break;
    }
  }
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const from = Math.floor((bucket * count) / buckets);
    const to = Math.max(from + 1, Math.floor(((bucket + 1) * count) / buckets));
    let lowest = -1;
    let highest = -1;
    for (let index = from; index < to; index += 1) {
      const value = values[index]!;
      if (!Number.isFinite(value)) continue;
      if (lowest < 0 || value < values[lowest]!) lowest = index;
      if (highest < 0 || value > values[highest]!) highest = index;
    }
    if (lowest >= 0) kept.add(lowest);
    if (highest >= 0) kept.add(highest);
  }
  return [...kept].sort((a, b) => a - b);
}

export interface PlotPoint {
  readonly x: number;
  readonly y: number;
}

/** The pixel positions of the points that are drawn for one series. */
export function seriesPoints(values: readonly number[], range: ValueRange, area: PlotArea, buckets = Math.max(1, Math.floor(area.width / 2))): PlotPoint[] {
  return keptIndices(values, buckets)
    .filter((index) => Number.isFinite(values[index]!))
    .map((index) => ({ x: xAt(index, values.length, area), y: yAt(values[index]!, range, area) }));
}

/** The parts of the 2D context the chart uses. */
export type ChartContext = Pick<
  CanvasRenderingContext2D,
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'arc'
  | 'fill'
  | 'stroke'
  | 'fillText'
  | 'setLineDash'
  | 'strokeStyle'
  | 'fillStyle'
  | 'lineWidth'
  | 'font'
  | 'textAlign'
  | 'textBaseline'
>;

export interface PanelSpec {
  readonly area: PlotArea;
  readonly range: ValueRange;
  readonly series: readonly ChartSeries[];
  /** Formats a y tick label. */
  readonly formatValue: (value: number) => string;
  /** Labels for the first and last x positions, for example generation numbers. */
  readonly xLabels: { readonly first: string; readonly last: string };
}

export const CHART_COLOURS = Object.freeze({ axis: '#4a5a6a', text: '#9fb0c0' });

/** A series with at most this many positions also gets a dot on each point, so a single point is visible. */
export const MARKER_LIMIT = 30;
export const MARKER_RADIUS = 3;

/** Draws a one-line legend from (`x`, `y`): a short sample of each line in its colour and dash, then its label. */
export function drawLegend(ctx: ChartContext, series: readonly ChartSeries[], x: number, y: number): void {
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let at = x;
  for (const line of series) {
    ctx.strokeStyle = line.colour;
    ctx.lineWidth = 2;
    ctx.setLineDash([...line.dash]);
    ctx.beginPath();
    ctx.moveTo(at, y);
    ctx.lineTo(at + 18, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = CHART_COLOURS.text;
    ctx.fillText(line.label, at + 22, y);
    at += 22 + line.label.length * 6.5 + 12;
  }
}

/** Draws one panel: tick lines and labels, the x-axis end labels, and each series as a polyline. */
export function drawPanel(ctx: ChartContext, panel: PanelSpec): void {
  const { area, range, series } = panel;
  ctx.setLineDash([]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = CHART_COLOURS.axis;
  ctx.fillStyle = CHART_COLOURS.text;
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const tick of range.ticks) {
    const y = yAt(tick, range, area);
    ctx.beginPath();
    ctx.moveTo(area.left, y);
    ctx.lineTo(area.left + area.width, y);
    ctx.stroke();
    ctx.fillText(panel.formatValue(tick), area.left - 4, y);
  }
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(panel.xLabels.first, area.left, area.top + area.height + 3);
  ctx.textAlign = 'right';
  ctx.fillText(panel.xLabels.last, area.left + area.width, area.top + area.height + 3);
  ctx.lineWidth = 2;
  for (const line of series) {
    const points = seriesPoints(line.values, range, area);
    if (points.length === 0) continue;
    ctx.strokeStyle = line.colour;
    ctx.setLineDash([...line.dash]);
    if (points.length > 1) {
      ctx.beginPath();
      points.forEach((point, index) => (index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)));
      ctx.stroke();
    }
    // A short series gets a dot on each point. A lone point has no line to show it, so the dot is what is seen.
    if (line.values.length <= MARKER_LIMIT) {
      ctx.setLineDash([]);
      ctx.fillStyle = line.colour;
      for (const point of points) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, MARKER_RADIUS, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
  }
  ctx.setLineDash([]);
}
