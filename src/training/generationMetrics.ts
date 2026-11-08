// Dashboard values for the training view (P3-01), computed from what the trainer already records. Pure and headless:
// nothing here draws, reads the DOM or changes the trainer, so tests can check the numbers without a browser.
//
// Two groups, with different meanings (docs/plans/p3-01-plan.md §4):
//  - the current generation's live counts, which change every tick, and
//  - the last completed generation's recorded `GenerationStats`, which are final.
// Fitness is reported only for a completed generation, because a running generation's fitness is incomplete.
import type { Generation, GenerationStats } from './trainer';

/** The cars of the generation being evaluated, by what has happened to them. The four counts sum to `population`. */
export interface LiveCounts {
  /** The generation number as shown: it starts from 1. */
  readonly generation: number;
  readonly population: number;
  /** Cars whose episode has not ended (`episode.outcome` is null). */
  readonly running: number;
  readonly crashed: number;
  readonly stalled: number;
  /** Cars whose episode ended without a crash or a stall: it `completed` or reached its time limit (`timeout`). */
  readonly finished: number;
}

function unreachable(value: never): never {
  throw new Error(`Unexpected episode outcome: ${String(value)}`);
}

/** Counts the cars of `generation` by outcome. Every car falls in exactly one count, so they sum to the population. */
export function liveCounts(generation: Generation): LiveCounts {
  let running = 0;
  let crashed = 0;
  let stalled = 0;
  let finished = 0;
  for (const car of generation.cars) {
    const outcome = car.episode.outcome;
    switch (outcome) {
      case null:
        running += 1;
        break;
      case 'crashed':
        crashed += 1;
        break;
      case 'stalled':
        stalled += 1;
        break;
      case 'completed':
      case 'timeout':
        finished += 1;
        break;
      default:
        return unreachable(outcome);
    }
  }
  return { generation: generation.index + 1, population: generation.cars.length, running, crashed, stalled, finished };
}

/** The last completed generation, as recorded by the trainer. Rates are a share of `population`. */
export interface CompletedMetrics {
  /** The generation number as shown: it starts from 1. */
  readonly generation: number;
  readonly population: number;
  readonly bestFitness: number;
  readonly meanFitness: number;
  /** Cars that crashed, and their share of the population. This is the collision rate; stalls are not included. */
  readonly crashed: number;
  readonly crashRate: number;
  /** Cars that stalled, reported separately from crashes. */
  readonly stalled: number;
  readonly stallRate: number;
  /** Cars that completed at least one valid lap, and their share of the population. */
  readonly carsWithLap: number;
  readonly lapCompletionRate: number;
}

/**
 * The figures for the last completed generation, or null before the first one ends. Takes the stats the trainer
 * returned when the generation ended, so it never needs the trainer's history.
 */
export function completedMetrics(stats: GenerationStats | null, population: number): CompletedMetrics | null {
  if (stats === null) return null;
  if (!Number.isInteger(population) || population < 1) throw new RangeError(`The population must be a positive integer, got ${population}.`);
  const { crashed, stalled } = stats.outcomes;
  return {
    generation: stats.generation + 1,
    population,
    bestFitness: stats.bestFitness,
    meanFitness: stats.meanFitness,
    crashed,
    crashRate: crashed / population,
    stalled,
    stallRate: stalled / population,
    carsWithLap: stats.carsWithLap,
    lapCompletionRate: stats.carsWithLap / population,
  };
}
