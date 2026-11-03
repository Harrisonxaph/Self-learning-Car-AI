// P2-08 study formats (docs/experiments/p2-08-step3-design.md §4, C1): a versioned manifest (the preregistration),
// one versioned record per training seed with every raw result, strict parsing of both, and same-engine replay.
// Tooling only: this module runs one seed when asked, never a study, and writes no files. The command line is C2.
//
// Boundaries: the manifest's tracks must be a training and a validation track (trainingTrack, validationTrack);
// the held-out track is refused with TrackLeakageError. Selection is training fitness only, validation results are
// descriptive, and nothing here calls heldOutTrack or tracksIn.
import { PARAMETER_COUNT } from '../ai/network';
import { RANDOM_ACTION_ALGORITHM } from '../ai/randomDrivers';
import { createNetworkDriver } from '../ai/drivers';
import { sha256Hex } from '../utils/sha256';
import { A5_SELECTION, ACTION_SEED_DERIVATION, actionSeed, generateAgents, MAX_EPISODES_PER_TRACK, type AgentConfig, type Agents } from './agents';
import { A8_STREAM, episodeResult, genomeId, MAX_BASELINE_GENERATIONS, resolveBaselineConfig, selectBest, SELECTION_RULE, type TrainingSettings } from './baselines';
import { createEvaluationSetup, evaluateDriver } from './evaluation';
import {
  canonicalJson,
  currentContracts,
  jsonDifferences,
  manifestRecord,
  type ExperimentContracts,
  type ExperimentEngine,
  type ExperimentSource,
} from './experiment';
import { FITNESS_VERSION, PARTIAL_PROGRESS_CAP, scoreEpisode, type Episode, type EpisodeRules, type FitnessConfig } from './fitness';
import { freezeModel, trackContentHash, trainingTrack, validationTrack } from './trackSplits';
import { DEFAULT_TRAINING_CONFIG, RNG_STREAMS } from './trainer';

export const STUDY_MANIFEST_FORMAT = 'self-driving-ai-evolution/p2-08-manifest';
export const STUDY_RECORD_FORMAT = 'self-driving-ai-evolution/p2-08-seed-record';
export const STUDY_VERSION = 1;
export const AGENT_ORDER = Object.freeze(['A1', 'A7', 'A2', 'A9', 'A8', 'A5'] as const);
export const METRIC = 'ordered-progress-gates-per-lap-v1';
export const MIN_DELTA = 0.25;
export const BOOTSTRAP = Object.freeze({ resamples: 10_000, seed: 20261028, level: 0.95, method: 'percentile-nearest-rank-v1' });
export const WILCOXON = 'exact-signed-rank-drop-zeros-midranks-v1';
export const DECISION_RULE = 'p2-08-decision-v1';
export const LABELS = Object.freeze(['mechanics', 'pilot', 'confirmatory'] as const);
export type StudyLabel = (typeof LABELS)[number];
export const PILOT_SEEDS = Object.freeze([9001, 9002, 9003]);
export const CONFIRMATORY_SEED_SETS = Object.freeze([
  Object.freeze(Array.from({ length: 10 }, (_, i) => 1001 + i)),
  Object.freeze(Array.from({ length: 20 }, (_, i) => 1001 + i)),
]);
/** P2-09 E4's reserved seeds (docs/experiments/p2-09-plan.md §5): disjoint from the pilot and the P2-08 confirmatory seeds. */
export const E4_SEEDS = Object.freeze(Array.from({ length: 10 }, (_, i) => 2001 + i));
export const MAX_MECHANICS_SEEDS = 1_000;

/** A malformed or inconsistent study manifest. */
export class StudyManifestError extends Error {
  override name = 'StudyManifestError';
}
/** A malformed, incomplete or internally inconsistent seed record. */
export class StudyRecordError extends Error {
  override name = 'StudyRecordError';
}
/** A record this engine or code cannot replay (other engine, contracts or manifest). */
export class StudyCompatibilityError extends Error {
  override name = 'StudyCompatibilityError';
}

// The helpers below are exported for the P2-09 E4 study (e4Study.ts), which parses its records with the same strictness.
export type Fail = (message: string) => never;
export type Json = Record<string, unknown>;

export interface StudyManifest {
  readonly format: typeof STUDY_MANIFEST_FORMAT;
  readonly version: typeof STUDY_VERSION;
  readonly id: string;
  readonly label: StudyLabel;
  readonly description: string;
  readonly agents: readonly string[];
  readonly seeds: readonly number[];
  readonly configuration: {
    readonly generations: number;
    readonly episodesPerTrack: number;
    readonly holdTicks: number;
    readonly training: TrainingSettings;
  };
  readonly streams: {
    readonly rngStreams: string;
    readonly a8Stream: string;
    readonly actionSeedDerivation: string;
    readonly selectionRule: string;
    readonly a5Selection: string;
  };
  readonly tracks: {
    readonly training: { readonly id: string; readonly contentHash: string };
    readonly validation: { readonly id: string; readonly contentHash: string };
    readonly splitManifestHash: string;
  };
  readonly metric: typeof METRIC;
  readonly analysis: {
    readonly delta: number;
    readonly bootstrap: typeof BOOTSTRAP;
    readonly wilcoxon: typeof WILCOXON;
    readonly decisionRule: typeof DECISION_RULE;
  };
  readonly code: { readonly revision: string | null };
}

export interface StudyContracts extends ExperimentContracts {
  readonly randomAction: string;
  readonly evaluation: { readonly fitnessVersion: number };
}

export interface StudyContext {
  readonly engine: ExperimentEngine;
  readonly source: ExperimentSource;
  /** ISO 8601 UTC time; replay ignores it. */
  readonly recordedAt: string;
}

export interface StudyRecord {
  readonly format: typeof STUDY_RECORD_FORMAT;
  readonly version: typeof STUDY_VERSION;
  readonly manifestHash: string;
  readonly seed: number;
  readonly recordedAt: string;
  readonly source: ExperimentSource;
  readonly engine: ExperimentEngine;
  readonly contracts: StudyContracts;
  readonly budgets: Json;
  readonly agents: Json;
  readonly evaluations: { readonly validation: 'descriptive'; readonly heldOut: 'none' };
  readonly resultsHash: string;
}

export interface StudyReplay {
  readonly identical: boolean;
  /** Up to 20 differing paths in `agents`. */
  readonly differences: readonly string[];
  /** Whether each frozen model, evaluated alone, reproduced its recorded training and validation episodes. */
  readonly modelsReplayed: Readonly<Record<'A9' | 'A8' | 'A5', boolean>>;
  readonly sameSourceRevision: boolean | null;
}

export const hashOf = (value: unknown): string => `sha256:${sha256Hex(canonicalJson(value))}`;
export const HASH = /^sha256:[0-9a-f]{64}$/;
export const REVISION = /^[0-9a-f]{40}$/;
export const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const isPlainObject = (value: unknown): value is Json => value !== null && typeof value === 'object' && !Array.isArray(value);

export function exact(value: unknown, path: string, keys: readonly string[], fail: Fail): Json {
  if (!isPlainObject(value)) return fail(`${path} must be an object.`);
  for (const key of keys) if (!Object.prototype.hasOwnProperty.call(value, key)) fail(`incomplete: ${path}.${key} is missing.`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${path} has an unknown field "${key}".`);
  return value;
}
export const int = (value: unknown, path: string, min: number, max: number, fail: Fail): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : fail(`${path} must be an integer from ${min} to ${max}, got ${String(value)}.`);
export const finite = (value: unknown, path: string, fail: Fail): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fail(`${path} must be a finite number, got ${String(value)}.`);
export const str = (value: unknown, path: string, fail: Fail): string => (typeof value === 'string' ? value : fail(`${path} must be a string.`));
/**
 * An array with an own, defined element at every index. Array callbacks (map, forEach, reduce) skip holes, so a
 * sparse array such as `[1, , 2]` or `new Array(1)` would otherwise pass every per-element check unexamined.
 */
export const dense = (value: unknown, path: string, fail: Fail): unknown[] => {
  if (!Array.isArray(value)) return fail(`${path} must be an array.`);
  for (let i = 0; i < value.length; i += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, i) || value[i] === undefined) fail(`${path}[${i}] is missing.`);
  }
  return value;
};
/**
 * Every array anywhere inside `value` must be dense (an own, defined element at each index). Checked over the whole
 * manifest or record first, so no later comparison (including ones that only visit enumerable keys) can see a hole.
 */
export function denseEverywhere(value: unknown, path: string, fail: Fail): void {
  if (Array.isArray(value)) {
    dense(value, path, fail).forEach((item, i) => denseEverywhere(item, `${path}[${i}]`, fail));
  } else if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) denseEverywhere(item, `${path}.${key}`, fail);
  }
}
export const arr = (value: unknown, path: string, length: number, fail: Fail): unknown[] => {
  const list = dense(value, path, fail);
  if (list.length !== length) fail(`${path} must have ${length} entries, got ${list.length}.`);
  return list;
};
export const same = (value: unknown, expected: unknown, path: string, fail: Fail): void => {
  if (canonicalJson(value) !== canonicalJson(expected)) fail(`${path} must be ${canonicalJson(expected)}, got ${canonicalJson(value)}.`);
};

// ---------------------------------------------------------------------------------------------------------------
// Manifest

/** The streams and selection rules this code implements; a manifest must name exactly these. */
export function currentStreams(): StudyManifest['streams'] {
  return { rngStreams: RNG_STREAMS, a8Stream: A8_STREAM, actionSeedDerivation: ACTION_SEED_DERIVATION, selectionRule: SELECTION_RULE, a5Selection: A5_SELECTION };
}

/** The tracks block for a training and a validation track ID (TrackLeakageError for anything else). */
export function trackReferences(trainingId: string, validationId: string): StudyManifest['tracks'] {
  return {
    training: { id: trainingId, contentHash: trackContentHash(trainingTrack(trainingId)) },
    validation: { id: validationId, contentHash: trackContentHash(validationTrack(validationId)) },
    splitManifestHash: manifestRecord().hash,
  };
}

/** `sha256:` + SHA-256 of the manifest's canonical JSON; every record carries it. */
export function manifestHash(manifest: StudyManifest): string {
  return hashOf(manifest);
}

const TRAINING_KEYS = Object.keys(DEFAULT_TRAINING_CONFIG).filter((key) => key !== 'seed');
const NESTED_KEYS: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  Object.entries(DEFAULT_TRAINING_CONFIG).filter(([, v]) => isPlainObject(v)).map(([k, v]) => [k, Object.keys(v as object)]),
);
const MANIFEST_KEYS = ['format', 'version', 'id', 'label', 'description', 'agents', 'seeds', 'configuration', 'streams', 'tracks', 'metric', 'analysis', 'code'];

export const reserved = (seed: number): boolean => (seed >= 1001 && seed <= 1020) || PILOT_SEEDS.includes(seed) || E4_SEEDS.includes(seed);

/**
 * Checks a study manifest completely and returns it. Throws StudyManifestError for any missing or unknown field (at
 * every level), a wrong constant, a training block that is not a complete resolved configuration, seeds that break
 * the label's set, E ≠ P or a hold other than 30 for a pilot or confirmatory manifest, δ below 0.25, no elites, or a
 * missing code revision outside mechanics; and TrackLeakageError if a track is not in its split.
 */
export function parseStudyManifest(input: unknown): StudyManifest {
  const fail: Fail = (message) => {
    throw new StudyManifestError(`Study manifest: ${message}`);
  };
  denseEverywhere(input, 'manifest', fail);
  const m = exact(input, 'manifest', MANIFEST_KEYS, fail);
  same(m.format, STUDY_MANIFEST_FORMAT, 'manifest.format', fail);
  same(m.version, STUDY_VERSION, 'manifest.version', fail);
  if (typeof m.id !== 'string' || !ID_PATTERN.test(m.id)) fail('manifest.id must be 1 to 64 lowercase letters, digits or hyphens.');
  if (!LABELS.includes(m.label as StudyLabel)) fail(`manifest.label must be one of ${LABELS.join(', ')}.`);
  const label = m.label as StudyLabel;
  if (str(m.description, 'manifest.description', fail).length > 1000) fail('manifest.description must be at most 1000 characters.');
  same(m.agents, AGENT_ORDER, 'manifest.agents', fail);

  const seedList = dense(m.seeds, 'manifest.seeds', fail);
  if (seedList.length === 0) fail('manifest.seeds must be a non-empty array.');
  const seeds = seedList.map((s, i) => int(s, `manifest.seeds[${i}]`, 0, 0xffffffff, fail));
  if (new Set(seeds).size !== seeds.length) fail('manifest.seeds must be distinct.');
  if (label === 'pilot' && !seeds.every((s) => PILOT_SEEDS.includes(s))) fail('a pilot manifest\'s seeds must be a subset of 9001–9003.');
  if (label === 'confirmatory' && !CONFIRMATORY_SEED_SETS.some((set) => canonicalJson(set) === canonicalJson(seeds))) {
    fail('a confirmatory manifest\'s seeds must be exactly 1001–1010 or 1001–1020, in order.');
  }
  if (label === 'mechanics') {
    if (seeds.some(reserved)) fail('a mechanics manifest may not use the reserved pilot (9001–9003), P2-08 confirmatory (1001–1020) or P2-09 E4 (2001–2010) seeds.');
    if (seeds.length > MAX_MECHANICS_SEEDS) fail(`a mechanics manifest has at most ${MAX_MECHANICS_SEEDS} seeds.`);
  }

  const c = exact(m.configuration, 'manifest.configuration', ['generations', 'episodesPerTrack', 'holdTicks', 'training'], fail);
  int(c.generations, 'manifest.configuration.generations', 1, MAX_BASELINE_GENERATIONS, fail);
  const E = int(c.episodesPerTrack, 'manifest.configuration.episodesPerTrack', 1, MAX_EPISODES_PER_TRACK, fail);
  const hold = int(c.holdTicks, 'manifest.configuration.holdTicks', 1, Number.MAX_SAFE_INTEGER, fail);
  const training = exact(c.training, 'manifest.configuration.training', TRAINING_KEYS, fail);
  for (const [key, keys] of Object.entries(NESTED_KEYS)) exact(training[key], `manifest.configuration.training.${key}`, keys, fail);
  if (label !== 'mechanics') {
    if (E !== training.populationSize) fail(`a ${label} manifest needs episodesPerTrack equal to populationSize (E = P).`);
    if (hold !== 30) fail(`a ${label} manifest needs holdTicks 30.`);
  }
  if (!(typeof training.eliteCount === 'number' && training.eliteCount >= 1)) fail('manifest.configuration.training.eliteCount must be at least 1.');

  same(m.streams, currentStreams(), 'manifest.streams', fail);
  const t = exact(m.tracks, 'manifest.tracks', ['training', 'validation', 'splitManifestHash'], fail);
  const trainingRef = exact(t.training, 'manifest.tracks.training', ['id', 'contentHash'], fail);
  const validationRef = exact(t.validation, 'manifest.tracks.validation', ['id', 'contentHash'], fail);
  // trainingTrack / validationTrack throw TrackLeakageError for a track outside its split, held-out included.
  same(t, trackReferences(str(trainingRef.id, 'manifest.tracks.training.id', fail), str(validationRef.id, 'manifest.tracks.validation.id', fail)), 'manifest.tracks', fail);

  // The training block must already be complete and resolved: the trainer's resolvers give it back unchanged.
  let resolved: Json;
  try {
    const { setup } = resolveBaselineConfig({ training, generations: c.generations, trackId: trainingRef.id }, seeds[0]!);
    resolved = Object.fromEntries(Object.entries(setup.config).filter(([key]) => key !== 'seed'));
  } catch (error) {
    if (error instanceof Error && error.name === 'TrackLeakageError') throw error;
    return fail(`manifest.configuration.training is invalid: ${(error as Error).message}`);
  }
  if (canonicalJson(resolved) !== canonicalJson(training)) fail('manifest.configuration.training must be a complete resolved training configuration.');

  same(m.metric, METRIC, 'manifest.metric', fail);
  const a = exact(m.analysis, 'manifest.analysis', ['delta', 'bootstrap', 'wilcoxon', 'decisionRule'], fail);
  if (finite(a.delta, 'manifest.analysis.delta', fail) < MIN_DELTA) fail(`manifest.analysis.delta must be at least ${MIN_DELTA} (the pilot may only raise it).`);
  same(a.bootstrap, BOOTSTRAP, 'manifest.analysis.bootstrap', fail);
  same(a.wilcoxon, WILCOXON, 'manifest.analysis.wilcoxon', fail);
  same(a.decisionRule, DECISION_RULE, 'manifest.analysis.decisionRule', fail);
  const code = exact(m.code, 'manifest.code', ['revision'], fail);
  if (code.revision === null) {
    if (label !== 'mechanics') fail(`a ${label} manifest needs manifest.code.revision, the commit it was frozen at.`);
  } else if (typeof code.revision !== 'string' || !REVISION.test(code.revision)) fail('manifest.code.revision must be a 40-character git commit or null.');
  return input as StudyManifest;
}

/** The agent configuration a manifest describes. */
export function agentConfigFor(manifest: StudyManifest): AgentConfig {
  const c = manifest.configuration;
  return {
    training: JSON.parse(JSON.stringify(c.training)) as TrainingSettings,
    generations: c.generations,
    trackId: manifest.tracks.training.id,
    validationTrackId: manifest.tracks.validation.id,
    episodesPerTrack: c.episodesPerTrack,
    holdTicks: c.holdTicks,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Records

/** The contracts of the code that is running now. */
export function currentStudyContracts(): StudyContracts {
  return { ...currentContracts(), randomAction: RANDOM_ACTION_ALGORITHM, evaluation: { fitnessVersion: FITNESS_VERSION } };
}

export const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const modelJson = (model: { id: string; parameters: readonly number[]; provenance: object }) => ({
  id: model.id,
  parameters: [...model.parameters],
  provenance: { ...model.provenance },
});

/** The record's raw `agents` block for one seed's results. */
function agentsJson(a: Agents): Json {
  const b = a.baselines;
  return plain({
    A1: { training: a.A1.training, validation: a.A1.validation },
    A7: { holdTicks: a.A7.holdTicks, training: a.A7.training, validation: a.A7.validation },
    A2: { candidates: b.A2.candidates, validation: a.validation.A2 },
    A9: { index: b.A9.index, model: modelJson(b.A9.model), validation: a.validation.A9 },
    A8: { stream: b.A8.stream, samples: b.A8.samples, index: b.A8.selected.index, model: modelJson(b.A8.selected.model), validation: a.validation.A8 },
    A5: {
      generations: a.A5.generations.map((gen, g) => gen.map((training, index) => ({ index, genomeId: a.A5.genomeIds[g]![index], training }))),
      generation: a.A5.generation,
      index: a.A5.index,
      selection: a.A5.selection,
      model: modelJson(a.A5.model),
      validation: a.A5.episodes.validation,
    },
  });
}

function budgetsJson(manifest: StudyManifest, a: Agents, maxEpisodeTicks: number): Json {
  const P = manifest.configuration.training.populationSize;
  const G = manifest.configuration.generations;
  const b = a.baselines.budgets;
  return plain({
    planned: { evolutionEvaluations: P * G, a8Evaluations: P * G, episodesPerTrack: manifest.configuration.episodesPerTrack, maxEpisodeTicks },
    actual: {
      a5Evaluations: a.A5.generations.reduce((n, gen) => n + gen.length, 0),
      a8Evaluations: b.a8Evaluations,
      a2Evaluations: b.a2Evaluations,
      eliteReevaluations: b.evolution.eliteReevaluations,
    },
    diversity: { evaluations: a.A5.evaluations, maxDistinctGenomes: a.A5.maxDistinctGenomes, actualDistinctGenomes: a.A5.actualDistinctGenomes },
    ticks: a.ticks,
  });
}

function maxEpisodeTicksFor(manifest: StudyManifest, seed: number): number {
  return resolveBaselineConfig({ training: manifest.configuration.training, generations: manifest.configuration.generations, trackId: manifest.tracks.training.id }, seed).setup.rules.maxEpisodeTicks;
}

const RECORD_KEYS = ['format', 'version', 'manifestHash', 'seed', 'recordedAt', 'source', 'engine', 'contracts', 'budgets', 'agents', 'evaluations', 'resultsHash'];

export function checkContext(context: StudyContext, fail: Fail): void {
  const e = exact(context?.engine, 'engine', ['name', 'version', 'v8'], fail);
  for (const key of ['name', 'version', 'v8']) if (typeof e[key] !== 'string' || (e[key] as string).length === 0) fail(`engine.${key} must be a non-empty string.`);
  const s = exact(context.source, 'source', ['revision', 'dirty', 'unavailableReason', 'appVersion'], fail);
  if (typeof s.appVersion !== 'string' || s.appVersion.length === 0) fail('source.appVersion must be a non-empty string.');
  if (s.revision === null) {
    if (s.dirty !== null) fail('source.dirty must be null when the revision is unknown.');
    if (typeof s.unavailableReason !== 'string' || s.unavailableReason.length === 0) fail('source.unavailableReason must say why the revision is unknown.');
  } else {
    if (typeof s.revision !== 'string' || !REVISION.test(s.revision)) fail('source.revision must be a 40-character git commit or null.');
    if (typeof s.dirty !== 'boolean') fail('source.dirty must be a boolean when the revision is known.');
    if (s.unavailableReason !== null) fail('source.unavailableReason must be null when the revision is known.');
  }
  if (typeof context.recordedAt !== 'string' || !ISO_TIME.test(context.recordedAt)) fail('recordedAt must be an ISO 8601 UTC time.');
}

/**
 * Runs one training seed of a manifest and returns its complete record. Throws StudyManifestError for an invalid
 * manifest or a seed it does not list, and StudyRecordError for an invalid context.
 */
export function runStudySeed(manifestInput: unknown, seed: number, context: StudyContext): StudyRecord {
  const manifest = parseStudyManifest(manifestInput);
  if (!manifest.seeds.includes(seed)) throw new StudyManifestError(`Study manifest: seed ${seed} is not one of the manifest's seeds.`);
  checkContext(context, (message) => {
    throw new StudyRecordError(`Study context: ${message}`);
  });
  const agents = generateAgents(agentConfigFor(manifest), seed);
  const agentsBlock = agentsJson(agents);
  return {
    format: STUDY_RECORD_FORMAT,
    version: STUDY_VERSION,
    manifestHash: manifestHash(manifest),
    seed,
    recordedAt: context.recordedAt,
    source: plain(context.source),
    engine: plain(context.engine),
    contracts: currentStudyContracts(),
    budgets: budgetsJson(manifest, agents, maxEpisodeTicksFor(manifest, seed)),
    agents: agentsBlock,
    evaluations: { validation: 'descriptive', heldOut: 'none' },
    resultsHash: hashOf(agentsBlock),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Parsing a record

const OUTCOMES = ['completed', 'crashed', 'stalled', 'timeout'];
const EPISODE_KEYS = ['outcome', 'ticks', 'gatesPassed', 'lapTicks', 'crashed', 'partialProgress', 'fitness', 'orderedProgress'];
const FITNESS_KEYS = ['checkpoints', 'partialProgress', 'laps', 'lapTimeBonus', 'collisionPenalty', 'total'];

/** What checking an episode needs: the tick limit, the track's gates and the manifest's scoring. */
export interface EpisodeCheck {
  readonly maxTicks: number;
  readonly gates: number;
  readonly fitness: FitnessConfig;
  readonly rules: EpisodeRules;
}

export function checkEpisode(value: unknown, path: string, check: EpisodeCheck, fail: Fail, extra: readonly string[] = []): Json {
  const { maxTicks, gates } = check;
  const e = exact(value, path, [...EPISODE_KEYS, ...extra], fail);
  if (!OUTCOMES.includes(e.outcome as string)) fail(`${path}.outcome must be one of ${OUTCOMES.join(', ')}.`);
  int(e.ticks, `${path}.ticks`, 1, maxTicks, fail);
  const gatesPassed = int(e.gatesPassed, `${path}.gatesPassed`, 0, Number.MAX_SAFE_INTEGER, fail);
  dense(e.lapTicks, `${path}.lapTicks`, fail).forEach((t, i) => int(t, `${path}.lapTicks[${i}]`, 1, maxTicks, fail));
  if (typeof e.crashed !== 'boolean') fail(`${path}.crashed must be a boolean.`);
  if (e.outcome === 'crashed' && e.crashed !== true) fail(`${path}.crashed must be true for a crashed outcome.`);
  const partial = finite(e.partialProgress, `${path}.partialProgress`, fail);
  if (partial < 0 || partial > PARTIAL_PROGRESS_CAP) fail(`${path}.partialProgress must be from 0 to ${PARTIAL_PROGRESS_CAP}.`);
  const f = exact(e.fitness, `${path}.fitness`, FITNESS_KEYS, fail);
  for (const key of FITNESS_KEYS) finite(f[key], `${path}.fitness.${key}`, fail);
  // Every fitness term must be what the manifest's scoring gives for this episode's own raw values.
  const scored = scoreEpisode(
    { gatesPassed, partialProgress: partial, lapTicks: e.lapTicks as number[], crashed: e.crashed as boolean } as unknown as Episode,
    check.fitness,
    check.rules,
  );
  for (const key of FITNESS_KEYS) {
    if (f[key] !== scored[key as keyof typeof scored]) fail(`${path}.fitness.${key} is not the score of this episode (${String(f[key])}, expected ${String(scored[key as keyof typeof scored])}).`);
  }
  if (finite(e.orderedProgress, `${path}.orderedProgress`, fail) !== gatesPassed / gates) fail(`${path}.orderedProgress must be gatesPassed ÷ ${gates}.`);
  return e;
}

export function checkCandidate(value: unknown, path: string, index: number, check: EpisodeCheck, fail: Fail): Json {
  const c = exact(value, path, ['index', 'genomeId', 'training'], fail);
  if (c.index !== index) fail(`${path}.index must be ${index}.`);
  if (typeof c.genomeId !== 'string' || !HASH.test(c.genomeId)) fail(`${path}.genomeId must be a sha256: hash.`);
  checkEpisode(c.training, `${path}.training`, check, fail);
  return c;
}

export function checkModel(value: unknown, path: string, expectedGenomeId: string, provenance: Json, fail: Fail): void {
  const m = exact(value, path, ['id', 'parameters', 'provenance'], fail);
  const parameters = arr(m.parameters, `${path}.parameters`, PARAMETER_COUNT, fail).map((p, i) => finite(p, `${path}.parameters[${i}]`, fail));
  same(m.provenance, provenance, `${path}.provenance`, fail);
  if (genomeId(parameters) !== expectedGenomeId) fail(`${path}.parameters are not the selected candidate's genome.`);
  if (m.id !== freezeModel(parameters, provenance as Record<string, string | number | boolean>).id) fail(`${path}.id does not match its parameters and provenance.`);
}

export const totals = (candidates: readonly Json[]): number[] => candidates.map((c) => ((c.training as Json).fitness as Json).total as number);
export const ticksOf = (episodes: readonly Json[]): number => episodes.reduce((n, e) => n + (e.ticks as number), 0);

/**
 * Checks a seed record against its manifest completely, before anything runs, and returns it. Throws
 * StudyRecordError for a malformed or incomplete record (missing or unknown fields, non-finite numbers, wrong
 * counts, inconsistent selections, models, action seeds, budgets or ticks, or a stale resultsHash), and
 * StudyCompatibilityError for another engine, other contracts, or another manifest.
 */
export function parseStudyRecord(input: unknown, manifestInput: unknown, engine: ExperimentEngine): StudyRecord {
  const manifest = parseStudyManifest(manifestInput);
  const fail: Fail = (message) => {
    throw new StudyRecordError(`Study record: ${message}`);
  };
  const incompatible: Fail = (message) => {
    throw new StudyCompatibilityError(`Study record is incompatible: ${message}`);
  };
  denseEverywhere(input, 'record', fail);
  const r = exact(input, 'record', RECORD_KEYS, fail);
  same(r.format, STUDY_RECORD_FORMAT, 'record.format', fail);
  same(r.version, STUDY_VERSION, 'record.version', fail);
  if (typeof r.manifestHash !== 'string' || !HASH.test(r.manifestHash)) fail('record.manifestHash must be a sha256: hash.');
  if (r.manifestHash !== manifestHash(manifest)) incompatible('it was recorded for another manifest (manifestHash differs).');
  const seed = int(r.seed, 'record.seed', 0, 0xffffffff, fail);
  if (!manifest.seeds.includes(seed)) fail(`record.seed ${seed} is not one of the manifest's seeds.`);
  checkContext({ engine: r.engine as ExperimentEngine, source: r.source as ExperimentSource, recordedAt: r.recordedAt as string }, fail);
  const recordedEngine = r.engine as Json;
  for (const key of ['name', 'version', 'v8'] as const) {
    if (recordedEngine[key] !== engine[key]) incompatible(`engine ${key} ${String(recordedEngine[key])} differs from this engine's ${engine[key]}; results are only reproducible within one engine.`);
  }
  if (!isPlainObject(r.contracts)) fail('record.contracts must be an object.');
  const contracts = currentStudyContracts();
  for (const difference of jsonDifferences(r.contracts, contracts, 'contracts', 1)) incompatible(`${difference}.`);
  // jsonDifferences visits keys only; the whole contract block must also be exactly equal (array lengths included).
  if (canonicalJson(r.contracts) !== canonicalJson(contracts)) incompatible('contracts differ from this code\'s contracts.');
  same(r.evaluations, { validation: 'descriptive', heldOut: 'none' }, 'record.evaluations', fail);

  const P = manifest.configuration.training.populationSize;
  const G = manifest.configuration.generations;
  const E = manifest.configuration.episodesPerTrack;
  const { setup } = resolveBaselineConfig({ training: manifest.configuration.training, generations: G, trackId: manifest.tracks.training.id }, seed);
  const maxTicks = setup.rules.maxEpisodeTicks;
  const scoring = { maxTicks, fitness: setup.config.fitness, rules: setup.rules };
  const checks = {
    training: { ...scoring, gates: trainingTrack(manifest.tracks.training.id).gates.length },
    validation: { ...scoring, gates: validationTrack(manifest.tracks.validation.id).gates.length },
  };
  const a = exact(r.agents, 'record.agents', [...AGENT_ORDER], fail);

  // A1, A7: E episodes per track with the derived action seeds.
  for (const agent of ['A1', 'A7'] as const) {
    const block = exact(a[agent], `agents.${agent}`, agent === 'A7' ? ['holdTicks', 'training', 'validation'] : ['training', 'validation'], fail);
    if (agent === 'A7' && block.holdTicks !== manifest.configuration.holdTicks) fail(`agents.A7.holdTicks must be ${manifest.configuration.holdTicks}.`);
    for (const track of ['training', 'validation'] as const) {
      arr(block[track], `agents.${agent}.${track}`, E, fail).forEach((e, i) => {
        const ep = checkEpisode(e, `agents.${agent}.${track}[${i}]`, checks[track], fail, ['actionSeed']);
        if (ep.actionSeed !== actionSeed(agent, seed, i)) fail(`agents.${agent}.${track}[${i}].actionSeed is not the derived action seed.`);
      });
    }
  }

  // A2: generation 0, and its validation episodes.
  const a2 = exact(a.A2, 'agents.A2', ['candidates', 'validation'], fail);
  const a2c = arr(a2.candidates, 'agents.A2.candidates', P, fail).map((c, i) => checkCandidate(c, `agents.A2.candidates[${i}]`, i, checks.training, fail));
  const a2v = arr(a2.validation, 'agents.A2.validation', P, fail).map((e, i) => checkEpisode(e, `agents.A2.validation[${i}]`, checks.validation, fail));
  const tracks = manifest.tracks.training;

  // A9: the best of A2 by training fitness.
  const a9 = exact(a.A9, 'agents.A9', ['index', 'model', 'validation'], fail);
  if (a9.index !== selectBest(totals(a2c))) fail('agents.A9.index is not the best of A2 by training fitness (earliest on ties).');
  const a9i = a9.index as number;
  checkModel(a9.model, 'agents.A9.model', a2c[a9i]!.genomeId as string, {
    agent: 'A9', seed, generation: 0, index: a9i, selection: SELECTION_RULE, trackId: tracks.id, trackContentHash: tracks.contentHash,
  }, fail);
  checkEpisode(a9.validation, 'agents.A9.validation', checks.validation, fail);

  // A8: P × G samples whose first P are A2, and the best of them.
  const a8 = exact(a.A8, 'agents.A8', ['stream', 'samples', 'index', 'model', 'validation'], fail);
  same(a8.stream, A8_STREAM, 'agents.A8.stream', fail);
  const a8s = arr(a8.samples, 'agents.A8.samples', P * G, fail).map((c, i) => checkCandidate(c, `agents.A8.samples[${i}]`, i, checks.training, fail));
  for (let i = 0; i < P; i += 1) same(a8s[i], a2c[i], `agents.A8.samples[${i}] (must equal A2)`, fail);
  if (a8.index !== selectBest(totals(a8s))) fail('agents.A8.index is not the best sample by training fitness (earliest on ties).');
  const a8i = a8.index as number;
  checkModel(a8.model, 'agents.A8.model', a8s[a8i]!.genomeId as string, {
    agent: 'A8', seed, index: a8i, stream: A8_STREAM, selection: SELECTION_RULE, trackId: tracks.id, trackContentHash: tracks.contentHash,
  }, fail);
  checkEpisode(a8.validation, 'agents.A8.validation', checks.validation, fail);

  // A5: G generations of P cars, generation 0 = A2, champion = final generation's best.
  const a5 = exact(a.A5, 'agents.A5', ['generations', 'generation', 'index', 'selection', 'model', 'validation'], fail);
  const gens = arr(a5.generations, 'agents.A5.generations', G, fail).map((gen, g) =>
    arr(gen, `agents.A5.generations[${g}]`, P, fail).map((c, i) => checkCandidate(c, `agents.A5.generations[${g}][${i}]`, i, checks.training, fail)),
  );
  same(gens[0], a2c, 'agents.A5.generations[0] (must equal A2)', fail);
  if (a5.generation !== G - 1) fail(`agents.A5.generation must be ${G - 1}.`);
  same(a5.selection, A5_SELECTION, 'agents.A5.selection', fail);
  if (a5.index !== selectBest(totals(gens[G - 1]!))) fail('agents.A5.index is not the final generation\'s best by training fitness (earliest on ties).');
  const a5i = a5.index as number;
  checkModel(a5.model, 'agents.A5.model', gens[G - 1]![a5i]!.genomeId as string, {
    agent: 'A5', seed, generation: G - 1, index: a5i, selection: A5_SELECTION, trackId: tracks.id, trackContentHash: tracks.contentHash,
  }, fail);
  checkEpisode(a5.validation, 'agents.A5.validation', checks.validation, fail);

  // Budgets: planned, actual and diversity kept apart, every value recomputed.
  const eliteCount = manifest.configuration.training.eliteCount;
  const sumTrain = (cs: readonly Json[]) => ticksOf(cs.map((c) => c.training as Json));
  const random = (agent: 'A1' | 'A7', track: 'training' | 'validation') => ticksOf((a[agent] as Json)[track] as Json[]);
  same(r.budgets, {
    planned: { evolutionEvaluations: P * G, a8Evaluations: P * G, episodesPerTrack: E, maxEpisodeTicks: maxTicks },
    actual: { a5Evaluations: P * G, a8Evaluations: P * G, a2Evaluations: P, eliteReevaluations: eliteCount * (G - 1) },
    diversity: { evaluations: P * G, maxDistinctGenomes: P * G - eliteCount * (G - 1), actualDistinctGenomes: new Set(gens.flat().map((c) => c.genomeId)).size },
    ticks: {
      A1: { training: random('A1', 'training'), validation: random('A1', 'validation') },
      A7: { training: random('A7', 'training'), validation: random('A7', 'validation') },
      A2: { training: sumTrain(a2c), validation: ticksOf(a2v) },
      A9: { training: (a2c[a9i]!.training as Json).ticks, validation: (a9.validation as Json).ticks },
      A8: { training: sumTrain(a8s), validation: (a8.validation as Json).ticks },
      A5: { training: gens.reduce((n, gen) => n + sumTrain(gen), 0), validation: (a5.validation as Json).ticks },
    },
  }, 'record.budgets', fail);

  if (typeof r.resultsHash !== 'string' || !HASH.test(r.resultsHash)) fail('record.resultsHash must be a sha256: hash.');
  if (r.resultsHash !== hashOf(r.agents)) fail('resultsHash does not match the agents block; the results were edited.');
  return input as StudyRecord;
}

// ---------------------------------------------------------------------------------------------------------------
// Replay

/**
 * Checks a record (parseStudyRecord), re-runs its seed from the manifest in this engine and compares every raw
 * result. Also evaluates each frozen model alone against its recorded training and validation episodes.
 */
export function replayStudyRecord(input: unknown, manifestInput: unknown, engine: ExperimentEngine, source?: ExperimentSource): StudyReplay {
  const record = parseStudyRecord(input, manifestInput, engine);
  const manifest = manifestInput as StudyManifest;
  const fresh = agentsJson(generateAgents(agentConfigFor(manifest), record.seed));
  const differences = jsonDifferences(record.agents, fresh, 'agents', 20);
  const config = manifest.configuration.training;
  const { maxEpisodeSeconds, stallSeconds, maxLaps, fitness } = config;
  const limits = { maxEpisodeSeconds, stallSeconds, maxLaps, fitness };
  const { environment } = resolveBaselineConfig({ training: config, generations: manifest.configuration.generations, trackId: manifest.tracks.training.id }, record.seed);
  const setups = {
    training: createEvaluationSetup(limits, environment),
    validation: createEvaluationSetup(limits, { ...environment, track: validationTrack(manifest.tracks.validation.id) }),
  };
  const a = record.agents as Record<string, Json>;
  const replayModel = (agent: 'A9' | 'A8' | 'A5', training: unknown): boolean => {
    const parameters = (a[agent]!.model as Json).parameters as number[];
    // The complete episode result, fitness breakdown included, must match the recorded one.
    const check = (track: 'training' | 'validation', recorded: unknown) => {
      const setup = setups[track];
      const { episode } = evaluateDriver(createNetworkDriver(parameters, { brakeEnabled: config.brakeEnabled }), setup);
      const replayed = episodeResult(episode, setup.config.fitness, setup.rules, setup.environment.track.gates.length);
      return canonicalJson(replayed) === canonicalJson(recorded);
    };
    return check('training', training) && check('validation', a[agent]!.validation);
  };
  const A2 = (a.A2!.candidates as Json[]);
  const A8 = (a.A8!.samples as Json[]);
  const gens = a.A5!.generations as Json[][];
  const modelsReplayed = {
    A9: replayModel('A9', A2[a.A9!.index as number]!.training),
    A8: replayModel('A8', A8[a.A8!.index as number]!.training),
    A5: replayModel('A5', gens[gens.length - 1]![a.A5!.index as number]!.training),
  };
  const identical = differences.length === 0 && Object.values(modelsReplayed).every(Boolean);
  const sameSourceRevision = source?.revision && record.source.revision ? source.revision === record.source.revision : null;
  return { identical, differences, modelsReplayed, sameSourceRevision };
}
