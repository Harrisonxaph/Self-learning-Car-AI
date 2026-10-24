// Car–boundary collision: the car's rectangle against the track's two boundary polylines. Headless and pure.
//
// A car is on the road while its whole footprint lies strictly between the boundaries: inside the outer one,
// outside the inner one, and touching neither. Touching a boundary counts as a crash, so a contact is never
// missed by rounding the other way.
//
// Each step is checked as a sweep, not just at its end, so a fast car cannot jump over a wall between ticks.
// The sweep takes the convex hull of the footprint's corners before and after the step (or before and after
// each slice of a sharp turn, see MAX_SWEEP_ROTATION). For a straight move that hull is exactly the area the
// car passes over, at any speed. While turning, the corners move on arcs instead of straight lines, and the
// hull can miss a sliver at most |corner| × (1 − cos(MAX_SWEEP_ROTATION / 2)) wide: about 1 mm for the
// default 4 × 2 m car. With the default timestep a car turns at most about 0.022 rad per tick, so the
// sliver is at most about 0.2 mm in practice.
//
// Every boundary segment is tested each tick. The built-in track has 52, so this is cheap; a spatial index
// (P2-11) waits until a measured track needs one.
import type { VehiclePhysics } from './config';
import type { Pose, Track, Vec2 } from './track';
import { createVehicle, stepVehicle, wrapAngle, type Controls, type VehicleState } from './vehicle';

/**
 * The largest heading change checked as one sweep, rad. A step that turns more is split into equal slices,
 * so the arc-versus-chord gap above stays bounded whatever the timestep. Default steps never need splitting.
 */
export const MAX_SWEEP_ROTATION = 0.05;

/** A car on a track: its motion, and whether it has hit a boundary. */
export interface Car {
  readonly vehicle: VehicleState;
  /** True once the car has touched or crossed a boundary. A crashed car stays stopped where it is. */
  readonly crashed: boolean;
}

/**
 * The car's body as four corners, in order: rear-right, front-right, front-left, rear-left ("right" is the
 * side a positive steering input turns towards, +y when the heading is 0).
 *
 * The state's position is the rear axle (sim/vehicle.ts). The body is `vehicleLength` × `vehicleWidth`,
 * centred on the midpoint between the axles, so it overhangs each axle by (vehicleLength − wheelbase) / 2:
 * 0.75 m for the defaults, giving a body from 0.75 m behind the rear axle to 3.25 m in front of it.
 */
export function vehicleFootprint(pose: Pose, physics: VehiclePhysics): [Vec2, Vec2, Vec2, Vec2] {
  const overhang = (physics.vehicleLength - physics.wheelbase) / 2;
  const back = -overhang;
  const front = physics.wheelbase + overhang;
  const half = physics.vehicleWidth / 2;
  const cos = Math.cos(pose.heading);
  const sin = Math.sin(pose.heading);
  // Forward is (cos, sin); right is forward turned a quarter turn towards +y: (−sin, cos).
  const at = (along: number, across: number): Vec2 => ({
    x: pose.position.x + cos * along - sin * across,
    y: pose.position.y + sin * along + cos * across,
  });
  return [at(back, half), at(front, half), at(front, -half), at(back, -half)];
}

/** True if the footprint touches a boundary or is not on the road (for example wholly in the infield). */
export function footprintHitsTrack(footprint: readonly Vec2[], track: Track): boolean {
  return shapeTouchesBoundary(footprint, track) || !pointOnRoad(footprint[0]!, track);
}

/**
 * True if the car touches or crosses a boundary anywhere on its way from `before` to `after`, or ends off
 * the road. The motion between the two poses is taken as a straight line with the heading turning evenly.
 */
export function sweepHitsTrack(before: Pose, after: Pose, track: Track, physics: VehiclePhysics): boolean {
  const turn = wrapAngle(after.heading - before.heading);
  const slices = Math.max(1, Math.ceil(Math.abs(turn) / MAX_SWEEP_ROTATION));
  let from = vehicleFootprint(before, physics);
  for (let i = 1; i <= slices; i += 1) {
    const t = i / slices;
    const pose: Pose =
      i === slices
        ? after
        : {
            position: {
              x: before.position.x + (after.position.x - before.position.x) * t,
              y: before.position.y + (after.position.y - before.position.y) * t,
            },
            heading: before.heading + turn * t,
          };
    const to = vehicleFootprint(pose, physics);
    if (shapeTouchesBoundary([...from, ...to], track)) return true;
    from = to;
  }
  return !pointOnRoad(from[0]!, track);
}

/** A stationary car at `pose`, already crashed if it starts touching a boundary or off the road. */
export function createCar(pose: Pose, track: Track, physics: VehiclePhysics): Car {
  const vehicle = createVehicle(pose);
  return { vehicle, crashed: footprintHitsTrack(vehicleFootprint(vehicle, physics), track) };
}

/**
 * Advances the car by one fixed timestep. If the step would touch or cross a boundary, the car instead
 * stops at its pose before the step (the last pose known to be clear, at most one step's travel short of
 * the wall: 0.40 m at top speed with the default timestep) and is marked crashed. A crashed car ignores
 * its controls and stays where it is; restarting is a separate action (P1-08).
 */
export function stepCar(car: Car, controls: Controls, track: Track, physics: VehiclePhysics, dt: number): Car {
  if (car.crashed) return car;
  const next = stepVehicle(car.vehicle, controls, physics, dt);
  if (!sweepHitsTrack(car.vehicle, next, track, physics)) return { vehicle: next, crashed: false };
  return { vehicle: { ...car.vehicle, speed: 0 }, crashed: true };
}

// ---- Geometry helpers. Exact comparisons: "touching" includes sharing a single point. ----

/** Twice the signed area of triangle a, b, c: positive if c is to the left of a→b in x-right, y-up terms. */
function orient(a: Vec2, b: Vec2, c: Vec2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** For a point known to be on the line through a and b: is it between them (inclusive)? */
function withinBox(a: Vec2, b: Vec2, p: Vec2): boolean {
  return (
    Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= p.y && p.y <= Math.max(a.y, b.y)
  );
}

/** Do the closed segments p1–p2 and q1–q2 share at least one point? */
export function segmentsTouch(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2): boolean {
  const d1 = orient(q1, q2, p1);
  const d2 = orient(q1, q2, p2);
  const d3 = orient(p1, p2, q1);
  const d4 = orient(p1, p2, q2);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return (
    (d1 === 0 && withinBox(q1, q2, p1)) ||
    (d2 === 0 && withinBox(q1, q2, p2)) ||
    (d3 === 0 && withinBox(p1, p2, q1)) ||
    (d4 === 0 && withinBox(p1, p2, q2))
  );
}

/**
 * The convex hull of the points (Andrew's monotone chain), with positive orientation and no repeated or
 * collinear points. Deterministic: the result depends only on the input values.
 */
export function convexHull(points: readonly Vec2[]): Vec2[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const half = (list: Vec2[]) => {
    const chain: Vec2[] = [];
    for (const p of list) {
      while (chain.length >= 2 && orient(chain[chain.length - 2]!, chain[chain.length - 1]!, p) <= 0) chain.pop();
      chain.push(p);
    }
    chain.pop();
    return chain;
  };
  return [...half(sorted), ...half(sorted.reverse())];
}

/** Is p inside or on the edge of a convex polygon with positive orientation (as convexHull returns)? */
function inConvex(polygon: readonly Vec2[], p: Vec2): boolean {
  return polygon.every((a, i) => orient(a, polygon[(i + 1) % polygon.length]!, p) >= 0);
}

/** Even-odd test; only called for points known not to lie on the polygon's edges. */
function inPolygon(polygon: readonly Vec2[], p: Vec2): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function pointOnRoad(p: Vec2, track: Track): boolean {
  return inPolygon(track.outer, p) && !inPolygon(track.inner, p);
}

/**
 * Does any boundary segment touch the convex hull of these points: cross or touch one of its edges, or lie
 * inside it? Checking each segment's first point covers a whole boundary loop inside the hull.
 */
function shapeTouchesBoundary(points: readonly Vec2[], track: Track): boolean {
  const convex = convexHull(points);
  for (const loop of [track.outer, track.inner]) {
    for (let i = 0; i < loop.length; i += 1) {
      const a = loop[i]!;
      const b = loop[(i + 1) % loop.length]!;
      if (inConvex(convex, a)) return true;
      for (let k = 0; k < convex.length; k += 1) {
        if (segmentsTouch(a, b, convex[k]!, convex[(k + 1) % convex.length]!)) return true;
      }
    }
  }
  return false;
}
