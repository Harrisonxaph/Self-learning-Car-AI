// Gaussian mutation (P2-04). Each gene independently, with probability `rate`, has gaussian(0, scale) noise
// added. Rate 0 or scale 0 changes nothing.
import type { Rng } from '../utils/rng';
import type { Genome } from './genome';

/**
 * A mutated copy of `genome`; the input is never written. For each gene in order: one rng.next() draw decides
 * whether it mutates (draw < rate); if so, rng.gaussian(0, scale) is added. Throws RangeError if a mutated gene
 * overflows to ±Infinity.
 */
export function gaussianMutate(genome: ArrayLike<number>, rate: number, scale: number, rng: Rng): Genome {
  const child = Float64Array.from(genome);
  for (let i = 0; i < child.length; i += 1) {
    if (!(rng.next() < rate)) continue;
    const value = child[i]! + rng.gaussian(0, scale);
    if (!Number.isFinite(value)) throw new RangeError(`Mutating gene ${i} overflowed (${child[i]} + noise).`);
    child[i] = value;
  }
  return child;
}
