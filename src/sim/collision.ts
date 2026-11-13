// Car–boundary collision: the car's rectangle against the track's two boundary polylines. Headless and pure.
//
// A car is on the road while its whole footprint lies strictly between the boundaries: inside the outer one,
// outside the inner one, and touching neither. Touching a boundary counts as a crash, so a contact is never
// missed by rounding the other way.
//
// Each step is checked as a sweep, not just at its end, so a fast car cannot jump over a wall between ticks.
// The sweep takes the convex hull of the footprint's corners before and after the step (or before and after
// each slice of a sharp turn, see MAX_SWEEP_ROTATION). For a straight move that hull is exactly the area the
// car passes over, at any speed, and the test is exact. While turning, points of the body move on arcs, which
// bulge out of the hull by up to reach × turn² / 8 (reach: the body's farthest point from the rear axle;
// turn: the slice's heading change; this bounds the gap between an arc and its chord). A turning sweep
// therefore also counts a boundary within that margin of the hull as a hit, so it never misses a contact;
// the price is that a turning car may be flagged up to that margin early: at most about 0.2 mm with the
// default timestep (at most 0.0225 rad per tick) and about 1.1 mm for a full 0.05 rad slice.
//
// The boundary tests look only at the segments near the car: a grid index over the track's segments (sim/trackIndex.ts, P2-11) picks which segments the exact
// tests below see, and never changes an answer (tests/sim/trackIndex.test.ts compares every result with the brute-force functions, which test every segment
// after a quick bounding-box rejection and are kept as the reference).
import type { VehiclePhysics } from './config';
import type { Pose, Track, Vec2 } from './track';
import { candidateBuffer, collectBoxCandidates, pointOnRoadIndexed, trackIndexOrNull, type TrackIndex } from './trackIndex';
import { createVehicle, stepVehicle, wrapAngle, type Controls, type VehicleState } from './vehicle';

/**
 * The largest heading change checked as one sweep, rad. A step that turns more is split into equal slices,
 * so the turning margin above stays small whatever the timestep. Default steps never need splitting.
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

/**
 * True if the footprint touches a boundary or is not on the road (for example wholly in the infield). Uses the track's index (sim/trackIndex.ts), which only
 * chooses which segments the exact tests see, so the answer is brute force's, bit for bit; a track that cannot be indexed uses brute force.
 */
export function footprintHitsTrack(footprint: readonly Vec2[], track: Track): boolean {
  const index = trackIndexOrNull(track);
  return index === null ? footprintHitsTrackBruteForce(footprint, track) : footprintHitsTrackIndexed(footprint, index);
}

/** `footprintHitsTrack` testing every boundary segment: the reference the indexed version must equal exactly (tests/sim/trackIndex.test.ts). */
export function footprintHitsTrackBruteForce(footprint: readonly Vec2[], track: Track): boolean {
  return shapeTouchesBoundary(footprint, track) || !pointOnRoad(footprint[0]!, track);
}

/** `footprintHitsTrack` through a built index. */
export function footprintHitsTrackIndexed(footprint: readonly Vec2[], index: TrackIndex): boolean {
  return shapeTouchesBoundaryIndexed(footprint, index) || !pointOnRoadIndexed(footprint[0]!, index);
}

/**
 * True if the car touches or crosses a boundary anywhere on its way from `before` to `after`, or ends off
 * the road. The motion between the two poses is taken as a straight line with the heading turning evenly.
 * Uses the track's index (see `footprintHitsTrack`): the same answer as brute force, bit for bit.
 */
export function sweepHitsTrack(before: Pose, after: Pose, track: Track, physics: VehiclePhysics): boolean {
  const index = trackIndexOrNull(track);
  return index === null ? sweepHitsTrackBruteForce(before, after, track, physics) : sweepHitsTrackIndexed(before, after, index, physics);
}

/** `sweepHitsTrack` testing every boundary segment: the reference the indexed version must equal exactly. */
export function sweepHitsTrackBruteForce(before: Pose, after: Pose, track: Track, physics: VehiclePhysics): boolean {
  return sweepSlices(before, after, physics, track, null);
}

/** `sweepHitsTrack` through a built index. */
export function sweepHitsTrackIndexed(before: Pose, after: Pose, index: TrackIndex, physics: VehiclePhysics): boolean {
  return sweepSlices(before, after, physics, null, index);
}

/** The sweep itself, with brute force (`track`) or an index: the slices, the margin and the order of tests are the same either way. */
function sweepSlices(before: Pose, after: Pose, physics: VehiclePhysics, track: Track | null, index: TrackIndex | null): boolean {
  const turn = wrapAngle(after.heading - before.heading);
  const slices = Math.max(1, Math.ceil(Math.abs(turn) / MAX_SWEEP_ROTATION));
  const margin = turnMargin(turn / slices, physics);
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
    const touches = index !== null ? shapeTouchesBoundaryIndexed([...from, ...to], index, margin) : shapeTouchesBoundary([...from, ...to], track!, margin);
    if (touches) return true;
    from = to;
  }
  return !(index !== null ? pointOnRoadIndexed(from[0]!, index) : pointOnRoad(from[0]!, track!));
}

/** The distance from the rear axle to the farthest point of the body, m. */
export function footprintReach(physics: VehiclePhysics): number {
  const overhang = (physics.vehicleLength - physics.wheelbase) / 2;
  return Math.hypot(Math.max(Math.abs(overhang), Math.abs(physics.wheelbase + overhang)), physics.vehicleWidth / 2);
}

/**
 * How far a body turning evenly by `turn` rad while moving in a straight line can bulge outside the convex
 * hull of its start and end footprints: reach × turn² / 8, the bound on how far a point's arc strays from the
 * straight chord (linear-interpolation error ≤ length² / 8 × curvature). 0 when not turning, so straight
 * moves are tested exactly.
 */
export function turnMargin(turn: number, physics: VehiclePhysics): number {
  return (footprintReach(physics) * turn * turn) / 8;
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
export function inPolygon(polygon: readonly Vec2[], p: Vec2): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** The distance from p to the closed segment a–b. */
function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Is the closed segment a–b within `margin` of the convex polygon (touching or inside counts as 0)? */
export function segmentNearConvex(a: Vec2, b: Vec2, polygon: readonly Vec2[], margin: number): boolean {
  if (inConvex(polygon, a)) return true;
  for (let k = 0; k < polygon.length; k += 1) {
    const c = polygon[k]!;
    const d = polygon[(k + 1) % polygon.length]!;
    if (segmentsTouch(a, b, c, d)) return true;
    // Two segments that do not touch are closest at an end point of one of them.
    if (
      margin > 0 &&
      Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b)) <= margin
    ) {
      return true;
    }
  }
  return false;
}

export function pointOnRoad(p: Vec2, track: Track): boolean {
  return inPolygon(track.outer, p) && !inPolygon(track.inner, p);
}

/**
 * Does any boundary segment come within `margin` of the convex hull of these points: cross or touch one of
 * its edges, lie inside it, or (for a positive margin) pass within that distance? With every segment tested,
 * a whole boundary loop inside the hull is caught by its own points.
 */
export function shapeTouchesBoundary(points: readonly Vec2[], track: Track, margin = 0): boolean {
  const convex = convexHull(points);
  // A quick bounding-box test skips segments that are clearly too far away (most of them), before the
  // detailed test. Not a spatial index: every segment is still looked at.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of convex) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  minX -= margin;
  minY -= margin;
  maxX += margin;
  maxY += margin;
  for (const loop of [track.outer, track.inner]) {
    for (let i = 0; i < loop.length; i += 1) {
      const a = loop[i]!;
      const b = loop[(i + 1) % loop.length]!;
      if (Math.max(a.x, b.x) < minX || Math.min(a.x, b.x) > maxX || Math.max(a.y, b.y) < minY || Math.min(a.y, b.y) > maxY) {
        continue;
      }
      if (segmentNearConvex(a, b, convex, margin)) return true;
    }
  }
  return false;
}

/** As `shapeTouchesBoundary`, with only the segments whose bounding box meets the (widened) shape box tested. */
export function shapeTouchesBoundaryIndexed(points: readonly Vec2[], index: TrackIndex, margin = 0): boolean {
  const convex = convexHull(points);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of convex) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  minX -= margin;
  minY -= margin;
  maxX += margin;
  maxY += margin;
  const count = collectBoxCandidates(index, minX, minY, maxX, maxY);
  const ids = candidateBuffer(index);
  const total = count < 0 ? index.segA.length : count;
  for (let k = 0; k < total; k += 1) {
    const id = count < 0 ? k : (ids[k] as number);
    const a = index.segA[id]!;
    const b = index.segB[id]!;
    if (Math.max(a.x, b.x) < minX || Math.min(a.x, b.x) > maxX || Math.max(a.y, b.y) < minY || Math.min(a.y, b.y) > maxY) continue;
    if (segmentNearConvex(a, b, convex, margin)) return true;
  }
  return false;
}
