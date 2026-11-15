// P5-04 step 3b (docs/plans/p5-04-plan.md section 4): the E6 study kind, "do evolved drivers complete laps on held-out circuits above
// baselines?". A library only: it defines the manifest, the held-out record, strict parsers, replay and the analysis wiring. THIS MODULE
// RUNS NO STUDY; the tests use E4/E5 *mechanics* fixtures and a SYNTHETIC held-out registry, so no real held-out circuit is evaluated here.
//
// STATUS: EXPLORATORY AND DESCRIPTIVE. The owner chose the shared-circuit option after the E5 opening, so E5's results on these circuits
// were known when E6 was designed. The manifest label is `exploratory` (never `confirmatory`) and every output says so.
//
// What is evaluated and what is read (shared-circuit option, plan 3.2):
//  * A4 and A5 are READ from E5's held-out record (checked, through the strict E5 parser, against E5's manifest, the E4 records and a
//    pinned E5 resultsHash). The gate allows each (model, circuit) once, and E5 already opened them, so E6 never evaluates them again.
//  * A2 (per training seed, the FIRST genome of that seed's generation 0, brake active: no performance is used to choose it), A1 and A7
//    (random-action drivers with predeclared action seeds) and A3 (the frozen rule) are evaluated NEW, once each per circuit, through the
//    gate, from the five fixed starts.
import { initialParameters } from '../ai/network';
import { episodeResult } from './baselines';
import { e5ManifestHash, gatesOf, heldOutEpisodeCheck, heldOutScoring, checkSourcePin, parseE5HeldOutRecord, parseE5Manifest, E5_SPENT_CIRCUITS, type E5HeldOutRecord } from './e5Study';
import { E6_BOOTSTRAP, E6_DECISION_RULE, E6_FLOOR_SHARE, E6_MARGIN, E6_STATUS, analyseE6, type E6CircuitInput, type E6Unit } from './e6Analysis';
import { canonicalJson, jsonDifferences, manifestEpochOf, manifestRecord, type ExperimentEngine, type ExperimentSource } from './experiment';
import {
  createHeldOutGate,
  createMemoryLedger,
  freezeRandomAgent,
  freezeRuleAgent,
  freezeUntrainedNetworkAgent,
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
  plain,
  REVISION,
  reserved,
  same,
  str,
  StudyCompatibilityError,
  StudyManifestError,
  StudyRecordError,
  type Fail,
  type Json,
  type StudyContext,
} from './study';
import { trainerStreams } from './trainer';
import { BUILT_IN_TRACK_SPLITS, epochIds, isBuiltInRegistry, latestEpochOf, splitsAsOf, type FrozenModel, type TrackSplits } from './trackSplits';


export const E6_MANIFEST_FORMAT = 'self-driving-ai-evolution/p5-04-e6-manifest';
export const E6_HELDOUT_FORMAT = 'self-driving-ai-evolution/p5-04-e6-heldout-record';
export const E6_VERSION = 1;
export const E6_LABELS = Object.freeze(['mechanics', 'exploratory'] as const);
export type E6Label = (typeof E6_LABELS)[number];
/** The predeclared action seeds of the random-action drivers A1 and A7: ten, unrelated to the training seeds. */
export const E6_ACTION_SEEDS = Object.freeze(Array.from({ length: 10 }, (_, i) => 5001 + i));
export const E6_STARTS = Object.freeze([0, 1, 2, 3, 4]);
export const E6_NEW_AGENTS = Object.freeze(['A2', 'A1', 'A7', 'A3'] as const);
export type E6NewAgent = (typeof E6_NEW_AGENTS)[number];
const A3_SEED = 0;

export interface E6Pin {
  readonly seed: number;
  readonly modelId: string;
}
export interface E6Manifest {
  readonly format: typeof E6_MANIFEST_FORMAT;
  readonly version: typeof E6_VERSION;
  readonly id: string;
  readonly label: E6Label;
  readonly description: string;
  /** The E5 manifest and held-out record that A4 and A5 are read from. */
  readonly e5: { readonly manifestHash: string; readonly resultsHash: string };
  readonly baselines: { readonly a2: readonly E6Pin[]; readonly a1: readonly E6Pin[]; readonly a7: readonly E6Pin[]; readonly a3: { readonly modelId: string } };
  /** The training configuration the champions were evolved under (equal to E5's): its episode limits and scoring are used for every evaluation. */
  readonly configuration: { readonly generations: number; readonly training: Json };
  readonly tracks: { readonly heldOut: readonly { readonly id: string; readonly contentHash: string }[]; readonly splitManifestHash: string };
  readonly analysis: {
    readonly starts: readonly number[];
    readonly margin: number;
    readonly bootstrap: typeof E6_BOOTSTRAP;
    readonly decisionRule: typeof E6_DECISION_RULE;
    readonly floorShare: number;
    readonly status: string;
  };
  readonly authorisation: string;
  readonly code: { readonly revision: string | null };
}

const MANIFEST_KEYS = ['format', 'version', 'id', 'label', 'description', 'e5', 'baselines', 'configuration', 'tracks', 'analysis', 'authorisation', 'code'];

export const e6ManifestHash = (manifest: E6Manifest): string => hashOf(manifest);

// ---------------------------------------------------------------------------------------------------------------------------------
// The new agents, derived (never chosen by performance) and pinned

/** A2 for a training seed: the first genome of that seed's generation 0 (the trainer's own initial stream), brake active. */
export function untrainedRepresentative(seed: number): FrozenModel {
  const genome = initialParameters(trainerStreams(seed).initial);
  return freezeUntrainedNetworkAgent(genome, { trainingSeed: seed, genomeIndex: 0, selection: 'first-genome-of-generation-0' });
}
export const randomAgentFor = (agent: 'A1' | 'A7', seed: number): FrozenModel => freezeRandomAgent(agent, seed, { actionSeed: seed });
export const ruleAgentA3 = (): FrozenModel => freezeRuleAgent('A3');

/** The pins a manifest needs for the given seeds (for the author of a manifest; `loadE6Agents` re-derives and re-checks them). */
export function e6BaselinePins(a2Seeds: readonly number[], actionSeeds: readonly number[]): E6Manifest['baselines'] {
  return {
    a2: a2Seeds.map((seed) => ({ seed, modelId: untrainedRepresentative(seed).id })),
    a1: actionSeeds.map((seed) => ({ seed, modelId: randomAgentFor('A1', seed).id })),
    a7: actionSeeds.map((seed) => ({ seed, modelId: randomAgentFor('A7', seed).id })),
    a3: { modelId: ruleAgentA3().id },
  };
}

export interface E6Agent {
  readonly agent: E6NewAgent;
  readonly seed: number;
  readonly model: FrozenModel;
}

/** The new agents in their fixed order (A2 by training seed, then A1, A7 by action seed, then A3), re-derived from the manifest's seeds and checked against its pins. */
export function loadE6Agents(manifest: E6Manifest): E6Agent[] {
  const fail: Fail = (message) => {
    throw new StudyRecordError(`E6 agents: ${message}`);
  };
  const list: E6Agent[] = [
    ...manifest.baselines.a2.map((p) => ({ agent: 'A2' as const, seed: p.seed, model: untrainedRepresentative(p.seed) })),
    ...manifest.baselines.a1.map((p) => ({ agent: 'A1' as const, seed: p.seed, model: randomAgentFor('A1', p.seed) })),
    ...manifest.baselines.a7.map((p) => ({ agent: 'A7' as const, seed: p.seed, model: randomAgentFor('A7', p.seed) })),
    { agent: 'A3' as const, seed: A3_SEED, model: ruleAgentA3() },
  ];
  const pins = [...manifest.baselines.a2, ...manifest.baselines.a1, ...manifest.baselines.a7, { seed: A3_SEED, modelId: manifest.baselines.a3.modelId }];
  list.forEach((a, i) => same(a.model.id, pins[i]!.modelId, `the ${a.agent} agent for seed ${a.seed} (its identity, re-derived from the seed)`, fail));
  return list;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The manifest

export function parseE6Manifest(input: unknown, splits: TrackSplits = BUILT_IN_TRACK_SPLITS): E6Manifest {
  const fail: Fail = (message) => {
    throw new StudyManifestError(`E6 manifest: ${message}`);
  };
  denseEverywhere(input, 'manifest', fail);
  const m = exact(input, 'manifest', MANIFEST_KEYS, fail);
  same(m.format, E6_MANIFEST_FORMAT, 'manifest.format', fail);
  same(m.version, E6_VERSION, 'manifest.version', fail);
  if (typeof m.id !== 'string' || !ID_PATTERN.test(m.id)) fail('manifest.id must be 1 to 64 lowercase letters, digits or hyphens.');
  if (!E6_LABELS.includes(m.label as E6Label)) fail(`manifest.label must be one of ${E6_LABELS.join(', ')} (E6 is exploratory: it is never confirmatory, because E5's results were known).`);
  const label = m.label as E6Label;
  if (str(m.description, 'manifest.description', fail).length > 1000) fail('manifest.description must be at most 1000 characters.');
  const builtIn = isBuiltInRegistry(splits);

  const e5 = exact(m.e5, 'manifest.e5', ['manifestHash', 'resultsHash'], fail);
  for (const key of ['manifestHash', 'resultsHash'] as const) if (typeof e5[key] !== 'string' || !HASH.test(e5[key] as string)) fail(`manifest.e5.${key} must be a sha256: hash.`);

  const b = exact(m.baselines, 'manifest.baselines', ['a2', 'a1', 'a7', 'a3'], fail);
  const pins = (value: unknown, path: string): E6Pin[] => {
    const list = dense(value, path, fail);
    if (list.length === 0) fail(`${path} must be a non-empty array.`);
    const out = list.map((p, i) => {
      const pin = exact(p, `${path}[${i}]`, ['seed', 'modelId'], fail);
      if (typeof pin.modelId !== 'string' || !HASH.test(pin.modelId)) fail(`${path}[${i}].modelId must be a sha256: hash.`);
      return { seed: int(pin.seed, `${path}[${i}].seed`, 0, 0xffffffff, fail), modelId: pin.modelId as string };
    });
    if (new Set(out.map((p) => p.seed)).size !== out.length) fail(`${path} must have distinct seeds.`);
    return out;
  };
  const a2 = pins(b.a2, 'manifest.baselines.a2');
  const a1 = pins(b.a1, 'manifest.baselines.a1');
  const a7 = pins(b.a7, 'manifest.baselines.a7');
  const a3 = exact(b.a3, 'manifest.baselines.a3', ['modelId'], fail);
  if (typeof a3.modelId !== 'string' || !HASH.test(a3.modelId)) fail('manifest.baselines.a3.modelId must be a sha256: hash.');
  same(a1.map((p) => p.seed), a7.map((p) => p.seed), 'manifest.baselines.a7 seeds (the same predeclared action seeds as A1, in order)', fail);
  const ids = [...a2, ...a1, ...a7].map((p) => p.modelId).concat(a3.modelId as string);
  if (new Set(ids).size !== ids.length) fail('manifest.baselines must name distinct frozen agents.');
  if (label === 'exploratory') {
    same(a2.map((p) => p.seed), E4_SEEDS, "manifest.baselines.a2 (an exploratory manifest pairs A2 with E4's training seeds 2001–2010, in order)", fail);
    same(a1.map((p) => p.seed), E6_ACTION_SEEDS, 'manifest.baselines.a1 (the predeclared action seeds 5001–5010)', fail);
  } else {
    if ([...a2, ...a1, ...a7].some((p) => reserved(p.seed))) fail('a mechanics manifest may not use a reserved seed (pilot 9001–9003, P2-08 1001–1020, E4 2001–2010 or E3 3001–3010).');
    if (a2.length > MAX_MECHANICS_SEEDS) fail(`a mechanics manifest has at most ${MAX_MECHANICS_SEEDS} seeds.`);
  }

  const c = exact(m.configuration, 'manifest.configuration', ['generations', 'training'], fail);
  int(c.generations, 'manifest.configuration.generations', 1, 10_000, fail);
  if (c.training === null || typeof c.training !== 'object' || Array.isArray(c.training)) fail('manifest.configuration.training must be an object.');
  try {
    heldOutScoring(c as { generations: number; training: Json }, a2[0]!.seed, splits); // resolves the configuration: throws on anything invalid
  } catch (error) {
    return fail(`manifest.configuration is invalid: ${(error as Error).message}`);
  }

  const t = exact(m.tracks, 'manifest.tracks', ['heldOut', 'splitManifestHash'], fail);
  const epoch = splits.epochs !== undefined ? manifestEpochOf(t.splitManifestHash, splits) ?? latestEpochOf(splits.epochs) : undefined;
  const view = epoch !== undefined ? splitsAsOf(splits, epoch) : splits;
  same(t.splitManifestHash, manifestRecord(splits, epoch).hash, 'manifest.tracks.splitManifestHash', fail);
  const held = dense(t.heldOut, 'manifest.tracks.heldOut', fail).map((h, i) => {
    const ref = exact(h, `manifest.tracks.heldOut[${i}]`, ['id', 'contentHash'], fail);
    const entry = view.tracks.find((x) => x.id === ref.id);
    if (entry === undefined || entry.split !== 'held-out') fail(`manifest.tracks.heldOut[${i}] ("${String(ref.id)}") is not a registered held-out circuit.`);
    if (ref.contentHash !== entry!.contentHash) fail(`manifest.tracks.heldOut[${i}].contentHash does not match the registered circuit.`);
    if (E5_SPENT_CIRCUITS.includes(ref.id as string)) fail(`manifest.tracks.heldOut lists "${ref.id as string}", which E3 already exposed (spent as held-out evidence).`);
    const provenance = entry!.provenance;
    if (provenance === null || provenance.designedBeforeAnyEvaluation !== true || !provenance.introducedBy.startsWith('P5-02')) fail(`manifest.tracks.heldOut[${i}] ("${ref.id as string}") has no registered P5-02 provenance.`);
    return { id: ref.id as string, contentHash: ref.contentHash as string };
  });
  if (held.length === 0) fail('manifest.tracks.heldOut must list at least one held-out circuit.');
  if (new Set(held.map((h) => h.id)).size !== held.length) fail('manifest.tracks.heldOut must be distinct.');
  if (epoch !== undefined) for (const h of held) if (!epochIds(epoch, splits.epochs).includes(h.id)) fail(`manifest.tracks lists "${h.id}", which is not part of the track set (split epoch ${epoch}) the manifest names.`);
  if (label === 'exploratory' && !builtIn) fail('an exploratory manifest uses the built-in track registry.');
  if (label === 'mechanics' && builtIn) fail('a mechanics manifest uses a synthetic registry: mechanics never touches real held-out data.');

  const a = exact(m.analysis, 'manifest.analysis', ['starts', 'margin', 'bootstrap', 'decisionRule', 'floorShare', 'status'], fail);
  same(a.starts, E6_STARTS, "manifest.analysis.starts (the evaluation protocol's five fixed starts)", fail);
  same(a.margin, E6_MARGIN, 'manifest.analysis.margin', fail);
  same(a.bootstrap, E6_BOOTSTRAP, 'manifest.analysis.bootstrap', fail);
  same(a.decisionRule, E6_DECISION_RULE, 'manifest.analysis.decisionRule', fail);
  same(a.floorShare, E6_FLOOR_SHARE, 'manifest.analysis.floorShare', fail);
  same(a.status, E6_STATUS, 'manifest.analysis.status (E6 is exploratory and descriptive and says so where it is frozen)', fail);
  if (typeof m.authorisation !== 'string' || !/^[A-Za-z0-9._:/#-]{1,200}$/.test(m.authorisation)) fail("manifest.authorisation must name the owner's authorisation (1 to 200 letters, digits or . _ : / # -).");
  const code = exact(m.code, 'manifest.code', ['revision'], fail);
  if (code.revision === null) {
    if (label !== 'mechanics') fail(`a ${label} manifest needs manifest.code.revision, the commit it was frozen at.`);
  } else if (typeof code.revision !== 'string' || !REVISION.test(code.revision)) fail('manifest.code.revision must be a 40-character git commit or null.');
  return input as E6Manifest;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The evolved cohorts, read from E5's record

/**
 * The evolved cohorts as LOADED and validated for exactly one E6 manifest: a private, deeply frozen copy of E5's record (the caller's object is
 * never kept), bound to the E6 manifest hash it was validated for, the E5 manifest pin and a digest of its contents. Only `loadE6Evolved` makes
 * one (a brand no hand-built object carries), and `runE6HeldOut` re-checks all of it before the once-only gate opens (Codex's P2 on #215).
 */
export interface E6Evolved {
  readonly record: E5HeldOutRecord;
  readonly e5ManifestHash: string;
  /** The hash of the E6 manifest this snapshot was validated against. */
  readonly e6ManifestHash: string;
  /** The hash of the snapshot's contents (the opening and evaluations), recomputed before the opening. */
  readonly digest: string;
}
const LOADED = new WeakSet<object>();

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as object)) deepFreeze(child);
  }
  return value;
}
const digestOf = (record: E5HeldOutRecord): string => hashOf({ opening: record.opening, evaluations: record.evaluations });

/**
 * Reads A4 and A5 from E5's held-out record through the strict E5 parser (against E5's manifest and the E4 records) and checks that this
 * manifest pins exactly that manifest and record, that it lists the same circuits and uses the same training configuration and split
 * epoch. Nothing is evaluated.
 */
export function loadE6Evolved(
  manifestInput: unknown,
  e5ManifestInput: unknown,
  e5Record: unknown,
  e4ManifestInput: unknown,
  e4Records: readonly unknown[],
  engine: ExperimentEngine,
  splits: TrackSplits = BUILT_IN_TRACK_SPLITS,
): E6Evolved {
  const manifest = parseE6Manifest(manifestInput, splits);
  const e5Manifest = parseE5Manifest(e5ManifestInput, splits);
  const incompatible = (message: string): never => {
    throw new StudyCompatibilityError(`E6 is incompatible with the E5 record it reads: ${message}`);
  };
  if (e5ManifestHash(e5Manifest) !== manifest.e5.manifestHash) incompatible('the E5 manifest is not the one this E6 manifest pins (manifest.e5.manifestHash differs).');
  if (canonicalJson(e5Manifest.tracks) !== canonicalJson(manifest.tracks)) incompatible('the held-out circuits or split-manifest hash differ from the E5 manifest\'s.');
  if (canonicalJson(e5Manifest.configuration) !== canonicalJson(manifest.configuration)) incompatible('the training configuration differs from the E5 manifest\'s.');
  const record = parseE5HeldOutRecord(e5Record, e5Manifest, e4ManifestInput, e4Records, engine, splits);
  if (record.resultsHash !== manifest.e5.resultsHash) incompatible('the E5 held-out record is not the one this manifest pins (manifest.e5.resultsHash differs).');
  if (canonicalJson(e5Manifest.pairs.map((p) => p.seed)) !== canonicalJson(manifest.baselines.a2.map((p) => p.seed))) incompatible("A2's training seeds are not the E5 champion pairs' seeds, so A2 cannot be paired with them.");
  const snapshot = deepFreeze(plain(record)); // a private copy: later changes to the caller's record cannot reach it
  const bound: E6Evolved = Object.freeze({ record: snapshot, e5ManifestHash: manifest.e5.manifestHash, e6ManifestHash: e6ManifestHash(manifest), digest: digestOf(snapshot) });
  LOADED.add(bound);
  return bound;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The held-out record of the NEW agents

/** The held-out protocol: the manifest's hash, its authorisation, its circuits and ONLY the new agents (A4 and A5 are not evaluated again). */
export function e6HeldOutProtocol(manifestInput: unknown, splits: TrackSplits = BUILT_IN_TRACK_SPLITS): HeldOutProtocol {
  const manifest = parseE6Manifest(manifestInput, splits);
  return {
    protocolHash: e6ManifestHash(manifest),
    authorisationId: manifest.authorisation,
    trackIds: manifest.tracks.heldOut.map((t) => t.id),
    agentIds: loadE6Agents(manifest).map((a) => a.model.id),
  };
}

export interface E6StartResult {
  readonly start: number;
  readonly episode: ReturnType<typeof episodeResult>;
}
export interface E6HeldOutEvaluation {
  readonly agent: E6NewAgent;
  readonly seed: number;
  readonly modelId: string;
  readonly trackId: string;
  readonly starts: readonly E6StartResult[];
}
export interface E6HeldOutRecord {
  readonly format: typeof E6_HELDOUT_FORMAT;
  readonly version: typeof E6_VERSION;
  readonly manifestHash: string;
  readonly recordedAt: string;
  readonly source: ExperimentSource;
  readonly engine: ExperimentEngine;
  readonly contracts: ReturnType<typeof currentStudyContracts>;
  readonly opening: HeldOutOpening;
  readonly evaluations: readonly E6HeldOutEvaluation[];
  readonly resultsHash: string;
}
const HELDOUT_KEYS = ['format', 'version', 'manifestHash', 'recordedAt', 'source', 'engine', 'contracts', 'opening', 'evaluations', 'resultsHash'];

function checkManifestAndContext(manifestInput: unknown, context: StudyContext, splits: TrackSplits): E6Manifest {
  const manifest = parseE6Manifest(manifestInput, splits);
  const fail: Fail = (message) => {
    throw new StudyRecordError(`Study context: ${message}`);
  };
  checkContext(context, fail);
  checkSourcePin(manifest, context.source, fail);
  return manifest;
}

/**
 * The ONE look of E6: every new agent is evaluated once on each listed held-out circuit through the gate, from the five fixed starts. The
 * gate must be made for exactly this study's protocol with a ledger restored from earlier openings; opening it claims the protocol. The
 * evolved record is read and checked BEFORE the gate opens, so a bad input can never use up the look.
 */
export function runE6HeldOut(
  manifestInput: unknown,
  evolved: E6Evolved,
  gate: HeldOutGate,
  context: StudyContext,
  splits: TrackSplits = BUILT_IN_TRACK_SPLITS,
): E6HeldOutRecord {
  const manifest = checkManifestAndContext(manifestInput, context, splits);
  // Everything about the evolved cohorts is re-checked HERE, before the once-only gate can open, so an input that the later analysis would
  // reject can never spend the look.
  const refuse = (message: string): never => {
    throw new StudyCompatibilityError(`${message} Nothing was opened.`);
  };
  if (!LOADED.has(evolved)) refuse('The evolved cohorts were not produced by loadE6Evolved (they carry no validated binding).');
  if (evolved.e6ManifestHash !== e6ManifestHash(manifest)) refuse('The evolved cohorts were validated for another E6 manifest (its hash differs from this one: a changed configuration, circuit, pin or analysis setting).');
  if (evolved.e5ManifestHash !== manifest.e5.manifestHash) refuse("The evolved cohorts' E5 manifest is not the one this manifest pins.");
  if (evolved.record.resultsHash !== manifest.e5.resultsHash) refuse('The evolved record is not the E5 record this manifest pins.');
  if (digestOf(evolved.record) !== evolved.digest || hashOf({ opening: evolved.record.opening, evaluations: evolved.record.evaluations }) !== evolved.record.resultsHash) {
    refuse("The evolved record's contents no longer match its pinned results hash (it was changed after loading).");
  }
  // The E5 record was produced and parsed under ONE engine, and `analyseE6Records` hands one engine to both strict parsers, so an E6 look taken
  // under another engine could never be analysed together with it: refuse before the once-only gate opens (Codex's P2 on #215).
  for (const key of ['name', 'version', 'v8'] as const) {
    if (evolved.record.engine[key] !== context.engine[key]) {
      throw new StudyCompatibilityError(`The evolved E5 record was recorded under engine ${key} ${evolved.record.engine[key]}, but this run's is ${context.engine[key]}; E6 must run under the engine of the record it reads, and nothing was opened.`);
    }
  }
  const agents = loadE6Agents(manifest);
  const protocol = e6HeldOutProtocol(manifest, splits);
  if (canonicalJson(gate.protocol) !== canonicalJson(protocol)) {
    throw new HeldOutAccessError("The gate was not made for this study's protocol (manifest hash, authorisation, held-out circuits and frozen agents must match exactly).");
  }
  const session = gate.open(manifest.authorisation);
  const config = (({ maxEpisodeSeconds, stallSeconds, maxLaps, fitness }) => ({ maxEpisodeSeconds, stallSeconds, maxLaps, fitness }))(heldOutScoring(manifest.configuration, manifest.baselines.a2[0]!.seed, splits).config);
  const scoring = heldOutScoring(manifest.configuration, manifest.baselines.a2[0]!.seed, splits);
  const evaluations: E6HeldOutEvaluation[] = [];
  for (const track of manifest.tracks.heldOut) {
    const gates = gatesOf(track.id, splits);
    for (const { agent, seed, model } of agents) {
      const results = session.evaluateStarts(model, track.id, config);
      evaluations.push({ agent, seed, modelId: model.id, trackId: track.id, starts: results.map((r, i) => ({ start: E6_STARTS[i]!, episode: episodeResult(r.episode, scoring.config.fitness, scoring.rules, gates) })) });
    }
  }
  const plainEvaluations = plain(evaluations);
  return {
    format: E6_HELDOUT_FORMAT,
    version: E6_VERSION,
    manifestHash: e6ManifestHash(manifest),
    recordedAt: context.recordedAt,
    source: plain(context.source),
    engine: plain(context.engine),
    contracts: currentStudyContracts(),
    opening: plain(session.opening),
    evaluations: plainEvaluations,
    resultsHash: hashOf({ opening: session.opening, evaluations: plainEvaluations }),
  };
}

/** Checks an E6 held-out record against its manifest completely and returns it. */
export function parseE6HeldOutRecord(input: unknown, manifestInput: unknown, engine: ExperimentEngine, splits: TrackSplits = BUILT_IN_TRACK_SPLITS): E6HeldOutRecord {
  const manifest = parseE6Manifest(manifestInput, splits);
  const fail: Fail = (message) => {
    throw new StudyRecordError(`E6 held-out record: ${message}`);
  };
  denseEverywhere(input, 'record', fail);
  const r = exact(input, 'record', HELDOUT_KEYS, fail);
  same(r.format, E6_HELDOUT_FORMAT, 'record.format', fail);
  same(r.version, E6_VERSION, 'record.version', fail);
  if (typeof r.manifestHash !== 'string' || !HASH.test(r.manifestHash)) fail('record.manifestHash must be a sha256: hash.');
  if (typeof r.recordedAt !== 'string' || !ISO_TIME.test(r.recordedAt)) fail('record.recordedAt must be an ISO 8601 UTC time.');
  const incompatible: Fail = (message) => {
    throw new StudyCompatibilityError(`E6 held-out record is incompatible: ${message}`);
  };
  if (r.manifestHash !== e6ManifestHash(manifest)) incompatible('it was recorded for another manifest (manifestHash differs).');
  const recorded = r.engine as Json;
  for (const key of ['name', 'version', 'v8'] as const) {
    if (recorded?.[key] !== engine[key]) incompatible(`engine ${key} ${String(recorded?.[key])} differs from this engine's ${engine[key]}; results are only reproducible within one engine.`);
  }
  if (canonicalJson(r.contracts) !== canonicalJson(currentStudyContracts())) incompatible("its contracts differ from this code's.");
  checkContext({ engine: r.engine as ExperimentEngine, source: r.source as ExperimentSource, recordedAt: r.recordedAt as string }, fail);
  checkSourcePin(manifest, r.source as ExperimentSource, fail);
  const opening = exact(r.opening, 'record.opening', ['protocolHash', 'authorisationId', 'trackIds', 'agentIds'], fail);
  same(opening, e6HeldOutProtocol(manifest, splits), 'record.opening (the protocol this manifest and its frozen agents define)', fail);
  const agents = loadE6Agents(manifest);
  const evals = dense(r.evaluations, 'record.evaluations', fail);
  const expected = manifest.tracks.heldOut.flatMap((t) => agents.map((a) => ({ track: t.id, ...a })));
  if (evals.length !== expected.length) fail(`record.evaluations must hold ${expected.length} evaluations (each new agent once on each held-out circuit), got ${evals.length}.`);
  evals.forEach((value, i) => {
    const e = exact(value, `record.evaluations[${i}]`, ['agent', 'seed', 'modelId', 'trackId', 'starts'], fail);
    const want = expected[i]!;
    same([e.agent, e.seed, e.modelId, e.trackId], [want.agent, want.seed, want.model.id, want.track], `record.evaluations[${i}] (agent, seed, model, circuit)`, fail);
    const starts = dense(e.starts, `record.evaluations[${i}].starts`, fail);
    if (starts.length !== E6_STARTS.length) fail(`record.evaluations[${i}].starts must hold ${E6_STARTS.length} starts (the protocol's), got ${starts.length}.`);
    starts.forEach((sv, j) => {
      const path = `record.evaluations[${i}].starts[${j}]`;
      const st = exact(sv, path, ['start', 'episode'], fail);
      same(st.start, E6_STARTS[j], `${path}.start`, fail);
      checkEpisode(st.episode, `${path}.episode`, heldOutEpisodeCheck(manifest.configuration, manifest.baselines.a2[0]!.seed, want.track, splits), fail);
    });
  });
  if (r.resultsHash !== hashOf({ opening: r.opening, evaluations: r.evaluations })) fail('record.resultsHash does not match the opening and evaluations.');
  return input as E6HeldOutRecord;
}

/** The ledger a restart must use: restored from the openings of the held-out records already written. */
export const e6LedgerFromRecords = (records: readonly { readonly opening: HeldOutOpening }[]): OpeningLedger => createMemoryLedger(records.map((r) => r.opening));

export interface E6Replay {
  readonly identical: boolean;
  readonly differences: readonly string[];
  readonly sameSourceRevision: boolean | null;
}

/** Verifies a record by re-evaluating its frozen agents through a REPLAY gate (a fresh ledger): a check, not a new look; the study's real ledger is never touched. */
export function replayE6HeldOutRecord(input: unknown, manifestInput: unknown, evolved: E6Evolved, engine: ExperimentEngine, source?: ExperimentSource, splits: TrackSplits = BUILT_IN_TRACK_SPLITS): E6Replay {
  const record = parseE6HeldOutRecord(input, manifestInput, engine, splits);
  const gate = createHeldOutGate(e6HeldOutProtocol(manifestInput, splits), createMemoryLedger(), splits);
  const fresh = runE6HeldOut(manifestInput, evolved, gate, { engine, source: record.source, recordedAt: record.recordedAt }, splits);
  const differences = jsonDifferences({ evaluations: record.evaluations }, { evaluations: fresh.evaluations }, 'record', 20);
  const sameSourceRevision = source?.revision && record.source.revision ? source.revision === record.source.revision : null;
  return { identical: differences.length === 0, differences, sameSourceRevision };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The analysis from the records

const unitOf = (seed: number, starts: readonly { readonly episode: { readonly lapTicks: readonly number[]; readonly orderedProgress: number } }[]): E6Unit => ({
  seed,
  completedStarts: starts.filter((s) => s.episode.lapTicks.length >= 1).length,
  progress: starts.reduce((t, s) => t + s.episode.orderedProgress, 0) / starts.length,
});

export function analyseE6Records(
  manifestInput: unknown,
  e5ManifestInput: unknown,
  e5Record: unknown,
  e4ManifestInput: unknown,
  e4Records: readonly unknown[],
  heldOutRecord: unknown,
  engine: ExperimentEngine,
  splits: TrackSplits = BUILT_IN_TRACK_SPLITS,
): Json {
  const manifest = parseE6Manifest(manifestInput, splits);
  const evolved = loadE6Evolved(manifest, e5ManifestInput, e5Record, e4ManifestInput, e4Records, engine, splits);
  const record = parseE6HeldOutRecord(heldOutRecord, manifest, engine, splits);
  const circuits: E6CircuitInput[] = manifest.tracks.heldOut.map((track) => {
    const evolvedUnits = (agent: 'A5' | 'A4'): E6Unit[] =>
      evolved.record.evaluations.filter((e) => e.trackId === track.id && e.agent === agent).map((e) => unitOf(e.seed, e.starts));
    const baseline = (agent: E6NewAgent): E6Unit[] => record.evaluations.filter((e) => e.trackId === track.id && e.agent === agent).map((e) => unitOf(e.seed, e.starts));
    const a3 = baseline('A3');
    if (a3.length !== 1) throw new StudyRecordError('E6 analysis: A3 must have exactly one evaluation per circuit.');
    return { circuit: track.id, evolved: { A5: evolvedUnits('A5'), A4: evolvedUnits('A4') }, baselines: { A1: baseline('A1'), A7: baseline('A7'), A2: baseline('A2'), A3: a3[0]! } };
  });
  return plain({
    ...analyseE6({ circuits, manifestHash: e6ManifestHash(manifest) }),
    label: manifest.label,
    e5: manifest.e5,
    evidence: manifest.label === 'mechanics' ? 'MECHANICS ONLY: a check that the machinery runs on a synthetic held-out registry. Not study evidence, whatever the numbers say.' : E6_STATUS,
  });
}
