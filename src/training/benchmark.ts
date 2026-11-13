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

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// The sliced, fixed-work benchmark job (the in-page headless benchmark, `?mode=bench`; approved by the owner on 2026-11-13). The same trainer and the same
// definitions as `runBenchmark`, but the work is a fixed number of CAR-TICKS (one running car stepped once) instead of whole generations, and it advances in
// slices of a wall-clock budget so a page stays responsive while it runs. A phone and `npm run bench --car-ticks` therefore do exactly the same simulated work
// (bit-identical), and only the time differs. Only time spent INSIDE slices counts: the pauses between slices (a page yielding to the browser) never do.
// Warm-up car-ticks run first and are not counted, so one-off start-up costs stay out of the figure.

export interface CarTickBenchmarkOptions {
  readonly environment: TrainingEnvironment;
  readonly config: TrainingConfig;
  /** Car-ticks run before timing starts, 0 to 10,000,000. */
  readonly warmupCarTicks: number;
  /** Car-ticks timed, 1 to 10,000,000. The job stops at the tick that reaches this many, so the count run can exceed it by at most one tick's cars. */
  readonly measureCarTicks: number;
  readonly clock: () => number;
}

export type BenchmarkPhase = 'warm-up' | 'measuring' | 'done';

export interface CarTickBenchmarkProgress {
  readonly phase: BenchmarkPhase;
  /** Car-ticks done in the current phase (the measured count once done). */
  readonly carTicks: number;
  /** The current phase's target (the measured target once done). */
  readonly target: number;
}

export interface CarTickBenchmarkResult {
  readonly trackId: string;
  readonly trackVersion: string;
  readonly boundarySegments: number;
  readonly populationSize: number;
  readonly seed: number;
  readonly warmupCarTicks: number;
  readonly measureCarTicks: number;
  /** Car-ticks actually measured: at least `measureCarTicks`. Deterministic for the same inputs. */
  readonly carTicks: number;
  readonly ticks: number;
  readonly meanRunningCars: number | null;
  /** Time spent inside the measured slices only. */
  readonly computeMs: number;
  readonly carTicksPerSecond: number | null;
  /** carTicksPerSecond / populationSize, as in `BenchmarkResult`. Compared with the headless budget of 600. */
  readonly ticksPerSecondFullPopulation: number | null;
}

export interface CarTickBenchmarkJob {
  /** Runs for about `budgetMs` of clock time (always at least one tick, so it always progresses). Returns true once the job is done. */
  advance(budgetMs: number): boolean;
  progress(): CarTickBenchmarkProgress;
  /** The result once done, otherwise null. */
  result(): CarTickBenchmarkResult | null;
}

export function createCarTickBenchmarkJob(options: CarTickBenchmarkOptions): CarTickBenchmarkJob {
  if (options === null || typeof options !== 'object') throw new RangeError('The benchmark needs an options object.');
  const warmup = whole(options.warmupCarTicks, 0, 10_000_000, 'warmupCarTicks');
  const target = whole(options.measureCarTicks, 1, 10_000_000, 'measureCarTicks');
  if (typeof options.clock !== 'function') throw new RangeError('The benchmark needs a clock function.');
  const trainer = createTrainer(options.config, options.environment);
  const { track } = options.environment;
  const record = trainer.record();
  let phase: BenchmarkPhase = warmup === 0 ? 'measuring' : 'warm-up';
  let warmDone = 0;
  let carTicks = 0;
  let ticks = 0;
  let computeMs = 0;

  const tickOnce = (): number => {
    let running = 0;
    for (const car of trainer.generation().cars) if (car.episode.outcome === null) running += 1;
    trainer.step();
    return running;
  };

  const rate = (count: number): number | null => (computeMs > 0 && Number.isFinite(count / (computeMs / 1000)) ? count / (computeMs / 1000) : null);

  return {
    advance(budgetMs) {
      if (typeof budgetMs !== 'number' || !Number.isFinite(budgetMs) || budgetMs <= 0) throw new RangeError('The slice budget must be a finite number of milliseconds above 0.');
      if (phase === 'done') return true;
      const sliceStart = options.clock();
      let timedFrom: number | null = phase === 'measuring' ? sliceStart : null;
      for (;;) {
        const running = tickOnce();
        if (phase === 'warm-up') {
          warmDone += running;
          if (warmDone >= warmup) {
            phase = 'measuring';
            timedFrom = options.clock();
            // The slice ends at the boundary, so a caller (the profile script) can act exactly between the warm-up and the measured work. Only the slicing
            // changes: the work and the car-tick counts are the same however the job is sliced.
            break;
          }
        } else {
          carTicks += running;
          ticks += 1;
          if (carTicks >= target) {
            phase = 'done';
            break;
          }
        }
        if (options.clock() - sliceStart >= budgetMs) break;
      }
      if (timedFrom !== null) computeMs += Math.max(0, options.clock() - timedFrom);
      return phase === 'done';
    },
    progress: () => ({
      phase,
      carTicks: phase === 'warm-up' ? warmDone : carTicks,
      target: phase === 'warm-up' ? warmup : target,
    }),
    result: () =>
      phase !== 'done'
        ? null
        : {
            trackId: track.id,
            trackVersion: track.version,
            boundarySegments: track.outer.length + track.inner.length,
            populationSize: record.config.populationSize,
            seed: record.config.seed,
            warmupCarTicks: warmup,
            measureCarTicks: target,
            carTicks,
            ticks,
            meanRunningCars: ticks > 0 ? carTicks / ticks : null,
            computeMs,
            carTicksPerSecond: rate(carTicks),
            ticksPerSecondFullPopulation: rate(carTicks) === null ? null : rate(carTicks)! / record.config.populationSize,
          },
  };
}

/** Runs a fixed-work job to completion in slices of `sliceMs`. For Node and the tests; a page advances the job itself between yields. */
export function runCarTickBenchmark(options: CarTickBenchmarkOptions, sliceMs = 50): CarTickBenchmarkResult {
  const job = createCarTickBenchmarkJob(options);
  while (!job.advance(sliceMs)) {
    // The job is advanced until done.
  }
  return job.result()!;
}
