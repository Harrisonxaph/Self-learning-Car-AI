// Champion replay (P3-04): one genome's episode, one fixed tick at a time, with what the network saw and chose.
//
// It steps through the same `stepEpisode` as the trainer (training/episodeStep.ts), so the car takes exactly the path it
// took in the population: cars are independent, and a tick reads only the car and the setup. Nothing here draws random
// numbers and nothing in the trainer changes.
//
// A tick has two different states, and a frame keeps them apart:
//   before    the DECISION state: the racer and episode as they were when the network was asked (after tick - 1 ticks).
//   decision  the inputs, the rays and the controls, all taken from `before`. The inputs and controls are captured inside
//             the `decide` callback that drives the physics, so they are the values that drove the car, not a recomputation.
//   after     the RESULT state: what the tick produced (after `tick` ticks): the new pose, any crash, gate or lap.
// The next frame's `before` is this frame's `after`. When a step ends the episode there is no further decision, and
// `step()` returns null rather than inventing one.
import { runNetwork } from '../ai/network';
import { castRays, type SensorReadings } from '../sensors/rays';
import type { Controls } from '../sim/vehicle';
import { stepEpisode, type EpisodeState } from './episodeStep';
import { startCar, type TrainingSetup } from './trainer';

/** What the network was asked and answered on one tick. */
export interface ReplayDecision {
  /** The nine network inputs, as the network received them. */
  readonly inputs: readonly number[];
  /** The three controls the network chose (steering, throttle, brake), as the physics received them. */
  readonly controls: Controls;
  /** The rays cast from the decision state, for drawing. Their normalised distances are inputs 0 to 6. */
  readonly readings: SensorReadings;
}

export interface ReplayFrame {
  /** Ticks completed once this step has run: 1 for the first step, the same count as `Generation.tick`. */
  readonly tick: number;
  readonly before: EpisodeState;
  readonly decision: ReplayDecision;
  readonly after: EpisodeState;
}

export interface ChampionReplay {
  /** The state before the first tick: the track's start pose at rest. */
  readonly start: EpisodeState;
  /** Runs one tick and returns its frame, or null once the episode has ended. */
  step(): ReplayFrame | null;
  /** The latest state: `start` before the first step, then each step's `after`. */
  state(): EpisodeState;
  /** Ticks completed so far. */
  ticks(): number;
  /** True once the episode has an outcome. */
  done(): boolean;
}

/** A replay of `genome` on the setup's track, from the start pose. The genome is copied, so later changes to it are not seen. */
export function createChampionReplay(genome: Float64Array, setup: TrainingSetup): ChampionReplay {
  const parameters = Float64Array.from(genome);
  const brake = { brakeEnabled: setup.config.brakeEnabled };
  const { track, physics } = setup.environment;
  const start: EpisodeState = startCar(parameters, setup);
  let current: EpisodeState = { racer: start.racer, episode: start.episode };
  let ticks = 0;
  return {
    start: current,
    step() {
      if (current.episode.outcome !== null) return null;
      const before = current;
      let captured: { inputs: readonly number[]; controls: Controls; readings: SensorReadings } | null = null;
      const after = stepEpisode(
        before,
        (inputs, racer) => {
          const controls = runNetwork(parameters, inputs, brake);
          captured = { inputs, controls, readings: castRays(racer.car.vehicle, track, physics, setup.sensors) };
          return controls;
        },
        setup,
      );
      if (captured === null) throw new Error('The network was not asked for a decision.');
      current = after;
      ticks += 1;
      return { tick: ticks, before, decision: captured, after };
    },
    state: () => current,
    ticks: () => ticks,
    done: () => current.episode.outcome !== null,
  };
}

