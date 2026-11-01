// Seeded random-action baselines (P2-08 step 2, A1 and A7): the exact draws and ranges, A7's 30-tick hold, reset
// semantics, the recorded configuration, and that two drivers never share state. Pure unit tests: no track.
import { describe, expect, it } from 'vitest';
import {
  CORRELATED_HOLD_TICKS,
  createCorrelatedRandomDriver,
  createRandomDriver,
  DRAWS_PER_ACTION,
  RANDOM_ACTION_ALGORITHM,
  sampleAction,
  type RandomDriver,
} from '../../src/ai/randomDrivers';
import type { Observation } from '../../src/ai/drivers';
import type { Controls } from '../../src/sim/vehicle';
import { createRng } from '../../src/utils/rng';

const OBSERVATION: Observation = { car: { vehicle: { position: { x: 0, y: 0 }, heading: 0, speed: 0 }, crashed: false } };
const decisions = (driver: RandomDriver, n: number): Controls[] => Array.from({ length: n }, () => driver.decide(OBSERVATION));

/** The k-th action a fresh generator seeded with `seed` gives, computed independently of the drivers. */
function expectedActions(seed: number, count: number): Controls[] {
  const rng = createRng(seed);
  return Array.from({ length: count }, () => {
    const steering = rng.range(-1, 1);
    const throttle = rng.next();
    const brake = rng.next();
    return { steering, throttle, brake };
  });
}

describe('sampleAction', () => {
  it('takes exactly three draws, in the order steering, throttle, brake', () => {
    const a = createRng(5);
    const b = createRng(5);
    const action = sampleAction(a);
    expect(action).toEqual({ steering: b.range(-1, 1), throttle: b.next(), brake: b.next() });
    expect(a.getState()).toEqual(b.getState());
    expect(DRAWS_PER_ACTION).toBe(3);
  });

  it('keeps steering in [-1, 1) and throttle and brake in [0, 1), centred as a uniform draw should be', () => {
    const rng = createRng(2026);
    const n = 20_000;
    const sums = { steering: 0, throttle: 0, brake: 0 };
    for (let i = 0; i < n; i += 1) {
      const { steering, throttle, brake } = sampleAction(rng);
      expect(steering >= -1 && steering < 1).toBe(true);
      expect(throttle >= 0 && throttle < 1).toBe(true);
      expect(brake >= 0 && brake < 1).toBe(true);
      sums.steering += steering;
      sums.throttle += throttle;
      sums.brake += brake;
    }
    // A uniform mean's standard error is about 0.0058 (steering) and 0.0020 (others) here; allow over 4 of them.
    expect(Math.abs(sums.steering / n)).toBeLessThan(0.025);
    expect(Math.abs(sums.throttle / n - 0.5)).toBeLessThan(0.01);
    expect(Math.abs(sums.brake / n - 0.5)).toBeLessThan(0.01);
  });
});

describe('A1 random driver', () => {
  it('draws a new action every tick from its own generator', () => {
    const driver = createRandomDriver(42);
    expect(decisions(driver, 50)).toEqual(expectedActions(42, 50));
  });

  it('records the configuration needed to rebuild it', () => {
    const driver = createRandomDriver(42);
    expect(driver.config).toEqual({ agent: 'A1', algorithm: RANDOM_ACTION_ALGORITHM, seed: 42, holdTicks: 1 });
    expect(Object.isFrozen(driver.config)).toBe(true);
  });
});

describe('A7 correlated random driver', () => {
  it('holds each action for exactly 30 ticks by default', () => {
    expect(CORRELATED_HOLD_TICKS).toBe(30);
    const driver = createCorrelatedRandomDriver(7);
    const got = decisions(driver, 95);
    const samples = expectedActions(7, 4);
    got.forEach((action, k) => expect(action).toEqual(samples[Math.floor(k / 30)]));
    // The hold boundaries: decision 29 still uses the first sample and decision 30 draws the second.
    expect(got[29]).toEqual(samples[0]);
    expect(got[30]).toEqual(samples[1]);
    expect(got[30]).not.toEqual(got[29]);
    expect(new Set(got.map((a) => JSON.stringify(a))).size).toBe(4);
  });

  it('honours a recorded hold length, and with a hold of 1 matches A1 action for action', () => {
    const seven = decisions(createCorrelatedRandomDriver(9, 7), 22);
    const samples = expectedActions(9, 4);
    seven.forEach((action, k) => expect(action).toEqual(samples[Math.floor(k / 7)]));
    expect(decisions(createCorrelatedRandomDriver(9, 1), 40)).toEqual(decisions(createRandomDriver(9), 40));
  });

  it('records the configuration needed to rebuild it', () => {
    const driver = createCorrelatedRandomDriver(3);
    expect(driver.config).toEqual({ agent: 'A7', algorithm: RANDOM_ACTION_ALGORITHM, seed: 3, holdTicks: 30 });
    const rebuilt = createCorrelatedRandomDriver(driver.config.seed, driver.config.holdTicks);
    expect(decisions(rebuilt, 100)).toEqual(decisions(driver, 100));
  });
});

describe('reset semantics', () => {
  it.each([
    ['A1', () => createRandomDriver(11)],
    ['A7', () => createCorrelatedRandomDriver(11)],
  ])('%s: after reset it repeats exactly what a fresh driver does', (_label, make) => {
    const fresh = decisions(make(), 120);
    const driver = make();
    decisions(driver, 77);
    driver.reset();
    expect(decisions(driver, 120)).toEqual(fresh);
  });

  it('A7: a reset in the middle of a hold starts a full new hold with the first sample', () => {
    const driver = createCorrelatedRandomDriver(13);
    decisions(driver, 45);
    driver.reset();
    const samples = expectedActions(13, 2);
    const after = decisions(driver, 31);
    after.slice(0, 30).forEach((action) => expect(action).toEqual(samples[0]));
    expect(after[30]).toEqual(samples[1]);
  });
});

describe('isolation', () => {
  it('drivers with the same seed, used in turn, each give the same actions as alone: no shared generator', () => {
    const alone = decisions(createCorrelatedRandomDriver(21), 90);
    const a = createCorrelatedRandomDriver(21);
    const b = createCorrelatedRandomDriver(21);
    const c = createRandomDriver(21);
    const fromA: Controls[] = [];
    const fromB: Controls[] = [];
    for (let k = 0; k < 90; k += 1) {
      fromA.push(a.decide(OBSERVATION));
      c.decide(OBSERVATION);
      if (k % 2 === 0) fromB.push(b.decide(OBSERVATION), b.decide(OBSERVATION));
    }
    expect(fromA).toEqual(alone);
    expect(fromB).toEqual(alone);
  });

  it('resetting one driver does not affect another', () => {
    const a = createRandomDriver(31);
    const b = createRandomDriver(31);
    const first = decisions(a, 10);
    expect(decisions(b, 5)).toEqual(first.slice(0, 5));
    a.reset();
    expect(decisions(b, 5)).toEqual(first.slice(5, 10));
  });

  it('different seeds give different actions', () => {
    expect(decisions(createRandomDriver(1), 10)).not.toEqual(decisions(createRandomDriver(2), 10));
  });

  it('returns frozen actions, so a caller cannot change a held action', () => {
    const driver = createCorrelatedRandomDriver(17);
    const action = driver.decide(OBSERVATION);
    expect(Object.isFrozen(action)).toBe(true);
    expect(() => {
      (action as { throttle: number }).throttle = 5;
    }).toThrow(TypeError);
    expect(driver.decide(OBSERVATION)).toEqual(expectedActions(17, 1)[0]);
  });

  it('ignores the observation', () => {
    const moving: Observation = {
      car: { vehicle: { position: { x: 50, y: -3 }, heading: 2, speed: 20 }, crashed: true },
      inputs: [0, 0, 0, 0, 0, 0, 0, 1, 1],
    };
    const a = createRandomDriver(8);
    const b = createRandomDriver(8);
    for (let k = 0; k < 20; k += 1) expect(a.decide(OBSERVATION)).toEqual(b.decide(moving));
  });
});

describe('validation', () => {
  it.each([-1, 1.5, 2 ** 32, Number.NaN, '1' as unknown as number])('rejects the seed %s', (seed) => {
    expect(() => createRandomDriver(seed)).toThrow(RangeError);
    expect(() => createCorrelatedRandomDriver(seed)).toThrow(RangeError);
  });

  it('accepts the extreme seeds 0 and 4294967295', () => {
    expect(createRandomDriver(0).config.seed).toBe(0);
    expect(createCorrelatedRandomDriver(0xffffffff).config.seed).toBe(0xffffffff);
  });

  it.each([0, -3, 1.5, Number.NaN, Infinity, 2 ** 53])('rejects the hold length %s', (hold) => {
    expect(() => createCorrelatedRandomDriver(1, hold)).toThrow(RangeError);
  });
});
