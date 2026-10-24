import { describe, expect, it } from 'vitest';
import { NO_INPUT, controlsFromInput, createHumanDriver, type HumanInput } from '../../src/ai/drivers';
import { NO_CONTROLS } from '../../src/sim/vehicle';

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
