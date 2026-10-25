// The network's nine inputs (P2-02): what a neural driver will see each tick. Headless and pure: reads the
// world and returns numbers; it never draws, never changes its inputs and never changes the simulation.
//
// Contract `seven-rays-speed-heading-v1` (docs/ARCHITECTURE.md "Sensors and network inputs"; the names are
// MODEL_FORMAT's `architecture.inputs`):
//   0–6  ray-90 … ray90   each ray's normalised distance from sensors/rays.ts, in the config's angle order
//                         (body-centre origin; 1 means nothing within range), in [0, 1]
//   7    speed            forward speed ÷ physics.maxSpeed, clamped to [0, 1]
//   8    headingError     signed angle from the heading to the next gate's centre ÷ π, in (−1, 1]
//
// Heading error:
// - Target: the midpoint of the gate that can count next (`progress.nextGate`, sim/checkpoints.ts).
// - Reference point: the rear axle (the vehicle state's `position`), the point checkpoints use for crossings,
//   so the target moves to the following gate on exactly the tick the gate is credited.
// - Sign: positive when the target is to the car's right (towards +y at heading 0), the side a positive
//   steering input turns towards; negative to the left; 0 straight ahead.
// - Wrapping: the angle is wrapped into (−π, π] (sim/vehicle.ts `wrapAngle`), so a target exactly behind
//   reads +1, and one just left of behind reads close to −1.
// - Degenerate case: a reference point exactly on the target (zero distance) has no direction; it reads 0.
// - A crashed car still has inputs, computed from the pose where it stopped.
import { castRays, DEFAULT_SENSOR_CONFIG, type SensorConfig } from '../sensors/rays';
import type { Racer } from '../sim/checkpoints';
import type { VehiclePhysics } from '../sim/config';
import type { Track, Vec2 } from '../sim/track';
import { wrapAngle } from '../sim/vehicle';

/** The input contract this module builds; saved models record it as `inputContract`. */
export const INPUT_CONTRACT = 'seven-rays-speed-heading-v1';

/** Number of network inputs: one per ray, then speed and heading error. */
export const INPUT_COUNT = 9;

/** Index of the speed input; the rays come before it, the heading error after it. */
export const SPEED_INPUT = 7;
export const HEADING_ERROR_INPUT = 8;

/** The input names for a sensor configuration, in input order, as MODEL_FORMAT's `architecture.inputs`. */
export function inputNames(config: SensorConfig = DEFAULT_SENSOR_CONFIG): readonly string[] {
  return Object.freeze([...config.anglesDegrees.map((degrees) => `ray${degrees}`), 'speed', 'headingError']);
}

/** The default input names: ray-90, ray-60, ray-30, ray0, ray30, ray60, ray90, speed, headingError. */
export const INPUT_NAMES = inputNames();

/** The centre of a gate: the midpoint of its two ends. */
export function gateCentre(track: Track, gateIndex: number): Vec2 {
  if (track.gates.length === 0) throw new RangeError('Track has no gates.');
  if (!Number.isInteger(gateIndex) || gateIndex < 0 || gateIndex >= track.gates.length) {
    throw new RangeError(`Gate index must be an integer from 0 to ${track.gates.length - 1}, got ${gateIndex}.`);
  }
  const { a, b } = track.gates[gateIndex]!;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Signed angle from `heading` to the direction from `from` to `target`, wrapped into (−π, π]: positive when
 * the target is to the right (towards +y at heading 0), 0 when `from` is exactly on the target.
 */
export function headingErrorRadians(from: Vec2, heading: number, target: Vec2): number {
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  if (dx === 0 && dy === 0) return 0;
  return wrapAngle(Math.atan2(dy, dx) - heading);
}

/** Forward speed ÷ maxSpeed, clamped to [0, 1]. Throws RangeError for a non-finite speed or a bad maxSpeed. */
export function normalisedSpeed(speed: number, maxSpeed: number): number {
  if (!Number.isFinite(maxSpeed) || !(maxSpeed > 0)) {
    throw new RangeError(`Physics "maxSpeed" must be a finite number greater than 0, got ${maxSpeed}.`);
  }
  if (!Number.isFinite(speed)) throw new RangeError(`Vehicle speed must be finite, got ${speed}.`);
  return Math.min(1, Math.max(0, speed / maxSpeed));
}

/**
 * The nine network inputs for one car, in contract order (see the top of this file). Pure and deterministic:
 * the same racer, track, physics and config always give the same values, and nothing passed in is changed.
 * Throws RangeError for a non-finite pose or speed, an invalid sensor config, wheelbase or maxSpeed, or a
 * `nextGate` that is not an index into the track's gates.
 */
export function buildInputs(
  racer: Racer,
  track: Track,
  physics: Pick<VehiclePhysics, 'wheelbase' | 'maxSpeed'>,
  config: SensorConfig = DEFAULT_SENSOR_CONFIG,
): readonly number[] {
  const { vehicle } = racer.car;
  const target = gateCentre(track, racer.progress.nextGate);
  const speed = normalisedSpeed(vehicle.speed, physics.maxSpeed);
  const rays = castRays(vehicle, track, physics, config).rays.map((ray) => ray.normalised);
  const headingError = headingErrorRadians(vehicle.position, vehicle.heading, target) / Math.PI;
  return Object.freeze([...rays, speed, headingError]);
}
