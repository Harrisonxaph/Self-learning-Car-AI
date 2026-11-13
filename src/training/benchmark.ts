// The headless throughput benchmark behind `npm run bench` (P4-06 step 4, the P2-11 budget's headless figure). It runs the real trainer (the same
// `createTrainer` and `runGeneration` the training page and the studies use) for a fixed number of generations on one circuit with a seeded population and
// reports how fast the simulation ran: car-ticks per second, and the ticks per second a full population would manage. Pure: the clock is injected, nothing
// here reads a file, a device or the time of day, so tests drive it with a fake clock and the simulated work (the car-tick counts) is bit-identical for the
// same inputs. The wall-clock figures are the only non-deterministic part, and they are a measurement of one machine, never a result about any model.
//
// Method: `warmupGenerations` generations run first and are not timed (the engine's first generation pays one-off costs). Each measured generation is timed
// with two clock reads around `runGeneration`. A tick here is one fixed simulation step of the whole generation; a car-tick is one running car stepped once
// (`totalEpisodeTicks`, summed). Cars leave a generation when they crash or stall, so a generation's running population shrinks: the full-population figure
// divides the car-tick rate by the population, i.e. the rate if every car stayed alive. That is conservative for the P2-11 budget, because the fixed per-tick
// cost of a nearly empty generation is counted against few cars.
import { createTrainer, type TrainingConfig, type TrainingEnvironment } from './trainer';

export interface BenchmarkOptions {
  readonly environment: TrainingEnvironment;
  /** The trainer configuration: population, seed and the episode limits the run uses. */
  readonly config: TrainingConfig;
  /** Generations run before timing starts, 0 to 100. */
  readonly warmupGenerations: number;
  /** Generations timed, 1 to 1000. */
  readonly generations: number;
  /** A monotonic clock in milliseconds (process.hrtime or performance.now). */
  readonly clock: () => number;
}

export interface BenchmarkResult {
  readonly trackId: string;
  readonly trackVersion: string;
  /** Boundary segments the collision and ray queries test against (both closed boundaries). */
  readonly boundarySegments: number;
  readonly populationSize: number;
  readonly seed: number;
  readonly warmupGenerations: number;
  readonly generations: number;
  /** Fixed simulation steps of the whole generation, summed over the measured generations. */
  readonly ticks: number;
  /** Running cars stepped, summed over the measured generations. Deterministic for the same inputs. */
  readonly carTicks: number;
  /** carTicks / ticks: how many cars were still running on average. */
  readonly meanRunningCars: number | null;
  /** The best fitness of each measured generation, in order, so two runs can be shown to have done the same work. Not a result about learning. */
  readonly bestFitness: readonly number[];
  readonly wallMs: number;
  readonly carTicksPerSecond: number | null;
  /** carTicksPerSecond / populationSize: the ticks per second if every car stayed running. Compared with the headless budget of 600. */
  readonly ticksPerSecondFullPopulation: number | null;
  /** ticks per second as observed (the running population shrinks inside a generation, so this is higher). Context only. */
  readonly ticksPerSecondObserved: number | null;
}

const whole = (value: unknown, low: number, high: number, name: string): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < low || value > high) {
    throw new RangeError(`The benchmark's "${name}" must be a whole number from ${low} to ${high}, got ${String(value)}.`);
  }
  return value;
};

/** Runs the benchmark. Throws RangeError naming the field for an unusable option. */
export function runBenchmark(options: BenchmarkOptions): BenchmarkResult {
  if (options === null || typeof options !== 'object') throw new RangeError('The benchmark needs an options object.');
  const warmup = whole(options.warmupGenerations, 0, 100, 'warmupGenerations');
  const generations = whole(options.generations, 1, 1000, 'generations');
  if (typeof options.clock !== 'function') throw new RangeError('The benchmark needs a clock function.');
  const trainer = createTrainer(options.config, options.environment);
  for (let i = 0; i < warmup; i += 1) trainer.runGeneration();
  let wallMs = 0;
  let ticks = 0;
  let carTicks = 0;
  const bestFitness: number[] = [];
  for (let i = 0; i < generations; i += 1) {
    const started = options.clock();
    const stats = trainer.runGeneration();
    const ended = options.clock();
    wallMs += Math.max(0, ended - started);
    ticks += stats.generationTicks;
    carTicks += stats.totalEpisodeTicks;
    bestFitness.push(stats.bestFitness);
  }
  const { track } = options.environment;
  const populationSize = trainer.record().config.populationSize;
  const seconds = wallMs / 1000;
  const rate = (count: number): number | null => (seconds > 0 && Number.isFinite(count / seconds) ? count / seconds : null);
  const carRate = rate(carTicks);
  return {
    trackId: track.id,
    trackVersion: track.version,
    boundarySegments: track.outer.length + track.inner.length,
    populationSize,
    seed: trainer.record().config.seed,
    warmupGenerations: warmup,
    generations,
    ticks,
    carTicks,
    meanRunningCars: ticks > 0 ? carTicks / ticks : null,
    bestFitness,
    wallMs,
    carTicksPerSecond: carRate,
    ticksPerSecondFullPopulation: carRate === null ? null : carRate / populationSize,
    ticksPerSecondObserved: rate(ticks),
  };
}

/** The headless budget of the P2-11 entry: at least this many ticks per second with a population of 50 (10 times real time). */
export const HEADLESS_BUDGET_TICKS_PER_SECOND = 600;
