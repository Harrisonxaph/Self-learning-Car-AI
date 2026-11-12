// Evaluating a saved model on built-in circuits it was not trained on (P4-05, docs/plans/p4-05-plan.md). Pure and headless:
// no storage, no DOM. It lives in src/ui, beside savedReplay.ts, because it joins the persistence layer (the model document) to the
// training layer (the episode path), and src/training must not import src/persistence.
// One fixed protocol, `p4-05-evaluation-v1`, in one engine; deterministic for a model, a circuit and the protocol.
//
// WHICH CIRCUITS: this module takes circuit IDs, never a Track, and resolves each through trainingTrack or validationTrack
// only. A held-out circuit (or a renamed copy, or any unregistered ID) is therefore refused with TrackLeakageError BEFORE any
// episode runs. It never imports the held-out accessor or the study gate's setup builder: held-out evaluation exists only through
// the preregistered command-line studies (decided with the owner, plan section 5). A test enforces this.
//
// STARTS: a model is deterministic, so the same start repeated is one trial. The protocol runs the circuit's nominal start
// (seed 0) and four recorded perturbed starts (seeds 1 to 4): small offsets drawn from the repository's seeded RNG
// (persistence/evaluationEntry.ts holds the derivation, so a stored entry can be checked against it). The track itself is never
// changed (a start OVERRIDE pose is given to the episode). These are scenario variation of one model, not independent training runs.
//
// WORK IN SLICES: an evaluation is a job that advances a bounded number of simulation ticks per call, on the same fixed-step
// episode path as everything else (stepEpisode), so a page can yield between slices and cancel without storing anything partial.
import { createNetworkDriver, type EpisodeDriver } from '../ai/drivers';
import {
  EVALUATION_KIND,
  EVALUATION_PROTOCOL,
  EVALUATION_SEEDS,
  PROTOCOL_LIMITS,
  START_BOUNDS,
  evaluationConfigHash,
  evaluationStartFor,
  stableStringify,
  summariseRows,
  validateEvaluationEntry,
  type EntryContext,
  type EvaluationEntry,
  type RegistryTrack,
  type EvaluationRow,
  type EvaluationSplit,
  type EvaluationStart,
} from '../persistence/evaluationEntry';
import { compatibility, modelParameters, type ModelDocument } from '../persistence/modelFormat';
import { createCar } from '../sim/collision';
import { DEFAULT_VEHICLE_PHYSICS } from '../sim/config';
import type { Pose, Track } from '../sim/track';
import { createEvaluationSetup, type EvaluationSetup } from '../training/evaluation';
import { startEpisodeState, stepEpisode, type EpisodeState } from '../training/episodeStep';
import { BUILT_IN_TRACK_SPLITS, RESERVED_LAYOUT_MESSAGE, TrackLeakageError, classifyCustomTrack, freezeModel, trackContentHash, trackGeometryHash, trainingTrack, validationTrack, type FrozenModel } from '../training/trackSplits';

export { EVALUATION_SEEDS, START_BOUNDS };

/** How many simulation ticks one slice of work runs (a few milliseconds on a phone), so a page can yield and cancel. */
export const SLICE_TICKS = 300;

export interface CircuitRef {
  readonly id: string;
  readonly version: string;
  readonly split: EvaluationSplit;
  readonly contentHash: string;
  readonly track: Track;
}

/** The built-in circuits an entry may name: training and validation only, with their tracks for the start and gate checks. */
export const EVALUATION_REGISTRY = BUILT_IN_TRACK_SPLITS.tracks.filter((t) => t.split === 'training' || t.split === 'validation');

/** The saved custom track an ID names, validated again by the caller's store on every call (P4-03), or null when none is saved. */
export type CustomSource = (id: string) => Track | null | 'unreadable';

/**
 * The saved-track source over a track store: a saved track, `null` when nothing is stored under the ID (a deleted track), and `'unreadable'`
 * when something is stored but cannot be used (damaged, hand-edited, reserved, or the storage failed), so the two are never mixed up.
 */
export function customSourceFromStore(store: { load(id: string): { readonly ok: true; readonly track: Track } | { readonly ok: false; readonly kind: 'missing' | 'unreadable' } }): CustomSource {
  return (id) => {
    const loaded = store.load(id);
    return loaded.ok ? loaded.track : loaded.kind === 'missing' ? null : 'unreadable';
  };
}

/** Every built-in circuit's ID, in every split (IDs only: no geometry, and no circuit becomes evaluable): the IDs a custom layout may not use. */
export const RESERVED_CIRCUIT_IDS: readonly string[] = BUILT_IN_TRACK_SPLITS.tracks.map((t) => t.id);

/**
 * The circuit an ID names: a built-in training or validation circuit, or, when `custom` is given, a saved custom track.
 * Throws TrackLeakageError for a held-out circuit, a renamed copy of one or any other ID, before anything is evaluated. A saved
 * track is classified again here (an ID or layout of a built-in study circuit is refused with the one generic message), and its
 * geometry hash is its content hash.
 */
export function resolveCircuit(id: string, custom?: CustomSource): CircuitRef {
  let split: EvaluationSplit;
  let track: Track;
  try {
    track = trainingTrack(id);
    split = 'training';
  } catch (first) {
    if (!(first instanceof TrackLeakageError)) throw first;
    try {
      track = validationTrack(id);
      split = 'validation';
    } catch (second) {
      if (!(second instanceof TrackLeakageError)) throw second;
      const saved = custom === undefined ? null : custom(id);
      if (saved === 'unreadable') throw new TrackLeakageError('That saved track cannot be read, so it cannot be evaluated.');
      if (saved === null || saved.id !== id) throw new TrackLeakageError(`"${String(id)}" is not a training or validation circuit${custom === undefined ? '' : ' or a saved custom track'}; saved models are evaluated on those only.`);
      if (!classifyCustomTrack(saved).ok) throw new TrackLeakageError(RESERVED_LAYOUT_MESSAGE);
      return { id: saved.id, version: saved.version, split: 'custom', contentHash: trackGeometryHash(saved), track: saved };
    }
  }
  return { id: track.id, version: track.version, split, contentHash: trackContentHash(track), track };
}

/** The saved-track lookup an entry is checked against (the form the entry validator and the model store take). */
export function customRegistryLookup(custom: CustomSource): (id: string) => RegistryTrack | null | 'unreadable' {
  return (id) => {
    const track = custom(id);
    if (track === 'unreadable') return 'unreadable';
    return track === null ? null : { id: track.id, version: track.version, split: 'custom', contentHash: trackGeometryHash(track), track };
  };
}

/** How an entry is checked for a model: the built-in circuits, the saved custom tracks, and that it belongs to the model. */
export function entryContext(model: ModelDocument, custom?: CustomSource): EntryContext {
  return { registry: EVALUATION_REGISTRY, reservedIds: RESERVED_CIRCUIT_IDS, belongsTo: (e) => entryBelongsTo(model, e), custom: custom === undefined ? undefined : customRegistryLookup(custom) };
}

/** The start of seed `seed` on a track (see evaluationStartFor). */
export function evaluationStart(track: Track, seed: number): EvaluationStart {
  return evaluationStartFor(track.start, seed);
}

const poseOf = (s: EvaluationStart): Pose => ({ position: { x: s.x, y: s.y }, heading: s.heading });

/** The frozen identity of a saved model as it is evaluated: its parameters and everything that determines how it drives. */
export function frozenIdentity(model: ModelDocument): FrozenModel {
  const configuration = model.training.configuration;
  const physics = JSON.stringify(Object.entries({ ...configuration.physics }).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return freezeModel(modelParameters(model), { modelId: model.id, brakeEnabled: configuration.brakeEnabled, timestepSeconds: configuration.timestepSeconds, physics });
}

/** Why an entry does not belong to this saved model (another champion, or this champion changed since), or null when it does. */
export function entryBelongsTo(model: ModelDocument, entry: EvaluationEntry): string | null {
  if (entry.modelId !== model.id) return `This evaluation was made for champion "${entry.modelId}", not this one.`;
  try {
    if (entry.frozenModelId !== frozenIdentity(model).id) return 'This evaluation was made for a different version of this champion (its parameters or driving settings differ).';
  } catch {
    return 'This evaluation cannot be matched to this champion.';
  }
  if (entry.brakeEnabled !== model.training.configuration.brakeEnabled) return 'This evaluation used a different brake setting from this champion.';
  if (entry.timestepSeconds !== model.training.configuration.timestepSeconds) return 'This evaluation used a different simulation timestep from this champion.';
  return null;
}

export type ModelEvaluationResult = { readonly ok: true; readonly entry: EvaluationEntry } | { readonly ok: false; readonly message: string };

export interface EvaluateOptions {
  readonly recordedAt: string;
  readonly appVersion: string;
  readonly codeVersion: string;
  readonly runtime?: string;
  /** For tests: called each time an episode starts, so a refusal can be shown to run none. */
  readonly onEpisode?: () => void;
  /** The saved custom track an ID names (P4-03); without it only built-in training and validation circuits can be evaluated. */
  readonly customTracks?: CustomSource | undefined;
}

export const DEFAULT_RUNTIME_NOTE =
  'Results can differ slightly between browsers and engines (Math.sin and Math.cos), as docs/AI_EVALUATION.md section 4 says.';

/** Why a model cannot be evaluated, or null. */
export function modelProblem(model: ModelDocument): string | null {
  const result = compatibility(model);
  if (!result.drivable) return `This app cannot drive this model: ${result.reasons.join(' ')}`;
  return null;
}

export interface EvaluationProgress {
  /** The episode in progress, from 1. */
  readonly episode: number;
  readonly episodes: number;
  /** Ticks run in the current episode. */
  readonly tick: number;
}

/** One circuit's evaluation as a job that advances a bounded number of ticks per call. */
export interface EvaluationJob {
  /** Runs at most `ticks` simulation ticks (about one slice) and returns. Does nothing once done. */
  step(ticks: number): void;
  done(): boolean;
  progress(): EvaluationProgress;
  /** The entry to store, once done. */
  result(): ModelEvaluationResult;
}

export type StartJobResult = { readonly ok: true; readonly job: EvaluationJob } | { readonly ok: false; readonly message: string };

const rowOf = (state: EpisodeState, seed: number, gates: number, timestepSeconds: number): EvaluationRow => {
  const episode = state.episode;
  const first = episode.lapTicks[0];
  return Object.freeze({
    seed,
    outcome: episode.outcome!,
    ticks: episode.tick,
    gatesPassed: episode.gatesPassed,
    gates,
    laps: episode.lapTicks.length,
    orderedProgress: episode.gatesPassed / gates,
    firstLapTicks: first ?? null,
    firstLapSeconds: first === undefined ? null : first * timestepSeconds,
  });
};

/**
 * Starts evaluating one saved model on one built-in training or validation circuit under the fixed protocol. Never throws for
 * a bad model or circuit: it returns a message (a held-out or unknown circuit is refused before any episode runs).
 */
export function startEvaluationJob(model: ModelDocument, circuitId: string, options: EvaluateOptions): StartJobResult {
  let circuit: CircuitRef;
  try {
    circuit = resolveCircuit(circuitId, options.customTracks);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'That circuit cannot be evaluated.' };
  }
  const problem = modelProblem(model);
  if (problem !== null) return { ok: false, message: problem };
  try {
    const configuration = model.training.configuration;
    const parameters = modelParameters(model);
    const brakeEnabled = configuration.brakeEnabled;
    const frozen = frozenIdentity(model);
    const driver: EpisodeDriver = createNetworkDriver(parameters, { brakeEnabled });
    const timestepSeconds = configuration.timestepSeconds;
    const setup: EvaluationSetup = createEvaluationSetup({}, { track: circuit.track, physics: { ...DEFAULT_VEHICLE_PHYSICS, ...configuration.physics }, timestepSeconds });
    const starts: EvaluationStart[] = [0, ...EVALUATION_SEEDS].map((seed) => evaluationStart(circuit.track, seed));
    for (const start of starts) {
      if (start.seed !== 0 && createCar(poseOf(start), circuit.track, setup.environment.physics).crashed) {
        return { ok: false, message: `The perturbed start ${start.seed} on ${circuit.id} touches a wall, so this circuit cannot be evaluated.` };
      }
    }
    const rows: EvaluationRow[] = [];
    let state: EpisodeState | null = null;
    let tickInEpisode = 0;
    const decide = (inputs: readonly number[], racer: EpisodeState['racer']) => driver.decide({ car: racer.car, inputs });
    const total = starts.length;
    const job: EvaluationJob = {
      step(ticks) {
        let budget = ticks;
        try {
          while (budget > 0 && rows.length < total) {
            if (state === null) {
              const index = rows.length;
              options.onEpisode?.();
              driver.reset();
              state = startEpisodeState(setup, poseOf(starts[index]!));
              tickInEpisode = 0;
            }
            while (budget > 0 && state.episode.outcome === null) {
              state = stepEpisode(state, decide, setup);
              tickInEpisode += 1;
              budget -= 1;
            }
            if (state.episode.outcome !== null) {
              rows.push(rowOf(state, rows.length, circuit.track.gates.length, timestepSeconds));
              state = null;
            }
          }
        } catch (error) {
          failure = error instanceof Error ? error.message : 'The model could not be evaluated.';
          rows.length = total;
        }
      },
      done: () => rows.length >= total,
      progress: () => ({ episode: Math.min(rows.length + 1, total), episodes: total, tick: tickInEpisode }),
      result() {
        if (failure !== null) return { ok: false, message: failure };
        if (rows.length < total) return { ok: false, message: 'The evaluation has not finished.' };
        const config = { maxEpisodeSeconds: PROTOCOL_LIMITS.maxEpisodeSeconds, stallSeconds: PROTOCOL_LIMITS.stallSeconds, maxLaps: PROTOCOL_LIMITS.maxLaps };
        const entry: EvaluationEntry = {
          kind: EVALUATION_KIND,
          protocol: EVALUATION_PROTOCOL,
          configHash: evaluationConfigHash(config, PROTOCOL_LIMITS.fitnessVersion, timestepSeconds),
          config,
          fitnessVersion: PROTOCOL_LIMITS.fitnessVersion,
          timestepSeconds,
          modelId: model.id,
          frozenModelId: frozen.id,
          brakeEnabled,
          track: { id: circuit.id, version: circuit.version, split: circuit.split, contentHash: circuit.contentHash },
          starts,
          rows,
          summary: summariseRows(rows),
          recordedAt: options.recordedAt,
          appVersion: options.appVersion,
          codeVersion: options.codeVersion,
          runtime: options.runtime ?? DEFAULT_RUNTIME_NOTE,
        };
        const checked = validateEvaluationEntry(entry, entryContext(model, options.customTracks));
        if (!checked.ok) return { ok: false, message: `The evaluation produced an invalid entry: ${checked.errors.join(' ')}` };
        return { ok: true, entry };
      },
    };
    let failure: string | null = null;
    return { ok: true, job };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'The model could not be evaluated.' };
  }
}

/** Evaluates one saved model on one circuit to completion (the same job, run in one go). Never throws. */
export function evaluateModelOnCircuit(model: ModelDocument, circuitId: string, options: EvaluateOptions): ModelEvaluationResult {
  const started = startEvaluationJob(model, circuitId, options);
  if (!started.ok) return started;
  while (!started.job.done()) started.job.step(SLICE_TICKS * 100);
  return started.job.result();
}

/** Evaluates one model on a list of circuits, in order, stopping at the first refusal. */
export function evaluateModel(model: ModelDocument, circuitIds: readonly string[], options: EvaluateOptions): { ok: true; entries: EvaluationEntry[] } | { ok: false; message: string } {
  const entries: EvaluationEntry[] = [];
  for (const id of circuitIds) {
    const result = evaluateModelOnCircuit(model, id, options);
    if (!result.ok) return result;
    entries.push(result.entry);
  }
  return { ok: true, entries };
}

const COMPARED = ['kind', 'protocol', 'configHash', 'config', 'fitnessVersion', 'timestepSeconds', 'modelId', 'frozenModelId', 'brakeEnabled', 'track', 'starts', 'rows', 'summary'] as const;

/**
 * Re-runs the protocol for a stored entry and reports whether it reproduces EVERY recorded field. The entry is validated first (the
 * protocol's invariants, the allowed circuit and the model it belongs to), so a truncated, extended or altered record is reported
 * and never confirmed; the fresh entry is then compared whole, whatever the key order. A different engine can differ in the last
 * digits, which is reported, not hidden.
 */
export function replayEntry(entry: EvaluationEntry, model: ModelDocument, options: EvaluateOptions): { identical: boolean; differences: string[] } {
  const checked = validateEvaluationEntry(entry, entryContext(model, options.customTracks));
  if (!checked.ok) return { identical: false, differences: [`The record is not valid: ${checked.errors.join(' ')}`] };
  // A custom entry whose track is no longer saved is a historical result with nothing to re-run: unavailable, never "confirmed".
  if (checked.entry.track.split === 'custom' && (options.customTracks?.(entry.track.id) ?? null) === null) {
    return { identical: false, differences: ['This track is no longer saved, so this result cannot be re-run or confirmed.'] };
  }
  const again = evaluateModelOnCircuit(model, entry.track.id, options);
  if (!again.ok) return { identical: false, differences: [again.message] };
  const differences: string[] = [];
  for (const key of COMPARED) {
    if (stableStringify((again.entry as unknown as Record<string, unknown>)[key]) !== stableStringify((entry as unknown as Record<string, unknown>)[key])) differences.push(`"${key}" differs.`);
  }
  entry.rows.forEach((row, i) => {
    if (stableStringify(again.entry.rows[i]) !== stableStringify(row)) differences.push(`Row ${i} differs.`);
  });
  return { identical: differences.length === 0, differences };
}
