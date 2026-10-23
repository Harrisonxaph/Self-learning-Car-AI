// The simulation state. For now it only counts ticks; cars and the track are added by later tasks.
import type { SimConfig } from './config';

export interface World {
  /** Number of fixed timesteps run so far. */
  readonly tick: number;
}

export function createWorld(): World {
  return { tick: 0 };
}

/** Advances the world by exactly one fixed timestep. */
export function stepWorld(world: World): World {
  return { tick: world.tick + 1 };
}

/** Simulated time in seconds, computed from the tick count so it never drifts. */
export function elapsedSeconds(world: World, config: SimConfig): number {
  return world.tick * config.timestepSeconds;
}
