// Episode scoring (P2-06): fitness from ordered checkpoint progress, laps and completed-lap times, with the
// termination rules that stop exploits. Headless and pure: it reads the simulation's per-tick racer state
// (sim/checkpoints.ts) and never steps physics, draws or reads the clock. It imports only sim/, so it is
// independent of neural inference (ai/) and the genetic operators (evolution/).
//
// Fitness formula, `fitnessVersion` 1 (points; docs/ARCHITECTURE.md "Fitness"):
//   fitness = checkpointWeight × gatesPassed
//           + partialProgressWeight × partialProgress                       (0 ≤ partialProgress ≤ 0.99)
//           + Σ completed laps ( lapWeight + lapTimeBonusScale × min(maxLapTimeRatio, referenceLapSeconds / lapSeconds) )
//           − (crashed ? collisionPenalty : 0)
// Distance and speed earn nothing.
//
// - gatesPassed and lap ticks are P1-07's ordered gate credits (only the next gate, forwards, through the gate,
//   using the move collision accepted), including the first crossing of gate 0, which starts lap timing.
// - partialProgress is a high-water mark, not a per-tick sum: the largest fraction of the way from an anchor to
//   the next gate's centre reached since the last gate credit (see partialProgressAt). It resets only when a new
//   gate is credited. Capped below 1, so any approach is worth less than one real crossing.
// - Lap seconds are whole ticks × the fixed timestep. The ratio cap keeps the bonus bounded even on a
//   degenerate track whose "lap" takes a few ticks.
//
// Termination (checked after each tick, first match wins): `completed` (maxLaps laps), `crashed` (the car
// touched a wall), `stalled` (no new gate credit for stallTicks), `timeout` (maxEpisodeTicks ticks). The caller
// stops stepping once an outcome is set; recording another tick throws.
import { lapSeconds, type Racer } from '../sim/checkpoints';
import type { Gate, Track, Vec2 } from '../sim/track';

/** The fitness formula this module implements; saved models record it as `fitnessVersion`. */
export const FITNESS_VERSION = 1;

/** Largest partial progress towards the next gate: an approach is always worth less than a crossing. */
export const PARTIAL_PROGRESS_CAP = 0.99;

/** Fitness weights, named as the `fitness` block of a saved model's `training.configuration`. */
export interface FitnessConfig {
  readonly version: number;
  /** Points per ordered gate credit. */
  readonly checkpointWeight: number;
  /** Points for a whole gate's worth of partial progress (partialProgress is at most PARTIAL_PROGRESS_CAP). */
  readonly partialProgressWeight: number;
  /** Points per completed lap. */
  readonly lapWeight: number;
  /** Points taken away once if the car crashed. */
  readonly collisionPenalty: number;
  /** Points per completed lap at the reference lap time. */
  readonly lapTimeBonusScale: number;
  /** Lap time, in simulated seconds, that earns exactly lapTimeBonusScale. */
  readonly referenceLapSeconds: number;
  /** Largest referenceLapSeconds / lapSeconds counted, so one lap's bonus is at most scale × this ratio. */
  readonly maxLapTimeRatio: number;
}

/** Episode limits, named as in a saved model's `training.configuration`. */
export interface EpisodeLimits {
  /** Simulated seconds before the episode ends as `timeout`. */
  readonly maxEpisodeSeconds: number;
  /** Simulated seconds without a new gate credit before the episode ends as `stalled`. */
  readonly stallSeconds: number;
  /** Completed laps that end the episode as `completed`. */
  readonly maxLaps: number;
}

/** Episode limits converted to whole fixed ticks. */
export interface EpisodeRules {
  readonly timestepSeconds: number;
  readonly maxEpisodeTicks: number;
  readonly stallTicks: number;
  readonly maxLaps: number;
}

export const DEFAULT_FITNESS_CONFIG: FitnessConfig = Object.freeze({
  version: FITNESS_VERSION,
  checkpointWeight: 1000,
  partialProgressWeight: 1000,
  lapWeight: 5000,
  collisionPenalty: 500,
  lapTimeBonusScale: 2000,
  referenceLapSeconds: 30,
  maxLapTimeRatio: 2,
});

export const DEFAULT_EPISODE_LIMITS: EpisodeLimits = Object.freeze({ maxEpisodeSeconds: 60, stallSeconds: 5, maxLaps: 3 });

export type EpisodeOutcome = 'completed' | 'crashed' | 'stalled' | 'timeout';

/** One car's episode so far. Each car has its own; nothing is shared between cars. */
export interface Episode {
  /** The racer's tick when this state was recorded (0 at the start). */
  readonly tick: number;
  /** The start position: the anchor for partial progress before the first gate credit. */
  readonly startPosition: Vec2;
  readonly gatesPassed: number;
  readonly nextGate: number;
  /** Completed lap durations in ticks, from the racer's progress. */
  readonly lapTicks: readonly number[];
  /** The tick of the most recent gate credit, or 0 if none yet. */
  readonly lastCreditTick: number;
  /** High-water mark of partial progress towards the next gate since the last credit, in [0, PARTIAL_PROGRESS_CAP]. */
  readonly partialProgress: number;
  readonly crashed: boolean;
  /** Why the episode ended, or null while it is running. */
  readonly outcome: EpisodeOutcome | null;
}

/** A fitness value with its parts, so a result can be explained term by term. */
export interface FitnessBreakdown {
  readonly fitnessVersion: number;
  readonly checkpoints: number;
  readonly partialProgress: number;
  readonly laps: number;
  readonly lapTimeBonus: number;
  /** collisionPenalty if the car crashed, otherwise 0 (subtracted from the total). */
  readonly collisionPenalty: number;
  readonly total: number;
}

const finiteAtLeast = (value: unknown, name: string, min: number, what: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
    throw new RangeError(`${what} "${name}" must be a finite number of at least ${min}, got ${String(value)}.`);
  }
  return value;
};
const finitePositive = (value: unknown, name: string, what: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || !(value > 0)) {
    throw new RangeError(`${what} "${name}" must be a finite number greater than 0, got ${String(value)}.`);
  }
  return value;
};

/**
 * Checks fitness weights and returns a frozen copy. Throws RangeError naming the field for: a version other than
 * FITNESS_VERSION; a negative or non-finite weight, penalty or scale; a referenceLapSeconds that is not finite and
 * greater than 0; a maxLapTimeRatio that is not finite and at least 1.
 */
export function resolveFitnessConfig(input: unknown): FitnessConfig {
  const what = 'Fitness config';
  if (input === null || typeof input !== 'object') throw new RangeError(`${what} must be an object.`);
  const c = input as Record<string, unknown>;
  if (c.version !== FITNESS_VERSION) {
    throw new RangeError(`${what} "version" must be ${FITNESS_VERSION}, got ${String(c.version)}.`);
  }
  return Object.freeze({
    version: FITNESS_VERSION,
    checkpointWeight: finiteAtLeast(c.checkpointWeight, 'checkpointWeight', 0, what),
    partialProgressWeight: finiteAtLeast(c.partialProgressWeight, 'partialProgressWeight', 0, what),
    lapWeight: finiteAtLeast(c.lapWeight, 'lapWeight', 0, what),
    collisionPenalty: finiteAtLeast(c.collisionPenalty, 'collisionPenalty', 0, what),
    lapTimeBonusScale: finiteAtLeast(c.lapTimeBonusScale, 'lapTimeBonusScale', 0, what),
    referenceLapSeconds: finitePositive(c.referenceLapSeconds, 'referenceLapSeconds', what),
    maxLapTimeRatio: finiteAtLeast(c.maxLapTimeRatio, 'maxLapTimeRatio', 1, what),
  });
}

/** Whole ticks covering `seconds`: ⌈seconds ÷ dt⌉, with a 1e-9 tolerance so 5 s at 1/60 s is exactly 300. */
function ticksFor(seconds: number, timestepSeconds: number): number {
  return Math.max(1, Math.ceil(seconds / timestepSeconds - 1e-9));
}

/**
 * Converts episode limits to whole ticks of `timestepSeconds`. Throws RangeError naming the field for a
 * maxEpisodeSeconds, stallSeconds or timestep that is not finite and greater than 0, or a maxLaps that is not
 * an integer of at least 1.
 */
export function resolveEpisodeRules(limits: unknown, timestepSeconds: number): EpisodeRules {
  const what = 'Episode limits';
  if (limits === null || typeof limits !== 'object') throw new RangeError(`${what} must be an object.`);
  const c = limits as Record<string, unknown>;
  const dt = finitePositive(timestepSeconds, 'timestepSeconds', what);
  const maxEpisodeSeconds = finitePositive(c.maxEpisodeSeconds, 'maxEpisodeSeconds', what);
  const stallSeconds = finitePositive(c.stallSeconds, 'stallSeconds', what);
  const { maxLaps } = c;
  if (typeof maxLaps !== 'number' || !Number.isInteger(maxLaps) || maxLaps < 1) {
    throw new RangeError(`${what} "maxLaps" must be an integer of at least 1, got ${String(maxLaps)}.`);
  }
  return Object.freeze({
    timestepSeconds: dt,
    maxEpisodeTicks: ticksFor(maxEpisodeSeconds, dt),
    stallTicks: ticksFor(stallSeconds, dt),
    maxLaps,
  });
}

const midpoint = (gate: Gate): Vec2 => ({ x: (gate.a.x + gate.b.x) / 2, y: (gate.a.y + gate.b.y) / 2 });
/** How far ahead of the gate's line p is, in the gate's forward direction (as sim/checkpoints.ts), scaled. */
const ahead = (gate: Gate, p: Vec2): number =>
  (gate.b.y - gate.a.y) * (p.x - gate.a.x) - (gate.b.x - gate.a.x) * (p.y - gate.a.y);
const gateLength = (gate: Gate): number => Math.hypot(gate.b.x - gate.a.x, gate.b.y - gate.a.y);

function checkGateIndex(track: Track, nextGate: number): void {
  if (track.gates.length === 0) throw new RangeError('Track has no gates.');
  if (!Number.isInteger(nextGate) || nextGate < 0 || nextGate >= track.gates.length) {
    throw new RangeError(`Next gate must be an integer from 0 to ${track.gates.length - 1}, got ${nextGate}.`);
  }
}

/**
 * Partial progress at one position: how far `position` is along the segment from the anchor to the centre of
 * gate `nextGate`, as a fraction, clamped to [0, PARTIAL_PROGRESS_CAP].
 * - The anchor is `startPosition` before the first gate credit (`gatesPassed` 0), otherwise the centre of the
 *   previous gate (gate n − 1 before gate 0, so start/finish wraps).
 * - It is 0 when the position is strictly ahead of the next gate's line without having crossed it (only possible
 *   by arriving from the wrong way), when it is more than one road width (the longer of the anchor gate and the
 *   next gate) from the segment, so the far side of the track earns nothing, and when anchor and target coincide.
 */
export function partialProgressAt(position: Vec2, nextGate: number, gatesPassed: number, startPosition: Vec2, track: Track): number {
  checkGateIndex(track, nextGate);
  const n = track.gates.length;
  const target = track.gates[nextGate]!;
  const anchorGate = gatesPassed === 0 ? target : track.gates[(nextGate - 1 + n) % n]!;
  const anchor = gatesPassed === 0 ? startPosition : midpoint(anchorGate);
  const centre = midpoint(target);
  const dx = centre.x - anchor.x;
  const dy = centre.y - anchor.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0 || ahead(target, position) > 0) return 0;
  const t = ((position.x - anchor.x) * dx + (position.y - anchor.y) * dy) / lengthSquared;
  const along = Math.min(1, Math.max(0, t));
  const offset = Math.hypot(position.x - (anchor.x + along * dx), position.y - (anchor.y + along * dy));
  if (offset > Math.max(gateLength(anchorGate), gateLength(target))) return 0;
  return Math.min(PARTIAL_PROGRESS_CAP, Math.max(0, t));
}

function checkPosition(position: Vec2): void {
  if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y)) {
    throw new RangeError(`Racer position must be finite, got (${String(position?.x)}, ${String(position?.y)}).`);
  }
}

/**
 * Starts scoring a racer that has just been placed on its start pose with fresh progress (tick 0, no gates,
 * no laps). A racer that starts crashed ends the episode at once as `crashed`.
 */
export function startEpisode(racer: Racer, track: Track): Episode {
  const { progress } = racer;
  if (progress.tick !== 0 || progress.gatesPassed !== 0 || progress.nextGate !== 0 || progress.lapTicks.length !== 0) {
    throw new RangeError('An episode must start from fresh lap progress (tick 0, no gates, no laps).');
  }
  const startPosition = racer.car.vehicle.position;
  checkPosition(startPosition);
  const crashed = racer.car.crashed === true;
  return {
    tick: 0,
    startPosition,
    gatesPassed: 0,
    nextGate: 0,
    lapTicks: progress.lapTicks,
    lastCreditTick: 0,
    partialProgress: partialProgressAt(startPosition, 0, 0, startPosition, track),
    crashed,
    outcome: crashed ? 'crashed' : null,
  };
}

/**
 * Records the racer after one more fixed tick (from stepRacer) and returns the new episode; the input is
 * unchanged. Throws RangeError if the episode has ended, if the racer is not exactly one tick later, if its gate
 * count or completed laps went down, if a crash was undone, or for a non-finite position or invalid next gate.
 */
export function recordTick(episode: Episode, racer: Racer, track: Track, rules: EpisodeRules): Episode {
  if (episode.outcome !== null) throw new RangeError(`The episode has already ended (${episode.outcome}).`);
  const { progress } = racer;
  const tick = episode.tick + 1;
  if (progress.tick !== tick) throw new RangeError(`Expected the racer at tick ${tick}, got ${progress.tick}.`);
  if (!(progress.gatesPassed >= episode.gatesPassed)) throw new RangeError('Gates passed must never decrease.');
  if (!(progress.lapTicks.length >= episode.lapTicks.length)) throw new RangeError('Completed laps must never decrease.');
  if (episode.crashed && racer.car.crashed !== true) throw new RangeError('A crashed car cannot become uncrashed.');
  checkGateIndex(track, progress.nextGate);
  const position = racer.car.vehicle.position;
  checkPosition(position);

  const credited = progress.gatesPassed > episode.gatesPassed;
  const lastCreditTick = credited ? tick : episode.lastCreditTick;
  const here = partialProgressAt(position, progress.nextGate, progress.gatesPassed, episode.startPosition, track);
  const crashed = racer.car.crashed === true;
  let outcome: EpisodeOutcome | null = null;
  if (progress.lapTicks.length >= rules.maxLaps) outcome = 'completed';
  else if (crashed) outcome = 'crashed';
  else if (tick - lastCreditTick >= rules.stallTicks) outcome = 'stalled';
  else if (tick >= rules.maxEpisodeTicks) outcome = 'timeout';
  return {
    tick,
    startPosition: episode.startPosition,
    gatesPassed: progress.gatesPassed,
    nextGate: progress.nextGate,
    lapTicks: progress.lapTicks,
    lastCreditTick,
    partialProgress: credited ? here : Math.max(episode.partialProgress, here),
    crashed,
    outcome,
  };
}

/** The episode's fitness so far (or final, once it has an outcome), with each term of the formula. */
export function scoreEpisode(episode: Episode, configInput: FitnessConfig, rules: EpisodeRules): FitnessBreakdown {
  const config = resolveFitnessConfig(configInput);
  const checkpoints = config.checkpointWeight * episode.gatesPassed;
  const partialProgress = config.partialProgressWeight * episode.partialProgress;
  const laps = config.lapWeight * episode.lapTicks.length;
  let lapTimeBonus = 0;
  for (const ticks of episode.lapTicks) {
    const ratio = config.referenceLapSeconds / lapSeconds(ticks, rules.timestepSeconds);
    lapTimeBonus += config.lapTimeBonusScale * Math.min(config.maxLapTimeRatio, ratio);
  }
  const collisionPenalty = episode.crashed ? config.collisionPenalty : 0;
  return {
    fitnessVersion: config.version,
    checkpoints,
    partialProgress,
    laps,
    lapTimeBonus,
    collisionPenalty,
    total: checkpoints + partialProgress + laps + lapTimeBonus - collisionPenalty,
  };
}
