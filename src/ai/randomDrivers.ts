// Seeded random-action baselines for P2-08 (AI_EVALUATION.md §2): A1 draws a new action every tick, and A7 holds
// each action for a fixed number of ticks (30 = 0.5 s at 1/60 s) before drawing the next. They ignore what the
// car sees, so they set a floor for "random driving" without any network.
//
// Generator ownership: each driver creates its own generator from its seed and never exposes or accepts one, so
// two drivers never share a stream and a driver never draws from a trainer's streams. reset() restarts that
// generator from the seed, so a reset driver repeats exactly the actions a fresh one would take.
//
// Sampling (RANDOM_ACTION_ALGORITHM): each sample takes exactly three draws, in this order: steering =
// range(-1, 1), throttle = next(), brake = next(). Steering is in [-1, 1), throttle and brake in [0, 1).
import type { Controls } from '../sim/vehicle';
import { createRng, type Rng } from '../utils/rng';
import type { EpisodeDriver } from './drivers';

/** How a random action is drawn. Change it whenever the draws, their order or their ranges change. */
export const RANDOM_ACTION_ALGORITHM = 'uniform-steer-throttle-brake-v1';

/** Draws per sampled action. */
export const DRAWS_PER_ACTION = 3;

/** A7's hold: 30 ticks, 0.5 s at the fixed 1/60 s timestep. */
export const CORRELATED_HOLD_TICKS = 30;

/** Everything needed to rebuild a random driver exactly; recorded with its results. */
export interface RandomDriverConfig {
  readonly agent: 'A1' | 'A7';
  readonly algorithm: typeof RANDOM_ACTION_ALGORITHM;
  /** The driver's own generator seed: an integer from 0 to 4,294,967,295. */
  readonly seed: number;
  /** Ticks each sampled action is used for: 1 for A1. */
  readonly holdTicks: number;
}

export interface RandomDriver extends EpisodeDriver {
  readonly config: RandomDriverConfig;
}

/** One action: exactly three draws from `rng`, in the documented order. */
export function sampleAction(rng: Rng): Controls {
  const steering = rng.range(-1, 1);
  const throttle = rng.next();
  const brake = rng.next();
  return Object.freeze({ steering, throttle, brake });
}

function checkSeed(seed: unknown): number {
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError(`A random driver's seed must be an integer from 0 to 4294967295, got ${String(seed)}.`);
  }
  return seed;
}

function holdingDriver(config: RandomDriverConfig): RandomDriver {
  let rng = createRng(config.seed);
  let action: Controls | null = null;
  // Decisions made with the current action; a new action is drawn when it reaches holdTicks.
  let used = 0;
  return {
    config,
    decide() {
      if (action === null || used === config.holdTicks) {
        action = sampleAction(rng);
        used = 0;
      }
      used += 1;
      return action;
    },
    reset() {
      rng = createRng(config.seed);
      action = null;
      used = 0;
    },
  };
}

/** A1: a new uniformly random action every tick, from its own generator seeded with `seed`. */
export function createRandomDriver(seed: number): RandomDriver {
  return holdingDriver(Object.freeze({ agent: 'A1', algorithm: RANDOM_ACTION_ALGORITHM, seed: checkSeed(seed), holdTicks: 1 }));
}

/**
 * A7: each uniformly random action is used for exactly `holdTicks` consecutive ticks (default 30), then the next is
 * drawn. Decisions 0 to holdTicks − 1 use the first sample, decision holdTicks the second, and so on.
 */
export function createCorrelatedRandomDriver(seed: number, holdTicks: number = CORRELATED_HOLD_TICKS): RandomDriver {
  if (!Number.isSafeInteger(holdTicks) || holdTicks < 1) {
    throw new RangeError(`holdTicks must be an integer of at least 1, got ${holdTicks}.`);
  }
  return holdingDriver(Object.freeze({ agent: 'A7', algorithm: RANDOM_ACTION_ALGORITHM, seed: checkSeed(seed), holdTicks }));
}
