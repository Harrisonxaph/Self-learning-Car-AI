import { describe, expect, it } from 'vitest';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import {
  MAX_SWEEP_ROTATION,
  convexHull,
  createCar,
  footprintHitsTrack,
  footprintReach,
  turnMargin,
  segmentsTouch,
  stepCar,
  sweepHitsTrack,
  vehicleFootprint,
  type Car,
} from '../../src/sim/collision';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { loadTrack, type Pose, type Track, type Vec2 } from '../../src/sim/track';
import { NO_CONTROLS, maxSteerAngle, stepVehicle, wrapAngle, type Controls } from '../../src/sim/vehicle';
import { createRng } from '../../src/utils/rng';

const PHYSICS = DEFAULT_VEHICLE_PHYSICS;
const DT = DEFAULT_SIM_CONFIG.timestepSeconds;
const FULL_THROTTLE: Controls = { steering: 0, throttle: 1, brake: 0 };
const pose = (x: number, y: number, heading = 0): Pose => ({ position: { x, y }, heading });
const oval = loadTrack(stadiumOval);

/** A test track from boundary points; the start pose and gates are placeholders that collision ignores. */
function makeTrack(outer: Vec2[], inner: Vec2[]): Track {
  const gate = { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } };
  return loadTrack({ id: 'test', version: '1', name: 'Test', outer, inner, start: pose(0, 0), gates: [gate, gate, gate] });
}
const square = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
/** A 100 m square with a 20 m square infield: road everywhere else. */
const BOX = makeTrack(square(0, 0, 100, 100), square(40, 40, 60, 60));
/** With heading 0 the default body covers x from rear − 0.75 to rear + 3.25 and y from rear − 1 to rear + 1. */
const hits = (track: Track, x: number, y: number, heading = 0) =>
  footprintHitsTrack(vehicleFootprint(pose(x, y, heading), PHYSICS), track);

/** How far p lies outside a convex polygon with positive orientation (0 if inside or on it). */
function distanceOutside(polygon: readonly Vec2[], p: Vec2): number {
  const inside = polygon.every((a, i) => {
    const b = polygon[(i + 1) % polygon.length]!;
    return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= 0;
  });
  if (inside) return 0;
  return Math.min(
    ...polygon.map((a, i) => {
      const b = polygon[(i + 1) % polygon.length]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    }),
  );
}

describe('vehicle footprint', () => {
  it('is the 4 × 2 m body centred between the axles, 0.75 m behind and 3.25 m ahead of the rear axle', () => {
    expect(vehicleFootprint(pose(10, 20), PHYSICS)).toEqual([
      { x: 9.25, y: 21 }, // rear-right
      { x: 13.25, y: 21 }, // front-right
      { x: 13.25, y: 19 }, // front-left
      { x: 9.25, y: 19 }, // rear-left
    ]);
  });

  it('turns with the heading in the y-down convention: facing +y, the right side is −x', () => {
    const [rearRight, frontRight] = vehicleFootprint(pose(10, 20, Math.PI / 2), PHYSICS);
    expect(rearRight!.x).toBeCloseTo(9, 12);
    expect(rearRight!.y).toBeCloseTo(19.25, 12);
    expect(frontRight!.x).toBeCloseTo(9, 12);
    expect(frontRight!.y).toBeCloseTo(23.25, 12);
  });

  it('has its "right" on the side that positive steering turns towards', () => {
    const start = { position: { x: 0, y: 0 }, heading: 0.3, speed: 10 };
    let state = start;
    for (let i = 0; i < 30; i += 1) state = stepVehicle(state, { steering: 1, throttle: 0.3, brake: 0 }, PHYSICS, DT);
    const [rearRight, , , rearLeft] = vehicleFootprint(start, PHYSICS);
    const right = { x: rearRight!.x - rearLeft!.x, y: rearRight!.y - rearLeft!.y };
    const moved = { x: state.position.x - start.position.x, y: state.position.y - start.position.y };
    const forward = { x: Math.cos(start.heading), y: Math.sin(start.heading) };
    // Remove the forward part of the movement; what is left must point to the footprint's right side.
    const along = moved.x * forward.x + moved.y * forward.y;
    const sideways = { x: moved.x - along * forward.x, y: moved.y - along * forward.y };
    expect(sideways.x * right.x + sideways.y * right.y).toBeGreaterThan(0);
  });
});

describe('geometry helpers', () => {
  const p = (x: number, y: number) => ({ x, y });
  it.each([
    ['crossing', [p(0, 0), p(2, 2), p(0, 2), p(2, 0)], true],
    ['touching at an end point', [p(0, 0), p(1, 1), p(1, 1), p(2, 0)], true],
    ['an end touching the other segment\'s middle (T)', [p(0, 0), p(2, 0), p(1, 0), p(1, 5)], true],
    ['collinear and overlapping', [p(0, 0), p(2, 0), p(1, 0), p(3, 0)], true],
    ['collinear with a gap', [p(0, 0), p(1, 0), p(1.5, 0), p(3, 0)], false],
    ['parallel and apart', [p(0, 0), p(2, 0), p(0, 1), p(2, 1)], false],
    ['would cross only if extended', [p(0, 0), p(1, 1), p(3, 0), p(2, 1)], false],
  ])('segmentsTouch: %s', (_label, [a, b, c, d], expected) => {
    expect(segmentsTouch(a!, b!, c!, d!)).toBe(expected);
    expect(segmentsTouch(c!, d!, a!, b!)).toBe(expected);
  });

  it('convexHull drops inner, repeated and collinear points', () => {
    const hull = convexHull([p(0, 0), p(2, 0), p(1, 0), p(2, 2), p(0, 2), p(1, 1), p(0, 0), p(2, 2)]);
    expect(hull).toHaveLength(4);
    expect(new Set(hull.map((q) => `${q.x},${q.y}`))).toEqual(new Set(['0,0', '2,0', '2,2', '0,2']));
  });
});

describe('contact cases (a car placed on a test track)', () => {
  it('is clear in open road', () => {
    expect(hits(BOX, 20, 20)).toBe(false);
  });

  it.each([
    ['a side lying exactly on a wall (parallel contact)', 20, 1, true],
    ['a side 1 mm from a parallel wall', 20, 1.001, false],
    ['the front edge exactly on a wall', 96.75, 50 - 30, true],
    ['the front edge 1 mm short of a wall', 96.749, 50 - 30, false],
    ['the rear edge exactly on a wall', 0.75, 20, true],
  ])('%s', (_label, x, y, expected) => {
    expect(hits(BOX, x, y)).toBe(expected);
  });

  // The outer wall's corner is cut by a diagonal x + y = 190 from (100, 90) to (90, 100).
  const chamfered = makeTrack(
    [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 90 }, { x: 90, y: 100 }, { x: 0, y: 100 }],
    square(40, 40, 60, 60),
  );
  it('detects only a car corner touching a diagonal wall', () => {
    // Front-right corner at (95, 95), exactly on the diagonal; every other point of the car is clear of it.
    expect(hits(chamfered, 91.75, 94)).toBe(true);
    expect(hits(chamfered, 91.749, 94)).toBe(false);
  });

  it('detects a wall corner pushing into the side of the car, with no car corner across the wall', () => {
    // The infield corner (40, 40) lies inside the body (x 37.25–41.25, y 39–41).
    expect(hits(BOX, 38, 40)).toBe(true);
    // The same corner exactly on the body's right side (y = 40).
    expect(hits(BOX, 38, 39)).toBe(true);
    expect(hits(BOX, 38, 38.999)).toBe(false);
  });

  it('detects a car standing across a corner of the infield', () => {
    expect(hits(BOX, 39, 39, Math.PI / 4)).toBe(true);
  });

  it('detects a car wholly off the road, where no edge crosses a boundary', () => {
    expect(hits(BOX, 48, 50)).toBe(true); // inside the infield
    expect(hits(BOX, 200, 200)).toBe(true); // outside the outer wall
    expect(hits(BOX, -50, 50, 1)).toBe(true);
  });

  it('detects a small obstacle wholly under the car', () => {
    // A 0.5 m infield triangle inside the body: no car corner is off the road and no edges cross.
    const island = makeTrack(square(0, 0, 100, 100), [
      { x: 20, y: 20 },
      { x: 20.5, y: 20 },
      { x: 20, y: 20.5 },
    ]);
    expect(hits(island, 19, 20)).toBe(true);
    expect(hits(island, 30, 20)).toBe(false);
  });

  it('starts a car on the built-in track clear, and a car placed off the road already crashed', () => {
    expect(createCar(oval.start, oval, PHYSICS).crashed).toBe(false);
    expect(createCar(pose(0, 0), oval, PHYSICS).crashed).toBe(true); // the infield
    expect(createCar(pose(-6, 46.5), oval, PHYSICS).crashed).toBe(true); // across the outer wall
  });
});

describe('sweeps between ticks', () => {
  // A 1 cm thick wall across the road: an infield sliver from y = 10 to y = 90 at x = 50.
  const thinWall = makeTrack(square(0, 0, 100, 100), square(50, 10, 50.01, 90));

  it('catches a car that would jump over a thin wall in one step, though both end poses are clear', () => {
    const before = pose(40, 50);
    const after = pose(55, 50);
    expect(hits(thinWall, 40, 50)).toBe(false);
    expect(hits(thinWall, 55, 50)).toBe(false);
    expect(sweepHitsTrack(before, after, thinWall, PHYSICS)).toBe(true);
    expect(sweepHitsTrack(before, pose(46, 50), thinWall, PHYSICS)).toBe(false);
  });

  it('reports a move that starts and ends wholly off the road', () => {
    expect(sweepHitsTrack(pose(45, 50), pose(47, 50), BOX, PHYSICS)).toBe(true);
  });

  it('catches the jump when stepping a fast car with a long timestep', () => {
    const car: Car = { vehicle: { ...pose(40, 50), speed: 20 }, crashed: false };
    const next = stepCar(car, FULL_THROTTLE, thinWall, PHYSICS, 0.75); // about 15 m in one step
    expect(next.crashed).toBe(true);
    expect(next.vehicle).toEqual({ ...car.vehicle, speed: 0 });
  });

  it('catches a diagonal pass over a wall corner', () => {
    // Moving up and to the right past the infield's corner (40, 40): one pose is left of the infield, the
    // other above it, and the path between them cuts the corner.
    expect(hits(BOX, 36, 44)).toBe(false);
    expect(hits(BOX, 44, 36)).toBe(false);
    expect(sweepHitsTrack(pose(36, 44), pose(44, 36), BOX, PHYSICS)).toBe(true);
    expect(sweepHitsTrack(pose(36, 44), pose(36, 50), BOX, PHYSICS)).toBe(false);
  });

  it('splits a sharp turn into slices, so a point swept only mid-turn is still caught', () => {
    // Turning half a circle on the spot: at a quarter turn the nose points +y and covers y up to 53.25,
    // further than either end pose, which only reach y = 51.
    const pip = makeTrack(square(0, 0, 100, 100), [
      { x: 49.9, y: 52.5 },
      { x: 50.1, y: 52.5 },
      { x: 50, y: 52.7 },
    ]);
    const before = pose(50, 50, 0);
    const after = pose(50, 50, Math.PI);
    expect(hits(pip, 50, 50, 0)).toBe(false);
    expect(hits(pip, 50, 50, Math.PI)).toBe(false);
    expect(hits(pip, 50, 50, Math.PI / 2)).toBe(true);
    expect(sweepHitsTrack(before, after, pip, PHYSICS)).toBe(true);
    // Slicing also keeps the turning margin small: the same half turn 5 m from a wall (the nose reaches
    // 1.6 m from it) is clear, where one unsliced hull would need a 4 m margin and report a false crash.
    expect(sweepHitsTrack(pose(20, 5, 0), pose(20, 5, Math.PI), BOX, PHYSICS)).toBe(false);
  });

  it('sweeps the short way round when the heading crosses ±π', () => {
    // Facing −x just above the infield (top edge y = 40). Turning 0.6 rad through π (12 slices) stays clear;
    // the long way round, almost a full turn on the spot, would swing the nose into the infield.
    const before = pose(50, 37.5, Math.PI - 0.3);
    const after = pose(50, 37.5, -Math.PI + 0.3);
    expect(sweepHitsTrack(before, after, BOX, PHYSICS)).toBe(false);
    expect(sweepHitsTrack(before, pose(50, 37.5, Math.PI / 2), BOX, PHYSICS)).toBe(true);
  });

  it('turns at most 0.0225 rad per default tick, so a sweep never needs slicing and its turning margin stays below 0.22 mm', () => {
    let largest = 0;
    for (let v = 0; v <= PHYSICS.maxSpeed; v += 0.01) {
      largest = Math.max(largest, (v * Math.tan(maxSteerAngle(v, PHYSICS)) * DT) / PHYSICS.wheelbase);
    }
    expect(largest).toBeLessThan(0.0225);
    expect(largest).toBeLessThan(MAX_SWEEP_ROTATION);
    expect(footprintReach(PHYSICS)).toBeCloseTo(Math.hypot(3.25, 1), 12);
    expect(turnMargin(largest, PHYSICS)).toBeLessThan(0.00022);
    expect(turnMargin(MAX_SWEEP_ROTATION, PHYSICS)).toBeLessThan(0.0011);
    expect(turnMargin(0, PHYSICS)).toBe(0);
  });

  it('catches a turning car that clips a wall only between ticks (Codex review, default tick, built-in track)', () => {
    // Full lock at top speed beside the bottom straight's inner wall (y = 33). Both tick poses are clear,
    // but halfway through the step a corner reaches y ≈ 32.9999989: about 1 µm into the wall.
    const before = { position: { x: -6, y: 34.16468803906176 }, heading: -0.05109599460022829, speed: PHYSICS.maxSpeed };
    const controls = { steering: 1, throttle: 1, brake: 0 };
    const after = stepVehicle(before, controls, PHYSICS, DT);
    const mid = pose(
      (before.position.x + after.position.x) / 2,
      (before.position.y + after.position.y) / 2,
      (before.heading + after.heading) / 2,
    );
    expect(footprintHitsTrack(vehicleFootprint(before, PHYSICS), oval)).toBe(false);
    expect(footprintHitsTrack(vehicleFootprint(after, PHYSICS), oval)).toBe(false);
    expect(footprintHitsTrack(vehicleFootprint(mid, PHYSICS), oval)).toBe(true);
    expect(sweepHitsTrack(before, after, oval, PHYSICS)).toBe(true);
    const car = stepCar({ vehicle: before, crashed: false }, controls, oval, PHYSICS, DT);
    expect(car).toEqual({ vehicle: { ...before, speed: 0 }, crashed: true });
  });

  it('keeps every point of a turning body within the margin of its sweep hull', () => {
    // The margin must cover the arcs' bulge for any turn up to a full slice, from any start heading.
    const rng = createRng(61);
    for (let n = 0; n < 200; n += 1) {
      const turn = rng.range(-MAX_SWEEP_ROTATION, MAX_SWEEP_ROTATION);
      const before = pose(0, 0, rng.range(-Math.PI, Math.PI));
      const after = pose(rng.range(-1, 1), rng.range(-1, 1), before.heading + turn);
      const margin = turnMargin(turn, PHYSICS);
      const hull = convexHull([...vehicleFootprint(before, PHYSICS), ...vehicleFootprint(after, PHYSICS)]);
      for (let i = 1; i < 32; i += 1) {
        const t = i / 32;
        const mid = pose(after.position.x * t, after.position.y * t, before.heading + turn * t);
        for (const corner of vehicleFootprint(mid, PHYSICS)) {
          expect(distanceOutside(hull, corner)).toBeLessThanOrEqual(margin + 1e-12);
        }
      }
    }
  });

  it('does not flag a car driving parallel to a wall 1 mm away', () => {
    let car: Car = { vehicle: { ...pose(5, 1.001), speed: PHYSICS.maxSpeed }, crashed: false };
    for (let i = 0; i < 200; i += 1) car = stepCar(car, FULL_THROTTLE, BOX, PHYSICS, DT);
    expect(car.crashed).toBe(false);
    expect(car.vehicle.position.y).toBe(1.001);
  });
});

describe('crash response', () => {
  it('stops a car driving into the wall at its last clear pose, flags it, and keeps it there', () => {
    let car = createCar(oval.start, oval, PHYSICS);
    let ticks = 0;
    let previous = car;
    while (!car.crashed && ticks < 3000) {
      previous = car;
      car = stepCar(car, FULL_THROTTLE, oval, PHYSICS, DT);
      ticks += 1;
    }
    expect(car.crashed).toBe(true);
    expect(car.vehicle.speed).toBe(0);
    expect(car.vehicle.position).toEqual(previous.vehicle.position);
    expect(car.vehicle.heading).toBe(previous.vehicle.heading);
    expect(footprintHitsTrack(vehicleFootprint(car.vehicle, PHYSICS), oval)).toBe(false);
    // Straight along the bottom straight (y = 40) into the right-hand curve's outer wall.
    expect(car.vehicle.position.x).toBeGreaterThan(60);
    expect(car.vehicle.position.x).toBeLessThan(85);
    expect(car.vehicle.position.y).toBe(40);

    // Further steps, whatever the controls, change nothing.
    let after = car;
    for (let i = 0; i < 100; i += 1) after = stepCar(after, { steering: -1, throttle: 1, brake: 0 }, oval, PHYSICS, DT);
    expect(after).toBe(car);
  });

  it('gives the same crash tick and pose on every run', () => {
    const run = () => {
      let car = createCar(oval.start, oval, PHYSICS);
      let ticks = 0;
      while (!car.crashed) {
        car = stepCar(car, { steering: 0.2, throttle: 1, brake: 0 }, oval, PHYSICS, DT);
        ticks += 1;
      }
      return { ticks, car };
    };
    expect(run()).toEqual(run());
  });
});

describe('the built-in track', () => {
  /** Rear-axle poses along the centre line, facing along the track: two straights and two semicircles. */
  function centreLine(): Pose[] {
    const poses: Pose[] = [];
    for (let x = -60; x <= 60; x += 1) poses.push(pose(x, 40, 0), pose(x, -40, Math.PI));
    for (let a = 0; a <= 180; a += 1) {
      const t = (a * Math.PI) / 180;
      // Right-hand curve, centre (60, 0), driven from the bottom (y = 40) round to the top.
      poses.push(pose(60 + 40 * Math.sin(t), 40 * Math.cos(t), -t));
      poses.push(pose(-60 - 40 * Math.sin(t), -40 * Math.cos(t), Math.PI - t));
    }
    return poses;
  }

  it('reports no contact anywhere along the centre line', () => {
    const clear = centreLine().filter((p) => !footprintHitsTrack(vehicleFootprint(p, PHYSICS), oval));
    expect(clear).toHaveLength(centreLine().length);
  });

  /** Samples the step as `samples` evenly interpolated poses and checks each one on its own. */
  function denseHit(before: Pose, after: Pose, samples: number): boolean {
    const turn = wrapAngle(after.heading - before.heading);
    for (let i = 0; i <= samples; i += 1) {
      const t = i / samples;
      const p = pose(
        before.position.x + (after.position.x - before.position.x) * t,
        before.position.y + (after.position.y - before.position.y) * t,
        before.heading + turn * t,
      );
      if (footprintHitsTrack(vehicleFootprint(p, PHYSICS), oval)) return true;
    }
    return false;
  }

  it('never lets a car at top speed pass a wall: every accepted step is clear when sampled finely', () => {
    // Cars from the centre line at top speed, aimed off the track at angles from 5° to 90°.
    let runs = 0;
    const starts = centreLine().filter((_, i) => i % 15 === 0);
    for (const start of starts) {
      for (const angle of [5, 20, 45, 90, -5, -20, -45, -90]) {
        const aimed = { ...start, heading: start.heading + (angle * Math.PI) / 180 };
        if (footprintHitsTrack(vehicleFootprint(aimed, PHYSICS), oval)) continue;
        let car: Car = { vehicle: { ...aimed, speed: PHYSICS.maxSpeed }, crashed: false };
        for (let tick = 0; tick < 600 && !car.crashed; tick += 1) {
          const next = stepCar(car, FULL_THROTTLE, oval, PHYSICS, DT);
          if (!next.crashed) expect(denseHit(car.vehicle, next.vehicle, 16)).toBe(false);
          car = next;
        }
        expect(car.crashed).toBe(true);
        runs += 1;
      }
    }
    expect(runs).toBeGreaterThan(250);
  });

  it('agrees with fine sampling for seeded random driving', () => {
    const rng = createRng(6);
    let crashes = 0;
    let steps = 0;
    for (let n = 0; n < 60; n += 1) {
      let car = createCar(oval.start, oval, PHYSICS);
      let controls: Controls = NO_CONTROLS;
      for (let tick = 0; tick < 900 && !car.crashed; tick += 1) {
        if (tick % 20 === 0) controls = { steering: rng.range(-1, 1), throttle: rng.next(), brake: rng.next() * 0.3 };
        const next = stepCar(car, controls, oval, PHYSICS, DT);
        if (!next.crashed) expect(denseHit(car.vehicle, next.vehicle, 16)).toBe(false);
        car = next;
        steps += 1;
      }
      if (car.crashed) crashes += 1;
    }
    expect(crashes).toBeGreaterThan(10);
    expect(steps).toBeGreaterThan(10_000);
  });
});
