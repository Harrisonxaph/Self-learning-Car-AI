// The simulation state: the track, one car with its lap progress, and the tick count. stepWorld advances
// everything by exactly one fixed timestep; it is the only way the simulation moves, whoever is driving.
import { createProgress, stepRacer, type Racer } from './checkpoints';
import { createCar } from './collision';
import type { SimConfig, VehiclePhysics } from './config';
import type { Track } from './track';
import type { Controls } from './vehicle';

export interface World {
  readonly track: Track;
  readonly physics: VehiclePhysics;
  /** Number of fixed timesteps run so far. Restarting the car does not reset it. */
  readonly tick: number;
  /** The car and its lap progress since the last (re)start. */
  readonly racer: Racer;
  /** The best completed lap since the page loaded, in ticks, or null. It survives restarts. */
  readonly bestLapTicks: number | null;
}

/** A car at rest on the start pose, with no progress. */
export function startRacer(track: Track, physics: VehiclePhysics): Racer {
  return { car: createCar(track.start, track, physics), progress: createProgress() };
}

export function createWorld(track: Track, physics: VehiclePhysics): World {
  return { track, physics, tick: 0, racer: startRacer(track, physics), bestLapTicks: null };
}

/** Advances the world by exactly one fixed timestep with the given controls. */
export function stepWorld(world: World, controls: Controls, config: SimConfig): World {
  const racer = stepRacer(world.racer, controls, world.track, world.physics, config.timestepSeconds);
  const laps = racer.progress.lapTicks;
  let { bestLapTicks } = world;
  if (laps.length > world.racer.progress.lapTicks.length) {
    const lap = laps[laps.length - 1]!;
    if (bestLapTicks === null || lap < bestLapTicks) bestLapTicks = lap;
  }
  return { ...world, tick: world.tick + 1, racer, bestLapTicks };
}

/**
 * Puts the car back on the start pose at rest, uncrashed, with fresh lap progress (no laps, timing waits for
 * gate 0 again). The tick count and the best lap are kept.
 */
export function restartWorld(world: World): World {
  return { ...world, racer: startRacer(world.track, world.physics) };
}

/** Simulated time in seconds, computed from the tick count so it never drifts. */
export function elapsedSeconds(world: World, config: SimConfig): number {
  return world.tick * config.timestepSeconds;
}
