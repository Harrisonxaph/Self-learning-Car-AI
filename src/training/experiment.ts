// Seeded training experiments (P2-07): a JSON experiment configuration in, a complete JSON record out, and a replay
// that re-runs a record and checks it reproduces exactly. Headless and deterministic. The command line
// (scripts/experiment.mjs) supplies the only outside facts: the engine, the source revision and the date.
// docs/ARCHITECTURE.md "Experiments" is the contract and docs/AI_EVALUATION.md §7 the protocol.
//
// A record holds everything a run depends on: the resolved training configuration, the seeds, the PRNG and every
// other contract version, the physics, timestep and sensors, the split manifest and the training track's hash, the
// generation and simulated-tick budgets, every car's raw outcome in every generation, per-generation statistics, and
// each run's frozen champion (freezeModel) with its provenance. `resultsHash` covers the results.
//
// Boundaries (P2-10). An experiment trains on one built-in training-split track, named by ID, and nothing else: it
// never evaluates a validation or held-out track. Its champion is chosen by training fitness and says so; choosing
// on validation and evaluating on held-out tracks stay with P2-08 and later, through trackSplits.ts.
//
// Replay re-runs every seed from the record's own resolved configuration (never from defaults), compares the
// results, and re-evaluates each frozen champion alone. Results are only promised within one JavaScript engine
// (AI_EVALUATION §4), so a record from another engine, or from different contracts, physics, sensors or tracks,
// is rejected as incompatible before anything runs.
import { INPUT_CONTRACT } from '../ai/inputs';
import { INITIALISATION, PARAMETER_COUNT, PARAMETER_ORDER } from '../ai/network';
import { OUTPUT_CONTRACT } from '../ai/outputs';
import { EVOLUTION_OPERATORS } from '../evolution/population';
import { DEFAULT_SENSOR_CONFIG } from '../sensors/rays';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS, SIMULATION_VERSION, type VehiclePhysics } from '../sim/config';
import { RNG_ALGORITHM } from '../utils/rng';
import { sha256Hex } from '../utils/sha256';
import { FITNESS_VERSION, scoreEpisode, type Episode, type EpisodeOutcome } from './fitness';
import {
  BUILT_IN_TRACK_SPLITS,
  freezeModel,
  trackContentHash,
  trainingTrack,
  TRACK_SPLITS_FORMAT,
  TRACK_SPLITS_VERSION,
  type TrackSplits,
} from './trackSplits';
import {
  createTrainer,
  createTrainingSetup,
  DEFAULT_TRAINING_CONFIG,
  evaluateGenome,
  RNG_STREAMS,
  type GenerationStats,
  type TrainingConfig,
  type TrainingEnvironment,
  type TrainingSetup,
} from './trainer';

export const EXPERIMENT_CONFIG_FORMAT = 'self-driving-ai-evolution/experiment-config';
export const EXPERIMENT_RECORD_FORMAT = 'self-driving-ai-evolution/experiment-record';
export const EXPERIMENT_VERSION = 1;
/** How a run's champion is chosen. It is a training-fitness champion, not a validation-selected model. */
export const CHAMPION_SELECTION = 'best-training-fitness-final-generation';
/** Upper bounds that keep a configuration or an untrusted record from asking for an unbounded run. */
export const MAX_GENERATIONS = 10_000;
export const MAX_SEEDS = 1_000;

/** An experiment configuration that cannot be run (wrong format, field or value). */
export class ExperimentConfigError extends Error {
  override name = 'ExperimentConfigError';
}

/** A record that is malformed (wrong type, unknown field, inconsistent or edited) or incomplete (missing field). */
export class ExperimentRecordError extends Error {
  override name = 'ExperimentRecordError';
}

/** A well-formed record that this engine and code cannot replay: other engine, contracts, physics or tracks. */
export class ExperimentCompatibilityError extends Error {
  override name = 'ExperimentCompatibilityError';
}

/** The JavaScript engine a run used, for example { name: 'node', version: 'v24.22.1', v8: '13.6.233.17-node.33' }. */
export interface ExperimentEngine {
  readonly name: string;
  readonly version: string;
  readonly v8: string;
}

/** The source the run was built from. `revision` is a git commit, or null with the reason it is unavailable. */
export interface ExperimentSource {
  readonly revision: string | null;
  /** True if the worktree had uncommitted changes; null if unknown. */
  readonly dirty: boolean | null;
  readonly unavailableReason: string | null;
  readonly appVersion: string;
}

/** The outside facts a run records; the command line supplies them. */
export interface ExperimentContext {
  readonly engine: ExperimentEngine;
  readonly source: ExperimentSource;
  /** ISO 8601 UTC time the run was recorded. Replay ignores it. */
  readonly recordedAt: string;
}

/** Training settings an experiment may change: every TrainingConfig field except the seed. */
export type TrainingSettings = Omit<TrainingConfig, 'seed'>;

/** A checked experiment configuration with everything resolved. */
export interface ExperimentPlan {
  readonly id: string;
  readonly description: string;
  readonly trackId: string;
  readonly seeds: readonly number[];
  readonly generations: number;
  readonly training: TrainingSettings;
}

/** The contracts and constants a run depends on, all of which must match for replay. */
export interface ExperimentContracts {
  readonly simulationVersion: number;
  readonly rngAlgorithm: string;
  readonly rngStreams: string;
  readonly evolutionOperators: string;
  readonly initialisation: string;
  readonly parameterOrder: string;
  readonly parameterCount: number;
  readonly inputContract: string;
  readonly outputContract: string;
  readonly fitnessVersion: number;
  readonly timestepSeconds: number;
  readonly physics: VehiclePhysics;
  readonly sensors: { readonly origin: string; readonly anglesDegrees: readonly number[]; readonly maxDistance: number };
}

export interface ManifestEntryRecord {
  readonly id: string;
  readonly version: string;
  readonly split: string;
  readonly contentHash: string;
}

export interface ExperimentTracks {
  readonly manifest: {
    readonly format: string;
    readonly version: number;
    readonly entries: readonly ManifestEntryRecord[];
    /** `sha256:` + SHA-256 of the canonical JSON of { format, version, entries }. */
    readonly hash: string;
  };
  readonly training: { readonly id: string; readonly version: string; readonly split: 'training'; readonly contentHash: string };
}

export interface ExperimentBudgets {
  readonly generations: number;
  readonly populationSize: number;
  /** Episodes per run: generations × population. */
  readonly evaluationsPerRun: number;
  readonly maxEpisodeTicks: number;
  readonly stallTicks: number;
  /** The most simulated car-ticks a run can use: evaluationsPerRun × maxEpisodeTicks. */
  readonly maxSimulatedTicksPerRun: number;
}

/** One car's episode, raw: the outcome and every fitness term. */
export interface CarResult {
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
}

export interface GenerationResult {
  readonly generation: number;
  /** Every car, in population order. */
  readonly cars: readonly CarResult[];
  readonly stats: {
    readonly bestFitness: number;
    readonly meanFitness: number;
    readonly worstFitness: number;
    readonly championIndex: number;
    readonly outcomes: Readonly<Record<EpisodeOutcome, number>>;
    readonly carsWithLap: number;
    readonly maxGatesPassed: number;
    readonly generationTicks: number;
    readonly totalEpisodeTicks: number;
  };
}

export type ChampionProvenance = {
  readonly experimentId: string;
  readonly seed: number;
  readonly generation: number;
  readonly carIndex: number;
  readonly trackId: string;
  readonly trackContentHash: string;
  readonly selection: string;
};

/** A run's champion, frozen: its content ID, all parameters at full precision, provenance and episode. */
export interface ChampionRecord {
  readonly id: string;
  readonly parameters: readonly number[];
  readonly provenance: ChampionProvenance;
  readonly episode: CarResult;
}

export interface RunRecord {
  readonly seed: number;
  readonly generations: readonly GenerationResult[];
  /** Simulated car-ticks this run used: the sum of every episode's ticks. */
  readonly simulatedTicks: number;
  readonly champion: ChampionRecord;
}

export interface ExperimentRecord {
  readonly format: string;
  readonly version: number;
  readonly experiment: { readonly id: string; readonly description: string };
  readonly recordedAt: string;
  readonly source: ExperimentSource;
  readonly engine: ExperimentEngine;
  readonly contracts: ExperimentContracts;
  readonly tracks: ExperimentTracks;
  readonly configuration: { readonly seeds: readonly number[]; readonly generations: number; readonly training: TrainingSettings };
  readonly budgets: ExperimentBudgets;
  /** What the record does not contain, stated so no one mistakes it for an evaluation. */
  readonly evaluations: { readonly validation: 'none'; readonly heldOut: 'none' };
  readonly runs: readonly RunRecord[];
  /** `sha256:` + SHA-256 of the canonical JSON of `runs`. */
  readonly resultsHash: string;
}

export interface ReplayResult {
  /** True if every run's results equal the record's and every champion replays alone to its recorded episode. */
  readonly identical: boolean;
  /** Up to 20 JSON paths where the replayed results differ, with both values. Empty when identical. */
  readonly differences: readonly string[];
  /** Per run: whether the frozen champion, evaluated alone, reproduced its recorded episode. */
  readonly championsReplayed: readonly boolean[];
  /** Whether the record's source revision equals the current one, or null when either is unknown. */
  readonly sameSourceRevision: boolean | null;
}

// ---------------------------------------------------------------------------------------------------------------
// Canonical JSON and comparison

/** JSON with object keys sorted at every level, so equal data always gives the same text. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const text = JSON.stringify(value);
    if (text === undefined) throw new ExperimentRecordError(`Value ${String(value)} cannot be written as JSON.`);
    return text;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`;
}

const hashOf = (value: unknown): string => `sha256:${sha256Hex(canonicalJson(value))}`;

/** Paths where two JSON values differ (at most `limit`), depth first. */
function differences(a: unknown, b: unknown, path: string, out: string[], limit: number): void {
  if (out.length >= limit) return;
  const aObject = a !== null && typeof a === 'object';
  const bObject = b !== null && typeof b === 'object';
  if (!aObject || !bObject || Array.isArray(a) !== Array.isArray(b)) {
    if (canonicalJson(a) !== canonicalJson(b)) out.push(`${path}: recorded ${canonicalJson(a)}, replayed ${canonicalJson(b)}`);
    return;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(ao), ...Object.keys(bo)])].sort((x, y) => (Array.isArray(a) ? Number(x) - Number(y) : x < y ? -1 : 1));
  for (const key of keys) differences(ao[key], bo[key], Array.isArray(a) ? `${path}[${key}]` : `${path}.${key}`, out, limit);
}

// ---------------------------------------------------------------------------------------------------------------
// The current engine's contracts and tracks

/** The contracts of the code that is running now. */
export function currentContracts(): ExperimentContracts {
  return {
    simulationVersion: SIMULATION_VERSION,
    rngAlgorithm: RNG_ALGORITHM,
    rngStreams: RNG_STREAMS,
    evolutionOperators: EVOLUTION_OPERATORS,
    initialisation: INITIALISATION.id,
    parameterOrder: PARAMETER_ORDER,
    parameterCount: PARAMETER_COUNT,
    inputContract: INPUT_CONTRACT,
    outputContract: OUTPUT_CONTRACT,
    fitnessVersion: FITNESS_VERSION,
    timestepSeconds: DEFAULT_SIM_CONFIG.timestepSeconds,
    physics: { ...DEFAULT_VEHICLE_PHYSICS },
    sensors: {
      origin: DEFAULT_SENSOR_CONFIG.origin,
      anglesDegrees: [...DEFAULT_SENSOR_CONFIG.anglesDegrees],
      maxDistance: DEFAULT_SENSOR_CONFIG.maxDistance,
    },
  };
}

/** The split manifest as a record holds it: every entry and a hash of them. */
export function manifestRecord(splits: TrackSplits = BUILT_IN_TRACK_SPLITS): ExperimentTracks['manifest'] {
  const entries = splits.tracks.map(({ id, version, split, contentHash }) => ({ id, version, split, contentHash }));
  const body = { format: TRACK_SPLITS_FORMAT, version: TRACK_SPLITS_VERSION, entries };
  return { ...body, hash: hashOf(body) };
}

const isBuiltIn = (trackId: string): boolean => BUILT_IN_TRACK_SPLITS.tracks.some((t) => t.id === trackId);

const environmentFor = (trackId: string): TrainingEnvironment => ({
  // trainingTrack throws TrackLeakageError for a validation or held-out track.
  track: trainingTrack(trackId),
  physics: DEFAULT_VEHICLE_PHYSICS,
  timestepSeconds: DEFAULT_SIM_CONFIG.timestepSeconds,
});

// ---------------------------------------------------------------------------------------------------------------
// Configuration

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const TRAINING_KEYS = Object.freeze(Object.keys(DEFAULT_TRAINING_CONFIG).filter((key) => key !== 'seed'));
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

const isSeed = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff;

/** Resolves training settings with `seed`, through the trainer's own validation. */
function resolveSettings(settings: Record<string, unknown>, seed: number, environment: TrainingEnvironment): TrainingSetup {
  return createTrainingSetup({ ...settings, seed }, environment);
}

const withoutSeed = (config: TrainingConfig): TrainingSettings => {
  const { seed, ...settings } = config;
  void seed;
  return settings;
};

/**
 * Checks an experiment configuration and resolves it. `training` may set any training field except `seed`; each
 * field it sets replaces the default whole (nested blocks are never merged). Throws ExperimentConfigError for a
 * wrong format or version, an unknown or missing field, a bad ID, seed list or generation count, or settings the
 * trainer rejects; TrackLeakageError for a validation or held-out track.
 */
export function resolveExperimentConfig(input: unknown): ExperimentPlan {
  const fail = (message: string): never => {
    throw new ExperimentConfigError(`Experiment config: ${message}`);
  };
  if (!isPlainObject(input)) fail('must be a JSON object.');
  const c = input as Record<string, unknown>;
  const allowed = ['format', 'version', 'id', 'description', 'trackId', 'seeds', 'generations', 'training'];
  for (const key of Object.keys(c)) if (!allowed.includes(key)) fail(`unknown field "${key}".`);
  if (c.format !== EXPERIMENT_CONFIG_FORMAT) fail(`"format" must be "${EXPERIMENT_CONFIG_FORMAT}", got ${String(c.format)}.`);
  if (c.version !== EXPERIMENT_VERSION) fail(`"version" must be ${EXPERIMENT_VERSION}, got ${String(c.version)}.`);
  if (typeof c.id !== 'string' || !ID_PATTERN.test(c.id)) {
    fail(`"id" must be 1 to 64 lower-case letters, digits or hyphens, starting with a letter or digit, got ${String(c.id)}.`);
  }
  const description = c.description ?? '';
  if (typeof description !== 'string' || description.length > 1000) fail('"description" must be a string of at most 1000 characters.');
  if (typeof c.trackId !== 'string') fail(`"trackId" must name a built-in training track, got ${String(c.trackId)}.`);
  const { seeds, generations } = c;
  if (!Array.isArray(seeds) || seeds.length === 0 || seeds.length > MAX_SEEDS) fail(`"seeds" must be a list of 1 to ${MAX_SEEDS} seeds.`);
  const seedList = seeds as unknown[];
  for (const seed of seedList) if (!isSeed(seed)) fail(`every seed must be an integer from 0 to 4294967295, got ${String(seed)}.`);
  if (new Set(seedList).size !== seedList.length) fail('"seeds" must not repeat a seed.');
  if (typeof generations !== 'number' || !Number.isInteger(generations) || generations < 1 || generations > MAX_GENERATIONS) {
    fail(`"generations" must be an integer from 1 to ${MAX_GENERATIONS}, got ${String(generations)}.`);
  }
  const overrides = c.training ?? {};
  if (!isPlainObject(overrides)) fail('"training" must be an object.');
  for (const key of Object.keys(overrides as object)) {
    if (key === 'seed') fail('"training.seed" is not allowed; list the seeds in "seeds".');
    if (!TRAINING_KEYS.includes(key)) fail(`unknown training field "training.${key}".`);
  }
  if (!isBuiltIn(c.trackId as string)) fail(`"trackId": no built-in track "${String(c.trackId)}".`);
  const environment = environmentFor(c.trackId as string);
  const merged = { ...withoutSeed(DEFAULT_TRAINING_CONFIG), ...(overrides as Record<string, unknown>) };
  let setup: TrainingSetup;
  try {
    setup = resolveSettings(merged, seedList[0] as number, environment);
  } catch (error) {
    if (error instanceof RangeError) return fail(`"training": ${error.message}`);
    throw error;
  }
  return Object.freeze({
    id: c.id as string,
    description: description as string,
    trackId: environment.track.id,
    seeds: Object.freeze([...(seedList as number[])]),
    generations: generations as number,
    training: withoutSeed(setup.config),
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Running

function carResult(episode: Episode, setup: TrainingSetup): CarResult {
  const breakdown = scoreEpisode(episode, setup.config.fitness, setup.rules);
  return {
    outcome: episode.outcome!,
    ticks: episode.tick,
    gatesPassed: episode.gatesPassed,
    lapTicks: [...episode.lapTicks],
    crashed: episode.crashed,
    partialProgress: episode.partialProgress,
    fitness: {
      checkpoints: breakdown.checkpoints,
      partialProgress: breakdown.partialProgress,
      laps: breakdown.laps,
      lapTimeBonus: breakdown.lapTimeBonus,
      collisionPenalty: breakdown.collisionPenalty,
      total: breakdown.total,
    },
  };
}

function statsResult(stats: GenerationStats): GenerationResult['stats'] {
  return {
    bestFitness: stats.bestFitness,
    meanFitness: stats.meanFitness,
    worstFitness: stats.worstFitness,
    championIndex: stats.championIndex,
    outcomes: { ...stats.outcomes },
    carsWithLap: stats.carsWithLap,
    maxGatesPassed: stats.maxGatesPassed,
    generationTicks: stats.generationTicks,
    totalEpisodeTicks: stats.totalEpisodeTicks,
  };
}

/** One independent training run: a fresh trainer for `seed`, sharing nothing with any other run. */
function runSeed(plan: ExperimentPlan, seed: number): RunRecord {
  const environment = environmentFor(plan.trackId);
  const trainer = createTrainer({ ...plan.training, seed }, environment);
  const { setup } = trainer;
  const generations: GenerationResult[] = [];
  let last: GenerationStats | null = null;
  for (let g = 0; g < plan.generations; g += 1) {
    last = trainer.runGeneration();
    const finished = trainer.finished()!;
    generations.push({ generation: last.generation, cars: finished.cars.map((car) => carResult(car.episode, setup)), stats: statsResult(last) });
  }
  const final = generations[generations.length - 1]!;
  const provenance: ChampionProvenance = {
    experimentId: plan.id,
    seed,
    generation: final.generation,
    carIndex: last!.championIndex,
    trackId: environment.track.id,
    trackContentHash: setup.versions.trackHash,
    selection: CHAMPION_SELECTION,
  };
  const frozen = freezeModel(last!.champion, { ...provenance });
  return {
    seed,
    generations,
    simulatedTicks: generations.reduce((total, gen) => total + gen.stats.totalEpisodeTicks, 0),
    champion: { id: frozen.id, parameters: [...frozen.parameters], provenance, episode: final.cars[last!.championIndex]! },
  };
}

function budgetsFor(plan: ExperimentPlan): ExperimentBudgets {
  const setup = resolveSettings({ ...plan.training }, plan.seeds[0]!, environmentFor(plan.trackId));
  const evaluationsPerRun = plan.generations * plan.training.populationSize;
  return {
    generations: plan.generations,
    populationSize: plan.training.populationSize,
    evaluationsPerRun,
    maxEpisodeTicks: setup.rules.maxEpisodeTicks,
    stallTicks: setup.rules.stallTicks,
    maxSimulatedTicksPerRun: evaluationsPerRun * setup.rules.maxEpisodeTicks,
  };
}

function tracksFor(plan: ExperimentPlan): ExperimentTracks {
  const track = trainingTrack(plan.trackId);
  return {
    manifest: manifestRecord(),
    training: { id: track.id, version: track.version, split: 'training', contentHash: trackContentHash(track) },
  };
}

function checkContext(context: ExperimentContext): void {
  const fail = (message: string): never => {
    throw new ExperimentConfigError(`Experiment context: ${message}`);
  };
  if (!isPlainObject(context)) fail('must be an object.');
  const { engine, source, recordedAt } = context;
  if (!isPlainObject(engine) || [engine.name, engine.version, engine.v8].some((v) => typeof v !== 'string' || v.length === 0)) {
    fail('"engine" needs a name, version and v8 version.');
  }
  checkSource(source, (message) => fail(message));
  if (typeof recordedAt !== 'string' || !ISO_TIME.test(recordedAt)) fail(`"recordedAt" must be an ISO 8601 UTC time, got ${String(recordedAt)}.`);
}

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const REVISION = /^[0-9a-f]{40}$/;

function checkSource(source: unknown, fail: (message: string) => never): void {
  if (!isPlainObject(source)) fail('"source" must be an object.');
  const s = source as Record<string, unknown>;
  if (typeof s.appVersion !== 'string' || s.appVersion.length === 0) fail('"source.appVersion" must be a non-empty string.');
  if (s.revision === null) {
    if (s.dirty !== null) fail('"source.dirty" must be null when the revision is unknown.');
    if (typeof s.unavailableReason !== 'string' || s.unavailableReason.length === 0) fail('"source.unavailableReason" must say why the revision is unknown.');
  } else {
    if (typeof s.revision !== 'string' || !REVISION.test(s.revision)) fail(`"source.revision" must be a 40-character git commit or null, got ${String(s.revision)}.`);
    if (typeof s.dirty !== 'boolean') fail('"source.dirty" must be a boolean when the revision is known.');
    if (s.unavailableReason !== null) fail('"source.unavailableReason" must be null when the revision is known.');
  }
}

/**
 * Runs an experiment and returns its record. `input` is an experiment configuration (see resolveExperimentConfig);
 * `context` holds the engine, source revision and recording time. Each seed is an independent run, so a run's
 * results do not depend on the other seeds or their order. No validation or held-out track is used.
 */
export function runExperiment(input: unknown, context: ExperimentContext): ExperimentRecord {
  const plan = resolveExperimentConfig(input);
  checkContext(context);
  return buildRecord(plan, context, plan.seeds.map((seed) => runSeed(plan, seed)));
}

function buildRecord(plan: ExperimentPlan, context: ExperimentContext, runs: readonly RunRecord[]): ExperimentRecord {
  return {
    format: EXPERIMENT_RECORD_FORMAT,
    version: EXPERIMENT_VERSION,
    experiment: { id: plan.id, description: plan.description },
    recordedAt: context.recordedAt,
    source: {
      revision: context.source.revision,
      dirty: context.source.dirty,
      unavailableReason: context.source.unavailableReason,
      appVersion: context.source.appVersion,
    },
    engine: { name: context.engine.name, version: context.engine.version, v8: context.engine.v8 },
    contracts: currentContracts(),
    tracks: tracksFor(plan),
    configuration: { seeds: [...plan.seeds], generations: plan.generations, training: JSON.parse(JSON.stringify(plan.training)) as TrainingSettings },
    budgets: budgetsFor(plan),
    evaluations: { validation: 'none', heldOut: 'none' },
    runs,
    resultsHash: hashOf(runs),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Reading a record

type Fail = (message: string) => never;

/** Checks that `value` is an object with exactly `keys`: a missing key is incomplete, an extra one malformed. */
function exactObject(value: unknown, path: string, keys: readonly string[], fail: Fail): Record<string, unknown> {
  if (!isPlainObject(value)) return fail(`${path} must be an object.`);
  for (const key of keys) if (!(key in value)) fail(`incomplete: ${path}.${key} is missing.`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${path} has an unknown field "${key}".`);
  return value;
}

const finite = (value: unknown, path: string, fail: Fail): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fail(`${path} must be a finite number, got ${String(value)}.`);
const integer = (value: unknown, path: string, min: number, max: number, fail: Fail): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fail(`${path} must be an integer from ${min} to ${max}, got ${String(value)}.`);
const text = (value: unknown, path: string, fail: Fail): string => (typeof value === 'string' ? value : fail(`${path} must be a string.`));
const list = (value: unknown, path: string, fail: Fail, length?: number): unknown[] => {
  if (!Array.isArray(value)) return fail(`${path} must be an array.`);
  if (length !== undefined && value.length !== length) fail(`${path} must have ${length} entries, got ${value.length}.`);
  return value;
};

const OUTCOMES: readonly EpisodeOutcome[] = ['completed', 'crashed', 'stalled', 'timeout'];
const CAR_KEYS = ['outcome', 'ticks', 'gatesPassed', 'lapTicks', 'crashed', 'partialProgress', 'fitness'];
const FITNESS_KEYS = ['checkpoints', 'partialProgress', 'laps', 'lapTimeBonus', 'collisionPenalty', 'total'];
const STATS_KEYS = ['bestFitness', 'meanFitness', 'worstFitness', 'championIndex', 'outcomes', 'carsWithLap', 'maxGatesPassed', 'generationTicks', 'totalEpisodeTicks'];

function checkCar(value: unknown, path: string, maxTicks: number, fail: Fail): void {
  const car = exactObject(value, path, CAR_KEYS, fail);
  if (!OUTCOMES.includes(car.outcome as EpisodeOutcome)) fail(`${path}.outcome must be one of ${OUTCOMES.join(', ')}.`);
  integer(car.ticks, `${path}.ticks`, 0, maxTicks, fail);
  integer(car.gatesPassed, `${path}.gatesPassed`, 0, Number.MAX_SAFE_INTEGER, fail);
  list(car.lapTicks, `${path}.lapTicks`, fail).forEach((t, i) => integer(t, `${path}.lapTicks[${i}]`, 1, maxTicks, fail));
  if (typeof car.crashed !== 'boolean') fail(`${path}.crashed must be a boolean.`);
  finite(car.partialProgress, `${path}.partialProgress`, fail);
  const terms = exactObject(car.fitness, `${path}.fitness`, FITNESS_KEYS, fail);
  for (const key of FITNESS_KEYS) finite(terms[key], `${path}.fitness.${key}`, fail);
}

function checkStats(value: unknown, path: string, populationSize: number, fail: Fail): Record<string, unknown> {
  const stats = exactObject(value, path, STATS_KEYS, fail);
  for (const key of ['bestFitness', 'meanFitness', 'worstFitness']) finite(stats[key], `${path}.${key}`, fail);
  integer(stats.championIndex, `${path}.championIndex`, 0, populationSize - 1, fail);
  const outcomes = exactObject(stats.outcomes, `${path}.outcomes`, OUTCOMES, fail);
  for (const key of OUTCOMES) integer(outcomes[key], `${path}.outcomes.${key}`, 0, populationSize, fail);
  for (const key of ['carsWithLap', 'maxGatesPassed', 'generationTicks', 'totalEpisodeTicks']) {
    integer(stats[key], `${path}.${key}`, 0, Number.MAX_SAFE_INTEGER, fail);
  }
  return stats;
}

/**
 * Checks a parsed record completely, before anything runs, and returns it. Throws ExperimentRecordError for a
 * malformed record (wrong format or version, a wrong type or non-finite number, an unknown field, counts that
 * disagree with the configuration, a champion whose ID does not match its parameters, a stale resultsHash) or an
 * incomplete one (a missing field); ExperimentCompatibilityError if this engine or code cannot replay it (other
 * engine, contracts, physics, sensors, manifest or track hash); and TrackLeakageError if its training track is
 * not a training track.
 */
export function parseExperimentRecord(input: unknown, engine: ExperimentEngine): ExperimentRecord {
  const fail: Fail = (message) => {
    throw new ExperimentRecordError(`Experiment record: ${message}`);
  };
  const incompatible: Fail = (message) => {
    throw new ExperimentCompatibilityError(`Experiment record is incompatible: ${message}`);
  };
  const r = exactObject(input, 'record', [
    'format', 'version', 'experiment', 'recordedAt', 'source', 'engine', 'contracts', 'tracks', 'configuration', 'budgets', 'evaluations', 'runs', 'resultsHash',
  ], fail);
  if (r.format !== EXPERIMENT_RECORD_FORMAT) fail(`"format" must be "${EXPERIMENT_RECORD_FORMAT}", got ${String(r.format)}.`);
  if (r.version !== EXPERIMENT_VERSION) fail(`"version" must be ${EXPERIMENT_VERSION}, got ${String(r.version)}.`);
  const experiment = exactObject(r.experiment, 'experiment', ['id', 'description'], fail);
  if (typeof experiment.id !== 'string' || !ID_PATTERN.test(experiment.id)) fail('experiment.id is not a valid experiment ID.');
  text(experiment.description, 'experiment.description', fail);
  if (typeof r.recordedAt !== 'string' || !ISO_TIME.test(r.recordedAt)) fail('recordedAt must be an ISO 8601 UTC time.');
  exactObject(r.source, 'source', ['revision', 'dirty', 'unavailableReason', 'appVersion'], fail);
  checkSource(r.source, (message) => fail(message));
  const recordedEngine = exactObject(r.engine, 'engine', ['name', 'version', 'v8'], fail);
  for (const key of ['name', 'version', 'v8']) text(recordedEngine[key], `engine.${key}`, fail);
  const evaluations = exactObject(r.evaluations, 'evaluations', ['validation', 'heldOut'], fail);
  if (evaluations.validation !== 'none' || evaluations.heldOut !== 'none') fail('evaluations must be { validation: "none", heldOut: "none" }.');

  // Contracts: shape first, then equality with the running code.
  const contracts = exactObject(r.contracts, 'contracts', Object.keys(currentContracts()), fail);
  const current = currentContracts();
  exactObject(contracts.physics, 'contracts.physics', Object.keys(current.physics), fail);
  exactObject(contracts.sensors, 'contracts.sensors', Object.keys(current.sensors), fail);
  const tracks = exactObject(r.tracks, 'tracks', ['manifest', 'training'], fail);
  const manifest = exactObject(tracks.manifest, 'tracks.manifest', ['format', 'version', 'entries', 'hash'], fail);
  list(manifest.entries, 'tracks.manifest.entries', fail).forEach((entry, i) =>
    exactObject(entry, `tracks.manifest.entries[${i}]`, ['id', 'version', 'split', 'contentHash'], fail),
  );
  const training = exactObject(tracks.training, 'tracks.training', ['id', 'version', 'split', 'contentHash'], fail);
  text(training.id, 'tracks.training.id', fail);
  if (manifest.hash !== hashOf({ format: manifest.format, version: manifest.version, entries: manifest.entries })) {
    fail('tracks.manifest.hash does not match its entries.');
  }

  // Configuration and budgets.
  const configuration = exactObject(r.configuration, 'configuration', ['seeds', 'generations', 'training'], fail);
  const seeds = list(configuration.seeds, 'configuration.seeds', fail);
  if (seeds.length === 0 || seeds.length > MAX_SEEDS) fail(`configuration.seeds must have 1 to ${MAX_SEEDS} seeds.`);
  seeds.forEach((seed, i) => {
    if (!isSeed(seed)) fail(`configuration.seeds[${i}] must be an integer from 0 to 4294967295.`);
  });
  if (new Set(seeds).size !== seeds.length) fail('configuration.seeds repeats a seed.');
  const generations = integer(configuration.generations, 'configuration.generations', 1, MAX_GENERATIONS, fail);
  const settings = exactObject(configuration.training, 'configuration.training', TRAINING_KEYS, fail);

  // Compatibility: same engine, contracts and tracks as the code running now.
  for (const key of ['name', 'version', 'v8'] as const) {
    if (recordedEngine[key] !== engine[key]) {
      incompatible(`it was recorded with engine ${String(recordedEngine.name)} ${String(recordedEngine.version)} (V8 ${String(recordedEngine.v8)}), ` +
        `but this is ${engine.name} ${engine.version} (V8 ${engine.v8}); results are only reproducible within one engine.`);
    }
  }
  for (const key of Object.keys(current) as (keyof ExperimentContracts)[]) {
    if (canonicalJson(contracts[key]) !== canonicalJson(current[key])) {
      incompatible(`contracts.${key} is ${canonicalJson(contracts[key])}, but this code has ${canonicalJson(current[key])}.`);
    }
  }
  const currentManifest = manifestRecord();
  if (canonicalJson(manifest) !== canonicalJson(currentManifest)) {
    incompatible(`its track split manifest (${String(manifest.hash)}) differs from this code's (${currentManifest.hash}).`);
  }
  // An unknown ID is incompatible; trainingTrack throws TrackLeakageError for a validation or held-out track.
  if (!isBuiltIn(training.id as string)) incompatible(`its training track "${String(training.id)}" is not a built-in track here.`);
  const track = trainingTrack(training.id as string);
  const expectedTraining = { id: track.id, version: track.version, split: 'training', contentHash: trackContentHash(track) };
  if (canonicalJson(training) !== canonicalJson(expectedTraining)) {
    incompatible(`tracks.training is ${canonicalJson(training)}, but this code's track is ${canonicalJson(expectedTraining)}.`);
  }

  // The training settings must already be a complete resolved configuration: resolving them changes nothing.
  let setup: TrainingSetup;
  try {
    setup = resolveSettings(settings, seeds[0] as number, environmentFor(track.id));
  } catch (error) {
    if (error instanceof RangeError) return fail(`configuration.training: ${error.message}`);
    throw error;
  }
  if (canonicalJson(withoutSeed(setup.config)) !== canonicalJson(settings)) {
    fail('configuration.training is not a complete resolved training configuration.');
  }
  const plan: ExperimentPlan = {
    id: experiment.id as string,
    description: experiment.description as string,
    trackId: track.id,
    seeds: seeds as number[],
    generations,
    training: withoutSeed(setup.config),
  };
  const budgets = exactObject(r.budgets, 'budgets', Object.keys(budgetsFor(plan)), fail);
  if (canonicalJson(budgets) !== canonicalJson(budgetsFor(plan))) fail('budgets do not match the configuration.');

  // Results.
  const populationSize = plan.training.populationSize;
  const maxTicks = setup.rules.maxEpisodeTicks;
  const runs = list(r.runs, 'runs', fail, seeds.length);
  runs.forEach((value, i) => {
    const path = `runs[${i}]`;
    const run = exactObject(value, path, ['seed', 'generations', 'simulatedTicks', 'champion'], fail);
    if (run.seed !== seeds[i]) fail(`${path}.seed must be configuration.seeds[${i}] (${String(seeds[i])}).`);
    const gens = list(run.generations, `${path}.generations`, fail, generations);
    let used = 0;
    gens.forEach((genValue, g) => {
      const genPath = `${path}.generations[${g}]`;
      const gen = exactObject(genValue, genPath, ['generation', 'cars', 'stats'], fail);
      if (gen.generation !== g) fail(`${genPath}.generation must be ${g}.`);
      list(gen.cars, `${genPath}.cars`, fail, populationSize).forEach((car, c) => checkCar(car, `${genPath}.cars[${c}]`, maxTicks, fail));
      const stats = checkStats(gen.stats, `${genPath}.stats`, populationSize, fail);
      used += stats.totalEpisodeTicks as number;
    });
    if (run.simulatedTicks !== used) fail(`${path}.simulatedTicks must be the sum of its generations' totalEpisodeTicks (${used}).`);
    if (used > plan.generations * populationSize * maxTicks) fail(`${path} used more simulated ticks than its budget.`);
    const champion = exactObject(run.champion, `${path}.champion`, ['id', 'parameters', 'provenance', 'episode'], fail);
    const parameters = list(champion.parameters, `${path}.champion.parameters`, fail, PARAMETER_COUNT);
    parameters.forEach((p, k) => finite(p, `${path}.champion.parameters[${k}]`, fail));
    const provenance = exactObject(champion.provenance, `${path}.champion.provenance`, [
      'experimentId', 'seed', 'generation', 'carIndex', 'trackId', 'trackContentHash', 'selection',
    ], fail);
    const finalGen = gens[generations - 1] as Record<string, unknown>;
    const finalStats = finalGen.stats as Record<string, unknown>;
    const expected: ChampionProvenance = {
      experimentId: plan.id,
      seed: seeds[i] as number,
      generation: generations - 1,
      carIndex: finalStats.championIndex as number,
      trackId: track.id,
      trackContentHash: expectedTraining.contentHash,
      selection: CHAMPION_SELECTION,
    };
    if (canonicalJson(provenance) !== canonicalJson(expected)) fail(`${path}.champion.provenance does not match the run.`);
    if (champion.id !== freezeModel(parameters as number[], expected).id) fail(`${path}.champion.id does not match its parameters and provenance.`);
    checkCar(champion.episode, `${path}.champion.episode`, maxTicks, fail);
    const championCar = (finalGen.cars as unknown[])[expected.carIndex];
    if (canonicalJson(champion.episode) !== canonicalJson(championCar)) fail(`${path}.champion.episode must equal its car in the final generation.`);
  });
  if (r.resultsHash !== hashOf(r.runs)) fail('resultsHash does not match the results; the record was changed or corrupted.');
  return input as ExperimentRecord;
}

// ---------------------------------------------------------------------------------------------------------------
// Replay

/**
 * Re-runs a record in this engine and compares the results. The record is checked first (parseExperimentRecord,
 * which throws for malformed, incomplete or incompatible records). Every seed is re-run from the record's own
 * resolved configuration, and each frozen champion is also evaluated alone and compared with its recorded episode.
 * `source` is the current source, used only to report whether the revision is the same.
 */
export function replayExperiment(input: unknown, engine: ExperimentEngine, source?: ExperimentSource): ReplayResult {
  const record = parseExperimentRecord(input, engine);
  const plan: ExperimentPlan = {
    id: record.experiment.id,
    description: record.experiment.description,
    trackId: record.tracks.training.id,
    seeds: record.configuration.seeds,
    generations: record.configuration.generations,
    training: record.configuration.training,
  };
  const runs = plan.seeds.map((seed) => runSeed(plan, seed));
  const found: string[] = [];
  differences(record.runs, runs, 'runs', found, 20);
  const championsReplayed = record.runs.map((run) => replayChampion(record, run));
  const sameSourceRevision = source && source.revision !== null && record.source.revision !== null ? source.revision === record.source.revision : null;
  return { identical: found.length === 0 && championsReplayed.every(Boolean), differences: found, championsReplayed, sameSourceRevision };
}

/**
 * Evaluates one run's frozen champion alone, on the record's training track with its configuration, and reports
 * whether the episode equals the recorded one. The record must already be checked (parseExperimentRecord).
 */
export function replayChampion(record: ExperimentRecord, run: RunRecord): boolean {
  const setup = resolveSettings({ ...record.configuration.training }, run.seed, environmentFor(record.tracks.training.id));
  const car = evaluateGenome(Float64Array.from(run.champion.parameters), setup);
  return canonicalJson(carResult(car.episode, setup)) === canonicalJson(run.champion.episode);
}
