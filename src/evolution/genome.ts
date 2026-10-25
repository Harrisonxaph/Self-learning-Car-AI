// Flat genomes (P2-04): one array of finite numbers per individual. Evolution never looks inside a genome; for
// the driving network a genome is its 159 parameters in the documented order (ai/network.ts), but the operators
// work on any length, so they never depend on the network's layout.

/** A genome produced by evolution: always a new array that the caller owns. */
export type Genome = Float64Array;

/** Throws RangeError unless `genome` is array-like with `length` finite numbers. */
export function checkGenome(genome: ArrayLike<number>, length: number, what = 'Genome'): void {
  if (genome === null || typeof genome !== 'object' || typeof genome.length !== 'number') {
    throw new RangeError(`${what} must be an array of numbers.`);
  }
  if (genome.length !== length) throw new RangeError(`${what} must have ${length} genes, got ${genome.length}.`);
  for (let i = 0; i < length; i += 1) {
    const gene: unknown = genome[i];
    if (typeof gene !== 'number' || !Number.isFinite(gene)) {
      throw new RangeError(`${what}[${i}] must be a finite number, got ${String(gene)}.`);
    }
  }
}

/**
 * Checks a population: `size` genomes, all the same length (at least 1), every gene finite. Returns that
 * length. Throws RangeError naming the first problem.
 */
export function checkPopulation(population: readonly ArrayLike<number>[], size: number): number {
  if (!Array.isArray(population)) throw new RangeError('Population must be an array of genomes.');
  if (population.length !== size) throw new RangeError(`Population must have ${size} genomes, got ${population.length}.`);
  const first: unknown = population[0];
  const length = first !== null && typeof first === 'object' ? (first as ArrayLike<number>).length : undefined;
  if (typeof length !== 'number' || !Number.isInteger(length) || length < 1) {
    throw new RangeError('Population[0] must be a genome with at least one gene.');
  }
  population.forEach((genome, i) => checkGenome(genome, length, `Population[${i}]`));
  return length;
}

/** A new Float64Array with the same genes. */
export function copyGenome(genome: ArrayLike<number>): Genome {
  return Float64Array.from(genome);
}
