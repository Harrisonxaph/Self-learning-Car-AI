// P5-04 step 3b: the E6 study kind (src/training/e6Study.ts): manifest, the evolved cohorts read from E5's record, the once-only held-out
// record of the NEW agents (A2, A1, A7, A3), strict parsing, replay and the analysis wiring. Tiny E4/E5 MECHANICS fixtures (seeds 76xx and
// 77xx) and a SYNTHETIC held-out registry: no real held-out circuit is evaluated and nothing here is a study result. The real committed E4
// and E5 records are only READ, to show the evolved cohorts and the pins can be built from them.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import manifestData from '../../src/data/tracks/index.json';
import roundedRectangle from '../../src/data/tracks/rounded-rectangle.json';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { BRAKE_USAGE_THRESHOLD } from '../../src/training/e4Agents';
import { E4_BOOTSTRAP, E4_DECISION_RULE, E4_DELTA, E4_MANIFEST_FORMAT, runE4Seed, type E4Manifest } from '../../src/training/e4Study';
import { resolveBaselineConfig } from '../../src/training/baselines';
import { manifestRecord } from '../../src/training/experiment';
import { E5_BOOTSTRAP, E5_DECISION_RULE, E5_ENDPOINTS, E5_HELDOUT_FORMAT, E5_MANIFEST_FORMAT, E5_STARTS, e5HeldOutProtocol, e5ManifestHash, e5PairPins, loadE5Pairs, runE5HeldOut } from '../../src/training/e5Study';
import {
  analyseE6Records,
  E6_ACTION_SEEDS,
  E6_HELDOUT_FORMAT,
  E6_MANIFEST_FORMAT,
  E6_STARTS,
  e6BaselinePins,
  e6HeldOutProtocol,
  e6LedgerFromRecords,
  e6ManifestHash,
  loadE6Agents,
  loadE6Evolved,
  parseE6HeldOutRecord,
  parseE6Manifest,
  replayE6HeldOutRecord,
  runE6HeldOut,
  untrainedRepresentative,
} from '../../src/training/e6Study';
import { E6_BOOTSTRAP, E6_DECISION_RULE, E6_FLOOR_SHARE, E6_MARGIN, E6_STATUS } from '../../src/training/e6Analysis';
import { createHeldOutGate, createMemoryLedger, HeldOutAccessError } from '../../src/training/heldOutAccess';
import { loadTrackSplits, trackContentHash } from '../../src/training/trackSplits';
import { currentStreams, E4_SEEDS, hashOf, METRIC, StudyCompatibilityError, StudyManifestError, StudyRecordError, trackReferences, WILCOXON, type StudyContext } from '../../src/training/study';
import { loadTrack } from '../../src/sim/track';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const rehash = (record: Json): Json => ({ ...record, resultsHash: hashOf({ opening: record.opening, evaluations: record.evaluations }) });

// ---- A synthetic registry: the oval (training), the rounded rectangle (validation), a scaled oval (held-out) ----
const scale = (p: { x: number; y: number }, k: number) => ({ x: p.x * k, y: p.y * k });
const t = stadiumOval as unknown as { outer: { x: number; y: number }[]; inner: { x: number; y: number }[]; start: { position: { x: number; y: number }; heading: number }; gates: { a: { x: number; y: number }; b: { x: number; y: number } }[] };
const scaledOval = {
  ...stadiumOval,
  id: 'synthetic-held-out',
  name: 'Synthetic held-out (scaled oval)',
  outer: t.outer.map((p) => scale(p, 1.3)),
  inner: t.inner.map((p) => scale(p, 1.3)),
  start: { position: scale(t.start.position, 1.3), heading: t.start.heading },
  gates: t.gates.map((g) => ({ a: scale(g.a, 1.3), b: scale(g.b, 1.3) })),
};
const SPLITS = loadTrackSplits(
  {
    ...manifestData,
    tracks: [
      { id: 'stadium-oval', version: '1', split: 'training', file: 'stadium-oval.json', contentHash: trackContentHash(loadTrack(stadiumOval)), description: 'training' },
      { id: 'rounded-rectangle', version: '1', split: 'validation', file: 'rounded-rectangle.json', contentHash: trackContentHash(loadTrack(roundedRectangle)), description: 'validation' },
      { id: 'synthetic-held-out', version: '1', split: 'held-out', file: 'synthetic.json', contentHash: trackContentHash(loadTrack(scaledOval)), description: 'held-out', provenance: { introducedBy: 'P5-02 step 2b (test fixture)', designedBeforeAnyEvaluation: true, designCriteria: 'test fixture' } },
    ],
  },
  { 'stadium-oval.json': stadiumOval, 'rounded-rectangle.json': roundedRectangle, 'synthetic.json': scaledOval },
);
const HELD = 'synthetic-held-out';

// ---- Tiny E4 mechanics records, an E5 mechanics manifest and its held-out record (the evolved cohorts E6 reads) ----
const P = 3;
const G = 2;
const SMALL = { populationSize: P, eliteCount: 1, maxEpisodeSeconds: 3, stallSeconds: 1 };
const training = () => {
  const { setup } = resolveBaselineConfig({ training: SMALL, generations: G, trackId: 'stadium-oval' }, 0);
  return Object.fromEntries(Object.entries(setup.config).filter(([key]) => key !== 'seed' && key !== 'brakeEnabled'));
};
const E4_MANIFEST: E4Manifest = {
  format: E4_MANIFEST_FORMAT,
  version: 1,
  id: 'mechanics-e4-for-e6',
  label: 'mechanics',
  description: 'Tiny E4 mechanics fixture the E6 tests read.',
  agents: ['A4', 'A5'],
  brake: { A4: false, A5: true },
  seeds: [7601, 7602],
  configuration: { generations: G, training: training() as E4Manifest['configuration']['training'] },
  streams: currentStreams(),
  tracks: trackReferences('stadium-oval', 'rounded-rectangle'),
  metric: METRIC,
  analysis: { delta: E4_DELTA, bootstrap: { ...E4_BOOTSTRAP }, wilcoxon: WILCOXON, decisionRule: E4_DECISION_RULE, brakeUsageThreshold: BRAKE_USAGE_THRESHOLD },
  code: { revision: null },
};
const ENGINE = { name: 'node', version: process.version, v8: process.versions.v8 };
const CONTEXT: StudyContext = { engine: ENGINE, source: { revision: null, dirty: null, unavailableReason: 'test fixture', appVersion: '0.0.0' }, recordedAt: '2026-11-15T00:00:00Z' };
const E4_RECORDS = [runE4Seed(E4_MANIFEST, 7601, CONTEXT), runE4Seed(E4_MANIFEST, 7602, CONTEXT)];
const PINS = e5PairPins(E4_MANIFEST, E4_RECORDS, ENGINE);
const E5_MANIFEST = (): Json => ({
  format: E5_MANIFEST_FORMAT,
  version: 1,
  id: 'mechanics-e5-for-e6',
  label: 'mechanics',
  description: 'Tiny E5 mechanics fixture the E6 tests read.',
  e4: { manifestHash: PINS.e4ManifestHash },
  pairs: clone(PINS.pairs),
  configuration: clone(E4_MANIFEST.configuration),
  tracks: { heldOut: [{ id: HELD, contentHash: trackContentHash(loadTrack(scaledOval)) }], splitManifestHash: manifestRecord(SPLITS).hash },
  analysis: { descriptiveMetric: METRIC, starts: [...E5_STARTS], endpoints: { ...E5_ENDPOINTS }, bootstrap: { ...E5_BOOTSTRAP }, decisionRule: E5_DECISION_RULE, brakeUsageThreshold: BRAKE_USAGE_THRESHOLD },
  authorisation: 'issue-34#mechanics',
  code: { revision: null },
});
const e5Manifest = E5_MANIFEST();
const e5Pairs = loadE5Pairs(e5Manifest, E4_MANIFEST, E4_RECORDS, ENGINE, SPLITS);
const E5_RECORD = runE5HeldOut(e5Manifest, E4_MANIFEST, E4_RECORDS, createHeldOutGate(e5HeldOutProtocol(e5Manifest, e5Pairs, SPLITS), createMemoryLedger(), SPLITS), CONTEXT, SPLITS);

// ---- The E6 mechanics manifest ----
const ACTION = [7701, 7702];
const MANIFEST = (): Json => ({
  format: E6_MANIFEST_FORMAT,
  version: 1,
  id: 'mechanics-e6',
  label: 'mechanics',
  description: 'Tiny mechanics fixture for the E6 tests.',
  e5: { manifestHash: e5ManifestHash(e5Manifest as never), resultsHash: E5_RECORD.resultsHash },
  baselines: e6BaselinePins([7601, 7602], ACTION),
  configuration: clone(E4_MANIFEST.configuration),
  tracks: clone(e5Manifest.tracks),
  analysis: { starts: [...E6_STARTS], margin: E6_MARGIN, bootstrap: { ...E6_BOOTSTRAP }, decisionRule: E6_DECISION_RULE, floorShare: E6_FLOOR_SHARE, status: E6_STATUS },
  authorisation: 'issue-36#mechanics',
  code: { revision: null },
});
const manifest = MANIFEST();
const evolved = loadE6Evolved(manifest, e5Manifest, E5_RECORD, E4_MANIFEST, E4_RECORDS, ENGINE, SPLITS);
const newGate = (ledger = createMemoryLedger()) => createHeldOutGate(e6HeldOutProtocol(manifest, SPLITS), ledger, SPLITS);
const ledger = createMemoryLedger();
const held = runE6HeldOut(manifest, evolved, newGate(ledger), CONTEXT, SPLITS);
const parseHeld = (record: unknown, m: unknown = manifest) => parseE6HeldOutRecord(record, m, ENGINE, SPLITS);

describe('the pins are derived, never chosen by performance', () => {
  it('A2 is the first genome of the seed\'s generation 0, with the brake active, and differs by seed', () => {
    const a = untrainedRepresentative(7601);
    expect(a.provenance).toMatchObject({ agent: 'A2', trainingSeed: 7601, genomeIndex: 0, brakeEnabled: true });
    expect(untrainedRepresentative(7601).id).toBe(a.id);
    expect(untrainedRepresentative(7602).id).not.toBe(a.id);
  });
  it('the agents are A2 by training seed, A1 and A7 by action seed, then A3, in that order, re-derived from the seeds', () => {
    const agents = loadE6Agents(manifest as never);
    expect(agents.map((x) => `${x.agent}:${x.seed}`)).toEqual(['A2:7601', 'A2:7602', 'A1:7701', 'A1:7702', 'A7:7701', 'A7:7702', 'A3:0']);
    expect(new Set(agents.map((x) => x.model.id)).size).toBe(7);
  });
  it('the predeclared action seeds are 5001 to 5010, unrelated to the training seeds', () => {
    expect([...E6_ACTION_SEEDS]).toEqual([5001, 5002, 5003, 5004, 5005, 5006, 5007, 5008, 5009, 5010]);
  });
});

describe('the manifest', () => {
  it('parses the fixture and hashes it', () => {
    expect(parseE6Manifest(manifest, SPLITS).id).toBe('mechanics-e6');
    expect(e6ManifestHash(manifest as never)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
  it.each<[string, (m: Json) => void, RegExp]>([
    ['an unknown field', (m) => { m.extra = 1; }, /unknown field/],
    ['a confirmatory label (E6 is exploratory)', (m) => { m.label = 'confirmatory'; }, /label must be one of/],
    ['an exploratory label on a synthetic registry', (m) => { m.label = 'exploratory'; m.code.revision = 'a'.repeat(40); }, /seeds 2001|built-in/],
    ['a pin that is not the re-derived agent (checked when the agents load)', (m) => { m.baselines.a3.modelId = `sha256:${'0'.repeat(64)}`; }, /$^/],
    ['another margin', (m) => { m.analysis.margin = 0.1; }, /margin/],
    ['another bootstrap seed', (m) => { m.analysis.bootstrap.seed = 1; }, /bootstrap/],
    ['another decision rule', (m) => { m.analysis.decisionRule = 'other'; }, /decisionRule/],
    ['another status text', (m) => { m.analysis.status = 'Confirmatory.'; }, /status/],
    ['other starts', (m) => { m.analysis.starts = [0, 1]; }, /starts/],
    ['A7 seeds that differ from A1', (m) => { m.baselines.a7[0].seed = 7799; }, /same predeclared action seeds/],
    ['a reserved seed in a mechanics manifest', (m) => { m.baselines.a2[0].seed = 2001; }, /reserved/],
    ['a spent circuit', (m) => { m.tracks.heldOut[0].id = 'hairpin-chicane'; }, /not a registered held-out|spent/],
    ['a validation circuit as held-out', (m) => { m.tracks.heldOut[0] = { id: 'rounded-rectangle', contentHash: trackContentHash(loadTrack(roundedRectangle)) }; }, /not a registered held-out/],
    ['another split-manifest hash', (m) => { m.tracks.splitManifestHash = `sha256:${'0'.repeat(64)}`; }, /splitManifestHash/],
    ['a missing revision outside mechanics is not testable here; a malformed revision is', (m) => { m.code.revision = 'xyz'; }, /40-character/],
  ])('the parser refuses %s', (name, change, pattern) => {
    const bad = clone(manifest);
    change(bad);
    if (name.startsWith('a pin that is not')) {
      expect(() => loadE6Agents(bad as never)).toThrow(StudyRecordError);
      return;
    }
    expect(() => parseE6Manifest(bad, SPLITS)).toThrow(StudyManifestError);
    expect(() => parseE6Manifest(bad, SPLITS)).toThrow(pattern);
  });
});

describe('the evolved cohorts are READ from E5, never evaluated again', () => {
  it('reads A4 and A5 through the strict E5 parser', () => {
    expect(evolved.record.resultsHash).toBe(E5_RECORD.resultsHash);
    expect(evolved.record.evaluations.map((e) => e.agent)).toEqual(['A4', 'A5', 'A4', 'A5']);
  });
  it.each<[string, (m: Json) => void]>([
    ['another E5 manifest hash', (m) => { m.e5.manifestHash = `sha256:${'1'.repeat(64)}`; }],
    ['another E5 results hash', (m) => { m.e5.resultsHash = `sha256:${'2'.repeat(64)}`; }],
    ['another training configuration', (m) => { m.configuration.generations = G + 1; }],
    ['A2 seeds that are not the champions\' seeds', (m) => { m.baselines = e6BaselinePins([7611, 7612], ACTION); }],
  ])('refuses %s', (_name, change) => {
    const bad = clone(manifest);
    change(bad);
    expect(() => loadE6Evolved(bad, e5Manifest, E5_RECORD, E4_MANIFEST, E4_RECORDS, ENGINE, SPLITS)).toThrow(StudyCompatibilityError);
  });
  it('refuses an E5 record that is corrupted (the strict E5 parser runs first)', () => {
    const bad = clone(E5_RECORD) as Json;
    bad.evaluations[0].starts[0].episode.ticks += 1;
    expect(() => loadE6Evolved(manifest, e5Manifest, rehash(bad), E4_MANIFEST, E4_RECORDS, ENGINE, SPLITS)).toThrow();
  });
});

describe('the held-out record of the new agents', () => {
  it('lists ONLY the new agents in the protocol: A4 and A5 are not evaluated again, so the ledger holds one claim and no champion', () => {
    const protocol = e6HeldOutProtocol(manifest, SPLITS);
    const champions = new Set(E5_RECORD.opening.agentIds);
    expect(protocol.agentIds).toHaveLength(7);
    for (const id of protocol.agentIds) expect(champions.has(id)).toBe(false);
    expect(held.opening.agentIds).toEqual(protocol.agentIds);
    expect(ledger.openings().map((o) => o.protocolHash)).toEqual([held.opening.protocolHash]);
  });
  it('holds each new agent once on the circuit with the five protocol starts', () => {
    expect(held.format).toBe(E6_HELDOUT_FORMAT);
    expect(held.evaluations).toHaveLength(7);
    for (const e of held.evaluations) {
      expect(e.starts).toHaveLength(5);
      expect(e.starts.map((s) => s.start)).toEqual([0, 1, 2, 3, 4]);
    }
    expect(held.manifestHash).toBe(e6ManifestHash(manifest as never));
  });
  it('is parsed, and a second opening with the same ledger is refused', () => {
    expect(parseHeld(held).resultsHash).toBe(held.resultsHash);
    expect(() => runE6HeldOut(manifest, evolved, newGate(ledger), CONTEXT, SPLITS)).toThrow(HeldOutAccessError);
    expect(() => newGate(e6LedgerFromRecords([held])).open(manifest.authorisation)).toThrow(HeldOutAccessError);
  });
  it('refuses a run under another engine than the evolved E5 record was recorded under, before the once-only gate opens (Codex P2 on #215)', () => {
    const l = createMemoryLedger();
    for (const key of ['name', 'version', 'v8'] as const) {
      const other = { ...CONTEXT, engine: { ...ENGINE, [key]: `${ENGINE[key]}-other` } };
      expect(() => runE6HeldOut(manifest, evolved, newGate(l), other, SPLITS)).toThrow(/nothing was opened/);
    }
    expect(l.openings()).toEqual([]); // the look was not spent
    expect(runE6HeldOut(manifest, evolved, newGate(l), CONTEXT, SPLITS).resultsHash).toBe(held.resultsHash); // and is still available under the right engine
  });
  describe('the evolved cohorts are a manifest-bound immutable snapshot, checked before the once-only opening (Codex P2 on #215)', () => {
    const attempt = (m: Json, e: unknown) => {
      const l = createMemoryLedger();
      let error: unknown;
      try {
        runE6HeldOut(m, e as never, createHeldOutGate(e6HeldOutProtocol(m, SPLITS), l, SPLITS), CONTEXT, SPLITS);
      } catch (caught) {
        error = caught;
      }
      return { error, l };
    };
    it('the valid path still works, and the snapshot is bound to this manifest', () => {
      expect(evolved.e6ManifestHash).toBe(e6ManifestHash(manifest as never));
      const { error, l } = attempt(manifest, evolved);
      expect(error).toBeUndefined();
      expect(l.openings()).toHaveLength(1);
    });
    it('a changed E6 configuration (maxEpisodeSeconds 3 to 4) is refused although loadE6Evolved also rejects it as incompatible, and the ledger stays untouched', () => {
      const changed = clone(manifest);
      changed.configuration.training.maxEpisodeSeconds = 4;
      expect(() => loadE6Evolved(changed, e5Manifest, E5_RECORD, E4_MANIFEST, E4_RECORDS, ENGINE, SPLITS)).toThrow(StudyCompatibilityError);
      const { error, l } = attempt(changed, evolved);
      expect(error).toBeInstanceOf(StudyCompatibilityError);
      expect(String(error)).toMatch(/Nothing was opened/);
      expect(l.openings()).toEqual([]);
    });
    it('a changed E5 manifest pin is refused before opening, and the ledger stays untouched', () => {
      const changed = clone(manifest);
      changed.e5.manifestHash = `sha256:${'7'.repeat(64)}`;
      const { error, l } = attempt(changed, evolved);
      expect(error).toBeInstanceOf(StudyCompatibilityError);
      expect(l.openings()).toEqual([]);
    });
    it('a changed analysis setting or circuit list changes the manifest hash and is refused the same way', () => {
      const changed = clone(manifest);
      changed.description = 'another description changes the manifest hash';
      const { error, l } = attempt(changed, evolved);
      expect(String(error)).toMatch(/another E6 manifest/);
      expect(l.openings()).toEqual([]);
    });
    it('removing an evaluation from the caller\'s E5 record after loading cannot reach the snapshot, which is a private copy', () => {
      const mine = clone(E5_RECORD) as Json;
      const loaded = loadE6Evolved(manifest, e5Manifest, mine, E4_MANIFEST, E4_RECORDS, ENGINE, SPLITS);
      mine.evaluations.pop();
      mine.evaluations[0].starts[0].episode.ticks += 1;
      expect(loaded.record.evaluations).toHaveLength(E5_RECORD.evaluations.length);
      const { error, l } = attempt(manifest, loaded);
      expect(error).toBeUndefined();
      expect(l.openings()).toHaveLength(1);
    });
    it('the snapshot itself is deeply frozen: an edit to it throws and changes nothing', () => {
      expect(Object.isFrozen(evolved)).toBe(true);
      expect(Object.isFrozen(evolved.record.evaluations)).toBe(true);
      expect(Object.isFrozen(evolved.record.evaluations[0]!.starts[0]!.episode)).toBe(true);
      expect(() => { (evolved.record.evaluations as unknown[]).pop(); }).toThrow(TypeError);
      expect(() => { (evolved.record.evaluations[0]!.starts[0]!.episode as { ticks: number }).ticks += 1; }).toThrow(TypeError);
      expect(attempt(manifest, evolved).error).toBeUndefined();
    });
    it('a hand-built object, a copy of the snapshot and a record with a stale hash are refused: only a loaded snapshot opens the gate', () => {
      const handBuilt = { record: clone(E5_RECORD), e5ManifestHash: manifest.e5.manifestHash, e6ManifestHash: e6ManifestHash(manifest as never), digest: evolved.digest };
      for (const e of [handBuilt, { ...evolved }, { record: evolved.record, e5ManifestHash: evolved.e5ManifestHash }]) {
        const { error, l } = attempt(manifest, e);
        expect(error).toBeInstanceOf(StudyCompatibilityError);
        expect(String(error)).toMatch(/Nothing was opened/);
        expect(l.openings()).toEqual([]);
      }
    });
  });
  it('refuses a gate made for another protocol, and an evolved record that is not the pinned one, before anything is claimed', () => {
    const l = createMemoryLedger();
    const other = createHeldOutGate({ ...e6HeldOutProtocol(manifest, SPLITS), authorisationId: 'issue-36#other' }, l, SPLITS);
    expect(() => runE6HeldOut(manifest, evolved, other, CONTEXT, SPLITS)).toThrow(HeldOutAccessError);
    const wrong = { ...evolved, record: { ...evolved.record, resultsHash: `sha256:${'3'.repeat(64)}` } };
    expect(() => runE6HeldOut(manifest, wrong as never, newGate(l), CONTEXT, SPLITS)).toThrow(StudyCompatibilityError);
    expect(l.openings()).toEqual([]);
  });
  it.each<[string, (r: Json) => void, RegExp]>([
    ['an extra field', (r) => { r.extra = 1; }, /unknown field/],
    ['another manifest hash', (r) => { r.manifestHash = `sha256:${'4'.repeat(64)}`; }, /another manifest/],
    ['a missing evaluation', (r) => { r.evaluations.pop(); }, /must hold 7 evaluations/],
    ['a swapped evaluation order', (r) => { r.evaluations.reverse(); }, /agent, seed, model, circuit/],
    ['a missing start', (r) => { r.evaluations[0].starts.pop(); }, /must hold 5 starts/],
    ['a mis-indexed start', (r) => { r.evaluations[0].starts[1].start = 3; }, /start/],
    ['an edited opening', (r) => { r.opening.agentIds.pop(); }, /opening/],
  ])('the record parser refuses %s', (_name, change, pattern) => {
    const bad = clone(held) as Json;
    change(bad);
    expect(() => parseHeld(rehash(bad))).toThrow(pattern);
  });
  it('refuses a record whose results hash no longer matches', () => {
    const bad = clone(held) as Json;
    bad.evaluations[0].starts[0].episode.ticks += 0;
    bad.resultsHash = `sha256:${'5'.repeat(64)}`;
    expect(() => parseHeld(bad)).toThrow(/resultsHash/);
  });
});

describe('replay and the analysis', () => {
  it('replays identically through a separate gate and leaves the study ledger untouched', () => {
    const before = JSON.stringify(ledger.openings());
    const replay = replayE6HeldOutRecord(held, manifest, evolved, ENGINE, undefined, SPLITS);
    expect(replay).toMatchObject({ identical: true, differences: [] });
    expect(JSON.stringify(ledger.openings())).toBe(before);
  });
  it('detects an edited episode on replay', () => {
    const bad = clone(held) as Json;
    bad.evaluations[0].starts[0].episode.gatesPassed += 1;
    bad.evaluations[0].starts[0].episode.orderedProgress += 0.01;
    expect(() => replayE6HeldOutRecord(rehash(bad), manifest, evolved, ENGINE, undefined, SPLITS)).toThrow();
  });
  it('analyses the records: the evolved cohorts come from E5 by seed, the baselines from the new record, and the output says it is mechanics only', () => {
    const a = analyseE6Records(manifest, e5Manifest, E5_RECORD, E4_MANIFEST, E4_RECORDS, held, ENGINE, SPLITS) as Json;
    expect(a.evidence).toMatch(/MECHANICS ONLY/);
    expect(a.status).toBe(E6_STATUS);
    expect(a.manifestHash).toBe(e6ManifestHash(manifest as never));
    expect(a.circuits).toHaveLength(1);
    expect(a.circuits[0].contrasts).toHaveLength(8);
    expect(a.circuits[0].cohorts.A5.units).toBe(2);
    expect(a.circuits[0].cohorts.A1.units).toBe(2);
    expect(JSON.stringify(a)).not.toMatch(/pooled-headline|"headline"/);
  });
});

describe('the committed E4 and E5 results are only READ (nothing is evaluated)', () => {
  const ROOT = join(__dirname, '../..');
  const read = (path: string): unknown => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
  it('builds the real pins and reads the real evolved cohorts: A2 pairs with the ten E4 seeds, and the recorded E5 cohorts completed no lap', () => {
    const pins = e6BaselinePins(E4_SEEDS, E6_ACTION_SEEDS);
    expect(pins.a2.map((p) => p.seed)).toEqual([...E4_SEEDS]);
    expect(pins.a1).toHaveLength(10);
    expect(new Set([...pins.a2, ...pins.a1, ...pins.a7].map((p) => p.modelId)).size).toBe(30);
    const e4Manifest = read('experiments/manifests/p2-09-e4.json');
    const e4Engine = (JSON.parse(gunzipSync(readFileSync(join(ROOT, 'experiments/results/p2-09/e4/seed-2001.json.gz'))).toString('utf8')) as Json).engine;
    const e4Records = E4_SEEDS.map((s) => JSON.parse(gunzipSync(readFileSync(join(ROOT, `experiments/results/p2-09/e4/seed-${s}.json.gz`))).toString('utf8')) as unknown);
    const e5ManifestReal = read('experiments/manifests/p5-02-e5.json') as Json;
    const e5Real = read('experiments/results/p5-02/e5/held-out.json') as Json;
    const real = {
      format: E6_MANIFEST_FORMAT,
      version: 1,
      id: 'p5-04-e6-read-only-check',
      label: 'exploratory',
      description: 'A read-only check that the real E5 record can be read as E6 evolved cohorts. Not a frozen manifest.',
      e5: { manifestHash: e5ManifestHash(e5ManifestReal as never), resultsHash: e5Real.resultsHash },
      baselines: pins,
      configuration: clone(e5ManifestReal.configuration),
      tracks: clone(e5ManifestReal.tracks),
      analysis: { starts: [...E6_STARTS], margin: E6_MARGIN, bootstrap: { ...E6_BOOTSTRAP }, decisionRule: E6_DECISION_RULE, floorShare: E6_FLOOR_SHARE, status: E6_STATUS },
      authorisation: 'issue-36#read-only-check',
      code: { revision: 'a'.repeat(40) },
    };
    expect(parseE6Manifest(real).label).toBe('exploratory');
    const cohorts = loadE6Evolved(real, e5ManifestReal, e5Real, e4Manifest, e4Records, e4Engine as never);
    const evals = cohorts.record.evaluations;
    expect(evals).toHaveLength(60);
    expect(E5_HELDOUT_FORMAT).toBe(cohorts.record.format);
    // The recorded fact the E6 design must face: no champion completed a lap on any fresh circuit (E5 saturated).
    expect(evals.every((e) => e.starts.every((s) => s.episode.lapTicks.length === 0))).toBe(true);
  });
});
