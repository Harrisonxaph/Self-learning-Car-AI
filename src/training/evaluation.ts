// Headless evaluation of one driver for one episode (P2-08 step 2), on a training or validation track. It uses the
// trainer's own per-tick path (training/episodeStep.ts): buildInputs → driver.decide → stepRacer → recordTick, and
// scores the episode with scoreEpisode. Only the source of the controls differs from a training car.
//
// Boundaries (docs/ARCHITECTURE.md, "Baseline drivers and headless evaluation"):
// - A held-out track is refused (assertEvaluationTrack, TrackLeakageError); held-out evaluation is E6 and goes
//   through heldOutTrack with a frozen model.
// - Validation may be evaluated but is never trained on: this module imports nothing from evolution/ and feeds no
//   population, and the trainer keeps its own assertTrainingTrack.
// - It draws no random numbers. A stochastic driver owns its generator, and evaluateDriver resets the driver
//   before the first tick, so the same driver and setup always give the same episode.
import type { EpisodeDriver } from '../ai/drivers';
import { INPUT_CONTRACT } from '../ai/inputs';
import { DEFAULT_SENSOR_CONFIG, type SensorConfig } from '../sensors/rays';
import type { Racer } from '../sim/checkpoints';
import type { VehiclePhysics } from '../sim/config';
import type { Track } from '../sim/track';
import { startEpisodeState, stepEpisode } from './episodeStep';
import {
  DEFAULT_EPISODE_LIMITS,
  DEFAULT_FITNESS_CONFIG,
  FITNESS_VERSION,
  resolveEpisodeRules,
  resolveFitnessConfig,
  scoreEpisode,
  type Episode,
  type EpisodeLimits,
  type EpisodeRules,
  type FitnessBreakdown,
  type FitnessConfig,
} from './fitness';
import { assertEvaluationTrack, trackContentHash } from './trackSplits';

/** Episode limits and fitness weights for an evaluation, named as in TrainingConfig. */
export interface EvaluationConfig extends EpisodeLimits {
  readonly fitness: FitnessConfig;
}

/** The trainer's defaults (DEFAULT_TRAINING_CONFIG uses the same): 60 s episodes, 5 s stall, 3-lap cap, P2-06 weights. */
export const DEFAULT_EVALUATION_CONFIG: EvaluationConfig = Object.freeze({ ...DEFAULT_EPISODE_LIMITS, fitness: DEFAULT_FITNESS_CONFIG });

const CONFIG_KEYS: readonly string[] = Object.keys(DEFAULT_EVALUATION_CONFIG);

export interface EvaluationEnvironment {
  readonly track: Track;
  readonly physics: VehiclePhysics;
  readonly timestepSeconds: number;
}

/** A validated evaluation: configuration, derived rules, sensors and what the track is. */
export interface EvaluationSetup {
  readonly config: EvaluationConfig;
  readonly environment: EvaluationEnvironment;
  readonly sensors: SensorConfig;
  readonly rules: EpisodeRules;
  readonly versions: {
    readonly inputContract: string;
    readonly fitnessVersion: number;
    readonly trackId: string;
    readonly trackVersion: string;
    readonly trackHash: string;
    readonly trackSplit: 'training' | 'validation' | 'unregistered';
  };
}

/**
 * Checks an evaluation configuration (any field left out takes DEFAULT_EVALUATION_CONFIG's value) against an
 * environment. Throws RangeError for an unknown field, anything the episode-limit or fitness resolvers reject, or a
 * track without gates, and TrackLeakageError for a held-out track.
 */
export function createEvaluationSetup(input: unknown, environment: EvaluationEnvironment): EvaluationSetup {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new RangeError('Evaluation config must be an object.');
  for (const key of Object.keys(input)) {
    if (!CONFIG_KEYS.includes(key)) throw new RangeError(`Unknown evaluation config field "${key}"; allowed: ${CONFIG_KEYS.join(', ')}.`);
  }
  const merged = { ...DEFAULT_EVALUATION_CONFIG, ...(input as Partial<EvaluationConfig>) };
  const rules = resolveEpisodeRules(merged, environment.timestepSeconds);
  const fitness = resolveFitnessConfig(merged.fitness);
  if (!environment.track || environment.track.gates.length === 0) throw new RangeError('Evaluation needs a track with gates.');
  const trackSplit = assertEvaluationTrack(environment.track);
  return Object.freeze({
    config: Object.freeze({
      maxEpisodeSeconds: merged.maxEpisodeSeconds,
      stallSeconds: merged.stallSeconds,
      maxLaps: rules.maxLaps,
      fitness,
    }),
    environment: Object.freeze({ ...environment }),
    sensors: DEFAULT_SENSOR_CONFIG,
    rules,
    versions: Object.freeze({
      inputContract: INPUT_CONTRACT,
      fitnessVersion: FITNESS_VERSION,
      trackId: environment.track.id,
      trackVersion: environment.track.version,
      trackHash: trackContentHash(environment.track),
      trackSplit,
    }),
  });
}

/** One finished evaluation episode. */
export interface DriverEvaluation {
  readonly racer: Racer;
  readonly episode: Episode;
  readonly fitness: FitnessBreakdown;
  /** Ordered gate credits ÷ gates per lap (P1-07 credits, including the first crossing of gate 0). */
  readonly orderedProgress: number;
  /** Calls to driver.decide: one per simulated tick. */
  readonly decisions: number;
}

/**
 * Resets `driver`, then runs one whole episode from the track's start pose until an outcome, asking the driver
 * for controls once per tick with the car and its nine network inputs. Deterministic for a given driver
 * configuration and setup.
 */
export function evaluateDriver(driver: EpisodeDriver, setup: EvaluationSetup): DriverEvaluation {
  driver.reset();
  let decisions = 0;
  const decide = (inputs: readonly number[], racer: Racer) => {
    decisions += 1;
    return driver.decide({ car: racer.car, inputs });
  };
  let state = startEpisodeState(setup);
  while (state.episode.outcome === null) state = stepEpisode(state, decide, setup);
  return Object.freeze({
    racer: state.racer,
    episode: state.episode,
    fitness: scoreEpisode(state.episode, setup.config.fitness, setup.rules),
    orderedProgress: state.episode.gatesPassed / setup.environment.track.gates.length,
    decisions,
  });
}
