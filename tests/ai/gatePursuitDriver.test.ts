// The P2-09 feasibility driver (src/ai/gatePursuitDriver.ts, plan step 3). Mechanics only: geometry checked against
// hand-computed values on the built-in oval, the control law at synthetic states, the one difference between the two
// modes, determinism and validation. No test asserts how well the driver drives, and the feasibility grid is not run.
import { describe, expect, it } from 'vitest';
import {
  createGatePursuitDriver,
  gateLoop,
  loopPoint,
  nearestArcLength,
  OVERSPEED_MARGIN,
  radiusAt,
  STEER_LOOK_AHEAD_METERS,
  targetSpeed,
  type BrakeMode,
  type GatePursuitConfig,
} from '../../src/ai/gatePursuitDriver';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import type { Car } from '../../src/sim/collision';
import { createEvaluationSetup, evaluateDriver } from '../../src/training/evaluation';
import { trainingTrack, validationTrack } from '../../src/training/trackSplits';
import type { Controls } from '../../src/sim/vehicle';

const oval = trainingTrack('stadium-oval');
const loop = gateLoop(oval);
const car = (x: number, y: number, heading: number, speed: number): Car => ({ vehicle: { position: { x, y }, heading, speed }, crashed: false });
const config = (mode: BrakeMode, extra: Partial<GatePursuitConfig> = {}): GatePursuitConfig => ({ mode, aLat: 4, lookAheadMeters: 10, vTop: 20, ...extra });
const driverFor = (mode: BrakeMode, extra: Partial<GatePursuitConfig> = {}) => createGatePursuitDriver(oval, DEFAULT_VEHICLE_PHYSICS, config(mode, extra));
const SIN_15 = Math.sin(Math.PI / 12);
// The track file stores gate coordinates to 3 decimals (for example 94.641), so hand-computed exact values hold to that precision.
const DECIMALS = 3;

describe('gate loop geometry on the stadium oval (hand-computed)', () => {
  it('has the 20 gate midpoints: straights at y = ±40, arcs of radius 40 about (±60, 0) every 30 degrees', () => {
    expect(loop.points).toHaveLength(20);
    expect(loop.points[0]).toEqual({ x: 0, y: 40 });
    expect(loop.points[1]).toEqual({ x: 30, y: 40 });
    expect(loop.points[2]).toEqual({ x: 60, y: 40 });
    for (let k = 3; k <= 7; k += 1) {
      const angle = ((k - 2) * Math.PI) / 6; // gate 3 at 30 degrees ... gate 7 at 150 degrees
      expect(loop.points[k]!.x).toBeCloseTo(60 + 40 * Math.sin(angle), DECIMALS);
      expect(loop.points[k]!.y).toBeCloseTo(40 * Math.cos(angle), DECIMALS);
    }
    expect(loop.points[10]).toEqual({ x: 0, y: -40 });
  });

  it('has the length of its chords: eight 30 m straights and twelve chords of 2 × 40 × sin 15 degrees', () => {
    expect(loop.length).toBeCloseTo(240 + 12 * 80 * SIN_15, DECIMALS);
    expect(loop.cumulative[0]).toBe(0);
    expect(loop.cumulative[1]).toBeCloseTo(30, 12);
    expect(loop.cumulative[2]).toBeCloseTo(60, 12);
    expect(loop.cumulative[3]! - loop.cumulative[2]!).toBeCloseTo(80 * SIN_15, DECIMALS);
  });

  it('has radius Infinity on the straights and exactly 40 m on the arcs', () => {
    for (const k of [0, 1, 9, 10, 11, 19]) expect(radiusAt(loop, loop.cumulative[k]!)).toBe(Infinity);
    for (const k of [3, 4, 5, 6, 7, 13, 14, 15, 16, 17]) expect(radiusAt(loop, loop.cumulative[k]!)).toBeCloseTo(40, 2);
    // Where a straight meets an arc, the circle through the straight's end and the arc's first two points is wider.
    for (const k of [2, 8, 12, 18]) {
      const r = radiusAt(loop, loop.cumulative[k]!);
      expect(r).toBeGreaterThan(40);
      expect(Number.isFinite(r)).toBe(true);
    }
  });

  it('reads the radius of the midpoint nearest to s, and wraps around the loop', () => {
    expect(radiusAt(loop, loop.cumulative[5]! + 3)).toBeCloseTo(40, 2);
    expect(radiusAt(loop, loop.cumulative[5]! - 3 + loop.length)).toBeCloseTo(40, 2);
    expect(radiusAt(loop, loop.cumulative[10]! - 4)).toBe(Infinity);
  });

  it('gives the point at an arc length, wrapping for any real s', () => {
    expect(loopPoint(loop, 0)).toEqual({ x: 0, y: 40 });
    expect(loopPoint(loop, 15)).toEqual({ x: 15, y: 40 });
    expect(loopPoint(loop, loop.cumulative[3]!).x).toBeCloseTo(loop.points[3]!.x, 9);
    const half = (loop.cumulative[3]! + loop.cumulative[4]!) / 2;
    expect(loopPoint(loop, half).x).toBeCloseTo((loop.points[3]!.x + loop.points[4]!.x) / 2, 9);
    expect(loopPoint(loop, 15 + loop.length).x).toBeCloseTo(15, 9);
    expect(loopPoint(loop, 15 - loop.length).x).toBeCloseTo(15, 9);
    // The closing segment from the last midpoint back to gate 0.
    expect(loopPoint(loop, loop.length - 15)).toEqual({ x: -15, y: 40 });
  });

  it('finds the nearest arc length, projecting onto segments', () => {
    expect(nearestArcLength(loop, { x: 12, y: 40 })).toBeCloseTo(12, 9);
    expect(nearestArcLength(loop, { x: 12, y: 47 })).toBeCloseTo(12, 9); // off the road side, same foot point
    expect(nearestArcLength(loop, { x: 12, y: 33 })).toBeCloseTo(12, 9);
    expect(nearestArcLength(loop, { x: 0, y: 40 })).toBeCloseTo(0, 12);
    expect(nearestArcLength(loop, { x: 30, y: -40 })).toBeCloseTo(loop.cumulative[9]!, 9);
  });

  it('needs at least 3 gates', () => {
    expect(() => gateLoop({ ...oval, gates: oval.gates.slice(0, 2) })).toThrow(RangeError);
  });
});

describe('speed target', () => {
  it('is min(vTop, sqrt(aLat × R) at s + lookAhead), and vTop on a straight', () => {
    const arc = loop.cumulative[5]!; // R = 40 there
    expect(targetSpeed(loop, 0, config('brake'))).toBe(20); // straight ahead: R infinite
    expect(targetSpeed(loop, arc - 10, config('brake', { aLat: 4, lookAheadMeters: 10, vTop: 20 }))).toBeCloseTo(Math.sqrt(160), DECIMALS); // 12.649
    expect(targetSpeed(loop, arc - 10, config('brake', { aLat: 8, lookAheadMeters: 10, vTop: 20 }))).toBeCloseTo(Math.sqrt(320), DECIMALS); // 17.889
    expect(targetSpeed(loop, arc - 10, config('brake', { aLat: 8, lookAheadMeters: 10, vTop: 16 }))).toBe(16); // capped by vTop
  });

  it('is the same in both modes', () => {
    for (const s of [0, 50, 110, 200, 330]) expect(targetSpeed(loop, s, config('brake'))).toBe(targetSpeed(loop, s, config('coast')));
  });
});

describe('steering (pure pursuit 8 m ahead along the gate polyline)', () => {
  const steer = (c: Car) => driverFor('brake').decide({ car: c }).steering;

  it('is 0 on the straight, heading along it', () => {
    expect(steer(car(0, 40, 0, 5))).toBeCloseTo(0, 12);
    expect(steer(car(12, 40, 0, 5))).toBeCloseTo(0, 12);
  });

  it('turns back towards the line from either side, symmetrically (+y is down, a negative steer turns towards -y)', () => {
    const below = steer(car(0, 42, 0, 5)); // 2 m to the +y side
    const above = steer(car(0, 38, 0, 5)); // 2 m to the -y side
    expect(below).toBeLessThan(0);
    expect(above).toBeGreaterThan(0);
    expect(below).toBeCloseTo(-above, 12);
    // Hand-computed: target (8, 40), alpha = atan2(∓2, 8), wheel = atan(2 × 2.5 × sin(alpha) / 8), maxSteerAngle(5) = 0.5.
    const alpha = Math.atan2(-2, STEER_LOOK_AHEAD_METERS);
    expect(below).toBeCloseTo(Math.atan((2 * DEFAULT_VEHICLE_PHYSICS.wheelbase * Math.sin(alpha)) / 8) / 0.5, 9);
  });

  it('steers into the corner on the arc', () => {
    // Just before the right-hand arc on the bottom straight, on the line: the line curves towards -y, so steer negative.
    expect(steer(car(55, 40, 0, 5))).toBeLessThan(0);
    // On the left-hand arc the line curves the other way round in world terms but the same way in the car's frame.
    const s = loop.cumulative[15]!;
    const p = loopPoint(loop, s);
    const q = loopPoint(loop, s + 1);
    expect(steer(car(p.x, p.y, Math.atan2(q.y - p.y, q.x - p.x), 5))).toBeLessThan(0);
  });

  it('is clamped to [-1, 1] and does not depend on the mode or the speed target parameters', () => {
    expect(steer(car(0, 40, Math.PI / 2, 5))).toBe(-1);
    expect(steer(car(0, 40, -Math.PI / 2, 5))).toBe(1);
    const a = driverFor('brake', { aLat: 4, lookAheadMeters: 10, vTop: 16 }).decide({ car: car(3, 41, 0.1, 9) }).steering;
    const b = driverFor('coast', { aLat: 8, lookAheadMeters: 40, vTop: 23.7 }).decide({ car: car(3, 41, 0.1, 9) }).steering;
    expect(a).toBe(b);
  });
});

describe('throttle and the one difference between the modes', () => {
  // On the straight at gate 0 with aLat 4, lookAhead 10 and vTop 20, the speed target is exactly 20 m/s.
  const at = (mode: BrakeMode, speed: number): Controls => driverFor(mode).decide({ car: car(0, 40, 0, speed) });

  it('throttles below the target and not at or above it, the same in both modes', () => {
    for (const mode of ['brake', 'coast'] as const) {
      expect(at(mode, 0).throttle).toBe(1);
      expect(at(mode, 19.999).throttle).toBe(1);
      expect(at(mode, 20).throttle).toBe(0);
      expect(at(mode, 25).throttle).toBe(0);
    }
  });

  it('brakes in BRAKE mode only when over the target by MORE than the margin, and never in COAST mode', () => {
    expect(OVERSPEED_MARGIN).toBe(0.5);
    for (const speed of [0, 10, 19.999, 20, 20.25, 20.5]) {
      expect(at('brake', speed).brake).toBe(0); // 20.5 is exactly target + margin: not over it
      expect(at('coast', speed).brake).toBe(0);
    }
    expect(at('brake', 20.5001).brake).toBe(1);
    expect(at('brake', 25).brake).toBe(1);
    for (const speed of [20.5001, 22, 25, 40]) expect(at('coast', speed).brake).toBe(0);
  });

  it('gives identical steering and throttle in both modes at every state of a sweep, and COAST never brakes', () => {
    let overspeed = 0;
    for (let i = 0; i < 400; i += 1) {
      const s = (i * 37.3) % loop.length;
      const p = loopPoint(loop, s);
      const state = car(p.x + ((i % 7) - 3) * 0.9, p.y + ((i % 5) - 2) * 1.1, ((i % 13) - 6) * 0.2, (i * 1.7) % 30);
      const extra = { aLat: 4 + (i % 5), lookAheadMeters: 10 + 10 * (i % 4), vTop: [16, 20, 23.7][i % 3]! };
      const b = driverFor('brake', extra).decide({ car: state });
      const c = driverFor('coast', extra).decide({ car: state });
      expect(c.steering).toBe(b.steering);
      expect(c.throttle).toBe(b.throttle);
      expect(c.brake).toBe(0);
      if (b.brake === 1) overspeed += 1;
    }
    expect(overspeed).toBeGreaterThan(0); // the sweep does reach states over the target, so the comparison is not vacuous
  });
});

describe('over a whole episode (mechanics only, no outcome is asserted)', () => {
  const setup = createEvaluationSetup({}, { track: oval, physics: DEFAULT_VEHICLE_PHYSICS, timestepSeconds: DEFAULT_SIM_CONFIG.timestepSeconds });
  const record = (mode: BrakeMode) => {
    const inner = driverFor(mode, { aLat: 6, lookAheadMeters: 20, vTop: 20 });
    const log: Controls[] = [];
    const wrapped = { decide: (o: Parameters<typeof inner.decide>[0]) => { const c = inner.decide(o); log.push(c); return c; }, reset: () => inner.reset() };
    const evaluation = evaluateDriver(wrapped, setup);
    return { log, evaluation };
  };

  it('is deterministic: a fresh instance and a reused instance give the same episode', () => {
    const driver = driverFor('brake', { aLat: 6, lookAheadMeters: 20, vTop: 20 });
    const first = evaluateDriver(driver, setup);
    const again = evaluateDriver(driver, setup);
    const fresh = evaluateDriver(driverFor('brake', { aLat: 6, lookAheadMeters: 20, vTop: 20 }), setup);
    expect(again.episode).toEqual(first.episode);
    expect(fresh.episode).toEqual(first.episode);
  });

  it('gives the two modes identical controls until the first tick BRAKE brakes, and COAST never brakes', () => {
    const b = record('brake');
    const c = record('coast');
    expect(c.log.every((x) => x.brake === 0)).toBe(true);
    for (let i = 0; i < Math.min(b.log.length, c.log.length); i += 1) {
      expect(c.log[i]!.steering).toBe(b.log[i]!.steering);
      expect(c.log[i]!.throttle).toBe(b.log[i]!.throttle);
      if (b.log[i]!.brake === 1) break; // the runs may part ways from here, but steering and throttle still agreed at this tick
      expect(c.log[i]!.brake).toBe(b.log[i]!.brake);
    }
  });

  it('never gets a held-out track: the evaluation setup refuses one', () => {
    const heldOut = { ...oval, id: 'hairpin-chicane' };
    expect(() => createEvaluationSetup({}, { track: heldOut, physics: DEFAULT_VEHICLE_PHYSICS, timestepSeconds: DEFAULT_SIM_CONFIG.timestepSeconds })).toThrow();
    expect(validationTrack('rounded-rectangle').gates.length).toBe(14);
  });
});

describe('validation', () => {
  it('rejects an unknown field, a bad mode, and non-positive or non-finite parameters', () => {
    expect(() => createGatePursuitDriver(oval, DEFAULT_VEHICLE_PHYSICS, { ...config('brake'), extra: 1 } as unknown as GatePursuitConfig)).toThrow('Unknown gate-pursuit config field "extra"');
    expect(() => createGatePursuitDriver(oval, DEFAULT_VEHICLE_PHYSICS, { ...config('brake'), mode: 'both' } as unknown as GatePursuitConfig)).toThrow('"mode"');
    for (const key of ['aLat', 'lookAheadMeters', 'vTop'] as const) {
      for (const bad of [0, -1, NaN, Infinity, '5']) {
        expect(() => createGatePursuitDriver(oval, DEFAULT_VEHICLE_PHYSICS, { ...config('brake'), [key]: bad } as unknown as GatePursuitConfig)).toThrow(key);
      }
    }
    expect(() => createGatePursuitDriver(oval, DEFAULT_VEHICLE_PHYSICS, null as unknown as GatePursuitConfig)).toThrow(RangeError);
  });

  it('rejects a track with fewer than 3 gates', () => {
    expect(() => createGatePursuitDriver({ ...oval, gates: oval.gates.slice(0, 2) }, DEFAULT_VEHICLE_PHYSICS, config('brake'))).toThrow(RangeError);
  });

  it('copies the configuration, so changing the caller\'s object later changes nothing', () => {
    const mutable = { mode: 'coast' as BrakeMode, aLat: 4, lookAheadMeters: 10, vTop: 20 };
    const driver = createGatePursuitDriver(oval, DEFAULT_VEHICLE_PHYSICS, mutable);
    mutable.mode = 'brake';
    expect(driver.decide({ car: car(0, 40, 0, 40) }).brake).toBe(0);
  });
});
