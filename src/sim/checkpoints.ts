// Ordered checkpoint gates, lap counting and lap timing. Headless and pure: progress only changes through
// advanceProgress, from one simulation pose to the next, and time is counted in fixed ticks.
//
// Rules:
// - The car's reference point is its rear axle: the vehicle state's `position` (sim/vehicle.ts). Between
//   ticks it moves in a straight line, the same motion sim/collision.ts sweeps, so a crossing found on that
//   segment is exact at any speed. (The nose reaches a gate 3.25 m before the reference point does.)
// - Only the next gate in order can count. Gate 0 is the start/finish line; the start pose sits just behind
//   it, so the first forward crossing of gate 0 starts lap timing, then gates 1 … n−1 must follow in order,
//   and crossing gate 0 again completes the lap and starts the next one.
// - Forward is the gate's a → b direction turned a quarter turn anticlockwise as seen on screen: (dy, −dx)
//   for d = b − a. Since a is on the inner boundary, a car driving forwards has the infield on its left, so
//   it laps anticlockwise on screen. On the built-in track this is the start direction.
// - A crossing goes from behind or exactly on the gate's line to strictly ahead of it, through the gate
//   segment, end points included. So a car that starts on a gate, or rests on one for several ticks, gets
//   one credit when it moves off it forwards; stopping on the line, moving backwards, or passing beyond
//   a gate's ends gives nothing.
// - Credit cannot repeat: once a gate counts, the next gate is a different one, so lingering on it or
//   crossing it back and forth earns nothing more. A lap needs every gate, in order, since the last lap.
// - One step can cross several gates (a very fast car or a long timestep); they count in order along the
//   step, each only if it is the next gate at that point.
import { segmentsTouch, stepCar, type Car } from './collision';
import type { VehiclePhysics } from './config';
import type { Gate, Track, Vec2 } from './track';
import type { Controls } from './vehicle';

/** One car's progress round the track. Each car has its own; nothing is shared between cars. */
export interface LapProgress {
  /** Ticks advanced so far. */
  readonly tick: number;
  /** Index of the only gate that can count next. */
  readonly nextGate: number;
  /** Ordered gate crossings credited so far, including each crossing of gate 0. */
  readonly gatesPassed: number;
  /** The tick when the current lap started (a gate 0 crossing), or null before the first one. */
  readonly lapStartTick: number | null;
  /** Durations of completed laps, in ticks. Seconds = ticks × the fixed timestep (see lapSeconds). */
  readonly lapTicks: readonly number[];
}

/** A car together with its lap progress. */
export interface Racer {
  readonly car: Car;
  readonly progress: LapProgress;
}

/** Progress before the first tick: waiting for gate 0, no laps. */
export function createProgress(): LapProgress {
  return { tick: 0, nextGate: 0, gatesPassed: 0, lapStartTick: null, lapTicks: [] };
}

/** A lap's duration in seconds: whole ticks × the fixed timestep, so it never depends on frame rate. */
export function lapSeconds(ticks: number, timestepSeconds: number): number {
  return ticks * timestepSeconds;
}

/** How far ahead of the gate's line p is, in the forward direction (scaled by the gate's length). */
function ahead(gate: Gate, p: Vec2): number {
  const dx = gate.b.x - gate.a.x;
  const dy = gate.b.y - gate.a.y;
  return dy * (p.x - gate.a.x) - dx * (p.y - gate.a.y);
}

/**
 * If moving from `from` to `to` crosses the gate forwards (see the rules above), the fraction of the way
 * along the move where it crosses the line, from 0 to 1; otherwise null.
 */
export function forwardCrossing(gate: Gate, from: Vec2, to: Vec2): number | null {
  const before = ahead(gate, from);
  const after = ahead(gate, to);
  if (!(before <= 0 && after > 0)) return null;
  if (!segmentsTouch(from, to, gate.a, gate.b)) return null;
  return before / (before - after);
}

/**
 * Advances progress by one tick in which the reference point moved from `from` to `to` (equal when the car
 * did not move, for example when collision rejected the step). Returns new progress; the input is unchanged.
 */
export function advanceProgress(progress: LapProgress, from: Vec2, to: Vec2, track: Track): LapProgress {
  const tick = progress.tick + 1;
  let { nextGate, gatesPassed, lapStartTick } = progress;
  let lapTicks = progress.lapTicks;
  // Count the gates crossed this tick in order along the move; at most one full lap's worth.
  let along = 0;
  for (let i = 0; i < track.gates.length; i += 1) {
    const at = forwardCrossing(track.gates[nextGate]!, from, to);
    if (at === null || at < along) break;
    along = at;
    gatesPassed += 1;
    if (nextGate === 0) {
      if (lapStartTick !== null) lapTicks = [...lapTicks, tick - lapStartTick];
      lapStartTick = tick;
    }
    nextGate = (nextGate + 1) % track.gates.length;
  }
  if (gatesPassed === progress.gatesPassed) return { ...progress, tick };
  return { tick, nextGate, gatesPassed, lapStartTick, lapTicks };
}

/**
 * Steps a car (physics and collision, sim/collision.ts) and then its progress, using only the move the
 * collision check accepted. A step that would hit a wall leaves the car where it was, so it credits no gate,
 * even one the rejected move would have crossed; a crashed car earns nothing more, though its ticks go on.
 */
export function stepRacer(racer: Racer, controls: Controls, track: Track, physics: VehiclePhysics, dt: number): Racer {
  const car = stepCar(racer.car, controls, track, physics, dt);
  const progress = advanceProgress(racer.progress, racer.car.vehicle.position, car.vehicle.position, track);
  return { car, progress };
}
