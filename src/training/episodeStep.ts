// One car's episode, one fixed tick at a time: the single simulation path shared by the trainer (P2-05) and the
// headless driver evaluation (P2-08 step 2). Only the source of the controls differs between them:
//
//   buildInputs (ai/inputs.ts) → decide(inputs) → stepRacer (sim/checkpoints.ts: physics, swept collision, gates)
//   → recordTick (training/fitness.ts: termination).
//
// Every episode starts from startRacer (the track's one start pose, at rest, tick 0) and startEpisode. Nothing
// here draws random numbers; any randomness belongs to the controls' source.
import { buildInputs } from '../ai/inputs';
import type { SensorConfig } from '../sensors/rays';
import { stepRacer, type Racer } from '../sim/checkpoints';
import type { VehiclePhysics } from '../sim/config';
import type { Pose, Track } from '../sim/track';
import type { Controls } from '../sim/vehicle';
import { startRacer } from '../sim/world';
import { recordTick, startEpisode, type Episode, type EpisodeRules } from './fitness';

/** What an episode needs besides its controls; a TrainingSetup and an EvaluationSetup both provide it. */
export interface EpisodeContext {
  readonly environment: { readonly track: Track; readonly physics: VehiclePhysics; readonly timestepSeconds: number };
  readonly sensors: SensorConfig;
  readonly rules: EpisodeRules;
}

/** A car's racer (vehicle, crash flag, lap progress) and its episode. */
export interface EpisodeState {
  readonly racer: Racer;
  readonly episode: Episode;
}

/** Chooses one tick's controls from the network inputs and the racer they were built from. */
export type DecideControls = (inputs: readonly number[], racer: Racer) => Controls;

/**
 * A fresh episode: the track's start pose at rest (or the `pose` override an evaluation gives, P4-05; the track is not
 * changed), uncrashed, with fresh lap progress and episode.
 */
export function startEpisodeState(context: EpisodeContext, pose?: Pose): EpisodeState {
  const { track, physics } = context.environment;
  const racer = startRacer(track, physics, pose);
  return { racer, episode: startEpisode(racer, track) };
}

/**
 * One fixed tick: inputs, controls, physics with collision and gates, then episode termination. A finished
 * episode is returned unchanged and `decide` is not called. Pure apart from whatever `decide` does.
 */
export function stepEpisode(state: EpisodeState, decide: DecideControls, context: EpisodeContext): EpisodeState {
  if (state.episode.outcome !== null) return state;
  const { track, physics, timestepSeconds } = context.environment;
  const inputs = buildInputs(state.racer, track, physics, context.sensors);
  const racer = stepRacer(state.racer, decide(inputs, state.racer), track, physics, timestepSeconds);
  return { racer, episode: recordTick(state.episode, racer, track, context.rules) };
}
