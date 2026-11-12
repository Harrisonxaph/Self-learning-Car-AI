// Human vs AI race (P5-03): two independent racers on the shared simulation path. These check mechanics: the AI's path
// in a race equals its AI-only run tick by tick whatever the human does, the two cars never interact, and the results
// say only what is true. Nothing here is evidence about learning or about who drives better.
import { describe, expect, it } from 'vitest';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { buildInputs } from '../../src/ai/inputs';
import { createNetworkDriver } from '../../src/ai/drivers';
import { PARAMETER_COUNT } from '../../src/ai/network';
import { RULE_A3_PARAMS, ruleControls } from '../../src/ai/ruleBasedDriver';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { loadTrack } from '../../src/sim/track';
import type { Controls } from '../../src/sim/vehicle';
import { stepEpisode, startEpisodeState, type EpisodeState } from '../../src/training/episodeStep';
import {
  compareRace,
  createRaceRunner,
  createRaceSetup,
  MAX_RACE_LAPS,
  raceDone,
  raceResult,
  RACE_SECONDS_PER_LAP,
  sanitiseControls,
  type RaceInput,
  type RacerResult,
  type RaceState,
} from '../../src/training/race';
import { createRng } from '../../src/utils/rng';

const track = loadTrack(stadiumOval);
const DT = DEFAULT_SIM_CONFIG.timestepSeconds;
const genome = (seed: number): Float64Array => {
  const rng = createRng(seed);
  return Float64Array.from({ length: PARAMETER_COUNT }, () => rng.range(-1, 1));
};
const input = (over: Partial<RaceInput> = {}): RaceInput => ({
  track,
  physics: DEFAULT_VEHICLE_PHYSICS,
  timestepSeconds: DT,
  stallSeconds: 5,
  laps: 1,
  genome: genome(1),
  brakeEnabled: true,
  ...over,
});
const IDLE: Controls = { steering: 0, throttle: 0, brake: 0 };
const FULL: Controls = { steering: 0, throttle: 1, brake: 0 };

/** Runs a race to its end (or `limit` ticks) with `human(tick, state)` supplying the human's controls; returns every state. */
function run(setup: ReturnType<typeof createRaceSetup>, human: (tick: number, state: RaceState) => Controls, limit = 20000): RaceState[] {
  const runner = createRaceRunner(setup);
  let state = runner.start();
  const states = [state];
  while (!raceDone(state) && states.length <= limit) {
    state = runner.step(state, human(state.tick, state));
    states.push(state);
  }
  return states;
}

/** The AI's own run under the race's rules, with no human anywhere. */
function aiOnly(setup: ReturnType<typeof createRaceSetup>, ticks: number): EpisodeState[] {
  const driver = createNetworkDriver(setup.genome, { brakeEnabled: setup.brakeEnabled });
  let state = startEpisodeState(setup.context);
  const states = [state];
  for (let i = 0; i < ticks; i += 1) {
    state = stepEpisode(state, (inputs, racer) => driver.decide({ car: racer.car, inputs }), setup.context);
    states.push(state);
  }
  return states;
}

/** A scripted lap: the rule-based baseline's controls computed from the HUMAN car's own state. */
const scriptedLap = (_tick: number, state: RaceState): Controls =>
  ruleControls(buildInputs(state.human.racer, track, DEFAULT_VEHICLE_PHYSICS, createRaceSetup(input()).context.sensors), RULE_A3_PARAMS, true);

describe('createRaceSetup', () => {
  it('uses the champion\'s own conditions and a clock of 60 s per chosen lap', () => {
    const setup = createRaceSetup(input({ laps: 3 }));
    expect(setup.raceSeconds).toBe(3 * RACE_SECONDS_PER_LAP);
    expect(setup.context.rules.maxLaps).toBe(3);
    expect(setup.context.rules.maxEpisodeTicks).toBe(Math.ceil((180 / DT) - 1e-9));
    expect(setup.context.rules.stallTicks).toBe(Math.ceil(5 / DT - 1e-9));
    expect(setup.context.environment.physics).toBe(DEFAULT_VEHICLE_PHYSICS);
    expect(setup.context.environment.timestepSeconds).toBe(DT);
  });

  it('rejects hostile inputs with a message naming the field', () => {
    for (const laps of [0, -1, 1.5, NaN, Infinity, MAX_RACE_LAPS + 1, '3' as unknown as number]) {
      expect(() => createRaceSetup(input({ laps }))).toThrow(/laps/);
    }
    expect(() => createRaceSetup(input({ genome: new Float64Array(5) }))).toThrow(RangeError);
    expect(() => createRaceSetup(input({ genome: Float64Array.from({ length: PARAMETER_COUNT }, () => NaN) }))).toThrow(RangeError);
    expect(() => createRaceSetup(input({ brakeEnabled: 'yes' as unknown as boolean }))).toThrow(/brakeEnabled/);
    expect(() => createRaceSetup(input({ timestepSeconds: 0 }))).toThrow(RangeError);
    expect(() => createRaceSetup(input({ stallSeconds: NaN }))).toThrow(RangeError);
    expect(() => createRaceSetup(null as unknown as RaceInput)).toThrow(RangeError);
  });

  it('copies the genome, so changing the caller\'s array later changes nothing', () => {
    const g = genome(2);
    const setup = createRaceSetup(input({ genome: g }));
    const before = Array.from(setup.genome);
    g.fill(0);
    expect(Array.from(setup.genome)).toEqual(before);
  });
});

describe('the two cars start together', () => {
  it('begin at tick 0 on the same pose, at rest, with fresh separate progress and the same physics', () => {
    const setup = createRaceSetup(input());
    const state = createRaceRunner(setup).start();
    expect(state.tick).toBe(0);
    expect(state.human.racer.car.vehicle).toEqual(state.ai.racer.car.vehicle);
    expect(state.human.racer.car.vehicle.position).toEqual({ x: track.start.position.x, y: track.start.position.y });
    expect(state.human.racer.progress).not.toBe(state.ai.racer.progress);
    expect(state.human.racer.progress.gatesPassed).toBe(0);
    expect(state.human.episode.outcome).toBeNull();
    expect(state.ai.episode.outcome).toBeNull();
  });
});

describe('the AI is deterministic and independent of the human', () => {
  // Seed 55 is a random genome that actually drives (about 10 gates before it crashes); most random genomes never move, which would make these checks vacuous.
  const setup = createRaceSetup(input({ genome: genome(55), laps: 1 }));
  it('the chosen AI really drives, so the checks below are not vacuous', () => {
    const states = run(setup, () => IDLE, 4000);
    const ai = states[states.length - 1]!.ai;
    expect(ai.racer.progress.gatesPassed).toBeGreaterThanOrEqual(5);
    expect(states.length).toBeGreaterThan(600);
  });
  const scripts: [string, (tick: number, state: RaceState) => Controls][] = [
    ['idle', () => IDLE],
    ['full throttle into a wall', () => FULL],
    ['a scripted lap', scriptedLap],
    ['seeded random inputs', (() => {
      const rng = createRng(99);
      return () => ({ steering: rng.range(-1, 1), throttle: rng.next(), brake: rng.next() < 0.2 ? 1 : 0 });
    })()],
  ];

  for (const [name, human] of scripts) {
    it(`the AI's state at every tick equals its AI-only run (human: ${name})`, () => {
      const states = run(setup, human, 2000);
      expect(states.length).toBeGreaterThan(600);
      const solo = aiOnly(setup, states.length - 1);
      states.forEach((s, i) => {
        expect(s.ai).toEqual(solo[i]);
      });
    });
  }

  it('two races with the same human inputs are identical, and the human cannot change the AI', () => {
    const a = run(setup, scriptedLap, 3000);
    const b = run(setup, scriptedLap, 3000);
    expect(a).toEqual(b);
    const idle = run(setup, () => IDLE, 3000);
    const n = Math.min(a.length, idle.length);
    for (let i = 0; i < n; i += 1) expect(a[i]!.ai).toEqual(idle[i]!.ai);
  });

  it('the human car does not appear to the AI: parking it on the AI\'s line changes nothing', () => {
    // The human's state is simply never an input to the AI's step: step with a race whose human is moved anywhere.
    const runner = createRaceRunner(setup);
    const state = runner.start();
    const vehicle = state.human.racer.car.vehicle;
    const onAiLine = { ...vehicle, position: { x: vehicle.position.x + 0.1, y: vehicle.position.y } };
    const moved: RaceState = {
      ...state,
      human: { ...state.human, racer: { ...state.human.racer, car: { ...state.human.racer.car, vehicle: onAiLine } } },
    };
    let a = state;
    let b = moved;
    for (let i = 0; i < 200; i += 1) {
      a = runner.step(a, IDLE);
      b = runner.step(b, IDLE);
      expect(b.ai).toEqual(a.ai);
    }
  });

  it('the AI rerun by a fresh runner repeats exactly (Restart repeats the AI)', () => {
    const first = run(setup, () => IDLE, 1500);
    const second = run(setup, () => IDLE, 1500);
    expect(second.map((s) => s.ai)).toEqual(first.map((s) => s.ai));
  });
});

describe('the cars are independent racers', () => {
  it('a human crash does not stop the AI, and the AI\'s end does not stop the human', () => {
    const setup = createRaceSetup(input({ genome: genome(3), laps: 1 }));
    const states = run(setup, () => FULL, 4000);
    const crashedAt = states.findIndex((s) => s.human.episode.outcome === 'crashed');
    expect(crashedAt).toBeGreaterThan(0);
    // After its crash the human earns nothing more: its state is frozen.
    for (let i = crashedAt; i < states.length; i += 1) expect(states[i]!.human).toBe(states[crashedAt]!.human);
    const last = states[states.length - 1]!;
    expect(raceDone(last)).toBe(true);
  });

  it('the race ends only when both racers have ended, and a finished race does not change', () => {
    const setup = createRaceSetup(input({ genome: genome(5), laps: 1 }));
    const runner = createRaceRunner(setup);
    const states = run(setup, () => IDLE, 4000);
    const last = states[states.length - 1]!;
    expect(raceDone(last)).toBe(true);
    expect(runner.step(last, FULL)).toBe(last);
    for (const s of states.slice(0, -1)) expect(raceDone(s)).toBe(false);
  });

  it('an idle human stalls under the same stall rule as the AI', () => {
    const setup = createRaceSetup(input({ genome: genome(5), laps: 1 }));
    const states = run(setup, () => IDLE, 4000);
    const human = states[states.length - 1]!.human;
    expect(human.episode.outcome).toBe('stalled');
    expect(human.episode.tick).toBe(setup.context.rules.stallTicks);
  });
});

describe('a scripted human lap', () => {
  it('can complete a lap, with the lap time equal to ticks times the timestep and totals only on completion', () => {
    const setup = createRaceSetup(input({ genome: genome(5), laps: 1 }));
    const states = run(setup, scriptedLap, 8000);
    const last = states[states.length - 1]!;
    const result = raceResult(setup, last);
    expect(result.human.outcome).toBe('completed');
    expect(result.human.laps).toBe(1);
    const ticks = last.human.racer.progress.lapTicks[0]!;
    expect(result.human.firstLapSeconds).toBe(ticks * DT);
    expect(result.human.bestLapSeconds).toBe(ticks * DT);
    expect(result.human.totalSeconds).toBe(ticks * DT);
    expect(result.human.wallCollisions).toBe(0);
    expect(result.human.crashTick).toBeNull();
  });
});

describe('raceResult and the comparison sentence', () => {
  const racer = (over: Partial<RacerResult>): RacerResult => ({
    outcome: 'completed',
    laps: 1,
    firstLapSeconds: 20,
    bestLapSeconds: 20,
    totalSeconds: 20,
    gates: 10,
    crashTick: null,
    wallCollisions: 0,
    ...over,
  });
  const crashed = (gates: number) => racer({ outcome: 'crashed', laps: 0, firstLapSeconds: null, bestLapSeconds: null, totalSeconds: null, gates, crashTick: 50, wallCollisions: 1 });

  it('names a faster car only when both completed', () => {
    expect(compareRace(racer({ totalSeconds: 19 }), racer({ totalSeconds: 20 }), 1)).toMatch(/^You were faster over 1 lap by 1\.00 s/);
    expect(compareRace(racer({ totalSeconds: 21 }), racer({ totalSeconds: 20 }), 3)).toMatch(/^The AI was faster over 3 laps by 1\.00 s/);
  });

  it('says a tie explicitly when the times are exactly equal', () => {
    expect(compareRace(racer({}), racer({}), 1)).toMatch(/exactly the same time.*tie/);
  });

  it('declares no winner when either car did not complete, and says who crashed', () => {
    const humanCrash = compareRace(crashed(4), racer({}), 1);
    expect(humanCrash).toMatch(/you crashed at gate 4/);
    expect(humanCrash).toMatch(/No winner/);
    expect(humanCrash).not.toMatch(/faster/);
    const aiCrash = compareRace(racer({}), crashed(7), 1);
    expect(aiCrash).toMatch(/the AI crashed at gate 7/);
    expect(aiCrash).toMatch(/No winner/);
    const both = compareRace(crashed(1), crashed(2), 1);
    expect(both).toMatch(/neither car completed/);
    expect(compareRace(racer({ outcome: 'stalled', totalSeconds: null }), racer({ outcome: 'timeout', totalSeconds: null }), 1)).toMatch(/stalled.*ran out of race time/);
  });

  it('says the race is still running while a car has no outcome', () => {
    expect(compareRace(racer({ outcome: null }), racer({}), 1)).toMatch(/still running/);
  });

  it('gives null (not zero) times when no lap completed, and the AI-had-no-brake note', () => {
    const setup = createRaceSetup(input({ genome: genome(5), brakeEnabled: false }));
    const states = run(setup, () => IDLE, 4000);
    const result = raceResult(setup, states[states.length - 1]!);
    expect(result.human.firstLapSeconds).toBeNull();
    expect(result.human.bestLapSeconds).toBeNull();
    expect(result.human.totalSeconds).toBeNull();
    expect(result.aiHadNoBrake).toBe(true);
    expect(result.raceSeconds).toBe(RACE_SECONDS_PER_LAP);
  });
});

describe('human controls are made safe', () => {
  it('treats non-finite values as not pressed and clamps ranges, and never throws', () => {
    expect(sanitiseControls({ steering: NaN, throttle: Infinity, brake: -5 })).toEqual({ steering: 0, throttle: 0, brake: 0 });
    expect(sanitiseControls({ steering: 9, throttle: 9, brake: 9 })).toEqual({ steering: 1, throttle: 1, brake: 1 });
    expect(sanitiseControls({ steering: -9, throttle: -1, brake: 0.5 })).toEqual({ steering: -1, throttle: 0, brake: 0.5 });
    expect(sanitiseControls(null)).toEqual(IDLE);
    expect(sanitiseControls(undefined)).toEqual(IDLE);
    const setup = createRaceSetup(input());
    const runner = createRaceRunner(setup);
    expect(() => runner.step(runner.start(), { steering: NaN, throttle: NaN, brake: NaN })).not.toThrow();
  });
});
