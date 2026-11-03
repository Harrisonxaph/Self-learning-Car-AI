// P2-09 E4 agents (docs/experiments/p2-09-plan.md §3 and §5): A4 (evolved with the brake output masked) and A5 (evolved
// with it on) for one training seed. Tooling only: this module runs one seed's two evolutionary runs when asked and
// never a study. Nothing here is a manifest, record or analysis, and no held-out track is evaluated.
//
// What is shared and what differs: the training configuration, the physics, the fitness and the training seed are the
// same for both agents, so for one seed both start from the identical generation-0 population (the trainer's
// initial stream depends only on the seed). Only the brake mask differs: A4 is always `false` and A5 always `true`.
// The setting is fixed here, per agent, and is not a free parameter. It enters each frozen model's identity through
// `provenance.brakeEnabled` (plan §3, option A), and each model is driven with exactly that value (frozenModelBrake.ts).
// A4 is never an ablation of a trained A5.
import type { EpisodeDriver } from '../ai/drivers';
import { createEvaluationSetup, evaluateDriver, type EvaluationSetup } from './evaluation';
import { A5_SELECTION, type PerTrack } from './agents';
import { episodeResult, genomeId, resolveBaselineConfig, selectBest, type EpisodeResult, type TrainingSettings } from './baselines';
import { createFrozenModelDriver } from './frozenModelBrake';
import { freezeModel, validationTrack, type FrozenModel } from './trackSplits';
import { createTrainer } from './trainer';

export const E4_AGENTS = Object.freeze(['A4', 'A5'] as const);
export type E4Agent = (typeof E4_AGENTS)[number];
/** The brake mask each agent is evolved and evaluated with. Fixed by the study kind (plan §3); never a free parameter. */
export const E4_BRAKE: Readonly<Record<E4Agent, boolean>> = Object.freeze({ A4: false, A5: true });
/** A champion's final generation's best by training fitness, earliest wins ties: P2-08's A5 rule, for both agents. */
export const E4_SELECTION = A5_SELECTION;
/** The brake command above which a tick counts as braking in the brake-usage measure (plan §5). */
export const BRAKE_USAGE_THRESHOLD = 0.05;

/** The shared training configuration: every training setting except the seed and the per-agent brake mask. */
export type E4TrainingSettings = Omit<TrainingSettings, 'brakeEnabled'>;

export interface E4AgentConfig {
  readonly training: E4TrainingSettings;
  readonly generations: number;
  /** A built-in training track. */
  readonly trackId: string;
  /** A built-in validation track, evaluated descriptively only. */
  readonly validationTrackId: string;
}

/** Ticks a champion drove, and how many of them it braked in (brake command above BRAKE_USAGE_THRESHOLD). */
export interface BrakeUsage {
  readonly ticks: number;
  readonly brakeTicks: number;
}

export interface E4AgentResult {
  readonly agent: E4Agent;
  readonly seed: number;
  readonly brakeEnabled: boolean;
  /** Every car of every generation, in population order: generations[g][i]. */
  readonly generations: readonly (readonly EpisodeResult[])[];
  readonly genomeIds: readonly (readonly string[])[];
  readonly generation: number;
  readonly index: number;
  readonly selection: typeof E4_SELECTION;
  readonly model: FrozenModel;
  /** The champion's training episode (its own, from the final generation) and its descriptive validation episode. */
  readonly episodes: PerTrack<EpisodeResult>;
  /** The frozen champion's brake usage on each track, counted while it is driven by createFrozenModelDriver. */
  readonly brakeUsage: PerTrack<BrakeUsage>;
  readonly evaluations: number;
  readonly maxDistinctGenomes: number;
  readonly actualDistinctGenomes: number;
  readonly ticks: PerTrack<number>;
}

/** The evaluation setups for an agent configuration: the training track as the trainer ran it, and the validation track. */
export function e4Evaluation(config: E4AgentConfig, seed: number, brakeEnabled: boolean) {
  const { setup, environment, generations } = resolveBaselineConfig(
    { training: { ...config.training, brakeEnabled }, generations: config.generations, trackId: config.trackId },
    seed,
  );
  if (setup.config.eliteCount < 1) throw new RangeError('E4 needs eliteCount of at least 1, so a champion is the run\'s best ever.');
  const { maxEpisodeSeconds, stallSeconds, maxLaps, fitness } = setup.config;
  const limits = { maxEpisodeSeconds, stallSeconds, maxLaps, fitness };
  const { physics, timestepSeconds } = environment;
  const evaluation: PerTrack<EvaluationSetup> = {
    training: createEvaluationSetup(limits, environment),
    validation: createEvaluationSetup(limits, { track: validationTrack(config.validationTrackId), physics, timestepSeconds }),
  };
  return { setup, environment, generations, evaluation };
}

/**
 * Wraps a driver so the controls it gives are counted: every tick, and every tick whose brake command is above
 * BRAKE_USAGE_THRESHOLD. The counts restart with the driver's reset (the harness resets before each episode), and the
 * wrapper changes no control.
 */
export function withBrakeCount(driver: EpisodeDriver): { readonly driver: EpisodeDriver; counts(): BrakeUsage } {
  let ticks = 0;
  let brakeTicks = 0;
  return {
    driver: {
      decide(observation) {
        const controls = driver.decide(observation);
        ticks += 1;
        if (controls.brake > BRAKE_USAGE_THRESHOLD) brakeTicks += 1;
        return controls;
      },
      reset() {
        ticks = 0;
        brakeTicks = 0;
        driver.reset();
      },
    },
    counts: () => ({ ticks, brakeTicks }),
  };
}

/** One frozen model on one track: its complete episode result and its brake usage. */
export function evaluateE4Model(model: FrozenModel, setup: EvaluationSetup): { readonly episode: EpisodeResult; readonly brakeUsage: BrakeUsage } {
  const counted = withBrakeCount(createFrozenModelDriver(model));
  const { episode } = evaluateDriver(counted.driver, setup);
  return { episode: episodeResult(episode, setup.config.fitness, setup.rules, setup.environment.track.gates.length), brakeUsage: counted.counts() };
}

const sumTicks = (episodes: readonly EpisodeResult[]): number => episodes.reduce((total, e) => total + e.ticks, 0);

/**
 * Runs one agent's whole evolutionary run for one training seed and freezes its champion. Deterministic for a given
 * config, agent and seed, alone or next to other seeds. Throws RangeError for a config the trainer rejects or an
 * eliteCount below 1, and TrackLeakageError for a track outside its split.
 */
export function generateE4Agent(config: E4AgentConfig, agent: E4Agent, seed: number): E4AgentResult {
  if (!E4_AGENTS.includes(agent)) throw new RangeError(`E4 agents are ${E4_AGENTS.join(' and ')}, got ${String(agent)}.`);
  const brakeEnabled = E4_BRAKE[agent];
  const { setup, environment, generations: G, evaluation } = e4Evaluation(config, seed, brakeEnabled);
  const gates = environment.track.gates.length;
  const track = Object.freeze({ id: evaluation.training.versions.trackId, contentHash: evaluation.training.versions.trackHash });

  const trainer = createTrainer({ ...setup.config }, environment);
  const generations: EpisodeResult[][] = [];
  const genomeIds: string[][] = [];
  let finalChampion: Float64Array | null = null;
  let finalChampionIndex = -1;
  for (let g = 0; g < G; g += 1) {
    const stats = trainer.runGeneration();
    const cars = trainer.finished()!.cars;
    generations.push(cars.map((car) => episodeResult(car.episode, setup.config.fitness, setup.rules, gates)));
    genomeIds.push(cars.map((car) => genomeId(car.genome)));
    finalChampion = stats.champion;
    finalChampionIndex = stats.championIndex;
  }
  const final = generations[G - 1]!;
  const index = selectBest(final.map((e) => e.fitness.total));
  if (index !== finalChampionIndex) throw new Error(`${agent} champion mismatch: selection rule ${index}, trainer ${finalChampionIndex}.`);
  const model = freezeModel(finalChampion!, {
    agent, seed, generation: G - 1, index, selection: E4_SELECTION, trackId: track.id, trackContentHash: track.contentHash, brakeEnabled,
  });
  const onTraining = evaluateE4Model(model, evaluation.training);
  const onValidation = evaluateE4Model(model, evaluation.validation);
  // The frozen model, driven alone, must reproduce the car it was frozen from (the same check P2-08's replay makes).
  if (JSON.stringify(onTraining.episode) !== JSON.stringify(final[index])) {
    throw new Error(`${agent} seed ${seed}: the frozen champion did not reproduce its own training episode.`);
  }
  const actualDistinctGenomes = new Set(genomeIds.flat()).size;
  const eliteReevaluations = setup.config.eliteCount * (G - 1);
  return Object.freeze({
    agent,
    seed,
    brakeEnabled,
    generations: Object.freeze(generations.map((gen) => Object.freeze(gen))),
    genomeIds: Object.freeze(genomeIds.map((gen) => Object.freeze(gen))),
    generation: G - 1,
    index,
    selection: E4_SELECTION,
    model,
    episodes: Object.freeze({ training: final[index]!, validation: onValidation.episode }),
    brakeUsage: Object.freeze({ training: onTraining.brakeUsage, validation: onValidation.brakeUsage }),
    evaluations: setup.config.populationSize * G,
    maxDistinctGenomes: setup.config.populationSize * G - eliteReevaluations,
    actualDistinctGenomes,
    ticks: Object.freeze({ training: generations.reduce((t, gen) => t + sumTicks(gen), 0), validation: onValidation.episode.ticks }),
  });
}
