// P2-08 baseline generation and selection (docs/experiments/p2-08-baselines-design.md): A2, A9 and A8 for one
// training seed. Stream pairing, selection and ties, budgets (including elite re-evaluations), immutability,
// isolation and invalid inputs. Small configurations and mechanics seeds (7xxx) only, outside the pilot (9001–9003)
// and confirmatory (1001–1020) sets. Mechanics checks, not study results or evidence of learning.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { initialParameters } from '../../src/ai/network';
import { rankByFitness } from '../../src/evolution/selection';
import {
  A8_STREAM,
  generateBaselines,
  genomeId,
  resolveBaselineConfig,
  selectBest,
  SELECTION_RULE,
  type BaselineConfig,
} from '../../src/training/baselines';
import { canonicalJson } from '../../src/training/experiment';
import { DEFAULT_FITNESS_CONFIG } from '../../src/training/fitness';
import { isFrozenModel, TrackLeakageError } from '../../src/training/trackSplits';
import { createTrainer, DEFAULT_TRAINING_CONFIG, evaluateGenome, trainerStreams } from '../../src/training/trainer';
import { createRng } from '../../src/utils/rng';

const CONFIG: BaselineConfig = {
  training: { populationSize: 5, eliteCount: 1, maxEpisodeSeconds: 4, stallSeconds: 2 },
  generations: 3,
  trackId: 'stadium-oval',
};
const SEED = 7101;
const P = 5;
const G = 3;
const RESULT = generateBaselines(CONFIG, SEED);
const SETUP = resolveBaselineConfig(CONFIG, SEED).setup;
const ENV = resolveBaselineConfig(CONFIG, SEED).environment;
const draws = (seed: number, count: number) => {
  const { initial } = trainerStreams(seed);
  return Array.from({ length: count }, () => initialParameters(initial));
};
const totals = (candidates: readonly { training: { fitness: { total: number } } }[]) => candidates.map((c) => c.training.fitness.total);

describe('mechanics seeds only', () => {
  it('uses seeds outside the reserved pilot and confirmatory sets', () => {
    for (const seed of [SEED, 7102, 7103, 7104]) expect((seed >= 1001 && seed <= 1020) || (seed >= 9001 && seed <= 9003)).toBe(false);
  });
});

describe('RNG ownership and stream pairing', () => {
  it('trainerStreams is the trainer\'s derivation, and leaves run exactly one draw in', () => {
    const trainer = createTrainer({ ...SETUP.config }, ENV);
    expect(trainer.generation().cars.map((c) => Array.from(c.genome))).toEqual(draws(SEED, P).map((g) => Array.from(g)));
    const { run } = trainerStreams(SEED);
    const reference = createRng(SEED);
    reference.nextUint32();
    expect(run.getState()).toEqual(reference.getState());
  });

  it('A2 is the evolutionary run\'s generation 0, scored by the trainer', () => {
    const trainer = createTrainer({ ...SETUP.config }, ENV);
    trainer.runGeneration();
    const cars = trainer.finished()!.cars;
    expect(RESULT.A2.generation).toBe(0);
    expect(RESULT.A2.candidates.map((c) => c.genomeId)).toEqual(cars.map((car) => genomeId(car.genome)));
    RESULT.A2.candidates.forEach((c, i) => {
      expect(c.index).toBe(i);
      expect(c.training.ticks).toBe(cars[i]!.episode.tick);
      expect(c.training.gatesPassed).toBe(cars[i]!.episode.gatesPassed);
    });
  });

  it('A8\'s first P samples are A2: same genomes and same episodes', () => {
    expect(RESULT.A8.samples.slice(0, P).map((c) => c.genomeId)).toEqual(RESULT.A2.candidates.map((c) => c.genomeId));
    expect(RESULT.A8.samples.slice(0, P).map((c) => c.training)).toEqual(RESULT.A2.candidates.map((c) => c.training));
  });

  it('later A8 samples continue the same stream and are scored through the shared path', () => {
    const genomes = draws(SEED, P * G);
    expect(RESULT.A8.samples.map((c) => c.genomeId)).toEqual(genomes.map(genomeId));
    RESULT.A8.samples.forEach((c, i) => {
      expect(c.index).toBe(i);
      const episode = evaluateGenome(genomes[i]!, SETUP).episode;
      expect(c.training.ticks).toBe(episode.tick);
      expect(c.training.outcome).toBe(episode.outcome);
      expect(c.training.orderedProgress).toBe(episode.gatesPassed / ENV.track.gates.length);
    });
    expect(RESULT.A8.stream).toBe(A8_STREAM);
  });

  it('generating baselines does not shift a trainer\'s streams or results', () => {
    const settings = { ...SETUP.config };
    const alone = createTrainer(settings, ENV);
    alone.runGeneration();
    alone.runGeneration();
    const interleaved = createTrainer(settings, ENV);
    interleaved.runGeneration();
    generateBaselines(CONFIG, SEED);
    interleaved.runGeneration();
    expect(canonicalJson(interleaved.record().generations.map((g) => ({ ...g, champion: Array.from(g.champion) })))).toBe(
      canonicalJson(alone.record().generations.map((g) => ({ ...g, champion: Array.from(g.champion) }))),
    );
  });
});

describe('selection', () => {
  it('picks the highest fitness, earliest wins ties, as rankByFitness does', () => {
    expect(selectBest([3, 7, 7, 1])).toBe(1);
    expect(selectBest([-5, -5])).toBe(0);
    expect(selectBest([0])).toBe(0);
    expect(selectBest([1, 2, 3])).toBe(2);
    const rng = createRng(7150);
    for (let k = 0; k < 100; k += 1) {
      const fitness = Array.from({ length: 1 + rng.int(0, 12) }, () => rng.int(-3, 4));
      expect(selectBest(fitness)).toBe(rankByFitness(fitness)[0]);
    }
  });

  it.each([[[]], [[1, Number.NaN]], [[Infinity]], [['1' as unknown as number]]])('rejects %j', (fitness) => {
    expect(() => selectBest(fitness)).toThrow(RangeError);
  });

  it('A9 is the best of A2, and A8 selects the best of its samples', () => {
    expect(RESULT.A9.index).toBe(selectBest(totals(RESULT.A2.candidates)));
    expect(RESULT.A8.selected.index).toBe(selectBest(totals(RESULT.A8.samples)));
    expect(RESULT.selectionRule).toBe(SELECTION_RULE);
  });

  it('a tie goes to the earliest evaluated candidate', () => {
    // Three-tick episodes cross no gate, and with partial progress unweighted every candidate scores exactly 0.
    const fitness = { ...DEFAULT_FITNESS_CONFIG, partialProgressWeight: 0 };
    const tied = generateBaselines({ ...CONFIG, training: { ...CONFIG.training, maxEpisodeSeconds: 0.05, stallSeconds: 0.05, fitness } }, 7102);
    expect(totals(tied.A8.samples).every((t) => t === 0)).toBe(true);
    const all = totals(tied.A8.samples);
    const best = Math.max(...all);
    expect(all.filter((t) => t === best).length).toBeGreaterThan(1);
    expect(tied.A8.selected.index).toBe(all.indexOf(best));
    expect(tied.A9.index).toBe(totals(tied.A2.candidates).indexOf(Math.max(...totals(tied.A2.candidates))));
  });
});

describe('selected models are independent frozen copies', () => {
  it.each(['A9', 'A8'] as const)('%s keeps its parameters, provenance and ID, and cannot be changed', (agent) => {
    const { model, index } = agent === 'A9' ? RESULT.A9 : RESULT.A8.selected;
    expect(isFrozenModel(model)).toBe(true);
    const genomes = draws(SEED, P * G);
    expect(model.parameters).toEqual(Array.from(genomes[index]!));
    expect(genomeId(model.parameters)).toBe(agent === 'A9' ? RESULT.A2.candidates[index]!.genomeId : RESULT.A8.samples[index]!.genomeId);
    expect(model.provenance).toMatchObject({ agent, seed: SEED, index, selection: SELECTION_RULE, trackId: 'stadium-oval' });
    expect(() => {
      (model.parameters as number[])[0] = 99;
    }).toThrow(TypeError);
    expect(() => {
      (model.provenance as Record<string, unknown>).seed = 1;
    }).toThrow(TypeError);
  });

  it('A9\'s provenance names generation 0, and A8\'s names its stream', () => {
    expect(RESULT.A9.model.provenance.generation).toBe(0);
    expect(RESULT.A8.selected.model.provenance.stream).toBe(A8_STREAM);
  });

  it('results are frozen, and the config passed in is never written', () => {
    const config = JSON.parse(JSON.stringify(CONFIG)) as BaselineConfig;
    const result = generateBaselines(config, SEED);
    expect(config).toEqual(CONFIG);
    expect(Object.isFrozen(result.A2.candidates)).toBe(true);
    expect(Object.isFrozen(result.A8.samples[0]!.training)).toBe(true);
    expect(Object.isFrozen(result.budgets)).toBe(true);
  });
});

describe('budgets', () => {
  it('A8 gets exactly the evolutionary run\'s P × G evaluations', () => {
    expect(RESULT.budgets.evolution.evaluations).toBe(P * G);
    expect(RESULT.budgets.a8Evaluations).toBe(P * G);
    expect(RESULT.A8.samples).toHaveLength(P * G);
    expect(RESULT.budgets.a2Evaluations).toBe(P);
  });

  it('counts the elite re-evaluations inside the evolutionary P × G', () => {
    expect(RESULT.budgets.evolution.eliteReevaluations).toBe(1 * (G - 1));
    expect(RESULT.budgets.evolution.maxDistinctGenomes).toBe(P * G - (G - 1));
  });

  it('a full run really performs P × G evaluations, re-evaluating elites to their previous fitness', () => {
    const trainer = createTrainer({ ...SETUP.config }, ENV);
    let evaluations = 0;
    let previous: { champion: Float64Array; best: number } | null = null;
    for (let g = 0; g < G; g += 1) {
      const stats = trainer.runGeneration();
      const cars = trainer.finished()!.cars;
      evaluations += cars.length;
      if (previous) {
        // Elite 0 is the previous champion, copied unchanged and evaluated again.
        expect(Array.from(cars[0]!.genome)).toEqual(Array.from(previous.champion));
        expect(stats.fitness[0]).toBe(previous.best);
      }
      previous = { champion: stats.champion, best: stats.bestFitness };
    }
    expect(evaluations).toBe(RESULT.budgets.evolution.evaluations);
  });

  it('sums simulated ticks for A2 and A8', () => {
    expect(RESULT.budgets.ticks.A2).toBe(RESULT.A2.candidates.reduce((t, c) => t + c.training.ticks, 0));
    expect(RESULT.budgets.ticks.A8).toBe(RESULT.A8.samples.reduce((t, c) => t + c.training.ticks, 0));
  });
});

describe('determinism and isolation', () => {
  it('the same config and seed give an identical result, after other seeds and in another order', () => {
    const other = generateBaselines(CONFIG, 7103);
    expect(canonicalJson(generateBaselines(CONFIG, SEED))).toBe(canonicalJson(RESULT));
    expect(canonicalJson(other)).not.toBe(canonicalJson(RESULT));
    expect(canonicalJson(generateBaselines(CONFIG, 7103))).toBe(canonicalJson(other));
  });
});

describe('invalid inputs', () => {
  it.each([
    ['a non-object config', null, /must be an object/],
    ['an unknown top-level field', { ...CONFIG, seeds: [1] }, /Unknown baseline config field "seeds"/],
    ['an unknown training field', { ...CONFIG, training: { populationSise: 4 } }, /"training\.populationSise"/],
    ['an unknown nested field', { ...CONFIG, training: { mutation: { rate: 0.1, sclae: 0.2 } } }, /"training\.mutation\.sclae"/],
    ['the seed inside training', { ...CONFIG, training: { seed: 3 } }, /"training\.seed"/],
    ['zero generations', { ...CONFIG, generations: 0 }, /generations/],
    ['fractional generations', { ...CONFIG, generations: 1.5 }, /generations/],
    ['too many generations', { ...CONFIG, generations: 10_001 }, /generations/],
    ['a non-string track', { ...CONFIG, trackId: 3 }, /trackId/],
    ['an invalid population', { ...CONFIG, training: { populationSize: 0 } }, /populationSize/],
  ])('rejects %s', (_label, config, message) => {
    expect(() => generateBaselines(config as BaselineConfig, SEED)).toThrow(message);
  });

  it.each([-1, 1.5, 2 ** 32])('rejects the seed %s', (seed) => {
    expect(() => generateBaselines(CONFIG, seed)).toThrow(RangeError);
  });

  it.each(['rounded-rectangle', 'hairpin-chicane'])('refuses %s, which is not a training track', (trackId) => {
    expect(() => generateBaselines({ ...CONFIG, trackId }, SEED)).toThrow(TrackLeakageError);
  });

  it('defaults to the trainer\'s settings for fields left out', () => {
    const { setup } = resolveBaselineConfig({ generations: 1, trackId: 'stadium-oval' }, SEED);
    expect({ ...setup.config, seed: DEFAULT_TRAINING_CONFIG.seed }).toEqual(DEFAULT_TRAINING_CONFIG);
  });
});

describe('boundaries', () => {
  it('never references held-out or validation accessors, or unseeded randomness', () => {
    const code = readFileSync(join(__dirname, '../../src/training/baselines.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const name of ['heldOutTrack', 'validationTrack', 'selectByValidation', 'tracksIn', 'Math\\.random', 'Date']) {
      expect(code).not.toMatch(new RegExp(`\\b${name}\\b`));
    }
  });
});
