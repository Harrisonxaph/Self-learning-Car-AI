// P2-08 step 3 B2 (docs/experiments/p2-08-step3-design.md §2.5): A5's run and champion, A1/A7 episodes from SHA-256
// action seeds, and descriptive validation evaluation of A2, A9, A8 and A5. Small configurations and mechanics seeds
// (72xx) only, outside the pilot (9001–9003) and confirmatory (1001–1020) sets. Mechanics checks, not study results
// or evidence of learning.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNetworkDriver } from '../../src/ai/drivers';
import { createCorrelatedRandomDriver, createRandomDriver } from '../../src/ai/randomDrivers';
import { A5_SELECTION, actionSeed, generateAgents, type AgentConfig } from '../../src/training/agents';
import { generateBaselines, genomeId, selectBest, type EpisodeResult } from '../../src/training/baselines';
import { createEvaluationSetup, evaluateDriver } from '../../src/training/evaluation';
import { canonicalJson } from '../../src/training/experiment';
import { BUILT_IN_TRACK_SPLITS, isFrozenModel, TrackLeakageError } from '../../src/training/trackSplits';
import { createTrainer, DEFAULT_TRAINING_CONFIG } from '../../src/training/trainer';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';

const TRAINING = { populationSize: 4, eliteCount: 1, maxEpisodeSeconds: 4, stallSeconds: 2 };
const CONFIG: AgentConfig = { training: TRAINING, generations: 3, trackId: 'stadium-oval', validationTrackId: 'rounded-rectangle', episodesPerTrack: 3 };
const SEED = 7201;
const P = 4;
const G = 3;
const E = 3;
const RESULT = generateAgents(CONFIG, SEED);
const BASELINES = generateBaselines({ training: TRAINING, generations: G, trackId: 'stadium-oval' }, SEED);
const track = (id: string) => BUILT_IN_TRACK_SPLITS.tracks.find((t) => t.id === id)!.track;
const env = (id: string) => ({ track: track(id), physics: DEFAULT_VEHICLE_PHYSICS, timestepSeconds: DEFAULT_SIM_CONFIG.timestepSeconds });
const LIMITS = { ...TRAINING, maxLaps: DEFAULT_TRAINING_CONFIG.maxLaps, fitness: DEFAULT_TRAINING_CONFIG.fitness };
delete (LIMITS as Record<string, unknown>).populationSize;
delete (LIMITS as Record<string, unknown>).eliteCount;
const SETUPS = { training: createEvaluationSetup(LIMITS, env('stadium-oval')), validation: createEvaluationSetup(LIMITS, env('rounded-rectangle')) };
const sameEpisode = (result: EpisodeResult, episode: { tick: number; outcome: unknown; gatesPassed: number; lapTicks: readonly number[] }) => {
  expect(result.ticks).toBe(episode.tick);
  expect(result.outcome).toBe(episode.outcome);
  expect(result.gatesPassed).toBe(episode.gatesPassed);
  expect(result.lapTicks).toEqual(episode.lapTicks);
};
const network = (parameters: ArrayLike<number>, which: 'training' | 'validation') =>
  evaluateDriver(createNetworkDriver(parameters, { brakeEnabled: true }), SETUPS[which]).episode;

describe('mechanics seeds only', () => {
  it('uses seeds outside the reserved pilot and confirmatory sets', () => {
    for (const seed of [SEED, 7202, 7203]) expect((seed >= 1001 && seed <= 1020) || (seed >= 9001 && seed <= 9003)).toBe(false);
  });
});

describe('composition with B1', () => {
  it('keeps B1\'s A2, A9 and A8 unchanged', () => {
    expect(canonicalJson(RESULT.baselines)).toBe(canonicalJson(BASELINES));
  });

  it('A5\'s generation 0 is B1\'s A2: genome IDs and episodes', () => {
    expect(RESULT.A5.genomeIds[0]).toEqual(BASELINES.A2.candidates.map((c) => c.genomeId));
    expect(RESULT.A5.generations[0]).toEqual(BASELINES.A2.candidates.map((c) => c.training));
  });
});

describe('A5: the evolutionary run and its champion', () => {
  it('keeps every car of every generation, in population order, matching an independent trainer run', () => {
    const trainer = createTrainer({ ...DEFAULT_TRAINING_CONFIG, ...TRAINING, seed: SEED }, env('stadium-oval'));
    expect(RESULT.A5.generations).toHaveLength(G);
    for (let g = 0; g < G; g += 1) {
      trainer.runGeneration();
      const cars = trainer.finished()!.cars;
      expect(RESULT.A5.genomeIds[g]).toEqual(cars.map((c) => genomeId(c.genome)));
      cars.forEach((car, i) => sameEpisode(RESULT.A5.generations[g]![i]!, car.episode));
    }
  });

  it('selects the final generation\'s best, earliest on ties, which with an elite is the best ever', () => {
    const final = RESULT.A5.generations[G - 1]!;
    expect(RESULT.A5.index).toBe(selectBest(final.map((e) => e.fitness.total)));
    expect(RESULT.A5.generation).toBe(G - 1);
    expect(RESULT.A5.selection).toBe(A5_SELECTION);
    expect(RESULT.A5.episodes.training).toEqual(final[RESULT.A5.index]);
    expect(RESULT.A5.episodes.training.fitness.total).toBe(Math.max(...RESULT.A5.generations.flat().map((e) => e.fitness.total)));
  });

  it('is a frozen copy with provenance whose parameters replay its training episode alone', () => {
    const { model } = RESULT.A5;
    expect(isFrozenModel(model)).toBe(true);
    expect(genomeId(model.parameters)).toBe(RESULT.A5.genomeIds[G - 1]![RESULT.A5.index]);
    expect(model.provenance).toMatchObject({ agent: 'A5', seed: SEED, generation: G - 1, index: RESULT.A5.index, selection: A5_SELECTION, trackId: 'stadium-oval' });
    sameEpisode(RESULT.A5.episodes.training, network(model.parameters, 'training'));
    expect(() => {
      (model.parameters as number[])[0] = 5;
    }).toThrow(TypeError);
  });

  it('records evaluations, the distinct-genome bound and the actual count separately', () => {
    expect(RESULT.A5.evaluations).toBe(P * G);
    expect(RESULT.A5.maxDistinctGenomes).toBe(P * G - 1 * (G - 1));
    expect(RESULT.A5.actualDistinctGenomes).toBe(new Set(RESULT.A5.genomeIds.flat()).size);
    expect(RESULT.A5.actualDistinctGenomes).toBeLessThanOrEqual(RESULT.A5.maxDistinctGenomes);
  });

  it('with crossover and mutation off, the actual count falls below the bound', () => {
    const copies = generateAgents({
      ...CONFIG,
      training: { ...TRAINING, populationSize: 3, crossover: { type: 'uniform', rate: 0 }, mutation: { rate: 0, scale: 0 } },
    }, 7202);
    expect(copies.A5.evaluations).toBe(9);
    expect(copies.A5.maxDistinctGenomes).toBe(7);
    expect(copies.A5.actualDistinctGenomes).toBeLessThanOrEqual(3);
  });
});

describe('A1 and A7', () => {
  it('derives action seeds from SHA-256, checked against Node\'s own SHA-256', () => {
    for (const [agent, seed, e] of [['A1', 7201, 0], ['A7', 7201, 2], ['A1', 0xffffffff, 9]] as const) {
      const hex = createHash('sha256').update(`p2-08|${agent}|${seed}|${e}`).digest('hex');
      expect(actionSeed(agent, seed, e)).toBe(Number.parseInt(hex.slice(0, 8), 16));
    }
    expect(actionSeed('A1', 7201, 0)).not.toBe(actionSeed('A7', 7201, 0));
  });

  it.each([['A2', 1, 0], ['A1', -1, 0], ['A1', 2 ** 32, 0], ['A1', 1, -1], ['A1', 1, 0.5]] as const)('rejects actionSeed(%s, %s, %s)', (agent, seed, e) => {
    expect(() => actionSeed(agent as 'A1', seed, e)).toThrow(RangeError);
  });

  it.each(['A1', 'A7'] as const)('%s runs E episodes per track with the same seeds on both, each replaying alone', (agent) => {
    for (const which of ['training', 'validation'] as const) {
      const episodes = RESULT[agent][which];
      expect(episodes).toHaveLength(E);
      episodes.forEach((ep, e) => {
        expect(ep.actionSeed).toBe(actionSeed(agent, SEED, e));
        const driver = agent === 'A1' ? createRandomDriver(ep.actionSeed) : createCorrelatedRandomDriver(ep.actionSeed, 30);
        sameEpisode(ep, evaluateDriver(driver, SETUPS[which]).episode);
      });
    }
    expect(RESULT.A7.holdTicks).toBe(30);
  });

  it('honours a recorded hold length', () => {
    const held = generateAgents({ ...CONFIG, holdTicks: 7 }, SEED);
    expect(held.A7.holdTicks).toBe(7);
    sameEpisode(held.A7.training[0]!, evaluateDriver(createCorrelatedRandomDriver(actionSeed('A7', SEED, 0), 7), SETUPS.training).episode);
  });
});

describe('validation evaluation (descriptive)', () => {
  it('evaluates each A2 network and the frozen A9, A8 and A5 models once on the validation track', () => {
    const trainer = createTrainer({ ...DEFAULT_TRAINING_CONFIG, ...TRAINING, seed: SEED }, env('stadium-oval'));
    const genomes = trainer.generation().cars.map((c) => c.genome);
    expect(RESULT.validation.A2).toHaveLength(P);
    genomes.forEach((genome, i) => sameEpisode(RESULT.validation.A2[i]!, network(genome, 'validation')));
    sameEpisode(RESULT.validation.A9, network(RESULT.baselines.A9.model.parameters, 'validation'));
    sameEpisode(RESULT.validation.A8, network(RESULT.baselines.A8.selected.model.parameters, 'validation'));
    sameEpisode(RESULT.A5.episodes.validation, network(RESULT.A5.model.parameters, 'validation'));
    expect(RESULT.tracks.validation.id).toBe('rounded-rectangle');
  });

  it('never changes a selection: A9, A8 and A5 are the same with any validation episodes', () => {
    // Selection reads training fitness only, so the selected indices equal those from training data alone.
    expect(RESULT.baselines.A9.index).toBe(selectBest(RESULT.baselines.A2.candidates.map((c) => c.training.fitness.total)));
    expect(RESULT.baselines.A8.selected.index).toBe(selectBest(RESULT.baselines.A8.samples.map((c) => c.training.fitness.total)));
    expect(RESULT.A5.index).toBe(selectBest(RESULT.A5.generations[G - 1]!.map((e) => e.fitness.total)));
  });
});

describe('ticks, determinism and immutability', () => {
  it('sums simulated ticks per agent and track', () => {
    const sum = (list: readonly EpisodeResult[]) => list.reduce((t, e) => t + e.ticks, 0);
    expect(RESULT.ticks.A1).toEqual({ training: sum(RESULT.A1.training), validation: sum(RESULT.A1.validation) });
    expect(RESULT.ticks.A2.validation).toBe(sum(RESULT.validation.A2));
    expect(RESULT.ticks.A5.training).toBe(sum(RESULT.A5.generations.flat()));
    expect(RESULT.ticks.A8.training).toBe(RESULT.baselines.budgets.ticks.A8);
  });

  it('is identical for the same config and seed, after other seeds, and differs for another seed', () => {
    const other = generateAgents(CONFIG, 7203);
    expect(canonicalJson(generateAgents(CONFIG, SEED))).toBe(canonicalJson(RESULT));
    expect(canonicalJson(other)).not.toBe(canonicalJson(RESULT));
  });

  it('returns frozen results and never writes the config', () => {
    const config = JSON.parse(JSON.stringify(CONFIG)) as AgentConfig;
    generateAgents(config, SEED);
    expect(config).toEqual(CONFIG);
    expect(Object.isFrozen(RESULT.A1.training)).toBe(true);
    expect(Object.isFrozen(RESULT.A5.generations[0])).toBe(true);
    expect(Object.isFrozen(RESULT.validation)).toBe(true);
  });
});

describe('invalid inputs and boundaries', () => {
  it.each([
    ['a non-object', null, /must be an object/],
    ['an unknown field', { ...CONFIG, seeds: [1] }, /Unknown agent config field "seeds"/],
    ['an unknown nested training field', { ...CONFIG, training: { mutation: { rate: 0.1, sclae: 1 } } }, /training\.mutation\.sclae/],
    ['zero episodes', { ...CONFIG, episodesPerTrack: 0 }, /episodesPerTrack/],
    ['too many episodes', { ...CONFIG, episodesPerTrack: 10_001 }, /episodesPerTrack/],
    ['a fractional hold', { ...CONFIG, holdTicks: 1.5 }, /holdTicks/],
    ['a zero hold', { ...CONFIG, holdTicks: 0 }, /holdTicks/],
    ['no elites', { ...CONFIG, training: { ...TRAINING, eliteCount: 0 } }, /eliteCount/],
    ['a non-string validation track', { ...CONFIG, validationTrackId: 1 }, /validationTrackId/],
  ])('rejects %s', (_label, config, message) => {
    expect(() => generateAgents(config as AgentConfig, SEED)).toThrow(message);
  });

  it.each([
    ['the held-out track as validation', { validationTrackId: 'hairpin-chicane' }],
    ['the training track as validation', { validationTrackId: 'stadium-oval' }],
    ['the held-out track for training', { trackId: 'hairpin-chicane' }],
    ['the validation track for training', { trackId: 'rounded-rectangle' }],
  ])('refuses %s', (_label, change) => {
    expect(() => generateAgents({ ...CONFIG, ...change }, SEED)).toThrow(TrackLeakageError);
  });

  it('never references held-out or validation-selection accessors, or unseeded randomness', () => {
    const code = readFileSync(join(__dirname, '../../src/training/agents.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const name of ['heldOutTrack', 'tracksIn', 'selectByValidation', 'Math\\.random', 'Date']) {
      expect(code).not.toMatch(new RegExp(`\\b${name}\\b`));
    }
  });
});
