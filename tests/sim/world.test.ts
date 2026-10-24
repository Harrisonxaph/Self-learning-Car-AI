import { describe, expect, it } from 'vitest';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { loadTrack } from '../../src/sim/track';
import { NO_CONTROLS, type Controls } from '../../src/sim/vehicle';
import { createWorld, elapsedSeconds, restartWorld, stepWorld, type World } from '../../src/sim/world';
import { pursuit } from './ovalDriver';

const track = loadTrack(stadiumOval);
const PHYSICS = DEFAULT_VEHICLE_PHYSICS;
const CONFIG = DEFAULT_SIM_CONFIG;
const FULL_THROTTLE: Controls = { steering: 0, throttle: 1, brake: 0 };
const run = (world: World, ticks: number, controls: (w: World) => Controls) => {
  for (let i = 0; i < ticks; i += 1) world = stepWorld(world, controls(world), CONFIG);
  return world;
};

describe('world', () => {
  it('uses a fixed 1/60 s timestep', () => {
    expect(CONFIG.timestepSeconds).toBe(1 / 60);
    expect(Object.isFrozen(CONFIG)).toBe(true);
  });

  it('starts with the car at rest on the start pose, uncrashed, waiting for gate 0', () => {
    const world = createWorld(track, PHYSICS);
    expect(world.tick).toBe(0);
    expect(world.racer.car).toEqual({ vehicle: { ...track.start, speed: 0 }, crashed: false });
    expect(world.racer.progress).toMatchObject({ tick: 0, nextGate: 0, lapTicks: [] });
    expect(world.bestLapTicks).toBeNull();
  });

  it('advances one tick per step without changing the previous state', () => {
    const start = createWorld(track, PHYSICS);
    const next = stepWorld(start, FULL_THROTTLE, CONFIG);
    expect(start.tick).toBe(0);
    expect(start.racer.car.vehicle.speed).toBe(0);
    expect(next.tick).toBe(1);
    expect(next.racer.car.vehicle.speed).toBeGreaterThan(0);
    expect(next.racer.progress.tick).toBe(1);
  });

  it('computes simulated time from the tick count, so it does not drift', () => {
    const world = run(createWorld(track, PHYSICS), 3600, () => NO_CONTROLS);
    expect(elapsedSeconds(world, CONFIG)).toBe(60);
  });

  it('drives the car through physics, collision and checkpoints together', () => {
    // Full throttle from the start: gates 0 to 2 are crossed, then the car crashes on the right-hand curve.
    const world = run(createWorld(track, PHYSICS), 600, () => FULL_THROTTLE);
    expect(world.racer.car.crashed).toBe(true);
    expect(world.racer.car.vehicle.speed).toBe(0);
    expect(world.racer.progress.gatesPassed).toBe(3);
  });

  it('restarts the car and its progress, keeping the tick count and the best lap', () => {
    const crashed = { ...run(createWorld(track, PHYSICS), 600, () => FULL_THROTTLE), bestLapTicks: 2500 };
    const restarted = restartWorld(crashed);
    expect(restarted.tick).toBe(crashed.tick);
    expect(restarted.bestLapTicks).toBe(2500);
    expect(restarted.racer).toEqual(createWorld(track, PHYSICS).racer);
    // It drives again from the start, and the first gate starts lap timing afresh.
    const again = run(restarted, 120, () => FULL_THROTTLE);
    expect(again.racer.car.crashed).toBe(false);
    expect(again.racer.progress.gatesPassed).toBe(1);
    // Progress counts its own ticks from the restart: timing started at the gate 0 crossing within them.
    expect(again.racer.progress.tick).toBe(120);
    expect(again.racer.progress.lapStartTick).toBeGreaterThan(0);
    expect(again.racer.progress.lapStartTick).toBeLessThanOrEqual(120);
  });

  it('records the best lap across laps and restarts', () => {
    let world = run(createWorld(track, PHYSICS), 60 * 90, (w) => pursuit(w.racer.car, 12));
    const laps = world.racer.progress.lapTicks;
    expect(laps.length).toBe(2);
    expect(world.bestLapTicks).toBe(Math.min(...laps));
    world = restartWorld(world);
    expect(world.racer.progress.lapTicks).toEqual([]);
    expect(world.bestLapTicks).toBe(Math.min(...laps));
    // A slower lap after the restart does not replace the best.
    const slow = run(world, 60 * 60, (w) => pursuit(w.racer.car, 9));
    expect(slow.racer.progress.lapTicks.length).toBe(1);
    expect(slow.racer.progress.lapTicks[0]!).toBeGreaterThan(Math.min(...laps));
    expect(slow.bestLapTicks).toBe(Math.min(...laps));
  });
});
