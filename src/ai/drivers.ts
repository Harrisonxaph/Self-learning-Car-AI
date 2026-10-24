// Drivers decide each tick's controls. Every car is driven through this one interface, so a human, a
// scripted driver and (later) a neural network all use the same simulation path. Headless: a human
// driver only reads the held inputs that the UI (ui/controls) records; it never touches the DOM.
import type { Car } from '../sim/collision';
import type { Controls } from '../sim/vehicle';

/** What a driver can see when deciding. Sensors are added in Phase 2 (P2-01, P2-02). */
export interface Observation {
  readonly car: Car;
}

export interface Driver {
  decide(observation: Observation): Controls;
}

/** The buttons a human is holding: keyboard keys and touch buttons both map onto these. */
export interface HumanInput {
  readonly left: boolean;
  readonly right: boolean;
  readonly accelerate: boolean;
  readonly brake: boolean;
}

export const NO_INPUT: HumanInput = Object.freeze({ left: false, right: false, accelerate: false, brake: false });

/**
 * Digital buttons to controls: full steering towards the held side (both sides cancel out), full throttle
 * and full brake. Any combination works at once, for example steering while accelerating. The physics
 * limits the wheel angle at speed (sim/vehicle.ts), so full steering stays drivable.
 */
export function controlsFromInput(input: HumanInput): Controls {
  return {
    steering: (input.right ? 1 : 0) - (input.left ? 1 : 0),
    throttle: input.accelerate ? 1 : 0,
    brake: input.brake ? 1 : 0,
  };
}

/** A driver that does whatever the human is holding at the moment it is asked. */
export function createHumanDriver(read: () => HumanInput): Driver {
  return { decide: () => controlsFromInput(read()) };
}
