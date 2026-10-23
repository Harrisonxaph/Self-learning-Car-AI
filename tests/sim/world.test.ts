import { describe, expect, it } from 'vitest';
import { DEFAULT_SIM_CONFIG } from '../../src/sim/config';
import { createWorld, elapsedSeconds, stepWorld } from '../../src/sim/world';

describe('world', () => {
  it('uses a fixed 1/60 s timestep', () => {
    expect(DEFAULT_SIM_CONFIG.timestepSeconds).toBe(1 / 60);
    expect(Object.isFrozen(DEFAULT_SIM_CONFIG)).toBe(true);
  });

  it('advances one tick per step without changing the previous state', () => {
    const start = createWorld();
    const next = stepWorld(start);
    expect(start.tick).toBe(0);
    expect(next.tick).toBe(1);
  });

  it('computes simulated time from the tick count, so it does not drift', () => {
    let world = createWorld();
    for (let i = 0; i < 3600; i += 1) world = stepWorld(world);
    expect(elapsedSeconds(world, DEFAULT_SIM_CONFIG)).toBe(60);
  });
});
