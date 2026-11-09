// The training checkpoint format v1 (docs/CHECKPOINT_FORMAT.md, P3-07): a generation-boundary snapshot of one run, so it
// can be resumed exactly. It is a different document from a saved champion (`modelFormat.ts`): a champion is one controller
// and cannot resume evolution. Pure: no DOM, storage, clock or randomness, and it imports nothing from `training`, `ui`
// or `render` (the boundary lint). The configuration rules are not repeated here: `validateCheckpoint` is given a
// `resolveConfig` adapter by the application layer (`ui/checkpointAdapter.ts`), which wraps the trainer's own validator.
// Like the model format, a reader trusts nothing it parses: sizes are bounded before anything is allocated, every number
// must be finite, every error is reported, and a check that fails unexpectedly is a refusal, never an exception.
import { LAYERS, MAX_CHECKPOINT_PARAMETER_MAGNITUDE, PARAMETER_COUNT, PARAMETER_ORDER } from '../ai/network';
import { DEFAULT_VEHICLE_PHYSICS } from '../sim/config';
import { RNG_ALGORITHM } from '../utils/rng';
import { MAX_TIMESTEP_SECONDS, MIN_TIMESTEP_SECONDS, MODEL_ID_PATTERN, type TrackRegistryEntry } from './modelFormat';

export const CHECKPOINT_FORMAT = 'self-driving-ai-evolution/checkpoint';
export const CHECKPOINT_SCHEMA_VERSION = 1;
/** The limit, in UTF-8 bytes, for stored text, a file and a download (docs/CHECKPOINT_FORMAT.md, "Size"). */
export const MAX_CHECKPOINT_BYTES = 3 * 1_048_576;
/** Bounds checked before any array is walked. A checkpoint this large would not fit the byte limit anyway. */
export const MAX_CHECKPOINT_POPULATION = 2_000;
export const MAX_CHECKPOINT_GENERATIONS = 20_000;

/**
 * The size of `text` in UTF-8 bytes, up to `limit`: text longer than `limit` code units is already over it, so it is not
 * encoded and its length (which is over the limit) is returned.
 */
export function utf8Size(text: string, limit: number = MAX_CHECKPOINT_BYTES): number {
  return text.length > limit ? text.length : new TextEncoder().encode(text).length;
}

export type OutcomeCounts = { readonly completed: number; readonly crashed: number; readonly stalled: number; readonly timeout: number };

interface EntryFields {
  readonly generation: number;
  readonly bestFitness: number;
  readonly meanFitness: number;
  readonly worstFitness: number;
  readonly outcomes: OutcomeCounts;
  readonly carsWithLap: number;
  readonly maxGatesPassed: number;
  readonly generationTicks: number;
  readonly totalEpisodeTicks: number;
}
/** A generation kept in full: every car's fitness and the champion genome. */
export interface CheckpointFullEntry extends EntryFields {
  readonly retained: true;
  readonly fitness: readonly number[];
  readonly championIndex: number;
  readonly champion: readonly number[];
  /** Indices in `champion` that hold negative zero, which JSON cannot write; restored on reading. */
  readonly championNegativeZeros?: readonly number[];
}
/** A generation whose champion and per-car fitness were not kept. It has no such fields: they are unavailable, not zero. */
export interface CheckpointCompactEntry extends EntryFields {
  readonly retained: false;
  readonly populationSize: number;
}
export type CheckpointEntry = CheckpointFullEntry | CheckpointCompactEntry;

export interface CheckpointDocument {
  readonly format: typeof CHECKPOINT_FORMAT;
  readonly schemaVersion: typeof CHECKPOINT_SCHEMA_VERSION;
  readonly id: string;
  readonly createdAt: string;
  readonly codeVersion: string;
  readonly appVersion?: string;
  readonly simulationVersion: number;
  readonly training: {
    /** The trainer's configuration, as `resolveConfig` returned it. */
    readonly configuration: Readonly<Record<string, unknown>>;
    readonly environment: {
      readonly physics: Readonly<Record<string, number>>;
      readonly timestepSeconds: number;
      readonly sensors: { readonly origin: string; readonly anglesDegrees: readonly number[]; readonly maxDistance: number };
    };
    readonly trackId: string;
    readonly trackVersion: string;
    readonly trackHash: string;
    readonly rngStreams: string;
    /** The run generator's state: the only random state at a generation boundary (there is no cached draw). */
    readonly rng: { readonly algorithm: string; readonly words: readonly [number, number, number, number] };
  };
  /** The number of completed generations; the generation to run next (numbered from 0). */
  readonly generationIndex: number;
  readonly population: {
    readonly count: number;
    readonly order: string;
    readonly values: readonly (readonly number[])[];
    /** `[genome, parameter]` pairs that hold negative zero, restored on reading. */
    readonly negativeZeros?: readonly (readonly [number, number])[];
  };
  readonly history: readonly CheckpointEntry[];
}

/** What a checkpoint is built from. Plain data: the application layer converts the trainer's state into it. */
export interface BuildCheckpointInput {
  readonly id: string;
  readonly createdAt: string;
  readonly codeVersion: string;
  readonly appVersion?: string | undefined;
  readonly simulationVersion: number;
  readonly configuration: Readonly<Record<string, unknown>>;
  readonly physics: Readonly<Record<string, number>>;
  readonly timestepSeconds: number;
  readonly sensors: { readonly origin: string; readonly anglesDegrees: readonly number[]; readonly maxDistance: number };
  readonly trackId: string;
  readonly trackVersion: string;
  readonly trackHash: string;
  readonly rngStreams: string;
  readonly rngState: { readonly algorithm: string; readonly words: readonly number[] };
  readonly generationIndex: number;
  readonly genomes: readonly Float64Array[];
  readonly history: readonly (
    | (EntryFields & { readonly retained: true; readonly fitness: readonly number[]; readonly championIndex: number; readonly champion: Float64Array })
    | (EntryFields & { readonly retained: false; readonly populationSize: number })
  )[];
}

/** Numbers for JSON: values copied at full precision; negative zero is listed beside them, because JSON would write 0. */
function encodeGenome(genome: Float64Array): { values: number[]; negativeZeros: number[] } {
  const negativeZeros: number[] = [];
  const values = Array.from(genome, (value, i) => {
    if (Object.is(value, -0)) {
      negativeZeros.push(i);
      return 0;
    }
    return value;
  });
  return { values, negativeZeros };
}

export function buildCheckpoint(input: BuildCheckpointInput): CheckpointDocument {
  const negativeZeros: [number, number][] = [];
  const values = input.genomes.map((genome, g) => {
    const encoded = encodeGenome(genome);
    for (const i of encoded.negativeZeros) negativeZeros.push([g, i]);
    return encoded.values;
  });
  const history = input.history.map((entry): CheckpointEntry => {
    const { outcomes } = entry;
    const common = {
      generation: entry.generation,
      bestFitness: entry.bestFitness,
      meanFitness: entry.meanFitness,
      worstFitness: entry.worstFitness,
      outcomes: { completed: outcomes.completed, crashed: outcomes.crashed, stalled: outcomes.stalled, timeout: outcomes.timeout },
      carsWithLap: entry.carsWithLap,
      maxGatesPassed: entry.maxGatesPassed,
      generationTicks: entry.generationTicks,
      totalEpisodeTicks: entry.totalEpisodeTicks,
    };
    if (!entry.retained) return { retained: false, populationSize: entry.populationSize, ...common };
    const champion = encodeGenome(entry.champion);
    return {
      retained: true,
      ...common,
      fitness: Array.from(entry.fitness, (v) => (Object.is(v, -0) ? 0 : v)),
      championIndex: entry.championIndex,
      champion: champion.values,
      ...(champion.negativeZeros.length > 0 ? { championNegativeZeros: champion.negativeZeros } : {}),
    };
  });
  const word = (i: number) => input.rngState.words[i] as number;
  return {
    format: CHECKPOINT_FORMAT,
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    id: input.id,
    createdAt: input.createdAt,
    codeVersion: input.codeVersion,
    ...(input.appVersion === undefined ? {} : { appVersion: input.appVersion }),
    simulationVersion: input.simulationVersion,
    training: {
      configuration: input.configuration,
      environment: { physics: { ...input.physics }, timestepSeconds: input.timestepSeconds, sensors: { origin: input.sensors.origin, anglesDegrees: [...input.sensors.anglesDegrees], maxDistance: input.sensors.maxDistance } },
      trackId: input.trackId,
      trackVersion: input.trackVersion,
      trackHash: input.trackHash,
      rngStreams: input.rngStreams,
      rng: { algorithm: input.rngState.algorithm, words: [word(0), word(1), word(2), word(3)] },
    },
    generationIndex: input.generationIndex,
    population: { count: values.length, order: PARAMETER_ORDER, values, ...(negativeZeros.length > 0 ? { negativeZeros } : {}) },
    history,
  };
}

/** The population as genomes, with negative zeros restored. Call only on a validated document. */
export function checkpointGenomes(doc: CheckpointDocument): Float64Array[] {
  const genomes = doc.population.values.map((row) => Float64Array.from(row));
  for (const [g, i] of doc.population.negativeZeros ?? []) genomes[g]![i] = -0;
  return genomes;
}

/** A full entry's champion genome, with negative zeros restored. */
export function entryChampion(entry: CheckpointFullEntry): Float64Array {
  const genome = Float64Array.from(entry.champion);
  for (const i of entry.championNegativeZeros ?? []) genome[i] = -0;
  return genome;
}

export type ValidationResult = { readonly ok: true; readonly checkpoint: CheckpointDocument } | { readonly ok: false; readonly errors: readonly string[] };

/** Turns the configuration into the trainer's validated one, or says why not. Supplied by the application layer. */
export type ResolveConfig = (configuration: unknown, timestepSeconds: number) => { readonly ok: true; readonly config: unknown } | { readonly ok: false; readonly errors: readonly string[] };

export interface ValidateOptions {
  readonly registry: readonly TrackRegistryEntry[];
  readonly resolveConfig: ResolveConfig;
}

type Obj = Readonly<Record<string, unknown>>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => isNum(v) && Number.isInteger(v);
const isCount = (v: unknown): v is number => isInt(v) && v >= 0;
const isUint32 = (v: unknown): v is number => isInt(v) && v >= 0 && v <= 0xffffffff;
const OUTCOMES = ['completed', 'crashed', 'stalled', 'timeout'] as const;

/** Checks a parsed value against the v1 format. Changes nothing, throws nothing, and reports every error it finds. */
export function validateCheckpoint(value: unknown, options: ValidateOptions): ValidationResult {
  try {
    return validateUnchecked(value, options);
  } catch {
    return { ok: false, errors: ['The checkpoint could not be checked: it holds a value this app cannot read.'] };
  }
}

function validateUnchecked(value: unknown, options: ValidateOptions): ValidationResult {
  const errors: string[] = [];
  const fail = (message: string) => void errors.push(message);
  if (!isObj(value)) return { ok: false, errors: ['The file is not a checkpoint: expected a JSON object.'] };
  if (value.format === 'self-driving-ai-evolution/model') return { ok: false, errors: ['This is a saved champion, not a training checkpoint. Use "Import JSON file" in Saved champions for it.'] };
  if (value.format !== CHECKPOINT_FORMAT) return { ok: false, errors: [`"format" must be "${CHECKPOINT_FORMAT}".`] };
  if (!isInt(value.schemaVersion) || value.schemaVersion < 1) return { ok: false, errors: ['"schemaVersion" must be a positive integer.'] };
  if (value.schemaVersion > CHECKPOINT_SCHEMA_VERSION) return { ok: false, errors: [`This checkpoint was made by a newer version of the app (schema ${value.schemaVersion}); this app reads schema ${CHECKPOINT_SCHEMA_VERSION}.`] };
  if (value.schemaVersion !== CHECKPOINT_SCHEMA_VERSION) return { ok: false, errors: [`Checkpoint schema ${value.schemaVersion} is not supported; this app reads schema ${CHECKPOINT_SCHEMA_VERSION}.`] };

  if (typeof value.id !== 'string' || !MODEL_ID_PATTERN.test(value.id)) fail('"id" must be 1 to 100 letters, digits, dots, dashes or underscores.');
  if (typeof value.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value.createdAt) || Number.isNaN(Date.parse(value.createdAt))) fail('"createdAt" must be an ISO 8601 UTC timestamp.');
  if (typeof value.codeVersion !== 'string' || value.codeVersion.length === 0) fail('"codeVersion" must be a non-empty string.');
  if (value.appVersion !== undefined && typeof value.appVersion !== 'string') fail('"appVersion" must be a string.');
  if (!isInt(value.simulationVersion) || value.simulationVersion < 1) fail('"simulationVersion" must be a positive integer.');

  let populationSize: number | null = null;
  const t = value.training;
  if (!isObj(t)) {
    fail('"training" must be an object.');
  } else {
    const env = t.environment;
    let timestep: number | null = null;
    if (!isObj(env)) {
      fail('"training.environment" must be an object.');
    } else {
      if (!isNum(env.timestepSeconds) || env.timestepSeconds < MIN_TIMESTEP_SECONDS || env.timestepSeconds > MAX_TIMESTEP_SECONDS) fail(`"training.environment.timestepSeconds" must be a number from ${MIN_TIMESTEP_SECONDS} to ${MAX_TIMESTEP_SECONDS} seconds.`);
      else timestep = env.timestepSeconds;
      const physics = env.physics;
      if (!isObj(physics)) {
        fail('"training.environment.physics" must be an object.');
      } else {
        const missing = (Object.keys(DEFAULT_VEHICLE_PHYSICS) as string[]).filter((k) => !isNum(physics[k]));
        if (missing.length > 0) fail(`"training.environment.physics" needs a finite number for ${missing.join(', ')}.`);
      }
      const sensors = env.sensors;
      if (!isObj(sensors)) {
        fail('"training.environment.sensors" must be an object.');
      } else {
        if (sensors.origin !== 'body-centre') fail('"training.environment.sensors.origin" must be "body-centre".');
        if (!Array.isArray(sensors.anglesDegrees) || !sensors.anglesDegrees.every(isNum) || sensors.anglesDegrees.length + 2 !== LAYERS[0]) fail('"training.environment.sensors.anglesDegrees" must be finite numbers that, with speed and heading error, match the network inputs.');
        if (!isNum(sensors.maxDistance) || sensors.maxDistance <= 0) fail('"training.environment.sensors.maxDistance" must be a number above 0.');
      }
    }
    if (!isObj(t.configuration)) {
      fail('"training.configuration" must be an object.');
    } else if (timestep !== null) {
      // One authoritative set of rules: the trainer's own validator, supplied by the application layer.
      const resolved = options.resolveConfig(t.configuration, timestep);
      if (!resolved.ok) for (const message of resolved.errors) fail(`"training.configuration": ${message}`);
      else if (isObj(resolved.config) && isInt(resolved.config.populationSize)) populationSize = resolved.config.populationSize;
    }
    for (const key of ['trackId', 'trackVersion', 'trackHash', 'rngStreams'] as const) if (typeof t[key] !== 'string' || (t[key] as string).length === 0) fail(`"training.${key}" must be a non-empty string.`);
    if (typeof t.trackId === 'string') {
      const entry = options.registry.find((track) => track.id === t.trackId);
      if (!entry) fail(`Track "${t.trackId}" is not a registered training track.`);
      else {
        if (t.trackVersion !== entry.version) fail(`Track "${t.trackId}" has version ${String(t.trackVersion)}, but this app has version ${entry.version}.`);
        if (t.trackHash !== entry.contentHash) fail(`Track "${t.trackId}" has a different content hash from this app's track.`);
      }
    }
    const rng = t.rng;
    if (!isObj(rng) || rng.algorithm !== RNG_ALGORITHM || !Array.isArray(rng.words) || rng.words.length !== 4 || ![0, 1, 2, 3].every((i) => isUint32((rng.words as unknown[])[i]))) {
      fail(`"training.rng" must be { algorithm: "${RNG_ALGORITHM}", words: four unsigned 32-bit integers }.`);
    }
  }

  const generationIndex = value.generationIndex;
  if (!isCount(generationIndex) || generationIndex > MAX_CHECKPOINT_GENERATIONS) fail(`"generationIndex" must be an integer from 0 to ${MAX_CHECKPOINT_GENERATIONS}.`);

  // Population: bounds are checked before any row is walked.
  const pop = value.population;
  if (!isObj(pop)) {
    fail('"population" must be an object.');
  } else {
    if (pop.order !== PARAMETER_ORDER) fail(`"population.order" must be "${PARAMETER_ORDER}".`);
    if (!isInt(pop.count) || pop.count < 2 || pop.count > MAX_CHECKPOINT_POPULATION) fail(`"population.count" must be an integer from 2 to ${MAX_CHECKPOINT_POPULATION}.`);
    else if (populationSize !== null && pop.count !== populationSize) fail('"population.count" must equal the configuration\'s population size.');
    const rows = pop.values;
    if (!Array.isArray(rows)) fail('"population.values" must be an array of genomes.');
    else if (isInt(pop.count) && rows.length !== pop.count) fail(`"population.values" must hold ${String(pop.count)} genomes, found ${rows.length}.`);
    else if (rows.length <= MAX_CHECKPOINT_POPULATION) {
      rows.forEach((row: unknown, g) => {
        if (!Array.isArray(row) || row.length !== PARAMETER_COUNT) fail(`"population.values[${g}]" must have exactly ${PARAMETER_COUNT} numbers.`);
        else {
          const bad = row.findIndex((v: unknown) => !isNum(v));
          if (bad >= 0) fail(`"population.values[${g}][${bad}]" must be a finite number (no NaN, Infinity or null).`);
          else if (row.some((v: number) => Math.abs(v) >= MAX_CHECKPOINT_PARAMETER_MAGNITUDE)) fail(`"population.values[${g}]" has a parameter too large for the network to compute with (it must stay below ${MAX_CHECKPOINT_PARAMETER_MAGNITUDE}).`);
        }
      });
      checkZeros(pop.negativeZeros, rows, fail);
    }
  }

  // History: one entry per completed generation, in order.
  const history = value.history;
  if (!Array.isArray(history)) {
    fail('"history" must be an array.');
  } else if (isCount(generationIndex) && history.length !== generationIndex) {
    fail(`"history" must hold one entry per completed generation (${generationIndex}), found ${history.length}.`);
  } else if (history.length <= MAX_CHECKPOINT_GENERATIONS) {
    let best = -1;
    let bestValue = Number.NEGATIVE_INFINITY;
    history.forEach((entry: unknown, i) => {
      checkEntry(entry, i, isInt(pop && isObj(pop) ? pop.count : null) ? ((pop as Obj).count as number) : populationSize, fail);
      if (isObj(entry) && isNum(entry.bestFitness) && entry.bestFitness > bestValue) {
        bestValue = entry.bestFitness;
        best = i;
      }
    });
    if (best >= 0 && isObj(history[best]) && (history[best] as Obj).retained !== true) fail('The best generation so far must be kept in full ("retained": true).');
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, checkpoint: value as unknown as CheckpointDocument };
}

function checkZeros(zeros: unknown, rows: readonly unknown[], fail: (m: string) => void): void {
  if (zeros === undefined) return;
  if (!Array.isArray(zeros) || zeros.length > rows.length * PARAMETER_COUNT) {
    fail('"population.negativeZeros" must be a list of [genome, parameter] pairs.');
    return;
  }
  zeros.forEach((pair: unknown, k) => {
    const ok = Array.isArray(pair) && pair.length === 2 && isCount(pair[0]) && isCount(pair[1]) && pair[0] < rows.length && pair[1] < PARAMETER_COUNT && (rows[pair[0]] as unknown[])[pair[1]] === 0;
    if (!ok) fail(`"population.negativeZeros[${k}]" must be a [genome, parameter] pair that points at a 0.`);
  });
}

function checkEntry(entry: unknown, i: number, population: number | null, fail: (m: string) => void): void {
  const at = `history[${i}]`;
  if (!isObj(entry)) {
    fail(`"${at}" must be an object.`);
    return;
  }
  if (entry.generation !== i) fail(`"${at}.generation" must be ${i}.`);
  if (typeof entry.retained !== 'boolean') fail(`"${at}.retained" must be true or false.`);
  for (const key of ['bestFitness', 'meanFitness', 'worstFitness'] as const) if (!isNum(entry[key])) fail(`"${at}.${key}" must be a finite number.`);
  for (const key of ['carsWithLap', 'maxGatesPassed', 'generationTicks', 'totalEpisodeTicks'] as const) if (!isCount(entry[key])) fail(`"${at}.${key}" must be an integer of at least 0.`);
  const outcomes = entry.outcomes;
  let outcomeTotal: number | null = null;
  if (!isObj(outcomes) || !OUTCOMES.every((k) => isCount(outcomes[k]))) fail(`"${at}.outcomes" must hold an integer of at least 0 for ${OUTCOMES.join(', ')}.`);
  else outcomeTotal = OUTCOMES.reduce((sum, k) => sum + (outcomes[k] as number), 0);
  const count = entry.retained === true ? (Array.isArray(entry.fitness) ? entry.fitness.length : null) : isInt(entry.populationSize) ? entry.populationSize : null;
  if (outcomeTotal !== null && count !== null && outcomeTotal !== count) fail(`"${at}.outcomes" must add up to the population (${count}).`);
  if (population !== null && count !== null && count !== population) fail(`"${at}" is for a population of ${count}, but the checkpoint's is ${population}.`);
  if (entry.retained === true) {
    if (!Array.isArray(entry.fitness) || entry.fitness.length < 2 || entry.fitness.length > MAX_CHECKPOINT_POPULATION || !entry.fitness.every(isNum)) fail(`"${at}.fitness" must be a list of finite numbers, one per car.`);
    if (!Array.isArray(entry.champion) || entry.champion.length !== PARAMETER_COUNT || !entry.champion.every(isNum)) fail(`"${at}.champion" must be ${PARAMETER_COUNT} finite numbers.`);
    else if (entry.champion.some((v: number) => Math.abs(v) >= MAX_CHECKPOINT_PARAMETER_MAGNITUDE)) fail(`"${at}.champion" has a parameter too large for the network to compute with.`);
    if (!isCount(entry.championIndex) || (count !== null && entry.championIndex >= count)) fail(`"${at}.championIndex" must be a car index.`);
    else if (Array.isArray(entry.fitness) && entry.fitness[entry.championIndex] !== entry.bestFitness) fail(`"${at}.bestFitness" must be the champion's fitness.`);
    const zeros = entry.championNegativeZeros;
    if (zeros !== undefined && (!Array.isArray(zeros) || !zeros.every((k: unknown) => isCount(k) && k < PARAMETER_COUNT && Array.isArray(entry.champion) && (entry.champion as unknown[])[k] === 0))) fail(`"${at}.championNegativeZeros" must list positions that hold 0.`);
  } else {
    if (!isInt(entry.populationSize) || entry.populationSize < 2 || entry.populationSize > MAX_CHECKPOINT_POPULATION) fail(`"${at}.populationSize" must be an integer from 2 to ${MAX_CHECKPOINT_POPULATION}.`);
    for (const key of ['fitness', 'champion', 'championIndex']) if (key in entry) fail(`"${at}.${key}" must be absent from a compact entry (it was not kept).`);
  }
}

/** What differs between a validated checkpoint and this build, so a resume is refused rather than run under other rules. */
export interface CurrentEnvironment {
  readonly simulationVersion: number;
  readonly physics: Readonly<Record<string, number>>;
  readonly timestepSeconds: number;
  readonly sensors: { readonly origin: string; readonly anglesDegrees: readonly number[]; readonly maxDistance: number };
  readonly trackId: string;
  readonly trackVersion: string;
  readonly trackHash: string;
  readonly rngStreams: string;
}

export function resumeProblems(doc: CheckpointDocument, current: CurrentEnvironment): string[] {
  const reasons: string[] = [];
  const t = doc.training;
  if (doc.simulationVersion !== current.simulationVersion) reasons.push(`It was made for simulation version ${doc.simulationVersion}; this app runs version ${current.simulationVersion}.`);
  if (t.rngStreams !== current.rngStreams) reasons.push('It was made with a different random-stream layout.');
  if (t.trackId !== current.trackId || t.trackVersion !== current.trackVersion || t.trackHash !== current.trackHash) reasons.push('It was made on a different track or track version.');
  if (t.environment.timestepSeconds !== current.timestepSeconds) reasons.push('It was made with a different timestep.');
  const physicsKeys = Object.keys(current.physics);
  if (physicsKeys.some((k) => !Object.is(t.environment.physics[k], current.physics[k]))) reasons.push('It was made with different vehicle physics.');
  const a = t.environment.sensors;
  const b = current.sensors;
  if (a.origin !== b.origin || a.maxDistance !== b.maxDistance || a.anglesDegrees.length !== b.anglesDegrees.length || a.anglesDegrees.some((v, i) => v !== b.anglesDegrees[i])) reasons.push('It was made with a different sensor layout.');
  return reasons;
}
