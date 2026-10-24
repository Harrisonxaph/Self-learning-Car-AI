// Seeded driving scenarios for the determinism suite (P1-09), and a recorder that turns a run into a compact,
// comparable trace. Test helpers only; not part of the app.
//
// A scenario is a seed plus a rule for choosing controls each tick. Every random choice is drawn from the
// scenario's own seeded generator on a fixed tick schedule, so the same seed gives the same controls whoever
// calls `step()` and however the calls are spread over animation frames.
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { loadTrack, type Track } from '../../src/sim/track';
import type { Controls } from '../../src/sim/vehicle';
import { createWorld, restartWorld, stepWorld, type World } from '../../src/sim/world';
import { createRng } from '../../src/utils/rng';
import { pursuit } from './ovalDriver';

export const TRACK = loadTrack(stadiumOval);
export const CONFIG = DEFAULT_SIM_CONFIG;
export const PHYSICS = DEFAULT_VEHICLE_PHYSICS;
/** Ticks per trace window: each window gets its own hash and an end-of-window state sample. */
export const WINDOW_TICKS = 60;

export interface Scenario {
  readonly name: string;
  readonly seed: number;
  readonly ticks: number;
  /** Makes a fresh driver (with its own generator) that picks controls for the world's current tick. */
  readonly driver: (seed: number) => (world: World) => Controls;
  /** If set, the car is restarted this many ticks after it crashes (applied before a tick, as on the page). */
  readonly restartAfterCrashTicks?: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Laps: a centre-line follower whose target speed, steering offset and brake pulses are all seeded. It
 * accelerates, steers through both curves, brakes hard several times and completes two timed laps without
 * touching a wall.
 */
export const LAPS: Scenario = {
  name: 'laps',
  seed: 20261024,
  ticks: 6600,
  driver(seed) {
    const rng = createRng(seed);
    let targetSpeed = 10;
    let steeringOffset = 0;
    let brakeUntil = -1;
    return (world) => {
      const { tick } = world;
      if (tick % 90 === 0) targetSpeed = rng.range(8, 13);
      if (tick % 15 === 0) steeringOffset = rng.range(-0.25, 0.25);
      if (tick % 120 === 60 && rng.next() < 0.3) brakeUntil = tick + 25;
      const follow = pursuit(world.racer.car, targetSpeed);
      const steering = clamp(follow.steering + steeringOffset, -1, 1);
      if (tick < brakeUntil) return { steering, throttle: 0, brake: 0.8 };
      return { ...follow, steering };
    };
  },
};

/**
 * Crashes: open-loop seeded controls held for 30 ticks at a time (as a random or badly trained driver might
 * produce), so the car wanders into walls. It is restarted 30 ticks after each crash and keeps driving.
 */
export const CRASHES: Scenario = {
  name: 'crashes',
  seed: 7,
  ticks: 2400,
  restartAfterCrashTicks: 30,
  driver(seed) {
    const rng = createRng(seed);
    let controls: Controls = { steering: 0, throttle: 0, brake: 0 };
    return (world) => {
      if (world.tick % 30 === 0) {
        controls = {
          steering: rng.range(-0.6, 0.6),
          throttle: rng.next() < 0.85 ? rng.range(0.6, 1) : 0,
          brake: rng.next() < 0.15 ? rng.range(0.3, 1) : 0,
        };
      }
      return controls;
    };
  },
};

export const SCENARIOS = [LAPS, CRASHES] as const;

export type TraceEvent =
  | { readonly tick: number; readonly type: 'gate'; readonly gate: number }
  | { readonly tick: number; readonly type: 'lap'; readonly lapTicks: number }
  | { readonly tick: number; readonly type: 'crash' }
  | { readonly tick: number; readonly type: 'restart' };

/** The state at the end of a window: [tick, x, y, heading, speed, crashed, nextGate, gatesPassed]. */
export type Sample = [number, number, number, number, number, boolean, number, number];

export interface Trace {
  /** One 32-bit FNV-1a hash per window, over the exact bits of every tick's state in that window. */
  readonly windowHashes: string[];
  readonly samples: Sample[];
  readonly events: TraceEvent[];
}

/** The numbers that make up one tick's state, in a fixed order. */
function stateNumbers(world: World): number[] {
  const { vehicle, crashed } = world.racer.car;
  const p = world.racer.progress;
  return [
    world.tick,
    vehicle.position.x,
    vehicle.position.y,
    vehicle.heading,
    vehicle.speed,
    crashed ? 1 : 0,
    p.tick,
    p.nextGate,
    p.gatesPassed,
    p.lapStartTick ?? -1,
    p.lapTicks.length,
    p.lapTicks.at(-1) ?? -1,
    world.bestLapTicks ?? -1,
  ];
}

/** Records hashes, samples and events as a run advances. Hashing the float bits catches any difference, even −0. */
export function createRecorder() {
  const windowHashes: string[] = [];
  const samples: Sample[] = [];
  const events: TraceEvent[] = [];
  const bytes = new DataView(new ArrayBuffer(8));
  let hash = 0x811c9dc5;
  const mix = (value: number) => {
    bytes.setFloat64(0, value);
    for (let i = 0; i < 8; i += 1) hash = Math.imul(hash ^ bytes.getUint8(i), 0x01000193) >>> 0;
  };
  return {
    restarted(world: World) {
      events.push({ tick: world.tick, type: 'restart' });
    },
    /** Called after every tick with the world before and after it. */
    stepped(before: World, after: World) {
      const from = before.racer.progress;
      const to = after.racer.progress;
      for (let i = 0; i < to.gatesPassed - from.gatesPassed; i += 1) {
        events.push({ tick: after.tick, type: 'gate', gate: (from.nextGate + i) % after.track.gates.length });
      }
      if (to.lapTicks.length > from.lapTicks.length) events.push({ tick: after.tick, type: 'lap', lapTicks: to.lapTicks.at(-1)! });
      if (after.racer.car.crashed && !before.racer.car.crashed) events.push({ tick: after.tick, type: 'crash' });
      stateNumbers(after).forEach(mix);
      if (after.tick % WINDOW_TICKS === 0) {
        windowHashes.push(hash.toString(16).padStart(8, '0'));
        hash = 0x811c9dc5;
        const { vehicle, crashed } = after.racer.car;
        samples.push([after.tick, vehicle.position.x, vehicle.position.y, vehicle.heading, vehicle.speed, crashed, to.nextGate, to.gatesPassed]);
      }
    },
    trace: (): Trace => ({ windowHashes, samples, events }),
  };
}

/**
 * One run of a scenario, advanced a tick at a time by `step()`, exactly as the page's frame loop would call it.
 * `track` can be passed to share one track object between runs.
 */
export function createScenarioRun(scenario: Scenario, seed = scenario.seed, track: Track = TRACK) {
  const drive = scenario.driver(seed);
  const recorder = createRecorder();
  let world = createWorld(track, PHYSICS);
  let crashTick: number | null = null;
  return {
    step() {
      if (scenario.restartAfterCrashTicks !== undefined && crashTick !== null && world.tick - crashTick >= scenario.restartAfterCrashTicks) {
        world = restartWorld(world);
        crashTick = null;
        recorder.restarted(world);
      }
      const before = world;
      world = stepWorld(world, drive(world), CONFIG);
      if (world.racer.car.crashed && !before.racer.car.crashed) crashTick = world.tick;
      recorder.stepped(before, world);
    },
    world: () => world,
    trace: recorder.trace,
  };
}

/** Runs a scenario for `ticks` ticks with no frame loop and no drawing. */
export function runScenario(scenario: Scenario, ticks = scenario.ticks, seed = scenario.seed) {
  const run = createScenarioRun(scenario, seed);
  for (let i = 0; i < ticks; i += 1) run.step();
  return { world: run.world(), trace: run.trace() };
}
