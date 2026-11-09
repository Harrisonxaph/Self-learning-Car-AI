// The population training loop (P2-05): evaluates every genome as its own neural car on one track, records
// per-generation statistics, and builds the next generation. Headless: it never draws or touches the DOM, so
// the same code runs in Node (tests, `npm run demo:train`) and, one tick at a time, under the page's frame loop.
//
// One simulation path. Each running car, each fixed tick, goes through stepEpisode (training/episodeStep.ts),
// which the headless driver evaluation shares:
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
import { INPUT_CONTRACT } from '../ai/inputs';
import { INITIALISATION, initialParameters, PARAMETER_COUNT, PARAMETER_ORDER, runNetwork } from '../ai/network';
import { OUTPUT_CONTRACT } from '../ai/outputs';
import { createEvolutionRngs, EVOLUTION_OPERATORS, nextGeneration, resolveEvolutionConfig, type EvolutionConfig } from '../evolution/population';
import { rankByFitness } from '../evolution/selection';
import { DEFAULT_SENSOR_CONFIG, type SensorConfig } from '../sensors/rays';
import type { Racer } from '../sim/checkpoints';
import type { VehiclePhysics } from '../sim/config';
import type { Track } from '../sim/track';
import { createRng, restoreRng, RNG_ALGORITHM, type Rng, type RngState } from '../utils/rng';
import { startEpisodeState, stepEpisode } from './episodeStep';
import { assertTrainingTrack, trackContentHash } from './trackSplits';
import {
  DEFAULT_EPISODE_LIMITS,
  DEFAULT_FITNESS_CONFIG,
  FITNESS_VERSION,
  resolveEpisodeRules,
  resolveFitnessConfig,
  scoreEpisode,
  type Episode,
  type EpisodeLimits,
  type EpisodeOutcome,
  type EpisodeRules,
  type FitnessConfig,
} from './fitness';

/**
 * The layout of the trainer's random streams (see "Randomness" above), recorded with every run. Change it whenever
 * the order or number of draws changes.
 */
export const RNG_STREAMS = 'trainer-run-initial-then-3-per-transition-v1';

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
  /** RNG_STREAMS: how the run generator's draws are used. */
  readonly rngStreams: string;
  readonly evolutionOperators: string;
  readonly initialisation: string;
  readonly parameterOrder: string;
  readonly inputContract: string;
  readonly outputContract: string;
  readonly fitnessVersion: number;
  readonly trackId: string;
  readonly trackVersion: string;
  /** The track's content hash (training/trackSplits.ts), so a run names exactly the geometry it trained on. */
  readonly trackHash: string;
  /** 'training' for a built-in training track; 'unregistered' for a track outside the split manifest. */
  readonly trackSplit: 'training' | 'unregistered';
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

/**
 * Everything needed to describe and reproduce a run so far: configuration, the physics and timestep the cars
 * drove with, the sensor layout, version references and per-generation statistics.
 */
export interface TrainingRecord {
  readonly config: TrainingConfig;
  readonly versions: TrainingVersions;
  /** A copy of the vehicle physics every car used. */
  readonly physics: VehiclePhysics;
  readonly timestepSeconds: number;
  readonly sensors: SensorConfig;
  /**
   * The complete `GenerationStats` of every generation this record holds in full: all of them for a run started fresh, and
   * only the retained ones after a resume from a checkpoint (P3-07). Use `complete` before treating it as the whole run.
   */
  readonly generations: readonly GenerationStats[];
  /** Every completed generation in order, each either full or compact (P3-07), so nothing is silently missing. */
  readonly history: readonly HistoryEntry[];
  /** True when every generation in `history` is held in full (a run that was never restored from a compact checkpoint). */
  readonly complete: boolean;
}

/**
 * A completed generation whose per-car fitness list and champion genome were not kept (P3-07). Only what the graph and
 * the dashboard read remains; nothing is reconstructed or invented, and `retained: false` says so.
 */
export interface CompactGenerationStats {
  readonly retained: false;
  readonly generation: number;
  readonly populationSize: number;
  readonly bestFitness: number;
  readonly meanFitness: number;
  readonly worstFitness: number;
  readonly outcomes: Readonly<Record<EpisodeOutcome, number>>;
  readonly carsWithLap: number;
  readonly maxGatesPassed: number;
  readonly generationTicks: number;
  readonly totalEpisodeTicks: number;
}

/** One completed generation: its full statistics, or the compact form when the champion was not kept. */
export type HistoryEntry = { readonly retained: true; readonly stats: GenerationStats } | CompactGenerationStats;

/** The compact form of a generation's statistics. */
export function compactOf(stats: GenerationStats): CompactGenerationStats {
  return Object.freeze({
    retained: false as const,
    generation: stats.generation,
    populationSize: stats.fitness.length,
    bestFitness: stats.bestFitness,
    meanFitness: stats.meanFitness,
    worstFitness: stats.worstFitness,
    outcomes: Object.freeze({ ...stats.outcomes }),
    carsWithLap: stats.carsWithLap,
    maxGatesPassed: stats.maxGatesPassed,
    generationTicks: stats.generationTicks,
    totalEpisodeTicks: stats.totalEpisodeTicks,
  });
}

/** Generations whose champion is kept in a checkpoint besides the best so far (the P3-07 default). */
export const DEFAULT_RETAINED_GENERATIONS = 20;

/**
 * What a checkpoint keeps in full: the last `keepLast` generations and the best so far (highest best fitness; the earliest
 * on a tie). Every other generation becomes compact. Entries already compact stay compact; none is ever made full again.
 */
export function retainHistory(entries: readonly HistoryEntry[], keepLast: number = DEFAULT_RETAINED_GENERATIONS): HistoryEntry[] {
  if (!Number.isInteger(keepLast) || keepLast < 0) throw new RangeError(`keepLast must be an integer of at least 0, got ${keepLast}.`);
  let best = -1;
  for (let i = 0; i < entries.length; i += 1) {
    if (best < 0 || bestOf(entries[i]!) > bestOf(entries[best]!)) best = i;
  }
  const firstKept = entries.length - keepLast;
  return entries.map((entry, i) => (!entry.retained ? entry : i >= firstKept || i === best ? entry : compactOf(entry.stats)));
}

const bestOf = (entry: HistoryEntry): number => (entry.retained ? entry.stats.bestFitness : entry.bestFitness);

/**
 * The trainer's state at the start of its current generation, which is a generation boundary: everything the rest of the
 * run depends on. `genomes` are the current population (copies), `runState` is the run generator's state (the only random
 * state that persists between generations: the per-transition generators are derived from it afresh, and nothing caches a
 * draw), and `history` holds the completed generations.
 */
export interface TrainerState {
  readonly generationIndex: number;
  readonly genomes: readonly Float64Array[];
  readonly runState: RngState;
  readonly history: readonly HistoryEntry[];
}

/** Where to resume a run: a `TrainerState`, normally read back from a checkpoint (so it is checked in full). */
export type TrainerResume = TrainerState;

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
  /** The state at the start of the current generation (a copy), for a checkpoint. Valid at any time. */
  checkpointState(): TrainerState;
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
  // P2-10: never train on a validation or held-out track, even under another ID (TrackLeakageError).
  const trackSplit = assertTrainingTrack(environment.track);
  return Object.freeze({
    config,
    environment: Object.freeze({ ...environment }),
    sensors: DEFAULT_SENSOR_CONFIG,
    rules,
    versions: Object.freeze({
      rngAlgorithm: RNG_ALGORITHM,
      rngStreams: RNG_STREAMS,
      evolutionOperators: EVOLUTION_OPERATORS,
      initialisation: INITIALISATION.id,
      parameterOrder: PARAMETER_ORDER,
      inputContract: INPUT_CONTRACT,
      outputContract: OUTPUT_CONTRACT,
      fitnessVersion: FITNESS_VERSION,
      trackId: environment.track.id,
      trackVersion: environment.track.version,
      trackHash: trackContentHash(environment.track),
      trackSplit,
    }),
  });
}

/** A fresh car for `genome`: the track's start pose at rest, uncrashed, with fresh lap progress and episode. */
export function startCar(genome: Float64Array, setup: TrainingSetup): TrainingCar {
  return { genome, ...startEpisodeState(setup) };
}

/**
 * One fixed tick for one car: inputs, network, physics with collision and gates, then episode termination. A car
 * whose episode has ended is returned unchanged. Pure: reads only the car and the setup.
 */
export function stepCar(car: TrainingCar, setup: TrainingSetup): TrainingCar {
  if (car.episode.outcome !== null) return car;
  const { genome } = car;
  const brake = { brakeEnabled: setup.config.brakeEnabled };
  const { racer, episode } = stepEpisode(car, (inputs) => runNetwork(genome, inputs, brake), setup);
  return { genome, racer, episode };
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
 * The trainer's random streams for a seed (RNG_STREAMS): `run = createRng(seed)`, and `initial`, seeded with run's
 * first draw, which fills generation 0 in index order. The only place these streams are derived, so anything that
 * must pair with a run's generation 0 (P2-08's A8 random search) uses exactly the trainer's draws. Each call returns
 * fresh generators, shared with nobody.
 */
export function trainerStreams(seed: number): { readonly run: Rng; readonly initial: Rng } {
  const run = createRng(seed);
  const initial = createRng(run.nextUint32());
  return { run, initial };
}

/**
 * Creates a trainer and starts generation 0. Validates the configuration (RangeError on anything invalid), then
 * seeds the initial population from the run generator.
 */
export function createTrainer(input: unknown, environment: TrainingEnvironment, resume?: TrainerResume): Trainer {
  const setup = createTrainingSetup(input, environment);
  let run: Rng;
  let current: Generation;
  const history: HistoryEntry[] = [];
  if (resume !== undefined) {
    checkResume(resume, setup);
    run = restoreRng(resume.runState);
    history.push(...resume.history);
    current = startGeneration(resume.generationIndex, resume.genomes.map((genome) => Float64Array.from(genome)), setup);
  } else {
    const streams = trainerStreams(setup.config.seed);
    run = streams.run;
    const genomes = Array.from({ length: setup.config.populationSize }, () => initialParameters(streams.initial));
    if (genomes[0]!.length !== PARAMETER_COUNT) throw new RangeError('Initial genomes do not match the network.');
    current = startGeneration(0, genomes, setup);
  }
  let finished: Generation | null = null;

  const finish = (): GenerationStats => {
    const stats = generationStats(current, setup);
    history.push({ retained: true, stats });
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
        physics: Object.freeze({ ...setup.environment.physics }),
        timestepSeconds: setup.environment.timestepSeconds,
        sensors: setup.sensors,
        generations: Object.freeze(history.flatMap((entry) => (entry.retained ? [entry.stats] : []))),
        history: Object.freeze([...history]),
        complete: history.every((entry) => entry.retained),
      }),
    checkpointState: () => ({
      generationIndex: current.index,
      genomes: current.cars.map((car) => Float64Array.from(car.genome)),
      runState: run.getState(),
      history: [...history],
    }),
  };
}

/** Checks a resume state against the setup it will run under. Throws RangeError naming the problem. */
function checkResume(resume: TrainerResume, setup: TrainingSetup): void {
  const { populationSize } = setup.config;
  if (!resume || typeof resume !== 'object') throw new RangeError('Resume state must be an object.');
  if (!Number.isInteger(resume.generationIndex) || resume.generationIndex < 0) throw new RangeError(`Resume generation index must be an integer of at least 0, got ${String(resume.generationIndex)}.`);
  if (!Array.isArray(resume.history) || resume.history.length !== resume.generationIndex) throw new RangeError('Resume history must hold exactly one entry per completed generation.');
  resume.history.forEach((entry, i) => {
    const generation = entry?.retained ? entry.stats?.generation : (entry as CompactGenerationStats | undefined)?.generation;
    if (generation !== i) throw new RangeError(`Resume history entry ${i} is for generation ${String(generation)}.`);
  });
  if (!Array.isArray(resume.genomes) || resume.genomes.length !== populationSize) throw new RangeError(`Resume population must hold ${populationSize} genomes.`);
  resume.genomes.forEach((genome, i) => {
    if (!(genome instanceof Float64Array) || genome.length !== PARAMETER_COUNT || !genome.every(Number.isFinite)) throw new RangeError(`Resume genome ${i} must be ${PARAMETER_COUNT} finite numbers.`);
  });
  restoreRng(resume.runState);
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
