// P2-08 baseline generation and selection for one training seed (docs/experiments/p2-08-baselines-design.md):
// A2, the evolutionary run's own generation 0; A9, its best model by training fitness; and A8, P × G random networks
// drawn by continuing the same initialisation stream. Every candidate is scored on the training track through the
// shared episode path, and the selected models are copied and frozen. Tooling only: nothing here runs a study,
// evaluates validation or held-out tracks, or writes records.
//
// RNG ownership: the training seed belongs to the trainer. trainerStreams(seed) is the only derivation of its
// streams; A2 is the trainer's own generation 0, and A8 draws from a fresh copy of the same `initial` stream, so its
// first P genomes are A2's and the two never share a generator object. Episodes draw nothing.
import { initialParameters, PARAMETER_COUNT } from '../ai/network';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../sim/config';
import { sha256Hex } from '../utils/sha256';
import { scoreEpisode, type Episode, type EpisodeOutcome, type EpisodeRules, type FitnessConfig } from './fitness';
import { freezeModel, trainingTrack, type FrozenModel } from './trackSplits';
import {
  createTrainer,
  createTrainingSetup,
  DEFAULT_TRAINING_CONFIG,
  evaluateGenome,
  trainerStreams,
  type TrainingConfig,
  type TrainingEnvironment,
  type TrainingSetup,
} from './trainer';

/** A8's stream: the trainer's `initial` stream for the seed, restarted and continued for P × G genomes in order. */
export const A8_STREAM = 'p2-08-a8-continue-initial-v1';
/** The selection rule for A9 and A8 (and, later, A5): highest training fitness, earliest evaluated wins ties. */
export const SELECTION_RULE = 'highest-training-fitness-earliest-v1';
/** The largest G accepted, as for P2-07 experiments. */
export const MAX_BASELINE_GENERATIONS = 10_000;

export type TrainingSettings = Omit<TrainingConfig, 'seed'>;

/** What generateBaselines needs besides the seed. */
export interface BaselineConfig {
  /** Training settings over DEFAULT_TRAINING_CONFIG; a field that is set replaces the default whole. */
  readonly training?: Partial<TrainingSettings>;
  /** G: the evolutionary run's generations, which fixes the budget P × G. */
  readonly generations: number;
  /** A built-in training track. */
  readonly trackId: string;
}

/** One training-track episode, raw. */
export interface EpisodeResult {
  readonly outcome: EpisodeOutcome;
  readonly ticks: number;
  readonly gatesPassed: number;
  readonly lapTicks: readonly number[];
  readonly crashed: boolean;
  readonly partialProgress: number;
  readonly fitness: {
    readonly checkpoints: number;
    readonly partialProgress: number;
    readonly laps: number;
    readonly lapTimeBonus: number;
    readonly collisionPenalty: number;
    readonly total: number;
  };
  /** gatesPassed ÷ gates per lap. */
  readonly orderedProgress: number;
}

/** A scored candidate: its index (population index or sample number), genome identity and training episode. */
export interface Candidate {
  readonly index: number;
  /** `sha256:` + SHA-256 of the JSON array of its parameters, in parameter order. */
  readonly genomeId: string;
  readonly training: EpisodeResult;
}

/** A selected model: which candidate, and an independent frozen copy of its parameters with provenance. */
export interface Selection {
  readonly index: number;
  readonly model: FrozenModel;
}

export interface Baselines {
  readonly seed: number;
  readonly selectionRule: typeof SELECTION_RULE;
  /** The resolved training settings (seed excluded) and G. */
  readonly training: TrainingSettings;
  readonly generations: number;
  readonly track: { readonly id: string; readonly contentHash: string };
  /** A2: generation 0 of the evolutionary run, in population order. */
  readonly A2: { readonly generation: 0; readonly candidates: readonly Candidate[] };
  /** A9: the best of A2. Its episode is A2's; nothing is re-run. */
  readonly A9: Selection;
  /** A8: P × G samples in draw order, and the best of them. */
  readonly A8: { readonly stream: typeof A8_STREAM; readonly samples: readonly Candidate[]; readonly selected: Selection };
  readonly budgets: {
    /** The evolutionary run's P × G evaluations, elites included. */
    readonly evolution: { readonly evaluations: number; readonly eliteReevaluations: number; readonly maxDistinctGenomes: number };
    readonly a2Evaluations: number;
    readonly a8Evaluations: number;
    /** Simulated car-ticks, summed over episodes; recorded, not equalised. */
    readonly ticks: { readonly A2: number; readonly A8: number };
  };
}

/** SELECTION_RULE: the index of the highest fitness, earliest wins ties. Throws RangeError for none or non-finite. */
export function selectBest(fitness: readonly number[]): number {
  if (!Array.isArray(fitness) || fitness.length === 0) throw new RangeError('Selection needs at least one fitness value.');
  let best = 0;
  for (let i = 0; i < fitness.length; i += 1) {
    const value = fitness[i];
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new RangeError(`Fitness ${i} must be finite, got ${String(value)}.`);
    if (value > fitness[best]!) best = i;
  }
  return best;
}

/** A genome's identity: `sha256:` + SHA-256 of the JSON array of its parameters. */
export function genomeId(parameters: ArrayLike<number>): string {
  return `sha256:${sha256Hex(JSON.stringify(Array.from(parameters)))}`;
}

/** The raw result of a finished episode. */
export function episodeResult(episode: Episode, fitness: FitnessConfig, rules: EpisodeRules, gates: number): EpisodeResult {
  if (episode.outcome === null) throw new RangeError('Only a finished episode has a result.');
  const b = scoreEpisode(episode, fitness, rules);
  return Object.freeze({
    outcome: episode.outcome,
    ticks: episode.tick,
    gatesPassed: episode.gatesPassed,
    lapTicks: Object.freeze([...episode.lapTicks]),
    crashed: episode.crashed,
    partialProgress: episode.partialProgress,
    fitness: Object.freeze({
      checkpoints: b.checkpoints,
      partialProgress: b.partialProgress,
      laps: b.laps,
      lapTimeBonus: b.lapTimeBonus,
      collisionPenalty: b.collisionPenalty,
      total: b.total,
    }),
    orderedProgress: episode.gatesPassed / gates,
  });
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const TRAINING_KEYS: readonly string[] = Object.keys(DEFAULT_TRAINING_CONFIG).filter((key) => key !== 'seed');
const NESTED_KEYS: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  Object.entries(DEFAULT_TRAINING_CONFIG)
    .filter(([, value]) => isPlainObject(value))
    .map(([key, value]) => [key, Object.keys(value as object)]),
);
const CONFIG_KEYS = ['training', 'generations', 'trackId'];

/**
 * Checks a baseline configuration and seed and returns the trainer setup they describe. Throws RangeError naming the
 * path for an unknown field (top level, `training`, or inside `selection`, `crossover`, `mutation`, `fitness`), for
 * generations that are not an integer from 1 to 10,000, and for anything the trainer's resolvers reject; throws
 * TrackLeakageError for a validation or held-out track.
 */
export function resolveBaselineConfig(input: unknown, seed: number): { setup: TrainingSetup; environment: TrainingEnvironment; generations: number } {
  if (!isPlainObject(input)) throw new RangeError('Baseline config must be an object.');
  for (const key of Object.keys(input)) if (!CONFIG_KEYS.includes(key)) throw new RangeError(`Unknown baseline config field "${key}".`);
  const { generations, trackId } = input;
  const training = input.training ?? {};
  if (!isPlainObject(training)) throw new RangeError('Baseline config "training" must be an object.');
  for (const [key, block] of Object.entries(training)) {
    if (!TRAINING_KEYS.includes(key)) throw new RangeError(`Unknown baseline config field "training.${key}".`);
    const nested = NESTED_KEYS[key];
    if (nested && isPlainObject(block)) {
      for (const field of Object.keys(block)) {
        if (!nested.includes(field)) throw new RangeError(`Unknown baseline config field "training.${key}.${field}"; "${key}" takes ${nested.join(', ')}.`);
      }
    }
  }
  if (typeof generations !== 'number' || !Number.isInteger(generations) || generations < 1 || generations > MAX_BASELINE_GENERATIONS) {
    throw new RangeError(`Baseline config "generations" must be an integer from 1 to ${MAX_BASELINE_GENERATIONS}, got ${String(generations)}.`);
  }
  if (typeof trackId !== 'string') throw new RangeError('Baseline config "trackId" must be a string.');
  const environment: TrainingEnvironment = {
    track: trainingTrack(trackId),
    physics: DEFAULT_VEHICLE_PHYSICS,
    timestepSeconds: DEFAULT_SIM_CONFIG.timestepSeconds,
  };
  const setup = createTrainingSetup({ ...DEFAULT_TRAINING_CONFIG, ...training, seed }, environment);
  return { setup, environment, generations };
}

const sumTicks = (candidates: readonly Candidate[]): number => candidates.reduce((total, c) => total + c.training.ticks, 0);

/**
 * Generates A2, A9 and A8 for one training seed. Deterministic: the same config and seed always give the same
 * result, alone or next to other seeds, and the config is never written. Throws as resolveBaselineConfig does.
 */
export function generateBaselines(config: BaselineConfig, seed: number): Baselines {
  const { setup, environment, generations: G } = resolveBaselineConfig(config, seed);
  const P = setup.config.populationSize;
  const gates = environment.track.gates.length;
  const result = (episode: Episode) => episodeResult(episode, setup.config.fitness, setup.rules, gates);
  const track = { id: setup.versions.trackId, contentHash: setup.versions.trackHash };

  // A2: the evolutionary run's own generation 0, evaluated by the trainer itself.
  const trainer = createTrainer({ ...setup.config }, environment);
  trainer.runGeneration();
  const generation0 = trainer.finished()!.cars;
  const a2: Candidate[] = generation0.map((car, index) => Object.freeze({ index, genomeId: genomeId(car.genome), training: result(car.episode) }));

  // A9: the best of generation 0, copied and frozen.
  const a9Index = selectBest(a2.map((c) => c.training.fitness.total));
  const a9 = Object.freeze({
    index: a9Index,
    model: freezeModel(generation0[a9Index]!.genome, {
      agent: 'A9', seed, generation: 0, index: a9Index, selection: SELECTION_RULE, trackId: track.id, trackContentHash: track.contentHash,
    }),
  });

  // A8: a fresh copy of the trainer's initial stream, continued for P × G genomes, each evaluated once.
  const { initial } = trainerStreams(seed);
  const samples: Candidate[] = [];
  let bestIndex = 0;
  let bestGenome: Float64Array | null = null;
  for (let i = 0; i < P * G; i += 1) {
    const genome = initialParameters(initial);
    if (genome.length !== PARAMETER_COUNT) throw new RangeError('A8 genomes do not match the network.');
    const candidate = Object.freeze({ index: i, genomeId: genomeId(genome), training: result(evaluateGenome(genome, setup).episode) });
    samples.push(candidate);
    // Strictly greater: the earliest sample wins ties (SELECTION_RULE).
    if (bestGenome === null || candidate.training.fitness.total > samples[bestIndex]!.training.fitness.total) {
      bestIndex = i;
      bestGenome = genome;
    }
  }
  const a8Selected = Object.freeze({
    index: bestIndex,
    model: freezeModel(bestGenome!, {
      agent: 'A8', seed, index: bestIndex, stream: A8_STREAM, selection: SELECTION_RULE, trackId: track.id, trackContentHash: track.contentHash,
    }),
  });

  const training = Object.freeze(Object.fromEntries(Object.entries(setup.config).filter(([key]) => key !== 'seed'))) as TrainingSettings;
  const eliteReevaluations = setup.config.eliteCount * (G - 1);
  return Object.freeze({
    seed,
    selectionRule: SELECTION_RULE,
    training,
    generations: G,
    track: Object.freeze(track),
    A2: Object.freeze({ generation: 0 as const, candidates: Object.freeze(a2) }),
    A9: a9,
    A8: Object.freeze({ stream: A8_STREAM, samples: Object.freeze(samples), selected: a8Selected }),
    budgets: Object.freeze({
      evolution: Object.freeze({ evaluations: P * G, eliteReevaluations, maxDistinctGenomes: P * G - eliteReevaluations }),
      a2Evaluations: a2.length,
      a8Evaluations: samples.length,
      ticks: Object.freeze({ A2: sumTicks(a2), A8: sumTicks(samples) }),
    }),
  });
}
