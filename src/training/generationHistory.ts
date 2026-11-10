// What the training graph plots (P3-02): one point per completed generation, built from the trainer's own
// `GenerationStats`, plus a plain-text summary of the plotted history for people who cannot read the chart.
// Pure and headless: nothing here draws or reads the DOM.
import { completedMetrics, type CompletedSource } from './generationMetrics';

/** The figures plotted for one completed generation. Rates are shares of the population, from 0 to 1. */
export interface HistoryPoint {
  /** The generation number as shown: it starts from 1. */
  readonly generation: number;
  readonly bestFitness: number;
  readonly meanFitness: number;
  /** Cars that crashed, as a share of the population (crashes only: stalls are not included). */
  readonly crashRate: number;
  /** Cars that completed at least one valid lap, as a share of the population. */
  readonly lapCompletionRate: number;
}

/** The plotted point for a generation the trainer has just completed. Uses the same definitions as the dashboard. */
export function historyPoint(stats: CompletedSource, population: number): HistoryPoint {
  const metrics = completedMetrics(stats, population);
  if (metrics === null) throw new TypeError('A completed generation is required.');
  return {
    generation: metrics.generation,
    bestFitness: metrics.bestFitness,
    meanFitness: metrics.meanFitness,
    crashRate: metrics.crashRate,
    lapCompletionRate: metrics.lapCompletionRate,
  };
}

const fitness = (value: number) => value.toFixed(2);
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

/**
 * A plain-text description of the plotted history. It reports what was recorded and says nothing about learning or
 * improvement: a rising line is not evidence of general driving ability (docs/AI_EVALUATION.md).
 */
export function summariseHistory(points: readonly HistoryPoint[]): string {
  if (points.length === 0) return 'No generation completed yet, so there is nothing to plot.';
  const latest = points[points.length - 1]!;
  let highest = points[0]!;
  for (const point of points) if (point.bestFitness > highest.bestFitness) highest = point;
  const count = points.length === 1 ? '1 completed generation is plotted' : `${points.length} completed generations are plotted`;
  return (
    `${count}. Latest, generation ${latest.generation}: best fitness ${fitness(latest.bestFitness)}, mean fitness ${fitness(latest.meanFitness)}, ` +
    `${percent(latest.crashRate)} of cars crashed, ${percent(latest.lapCompletionRate)} completed a lap. ` +
    `Highest best fitness so far: ${fitness(highest.bestFitness)} in generation ${highest.generation}.`
  );
}
