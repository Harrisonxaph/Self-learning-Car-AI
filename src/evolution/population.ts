// The next generation (P2-04): elitism, then tournament selection, uniform crossover and Gaussian mutation for
// every other place. Headless and pure apart from the generators passed in; it never reads the clock or the DOM,
// and never imports inference, training, persistence or rendering (eslint.config.js).
//
// Operator set `tournament-uniform-gaussian-v1`:
// 1. Rank by fitness (higher is better; ties go to the lower index).
// 2. Elitism: the top `eliteCount` genomes are copied unchanged, in rank order, into places 0 … E−1.
// 3. Each remaining place: parent A and parent B from two tournaments (selection generator), one child by
//    uniform crossover (crossover generator), then Gaussian mutation (mutation generator).
// Each operator has its own generator, so changing crossover or mutation settings never changes which parents
// are selected. Every returned genome is a new array; nothing passed in is written.
import { createRng, type Rng } from '../utils/rng';
import { uniformCrossover } from './crossover';
import { checkPopulation, copyGenome, type Genome } from './genome';
import { gaussianMutate } from './mutation';
import { checkFitness, rankByFitness, tournamentSelect } from './selection';

/** The operator set this module implements; experiments record it with their configuration (P2-07). */
export const EVOLUTION_OPERATORS = 'tournament-uniform-gaussian-v1';

/** Largest population accepted, a sanity bound against accidental huge allocations. */
export const MAX_POPULATION_SIZE = 100_000;

/** The evolution settings, named as in a saved model's `training.configuration` (docs/MODEL_FORMAT.md). */
export interface EvolutionConfig {
  readonly populationSize: number;
  readonly eliteCount: number;
  readonly selection: { readonly type: 'tournament'; readonly size: number };
  readonly crossover: { readonly type: 'uniform'; readonly rate: number };
  readonly mutation: { readonly rate: number; readonly scale: number };
}

/** One generator per operator. */
export interface EvolutionRngs {
  readonly selection: Rng;
  readonly crossover: Rng;
  readonly mutation: Rng;
}

export interface NextGeneration {
  /** populationSize new genomes: the elites first, in rank order, then the children. */
  readonly genomes: readonly Genome[];
  /** For each elite (places 0 … E−1), the index it was copied from. */
  readonly eliteSources: readonly number[];
  /** For each child (places E … N−1), the indices of its parents A and B. */
  readonly parents: readonly (readonly [number, number])[];
}

/**
 * Three generators for one generation, derived from `parent` with createRng(parent.nextUint32()) in the fixed
 * order selection, crossover, mutation. Advances `parent` by exactly three draws.
 */
export function createEvolutionRngs(parent: Rng): EvolutionRngs {
  const selection = createRng(parent.nextUint32());
  const crossover = createRng(parent.nextUint32());
  const mutation = createRng(parent.nextUint32());
  return { selection, crossover, mutation };
}

/**
 * Checks an evolution config and returns a frozen copy. Throws RangeError naming the field for: a population
 * size that is not an integer from 2 to MAX_POPULATION_SIZE; an elite count that is not an integer from 0 to the
 * population size; a tournament size that is not an integer from 1 to the population size; crossover or
 * mutation rates outside [0, 1]; a negative or non-finite mutation scale; an unknown operator type.
 */
export function resolveEvolutionConfig(input: unknown): EvolutionConfig {
  if (input === null || typeof input !== 'object') throw new RangeError('Evolution config must be an object.');
  const c = input as Record<string, unknown>;
  const object = (value: unknown, name: string): Record<string, unknown> => {
    if (value === null || typeof value !== 'object') throw new RangeError(`Evolution config "${name}" must be an object.`);
    return value as Record<string, unknown>;
  };
  const integer = (value: unknown, name: string, min: number, max: number): number => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      throw new RangeError(`Evolution config "${name}" must be an integer from ${min} to ${max}, got ${String(value)}.`);
    }
    return value;
  };
  const unit = (value: unknown, name: string): number => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new RangeError(`Evolution config "${name}" must be a number from 0 to 1, got ${String(value)}.`);
    }
    return value;
  };
  const populationSize = integer(c.populationSize, 'populationSize', 2, MAX_POPULATION_SIZE);
  const eliteCount = integer(c.eliteCount, 'eliteCount', 0, populationSize);
  const selection = object(c.selection, 'selection');
  if (selection.type !== 'tournament') throw new RangeError(`Evolution config "selection.type" must be "tournament", got ${String(selection.type)}.`);
  const tournamentSize = integer(selection.size, 'selection.size', 1, populationSize);
  const crossover = object(c.crossover, 'crossover');
  if (crossover.type !== 'uniform') throw new RangeError(`Evolution config "crossover.type" must be "uniform", got ${String(crossover.type)}.`);
  const crossoverRate = unit(crossover.rate, 'crossover.rate');
  const mutation = object(c.mutation, 'mutation');
  const mutationRate = unit(mutation.rate, 'mutation.rate');
  const scale = mutation.scale;
  if (typeof scale !== 'number' || !Number.isFinite(scale) || scale < 0) {
    throw new RangeError(`Evolution config "mutation.scale" must be a finite number of at least 0, got ${String(scale)}.`);
  }
  return Object.freeze({
    populationSize,
    eliteCount,
    selection: Object.freeze({ type: 'tournament' as const, size: tournamentSize }),
    crossover: Object.freeze({ type: 'uniform' as const, rate: crossoverRate }),
    mutation: Object.freeze({ rate: mutationRate, scale }),
  });
}

function checkRngs(rngs: EvolutionRngs): void {
  if (rngs === null || typeof rngs !== 'object') throw new RangeError('Evolution needs generators { selection, crossover, mutation }.');
  for (const name of ['selection', 'crossover', 'mutation'] as const) {
    const rng = rngs[name] as Partial<Rng> | undefined;
    if (!rng || typeof rng.int !== 'function' || typeof rng.next !== 'function' || typeof rng.gaussian !== 'function') {
      throw new RangeError(`Evolution needs a "${name}" generator.`);
    }
  }
}

/**
 * The next generation from `population` scored by `fitness` (one finite score per genome, higher is better).
 * Validates everything first (config, population, fitness, generators) and throws RangeError on any problem.
 * Same inputs and generator states always give the same result.
 */
export function nextGeneration(
  population: readonly ArrayLike<number>[],
  fitness: readonly number[],
  configInput: EvolutionConfig,
  rngs: EvolutionRngs,
): NextGeneration {
  const config = resolveEvolutionConfig(configInput);
  checkPopulation(population, config.populationSize);
  checkFitness(fitness, config.populationSize);
  checkRngs(rngs);

  const ranked = rankByFitness(fitness);
  const eliteSources = ranked.slice(0, config.eliteCount);
  const genomes: Genome[] = eliteSources.map((i) => copyGenome(population[i]!));
  const parents: [number, number][] = [];
  for (let place = config.eliteCount; place < config.populationSize; place += 1) {
    const a = tournamentSelect(fitness, config.selection.size, rngs.selection);
    const b = tournamentSelect(fitness, config.selection.size, rngs.selection);
    parents.push([a, b]);
    const child = uniformCrossover(population[a]!, population[b]!, config.crossover.rate, rngs.crossover);
    genomes.push(gaussianMutate(child, config.mutation.rate, config.mutation.scale, rngs.mutation));
  }
  return { genomes, eliteSources, parents };
}
