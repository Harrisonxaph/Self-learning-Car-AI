// The committed P5-04 E6 manifest (plan step 5, docs/experiments/p5-04-e6-protocol.md). It is rebuilt here from the code's own resolvers and
// must match exactly. PARSING ONLY: no E6 evaluation is ever run, no held-out circuit is evaluated, no ledger is created, and nothing here
// invokes `npm run e6 run-held-out` (at the frozen commit, in a clean worktree, with a go-ahead, that would take the one look).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { e5ManifestHash } from '../../src/training/e5Study';
import { E6_BOOTSTRAP, E6_DECISION_RULE, E6_FLOOR_SHARE, E6_MARGIN, E6_STATUS } from '../../src/training/e6Analysis';
import { E6_ACTION_SEEDS, E6_MANIFEST_FORMAT, E6_STARTS, e6BaselinePins, e6HeldOutProtocol, e6ManifestHash, loadE6Agents, parseE6Manifest } from '../../src/training/e6Study';
import { E4_SEEDS, StudyManifestError } from '../../src/training/study';
import { BUILT_IN_TRACK_SPLITS } from '../../src/training/trackSplits';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ROOT = join(__dirname, '../..');
const FROZEN_REVISION = '0d467bffbe2a4ff3a85700e152cee2c199e07bff';
const MANIFEST_HASH = 'sha256:4db9a3d9fccd98a1b970c9e3e05121b9b9e503b9bcdfad2186194dcb5335ccff';
const FILE_SHA256 = '68d13dc58218e266b732cc534d2f44d14a697fe1057c7c591147fd0349d787a7';
const E5_MANIFEST_HASH = 'sha256:689aead26e69d6f770481e7e0d1b6f12bc2832f578c3902f11bd452eb0f0c8b6';
const E5_RESULTS_HASH = 'sha256:1a5664c1ab2e3d53f0b3377cc65df69dc18d615240e182c928196512c2f9c260';
const EPOCH_4_HASH = 'sha256:681d603918e4db06b4c8434f9893275ae50477dd2c7735dc67a86be3dc4bfbc5';
const MANIFEST_PATH = join(ROOT, 'experiments/manifests/p5-04-e6.json');
const PROTOCOL_PATH = join(ROOT, 'docs/experiments/p5-04-e6-protocol.md');
const FRESH = ['hairpin-run', 'sweep-hook', 'hook-chicane'];
const load = (): Json => JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Json;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const e5Manifest = JSON.parse(readFileSync(join(ROOT, 'experiments/manifests/p5-02-e5.json'), 'utf8')) as Json;
const e5Record = JSON.parse(readFileSync(join(ROOT, 'experiments/results/p5-02/e5/held-out.json'), 'utf8')) as Json;

const expected = (): Json => ({
  format: E6_MANIFEST_FORMAT,
  version: 1,
  id: 'p5-04-e6',
  label: 'exploratory',
  description: load().description,
  e5: { manifestHash: e5ManifestHash(e5Manifest as never), resultsHash: e5Record.resultsHash },
  baselines: e6BaselinePins(E4_SEEDS, E6_ACTION_SEEDS),
  configuration: e5Manifest.configuration,
  tracks: e5Manifest.tracks,
  analysis: { starts: [...E6_STARTS], margin: E6_MARGIN, bootstrap: { ...E6_BOOTSTRAP }, decisionRule: E6_DECISION_RULE, floorShare: E6_FLOOR_SHARE, status: E6_STATUS },
  authorisation: 'issue-36#issuecomment-6899115006',
  code: { revision: FROZEN_REVISION },
});

describe('the committed E6 manifest', () => {
  it('is exactly the preregistered study and a valid exploratory manifest, with its hashes pinned', () => {
    const manifest = load();
    expect(manifest).toEqual(expected());
    expect(parseE6Manifest(manifest)).toEqual(manifest);
    expect(e6ManifestHash(parseE6Manifest(manifest))).toBe(MANIFEST_HASH);
    expect(createHash('sha256').update(readFileSync(MANIFEST_PATH)).digest('hex')).toBe(FILE_SHA256);
    expect(readFileSync(MANIFEST_PATH, 'utf8').endsWith('\n')).toBe(true);
  });
  it('applies the plan and the owner\'s choice: exploratory, the E5 pins, the ten A2 seeds, the ten action seeds, the three fresh circuits and the frozen commit', () => {
    const m = load();
    expect(m.label).toBe('exploratory');
    expect(m.e5).toEqual({ manifestHash: E5_MANIFEST_HASH, resultsHash: E5_RESULTS_HASH });
    expect(m.baselines.a2.map((p: Json) => p.seed)).toEqual([...E4_SEEDS]);
    expect(m.baselines.a1.map((p: Json) => p.seed)).toEqual([5001, 5002, 5003, 5004, 5005, 5006, 5007, 5008, 5009, 5010]);
    expect(m.baselines.a7.map((p: Json) => p.seed)).toEqual(m.baselines.a1.map((p: Json) => p.seed));
    expect(new Set([...m.baselines.a2, ...m.baselines.a1, ...m.baselines.a7].map((p: Json) => p.modelId)).size).toBe(30);
    expect(m.tracks.heldOut.map((h: Json) => h.id)).toEqual(FRESH);
    expect(m.tracks.splitManifestHash).toBe(EPOCH_4_HASH);
    expect(m.analysis.margin).toBe(0.2);
    expect(m.analysis.bootstrap).toEqual({ resamples: 10000, seed: 20261115, level: 0.95, method: 'percentile-nearest-rank-v1' });
    expect(m.analysis.decisionRule).toBe('p5-04-e6-decision-v1');
    expect(m.analysis.status).toMatch(/^Exploratory and descriptive/);
    expect(m.code.revision).toBe(FROZEN_REVISION);
    expect(m.authorisation).toBe('issue-36#issuecomment-6899115006');
    expect(m.description).toContain('not preregistered before the look');
  });
  it('re-derives every new agent from its seed and finds the pinned identity (nothing is evaluated)', () => {
    const agents = loadE6Agents(parseE6Manifest(load()));
    expect(agents).toHaveLength(31);
    expect(e6HeldOutProtocol(load()).agentIds).toHaveLength(31);
    expect(e6HeldOutProtocol(load()).protocolHash).toBe(MANIFEST_HASH);
  });
  it('lists no champion in the gate\'s protocol: A4 and A5 are read from E5, never evaluated again', () => {
    const champions = new Set(e5Record.opening.agentIds as string[]);
    for (const id of e6HeldOutProtocol(load()).agentIds) expect(champions.has(id)).toBe(false);
  });
  it('lists exactly the three fresh circuits, each registered held-out with P5-02 provenance', () => {
    for (const id of FRESH) {
      const entry = BUILT_IN_TRACK_SPLITS.tracks.find((t) => t.id === id)!;
      expect(entry.split).toBe('held-out');
      expect(entry.provenance?.introducedBy.startsWith('P5-02')).toBe(true);
    }
  });
  it.each<[string, (m: Json) => void]>([
    ['a confirmatory label', (m) => { m.label = 'confirmatory'; }],
    ['no frozen commit', (m) => { m.code.revision = null; }],
    ['another margin', (m) => { m.analysis.margin = 0.1; }],
    ['another bootstrap seed', (m) => { m.analysis.bootstrap.seed = 1; }],
    ['another decision rule', (m) => { m.analysis.decisionRule = 'other'; }],
    ['a changed status text', (m) => { m.analysis.status = 'Confirmatory.'; }],
    ['other action seeds', (m) => { m.baselines.a1[0].seed = 5999; m.baselines.a7[0].seed = 5999; }],
    ['other A2 seeds', (m) => { m.baselines.a2[0].seed = 2999; }],
    ['a spent circuit as a held-out circuit', (m) => { m.tracks.heldOut[0].id = 'hairpin-chicane'; }],
    ['another split-manifest hash', (m) => { m.tracks.splitManifestHash = `sha256:${'0'.repeat(64)}`; }],
    ['an unknown field', (m) => { m.extra = 1; }],
  ])('the parser refuses %s', (_name, change) => {
    const bad = clone(load());
    change(bad);
    expect(() => parseE6Manifest(bad)).toThrow(StudyManifestError);
  });
});

describe('the protocol document quotes the same frozen values', () => {
  const doc = readFileSync(PROTOCOL_PATH, 'utf8');
  it.each([
    ['the manifest hash', MANIFEST_HASH],
    ['the manifest file hash', FILE_SHA256],
    ['the frozen commit', FROZEN_REVISION],
    ['the E5 manifest hash', E5_MANIFEST_HASH],
    ['the E5 results hash', E5_RESULTS_HASH],
    ['the epoch 4 split-manifest hash', EPOCH_4_HASH],
    ['the manifest path', 'experiments/manifests/p5-04-e6.json'],
    ['the authorisation', 'issue-36#issuecomment-6899115006'],
    ['the decision rule', 'p5-04-e6-decision-v1'],
    ['the bootstrap seed', '20261115'],
    ['the engine', 'Node 24.22.1'],
  ])('contains %s', (_name, value) => {
    expect(doc).toContain(value);
  });
  it('names the three circuits, the exploratory status, the explicit-go-ahead gate and the failure rule', () => {
    for (const id of FRESH) expect(doc).toContain(id);
    expect(doc).toMatch(/E6 is exploratory and descriptive/);
    expect(doc).toMatch(/explicit go-ahead naming the .?manifestHash/);
    expect(doc).toMatch(/Any failure stops the study and is reported to the owner before anything resumes, including a refused or failed analysis/);
    expect(doc).toMatch(/never answered by opening again/);
  });
  it('states that nothing has been evaluated and claims nothing about learning or braking', () => {
    expect(doc).toContain('No model, random driver or rule has been evaluated for E6');
    expect(doc).toContain('E6 claims nothing about learning or braking');
    expect(load().description).toContain('claims nothing about learning or braking');
  });
});
