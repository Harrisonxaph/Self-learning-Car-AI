// The rule-based baseline driver A3 (P5-01; docs/AI_EVALUATION.md §2, docs/plans/p5-01-plan.md §3): a hand-written
// driver with no learning. Headless, pure and deterministic.
//
// It reads ONLY the seven ray readings and the speed from the observation's nine inputs (ai/inputs.ts); it ignores the
// heading-error input, so it uses no gate or centre-line information. It is stateless, so reset() does nothing and
// the same inputs always give the same controls.
//
// The rule (every quantity is in the inputs' normalised units: rays 1 = clear, speed 1 = maxSpeed):
//   1. Steering: steerGain × (right − left), clamped to [−1, 1]. `right` is the mean of the +30, +60 and +90 degree
//      rays (positive angles are to the car's right, as for steering) and `left` the mean of −30, −60 and −90.
//   2. Throttle: 1 when the front (0 degree) ray is at least frontClear, else front ÷ frontClear; 0 while the speed is
//      above speedCap.
//   3. Brake (A3 only): 1 when the front ray is below brakeFront AND the speed is above brakeSpeed, else 0.
// A3-nb ("no brake") is identical in every line except that its brake is always 0, so a difference between the two is a
// difference the brake makes (the same design principle as the P2-09 feasibility drivers).
//
// Boundaries are fixed: a front ray exactly at frontClear counts as clear; exactly at brakeFront it is NOT short;
// a speed exactly at speedCap or brakeSpeed is NOT above it.
//
// The constants are chosen by P5-01 step 3 on the training track only and frozen below (RULE_A3_PARAMS,
// RULE_A3_NB_PARAMS); A3-nb-same is RULE_A3_PARAMS with the brake masked.
import type { Controls } from '../sim/vehicle';
import { clampControls } from '../sim/vehicle';
import type { EpisodeDriver, Observation } from './drivers';
import { INPUT_COUNT, SPEED_INPUT } from './inputs';

/** Change this whenever the rule, the input indices or the boundary conventions change. */
export const RULE_BASED_ALGORITHM = 'rule-based-v1';

/** The five numbers that define the rule. */
export interface RuleParams {
  /** Steering per unit of (right − left) free space; at least 0. */
  readonly steerGain: number;
  /** Front-ray reading at or above which the road ahead counts as clear, in (0, 1]. */
  readonly frontClear: number;
  /** Speed input above which the throttle is 0, in (0, 1]. */
  readonly speedCap: number;
  /** Front-ray reading below which the road ahead counts as short, in [0, 1]. */
  readonly brakeFront: number;
  /** Speed input above which the car counts as fast, in [0, 1]. */
  readonly brakeSpeed: number;
}

/**
 * A3's constants, chosen by P5-01 step 3 on the TRAINING track only (stadium-oval) from the predeclared grid and frozen
 * here (docs/experiments/p5-01-tuning.json and .md; training/ruleTuning.ts). A test checks they equal the committed record.
 * They are a baseline's constants, not a claim that this is the best possible rule.
 */
export const RULE_A3_PARAMS: RuleParams = Object.freeze({
  steerGain: 4,
  frontClear: 0.3,
  speedCap: 1,
  brakeFront: 0.3,
  brakeSpeed: 0.6,
});

/**
 * A3-nb's constants: tuned separately over the same grid (brake constants unused, fixed at 0). **A3-nb is not a brake
 * ablation of A3**: its steering and throttle constants differ. The ablation is A3-nb-same: `RULE_A3_PARAMS` with
 * `{ brakeEnabled: false }`.
 */
export const RULE_A3_NB_PARAMS: RuleParams = Object.freeze({
  steerGain: 4,
  frontClear: 0.3,
  speedCap: 0.75,
  brakeFront: 0,
  brakeSpeed: 0,
});

/** Indices into the nine inputs (ray angles −90, −60, −30, 0, 30, 60, 90 degrees, then speed, then heading error). */
const LEFT_RAYS = Object.freeze([0, 1, 2] as const);
const FRONT_RAY = 3;
const RIGHT_RAYS = Object.freeze([4, 5, 6] as const);

/** Everything needed to rebuild a rule driver exactly; recorded with its results. */
export interface RuleDriverConfig {
  readonly agent: 'A3' | 'A3-nb';
  readonly algorithm: typeof RULE_BASED_ALGORITHM;
  readonly params: RuleParams;
  readonly brakeEnabled: boolean;
}

export interface RuleBasedDriver extends EpisodeDriver {
  readonly config: RuleDriverConfig;
}

function inRange(value: unknown, min: number, max: number, minOpen: boolean): value is number {
  return typeof value === 'number' && Number.isFinite(value) && (minOpen ? value > min : value >= min) && value <= max;
}

/** Validates the parameters (a hostile or mistaken value is refused, not clamped) and returns a frozen copy. */
export function checkRuleParams(params: unknown): RuleParams {
  if (typeof params !== 'object' || params === null) throw new RangeError('Rule parameters must be an object.');
  const p = params as Record<string, unknown>;
  const bad = (name: string, rule: string): never => {
    throw new RangeError(`Rule parameter "${name}" must be ${rule}, got ${String(p[name])}.`);
  };
  if (!inRange(p.steerGain, 0, Number.MAX_VALUE, false)) bad('steerGain', 'a finite number of at least 0');
  if (!inRange(p.frontClear, 0, 1, true)) bad('frontClear', 'a number above 0 and at most 1');
  if (!inRange(p.speedCap, 0, 1, true)) bad('speedCap', 'a number above 0 and at most 1');
  if (!inRange(p.brakeFront, 0, 1, false)) bad('brakeFront', 'a number from 0 to 1');
  if (!inRange(p.brakeSpeed, 0, 1, false)) bad('brakeSpeed', 'a number from 0 to 1');
  return Object.freeze({
    steerGain: p.steerGain as number,
    frontClear: p.frontClear as number,
    speedCap: p.speedCap as number,
    brakeFront: p.brakeFront as number,
    brakeSpeed: p.brakeSpeed as number,
  });
}

function checkInputs(inputs: unknown): readonly number[] {
  if (!Array.isArray(inputs) || inputs.length !== INPUT_COUNT) {
    throw new RangeError(`A rule-based driver needs the observation's ${INPUT_COUNT} inputs.`);
  }
  for (let i = 0; i < INPUT_COUNT; i += 1) {
    const value: unknown = inputs[i];
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new RangeError(`Input ${i} must be a finite number, got ${String(value)}.`);
  }
  return inputs as readonly number[];
}

const unit = (value: number): number => Math.min(1, Math.max(0, value));
const mean = (inputs: readonly number[], indices: readonly number[]): number => indices.reduce((sum, i) => sum + unit(inputs[i]!), 0) / indices.length;

/** The controls the rule chooses for nine inputs. Pure: nothing is stored or changed. */
export function ruleControls(inputs: readonly number[], params: RuleParams, brakeEnabled: boolean): Controls {
  const checked = checkInputs(inputs);
  const front = unit(checked[FRONT_RAY]!);
  const speed = unit(checked[SPEED_INPUT]!);
  const steering = params.steerGain * (mean(checked, RIGHT_RAYS) - mean(checked, LEFT_RAYS));
  const throttle = speed > params.speedCap ? 0 : front >= params.frontClear ? 1 : front / params.frontClear;
  const brake = brakeEnabled && front < params.brakeFront && speed > params.brakeSpeed ? 1 : 0;
  return clampControls({ steering, throttle, brake });
}

/**
 * A3 (`brakeEnabled` true) or A3-nb (false) for the given parameters. Throws RangeError for invalid parameters or
 * for an observation without its nine finite inputs.
 */
export function createRuleBasedDriver(params: RuleParams, options: { readonly brakeEnabled: boolean }): RuleBasedDriver {
  if (options === null || typeof options !== 'object' || typeof options.brakeEnabled !== 'boolean') {
    throw new RangeError('createRuleBasedDriver needs options { brakeEnabled: boolean }.');
  }
  const frozen = checkRuleParams(params);
  // Captured once: the caller's options object is never read again, so changing it later cannot change the driver
  // (or make its behaviour disagree with its recorded configuration).
  const brakeEnabled = options.brakeEnabled;
  const config: RuleDriverConfig = Object.freeze({
    agent: brakeEnabled ? 'A3' : 'A3-nb',
    algorithm: RULE_BASED_ALGORITHM,
    params: frozen,
    brakeEnabled,
  });
  return {
    config,
    decide(observation: Observation) {
      if (observation === null || typeof observation !== 'object' || observation.inputs === undefined) {
        throw new RangeError("A rule-based driver needs the observation's inputs.");
      }
      return ruleControls(observation.inputs, frozen, brakeEnabled);
    },
    reset() {},
  };
}
