// P2-08 step 3 B2 (docs/experiments/p2-08-step3-design.md §2.5): the remaining agents for one training seed, on top
// of B1's baselines. A5's full evolutionary run and frozen champion; A1/A7 random-driving episodes from SHA-256
// action seeds; and a descriptive evaluation of A2, A9, A8 and A5 on the validation track. Tooling only: no record,
// manifest, study run or analysis, and no held-out track.
//
// This is the one step 3 module allowed to call validationTrack. Validation results are reported only: nothing here
// selects on them. Every episode runs through the shared per-tick path: training cars in the trainer, everything
// else through evaluateDriver.
import { createNetworkDriver } from '../ai/drivers';
import { CORRELATED_HOLD_TICKS, createCorrelatedRandomDriver, createRandomDriver } from '../ai/randomDrivers';
import { sha256Hex } from '../utils/sha256';
import {
  baselinesFromGeneration0,
  episodeResult,
  genomeId,
  resolveBaselineConfig,
  selectBest,
  type BaselineConfig,
  type Baselines,
  type EpisodeResult,
} from './baselines';
import { createEvaluationSetup, evaluateDriver, type EvaluationSetup } from './evaluation';
import { freezeModel, validationTrack, type FrozenModel } from './trackSplits';
import { createTrainer } from './trainer';

/** A1/A7 action seeds: the first 32 bits (big-endian) of sha256("p2-08|<agent>|<seed>|<episode>"). */
export const ACTION_SEED_DERIVATION = 'p2-08-sha256-first-32-bits-v1';
/** A5's champion: the final generation's best by training fitness, earliest wins ties. */
export const A5_SELECTION = 'best-training-fitness-final-generation';
/** The largest E accepted. */
export const MAX_EPISODES_PER_TRACK = 10_000;

export interface AgentConfig extends BaselineConfig {
  /** A built-in validation track, evaluated descriptively only. */
  readonly validationTrackId: string;
  /** E: A1/A7 episodes per training seed per track. */
  readonly episodesPerTrack: number;
  /** A7's hold in ticks; 30 (0.5 s) when left out. */
  readonly holdTicks?: number;
}

export interface PerTrack<T> {
  readonly training: T;
  readonly validation: T;
}

export interface RandomEpisode extends EpisodeResult {
  readonly actionSeed: number;
}

export interface Agents {
  readonly seed: number;
  readonly tracks: PerTrack<{ readonly id: string; readonly contentHash: string }>;
  /** B1's A2, A9 and A8, unchanged. */
  readonly baselines: Baselines;
  readonly A5: {
    /** Every car of every generation, in population order: generations[g][i]. */
    readonly generations: readonly (readonly EpisodeResult[])[];
    readonly genomeIds: readonly (readonly string[])[];
    readonly generation: number;
    readonly index: number;
    readonly selection: typeof A5_SELECTION;
    readonly model: FrozenModel;
    readonly episodes: PerTrack<EpisodeResult>;
    readonly evaluations: number;
    readonly maxDistinctGenomes: number;
    readonly actualDistinctGenomes: number;
  };
  readonly A1: PerTrack<readonly RandomEpisode[]>;
  readonly A7: PerTrack<readonly RandomEpisode[]> & { readonly holdTicks: number };
  /** Descriptive validation episodes: A2's P networks, and the frozen A9 and A8 models. */
  readonly validation: { readonly A2: readonly EpisodeResult[]; readonly A9: EpisodeResult; readonly A8: EpisodeResult };
  readonly ticks: Readonly<Record<'A1' | 'A7' | 'A2' | 'A9' | 'A8' | 'A5', PerTrack<number>>>;
}

/** A1/A7's action seed for training seed `seed` and episode `episode` (ACTION_SEED_DERIVATION). */
export function actionSeed(agent: 'A1' | 'A7', seed: number, episode: number): number {
  if (agent !== 'A1' && agent !== 'A7') throw new RangeError(`Action seeds are for A1 and A7, got ${String(agent)}.`);
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError(`Seed must be an integer from 0 to 4294967295, got ${String(seed)}.`);
  }
  if (typeof episode !== 'number' || !Number.isSafeInteger(episode) || episode < 0) {
    throw new RangeError(`Episode must be a non-negative integer, got ${String(episode)}.`);
  }
  return Number.parseInt(sha256Hex(`p2-08|${agent}|${seed}|${episode}`).slice(0, 8), 16);
}

const AGENT_KEYS = ['validationTrackId', 'episodesPerTrack', 'holdTicks'];

/**
 * Checks the B2 fields and returns the B1 config, the validation track's evaluation setup, E and the hold. Throws
 * RangeError for an unknown field, E outside 1 to 10,000, a hold that is not an integer of at least 1, eliteCount
 * below 1 or anything B1 rejects; TrackLeakageError for a validation track that is not one.
 */
function resolveAgentConfig(input: unknown, seed: number) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new RangeError('Agent config must be an object.');
  const { validationTrackId, episodesPerTrack, holdTicks = CORRELATED_HOLD_TICKS, ...rest } = input as Record<string, unknown>;
  for (const key of Object.keys(rest)) {
    if (!['training', 'generations', 'trackId'].includes(key)) throw new RangeError(`Unknown agent config field "${key}"; B2 adds ${AGENT_KEYS.join(', ')}.`);
  }
  if (typeof episodesPerTrack !== 'number' || !Number.isInteger(episodesPerTrack) || episodesPerTrack < 1 || episodesPerTrack > MAX_EPISODES_PER_TRACK) {
    throw new RangeError(`Agent config "episodesPerTrack" must be an integer from 1 to ${MAX_EPISODES_PER_TRACK}, got ${String(episodesPerTrack)}.`);
  }
  if (typeof holdTicks !== 'number' || !Number.isSafeInteger(holdTicks) || holdTicks < 1) {
    throw new RangeError(`Agent config "holdTicks" must be an integer of at least 1, got ${String(holdTicks)}.`);
  }
  if (typeof validationTrackId !== 'string') throw new RangeError('Agent config "validationTrackId" must be a string.');
  const { setup, environment, generations } = resolveBaselineConfig(rest as unknown as BaselineConfig, seed);
  if (setup.config.eliteCount < 1) throw new RangeError('P2-08 needs eliteCount of at least 1, so A5\'s final champion is its best ever.');
  const { maxEpisodeSeconds, stallSeconds, maxLaps, fitness } = setup.config;
  const limits = { maxEpisodeSeconds, stallSeconds, maxLaps, fitness };
  const { physics, timestepSeconds } = environment;
  const evaluation: PerTrack<EvaluationSetup> = {
    training: createEvaluationSetup(limits, environment),
    validation: createEvaluationSetup(limits, { track: validationTrack(validationTrackId), physics, timestepSeconds }),
  };
  return { resolved: { setup, environment, generations }, setup, environment, generations, evaluation, episodesPerTrack, holdTicks };
}

const sumTicks = (episodes: readonly EpisodeResult[]): number => episodes.reduce((total, e) => total + e.ticks, 0);

function evaluateNetwork(parameters: ArrayLike<number>, brakeEnabled: boolean, setup: EvaluationSetup): EpisodeResult {
  const { episode } = evaluateDriver(createNetworkDriver(parameters, { brakeEnabled }), setup);
  return episodeResult(episode, setup.config.fitness, setup.rules, setup.environment.track.gates.length);
}

function randomEpisodes(agent: 'A1' | 'A7', seed: number, count: number, holdTicks: number, setup: EvaluationSetup): RandomEpisode[] {
  return Array.from({ length: count }, (_, e) => {
    const s = actionSeed(agent, seed, e);
    const driver = agent === 'A1' ? createRandomDriver(s) : createCorrelatedRandomDriver(s, holdTicks);
    const { episode } = evaluateDriver(driver, setup);
    return Object.freeze({ ...episodeResult(episode, setup.config.fitness, setup.rules, setup.environment.track.gates.length), actionSeed: s });
  });
}

/**
 * Generates every P2-08 agent for one training seed: B1's A2, A9 and A8, plus A5, A1 and A7, and the descriptive
 * validation episodes. Deterministic for a given config and seed. Throws as resolveAgentConfig does.
 */
export function generateAgents(config: AgentConfig, seed: number): Agents {
  const { resolved, setup, environment, generations: G, evaluation, episodesPerTrack: E, holdTicks } = resolveAgentConfig(config, seed);
  const gates = environment.track.gates.length;
  const brakeEnabled = setup.config.brakeEnabled;
  const tracks = {
    training: Object.freeze({ id: evaluation.training.versions.trackId, contentHash: evaluation.training.versions.trackHash }),
    validation: Object.freeze({ id: evaluation.validation.versions.trackId, contentHash: evaluation.validation.versions.trackHash }),
  };

  // A5: the full evolutionary run, every car of every generation kept. Its generation 0 is evaluated once and is
  // also A2: the baselines (A2, A9, A8) are built from it rather than from a second generation-0 run.
  const trainer = createTrainer({ ...setup.config }, environment);
  let baselines: Baselines | null = null;
  const generations: EpisodeResult[][] = [];
  const genomeIds: string[][] = [];
  let generation0: Float64Array[] = [];
  let finalChampion: Float64Array | null = null;
  let finalChampionIndex = -1;
  for (let g = 0; g < G; g += 1) {
    const stats = trainer.runGeneration();
    const cars = trainer.finished()!.cars;
    if (g === 0) {
      generation0 = cars.map((car) => Float64Array.from(car.genome));
      baselines = baselinesFromGeneration0(resolved, seed, trainer.finished()!);
    }
    generations.push(cars.map((car) => episodeResult(car.episode, setup.config.fitness, setup.rules, gates)));
    genomeIds.push(cars.map((car) => genomeId(car.genome)));
    finalChampion = stats.champion;
    finalChampionIndex = stats.championIndex;
  }
  const final = generations[G - 1]!;
  const index = selectBest(final.map((e) => e.fitness.total));
  if (index !== finalChampionIndex) throw new Error(`A5 champion mismatch: selection rule ${index}, trainer ${finalChampionIndex}.`);
  const model = freezeModel(finalChampion!, {
    agent: 'A5', seed, generation: G - 1, index, selection: A5_SELECTION, trackId: tracks.training.id, trackContentHash: tracks.training.contentHash,
  });
  const a5Validation = evaluateNetwork(model.parameters, brakeEnabled, evaluation.validation);
  const actualDistinctGenomes = new Set(genomeIds.flat()).size;
  const base = baselines!;

  // Descriptive validation episodes for A2, A9 and A8 (never used to select).
  const a2Validation = generation0.map((genome) => evaluateNetwork(genome, brakeEnabled, evaluation.validation));
  const a9Validation = evaluateNetwork(base.A9.model.parameters, brakeEnabled, evaluation.validation);
  const a8Validation = evaluateNetwork(base.A8.selected.model.parameters, brakeEnabled, evaluation.validation);

  // A1 and A7: E episodes per track, the same action seeds on both tracks.
  const A1 = { training: randomEpisodes('A1', seed, E, holdTicks, evaluation.training), validation: randomEpisodes('A1', seed, E, holdTicks, evaluation.validation) };
  const A7 = { training: randomEpisodes('A7', seed, E, holdTicks, evaluation.training), validation: randomEpisodes('A7', seed, E, holdTicks, evaluation.validation) };

  const a2Training = base.A2.candidates.map((c) => c.training);
  const a9Training = base.A2.candidates[base.A9.index]!.training;
  return Object.freeze({
    seed,
    tracks: Object.freeze(tracks),
    baselines: base,
    A5: Object.freeze({
      generations: Object.freeze(generations.map((g) => Object.freeze(g))),
      genomeIds: Object.freeze(genomeIds.map((g) => Object.freeze(g))),
      generation: G - 1,
      index,
      selection: A5_SELECTION,
      model,
      episodes: Object.freeze({ training: final[index]!, validation: a5Validation }),
      evaluations: base.budgets.evolution.evaluations,
      maxDistinctGenomes: base.budgets.evolution.maxDistinctGenomes,
      actualDistinctGenomes,
    }),
    A1: Object.freeze({ training: Object.freeze(A1.training), validation: Object.freeze(A1.validation) }),
    A7: Object.freeze({ training: Object.freeze(A7.training), validation: Object.freeze(A7.validation), holdTicks }),
    validation: Object.freeze({ A2: Object.freeze(a2Validation), A9: a9Validation, A8: a8Validation }),
    ticks: Object.freeze({
      A1: Object.freeze({ training: sumTicks(A1.training), validation: sumTicks(A1.validation) }),
      A7: Object.freeze({ training: sumTicks(A7.training), validation: sumTicks(A7.validation) }),
      A2: Object.freeze({ training: sumTicks(a2Training), validation: sumTicks(a2Validation) }),
      A9: Object.freeze({ training: a9Training.ticks, validation: a9Validation.ticks }),
      A8: Object.freeze({ training: base.budgets.ticks.A8, validation: a8Validation.ticks }),
      A5: Object.freeze({ training: generations.reduce((t, g) => t + sumTicks(g), 0), validation: a5Validation.ticks }),
    }),
  });
}
