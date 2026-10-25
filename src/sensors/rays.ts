// Seven ray sensors (P2-01): how far the car can see along fixed directions before a track boundary.
// Headless and pure: reads the track and a pose, returns distances, and never changes its inputs.
//
// Contract (recorded in docs/ARCHITECTURE.md "Sensors and network inputs" and in each saved model's
// `training.configuration.sensors`, docs/MODEL_FORMAT.md):
// - Origin: the body centre, half a wheelbase ahead of the rear-axle reference (`sensorOrigin`). This is the
//   centre of the collision footprint, so ±90° rays read side clearance equally.
// - Angles: degrees relative to the heading, positive turning towards +y (the car's right, as for steering).
// - Range: `maxDistance` metres. A ray reports the distance to the nearest boundary point in [0, maxDistance];
//   nothing within range reports maxDistance. Normalised = distance ÷ maxDistance, so 1 means clear.
//
// Edge rules (each has its own test in tests/sensors/rays.test.ts):
// - Touching counts, as in collision: an origin lying on a boundary reads 0 in every direction.
// - A hit exactly at maxDistance counts as a hit (normalised 1); anything farther is clear.
// - Hits behind the origin are ignored. The nearest hit over both boundaries wins.
// - A ray through a vertex shared by two segments is found once, at the vertex: the side test for the shared
//   point is the same calculation for both segments, so rounding cannot let the ray slip between them.
// - A ray parallel to a segment misses it unless the two are collinear; then the nearest overlapping point
//   ahead counts, and an overlap wholly behind the origin is ignored. A boundary point within
//   LINE_TOLERANCE of the ray's line counts as on it, so a ray along a wall (for example a ±90° ray, whose
//   direction cos(π/2) rounds to 6e-17 rather than 0) is treated as collinear instead of missing the wall by
//   about 1e-15 m.
// - An origin off the road (for example a crashed car past a corner) still reports its nearest hit.
//
// Every boundary segment is tested for every ray (7 × 52 on the built-in track). A spatial index (P2-11)
// waits until a measured track needs one.
import type { VehiclePhysics } from '../sim/config';
import type { Pose, Track, Vec2 } from '../sim/track';

/** Where the rays start. Only the body centre is defined; it is part of the observation contract. */
export type SensorOrigin = 'body-centre';

export interface SensorConfig {
  readonly origin: SensorOrigin;
  /** One angle per ray, degrees from the heading, strictly increasing within [−90, 90]. */
  readonly anglesDegrees: readonly number[];
  /** Ray length, m. Finite and greater than 0. */
  readonly maxDistance: number;
}

/**
 * Distance from the ray's line within which a boundary point counts as on the line, m. Far below anything
 * the simulation can resolve, and far above the rounding in the side test (about 1e-14 m on this track).
 */
export const LINE_TOLERANCE = 1e-12;

/** The seven-ray API always casts exactly this many rays (network inputs 0–6). */
export const RAY_COUNT = 7;

/** One ray's result. */
export interface RayReading {
  /** World direction of the ray, rad (heading + angle). */
  readonly angle: number;
  /** Distance to the nearest boundary point, or maxDistance if none is in range, m. */
  readonly distance: number;
  /** distance ÷ maxDistance, in [0, 1]; 1 means clear. */
  readonly normalised: number;
  /** True if a boundary was found within maxDistance (including exactly at it). */
  readonly hit: boolean;
  /** The ray's end: the hit point, or the point maxDistance along the ray. */
  readonly end: Vec2;
}

export interface SensorReadings {
  readonly origin: Vec2;
  /** One reading per configured angle, in the same order. */
  readonly rays: readonly RayReading[];
}

/** The result of one ray cast against a set of boundaries. */
export interface RayHit {
  readonly distance: number;
  readonly hit: boolean;
}

/**
 * Checks a sensor configuration and returns a frozen copy. Throws RangeError naming the field if the origin
 * is unknown, there are not exactly RAY_COUNT angles, any angle is non-finite, outside [−90, 90] or not
 * strictly increasing, or maxDistance is not a finite number above 0.
 */
export function resolveSensorConfig(input: unknown): SensorConfig {
  checkSensorConfig(input);
  return Object.freeze({
    origin: input.origin,
    anglesDegrees: Object.freeze([...input.anglesDegrees]),
    maxDistance: input.maxDistance,
  });
}

/** The default configuration, matching docs/MODEL_FORMAT.md. */
export const DEFAULT_SENSOR_CONFIG: SensorConfig = resolveSensorConfig({
  origin: 'body-centre',
  anglesDegrees: [-90, -60, -30, 0, 30, 60, 90],
  maxDistance: 50,
});

function checkSensorConfig(input: unknown): asserts input is SensorConfig {
  if (typeof input !== 'object' || input === null) throw new RangeError('Sensor config must be an object.');
  const { origin, anglesDegrees, maxDistance } = input as Record<string, unknown>;
  if (origin !== 'body-centre') throw new RangeError(`Sensor config "origin" must be "body-centre", got ${String(origin)}.`);
  if (!Array.isArray(anglesDegrees) || anglesDegrees.length !== RAY_COUNT) {
    throw new RangeError(`Sensor config "anglesDegrees" must hold exactly ${RAY_COUNT} angles.`);
  }
  for (let i = 0; i < anglesDegrees.length; i += 1) {
    const angle: unknown = anglesDegrees[i];
    if (typeof angle !== 'number' || !Number.isFinite(angle) || angle < -90 || angle > 90) {
      throw new RangeError(`Sensor config "anglesDegrees[${i}]" must be a finite number in [-90, 90], got ${String(angle)}.`);
    }
    if (i > 0 && !(angle > (anglesDegrees[i - 1] as number))) {
      throw new RangeError(`Sensor config "anglesDegrees" must be strictly increasing (index ${i}).`);
    }
  }
  checkMaxDistance(maxDistance, 'Sensor config "maxDistance"');
}

function checkMaxDistance(value: unknown, what: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !(value > 0)) {
    throw new RangeError(`${what} must be a finite number greater than 0, got ${String(value)}.`);
  }
}

function checkPoint(p: Vec2, what: string): void {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new RangeError(`${what} must be finite, got (${p.x}, ${p.y}).`);
}

/**
 * The rays' origin: the rear-axle position moved half a wheelbase along the heading, which is the centre of
 * the collision footprint (sim/collision.ts `vehicleFootprint`). Throws RangeError for a non-finite pose or
 * a wheelbase that is not a finite number above 0.
 */
export function sensorOrigin(pose: Pose, physics: Pick<VehiclePhysics, 'wheelbase'>): Vec2 {
  checkPoint(pose.position, 'Sensor pose position');
  if (!Number.isFinite(pose.heading)) throw new RangeError(`Sensor pose heading must be finite, got ${pose.heading}.`);
  const { wheelbase } = physics;
  if (!Number.isFinite(wheelbase) || !(wheelbase > 0)) {
    throw new RangeError(`Physics "wheelbase" must be a finite number greater than 0, got ${wheelbase}.`);
  }
  const half = wheelbase / 2;
  return { x: pose.position.x + Math.cos(pose.heading) * half, y: pose.position.y + Math.sin(pose.heading) * half };
}

/**
 * Casts one ray from `origin` in world direction `angle` (radians from +x, turning towards +y) and returns
 * the distance to the nearest point of any boundary within `maxDistance`. Each boundary is a closed polyline:
 * its last point joins its first (a two-point boundary is a single wall). Taking an angle rather than a
 * vector means the direction is always a unit vector. Throws RangeError for a non-finite origin or angle, or
 * a maxDistance that is not a finite number above 0.
 */
export function castRay(origin: Vec2, angle: number, maxDistance: number, boundaries: readonly (readonly Vec2[])[]): RayHit {
  checkPoint(origin, 'Ray origin');
  if (!Number.isFinite(angle)) throw new RangeError(`Ray angle must be finite, got ${angle}.`);
  checkMaxDistance(maxDistance, 'Ray maxDistance');
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let nearest = Infinity;
  for (const loop of boundaries) {
    for (let i = 0; i < loop.length; i += 1) {
      const t = raySegment(origin, dx, dy, loop[i]!, loop[(i + 1) % loop.length]!);
      if (t < nearest) nearest = t;
    }
  }
  return nearest <= maxDistance ? { distance: nearest, hit: true } : { distance: maxDistance, hit: false };
}

/**
 * Casts every configured ray for a car at `pose` (its rear-axle reference, as stored in the vehicle state).
 * Pure and deterministic. Throws RangeError for an invalid config, a non-finite pose or an invalid wheelbase.
 */
export function castRays(pose: Pose, track: Track, physics: Pick<VehiclePhysics, 'wheelbase'>, config: SensorConfig): SensorReadings {
  checkSensorConfig(config);
  const origin = sensorOrigin(pose, physics);
  const boundaries = [track.outer, track.inner];
  const rays = config.anglesDegrees.map((degrees): RayReading => {
    const angle = pose.heading + (degrees * Math.PI) / 180;
    const { distance, hit } = castRay(origin, angle, config.maxDistance, boundaries);
    return {
      angle,
      distance,
      normalised: distance / config.maxDistance,
      hit,
      end: { x: origin.x + Math.cos(angle) * distance, y: origin.y + Math.sin(angle) * distance },
    };
  });
  return { origin, rays };
}

/**
 * Distance along the ray (origin o, unit direction d) to the nearest point of the closed segment a–b, or
 * Infinity if the ray does not reach it. Exact comparisons, as in sim/collision.ts.
 */
function raySegment(o: Vec2, dx: number, dy: number, a: Vec2, b: Vec2): number {
  // An origin on the segment touches it: 0 whichever way the ray points.
  const ax = a.x - o.x;
  const ay = a.y - o.y;
  const bx = b.x - o.x;
  const by = b.y - o.y;
  if (ax * by - ay * bx === 0 && Math.min(a.x, b.x) <= o.x && o.x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= o.y && o.y <= Math.max(a.y, b.y)) {
    return 0;
  }
  // Signed distance of each end from the ray's line (cross product with the unit direction); within
  // LINE_TOLERANCE counts as on the line.
  const sa = snap(dx * ay - dy * ax);
  const sb = snap(dx * by - dy * bx);
  if (sa === 0 && sb === 0) {
    // Collinear: the nearest overlapping point ahead of the origin. An overlap reaching back past the origin
    // starts at it (0); one wholly behind it is ignored.
    const ta = ax * dx + ay * dy;
    const tb = bx * dx + by * dy;
    if (ta < 0 && tb < 0) return Infinity;
    return Math.max(0, Math.min(ta, tb));
  }
  if ((sa > 0 && sb > 0) || (sa < 0 && sb < 0)) return Infinity;
  // The segment crosses or touches the ray's line at fraction s from a to b; s is exactly 0 or 1 when an end
  // lies on the line, so a shared vertex gives the same point for both of its segments.
  const s = sa / (sa - sb);
  const px = s === 1 ? bx : ax + (bx - ax) * s;
  const py = s === 1 ? by : ay + (by - ay) * s;
  const t = px * dx + py * dy;
  return t >= 0 ? t : Infinity;
}

const snap = (side: number): number => (Math.abs(side) <= LINE_TOLERANCE ? 0 : side);
