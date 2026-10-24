// Test helpers for the built-in stadium oval: its centre line, and a simple scripted driver that follows it.
// Used by the lap tests and the lap demonstration; not part of the app.
import { DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import type { Car } from '../../src/sim/collision';
import type { Pose, Vec2 } from '../../src/sim/track';
import { maxSteerAngle, wrapAngle, type Controls } from '../../src/sim/vehicle';

const PHYSICS = DEFAULT_VEHICLE_PHYSICS;
const v = (x: number, y: number): Vec2 => ({ x, y });

// The oval's centre line by distance s from (−60, 40), in the start direction: bottom straight (+x), the
// right-hand semicircle, the top straight (−x), the left-hand semicircle. Gate 0 is at s = 60.
export const STRAIGHT = 120;
export const ARC = 40 * Math.PI;
export const LAP_LENGTH = 2 * STRAIGHT + 2 * ARC;
export function centre(distance: number): Pose {
  const s = ((distance % LAP_LENGTH) + LAP_LENGTH) % LAP_LENGTH;
  if (s < STRAIGHT) return { position: v(-60 + s, 40), heading: 0 };
  if (s < STRAIGHT + ARC) {
    const t = (s - STRAIGHT) / 40;
    return { position: v(60 + 40 * Math.sin(t), 40 * Math.cos(t)), heading: -t };
  }
  if (s < 2 * STRAIGHT + ARC) return { position: v(60 - (s - STRAIGHT - ARC), -40), heading: Math.PI };
  const t = (s - 2 * STRAIGHT - ARC) / 40;
  return { position: v(-60 - 40 * Math.sin(t), -40 * Math.cos(t)), heading: Math.PI - t };
}

/** Steers along the centre line (pure pursuit, 8 m ahead) at a target speed; a simple scripted driver. */
export function pursuit(car: Car, targetSpeed: number): Controls {
  const { position, heading, speed } = car.vehicle;
  // Nearest centre-line distance, by a coarse search.
  let best = 0;
  let bestDistance = Infinity;
  for (let s = 0; s < LAP_LENGTH; s += 0.25) {
    const p = centre(s).position;
    const d = Math.hypot(p.x - position.x, p.y - position.y);
    if (d < bestDistance) [best, bestDistance] = [s, d];
  }
  const target = centre(best + 8).position;
  const alpha = wrapAngle(Math.atan2(target.y - position.y, target.x - position.x) - heading);
  const wheel = Math.atan((2 * PHYSICS.wheelbase * Math.sin(alpha)) / 8);
  const steering = Math.max(-1, Math.min(1, wheel / maxSteerAngle(speed, PHYSICS)));
  const throttle = speed < targetSpeed ? 1 : 0;
  return { steering, throttle, brake: speed > targetSpeed + 1 ? 0.5 : 0 };
}

