// The population training loop (P2-05): lifecycle, independence, reset semantics, generation transitions,
// determinism and the rendered/headless boundary. Runs on the built-in oval with the real physics, sensors,
// network, fitness and genetic operators. These tests check the mechanics; a rising fitness here is not
// evidence of learning (docs/AI_EVALUATION.md).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { INPUT_CONTRACT } from '../../src/ai/inputs';
import { initialParameters, PARAMETER_COUNT } from '../../src/ai/network';
import { createEvolutionRngs, EVOLUTION_OPERATORS, nextGeneration } from '../../src/evolution/population';
import { rankByFitness } from '../../src/evolution/selection';
import { drawCars, type RaceContext } from '../../src/render/raceView';
import { computeViewportSize } from '../../src/render/viewport';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { createFixedStepClock } from '../../src/sim/fixedStep';
import { loadTrack } from '../../src/sim/track';
import { startRacer } from '../../src/sim/world';
import { DEFAULT_FITNESS_CONFIG, FITNESS_VERSION } from '../../src/training/fitness';
import {
  carFitness,
  createTrainer,
  createTrainingSetup,
  DEFAULT_TRAINING_CONFIG,
  evaluateGenome,
  generationDone,
  startGeneration,
  stepGeneration,
  trainHeadless,
  type Generation,
  type TrainingConfig,
  type TrainingSetup,
} from '../../src/training/trainer';
import { startFrameLoop } from '../../src/ui/frameLoop';
import { createRng, RNG_ALGORITHM } from '../../src/utils/rng';
import { FakeFrames } from '../ui/fakeFrames';

const track = loadTrack(stadiumOval);
const ENV = { track, physics: DEFAULT_VEHICLE_PHYSICS, timestepSeconds: DEFAULT_SIM_CONFIG.timestepSeconds };
/** A small, short configuration so whole generations run quickly. */
const SMALL: TrainingConfig = { ...DEFAULT_TRAINING_CONFIG, seed: 7, populationSize: 8, eliteCount: 2, maxEpisodeSeconds: 15 };
const config = (overrides: Partial<Record<keyof TrainingConfig, unknown>> = {}) => ({ ...SMALL, ...overrides }) as TrainingConfig;

/** Steps a generation until every car's episode has ended. */
function finish(generation: Generation, setup: TrainingSetup): Generation {
  let current = generation;
  while (!generationDone(current)) current = stepGeneration(current, setup);
  return current;
}

describe('configuration', () => {
  it('defaults to the MODEL_FORMAT example settings, with seed 1', () => {
    const doc = readFileSync(join(__dirname, '../../docs/MODEL_FORMAT.md'), 'utf8');
    const start = doc.indexOf('```json') + 7;
    const example = JSON.parse(doc.slice(start, doc.indexOf('```', start))).training.configuration;
    const { populationSize, eliteCount, selection, crossover, mutation, maxEpisodeSeconds, stallSeconds, maxLaps, brakeEnabled, fitness } = example;
    expect(DEFAULT_TRAINING_CONFIG).toEqual({
      seed: 1,
      populationSize,
      eliteCount,
      selection,
      crossover,
      mutation,
      maxEpisodeSeconds,
      stallSeconds,
      maxLaps,
      brakeEnabled,
      fitness,
    });
    expect(Object.isFrozen(DEFAULT_TRAINING_CONFIG)).toBe(true);
  });

  it('records the versions and contracts a champion replay depends on', () => {
    const setup = createTrainingSetup(SMALL, ENV);
    expect(setup.versions).toEqual({
      rngAlgorithm: RNG_ALGORITHM,
      evolutionOperators: EVOLUTION_OPERATORS,
      initialisation: 'uniform-pm1-v1',
      parameterOrder: 'layer-major; per layer: weights[out][in] row-major, then biases[out]',
      inputContract: INPUT_CONTRACT,
      outputContract: 'steering-throttle-brake-v1',
      fitnessVersion: FITNESS_VERSION,
      trackId: 'stadium-oval',
      trackVersion: '1',
      trackHash: 'sha256:f1c3e1a7f9ef938d7a1ffd4bcb79e4260fd870b4c637fdf43389ee7f4aefe8c2',
      trackSplit: 'training',
    });
    expect(setup.rules).toEqual({ timestepSeconds: 1 / 60, maxEpisodeTicks: 900, stallTicks: 300, maxLaps: 3 });
  });

  it('records the physics the cars drove with, so runs under different physics have different records', () => {
    const record = trainHeadless(SMALL, ENV, 1);
    expect(record.physics).toEqual(DEFAULT_VEHICLE_PHYSICS);
    expect(record.physics).not.toBe(DEFAULT_VEHICLE_PHYSICS);
    expect(Object.isFrozen(record.physics)).toBe(true);
    expect(record.timestepSeconds).toBe(1 / 60);
    const faster = { ...DEFAULT_VEHICLE_PHYSICS, engineAcceleration: 10 };
    const other = trainHeadless(SMALL, { ...ENV, physics: faster }, 1);
    expect(other.physics).toEqual(faster);
    expect(other.physics).not.toEqual(record.physics);
  });

  it.each([
    ['seed', -1],
    ['seed', 1.5],
    ['seed', 2 ** 32],
    ['seed', '1'],
    ['brakeEnabled', 'yes'],
    ['populationSize', 1],
    ['eliteCount', 9],
    ['stallSeconds', 0],
    ['maxLaps', 0],
  ])('rejects %s = %s', (field, value) => {
    expect(() => createTrainer(config({ [field]: value }), ENV)).toThrow(RangeError);
  });

  it('rejects an invalid fitness block, a bad timestep and a track without gates', () => {
    expect(() => createTrainer(config({ fitness: { ...DEFAULT_FITNESS_CONFIG, partialProgressWeight: 2000 } }), ENV)).toThrow(/partialProgressWeight/);
    expect(() => createTrainer(SMALL, { ...ENV, timestepSeconds: 0 })).toThrow(/timestepSeconds/);
    expect(() => createTrainer(SMALL, { ...ENV, track: { ...track, gates: [] } })).toThrow(/gates/);
    expect(() => createTrainer(null, ENV)).toThrow(RangeError);
    expect(() => trainHeadless(SMALL, ENV, 0)).toThrow(/Generations/);
  });
});

describe('generation 0 and RNG ownership', () => {
  it('starts every car fresh on the same start pose, with genomes from the run generator\'s first draw', () => {
    const trainer = createTrainer(SMALL, ENV);
    const generation = trainer.generation();
    expect(generation.index).toBe(0);
    expect(generation.tick).toBe(0);
    expect(trainer.finished()).toBeNull();
    const run = createRng(SMALL.seed);
    const initial = createRng(run.nextUint32());
    const expected = Array.from({ length: 8 }, () => initialParameters(initial));
    const fresh = startRacer(track, DEFAULT_VEHICLE_PHYSICS);
    generation.cars.forEach((car, i) => {
      expect(car.genome).toEqual(expected[i]);
      expect(car.genome.length).toBe(PARAMETER_COUNT);
      expect(car.racer).toEqual(fresh); // all overlapping at the start pose, at rest, tick 0
      expect(car.episode).toMatchObject({ tick: 0, gatesPassed: 0, outcome: null, partialProgress: 0 });
    });
    // Each car has its own objects: nothing mutable is shared.
    expect(new Set(generation.cars.map((c) => c.racer)).size).toBe(8);
    expect(new Set(generation.cars.map((c) => c.genome)).size).toBe(8);
  });

  it('builds generation 1 with exactly three more run-generator draws, as nextGeneration with createEvolutionRngs', () => {
    const trainer = createTrainer(SMALL, ENV);
    const gen0 = trainer.generation().cars.map((c) => c.genome);
    const stats = trainer.runGeneration();
    const run = createRng(SMALL.seed);
    run.nextUint32(); // the initial-population seed
    const expected = nextGeneration(gen0, stats.fitness, SMALL, createEvolutionRngs(run));
    expect(trainer.generation().cars.map((c) => c.genome)).toEqual(expected.genomes);
  });
});

describe('episode lifecycle', () => {
  it('runs every car until its own episode ends, freezes finished cars, and ends the generation when all have ended', () => {
    const setup = createTrainingSetup(SMALL, ENV);
    let generation = startGeneration(0, createTrainer(SMALL, ENV).generation().cars.map((c) => c.genome), setup);
    const endedAt = new Map<number, unknown>();
    while (!generationDone(generation)) {
      const next = stepGeneration(generation, setup);
      next.cars.forEach((car, i) => {
        const before = generation.cars[i]!;
        if (before.episode.outcome !== null) {
          expect(car).toBe(before); // a finished car is never stepped again
        } else {
          expect(car.episode.tick).toBe(before.episode.tick + 1);
          if (car.episode.outcome !== null) endedAt.set(i, car.episode.tick);
        }
      });
      generation = next;
    }
    expect(endedAt.size).toBe(8);
    expect(generation.tick).toBe(Math.max(...generation.cars.map((c) => c.episode.tick)));
    expect(generation.tick).toBeLessThanOrEqual(setup.rules.maxEpisodeTicks);
  });

  it('ends every episode, even with tiny limits, and never runs a generation past maxEpisodeTicks', () => {
    const record = trainHeadless(config({ maxEpisodeSeconds: 0.5, stallSeconds: 0.25 }), ENV, 4);
    for (const stats of record.generations) {
      expect(stats.generationTicks).toBeLessThanOrEqual(30);
      expect(Object.values(stats.outcomes).reduce((a, b) => a + b, 0)).toBe(8);
    }
  });

  it('records statistics that agree with the cars\' episodes', () => {
    const trainer = createTrainer(SMALL, ENV);
    const stats = trainer.runGeneration();
    const done = trainer.finished()!;
    const setup = trainer.setup;
    const fitness = done.cars.map((car) => carFitness(car, setup));
    expect(stats.fitness).toEqual(fitness);
    expect(stats.bestFitness).toBe(Math.max(...fitness));
    expect(stats.worstFitness).toBe(Math.min(...fitness));
    expect(stats.meanFitness).toBeCloseTo(fitness.reduce((a, b) => a + b, 0) / 8, 9);
    expect(stats.championIndex).toBe(rankByFitness(fitness)[0]);
    expect(stats.champion).toEqual(done.cars[stats.championIndex]!.genome);
    expect(stats.champion).not.toBe(done.cars[stats.championIndex]!.genome); // a copy
    const outcomes = { completed: 0, crashed: 0, stalled: 0, timeout: 0 };
    for (const car of done.cars) outcomes[car.episode.outcome!] += 1;
    expect(stats.outcomes).toEqual(outcomes);
    expect(stats.totalEpisodeTicks).toBe(done.cars.reduce((sum, c) => sum + c.episode.tick, 0));
    expect(stats.maxGatesPassed).toBe(Math.max(...done.cars.map((c) => c.episode.gatesPassed)));
    expect(stats.carsWithLap).toBe(done.cars.filter((c) => c.episode.lapTicks.length > 0).length);
    expect(stats.generationTicks).toBe(done.tick);
  });
});

describe('car independence (multi-car Option A)', () => {
  const setup = createTrainingSetup(SMALL, ENV);
  const genomes = createTrainer(SMALL, ENV).generation().cars.map((c) => c.genome);

  it('gives each genome a bit-identical episode alone, in the population, and in reversed and shuffled populations', () => {
    const together = finish(startGeneration(0, genomes, setup), setup).cars;
    // The population includes cars that crash and cars that do not, all starting overlapped.
    expect(together.some((c) => c.episode.outcome === 'crashed')).toBe(true);
    expect(together.some((c) => c.episode.outcome !== 'crashed')).toBe(true);
    const order = [5, 2, 7, 0, 3, 6, 1, 4];
    const reversed = [...finish(startGeneration(0, [...genomes].reverse(), setup), setup).cars].reverse();
    const shuffled = finish(startGeneration(0, order.map((i) => genomes[i]!), setup), setup).cars;
    genomes.forEach((genome, i) => {
      const alone = evaluateGenome(genome, setup);
      expect(together[i]!.racer).toEqual(alone.racer);
      expect(together[i]!.episode).toEqual(alone.episode);
      expect(reversed[i]!.episode).toEqual(alone.episode);
      expect(shuffled[order.indexOf(i)]!.episode).toEqual(alone.episode);
      expect(carFitness(together[i]!, setup)).toBe(carFitness(alone, setup));
    });
  });

  it('gives the same result when the same genome appears several times, and next to different neighbours', () => {
    const twins = finish(startGeneration(0, [genomes[0]!, genomes[0]!, genomes[1]!, genomes[0]!], setup), setup).cars;
    expect(twins[1]!.episode).toEqual(twins[0]!.episode);
    expect(twins[3]!.episode).toEqual(twins[0]!.episode);
    expect(twins[0]!.episode).toEqual(evaluateGenome(genomes[0]!, setup).episode);
  });

  it('never writes the genomes, track or configuration', () => {
    const frozen = genomes.map((g) => Float64Array.from(g));
    const before = JSON.stringify({ track, SMALL });
    trainHeadless(SMALL, ENV, 2);
    finish(startGeneration(0, genomes, setup), setup);
    expect(genomes).toEqual(frozen);
    expect(JSON.stringify({ track, SMALL })).toBe(before);
  });
});

describe('generation transitions and elites', () => {
  it('keeps the population size, numbers generations in order and starts each generation fresh', () => {
    const trainer = createTrainer(SMALL, ENV);
    for (let g = 0; g < 4; g += 1) {
      const generation = trainer.generation();
      expect(generation.index).toBe(g);
      expect(generation.tick).toBe(0);
      expect(generation.cars).toHaveLength(8);
      const fresh = startRacer(track, DEFAULT_VEHICLE_PHYSICS);
      for (const car of generation.cars) {
        expect(car.racer).toEqual(fresh);
        expect(car.episode).toMatchObject({ tick: 0, gatesPassed: 0, lapTicks: [], crashed: false, outcome: null });
      }
      expect(trainer.runGeneration().generation).toBe(g);
    }
    expect(trainer.record().generations.map((s) => s.generation)).toEqual([0, 1, 2, 3]);
  });

  it('copies the elites unchanged into places 0 and 1, where they score exactly their previous fitness', () => {
    const trainer = createTrainer(SMALL, ENV);
    for (let g = 0; g < 3; g += 1) {
      const previous = trainer.runGeneration();
      const ranked = rankByFitness(previous.fitness);
      const finishedGenomes = trainer.finished()!.cars.map((c) => c.genome);
      const next = trainer.generation();
      expect(next.cars[0]!.genome).toEqual(finishedGenomes[ranked[0]!]);
      expect(next.cars[1]!.genome).toEqual(finishedGenomes[ranked[1]!]);
      expect(next.cars[0]!.genome).not.toBe(finishedGenomes[ranked[0]!]); // new arrays
      const scored = trainer.runGeneration();
      expect(scored.fitness[0]).toBe(previous.fitness[ranked[0]!]);
      expect(scored.fitness[1]).toBe(previous.fitness[ranked[1]!]);
      // So the best fitness never falls between generations while elites are kept.
      expect(scored.bestFitness).toBeGreaterThanOrEqual(previous.bestFitness);
    }
  });

  it('honours brakeEnabled: with the brake masked, cars evaluate exactly as networks whose brake output is 0', () => {
    const masked = createTrainingSetup(config({ brakeEnabled: false }), ENV);
    const genome = createTrainer(SMALL, ENV).generation().cars[0]!.genome;
    // Setting the brake output's weights and bias to a huge negative value makes sigmoid(o2) exactly 0.
    const noBrake = Float64Array.from(genome);
    for (let i = 120 + 2 * 12; i < 120 + 3 * 12; i += 1) noBrake[i] = 0;
    noBrake[158] = -1e6;
    const withBrakeSetup = createTrainingSetup(SMALL, ENV);
    expect(evaluateGenome(genome, masked).episode).toEqual(evaluateGenome(noBrake, withBrakeSetup).episode);
  });
});

describe('determinism', () => {
  it('gives identical statistics, champions and genomes for the same seed and config over 5 generations', () => {
    const a = trainHeadless(SMALL, ENV, 5);
    const b = trainHeadless(SMALL, ENV, 5);
    expect(b).toEqual(a);
    expect(a.generations).toHaveLength(5);
    const c = trainHeadless(config({ seed: 8 }), ENV, 5);
    expect(c.generations[0]!.fitness).not.toEqual(a.generations[0]!.fitness);
  });

  it('gives the same results through the page\'s frame loop, drawing every frame, at any frame rate', () => {
    const headless = trainHeadless(SMALL, ENV, 3);
    const context = nullContext();
    const size = computeViewportSize(390, 600, 3);
    const view = { scale: 2.5, offsetX: 195, offsetY: 300 };
    for (const frameMs of [1000 / 30, 1000 / 60, 1000 / 144, 73]) {
      const env = new FakeFrames();
      const trainer = createTrainer(SMALL, ENV);
      let draws = 0;
      const loop = startFrameLoop(env, createFixedStepClock(DEFAULT_SIM_CONFIG), {
        step: () => {
          if (trainer.record().generations.length < 3) trainer.step();
        },
        render: () => {
          const cars = trainer.generation().cars.map((c) => ({ car: c.racer.car, finished: c.episode.outcome !== null }));
          drawCars(context, size, view, cars, DEFAULT_VEHICLE_PHYSICS);
          draws += 1;
        },
      });
      for (let t = 0; trainer.record().generations.length < 3; t += frameMs) env.fire(t);
      loop.stop();
      expect(trainer.record()).toEqual(headless);
      expect(draws).toBeGreaterThan(10);
    }
  });
});

describe('long runs', () => {
  it('runs 50 generations headless without errors, recording finite statistics for every generation', () => {
    const record = trainHeadless(config({ populationSize: 10, maxEpisodeSeconds: 20, seed: 50 }), ENV, 50);
    expect(record.generations).toHaveLength(50);
    record.generations.forEach((stats, g) => {
      expect(stats.generation).toBe(g);
      expect(stats.fitness).toHaveLength(10);
      for (const value of [...stats.fitness, stats.bestFitness, stats.meanFitness, stats.worstFitness]) expect(Number.isFinite(value)).toBe(true);
      expect(stats.generationTicks).toBeLessThanOrEqual(1200);
    });
  }, 120_000);
});

describe('separation', () => {
  it('the trainer imports no rendering, UI, persistence or DOM code', () => {
    const source = readFileSync(join(__dirname, '../../src/training/trainer.ts'), 'utf8');
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]!);
    for (const path of imports) expect(path).toMatch(/^(\.\.\/(ai|evolution|sensors|sim|utils)\/|\.\/)/);
  });
});

/** A canvas context that accepts every drawing call and keeps nothing. */
function nullContext(): RaceContext {
  const context: Record<string, unknown> = { fillStyle: '', strokeStyle: '', lineWidth: 1, lineJoin: 'miter' };
  for (const name of ['setTransform', 'beginPath', 'moveTo', 'lineTo', 'arc', 'closePath', 'fill', 'stroke']) context[name] = () => {};
  return context as unknown as RaceContext;
}
