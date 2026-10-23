// Turns real elapsed time into a whole number of fixed simulation ticks.
import type { SimConfig } from './config';

/** Absorbs floating-point error, so 1/120 s added twice still counts as one 1/60 s tick. */
const TICK_EPSILON = 1e-6;

export interface FixedStepClock {
  /** Adds real elapsed time and returns how many ticks to run now (at most `maxStepsPerFrame`). */
  advance(elapsedSeconds: number): number;
  /** Drops any time not yet turned into ticks, for example after the tab was hidden. */
  reset(): void;
}

export function createFixedStepClock(config: SimConfig): FixedStepClock {
  // Kept in ticks rather than seconds, so common frame rates add up exactly.
  let pendingTicks = 0;
  return {
    advance(elapsedSeconds) {
      // A clock that jumps backwards or reports nonsense adds no time.
      if (!(elapsedSeconds > 0) || !Number.isFinite(elapsedSeconds)) return 0;
      pendingTicks += elapsedSeconds / config.timestepSeconds;
      const due = Math.floor(pendingTicks + TICK_EPSILON);
      if (due > config.maxStepsPerFrame) {
        // Too far behind: run the maximum and drop the backlog, keeping only the part-tick.
        pendingTicks = Math.max(0, pendingTicks - due);
        return config.maxStepsPerFrame;
      }
      pendingTicks = Math.max(0, pendingTicks - due);
      return due;
    },
    reset() {
      pendingTicks = 0;
    },
  };
}
