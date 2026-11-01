// Headless driver evaluation (P2-08 step 2): one shared per-tick path for training cars and evaluated drivers,
// deterministic episodes, driver isolation, and the evaluation track boundary (training or validation, never
// held-out, never trained on). Runs on the built-in tracks with the real physics, sensors, collision, checkpoints,
// termination and fitness. Nothing here is a study or a learning result: these are mechanics checks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNetworkDriver, type EpisodeDriver } from '../../src/ai/drivers';
import { buildInputs } from '../../src/ai/inputs';
import { initialParameters } from '../../src/ai/network';
import { createCorrelatedRandomDriver, createRandomDriver } from '../../src/ai/randomDrivers';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import type { Track } from '../../src/sim/track';
import type { Controls } from '../../src/sim/vehicle';
import { startEpisodeState, stepEpisode, type DecideControls } from '../../src/training/episodeStep';
import { createEvaluationSetup, DEFAULT_EVALUATION_CONFIG, evaluateDriver } from '../../src/training/evaluation';
import { canonicalJson } from '../../src/training/experiment';
import { DEFAULT_FITNESS_CONFIG, scoreEpisode } from '../../src/training/fitness';
import { assertEvaluationTrack, BUILT_IN_TRACK_SPLITS, TrackLeakageError } from '../../src/training/trackSplits';
import {
  createTrainer,
  createTrainingSetup,
  DEFAULT_TRAINING_CONFIG,
  evaluateGenome,
  startCar,
  stepCar,
  trainHeadless,
} from '../../src/training/trainer';
import { createRng } from '../../src/utils/rng';
import { sha256Hex } from '../../src/utils/sha256';

const builtIn = (id: string): Track => BUILT_IN_TRACK_SPLITS.tracks.find((t) => t.id === id)!.track;
const OVAL = builtIn('stadium-oval');
const VALIDATION = builtIn('rounded-rectangle');
const HELD_OUT = builtIn('hairpin-chicane');
const env = (track: Track) => ({ track, physics: DEFAULT_VEHICLE_PHYSICS, timestepSeconds: DEFAULT_SIM_CONFIG.timestepSeconds });
const ON_OVAL = createEvaluationSetup({}, env(OVAL));
const ON_VALIDATION = createEvaluationSetup({}, env(VALIDATION));

/** A driver that always returns the same controls and counts its decisions. */
function constantDriver(controls: Controls): EpisodeDriver & { calls: number } {
  return {
    calls: 0,
    decide() {
      this.calls += 1;
      return controls;
    },
    reset() {
      this.calls = 0;
    },
  };
}

describe('shared stepping preserves network training exactly', () => {
  // Recorded on main at ee4b269, before episodeStep.ts existed (the trainer then stepped cars itself).
  const CONFIG = { ...DEFAULT_TRAINING_CONFIG, seed: 4242, populationSize: 12, eliteCount: 1, maxEpisodeSeconds: 20 };
  const PINNED_TRAINING = '0eff893f93945750f7ee9306da7a126424de158e2fb197b27707116c9945d2ca';
  const PINNED_TICKS = '50e7ed82b7f67bfdf0d3b799e622fe8c92cdfe4b7542beb56d2fb5ae39d7e72b';

  it('gives the same three generations as before the refactor', () => {
    const record = trainHeadless(CONFIG, env(OVAL), 3);
    const generations = record.generations.map((g) => ({ ...g, champion: Array.from(g.champion) }));
    expect(sha256Hex(canonicalJson(generations))).toBe(PINNED_TRAINING);
  });

  it('gives the same vehicle, progress and episode on every tick of four network episodes as before', () => {
    const setup = createTrainingSetup(CONFIG, env(OVAL));
    const rng = createRng(77);
    const ticks: unknown[] = [];
    for (let i = 0; i < 4; i += 1) {
      let car = startCar(initialParameters(rng), setup);
      while (car.episode.outcome === null) {
        car = stepCar(car, setup);
        ticks.push({ v: car.racer.car.vehicle, p: car.racer.progress, e: car.episode, c: car.racer.car.crashed });
      }
    }
    expect(ticks).toHaveLength(1017);
    expect(sha256Hex(canonicalJson(ticks))).toBe(PINNED_TICKS);
  });

  it.each([true, false])('evaluateDriver with a network driver equals evaluateGenome (brakeEnabled %s)', (brakeEnabled) => {
    const training = createTrainingSetup({ ...DEFAULT_TRAINING_CONFIG, brakeEnabled }, env(OVAL));
    const rng = createRng(99);
    for (let i = 0; i < 6; i += 1) {
      const genome = initialParameters(rng);
      const expected = evaluateGenome(genome, training);
      const got = evaluateDriver(createNetworkDriver(genome, { brakeEnabled }), ON_OVAL);
      expect(got.episode).toEqual(expected.episode);
      expect(got.racer).toEqual(expected.racer);
      expect(got.fitness).toEqual(scoreEpisode(expected.episode, training.config.fitness, training.rules));
      expect(got.decisions).toBe(expected.episode.tick);
    }
  });
});

describe('evaluateDriver', () => {
  it('runs a stationary driver to the analytical stall: no gate, no movement, stalled at exactly stallTicks', () => {
    const driver = constantDriver({ steering: 0, throttle: 0, brake: 0 });
    const result = evaluateDriver(driver, ON_OVAL);
    expect(ON_OVAL.rules.stallTicks).toBe(300);
    expect(result.episode.outcome).toBe('stalled');
    expect(result.episode.tick).toBe(300);
    expect(result.decisions).toBe(300);
    expect(driver.calls).toBe(300);
    expect(result.episode.gatesPassed).toBe(0);
    expect(result.orderedProgress).toBe(0);
    expect(result.racer.car.vehicle.position).toEqual(OVAL.start.position);
    expect(result.fitness).toEqual(scoreEpisode(result.episode, DEFAULT_FITNESS_CONFIG, ON_OVAL.rules));
    expect(result.fitness.total).toBe(0);
  });

  it('gives each decision the car and the nine network inputs for its current state', () => {
    const seen: { inputs: readonly number[]; car: unknown }[] = [];
    const inner = createRandomDriver(5);
    const recording: EpisodeDriver = {
      decide(observation) {
        seen.push({ inputs: observation.inputs!, car: observation.car });
        return inner.decide(observation);
      },
      reset: () => inner.reset(),
    };
    const result = evaluateDriver(recording, ON_OVAL);
    expect(seen).toHaveLength(result.episode.tick);
    // Replays the same controls independently and checks every observation against the racer it came from.
    const replay = createRandomDriver(5);
    let state = startEpisodeState(ON_OVAL);
    for (const observation of seen) {
      expect(observation.car).toEqual(state.racer.car);
      expect(observation.inputs).toEqual(buildInputs(state.racer, OVAL, DEFAULT_VEHICLE_PHYSICS, ON_OVAL.sensors));
      state = stepEpisode(state, () => replay.decide({ car: state.racer.car }), ON_OVAL);
    }
    expect(state.episode).toEqual(result.episode);
  });

  it('reports ordered progress as gates credited ÷ gates per lap, and the scored fitness', () => {
    for (const driver of [createRandomDriver(1), createCorrelatedRandomDriver(1), createCorrelatedRandomDriver(2)]) {
      const result = evaluateDriver(driver, ON_OVAL);
      expect(result.episode.outcome).not.toBeNull();
      expect(result.orderedProgress).toBe(result.episode.gatesPassed / OVAL.gates.length);
      expect(result.fitness).toEqual(scoreEpisode(result.episode, DEFAULT_FITNESS_CONFIG, ON_OVAL.rules));
      expect(result.decisions).toBe(result.episode.tick);
      expect(result.episode.tick).toBeLessThanOrEqual(ON_OVAL.rules.maxEpisodeTicks);
    }
  });

  it('A7 really holds its action for 30 ticks inside the simulation', () => {
    const applied: Controls[] = [];
    const inner = createCorrelatedRandomDriver(23);
    const spy: EpisodeDriver = {
      decide(observation) {
        const controls = inner.decide(observation);
        applied.push(controls);
        return controls;
      },
      reset: () => inner.reset(),
    };
    const result = evaluateDriver(spy, ON_OVAL);
    expect(applied).toHaveLength(result.episode.tick);
    applied.forEach((controls, k) => expect(controls).toBe(applied[k - (k % 30)]));
    for (let k = 30; k < applied.length; k += 30) expect(applied[k]).not.toEqual(applied[k - 1]);
  });
});

describe('determinism and isolation', () => {
  const runs = (make: () => EpisodeDriver, setup = ON_OVAL) => {
    const driver = make();
    return [evaluateDriver(driver, setup), evaluateDriver(driver, setup), evaluateDriver(make(), setup)];
  };

  it.each([
    ['A1', () => createRandomDriver(1234)],
    ['A7', () => createCorrelatedRandomDriver(1234)],
  ])('%s: identical conditions give identical outcomes, on reuse and in a fresh instance', (_label, make) => {
    for (const setup of [ON_OVAL, ON_VALIDATION]) {
      const [first, again, fresh] = runs(make, setup);
      expect(canonicalJson(again)).toBe(canonicalJson(first));
      expect(canonicalJson(fresh)).toBe(canonicalJson(first));
    }
  });

  it('a driver left mid-episode by another use is reset before evaluation', () => {
    const driver = createCorrelatedRandomDriver(55);
    const clean = evaluateDriver(createCorrelatedRandomDriver(55), ON_OVAL);
    for (let k = 0; k < 47; k += 1) driver.decide({ car: startEpisodeState(ON_OVAL).racer.car });
    expect(evaluateDriver(driver, ON_OVAL)).toEqual(clean);
  });

  it('different seeds drive differently', () => {
    const a = evaluateDriver(createRandomDriver(1), ON_OVAL);
    const b = evaluateDriver(createRandomDriver(2), ON_OVAL);
    expect(canonicalJson(a.racer)).not.toBe(canonicalJson(b.racer));
  });

  it('drivers share no state: evaluating others in between, or stepping two episodes interleaved, changes nothing', () => {
    const alone = evaluateDriver(createCorrelatedRandomDriver(77), ON_OVAL);
    const a = createCorrelatedRandomDriver(77);
    evaluateDriver(createCorrelatedRandomDriver(77), ON_OVAL);
    evaluateDriver(createRandomDriver(77), ON_VALIDATION);
    expect(evaluateDriver(a, ON_OVAL)).toEqual(alone);

    // Two same-seed drivers and a network stepped tick by tick in turn, each in its own episode.
    const x = createCorrelatedRandomDriver(77);
    const y = createCorrelatedRandomDriver(77);
    const net = createNetworkDriver(initialParameters(createRng(4)), { brakeEnabled: true });
    let sx = startEpisodeState(ON_OVAL);
    let sy = startEpisodeState(ON_OVAL);
    let sn = startEpisodeState(ON_OVAL);
    const via = (driver: EpisodeDriver): DecideControls => (inputs, racer) => driver.decide({ car: racer.car, inputs });
    while (sx.episode.outcome === null || sy.episode.outcome === null || sn.episode.outcome === null) {
      sx = stepEpisode(sx, via(x), ON_OVAL);
      sn = stepEpisode(sn, via(net), ON_OVAL);
      sy = stepEpisode(sy, via(y), ON_OVAL);
    }
    expect(sx.episode).toEqual(alone.episode);
    expect(sy.episode).toEqual(alone.episode);
    expect(sx.racer).toEqual(alone.racer);
  });

  it('evaluation draws nothing from a trainer and leaves training results unchanged', () => {
    const config = { ...DEFAULT_TRAINING_CONFIG, seed: 8, populationSize: 6, maxEpisodeSeconds: 10 };
    const before = trainHeadless(config, env(OVAL), 2);
    const trainer = createTrainer(config, env(OVAL));
    evaluateDriver(createRandomDriver(8), ON_OVAL);
    trainer.runGeneration();
    evaluateDriver(createCorrelatedRandomDriver(8), ON_VALIDATION);
    trainer.runGeneration();
    expect(canonicalJson(trainer.record().generations.map((g) => ({ ...g, champion: Array.from(g.champion) })))).toBe(
      canonicalJson(before.generations.map((g) => ({ ...g, champion: Array.from(g.champion) }))),
    );
  });
});

describe('evaluation configuration', () => {
  it('defaults to the trainer\'s episode limits and fitness weights', () => {
    expect(ON_OVAL.config).toEqual(DEFAULT_EVALUATION_CONFIG);
    expect(DEFAULT_EVALUATION_CONFIG).toEqual({
      maxEpisodeSeconds: DEFAULT_TRAINING_CONFIG.maxEpisodeSeconds,
      stallSeconds: DEFAULT_TRAINING_CONFIG.stallSeconds,
      maxLaps: DEFAULT_TRAINING_CONFIG.maxLaps,
      fitness: DEFAULT_TRAINING_CONFIG.fitness,
    });
    expect(ON_OVAL.rules).toEqual(createTrainingSetup(DEFAULT_TRAINING_CONFIG, env(OVAL)).rules);
  });

  it('applies overrides through the same resolvers, so episodes end at the new limit', () => {
    const short = createEvaluationSetup({ maxEpisodeSeconds: 2, stallSeconds: 10 }, env(OVAL));
    expect(short.rules.maxEpisodeTicks).toBe(120);
    const result = evaluateDriver(constantDriver({ steering: 0, throttle: 0, brake: 0 }), short);
    expect(result.episode.outcome).toBe('timeout');
    expect(result.episode.tick).toBe(120);
  });

  it.each([
    ['an unknown field', { seed: 3 }, /Unknown evaluation config field "seed"/],
    ['a typo', { maxLap: 2 }, /Unknown evaluation config field "maxLap"/],
    ['a bad limit', { maxEpisodeSeconds: 0 }, /maxEpisodeSeconds/],
    ['bad fitness', { fitness: { ...DEFAULT_FITNESS_CONFIG, version: 2 } }, /version/],
    ['an array', [], /must be an object/],
  ])('rejects %s', (_label, config, message) => {
    expect(() => createEvaluationSetup(config, env(OVAL))).toThrow(message);
  });

  it('records the track and its split', () => {
    expect(ON_OVAL.versions).toMatchObject({ trackId: 'stadium-oval', trackSplit: 'training' });
    expect(ON_VALIDATION.versions).toMatchObject({ trackId: 'rounded-rectangle', trackSplit: 'validation' });
    expect(ON_OVAL.versions.trackHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe('training versus evaluation boundaries', () => {
  it('evaluates a validation track, but the trainer still refuses to train on it', () => {
    expect(assertEvaluationTrack(VALIDATION)).toBe('validation');
    expect(evaluateDriver(createRandomDriver(3), ON_VALIDATION).episode.outcome).not.toBeNull();
    expect(() => createTrainer(DEFAULT_TRAINING_CONFIG, env(VALIDATION))).toThrow(TrackLeakageError);
    expect(() => createTrainingSetup(DEFAULT_TRAINING_CONFIG, env(VALIDATION))).toThrow(TrackLeakageError);
  });

  it('refuses the held-out track, also renamed or under a training ID', () => {
    expect(() => createEvaluationSetup({}, env(HELD_OUT))).toThrow(TrackLeakageError);
    expect(() => createEvaluationSetup({}, env({ ...HELD_OUT, id: 'my-copy' }))).toThrow(/copy of "hairpin-chicane"/);
    expect(() => createEvaluationSetup({}, env({ ...HELD_OUT, id: 'stadium-oval' }))).toThrow(TrackLeakageError);
    expect(() => assertEvaluationTrack({ ...OVAL, id: 'hairpin-chicane' })).toThrow(TrackLeakageError);
  });

  it('classifies a renamed validation copy by its geometry and accepts an unregistered track', () => {
    expect(assertEvaluationTrack({ ...VALIDATION, id: 'stadium-oval' })).toBe('validation');
    const moved = { ...OVAL, id: 'synthetic', start: { ...OVAL.start, heading: OVAL.start.heading + 1e-9 } };
    expect(assertEvaluationTrack(moved)).toBe('unregistered');
  });

  it('keeps the new modules away from evolution, held-out access and unseeded randomness', () => {
    for (const file of ['src/training/evaluation.ts', 'src/training/episodeStep.ts', 'src/ai/randomDrivers.ts', 'src/ai/drivers.ts']) {
      // Code only: the comments name these functions to explain the boundary.
      const code = readFileSync(join(__dirname, '../..', file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      const imports = [...code.matchAll(/from '([^']+)'/g)].map((m) => m[1]!);
      expect(imports.filter((path) => /evolution|trainer|experiment/.test(path))).toEqual([]);
      for (const name of ['heldOutTrack', 'validationTrack', 'selectByValidation', 'tracksIn', 'Math.random', 'Date']) {
        expect(code).not.toMatch(new RegExp(`\\b${name.replace('.', '\\.')}\\b`));
      }
    }
  });
});
