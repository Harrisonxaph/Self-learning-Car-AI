// Golden tests for the whole simulation (P1-09): physics, collision, checkpoints, laps and restart, driven by
// seeded control sequences and compared with stored expectations in tests/sim/golden/world.json.
//
// The golden file is only rewritten deliberately, with `npm run test:golden:update` (Vitest in mode
// `golden-update`), after a simulation change that is meant to change results. Every other run only reads it:
// a missing file fails, and so does an update attempted in CI. See docs/TESTING.md, "Golden files".
//
// Expected outcomes are not just "whatever the code produced": each scenario is first checked against rules
// that follow from the documented behaviour, independently of the stored numbers.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RNG_ALGORITHM } from '../../src/utils/rng';
import type { Controls } from '../../src/sim/vehicle';
import { createWorld, restartWorld, stepWorld, type World } from '../../src/sim/world';
import { CONFIG, CRASHES, createRecorder, createScenarioRun, LAPS, PHYSICS, runScenario, SCENARIOS, TRACK, WINDOW_TICKS, type Scenario, type Trace } from './scenarios';
import { LAP_LENGTH, pursuit } from './ovalDriver';

/** Runs a scenario keeping every world and the controls used for it, for the rule checks below. */
function detailedRun(scenario: Scenario) {
  const drive = scenario.driver(scenario.seed);
  const used: Controls[] = [];
  const recording: Scenario = { ...scenario, driver: () => (world) => used[used.push(drive(world)) - 1]! };
  const run = createScenarioRun(recording);
  const worlds: World[] = [run.world()];
  for (let i = 0; i < scenario.ticks; i += 1) {
    run.step();
    worlds.push(run.world());
  }
  return { worlds, controls: used, trace: run.trace() };
}

describe('scenario rules (independent of the stored numbers)', () => {
  it('laps: two clean laps, gates strictly in order, lap times matching the gate-0 crossings', () => {
    const { worlds, controls, trace } = detailedRun(LAPS);
    expect(worlds.every((w) => !w.racer.car.crashed)).toBe(true);
    // Gates are credited 0, 1, …, 19, 0, 1, … with none skipped or repeated.
    const gates = trace.events.filter((e) => e.type === 'gate');
    gates.forEach((event, i) => expect(event).toMatchObject({ gate: i % TRACK.gates.length }));
    // Each lap's time is exactly the ticks between consecutive gate-0 crossings.
    const starts = gates.filter((e) => e.gate === 0).map((e) => e.tick);
    const laps = trace.events.filter((e) => e.type === 'lap');
    expect(laps).toHaveLength(2);
    laps.forEach((lap, i) => expect(lap).toEqual({ tick: starts[i + 1], type: 'lap', lapTicks: starts[i + 1]! - starts[i]! }));
    // Target speeds are drawn from 8–13 m/s and brake pulses only slow the car, so the average lap speed
    // over the 491 m centre line lies between 6 and 13 m/s.
    for (const lap of laps) {
      if (lap.type !== 'lap') continue;
      const averageSpeed = LAP_LENGTH / (lap.lapTicks * CONFIG.timestepSeconds);
      expect(averageSpeed).toBeGreaterThan(6);
      expect(averageSpeed).toBeLessThan(13);
    }
    // The best lap is the faster of the two.
    const lapTicks = laps.map((lap) => (lap.type === 'lap' ? lap.lapTicks : 0));
    expect(worlds.at(-1)!.bestLapTicks).toBe(Math.min(...lapTicks));
    // The run really brakes and steers: speed falls on braking ticks, and the car turns through both curves.
    const braking = controls.filter((c, i) => c.brake > 0 && worlds[i + 1]!.racer.car.vehicle.speed < worlds[i]!.racer.car.vehicle.speed);
    expect(braking.length).toBeGreaterThan(50);
    const headings = worlds.map((w) => w.racer.car.vehicle.heading);
    expect(Math.min(...headings)).toBeLessThan(-3);
    expect(Math.max(...headings)).toBeGreaterThan(3);
    // Speed never exceeds the physics' terminal speed.
    expect(Math.max(...worlds.map((w) => w.racer.car.vehicle.speed))).toBeLessThanOrEqual(PHYSICS.maxSpeed);
  });

  it('crashes: each crash stops the car at its last clear pose, and each restart is a full reset', () => {
    const { worlds, trace } = detailedRun(CRASHES);
    const crashes = trace.events.filter((e) => e.type === 'crash');
    const restarts = trace.events.filter((e) => e.type === 'restart');
    expect(crashes.length).toBeGreaterThanOrEqual(5);
    for (const crash of crashes) {
      const before = worlds[crash.tick - 1]!.racer.car;
      const at = worlds[crash.tick]!.racer.car;
      // Moving, then stopped where it was: the step into the wall is rejected (docs/ARCHITECTURE.md).
      expect(before.vehicle.speed).toBeGreaterThan(0);
      expect(at).toEqual({ vehicle: { ...before.vehicle, speed: 0 }, crashed: true });
      // A crashed car stays put until the restart 30 ticks later.
      expect(worlds[crash.tick + CRASHES.restartAfterCrashTicks! - 1]!.racer.car).toEqual(at);
    }
    // Restarts happen 30 ticks after each crash that has time left, and put the car back on the start pose.
    expect(restarts.map((r) => r.tick)).toEqual(crashes.filter((c) => c.tick + 30 < CRASHES.ticks).map((c) => c.tick + 30));
    for (const restart of restarts) {
      // The restart applies before the tick, so the world after that tick has moved one step from the start.
      const after = worlds[restart.tick + 1]!;
      expect(after.racer.progress.tick).toBe(1);
      expect(after.racer.progress.lapTicks).toEqual([]);
    }
    // Progress continues after restarts: gate 0 is crossed again from the start pose.
    expect(trace.events.filter((e) => e.type === 'gate' && e.gate === 0).length).toBeGreaterThan(1);
  });
});

/** The golden file's text: one line per window and event, so a diff points at the first window that changed. */
function goldenText(): string {
  const scenarios = SCENARIOS.map((scenario) => {
    const { world, trace } = runScenario(scenario);
    return { scenario, world, trace };
  });
  const lines = [
    '{',
    '  "about": "Golden expectations for tests/sim/golden.test.ts (P1-09). Regenerate only for a deliberate simulation change: npm run test:golden:update. See docs/TESTING.md.",',
    '  "format": 1,',
    `  "rng": ${JSON.stringify(RNG_ALGORITHM)},`,
    `  "track": ${JSON.stringify({ id: TRACK.id, version: TRACK.version })},`,
    `  "config": ${JSON.stringify(CONFIG)},`,
    `  "physics": ${JSON.stringify(PHYSICS)},`,
    `  "windowTicks": ${WINDOW_TICKS},`,
    '  "scenarios": {',
    scenarios
      .map(({ scenario, world, trace }) => {
        const final = { tick: world.tick, car: world.racer.car, progress: world.racer.progress, bestLapTicks: world.bestLapTicks };
        return [
          `    ${JSON.stringify(scenario.name)}: {`,
          `      "seed": ${scenario.seed},`,
          `      "ticks": ${scenario.ticks},`,
          `      "final": ${JSON.stringify(final)},`,
          '      "events": [',
          trace.events.map((e) => `        ${JSON.stringify(e)}`).join(',\n'),
          '      ],',
          '      "windows": [',
          trace.windowHashes.map((hash, i) => `        ${JSON.stringify([hash, ...trace.samples[i]!])}`).join(',\n'),
          '      ]',
          '    }',
        ].join('\n');
      })
      .join(',\n'),
    '  }',
    '}',
    '',
  ];
  return lines.join('\n');
}

const GOLDEN_FILE = new URL('./golden/world.json', import.meta.url);
/** True only for `npm run test:golden:update`, which runs Vitest with `--mode golden-update`. */
const UPDATING = import.meta.env.MODE === 'golden-update';

describe('golden file', () => {
  it('matches tests/sim/golden/world.json exactly (full car state, lap events and every window of ticks)', () => {
    if (UPDATING) {
      // Regenerating in CI would accept whatever the code produces there; only a person does it, locally.
      if (process.env.CI) throw new Error('The golden file is never regenerated in CI. Run npm run test:golden:update locally.');
      writeFileSync(GOLDEN_FILE, goldenText());
      return;
    }
    // Any other run only reads the file. A missing file is an error, never silently recreated.
    if (!existsSync(GOLDEN_FILE)) throw new Error('tests/sim/golden/world.json is missing. Restore it, or regenerate it deliberately with npm run test:golden:update.');
    expect(goldenText()).toBe(readFileSync(GOLDEN_FILE, 'utf8'));
  });
});

describe('bit-identical runs in Node', () => {
  /** The first window whose hash differs, or -1; a divergence anywhere in a window changes its hash. */
  const firstDifference = (a: Trace, b: Trace) => a.windowHashes.findIndex((hash, i) => hash !== b.windowHashes[i]);

  it.each(SCENARIOS.map((s) => [s.name, s] as const))('%s: a fresh run with the same seed matches tick for tick', (_name, scenario) => {
    const a = runScenario(scenario);
    const b = runScenario(scenario);
    expect(firstDifference(a.trace, b.trace)).toBe(-1);
    expect(b).toEqual(a);
    // The comparison is sensitive: a different seed diverges within the first few windows.
    const other = runScenario(scenario, scenario.ticks, scenario.seed + 1);
    const diverged = firstDifference(a.trace, other.trace);
    expect(diverged).toBeGreaterThanOrEqual(0);
    expect(diverged).toBeLessThan(5);
  });

  it('covers every tick, including a last window the run stopped part-way through', () => {
    // 125 ticks: two full windows and 5 ticks of a third. A 1e-12 m change at tick 123 must show in the trace.
    const run = createScenarioRun(CRASHES);
    const worlds: World[] = [run.world()];
    for (let i = 0; i < 125; i += 1) {
      run.step();
      worlds.push(run.world());
    }
    const replay = (nudgeTick: number | null) => {
      const recorder = createRecorder();
      for (let t = 1; t < worlds.length; t += 1) {
        let after = worlds[t]!;
        if (t === nudgeTick) {
          const { vehicle } = after.racer.car;
          after = { ...after, racer: { ...after.racer, car: { ...after.racer.car, vehicle: { ...vehicle, position: { ...vehicle.position, x: vehicle.position.x + 1e-12 } } } } };
        }
        recorder.stepped(worlds[t - 1]!, after);
      }
      return recorder.trace();
    };
    const exact = replay(null);
    expect(exact).toEqual(run.trace());
    expect(exact.windowHashes).toHaveLength(3);
    expect(exact.samples.at(-1)![0]).toBe(125);
    expect(replay(123).windowHashes[2]).not.toBe(exact.windowHashes[2]);
  });

  it('separate worlds stepped alternately, sharing one track, match runs made on their own', () => {
    // Two scenarios interleaved tick by tick on the same track object: any shared mutable state (in the
    // track, a cache, or a module-level variable) would make the interleaved traces differ from solo runs.
    const a = createScenarioRun(LAPS, LAPS.seed, TRACK);
    const b = createScenarioRun(CRASHES, CRASHES.seed, TRACK);
    for (let i = 0; i < 1800; i += 1) {
      a.step();
      b.step();
    }
    expect(a.trace()).toEqual(runScenario(LAPS, 1800).trace);
    expect(b.trace()).toEqual(runScenario(CRASHES, 1800).trace);
  });

  it('never mutates a world, its track or its physics: every state can be frozen and stepping still works', () => {
    const deepFreeze = <T>(value: T): T => {
      if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        Object.values(value).forEach(deepFreeze);
      }
      return value;
    };
    const run = createScenarioRun(CRASHES, CRASHES.seed, structuredClone(TRACK));
    deepFreeze(run.world());
    // Freezing each new world before the next step makes any in-place write throw (ES modules are strict).
    for (let i = 0; i < CRASHES.ticks; i += 1) {
      run.step();
      deepFreeze(run.world());
    }
    expect(run.trace()).toEqual(runScenario(CRASHES).trace);
  });
});

describe('restart', () => {
  it('after a restart the car drives exactly as in a fresh world; only the tick count and best lap carry over', () => {
    // A lap is done (best 3025 ticks) and the car is mid-way round the next one when it is restarted.
    const lapped = runScenario(LAPS, 3200).world;
    expect(lapped.bestLapTicks).toBe(3025);
    let restarted = restartWorld(lapped);
    let fresh = createWorld(TRACK, PHYSICS);
    // A driver that looks only at the car, so both worlds get the same controls for the same car state.
    for (let i = 0; i < 900; i += 1) {
      restarted = stepWorld(restarted, pursuit(restarted.racer.car, 11), CONFIG);
      fresh = stepWorld(fresh, pursuit(fresh.racer.car, 11), CONFIG);
      expect(restarted.racer).toEqual(fresh.racer);
    }
    // 900 ticks cross gates 0 to about 7, so lap progress really moved, but no lap completed.
    expect(fresh.racer.progress.gatesPassed).toBeGreaterThan(5);
    expect(restarted.tick).toBe(3200 + 900);
    expect(restarted.bestLapTicks).toBe(3025);
  });
});
