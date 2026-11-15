// The committed P5-02 E5 manifest (plan step 5, docs/experiments/p5-02-e5-protocol.md). It is rebuilt here from the code's own resolvers and
// must match exactly. PARSING ONLY: no E5 evaluation is ever run, no held-out circuit is evaluated, no ledger is created, and nothing here
// invokes `npm run e5 run-held-out` (at the frozen commit, in a clean worktree, with a go-ahead, that would take the one look).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { BRAKE_USAGE_THRESHOLD } from '../../src/training/e4Agents';
import { c1Training } from '../../src/training/e4Study';
import { E5_BOOTSTRAP, E5_DECISION_RULE, E5_ENDPOINTS, E5_MANIFEST_FORMAT, E5_SPENT_CIRCUITS, E5_STARTS, e5ManifestHash, e5PairPins, parseE5Manifest } from '../../src/training/e5Study';
import { manifestEpochOf, manifestRecord } from '../../src/training/experiment';
import { E4_SEEDS, METRIC, StudyManifestError } from '../../src/training/study';
import { BUILT_IN_TRACK_SPLITS, tracksIn } from '../../src/training/trackSplits';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ROOT = join(__dirname, '../..');
const FROZEN_REVISION = '56d58e29260fb34994949f1d1ebdc3a312a6325f';
const MANIFEST_HASH = 'sha256:689aead26e69d6f770481e7e0d1b6f12bc2832f578c3902f11bd452eb0f0c8b6';
const FILE_SHA256 = 'e7a39f6d1a6f8290868c731d463daa87664c9b8f4d712d0bf9b7314161155b45';
const E4_MANIFEST_HASH = 'sha256:6abd4cb7d43661998169b43aad3f0632568fc3ab84d82358e8d5b6973ec950b0';
const EPOCH_4_HASH = 'sha256:681d603918e4db06b4c8434f9893275ae50477dd2c7735dc67a86be3dc4bfbc5';
const MANIFEST_PATH = join(ROOT, 'experiments/manifests/p5-02-e5.json');
const PROTOCOL_PATH = join(ROOT, 'docs/experiments/p5-02-e5-protocol.md');
const FRESH = ['hairpin-run', 'sweep-hook', 'hook-chicane'];
const load = (): Json => JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Json;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const e4Root = join(ROOT, 'experiments');
const e4Manifest = JSON.parse(readFileSync(join(e4Root, 'manifests', 'p2-09-e4.json'), 'utf8')) as unknown;
const e4Records = E4_SEEDS.map((s) => JSON.parse(gunzipSync(readFileSync(join(e4Root, 'results', 'p2-09', 'e4', `seed-${s}.json.gz`))).toString('utf8')) as unknown);
const e4Engine = ((e4Records[0] as Json).engine) as { name: string; version: string; v8: string };
const pins = e5PairPins(e4Manifest, e4Records, e4Engine);

const expected = (): Json => ({
  format: E5_MANIFEST_FORMAT,
  version: 1,
  id: 'p5-02-e5',
  label: 'confirmatory',
  description: load().description,
  e4: { manifestHash: pins.e4ManifestHash },
  pairs: pins.pairs,
  configuration: { generations: 100, training: c1Training() },
  tracks: {
    heldOut: tracksIn('held-out').map((t) => ({ id: t.id, contentHash: t.contentHash })),
    splitManifestHash: manifestRecord().hash,
  },
  analysis: { descriptiveMetric: METRIC, starts: [...E5_STARTS], endpoints: { ...E5_ENDPOINTS }, bootstrap: { ...E5_BOOTSTRAP }, decisionRule: E5_DECISION_RULE, brakeUsageThreshold: BRAKE_USAGE_THRESHOLD },
  authorisation: 'issue-34#issuecomment-6886405758',
  code: { revision: FROZEN_REVISION },
});

describe('the committed E5 manifest', () => {
  it('is exactly the preregistered study and a valid confirmatory manifest, with its hashes pinned', () => {
    const manifest = load();
    expect(manifest).toEqual(expected());
    expect(parseE5Manifest(manifest)).toEqual(manifest);
    expect(e5ManifestHash(parseE5Manifest(manifest))).toBe(MANIFEST_HASH);
    expect(createHash('sha256').update(readFileSync(MANIFEST_PATH)).digest('hex')).toBe(FILE_SHA256);
    expect(readFileSync(MANIFEST_PATH, 'utf8').endsWith('\n')).toBe(true);
  });
  it('applies the plan: the ten E4 pairs 2001-2010 pinned by identity, C1, the three fresh circuits, the five starts, the predeclared endpoints and the frozen commit', () => {
    const m = load();
    expect(m.label).toBe('confirmatory');
    expect(m.pairs.map((p: Json) => p.seed)).toEqual([...E4_SEEDS]);
    expect(m.e4.manifestHash).toBe(E4_MANIFEST_HASH);
    expect(new Set(m.pairs.flatMap((p: Json) => [p.a4, p.a5])).size).toBe(20); // twenty distinct frozen models
    expect(m.configuration.generations).toBe(100);
    expect(m.configuration.training.populationSize).toBe(50);
    expect(m.analysis.starts).toEqual([0, 1, 2, 3, 4]);
    expect(m.analysis.endpoints).toEqual({ collisionDelta: 0.2, lapTimeDeltaSeconds: 1, minEligiblePairs: 6 });
    expect(m.analysis.bootstrap).toEqual({ resamples: 10000, seed: 20261114, level: 0.95, method: 'percentile-nearest-rank-v1' });
    expect(m.analysis.decisionRule).toBe('p5-02-e5-decision-v2');
    expect(m.analysis.brakeUsageThreshold).toBe(0.05);
    expect(m.code.revision).toBe(FROZEN_REVISION);
    expect(m.authorisation).toBe('issue-34#issuecomment-6886405758');
  });
  it('lists exactly the three fresh circuits, each registered held-out with P5-02 provenance, none spent, none the training or validation circuit', () => {
    const held = load().tracks.heldOut.map((h: Json) => h.id) as string[];
    expect(held).toEqual(FRESH);
    for (const id of held) {
      const entry = BUILT_IN_TRACK_SPLITS.tracks.find((t) => t.id === id)!;
      expect(entry.split).toBe('held-out');
      expect(entry.provenance?.introducedBy.startsWith('P5-02')).toBe(true);
      expect(entry.provenance?.designedBeforeAnyEvaluation).toBe(true);
      expect(E5_SPENT_CIRCUITS).not.toContain(id);
    }
  });
  it('names the split epoch it was written against (epoch 4, the fresh circuits), pinned as a literal', () => {
    expect(load().tracks.splitManifestHash).toBe(EPOCH_4_HASH);
    expect(manifestEpochOf(load().tracks.splitManifestHash)).toBe(4);
    expect(manifestRecord().hash).toBe(EPOCH_4_HASH);
  });
  it.each<[string, (m: Json) => void]>([
    ['a mechanics label on a manifest naming real held-out circuits', (m) => { m.label = 'mechanics'; }],
    ['no frozen commit', (m) => { m.code.revision = null; }],
    ['another meaningful collision difference', (m) => { m.analysis.endpoints.collisionDelta = 0.1; }],
    ['another meaningful lap-time difference', (m) => { m.analysis.endpoints.lapTimeDeltaSeconds = 2; }],
    ['another eligibility minimum', (m) => { m.analysis.endpoints.minEligiblePairs = 3; }],
    ['another bootstrap seed', (m) => { m.analysis.bootstrap.seed = 1; }],
    ['another decision rule', (m) => { m.analysis.decisionRule = 'other'; }],
    ['a pair pinned to another model', (m) => { m.pairs[0].a5 = m.pairs[0].a4.replace(/.$/, '0'); }],
    ['a missing pair', (m) => { m.pairs.pop(); }],
    ['a spent circuit as a held-out circuit', (m) => { m.tracks.heldOut[0] = { id: 'hairpin-chicane', contentHash: BUILT_IN_TRACK_SPLITS.tracks.find((t) => t.id === 'hairpin-chicane')!.contentHash }; }],
    ['a validation circuit as a held-out circuit', (m) => { m.tracks.heldOut[0] = { id: 'rounded-rectangle', contentHash: BUILT_IN_TRACK_SPLITS.tracks.find((t) => t.id === 'rounded-rectangle')!.contentHash }; }],
    ['a held-out circuit with another content hash', (m) => { m.tracks.heldOut[0].contentHash = m.tracks.heldOut[1].contentHash; }],
    ['another split-manifest hash', (m) => { m.tracks.splitManifestHash = `sha256:${'0'.repeat(64)}`; }],
    ['another training configuration', (m) => { m.configuration.generations = 50; }],
    ['an unknown field', (m) => { m.extra = 1; }],
  ])('the parser refuses %s', (_name, change) => {
    const bad = clone(load());
    change(bad);
    expect(() => parseE5Manifest(bad)).toThrow(StudyManifestError);
  });
});

describe('the protocol document quotes the same frozen values', () => {
  const doc = readFileSync(PROTOCOL_PATH, 'utf8');
  it.each([
    ['the manifest hash', MANIFEST_HASH],
    ['the manifest file hash', FILE_SHA256],
    ['the frozen commit', FROZEN_REVISION],
    ['the E4 manifest hash', E4_MANIFEST_HASH],
    ['the epoch 4 split-manifest hash', EPOCH_4_HASH],
    ['the manifest path', 'experiments/manifests/p5-02-e5.json'],
    ['the authorisation', 'issue-34#issuecomment-6886405758'],
    ['the decision rule', 'p5-02-e5-decision-v2'],
    ['the bootstrap seed', '20261114'],
    ['the engine', 'Node 24.22.1'],
  ])('contains %s', (_name, value) => {
    expect(doc).toContain(value);
  });
  it('names the three circuits, the two endpoint thresholds and the explicit-go-ahead gate, and says the opening is not started', () => {
    for (const id of FRESH) expect(doc).toContain(id);
    expect(doc).toContain('delta_c = 0.20');
    expect(doc).toContain('delta_t = 1.0');
    expect(doc).toMatch(/explicit go-ahead naming the .?manifestHash/);
    expect(doc).toMatch(/step 6, not started/);
    expect(doc).toMatch(/A failure at or after the opening is never answered by opening again/);
  });
  it('states that no model has been evaluated and that the manifest claims nothing about learning or braking', () => {
    expect(doc).toContain('No model has been evaluated on any fresh circuit');
    expect(load().description).toContain('claims nothing about learning or braking'); // the manifest says it where it is frozen
  });
});
