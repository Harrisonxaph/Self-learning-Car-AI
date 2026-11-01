import { describe, expect, it } from 'vitest';
import { NO_INPUT, controlsFromInput, createHumanDriver, createNetworkDriver, type HumanInput } from '../../src/ai/drivers';
import { initialParameters, runNetwork } from '../../src/ai/network';
import { NO_CONTROLS } from '../../src/sim/vehicle';
import { createRng } from '../../src/utils/rng';

const input = (held: Partial<HumanInput>): HumanInput => ({ ...NO_INPUT, ...held });

describe('human driver', () => {
  it.each([
    ['nothing held', {}, NO_CONTROLS],
    ['accelerate', { accelerate: true }, { steering: 0, throttle: 1, brake: 0 }],
    ['brake', { brake: true }, { steering: 0, throttle: 0, brake: 1 }],
    ['left', { left: true }, { steering: -1, throttle: 0, brake: 0 }],
    ['right', { right: true }, { steering: 1, throttle: 0, brake: 0 }],
    ['steering while accelerating', { right: true, accelerate: true }, { steering: 1, throttle: 1, brake: 0 }],
    ['left and right together cancel', { left: true, right: true, accelerate: true }, { steering: 0, throttle: 1, brake: 0 }],
    ['everything at once', { left: true, accelerate: true, brake: true }, { steering: -1, throttle: 1, brake: 1 }],
  ])('maps %s', (_label, held, controls) => {
    expect(controlsFromInput(input(held))).toEqual(controls);
  });

  it('reads the current input each time it decides', () => {
    let current: HumanInput = NO_INPUT;
    const driver = createHumanDriver(() => current);
    const observation = { car: { vehicle: { position: { x: 0, y: 0 }, heading: 0, speed: 0 }, crashed: false } };
    expect(driver.decide(observation)).toEqual(NO_CONTROLS);
    current = input({ accelerate: true, left: true });
    expect(driver.decide(observation)).toEqual({ steering: -1, throttle: 1, brake: 0 });
  });
});

describe('network driver', () => {
  const rng = createRng(3);
  const parameters = initialParameters(rng);
  const inputs = [0.1, 0.4, 1, 0.9, 0.2, 0.5, 0.3, 0.6, -0.25];
  const car = { vehicle: { position: { x: 0, y: 0 }, heading: 0, speed: 0 }, crashed: false };

  it.each([true, false])('decides exactly as runNetwork with brakeEnabled %s', (brakeEnabled) => {
    const driver = createNetworkDriver(parameters, { brakeEnabled });
    expect(driver.decide({ car, inputs })).toEqual(runNetwork(parameters, inputs, { brakeEnabled }));
  });

  it('copies the parameters, so later changes to the caller\'s array do not change it', () => {
    const own = Float64Array.from(parameters);
    const driver = createNetworkDriver(own, { brakeEnabled: true });
    const before = driver.decide({ car, inputs });
    own.fill(0);
    driver.reset();
    expect(driver.decide({ car, inputs })).toEqual(before);
  });

  it('needs the observation\'s inputs and checks its parameters and options', () => {
    const driver = createNetworkDriver(parameters, { brakeEnabled: true });
    expect(() => driver.decide({ car })).toThrow(/inputs/);
    expect(() => createNetworkDriver(parameters.slice(1), { brakeEnabled: true })).toThrow(RangeError);
    expect(() => createNetworkDriver(parameters, {} as { brakeEnabled: boolean })).toThrow(RangeError);
  });
});
