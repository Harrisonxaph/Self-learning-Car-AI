// P5-01 step 4b: the E3 study kind (docs/plans/p5-01-plan.md §4 and §7): does evolution (A5) beat a hand-written rule
// (A3, its separately tuned no-brake variant A3-nb, and the derived brake ablation A3-nb-same)? Headless and deterministic.
// THIS MODULE RUNS NO STUDY. It defines the manifest, three record kinds, their strict parsers, replay and the analysis;
// the tests use tiny mechanics fixtures with a synthetic held-out registry. No confirmatory seed (3001–3010) is run here
// and no real held-out circuit is evaluated.
//
// The sequence the formats enforce:
//  1. one SEED RECORD per training seed: A5 is evolved on the training circuit, frozen, and its champion evaluated on the
//     validation circuit only. No held-out circuit is touched in this phase.
//  2. one RULES RECORD: A3, A3-nb and A3-nb-same (their frozen identities are pinned in the manifest) on the validation circuit.
//  3. ONE HELD-OUT RECORD, made after every seed record and the rules record exist, so every agent is frozen before the look:
//     each frozen agent is evaluated, once, on each of the manifest's listed held-out circuits through the once-only gate of
//     heldOutAccess.ts. The record carries the opening (protocol hash, the owner's authorisation, circuits, agents).
// The analysis is a pure function of the records.
import { generateE4Agent, type E4AgentConfig, type E4TrainingSettings } from './e4Agents';
import { c1Training, E4_CONFIRMATORY_GENERATIONS, E4_DELTA, E4_TRAINING_TRACK, E4_VALIDATION_TRACK } from './e4Study';
import { A5_SELECTION } from './agents';
import { bootstrapMeanInterval, iqr, median } from './analysis';
import { episodeResult, resolveBaselineConfig, type EpisodeResult } from './baselines';
import { createEvaluationSetup, evaluateDriver, type EvaluationSetup } from './evaluation';
import { canonicalJson, jsonDifferences, manifestEpochOf, manifestRecord, type ExperimentEngine, type ExperimentSource } from './experiment';
import {
  createHeldOutGate,
  createMemoryLedger,
  driverForFrozenAgent,
  freezeRuleAgent,
  HeldOutAccessError,
  RULE_AGENTS,
  type HeldOutGate,
  type HeldOutOpening,
  type HeldOutProtocol,
  type OpeningLedger,
  type RuleAgent,
} from './heldOutAccess';
import {
  checkContext,
  checkEpisode,
  currentStudyContracts,
  dense,
  denseEverywhere,
  E3_SEEDS,
  exact,
  hashOf,
  HASH,
  ID_PATTERN,
  int,
  ISO_TIME,
  isPlainObject,
  MAX_MECHANICS_SEEDS,
  METRIC,
  modelJson,
  plain,
  REVISION,
  reserved,
  same,
  str,
  StudyCompatibilityError,
  StudyManifestError,
  StudyRecordError,
  type EpisodeCheck,
  type Fail,
  type Json,
  type StudyContext,
} from './study';
import { BUILT_IN_TRACK_SPLITS, epochIds, freezeModel, LATEST_SPLIT_EPOCH, trackContentHash, trainingTrack, validationTrack, type FrozenModel, type TrackSplits } from './trackSplits';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../sim/config';

export const E3_MANIFEST_FORMAT = 'self-driving-ai-evolution/p5-01-e3-manifest';
export const E3_SEED_FORMAT = 'self-driving-ai-evolution/p5-01-e3-seed-record';
export const E3_RULES_FORMAT = 'self-driving-ai-evolution/p5-01-e3-rules-record';
export const E3_HELDOUT_FORMAT = 'self-driving-ai-evolution/p5-01-e3-heldout-record';
export const E3_VERSION = 1;
export const E3_LABELS = Object.freeze(['mechanics', 'confirmatory'] as const);
export type E3Label = (typeof E3_LABELS)[number];
export const E3_BOOTSTRAP = Object.freeze({ resamples: 10_000, seed: 20261112, level: 0.95, method: 'percentile-nearest-rank-v1' });
export const E3_DECISION_RULE = 'p5-01-e3-decision-v1';
export { E3_SEEDS };

export interface E3Manifest {
  readonly format: typeof E3_MANIFEST_FORMAT;
  readonly version: typeof E3_VERSION;
  readonly id: string;
  readonly label: E3Label;
  readonly description: string;
  readonly seeds: readonly number[];
  readonly configuration: { readonly generations: number; readonly training: E4TrainingSettings };
  readonly tracks: {
    readonly training: { readonly id: string; readonly contentHash: string };
    readonly validation: { readonly id: string; readonly contentHash: string };
    /** The held-out circuits the single opening may evaluate; empty in a mechanics manifest on the built-in registry. */
    readonly heldOut: readonly { readonly id: string; readonly contentHash: string }[];
    readonly splitManifestHash: string;
  };
  /** The frozen identities of the rule agents (their content hashes), pinned so a result names exactly what was run. */
  readonly rules: Readonly<Record<RuleAgent, string>>;
  readonly analysis: { readonly metric: typeof METRIC; readonly delta: number; readonly bootstrap: typeof E3_BOOTSTRAP; readonly decisionRule: typeof E3_DECISION_RULE };
  /** The owner's authorisation for the one held-out opening; null when no held-out circuit is listed. */
  readonly authorisation: string | null;
  readonly code: { readonly revision: string | null };
}

const MANIFEST_KEYS = ['format', 'version', 'id', 'label', 'description', 'seeds', 'configuration', 'tracks', 'rules', 'analysis', 'authorisation', 'code'];

/** `sha256:` + SHA-256 of the manifest's canonical JSON; every record carries it, and it is the held-out protocol hash. */
export function e3ManifestHash(manifest: E3Manifest): string {
  return hashOf(manifest);
}

/** The pinned identities of the three rule agents. */
export function ruleIds(): Record<RuleAgent, string> {
  return Object.fromEntries(RULE_AGENTS.map((agent) => [agent, freezeRuleAgent(agent).id])) as Record<RuleAgent, string>;
}

/**
 * Checks an E3 manifest completely and returns it. Throws StudyManifestError for any missing or unknown field, a wrong
 * constant, a training block that is not a complete resolved configuration (or sets `brakeEnabled`), seeds that break the
 * label's set (mechanics: no reserved seed; confirmatory: exactly 3001–3010, C1 and the oval / rounded-rectangle pair),
 * rule identities that are not the current frozen ones, a listed held-out circuit that is not registered as held-out or whose
 * hash differs, held-out circuits or an authorisation in a mechanics manifest on the **built-in** registry, a
 * confirmatory manifest without them, or a missing revision outside mechanics. `splits` is for tests (a synthetic registry).
 */
export function parseE3Manifest(input: unknown, splits: TrackSplits = BUILT_IN_TRACK_SPLITS): E3Manifest {
  const fail: Fail = (message) => {
    throw new StudyManifestError(`E3 manifest: ${message}`);
  };
  denseEverywhere(input, 'manifest', fail);
  const m = exact(input, 'manifest', MANIFEST_KEYS, fail);
  same(m.format, E3_MANIFEST_FORMAT, 'manifest.format', fail);
  same(m.version, E3_VERSION, 'manifest.version', fail);
  if (typeof m.id !== 'string' || !ID_PATTERN.test(m.id)) fail('manifest.id must be 1 to 64 lowercase letters, digits or hyphens.');
  if (!E3_LABELS.includes(m.label as E3Label)) fail(`manifest.label must be one of ${E3_LABELS.join(', ')}.`);
  const label = m.label as E3Label;
  if (str(m.description, 'manifest.description', fail).length > 1000) fail('manifest.description must be at most 1000 characters.');
  const builtIn = splits === BUILT_IN_TRACK_SPLITS;

  const seedList = dense(m.seeds, 'manifest.seeds', fail);
  if (seedList.length === 0) fail('manifest.seeds must be a non-empty array.');
  const seeds = seedList.map((s, i) => int(s, `manifest.seeds[${i}]`, 0, 0xffffffff, fail));
  if (new Set(seeds).size !== seeds.length) fail('manifest.seeds must be distinct.');
  if (label === 'confirmatory') same(seeds, E3_SEEDS, "manifest.seeds (a confirmatory manifest's seeds are exactly 3001–3010, in order)", fail);
  if (label === 'mechanics') {
    if (seeds.some(reserved)) fail('a mechanics manifest may not use a reserved seed (pilot 9001–9003, P2-08 1001–1020, E4 2001–2010 or E3 3001–3010).');
    if (seeds.length > MAX_MECHANICS_SEEDS) fail(`a mechanics manifest has at most ${MAX_MECHANICS_SEEDS} seeds.`);
  }

  const c = exact(m.configuration, 'manifest.configuration', ['generations', 'training'], fail);
  const G = int(c.generations, 'manifest.configuration.generations', 1, 10_000, fail);
  if (isPlainObject(c.training) && Object.prototype.hasOwnProperty.call(c.training, 'brakeEnabled')) {
    fail('manifest.configuration.training.brakeEnabled must not be set: A5 is always evolved with the brake enabled.');
  }
  if (!isPlainObject(c.training)) fail('manifest.configuration.training must be an object.');
  const training = c.training as Json;
  if (!(typeof training.eliteCount === 'number' && training.eliteCount >= 1)) fail('manifest.configuration.training.eliteCount must be at least 1.');

  const t = exact(m.tracks, 'manifest.tracks', ['training', 'validation', 'heldOut', 'splitManifestHash'], fail);
  const trainingRef = exact(t.training, 'manifest.tracks.training', ['id', 'contentHash'], fail);
  const validationRef = exact(t.validation, 'manifest.tracks.validation', ['id', 'contentHash'], fail);
  // trainingTrack / validationTrack throw TrackLeakageError for a circuit outside its split, held-out included.
  same(trainingRef, { id: str(trainingRef.id, 'manifest.tracks.training.id', fail), contentHash: trackContentHash(trainingTrack(trainingRef.id as string, splits)) }, 'manifest.tracks.training', fail);
  same(validationRef, { id: str(validationRef.id, 'manifest.tracks.validation.id', fail), contentHash: trackContentHash(validationTrack(validationRef.id as string, splits)) }, 'manifest.tracks.validation', fail);
  // The built-in registry: the manifest names a split epoch by its hash, and every circuit it lists must belong to that epoch.
  const epoch = splits === BUILT_IN_TRACK_SPLITS ? manifestEpochOf(t.splitManifestHash) ?? LATEST_SPLIT_EPOCH : undefined;
  same(t.splitManifestHash, manifestRecord(splits, epoch).hash, 'manifest.tracks.splitManifestHash', fail);
  const heldList = dense(t.heldOut, 'manifest.tracks.heldOut', fail).map((h, i) => {
    const ref = exact(h, `manifest.tracks.heldOut[${i}]`, ['id', 'contentHash'], fail);
    const entry = splits.tracks.find((x) => x.id === ref.id);
    if (entry === undefined || entry.split !== 'held-out') fail(`manifest.tracks.heldOut[${i}] ("${String(ref.id)}") is not a registered held-out circuit.`);
    if (ref.contentHash !== entry!.contentHash) fail(`manifest.tracks.heldOut[${i}].contentHash does not match the registered circuit.`);
    return { id: ref.id as string, contentHash: ref.contentHash as string };
  });
  if (new Set(heldList.map((h) => h.id)).size !== heldList.length) fail('manifest.tracks.heldOut must be distinct.');
  // Every listed circuit must belong to the split epoch the manifest names (checked after the held-out entries are validated).
  if (epoch !== undefined) {
    for (const id of [trainingRef.id as string, validationRef.id as string, ...heldList.map((h) => h.id)]) {
      if (!epochIds(epoch).includes(id)) fail(`manifest.tracks lists "${id}", which is not part of the track set (split epoch ${epoch}) the manifest names.`);
    }
  }

  // The training block must already be complete and resolved: the trainer's resolvers give it back unchanged.
  try {
    const { setup } = resolveBaselineConfig({ training: { ...training, brakeEnabled: true }, generations: G, trackId: trainingRef.id as string }, seeds[0]!);
    const resolved = Object.fromEntries(Object.entries(setup.config).filter(([key]) => key !== 'seed' && key !== 'brakeEnabled'));
    if (canonicalJson(resolved) !== canonicalJson(training)) fail('manifest.configuration.training must be a complete resolved training configuration.');
  } catch (error) {
    if (error instanceof StudyManifestError) throw error;
    if (error instanceof Error && error.name === 'TrackLeakageError') throw error;
    return fail(`manifest.configuration.training is invalid: ${(error as Error).message}`);
  }

  if (label === 'confirmatory') {
    if (!builtIn) fail('a confirmatory manifest uses the built-in track registry.');
    if (G !== E4_CONFIRMATORY_GENERATIONS) fail(`a confirmatory manifest needs generations ${E4_CONFIRMATORY_GENERATIONS} (C1).`);
    same(training, c1Training(), 'manifest.configuration.training (a confirmatory manifest uses C1, the trainer defaults)', fail);
    if (trainingRef.id !== E4_TRAINING_TRACK || validationRef.id !== E4_VALIDATION_TRACK) {
      fail(`a confirmatory manifest's circuits are ${E4_TRAINING_TRACK} (training) and ${E4_VALIDATION_TRACK} (validation).`);
    }
    if (heldList.length === 0) fail('a confirmatory manifest lists at least one held-out circuit.');
  }
  if (label === 'mechanics' && builtIn && heldList.length > 0) {
    fail('a mechanics manifest on the built-in registry may not list a held-out circuit: mechanics never touches real held-out data.');
  }

  same(m.rules, ruleIds(), 'manifest.rules (the rule agents\' frozen identities)', fail);
  const a = exact(m.analysis, 'manifest.analysis', ['metric', 'delta', 'bootstrap', 'decisionRule'], fail);
  same(a.metric, METRIC, 'manifest.analysis.metric', fail);
  same(a.delta, E4_DELTA, 'manifest.analysis.delta', fail);
  same(a.bootstrap, E3_BOOTSTRAP, 'manifest.analysis.bootstrap', fail);
  same(a.decisionRule, E3_DECISION_RULE, 'manifest.analysis.decisionRule', fail);
  if (heldList.length > 0) {
    if (typeof m.authorisation !== 'string' || !/^[A-Za-z0-9._:/#-]{1,200}$/.test(m.authorisation)) fail('manifest.authorisation must name the owner\'s authorisation (1 to 200 letters, digits or . _ : / # -) when held-out circuits are listed.');
  } else if (m.authorisation !== null) fail('manifest.authorisation must be null when no held-out circuit is listed.');
  const code = exact(m.code, 'manifest.code', ['revision'], fail);
  if (code.revision === null) {
    if (label !== 'mechanics') fail(`a ${label} manifest needs manifest.code.revision, the commit it was frozen at.`);
  } else if (typeof code.revision !== 'string' || !REVISION.test(code.revision)) fail('manifest.code.revision must be a 40-character git commit or null.');
  return input as E3Manifest;
}

/** The agent configuration a manifest describes (A5's evolutionary run). */
export function e3AgentConfig(manifest: E3Manifest): E4AgentConfig {
  return {
    training: JSON.parse(JSON.stringify(manifest.configuration.training)) as E4TrainingSettings,
    generations: manifest.configuration.generations,
    trackId: manifest.tracks.training.id,
    validationTrackId: manifest.tracks.validation.id,
  };
}

/** The episode limits and scoring A5 was trained under; every E3 evaluation uses exactly these. */
function limitsOf(manifest: E3Manifest) {
  const { setup } = resolveBaselineConfig(
    { training: { ...manifest.configuration.training, brakeEnabled: true }, generations: manifest.configuration.generations, trackId: manifest.tracks.training.id },
    manifest.seeds[0]!,
  );
  const { maxEpisodeSeconds, stallSeconds, maxLaps, fitness } = setup.config;
  return { maxEpisodeSeconds, stallSeconds, maxLaps, fitness };
}

function validationSetup(manifest: E3Manifest, splits: TrackSplits): EvaluationSetup {
  return createEvaluationSetup(limitsOf(manifest), {
    track: validationTrack(manifest.tracks.validation.id, splits),
    physics: DEFAULT_VEHICLE_PHYSICS,
    timestepSeconds: DEFAULT_SIM_CONFIG.timestepSeconds,
  });
}

/** What checking an episode on a circuit needs. Held-out circuits use the validation setup's limits and scoring (the same limits). */
function episodeCheck(manifest: E3Manifest, trackId: string, splits: TrackSplits): EpisodeCheck {
  const setup = validationSetup(manifest, splits);
  const entry = splits.tracks.find((t) => t.id === trackId)!;
  return { maxTicks: setup.rules.maxEpisodeTicks, gates: entry.track.gates.length, fitness: setup.config.fitness, rules: setup.rules };
}

const gatesOf = (trackId: string, splits: TrackSplits): number => splits.tracks.find((t) => t.id === trackId)!.track.gates.length;

function evaluateFrozen(model: FrozenModel, setup: EvaluationSetup, gates: number): EpisodeResult {
  const { episode } = evaluateDriver(driverForFrozenAgent(model), setup);
  return episodeResult(episode, setup.config.fitness, setup.rules, gates);
}

/**
 * A manifest that names a frozen commit (always, when confirmatory; optionally in mechanics) only accepts runs and
 * records made from a clean checkout of exactly that commit. A null pin (mechanics only) imposes nothing. Replay is a
 * different question and reports the current source separately; it never goes through this check.
 */
function checkSourcePin(manifest: E3Manifest, source: ExperimentSource, fail: Fail): void {
  const pinned = manifest.code.revision;
  if (pinned === null) return;
  if (source.revision === null) fail(`the source revision is unknown, but the manifest is frozen at ${pinned}; run it from a clean checkout of that commit.`);
  else if (source.dirty !== false) fail(`the working tree was modified, but the manifest is frozen at ${pinned}; run it from a clean checkout of that commit.`);
  else if (source.revision !== pinned) fail(`the source revision ${source.revision} differs from the manifest's frozen commit ${pinned}.`);
}

function checkManifestAndContext(manifestInput: unknown, context: StudyContext, splits: TrackSplits): E3Manifest {
  const manifest = parseE3Manifest(manifestInput, splits);
  const fail: Fail = (message) => {
    throw new StudyRecordError(`Study context: ${message}`);
  };
  checkContext(context, fail);
  checkSourcePin(manifest, context.source, fail);
  return manifest;
}

// ---------------------------------------------------------------------------------------------------------------
// Seed records (A5)

export interface E3SeedRecord {
  readonly format: typeof E3_SEED_FORMAT;
  readonly version: typeof E3_VERSION;
  readonly manifestHash: string;
  readonly seed: number;
  readonly recordedAt: string;
  readonly source: ExperimentSource;
  readonly engine: ExperimentEngine;
  readonly contracts: ReturnType<typeof currentStudyContracts>;
  /** A5's champion (frozen model, selection) and its training-champion and validation episodes. */
  readonly a5: Json;
  readonly resultsHash: string;
}

const SEED_KEYS = ['format', 'version', 'manifestHash', 'seed', 'recordedAt', 'source', 'engine', 'contracts', 'a5', 'resultsHash'];
const A5_KEYS = ['generation', 'index', 'selection', 'model', 'training', 'validation'];

function a5Block(manifest: E3Manifest, seed: number): Json {
  const result = generateE4Agent(e3AgentConfig(manifest), 'A5', seed);
  return plain({
    generation: result.generation,
    index: result.index,
    selection: result.selection,
    model: modelJson(result.model),
    training: result.episodes.training,
    validation: result.episodes.validation,
  });
}

/** Runs one training seed: A5 is evolved, frozen and evaluated on the validation circuit. No held-out circuit is touched. */
export function runE3Seed(manifestInput: unknown, seed: number, context: StudyContext, splits: TrackSplits = BUILT_IN_TRACK_SPLITS): E3SeedRecord {
  const manifest = checkManifestAndContext(manifestInput, context, splits);
  if (!manifest.seeds.includes(seed)) throw new StudyManifestError(`E3 manifest: seed ${seed} is not one of the manifest's seeds.`);
  const a5 = a5Block(manifest, seed);
  return {
    format: E3_SEED_FORMAT,
    version: E3_VERSION,
    manifestHash: e3ManifestHash(manifest),
    seed,
    recordedAt: context.recordedAt,
    source: plain(context.source),
    engine: plain(context.engine),
    contracts: currentStudyContracts(),
    a5,
    resultsHash: hashOf(a5),
  };
}

function compat(r: Json, manifest: E3Manifest, engine: ExperimentEngine, what: string): void {
  const incompatible: Fail = (message) => {
    throw new StudyCompatibilityError(`${what} is incompatible: ${message}`);
  };
  if (r.manifestHash !== e3ManifestHash(manifest)) incompatible('it was recorded for another manifest (manifestHash differs).');
  const recorded = r.engine as Json;
  for (const key of ['name', 'version', 'v8'] as const) {
    if (recorded[key] !== engine[key]) incompatible(`engine ${key} ${String(recorded[key])} differs from this engine's ${engine[key]}; results are only reproducible within one engine.`);
  }
  if (canonicalJson(r.contracts) !== canonicalJson(currentStudyContracts())) incompatible('its contracts differ from this code\'s.');
}

function header(input: unknown, keys: readonly string[], format: string, what: string, fail: Fail): Json {
  denseEverywhere(input, 'record', fail);
  const r = exact(input, 'record', keys, fail);
  same(r.format, format, 'record.format', fail);
  same(r.version, E3_VERSION, 'record.version', fail);
  if (typeof r.manifestHash !== 'string' || !HASH.test(r.manifestHash)) fail('record.manifestHash must be a sha256: hash.');
  if (typeof r.recordedAt !== 'string' || !ISO_TIME.test(r.recordedAt)) fail('record.recordedAt must be an ISO 8601 UTC time.');
  void what;
  return r;
}

/** Checks a seed record against its manifest completely and returns it. Throws StudyRecordError or StudyCompatibilityError. */
export function parseE3SeedRecord(input: unknown, manifestInput: unknown, engine: ExperimentEngine, splits: TrackSplits = BUILT_IN_TRACK_SPLITS): E3SeedRecord {
  const manifest = parseE3Manifest(manifestInput, splits);
  const fail: Fail = (message) => {
    throw new StudyRecordError(`E3 seed record: ${message}`);
  };
  const r = header(input, SEED_KEYS, E3_SEED_FORMAT, 'seed record', fail);
  compat(r, manifest, engine, 'E3 seed record');
  const seed = int(r.seed, 'record.seed', 0, 0xffffffff, fail);
  if (!manifest.seeds.includes(seed)) fail(`record.seed ${seed} is not one of the manifest's seeds.`);
  checkContext({ engine: r.engine as ExperimentEngine, source: r.source as ExperimentSource, recordedAt: r.recordedAt as string }, fail);
  checkSourcePin(manifest, r.source as ExperimentSource, fail);
  const a = exact(r.a5, 'record.a5', A5_KEYS, fail);
  same(a.generation, manifest.configuration.generations - 1, 'record.a5.generation', fail);
  int(a.index, 'record.a5.index', 0, manifest.configuration.training.populationSize - 1, fail);
  same(a.selection, A5_SELECTION, 'record.a5.selection', fail);
  const model = exact(a.model, 'record.a5.model', ['id', 'parameters', 'provenance'], fail);
  let rebuilt: FrozenModel;
  try {
    rebuilt = freezeModel(dense(model.parameters, 'record.a5.model.parameters', fail) as number[], model.provenance as Record<string, string | number | boolean>);
  } catch (error) {
    return fail(`record.a5.model is not a valid frozen model: ${(error as Error).message}`);
  }
  try {
    // freezeModel proves integrity only; building the driver checks the parameter count (the network's architecture) too.
    driverForFrozenAgent(rebuilt);
  } catch (error) {
    return fail(`record.a5.model is not a usable A5 network: ${(error as Error).message}`);
  }
  if (rebuilt.id !== model.id) fail('record.a5.model.id does not match its parameters and provenance.');
  const training = manifest.tracks.training;
  same(model.provenance, {
    agent: 'A5', seed, generation: a.generation, index: a.index, selection: A5_SELECTION, trackId: training.id, trackContentHash: training.contentHash, brakeEnabled: true,
  }, 'record.a5.model.provenance', fail);
  checkEpisode(a.training, 'record.a5.training', episodeCheck(manifest, training.id, splits), fail);
  checkEpisode(a.validation, 'record.a5.validation', episodeCheck(manifest, manifest.tracks.validation.id, splits), fail);
  if (r.resultsHash !== hashOf(a)) fail('record.resultsHash does not match record.a5.');
  return input as E3SeedRecord;
}

export interface E3Replay {
  readonly identical: boolean;
  /** Up to 20 differing paths. */
  readonly differences: readonly string[];
  readonly sameSourceRevision: boolean | null;
}

/** Re-runs a seed record's A5 evolution and compares it with the record. Throws what parseE3SeedRecord throws. */
export function replayE3SeedRecord(input: unknown, manifestInput: unknown, engine: ExperimentEngine, source?: ExperimentSource, splits: TrackSplits = BUILT_IN_TRACK_SPLITS): E3Replay {
  const record = parseE3SeedRecord(input, manifestInput, engine, splits);
  const fresh = a5Block(manifestInput as E3Manifest, record.seed);
  const differences = jsonDifferences(record.a5, fresh, 'a5', 20);
  const sameSourceRevision = source?.revision && record.source.revision ? source.revision === record.source.revision : null;
  return { identical: differences.length === 0, differences, sameSourceRevision };
}

// ---------------------------------------------------------------------------------------------------------------
// Rules record (A3, A3-nb, A3-nb-same on the validation circuit)

export interface E3RulesRecord {
  readonly format: typeof E3_RULES_FORMAT;
  readonly version: typeof E3_VERSION;
  readonly manifestHash: string;
  readonly recordedAt: string;
  readonly source: ExperimentSource;
  readonly engine: ExperimentEngine;
  readonly contracts: ReturnType<typeof currentStudyContracts>;
  readonly agents: Json;
  readonly resultsHash: string;
}

const RULES_KEYS = ['format', 'version', 'manifestHash', 'recordedAt', 'source', 'engine', 'contracts', 'agents', 'resultsHash'];

function rulesBlock(manifest: E3Manifest, splits: TrackSplits): Json {
  const setup = validationSetup(manifest, splits);
  const gates = gatesOf(manifest.tracks.validation.id, splits);
  return plain(Object.fromEntries(RULE_AGENTS.map((agent) => {
    const model = freezeRuleAgent(agent);
    return [agent, { modelId: model.id, validation: evaluateFrozen(model, setup, gates) }];
  })));
}

/** Evaluates the three frozen rule agents on the validation circuit. */
export function runE3Rules(manifestInput: unknown, context: StudyContext, splits: TrackSplits = BUILT_IN_TRACK_SPLITS): E3RulesRecord {
  const manifest = checkManifestAndContext(manifestInput, context, splits);
  const agents = rulesBlock(manifest, splits);
  return {
    format: E3_RULES_FORMAT,
    version: E3_VERSION,
    manifestHash: e3ManifestHash(manifest),
    recordedAt: context.recordedAt,
    source: plain(context.source),
    engine: plain(context.engine),
    contracts: currentStudyContracts(),
    agents,
    resultsHash: hashOf(agents),
  };
}

export function parseE3RulesRecord(input: unknown, manifestInput: unknown, engine: ExperimentEngine, splits: TrackSplits = BUILT_IN_TRACK_SPLITS): E3RulesRecord {
  const manifest = parseE3Manifest(manifestInput, splits);
  const fail: Fail = (message) => {
    throw new StudyRecordError(`E3 rules record: ${message}`);
  };
  const r = header(input, RULES_KEYS, E3_RULES_FORMAT, 'rules record', fail);
  compat(r, manifest, engine, 'E3 rules record');
  checkContext({ engine: r.engine as ExperimentEngine, source: r.source as ExperimentSource, recordedAt: r.recordedAt as string }, fail);
  checkSourcePin(manifest, r.source as ExperimentSource, fail);
  const agents = exact(r.agents, 'record.agents', [...RULE_AGENTS], fail);
  const ids = ruleIds();
  const check = episodeCheck(manifest, manifest.tracks.validation.id, splits);
  for (const agent of RULE_AGENTS) {
    const block = exact(agents[agent], `record.agents.${agent}`, ['modelId', 'validation'], fail);
    same(block.modelId, ids[agent], `record.agents.${agent}.modelId`, fail);
    checkEpisode(block.validation, `record.agents.${agent}.validation`, check, fail);
  }
  if (r.resultsHash !== hashOf(agents)) fail('record.resultsHash does not match record.agents.');
  return input as E3RulesRecord;
}

export function replayE3RulesRecord(input: unknown, manifestInput: unknown, engine: ExperimentEngine, source?: ExperimentSource, splits: TrackSplits = BUILT_IN_TRACK_SPLITS): E3Replay {
  const record = parseE3RulesRecord(input, manifestInput, engine, splits);
  const differences = jsonDifferences(record.agents, rulesBlock(manifestInput as E3Manifest, splits), 'agents', 20);
  const sameSourceRevision = source?.revision && record.source.revision ? source.revision === record.source.revision : null;
  return { identical: differences.length === 0, differences, sameSourceRevision };
}

// ---------------------------------------------------------------------------------------------------------------
// The held-out record: the one opening

export interface E3HeldOutEvaluation {
  readonly agent: 'A5' | RuleAgent;
  /** The training seed of an A5 champion; null for a rule agent. */
  readonly seed: number | null;
  readonly modelId: string;
  readonly trackId: string;
  readonly episode: EpisodeResult;
}

export interface E3HeldOutRecord {
  readonly format: typeof E3_HELDOUT_FORMAT;
  readonly version: typeof E3_VERSION;
  readonly manifestHash: string;
  readonly recordedAt: string;
  readonly source: ExperimentSource;
  readonly engine: ExperimentEngine;
  readonly contracts: ReturnType<typeof currentStudyContracts>;
  /** The opening the gate recorded: the protocol hash (the manifest's hash), the authorisation, the circuits and the agents. */
  readonly opening: HeldOutOpening;
  readonly evaluations: readonly E3HeldOutEvaluation[];
  readonly resultsHash: string;
}

const HELDOUT_KEYS = ['format', 'version', 'manifestHash', 'recordedAt', 'source', 'engine', 'contracts', 'opening', 'evaluations', 'resultsHash'];

/** The frozen agents of a study, in a fixed order: A5 champions by seed, then the rule agents. */
function frozenAgents(manifest: E3Manifest, seedRecords: readonly E3SeedRecord[]): { agent: 'A5' | RuleAgent; seed: number | null; model: FrozenModel }[] {
  const out: { agent: 'A5' | RuleAgent; seed: number | null; model: FrozenModel }[] = [];
  for (const seed of manifest.seeds) {
    const record = seedRecords.find((r) => r.seed === seed)!;
    const m = record.a5.model as { parameters: number[]; provenance: Record<string, string | number | boolean> };
    out.push({ agent: 'A5', seed, model: freezeModel(m.parameters, m.provenance) });
  }
  for (const agent of RULE_AGENTS) out.push({ agent, seed: null, model: freezeRuleAgent(agent) });
  return out;
}

/** The held-out protocol a manifest and its frozen agents define. */
export function e3HeldOutProtocol(manifestInput: unknown, seedRecords: readonly E3SeedRecord[], splits: TrackSplits = BUILT_IN_TRACK_SPLITS): HeldOutProtocol {
  const manifest = parseE3Manifest(manifestInput, splits);
  if (manifest.authorisation === null) throw new StudyManifestError('E3 manifest: no held-out circuit is listed, so there is no held-out protocol.');
  return {
    protocolHash: e3ManifestHash(manifest),
    authorisationId: manifest.authorisation,
    trackIds: manifest.tracks.heldOut.map((t) => t.id),
    agentIds: frozenAgents(manifest, seedRecords).map((a) => a.model.id),
  };
}

function checkSeedRecords(manifest: E3Manifest, seedRecords: readonly unknown[], engine: ExperimentEngine, splits: TrackSplits): E3SeedRecord[] {
  const parsed = seedRecords.map((r) => parseE3SeedRecord(r, manifest, engine, splits));
  const seeds = parsed.map((r) => r.seed);
  if (canonicalJson(seeds) !== canonicalJson(manifest.seeds)) {
    throw new StudyRecordError(`E3 held-out: the seed records must be exactly the manifest's seeds in order (${manifest.seeds.join(', ')}), got ${seeds.join(', ')}.`);
  }
  return parsed;
}

/** Checks every seed record against the manifest (complete, in order, valid) and returns them. The command line builds the gate from these. */
export function parseE3SeedRecords(manifestInput: unknown, seedRecords: readonly unknown[], engine: ExperimentEngine, splits: TrackSplits = BUILT_IN_TRACK_SPLITS): E3SeedRecord[] {
  return checkSeedRecords(parseE3Manifest(manifestInput, splits), seedRecords, engine, splits);
}

/**
 * The ONE held-out look: every frozen agent (all seeds' A5 champions, then the rule agents) is evaluated once on each
 * listed held-out circuit through the gate. The gate must be made for exactly this study's protocol (`e3HeldOutProtocol`)
 * with a ledger restored from earlier openings; opening it claims the protocol in that ledger. Every seed record and the
 * rules record must already exist and be valid, so every agent is frozen before the look.
 */
export function runE3HeldOut(
  manifestInput: unknown,
  seedRecords: readonly unknown[],
  rulesRecord: unknown,
  gate: HeldOutGate,
  context: StudyContext,
  splits: TrackSplits = BUILT_IN_TRACK_SPLITS,
): E3HeldOutRecord {
  const manifest = checkManifestAndContext(manifestInput, context, splits);
  if (manifest.authorisation === null) throw new StudyManifestError('E3 manifest: no held-out circuit is listed, so there is nothing to evaluate.');
  const seeds = checkSeedRecords(manifest, seedRecords, context.engine, splits);
  parseE3RulesRecord(rulesRecord, manifest, context.engine, splits);
  const agents = frozenAgents(manifest, seeds);
  // Every frozen agent must build a driver before the opening is claimed, so a bad model can never use up the one look.
  for (const { model } of agents) driverForFrozenAgent(model);
  const protocol = e3HeldOutProtocol(manifest, seeds, splits);
  if (canonicalJson(gate.protocol) !== canonicalJson(protocol)) {
    throw new HeldOutAccessError('The gate was not made for this study\'s protocol (manifest hash, authorisation, held-out circuits and frozen agents must match exactly).');
  }
  const session = gate.open(manifest.authorisation);
  const config = limitsOf(manifest);
  const evaluations: E3HeldOutEvaluation[] = [];
  // The limits and scoring are the training run's own; the validation setup carries them (no held-out track is read here).
  const scoring = validationSetup(manifest, splits);
  for (const track of manifest.tracks.heldOut) {
    const gates = gatesOf(track.id, splits);
    for (const { agent, seed, model } of agents) {
      const result = session.evaluate(model, track.id, config);
      evaluations.push({ agent, seed, modelId: model.id, trackId: track.id, episode: episodeResult(result.episode, scoring.config.fitness, scoring.rules, gates) });
    }
  }
  const plainEvaluations = plain(evaluations);
  return {
    format: E3_HELDOUT_FORMAT,
    version: E3_VERSION,
    manifestHash: e3ManifestHash(manifest),
    recordedAt: context.recordedAt,
    source: plain(context.source),
    engine: plain(context.engine),
    contracts: currentStudyContracts(),
    opening: plain(session.opening),
    evaluations: plainEvaluations,
    resultsHash: hashOf({ opening: session.opening, evaluations: plainEvaluations }),
  };
}

/** Checks a held-out record against its manifest and seed records completely and returns it. */
export function parseE3HeldOutRecord(
  input: unknown,
  manifestInput: unknown,
  seedRecords: readonly unknown[],
  engine: ExperimentEngine,
  splits: TrackSplits = BUILT_IN_TRACK_SPLITS,
): E3HeldOutRecord {
  const manifest = parseE3Manifest(manifestInput, splits);
  const fail: Fail = (message) => {
    throw new StudyRecordError(`E3 held-out record: ${message}`);
  };
  if (manifest.authorisation === null) fail('the manifest lists no held-out circuit.');
  const seeds = checkSeedRecords(manifest, seedRecords, engine, splits);
  const r = header(input, HELDOUT_KEYS, E3_HELDOUT_FORMAT, 'held-out record', fail);
  compat(r, manifest, engine, 'E3 held-out record');
  checkContext({ engine: r.engine as ExperimentEngine, source: r.source as ExperimentSource, recordedAt: r.recordedAt as string }, fail);
  checkSourcePin(manifest, r.source as ExperimentSource, fail);
  const agents = frozenAgents(manifest, seeds);
  const protocol = e3HeldOutProtocol(manifest, seeds, splits);
  const opening = exact(r.opening, 'record.opening', ['protocolHash', 'authorisationId', 'trackIds', 'agentIds'], fail);
  same(opening, protocol, 'record.opening (the protocol this manifest and its frozen agents define)', fail);
  const evals = dense(r.evaluations, 'record.evaluations', fail);
  const expected = manifest.tracks.heldOut.flatMap((t) => agents.map((a) => ({ track: t.id, ...a })));
  if (evals.length !== expected.length) fail(`record.evaluations must hold ${expected.length} evaluations (each frozen agent once on each held-out circuit), got ${evals.length}.`);
  evals.forEach((value, i) => {
    const e = exact(value, `record.evaluations[${i}]`, ['agent', 'seed', 'modelId', 'trackId', 'episode'], fail);
    const want = expected[i]!;
    same([e.agent, e.seed, e.modelId, e.trackId], [want.agent, want.seed, want.model.id, want.track], `record.evaluations[${i}] (agent, seed, model, circuit)`, fail);
    checkEpisode(e.episode, `record.evaluations[${i}].episode`, episodeCheck(manifest, want.track, splits), fail);
  });
  if (r.resultsHash !== hashOf({ opening: r.opening, evaluations: r.evaluations })) fail('record.resultsHash does not match the opening and evaluations.');
  return input as E3HeldOutRecord;
}

/** The ledger a restart must use: restored from the openings of the held-out records already written. */
export function ledgerFromHeldOutRecords(records: readonly { readonly opening: HeldOutOpening }[]): OpeningLedger {
  return createMemoryLedger(records.map((r) => r.opening));
}

/**
 * Verifies a held-out record by re-evaluating its frozen agents on the held-out circuits through a REPLAY gate (a fresh
 * ledger, the protocol's own authorisation). This reveals nothing the record does not already hold; it is a check, not a
 * new look, and it never touches the study's real ledger.
 */
export function replayE3HeldOutRecord(
  input: unknown,
  manifestInput: unknown,
  seedRecords: readonly unknown[],
  engine: ExperimentEngine,
  source?: ExperimentSource,
  splits: TrackSplits = BUILT_IN_TRACK_SPLITS,
): E3Replay {
  const record = parseE3HeldOutRecord(input, manifestInput, seedRecords, engine, splits);
  const manifest = manifestInput as E3Manifest;
  const seeds = seedRecords.map((r) => r as E3SeedRecord);
  const gate = createHeldOutGate(e3HeldOutProtocol(manifest, seeds, splits), createMemoryLedger(), splits);
  const fresh = runE3HeldOut(manifest, seedRecords, makeRulesPlaceholder(manifest, { engine, source: record.source, recordedAt: record.recordedAt }, splits), gate, {
    engine,
    source: record.source,
    recordedAt: record.recordedAt,
  }, splits);
  const differences = jsonDifferences(record.evaluations, fresh.evaluations, 'evaluations', 20);
  const sameSourceRevision = source?.revision && record.source.revision ? source.revision === record.source.revision : null;
  return { identical: differences.length === 0, differences, sameSourceRevision };
}

/** A valid rules record for replay's internal run (its content is not compared; the held-out record has no rules block). */
function makeRulesPlaceholder(manifest: E3Manifest, context: StudyContext, splits: TrackSplits): E3RulesRecord {
  return runE3Rules(manifest, context, splits);
}

// ---------------------------------------------------------------------------------------------------------------
// The analysis

const orderedProgress = (episode: EpisodeResult, gates: number): number => episode.gatesPassed / gates;

function agentSummary(episodes: readonly EpisodeResult[], gates: number): Json {
  const progress = episodes.map((e) => orderedProgress(e, gates));
  return {
    n: episodes.length,
    progress,
    median: median(progress),
    iqr: iqr(progress),
    lapCompletions: episodes.filter((e) => e.lapTicks.length >= 1).length,
    crashes: episodes.filter((e) => e.crashed).length,
  };
}

/** The decision wording for one contrast, from the predeclared delta and the bootstrap interval (never from a p-value). */
export function classifyE3(mean: number, lower: number, upper: number, delta: number): 'a5-higher' | 'rule-higher' | 'no-clear-difference' {
  if (lower > 0 && mean >= delta) return 'a5-higher';
  if (upper < 0 && mean <= -delta) return 'rule-higher';
  return 'no-clear-difference';
}

/**
 * One contrast: A5's per-seed ordered progress against a deterministic rule agent's single value. The differences are
 * A5 minus the rule; the interval is the seed-cluster bootstrap of their mean (the rule contributes no sampling variation).
 */
export function e3Contrast(a5Progress: readonly number[], ruleProgress: number, analysis: Pick<E3Manifest['analysis'], 'delta' | 'bootstrap'>): Json {
  const diffs = a5Progress.map((p) => p - ruleProgress);
  const mean = diffs.reduce((sum, d) => sum + d, 0) / diffs.length;
  const ci = bootstrapMeanInterval(diffs, analysis.bootstrap);
  return {
    meanDifference: mean,
    interval: [ci.lower, ci.upper],
    seedsA5Higher: diffs.filter((d) => d > 0).length,
    seedsTied: diffs.filter((d) => d === 0).length,
    seedsRuleHigher: diffs.filter((d) => d < 0).length,
    outcome: classifyE3(mean, ci.lower, ci.upper, analysis.delta),
  };
}

/**
 * The E3 analysis, a pure function of the records. For the validation circuit and each held-out circuit: A5's per-seed
 * ordered progress against each deterministic rule agent's single value, the seed-cluster bootstrap interval for the
 * mean difference A5 minus the rule, and how many seeds beat it. Held-out results are included only when a held-out record
 * is given. "No clear difference" is a valid, reported outcome. Nothing here is a statement about learning beyond these tracks.
 */
export function analyseE3(
  manifestInput: unknown,
  seedRecords: readonly unknown[],
  rulesRecord: unknown,
  heldOutRecord: unknown | null,
  engine: ExperimentEngine,
  splits: TrackSplits = BUILT_IN_TRACK_SPLITS,
): Json {
  const manifest = parseE3Manifest(manifestInput, splits);
  const seeds = checkSeedRecords(manifest, seedRecords, engine, splits);
  const rules = parseE3RulesRecord(rulesRecord, manifest, engine, splits);
  const held = heldOutRecord === null ? null : parseE3HeldOutRecord(heldOutRecord, manifest, seeds, engine, splits);
  const tracks: Json[] = [];
  const build = (trackId: string, split: 'validation' | 'held-out', a5: EpisodeResult[], ruleEpisodes: Record<RuleAgent, EpisodeResult>): void => {
    const gates = gatesOf(trackId, splits);
    const summaries: Json = { A5: agentSummary(a5, gates) };
    const contrasts: Json = {};
    for (const agent of RULE_AGENTS) {
      summaries[agent] = agentSummary([ruleEpisodes[agent]], gates);
      contrasts[agent] = e3Contrast(a5.map((e) => orderedProgress(e, gates)), orderedProgress(ruleEpisodes[agent], gates), manifest.analysis);
    }
    tracks.push({ trackId, split, agents: summaries, contrasts });
  };
  build(
    manifest.tracks.validation.id,
    'validation',
    seeds.map((r) => (r.a5.validation as unknown) as EpisodeResult),
    Object.fromEntries(RULE_AGENTS.map((a) => [a, (rules.agents[a] as Json).validation as unknown as EpisodeResult])) as Record<RuleAgent, EpisodeResult>,
  );
  if (held !== null) {
    for (const track of manifest.tracks.heldOut) {
      const rows = held.evaluations.filter((e) => e.trackId === track.id);
      build(
        track.id,
        'held-out',
        rows.filter((e) => e.agent === 'A5').map((e) => e.episode),
        Object.fromEntries(RULE_AGENTS.map((a) => [a, rows.find((e) => e.agent === a)!.episode])) as Record<RuleAgent, EpisodeResult>,
      );
    }
  }
  return plain({
    format: 'self-driving-ai-evolution/p5-01-e3-analysis',
    version: E3_VERSION,
    manifestHash: e3ManifestHash(manifest),
    label: manifest.label,
    evidence:
      manifest.label === 'mechanics'
        ? 'MECHANICS ONLY: a check that the machinery runs. Not study evidence and not acceptance evidence, whatever the numbers say.'
        : 'Confirmatory study analysis under the manifest\'s predeclared rule.',
    seedCount: manifest.seeds.length,
    metric: manifest.analysis.metric,
    decisionRule: manifest.analysis.decisionRule,
    delta: manifest.analysis.delta,
    bootstrap: manifest.analysis.bootstrap,
    seeds: manifest.seeds,
    heldOutIncluded: held !== null,
    tracks,
    claim:
      'Descriptive comparison of an evolved driver against a hand-written rule on the listed circuits; it supports no statement about learning or generalisation beyond them, and "no clear difference" is a valid outcome.',
  });
}

/** The analysis as canonical JSON text. */
export const e3AnalysisJson = (analysis: Json): string => `${canonicalJson(analysis)}\n`;

/** A short Markdown report of an analysis, deterministic for a given analysis. */
export function renderE3Report(analysis: Json): string {
  const label = String(analysis.label);
  const n = analysis.seedCount as number;
  const lines: string[] = [`# P5-01 E3 (${label}): evolved A5 against the hand-written rule agents`, '', ...(label === 'mechanics' ? [`> **${String(analysis.evidence)}**`, ''] : []), `Label ${label}; ${n} independent seed${n === 1 ? '' : 's'}. Manifest \`${String(analysis.manifestHash)}\`. Metric ${String(analysis.metric)}; predeclared meaningful difference ${String(analysis.delta)}; seeds ${(analysis.seeds as number[]).join(', ')}.`, '', `**${String(analysis.claim)}**`, ''];
  for (const t of analysis.tracks as Json[]) {
    lines.push(`## ${String(t.trackId)} (${String(t.split)})`, '', '| Rule agent | A5 − rule (mean) | 95% interval | A5 higher / tied / rule higher | Outcome |', '| --- | --- | --- | --- | --- |');
    for (const agent of RULE_AGENTS) {
      const c = (t.contrasts as Json)[agent] as Json;
      const [lo, hi] = c.interval as number[];
      lines.push(`| ${agent} | ${(c.meanDifference as number).toFixed(3)} | ${lo!.toFixed(3)} to ${hi!.toFixed(3)} | ${String(c.seedsA5Higher)} / ${String(c.seedsTied)} / ${String(c.seedsRuleHigher)} | ${String(c.outcome)} |`);
    }
    lines.push('');
  }
  lines.push('## Limits', '', '- The rule agents are deterministic, so each contributes one value per circuit; the interval is over A5\'s training seeds.', '- A3-nb was tuned separately from A3; only A3 against A3-nb-same is a brake ablation.', `- ${n} independent seed${n === 1 ? '' : 's'} and a few circuits: an interval is a guide, not proof.`, '');
  return lines.join('\n');
}
