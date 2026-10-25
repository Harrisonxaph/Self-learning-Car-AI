// Uniform crossover (P2-04). Every child gene is copied from the same position in one parent, so a child only
// ever contains its parents' genes. Parents are never written.
import type { Rng } from '../utils/rng';
import type { Genome } from './genome';

/**
 * One child of parents `a` and `b` (same length). With probability `rate` (one rng.next() draw) the child takes
 * each gene from a or b with probability ½ (one rng.next() draw per gene, a when the draw is below ½); otherwise
 * it is a copy of `a`. Always returns a new array.
 */
export function uniformCrossover(a: ArrayLike<number>, b: ArrayLike<number>, rate: number, rng: Rng): Genome {
  const child = Float64Array.from(a);
  if (!(rng.next() < rate)) return child;
  for (let i = 0; i < child.length; i += 1) {
    if (!(rng.next() < 0.5)) child[i] = b[i]!;
  }
  return child;
}
