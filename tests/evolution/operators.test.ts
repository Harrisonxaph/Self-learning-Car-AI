// The individual genetic operators (P2-04): ranking, tournament selection, uniform crossover and Gaussian
// mutation, on hand-made genomes and hand-scored fitness fixtures.
import { describe, expect, it } from 'vitest';
import { uniformCrossover } from '../../src/evolution/crossover';
import { checkGenome, checkPopulation, copyGenome } from '../../src/evolution/genome';
import { gaussianMutate } from '../../src/evolution/mutation';
import { checkFitness, rankByFitness, tournamentSelect } from '../../src/evolution/selection';
import { createRng, restoreRng, type Rng } from '../../src/utils/rng';

/** A copy of a generator that continues from the same state, to replay its draws independently. */
const clone = (rng: Rng) => restoreRng(rng.getState());
const ramp = (n: number, offset = 0) => Float64Array.from({ length: n }, (_, i) => i + offset);

describe('genomes', () => {
  it('copyGenome returns a new Float64Array with the same genes', () => {
    const source = [1.5, -2, 3];
    const copy = copyGenome(source);
    expect(copy).toBeInstanceOf(Float64Array);
    expect([...copy]).toEqual(source);
    copy[0] = 99;
    expect(source[0]).toBe(1.5);
  });

  it('checkPopulation accepts equal-length finite genomes and returns their length', () => {
    expect(checkPopulation([ramp(4), [1, 2, 3, 4], new Float64Array(4)], 3)).toBe(4);
  });

  it.each([
    ['too few genomes', [ramp(3)], 2, /2 genomes/],
    ['not an array', 'abc', 1, /array of genomes/],
    ['an empty first genome', [new Float64Array(0), new Float64Array(0)], 2, /at least one gene/],
    ['a first genome that is not an array', [null, ramp(3)], 2, /at least one gene/],
    ['genomes of different lengths', [ramp(3), ramp(4)], 2, /Population\[1\] must have 3 genes/],
    ['a NaN gene', [ramp(3), [0, NaN, 0]], 2, /Population\[1\]\[1\]/],
    ['an infinite gene', [[Infinity, 0, 0], ramp(3)], 2, /Population\[0\]\[0\]/],
    ['a non-number gene', [ramp(3), [0, '1', 0]], 2, /Population\[1\]\[1\]/],
    ['a missing genome', [ramp(3), undefined], 2, /Population\[1\] must be an array/],
    ['a hole in a sparse population', Object.assign(new Array(3), { 0: ramp(3), 2: ramp(3) }), 3, /Population\[1\] must be an array/],
  ])('checkPopulation rejects %s', (_name, population, size, message) => {
    expect(() => checkPopulation(population as unknown as number[][], size)).toThrow(RangeError);
    expect(() => checkPopulation(population as unknown as number[][], size)).toThrow(message);
  });

  it('checkGenome checks length and finiteness', () => {
    expect(() => checkGenome([1, 2], 2)).not.toThrow();
    expect(() => checkGenome([1, 2], 3)).toThrow(RangeError);
    expect(() => checkGenome([1, -Infinity], 2)).toThrow(RangeError);
  });
});

describe('fitness and ranking', () => {
  it('ranks from best to worst, ties going to the lower index', () => {
    expect(rankByFitness([3, 9, 1, 9, 5])).toEqual([1, 3, 4, 0, 2]);
    expect(rankByFitness([0, 0, 0])).toEqual([0, 1, 2]);
    expect(rankByFitness([-1, -5, 2])).toEqual([2, 0, 1]);
  });

  it.each([
    ['too few scores', [1, 2], 3, /one score per genome/],
    ['too many scores', [1, 2, 3, 4], 3, /one score per genome/],
    ['NaN', [1, NaN, 3], 3, /Fitness\[1\]/],
    ['Infinity', [Infinity, 2, 3], 3, /Fitness\[0\]/],
    ['−Infinity', [1, 2, -Infinity], 3, /Fitness\[2\]/],
    ['a string', [1, '2', 3], 3, /Fitness\[1\]/],
    ['not an array', 'abc', 3, /array of numbers/],
    // Sparse arrays: forEach would skip these holes.
    ['a missing score (sparse array)', Object.assign(new Array(3), { 0: 10, 2: 5 }), 3, /Fitness\[1\] .* got undefined/],
    ['no scores at all (new Array(3))', new Array(3), 3, /Fitness\[0\]/],
  ])('rejects fitness with %s', (_name, fitness, size, message) => {
    expect(() => checkFitness(fitness as unknown as number[], size)).toThrow(RangeError);
    expect(() => checkFitness(fitness as unknown as number[], size)).toThrow(message);
  });
});

describe('tournament selection', () => {
  const fitness = [4, 10, 2, 10, 7, 0, 3, 8];

  it('returns the fittest of exactly `size` uniform draws with replacement (replayed on a cloned generator)', () => {
    const rng = createRng(1501);
    for (let n = 0; n < 500; n += 1) {
      const size = 1 + (n % 5);
      const replay = clone(rng);
      const drawn = Array.from({ length: size }, () => replay.int(0, fitness.length));
      const expected = drawn.reduce((best, i) => (fitness[i]! > fitness[best]! || (fitness[i] === fitness[best] && i < best) ? i : best));
      expect(tournamentSelect(fitness, size, rng)).toBe(expected);
      // It used exactly `size` draws: both generators are now in the same state.
      expect(rng.getState()).toEqual(replay.getState());
    }
  });

  it('size 1 selects uniformly; size equal to a large population almost always finds the best', () => {
    const rng = createRng(1502);
    const counts = new Array<number>(8).fill(0);
    for (let n = 0; n < 16_000; n += 1) counts[tournamentSelect(fitness, 1, rng)]! += 1;
    for (const count of counts) expect(Math.abs(count - 2000)).toBeLessThan(250); // ±~6 sd
    // Size 40 on 8 genomes: missing both best genomes (1 and 3) has probability (6/8)^40 ≈ 1e-5.
    for (let n = 0; n < 200; n += 1) expect(tournamentSelect(fitness, 40, rng)).toBe(1);
  });

  it('larger tournaments favour fitter genomes', () => {
    const meanFitness = (size: number) => {
      const rng = createRng(1503);
      let sum = 0;
      for (let n = 0; n < 4000; n += 1) sum += fitness[tournamentSelect(fitness, size, rng)]!;
      return sum / 4000;
    };
    const [one, two, three, five] = [meanFitness(1), meanFitness(2), meanFitness(3), meanFitness(5)];
    expect(one).toBeLessThan(two);
    expect(two).toBeLessThan(three);
    expect(three).toBeLessThan(five);
  });

  it('breaks ties by the lower index', () => {
    // Genomes 1 and 3 both score 10. Whenever both are drawn, 1 wins; 3 wins only when 1 was not drawn.
    const rng = createRng(1504);
    let bothDrawn = 0;
    for (let n = 0; n < 2000; n += 1) {
      const replay = clone(rng);
      const drawn = Array.from({ length: 4 }, () => replay.int(0, fitness.length));
      const winner = tournamentSelect(fitness, 4, rng);
      if (drawn.includes(1) && drawn.includes(3)) {
        bothDrawn += 1;
        expect(winner).toBe(1);
      }
      if (winner === 3) expect(drawn.includes(1)).toBe(false);
    }
    expect(bothDrawn).toBeGreaterThan(50);
  });
});

describe('uniform crossover', () => {
  const a = ramp(200, 0); // 0, 1, 2, …
  const b = ramp(200, 1000); // 1000, 1001, …

  it('every child gene comes from parent a or parent b at the same position', () => {
    const rng = createRng(1505);
    for (let n = 0; n < 50; n += 1) {
      const child = uniformCrossover(a, b, 0.7, rng);
      child.forEach((gene, i) => expect(gene === a[i] || gene === b[i]).toBe(true));
    }
  });

  it('rate 0 gives an exact copy of parent a, as a new array', () => {
    const rng = createRng(1506);
    const child = uniformCrossover(a, b, 0, rng);
    expect(child).toEqual(a);
    expect(child).not.toBe(a);
  });

  it('rate 1 always mixes: about half the genes from each parent', () => {
    const rng = createRng(1507);
    let fromB = 0;
    for (let n = 0; n < 50; n += 1) {
      const child = uniformCrossover(a, b, 1, rng);
      child.forEach((gene, i) => (fromB += gene === b[i] ? 1 : 0));
    }
    // 10,000 fair coin flips: mean 5000, sd 50.
    expect(Math.abs(fromB - 5000)).toBeLessThan(300);
  });

  it('crosses with probability `rate` per child, and takes a gene from a exactly when its draw is below ½', () => {
    const rng = createRng(1508);
    let crossed = 0;
    for (let n = 0; n < 4000; n += 1) {
      const replay = clone(rng);
      const child = uniformCrossover(a, b, 0.3, rng);
      if (replay.next() < 0.3) {
        crossed += 1;
        child.forEach((gene, i) => expect(gene).toBe(replay.next() < 0.5 ? a[i] : b[i]));
      } else {
        expect(child).toEqual(a);
      }
      expect(rng.getState()).toEqual(replay.getState());
    }
    expect(Math.abs(crossed / 4000 - 0.3)).toBeLessThan(0.04);
  });

  it('never writes either parent', () => {
    const pa = ramp(10);
    const pb = ramp(10, 50);
    uniformCrossover(pa, pb, 1, createRng(1509));
    expect(pa).toEqual(ramp(10));
    expect(pb).toEqual(ramp(10, 50));
  });
});

describe('Gaussian mutation', () => {
  const genome = ramp(500);

  it('rate 0 is the identity (a new, equal array)', () => {
    const out = gaussianMutate(genome, 0, 5, createRng(1510));
    expect(out).toEqual(genome);
    expect(out).not.toBe(genome);
  });

  it('scale 0 is the identity even at rate 1', () => {
    expect(gaussianMutate(genome, 1, 0, createRng(1511))).toEqual(genome);
  });

  it('rate 1 with a positive scale changes every gene', () => {
    const out = gaussianMutate(genome, 1, 0.2, createRng(1512));
    out.forEach((gene, i) => expect(gene).not.toBe(genome[i]));
  });

  it('mutates about `rate` of the genes, with noise of mean 0 and standard deviation `scale`', () => {
    const rng = createRng(1513);
    const deltas: number[] = [];
    let total = 0;
    for (let n = 0; n < 40; n += 1) {
      const out = gaussianMutate(genome, 0.1, 0.2, rng);
      out.forEach((gene, i) => {
        total += 1;
        if (gene !== genome[i]) deltas.push(gene - genome[i]!);
      });
    }
    // 20,000 genes at rate 0.1: about 2000 mutations (sd ≈ 42).
    expect(Math.abs(deltas.length / total - 0.1)).toBeLessThan(0.01);
    const mean = deltas.reduce((s, d) => s + d, 0) / deltas.length;
    const sd = Math.sqrt(deltas.reduce((s, d) => s + (d - mean) ** 2, 0) / deltas.length);
    expect(Math.abs(mean)).toBeLessThan(0.02);
    expect(Math.abs(sd - 0.2)).toBeLessThan(0.015);
  });

  it('draws one next() per gene and a gaussian only for mutated genes (replayed on a cloned generator)', () => {
    const rng = createRng(1514);
    const replay = clone(rng);
    const out = gaussianMutate(ramp(30), 0.4, 1, rng);
    ramp(30).forEach((gene, i) => {
      const expected = replay.next() < 0.4 ? gene + replay.gaussian(0, 1) : gene;
      expect(out[i]).toBe(expected);
    });
    expect(rng.getState()).toEqual(replay.getState());
  });

  it('never writes its input, and throws rather than returning an overflowed gene', () => {
    const input = ramp(5);
    gaussianMutate(input, 1, 1, createRng(1515));
    expect(input).toEqual(ramp(5));
    expect(() => gaussianMutate([Number.MAX_VALUE], 1, 1e308, createRng(1516))).toThrow(/overflowed/);
  });
});
