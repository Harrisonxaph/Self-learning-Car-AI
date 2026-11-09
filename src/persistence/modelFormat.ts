// The saved model format v1 (docs/MODEL_FORMAT.md): building a document from a champion and validating one that was read
// back. Pure: no DOM, no storage, no clock, no randomness; the identifiers and the time are passed in. A reader never
// trusts what it parses: every field is checked, numbers must be finite, sizes are bounded before anything is allocated,
// and `validateModel` returns every error it finds rather than the first. Unknown extra fields are ignored and not kept.
import { INPUT_NAMES, INPUT_CONTRACT } from '../ai/inputs';
import { LAYERS, PARAMETER_COUNT, PARAMETER_ORDER } from '../ai/network';
import { OUTPUT_CONTRACT } from '../ai/outputs';
import { DEFAULT_SENSOR_CONFIG } from '../sensors/rays';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS, SIMULATION_VERSION, terminalSpeed, type VehiclePhysics } from '../sim/config';
import { RNG_ALGORITHM } from '../utils/rng';

export const MODEL_FORMAT = 'self-driving-ai-evolution/model';
export const MODEL_SCHEMA_VERSION = 1;
/** A stored entry or a file over this many characters is rejected before it is parsed (MODEL_FORMAT.md, "Size"). */
export const MAX_MODEL_BYTES = 1_048_576;

/**
 * The size of `text` in UTF-8 bytes, which is what a file or a download holds (the limit is in bytes, not UTF-16 code
 * units: a multibyte character is up to 3 bytes per code unit). Text longer than the limit in code units is already
 * over it, so only text that could fit is encoded.
 */
export function utf8Bytes(text: string): number {
  return text.length > MAX_MODEL_BYTES ? text.length : new TextEncoder().encode(text).length;
}
export const PRNG_VERSION = 1;
/** Ids become storage keys, so they are limited to plain characters. */
export const MODEL_ID_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const HIDDEN_ACTIVATION = 'tanh';
const OUTPUT_ACTIVATIONS = Object.freeze(['tanh', 'sigmoid', 'sigmoid'] as const);
const OUTPUT_NAMES = Object.freeze(['steering', 'throttle', 'brake'] as const);
/** The largest relative difference allowed between a stored `maxSpeed` and the speed recomputed from the other physics fields. */
const MAX_SPEED_TOLERANCE = 1e-9;
/** Bounds a saved run's settings must lie within; they mirror what the trainer accepts, so a model that validates can be set up. */
export const MAX_POPULATION_SIZE = 100_000;
export const MIN_TIMESTEP_SECONDS = 0.001;
export const MAX_TIMESTEP_SECONDS = 0.1;
const MAX_LIMIT_SECONDS = 1_000_000;

// Persistence handles saved data only (docs/ARCHITECTURE.md), so it does not import the training code: the settings it
// stores are described here, and a run's `TrainingRecord` satisfies `RunRecord` structurally. The track registry is passed in.
export interface SelectionSettings {
  readonly type: string;
  readonly size: number;
}
export interface CrossoverSettings {
  readonly type: string;
  readonly rate: number;
}
export interface MutationSettings {
  readonly rate: number;
  readonly scale: number;
}
export interface FitnessSettings {
  readonly version: number;
  readonly checkpointWeight: number;
  readonly partialProgressWeight: number;
  readonly lapWeight: number;
  readonly collisionPenalty: number;
  readonly lapTimeBonusScale: number;
  readonly referenceLapSeconds: number;
  readonly maxLapTimeRatio: number;
}

/** What a saved model needs from a finished or running training run (`trainer.record()` provides it). */
export interface RunRecord {
  readonly config: {
    readonly seed: number;
    readonly populationSize: number;
    readonly eliteCount: number;
    readonly selection: SelectionSettings;
    readonly crossover: CrossoverSettings;
    readonly mutation: MutationSettings;
    readonly maxEpisodeSeconds: number;
    readonly stallSeconds: number;
    readonly maxLaps: number;
    readonly brakeEnabled: boolean;
    readonly fitness: FitnessSettings;
  };
  readonly versions: {
    readonly rngAlgorithm: string;
    readonly inputContract: string;
    readonly outputContract: string;
    readonly trackId: string;
    readonly trackVersion: string;
    readonly trackHash: string;
    readonly trackSplit: string;
  };
  readonly physics: VehiclePhysics;
  readonly timestepSeconds: number;
  readonly sensors: { readonly origin: string; readonly anglesDegrees: readonly number[]; readonly maxDistance: number };
}

/** A registered training track, as the track-splits manifest names it. */
export interface TrackRegistryEntry {
  readonly id: string;
  readonly version: string;
  readonly contentHash: string;
}

export interface ModelDocument {
  readonly format: typeof MODEL_FORMAT;
  readonly schemaVersion: typeof MODEL_SCHEMA_VERSION;
  readonly id: string;
  readonly name?: string;
  readonly createdAt: string;
  readonly appVersion?: string;
  readonly codeVersion: string;
  readonly simulationVersion: number;
  readonly architecture: {
    readonly type: 'feedforward';
    readonly layers: readonly number[];
    readonly hiddenActivation: string;
    readonly outputActivations: readonly string[];
    readonly inputs: readonly string[];
    readonly outputs: readonly string[];
    readonly brakeEnabled: boolean;
  };
  readonly parameters: { readonly order: string; readonly count: number; readonly values: readonly number[] };
  readonly fitness: number;
  readonly training: {
    readonly generation: number;
    readonly seed: number | null;
    readonly seedUnavailableReason?: string;
    readonly populationSize: number;
    readonly eliteCount: number;
    readonly selection: SelectionSettings;
    readonly crossover: CrossoverSettings;
    readonly mutation: MutationSettings;
    readonly maxEpisodeSeconds: number;
    readonly fitnessVersion: number;
    readonly trackIds: readonly string[];
    readonly trackVersions: Readonly<Record<string, string>>;
    /** Content hash of each training track (`sha256:…`), from the track-splits manifest. */
    readonly trackHashes: Readonly<Record<string, string>>;
    readonly configuration: {
      readonly timestepSeconds: number;
      readonly prng: { readonly algorithm: string; readonly version: number };
      readonly populationSize: number;
      readonly eliteCount: number;
      readonly selection: SelectionSettings;
      readonly crossover: CrossoverSettings;
      readonly mutation: MutationSettings;
      /** The generation budget of a batch run, or null for an open-ended interactive run. */
      readonly generations: number | null;
      readonly maxEpisodeSeconds: number;
      readonly stallSeconds: number;
      readonly maxLaps: number;
      readonly brakeEnabled: boolean;
      readonly physics: VehiclePhysics;
      readonly sensors: { readonly origin: string; readonly anglesDegrees: readonly number[]; readonly maxDistance: number };
      readonly fitness: FitnessSettings;
      readonly inputContract: string;
      readonly outputContract: string;
    };
  };
  readonly evaluation: readonly unknown[];
}

export interface BuildModelInput {
  /** The champion's 159 parameters. */
  readonly champion: ArrayLike<number>;
  /** The champion's fitness. */
  readonly fitness: number;
  /** The generation it won (0 for the initial population). */
  readonly generation: number;
  /** The run's configuration, versions and settings (`trainer.record()`). */
  readonly record: RunRecord;
  /** A fresh identifier (a UUID); making one must not consume a simulation or evolution random stream. */
  readonly id: string;
  /** ISO 8601 UTC time of the save. */
  readonly createdAt: string;
  readonly codeVersion: string;
  readonly appVersion?: string | undefined;
  readonly name?: string | undefined;
}

/**
 * The v1 document for a champion of a recorded run. Throws RangeError if the run was not on a registered training track,
 * since a saved model must name training data it is allowed to claim. Values are copied at full precision.
 */
export function buildModel(input: BuildModelInput): ModelDocument {
  const { record, champion } = input;
  const { config, versions, physics, sensors } = record;
  if (versions.trackSplit !== 'training') throw new RangeError('Only a champion trained on a registered training track can be saved.');
  const configuration = {
    timestepSeconds: record.timestepSeconds,
    prng: { algorithm: versions.rngAlgorithm, version: PRNG_VERSION },
    populationSize: config.populationSize,
    eliteCount: config.eliteCount,
    selection: { ...config.selection },
    crossover: { ...config.crossover },
    mutation: { ...config.mutation },
    generations: null,
    maxEpisodeSeconds: config.maxEpisodeSeconds,
    stallSeconds: config.stallSeconds,
    maxLaps: config.maxLaps,
    brakeEnabled: config.brakeEnabled,
    physics: { ...physics },
    sensors: { origin: sensors.origin, anglesDegrees: [...sensors.anglesDegrees], maxDistance: sensors.maxDistance },
    fitness: { ...config.fitness },
    inputContract: versions.inputContract,
    outputContract: versions.outputContract,
  };
  return {
    format: MODEL_FORMAT,
    schemaVersion: MODEL_SCHEMA_VERSION,
    id: input.id,
    ...(input.name === undefined ? {} : { name: input.name }),
    createdAt: input.createdAt,
    ...(input.appVersion === undefined ? {} : { appVersion: input.appVersion }),
    codeVersion: input.codeVersion,
    simulationVersion: SIMULATION_VERSION,
    architecture: {
      type: 'feedforward',
      layers: [...LAYERS],
      hiddenActivation: HIDDEN_ACTIVATION,
      outputActivations: [...OUTPUT_ACTIVATIONS],
      inputs: [...INPUT_NAMES],
      outputs: [...OUTPUT_NAMES],
      brakeEnabled: config.brakeEnabled,
    },
    // JSON has no negative zero (it is written as 0), so it is stored as 0 here too: what is built equals what is read back.
    parameters: { order: PARAMETER_ORDER, count: champion.length, values: Array.from(champion, (v) => (v === 0 ? 0 : v)) },
    fitness: input.fitness,
    training: {
      generation: input.generation,
      seed: config.seed,
      populationSize: config.populationSize,
      eliteCount: config.eliteCount,
      selection: { ...config.selection },
      crossover: { ...config.crossover },
      mutation: { ...config.mutation },
      maxEpisodeSeconds: config.maxEpisodeSeconds,
      fitnessVersion: config.fitness.version,
      trackIds: [versions.trackId],
      trackVersions: { [versions.trackId]: versions.trackVersion },
      trackHashes: { [versions.trackId]: versions.trackHash },
      configuration,
    },
    evaluation: [],
  };
}

export type ValidationResult = { readonly ok: true; readonly model: ModelDocument } | { readonly ok: false; readonly errors: readonly string[] };

type Obj = Readonly<Record<string, unknown>>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => isNum(v) && Number.isInteger(v);
/** Equal as ordered lists of plain values (arrays of strings or numbers). */
const same = (a: unknown, b: unknown): boolean => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
/** Equal on the named fields only: key order and unknown extra fields do not matter. */
const sameFields = (a: unknown, b: unknown, keys: readonly string[]): boolean => isObj(a) && isObj(b) && keys.every((key) => Object.is(a[key], b[key]));

/**
 * Checks a parsed value against the v1 format, with `registry` the registered training tracks (id, version, content hash) and returns the model or every error found, in a fixed order. It changes
 * nothing and throws nothing. Version and format are checked first so a document from a newer app is refused as such.
 */
export function validateModel(value: unknown, registry: readonly TrackRegistryEntry[]): ValidationResult {
  // Stored text is untrusted: whatever it holds, a check that fails unexpectedly is a rejection, never an exception.
  try {
    return validateModelUnchecked(value, registry);
  } catch {
    return { ok: false, errors: ['The model could not be checked: it holds a value this app cannot read.'] };
  }
}

function validateModelUnchecked(value: unknown, registry: readonly TrackRegistryEntry[]): ValidationResult {
  const errors: string[] = [];
  const fail = (message: string) => void errors.push(message);
  if (!isObj(value)) return { ok: false, errors: ['The file is not a model: expected a JSON object.'] };

  if (value.format !== MODEL_FORMAT) fail(`"format" must be "${MODEL_FORMAT}".`);
  if (!isInt(value.schemaVersion) || value.schemaVersion < 1) {
    fail('"schemaVersion" must be a positive integer.');
  } else if (value.schemaVersion > MODEL_SCHEMA_VERSION) {
    return { ok: false, errors: [`This model was made by a newer version of the app (schema ${value.schemaVersion}); this app reads schema ${MODEL_SCHEMA_VERSION}.`] };
  } else if (value.schemaVersion !== MODEL_SCHEMA_VERSION) {
    fail(`Schema ${value.schemaVersion} is not supported; this app reads schema ${MODEL_SCHEMA_VERSION}.`);
  }
  if (errors.length > 0) return { ok: false, errors };

  if (typeof value.id !== 'string' || !MODEL_ID_PATTERN.test(value.id)) fail('"id" must be 1 to 100 letters, digits, dots, dashes or underscores.');
  if (value.name !== undefined && (typeof value.name !== 'string' || value.name.length > 200)) fail('"name" must be a string of at most 200 characters.');
  if (typeof value.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value.createdAt) || Number.isNaN(Date.parse(value.createdAt))) {
    fail('"createdAt" must be an ISO 8601 UTC timestamp.');
  }
  if (value.appVersion !== undefined && typeof value.appVersion !== 'string') fail('"appVersion" must be a string.');
  if (typeof value.codeVersion !== 'string' || value.codeVersion.length === 0) fail('"codeVersion" must be a non-empty string.');
  if (!isInt(value.simulationVersion) || value.simulationVersion < 1) fail('"simulationVersion" must be a positive integer.');
  if (!isNum(value.fitness)) fail('"fitness" must be a finite number.');
  if (value.evaluation !== undefined && !Array.isArray(value.evaluation)) fail('"evaluation" must be an array.');

  // Architecture: exactly what this app can run.
  const a = value.architecture;
  let brakeEnabled: boolean | null = null;
  if (!isObj(a)) {
    fail('"architecture" must be an object.');
  } else {
    if (a.type !== 'feedforward') fail('"architecture.type" must be "feedforward".');
    if (!same(a.layers, LAYERS)) fail(`"architecture.layers" must be [${LAYERS.join(', ')}]; this app runs only that network.`);
    if (a.hiddenActivation !== HIDDEN_ACTIVATION) fail(`"architecture.hiddenActivation" must be "${HIDDEN_ACTIVATION}".`);
    if (!same(a.outputActivations, OUTPUT_ACTIVATIONS)) fail(`"architecture.outputActivations" must be ${JSON.stringify(OUTPUT_ACTIVATIONS)}.`);
    if (!same(a.inputs, INPUT_NAMES)) fail(`"architecture.inputs" must be ${JSON.stringify(INPUT_NAMES)}.`);
    if (!same(a.outputs, OUTPUT_NAMES)) fail(`"architecture.outputs" must be ${JSON.stringify(OUTPUT_NAMES)}.`);
    if (typeof a.brakeEnabled !== 'boolean') fail('"architecture.brakeEnabled" must be true or false.');
    else brakeEnabled = a.brakeEnabled;
  }

  // Parameters: bounds are checked before any element is read.
  const p = value.parameters;
  if (!isObj(p)) {
    fail('"parameters" must be an object.');
  } else {
    if (p.order !== PARAMETER_ORDER) fail(`"parameters.order" must be "${PARAMETER_ORDER}".`);
    if (p.count !== PARAMETER_COUNT) fail(`"parameters.count" must be ${PARAMETER_COUNT}, the number computed from the layers.`);
    if (!Array.isArray(p.values)) {
      fail('"parameters.values" must be an array.');
    } else if (p.values.length !== PARAMETER_COUNT) {
      fail(`"parameters.values" must have exactly ${PARAMETER_COUNT} values, found ${p.values.length}.`);
    } else {
      const bad = p.values.findIndex((v: unknown) => !isNum(v));
      if (bad >= 0) fail(`"parameters.values[${bad}]" must be a finite number (no NaN, Infinity or null).`);
    }
  }

  // Training.
  const t = value.training;
  if (!isObj(t)) {
    fail('"training" must be an object.');
  } else {
    validateTraining(t, brakeEnabled, registry, fail);
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, model: value as unknown as ModelDocument };
}

function validateTraining(t: Obj, brakeEnabled: boolean | null, registry: readonly TrackRegistryEntry[], fail: (message: string) => void): void {
  if (!isInt(t.generation) || t.generation < 0) fail('"training.generation" must be an integer of at least 0.');
  if (t.seed === null) {
    if (typeof t.seedUnavailableReason !== 'string' || t.seedUnavailableReason.length === 0) fail('"training.seedUnavailableReason" is required when "training.seed" is null.');
  } else if (!isInt(t.seed) || t.seed < 0 || t.seed > 0xffffffff) {
    fail('"training.seed" must be an unsigned 32-bit integer or null.');
  }
  const c = t.configuration;
  if (!isObj(c)) {
    fail('"training.configuration" must be an object.');
    return;
  }
  if (!isNum(c.timestepSeconds) || c.timestepSeconds < MIN_TIMESTEP_SECONDS || c.timestepSeconds > MAX_TIMESTEP_SECONDS) fail(`"training.configuration.timestepSeconds" must be a number from ${MIN_TIMESTEP_SECONDS} to ${MAX_TIMESTEP_SECONDS} seconds.`);
  const prng = c.prng;
  if (!isObj(prng) || prng.algorithm !== RNG_ALGORITHM || prng.version !== PRNG_VERSION) fail(`"training.configuration.prng" must be { algorithm: "${RNG_ALGORITHM}", version: ${PRNG_VERSION} }.`);
  if (c.generations !== null && (!isInt(c.generations) || c.generations < 1)) fail('"training.configuration.generations" must be a positive integer, or null for an open-ended run.');
  if (!isInt(c.populationSize) || c.populationSize < 2 || c.populationSize > MAX_POPULATION_SIZE) fail(`"training.configuration.populationSize" must be an integer from 2 to ${MAX_POPULATION_SIZE}.`);
  if (!isInt(c.eliteCount) || c.eliteCount < 0 || (isInt(c.populationSize) && c.eliteCount > c.populationSize)) fail('"training.configuration.eliteCount" must be an integer from 0 to the population size.');
  if (!isInt(c.maxLaps) || c.maxLaps < 1) fail('"training.configuration.maxLaps" must be an integer of at least 1.');
  for (const key of ['maxEpisodeSeconds', 'stallSeconds'] as const) {
    if (!isNum(c[key]) || (c[key] as number) <= 0 || (c[key] as number) > MAX_LIMIT_SECONDS) fail(`"training.configuration.${key}" must be a number above 0 and at most ${MAX_LIMIT_SECONDS}.`);
  }
  if (typeof c.brakeEnabled !== 'boolean') fail('"training.configuration.brakeEnabled" must be true or false.');
  else if (brakeEnabled !== null && c.brakeEnabled !== brakeEnabled) fail('"training.configuration.brakeEnabled" must agree with "architecture.brakeEnabled".');
  const populationSize = isInt(c.populationSize) ? c.populationSize : MAX_POPULATION_SIZE;
  const selection = c.selection;
  if (!isObj(selection) || selection.type !== 'tournament') fail('"training.configuration.selection.type" must be "tournament".');
  else if (!isInt(selection.size) || selection.size < 1 || selection.size > populationSize) fail('"training.configuration.selection.size" must be an integer from 1 to the population size.');
  const crossover = c.crossover;
  if (!isObj(crossover) || crossover.type !== 'uniform') fail('"training.configuration.crossover.type" must be "uniform".');
  else if (!isNum(crossover.rate) || crossover.rate < 0 || crossover.rate > 1) fail('"training.configuration.crossover.rate" must be a number from 0 to 1.');
  const mutation = c.mutation;
  if (!isObj(mutation)) fail('"training.configuration.mutation" must be an object.');
  else {
    if (!isNum(mutation.rate) || mutation.rate < 0 || mutation.rate > 1) fail('"training.configuration.mutation.rate" must be a number from 0 to 1.');
    if (!isNum(mutation.scale) || mutation.scale < 0) fail('"training.configuration.mutation.scale" must be a finite number of at least 0.');
  }
  if (c.inputContract !== INPUT_CONTRACT) fail(`"training.configuration.inputContract" must be "${INPUT_CONTRACT}".`);
  if (c.outputContract !== OUTPUT_CONTRACT) fail(`"training.configuration.outputContract" must be "${OUTPUT_CONTRACT}".`);

  // Physics: every field required; the speed limit must follow from the others.
  const physics = c.physics;
  if (!isObj(physics)) {
    fail('"training.configuration.physics" must be an object.');
  } else {
    const keys = Object.keys(DEFAULT_VEHICLE_PHYSICS) as (keyof VehiclePhysics)[];
    const missing = keys.filter((k) => !isNum(physics[k]));
    if (missing.length > 0) {
      fail(`"training.configuration.physics" needs a finite number for ${missing.join(', ')}.`);
    } else {
      const positive = ['wheelbase', 'engineAcceleration', 'brakeDeceleration', 'maxSteerRadians', 'maxLateralAcceleration', 'vehicleLength', 'vehicleWidth', 'maxSpeed'] as const;
      const nonNegative = ['quadraticDrag', 'rollingResistance', 'stopSpeed'] as const;
      for (const key of positive) if ((physics[key] as number) <= 0) fail(`"training.configuration.physics.${key}" must be above 0.`);
      for (const key of nonNegative) if ((physics[key] as number) < 0) fail(`"training.configuration.physics.${key}" must be at least 0.`);
      if (isNum(physics.maxSteerRadians) && physics.maxSteerRadians >= Math.PI / 2) fail('"training.configuration.physics.maxSteerRadians" must be below pi/2.');
      const derived = terminalSpeed(physics as unknown as VehiclePhysics);
      if (!Number.isFinite(derived) || !(Math.abs((physics.maxSpeed as number) - derived) <= MAX_SPEED_TOLERANCE * Math.max(1, Math.abs(derived)))) {
        fail(`"training.configuration.physics.maxSpeed" (${physics.maxSpeed as number}) must equal the terminal speed ${derived} that follows from the engine, drag and rolling resistance.`);
      }
    }
  }

  // Sensors: the ray inputs must match the angles.
  const s = c.sensors;
  if (!isObj(s)) {
    fail('"training.configuration.sensors" must be an object.');
  } else {
    if (s.origin !== 'body-centre') fail('"training.configuration.sensors.origin" must be "body-centre".');
    if (!Array.isArray(s.anglesDegrees) || !s.anglesDegrees.every(isNum)) fail('"training.configuration.sensors.anglesDegrees" must be an array of finite numbers.');
    else if ((s.anglesDegrees as number[]).length + 2 !== LAYERS[0]) fail('"training.configuration.sensors.anglesDegrees" plus speed and heading error must equal the number of network inputs.');
    if (!isNum(s.maxDistance) || s.maxDistance <= 0) fail('"training.configuration.sensors.maxDistance" must be a number above 0.');
  }

  // Fitness: weights of the version recorded.
  const f = c.fitness;
  if (!isObj(f)) {
    fail('"training.configuration.fitness" must be an object.');
  } else {
    for (const key of ['version', 'checkpointWeight', 'partialProgressWeight', 'lapWeight', 'collisionPenalty', 'lapTimeBonusScale', 'referenceLapSeconds', 'maxLapTimeRatio']) {
      if (!isNum(f[key])) fail(`"training.configuration.fitness.${key}" must be a finite number.`);
    }
    for (const key of ['checkpointWeight', 'partialProgressWeight', 'lapWeight', 'collisionPenalty', 'lapTimeBonusScale']) {
      if (isNum(f[key]) && (f[key] as number) < 0) fail(`"training.configuration.fitness.${key}" must be at least 0.`);
    }
    if (isNum(f.referenceLapSeconds) && f.referenceLapSeconds <= 0) fail('"training.configuration.fitness.referenceLapSeconds" must be above 0.');
    if (isNum(f.maxLapTimeRatio) && f.maxLapTimeRatio < 1) fail('"training.configuration.fitness.maxLapTimeRatio" must be at least 1.');
    if (isNum(f.partialProgressWeight) && isNum(f.checkpointWeight) && f.partialProgressWeight > f.checkpointWeight) fail('"training.configuration.fitness.partialProgressWeight" must not exceed "checkpointWeight".');
  }

  // Top-level summaries must agree with the configuration they summarise.
  for (const key of ['populationSize', 'eliteCount', 'maxEpisodeSeconds'] as const) {
    if (t[key] !== c[key]) fail(`"training.${key}" must agree with "training.configuration.${key}".`);
  }
  // Operator settings are compared field by field, so key order and unknown extra fields do not matter.
  const operatorFields = { selection: ['type', 'size'], crossover: ['type', 'rate'], mutation: ['rate', 'scale'] } as const;
  for (const key of ['selection', 'crossover', 'mutation'] as const) {
    if (!sameFields(t[key], c[key], operatorFields[key])) fail(`"training.${key}" must agree with "training.configuration.${key}".`);
  }
  if (!isObj(f) || t.fitnessVersion !== f.version) fail('"training.fitnessVersion" must agree with "training.configuration.fitness.version".');

  // Tracks: only registered training tracks, with the manifest's version and content hash.
  const ids = t.trackIds;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string')) {
    fail('"training.trackIds" must be a non-empty array of strings.');
    return;
  }
  const versions = t.trackVersions;
  const hashes = t.trackHashes;
  if (!isObj(versions) || !isObj(hashes)) {
    fail('"training.trackVersions" and "training.trackHashes" must be objects keyed by track id.');
    return;
  }
  if (!same([...ids].sort(), Object.keys(versions).sort()) || !same([...ids].sort(), Object.keys(hashes).sort())) fail('"training.trackVersions" and "training.trackHashes" must have exactly the tracks in "training.trackIds".');
  const registered = registry;
  for (const id of ids as string[]) {
    const entry = registered.find((track) => track.id === id);
    if (!entry) {
      fail(`Track "${id}" is not a registered training track.`);
      continue;
    }
    const version = versions[id];
    if (typeof version !== 'string') fail(`"training.trackVersions.${id}" must be a string.`);
    else if (version !== entry.version) fail(`Track "${id}" has version ${version}, but this app has version ${entry.version}.`);
    const hash = hashes[id];
    if (typeof hash !== 'string') fail(`"training.trackHashes.${id}" must be a string.`);
    else if (hash !== entry.contentHash) fail(`Track "${id}" has a different content hash from this app's track.`);
  }
}

/** The 159 parameters of a validated model, as a new array. */
export function modelParameters(model: ModelDocument): Float64Array {
  return Float64Array.from(model.parameters.values);
}

export interface Compatibility {
  /** False if this app cannot drive the model at all. */
  readonly drivable: boolean;
  /** Why it cannot (when `drivable` is false). */
  readonly reasons: readonly string[];
  /** Differences that do not stop it loading but mean its behaviour or old scores may differ. */
  readonly warnings: readonly string[];
}

/**
 * Whether this app can drive a validated model, and what differs from this build. It is replayed under its own recorded
 * physics and timestep, so those differences only warn; a different simulation version or sensor layout cannot be driven.
 */
export function compatibility(model: ModelDocument): Compatibility {
  const reasons: string[] = [];
  const warnings: string[] = [];
  if (model.simulationVersion !== SIMULATION_VERSION) reasons.push(`It was made for simulation version ${model.simulationVersion}; this app runs version ${SIMULATION_VERSION}.`);
  const sensors = model.training.configuration.sensors;
  if (!sameFields(sensors, DEFAULT_SENSOR_CONFIG, ['origin', 'maxDistance']) || !same(sensors.anglesDegrees, DEFAULT_SENSOR_CONFIG.anglesDegrees)) reasons.push('Its sensor layout differs from the one this app supports.');
  if (!sameFields(model.training.configuration.physics, DEFAULT_VEHICLE_PHYSICS, Object.keys(DEFAULT_VEHICLE_PHYSICS))) warnings.push('It was trained with different vehicle physics from this build; it is replayed with its own, and its behaviour and old scores may differ.');
  if (model.training.configuration.timestepSeconds !== DEFAULT_SIM_CONFIG.timestepSeconds) warnings.push('It was trained with a different timestep from this build; it is replayed with its own.');
  return { drivable: reasons.length === 0, reasons, warnings };
}
