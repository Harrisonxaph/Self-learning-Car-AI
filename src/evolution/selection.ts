// Fitness ranking and tournament selection (P2-04). Higher fitness is better; equal fitness goes to the lower
// index, so every result is fully determined by the inputs and the generator.
import type { Rng } from '../utils/rng';

/** Throws RangeError unless `fitness` has `size` finite numbers. */
export function checkFitness(fitness: readonly number[], size: number): void {
  if (!Array.isArray(fitness)) throw new RangeError('Fitness must be an array of numbers.');
  if (fitness.length !== size) throw new RangeError(`Fitness must have one score per genome (${size}), got ${fitness.length}.`);
  // An index loop, not forEach: forEach skips the holes in a sparse array, which would let missing scores through.
  for (let i = 0; i < size; i += 1) {
    const score: unknown = fitness[i];
    if (typeof score !== 'number' || !Number.isFinite(score)) {
      throw new RangeError(`Fitness[${i}] must be a finite number, got ${String(score)}.`);
    }
  }
}

/** Is genome a better than genome b? Higher fitness first; on a tie, the lower index. */
function better(fitness: readonly number[], a: number, b: number): boolean {
  return fitness[a]! > fitness[b]! || (fitness[a] === fitness[b] && a < b);
}

/** Indices from best to worst: fitness descending, ties by lower index. */
export function rankByFitness(fitness: readonly number[]): number[] {
  return fitness.map((_, i) => i).sort((a, b) => (better(fitness, a, b) ? -1 : better(fitness, b, a) ? 1 : 0));
}

/**
 * Tournament selection: draws `size` indices uniformly with replacement (rng.int(0, n)) and returns the best
 * of them. Size 1 picks uniformly at random; larger sizes favour fitter genomes. Uses exactly `size` int draws.
 * The caller validates fitness and size (population.ts).
 */
export function tournamentSelect(fitness: readonly number[], size: number, rng: Rng): number {
  let winner = rng.int(0, fitness.length);
  for (let i = 1; i < size; i += 1) {
    const challenger = rng.int(0, fitness.length);
    if (better(fitness, challenger, winner)) winner = challenger;
  }
  return winner;
}
