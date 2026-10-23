// Seeded pseudorandom numbers. All simulation, AI and evolution randomness comes from here, never Math.random,
// so the same seed and configuration give the same run.
//
// Algorithm: sfc32, Chris Doty-Humphrey's Small Fast Chaotic generator (128-bit state; reference implementation in
// PractRand, https://pracrand.sourceforge.net/), chosen over mulberry32 for its larger state and period.
// Seeding ("splitmix32" here): a Weyl sequence with step 0x9e3779b9 passed through MurmurHash3's fmix32 finaliser
// (constants 0x85ebca6b and 0xc2b2ae35) gives the three state words a, b and c; the counter starts at 1.
// The first 12 outputs are then discarded so similar seeds start far apart.
// Changing any of this changes every recorded run, so bump RNG_ALGORITHM if it ever changes.
//
// How to use it (see docs/ARCHITECTURE.md, "Randomness"):
// - Create generators from the recorded experiment seed; never keep one in a module-level variable.
// - Pass the generator into the code that needs it, so tests can supply their own.
// - Give each independent purpose its own generator (for example one for mutation, one for start positions),
//   seeded from a parent generator with nextUint32(), so adding draws in one place does not shift another.
// - Save getState() at checkpoints and continue with restoreRng(); do not re-seed mid-run.

export const RNG_ALGORITHM = 'sfc32-splitmix32-v1';

const TWO_POW_32 = 0x1_0000_0000;
const WARM_UP_OUTPUTS = 12;
const MAX_UINT32 = 0xffffffff;

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
  /** A copy of the internal state, plain JSON, for training checkpoints. */
  getState(): RngState;
}

/** Everything needed to continue a generator exactly where it stopped. */
export interface RngState {
  readonly algorithm: typeof RNG_ALGORITHM;
  /** sfc32's three state words and its counter, as unsigned 32-bit integers. */
  readonly words: readonly [number, number, number, number];
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

const isUint32 = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_UINT32;

/** Creates a generator from a seed: an integer from 0 to 4,294,967,295. */
export function createRng(seed: number): Rng {
  if (!isUint32(seed)) {
    throw new RangeError(`Seed must be an integer from 0 to 4294967295, got ${seed}.`);
  }
  const mix = splitmix32(seed);
  const rng = fromWords(mix(), mix(), mix(), 1);
  for (let i = 0; i < WARM_UP_OUTPUTS; i += 1) rng.nextUint32();
  return rng;
}

/**
 * Continues a generator from a state saved with getState(). The state is checked, because it may come from
 * an imported checkpoint file.
 */
export function restoreRng(state: RngState): Rng {
  const words: unknown = state?.words;
  // Check each index explicitly: every() would skip holes in a sparse array such as Array(4).
  const valid =
    state?.algorithm === RNG_ALGORITHM &&
    Array.isArray(words) &&
    words.length === 4 &&
    [0, 1, 2, 3].every((i) => isUint32(words[i]));
  if (!valid) throw new RangeError(`Not a valid ${RNG_ALGORITHM} generator state.`);
  const [a, b, c, counter] = words as [number, number, number, number];
  return fromWords(a, b, c, counter);
}

function fromWords(initialA: number, initialB: number, initialC: number, initialCounter: number): Rng {
  let a = initialA | 0;
  let b = initialB | 0;
  let c = initialC | 0;
  let counter = initialCounter | 0;

  const nextUint32 = (): number => {
    const t = (((a + b) | 0) + counter) | 0;
    counter = (counter + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  };

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
      // Check each bound before any arithmetic: subtraction would quietly turn "1" or null into a number,
      // and addition would then join strings. Number.isFinite rejects anything that is not a number.
      const span = max - min;
      // span is not finite when finite bounds overflow (e.g. -1e308 to 1e308).
      if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(span) || span < 0) {
        throw new RangeError(`range(min, max) needs finite numbers with min <= max, got ${min} and ${max}.`);
      }
      if (span === 0) return min;
      // At large magnitudes min + next() * span can round up to max; draw again so max is never returned.
      // A draw of 0 always gives min, so this ends.
      for (;;) {
        const value = min + next() * span;
        if (value < max) return value;
      }
    },
    int,
    gaussian(mean = 0, standardDeviation = 1) {
      if (!Number.isFinite(mean) || !Number.isFinite(standardDeviation) || standardDeviation < 0) {
        throw new RangeError(
          `gaussian(mean, sd) needs a finite mean and a finite sd >= 0, got ${mean} and ${standardDeviation}.`,
        );
      }
      // 1 - next() is in (0, 1], so the logarithm is always finite.
      const radius = Math.sqrt(-2 * Math.log(1 - next()));
      const value = mean + standardDeviation * radius * Math.cos(2 * Math.PI * next());
      // Only extreme inputs (near Number.MAX_VALUE) can overflow here.
      if (!Number.isFinite(value)) {
        throw new RangeError(`gaussian(${mean}, ${standardDeviation}) overflowed; use smaller values.`);
      }
      return value;
    },
    pick(items) {
      if (items.length === 0) throw new RangeError('pick() needs a non-empty array.');
      return items[int(0, items.length)] as (typeof items)[number];
    },
    getState() {
      return { algorithm: RNG_ALGORITHM, words: [a >>> 0, b >>> 0, c >>> 0, counter >>> 0] };
    },
  };
}
