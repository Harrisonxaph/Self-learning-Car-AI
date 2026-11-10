// The application-layer composition for training checkpoints (P3-07). `persistence/` may not import `training/` and
// `training/` stays headless and storage-free, so this layer connects them: it hands the trainer's own configuration
// validator to the checkpoint validator (one authoritative set of rules, in `training/`), converts a trainer's state to a
// checkpoint document and back, and decides whether a validated checkpoint can be resumed by this build.
import { SIMULATION_VERSION } from '../sim/config';
import {
  buildCheckpoint,
  checkpointGenomes,
  entryChampion,
  resumeProblems,
  type CheckpointDocument,
  type CurrentEnvironment,
  type ResolveConfig,
  type ValidateOptions,
} from '../persistence/checkpointFormat';
import { tracksIn } from '../training/trackSplits';
import { DEFAULT_RETAINED_GENERATIONS, resolveTrainingConfig, retainHistory, RNG_STREAMS, type HistoryEntry, type Trainer, type TrainerResume, type TrainerState, type TrainingSetup } from '../training/trainer';

/** The trainer's own validator, as the checkpoint validator's `resolveConfig`. It never throws. */
export const resolveConfigAdapter: ResolveConfig = (configuration, timestepSeconds) => {
  try {
    return { ok: true, config: resolveTrainingConfig(configuration, timestepSeconds).config };
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : 'The configuration is not valid.'] };
  }
};

/** What the page's validator needs: the registered training tracks and the trainer's configuration rules. */
export function checkpointValidateOptions(): ValidateOptions {
  return { registry: tracksIn('training'), resolveConfig: resolveConfigAdapter };
}

export interface CheckpointMeta {
  readonly id: string;
  readonly createdAt: string;
  readonly codeVersion: string;
  readonly appVersion?: string | undefined;
}

/** A checkpoint document from a trainer's state: the history is compacted by the retention rule (the last K and the best so far stay full). */
export function checkpointFromState(setup: TrainingSetup, state: TrainerState, meta: CheckpointMeta, keepLast: number = DEFAULT_RETAINED_GENERATIONS): CheckpointDocument {
  const history = retainHistory(state.history, keepLast).map((entry) => (entry.retained ? { ...entry.stats, retained: true as const } : entry));
  return buildCheckpoint({
    ...meta,
    simulationVersion: SIMULATION_VERSION,
    configuration: JSON.parse(JSON.stringify(setup.config)) as Record<string, unknown>,
    physics: { ...setup.environment.physics },
    timestepSeconds: setup.environment.timestepSeconds,
    sensors: setup.sensors,
    trackId: setup.versions.trackId,
    trackVersion: setup.versions.trackVersion,
    trackHash: setup.versions.trackHash,
    rngStreams: RNG_STREAMS,
    rngState: state.runState,
    generationIndex: state.generationIndex,
    genomes: state.genomes,
    history,
  });
}

export function checkpointFromTrainer(trainer: Trainer, meta: CheckpointMeta, keepLast?: number): CheckpointDocument {
  return checkpointFromState(trainer.setup, trainer.checkpointState(), meta, keepLast);
}

export function currentEnvironment(setup: TrainingSetup): CurrentEnvironment {
  return {
    simulationVersion: SIMULATION_VERSION,
    physics: { ...setup.environment.physics },
    timestepSeconds: setup.environment.timestepSeconds,
    sensors: setup.sensors,
    trackId: setup.versions.trackId,
    trackVersion: setup.versions.trackVersion,
    trackHash: setup.versions.trackHash,
    rngStreams: RNG_STREAMS,
  };
}

/** Key order and unknown fields do not matter: compared as sorted JSON. */
const canonical = (value: unknown): string => JSON.stringify(value, (_k, v: unknown) => (typeof v === 'object' && v !== null && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v));

export type ResumeResult = { readonly ok: true; readonly resume: TrainerResume; readonly configuration: unknown } | { readonly ok: false; readonly reasons: readonly string[] };

/**
 * Whether this build can resume a validated checkpoint, and the trainer state to resume from. The page can only train with
 * its own configuration, so a checkpoint made with other training settings is refused with a reason rather than run.
 */
export function resumeFromCheckpoint(doc: CheckpointDocument, setup: TrainingSetup): ResumeResult {
  const reasons = resumeProblems(doc, currentEnvironment(setup));
  const resolved = resolveConfigAdapter(doc.training.configuration, doc.training.environment.timestepSeconds);
  if (!resolved.ok) reasons.push(...resolved.errors);
  else if (canonical(resolved.config) !== canonical(setup.config)) reasons.push('It was made with different training settings from this page.');
  if (reasons.length > 0) return { ok: false, reasons };
  const history: HistoryEntry[] = doc.history.map((entry) =>
    entry.retained
      ? {
          retained: true as const,
          stats: Object.freeze({
            generation: entry.generation,
            fitness: Object.freeze([...entry.fitness]),
            bestFitness: entry.bestFitness,
            meanFitness: entry.meanFitness,
            worstFitness: entry.worstFitness,
            championIndex: entry.championIndex,
            champion: entryChampion(entry),
            outcomes: Object.freeze({ ...entry.outcomes }),
            carsWithLap: entry.carsWithLap,
            maxGatesPassed: entry.maxGatesPassed,
            generationTicks: entry.generationTicks,
            totalEpisodeTicks: entry.totalEpisodeTicks,
          }),
        }
      : Object.freeze({ ...entry, outcomes: Object.freeze({ ...entry.outcomes }) }),
  );
  return {
    ok: true,
    configuration: setup.config,
    resume: { generationIndex: doc.generationIndex, genomes: checkpointGenomes(doc), runState: { algorithm: doc.training.rng.algorithm as TrainerState['runState']['algorithm'], words: doc.training.rng.words }, history },
  };
}
