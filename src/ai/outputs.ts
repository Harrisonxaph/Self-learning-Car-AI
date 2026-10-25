// Maps the network's three raw outputs to driving controls (P2-03). Pure: no state, no randomness.
//
//   steering = tanh(o0)       in [−1, 1]   (positive steers right, as for every driver)
//   throttle = sigmoid(o1)    in [0, 1]
//   brake    = sigmoid(o2)    in [0, 1], or exactly 0 when braking is disabled (the no-brake mask)
//
// The three are independent: each output has its own activation, so a network can steer, accelerate and
// brake at once, as a human holding several buttons can.
import type { Controls } from '../sim/vehicle';

/**
 * The logistic function 1 / (1 + e^−x), computed so it never overflows: for very large |x| it returns
 * exactly 0 or 1, never NaN. sigmoid(0) = 0.5 and sigmoid(−x) = 1 − sigmoid(x).
 */
export function sigmoid(x: number): number {
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const e = Math.exp(x);
  return e / (1 + e);
}

/**
 * Controls from three raw outputs. With `brakeEnabled` false the brake is forced to 0 whatever o2 is, and
 * steering and throttle are unchanged. Throws RangeError for anything but three finite numbers, or a
 * non-boolean `brakeEnabled`.
 */
export function outputsToControls(raw: ArrayLike<number>, brakeEnabled: boolean): Controls {
  if (typeof brakeEnabled !== 'boolean') throw new RangeError(`brakeEnabled must be a boolean, got ${String(brakeEnabled)}.`);
  if (raw.length !== 3) throw new RangeError(`Expected 3 raw outputs, got ${raw.length}.`);
  for (let i = 0; i < 3; i += 1) {
    if (!Number.isFinite(raw[i])) throw new RangeError(`Raw output ${i} must be finite, got ${raw[i]}.`);
  }
  return {
    steering: Math.tanh(raw[0]!),
    throttle: sigmoid(raw[1]!),
    brake: brakeEnabled ? sigmoid(raw[2]!) : 0,
  };
}
