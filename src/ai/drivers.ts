// Drivers decide each tick's controls. Every car is driven through this one interface, so a human, a
// scripted or random driver and a neural network all use the same simulation path. Headless: a human
// driver only reads the held inputs that the UI (ui/controls) records; it never touches the DOM.
import type { Car } from '../sim/collision';
import type { Controls } from '../sim/vehicle';
import { checkParameters, runNetwork } from './network';

/** What a driver can see when deciding. */
export interface Observation {
  readonly car: Car;
  /**
   * The nine network inputs (ai/inputs.ts, INPUT_CONTRACT) for the car's current state. The evaluation harness
   * (training/evaluation.ts) always supplies them; manual driving does not need them.
   */
  readonly inputs?: readonly number[];
}

export interface Driver {
  decide(observation: Observation): Controls;
}

/**
 * A driver that is evaluated one episode at a time. `reset()` returns it to exactly the state it was created in;
 * the evaluation harness calls it before an episode's first tick, then calls `decide` exactly once per tick.
 */
export interface EpisodeDriver extends Driver {
  reset(): void;
}

/**
 * A driver for one network's parameters: runNetwork on the observation's inputs, with the brake mask. The
 * parameters are checked and copied, so changing the caller's array later cannot change the driver. It has no
 * other state, so reset() does nothing. Throws RangeError if an observation has no inputs.
 */
export function createNetworkDriver(parameters: ArrayLike<number>, options: { readonly brakeEnabled: boolean }): EpisodeDriver {
  checkParameters(parameters);
  if (options === null || typeof options !== 'object' || typeof options.brakeEnabled !== 'boolean') {
    throw new RangeError('createNetworkDriver needs options { brakeEnabled: boolean }.');
  }
  const copy = Float64Array.from(parameters);
  const runOptions = Object.freeze({ brakeEnabled: options.brakeEnabled });
  return {
    decide(observation) {
      if (!observation.inputs) throw new RangeError('A network driver needs the observation\'s inputs.');
      return runNetwork(copy, observation.inputs, runOptions);
    },
    reset() {},
  };
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
