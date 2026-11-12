// Human vs AI race (P5-03, ST5): two independent racers on one track, one fixed tick at a time.
//
// Both cars are advanced by the one simulation path the trainer, the evaluation and the champion replay use
// (training/episodeStep.ts `stepEpisode`); only the source of the controls differs: the human's come from the buttons
// held, the AI's from its loaded network. Each racer has its OWN vehicle, crash flag, lap progress and episode, and they
// never interact: there is no car-to-car collision, and the AI's ray sensors read the track's walls only, so the human
// car is invisible to the AI and to the physics. The AI side reads nothing but its genome and the setup, so its
// trajectory in a race is identical to its solo run on the same circuit under the same rules, whatever the human does.
//
// The race ends for a car when it completes the chosen laps (`completed`), touches a wall (`crashed`), goes
// stallSeconds without a new gate credit (`stalled`) or the race clock runs out (`timeout`, RACE_SECONDS_PER_LAP per
// chosen lap). The same rules judge both cars. Nothing here draws, reads a clock or stores anything; a countdown,
// a camera and drawing are the page's concern and never enter this module.
import { createNetworkDriver, type EpisodeDriver } from '../ai/drivers';
import { DEFAULT_SENSOR_CONFIG, type SensorConfig } from '../sensors/rays';
import { lapSeconds } from '../sim/checkpoints';
import type { VehiclePhysics } from '../sim/config';
import type { Track } from '../sim/track';
import type { Controls } from '../sim/vehicle';
import { stepEpisode, startEpisodeState, type EpisodeContext, type EpisodeState } from './episodeStep';
import { resolveEpisodeRules, type EpisodeOutcome } from './fitness';

/** Race clock per chosen lap, in simulated seconds (the P5-03 plan's proposal; the result records the limit it used). */
export const RACE_SECONDS_PER_LAP = 60;

/** Laps a race may be set to: whole laps, at least 1 and at most this. */
export const MAX_RACE_LAPS = 10;

export interface RaceInput {
  readonly track: Track;
  /** The champion's own recorded physics and timestep: both cars drive under them. */
  readonly physics: VehiclePhysics;
  readonly timestepSeconds: number;
  /** The champion's own stall limit in simulated seconds, applied to both cars. */
  readonly stallSeconds: number;
  /** Whole laps the race is run over. */
  readonly laps: number;
  /** The champion's parameters (copied). */
  readonly genome: ArrayLike<number>;
  /** False for a champion saved without a brake: the AI's brake output is masked, the human keeps theirs. */
  readonly brakeEnabled: boolean;
  readonly sensors?: SensorConfig;
}

/** What a race is run with. `context` is the same object shape the trainer's setup provides to `stepEpisode`. */
export interface RaceSetup {
  readonly context: EpisodeContext;
  readonly laps: number;
  readonly brakeEnabled: boolean;
  /** The race clock in ticks (and seconds, recorded in the result). */
  readonly raceSeconds: number;
  readonly genome: Float64Array;
}

export interface RaceState {
  /** Ticks run so far: the same for both cars (a finished car stops changing). */
  readonly tick: number;
  readonly human: EpisodeState;
  readonly ai: EpisodeState;
}

/** The checked setup for a race. Throws RangeError naming the field for a lap count that is not a whole number in [1, MAX_RACE_LAPS], or an unusable timestep or stall limit. */
export function createRaceSetup(input: RaceInput): RaceSetup {
  if (input === null || typeof input !== 'object') throw new RangeError('A race needs a setup object.');
  const { laps } = input;
  if (typeof laps !== 'number' || !Number.isInteger(laps) || laps < 1 || laps > MAX_RACE_LAPS) {
    throw new RangeError(`A race's "laps" must be a whole number from 1 to ${MAX_RACE_LAPS}, got ${String(laps)}.`);
  }
  if (typeof input.brakeEnabled !== 'boolean') throw new RangeError('A race needs "brakeEnabled" to be true or false.');
  const raceSeconds = RACE_SECONDS_PER_LAP * laps;
  const rules = resolveEpisodeRules(
    { maxEpisodeSeconds: raceSeconds, stallSeconds: input.stallSeconds, maxLaps: laps },
    input.timestepSeconds,
  );
  const genome = Float64Array.from(input.genome);
  // Checking the parameters here (not at the first tick) means a damaged model is refused before the countdown.
  createNetworkDriver(genome, { brakeEnabled: input.brakeEnabled });
  return Object.freeze({
    context: Object.freeze({
      environment: Object.freeze({ track: input.track, physics: input.physics, timestepSeconds: input.timestepSeconds }),
      sensors: input.sensors ?? DEFAULT_SENSOR_CONFIG,
      rules,
    }),
    laps,
    brakeEnabled: input.brakeEnabled,
    raceSeconds,
    genome,
  });
}

/** Both cars at the track's one start pose, at rest, tick 0, with fresh and separate progress. */
export function createRace(setup: RaceSetup): RaceState {
  return { tick: 0, human: startEpisodeState(setup.context), ai: startEpisodeState(setup.context) };
}

/** True once both racers have an outcome. */
export function raceDone(state: RaceState): boolean {
  return state.human.episode.outcome !== null && state.ai.episode.outcome !== null;
}

const finiteControl = (value: unknown, low: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(low, value));
};

/** A human's controls made safe: a non-finite value counts as not pressed, and each is held to its range. */
export function sanitiseControls(controls: Controls | null | undefined): Controls {
  if (controls === null || typeof controls !== 'object') return { steering: 0, throttle: 0, brake: 0 };
  return {
    steering: finiteControl(controls.steering, -1),
    throttle: finiteControl(controls.throttle, 0),
    brake: finiteControl(controls.brake, 0),
  };
}

/**
 * A stepper for one race: it owns the AI's driver, so the AI's path depends on its genome and the setup only.
 * `step` runs one fixed tick of both racers with the human's controls for that tick.
 */
export interface RaceRunner {
  readonly setup: RaceSetup;
  start(): RaceState;
  step(state: RaceState, humanControls: Controls): RaceState;
}

export function createRaceRunner(setup: RaceSetup): RaceRunner {
  const driver: EpisodeDriver = createNetworkDriver(setup.genome, { brakeEnabled: setup.brakeEnabled });
  return {
    setup,
    start() {
      driver.reset();
      return createRace(setup);
    },
    step(state, humanControls) {
      if (raceDone(state)) return state;
      const held = sanitiseControls(humanControls);
      const human = stepEpisode(state.human, () => held, setup.context);
      const ai = stepEpisode(state.ai, (inputs, racer) => driver.decide({ car: racer.car, inputs }), setup.context);
      return { tick: state.tick + 1, human, ai };
    },
  };
}

/** One car's result, in simulated time. */
export interface RacerResult {
  readonly outcome: EpisodeOutcome | null;
  /** Whole laps completed. */
  readonly laps: number;
  /** The first completed lap in simulated seconds, or null (no lap completed, not zero). */
  readonly firstLapSeconds: number | null;
  /** The fastest completed lap in simulated seconds, or null. */
  readonly bestLapSeconds: number | null;
  /** The sum of the completed laps when the car completed the chosen laps, otherwise null. */
  readonly totalSeconds: number | null;
  /** Ordered gate credits. */
  readonly gates: number;
  /** The tick of the wall contact, or null. */
  readonly crashTick: number | null;
  /** 0 or 1: a car's run ends at its first wall contact in this simulation. */
  readonly wallCollisions: number;
}

export interface RaceResult {
  readonly laps: number;
  readonly raceSeconds: number;
  readonly timestepSeconds: number;
  readonly human: RacerResult;
  readonly ai: RacerResult;
  /** True when the champion was saved without a brake, so its brake output was masked. */
  readonly aiHadNoBrake: boolean;
  /** One true sentence about the comparison; a winner is named only when both cars completed. */
  readonly comparison: string;
}

function racerResult(state: EpisodeState, laps: number, dt: number): RacerResult {
  const lapTicks = state.racer.progress.lapTicks;
  const completed = state.episode.outcome === 'completed';
  const times = lapTicks.map((t) => lapSeconds(t, dt));
  return {
    outcome: state.episode.outcome,
    laps: lapTicks.length,
    firstLapSeconds: times.length > 0 ? times[0]! : null,
    bestLapSeconds: times.length > 0 ? Math.min(...times) : null,
    totalSeconds: completed && lapTicks.length >= laps ? lapSeconds(lapTicks.reduce((a, b) => a + b, 0), dt) : null,
    gates: state.episode.gatesPassed,
    crashTick: state.episode.crashed ? state.episode.tick : null,
    wallCollisions: state.episode.crashed ? 1 : 0,
  };
}

const seconds = (value: number): string => `${value.toFixed(2)} s`;

function describeEnd(who: 'You' | 'The AI', r: RacerResult): string {
  switch (r.outcome) {
    case 'crashed':
      return `${who} crashed at gate ${r.gates}`;
    case 'stalled':
      return `${who} stalled (no new gate for too long) at gate ${r.gates}`;
    case 'timeout':
      return `${who} ran out of race time at gate ${r.gates}`;
    case 'completed':
      return `${who} completed the race`;
    default:
      return `${who} had not finished`;
  }
}

/** The comparison sentence: only a true one. A winner is named only when both cars completed the chosen laps. */
export function compareRace(human: RacerResult, ai: RacerResult, laps: number): string {
  const lapWord = laps === 1 ? '1 lap' : `${laps} laps`;
  if (human.outcome === 'completed' && ai.outcome === 'completed' && human.totalSeconds !== null && ai.totalSeconds !== null) {
    const diff = human.totalSeconds - ai.totalSeconds;
    if (Math.abs(diff) < 1e-9) return `Both completed ${lapWord} in exactly the same time (${seconds(human.totalSeconds)}): a tie.`;
    return diff < 0
      ? `You were faster over ${lapWord} by ${seconds(-diff)} (${seconds(human.totalSeconds)} against ${seconds(ai.totalSeconds)}).`
      : `The AI was faster over ${lapWord} by ${seconds(diff)} (${seconds(ai.totalSeconds)} against ${seconds(human.totalSeconds)}).`;
  }
  if (human.outcome === null || ai.outcome === null) return 'The race is still running.';
  if (human.outcome === 'completed') return `${describeEnd('You', human)}; ${describeEnd('The AI', ai).replace(/^The AI/, 'the AI')}. No winner is declared because the AI did not complete ${lapWord}.`;
  if (ai.outcome === 'completed') return `${describeEnd('The AI', ai)}; ${describeEnd('You', human).replace(/^You/, 'you')}. No winner is declared because you did not complete ${lapWord}.`;
  return `${describeEnd('You', human)}; ${describeEnd('The AI', ai).replace(/^The AI/, 'the AI')}. No winner is declared because neither car completed ${lapWord}.`;
}

/** The results of a race, in simulated time. Callable at any tick; outcomes are null while a car is still running. */
export function raceResult(setup: RaceSetup, state: RaceState): RaceResult {
  const dt = setup.context.environment.timestepSeconds;
  const human = racerResult(state.human, setup.laps, dt);
  const ai = racerResult(state.ai, setup.laps, dt);
  return {
    laps: setup.laps,
    raceSeconds: setup.raceSeconds,
    timestepSeconds: dt,
    human,
    ai,
    aiHadNoBrake: !setup.brakeEnabled,
    comparison: compareRace(human, ai, setup.laps),
  };
}
