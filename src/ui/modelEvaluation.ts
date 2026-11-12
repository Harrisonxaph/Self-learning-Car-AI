// Evaluating a saved model on built-in circuits it was not trained on (P4-05, docs/plans/p4-05-plan.md). Pure and headless:
// no storage, no DOM. It lives in src/ui, beside savedReplay.ts, because it joins the persistence layer (the model document) to the
// training layer (the episode path), and src/training must not import src/persistence. One fixed protocol, `p4-05-evaluation-v1`, in one engine; deterministic for a model, a circuit and the
// protocol.
//
// WHICH CIRCUITS: this module takes circuit IDs, never a Track, and resolves each through trainingTrack or validationTrack
// only. A held-out circuit (or a renamed copy, or any unregistered ID) is therefore refused with TrackLeakageError BEFORE any
// episode runs. It never imports the held-out accessor or the study gate's setup builder: held-out evaluation exists only through
// the preregistered command-line studies (decided with the owner, plan section 5). A test enforces this.
//
// STARTS: a model is deterministic, so the same start repeated is one trial. The protocol runs the circuit's nominal start
// (seed 0) and four recorded perturbed starts (seeds 1 to 4): small offsets drawn from the repository's seeded RNG. The track
// itself is never changed (a start OVERRIDE pose is given to the episode). These are scenario variation of one model, not
// independent training runs.
import { createNetworkDriver } from '../ai/drivers';
import { compatibility, modelParameters, type ModelDocument } from '../persistence/modelFormat';
import {
  EVALUATION_KIND,
  EVALUATION_PROTOCOL,
  evaluationConfigHash,
  summariseRows,
  validateEvaluationEntry,
  type EvaluationEntry,
  type EvaluationRow,
  type EvaluationSplit,
  type EvaluationStart,
} from '../persistence/evaluationEntry';
import { createCar } from '../sim/collision';
import { DEFAULT_VEHICLE_PHYSICS } from '../sim/config';
import type { Pose, Track } from '../sim/track';
import { createRng } from '../utils/rng';
import { DEFAULT_EVALUATION_CONFIG, createEvaluationSetup, evaluateDriver } from '../training/evaluation';
import { FITNESS_VERSION } from '../training/fitness';
import { BUILT_IN_TRACK_SPLITS, TrackLeakageError, freezeModel, trackContentHash, trainingTrack, validationTrack } from '../training/trackSplits';

/** The perturbed-start seeds; seed 0 is the nominal start. */
export const EVALUATION_SEEDS: readonly number[] = Object.freeze([1, 2, 3, 4]);
/** The largest start offsets: 1.0 m sideways and 3 degrees of heading. */
export const START_BOUNDS = Object.freeze({ lateralMetres: 1.0, headingRadians: (3 * Math.PI) / 180 });

export interface CircuitRef {
  readonly id: string;
  readonly version: string;
  readonly split: EvaluationSplit;
  readonly contentHash: string;
  readonly track: Track;
}

/**
 * The circuit an ID names, if it is a built-in training or validation circuit. Throws TrackLeakageError for a held-out
 * circuit, a renamed copy or any other ID, before anything is evaluated.
 */
export function resolveCircuit(id: string): CircuitRef {
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
      throw new TrackLeakageError(`"${String(id)}" is not a training or validation circuit; saved models are evaluated on those only.`);
    }
  }
  return { id: track.id, version: track.version, split, contentHash: trackContentHash(track), track };
}

/** The start of seed `seed` on a track: the nominal start for 0, otherwise a bounded offset from the seeded RNG. */
export function evaluationStart(track: Track, seed: number): EvaluationStart {
  const { position, heading } = track.start;
  if (seed === 0) return { seed, lateralMetres: 0, headingRadians: 0, x: position.x, y: position.y, heading };
  const rng = createRng(seed);
  const lateral = Math.round(rng.range(-START_BOUNDS.lateralMetres, START_BOUNDS.lateralMetres) * 1000) / 1000;
  const turn = Math.round(rng.range(-START_BOUNDS.headingRadians, START_BOUNDS.headingRadians) * 1e6) / 1e6;
  // To the left of the heading on the y-down screen is (sin h, -cos h).
  return {
    seed,
    lateralMetres: lateral,
    headingRadians: turn,
    x: position.x + Math.sin(heading) * lateral,
    y: position.y - Math.cos(heading) * lateral,
    heading: heading + turn,
  };
}

const poseOf = (s: EvaluationStart): Pose => ({ position: { x: s.x, y: s.y }, heading: s.heading });

export type ModelEvaluationResult = { readonly ok: true; readonly entry: EvaluationEntry } | { readonly ok: false; readonly message: string };

export interface EvaluateOptions {
  readonly recordedAt: string;
  readonly appVersion: string;
  readonly codeVersion: string;
  readonly runtime?: string;
  /** For tests: the function that runs one episode (the default is the real one), so a refusal can be shown to run none. */
  readonly evaluate?: typeof evaluateDriver;
}

export const DEFAULT_RUNTIME_NOTE =
  'Results can differ slightly between browsers and engines (Math.sin and Math.cos), as docs/AI_EVALUATION.md section 4 says.';

/** Why a model cannot be evaluated, or null. */
export function modelProblem(model: ModelDocument): string | null {
  const result = compatibility(model);
  if (!result.drivable) return `This app cannot drive this model: ${result.reasons.join(' ')}`;
  return null;
}

/**
 * Evaluates one saved model on one built-in training or validation circuit under the fixed protocol and returns the entry to
 * store. Never throws for a bad model or circuit: it returns a message (a held-out or unknown circuit is refused before any
 * episode runs).
 */
export function evaluateModelOnCircuit(model: ModelDocument, circuitId: string, options: EvaluateOptions): ModelEvaluationResult {
  let circuit: CircuitRef;
  try {
    circuit = resolveCircuit(circuitId);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'That circuit cannot be evaluated.' };
  }
  const problem = modelProblem(model);
  if (problem !== null) return { ok: false, message: problem };
  try {
    const configuration = model.training.configuration;
    const parameters = modelParameters(model);
    const brakeEnabled = configuration.brakeEnabled;
    const frozen = freezeModel(parameters, { brakeEnabled, modelId: model.id });
    const driver = createNetworkDriver(parameters, { brakeEnabled });
    const timestepSeconds = configuration.timestepSeconds;
    const setup = createEvaluationSetup({}, { track: circuit.track, physics: { ...DEFAULT_VEHICLE_PHYSICS, ...configuration.physics }, timestepSeconds });
    const run = options.evaluate ?? evaluateDriver;
    const starts: EvaluationStart[] = [0, ...EVALUATION_SEEDS].map((seed) => evaluationStart(circuit.track, seed));
    const rows: EvaluationRow[] = starts.map((start) => {
      const startPose = poseOf(start);
      if (start.seed !== 0 && createCar(startPose, circuit.track, setup.environment.physics).crashed) {
        throw new RangeError(`The perturbed start ${start.seed} on ${circuit.id} touches a wall, so this circuit cannot be evaluated.`);
      }
      const done = run(driver, setup, { start: startPose });
      const first = done.episode.lapTicks[0];
      return Object.freeze({
        seed: start.seed,
        outcome: done.episode.outcome!,
        ticks: done.episode.tick,
        gatesPassed: done.episode.gatesPassed,
        gates: circuit.track.gates.length,
        laps: done.episode.lapTicks.length,
        orderedProgress: done.orderedProgress,
        firstLapTicks: first ?? null,
        firstLapSeconds: first === undefined ? null : first * timestepSeconds,
      });
    });
    const config = { maxEpisodeSeconds: setup.config.maxEpisodeSeconds, stallSeconds: setup.config.stallSeconds, maxLaps: setup.config.maxLaps };
    const entry: EvaluationEntry = {
      kind: EVALUATION_KIND,
      protocol: EVALUATION_PROTOCOL,
      configHash: evaluationConfigHash(config, FITNESS_VERSION, timestepSeconds),
      config,
      fitnessVersion: FITNESS_VERSION,
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
    const checked = validateEvaluationEntry(entry, BUILT_IN_TRACK_SPLITS.tracks);
    if (!checked.ok) return { ok: false, message: `The evaluation produced an invalid entry: ${checked.errors.join(' ')}` };
    return { ok: true, entry };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'The model could not be evaluated.' };
  }
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

/**
 * Re-runs the protocol for a stored entry (same model, circuit and seed list) and reports whether every row, the summary and the
 * model's frozen identity are reproduced. A different engine can differ in the last digits, which is reported, not hidden.
 */
export function replayEntry(entry: EvaluationEntry, model: ModelDocument, options: EvaluateOptions): { identical: boolean; differences: string[] } {
  const again = evaluateModelOnCircuit(model, entry.track.id, options);
  if (!again.ok) return { identical: false, differences: [again.message] };
  const differences: string[] = [];
  if (again.entry.frozenModelId !== entry.frozenModelId) differences.push('The model is not the one that was evaluated (its frozen identity differs).');
  if (again.entry.track.contentHash !== entry.track.contentHash) differences.push('The circuit has changed since the evaluation.');
  if (JSON.stringify(again.entry.starts) !== JSON.stringify(entry.starts)) differences.push('The recorded starts differ.');
  entry.rows.forEach((row, i) => {
    if (JSON.stringify(again.entry.rows[i]) !== JSON.stringify(row)) differences.push(`Row ${i} differs.`);
  });
  if (JSON.stringify(again.entry.summary) !== JSON.stringify(entry.summary)) differences.push('The summary differs.');
  return { identical: differences.length === 0, differences };
}

export { DEFAULT_EVALUATION_CONFIG };
