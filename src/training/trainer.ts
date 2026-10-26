// The population training loop (P2-05): evaluates every genome as its own neural car on one track, records
// per-generation statistics, and builds the next generation. Headless: it never draws or touches the DOM, so
// the same code runs in Node (tests, `npm run demo:train`) and, one tick at a time, under the page's frame loop.
//
// One simulation path. Each running car, each fixed tick, uses only the existing modules:
//   buildInputs (ai/inputs.ts) → runNetwork (ai/network.ts) → stepRacer (sim/checkpoints.ts: physics, swept
//   collision, gates) → recordTick (training/fitness.ts).
// At the end of a generation, scoreEpisode gives each car's fitness and nextGeneration (evolution/population.ts)
// builds the next population: elites copied unchanged first, then selection, crossover and mutation.
//
// Cars are independent (multi-car Option A). Each has its own genome, racer (vehicle, crash flag, lap progress)
// and episode. Rays and collision test track boundaries only, so cars never see, block or hit each other, and
// all of them start overlapping on the track's start pose. A car's result depends only on its genome and the
// shared, immutable configuration: it is the same alone, in any population, and in any order.
//
// Randomness. The trainer owns one run generator, createRng(seed). Its first draw seeds the initial-population
// generator (genomes in index order); each generation transition takes exactly three more draws, through
// createEvolutionRngs. Episodes use no randomness, so stepping order and drawing cannot change any stream.
import { buildInputs, INPUT_CONTRACT } from '../ai/inputs';
import { INITIALISATION, initialParameters, PARAMETER_COUNT, PARAMETER_ORDER, runNetwork } from '../ai/network';
import { OUTPUT_CONTRACT } from '../ai/outputs';
import { createEvolutionRngs, EVOLUTION_OPERATORS, nextGeneration, resolveEvolutionConfig, type EvolutionConfig } from '../evolution/population';
import { rankByFitness } from '../evolution/selection';
import { DEFAULT_SENSOR_CONFIG, type SensorConfig } from '../sensors/rays';
import { stepRacer, type Racer } from '../sim/checkpoints';
import type { VehiclePhysics } from '../sim/config';
import type { Track } from '../sim/track';
import { startRacer } from '../sim/world';
import { createRng, RNG_ALGORITHM, type Rng } from '../utils/rng';
import {
  DEFAULT_EPISODE_LIMITS,
  DEFAULT_FITNESS_CONFIG,
  FITNESS_VERSION,
  recordTick,
  resolveEpisodeRules,
  resolveFitnessConfig,
  scoreEpisode,
  startEpisode,
  type Episode,
  type EpisodeLimits,
  type EpisodeOutcome,
  type EpisodeRules,
  type FitnessConfig,
} from './fitness';

/** Training settings, named as in a saved model's `training.configuration` (docs/MODEL_FORMAT.md). */
export interface TrainingConfig extends EvolutionConfig, EpisodeLimits {
  /** Seed for the run generator: an integer from 0 to 4,294,967,295. */
  readonly seed: number;
  readonly fitness: FitnessConfig;
  /** False forces every car's brake output to 0 (the no-brake mask, P2-03). */
  readonly brakeEnabled: boolean;
}

/** The MODEL_FORMAT example's settings, with seed 1. */
export const DEFAULT_TRAINING_CONFIG: TrainingConfig = Object.freeze({
  seed: 1,
  ...resolveEvolutionConfig({
    populationSize: 50,
    eliteCount: 2,
    selection: { type: 'tournament', size: 3 },
    crossover: { type: 'uniform', rate: 0.7 },
    mutation: { rate: 0.1, scale: 0.2 },
  }),
  ...DEFAULT_EPISODE_LIMITS,
  fitness: DEFAULT_FITNESS_CONFIG,
  brakeEnabled: true,
});

/** What the cars drive on and how time advances; shared by every car and never changed. */
export interface TrainingEnvironment {
  readonly track: Track;
  readonly physics: VehiclePhysics;
  readonly timestepSeconds: number;
}

/** The contract and version identifiers a run depends on, so a champion can be replayed and compared later. */
export interface TrainingVersions {
  readonly rngAlgorithm: string;
  readonly evolutionOperators: string;
  readonly initialisation: string;
  readonly parameterOrder: string;
  readonly inputContract: string;
  readonly outputContract: string;
  readonly fitnessVersion: number;
  readonly trackId: string;
  readonly trackVersion: string;
}

/** A validated configuration together with its derived rules and version references. */
export interface TrainingSetup {
  readonly config: TrainingConfig;
  readonly environment: TrainingEnvironment;
  readonly sensors: SensorConfig;
  readonly rules: EpisodeRules;
  readonly versions: TrainingVersions;
}

/** One car: its genome, its own racer (vehicle, crash flag, lap progress) and its own episode. */
export interface TrainingCar {
  readonly genome: Float64Array;
  readonly racer: Racer;
  readonly episode: Episode;
}

/** The generation being evaluated. */
export interface Generation {
  /** 0 for the initial population. */
  readonly index: number;
  /** Ticks run so far in this generation. */
  readonly tick: number;
  readonly cars: readonly TrainingCar[];
}

/** What one completed generation recorded. */
export interface GenerationStats {
  readonly generation: number;
  /** Each car's fitness, in population order. */
  readonly fitness: readonly number[];
  readonly bestFitness: number;
  readonly meanFitness: number;
  readonly worstFitness: number;
  /** The fittest car (ties to the lower index) and a copy of its genome. */
  readonly championIndex: number;
  readonly champion: Float64Array;
  readonly outcomes: Readonly<Record<EpisodeOutcome, number>>;
  /** Cars that completed at least one lap. */
  readonly carsWithLap: number;
  readonly maxGatesPassed: number;
  /** Ticks in the longest episode, which is how long the generation ran. */
  readonly generationTicks: number;
  /** Ticks summed over every car: the simulation budget this generation used. */
  readonly totalEpisodeTicks: number;
}

/** Everything needed to describe a run so far: configuration, versions and per-generation statistics. */
export interface TrainingRecord {
  readonly config: TrainingConfig;
  readonly versions: TrainingVersions;
  readonly timestepSeconds: number;
  readonly sensors: SensorConfig;
  readonly generations: readonly GenerationStats[];
}

export interface Trainer {
  readonly setup: TrainingSetup;
  /** The generation currently being evaluated. */
  generation(): Generation;
  /** The most recently completed generation, with every car's finished episode, or null before the first. */
  finished(): Generation | null;
  /**
   * Advances every running car by one fixed tick. When the last car's episode ends, the generation is scored,
   * its statistics are recorded and returned, and the next generation starts; otherwise returns null.
   */
  step(): GenerationStats | null;
  /** Steps until the current generation ends and returns its statistics. */
  runGeneration(): GenerationStats;
  /** The configuration, versions and statistics of every completed generation. */
  record(): TrainingRecord;
}

/**
 * Checks a training configuration and returns a frozen copy. Throws RangeError for a seed that is not an integer
 * from 0 to 4,294,967,295, a non-boolean brakeEnabled, or anything the evolution, fitness or episode-limit
 * resolvers reject.
 */
export function resolveTrainingConfig(input: unknown, timestepSeconds: number): { config: TrainingConfig; rules: EpisodeRules } {
  if (input === null || typeof input !== 'object') throw new RangeError('Training config must be an object.');
  const c = input as Record<string, unknown>;
  const { seed, brakeEnabled } = c;
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError(`Training config "seed" must be an integer from 0 to 4294967295, got ${String(seed)}.`);
  }
  if (typeof brakeEnabled !== 'boolean') throw new RangeError(`Training config "brakeEnabled" must be a boolean, got ${String(brakeEnabled)}.`);
  const evolution = resolveEvolutionConfig(c);
  const fitness = resolveFitnessConfig(c.fitness);
  const rules = resolveEpisodeRules(c, timestepSeconds);
  const config: TrainingConfig = Object.freeze({
    seed,
    ...evolution,
    maxEpisodeSeconds: c.maxEpisodeSeconds as number,
    stallSeconds: c.stallSeconds as number,
    maxLaps: rules.maxLaps,
    fitness,
    brakeEnabled,
  });
  return { config, rules };
}

/** Validates a configuration against an environment and collects the version references. */
export function createTrainingSetup(input: unknown, environment: TrainingEnvironment): TrainingSetup {
  const { config, rules } = resolveTrainingConfig(input, environment.timestepSeconds);
  if (!environment.track || environment.track.gates.length === 0) throw new RangeError('Training needs a track with gates.');
  return Object.freeze({
    config,
    environment: Object.freeze({ ...environment }),
    sensors: DEFAULT_SENSOR_CONFIG,
    rules,
    versions: Object.freeze({
      rngAlgorithm: RNG_ALGORITHM,
      evolutionOperators: EVOLUTION_OPERATORS,
      initialisation: INITIALISATION.id,
      parameterOrder: PARAMETER_ORDER,
      inputContract: INPUT_CONTRACT,
      outputContract: OUTPUT_CONTRACT,
      fitnessVersion: FITNESS_VERSION,
      trackId: environment.track.id,
      trackVersion: environment.track.version,
    }),
  });
}

/** A fresh car for `genome`: the track's start pose at rest, uncrashed, with fresh lap progress and episode. */
export function startCar(genome: Float64Array, setup: TrainingSetup): TrainingCar {
  const { track, physics } = setup.environment;
  const racer = startRacer(track, physics);
  return { genome, racer, episode: startEpisode(racer, track) };
}

/**
 * One fixed tick for one car: inputs, network, physics with collision and gates, then episode termination. A car
 * whose episode has ended is returned unchanged. Pure: reads only the car and the setup.
 */
export function stepCar(car: TrainingCar, setup: TrainingSetup): TrainingCar {
  if (car.episode.outcome !== null) return car;
  const { track, physics, timestepSeconds } = setup.environment;
  const inputs = buildInputs(car.racer, track, physics, setup.sensors);
  const controls = runNetwork(car.genome, inputs, { brakeEnabled: setup.config.brakeEnabled });
  const racer = stepRacer(car.racer, controls, track, physics, timestepSeconds);
  return { genome: car.genome, racer, episode: recordTick(car.episode, racer, track, setup.rules) };
}

/** A new generation: one fresh car per genome, in order, at tick 0. */
export function startGeneration(index: number, genomes: readonly Float64Array[], setup: TrainingSetup): Generation {
  return { index, tick: 0, cars: genomes.map((genome) => startCar(genome, setup)) };
}

/** Advances every running car of a generation by one tick (the same stepCar for each car, in index order). */
export function stepGeneration(generation: Generation, setup: TrainingSetup): Generation {
  return { index: generation.index, tick: generation.tick + 1, cars: generation.cars.map((car) => stepCar(car, setup)) };
}

/** True once every car's episode has an outcome. */
export function generationDone(generation: Generation): boolean {
  return generation.cars.every((car) => car.episode.outcome !== null);
}

/** Runs one genome's whole episode on its own and returns the finished car. */
export function evaluateGenome(genome: Float64Array, setup: TrainingSetup): TrainingCar {
  let car = startCar(genome, setup);
  while (car.episode.outcome === null) car = stepCar(car, setup);
  return car;
}

/** The fitness of a finished (or unfinished) car's episode. */
export function carFitness(car: TrainingCar, setup: TrainingSetup): number {
  return scoreEpisode(car.episode, setup.config.fitness, setup.rules).total;
}

function generationStats(generation: Generation, setup: TrainingSetup): GenerationStats {
  const fitness = generation.cars.map((car) => carFitness(car, setup));
  const championIndex = rankByFitness(fitness)[0]!;
  const sum = fitness.reduce((total, value) => total + value, 0);
  if (!Number.isFinite(sum)) throw new RangeError('Generation fitness total is not finite; the weights are too large.');
  const outcomes: Record<EpisodeOutcome, number> = { completed: 0, crashed: 0, stalled: 0, timeout: 0 };
  let carsWithLap = 0;
  let maxGatesPassed = 0;
  let totalEpisodeTicks = 0;
  for (const { episode } of generation.cars) {
    outcomes[episode.outcome!] += 1;
    if (episode.lapTicks.length > 0) carsWithLap += 1;
    maxGatesPassed = Math.max(maxGatesPassed, episode.gatesPassed);
    totalEpisodeTicks += episode.tick;
  }
  return Object.freeze({
    generation: generation.index,
    fitness: Object.freeze(fitness),
    bestFitness: fitness[championIndex]!,
    meanFitness: sum / fitness.length,
    worstFitness: Math.min(...fitness),
    championIndex,
    champion: Float64Array.from(generation.cars[championIndex]!.genome),
    outcomes: Object.freeze(outcomes),
    carsWithLap,
    maxGatesPassed,
    generationTicks: generation.tick,
    totalEpisodeTicks,
  });
}

/**
 * Creates a trainer and starts generation 0. Validates the configuration (RangeError on anything invalid), then
 * seeds the initial population from the run generator.
 */
export function createTrainer(input: unknown, environment: TrainingEnvironment): Trainer {
  const setup = createTrainingSetup(input, environment);
  const run: Rng = createRng(setup.config.seed);
  const initial = createRng(run.nextUint32());
  const genomes = Array.from({ length: setup.config.populationSize }, () => initialParameters(initial));
  if (genomes[0]!.length !== PARAMETER_COUNT) throw new RangeError('Initial genomes do not match the network.');

  let current = startGeneration(0, genomes, setup);
  let finished: Generation | null = null;
  const history: GenerationStats[] = [];

  const finish = (): GenerationStats => {
    const stats = generationStats(current, setup);
    history.push(stats);
    const next = nextGeneration(
      current.cars.map((car) => car.genome),
      stats.fitness,
      setup.config,
      createEvolutionRngs(run),
    );
    finished = current;
    current = startGeneration(current.index + 1, next.genomes, setup);
    return stats;
  };

  const step = (): GenerationStats | null => {
    current = stepGeneration(current, setup);
    return generationDone(current) ? finish() : null;
  };

  return {
    setup,
    generation: () => current,
    finished: () => finished,
    step,
    runGeneration() {
      for (;;) {
        const stats = step();
        if (stats) return stats;
      }
    },
    record: () =>
      Object.freeze({
        config: setup.config,
        versions: setup.versions,
        timestepSeconds: setup.environment.timestepSeconds,
        sensors: setup.sensors,
        generations: Object.freeze([...history]),
      }),
  };
}

/** Runs `generations` whole generations headless and returns the run's record. */
export function trainHeadless(input: unknown, environment: TrainingEnvironment, generations: number): TrainingRecord {
  if (!Number.isInteger(generations) || generations < 1) {
    throw new RangeError(`Generations must be an integer of at least 1, got ${generations}.`);
  }
  const trainer = createTrainer(input, environment);
  for (let g = 0; g < generations; g += 1) trainer.runGeneration();
  return trainer.record();
}
