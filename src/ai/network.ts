// The driving network (P2-03): a fixed 9-12-3 fully connected feedforward net, run as pure inference.
// Headless and stateless: every function takes its parameters and inputs as arguments, never writes them,
// and keeps nothing between calls. Inference never imports evolution or training (see eslint.config.js);
// evolution will treat the parameters as a flat genome without knowing this layout.
//
// Layout (docs/MODEL_FORMAT.md "Parameter order"): for each layer transition in order, every weight as
// weights[out][in] row-major, then that layer's biases. For 9-12-3:
//   0–107    W1, hidden j from input i at 9·j + i
//   108–119  b1, hidden j at 108 + j
//   120–155  W2, output k from hidden j at 120 + 12·k + j
//   156–158  b2, output k at 156 + k
// hidden = tanh(W1·x + b1); raw = W2·hidden + b2 (linear); controls come from outputs.ts.
import type { Controls } from '../sim/vehicle';
import type { Rng } from '../utils/rng';
import { outputsToControls } from './outputs';

/** Units per layer: 9 inputs (ai/inputs.ts), 12 hidden, 3 outputs (steering, throttle, brake). */
export const LAYERS = Object.freeze([9, 12, 3] as const);
export const INPUT_SIZE = 9;
export const HIDDEN_SIZE = 12;
export const OUTPUT_SIZE = 3;

/** 9·12 + 12 + 12·3 + 3. */
export const PARAMETER_COUNT = 159;

/** The order string saved models record as `parameters.order` (docs/MODEL_FORMAT.md). */
export const PARAMETER_ORDER = 'layer-major; per layer: weights[out][in] row-major, then biases[out]';

/** How fresh parameters are drawn: each independently uniform in [−1, 1), in parameter order. */
export const INITIALISATION = Object.freeze({ id: 'uniform-pm1-v1', type: 'uniform', min: -1, max: 1 } as const);

/** Where each layer's weights and biases start in the flat array, and the layer's sizes. */
const LAYOUT = [
  { inputs: INPUT_SIZE, outputs: HIDDEN_SIZE, weights: 0, biases: INPUT_SIZE * HIDDEN_SIZE },
  { inputs: HIDDEN_SIZE, outputs: OUTPUT_SIZE, weights: INPUT_SIZE * HIDDEN_SIZE + HIDDEN_SIZE, biases: PARAMETER_COUNT - OUTPUT_SIZE },
] as const;

function layerOf(layer: number) {
  const found = LAYOUT[layer];
  if (!found) throw new RangeError(`Layer must be 0 (input → hidden) or 1 (hidden → output), got ${layer}.`);
  return found;
}

function checkUnit(value: number, size: number, what: string): void {
  if (!Number.isInteger(value) || value < 0 || value >= size) {
    throw new RangeError(`${what} must be an integer from 0 to ${size - 1}, got ${value}.`);
  }
}

/** Index in the flat parameter array of the weight from unit `from` to unit `to` in layer transition `layer`. */
export function weightIndex(layer: number, to: number, from: number): number {
  const l = layerOf(layer);
  checkUnit(to, l.outputs, 'Output unit');
  checkUnit(from, l.inputs, 'Input unit');
  return l.weights + to * l.inputs + from;
}

/** Index in the flat parameter array of unit `to`'s bias in layer transition `layer`. */
export function biasIndex(layer: number, to: number): number {
  const l = layerOf(layer);
  checkUnit(to, l.outputs, 'Output unit');
  return l.biases + to;
}

/** Throws RangeError unless `values` holds exactly `count` finite numbers. */
function checkVector(values: ArrayLike<number>, count: number, what: string): void {
  if (values === null || typeof values !== 'object' || typeof values.length !== 'number') {
    throw new RangeError(`${what} must be an array of ${count} numbers.`);
  }
  if (values.length !== count) throw new RangeError(`${what} must have exactly ${count} values, got ${values.length}.`);
  for (let i = 0; i < count; i += 1) {
    const value: unknown = values[i];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new RangeError(`${what}[${i}] must be a finite number, got ${String(value)}.`);
    }
  }
}

/** Checks a parameter array: exactly 159 finite numbers. Throws RangeError naming the first bad index. */
export function checkParameters(parameters: ArrayLike<number>): void {
  checkVector(parameters, PARAMETER_COUNT, 'Parameters');
}

/** One fully connected layer: out[o] = Σ w[o][i]·x[i] + b[o], before any activation. */
function layer(parameters: ArrayLike<number>, l: (typeof LAYOUT)[number], x: ArrayLike<number>, what: string): Float64Array {
  const out = new Float64Array(l.outputs);
  for (let o = 0; o < l.outputs; o += 1) {
    let sum = parameters[l.biases + o]!;
    const row = l.weights + o * l.inputs;
    for (let i = 0; i < l.inputs; i += 1) sum += parameters[row + i]! * x[i]!;
    // Finite parameters and inputs can still overflow to ±Infinity when the weights or inputs are huge.
    if (!Number.isFinite(sum)) throw new RangeError(`${what} ${o} is not finite (${sum}); the parameters or inputs are too large.`);
    out[o] = sum;
  }
  return out;
}

/**
 * Runs the network on nine inputs. Returns new arrays: the 12 hidden activations (tanh, in [−1, 1]) and the
 * 3 raw, linear outputs. Throws RangeError for invalid parameters or inputs, or a non-finite intermediate sum.
 */
export function evaluate(parameters: ArrayLike<number>, inputs: ArrayLike<number>): { hidden: Float64Array; raw: Float64Array } {
  checkParameters(parameters);
  checkVector(inputs, INPUT_SIZE, 'Inputs');
  const hidden = layer(parameters, LAYOUT[0], inputs, 'Hidden pre-activation');
  for (let j = 0; j < hidden.length; j += 1) hidden[j] = Math.tanh(hidden[j]!);
  const raw = layer(parameters, LAYOUT[1], hidden, 'Raw output');
  return { hidden, raw };
}

/**
 * The controls the network chooses for nine inputs: steering tanh(o0), throttle sigmoid(o1), brake
 * sigmoid(o2), or brake 0 when `brakeEnabled` is false (outputs.ts).
 */
export function runNetwork(parameters: ArrayLike<number>, inputs: ArrayLike<number>, options: { readonly brakeEnabled: boolean }): Controls {
  if (options === null || typeof options !== 'object') throw new RangeError('runNetwork needs options { brakeEnabled }.');
  return outputsToControls(evaluate(parameters, inputs).raw, options.brakeEnabled);
}

/**
 * Fresh parameters for an untrained network: 159 independent draws of rng.range(−1, 1), taken in parameter
 * order, so the same generator state always gives the same network. Uses `range`, whose arithmetic is exact
 * in every engine, rather than `gaussian`. Advances the generator by exactly 159 draws.
 */
export function initialParameters(rng: Rng): Float64Array {
  const parameters = new Float64Array(PARAMETER_COUNT);
  for (let i = 0; i < PARAMETER_COUNT; i += 1) parameters[i] = rng.range(INITIALISATION.min, INITIALISATION.max);
  return parameters;
}
