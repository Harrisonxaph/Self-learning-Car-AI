// Ray sensors (P2-01). Expected values come from geometry worked out by hand in each test (closed-form
// expressions or an independent line intersection), never from the code under test.
import { describe, expect, it } from 'vitest';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import {
  DEFAULT_SENSOR_CONFIG,
  LINE_TOLERANCE,
  RAY_COUNT,
  castRay,
  castRays,
  resolveSensorConfig,
  sensorOrigin,
  type SensorConfig,
} from '../../src/sensors/rays';
import { vehicleFootprint } from '../../src/sim/collision';
import { DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { loadTrack, type Pose, type Track, type Vec2 } from '../../src/sim/track';
import { createRng } from '../../src/utils/rng';

const EPS = 1e-9;
const track = loadTrack(stadiumOval);
const physics = DEFAULT_VEHICLE_PHYSICS;
const deg = (d: number) => (d * Math.PI) / 180;
const p = (x: number, y: number): Vec2 => ({ x, y });
/** A single straight wall: a two-point closed boundary. */
const wall = (a: Vec2, b: Vec2): Vec2[] => [a, b];
const ORIGIN = p(0, 0);

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

describe('sensor configuration', () => {
  it('defaults to the MODEL_FORMAT sensors block, frozen, with the body-centre origin', () => {
    expect(DEFAULT_SENSOR_CONFIG).toEqual({ origin: 'body-centre', anglesDegrees: [-90, -60, -30, 0, 30, 60, 90], maxDistance: 50 });
    expect(RAY_COUNT).toBe(7);
    expect(Object.isFrozen(DEFAULT_SENSOR_CONFIG)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SENSOR_CONFIG.anglesDegrees)).toBe(true);
  });

  it('returns a frozen copy that later changes to the input cannot affect', () => {
    const input = { origin: 'body-centre', anglesDegrees: [-80, -50, -20, 0, 20, 50, 80], maxDistance: 30 };
    const resolved = resolveSensorConfig(input);
    input.anglesDegrees[0] = -90;
    input.maxDistance = 1;
    expect(resolved).toEqual({ origin: 'body-centre', anglesDegrees: [-80, -50, -20, 0, 20, 50, 80], maxDistance: 30 });
    expect(Object.isFrozen(resolved.anglesDegrees)).toBe(true);
  });

  const base = { origin: 'body-centre', anglesDegrees: [-90, -60, -30, 0, 30, 60, 90], maxDistance: 50 };
  const invalid: [string, unknown, RegExp][] = [
    ['range 0', { ...base, maxDistance: 0 }, /maxDistance/],
    ['negative range', { ...base, maxDistance: -1 }, /maxDistance/],
    ['NaN range', { ...base, maxDistance: NaN }, /maxDistance/],
    ['infinite range', { ...base, maxDistance: Infinity }, /maxDistance/],
    ['negative infinite range', { ...base, maxDistance: -Infinity }, /maxDistance/],
    ['range given as text', { ...base, maxDistance: '50' }, /maxDistance/],
    ['6 angles', { ...base, anglesDegrees: [-90, -60, -30, 30, 60, 90] }, /exactly 7/],
    ['8 angles', { ...base, anglesDegrees: [-90, -60, -30, -10, 10, 30, 60, 90] }, /exactly 7/],
    ['unsorted angles', { ...base, anglesDegrees: [-90, -30, -60, 0, 30, 60, 90] }, /strictly increasing/],
    ['a repeated angle', { ...base, anglesDegrees: [-90, -60, -30, 0, 0, 60, 90] }, /strictly increasing/],
    ['an angle of 91', { ...base, anglesDegrees: [-90, -60, -30, 0, 30, 60, 91] }, /anglesDegrees\[6\]/],
    ['an angle of −91', { ...base, anglesDegrees: [-91, -60, -30, 0, 30, 60, 90] }, /anglesDegrees\[0\]/],
    ['a NaN angle', { ...base, anglesDegrees: [-90, -60, NaN, 0, 30, 60, 90] }, /anglesDegrees\[2\]/],
    ['angles not an array', { ...base, anglesDegrees: 'all' }, /exactly 7/],
    ['an unknown origin', { ...base, origin: 'nose' }, /origin/],
    ['a missing origin', { anglesDegrees: base.anglesDegrees, maxDistance: 50 }, /origin/],
    ['null', null, /object/],
  ];

  it.each(invalid)('rejects %s with a RangeError naming the field', (_name, input, message) => {
    expect(() => resolveSensorConfig(input)).toThrow(RangeError);
    expect(() => resolveSensorConfig(input)).toThrow(message);
  });

  it.each(invalid.filter(([, input]) => input !== null))('castRays also rejects %s passed without resolving', (_name, input) => {
    expect(() => castRays(track.start, track, physics, input as SensorConfig)).toThrow(RangeError);
  });
});

describe('castRay input checks', () => {
  const walls = [wall(p(10, -5), p(10, 5))];
  it.each([
    ['a NaN angle', () => castRay(ORIGIN, NaN, 50, walls), /angle/],
    ['an infinite angle', () => castRay(ORIGIN, Infinity, 50, walls), /angle/],
    ['a NaN origin', () => castRay(p(NaN, 0), 0, 50, walls), /origin/],
    ['an infinite origin', () => castRay(p(0, -Infinity), 0, 50, walls), /origin/],
    ['range 0', () => castRay(ORIGIN, 0, 0, walls), /maxDistance/],
    ['a negative range', () => castRay(ORIGIN, 0, -5, walls), /maxDistance/],
    ['a NaN range', () => castRay(ORIGIN, 0, NaN, walls), /maxDistance/],
    ['an infinite range', () => castRay(ORIGIN, 0, Infinity, walls), /maxDistance/],
  ])('throws a RangeError for %s', (_name, call, message) => {
    expect(call).toThrow(RangeError);
    expect(call).toThrow(message);
  });

  it.each([
    ['a NaN x', { position: p(NaN, 40), heading: 0 }],
    ['an infinite y', { position: p(-6, Infinity), heading: 0 }],
    ['a NaN heading', { position: p(-6, 40), heading: NaN }],
  ])('castRays throws a RangeError for a pose with %s', (_name, pose) => {
    expect(() => castRays(pose, track, physics, DEFAULT_SENSOR_CONFIG)).toThrow(RangeError);
  });

  it.each([0, -2.5, NaN, Infinity])('castRays throws a RangeError for wheelbase %s', (wheelbase) => {
    expect(() => castRays(track.start, track, { wheelbase }, DEFAULT_SENSOR_CONFIG)).toThrow(/wheelbase/);
  });
});

describe('ray origin', () => {
  it('is the centre of the collision footprint: half a wheelbase ahead of the rear axle', () => {
    for (const pose of [track.start, { position: p(12.5, -3), heading: 2.2 }, { position: p(-80, 10), heading: -0.7 }]) {
      const corners = vehicleFootprint(pose, physics);
      const centroid = p(corners.reduce((s, c) => s + c.x, 0) / 4, corners.reduce((s, c) => s + c.y, 0) / 4);
      const origin = sensorOrigin(pose, physics);
      expect(origin.x).toBeCloseTo(centroid.x, 12);
      expect(origin.y).toBeCloseTo(centroid.y, 12);
    }
    // The stadium start: rear axle (−6, 40), heading 0, so the origin is 1.25 m ahead at (−4.75, 40).
    expect(sensorOrigin(track.start, physics)).toEqual(p(-4.75, 40));
  });
});

describe('the stadium oval from the start pose (origin (−4.75, 40), heading 0)', () => {
  // The bottom straight's boundaries are the segments (−60, 33)–(60, 33) (inner) and (−60, 47)–(60, 47)
  // (outer), 7 m either side of the origin. A ray at angle a from the heading meets one of them after
  // 7 / sin|a|. Positive angles turn towards +y, so they meet the outer boundary.
  const readings = castRays(track.start, track, physics, DEFAULT_SENSOR_CONFIG);
  const expected: [number, number][] = [
    [-90, 7],
    [-60, 7 / Math.sin(deg(60))],
    [-30, 14],
    [30, 14],
    [60, 7 / Math.sin(deg(60))],
    [90, 7],
  ];

  it.each(expected)('the %s° ray hits the straight after %s m', (angle, distance) => {
    const ray = readings.rays[DEFAULT_SENSOR_CONFIG.anglesDegrees.indexOf(angle)]!;
    expect(ray.hit).toBe(true);
    expect(Math.abs(ray.distance - distance)).toBeLessThan(EPS);
    expect(Math.abs(ray.normalised - distance / 50)).toBeLessThan(EPS);
    expect(Math.abs(ray.end.y - (angle < 0 ? 33 : 47))).toBeLessThan(EPS);
  });

  it('reads 7 m (0.14) at ±90° and 8.0829037686547… m at ±60°', () => {
    expect(readings.rays[0]!.normalised).toBeCloseTo(0.14, 12);
    expect(readings.rays[6]!.normalised).toBeCloseTo(0.14, 12);
    expect(readings.rays[1]!.distance).toBeCloseTo(8.0829037686547, 12);
  });

  it('sees nothing within 50 m straight ahead: raw 50, normalised 1, clear', () => {
    const ahead = readings.rays[3]!;
    expect(ahead).toMatchObject({ distance: 50, normalised: 1, hit: false });
    expect(ahead.end).toEqual(p(45.25, 40));
  });

  it('with a 100 m range, the 0° ray hits outer segment 2 where the polygon says it does', () => {
    // Outer segment 2 runs from outer[2] to outer[3]. The ray is the line y = 40 going +x from x = −4.75.
    const a = stadiumOval.outer[2]!;
    const b = stadiumOval.outer[3]!;
    expect([a, b]).toEqual([{ x: 83.5, y: 40.703 }, { x: 93.234, y: 33.234 }]);
    const x = a.x + ((40 - a.y) * (b.x - a.x)) / (b.y - a.y);
    const long = castRays(track.start, track, physics, resolveSensorConfig({ ...DEFAULT_SENSOR_CONFIG, maxDistance: 100 }));
    expect(long.rays[3]!.hit).toBe(true);
    expect(Math.abs(long.rays[3]!.distance - (x + 4.75))).toBeLessThan(EPS);
    expect(long.rays[3]!.distance).toBeCloseTo(89.1661871736511, 9);
  });

  it('returns seven finite readings in [0, 1]', () => {
    expect(readings.rays).toHaveLength(7);
    for (const ray of readings.rays) {
      expect(Number.isFinite(ray.distance)).toBe(true);
      expect(ray.normalised).toBeGreaterThanOrEqual(0);
      expect(ray.normalised).toBeLessThanOrEqual(1);
    }
  });
});

describe('straight and angled walls', () => {
  it('a perpendicular ray hits a straight wall at exactly its offset', () => {
    expect(castRay(ORIGIN, 0, 50, [wall(p(10, -5), p(10, 5))])).toEqual({ distance: 10, hit: true });
    expect(castRay(p(1, 2), deg(-90), 50, [wall(p(-5, -6), p(5, -6))]).distance).toBeCloseTo(8, 12);
  });

  // A wall whose normal points at angle phi, at perpendicular distance 10 from the origin. A ray at angle
  // theta reaches it after 10 / cos(theta − phi).
  const angledWall = (phiDegrees: number) => {
    const phi = deg(phiDegrees);
    const foot = p(10 * Math.cos(phi), 10 * Math.sin(phi));
    const along = p(-Math.sin(phi), Math.cos(phi));
    return wall(p(foot.x - 100 * along.x, foot.y - 100 * along.y), p(foot.x + 100 * along.x, foot.y + 100 * along.y));
  };
  it.each([
    [0, 30],
    [0, 45],
    [0, 60],
    [30, 0],
    [30, 30],
    [45, -20],
    [45, 80],
  ])('wall normal at %s°, ray at %s°: perpendicular distance ÷ cos(incidence)', (phi, theta) => {
    const hit = castRay(ORIGIN, deg(theta), 50, [angledWall(phi)]);
    expect(hit.hit).toBe(true);
    expect(Math.abs(hit.distance - 10 / Math.cos(deg(theta - phi)))).toBeLessThan(EPS);
  });
});

describe('range', () => {
  it('a wall beyond the range reads exactly maxDistance (normalised 1) and no hit', () => {
    expect(castRay(ORIGIN, 0, 50, [wall(p(60, -5), p(60, 5))])).toEqual({ distance: 50, hit: false });
  });

  it('a wall exactly at maxDistance is a hit at maxDistance', () => {
    expect(castRay(ORIGIN, 0, 50, [wall(p(50, -5), p(50, 5))])).toEqual({ distance: 50, hit: true });
  });

  it('a wall 1e-6 m beyond maxDistance is clear', () => {
    expect(castRay(ORIGIN, 0, 50, [wall(p(50 + 1e-6, -5), p(50 + 1e-6, 5))])).toEqual({ distance: 50, hit: false });
  });

  it('no boundaries at all is clear', () => {
    expect(castRay(ORIGIN, 1, 50, [])).toEqual({ distance: 50, hit: false });
  });
});

describe('edge rules', () => {
  it('an origin on a boundary reads 0 whichever way the ray points: into, along or away from the wall', () => {
    const walls = [wall(p(0, -5), p(0, 5))];
    for (const angle of [0, Math.PI, Math.PI / 2, -Math.PI / 2, deg(135), deg(-20)]) {
      expect(castRay(ORIGIN, angle, 50, walls)).toEqual({ distance: 0, hit: true });
    }
    // Also at a segment's end point.
    expect(castRay(p(0, 5), Math.PI, 50, walls)).toEqual({ distance: 0, hit: true });
  });

  it('a nearly parallel wall (1e-3 rad incidence) is hit after d / sin(a)', () => {
    const a = 1e-3;
    const d = 0.01;
    const hit = castRay(ORIGIN, a, 50, [wall(p(-1000, d), p(1000, d))]);
    expect(hit.hit).toBe(true);
    expect(Math.abs(hit.distance - d / Math.sin(a))).toBeLessThan(EPS);
  });

  it('an exactly parallel wall that is not collinear is not hit', () => {
    expect(castRay(ORIGIN, 0, 50, [wall(p(-10, 1), p(10, 1))])).toEqual({ distance: 50, hit: false });
  });

  it('a collinear wall ahead is hit at its nearer end, in either point order', () => {
    expect(castRay(ORIGIN, 0, 50, [wall(p(3, 0), p(8, 0))])).toEqual({ distance: 3, hit: true });
    expect(castRay(ORIGIN, 0, 50, [wall(p(8, 0), p(3, 0))])).toEqual({ distance: 3, hit: true });
    expect(castRay(ORIGIN, -Math.PI / 2, 50, [wall(p(0, -9), p(0, -4))]).distance).toBeCloseTo(4, 12);
  });

  it('the line tolerance is tiny: a parallel wall 1e-9 m off the ray line is not hit', () => {
    expect(LINE_TOLERANCE).toBe(1e-12);
    expect(castRay(ORIGIN, -Math.PI / 2, 50, [wall(p(1e-9, -9), p(1e-9, -4))])).toEqual({ distance: 50, hit: false });
    expect(castRay(ORIGIN, 0, 50, [wall(p(3, 1e-9), p(8, 1e-9))])).toEqual({ distance: 50, hit: false });
  });

  it('a collinear wall wholly behind the origin is ignored', () => {
    expect(castRay(ORIGIN, 0, 50, [wall(p(-8, 0), p(-3, 0))])).toEqual({ distance: 50, hit: false });
  });

  it('a collinear wall containing the origin reads 0', () => {
    expect(castRay(ORIGIN, 0, 50, [wall(p(-2, 0), p(2, 0))])).toEqual({ distance: 0, hit: true });
  });

  it('the nearest hit wins across inner and outer boundaries, in either order', () => {
    const near = wall(p(5, -1), p(5, 1));
    const far = wall(p(8, -1), p(8, 1));
    expect(castRay(ORIGIN, 0, 50, [near, far]).distance).toBe(5);
    expect(castRay(ORIGIN, 0, 50, [far, near]).distance).toBe(5);
  });

  it('hits behind the origin are ignored', () => {
    expect(castRay(ORIGIN, 0, 50, [wall(p(-5, -1), p(-5, 1))])).toEqual({ distance: 50, hit: false });
    expect(castRay(ORIGIN, 0, 50, [wall(p(-5, -1), p(-5, 1)), wall(p(7, -1), p(7, 1))]).distance).toBe(7);
  });

  it('a ray through a vertex shared by two segments hits the vertex', () => {
    // A V pointing back at the origin: its tip (5, 0) is shared by both arms.
    expect(castRay(ORIGIN, 0, 50, [[p(10, -5), p(5, 0), p(10, 5)]])).toEqual({ distance: 5, hit: true });
  });

  it('never slips between two segments at a shared vertex, at angles within 1e-9 rad of it', () => {
    const vertex = p(3.7, 2.9);
    const loop = [p(9.1, -1.3), vertex, p(8.2, 7.7)];
    const toVertex = Math.atan2(vertex.y, vertex.x);
    const distance = Math.hypot(vertex.x, vertex.y);
    for (let i = -1000; i <= 1000; i += 1) {
      const hit = castRay(ORIGIN, toVertex + i * 1e-12, 50, [loop]);
      expect(hit.hit).toBe(true);
      expect(Math.abs(hit.distance - distance)).toBeLessThan(1e-6);
    }
    expect(Math.abs(castRay(ORIGIN, toVertex, 50, [loop]).distance - distance)).toBeLessThan(EPS);
  });

  it('from inside a concave corner, rays meet each wall and the corner itself where expected', () => {
    // A 10 m square room; the origin is 2 m from the left wall and 3 m from the top wall.
    const room = [p(0, 0), p(10, 0), p(10, 10), p(0, 10)];
    const origin = p(2, 3);
    expect(castRay(origin, Math.PI, 50, [room]).distance).toBeCloseTo(2, 12);
    expect(castRay(origin, -Math.PI / 2, 50, [room]).distance).toBeCloseTo(3, 12);
    expect(castRay(origin, deg(-150), 50, [room]).distance).toBeCloseTo(2 / Math.cos(deg(30)), 12);
    const toCorner = castRay(origin, Math.atan2(-3, -2), 50, [room]);
    expect(toCorner.hit).toBe(true);
    expect(Math.abs(toCorner.distance - Math.hypot(2, 3))).toBeLessThan(EPS);
  });

  it('near a convex corner, rays either side meet its two faces and a ray at the corner hits it', () => {
    // A square block from (5, 5) to (8, 8), seen from the origin (2, 3); its near corner is (5, 5).
    const block = [p(5, 5), p(8, 5), p(8, 8), p(5, 8)];
    const origin = p(2, 3);
    const toCorner = Math.atan2(2, 3);
    expect(Math.abs(castRay(origin, toCorner, 50, [block]).distance - Math.hypot(3, 2))).toBeLessThan(EPS);
    // Slightly steeper: meets the face x = 5 at y > 5. Slightly shallower: meets the face y = 5 at x > 5.
    const steeper = toCorner + 0.1;
    expect(Math.abs(castRay(origin, steeper, 50, [block]).distance - 3 / Math.cos(steeper))).toBeLessThan(EPS);
    const shallower = toCorner - 0.1;
    expect(Math.abs(castRay(origin, shallower, 50, [block]).distance - 2 / Math.sin(shallower))).toBeLessThan(EPS);
    // Missing the block altogether.
    expect(castRay(origin, deg(-10), 50, [block]).hit).toBe(false);
  });

  it('an origin off the road (a car past the oval) still reports the nearest boundary', () => {
    // Rear axle at (0, 60), heading 0: the origin (1.25, 60) is 13 m outside the outer straight y = 47.
    const readings = castRays({ position: p(0, 60), heading: 0 }, track, physics, DEFAULT_SENSOR_CONFIG);
    expect(readings.rays[0]!.hit).toBe(true);
    expect(Math.abs(readings.rays[0]!.distance - 13)).toBeLessThan(EPS);
  });
});

/** An independent ray cast: classic parametric (Cramer's rule) intersection with every segment. */
function referenceCast(origin: Vec2, angle: number, maxDistance: number, t: Track): number {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let best = Infinity;
  for (const loop of [t.outer, t.inner]) {
    for (let i = 0; i < loop.length; i += 1) {
      const a = loop[i]!;
      const b = loop[(i + 1) % loop.length]!;
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const den = dx * ey - dy * ex;
      if (den === 0) continue;
      const wx = a.x - origin.x;
      const wy = a.y - origin.y;
      const along = (wx * ey - wy * ex) / den;
      const u = (wx * dy - wy * dx) / den;
      if (along >= 0 && u >= 0 && u <= 1) best = Math.min(best, along);
    }
  }
  return Math.min(best, maxDistance);
}

describe('agreement and invariants over seeded poses', () => {
  const rng = createRng(1201);
  const poses: Pose[] = Array.from({ length: 400 }, () => ({
    position: p(rng.range(-115, 115), rng.range(-55, 55)),
    heading: rng.range(-Math.PI, Math.PI),
  }));

  it('matches an independent intersection, stays in range and puts every end on the ray', () => {
    for (const pose of poses) {
      const readings = castRays(pose, track, physics, DEFAULT_SENSOR_CONFIG);
      for (const ray of readings.rays) {
        expect(Math.abs(ray.distance - referenceCast(readings.origin, ray.angle, 50, track))).toBeLessThan(EPS);
        expect(ray.distance).toBeGreaterThanOrEqual(0);
        expect(ray.distance).toBeLessThanOrEqual(50);
        expect(ray.normalised).toBe(ray.distance / 50);
        expect(ray.hit).toBe(referenceCast(readings.origin, ray.angle, Infinity, track) <= 50);
        expect(ray.end.x).toBeCloseTo(readings.origin.x + Math.cos(ray.angle) * ray.distance, 12);
        expect(ray.end.y).toBeCloseTo(readings.origin.y + Math.sin(ray.angle) * ray.distance, 12);
      }
    }
  });

  it('rotating and translating the whole scene with the car leaves every distance unchanged', () => {
    const turn = 0.83;
    const shift = p(-31.5, 17.25);
    const move = (q: Vec2) => p(q.x * Math.cos(turn) - q.y * Math.sin(turn) + shift.x, q.x * Math.sin(turn) + q.y * Math.cos(turn) + shift.y);
    const moved = loadTrack({ ...stadiumOval, outer: stadiumOval.outer.map(move), inner: stadiumOval.inner.map(move) });
    for (const pose of poses.slice(0, 100)) {
      const before = castRays(pose, track, physics, DEFAULT_SENSOR_CONFIG);
      const after = castRays({ position: move(pose.position), heading: pose.heading + turn }, moved, physics, DEFAULT_SENSOR_CONFIG);
      before.rays.forEach((ray, i) => expect(Math.abs(after.rays[i]!.distance - ray.distance)).toBeLessThan(EPS));
    }
  });

  it('mirroring the scene swaps left and right rays', () => {
    const flip = (q: Vec2) => p(q.x, -q.y);
    const mirrored = loadTrack({ ...stadiumOval, outer: stadiumOval.outer.map(flip), inner: stadiumOval.inner.map(flip) });
    for (const pose of poses.slice(0, 100)) {
      const before = castRays(pose, track, physics, DEFAULT_SENSOR_CONFIG);
      const after = castRays({ position: flip(pose.position), heading: -pose.heading }, mirrored, physics, DEFAULT_SENSOR_CONFIG);
      before.rays.forEach((ray, i) => expect(Math.abs(after.rays[6 - i]!.distance - ray.distance)).toBeLessThan(EPS));
    }
  });

  it('never changes its inputs and gives identical results on repeat calls', () => {
    const frozenTrack = deepFreeze(loadTrack(structuredClone(stadiumOval)));
    const frozenPhysics = deepFreeze({ ...physics });
    const config = deepFreeze(resolveSensorConfig({ ...DEFAULT_SENSOR_CONFIG }));
    for (const pose of poses.slice(0, 50)) {
      const frozenPose = deepFreeze(structuredClone(pose));
      const first = castRays(frozenPose, frozenTrack, frozenPhysics, config);
      expect(castRays(frozenPose, frozenTrack, frozenPhysics, config)).toEqual(first);
    }
  });
});
