// Seeded pseudorandom numbers. All simulation, AI and evolution randomness comes from here, never Math.random,
// so the same seed and configuration give the same run.
//
// Algorithm: sfc32 (Chris Doty-Humphrey's Small Fast Chaotic generator, 128-bit state, passes PractRand),
// chosen over mulberry32 for its larger state and period. The 32-bit seed is expanded into the state with
// splitmix32, and the first 12 outputs are discarded so similar seeds start far apart.
// Changing any of this changes every recorded run, so bump RNG_ALGORITHM if it ever changes.

export const RNG_ALGORITHM = 'sfc32-splitmix32-v1';

const TWO_POW_32 = 0x1_0000_0000;
const WARM_UP_OUTPUTS = 12;

export interface Rng {
  /** A uniform 32-bit unsigned integer. */
  nextUint32(): number;
  /** A uniform float in [0, 1), with 32 bits of resolution. */
  next(): number;
  /** A uniform float in [min, max). */
  range(min: number, max: number): number;
  /** A uniform integer in [min, max): `max` is excluded. Unbiased. */
  int(min: number, max: number): number;
  /** A normally distributed float (Box–Muller transform). */
  gaussian(mean?: number, standardDeviation?: number): number;
  /** A uniformly chosen element of a non-empty array. */
  pick<T>(items: readonly T[]): T;
}

/** Expands a 32-bit seed into well-mixed 32-bit words. */
function splitmix32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x9e3779b9) | 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

/** Creates a generator from a seed: an integer from 0 to 4,294,967,295. */
export function createRng(seed: number): Rng {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError(`Seed must be an integer from 0 to 4294967295, got ${seed}.`);
  }
  const mix = splitmix32(seed);
  let a = mix() | 0;
  let b = mix() | 0;
  let c = mix() | 0;
  let counter = 1;

  const nextUint32 = (): number => {
    const t = (((a + b) | 0) + counter) | 0;
    counter = (counter + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  };
  for (let i = 0; i < WARM_UP_OUTPUTS; i += 1) nextUint32();

  const next = () => nextUint32() / TWO_POW_32;

  const int = (min: number, max: number): number => {
    const span = max - min;
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || span < 1 || span > TWO_POW_32) {
      throw new RangeError(`int(min, max) needs integers with 1 <= max - min <= 2^32, got ${min} and ${max}.`);
    }
    // Reject the top values that would make some results more likely than others.
    const limit = TWO_POW_32 - (TWO_POW_32 % span);
    let value = nextUint32();
    while (value >= limit) value = nextUint32();
    return min + (value % span);
  };

  return {
    nextUint32,
    next,
    range(min, max) {
      if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) {
        throw new RangeError(`range(min, max) needs finite numbers with min <= max, got ${min} and ${max}.`);
      }
      return min + next() * (max - min);
    },
    int,
    gaussian(mean = 0, standardDeviation = 1) {
      // 1 - next() is in (0, 1], so the logarithm is always finite.
      const radius = Math.sqrt(-2 * Math.log(1 - next()));
      return mean + standardDeviation * radius * Math.cos(2 * Math.PI * next());
    },
    pick(items) {
      if (items.length === 0) throw new RangeError('pick() needs a non-empty array.');
      return items[int(0, items.length)] as (typeof items)[number];
    },
  };
}
