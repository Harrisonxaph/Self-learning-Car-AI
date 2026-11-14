// P5-02 step 3: the E5 study kind (docs/plans/p5-02-plan.md §3 and §4): does the brake output make a measurable difference
// on circuits the agents did not train on? Design A: E4's ten frozen champion PAIRS (A4, brake masked; A5, brake enabled)
// are read unchanged from the committed E4 records and each is evaluated, once, on each listed held-out circuit through
// the once-only gate of heldOutAccess.ts. No new training. Headless and deterministic.
// THIS MODULE RUNS NO STUDY. It defines the manifest, the held-out record, strict parsers, replay and the paired analysis;
// the tests use E4 *mechanics* records (tiny, non-reserved seeds) and a SYNTHETIC held-out registry. No real held-out
// circuit is evaluated here, and no E5 result exists.
//
// The sequence the formats enforce:
//  1. the E5 manifest pins the E4 manifest hash and, for every seed, the A4 and A5 frozen model ids and the E4 record's
//     resultsHash, so a result names exactly the champions that were evaluated;
//  2. the pairs are read from the E4 records through the strict E4 parser (never re-trained, never re-selected);
//  3. ONE HELD-OUT RECORD: each frozen agent evaluated once on each listed held-out circuit, with its brake usage.
// The analysis is a pure function of the manifest, the E4 records and the held-out record.
import { BRAKE_USAGE_THRESHOLD, withBrakeCount, type BrakeUsage } from './e4Agents';
import { c1Training, E4_CONFIRMATORY_GENERATIONS, E4_DELTA, E4_TRAINING_TRACK, e4ManifestHash, parseE4Manifest, parseE4Record, type E4Manifest } from './e4Study';
import { bootstrapMeanInterval, iqr, median } from './analysis';
import { episodeResult, resolveBaselineConfig, type EpisodeResult } from './baselines';
import { canonicalJson, jsonDifferences, manifestEpochOf, manifestRecord, type ExperimentEngine, type ExperimentSource } from './experiment';
import {
  createHeldOutGate,
  createMemoryLedger,
  driverForFrozenAgent,
  HeldOutAccessError,
  type HeldOutGate,
  type HeldOutOpening,
  type HeldOutProtocol,
  type OpeningLedger,
} from './heldOutAccess';
import {
  checkContext,
  checkEpisode,
  currentStudyContracts,
  dense,
  denseEverywhere,
  E4_SEEDS,
  exact,
  hashOf,
  HASH,
  ID_PATTERN,
  int,
  ISO_TIME,
  MAX_MECHANICS_SEEDS,
  METRIC,
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
import { BUILT_IN_TRACK_SPLITS, epochIds, freezeModel, LATEST_SPLIT_EPOCH, type FrozenModel, type TrackSplits } from './trackSplits';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../sim/config';
import { createEvaluationSetup, type EvaluationSetup } from './evaluation';

export const E5_MANIFEST_FORMAT = 'self-driving-ai-evolution/p5-02-e5-manifest';
export const E5_HELDOUT_FORMAT = 'self-driving-ai-evolution/p5-02-e5-heldout-record';
export const E5_ANALYSIS_FORMAT = 'self-driving-ai-evolution/p5-02-e5-analysis';
export const E5_VERSION = 1;
export const E5_LABELS = Object.freeze(['mechanics', 'confirmatory'] as const);
export type E5Label = (typeof E5_LABELS)[number];
export const E5_BOOTSTRAP = Object.freeze({ resamples: 10_000, seed: 20261114, level: 0.95, method: 'percentile-nearest-rank-v1' });
export const E5_DECISION_RULE = 'p5-02-e5-decision-v1';
export const E5_AGENTS = Object.freeze(['A4', 'A5'] as const);
export type E5Agent = (typeof E5_AGENTS)[number];

export interface E5PairPin {
  readonly seed: number;
  /** The frozen A4 champion's model id. */
  readonly a4: string;
  /** The frozen A5 champion's model id. */
  readonly a5: string;
  /** The `resultsHash` of the E4 record this pair was read from. */
  readonly e4ResultsHash: string;
}

export interface E5Manifest {
  readonly format: typeof E5_MANIFEST_FORMAT;
  readonly version: typeof E5_VERSION;
  readonly id: string;
  readonly label: E5Label;
  readonly description: string;
  /** The E4 manifest the champions were evolved under (its hash), and each pair's pinned identity. */
  readonly e4: { readonly manifestHash: string };
  readonly pairs: readonly E5PairPin[];
  /** The training configuration the champions were evolved under; its episode limits and scoring are used for every evaluation. */
  readonly configuration: { readonly generations: number; readonly training: Json };
  readonly tracks: {
    readonly heldOut: readonly { readonly id: string; readonly contentHash: string }[];
    readonly splitManifestHash: string;
  };
  readonly analysis: {
    readonly metric: typeof METRIC;
    readonly delta: number;
    readonly bootstrap: typeof E5_BOOTSTRAP;
    readonly decisionRule: typeof E5_DECISION_RULE;
    readonly brakeUsageThreshold: number;
  };
  /** The owner's authorisation for the one held-out opening. */
  readonly authorisation: string;
  readonly code: { readonly revision: string | null };
}

const MANIFEST_KEYS = ['format', 'version', 'id', 'label', 'description', 'e4', 'pairs', 'configuration', 'tracks', 'analysis', 'authorisation', 'code'];

/** `sha256:` + SHA-256 of the manifest's canonical JSON; every record carries it, and it is the held-out protocol hash. */
export function e5ManifestHash(manifest: E5Manifest): string {
  return hashOf(manifest);
}

/**
 * Checks an E5 manifest completely and returns it. Throws StudyManifestError for any missing or unknown field, a wrong
 * constant, a training block that is not a complete resolved configuration, pairs that are malformed, duplicated or (when
 * confirmatory) not exactly E4's seeds 2001–2010 in order, a training configuration other than C1 (confirmatory), a listed
 * held-out circuit that is not registered as held-out or whose hash differs, none listed, held-out circuits in a mechanics
 * manifest on the **built-in** registry, or a missing revision outside mechanics. `splits` is for tests (a synthetic registry).
 * Whether the pins match the E4 records is checked by `loadE5Pairs`, which has the records.
 */
export function parseE5Manifest(input: unknown, splits: TrackSplits = BUILT_IN_TRACK_SPLITS): E5Manifest {
  const fail: Fail = (message) => {
    throw new StudyManifestError(`E5 manifest: ${message}`);
  };
  denseEverywhere(input, 'manifest', fail);
  const m = exact(input, 'manifest', MANIFEST_KEYS, fail);
  same(m.format, E5_MANIFEST_FORMAT, 'manifest.format', fail);
  same(m.version, E5_VERSION, 'manifest.version', fail);
  if (typeof m.id !== 'string' || !ID_PATTERN.test(m.id)) fail('manifest.id must be 1 to 64 lowercase letters, digits or hyphens.');
  if (!E5_LABELS.includes(m.label as E5Label)) fail(`manifest.label must be one of ${E5_LABELS.join(', ')}.`);
  const label = m.label as E5Label;
  if (str(m.description, 'manifest.description', fail).length > 1000) fail('manifest.description must be at most 1000 characters.');
  const builtIn = splits === BUILT_IN_TRACK_SPLITS;

  const e4 = exact(m.e4, 'manifest.e4', ['manifestHash'], fail);
  if (typeof e4.manifestHash !== 'string' || !HASH.test(e4.manifestHash)) fail('manifest.e4.manifestHash must be a sha256: hash.');

  const pairList = dense(m.pairs, 'manifest.pairs', fail);
  if (pairList.length === 0) fail('manifest.pairs must be a non-empty array.');
  const pairs = pairList.map((p, i) => {
    const pin = exact(p, `manifest.pairs[${i}]`, ['seed', 'a4', 'a5', 'e4ResultsHash'], fail);
    const seed = int(pin.seed, `manifest.pairs[${i}].seed`, 0, 0xffffffff, fail);
    for (const key of ['a4', 'a5', 'e4ResultsHash'] as const) {
      if (typeof pin[key] !== 'string' || !HASH.test(pin[key] as string)) fail(`manifest.pairs[${i}].${key} must be a sha256: hash.`);
    }
    return { seed, a4: pin.a4 as string, a5: pin.a5 as string, e4ResultsHash: pin.e4ResultsHash as string };
  });
  const seeds = pairs.map((p) => p.seed);
  if (new Set(seeds).size !== seeds.length) fail('manifest.pairs must have distinct seeds.');
  const ids = pairs.flatMap((p) => [p.a4, p.a5]);
  if (new Set(ids).size !== ids.length) fail('manifest.pairs must name distinct frozen models (an A4 and an A5 never share an id).');
  if (label === 'confirmatory') same(seeds, E4_SEEDS, "manifest.pairs (a confirmatory manifest's pairs are exactly E4's seeds 2001–2010, in order)", fail);
  if (label === 'mechanics') {
    if (seeds.some(reserved)) fail('a mechanics manifest may not use a reserved seed (pilot 9001–9003, P2-08 1001–1020, E4 2001–2010 or E3 3001–3010).');
    if (seeds.length > MAX_MECHANICS_SEEDS) fail(`a mechanics manifest has at most ${MAX_MECHANICS_SEEDS} pairs.`);
  }

  const c = exact(m.configuration, 'manifest.configuration', ['generations', 'training'], fail);
  const G = int(c.generations, 'manifest.configuration.generations', 1, 10_000, fail);
  if (c.training === null || typeof c.training !== 'object' || Array.isArray(c.training)) fail('manifest.configuration.training must be an object.');
  const training = c.training as Json;
  if (Object.prototype.hasOwnProperty.call(training, 'brakeEnabled')) fail('manifest.configuration.training.brakeEnabled must not be set: the brake binding is part of each frozen agent.');
  try {
    const { setup } = resolveBaselineConfig({ training: { ...training, brakeEnabled: true }, generations: G, trackId: E4_TRAINING_TRACK }, seeds[0]!);
    const resolved = Object.fromEntries(Object.entries(setup.config).filter(([key]) => key !== 'seed' && key !== 'brakeEnabled'));
    if (canonicalJson(resolved) !== canonicalJson(training)) fail('manifest.configuration.training must be a complete resolved training configuration.');
  } catch (error) {
    if (error instanceof StudyManifestError) throw error;
    return fail(`manifest.configuration.training is invalid: ${(error as Error).message}`);
  }

  const t = exact(m.tracks, 'manifest.tracks', ['heldOut', 'splitManifestHash'], fail);
  const epoch = builtIn ? manifestEpochOf(t.splitManifestHash) ?? LATEST_SPLIT_EPOCH : undefined;
  same(t.splitManifestHash, manifestRecord(splits, epoch).hash, 'manifest.tracks.splitManifestHash', fail);
  const heldList = dense(t.heldOut, 'manifest.tracks.heldOut', fail).map((h, i) => {
    const ref = exact(h, `manifest.tracks.heldOut[${i}]`, ['id', 'contentHash'], fail);
    const entry = splits.tracks.find((x) => x.id === ref.id);
    if (entry === undefined || entry.split !== 'held-out') fail(`manifest.tracks.heldOut[${i}] ("${String(ref.id)}") is not a registered held-out circuit.`);
    if (ref.contentHash !== entry!.contentHash) fail(`manifest.tracks.heldOut[${i}].contentHash does not match the registered circuit.`);
    return { id: ref.id as string, contentHash: ref.contentHash as string };
  });
  if (heldList.length === 0) fail('manifest.tracks.heldOut must list at least one held-out circuit: E5 is a held-out evaluation.');
  if (new Set(heldList.map((h) => h.id)).size !== heldList.length) fail('manifest.tracks.heldOut must be distinct.');
  if (epoch !== undefined) {
    for (const h of heldList) {
      if (!epochIds(epoch).includes(h.id)) fail(`manifest.tracks lists "${h.id}", which is not part of the track set (split epoch ${epoch}) the manifest names.`);
    }
  }

  if (label === 'confirmatory') {
    if (!builtIn) fail('a confirmatory manifest uses the built-in track registry.');
    if (G !== E4_CONFIRMATORY_GENERATIONS) fail(`a confirmatory manifest needs generations ${E4_CONFIRMATORY_GENERATIONS} (C1, as E4).`);
    same(training, c1Training(), 'manifest.configuration.training (a confirmatory manifest uses C1, the configuration E4 evolved its champions under)', fail);
  }
  if (label === 'mechanics' && builtIn) fail('a mechanics manifest uses a synthetic registry: mechanics never touches real held-out data.');

  const a = exact(m.analysis, 'manifest.analysis', ['metric', 'delta', 'bootstrap', 'decisionRule', 'brakeUsageThreshold'], fail);
  same(a.metric, METRIC, 'manifest.analysis.metric', fail);
  same(a.delta, E4_DELTA, 'manifest.analysis.delta', fail);
  same(a.bootstrap, E5_BOOTSTRAP, 'manifest.analysis.bootstrap', fail);
  same(a.decisionRule, E5_DECISION_RULE, 'manifest.analysis.decisionRule', fail);
  same(a.brakeUsageThreshold, BRAKE_USAGE_THRESHOLD, 'manifest.analysis.brakeUsageThreshold', fail);
  if (typeof m.authorisation !== 'string' || !/^[A-Za-z0-9._:/#-]{1,200}$/.test(m.authorisation)) fail('manifest.authorisation must name the owner\'s authorisation (1 to 200 letters, digits or . _ : / # -).');
  const code = exact(m.code, 'manifest.code', ['revision'], fail);
  if (code.revision === null) {
    if (label !== 'mechanics') fail(`a ${label} manifest needs manifest.code.revision, the commit it was frozen at.`);
  } else if (typeof code.revision !== 'string' || !REVISION.test(code.revision)) fail('manifest.code.revision must be a 40-character git commit or null.');
  return input as E5Manifest;
}

/** The episode limits and scoring the champions were trained under; every E5 evaluation uses exactly these. */
function limitsOf(manifest: E5Manifest) {
  const { setup } = resolveBaselineConfig(
    { training: { ...manifest.configuration.training, brakeEnabled: true }, generations: manifest.configuration.generations, trackId: E4_TRAINING_TRACK },
    manifest.pairs[0]!.seed,
  );
  const { maxEpisodeSeconds, stallSeconds, maxLaps, fitness } = setup.config;
  return { maxEpisodeSeconds, stallSeconds, maxLaps, fitness };
}

/** The limits and scoring (no track is read). Held-out evaluations are scored with these. */
function scoringSetup(manifest: E5Manifest, splits: TrackSplits): EvaluationSetup {
  const anyTrack = splits.tracks.find((t) => t.split === 'training')!.track;
  return createEvaluationSetup(limitsOf(manifest), { track: anyTrack, physics: DEFAULT_VEHICLE_PHYSICS, timestepSeconds: DEFAULT_SIM_CONFIG.timestepSeconds });
}

function episodeCheck(manifest: E5Manifest, trackId: string, splits: TrackSplits): EpisodeCheck {
  const setup = scoringSetup(manifest, splits);
  const entry = splits.tracks.find((t) => t.id === trackId)!;
  return { maxTicks: setup.rules.maxEpisodeTicks, gates: entry.track.gates.length, fitness: setup.config.fitness, rules: setup.rules };
}

const gatesOf = (trackId: string, splits: TrackSplits): number => splits.tracks.find((t) => t.id === trackId)!.track.gates.length;

function checkSourcePin(manifest: E5Manifest, source: ExperimentSource, fail: Fail): void {
  const pinned = manifest.code.revision;
  if (pinned === null) return;
  if (source.revision === null) fail(`the source revision is unknown, but the manifest is frozen at ${pinned}; run it from a clean checkout of that commit.`);
  else if (source.dirty !== false) fail(`the working tree was modified, but the manifest is frozen at ${pinned}; run it from a clean checkout of that commit.`);
  else if (source.revision !== pinned) fail(`the source revision ${source.revision} differs from the manifest's frozen commit ${pinned}.`);
}

function checkManifestAndContext(manifestInput: unknown, context: StudyContext, splits: TrackSplits): E5Manifest {
  const manifest = parseE5Manifest(manifestInput, splits);
  const fail: Fail = (message) => {
    throw new StudyRecordError(`Study context: ${message}`);
  };
  checkContext(context, fail);
  checkSourcePin(manifest, context.source, fail);
  return manifest;
}

// ---------------------------------------------------------------------------------------------------------------
// The frozen pairs, read from E4's records

export interface E5Pair {
  readonly seed: number;
  readonly a4: FrozenModel;
  readonly a5: FrozenModel;
  readonly e4ResultsHash: string;
}

/** The pins an E5 manifest needs, built from E4's manifest and records (for the author of a manifest; `loadE5Pairs` re-checks them). */
export function e5PairPins(e4ManifestInput: unknown, e4Records: readonly unknown[], engine: ExperimentEngine): { e4ManifestHash: string; pairs: E5PairPin[] } {
  const e4Manifest = parseE4Manifest(e4ManifestInput);
  const pairs = readPairs(e4Manifest, e4Records, engine);
  return { e4ManifestHash: e4ManifestHash(e4Manifest), pairs: pairs.map((p) => ({ seed: p.seed, a4: p.a4.id, a5: p.a5.id, e4ResultsHash: p.e4ResultsHash })) };
}

function readPairs(e4Manifest: E4Manifest, e4Records: readonly unknown[], engine: ExperimentEngine): E5Pair[] {
  return e4Records.map((input) => {
    const record = parseE4Record(input, e4Manifest, engine);
    const agents = record.agents as Record<string, { model: { parameters: number[]; provenance: Record<string, string | number | boolean> } }>;
    const rebuild = (agent: E5Agent): FrozenModel => {
      const m = agents[agent]!.model;
      const model = freezeModel(m.parameters, m.provenance);
      driverForFrozenAgent(model); // the agent name, brake binding and network size are checked before any held-out use
      return model;
    };
    return { seed: record.seed, a4: rebuild('A4'), a5: rebuild('A5'), e4ResultsHash: record.resultsHash };
  });
}

/**
 * The frozen pairs an E5 manifest names, read from E4's manifest and records through the strict E4 parser and checked
 * against the manifest's pins: the E4 manifest hash, the seeds in order, every model id and every record's resultsHash.
 * Nothing is trained or selected here. Throws StudyRecordError or StudyCompatibilityError.
 */
export function loadE5Pairs(manifestInput: unknown, e4ManifestInput: unknown, e4Records: readonly unknown[], engine: ExperimentEngine, splits: TrackSplits = BUILT_IN_TRACK_SPLITS): E5Pair[] {
  const manifest = parseE5Manifest(manifestInput, splits);
  const fail: Fail = (message) => {
    throw new StudyRecordError(`E5 pairs: ${message}`);
  };
  const e4Manifest = parseE4Manifest(e4ManifestInput);
  if (e4ManifestHash(e4Manifest) !== manifest.e4.manifestHash) {
    throw new StudyCompatibilityError('E5 pairs are incompatible: the E4 manifest is not the one this E5 manifest pins (manifest.e4.manifestHash differs).');
  }
  if (canonicalJson(manifest.configuration) !== canonicalJson(e4Manifest.configuration)) {
    throw new StudyCompatibilityError('E5 pairs are incompatible: manifest.configuration differs from the E4 manifest\'s (the champions were evolved under another configuration).');
  }
  if (manifest.label === 'confirmatory' && e4Manifest.label !== 'confirmatory') fail('a confirmatory E5 manifest reads confirmatory E4 records only.');
  const pairs = readPairs(e4Manifest, e4Records, engine);
  const seeds = pairs.map((p) => p.seed);
  if (canonicalJson(seeds) !== canonicalJson(manifest.pairs.map((p) => p.seed))) {
    fail(`the E4 records must be exactly the manifest's pair seeds in order (${manifest.pairs.map((p) => p.seed).join(', ')}), got ${seeds.join(', ')}.`);
  }
  pairs.forEach((p, i) => {
    const pin = manifest.pairs[i]!;
    same([p.a4.id, p.a5.id, p.e4ResultsHash], [pin.a4, pin.a5, pin.e4ResultsHash], `the E4 record for seed ${p.seed} (A4 id, A5 id, resultsHash)`, fail);
  });
  return pairs;
}

/** The agents of a study in a fixed order: for each seed, the A4 champion then the A5 champion. */
function orderedAgents(pairs: readonly E5Pair[]): { agent: E5Agent; seed: number; model: FrozenModel }[] {
  return pairs.flatMap((p) => [
    { agent: 'A4' as const, seed: p.seed, model: p.a4 },
    { agent: 'A5' as const, seed: p.seed, model: p.a5 },
  ]);
}

/** The held-out protocol a manifest and its frozen pairs define. */
export function e5HeldOutProtocol(manifestInput: unknown, pairs: readonly E5Pair[], splits: TrackSplits = BUILT_IN_TRACK_SPLITS): HeldOutProtocol {
  const manifest = parseE5Manifest(manifestInput, splits);
  return {
    protocolHash: e5ManifestHash(manifest),
    authorisationId: manifest.authorisation,
    trackIds: manifest.tracks.heldOut.map((t) => t.id),
    agentIds: orderedAgents(pairs).map((a) => a.model.id),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The held-out record: the one opening

export interface E5HeldOutEvaluation {
  readonly agent: E5Agent;
  readonly seed: number;
  readonly modelId: string;
  readonly trackId: string;
  readonly episode: EpisodeResult;
  /** Ticks driven and ticks with a brake command above the threshold. */
  readonly brakeUsage: BrakeUsage;
}

export interface E5HeldOutRecord {
  readonly format: typeof E5_HELDOUT_FORMAT;
  readonly version: typeof E5_VERSION;
  readonly manifestHash: string;
  readonly recordedAt: string;
  readonly source: ExperimentSource;
  readonly engine: ExperimentEngine;
  readonly contracts: ReturnType<typeof currentStudyContracts>;
  /** The opening the gate recorded: the protocol hash (the manifest's hash), the authorisation, the circuits and the agents. */
  readonly opening: HeldOutOpening;
  readonly evaluations: readonly E5HeldOutEvaluation[];
  readonly resultsHash: string;
}

const HELDOUT_KEYS = ['format', 'version', 'manifestHash', 'recordedAt', 'source', 'engine', 'contracts', 'opening', 'evaluations', 'resultsHash'];

/**
 * The ONE held-out look: every frozen champion (for each seed, its A4 then its A5) is evaluated once on each listed held-out
 * circuit through the gate, with its brake usage counted by a wrapper that changes no control. The gate must be made for
 * exactly this study's protocol (`e5HeldOutProtocol`) with a ledger restored from earlier openings; opening it claims the
 * protocol in that ledger. The pairs are read and checked (`loadE5Pairs`) before the gate opens, so a bad record can never
 * use up the look.
 */
export function runE5HeldOut(
  manifestInput: unknown,
  e4ManifestInput: unknown,
  e4Records: readonly unknown[],
  gate: HeldOutGate,
  context: StudyContext,
  splits: TrackSplits = BUILT_IN_TRACK_SPLITS,
): E5HeldOutRecord {
  const manifest = checkManifestAndContext(manifestInput, context, splits);
  const pairs = loadE5Pairs(manifest, e4ManifestInput, e4Records, context.engine, splits);
  const agents = orderedAgents(pairs);
  for (const { model } of agents) driverForFrozenAgent(model);
  const protocol = e5HeldOutProtocol(manifest, pairs, splits);
  if (canonicalJson(gate.protocol) !== canonicalJson(protocol)) {
    throw new HeldOutAccessError('The gate was not made for this study\'s protocol (manifest hash, authorisation, held-out circuits and frozen agents must match exactly).');
  }
  const session = gate.open(manifest.authorisation);
  const config = limitsOf(manifest);
  const scoring = scoringSetup(manifest, splits);
  const evaluations: E5HeldOutEvaluation[] = [];
  for (const track of manifest.tracks.heldOut) {
    const gates = gatesOf(track.id, splits);
    for (const { agent, seed, model } of agents) {
      let counts: () => BrakeUsage = () => ({ ticks: 0, brakeTicks: 0 });
      const result = session.evaluate(model, track.id, config, (driver) => {
        const counted = withBrakeCount(driver);
        counts = counted.counts;
        return counted.driver;
      });
      evaluations.push({
        agent,
        seed,
        modelId: model.id,
        trackId: track.id,
        episode: episodeResult(result.episode, scoring.config.fitness, scoring.rules, gates),
        brakeUsage: counts(),
      });
    }
  }
  const plainEvaluations = plain(evaluations);
  return {
    format: E5_HELDOUT_FORMAT,
    version: E5_VERSION,
    manifestHash: e5ManifestHash(manifest),
    recordedAt: context.recordedAt,
    source: plain(context.source),
    engine: plain(context.engine),
    contracts: currentStudyContracts(),
    opening: plain(session.opening),
    evaluations: plainEvaluations,
    resultsHash: hashOf({ opening: session.opening, evaluations: plainEvaluations }),
  };
}

/** Checks a held-out record against its manifest and the E4 records completely and returns it. */
export function parseE5HeldOutRecord(
  input: unknown,
  manifestInput: unknown,
  e4ManifestInput: unknown,
  e4Records: readonly unknown[],
  engine: ExperimentEngine,
  splits: TrackSplits = BUILT_IN_TRACK_SPLITS,
): E5HeldOutRecord {
  const manifest = parseE5Manifest(manifestInput, splits);
  const fail: Fail = (message) => {
    throw new StudyRecordError(`E5 held-out record: ${message}`);
  };
  const pairs = loadE5Pairs(manifest, e4ManifestInput, e4Records, engine, splits);
  denseEverywhere(input, 'record', fail);
  const r = exact(input, 'record', HELDOUT_KEYS, fail);
  same(r.format, E5_HELDOUT_FORMAT, 'record.format', fail);
  same(r.version, E5_VERSION, 'record.version', fail);
  if (typeof r.manifestHash !== 'string' || !HASH.test(r.manifestHash)) fail('record.manifestHash must be a sha256: hash.');
  if (typeof r.recordedAt !== 'string' || !ISO_TIME.test(r.recordedAt)) fail('record.recordedAt must be an ISO 8601 UTC time.');
  const incompatible: Fail = (message) => {
    throw new StudyCompatibilityError(`E5 held-out record is incompatible: ${message}`);
  };
  if (r.manifestHash !== e5ManifestHash(manifest)) incompatible('it was recorded for another manifest (manifestHash differs).');
  const recorded = r.engine as Json;
  for (const key of ['name', 'version', 'v8'] as const) {
    if (recorded?.[key] !== engine[key]) incompatible(`engine ${key} ${String(recorded?.[key])} differs from this engine's ${engine[key]}; results are only reproducible within one engine.`);
  }
  if (canonicalJson(r.contracts) !== canonicalJson(currentStudyContracts())) incompatible('its contracts differ from this code\'s.');
  checkContext({ engine: r.engine as ExperimentEngine, source: r.source as ExperimentSource, recordedAt: r.recordedAt as string }, fail);
  checkSourcePin(manifest, r.source as ExperimentSource, fail);
  const protocol = e5HeldOutProtocol(manifest, pairs, splits);
  const opening = exact(r.opening, 'record.opening', ['protocolHash', 'authorisationId', 'trackIds', 'agentIds'], fail);
  same(opening, protocol, 'record.opening (the protocol this manifest and its frozen pairs define)', fail);
  const evals = dense(r.evaluations, 'record.evaluations', fail);
  const agents = orderedAgents(pairs);
  const expected = manifest.tracks.heldOut.flatMap((t) => agents.map((a) => ({ track: t.id, ...a })));
  if (evals.length !== expected.length) fail(`record.evaluations must hold ${expected.length} evaluations (each frozen champion once on each held-out circuit), got ${evals.length}.`);
  evals.forEach((value, i) => {
    const e = exact(value, `record.evaluations[${i}]`, ['agent', 'seed', 'modelId', 'trackId', 'episode', 'brakeUsage'], fail);
    const want = expected[i]!;
    same([e.agent, e.seed, e.modelId, e.trackId], [want.agent, want.seed, want.model.id, want.track], `record.evaluations[${i}] (agent, seed, model, circuit)`, fail);
    const episode = checkEpisode(e.episode, `record.evaluations[${i}].episode`, episodeCheck(manifest, want.track, splits), fail);
    const usage = exact(e.brakeUsage, `record.evaluations[${i}].brakeUsage`, ['ticks', 'brakeTicks'], fail);
    same(usage.ticks, episode.ticks, `record.evaluations[${i}].brakeUsage.ticks (the episode's ticks)`, fail);
    int(usage.brakeTicks, `record.evaluations[${i}].brakeUsage.brakeTicks`, 0, episode.ticks as number, fail);
    if (want.agent === 'A4' && usage.brakeTicks !== 0) fail(`record.evaluations[${i}]: an A4 champion cannot brake, but its brakeTicks is ${String(usage.brakeTicks)}.`);
  });
  if (r.resultsHash !== hashOf({ opening: r.opening, evaluations: r.evaluations })) fail('record.resultsHash does not match the opening and evaluations.');
  return input as E5HeldOutRecord;
}

/** The ledger a restart must use: restored from the openings of the held-out records already written. */
export function e5LedgerFromRecords(records: readonly { readonly opening: HeldOutOpening }[]): OpeningLedger {
  return createMemoryLedger(records.map((r) => r.opening));
}

export interface E5Replay {
  readonly identical: boolean;
  /** Up to 20 differing paths. */
  readonly differences: readonly string[];
  readonly sameSourceRevision: boolean | null;
}

/**
 * Verifies a held-out record by re-evaluating its frozen champions through a REPLAY gate (a fresh ledger, the protocol's own
 * authorisation). It reveals nothing the record does not already hold; it is a check, not a new look, and it never touches
 * the study's real ledger.
 */
export function replayE5HeldOutRecord(
  input: unknown,
  manifestInput: unknown,
  e4ManifestInput: unknown,
  e4Records: readonly unknown[],
  engine: ExperimentEngine,
  source?: ExperimentSource,
  splits: TrackSplits = BUILT_IN_TRACK_SPLITS,
): E5Replay {
  const record = parseE5HeldOutRecord(input, manifestInput, e4ManifestInput, e4Records, engine, splits);
  const pairs = loadE5Pairs(manifestInput, e4ManifestInput, e4Records, engine, splits);
  const gate = createHeldOutGate(e5HeldOutProtocol(manifestInput, pairs, splits), createMemoryLedger(), splits);
  const fresh = runE5HeldOut(manifestInput, e4ManifestInput, e4Records, gate, { engine, source: record.source, recordedAt: record.recordedAt }, splits);
  const differences = jsonDifferences({ evaluations: record.evaluations }, { evaluations: fresh.evaluations }, 'record', 20);
  const sameSourceRevision = source?.revision && record.source.revision ? source.revision === record.source.revision : null;
  return { identical: differences.length === 0, differences, sameSourceRevision };
}

// ---------------------------------------------------------------------------------------------------------------
// The analysis

export type E5Outcome = 'a5-higher' | 'a4-higher' | 'no-clear-difference';

/** The decision wording for one circuit, from the predeclared delta and the bootstrap interval (never from a p-value). */
export function classifyE5(mean: number, lower: number, upper: number, delta: number): E5Outcome {
  if (lower > 0 && mean >= delta) return 'a5-higher';
  if (upper < 0 && mean <= -delta) return 'a4-higher';
  return 'no-clear-difference';
}

const progressOf = (episode: EpisodeResult, gates: number): number => episode.gatesPassed / gates;
const sumOf = (values: readonly number[]): number => values.reduce((total, v) => total + v, 0);

export function e5AgentBlock(rows: readonly E5HeldOutEvaluation[], gates: number): Json {
  const progress = rows.map((r) => progressOf(r.episode, gates));
  const ticks = sumOf(rows.map((r) => r.brakeUsage.ticks));
  const brakeTicks = sumOf(rows.map((r) => r.brakeUsage.brakeTicks));
  return {
    n: rows.length,
    progress,
    medianProgress: median(progress),
    iqrProgress: iqr(progress),
    crashes: rows.filter((r) => r.episode.crashed).length,
    lapCompletions: rows.filter((r) => r.episode.lapTicks.length >= 1).length,
    brakeUsage: { ticks, brakeTicks, fraction: ticks === 0 ? null : brakeTicks / ticks, championsThatBraked: rows.filter((r) => r.brakeUsage.brakeTicks > 0).length },
  };
}

/**
 * The paired first-lap time, descriptive only (the rule P5-05 settled): over the pairs where BOTH champions completed a lap,
 * in simulated seconds; each agent's own number of completed laps is shown, and the pairs left out are named. A missing time
 * is never zero and never dropped from one side only.
 */
export function e5PairedFirstLap(a4: readonly E5HeldOutEvaluation[], a5: readonly E5HeldOutEvaluation[]): Json {
  const dt = DEFAULT_SIM_CONFIG.timestepSeconds;
  const first = (r: E5HeldOutEvaluation): number | null => (r.episode.lapTicks.length >= 1 ? r.episode.lapTicks[0]! * dt : null);
  const both: { seed: number; a4: number; a5: number }[] = [];
  const excluded: { seed: number; completed: string }[] = [];
  a4.forEach((r4, i) => {
    const r5 = a5[i]!;
    const t4 = first(r4);
    const t5 = first(r5);
    if (t4 !== null && t5 !== null) both.push({ seed: r4.seed, a4: t4, a5: t5 });
    else if (t4 !== null || t5 !== null) excluded.push({ seed: r4.seed, completed: t4 !== null ? 'A4 only' : 'A5 only' });
  });
  const mean = (values: readonly number[]): number | null => (values.length === 0 ? null : sumOf(values) / values.length);
  return {
    pairsWithBoth: both.length,
    a4Completed: a4.filter((r) => first(r) !== null).length,
    a5Completed: a5.filter((r) => first(r) !== null).length,
    excludedPairs: excluded,
    meanSecondsA4: mean(both.map((p) => p.a4)),
    meanSecondsA5: mean(both.map((p) => p.a5)),
    meanDifferenceA5MinusA4: mean(both.map((p) => p.a5 - p.a4)),
  };
}

/**
 * The E5 analysis, a pure function of the manifest, the E4 records and the held-out record. Per held-out circuit: the paired
 * differences d = progress(A5) − progress(A4) by seed, their mean, the seed-cluster bootstrap interval and one of three
 * labels; and the descriptive secondary measures. There is **no pooled headline** across circuits: if the labels differ the
 * analysis says so. "No clear difference" is a valid, reported outcome and is not a claim of no effect.
 */
export function analyseE5(
  manifestInput: unknown,
  e4ManifestInput: unknown,
  e4Records: readonly unknown[],
  heldOutRecord: unknown,
  engine: ExperimentEngine,
  splits: TrackSplits = BUILT_IN_TRACK_SPLITS,
): Json {
  const manifest = parseE5Manifest(manifestInput, splits);
  const pairs = loadE5Pairs(manifest, e4ManifestInput, e4Records, engine, splits);
  const held = parseE5HeldOutRecord(heldOutRecord, manifest, e4ManifestInput, e4Records, engine, splits);
  const tracks: Json[] = manifest.tracks.heldOut.map((track) => {
    const gates = gatesOf(track.id, splits);
    const rows = held.evaluations.filter((e) => e.trackId === track.id);
    const a4 = pairs.map((p) => rows.find((e) => e.agent === 'A4' && e.seed === p.seed)!);
    const a5 = pairs.map((p) => rows.find((e) => e.agent === 'A5' && e.seed === p.seed)!);
    const diffs = a5.map((r, i) => progressOf(r.episode, gates) - progressOf(a4[i]!.episode, gates));
    const mean = sumOf(diffs) / diffs.length;
    const ci = bootstrapMeanInterval(diffs, manifest.analysis.bootstrap);
    const agents = { A4: e5AgentBlock(a4, gates), A5: e5AgentBlock(a5, gates) };
    return {
      trackId: track.id,
      gates,
      primary: {
        differences: diffs,
        meanDifference: mean,
        interval: [ci.lower, ci.upper],
        seedsA5Higher: diffs.filter((d) => d > 0).length,
        seedsTied: diffs.filter((d) => d === 0).length,
        seedsA4Higher: diffs.filter((d) => d < 0).length,
        outcome: classifyE5(mean, ci.lower, ci.upper, manifest.analysis.delta),
      },
      agents,
      allEpisodesCrashed: [...a4, ...a5].every((r) => r.episode.crashed),
      pairedFirstLap: e5PairedFirstLap(a4, a5),
    };
  });
  const outcomes = tracks.map((t) => (t.primary as Json).outcome as E5Outcome);
  return plain({
    format: E5_ANALYSIS_FORMAT,
    version: E5_VERSION,
    manifestHash: e5ManifestHash(manifest),
    label: manifest.label,
    evidence:
      manifest.label === 'mechanics'
        ? 'MECHANICS ONLY: a check that the machinery runs on a synthetic held-out registry. Not study evidence and not acceptance evidence, whatever the numbers say.'
        : 'Confirmatory held-out evaluation under the manifest\'s predeclared rule.',
    pairCount: manifest.pairs.length,
    metric: manifest.analysis.metric,
    decisionRule: manifest.analysis.decisionRule,
    delta: manifest.analysis.delta,
    bootstrap: manifest.analysis.bootstrap,
    seeds: manifest.pairs.map((p) => p.seed),
    tracks,
    circuitsAgree: new Set(outcomes).size === 1,
    pooledHeadline: null,
    claim:
      'Descriptive paired comparison of ten frozen A5 (brake) and A4 (no brake) champion pairs on the listed held-out circuits; it supports no statement about braking in general, other circuits or learning beyond them, and "no clear difference" is a valid outcome that does not mean "no effect".',
  });
}

/** The analysis as canonical JSON text. */
export const e5AnalysisJson = (analysis: Json): string => `${canonicalJson(analysis)}\n`;

const fmt = (value: unknown, digits = 3): string => (typeof value === 'number' ? value.toFixed(digits) : 'n/a');

/** A short Markdown report of an analysis, deterministic for a given analysis. */
export function renderE5Report(analysis: Json): string {
  const label = String(analysis.label);
  const n = analysis.pairCount as number;
  const lines: string[] = [
    `# P5-02 E5 (${label}): brake against no brake on held-out circuits`,
    '',
    ...(label === 'mechanics' ? [`> **${String(analysis.evidence)}**`, ''] : []),
    `Label ${label}; ${n} frozen champion pair${n === 1 ? '' : 's'} (seeds ${(analysis.seeds as number[]).join(', ')}). Manifest \`${String(analysis.manifestHash)}\`. Metric ${String(analysis.metric)}; predeclared meaningful difference ${String(analysis.delta)}; decision rule ${String(analysis.decisionRule)}.`,
    '',
    `**${String(analysis.claim)}**`,
    '',
  ];
  const tracks = analysis.tracks as Json[];
  lines.push('## Primary: A5 − A4 ordered progress, paired by seed', '', '| Circuit | Mean difference | 95% interval | A5 higher / tied / A4 higher | Outcome |', '| --- | --- | --- | --- | --- |');
  for (const t of tracks) {
    const p = t.primary as Json;
    const [lo, hi] = p.interval as number[];
    lines.push(`| ${String(t.trackId)} | ${fmt(p.meanDifference)} | ${fmt(lo)} to ${fmt(hi)} | ${String(p.seedsA5Higher)} / ${String(p.seedsTied)} / ${String(p.seedsA4Higher)} | ${String(p.outcome)} |`);
  }
  lines.push('', analysis.circuitsAgree ? 'The circuits give the same label. There is still **no pooled headline**: each circuit is reported on its own.' : '**The circuits disagree.** There is no pooled headline and none is to be made; the per-circuit rows above are the whole result.', '');
  lines.push('## Secondary (descriptive; they decide nothing)', '', '| Circuit | Agent | Crashes | Lap completions | Median progress | Brake ticks / ticks | Champions that braked |', '| --- | --- | --- | --- | --- | --- | --- |');
  for (const t of tracks) {
    for (const agent of E5_AGENTS) {
      const a = (t.agents as Json)[agent] as Json;
      const u = a.brakeUsage as Json;
      lines.push(`| ${String(t.trackId)} | ${agent} | ${String(a.crashes)} of ${String(a.n)} | ${String(a.lapCompletions)} | ${fmt(a.medianProgress)} | ${String(u.brakeTicks)} / ${String(u.ticks)} | ${String(u.championsThatBraked)} |`);
    }
  }
  lines.push('', '### First-lap time (simulated seconds), only over pairs where both champions completed a lap', '', '| Circuit | Pairs with both | A4 laps | A5 laps | Mean A4 | Mean A5 | Excluded pairs |', '| --- | --- | --- | --- | --- | --- | --- |');
  for (const t of tracks) {
    const f = t.pairedFirstLap as Json;
    const excluded = (f.excludedPairs as { seed: number; completed: string }[]).map((e) => `${e.seed} (${e.completed})`).join(', ');
    lines.push(`| ${String(t.trackId)} | ${String(f.pairsWithBoth)} | ${String(f.a4Completed)} | ${String(f.a5Completed)} | ${fmt(f.meanSecondsA4)} | ${fmt(f.meanSecondsA5)} | ${excluded === '' ? 'none' : excluded} |`);
  }
  lines.push('', '## Limits', '');
  lines.push('- The champions are E4\'s ten pairs, so E5 is **not independent of E4\'s seeds**; it tests the same pairs on new circuits. The champions were chosen by training-circuit fitness.');
  lines.push('- The held-out circuits were looked at once before (E3, for different agents); "unseen" means only that no E5 agent was trained or tuned on them.');
  lines.push('- Intervals are pointwise per circuit, not a simultaneous guarantee across circuits.');
  for (const t of tracks) {
    if (t.allEpisodesCrashed) lines.push(`- On ${String(t.trackId)} every champion crashed: a "no clear difference" there is the likeliest result of a floor effect and says nothing about the brake.`);
  }
  lines.push('- A missing first-lap time is never zero and never dropped from one side only; the secondary measures decide nothing.', '');
  return lines.join('\n');
}
