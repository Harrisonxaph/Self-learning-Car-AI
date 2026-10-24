// What the driving display shows: lap count, current/last/best lap time, the next gate, speed and a short
// message for each event (checkpoint, lap, crash, restart). Pure functions of the world, so they are tested
// headless; main.ts only copies the text into the page.
import type { World } from '../sim/world';

export interface HudView {
  readonly laps: number;
  readonly currentLap: string;
  readonly lastLap: string;
  readonly bestLap: string;
  /** "3 / 20": the next gate to cross, counting from 1. */
  readonly nextGate: string;
  readonly speedKmh: number;
  readonly crashed: boolean;
}

/** A tick count as seconds with two decimals, or an em dash when there is none. */
export function formatTicks(ticks: number | null, timestepSeconds: number): string {
  return ticks === null ? '—' : `${(ticks * timestepSeconds).toFixed(2)} s`;
}

export function hudView(world: World, timestepSeconds: number): HudView {
  const { progress, car } = world.racer;
  const laps = progress.lapTicks;
  return {
    laps: laps.length,
    currentLap: formatTicks(progress.lapStartTick === null ? null : progress.tick - progress.lapStartTick, timestepSeconds),
    lastLap: formatTicks(laps.length > 0 ? laps[laps.length - 1]! : null, timestepSeconds),
    bestLap: formatTicks(world.bestLapTicks, timestepSeconds),
    nextGate: `${progress.nextGate + 1} / ${world.track.gates.length}`,
    speedKmh: Math.round(car.vehicle.speed * 3.6),
    crashed: car.crashed,
  };
}

export type FeedbackKind = 'start' | 'checkpoint' | 'lap' | 'crash' | 'restart';

export interface Feedback {
  readonly kind: FeedbackKind;
  readonly text: string;
  /** The world tick after which the message is hidden; a crash message stays until restart. */
  readonly untilTick: number;
}

/** How long event messages stay up: 2 s at 60 ticks per second. */
export const FEEDBACK_TICKS = 120;

/**
 * The message to show after the world changed from `before` to `after` (one or more ticks, and `restarted`
 * if the car was restarted in between), or the current message if nothing new happened. A restart outranks
 * a crash, which outranks a lap, which outranks a checkpoint.
 */
export function nextFeedback(
  before: World,
  after: World,
  current: Feedback | null,
  timestepSeconds: number,
  restarted = false,
): Feedback | null {
  const show = (kind: FeedbackKind, text: string, sticky = false): Feedback => ({
    kind,
    text,
    untilTick: sticky ? Number.POSITIVE_INFINITY : after.tick + FEEDBACK_TICKS,
  });
  const was = before.racer;
  const now = after.racer;
  if (restarted) return show('restart', 'Restarted: drive over the start line to begin a lap.');
  if (now.car.crashed && !was.car.crashed) return show('crash', 'Crashed! Press R or tap Restart.', true);
  const laps = now.progress.lapTicks;
  if (laps.length > was.progress.lapTicks.length) {
    const lap = laps[laps.length - 1]!;
    const best = lap === after.bestLapTicks ? ' (best)' : '';
    return show('lap', `Lap ${laps.length}: ${formatTicks(lap, timestepSeconds)}${best}`);
  }
  if (now.progress.gatesPassed > was.progress.gatesPassed) {
    if (was.progress.lapStartTick === null) return show('start', 'Lap timing started.');
    const passed = (now.progress.nextGate + after.track.gates.length - 1) % after.track.gates.length;
    return show('checkpoint', `Checkpoint ${passed} / ${after.track.gates.length - 1}`);
  }
  if (current && after.tick > current.untilTick) return null;
  return current;
}
