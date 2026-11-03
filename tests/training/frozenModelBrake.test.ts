// P2-09 plan step 2: the brake mask recorded in a frozen model's provenance, and the driver that honours it.
import { describe, expect, it } from 'vitest';
import { createNetworkDriver } from '../../src/ai/drivers';
import { initialParameters, runNetwork } from '../../src/ai/network';
import { createFrozenModelDriver, modelBrakeEnabled } from '../../src/training/frozenModelBrake';
import { freezeModel, type FrozenModel } from '../../src/training/trackSplits';
import { createRng } from '../../src/utils/rng';

const parameters = Array.from(initialParameters(createRng(5)));
const car = { vehicle: { position: { x: 0, y: 0 }, heading: 0, speed: 0 }, crashed: false };
// Several observations, so one lucky input cannot make a comparison pass.
const observations = [
  [0.1, 0.4, 1, 0.9, 0.2, 0.5, 0.3, 0.6, -0.25],
  [1, 1, 1, 1, 1, 1, 1, 0, 0],
  [0.05, 0.1, 0.2, 0.05, 0.3, 0.9, 1, 0.8, 0.5],
  [0.7, 0.2, 0.9, 0.1, 0.4, 0.6, 0.8, 0.3, -0.9],
].map((inputs) => ({ car, inputs }));

describe('modelBrakeEnabled', () => {
  it.each([true, false])('returns the recorded flag %s', (brakeEnabled) => {
    expect(modelBrakeEnabled(freezeModel(parameters, { agent: 'A5', seed: 2001, brakeEnabled }))).toBe(brakeEnabled);
  });

  it('puts the flag into the model identity: the same parameters with the flag true and false are different models', () => {
    const on = freezeModel(parameters, { agent: 'A5', brakeEnabled: true });
    const off = freezeModel(parameters, { agent: 'A5', brakeEnabled: false });
    expect(on.id).not.toBe(off.id);
    // The same facts give the same model, whatever order they were written in.
    expect(freezeModel(parameters, { brakeEnabled: false, agent: 'A5' }).id).toBe(off.id);
    expect(freezeModel(parameters, { agent: 'A5', brakeEnabled: true }).id).toBe(on.id);
  });

  it('rejects a model whose key is missing, naming the path', () => {
    const model = freezeModel(parameters, { agent: 'A5', seed: 2001 });
    expect(() => modelBrakeEnabled(model)).toThrow(RangeError);
    expect(() => modelBrakeEnabled(model)).toThrow('model.provenance.brakeEnabled is missing');
    expect(() => modelBrakeEnabled(freezeModel(parameters))).toThrow('model.provenance.brakeEnabled is missing');
  });

  it.each([
    ['the string "false"', 'false'],
    ['the string "true"', 'true'],
    ['the number 0', 0],
    ['the number 1', 1],
  ])('rejects a key that is not a boolean (%s), naming the path', (_label, value) => {
    const model = freezeModel(parameters, { brakeEnabled: value });
    expect(() => modelBrakeEnabled(model)).toThrow(RangeError);
    expect(() => modelBrakeEnabled(model)).toThrow('model.provenance.brakeEnabled must be a boolean');
  });

  it('rejects a model that is not an unchanged frozen model: a plain object, a forged ID, or a flipped flag', () => {
    const real = freezeModel(parameters, { brakeEnabled: false });
    expect(() => modelBrakeEnabled({ id: real.id, parameters: [...parameters], provenance: { brakeEnabled: false } })).toThrow('unchanged frozen model');
    // The flag flipped while keeping the old ID: the ID no longer matches the content.
    const flipped = Object.freeze({ id: real.id, parameters: real.parameters, provenance: Object.freeze({ brakeEnabled: true }) }) as FrozenModel;
    expect(() => modelBrakeEnabled(flipped)).toThrow('unchanged frozen model');
    expect(() => createFrozenModelDriver(flipped)).toThrow('unchanged frozen model');
  });
});

describe('createFrozenModelDriver', () => {
  it('a model with the brake off decides exactly as the brake-off network driver and applies no brake on any tick', () => {
    const driver = createFrozenModelDriver(freezeModel(parameters, { agent: 'A4', brakeEnabled: false }));
    const reference = createNetworkDriver(parameters, { brakeEnabled: false });
    for (const observation of observations) {
      const controls = driver.decide(observation);
      expect(controls).toEqual(reference.decide(observation));
      expect(controls.brake).toBe(0);
    }
  });

  it('a model with the brake off equals the same network with the brake enabled and its brake output pushed to exactly 0 (the T1 construction)', () => {
    // As tests/training/trainer.test.ts: zeroed brake weights and a huge negative bias make sigmoid(o2) exactly 0.
    const zeroBrake = [...parameters];
    for (let i = 120 + 2 * 12; i < 120 + 3 * 12; i += 1) zeroBrake[i] = 0;
    zeroBrake[158] = -1e6;
    const masked = createFrozenModelDriver(freezeModel(parameters, { brakeEnabled: false }));
    const enabled = createNetworkDriver(zeroBrake, { brakeEnabled: true });
    for (const observation of observations) expect(masked.decide(observation)).toEqual(enabled.decide(observation));
  });

  it('a model with the brake on decides exactly as createNetworkDriver with the brake enabled, and does brake', () => {
    const driver = createFrozenModelDriver(freezeModel(parameters, { agent: 'A5', brakeEnabled: true }));
    const reference = createNetworkDriver(parameters, { brakeEnabled: true });
    for (const observation of observations) {
      const controls = driver.decide(observation);
      expect(controls).toEqual(reference.decide(observation));
      expect(controls).toEqual(runNetwork(parameters, observation.inputs, { brakeEnabled: true }));
      expect(controls.brake).toBeGreaterThan(0);
    }
  });

  it('uses the recorded flag, not a default: the same parameters give different brakes under the two models', () => {
    const on = createFrozenModelDriver(freezeModel(parameters, { brakeEnabled: true }));
    const off = createFrozenModelDriver(freezeModel(parameters, { brakeEnabled: false }));
    const [first] = observations;
    expect(on.decide(first!).brake).toBeGreaterThan(0);
    expect(off.decide(first!).brake).toBe(0);
    // Steering and throttle do not depend on the mask.
    expect(on.decide(first!).steering).toBe(off.decide(first!).steering);
    expect(on.decide(first!).throttle).toBe(off.decide(first!).throttle);
  });

  it('refuses a model without the flag instead of defaulting, and a model whose parameters are not a 9-12-3 network', () => {
    expect(() => createFrozenModelDriver(freezeModel(parameters, { agent: 'A5' }))).toThrow('model.provenance.brakeEnabled is missing');
    expect(() => createFrozenModelDriver(freezeModel(parameters.slice(1), { brakeEnabled: true }))).toThrow(RangeError);
  });
});
