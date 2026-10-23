import { describe, expect, it } from 'vitest';
import { RNG_ALGORITHM, createRng, restoreRng, type RngState } from '../../src/utils/rng';

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

  it('accepts both ends of the seed range, 0 and 4294967295, as different seeds', () => {
    expect(draw(0, 5)).not.toEqual(draw(0xffffffff, 5));
  });

  it.each([-1, 0x1_0000_0000, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects the seed %s', (seed) => {
    expect(() => createRng(seed)).toThrow(RangeError);
  });

  it('rejects a seed that is not a number at runtime, for example from untrusted JSON', () => {
    expect(() => createRng('42' as unknown as number)).toThrow(RangeError);
  });

  it('does not let one generator change another, however they are interleaved', () => {
    const alone = draw(9, 50);
    const shared = createRng(9);
    const other = createRng(9);
    const interleaved: number[] = [];
    for (let i = 0; i < 50; i += 1) {
      interleaved.push(shared.nextUint32());
      // Draws from a second generator with the same seed, and from methods that consume several values.
      other.gaussian();
      other.int(0, 7);
    }
    expect(interleaved).toEqual(alone);
  });

  it('gives finite numbers from every method', () => {
    const rng = createRng(10);
    for (let i = 0; i < 2000; i += 1) {
      const values = [rng.nextUint32(), rng.next(), rng.range(-5, 5), rng.int(-100, 100), rng.gaussian(), rng.gaussian(3, 0)];
      expect(values.every(Number.isFinite)).toBe(true);
    }
    expect(Number.isInteger(createRng(10).nextUint32())).toBe(true);
  });
});

describe('getState and restoreRng', () => {
  it('continues exactly where the saved generator stopped', () => {
    const original = createRng(11);
    for (let i = 0; i < 37; i += 1) original.next();
    const saved = original.getState();
    const continued = restoreRng(saved);
    expect(Array.from({ length: 100 }, () => continued.nextUint32())).toEqual(
      Array.from({ length: 100 }, () => original.nextUint32()),
    );
  });

  it('survives a JSON round trip, as a checkpoint file would', () => {
    const original = createRng(12);
    original.gaussian();
    const saved = JSON.parse(JSON.stringify(original.getState())) as RngState;
    expect(saved.algorithm).toBe(RNG_ALGORITHM);
    const continued = restoreRng(saved);
    expect([continued.next(), continued.int(0, 1000)]).toEqual([original.next(), original.int(0, 1000)]);
  });

  it('returns a copy, so later draws do not change a saved state', () => {
    const rng = createRng(13);
    const saved = rng.getState();
    const before = JSON.stringify(saved);
    rng.nextUint32();
    expect(JSON.stringify(saved)).toBe(before);
    expect(rng.getState()).not.toEqual(saved);
  });

  it('keeps the restored generator independent of the original', () => {
    const original = createRng(14);
    const copy = restoreRng(original.getState());
    original.nextUint32();
    original.nextUint32();
    expect(copy.nextUint32()).toBe(draw(14, 1)[0]);
  });

  it.each([
    ['a different algorithm', { algorithm: 'mulberry32-v1', words: [1, 2, 3, 4] }],
    ['too few words', { algorithm: RNG_ALGORITHM, words: [1, 2, 3] }],
    ['a negative word', { algorithm: RNG_ALGORITHM, words: [1, 2, 3, -4] }],
    ['a word above 32 bits', { algorithm: RNG_ALGORITHM, words: [1, 2, 0x1_0000_0000, 4] }],
    ['a fractional word', { algorithm: RNG_ALGORITHM, words: [1, 2.5, 3, 4] }],
    ['a string word', { algorithm: RNG_ALGORITHM, words: [1, '2', 3, 4] }],
    ['missing words', { algorithm: RNG_ALGORITHM }],
    ['null', null],
  ])('rejects a state with %s', (_label, state) => {
    expect(() => restoreRng(state as unknown as RngState)).toThrow(RangeError);
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

  it('never returns max, even where rounding would reach it at large magnitudes', () => {
    // Doubles near 1e16 are 2 apart, so without a redraw about half of these results round up to max.
    const rng = createRng(8);
    for (let i = 0; i < 1000; i += 1) {
      expect(rng.range(1e16, 1e16 + 2)).toBe(1e16);
    }
  });

  it.each([
    [1, 0],
    [0, Number.NaN],
    [Number.NEGATIVE_INFINITY, 0],
    // Finite bounds whose difference overflows to Infinity.
    [-1e308, 1e308],
    [-Number.MAX_VALUE, Number.MAX_VALUE],
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

  it.each([
    [Number.NaN, 1],
    [0, Number.POSITIVE_INFINITY],
    [0, -1],
  ])('rejects gaussian(%s, %s)', (mean, sd) => {
    expect(() => createRng(0).gaussian(mean, sd)).toThrow(RangeError);
  });

  it('reports overflow instead of returning Infinity for extreme inputs', () => {
    expect(() => {
      const rng = createRng(0);
      for (let i = 0; i < 100; i += 1) rng.gaussian(Number.MAX_VALUE, Number.MAX_VALUE);
    }).toThrow(RangeError);
  });

  it('applies the requested mean and standard deviation', () => {
    const rng = createRng(7);
    const values = Array.from({ length: SAMPLES }, () => rng.gaussian(10, 2));
    const { mean, variance } = meanAndVariance(values);
    expect(Math.abs(mean - 10)).toBeLessThan(0.08);
    expect(Math.abs(variance - 4)).toBeLessThan(0.24);
  });
});
