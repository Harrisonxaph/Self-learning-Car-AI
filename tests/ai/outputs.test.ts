import { describe, expect, it } from 'vitest';
import { outputsToControls, sigmoid } from '../../src/ai/outputs';

describe('sigmoid', () => {
  it('matches the logistic function at known points', () => {
    expect(sigmoid(0)).toBe(0.5);
    expect(sigmoid(1)).toBeCloseTo(0.7310585786300049, 15);
    expect(sigmoid(-1)).toBeCloseTo(0.2689414213699951, 15);
    expect(sigmoid(Math.log(3))).toBeCloseTo(0.75, 15);
  });

  it('is symmetric: sigmoid(−x) = 1 − sigmoid(x)', () => {
    for (const x of [0.1, 0.5, 2, 7.25, 20]) expect(sigmoid(-x)).toBeCloseTo(1 - sigmoid(x), 15);
  });

  it('never overflows or returns NaN, reaching exactly 0 and 1 at the extremes', () => {
    expect(sigmoid(1000)).toBe(1);
    expect(sigmoid(-1000)).toBe(0);
    expect(sigmoid(Number.MAX_VALUE)).toBe(1);
    expect(sigmoid(-Number.MAX_VALUE)).toBe(0);
    for (let x = -800; x <= 800; x += 0.5) {
      const y = sigmoid(x);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
  });
});

describe('outputsToControls', () => {
  it('maps o0 → tanh steering, o1 → sigmoid throttle, o2 → sigmoid brake, independently', () => {
    expect(outputsToControls([0, 0, 0], true)).toEqual({ steering: 0, throttle: 0.5, brake: 0.5 });
    const c = outputsToControls([0.5, -2, 3], true);
    expect(c.steering).toBeCloseTo(0.46211715726000974, 15);
    expect(c.throttle).toBeCloseTo(0.11920292202211755, 15);
    expect(c.brake).toBeCloseTo(0.9525741268224334, 15);
  });

  it('keeps every output in range at the extremes: steering ±1, throttle and brake 0 or 1', () => {
    expect(outputsToControls([1e6, 1e6, -1e6], true)).toEqual({ steering: 1, throttle: 1, brake: 0 });
    expect(outputsToControls([-1e6, -1e6, 1e6], true)).toEqual({ steering: -1, throttle: 0, brake: 1 });
  });

  it('the no-brake mask forces brake to exactly 0 and leaves steering and throttle unchanged', () => {
    for (const raw of [
      [0, 0, 0],
      [0.3, -0.7, 5],
      [-4, 2, 1e6],
    ]) {
      const on = outputsToControls(raw, true);
      const off = outputsToControls(raw, false);
      expect(off.brake).toBe(0);
      expect(off.steering).toBe(on.steering);
      expect(off.throttle).toBe(on.throttle);
    }
  });

  it.each([
    ['two outputs', [0, 0], true],
    ['four outputs', [0, 0, 0, 0], true],
    ['a NaN output', [0, NaN, 0], true],
    ['an infinite output', [Infinity, 0, 0], true],
    ['a non-boolean mask', [0, 0, 0], 1 as unknown as boolean],
    ['an undefined mask', [0, 0, 0], undefined as unknown as boolean],
    ['null outputs', null as unknown as number[], true],
    ['undefined outputs', undefined as unknown as number[], true],
    ['a number instead of outputs', 3 as unknown as number[], true],
  ])('throws a RangeError for %s', (_name, raw, brakeEnabled) => {
    expect(() => outputsToControls(raw, brakeEnabled)).toThrow(RangeError);
  });
});
