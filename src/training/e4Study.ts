// P2-09 E4 study kind (docs/experiments/p2-09-plan.md §3, §5 and §6): a versioned manifest (the preregistration), one
// versioned record per training seed holding A4's and A5's raw results, strict parsing of both, and same-engine replay.
// Tooling only: this module runs one seed when asked, never a study, and writes no files. The command line is
// scripts/e4.mjs. It reuses the P2-08 study module's parsing helpers (study.ts) rather than changing them.
//
// The brake mask is bound per agent: A4 is always `false` and A5 always `true` (E4_BRAKE). A manifest fixes that
// binding and its training configuration may not contain `brakeEnabled`; a record's model identities, replay and
// brake-usage counts all use each agent's own value, and a model moved into the other agent's slot, or carrying the
// other value, is rejected naming the path.
//
// Boundaries: the manifest's tracks must be a training and a validation track (the held-out track is refused with
// TrackLeakageError). Selection is training fitness only, validation results are descriptive, and nothing here calls
// heldOutTrack. The reserved E4 seeds are 2001–2010.
import { DEFAULT_TRAINING_CONFIG } from './trainer';
import { resolveBaselineConfig, selectBest } from './baselines';
import { canonicalJson, jsonDifferences, type ExperimentEngine, type ExperimentSource } from './experiment';
import {
  E4_AGENTS,
  E4_BRAKE,
  E4_SELECTION,
  BRAKE_USAGE_THRESHOLD,
  e4Evaluation,
  evaluateE4Model,
  generateE4Agent,
  type E4AgentConfig,
  type E4Agent,
  type E4AgentResult,
  type E4TrainingSettings,
} from './e4Agents';
import {
  arr,
  checkCandidate,
  checkContext,
  checkEpisode,
  checkModel,
  currentStreams,
  currentStudyContracts,
  denseEverywhere,
  dense,
  E4_SEEDS,
  exact,
  finite,
  HASH,
  hashOf,
  ID_PATTERN,
  int,
  isPlainObject,
  MAX_MECHANICS_SEEDS,
  METRIC,
  modelJson,
  plain,
  reserved,
  same,
  StudyCompatibilityError,
  StudyManifestError,
  StudyRecordError,
  str,
  ticksOf,
  totals,
  recordedTrackReferences,
  trackReferences,
  WILCOXON,
  REVISION,
  type EpisodeCheck,
  type Fail,
  type Json,
  type StudyContext,
  type StudyContracts,
} from './study';
import { freezeModel, trainingTrack, validationTrack } from './trackSplits';

export const E4_MANIFEST_FORMAT = 'self-driving-ai-evolution/p2-09-e4-manifest';
export const E4_RECORD_FORMAT = 'self-driving-ai-evolution/p2-09-e4-seed-record';
export const E4_VERSION = 1;
export const E4_LABELS = Object.freeze(['mechanics', 'confirmatory'] as const);
export type E4Label = (typeof E4_LABELS)[number];
/** The predeclared meaningful difference between A5 and A4 on the training track, in laps (plan §5). Fixed, never raised. */
export const E4_DELTA = 0.25;
export const E4_BOOTSTRAP = Object.freeze({ resamples: 10_000, seed: 20261103, level: 0.95, method: 'percentile-nearest-rank-v1' });
export const E4_DECISION_RULE = 'p2-09-e4-decision-v1';
/** The confirmatory configuration (C1, the trainer defaults) and its tracks, preregistered in the plan (§5). */
export const E4_CONFIRMATORY_GENERATIONS = 100;
export const E4_TRAINING_TRACK = 'stadium-oval';
export const E4_VALIDATION_TRACK = 'rounded-rectangle';

export interface E4Manifest {
  readonly format: typeof E4_MANIFEST_FORMAT;
  readonly version: typeof E4_VERSION;
  readonly id: string;
  readonly label: E4Label;
  readonly description: string;
  readonly agents: readonly string[];
  /** The fixed per-agent brake mask: A4 false, A5 true. Recorded so it is part of the preregistered, hashed manifest. */
  readonly brake: { readonly A4: false; readonly A5: true };
  readonly seeds: readonly number[];
  readonly configuration: {
    readonly generations: number;
    /** The shared training configuration, without `brakeEnabled` and without a seed. */
    readonly training: E4TrainingSettings;
  };
  readonly streams: ReturnType<typeof currentStreams>;
  readonly tracks: ReturnType<typeof trackReferences>;
  readonly metric: typeof METRIC;
  readonly analysis: {
    readonly delta: number;
    readonly bootstrap: typeof E4_BOOTSTRAP;
    readonly wilcoxon: typeof WILCOXON;
    readonly decisionRule: typeof E4_DECISION_RULE;
    readonly brakeUsageThreshold: number;
  };
  readonly code: { readonly revision: string | null };
}

export interface E4Record {
  readonly format: typeof E4_RECORD_FORMAT;
  readonly version: typeof E4_VERSION;
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

export interface E4Replay {
  readonly identical: boolean;
  /** Up to 20 differing paths in `agents`. */
  readonly differences: readonly string[];
  /** Whether each frozen model, driven alone with its own brake value, reproduced its recorded episodes and brake usage. */
  readonly modelsReplayed: Readonly<Record<E4Agent, boolean>>;
  readonly sameSourceRevision: boolean | null;
}

const TRAINING_KEYS = Object.keys(DEFAULT_TRAINING_CONFIG).filter((key) => key !== 'seed' && key !== 'brakeEnabled');
const NESTED_KEYS: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  Object.entries(DEFAULT_TRAINING_CONFIG).filter(([key, v]) => key !== 'seed' && isPlainObject(v)).map(([k, v]) => [k, Object.keys(v as object)]),
);
const MANIFEST_KEYS = ['format', 'version', 'id', 'label', 'description', 'agents', 'brake', 'seeds', 'configuration', 'streams', 'tracks', 'metric', 'analysis', 'code'];

/** `sha256:` + SHA-256 of the manifest's canonical JSON; every record carries it. */
export function e4ManifestHash(manifest: E4Manifest): string {
  return hashOf(manifest);
}

/** The shared training configuration the plan preregisters (C1: the trainer defaults), without the seed and the brake mask. */
export function c1Training(): E4TrainingSettings {
  const { setup } = resolveBaselineConfig({ training: {}, generations: E4_CONFIRMATORY_GENERATIONS, trackId: E4_TRAINING_TRACK }, 0);
  return Object.fromEntries(Object.entries(setup.config).filter(([key]) => key !== 'seed' && key !== 'brakeEnabled')) as unknown as E4TrainingSettings;
}

/**
 * Checks an E4 manifest completely and returns it. Throws StudyManifestError for any missing or unknown field (at
 * every level), a wrong constant, a per-agent brake setting other than A4 = false and A5 = true, a shared training
 * configuration that contains `brakeEnabled` or is not a complete resolved configuration, no elites, a delta other
 * than 0.25, seeds that break the label's set (a mechanics manifest may not use a reserved seed; a confirmatory one
 * is exactly 2001–2010, C1 and the oval/rounded-rectangle pair) or a missing code revision outside mechanics; and
 * TrackLeakageError if a track is not in its split.
 */
export function parseE4Manifest(input: unknown): E4Manifest {
  const fail: Fail = (message) => {
    throw new StudyManifestError(`E4 manifest: ${message}`);
  };
  denseEverywhere(input, 'manifest', fail);
  const m = exact(input, 'manifest', MANIFEST_KEYS, fail);
  same(m.format, E4_MANIFEST_FORMAT, 'manifest.format', fail);
  same(m.version, E4_VERSION, 'manifest.version', fail);
  if (typeof m.id !== 'string' || !ID_PATTERN.test(m.id)) fail('manifest.id must be 1 to 64 lowercase letters, digits or hyphens.');
  if (!E4_LABELS.includes(m.label as E4Label)) fail(`manifest.label must be one of ${E4_LABELS.join(', ')}.`);
  const label = m.label as E4Label;
  if (str(m.description, 'manifest.description', fail).length > 1000) fail('manifest.description must be at most 1000 characters.');
  same(m.agents, E4_AGENTS, 'manifest.agents', fail);
  same(m.brake, E4_BRAKE, 'manifest.brake', fail);

  const seedList = dense(m.seeds, 'manifest.seeds', fail);
  if (seedList.length === 0) fail('manifest.seeds must be a non-empty array.');
  const seeds = seedList.map((s, i) => int(s, `manifest.seeds[${i}]`, 0, 0xffffffff, fail));
  if (new Set(seeds).size !== seeds.length) fail('manifest.seeds must be distinct.');
  if (label === 'confirmatory') same(seeds, E4_SEEDS, 'manifest.seeds (a confirmatory manifest\'s seeds are exactly 2001–2010, in order)', fail);
  if (label === 'mechanics') {
    if (seeds.some(reserved)) fail('a mechanics manifest may not use a reserved seed (pilot 9001–9003, P2-08 confirmatory 1001–1020 or E4 2001–2010).');
    if (seeds.length > MAX_MECHANICS_SEEDS) fail(`a mechanics manifest has at most ${MAX_MECHANICS_SEEDS} seeds.`);
  }

  const c = exact(m.configuration, 'manifest.configuration', ['generations', 'training'], fail);
  const G = int(c.generations, 'manifest.configuration.generations', 1, 10_000, fail);
  if (isPlainObject(c.training) && Object.prototype.hasOwnProperty.call(c.training, 'brakeEnabled')) {
    fail('manifest.configuration.training.brakeEnabled must not be set: the brake mask is fixed per agent (A4 = false, A5 = true), not part of the shared configuration.');
  }
  const training = exact(c.training, 'manifest.configuration.training', TRAINING_KEYS, fail);
  for (const [key, keys] of Object.entries(NESTED_KEYS)) exact(training[key], `manifest.configuration.training.${key}`, keys, fail);
  if (!(typeof training.eliteCount === 'number' && training.eliteCount >= 1)) fail('manifest.configuration.training.eliteCount must be at least 1.');

  same(m.streams, currentStreams(), 'manifest.streams', fail);
  const t = exact(m.tracks, 'manifest.tracks', ['training', 'validation', 'splitManifestHash'], fail);
  const trainingRef = exact(t.training, 'manifest.tracks.training', ['id', 'contentHash'], fail);
  const validationRef = exact(t.validation, 'manifest.tracks.validation', ['id', 'contentHash'], fail);
  // trainingTrack / validationTrack throw TrackLeakageError for a track outside its split, held-out included.
  same(t, recordedTrackReferences(t, str(trainingRef.id, 'manifest.tracks.training.id', fail), str(validationRef.id, 'manifest.tracks.validation.id', fail)), 'manifest.tracks', fail);

  // The training block must already be complete and resolved: the trainer's resolvers give it back unchanged.
  let resolved: Json;
  try {
    const { setup } = resolveBaselineConfig({ training: { ...training, brakeEnabled: true }, generations: G, trackId: trainingRef.id }, seeds[0]!);
    resolved = Object.fromEntries(Object.entries(setup.config).filter(([key]) => key !== 'seed' && key !== 'brakeEnabled'));
  } catch (error) {
    if (error instanceof Error && error.name === 'TrackLeakageError') throw error;
    return fail(`manifest.configuration.training is invalid: ${(error as Error).message}`);
  }
  if (canonicalJson(resolved) !== canonicalJson(training)) fail('manifest.configuration.training must be a complete resolved training configuration.');
  if (label === 'confirmatory') {
    if (G !== E4_CONFIRMATORY_GENERATIONS) fail(`a confirmatory manifest needs generations ${E4_CONFIRMATORY_GENERATIONS} (C1).`);
    same(training, c1Training(), 'manifest.configuration.training (a confirmatory manifest uses C1, the trainer defaults)', fail);
    if (trainingRef.id !== E4_TRAINING_TRACK || validationRef.id !== E4_VALIDATION_TRACK) {
      fail(`a confirmatory manifest's tracks are ${E4_TRAINING_TRACK} (training) and ${E4_VALIDATION_TRACK} (validation).`);
    }
  }

  same(m.metric, METRIC, 'manifest.metric', fail);
  const a = exact(m.analysis, 'manifest.analysis', ['delta', 'bootstrap', 'wilcoxon', 'decisionRule', 'brakeUsageThreshold'], fail);
  if (finite(a.delta, 'manifest.analysis.delta', fail) !== E4_DELTA) fail(`manifest.analysis.delta must be exactly ${E4_DELTA}, the predeclared meaningful difference.`);
  same(a.bootstrap, E4_BOOTSTRAP, 'manifest.analysis.bootstrap', fail);
  same(a.wilcoxon, WILCOXON, 'manifest.analysis.wilcoxon', fail);
  same(a.decisionRule, E4_DECISION_RULE, 'manifest.analysis.decisionRule', fail);
  same(a.brakeUsageThreshold, BRAKE_USAGE_THRESHOLD, 'manifest.analysis.brakeUsageThreshold', fail);
  const code = exact(m.code, 'manifest.code', ['revision'], fail);
  if (code.revision === null) {
    if (label !== 'mechanics') fail(`a ${label} manifest needs manifest.code.revision, the commit it was frozen at.`);
  } else if (typeof code.revision !== 'string' || !REVISION.test(code.revision)) fail('manifest.code.revision must be a 40-character git commit or null.');
  return input as E4Manifest;
}

/** The agent configuration a manifest describes. */
export function e4AgentConfigFor(manifest: E4Manifest): E4AgentConfig {
  return {
    training: JSON.parse(JSON.stringify(manifest.configuration.training)) as E4TrainingSettings,
    generations: manifest.configuration.generations,
    trackId: manifest.tracks.training.id,
    validationTrackId: manifest.tracks.validation.id,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Records

const RECORD_KEYS = ['format', 'version', 'manifestHash', 'seed', 'recordedAt', 'source', 'engine', 'contracts', 'budgets', 'agents', 'evaluations', 'resultsHash'];
const AGENT_KEYS = ['brakeEnabled', 'generations', 'generation', 'index', 'selection', 'model', 'validation', 'brakeUsage'];

/** The record's raw block for one agent's results. */
function agentBlock(a: E4AgentResult): Json {
  return plain({
    brakeEnabled: a.brakeEnabled,
    generations: a.generations.map((gen, g) => gen.map((training, index) => ({ index, genomeId: a.genomeIds[g]![index], training }))),
    generation: a.generation,
    index: a.index,
    selection: a.selection,
    model: modelJson(a.model),
    validation: a.episodes.validation,
    brakeUsage: a.brakeUsage,
  });
}

function budgetsJson(manifest: E4Manifest, results: Readonly<Record<E4Agent, E4AgentResult>>, maxEpisodeTicks: number): Json {
  const P = manifest.configuration.training.populationSize;
  const G = manifest.configuration.generations;
  const each = (pick: (a: E4AgentResult) => unknown) => Object.fromEntries(E4_AGENTS.map((agent) => [agent, pick(results[agent])]));
  return plain({
    planned: { evolutionEvaluations: P * G, maxEpisodeTicks },
    actual: {
      evaluations: each((a) => a.evaluations),
      eliteReevaluations: manifest.configuration.training.eliteCount * (G - 1),
      // The frozen champion's extra training-track episode (not part of the equal P × G search budget).
      verificationEpisodes: each(() => 1),
    },
    diversity: each((a) => ({ evaluations: a.evaluations, maxDistinctGenomes: a.maxDistinctGenomes, actualDistinctGenomes: a.actualDistinctGenomes })),
    ticks: each((a) => a.ticks),
  });
}

function maxEpisodeTicksFor(manifest: E4Manifest, seed: number): number {
  return resolveBaselineConfig({ training: { ...manifest.configuration.training, brakeEnabled: true }, generations: manifest.configuration.generations, trackId: manifest.tracks.training.id }, seed).setup.rules.maxEpisodeTicks;
}

/**
 * Runs one training seed of a manifest, A4 then A5, and returns its complete record. Throws StudyManifestError for an
 * invalid manifest or a seed it does not list, and StudyRecordError for an invalid context.
 */
export function runE4Seed(manifestInput: unknown, seed: number, context: StudyContext): E4Record {
  const manifest = parseE4Manifest(manifestInput);
  if (!manifest.seeds.includes(seed)) throw new StudyManifestError(`E4 manifest: seed ${seed} is not one of the manifest's seeds.`);
  checkContext(context, (message) => {
    throw new StudyRecordError(`Study context: ${message}`);
  });
  const config = e4AgentConfigFor(manifest);
  const results = { A4: generateE4Agent(config, 'A4', seed), A5: generateE4Agent(config, 'A5', seed) };
  const agents = { A4: agentBlock(results.A4), A5: agentBlock(results.A5) };
  return {
    format: E4_RECORD_FORMAT,
    version: E4_VERSION,
    manifestHash: e4ManifestHash(manifest),
    seed,
    recordedAt: context.recordedAt,
    source: plain(context.source),
    engine: plain(context.engine),
    contracts: currentStudyContracts(),
    budgets: budgetsJson(manifest, results, maxEpisodeTicksFor(manifest, seed)),
    agents,
    evaluations: { validation: 'descriptive', heldOut: 'none' },
    resultsHash: hashOf(agents),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Parsing a record

/**
 * Checks a seed record against its manifest completely, before anything runs, and returns it. Throws StudyRecordError
 * for a malformed or incomplete record (missing or unknown fields, non-finite numbers, wrong counts, a selection, model,
 * budget, brake-usage count or tick total that does not follow from the episodes, an agent whose brake setting or
 * model identity is not its own, generation-0 populations that differ between A4 and A5, an A4 that ever braked, or a
 * stale resultsHash), and StudyCompatibilityError for another engine, other contracts, or another manifest.
 */
export function parseE4Record(input: unknown, manifestInput: unknown, engine: ExperimentEngine): E4Record {
  const manifest = parseE4Manifest(manifestInput);
  const fail: Fail = (message) => {
    throw new StudyRecordError(`E4 record: ${message}`);
  };
  const incompatible: Fail = (message) => {
    throw new StudyCompatibilityError(`E4 record is incompatible: ${message}`);
  };
  denseEverywhere(input, 'record', fail);
  const r = exact(input, 'record', RECORD_KEYS, fail);
  same(r.format, E4_RECORD_FORMAT, 'record.format', fail);
  same(r.version, E4_VERSION, 'record.version', fail);
  if (typeof r.manifestHash !== 'string' || !HASH.test(r.manifestHash)) fail('record.manifestHash must be a sha256: hash.');
  if (r.manifestHash !== e4ManifestHash(manifest)) incompatible('it was recorded for another manifest (manifestHash differs).');
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
  if (canonicalJson(r.contracts) !== canonicalJson(contracts)) incompatible('contracts differ from this code\'s contracts.');
  same(r.evaluations, { validation: 'descriptive', heldOut: 'none' }, 'record.evaluations', fail);

  const P = manifest.configuration.training.populationSize;
  const G = manifest.configuration.generations;
  const eliteCount = manifest.configuration.training.eliteCount;
  const { setup } = resolveBaselineConfig({ training: { ...manifest.configuration.training, brakeEnabled: true }, generations: G, trackId: manifest.tracks.training.id }, seed);
  const maxTicks = setup.rules.maxEpisodeTicks;
  const scoring = { maxTicks, fitness: setup.config.fitness, rules: setup.rules };
  const checks = {
    training: { ...scoring, gates: trainingTrack(manifest.tracks.training.id).gates.length },
    validation: { ...scoring, gates: validationTrack(manifest.tracks.validation.id).gates.length },
  } as const satisfies Record<string, EpisodeCheck>;
  const trackRef = manifest.tracks.training;
  const a = exact(r.agents, 'record.agents', [...E4_AGENTS], fail);

  const parsed = {} as Record<E4Agent, { gens: Json[][]; index: number; block: Json }>;
  for (const agent of E4_AGENTS) {
    const path = `agents.${agent}`;
    const block = exact(a[agent], path, AGENT_KEYS, fail);
    const brake = E4_BRAKE[agent];
    if (block.brakeEnabled !== brake) fail(`${path}.brakeEnabled must be ${String(brake)} (${agent} is always evolved ${brake ? 'with' : 'without'} the brake), got ${String(block.brakeEnabled)}.`);
    const gens = arr(block.generations, `${path}.generations`, G, fail).map((gen, g) =>
      arr(gen, `${path}.generations[${g}]`, P, fail).map((c, i) => checkCandidate(c, `${path}.generations[${g}][${i}]`, i, checks.training, fail)),
    );
    if (block.generation !== G - 1) fail(`${path}.generation must be ${G - 1}.`);
    same(block.selection, E4_SELECTION, `${path}.selection`, fail);
    if (block.index !== selectBest(totals(gens[G - 1]!))) fail(`${path}.index is not the final generation's best by training fitness (earliest on ties).`);
    const index = block.index as number;
    // The model identity carries this agent's own brake value; a model moved to the other agent, or carrying the
    // other value, differs in its provenance (agent or brakeEnabled) and is rejected here, naming the path.
    checkModel(block.model, `${path}.model`, gens[G - 1]![index]!.genomeId as string, {
      agent, seed, generation: G - 1, index, selection: E4_SELECTION, trackId: trackRef.id, trackContentHash: trackRef.contentHash, brakeEnabled: brake,
    }, fail);
    checkEpisode(block.validation, `${path}.validation`, checks.validation, fail);
    const usage = exact(block.brakeUsage, `${path}.brakeUsage`, ['training', 'validation'], fail);
    const episodes = { training: (gens[G - 1]![index]!.training as Json), validation: block.validation as Json };
    for (const track of ['training', 'validation'] as const) {
      const u = exact(usage[track], `${path}.brakeUsage.${track}`, ['ticks', 'brakeTicks'], fail);
      if (u.ticks !== episodes[track].ticks) fail(`${path}.brakeUsage.${track}.ticks must be the episode's ticks (${String(episodes[track].ticks)}), got ${String(u.ticks)}.`);
      int(u.brakeTicks, `${path}.brakeUsage.${track}.brakeTicks`, 0, u.ticks as number, fail);
      if (!brake && u.brakeTicks !== 0) fail(`${path}.brakeUsage.${track}.brakeTicks must be 0: ${agent} has the brake masked, so it can never brake (got ${String(u.brakeTicks)}).`);
    }
    parsed[agent] = { gens, index, block };
  }
  // The pairing: for one seed, A4 and A5 start from the identical generation-0 population.
  same(
    parsed.A4.gens[0]!.map((c) => c.genomeId),
    parsed.A5.gens[0]!.map((c) => c.genomeId),
    'agents.A4.generations[0] genome IDs (must equal A5\'s: the same seed gives the same generation-0 population)',
    fail,
  );

  const sumTrain = (gens: readonly (readonly Json[])[]) => gens.reduce((n, gen) => n + ticksOf(gen.map((c) => c.training as Json)), 0);
  const eachAgent = (pick: (agent: E4Agent) => unknown) => Object.fromEntries(E4_AGENTS.map((agent) => [agent, pick(agent)]));
  same(r.budgets, {
    planned: { evolutionEvaluations: P * G, maxEpisodeTicks: maxTicks },
    actual: { evaluations: eachAgent(() => P * G), eliteReevaluations: eliteCount * (G - 1), verificationEpisodes: eachAgent(() => 1) },
    diversity: eachAgent((agent) => ({
      evaluations: P * G,
      maxDistinctGenomes: P * G - eliteCount * (G - 1),
      actualDistinctGenomes: new Set(parsed[agent].gens.flat().map((c) => c.genomeId)).size,
    })),
    // training = the search; validation = the descriptive episode; verification = the frozen champion re-driven alone
    // on the training track, which reproduces its own training episode, so it is that episode's tick count.
    ticks: eachAgent((agent) => ({
      training: sumTrain(parsed[agent].gens),
      validation: (parsed[agent].block.validation as Json).ticks,
      verification: (parsed[agent].gens[G - 1]![parsed[agent].index]!.training as Json).ticks,
    })),
  }, 'record.budgets', fail);

  if (typeof r.resultsHash !== 'string' || !HASH.test(r.resultsHash)) fail('record.resultsHash must be a sha256: hash.');
  if (r.resultsHash !== hashOf(r.agents)) fail('resultsHash does not match the agents block; the results were edited.');
  return input as E4Record;
}

// ---------------------------------------------------------------------------------------------------------------
// Replay

/**
 * Checks a record (parseE4Record), re-runs its seed from the manifest in this engine and compares every raw result.
 * Also drives each frozen model alone, with its own brake value, against its recorded training and validation episodes
 * and brake-usage counts.
 */
export function replayE4Record(input: unknown, manifestInput: unknown, engine: ExperimentEngine, source?: ExperimentSource): E4Replay {
  const record = parseE4Record(input, manifestInput, engine);
  const manifest = manifestInput as E4Manifest;
  const config = e4AgentConfigFor(manifest);
  const fresh = { A4: agentBlock(generateE4Agent(config, 'A4', record.seed)), A5: agentBlock(generateE4Agent(config, 'A5', record.seed)) };
  const differences = jsonDifferences(record.agents, fresh, 'agents', 20);
  const a = record.agents as Record<E4Agent, Json>;
  const replayModel = (agent: E4Agent): boolean => {
    const { evaluation } = e4Evaluation(config, record.seed, E4_BRAKE[agent]);
    const block = a[agent];
    const gens = block.generations as Json[][];
    const training = gens[gens.length - 1]![block.index as number]!.training;
    const usage = block.brakeUsage as Record<'training' | 'validation', unknown>;
    const recorded = block.model as { id: string; parameters: number[]; provenance: Record<string, string | number | boolean> };
    // A model read from a record is plain JSON; rebuild the frozen model from it (its id was checked by parseE4Record).
    const model = freezeModel(recorded.parameters, recorded.provenance);
    const onTraining = evaluateE4Model(model, evaluation.training);
    const onValidation = evaluateE4Model(model, evaluation.validation);
    return (
      model.id === recorded.id &&
      canonicalJson(onTraining.episode) === canonicalJson(training) &&
      canonicalJson(onValidation.episode) === canonicalJson(block.validation) &&
      canonicalJson(onTraining.brakeUsage) === canonicalJson(usage.training) &&
      canonicalJson(onValidation.brakeUsage) === canonicalJson(usage.validation)
    );
  };
  const modelsReplayed = { A4: replayModel('A4'), A5: replayModel('A5') };
  const identical = differences.length === 0 && Object.values(modelsReplayed).every(Boolean);
  const sameSourceRevision = source?.revision && record.source.revision ? source.revision === record.source.revision : null;
  return { identical, differences, modelsReplayed, sameSourceRevision };
}
