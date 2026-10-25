// The 9-12-3 driving network (P2-03). Expected values are computed by hand, with Math.tanh on explicit sums,
// or by an independent reference that reads the flat array exactly as docs/MODEL_FORMAT.md describes.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { INPUT_NAMES, buildInputs } from '../../src/ai/inputs';
import {
  HIDDEN_SIZE,
  INITIALISATION,
  INPUT_SIZE,
  LAYERS,
  OUTPUT_SIZE,
  PARAMETER_COUNT,
  PARAMETER_ORDER,
  biasIndex,
  checkParameters,
  evaluate,
  initialParameters,
  runNetwork,
  weightIndex,
} from '../../src/ai/network';
import { sigmoid } from '../../src/ai/outputs';
import { startRacer } from '../../src/sim/world';
import { DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { loadTrack } from '../../src/sim/track';
import { createRng } from '../../src/utils/rng';

const zeros = () => new Array<number>(PARAMETER_COUNT).fill(0);

/**
 * An independent reference: read the flat array front to back, as MODEL_FORMAT's "Parameter order" says
 * (each layer's weights[out][in] row-major, then its biases), into explicit matrices, then multiply.
 */
function reference(parameters: readonly number[], x: readonly number[]) {
  let next = 0;
  const take = () => parameters[next++]!;
  const W1 = Array.from({ length: 12 }, () => Array.from({ length: 9 }, take));
  const b1 = Array.from({ length: 12 }, take);
  const W2 = Array.from({ length: 3 }, () => Array.from({ length: 12 }, take));
  const b2 = Array.from({ length: 3 }, take);
  expect(next).toBe(159);
  const hidden = W1.map((row, j) => Math.tanh(row.reduce((s, w, i) => s + w * x[i]!, b1[j]!)));
  const raw = W2.map((row, k) => row.reduce((s, w, j) => s + w * hidden[j]!, b2[k]!));
  return { hidden, raw };
}

describe('architecture and documented contract', () => {
  it('is 9-12-3 with 159 parameters', () => {
    expect(LAYERS).toEqual([9, 12, 3]);
    expect([INPUT_SIZE, HIDDEN_SIZE, OUTPUT_SIZE]).toEqual([9, 12, 3]);
    expect(PARAMETER_COUNT).toBe(9 * 12 + 12 + 12 * 3 + 3);
    expect(PARAMETER_COUNT).toBe(159);
  });

  it("matches MODEL_FORMAT's example model: layers, activations, inputs, outputs, count and order string", () => {
    const doc = readFileSync(join(__dirname, '../../docs/MODEL_FORMAT.md'), 'utf8');
    const example = JSON.parse(doc.slice(doc.indexOf('```json') + 7, doc.indexOf('```', doc.indexOf('```json') + 7)));
    expect(example.architecture.layers).toEqual([...LAYERS]);
    expect(example.architecture.hiddenActivation).toBe('tanh');
    expect(example.architecture.outputActivations).toEqual(['tanh', 'sigmoid', 'sigmoid']);
    expect(example.architecture.inputs).toEqual([...INPUT_NAMES]);
    expect(example.architecture.outputs).toEqual(['steering', 'throttle', 'brake']);
    expect(example.parameters.count).toBe(PARAMETER_COUNT);
    expect(example.parameters.values).toHaveLength(PARAMETER_COUNT);
    expect(example.parameters.order).toBe(PARAMETER_ORDER);
    // Its all-zero parameters are a valid network: steering 0, throttle and brake 0.5.
    expect(runNetwork(example.parameters.values, new Array(9).fill(0.3), { brakeEnabled: true })).toEqual({
      steering: 0,
      throttle: 0.5,
      brake: 0.5,
    });
  });

  it('initialisation is documented as uniform-pm1-v1: independent uniform draws in [−1, 1)', () => {
    expect(INITIALISATION).toEqual({ id: 'uniform-pm1-v1', type: 'uniform', min: -1, max: 1 });
  });
});

describe('parameter order', () => {
  it('weightIndex and biasIndex follow the documented layout', () => {
    expect(weightIndex(0, 0, 0)).toBe(0);
    expect(weightIndex(0, 0, 8)).toBe(8);
    expect(weightIndex(0, 1, 0)).toBe(9);
    expect(weightIndex(0, 11, 8)).toBe(107);
    expect(biasIndex(0, 0)).toBe(108);
    expect(biasIndex(0, 11)).toBe(119);
    expect(weightIndex(1, 0, 0)).toBe(120);
    expect(weightIndex(1, 0, 11)).toBe(131);
    expect(weightIndex(1, 2, 11)).toBe(155);
    expect(biasIndex(1, 0)).toBe(156);
    expect(biasIndex(1, 2)).toBe(158);
    // Every index is used exactly once.
    const seen = new Set<number>();
    for (let j = 0; j < 12; j += 1) for (let i = 0; i < 9; i += 1) seen.add(weightIndex(0, j, i));
    for (let j = 0; j < 12; j += 1) seen.add(biasIndex(0, j));
    for (let k = 0; k < 3; k += 1) for (let j = 0; j < 12; j += 1) seen.add(weightIndex(1, k, j));
    for (let k = 0; k < 3; k += 1) seen.add(biasIndex(1, k));
    expect([...seen].sort((a, b) => a - b)).toEqual(Array.from({ length: 159 }, (_, i) => i));
  });

  it.each([
    [() => weightIndex(2, 0, 0)],
    [() => weightIndex(0, 12, 0)],
    [() => weightIndex(0, 0, 9)],
    [() => weightIndex(1, 3, 0)],
    [() => weightIndex(1, 0, 12)],
    [() => biasIndex(0, -1)],
    [() => biasIndex(1, 1.5)],
  ])('rejects an out-of-range layer or unit (%#)', (call) => {
    expect(call).toThrow(RangeError);
  });

  it('one-hot sweep: each of the 159 parameters changes exactly the unit the layout says, by the expected amount', () => {
    // Baseline: every hidden bias c_j = 0.1·(j+1), everything else 0, so each hidden unit has a known,
    // distinct non-zero activation and the output weights are observable. Inputs are distinct: x_i = (i+1)/10.
    const x = Array.from({ length: 9 }, (_, i) => (i + 1) / 10);
    const c = Array.from({ length: 12 }, (_, j) => 0.1 * (j + 1));
    const base = zeros();
    c.forEach((value, j) => (base[108 + j] = value));
    const v = 0.7;
    for (let index = 0; index < PARAMETER_COUNT; index += 1) {
      const p = [...base];
      p[index] = p[index]! + v;
      const { hidden, raw } = evaluate(p, x);
      const expectedHidden = c.map((value) => Math.tanh(value));
      const expectedRaw = [0, 0, 0];
      if (index < 108) {
        const j = Math.floor(index / 9);
        const i = index % 9;
        expectedHidden[j] = Math.tanh(c[j]! + v * x[i]!);
      } else if (index < 120) {
        const j = index - 108;
        expectedHidden[j] = Math.tanh(c[j]! + v);
      } else if (index < 156) {
        const k = Math.floor((index - 120) / 12);
        const j = (index - 120) % 12;
        expectedRaw[k] = v * Math.tanh(c[j]!);
      } else {
        expectedRaw[index - 156] = v;
      }
      [...hidden].forEach((h, j) => expect(Math.abs(h - expectedHidden[j]!)).toBeLessThan(1e-15));
      [...raw].forEach((r, k) => expect(Math.abs(r - expectedRaw[k]!)).toBeLessThan(1e-15));
    }
  });
});

describe('forward pass', () => {
  it('a hand-computed sparse network', () => {
    const p = zeros();
    p[weightIndex(0, 4, 2)] = 0.8; // hidden 4 ← input 2
    p[biasIndex(0, 4)] = 0.1;
    p[weightIndex(1, 1, 4)] = 2; // throttle ← hidden 4
    p[biasIndex(1, 1)] = -0.5;
    p[biasIndex(1, 0)] = 0.25;
    const x = [0.9, 0.1, 0.5, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3];
    // hidden 4 = tanh(0.8·0.5 + 0.1) = tanh(0.5); every other hidden unit is tanh(0) = 0.
    const { hidden, raw } = evaluate(p, x);
    expect(hidden[4]).toBe(0.46211715726000974);
    expect([...hidden].filter((_, j) => j !== 4)).toEqual(new Array(11).fill(0));
    // raw = [0.25, 2·tanh(0.5) − 0.5, 0] = [0.25, 0.4242343145200195, 0].
    expect(raw[0]).toBe(0.25);
    expect(raw[1]).toBeCloseTo(0.4242343145200195, 15);
    expect(raw[2]).toBe(0);
    const controls = runNetwork(p, x, { brakeEnabled: true });
    expect(controls.steering).toBeCloseTo(0.24491866240370913, 15);
    expect(controls.throttle).toBeCloseTo(0.6044960388416362, 15);
    expect(controls.brake).toBe(0.5);
  });

  it('a hand-computed dense network', () => {
    // Every W1 weight 0.1, inputs all 1, so every hidden unit is tanh(0.9). Output k's weights are all
    // 0.05·(k+1) and its bias −0.1·k, so raw k = 12 · 0.05·(k+1) · tanh(0.9) − 0.1·k.
    const p = zeros();
    for (let j = 0; j < 12; j += 1) for (let i = 0; i < 9; i += 1) p[weightIndex(0, j, i)] = 0.1;
    for (let k = 0; k < 3; k += 1) {
      for (let j = 0; j < 12; j += 1) p[weightIndex(1, k, j)] = 0.05 * (k + 1);
      p[biasIndex(1, k)] = -0.1 * k;
    }
    const { hidden, raw } = evaluate(p, new Array(9).fill(1));
    const h = Math.tanh(0.9);
    [...hidden].forEach((value) => expect(value).toBeCloseTo(h, 15));
    [...raw].forEach((value, k) => expect(value).toBeCloseTo(12 * 0.05 * (k + 1) * h - 0.1 * k, 14));
  });

  it('matches the independent reference for seeded random parameters and inputs', () => {
    const rng = createRng(1403);
    for (let n = 0; n < 200; n += 1) {
      const p = Array.from({ length: 159 }, () => rng.range(-3, 3));
      const x = Array.from({ length: 9 }, () => rng.range(-1, 1));
      const ours = evaluate(p, x);
      const ref = reference(p, x);
      [...ours.hidden].forEach((h, j) => expect(Math.abs(h - ref.hidden[j]!)).toBeLessThan(1e-12));
      [...ours.raw].forEach((r, k) => expect(Math.abs(r - ref.raw[k]!)).toBeLessThan(1e-12));
      const c = runNetwork(p, x, { brakeEnabled: true });
      expect(c.steering).toBeCloseTo(Math.tanh(ref.raw[0]!), 12);
      expect(c.throttle).toBeCloseTo(sigmoid(ref.raw[1]!), 12);
      expect(c.brake).toBeCloseTo(sigmoid(ref.raw[2]!), 12);
    }
  });
});

describe('output ranges and the brake mask', () => {
  it('steering stays in [−1, 1] and throttle and brake in [0, 1], all finite, for large seeded weights and inputs', () => {
    const rng = createRng(1404);
    for (let n = 0; n < 500; n += 1) {
      const p = Array.from({ length: 159 }, () => rng.range(-50, 50));
      const x = Array.from({ length: 9 }, () => rng.range(-10, 10));
      for (const brakeEnabled of [true, false]) {
        const { steering, throttle, brake } = runNetwork(p, x, { brakeEnabled });
        for (const value of [steering, throttle, brake]) expect(Number.isFinite(value)).toBe(true);
        expect(Math.abs(steering)).toBeLessThanOrEqual(1);
        expect(throttle).toBeGreaterThanOrEqual(0);
        expect(throttle).toBeLessThanOrEqual(1);
        expect(brake).toBeGreaterThanOrEqual(0);
        expect(brake).toBeLessThanOrEqual(1);
      }
      evaluate(p, x).hidden.forEach((h) => expect(Math.abs(h)).toBeLessThanOrEqual(1));
    }
  });

  it('with the brake disabled, brake is exactly 0 and steering and throttle are unchanged', () => {
    const rng = createRng(1405);
    for (let n = 0; n < 100; n += 1) {
      const p = initialParameters(rng);
      const x = Array.from({ length: 9 }, () => rng.range(0, 1));
      const on = runNetwork(p, x, { brakeEnabled: true });
      const off = runNetwork(p, x, { brakeEnabled: false });
      expect(on.brake).toBeGreaterThan(0);
      expect(off).toEqual({ steering: on.steering, throttle: on.throttle, brake: 0 });
    }
  });
});

describe('validation', () => {
  const p = zeros();
  const x = new Array(9).fill(0.5);
  it.each([
    ['158 parameters', p.slice(1), x, /exactly 159/],
    ['160 parameters', [...p, 0], x, /exactly 159/],
    ['a NaN parameter', Object.assign([...p], { 77: NaN }), x, /Parameters\[77\]/],
    ['an infinite parameter', Object.assign([...p], { 158: -Infinity }), x, /Parameters\[158\]/],
    ['a non-numeric parameter', Object.assign([...p], { 3: '1' }), x, /Parameters\[3\]/],
    ['8 inputs', p, x.slice(1), /exactly 9/],
    ['10 inputs', p, [...x, 0], /exactly 9/],
    ['a NaN input', p, Object.assign([...x], { 8: NaN }), /Inputs\[8\]/],
    ['no parameters', undefined, x, /Parameters/],
  ])('rejects %s with a RangeError', (_name, params, inputs, message) => {
    expect(() => evaluate(params as number[], inputs as number[])).toThrow(RangeError);
    expect(() => evaluate(params as number[], inputs as number[])).toThrow(message);
  });

  it('checkParameters accepts 159 finite numbers as an array or a Float64Array', () => {
    expect(() => checkParameters(p)).not.toThrow();
    expect(() => checkParameters(new Float64Array(159))).not.toThrow();
  });

  it('rejects a missing or non-boolean brake option', () => {
    expect(() => runNetwork(p, x, undefined as unknown as { brakeEnabled: boolean })).toThrow(RangeError);
    expect(() => runNetwork(p, x, { brakeEnabled: 'yes' as unknown as boolean })).toThrow(/brakeEnabled/);
  });

  it('throws rather than returning a non-finite value when finite parameters overflow', () => {
    const huge = zeros();
    for (let i = 0; i < 9; i += 1) huge[weightIndex(0, 0, i)] = 1e308;
    expect(() => evaluate(huge, new Array(9).fill(1))).toThrow(/Hidden pre-activation 0 is not finite/);
    // Every hidden unit tanh(1) ≈ 0.76 and every brake weight 1e308: the sum passes Number.MAX_VALUE.
    const output = zeros();
    for (let j = 0; j < 12; j += 1) {
      output[biasIndex(0, j)] = 1;
      output[weightIndex(1, 2, j)] = 1e308;
    }
    expect(() => evaluate(output, new Array(9).fill(0))).toThrow(/Raw output 2 is not finite/);
    // Large weights that cancel stay finite and are accepted.
    const cancel = zeros();
    for (let j = 0; j < 12; j += 1) {
      cancel[biasIndex(0, j)] = 1;
      cancel[weightIndex(1, 2, j)] = j % 2 === 0 ? 1e308 : -1e308;
    }
    expect(Number.isFinite(evaluate(cancel, new Array(9).fill(0)).raw[2])).toBe(true);
  });
});

describe('seeded initialisation', () => {
  it('the same seed gives the same parameters; different seeds give different ones', () => {
    const a = initialParameters(createRng(7));
    expect(a).toBeInstanceOf(Float64Array);
    expect(a).toHaveLength(159);
    expect(initialParameters(createRng(7))).toEqual(a);
    expect(initialParameters(createRng(8))).not.toEqual(a);
  });

  it('draws rng.range(−1, 1) 159 times, in parameter order, and nothing else', () => {
    const reference = createRng(99);
    const expected = Array.from({ length: 159 }, () => reference.range(-1, 1));
    const rng = createRng(99);
    expect([...initialParameters(rng)]).toEqual(expected);
    // The generator advanced by exactly those 159 draws.
    expect(rng.nextUint32()).toBe(reference.nextUint32());
  });

  it('every value is in [−1, 1), and they spread over the range', () => {
    const rng = createRng(2026);
    const all: number[] = [];
    for (let n = 0; n < 100; n += 1) all.push(...initialParameters(rng));
    expect(Math.min(...all)).toBeGreaterThanOrEqual(-1);
    expect(Math.max(...all)).toBeLessThan(1);
    expect(Math.min(...all)).toBeLessThan(-0.99);
    expect(Math.max(...all)).toBeGreaterThan(0.99);
    expect(Math.abs(all.reduce((s, v) => s + v, 0) / all.length)).toBeLessThan(0.05);
  });

  it('two generators used alternately give the same networks as each used alone (no shared state)', () => {
    const r1 = createRng(1);
    const r2 = createRng(2);
    const interleaved = [initialParameters(r1), initialParameters(r2), initialParameters(r1), initialParameters(r2)];
    const s1 = createRng(1);
    const s2 = createRng(2);
    const alone1 = [initialParameters(s1), initialParameters(s1)];
    const alone2 = [initialParameters(s2), initialParameters(s2)];
    expect(interleaved).toEqual([alone1[0], alone2[0], alone1[1], alone2[1]]);
  });
});

describe('isolation and determinism', () => {
  it('never writes its arguments and gives identical results on repeat calls', () => {
    const rng = createRng(1406);
    const frozenParams = Object.freeze(Array.from({ length: 159 }, () => rng.range(-2, 2)));
    const frozenInputs = Object.freeze(Array.from({ length: 9 }, () => rng.range(0, 1)));
    const first = runNetwork(frozenParams, frozenInputs, { brakeEnabled: true });
    expect(runNetwork(frozenParams, frozenInputs, { brakeEnabled: true })).toEqual(first);

    const typed = initialParameters(rng);
    const copy = Float64Array.from(typed);
    const inputs = new Float64Array(9).fill(0.4);
    evaluate(typed, inputs);
    expect(typed).toEqual(copy);
    expect(inputs).toEqual(new Float64Array(9).fill(0.4));
  });

  it('returns fresh arrays: changing a result does not affect the next call', () => {
    const p = initialParameters(createRng(5));
    const x = new Array(9).fill(0.2);
    const first = evaluate(p, x);
    first.hidden.fill(9);
    first.raw.fill(9);
    const second = evaluate(p, x);
    const ref = reference([...p], x);
    [...second.hidden].forEach((h, j) => expect(Math.abs(h - ref.hidden[j]!)).toBeLessThan(1e-12));
    [...second.raw].forEach((r, k) => expect(Math.abs(r - ref.raw[k]!)).toBeLessThan(1e-12));
  });

  it('running two networks alternately gives the same results as running each alone', () => {
    const a = initialParameters(createRng(11));
    const b = initialParameters(createRng(12));
    const rng = createRng(13);
    const inputs = Array.from({ length: 20 }, () => Array.from({ length: 9 }, () => rng.range(0, 1)));
    const aloneA = inputs.map((x) => runNetwork(a, x, { brakeEnabled: true }));
    const aloneB = inputs.map((x) => runNetwork(b, x, { brakeEnabled: false }));
    inputs.forEach((x, i) => {
      expect(runNetwork(a, x, { brakeEnabled: true })).toEqual(aloneA[i]);
      expect(runNetwork(b, x, { brakeEnabled: false })).toEqual(aloneB[i]);
    });
  });
});

describe('separation and composition', () => {
  it('inference code imports nothing from evolution, training, persistence, rendering or the UI', () => {
    const dir = join(__dirname, '../../src/ai');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const source = readFileSync(join(dir, file), 'utf8');
      const imports = [...source.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]!);
      for (const path of imports) expect(path, `${file} imports ${path}`).not.toMatch(/evolution|training|persistence|render|\/ui\//);
    }
  });

  it("takes P2-02's nine inputs: the stadium start gives finite, in-range controls (no driver wiring)", () => {
    const track = loadTrack(stadiumOval);
    const racer = startRacer(track, DEFAULT_VEHICLE_PHYSICS);
    const inputs = buildInputs(racer, track, DEFAULT_VEHICLE_PHYSICS);
    const controls = runNetwork(initialParameters(createRng(1)), inputs, { brakeEnabled: true });
    expect(Math.abs(controls.steering)).toBeLessThanOrEqual(1);
    for (const value of [controls.throttle, controls.brake]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});
