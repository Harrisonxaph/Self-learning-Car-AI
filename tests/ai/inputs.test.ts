// Network inputs (P2-02). Expected values come from geometry worked out in each test, not from the code.
import { describe, expect, it } from 'vitest';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import {
  HEADING_ERROR_INPUT,
  INPUT_CONTRACT,
  INPUT_COUNT,
  INPUT_NAMES,
  SPEED_INPUT,
  buildInputs,
  gateCentre,
  headingErrorRadians,
  inputNames,
  normalisedSpeed,
} from '../../src/ai/inputs';
import { DEFAULT_SENSOR_CONFIG, castRays, resolveSensorConfig } from '../../src/sensors/rays';
import { createProgress, type Racer } from '../../src/sim/checkpoints';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { loadTrack, type Vec2 } from '../../src/sim/track';
import { stepVehicle } from '../../src/sim/vehicle';
import { createRng } from '../../src/utils/rng';
import { CRASHES, LAPS, createScenarioRun, runScenario } from '../sim/scenarios';

const EPS = 1e-12;
const track = loadTrack(stadiumOval);
const physics = DEFAULT_VEHICLE_PHYSICS;
const p = (x: number, y: number): Vec2 => ({ x, y });

/** A racer at a given rear-axle pose and speed, aiming for gate `nextGate`. */
function racerAt(position: Vec2, heading: number, speed = 0, nextGate = 0, crashed = false): Racer {
  return { car: { vehicle: { position, heading, speed }, crashed }, progress: { ...createProgress(), nextGate } };
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

describe('input contract', () => {
  it('names nine inputs in MODEL_FORMAT order under seven-rays-speed-heading-v1', () => {
    expect(INPUT_CONTRACT).toBe('seven-rays-speed-heading-v1');
    expect(INPUT_COUNT).toBe(9);
    expect(INPUT_NAMES).toEqual(['ray-90', 'ray-60', 'ray-30', 'ray0', 'ray30', 'ray60', 'ray90', 'speed', 'headingError']);
    expect([SPEED_INPUT, HEADING_ERROR_INPUT]).toEqual([7, 8]);
    expect(Object.isFrozen(INPUT_NAMES)).toBe(true);
    expect(inputNames(resolveSensorConfig({ ...DEFAULT_SENSOR_CONFIG, anglesDegrees: [-80, -45, -10, 0, 10, 45, 80] }))).toEqual([
      'ray-80', 'ray-45', 'ray-10', 'ray0', 'ray10', 'ray45', 'ray80', 'speed', 'headingError',
    ]);
  });

  it('inputs 0–6 are exactly the P2-01 normalised ray readings, in angle order', () => {
    const rng = createRng(1302);
    for (let i = 0; i < 100; i += 1) {
      const racer = racerAt(p(rng.range(-110, 110), rng.range(-50, 50)), rng.range(-Math.PI, Math.PI), rng.range(0, 20), rng.int(0, 20));
      const inputs = buildInputs(racer, track, physics);
      const rays = castRays(racer.car.vehicle, track, physics, DEFAULT_SENSOR_CONFIG).rays.map((r) => r.normalised);
      expect(inputs.slice(0, 7)).toEqual(rays);
    }
  });
});

describe('the stadium start pose (rear axle (−6, 40), heading 0, at rest, next gate 0)', () => {
  it('gives the P2-01 start rays, speed 0 and heading error 0 (gate 0 centre (0, 40) is dead ahead)', () => {
    const inputs = buildInputs(racerAt(track.start.position, track.start.heading), track, physics);
    const expected = [7 / 50, 7 / Math.sin(Math.PI / 3) / 50, 14 / 50, 1, 14 / 50, 7 / Math.sin(Math.PI / 3) / 50, 7 / 50, 0, 0];
    expect(inputs).toHaveLength(9);
    inputs.forEach((value, i) => expect(Math.abs(value - expected[i]!)).toBeLessThan(1e-9));
    expect(gateCentre(track, 0)).toEqual(p(0, 40));
  });
});

describe('heading error', () => {
  // Gate 0's centre is (0, 40). Each case puts the rear axle somewhere around it.
  const at = (x: number, y: number, heading: number) => buildInputs(racerAt(p(x, y), heading), track, physics)[8]!;

  it.each([
    ['dead ahead', -10, 40, 0, 0],
    ['90° to the right (+y)', 0, 30, 0, 0.5],
    ['90° to the left (−y)', 0, 50, 0, -0.5],
    ['45° to the right', -10, 30, 0, 0.25],
    ['45° to the left', -10, 50, 0, -0.25],
    ['exactly behind: +1', 10, 40, 0, 1],
    ['ahead when facing −y from below', 0, 50, -Math.PI / 2, 0],
    ['to the right when facing −x from below', 0, 50, Math.PI, 0.5],
  ])('%s', (_name, x, y, heading, expected) => {
    expect(Math.abs(at(x, y, heading) - expected)).toBeLessThan(EPS);
  });

  it('wraps across ±π: headings either side of π give small errors of opposite sign, never close to ±2', () => {
    // From (10, 40) the target is in direction π (towards −x).
    expect(Math.abs(at(10, 40, Math.PI - 0.1) - 0.1 / Math.PI)).toBeLessThan(EPS);
    expect(Math.abs(at(10, 40, -Math.PI + 0.1) + 0.1 / Math.PI)).toBeLessThan(EPS);
  });

  it('just left of behind reads close to −1, just right of behind close to +1', () => {
    expect(at(-10, 40, Math.PI - 1e-9)).toBeCloseTo(-1, 8);
    expect(at(-10, 40, Math.PI - 1e-9)).toBeGreaterThan(-1);
    expect(at(-10, 40, -Math.PI + 1e-9)).toBeCloseTo(1, 8);
  });

  it('a heading of many whole turns reads the same as the wrapped heading', () => {
    expect(Math.abs(at(-10, 30, Math.PI / 6 + 20 * Math.PI) - at(-10, 30, Math.PI / 6))).toBeLessThan(1e-12);
    expect(Math.abs(at(-10, 30, Math.PI / 6) - (Math.PI / 4 - Math.PI / 6) / Math.PI)).toBeLessThan(EPS);
  });

  it('reads 0 when the reference point is exactly on the target (no direction)', () => {
    expect(at(0, 40, 1.234)).toBe(0);
    expect(headingErrorRadians(p(5, 5), 2, p(5, 5))).toBe(0);
  });

  it('uses the rear axle, not the body centre or the nose', () => {
    // Rear axle (−1, 41), facing −y, so "right" is +x. From the rear axle the target (0, 40) is 45° to the
    // right: 0.25. From the body centre (−1, 39.75) it would be atan2(0.25, 1) + π/2 ≈ 1.82 rad (≈ 0.58).
    const error = at(-1, 41, -Math.PI / 2);
    expect(Math.abs(error - 0.25)).toBeLessThan(EPS);
    expect(Math.abs(error - (Math.atan2(0.25, 1) + Math.PI / 2) / Math.PI)).toBeGreaterThan(0.3);
  });

  it('targets the next gate: the same pose aims at gate 1 once gate 0 has counted', () => {
    // Gate 1's centre is (30, 40), dead ahead of (10, 40); gate 0 at (0, 40) is behind it.
    expect(buildInputs(racerAt(p(10, 40), 0, 0, 0), track, physics)[8]).toBe(1);
    expect(buildInputs(racerAt(p(10, 40), 0, 0, 1), track, physics)[8]).toBe(0);
    // The last gate (19, centre (−30, 40)) is dead ahead of (−40, 40) facing +x.
    expect(buildInputs(racerAt(p(-40, 40), 0, 0, 19), track, physics)[8]).toBe(0);
  });

  it('its sign matches the steering side: steering towards the target shrinks the error, steering away grows it', () => {
    const dt = DEFAULT_SIM_CONFIG.timestepSeconds;
    for (const [y, side] of [
      [30, 'right'],
      [50, 'left'],
    ] as const) {
      // Rear axle 20 m before gate 0, 10 m to one side of its centre, heading 0, at 10 m/s.
      const start = { position: p(-20, y), heading: 0, speed: 10 };
      const error0 = headingErrorRadians(start.position, start.heading, p(0, 40));
      expect(Math.sign(error0)).toBe(side === 'right' ? 1 : -1);
      const towards = side === 'right' ? 1 : -1;
      const after = (steering: number) => {
        let vehicle = start;
        for (let i = 0; i < 10; i += 1) vehicle = stepVehicle(vehicle, { steering, throttle: 0, brake: 0 }, physics, dt);
        return Math.abs(headingErrorRadians(vehicle.position, vehicle.heading, p(0, 40)));
      };
      expect(after(towards)).toBeLessThan(Math.abs(error0));
      expect(after(-towards)).toBeGreaterThan(Math.abs(error0));
    }
  });
});

describe('speed input', () => {
  it.each([
    [0, 0],
    [physics.maxSpeed / 2, 0.5],
    [physics.maxSpeed / 4, 0.25],
    [physics.maxSpeed, 1],
    [physics.maxSpeed * 1.5, 1],
  ])('speed %s m/s reads %s', (speed, expected) => {
    expect(buildInputs(racerAt(track.start.position, 0, speed), track, physics)[7]).toBe(expected);
  });

  it('is forward speed ÷ the derived top speed (23.72… m/s with the defaults)', () => {
    expect(physics.maxSpeed).toBeCloseTo(23.722813232690147, 12);
    expect(normalisedSpeed(10, physics.maxSpeed)).toBe(10 / physics.maxSpeed);
  });
});

describe('input checks', () => {
  const ok = racerAt(track.start.position, 0, 5, 0);
  it.each([
    ['nextGate −1', racerAt(track.start.position, 0, 0, -1), physics, /Gate index/],
    ['nextGate past the last gate', racerAt(track.start.position, 0, 0, 20), physics, /Gate index/],
    ['a fractional nextGate', racerAt(track.start.position, 0, 0, 1.5), physics, /Gate index/],
    ['a NaN nextGate', racerAt(track.start.position, 0, 0, NaN), physics, /Gate index/],
    ['maxSpeed 0', ok, { ...physics, maxSpeed: 0 }, /maxSpeed/],
    ['an infinite maxSpeed', ok, { ...physics, maxSpeed: Infinity }, /maxSpeed/],
    ['a NaN maxSpeed', ok, { ...physics, maxSpeed: NaN }, /maxSpeed/],
    ['a NaN speed', racerAt(track.start.position, 0, NaN), physics, /speed/],
    ['a NaN position', racerAt(p(NaN, 40), 0), physics, /position/],
    ['an infinite heading', racerAt(track.start.position, Infinity), physics, /heading/],
    ['wheelbase 0', ok, { ...physics, wheelbase: 0 }, /wheelbase/],
  ])('throws a RangeError for %s', (_name, racer, phys, message) => {
    expect(() => buildInputs(racer, track, phys)).toThrow(RangeError);
    expect(() => buildInputs(racer, track, phys)).toThrow(message);
  });

  it('throws for an invalid sensor config and for a track with no gates', () => {
    expect(() => buildInputs(ok, track, physics, { ...DEFAULT_SENSOR_CONFIG, maxDistance: 0 })).toThrow(RangeError);
    expect(() => buildInputs(ok, { ...track, gates: [] }, physics)).toThrow(/no gates/);
  });
});

describe('symmetry, determinism and isolation', () => {
  const rng = createRng(1303);
  const racers = Array.from({ length: 200 }, () =>
    racerAt(p(rng.range(-110, 110), rng.range(-50, 50)), rng.range(-Math.PI, Math.PI), rng.range(0, 25), rng.int(0, 20), rng.next() < 0.3),
  );

  it('mirroring the scene reverses the rays, keeps the speed and negates the heading error', () => {
    const flip = (q: Vec2) => p(q.x, -q.y);
    const mirrored = loadTrack({
      ...stadiumOval,
      outer: stadiumOval.outer.map(flip),
      inner: stadiumOval.inner.map(flip),
      gates: stadiumOval.gates.map((g) => ({ a: flip(g.a), b: flip(g.b) })),
    });
    let compared = 0;
    for (const racer of racers) {
      const before = buildInputs(racer, track, physics);
      if (Math.abs(before[8]!) > 0.999) continue; // ±1 is the wrap point, where negation does not hold
      const { position, heading, speed } = racer.car.vehicle;
      const after = buildInputs(racerAt(flip(position), -heading, speed, racer.progress.nextGate), mirrored, physics);
      for (let i = 0; i < 7; i += 1) expect(Math.abs(after[6 - i]! - before[i]!)).toBeLessThan(1e-9);
      expect(after[7]).toBe(before[7]);
      expect(Math.abs(after[8]! + before[8]!)).toBeLessThan(1e-12);
      compared += 1;
    }
    expect(compared).toBeGreaterThan(190);
  });

  it('never changes what it is given, and repeat calls give identical values', () => {
    const frozenTrack = deepFreeze(loadTrack(structuredClone(stadiumOval)));
    const frozenPhysics = deepFreeze({ ...physics });
    for (const racer of racers.slice(0, 50)) {
      const frozen = deepFreeze(structuredClone(racer));
      const first = buildInputs(frozen, frozenTrack, frozenPhysics);
      expect(buildInputs(frozen, frozenTrack, frozenPhysics)).toEqual(first);
      expect(Object.isFrozen(first)).toBe(true);
    }
  });

  for (const scenario of [LAPS, CRASHES]) {
    it(`${scenario.name}: building inputs every tick leaves the run identical and keeps every input in range`, () => {
      const run = createScenarioRun(scenario);
      let crashedTicks = 0;
      let sumAbsHeading = 0;
      for (let i = 0; i < scenario.ticks; i += 1) {
        run.step();
        const world = run.world();
        const inputs = buildInputs(world.racer, world.track, world.physics);
        expect(inputs).toHaveLength(9);
        for (let k = 0; k < 8; k += 1) {
          expect(inputs[k]).toBeGreaterThanOrEqual(0);
          expect(inputs[k]).toBeLessThanOrEqual(1);
        }
        expect(inputs[8]).toBeGreaterThan(-1);
        expect(inputs[8]).toBeLessThanOrEqual(1);
        if (world.racer.car.crashed) crashedTicks += 1;
        sumAbsHeading += Math.abs(inputs[8]!);
      }
      expect(run.trace()).toEqual(runScenario(scenario).trace);
      if (scenario === CRASHES) expect(crashedTicks).toBeGreaterThan(0);
      // The laps driver follows the centre line, so the next gate stays roughly ahead of it on average.
      if (scenario === LAPS) expect(sumAbsHeading / scenario.ticks).toBeLessThan(0.1);
    });
  }
});
