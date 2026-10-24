import { describe, expect, it } from 'vitest';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { loadTrack } from '../../src/sim/track';
import type { Controls } from '../../src/sim/vehicle';
import { createWorld, restartWorld, stepWorld, type World } from '../../src/sim/world';
import { FEEDBACK_TICKS, formatTicks, hudView, nextFeedback, type Feedback } from '../../src/ui/hud';
import { pursuit } from '../sim/ovalDriver';

const DT = DEFAULT_SIM_CONFIG.timestepSeconds;
const track = loadTrack(stadiumOval);
const start = () => createWorld(track, DEFAULT_VEHICLE_PHYSICS);
const step = (world: World, controls: Controls) => stepWorld(world, controls, DEFAULT_SIM_CONFIG);
const FULL_THROTTLE: Controls = { steering: 0, throttle: 1, brake: 0 };

/** Steps until `done`, recording the feedback after every tick as the page does once per frame. */
function play(world: World, controls: (w: World) => Controls, done: (w: World) => boolean, limit = 60 * 120) {
  let feedback: Feedback | null = null;
  const messages: string[] = [];
  for (let i = 0; i < limit && !done(world); i += 1) {
    const next = step(world, controls(world));
    feedback = nextFeedback(world, next, feedback, DT);
    if (feedback && messages[messages.length - 1] !== feedback.text) messages.push(feedback.text);
    world = next;
  }
  return { world, feedback, messages };
}

describe('HUD values', () => {
  it('formats tick counts as seconds, and missing times as a dash', () => {
    expect(formatTicks(2454, DT)).toBe('40.90 s');
    expect(formatTicks(0, DT)).toBe('0.00 s');
    expect(formatTicks(null, DT)).toBe('—');
  });

  it('shows no times before the start line, then the current lap time from the gate 0 crossing', () => {
    expect(hudView(start(), DT)).toEqual({
      laps: 0, currentLap: '—', lastLap: '—', bestLap: '—', nextGate: '1 / 20', speedKmh: 0, crashed: false,
    });
    const { world } = play(start(), () => FULL_THROTTLE, (w) => w.racer.progress.lapStartTick !== null);
    const later = Array.from({ length: 60 }).reduce<World>((w) => step(w, FULL_THROTTLE), world);
    const view = hudView(later, DT);
    expect(view.currentLap).toBe('1.00 s');
    expect(view.nextGate).toBe('2 / 20');
    expect(view.speedKmh).toBe(Math.round(later.racer.car.vehicle.speed * 3.6));
  });

  it('shows lap count, last and best lap after laps', () => {
    const { world } = play(start(), (w) => pursuit(w.racer.car, 12), (w) => w.racer.progress.lapTicks.length === 2);
    const laps = world.racer.progress.lapTicks;
    expect(hudView(world, DT)).toMatchObject({
      laps: 2,
      lastLap: formatTicks(laps[1]!, DT),
      bestLap: formatTicks(Math.min(...laps), DT),
      currentLap: '0.00 s',
    });
  });
});

describe('feedback messages', () => {
  it('announces the start, each checkpoint in order, and a crash that stays until restart', () => {
    const { world, feedback, messages } = play(start(), () => FULL_THROTTLE, (w) => w.racer.car.crashed);
    expect(messages).toEqual(['Lap timing started.', 'Checkpoint 1 / 19', 'Checkpoint 2 / 19', 'Crashed! Press R or tap Restart.']);
    expect(feedback?.kind).toBe('crash');
    // Still shown long after.
    const later = step(world, FULL_THROTTLE);
    expect(nextFeedback(world, { ...later, tick: later.tick + 10_000 }, feedback, DT)?.kind).toBe('crash');
    // A restart replaces it.
    const restarted = restartWorld(world);
    expect(nextFeedback(world, restarted, feedback, DT, true)).toMatchObject({ kind: 'restart' });
  });

  it('announces each lap with its time, marking a new best', () => {
    const { messages, world } = play(start(), (w) => pursuit(w.racer.car, 12), (w) => w.racer.progress.lapTicks.length === 2);
    const laps = world.racer.progress.lapTicks;
    const lapMessages = messages.filter((m) => /^Lap \d/.test(m));
    expect(lapMessages[0]).toBe(`Lap 1: ${formatTicks(laps[0]!, DT)} (best)`);
    expect(lapMessages[1]).toBe(`Lap 2: ${formatTicks(laps[1]!, DT)}${laps[1]! < laps[0]! ? ' (best)' : ''}`);
    expect(messages.filter((m) => m.startsWith('Checkpoint')).length).toBe(2 * 19);
  });

  it('hides an event message after two seconds', () => {
    const world = start();
    const shown: Feedback = { kind: 'checkpoint', text: 'Checkpoint 1 / 19', untilTick: world.tick + FEEDBACK_TICKS };
    const at = (tick: number) => ({ ...world, tick });
    expect(nextFeedback(at(FEEDBACK_TICKS - 1), at(FEEDBACK_TICKS), shown, DT)).toBe(shown);
    expect(nextFeedback(at(FEEDBACK_TICKS), at(FEEDBACK_TICKS + 1), shown, DT)).toBeNull();
  });
});
