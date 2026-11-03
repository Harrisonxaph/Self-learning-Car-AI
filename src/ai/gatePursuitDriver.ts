// A scripted gate-pursuit driver for the P2-09 braking feasibility check (docs/experiments/p2-09-plan.md §4).
// Generalised from the oval-only test helper tests/sim/ovalDriver.ts: instead of a hand-written centre line it
// follows the closed polyline through the midpoints of a track's gates, so it works on any track with gates.
//
// It steers by pure pursuit and sets a speed target from the curvature ahead. Its two modes differ in ONE thing:
// when the car is over the target speed by more than a margin, 'brake' applies the brake and 'coast' does not, so the
// car slows only by drag and rolling resistance. Steering, throttle, the target profile and every parameter are the
// same in both modes, so a difference between them is a difference the brake makes.
//
// This is physical feasibility only: a scripted driver, not a network. It says nothing about learned braking.
import type { Car } from '../sim/collision';
import type { VehiclePhysics } from '../sim/config';
import type { Track, Vec2 } from '../sim/track';
import { maxSteerAngle, wrapAngle, type Controls } from '../sim/vehicle';
import type { EpisodeDriver } from './drivers';

export const GATE_PURSUIT_ALGORITHM = 'gate-pursuit-v1';
/** The pure-pursuit look-ahead distance for steering, in metres (as `pursuit()` in tests/sim/ovalDriver.ts). */
export const STEER_LOOK_AHEAD_METERS = 8;
/** How far over the target speed, in m/s, the car must be before 'brake' mode brakes. */
export const OVERSPEED_MARGIN = 0.5;
export const BRAKE_MODES = Object.freeze(['brake', 'coast'] as const);
export type BrakeMode = (typeof BRAKE_MODES)[number];

/** The closed polyline through a track's gate midpoints, with the arc length at each point. */
export interface GateLoop {
  readonly points: readonly Vec2[];
  /** Arc length from points[0] to points[i] along the loop; cumulative[0] is 0. */
  readonly cumulative: readonly number[];
  /** The whole loop's length, including the segment from the last point back to the first. */
  readonly length: number;
}

const distance = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.y - a.y);

/** The loop through the midpoint of each gate, in driving order. Throws RangeError for a track with fewer than 3 gates. */
export function gateLoop(track: Track): GateLoop {
  if (track.gates.length < 3) throw new RangeError(`A gate loop needs at least 3 gates, got ${track.gates.length}.`);
  const points = track.gates.map((gate) => ({ x: (gate.a.x + gate.b.x) / 2, y: (gate.a.y + gate.b.y) / 2 }));
  const cumulative: number[] = [0];
  for (let i = 1; i < points.length; i += 1) cumulative.push(cumulative[i - 1]! + distance(points[i - 1]!, points[i]!));
  const length = cumulative[points.length - 1]! + distance(points[points.length - 1]!, points[0]!);
  return Object.freeze({ points: Object.freeze(points), cumulative: Object.freeze(cumulative), length });
}

const wrapLength = (loop: GateLoop, s: number): number => ((s % loop.length) + loop.length) % loop.length;

/** The point at arc length `s` along the loop (any real `s`; it wraps around). */
export function loopPoint(loop: GateLoop, s: number): Vec2 {
  const at = wrapLength(loop, s);
  const n = loop.points.length;
  let i = n - 1;
  while (i > 0 && loop.cumulative[i]! > at) i -= 1;
  const from = loop.points[i]!;
  const to = loop.points[(i + 1) % n]!;
  const segment = (i + 1 < n ? loop.cumulative[i + 1]! : loop.length) - loop.cumulative[i]!;
  const t = segment > 0 ? (at - loop.cumulative[i]!) / segment : 0;
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

/** The arc length of the loop point nearest to `position`. The lowest arc length wins a tie. */
export function nearestArcLength(loop: GateLoop, position: Vec2): number {
  const n = loop.points.length;
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < n; i += 1) {
    const from = loop.points[i]!;
    const to = loop.points[(i + 1) % n]!;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const squared = dx * dx + dy * dy;
    const t = squared > 0 ? Math.max(0, Math.min(1, ((position.x - from.x) * dx + (position.y - from.y) * dy) / squared)) : 0;
    const d = Math.hypot(position.x - (from.x + dx * t), position.y - (from.y + dy * t));
    if (d < bestDistance) [best, bestDistance] = [loop.cumulative[i]! + t * Math.sqrt(squared), d];
  }
  return best;
}

/**
 * The polyline's radius of curvature at arc length `s`: the circumradius of the midpoint nearest to `s` and its two
 * neighbours (the lowest index wins a tie). Infinity where those three points are collinear.
 */
export function radiusAt(loop: GateLoop, s: number): number {
  const at = wrapLength(loop, s);
  const n = loop.points.length;
  let k = 0;
  let bestGap = Infinity;
  for (let i = 0; i < n; i += 1) {
    const raw = Math.abs(at - loop.cumulative[i]!);
    const gap = Math.min(raw, loop.length - raw);
    if (gap < bestGap) [k, bestGap] = [i, gap];
  }
  const a = loop.points[(k + n - 1) % n]!;
  const b = loop.points[k]!;
  const c = loop.points[(k + 1) % n]!;
  const cross = Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x));
  if (cross < 1e-12) return Infinity;
  return (distance(a, b) * distance(b, c) * distance(c, a)) / (2 * cross);
}

export interface GatePursuitConfig {
  readonly mode: BrakeMode;
  /** The lateral acceleration the speed target allows in a corner, m/s². */
  readonly aLat: number;
  /** How far ahead along the loop the curvature is read for the speed target, m. */
  readonly lookAheadMeters: number;
  /** The speed target never exceeds this, m/s. */
  readonly vTop: number;
}

const CONFIG_KEYS: readonly string[] = ['mode', 'aLat', 'lookAheadMeters', 'vTop'];

function checkConfig(config: unknown): GatePursuitConfig {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) throw new RangeError('Gate-pursuit config must be an object.');
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.includes(key)) throw new RangeError(`Unknown gate-pursuit config field "${key}"; allowed: ${CONFIG_KEYS.join(', ')}.`);
  }
  const c = config as Record<string, unknown>;
  if (!BRAKE_MODES.includes(c.mode as BrakeMode)) throw new RangeError(`Gate-pursuit "mode" must be one of ${BRAKE_MODES.join(', ')}, got ${String(c.mode)}.`);
  for (const key of ['aLat', 'lookAheadMeters', 'vTop'] as const) {
    const value = c[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || !(value > 0)) throw new RangeError(`Gate-pursuit "${key}" must be a finite number greater than 0, got ${String(value)}.`);
  }
  return Object.freeze({ mode: c.mode as BrakeMode, aLat: c.aLat as number, lookAheadMeters: c.lookAheadMeters as number, vTop: c.vTop as number });
}

/** The speed target at arc length `s`: min(vTop, sqrt(aLat × R(s + lookAhead))). */
export function targetSpeed(loop: GateLoop, s: number, config: GatePursuitConfig): number {
  return Math.min(config.vTop, Math.sqrt(config.aLat * radiusAt(loop, s + config.lookAheadMeters)));
}

/**
 * A gate-pursuit driver for `track`. It keeps no state, so reset() does nothing and an instance evaluated twice
 * gives the same episode. Throws RangeError for an unknown field, a bad mode or parameter, or a track with fewer
 * than 3 gates.
 */
export function createGatePursuitDriver(track: Track, physics: VehiclePhysics, config: GatePursuitConfig): EpisodeDriver {
  const checked = checkConfig(config);
  const loop = gateLoop(track);
  return {
    decide(observation: { readonly car: Car }): Controls {
      const { position, heading, speed } = observation.car.vehicle;
      const s = nearestArcLength(loop, position);
      const target = loopPoint(loop, s + STEER_LOOK_AHEAD_METERS);
      const alpha = wrapAngle(Math.atan2(target.y - position.y, target.x - position.x) - heading);
      const wheel = Math.atan((2 * physics.wheelbase * Math.sin(alpha)) / STEER_LOOK_AHEAD_METERS);
      const steering = Math.max(-1, Math.min(1, wheel / maxSteerAngle(speed, physics)));
      const wanted = targetSpeed(loop, s, checked);
      return {
        steering,
        throttle: speed < wanted ? 1 : 0,
        brake: checked.mode === 'brake' && speed > wanted + OVERSPEED_MARGIN ? 1 : 0,
      };
    },
    reset() {},
  };
}
