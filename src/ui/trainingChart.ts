// The training graph (P3-02): two small line charts of the completed generations, drawn on a canvas and redrawn at
// most a few times per second. Fitness (best and mean) is on top, and the crash and lap-completion rates are below.
// This controller has no DOM: the page gives it the history to plot, the drawing context, the plot size, and a clock,
// so tests can drive it exactly as the page does.
import { summariseHistory, type HistoryPoint } from '../training/generationHistory';
import { drawLegend, drawPanel, niceRange, type ChartContext, type ChartSeries, type PanelSpec, type PlotArea } from '../render/lineChart';
import type { ViewportSize } from '../render/viewport';
import type { TextTarget } from './trainingDashboard';

/** The graph is redrawn at most this often (4 times a second), however fast generations complete. */
export const MIN_REDRAW_MS = 250;

export type GraphContext = ChartContext & Pick<CanvasRenderingContext2D, 'setTransform' | 'clearRect'>;

export interface TrainingChartOptions {
  /** The completed generations to plot, in order. Read without copying. */
  readonly history: () => readonly HistoryPoint[];
  readonly context: GraphContext;
  /** Where the plain-text summary of the history is written. */
  readonly summary: TextTarget;
  /** Whether the graph is on screen. A closed graph is not drawn, but its summary still follows the history. */
  readonly isOpen: () => boolean;
  /** The plot size now, or null when there is none. */
  readonly size: () => ViewportSize | null;
  /** The time in milliseconds, from any steady clock. */
  readonly now: () => number;
}

export interface TrainingChart {
  /** Called once per rendered frame: follows the history, and redraws when something changed and enough time passed. */
  frame(): void;
  /** Something other than the history changed (the size, or the graph being opened): redraw when next allowed. */
  invalidate(): void;
  /** How many times the graph has been drawn. */
  readonly draws: number;
}

const BEST: ChartSeries = { label: 'Best fitness', colour: '#7fe0bd', dash: [], values: [] };
const MEAN: ChartSeries = { label: 'Mean fitness', colour: '#8ab4ff', dash: [6, 4], values: [] };
const CRASHED: ChartSeries = { label: 'Crashed', colour: '#ff8a8a', dash: [], values: [] };
const LAPS: ChartSeries = { label: 'Completed a lap', colour: '#ffd479', dash: [6, 4], values: [] };

const MARGIN = { left: 44, right: 10, top: 6, bottom: 4 };
const LEGEND_HEIGHT = 14;
const LABEL_HEIGHT = 16;

/** The two plot areas for a canvas of the given CSS size. Both stay inside it, even for a very small canvas. */
export function layoutPanels(cssWidth: number, cssHeight: number): { fitness: PlotArea; rates: PlotArea } {
  const width = Math.max(1, cssWidth - MARGIN.left - MARGIN.right);
  const block = Math.max(1, (cssHeight - MARGIN.top - MARGIN.bottom) / 2);
  const plotHeight = Math.max(1, block - LEGEND_HEIGHT - LABEL_HEIGHT);
  return {
    fitness: { left: MARGIN.left, top: MARGIN.top + LEGEND_HEIGHT, width, height: plotHeight },
    rates: { left: MARGIN.left, top: MARGIN.top + block + LEGEND_HEIGHT, width, height: plotHeight },
  };
}

/** Draws both panels for `points` into a context sized `size`. */
export function drawTrainingGraph(ctx: GraphContext, size: ViewportSize, points: readonly HistoryPoint[]): void {
  ctx.setTransform(size.pixelRatio, 0, 0, size.pixelRatio, 0, 0);
  ctx.clearRect(0, 0, size.cssWidth, size.cssHeight);
  if (points.length === 0) return;
  const areas = layoutPanels(size.cssWidth, size.cssHeight);
  const xLabels = { first: String(points[0]!.generation), last: String(points[points.length - 1]!.generation) };
  const best = points.map((p) => p.bestFitness);
  const mean = points.map((p) => p.meanFitness);
  const fitnessSeries = [
    { ...BEST, values: best },
    { ...MEAN, values: mean },
  ];
  const rateSeries = [
    { ...CRASHED, values: points.map((p) => p.crashRate) },
    { ...LAPS, values: points.map((p) => p.lapCompletionRate) },
  ];
  const panels: PanelSpec[] = [
    { area: areas.fitness, range: niceRange([...best, ...mean]), series: fitnessSeries, formatValue: (v) => String(v), xLabels },
    { area: areas.rates, range: { min: 0, max: 1, ticks: [0, 0.5, 1] }, series: rateSeries, formatValue: (v) => `${Math.round(v * 100)}%`, xLabels },
  ];
  for (const panel of panels) {
    drawLegend(ctx, panel.series, panel.area.left, panel.area.top - LEGEND_HEIGHT / 2 - 2);
    drawPanel(ctx, panel);
  }
}

export function createTrainingChart(options: TrainingChartOptions): TrainingChart {
  let plotted = -1;
  let dirty = true;
  let lastDrawMs: number | undefined;
  let draws = 0;
  return {
    get draws() {
      return draws;
    },
    invalidate() {
      dirty = true;
    },
    frame() {
      const points = options.history();
      if (points.length !== plotted) {
        plotted = points.length;
        const text = summariseHistory(points);
        if (options.summary.textContent !== text) options.summary.textContent = text;
        dirty = true;
      }
      if (!dirty || !options.isOpen()) return;
      const now = options.now();
      if (lastDrawMs !== undefined && now - lastDrawMs < MIN_REDRAW_MS) return;
      const size = options.size();
      if (!size || size.cssWidth < 1 || size.cssHeight < 1) return;
      drawTrainingGraph(options.context, size, points);
      dirty = false;
      lastDrawMs = now;
      draws += 1;
    },
  };
}
