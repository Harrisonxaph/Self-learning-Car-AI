// The rule-based driver A3 / A3-nb (P5-01 step 2): decisions for known inputs, the one-difference property, boundaries,
// determinism and hostile input. Parameters are chosen here, so no test depends on the placeholders' values.
import { describe, expect, it } from 'vitest';
import { createRuleBasedDriver, PLACEHOLDER_RULE_PARAMS, RULE_BASED_ALGORITHM, ruleControls, checkRuleParams, type RuleParams } from '../../src/ai/ruleBasedDriver';
import type { Car } from '../../src/sim/collision';

const P: RuleParams = { steerGain: 2, frontClear: 0.6, speedCap: 0.8, brakeFront: 0.25, brakeSpeed: 0.5 };
/** Nine inputs: rays at -90, -60, -30, 0, 30, 60, 90, then speed, then heading error (ignored). */
const inputs = (rays: [number, number, number, number, number, number, number], speed: number, heading = 0): number[] => [...rays, speed, heading];
const CLEAR: [number, number, number, number, number, number, number] = [1, 1, 1, 1, 1, 1, 1];
const car = {} as Car;
const decide = (values: readonly number[], brakeEnabled = true, params = P) => createRuleBasedDriver(params, { brakeEnabled }).decide({ car, inputs: values });

describe('the rule, for known inputs', () => {
  it('a clear, symmetric road at low speed: full throttle, no steering, no brake', () => {
    expect(decide(inputs(CLEAR, 0.1))).toEqual({ steering: 0, throttle: 1, brake: 0 });
  });
  it('steers towards the side with more free space (positive is the car\'s right)', () => {
    const rightFree = decide(inputs([0.2, 0.2, 0.2, 1, 0.5, 0.5, 0.5], 0.1));
    expect(rightFree.steering).toBeCloseTo(2 * 0.3, 12);
    const leftFree = decide(inputs([0.5, 0.5, 0.5, 1, 0.2, 0.2, 0.2], 0.1));
    expect(leftFree.steering).toBeCloseTo(-2 * 0.3, 12);
  });
  it('uses the mean of three rays on each side, not the extreme ones only', () => {
    // right mean (0, 0, 0.9) = 0.3; left mean (0, 0, 0) = 0.
    expect(decide(inputs([0, 0, 0, 1, 0, 0, 0.9], 0.1)).steering).toBeCloseTo(2 * 0.3, 12);
  });
  it.each([0, 1, 2])('each left ray (index %i) alone moves the steering by -gain/3 of its reading', (i) => {
    const rays = [0, 0, 0, 1, 0, 0, 0] as [number, number, number, number, number, number, number];
    rays[i] = 0.9;
    expect(decide(inputs(rays, 0.1), true, { ...P, steerGain: 1 }).steering).toBeCloseTo(-0.3, 12);
  });
  it.each([4, 5, 6])('each right ray (index %i) alone moves the steering by +gain/3 of its reading', (i) => {
    const rays = [0, 0, 0, 1, 0, 0, 0] as [number, number, number, number, number, number, number];
    rays[i] = 0.9;
    expect(decide(inputs(rays, 0.1), true, { ...P, steerGain: 1 }).steering).toBeCloseTo(0.3, 12);
  });
  it('clamps steering to [-1, 1]', () => {
    expect(decide(inputs([0, 0, 0, 1, 1, 1, 1], 0.1)).steering).toBe(1);
    expect(decide(inputs([1, 1, 1, 1, 0, 0, 0], 0.1)).steering).toBe(-1);
  });
  it('eases the throttle as the front ray closes: front / frontClear below frontClear', () => {
    expect(decide(inputs([1, 1, 1, 0.3, 1, 1, 1], 0.1)).throttle).toBeCloseTo(0.3 / 0.6, 12);
    expect(decide(inputs([1, 1, 1, 0, 1, 1, 1], 0.1)).throttle).toBe(0);
  });
  it('cuts the throttle while the speed is above speedCap', () => {
    expect(decide(inputs(CLEAR, 0.81)).throttle).toBe(0);
    expect(decide(inputs(CLEAR, 0.8)).throttle).toBe(1);
  });
  it('brakes only when the front is short AND the speed is high', () => {
    const shortFast = inputs([1, 1, 1, 0.1, 1, 1, 1], 0.7);
    const shortSlow = inputs([1, 1, 1, 0.1, 1, 1, 1], 0.4);
    const longFast = inputs([1, 1, 1, 0.9, 1, 1, 1], 0.7);
    expect(decide(shortFast).brake).toBe(1);
    expect(decide(shortSlow).brake).toBe(0);
    expect(decide(longFast).brake).toBe(0);
  });
  it('ignores the heading-error input entirely', () => {
    const a = decide(inputs([0.3, 0.5, 0.7, 0.4, 0.9, 0.2, 0.6], 0.6, -1));
    const b = decide(inputs([0.3, 0.5, 0.7, 0.4, 0.9, 0.2, 0.6], 0.6, 1));
    expect(a).toEqual(b);
  });
});

describe('the boundaries are fixed', () => {
  it('a front ray exactly at frontClear is clear (full throttle)', () => {
    expect(decide(inputs([1, 1, 1, 0.6, 1, 1, 1], 0.1)).throttle).toBe(1);
  });
  it('a front ray exactly at brakeFront is NOT short; just below it is', () => {
    expect(decide(inputs([1, 1, 1, 0.25, 1, 1, 1], 0.9)).brake).toBe(0);
    expect(decide(inputs([1, 1, 1, 0.2499, 1, 1, 1], 0.9)).brake).toBe(1);
  });
  it('a speed exactly at brakeSpeed is NOT fast; just above it is', () => {
    expect(decide(inputs([1, 1, 1, 0.1, 1, 1, 1], 0.5)).brake).toBe(0);
    expect(decide(inputs([1, 1, 1, 0.1, 1, 1, 1], 0.5001)).brake).toBe(1);
  });
  it('readings outside [0, 1] are clamped before use', () => {
    expect(decide(inputs([1.5, 1.5, 1.5, 2, -1, -1, -1], 0.1))).toEqual(decide(inputs([1, 1, 1, 1, 0, 0, 0], 0.1)));
  });
});

describe('A3 and A3-nb differ in the brake only', () => {
  const samples = [
    inputs(CLEAR, 0.1),
    inputs([0.2, 0.4, 0.6, 0.1, 0.9, 0.3, 0.5], 0.9),
    inputs([0, 0, 0, 0, 0, 0, 0], 1),
    inputs([1, 0.5, 0.2, 0.24, 0.8, 0.1, 0], 0.51),
    inputs([0.3, 0.3, 0.3, 0.7, 0.3, 0.3, 0.3], 0.2),
  ];
  it.each(samples.map((s, i) => [i, s] as const))('sample %i: steering and throttle are identical, A3-nb never brakes', (_i, values) => {
    const a3 = decide(values, true);
    const nb = decide(values, false);
    expect(nb.steering).toBe(a3.steering);
    expect(nb.throttle).toBe(a3.throttle);
    expect(nb.brake).toBe(0);
  });
  it('the two are labelled A3 and A3-nb in their recorded configuration', () => {
    expect(createRuleBasedDriver(P, { brakeEnabled: true }).config).toMatchObject({ agent: 'A3', algorithm: RULE_BASED_ALGORITHM, brakeEnabled: true });
    expect(createRuleBasedDriver(P, { brakeEnabled: false }).config).toMatchObject({ agent: 'A3-nb', brakeEnabled: false });
  });
});

describe('determinism and state', () => {
  it('gives the same controls for the same inputs, across calls, fresh drivers and reset()', () => {
    const values = inputs([0.3, 0.5, 0.7, 0.4, 0.9, 0.2, 0.6], 0.6);
    const driver = createRuleBasedDriver(P, { brakeEnabled: true });
    const first = driver.decide({ car, inputs: values });
    driver.reset();
    expect(driver.decide({ car, inputs: values })).toEqual(first);
    expect(createRuleBasedDriver(P, { brakeEnabled: true }).decide({ car, inputs: values })).toEqual(first);
  });
  it('is isolated from the caller\'s options object: mutating it later changes neither controls, configuration nor reset()', () => {
    const brakeObservation = { car, inputs: inputs([1, 1, 1, 0.1, 1, 1, 1], 0.9) };
    for (const brakeEnabled of [true, false]) {
      const options = { brakeEnabled };
      const driver = createRuleBasedDriver(P, options);
      const before = driver.decide(brakeObservation);
      const config = JSON.stringify(driver.config);
      options.brakeEnabled = !brakeEnabled;
      expect(driver.decide(brakeObservation)).toEqual(before);
      driver.reset();
      expect(driver.decide(brakeObservation)).toEqual(before);
      expect(JSON.stringify(driver.config)).toBe(config);
      expect(driver.config.brakeEnabled).toBe(brakeEnabled);
      expect(before.brake).toBe(brakeEnabled ? 1 : 0);
    }
  });
  it('does not keep or change the caller\'s inputs or parameters', () => {
    const values = Object.freeze(inputs([0.3, 0.5, 0.7, 0.4, 0.9, 0.2, 0.6], 0.6));
    const params = { ...P };
    const driver = createRuleBasedDriver(params, { brakeEnabled: true });
    params.steerGain = 99;
    expect(driver.decide({ car, inputs: values }).steering).toBeCloseTo(ruleControls(values, P, true).steering, 12);
  });
});

describe('hostile input is refused, never a NaN control', () => {
  const driver = createRuleBasedDriver(P, { brakeEnabled: true });
  it.each([
    ['no inputs', {}],
    ['too few inputs', { inputs: [1, 1, 1] }],
    ['too many inputs', { inputs: new Array(10).fill(1) }],
    ['a NaN reading', { inputs: inputs([1, 1, 1, Number.NaN, 1, 1, 1], 0.1) }],
    ['an Infinity speed', { inputs: inputs(CLEAR, Number.POSITIVE_INFINITY) }],
    ['a string reading', { inputs: [...CLEAR, '0.1', 0] }],
    ['a null observation', null],
  ])('%s', (_name, observation) => {
    expect(() => driver.decide(observation as never)).toThrow(RangeError);
  });
  it.each([
    ['null', null],
    ['a negative gain', { ...P, steerGain: -1 }],
    ['a NaN gain', { ...P, steerGain: Number.NaN }],
    ['frontClear 0', { ...P, frontClear: 0 }],
    ['frontClear above 1', { ...P, frontClear: 1.1 }],
    ['speedCap 0', { ...P, speedCap: 0 }],
    ['brakeFront above 1', { ...P, brakeFront: 2 }],
    ['brakeSpeed below 0', { ...P, brakeSpeed: -0.1 }],
    ['a missing field', { steerGain: 1 }],
  ])('rejects parameters: %s', (_name, params) => {
    expect(() => checkRuleParams(params)).toThrow(RangeError);
    expect(() => createRuleBasedDriver(params as never, { brakeEnabled: true })).toThrow(RangeError);
  });
  it('rejects missing or non-boolean options', () => {
    expect(() => createRuleBasedDriver(P, undefined as never)).toThrow(RangeError);
    expect(() => createRuleBasedDriver(P, { brakeEnabled: 1 as never })).toThrow(RangeError);
  });
  it('accepts the placeholder parameters (they are valid, and labelled as not tuned)', () => {
    expect(() => checkRuleParams(PLACEHOLDER_RULE_PARAMS)).not.toThrow();
  });
});
