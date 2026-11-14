// P5-02 step 3 (reworked on the corrected plan, docs/plans/p5-02-plan.md section 0): the E5 study kind. Does the brake output
// improve collisions and/or lap time on circuits the agents did not train on? Design A: E4's ten frozen champion PAIRS (A4, brake
// masked; A5, brake enabled) are read unchanged from the committed E4 records and each is evaluated, once, on each listed
// held-out circuit through the once-only gate of heldOutAccess.ts, from the evaluation protocol's five fixed starts. No new training.
// THIS MODULE RUNS NO STUDY. It defines the manifest, the held-out record, strict parsers, replay and the paired analysis; the
// tests use E4 *mechanics* records (tiny, non-reserved seeds) and a SYNTHETIC held-out registry. No real held-out circuit is
// evaluated here and no E5 result exists. A confirmatory manifest cannot be built yet: the three circuits E3 exposed are spent
// as held-out evidence (plan 0.1) and the fresh circuits do not exist (step 2b, a separate gated step).
//
// The decision (plan 0.2): collisions and lap time decide; ordered progress is descriptive. Per circuit, per endpoint, the seed
// (pair) is the unit and the five starts are scenario variation of one deterministic champion, not independent samples.
//  * Collision: per pair d = crashRate(A5) - crashRate(A4) over the five starts; seed-cluster bootstrap; delta_c = 0.20.
//  * Lap time: per pair, the mean first-lap seconds over the MATCHED starts (both completed a lap), A5 minus A4; a pair is
//    eligible with at least one matched start; a decision needs at least 6 eligible pairs, otherwise `inconclusive`; delta_t = 1 s.
//  * Combining: a net benefit needs the other endpoint's HARM EXCLUDED by its interval; otherwise the headline is endpoint-specific
//    (`partial`). No pooled headline, no equivalence claim, no multiplicity correction claimed, no imputation of a missing time.
import { BRAKE_USAGE_THRESHOLD, type BrakeUsage } from './e4Agents';
import { c1Training, E4_CONFIRMATORY_GENERATIONS, E4_TRAINING_TRACK, e4ManifestHash, parseE4Manifest, parseE4Record, type E4Manifest } from './e4Study';
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
export const E5_DECISION_RULE = 'p5-02-e5-decision-v2';
/** The evaluation protocol's five fixed starts (P4-05): the circuit's nominal start (0) and four perturbed starts (1 to 4). */
export const E5_STARTS = Object.freeze([0, 1, 2, 3, 4]);
/**
 * The predeclared endpoint rules (plan 0.2). PROPOSED DEFAULTS, not yet owner-approved: the owner and Codex may change them
 * before the analysis-design freeze (a reviewed one-line change here). The harm margin is the same meaningful difference.
 */
export const E5_ENDPOINTS = Object.freeze({
  /** Meaningful difference in crash rate (one start in five). */
  collisionDelta: 0.2,
  /** Meaningful difference in first-lap time, simulated seconds. */
  lapTimeDeltaSeconds: 1.0,
  /** At least this many of the pairs must be eligible (have a matched start) for a lap-time decision. */
  minEligiblePairs: 6,
});
/**
 * The three circuits E3 already exposed: spent as held-out evidence for E5 (plan 0.1). They may be development/validation
 * evidence, never E5's held-out conclusion, so no E5 manifest may list them.
 */
export const E5_SPENT_CIRCUITS = Object.freeze(['hairpin-chicane', 'long-sweepers', 'technical-narrow']);
/** A descriptive, non-deciding progress level (laps) used only to decide whether the report shows a possible-floor caution. */
export const E5_LOW_PROGRESS = 0.25;
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
    /** Ordered progress, kept as an additional DESCRIPTIVE measure: it decides nothing. */
    readonly descriptiveMetric: typeof METRIC;
    readonly starts: readonly number[];
    readonly endpoints: typeof E5_ENDPOINTS;
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
  for (const h of heldList) {
    if (E5_SPENT_CIRCUITS.includes(h.id)) {
      fail(`manifest.tracks.heldOut lists "${h.id}", which E3 already exposed: it is spent as held-out evidence for E5 and may only be development/validation evidence (plan section 0.1). E5 needs fresh held-out circuits.`);
    }
  }
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

  const a = exact(m.analysis, 'manifest.analysis', ['descriptiveMetric', 'starts', 'endpoints', 'bootstrap', 'decisionRule', 'brakeUsageThreshold'], fail);
  same(a.descriptiveMetric, METRIC, 'manifest.analysis.descriptiveMetric', fail);
  same(a.starts, E5_STARTS, 'manifest.analysis.starts (the evaluation protocol\'s five fixed starts)', fail);
  same(a.endpoints, E5_ENDPOINTS, 'manifest.analysis.endpoints (the predeclared collision and lap-time rules)', fail);
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
  const pairs = readE5PairsFromE4(e4Manifest, e4Records, engine);
  return { e4ManifestHash: e4ManifestHash(e4Manifest), pairs: pairs.map((p) => ({ seed: p.seed, a4: p.a4.id, a5: p.a5.id, e4ResultsHash: p.e4ResultsHash })) };
}

export function readE5PairsFromE4(e4Manifest: E4Manifest, e4Records: readonly unknown[], engine: ExperimentEngine): E5Pair[] {
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
  const pairs = readE5PairsFromE4(e4Manifest, e4Records, engine);
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

/** One champion on one start of one held-out circuit: its complete episode and its brake usage on that start. */
export interface E5StartResult {
  /** 0 is the circuit's nominal start; 1 to 4 are the protocol's perturbed starts. */
  readonly start: number;
  readonly episode: EpisodeResult;
  /** Ticks driven and ticks with a brake command above the threshold. */
  readonly brakeUsage: BrakeUsage;
}

export interface E5HeldOutEvaluation {
  readonly agent: E5Agent;
  readonly seed: number;
  readonly modelId: string;
  readonly trackId: string;
  /** Exactly one entry per protocol start, in order. */
  readonly starts: readonly E5StartResult[];
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
 * circuit through the gate, from the protocol's five fixed starts, with its brake usage counted per start by a READ-ONLY
 * observer (the gate owns the driver; the observer sees a frozen copy of each decision's controls and changes nothing). The
 * gate must be made for exactly this study's protocol (`e5HeldOutProtocol`) with a ledger restored from earlier openings;
 * opening it claims the protocol in that ledger. The pairs are read and checked (`loadE5Pairs`) before the gate opens, so a
 * bad record can never use up the look.
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
      const ticks = E5_STARTS.map(() => 0);
      const brakeTicks = E5_STARTS.map(() => 0);
      const results = session.evaluateStarts(model, track.id, config, ({ start, controls }) => {
        ticks[start]! += 1;
        if (controls.brake > BRAKE_USAGE_THRESHOLD) brakeTicks[start]! += 1;
      });
      evaluations.push({
        agent,
        seed,
        modelId: model.id,
        trackId: track.id,
        starts: results.map((result, i) => ({
          start: E5_STARTS[i]!,
          episode: episodeResult(result.episode, scoring.config.fitness, scoring.rules, gates),
          brakeUsage: { ticks: ticks[i]!, brakeTicks: brakeTicks[i]! },
        })),
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
    const e = exact(value, `record.evaluations[${i}]`, ['agent', 'seed', 'modelId', 'trackId', 'starts'], fail);
    const want = expected[i]!;
    same([e.agent, e.seed, e.modelId, e.trackId], [want.agent, want.seed, want.model.id, want.track], `record.evaluations[${i}] (agent, seed, model, circuit)`, fail);
    const starts = dense(e.starts, `record.evaluations[${i}].starts`, fail);
    if (starts.length !== E5_STARTS.length) fail(`record.evaluations[${i}].starts must hold ${E5_STARTS.length} starts (the protocol's), got ${starts.length}.`);
    starts.forEach((sv, j) => {
      const path = `record.evaluations[${i}].starts[${j}]`;
      const st = exact(sv, path, ['start', 'episode', 'brakeUsage'], fail);
      same(st.start, E5_STARTS[j], `${path}.start`, fail);
      const episode = checkEpisode(st.episode, `${path}.episode`, episodeCheck(manifest, want.track, splits), fail);
      const usage = exact(st.brakeUsage, `${path}.brakeUsage`, ['ticks', 'brakeTicks'], fail);
      same(usage.ticks, episode.ticks, `${path}.brakeUsage.ticks (the episode's ticks)`, fail);
      int(usage.brakeTicks, `${path}.brakeUsage.brakeTicks`, 0, episode.ticks as number, fail);
      if (want.agent === 'A4' && usage.brakeTicks !== 0) fail(`${path}: an A4 champion cannot brake, but its brakeTicks is ${String(usage.brakeTicks)}.`);
    });
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
// The analysis: pure functions of numbers, then of the records

const sumOf = (values: readonly number[]): number => values.reduce((total, v) => total + v, 0);
const meanOf = (values: readonly number[]): number => sumOf(values) / values.length;

/** What the analysis needs from one champion on one start. */
export interface E5StartRow {
  readonly crashed: boolean;
  /** Simulated seconds of the first completed lap, or null when no lap completed (never zero). */
  readonly firstLapSeconds: number | null;
  /** Ordered progress in laps (gates passed over gates per lap). */
  readonly progress: number;
  readonly ticks: number;
  readonly brakeTicks: number;
}

/** One seed's pair: the A4 and the A5 champion on the same starts, in start order. */
export interface E5PairRows {
  readonly seed: number;
  readonly a4: readonly E5StartRow[];
  readonly a5: readonly E5StartRow[];
}

const THRESHOLD_TOLERANCE = 1e-9;

export type E5EndpointLabel = 'favours-a5' | 'favours-a4' | 'no-clear-difference' | 'inconclusive';

/**
 * One endpoint's label from the predeclared rule: the difference is A5 minus A4 and NEGATIVE favours A5 for both endpoints
 * (fewer crashes, a shorter lap). Clear only when the whole interval is beyond zero AND the mean is at least the meaningful
 * difference; never from a p-value.
 */
export function classifyE5Endpoint(mean: number, lower: number, upper: number, delta: number): Exclude<E5EndpointLabel, 'inconclusive'> {
  // A mean that is exactly the meaningful difference counts as meeting it: a crash-rate difference of exactly one start in five is
  // 0.19999999999999996 in floating point, so the comparison tolerates rounding at the 1e-9 level.
  if (upper < 0 && mean <= -delta + THRESHOLD_TOLERANCE) return 'favours-a5';
  if (lower > 0 && mean >= delta - THRESHOLD_TOLERANCE) return 'favours-a4';
  return 'no-clear-difference';
}

export interface E5EndpointResult {
  readonly label: E5EndpointLabel;
  /** For A5: the whole interval lies below +delta, so a meaningful harm to A5 is excluded. False when there is no interval. */
  readonly harmExcludedForA5: boolean;
  /** For A4 (the mirror image): the whole interval lies above -delta. */
  readonly harmExcludedForA4: boolean;
}

export type E5Headline = 'a5-net-benefit' | 'a4-net-benefit' | 'a5-partial' | 'a4-partial' | 'mixed' | 'no-clear-difference' | 'inconclusive';

const ENDPOINT_WORDS = { collision: { a5: 'A5 has fewer collisions', a4: 'A4 has fewer collisions', name: 'collision' }, lapTime: { a5: 'A5 is faster on matched starts', a4: 'A4 is faster on matched starts', name: 'lap-time' } } as const;

/**
 * The per-circuit headline from the two endpoints (plan 0.2): a NET BENEFIT needs the other endpoint's harm excluded by its
 * interval (or both endpoints favouring the same agent); one clear endpoint without that is PARTIAL and its statement names the
 * unresolved endpoint ("A5 has fewer collisions; the lap-time effect is unresolved"), never "helps"; endpoints that favour
 * different agents are MIXED; neither clear is `no-clear-difference`, or `inconclusive` when lap time could not be decided
 * and collisions show no clear difference.
 */
export function e5Headline(collision: E5EndpointResult, lapTime: E5EndpointResult): { readonly headline: E5Headline; readonly statement: string } {
  const named = [
    { key: 'collision' as const, result: collision, other: lapTime, otherKey: 'lapTime' as const },
    { key: 'lapTime' as const, result: lapTime, other: collision, otherKey: 'collision' as const },
  ];
  const for5 = named.filter((n) => n.result.label === 'favours-a5');
  const for4 = named.filter((n) => n.result.label === 'favours-a4');
  if (for5.length > 0 && for4.length > 0) {
    return { headline: 'mixed', statement: `${ENDPOINT_WORDS[for5[0]!.key].a5}; ${ENDPOINT_WORDS[for4[0]!.key].a4}.` };
  }
  const side = for5.length > 0 ? { agent: 'a5' as const, list: for5 } : for4.length > 0 ? { agent: 'a4' as const, list: for4 } : null;
  if (side !== null) {
    const clear = side.list[0]!;
    const agentLabel = side.agent === 'a5' ? 'A5' : 'A4';
    if (side.list.length === 2) return { headline: `${side.agent}-net-benefit`, statement: `${ENDPOINT_WORDS.collision[side.agent]} and ${ENDPOINT_WORDS.lapTime[side.agent]}.` };
    const excluded = side.agent === 'a5' ? clear.other.harmExcludedForA5 : clear.other.harmExcludedForA4;
    if (excluded) {
      return { headline: `${side.agent}-net-benefit`, statement: `${ENDPOINT_WORDS[clear.key][side.agent]}; a meaningful ${ENDPOINT_WORDS[clear.otherKey].name} harm to ${agentLabel} is excluded.` };
    }
    return { headline: `${side.agent}-partial`, statement: `${ENDPOINT_WORDS[clear.key][side.agent]}; the ${ENDPOINT_WORDS[clear.otherKey].name} effect is unresolved.` };
  }
  if (lapTime.label === 'inconclusive' && collision.label === 'no-clear-difference') {
    return { headline: 'inconclusive', statement: 'No clear collision difference, and too few eligible pairs to decide lap time.' };
  }
  return { headline: 'no-clear-difference', statement: 'Neither endpoint shows a clear difference (this is not a statement of no effect or equivalence).' };
}

interface Settings {
  readonly collisionDelta: number;
  readonly lapTimeDeltaSeconds: number;
  readonly minEligiblePairs: number;
  readonly bootstrap: { readonly resamples: number; readonly seed: number; readonly level: number };
}

const interval = (values: readonly number[], bootstrap: Settings['bootstrap']): { mean: number; lower: number; upper: number } => {
  const ci = bootstrapMeanInterval(values, bootstrap);
  return { mean: meanOf(values), lower: ci.lower, upper: ci.upper };
};

function agentSummary(rows: readonly (readonly E5StartRow[])[]): Json {
  const all = rows.flat();
  const progress = all.map((r) => r.progress);
  const ticks = sumOf(all.map((r) => r.ticks));
  const brakeTicks = sumOf(all.map((r) => r.brakeTicks));
  return {
    champions: rows.length,
    starts: all.length,
    crashedStarts: all.filter((r) => r.crashed).length,
    lapCompletedStarts: all.filter((r) => r.firstLapSeconds !== null).length,
    progress: { median: median(progress), iqr: iqr(progress), mean: meanOf(progress), startsAtOrAboveOneLap: progress.filter((p) => p >= 1).length },
    brakeUsage: { ticks, brakeTicks, fraction: ticks === 0 ? null : brakeTicks / ticks, championsThatBraked: rows.filter((champion) => champion.some((r) => r.brakeTicks > 0)).length },
  };
}

/**
 * The analysis of ONE circuit from its pairs (a pure function of numbers, tested analytically). Collision: per pair, the A5 crash
 * rate minus the A4 crash rate over the starts. Lap time: per pair, over the MATCHED starts (both champions completed a lap),
 * the mean first-lap seconds, A5 minus A4; a pair is eligible with at least one matched start; fewer than `minEligiblePairs`
 * eligible pairs makes the endpoint `inconclusive` (no interval, no label, never replaced by another measure). Every excluded
 * start and pair is listed, including starts where neither champion completed a lap. Progress and the secondary counts are
 * descriptive. No missing time is ever zero or imputed.
 */
export function analyseE5Circuit(pairs: readonly E5PairRows[], settings: Settings): Json {
  if (pairs.length === 0) throw new RangeError('A circuit analysis needs at least one pair.');
  for (const p of pairs) {
    if (p.a4.length !== p.a5.length || p.a4.length === 0) throw new RangeError(`Pair ${p.seed}: both champions need the same, non-empty starts.`);
  }
  // Collision endpoint (always defined).
  const crashRate = (rows: readonly E5StartRow[]): number => rows.filter((r) => r.crashed).length / rows.length;
  const collisionDiffs = pairs.map((p) => crashRate(p.a5) - crashRate(p.a4));
  const c = interval(collisionDiffs, settings.bootstrap);
  const collisionLabel = classifyE5Endpoint(c.mean, c.lower, c.upper, settings.collisionDelta);
  const collision = {
    differences: collisionDiffs,
    meanDifference: c.mean,
    interval: [c.lower, c.upper],
    delta: settings.collisionDelta,
    pairsA5Fewer: collisionDiffs.filter((d) => d < 0).length,
    pairsTied: collisionDiffs.filter((d) => d === 0).length,
    pairsA4Fewer: collisionDiffs.filter((d) => d > 0).length,
    label: collisionLabel,
  };
  // Lap-time endpoint (conditioned on both completing; a decision needs enough eligible pairs).
  const perPair = pairs.map((p) => {
    const matched: number[] = [];
    let a4Only = 0;
    let a5Only = 0;
    let neither = 0;
    p.a4.forEach((r4, i) => {
      const r5 = p.a5[i]!;
      if (r4.firstLapSeconds !== null && r5.firstLapSeconds !== null) matched.push(i);
      else if (r4.firstLapSeconds !== null) a4Only += 1;
      else if (r5.firstLapSeconds !== null) a5Only += 1;
      else neither += 1;
    });
    const eligible = matched.length > 0;
    return {
      seed: p.seed,
      matchedStarts: matched.length,
      excludedStarts: { a4OnlyCompleted: a4Only, a5OnlyCompleted: a5Only, neitherCompleted: neither },
      eligible,
      meanSecondsA4: eligible ? meanOf(matched.map((i) => p.a4[i]!.firstLapSeconds as number)) : null,
      meanSecondsA5: eligible ? meanOf(matched.map((i) => p.a5[i]!.firstLapSeconds as number)) : null,
    };
  });
  const eligiblePairs = perPair.filter((p) => p.eligible);
  const decidable = eligiblePairs.length >= settings.minEligiblePairs;
  const lapDiffs = eligiblePairs.map((p) => (p.meanSecondsA5 as number) - (p.meanSecondsA4 as number));
  let lapLabel: E5EndpointLabel = 'inconclusive';
  let lapStats: { mean: number; lower: number; upper: number } | null = null;
  if (decidable) {
    lapStats = interval(lapDiffs, settings.bootstrap);
    lapLabel = classifyE5Endpoint(lapStats.mean, lapStats.lower, lapStats.upper, settings.lapTimeDeltaSeconds);
  }
  const lapTime = {
    delta: settings.lapTimeDeltaSeconds,
    minEligiblePairs: settings.minEligiblePairs,
    eligiblePairs: eligiblePairs.length,
    pairs: pairs.length,
    pairDetails: perPair,
    excludedPairs: perPair.filter((p) => !p.eligible).map((p) => p.seed),
    differences: decidable ? lapDiffs : null,
    meanDifference: lapStats === null ? null : lapStats.mean,
    interval: lapStats === null ? null : [lapStats.lower, lapStats.upper],
    label: lapLabel,
  };
  const harm = (stats: { lower: number; upper: number } | null, delta: number) => ({
    forA5: stats !== null && stats.upper < delta,
    forA4: stats !== null && stats.lower > -delta,
  });
  const ch = harm(c, settings.collisionDelta);
  const lh = harm(lapStats, settings.lapTimeDeltaSeconds);
  const verdict = e5Headline(
    { label: collisionLabel, harmExcludedForA5: ch.forA5, harmExcludedForA4: ch.forA4 },
    { label: lapLabel, harmExcludedForA5: lh.forA5, harmExcludedForA4: lh.forA4 },
  );
  const a4 = agentSummary(pairs.map((p) => p.a4));
  const a5 = agentSummary(pairs.map((p) => p.a5));
  const progressDiffs = pairs.map((p) => meanOf(p.a5.map((r) => r.progress)) - meanOf(p.a4.map((r) => r.progress)));
  const medianOf = (summary: Json): number => (summary.progress as { median: number }).median;
  const lowProgressNoLaps = medianOf(a4) < E5_LOW_PROGRESS && medianOf(a5) < E5_LOW_PROGRESS && a4.lapCompletedStarts === 0 && a5.lapCompletedStarts === 0;
  return {
    pairs: pairs.length,
    startsPerChampion: pairs[0]!.a4.length,
    collision,
    lapTime,
    harm: { collisionForA5Excluded: ch.forA5, collisionForA4Excluded: ch.forA4, lapTimeForA5Excluded: lh.forA5, lapTimeForA4Excluded: lh.forA4 },
    headline: verdict.headline,
    statement: verdict.statement,
    descriptive: { a4, a5, progressMeanDifferenceA5MinusA4: meanOf(progressDiffs), lowProgressNoLaps },
  };
}

/** The rows of the analysis for one circuit from a parsed held-out record. */
function pairRowsFor(held: E5HeldOutRecord, pairs: readonly E5Pair[], trackId: string, gates: number): E5PairRows[] {
  const dt = DEFAULT_SIM_CONFIG.timestepSeconds;
  const rowsOf = (agent: E5Agent, seed: number): E5StartRow[] => {
    const e = held.evaluations.find((x) => x.trackId === trackId && x.agent === agent && x.seed === seed)!;
    return e.starts.map((s) => ({
      crashed: s.episode.crashed,
      firstLapSeconds: s.episode.lapTicks.length >= 1 ? s.episode.lapTicks[0]! * dt : null,
      progress: s.episode.gatesPassed / gates,
      ticks: s.brakeUsage.ticks,
      brakeTicks: s.brakeUsage.brakeTicks,
    }));
  };
  return pairs.map((p) => ({ seed: p.seed, a4: rowsOf('A4', p.seed), a5: rowsOf('A5', p.seed) }));
}

/**
 * The E5 analysis, a pure function of the manifest, the E4 records and the held-out record. One block per held-out circuit
 * (`analyseE5Circuit`); there is **no pooled headline** across circuits, and `circuitsAgree` only says whether the headlines
 * coincide. "No clear difference" and `inconclusive` are valid, reported outcomes and are not claims of no effect.
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
  const settings: Settings = { ...manifest.analysis.endpoints, bootstrap: manifest.analysis.bootstrap };
  const tracks: Json[] = manifest.tracks.heldOut.map((track) => {
    const gates = gatesOf(track.id, splits);
    return { trackId: track.id, gates, ...analyseE5Circuit(pairRowsFor(held, pairs, track.id, gates), settings) };
  });
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
    decisionRule: manifest.analysis.decisionRule,
    endpoints: manifest.analysis.endpoints,
    startsPerChampion: manifest.analysis.starts.length,
    bootstrap: manifest.analysis.bootstrap,
    seeds: manifest.pairs.map((p) => p.seed),
    tracks,
    circuitsAgree: new Set(tracks.map((t) => t.headline as string)).size === 1,
    pooledHeadline: null,
    claim:
      'Descriptive paired comparison of ten frozen A5 (brake) and A4 (no brake) champion pairs on the listed held-out circuits. A headline is a statement about these pairs on that circuit only: not about braking in general, other circuits or learning beyond them; "no clear difference" and "inconclusive" do not mean no effect or equivalence.',
  });
}

/** The analysis as canonical JSON text. */
export const e5AnalysisJson = (analysis: Json): string => `${canonicalJson(analysis)}\n`;

const fmt = (value: unknown, digits = 3): string => (typeof value === 'number' ? value.toFixed(digits) : 'n/a');
const range = (value: unknown): string => (Array.isArray(value) ? `${fmt(value[0])} to ${fmt(value[1])}` : 'not decided');

/** A short Markdown report of an analysis, deterministic for a given analysis. Counts are factual; no cause is inferred. */
export function renderE5Report(analysis: Json): string {
  const label = String(analysis.label);
  const n = analysis.pairCount as number;
  const e = analysis.endpoints as Json;
  const tracks = analysis.tracks as Json[];
  const lines: string[] = [
    `# P5-02 E5 (${label}): brake against no brake on held-out circuits`,
    '',
    ...(label === 'mechanics' ? [`> **${String(analysis.evidence)}**`, ''] : []),
    `Label ${label}; ${n} frozen champion pair${n === 1 ? '' : 's'} (seeds ${(analysis.seeds as number[]).join(', ')}), ${String(analysis.startsPerChampion)} fixed starts per champion. Manifest \`${String(analysis.manifestHash)}\`. Decision rule ${String(analysis.decisionRule)}: collision (meaningful difference ${String(e.collisionDelta)} in crash rate) and lap time (meaningful difference ${String(e.lapTimeDeltaSeconds)} s, at least ${String(e.minEligiblePairs)} eligible pairs) decide; ordered progress is descriptive.`,
    '',
    `**${String(analysis.claim)}**`,
    '',
    '## Headline per circuit (no pooled headline)',
    '',
    '| Circuit | Collision (A5 − A4 crash rate): mean, 95% interval, label | Lap time (A5 − A4 s): eligible pairs, mean, 95% interval, label | Headline |',
    '| --- | --- | --- | --- |',
  ];
  for (const t of tracks) {
    const c = t.collision as Json;
    const l = t.lapTime as Json;
    lines.push(`| ${String(t.trackId)} | ${fmt(c.meanDifference)}, ${range(c.interval)}, ${String(c.label)} | ${String(l.eligiblePairs)} of ${String(l.pairs)}, ${fmt(l.meanDifference)}, ${range(l.interval)}, ${String(l.label)} | ${String(t.headline)}: ${String(t.statement)} |`);
  }
  lines.push('', analysis.circuitsAgree ? 'The circuits give the same headline. There is still **no pooled headline**: each circuit is reported on its own.' : '**The circuits give different headlines.** There is no pooled headline and none is to be made; the per-circuit rows above are the whole result.', '');
  lines.push('## Counts (factual, descriptive; they decide nothing)', '', '| Circuit | Agent | Crashed starts | Lap-completed starts | Progress median (laps) | Starts at or above one lap | Brake ticks / ticks | Champions that braked |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const t of tracks) {
    const d = t.descriptive as Json;
    for (const agent of ['a4', 'a5'] as const) {
      const a = d[agent] as Json;
      const u = a.brakeUsage as Json;
      const p = a.progress as Json;
      lines.push(`| ${String(t.trackId)} | ${agent.toUpperCase()} | ${String(a.crashedStarts)} of ${String(a.starts)} | ${String(a.lapCompletedStarts)} | ${fmt(p.median)} | ${String(p.startsAtOrAboveOneLap)} | ${String(u.brakeTicks)} / ${String(u.ticks)} | ${String(u.championsThatBraked)} of ${String(a.champions)} |`);
    }
  }
  lines.push('', '### Lap time: matched starts, excluded starts and excluded pairs', '', '| Circuit | Eligible pairs | Excluded pairs | Starts only A4 completed | Starts only A5 completed | Starts neither completed |', '| --- | --- | --- | --- | --- | --- |');
  for (const t of tracks) {
    const l = t.lapTime as Json;
    const details = l.pairDetails as { excludedStarts: { a4OnlyCompleted: number; a5OnlyCompleted: number; neitherCompleted: number } }[];
    const total = (key: 'a4OnlyCompleted' | 'a5OnlyCompleted' | 'neitherCompleted') => sumOf(details.map((p) => p.excludedStarts[key]));
    const excluded = (l.excludedPairs as number[]).join(', ');
    lines.push(`| ${String(t.trackId)} | ${String(l.eligiblePairs)} of ${String(l.pairs)} | ${excluded === '' ? 'none' : excluded} | ${total('a4OnlyCompleted')} | ${total('a5OnlyCompleted')} | ${total('neitherCompleted')} |`);
  }
  lines.push('', '## Reading the result', '');
  lines.push('- Collision and lap time are the deciding endpoints; a lap-time decision uses only starts where both champions completed a lap and needs enough eligible pairs, otherwise it is `inconclusive` and is not replaced by another measure. A missing time is never zero and never dropped from one side only.');
  lines.push('- A net benefit needs the other endpoint\'s harm excluded by its interval; one clear endpoint without that is `partial` and says which effect is unresolved.');
  lines.push('- The champions are E4\'s ten pairs, so E5 is **not independent of E4\'s seeds**; the champions were chosen by training-circuit fitness. The five starts are scenario variation of one deterministic champion, not independent samples, and the intervals are over the ten seeds only. Intervals are pointwise per circuit; two endpoints on several circuits are not corrected for multiplicity.');
  for (const t of tracks) {
    if ((t.descriptive as Json).lowProgressNoLaps) {
      lines.push(`- On ${String(t.trackId)} both agents' median progress is below ${E5_LOW_PROGRESS} lap and no start completed a lap (the counts above). A floor effect is a possibility that has not been tested here; the cause of a weak result is not established.`);
    }
  }
  lines.push('');
  return lines.join('\n');
}
