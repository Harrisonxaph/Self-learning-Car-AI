// P5-02 step 2b-1 (docs/plans/p5-02-fresh-circuits-plan.md sections 3.1 and 3.4): the epoch history. Each split-manifest epoch keeps its own
// split labels, so a circuit reclassified in a later epoch (the three E3 circuits becoming validation in step 2b-2) does not change any
// earlier epoch's recorded hash and no recorded result is refused; `splitsAsOf` gives the registry as it was in an epoch; E3 parses,
// verifies and replays through the registry of the epoch its manifest names.
// NO DATA CHANGE: the built-in registry's circuits and labels are untouched here. The reclassification is only SIMULATED with synthetic
// registries (a scaled oval relabelled), and the real committed E3 records are only READ and recomputed (no held-out circuit is
// evaluated, no model is trained).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import manifestData from '../../src/data/tracks/index.json';
import hairpinChicane from '../../src/data/tracks/hairpin-chicane.json';
import kidneyLoop from '../../src/data/tracks/kidney-loop.json';
import longSweepers from '../../src/data/tracks/long-sweepers.json';
import roundedRectangle from '../../src/data/tracks/rounded-rectangle.json';
import sSweepers from '../../src/data/tracks/s-sweepers.json';
import silverstone from '../../src/data/tracks/silverstone.json';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import technicalNarrow from '../../src/data/tracks/technical-narrow.json';
import { loadTrack } from '../../src/sim/track';
import { resolveBaselineConfig } from '../../src/training/baselines';
import { canonicalJson, manifestEpochOf, manifestRecord } from '../../src/training/experiment';
import { E4_DELTA } from '../../src/training/e4Study';
import {
  analyseE3,
  e3AnalysisJson,
  e3HeldOutProtocol,
  E3_BOOTSTRAP,
  E3_DECISION_RULE,
  E3_MANIFEST_FORMAT,
  e3RegistryFor,
  parseE3HeldOutRecord,
  parseE3Manifest,
  parseE3RulesRecord,
  parseE3SeedRecord,
  parseE3SeedRecords,
  replayE3HeldOutRecord,
  replayE3RulesRecord,
  replayE3SeedRecord,
  ruleIds,
  runE3HeldOut,
  runE3Rules,
  runE3Seed,
} from '../../src/training/e3Study';
import { createHeldOutGate, createMemoryLedger, freezeNoBrakeNetworkAgent } from '../../src/training/heldOutAccess';
import { METRIC, StudyManifestError, type StudyContext } from '../../src/training/study';
import {
  assertEvaluationTrack,
  assertTrainingTrack,
  BUILT_IN_TRACK_SPLITS,
  epochIds,
  epochSplits,
  heldOutTrack,
  isBuiltInRegistry,
  LATEST_SPLIT_EPOCH,
  loadTrackSplits,
  SPLIT_EPOCHS,
  splitsAsOf,
  trackContentHash,
  TrackLeakageError,
  TrackSplitError,
  type Split,
  type SplitEpoch,
} from '../../src/training/trackSplits';
import { PARAMETER_COUNT } from '../../src/ai/network';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// The three recorded epoch hashes, as LITERALS computed before any history change (E4 and the P2-08 records name epoch 1, E3 names epoch 2).
const EPOCH_HASH = [
  'sha256:3cb594e2cdf4ed07728a8a50a54d558fc20f3d8e01628acd376eb9ff940772c3',
  'sha256:4a56521e1e89b6cf58409181a7c6d3bcb1675dff8076a9df87aa675b9e2df91e',
  'sha256:297e0b586694b37ff61faebeeb17ca7044401b18ad51142d96e92b9cb68d1bbd',
] as const;
const SPENT = ['hairpin-chicane', 'long-sweepers', 'technical-narrow'] as const;

// The frozen labels of every epoch, written out. Epochs 1 to 3 may NEVER change; a later epoch may relabel a circuit.
const FROZEN_LABELS: Record<number, Record<string, Split>> = {
  1: { 'stadium-oval': 'training', 'rounded-rectangle': 'validation', 'hairpin-chicane': 'held-out' },
  2: {
    'stadium-oval': 'training', 'rounded-rectangle': 'validation', 'hairpin-chicane': 'held-out', 'kidney-loop': 'training', 's-sweepers': 'validation',
    'long-sweepers': 'held-out', 'technical-narrow': 'held-out',
  },
  3: {
    'stadium-oval': 'training', 'rounded-rectangle': 'validation', 'hairpin-chicane': 'held-out', 'kidney-loop': 'training', 's-sweepers': 'validation',
    'long-sweepers': 'held-out', 'technical-narrow': 'held-out', silverstone: 'training',
  },
};

describe('the built-in epochs keep their own split labels (no data change)', () => {
  it('records the three epoch hashes as literals, recomputed from today\'s data with each epoch\'s own labels', () => {
    EPOCH_HASH.forEach((hash, i) => expect(manifestRecord(undefined, i + 1).hash).toBe(hash));
    expect(manifestRecord().hash).toBe(EPOCH_HASH[2]);
    expect(manifestEpochOf(EPOCH_HASH[0])).toBe(1);
    expect(manifestEpochOf(EPOCH_HASH[1])).toBe(2);
    expect(manifestEpochOf(EPOCH_HASH[2])).toBe(3);
  });
  it('freezes the labels of epochs 1 to 3 as written out, and the latest epoch\'s labels are the registry\'s current ones', () => {
    for (const epoch of [1, 2, 3]) expect({ ...epochSplits(epoch) }).toEqual(FROZEN_LABELS[epoch]);
    expect([...epochIds(3)]).toEqual(Object.keys(FROZEN_LABELS[3]!));
    const latest = SPLIT_EPOCHS[SPLIT_EPOCHS.length - 1]!;
    for (const id of latest.ids) expect(BUILT_IN_TRACK_SPLITS.tracks.find((t) => t.id === id)!.split).toBe(latest.splits[id]);
    expect(BUILT_IN_TRACK_SPLITS.epochs).toBe(SPLIT_EPOCHS);
  });
  it('the registry as of the latest epoch is the registry itself; as of epoch 2 it lists epoch 2\'s circuits with epoch 2\'s labels', () => {
    expect(splitsAsOf(BUILT_IN_TRACK_SPLITS, LATEST_SPLIT_EPOCH)).toBe(BUILT_IN_TRACK_SPLITS);
    const view = splitsAsOf(BUILT_IN_TRACK_SPLITS, 2);
    expect(view.tracks.map((t) => [t.id, t.split])).toEqual(Object.entries(FROZEN_LABELS[2]!));
    expect(splitsAsOf(BUILT_IN_TRACK_SPLITS, 2)).toBe(view); // cached: one view per epoch
    expect(view.tracks.find((t) => t.id === 'long-sweepers')!.track).toBe(BUILT_IN_TRACK_SPLITS.tracks.find((t) => t.id === 'long-sweepers')!.track);
  });
  it('the lineage test compares epochs by value, never by property order, and a changed label, id or introducer is not built-in', () => {
    const reorder = (e: SplitEpoch): SplitEpoch =>
      ({ splits: Object.fromEntries([...Object.entries(e.splits)].reverse()), ids: e.ids, introducedBy: e.introducedBy, epoch: e.epoch }) as SplitEpoch;
    expect(isBuiltInRegistry(loadTrackSplits(manifestData, FILES, SPLIT_EPOCHS.map(reorder)))).toBe(true);
    const relabelled = SPLIT_EPOCHS.map((e) => (e.epoch === 2 ? { ...e, splits: { ...e.splits, 'long-sweepers': 'validation' as Split } } : e));
    expect(isBuiltInRegistry(loadTrackSplits(manifestData, FILES, relabelled.map((e, i) => (i === 2 ? { ...e, splits: { ...e.splits, 'long-sweepers': 'held-out' as Split } } : e))))).toBe(false);
    expect(isBuiltInRegistry(loadTrackSplits(manifestData, FILES, SPLIT_EPOCHS.map((e) => (e.epoch === 1 ? { ...e, introducedBy: 'other' } : e))))).toBe(false);
  });
  it('the built-in rules apply to the built-in registry and its later versions, never to a synthetic registry', () => {
    expect(isBuiltInRegistry(BUILT_IN_TRACK_SPLITS)).toBe(true);
    expect(isBuiltInRegistry(loadTrackSplits(manifestData, FILES))).toBe(false); // no epoch history
    expect(isBuiltInRegistry(loadTrackSplits(manifestData, FILES, SPLIT_EPOCHS))).toBe(true); // the same history
  });
  it('refuses an unknown epoch and a registry without an epoch history', () => {
    expect(() => splitsAsOf(BUILT_IN_TRACK_SPLITS, 99)).toThrow(TrackSplitError);
    expect(() => epochSplits(99)).toThrow(/no split-manifest epoch 99/);
    const plain = loadTrackSplits(manifestData, FILES);
    expect(plain.epochs).toBeUndefined();
    expect(() => splitsAsOf(plain, 1)).toThrow(/only a registry with an epoch history/);
    expect(() => manifestRecord(plain, 1)).toThrow(/only a registry with an epoch history/);
  });
});

const FILES = {
  'stadium-oval.json': stadiumOval,
  'rounded-rectangle.json': roundedRectangle,
  'hairpin-chicane.json': hairpinChicane,
  'kidney-loop.json': kidneyLoop,
  'long-sweepers.json': longSweepers,
  's-sweepers.json': sSweepers,
  'technical-narrow.json': technicalNarrow,
  'silverstone.json': silverstone,
};

describe('an epoch history must be consistent with its registry', () => {
  const ok = (epochs: readonly SplitEpoch[]) => loadTrackSplits(manifestData, FILES, epochs);
  const epoch = (n: number, labels: [string, Split][]): SplitEpoch => ({ epoch: n, introducedBy: 'test', ids: labels.map(([id]) => id), splits: Object.fromEntries(labels) });
  const all = Object.entries(FROZEN_LABELS[3]!) as [string, Split][];
  it('accepts the built-in history', () => expect(() => ok(SPLIT_EPOCHS)).not.toThrow());
  it.each<[string, SplitEpoch[], RegExp]>([
    ['no epoch', [], /at least one epoch/],
    ['an epoch out of order', [epoch(2, all)], /out of order/],
    ['a circuit listed twice', [epoch(1, [...all, ['stadium-oval', 'training']])], /more than once/],
    ['an unregistered circuit', [epoch(1, [...all, ['nowhere', 'training']])], /not registered/],
    ['a circuit with no label', [{ ...epoch(1, all), splits: { 'stadium-oval': 'training' } }], /labels circuits it does not list|no valid split label/],
    ['a circuit with an unknown label', [epoch(1, all.map(([id, s]) => (id === 'silverstone' ? [id, 'nonsense' as Split] : [id, s])))], /no valid split label/],
    ['a later epoch that is not an append-only extension', [epoch(1, all.slice(0, 3)), epoch(2, [all[1]!, all[0]!, ...all.slice(2)])], /append-only extension/],
    ['a registered circuit that the latest epoch omits', [epoch(1, all.slice(0, 7))], /every registered circuit in manifest order/],
    ['a latest epoch that lists the circuits in another order', [epoch(1, [all[1]!, all[0]!, ...all.slice(2)])], /every registered circuit in manifest order/],
    ['a latest epoch whose labels differ from the registry\'s current ones', [epoch(1, all.map(([id, s]) => (id === 'hairpin-chicane' ? [id, 'validation' as Split] : [id, s])))], /current split is held-out/],
  ])('refuses %s', (_name, epochs, pattern) => {
    expect(() => ok(epochs)).toThrow(pattern);
    expect(() => ok(epochs)).toThrow(TrackSplitError);
  });
});

// ---- A SIMULATED future registry: the three spent circuits relabelled validation, a synthetic fresh circuit held-out (epoch 4) ----
const scale = (p: { x: number; y: number }, k: number) => ({ x: p.x * k, y: p.y * k });
const oval = stadiumOval as unknown as { outer: { x: number; y: number }[]; inner: { x: number; y: number }[]; start: { position: { x: number; y: number }; heading: number }; gates: { a: { x: number; y: number }; b: { x: number; y: number } }[] };
const scaled = (id: string, k: number) => ({
  ...stadiumOval,
  id,
  name: id,
  outer: oval.outer.map((p) => scale(p, k)),
  inner: oval.inner.map((p) => scale(p, k)),
  start: { position: scale(oval.start.position, k), heading: oval.start.heading },
  gates: oval.gates.map((g) => ({ a: scale(g.a, k), b: scale(g.b, k) })),
});
const fresh = scaled('synthetic-fresh', 1.6);

describe('a simulated epoch 4 (the three spent circuits become validation) changes no earlier epoch and no enforcement of new work', () => {
  const relabel = (m: Json, labels: Record<string, string>): Json => ({ ...m, tracks: m.tracks.map((t: Json) => (labels[t.id] ? { ...t, split: labels[t.id] } : t)) });
  const futureManifest = (() => {
    const m = relabel(clone(manifestData), Object.fromEntries(SPENT.map((id) => [id, 'validation'])));
    m.tracks.push({ id: 'synthetic-fresh', version: '1', split: 'held-out', file: 'fresh.json', contentHash: trackContentHash(loadTrack(fresh)), description: 'simulated fresh held-out circuit' });
    return m;
  })();
  const epoch4: SplitEpoch = {
    epoch: 4,
    introducedBy: 'test (simulated P5-02 step 2b-2)',
    ids: [...epochIds(3), 'synthetic-fresh'],
    splits: { ...FROZEN_LABELS[3], ...Object.fromEntries(SPENT.map((id) => [id, 'validation'])), 'synthetic-fresh': 'held-out' } as Record<string, Split>,
  };
  const FUTURE = loadTrackSplits(futureManifest, { ...FILES, 'fresh.json': fresh }, [...SPLIT_EPOCHS, epoch4]);

  it('every earlier epoch keeps its pinned hash although the three circuits are now validation', () => {
    expect(FUTURE.tracks.find((t) => t.id === 'hairpin-chicane')!.split).toBe('validation');
    EPOCH_HASH.forEach((hash, i) => expect(manifestRecord(FUTURE, i + 1).hash).toBe(hash));
    expect(manifestRecord(FUTURE).hash).not.toBe(EPOCH_HASH[2]); // the new epoch is a different record
    const current = (manifestRecord(FUTURE).entries as unknown as { id: string; split: string }[]).filter((e) => (SPENT as readonly string[]).includes(e.id));
    expect(current.map((e) => [e.id, e.split])).toEqual(SPENT.map((id) => [id, 'validation']));
    expect(manifestEpochOf(EPOCH_HASH[0], FUTURE)).toBe(1);
    expect(manifestEpochOf(EPOCH_HASH[1], FUTURE)).toBe(2);
    expect(manifestEpochOf(manifestRecord(FUTURE).hash, FUTURE)).toBe(4);
  });
  it('the registry as of epoch 2 still has the three as held-out, as of epoch 4 as validation', () => {
    const asOf2 = splitsAsOf(FUTURE, 2);
    for (const id of SPENT) {
      expect(asOf2.tracks.find((t) => t.id === id)!.split).toBe('held-out');
      expect(splitsAsOf(FUTURE, 4).tracks.find((t) => t.id === id)!.split).toBe('validation');
    }
    expect(splitsAsOf(FUTURE, 4)).toBe(FUTURE);
  });
  it('new work uses the current labels: the spent circuits are evaluable and not held-out, the fresh one is held-out only', () => {
    for (const id of SPENT) {
      const entry = FUTURE.tracks.find((t) => t.id === id)!;
      expect(assertEvaluationTrack(entry.track, FUTURE)).toBe('validation');
      expect(() => assertTrainingTrack(entry.track, FUTURE)).toThrow(TrackLeakageError); // the trainer refuses a validation circuit
    }
    const freshEntry = FUTURE.tracks.find((t) => t.id === 'synthetic-fresh')!;
    expect(() => assertEvaluationTrack(freshEntry.track, FUTURE)).toThrow(TrackLeakageError);
    const model = freezeNoBrakeNetworkAgent(Array.from({ length: PARAMETER_COUNT }, (_, i) => Math.sin(i + 1) * 0.3), { seed: 1 });
    expect(() => heldOutTrack('hairpin-chicane', model, FUTURE)).toThrow(TrackLeakageError); // no longer a held-out circuit
    expect(heldOutTrack('synthetic-fresh', model, FUTURE)).toBe(freshEntry.track);
  });
  it('a NEW study naming epoch 4 cannot list a spent circuit as held-out, while the same circuits are still held-out in epoch 2', () => {
    // The E3 manifest names epoch 2, where they are held-out: it parses on the future registry.
    expect(parseE3Manifest(E3_COMMITTED_MANIFEST, FUTURE).id).toBe(E3_COMMITTED_MANIFEST.id);
    // A manifest naming epoch 4 and listing one of them is refused.
    const bad = clone(E3_COMMITTED_MANIFEST) as Json;
    bad.tracks.splitManifestHash = manifestRecord(FUTURE).hash;
    bad.label = 'mechanics';
    expect(() => parseE3Manifest(bad, FUTURE)).toThrow(StudyManifestError);
  });

  // ---- The REAL committed E3 results, read and recomputed only ----
  describe('the committed E3 study keeps verifying through the epoch-2 registry', () => {
    const e3Dir = join(__dirname, '..', '..', 'experiments', 'results', 'p5-01', 'e3');
    const read = (name: string): Json => JSON.parse(readFileSync(join(e3Dir, name), 'utf8')) as Json;
    const seedRecords = Array.from({ length: 10 }, (_, i) => read(`seed-${3001 + i}.json`));
    const rules = read('rules.json');
    const held = read('held-out.json');
    const recordedEngine = seedRecords[0]!.engine as { name: string; version: string; v8: string };
    it('parses the manifest, every seed, the rules and the held-out record, and recomputes the committed analysis byte for byte, on the future registry', () => {
      expect(e3RegistryFor(E3_COMMITTED_MANIFEST, FUTURE)).toBe(splitsAsOf(FUTURE, 2));
      expect(parseE3SeedRecords(E3_COMMITTED_MANIFEST, seedRecords, recordedEngine, FUTURE)).toHaveLength(10);
      parseE3RulesRecord(rules, E3_COMMITTED_MANIFEST, recordedEngine, FUTURE);
      parseE3HeldOutRecord(held, E3_COMMITTED_MANIFEST, seedRecords, recordedEngine, FUTURE);
      const committed = readFileSync(join(e3Dir, 'final', 'analysis.json'), 'utf8');
      expect(e3AnalysisJson(analyseE3(E3_COMMITTED_MANIFEST, seedRecords, rules, held, recordedEngine, FUTURE))).toBe(committed);
      // ... and exactly what today's registry gives.
      expect(e3AnalysisJson(analyseE3(E3_COMMITTED_MANIFEST, seedRecords, rules, held, recordedEngine))).toBe(committed);
    });
    it('a gate for E3\'s protocol can be built on the epoch-2 registry and NOT on the current one (so nothing re-opens E3 by accident)', () => {
      const protocol = e3HeldOutProtocol(E3_COMMITTED_MANIFEST, parseE3SeedRecords(E3_COMMITTED_MANIFEST, seedRecords, recordedEngine, FUTURE), FUTURE);
      expect(() => createHeldOutGate(protocol, createMemoryLedger(), e3RegistryFor(E3_COMMITTED_MANIFEST, FUTURE))).not.toThrow();
      expect(() => createHeldOutGate(protocol, createMemoryLedger(), FUTURE)).toThrow(TrackLeakageError);
    });
  });
});

const E3_COMMITTED_MANIFEST = JSON.parse(readFileSync(join(__dirname, '..', '..', 'experiments', 'manifests', 'p5-01-e3.json'), 'utf8')) as Json;

// ---- A full mechanics round trip on a small synthetic epoched registry: records made in epoch 1, verified and replayed after epoch 2 ----
describe('E3 mechanics records made in epoch 1 still parse, replay and analyse identically after a later epoch relabels their held-out circuit', () => {
  const heldOut = scaled('synthetic-held-out', 1.3);
  const freshTrack = scaled('synthetic-fresh-2', 1.7);
  const entries = (id: string, split: Split, file: string, track: object) => ({ id, version: '1', split, file, contentHash: trackContentHash(loadTrack(track as never)), description: id });
  const base = [
    entries('stadium-oval', 'training', 'stadium-oval.json', stadiumOval),
    entries('rounded-rectangle', 'validation', 'rounded-rectangle.json', roundedRectangle),
  ];
  const files = { 'stadium-oval.json': stadiumOval, 'rounded-rectangle.json': roundedRectangle, 'ho.json': heldOut, 'fresh.json': freshTrack };
  const epoch1: SplitEpoch = { epoch: 1, introducedBy: 'test', ids: ['stadium-oval', 'rounded-rectangle', 'synthetic-held-out'], splits: { 'stadium-oval': 'training', 'rounded-rectangle': 'validation', 'synthetic-held-out': 'held-out' } };
  const epoch2: SplitEpoch = {
    epoch: 2,
    introducedBy: 'test',
    ids: [...epoch1.ids, 'synthetic-fresh-2'],
    splits: { 'stadium-oval': 'training', 'rounded-rectangle': 'validation', 'synthetic-held-out': 'validation', 'synthetic-fresh-2': 'held-out' },
  };
  const A = loadTrackSplits({ ...manifestData, tracks: [...base, entries('synthetic-held-out', 'held-out', 'ho.json', heldOut)] }, files, [epoch1]);
  const B = loadTrackSplits(
    { ...manifestData, tracks: [...base, entries('synthetic-held-out', 'validation', 'ho.json', heldOut), entries('synthetic-fresh-2', 'held-out', 'fresh.json', freshTrack)] },
    files,
    [epoch1, epoch2],
  );
  const ENGINE = { name: 'node', version: process.version, v8: process.versions.v8 };
  const CONTEXT: StudyContext = { engine: ENGINE, source: { revision: null, dirty: null, unavailableReason: 'test fixture', appVersion: '0.0.0' }, recordedAt: '2026-11-14T00:00:00Z' };
  const training = () => {
    const { setup } = resolveBaselineConfig({ training: { populationSize: 3, eliteCount: 1, maxEpisodeSeconds: 3, stallSeconds: 1 }, generations: 2, trackId: 'stadium-oval' }, 0);
    return Object.fromEntries(Object.entries(setup.config).filter(([key]) => key !== 'seed' && key !== 'brakeEnabled'));
  };
  const manifest: Json = {
    format: E3_MANIFEST_FORMAT,
    version: 1,
    id: 'mechanics-e3-history',
    label: 'mechanics',
    description: 'Mechanics fixture for the epoch-history tests.',
    seeds: [7701, 7702],
    configuration: { generations: 2, training: training() },
    tracks: {
      training: { id: 'stadium-oval', contentHash: trackContentHash(loadTrack(stadiumOval)) },
      validation: { id: 'rounded-rectangle', contentHash: trackContentHash(loadTrack(roundedRectangle)) },
      heldOut: [{ id: 'synthetic-held-out', contentHash: trackContentHash(loadTrack(heldOut as never)) }],
      splitManifestHash: manifestRecord(A).hash,
    },
    rules: ruleIds(),
    analysis: { metric: METRIC, delta: E4_DELTA, bootstrap: { ...E3_BOOTSTRAP }, decisionRule: E3_DECISION_RULE },
    authorisation: 'issue-33#history-mechanics',
    code: { revision: null },
  };
  // Made while epoch 1 is the latest epoch (registry A).
  const seed1 = runE3Seed(manifest, 7701, CONTEXT, A);
  const seed2 = runE3Seed(manifest, 7702, CONTEXT, A);
  const rules = runE3Rules(manifest, CONTEXT, A);
  const seeds = [seed1, seed2];
  const held = runE3HeldOut(manifest, seeds, rules, createHeldOutGate(e3HeldOutProtocol(manifest, seeds, A), createMemoryLedger(), A), CONTEXT, A);
  const before = e3AnalysisJson(analyseE3(manifest, seeds, rules, held, ENGINE, A));

  it('the epoch-1 hash is the same on both registries, so the manifest names epoch 1 on B', () => {
    expect(manifestRecord(B, 1).hash).toBe(manifestRecord(A).hash);
    expect(manifestEpochOf(manifest.tracks.splitManifestHash, B)).toBe(1);
    expect(B.tracks.find((t) => t.id === 'synthetic-held-out')!.split).toBe('validation');
  });
  it('parses, replays identically (seeds, rules, held-out) and analyses byte for byte on the later registry', () => {
    expect(parseE3Manifest(manifest, B).id).toBe('mechanics-e3-history');
    expect(parseE3SeedRecord(seed1, manifest, ENGINE, B).seed).toBe(7701);
    expect(replayE3SeedRecord(seed1, manifest, ENGINE, undefined, B).identical).toBe(true);
    expect(parseE3RulesRecord(rules, manifest, ENGINE, B).format).toBe(rules.format);
    expect(replayE3RulesRecord(rules, manifest, ENGINE, undefined, B).identical).toBe(true);
    expect(parseE3HeldOutRecord(held, manifest, seeds, ENGINE, B).resultsHash).toBe(held.resultsHash);
    expect(replayE3HeldOutRecord(held, manifest, seeds, ENGINE, undefined, B)).toEqual({ identical: true, differences: [], sameSourceRevision: null });
    expect(e3AnalysisJson(analyseE3(manifest, seeds, rules, held, ENGINE, B))).toBe(before);
  });
  it('the gate default registry (B) refuses the relabelled circuit, the epoch-1 registry accepts it, and the run helper agrees', () => {
    const protocol = e3HeldOutProtocol(manifest, seeds, B);
    expect(() => createHeldOutGate(protocol, createMemoryLedger(), B)).toThrow(TrackLeakageError);
    expect(() => createHeldOutGate(protocol, createMemoryLedger(), e3RegistryFor(manifest, B))).not.toThrow();
    // A held-out run on B through the gate built for epoch 1 reproduces the record (replay's own route), through a fresh ledger.
    const again = runE3HeldOut(manifest, seeds, rules, createHeldOutGate(protocol, createMemoryLedger(), e3RegistryFor(manifest, B)), CONTEXT, B);
    expect(canonicalJson(again)).toBe(canonicalJson(held));
  });
  it('a manifest recorded in epoch 2 cannot list the relabelled circuit as held-out', () => {
    const later = clone(manifest);
    later.tracks.splitManifestHash = manifestRecord(B).hash;
    expect(() => parseE3Manifest(later, B)).toThrow(/not a registered held-out circuit/);
  });
});
