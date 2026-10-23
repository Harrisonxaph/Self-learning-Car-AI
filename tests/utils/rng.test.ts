import { describe, expect, it } from 'vitest';
import { RNG_ALGORITHM, createRng } from '../../src/utils/rng';

const SAMPLES = 10_000;

function draw(seed: number, count: number): number[] {
  const rng = createRng(seed);
  return Array.from({ length: count }, () => rng.nextUint32());
}

function meanAndVariance(values: number[]) {
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return { mean, variance };
}

describe('createRng', () => {
  it('names the algorithm so experiment records can store it', () => {
    expect(RNG_ALGORITHM).toBe('sfc32-splitmix32-v1');
  });

  // Expected values come from an independent Python implementation of splitmix32 seeding plus sfc32
  // with 12 warm-up outputs. If these change, every recorded run changes: bump RNG_ALGORITHM.
  it.each([
    [0, [591558436, 2737234123, 107644106, 1338548054, 2499804003]],
    [1, [792534090, 3215351813, 160231488, 1151041103, 1990438114]],
    [42, [2476999517, 2284424721, 914527439, 3398404915, 1005869237]],
    [0xffffffff, [401775837, 815230463, 1635982147, 2773186149, 285779518]],
  ])('gives the pinned first values for seed %i', (seed, expected) => {
    expect(draw(seed, 5)).toEqual(expected);
  });

  it('gives the same sequence for the same seed', () => {
    expect(draw(12345, 1000)).toEqual(draw(12345, 1000));
  });

  it('gives different sequences for neighbouring seeds', () => {
    const first = draw(7, 100);
    const second = draw(8, 100);
    const matches = first.filter((value, i) => value === second[i]).length;
    expect(matches).toBe(0);
  });

  it('keeps separate generators independent of each other', () => {
    const a = createRng(5);
    const b = createRng(5);
    const fromA = [a.nextUint32(), a.nextUint32()];
    createRng(6).nextUint32();
    expect([b.nextUint32(), b.nextUint32()]).toEqual(fromA);
  });

  it.each([-1, 0x1_0000_0000, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects the seed %s', (seed) => {
    expect(() => createRng(seed)).toThrow(RangeError);
  });
});

describe('next and range', () => {
  it(`stays in [0, 1) with mean 0.5 and variance 1/12 over ${SAMPLES} samples`, () => {
    const rng = createRng(1);
    const values = Array.from({ length: SAMPLES }, () => rng.next());
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    const { mean, variance } = meanAndVariance(values);
    expect(mean).toBeCloseTo(0.5, 1);
    expect(variance).toBeCloseTo(1 / 12, 2);
  });

  it('maps into [min, max)', () => {
    const rng = createRng(2);
    for (let i = 0; i < SAMPLES; i += 1) {
      const value = rng.range(-3, 5);
      expect(value).toBeGreaterThanOrEqual(-3);
      expect(value).toBeLessThan(5);
    }
    expect(rng.range(4, 4)).toBe(4);
  });

  it.each([
    [1, 0],
    [0, Number.NaN],
    [Number.NEGATIVE_INFINITY, 0],
  ])('rejects range(%s, %s)', (min, max) => {
    expect(() => createRng(0).range(min, max)).toThrow(RangeError);
  });
});

describe('int and pick', () => {
  it('returns every value in [min, max) roughly equally, never max', () => {
    const rng = createRng(3);
    const counts = new Map<number, number>();
    for (let i = 0; i < 60_000; i += 1) {
      const value = rng.int(-2, 4);
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    expect([...counts.keys()].sort((x, y) => x - y)).toEqual([-2, -1, 0, 1, 2, 3]);
    for (const count of counts.values()) {
      // Expected 10,000 each; ±5% is far outside normal sampling noise (about ±1%).
      expect(count).toBeGreaterThan(9_500);
      expect(count).toBeLessThan(10_500);
    }
  });

  it('handles the full 32-bit span', () => {
    const value = createRng(4).int(0, 0x1_0000_0000);
    expect(Number.isInteger(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(0x1_0000_0000);
  });

  it.each([
    [0, 0],
    [3, 1],
    [0, 2.5],
    [0, 0x1_0000_0001],
  ])('rejects int(%s, %s)', (min, max) => {
    expect(() => createRng(0).int(min, max)).toThrow(RangeError);
  });

  it('picks only from the given items and reaches all of them', () => {
    const rng = createRng(5);
    const items = ['a', 'b', 'c'] as const;
    const seen = new Set(Array.from({ length: 300 }, () => rng.pick(items)));
    expect([...seen].sort()).toEqual(['a', 'b', 'c']);
  });

  it('refuses to pick from an empty array', () => {
    expect(() => createRng(0).pick([])).toThrow(RangeError);
  });
});

describe('gaussian', () => {
  it(`has mean 0 and variance 1 within tolerance over ${SAMPLES} samples`, () => {
    const rng = createRng(6);
    const values = Array.from({ length: SAMPLES }, () => rng.gaussian());
    expect(values.every(Number.isFinite)).toBe(true);
    const { mean, variance } = meanAndVariance(values);
    // Standard error of the mean is 0.01 and of the variance about 0.014 at 10k samples.
    expect(Math.abs(mean)).toBeLessThan(0.04);
    expect(Math.abs(variance - 1)).toBeLessThan(0.06);
  });

  it('applies the requested mean and standard deviation', () => {
    const rng = createRng(7);
    const values = Array.from({ length: SAMPLES }, () => rng.gaussian(10, 2));
    const { mean, variance } = meanAndVariance(values);
    expect(Math.abs(mean - 10)).toBeLessThan(0.08);
    expect(Math.abs(variance - 4)).toBeLessThan(0.24);
  });
});
