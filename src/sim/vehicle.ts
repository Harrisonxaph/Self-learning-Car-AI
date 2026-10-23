// One car's motion: a kinematic bicycle model stepped by the fixed simulation timestep. Headless and pure:
// each step returns a new state and never reads the clock, the screen or Math.random.
//
// Conventions (same as sim/track.ts): positions in world metres with y pointing down, headings in radians
// from +x turning towards +y. A positive steering input increases the heading, which on screen is a turn
// to the right (clockwise).
import type { VehiclePhysics } from './config';
import type { Pose, Vec2 } from './track';

export interface VehicleState {
  /** Rear-axle position, m. */
  readonly position: Vec2;
  /** Direction of travel, rad, kept in (-π, π]. */
  readonly heading: number;
  /** Forward speed, m/s. Never negative: there is no reverse in this version. */
  readonly speed: number;
}

/** One tick of driver input. */
export interface Controls {
  /** -1 (full left) to 1 (full right). */
  readonly steering: number;
  /** 0 to 1. */
  readonly throttle: number;
  /** 0 to 1. */
  readonly brake: number;
}

export const NO_CONTROLS: Controls = Object.freeze({ steering: 0, throttle: 0, brake: 0 });

/** A stationary car at the given pose, for example a track's start pose. */
export function createVehicle(pose: Pose): VehicleState {
  return { position: { x: pose.position.x, y: pose.position.y }, heading: pose.heading, speed: 0 };
}

/**
 * Checks and limits one tick of controls. A non-number or non-finite value (NaN, Infinity) is a bug in the
 * caller, so it throws RangeError rather than silently corrupting the car. Finite values outside the range
 * are clamped, because a driver asking for "more than full throttle" is harmless.
 */
export function clampControls(controls: Controls): Controls {
  const check = (value: unknown, name: string): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new RangeError(`Control "${name}" must be a finite number, got ${String(value)}.`);
    }
    return value;
  };
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  return {
    steering: clamp(check(controls.steering, 'steering'), -1, 1),
    throttle: clamp(check(controls.throttle, 'throttle'), 0, 1),
    brake: clamp(check(controls.brake, 'brake'), 0, 1),
  };
}

/**
 * The largest front-wheel angle allowed at this speed. At low speed it is maxSteerRadians; faster, it shrinks
 * so the turn never needs more sideways acceleration than maxLateralAcceleration
 * (lateral acceleration = speed² × tan(angle) / wheelbase).
 */
export function maxSteerAngle(speed: number, physics: VehiclePhysics): number {
  if (speed <= 0) return physics.maxSteerRadians;
  return Math.min(physics.maxSteerRadians, Math.atan((physics.maxLateralAcceleration * physics.wheelbase) / (speed * speed)));
}

/**
 * The longitudinal acceleration for these controls at this speed, m/s². It can be negative at rest (brake
 * stronger than throttle); stepVehicle then keeps the speed at 0, so brakes hold the car but never reverse it.
 */
export function acceleration(speed: number, controls: Controls, physics: VehiclePhysics): number {
  return (
    controls.throttle * physics.engineAcceleration -
    controls.brake * physics.brakeDeceleration -
    physics.quadraticDrag * speed * speed -
    physics.rollingResistance * speed
  );
}

const TWO_PI = 2 * Math.PI;
/** Keeps an angle in (-π, π] so it never grows without bound. */
function wrapAngle(angle: number): number {
  if (angle > Math.PI) return angle - TWO_PI;
  if (angle <= -Math.PI) return angle + TWO_PI;
  return angle;
}

/**
 * Advances the car by one fixed timestep `dt` (seconds), using semi-implicit Euler integration:
 * 1. speed from the acceleration, then limited to [0, maxSpeed] (and set to 0 when coasting below stopSpeed);
 * 2. heading from the new speed and the speed-limited wheel angle (yaw rate = speed × tan(angle) / wheelbase);
 * 3. position from the new speed along the new heading.
 */
export function stepVehicle(state: VehicleState, input: Controls, physics: VehiclePhysics, dt: number): VehicleState {
  const controls = clampControls(input);

  let speed = state.speed + acceleration(state.speed, controls, physics) * dt;
  speed = Math.min(physics.maxSpeed, Math.max(0, speed));
  if (controls.throttle === 0 && speed < physics.stopSpeed) speed = 0;

  const wheelAngle = controls.steering * maxSteerAngle(speed, physics);
  const yawRate = (speed * Math.tan(wheelAngle)) / physics.wheelbase;
  const heading = wrapAngle(state.heading + yawRate * dt);

  return {
    position: {
      x: state.position.x + Math.cos(heading) * speed * dt,
      y: state.position.y + Math.sin(heading) * speed * dt,
    },
    heading,
    speed,
  };
}
