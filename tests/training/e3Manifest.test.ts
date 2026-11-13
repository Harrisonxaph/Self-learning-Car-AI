// The committed P5-01 E3 manifest (plan step 5, docs/experiments/p5-01-e3-protocol.md). It is rebuilt here from the code's own
// resolvers and must match exactly. Parsing only: no E3 seed (3001-3010) is ever run, no held-out circuit is evaluated, and
// nothing here invokes `npm run e3` on the real manifest (at the frozen commit, in a clean worktree, that would run the study).
// Nothing here is a study result or evidence of learning.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { c1Training, E4_DELTA } from '../../src/training/e4Study';
import { E3_BOOTSTRAP, E3_DECISION_RULE, E3_MANIFEST_FORMAT, E3_SEEDS, e3ManifestHash, parseE3Manifest, ruleIds } from '../../src/training/e3Study';
import { manifestEpochOf, manifestRecord } from '../../src/training/experiment';
import { METRIC, StudyManifestError } from '../../src/training/study';
import { BUILT_IN_TRACK_SPLITS, trackContentHash, tracksIn, trainingTrack, validationTrack } from '../../src/training/trackSplits';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ROOT = join(__dirname, '../..');
const FROZEN_REVISION = 'e82aa8bf9c5397a5dae4ebf31d5c6b59c1d7d0b8';
const MANIFEST_HASH = 'sha256:d72a73317a59f251aa86e804fe6f988340279c502a95ecd0cbf9e5d6f399c429';
const FILE_SHA256 = 'fa537fb912d869b42c7e61a52a7583c4054f28de0c08e15c075dde0d2b257753';
const MANIFEST_PATH = join(ROOT, 'experiments/manifests/p5-01-e3.json');
const load = (): Json => JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Json;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const HELD = ['hairpin-chicane', 'long-sweepers', 'technical-narrow'];

const expected = (): Json => ({
  format: E3_MANIFEST_FORMAT,
  version: 1,
  id: 'p5-01-e3',
  label: 'confirmatory',
  description: load().description,
  seeds: [...E3_SEEDS],
  configuration: { generations: 100, training: c1Training() },
  tracks: {
    training: { id: 'stadium-oval', contentHash: trackContentHash(trainingTrack('stadium-oval')) },
    validation: { id: 'rounded-rectangle', contentHash: trackContentHash(validationTrack('rounded-rectangle')) },
    heldOut: HELD.map((id) => ({ id, contentHash: tracksIn('held-out').find((t) => t.id === id)!.contentHash })),
    // The preregistered manifest was written against epoch 2 and must never change: its recorded hash is epoch 2's, not the latest epoch's.
    splitManifestHash: manifestRecord(BUILT_IN_TRACK_SPLITS, 2).hash,
  },
  rules: ruleIds(),
  analysis: { metric: METRIC, delta: 0.25, bootstrap: { ...E3_BOOTSTRAP }, decisionRule: E3_DECISION_RULE },
  authorisation: 'issue-33#issuecomment-6801667981',
  code: { revision: FROZEN_REVISION },
});

describe('the committed E3 manifest', () => {
  it('is exactly the preregistered study and a valid confirmatory manifest, with its hashes pinned', () => {
    const manifest = load();
    expect(manifest).toEqual(expected());
    expect(parseE3Manifest(manifest)).toEqual(manifest);
    expect(e3ManifestHash(parseE3Manifest(manifest))).toBe(MANIFEST_HASH);
    expect(createHash('sha256').update(readFileSync(MANIFEST_PATH)).digest('hex')).toBe(FILE_SHA256);
    expect(readFileSync(MANIFEST_PATH, 'utf8').endsWith('\n')).toBe(true);
  });
  it('applies the plan: ten seeds 3001-3010, C1 with G = 100, delta 0.25, the oval, the rounded rectangle, three held-out circuits, the frozen commit', () => {
    const m = load();
    expect(m.label).toBe('confirmatory');
    expect(m.seeds).toEqual([3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009, 3010]);
    expect(m.configuration.generations).toBe(100);
    expect(m.configuration.training.populationSize).toBe(50);
    expect(m.analysis.delta).toBe(E4_DELTA);
    expect(m.analysis.delta).toBe(0.25);
    expect(m.analysis.bootstrap).toEqual({ resamples: 10000, seed: 20261112, level: 0.95, method: 'percentile-nearest-rank-v1' });
    expect([m.tracks.training.id, m.tracks.validation.id]).toEqual(['stadium-oval', 'rounded-rectangle']);
    expect(m.tracks.heldOut.map((h: Json) => h.id)).toEqual(HELD);
    expect(m.code.revision).toBe(FROZEN_REVISION);
    expect(m.authorisation).toBe('issue-33#issuecomment-6801667981');
  });
  it('names the split epoch it was written against (the P4-04 expansion), so every listed circuit belongs to it', () => {
    expect(manifestEpochOf(load().tracks.splitManifestHash)).toBe(2);
    expect(load().tracks.splitManifestHash).toBe(manifestRecord(BUILT_IN_TRACK_SPLITS, 2).hash);
    expect(manifestRecord().hash).not.toBe(load().tracks.splitManifestHash); // later epochs exist now (P4-06), and the frozen manifest still names epoch 2
  });
  it('the held-out circuits are registered as held-out and the training and validation circuits are not among them', () => {
    const held = new Set<string>(load().tracks.heldOut.map((h: Json) => h.id));
    for (const id of held) expect(BUILT_IN_TRACK_SPLITS.tracks.find((t) => t.id === id)!.split).toBe('held-out');
    expect(held.has(load().tracks.training.id)).toBe(false);
    expect(held.has(load().tracks.validation.id)).toBe(false);
  });
  it.each<[string, (m: Json) => void]>([
    ['another seed block', (m) => { m.seeds = [3001, 3002]; }],
    ['a mechanics label on a manifest naming a held-out circuit', (m) => { m.label = 'mechanics'; }],
    ['no frozen commit', (m) => { m.code.revision = null; }],
    ['another delta', (m) => { m.analysis.delta = 0.1; }],
    ['another bootstrap seed', (m) => { m.analysis.bootstrap.seed = 1; }],
    ['a validation circuit listed as held-out', (m) => { m.tracks.heldOut[0] = { id: 's-sweepers', contentHash: m.tracks.heldOut[0].contentHash }; }],
    ['no authorisation', (m) => { m.authorisation = null; }],
    ['another rule identity', (m) => { m.rules.A3 = `sha256:${'0'.repeat(64)}`; }],
    ['the pre-expansion manifest hash with a circuit that postdates it', (m) => { m.tracks.splitManifestHash = manifestRecord(BUILT_IN_TRACK_SPLITS, 1).hash; }],
  ])('refuses a copy with %s', (_name, change) => {
    const m = clone(load());
    change(m);
    expect(() => parseE3Manifest(m)).toThrow(StudyManifestError);
  });
  it('a manifest with one held-out circuit removed is a valid but DIFFERENT study (another hash), so the opening is bound to this list', () => {
    const m = clone(load());
    m.tracks.heldOut.pop();
    expect(e3ManifestHash(parseE3Manifest(m))).not.toBe(MANIFEST_HASH);
  });
  it('the protocol document records the same frozen commit and hashes', () => {
    const doc = readFileSync(join(ROOT, 'docs/experiments/p5-01-e3-protocol.md'), 'utf8');
    for (const value of [FROZEN_REVISION, MANIFEST_HASH, FILE_SHA256, 'experiments/manifests/p5-01-e3.json', ...HELD]) expect(doc, value).toContain(value);
  });
});
