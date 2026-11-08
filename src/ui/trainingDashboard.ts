// The training dashboard (P3-01): formats the values from `training/generationMetrics` and writes them to the
// panel's `<output>` elements. It only reads; it never drives the trainer, and it changes a text node only when
// its text changes. The session below is the one place the page's per-frame dashboard path runs, so tests can drive
// exactly that path without a browser.
import { historyPoint, type HistoryPoint } from '../training/generationHistory';
import { completedMetrics, liveCounts, type CompletedMetrics, type LiveCounts } from '../training/generationMetrics';
import type { Trainer } from '../training/trainer';

/** What the dashboard writes to: an element's text, or any object with the same property in a test. */
export interface TextTarget {
  textContent: string | null;
}

export interface DashboardOutputs {
  readonly generation: TextTarget;
  readonly running: TextTarget;
  readonly crashed: TextTarget;
  readonly stalled: TextTarget;
  readonly finished: TextTarget;
  readonly lastGeneration: TextTarget;
  readonly bestFitness: TextTarget;
  readonly meanFitness: TextTarget;
  readonly crashRate: TextTarget;
  readonly stalls: TextTarget;
  readonly lapRate: TextTarget;
  readonly note: TextTarget;
}

/** Shown for every last-completed value until a generation has ended. */
export const NO_VALUE = '—';
export const NO_GENERATION_NOTE = 'No generation completed yet';

export type DashboardText = { readonly [K in keyof DashboardOutputs]: string };

/** A count and its share of the population, for example "62.0% (31/50)". */
export function formatShare(count: number, share: number, population: number): string {
  return `${(share * 100).toFixed(1)}% (${count}/${population})`;
}

/** Fitness to two decimals. */
export function formatFitness(value: number): string {
  return value.toFixed(2);
}

/** The text of every output for the given values. */
export function dashboardText(live: LiveCounts, completed: CompletedMetrics | null): DashboardText {
  return {
    generation: String(live.generation),
    running: String(live.running),
    crashed: String(live.crashed),
    stalled: String(live.stalled),
    finished: String(live.finished),
    lastGeneration: completed ? String(completed.generation) : NO_VALUE,
    bestFitness: completed ? formatFitness(completed.bestFitness) : NO_VALUE,
    meanFitness: completed ? formatFitness(completed.meanFitness) : NO_VALUE,
    crashRate: completed ? formatShare(completed.crashed, completed.crashRate, completed.population) : NO_VALUE,
    stalls: completed ? formatShare(completed.stalled, completed.stallRate, completed.population) : NO_VALUE,
    lapRate: completed ? formatShare(completed.carsWithLap, completed.lapCompletionRate, completed.population) : NO_VALUE,
    note: completed ? '' : NO_GENERATION_NOTE,
  };
}

/** Writes the dashboard, touching only the outputs whose text changed. */
export function renderDashboard(outputs: DashboardOutputs, live: LiveCounts, completed: CompletedMetrics | null): void {
  const text = dashboardText(live, completed);
  for (const key of Object.keys(text) as (keyof DashboardOutputs)[]) {
    if (outputs[key].textContent !== text[key]) outputs[key].textContent = text[key];
  }
}

/** The part of the trainer the dashboard may use. It leaves out `record()`, whose result copies the whole history. */
export type DashboardTrainer = Pick<Trainer, 'step' | 'generation'>;

export interface TrainingSession {
  /** Runs one fixed trainer tick, and remembers the statistics of a generation that ends on it. */
  step(): void;
  /** Called once per rendered frame: updates the dashboard and returns the values it showed. */
  frame(): { readonly live: LiveCounts; readonly completed: CompletedMetrics | null };
  /**
   * One point per completed generation, in order, for the training graph (P3-02). It grows by one entry when a
   * generation ends and is read without copying, so reading it never costs more as training goes on.
   */
  readonly history: readonly HistoryPoint[];
}

/**
 * The trainer plus its dashboard. `step()` keeps the `GenerationStats` the trainer returns when a generation ends, so
 * the dashboard reads the last completed generation without touching the trainer's history, and adds one point to the
 * graph's history.
 */
export function createTrainingSession(trainer: DashboardTrainer, outputs: DashboardOutputs): TrainingSession {
  let last: ReturnType<DashboardTrainer['step']> = null;
  const history: HistoryPoint[] = [];
  return {
    history,
    step() {
      const stats = trainer.step();
      if (stats) {
        last = stats;
        // `fitness` holds one entry per car, so its length is the population the generation was scored over.
        history.push(historyPoint(stats, stats.fitness.length));
      }
    },
    frame() {
      const generation = trainer.generation();
      const live = liveCounts(generation);
      const completed = completedMetrics(last, generation.cars.length);
      renderDashboard(outputs, live, completed);
      return { live, completed };
    },
  };
}
