// P5-02 step 3: the E5 study kind (src/training/e5Study.ts): manifest, the frozen pairs read from E4's records, the once-only
// held-out record with brake usage, strict parsing, replay and the paired analysis. Tiny E4 MECHANICS records (seeds 76xx) and a
// SYNTHETIC held-out registry (a scaled copy of the oval under its own ID): no real held-out circuit is evaluated, so nothing
// here is a study result or evidence of learning. The real committed E4 records are only READ (never re-trained or evaluated on
// a held-out circuit) to show that Design A's pins can be built from them.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import manifestData from '../../src/data/tracks/index.json';
import roundedRectangle from '../../src/data/tracks/rounded-rectangle.json';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import hairpinChicane from '../../src/data/tracks/hairpin-chicane.json';
import { BRAKE_USAGE_THRESHOLD } from '../../src/training/e4Agents';
import { E4_BOOTSTRAP, E4_DECISION_RULE, E4_DELTA, E4_MANIFEST_FORMAT, parseE4Manifest, runE4Seed, type E4Manifest } from '../../src/training/e4Study';
import { resolveBaselineConfig } from '../../src/training/baselines';
import { canonicalJson, manifestRecord } from '../../src/training/experiment';
import {
  analyseE5,
  analyseE5Circuit,
  classifyE5Endpoint,
  e5AnalysisJson,
  e5Headline,
  e5HeldOutProtocol,
  e5LedgerFromRecords,
  e5ManifestHash,
  e5PairPins,
  E5_BOOTSTRAP,
  E5_DECISION_RULE,
  E5_ENDPOINTS,
  E5_HELDOUT_FORMAT,
  E5_MANIFEST_FORMAT,
  E5_SPENT_CIRCUITS,
  E5_STARTS,
  loadE5Pairs,
  parseE5HeldOutRecord,
  parseE5Manifest,
  readE5PairsFromE4,
  renderE5Report,
  replayE5HeldOutRecord,
  runE5HeldOut,
  type E5EndpointResult,
  type E5PairRows,
  type E5StartRow,
} from '../../src/training/e5Study';
import { createHeldOutGate, createMemoryLedger, HeldOutAccessError } from '../../src/training/heldOutAccess';
import { BUILT_IN_TRACK_SPLITS } from '../../src/training/trackSplits';
import { currentStreams, E4_SEEDS, hashOf, METRIC, StudyCompatibilityError, StudyManifestError, StudyRecordError, trackReferences, WILCOXON, type StudyContext } from '../../src/training/study';
import { loadTrackSplits, trackContentHash } from '../../src/training/trackSplits';
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
      { id: 'synthetic-held-out', version: '1', split: 'held-out', file: 'synthetic.json', contentHash: trackContentHash(loadTrack(scaledOval)), description: 'held-out' },
    ],
  },
  { 'stadium-oval.json': stadiumOval, 'rounded-rectangle.json': roundedRectangle, 'synthetic.json': scaledOval },
);
const HELD = 'synthetic-held-out';

// ---- Tiny E4 mechanics records (the champions E5 reads) ----
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
  id: 'mechanics-e4-for-e5',
  label: 'mechanics',
  description: 'Tiny E4 mechanics fixture the E5 tests read.',
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
const CONTEXT: StudyContext = { engine: ENGINE, source: { revision: null, dirty: null, unavailableReason: 'test fixture', appVersion: '0.0.0' }, recordedAt: '2026-11-14T00:00:00Z' };
const E4_RECORDS = [runE4Seed(E4_MANIFEST, 7601, CONTEXT), runE4Seed(E4_MANIFEST, 7602, CONTEXT)];
const PINS = e5PairPins(E4_MANIFEST, E4_RECORDS, ENGINE);

const ANALYSIS = (): Json => ({ descriptiveMetric: METRIC, starts: [...E5_STARTS], endpoints: { ...E5_ENDPOINTS }, bootstrap: { ...E5_BOOTSTRAP }, decisionRule: E5_DECISION_RULE, brakeUsageThreshold: BRAKE_USAGE_THRESHOLD });
const MANIFEST = (): Json => ({
  format: E5_MANIFEST_FORMAT,
  version: 1,
  id: 'mechanics-e5',
  label: 'mechanics',
  description: 'Tiny mechanics fixture for the E5 tests.',
  e4: { manifestHash: PINS.e4ManifestHash },
  pairs: clone(PINS.pairs),
  configuration: clone(E4_MANIFEST.configuration),
  tracks: { heldOut: [{ id: HELD, contentHash: trackContentHash(loadTrack(scaledOval)) }], splitManifestHash: manifestRecord(SPLITS).hash },
  analysis: ANALYSIS(),
  authorisation: 'issue-34#mechanics',
  code: { revision: null },
});
const manifest = MANIFEST();
const pairs = loadE5Pairs(manifest, E4_MANIFEST, E4_RECORDS, ENGINE, SPLITS);
const newGate = (ledger = createMemoryLedger()) => createHeldOutGate(e5HeldOutProtocol(manifest, pairs, SPLITS), ledger, SPLITS);
const ledger = createMemoryLedger();
const held = runE5HeldOut(manifest, E4_MANIFEST, E4_RECORDS, newGate(ledger), CONTEXT, SPLITS);
const parseHeld = (record: unknown, m: unknown = manifest, records: readonly unknown[] = E4_RECORDS) => parseE5HeldOutRecord(record, m, E4_MANIFEST, records, ENGINE, SPLITS);

describe('the manifest', () => {
  it('parses the fixture and hashes it', () => {
    expect(parseE5Manifest(manifest, SPLITS).id).toBe('mechanics-e5');
    expect(e5ManifestHash(manifest as never)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
  it.each<[string, (m: Json) => void, RegExp]>([
    ['an unknown field', (m) => { m.extra = 1; }, /unknown field/],
    ['a missing field', (m) => { delete m.code; }, /missing|incomplete/],
    ['another meaningful collision difference', (m) => { m.analysis.endpoints.collisionDelta = 0.1; }, /endpoints/],
    ['another meaningful lap-time difference', (m) => { m.analysis.endpoints.lapTimeDeltaSeconds = 0.5; }, /endpoints/],
    ['another eligibility minimum', (m) => { m.analysis.endpoints.minEligiblePairs = 2; }, /endpoints/],
    ['other starts than the protocol\'s five', (m) => { m.analysis.starts = [0]; }, /five fixed starts/],
    ['another bootstrap', (m) => { m.analysis.bootstrap.resamples = 5; }, /bootstrap/],
    ['the superseded progress-only decision rule', (m) => { m.analysis.decisionRule = 'p5-02-e5-decision-v1'; }, /decisionRule/],
    ['a progress metric in place of the descriptive one', (m) => { m.analysis.descriptiveMetric = 'other'; }, /descriptiveMetric/],
    ['the old progress-only analysis block', (m) => { m.analysis = { metric: METRIC, delta: 0.25, bootstrap: { ...E5_BOOTSTRAP }, decisionRule: 'p5-02-e5-decision-v1', brakeUsageThreshold: BRAKE_USAGE_THRESHOLD }; }, /unknown field|missing|incomplete/],
    ['a reserved seed in a mechanics manifest', (m) => { m.pairs[0].seed = 2001; }, /reserved/],
    ['a repeated seed', (m) => { m.pairs[1].seed = m.pairs[0].seed; }, /distinct seeds/],
    ['an A4 and an A5 sharing an id', (m) => { m.pairs[0].a5 = m.pairs[0].a4; }, /distinct frozen models/],
    ['no pairs', (m) => { m.pairs = []; }, /non-empty/],
    ['brakeEnabled in the training block', (m) => { m.configuration.training.brakeEnabled = true; }, /brakeEnabled/],
    ['an incomplete training block', (m) => { delete m.configuration.training.mutation; }, /training/],
    ['a held-out circuit that is not registered as held-out', (m) => { m.tracks.heldOut = [{ id: 'stadium-oval', contentHash: trackContentHash(loadTrack(stadiumOval)) }]; }, /not a registered held-out/],
    ['a held-out circuit with the wrong hash', (m) => { m.tracks.heldOut[0].contentHash = `sha256:${'1'.repeat(64)}`; }, /contentHash/],
    ['a repeated held-out circuit', (m) => { m.tracks.heldOut.push({ ...m.tracks.heldOut[0] }); }, /distinct/],
    ['no held-out circuit', (m) => { m.tracks.heldOut = []; }, /at least one held-out/],
    ['a wrong split manifest hash', (m) => { m.tracks.splitManifestHash = `sha256:${'2'.repeat(64)}`; }, /splitManifestHash/],
    ['a bad authorisation', (m) => { m.authorisation = 'has spaces'; }, /authorisation/],
    ['a null authorisation', (m) => { m.authorisation = null; }, /authorisation/],
    ['a confirmatory label without E4\'s seeds', (m) => { m.label = 'confirmatory'; m.code.revision = 'a'.repeat(40); }, /E4's seeds 2001/],
    ['a bad revision', (m) => { m.code.revision = 'abc'; }, /revision/],
  ])('refuses %s', (_name, mutate, pattern) => {
    const bad = MANIFEST();
    mutate(bad);
    expect(() => parseE5Manifest(bad, SPLITS)).toThrow(pattern);
    expect(() => parseE5Manifest(bad, SPLITS)).toThrow(StudyManifestError);
  });
  it('refuses a mechanics manifest on the built-in registry (mechanics never touches real held-out data)', () => {
    expect(() => parseE5Manifest(manifest)).toThrow(StudyManifestError);
  });
  it('is a different protocol (hash) for any change, so a changed manifest cannot reuse an opening', () => {
    const other = MANIFEST();
    other.description = 'another';
    expect(e5ManifestHash(other as never)).not.toBe(e5ManifestHash(manifest as never));
  });
  describe('the spent circuits cannot be E5 held-out evidence (plan 0.1)', () => {
    // A synthetic registry whose held-out circuit carries a spent id, so the refusal is the rule and not a registry accident.
    const spentRegistry = (id: string) => {
      const track = { ...scaledOval, id };
      return {
        splits: loadTrackSplits(
          {
            ...manifestData,
            tracks: [
              { id: 'stadium-oval', version: '1', split: 'training', file: 'stadium-oval.json', contentHash: trackContentHash(loadTrack(stadiumOval)), description: 'training' },
              { id: 'rounded-rectangle', version: '1', split: 'validation', file: 'rounded-rectangle.json', contentHash: trackContentHash(loadTrack(roundedRectangle)), description: 'validation' },
              { id, version: '1', split: 'held-out', file: 'x.json', contentHash: trackContentHash(loadTrack(track)), description: 'held-out' },
            ],
          },
          { 'stadium-oval.json': stadiumOval, 'rounded-rectangle.json': roundedRectangle, 'x.json': track },
        ),
        hash: trackContentHash(loadTrack(track)),
      };
    };
    it.each(E5_SPENT_CIRCUITS)('refuses %s, however it is registered', (id) => {
      const { splits, hash } = spentRegistry(id);
      const m = MANIFEST();
      m.tracks = { heldOut: [{ id, contentHash: hash }], splitManifestHash: manifestRecord(splits).hash };
      expect(() => parseE5Manifest(m, splits)).toThrow(/already exposed.*spent as held-out evidence/);
    });
    it('accepts the same registry shape with a fresh id (so the refusal is about the spent ids)', () => {
      const { splits, hash } = spentRegistry('fresh-circuit-for-test');
      const m = MANIFEST();
      m.tracks = { heldOut: [{ id: 'fresh-circuit-for-test', contentHash: hash }], splitManifestHash: manifestRecord(splits).hash };
      expect(parseE5Manifest(m, splits).tracks.heldOut[0]!.id).toBe('fresh-circuit-for-test');
    });
    it('every held-out circuit on today\'s built-in registry is spent, so no confirmatory manifest can exist until fresh circuits are registered (step 2b)', () => {
      const heldOut = BUILT_IN_TRACK_SPLITS.tracks.filter((t) => t.split === 'held-out').map((t) => t.id);
      expect(heldOut.length).toBeGreaterThan(0);
      for (const id of heldOut) expect(E5_SPENT_CIRCUITS).toContain(id);
    });
  });
});

describe('the frozen pairs are read from the E4 records, never trained or selected here', () => {
  it('rebuilds each pair to its pinned identities', () => {
    expect(pairs.map((p) => p.seed)).toEqual([7601, 7602]);
    pairs.forEach((p, i) => {
      expect(p.a4.id).toBe(manifest.pairs[i].a4);
      expect(p.a5.id).toBe(manifest.pairs[i].a5);
      expect(p.a4.provenance.agent).toBe('A4');
      expect(p.a4.provenance.brakeEnabled).toBe(false);
      expect(p.a5.provenance.agent).toBe('A5');
      expect(p.a5.provenance.brakeEnabled).toBe(true);
    });
  });
  it.each<[string, () => unknown[], (m: Json) => void, RegExp, new (...args: never[]) => Error]>([
    ['another E4 manifest', () => E4_RECORDS, (m) => { m.e4.manifestHash = `sha256:${'3'.repeat(64)}`; }, /E4 manifest/, StudyCompatibilityError],
    ['a different configuration from E4\'s', () => E4_RECORDS, (m) => { m.configuration.generations = 3; }, /configuration/, StudyCompatibilityError],
    ['a pinned A4 id that differs', () => E4_RECORDS, (m) => { m.pairs[0].a4 = `sha256:${'4'.repeat(64)}`; }, /A4 id/, StudyRecordError],
    ['a pinned record hash that differs', () => E4_RECORDS, (m) => { m.pairs[1].e4ResultsHash = `sha256:${'5'.repeat(64)}`; }, /resultsHash/, StudyRecordError],
    ['records in another order', () => [E4_RECORDS[1]!, E4_RECORDS[0]!], () => undefined, /in order/, StudyRecordError],
    ['a missing record', () => [E4_RECORDS[0]!], () => undefined, /in order/, StudyRecordError],
  ])('refuses %s', (_name, records, mutate, pattern, error) => {
    const m = MANIFEST();
    mutate(m);
    const run = () => loadE5Pairs(m, E4_MANIFEST, records(), ENGINE, SPLITS);
    expect(run).toThrow(pattern);
    expect(run).toThrow(error);
  });
  it('refuses a corrupted E4 record (the strict E4 parser runs first)', () => {
    const bad = clone(E4_RECORDS[0]) as Json;
    bad.agents.A5.model.parameters[0] += 1;
    expect(() => loadE5Pairs(manifest, E4_MANIFEST, [bad, E4_RECORDS[1]!], ENGINE, SPLITS)).toThrow();
  });
});

describe('the one held-out record', () => {
  it('evaluates each frozen champion once on each listed circuit from the five protocol starts, A4 then A5 per seed, with brake usage per start', () => {
    expect(held.format).toBe(E5_HELDOUT_FORMAT);
    expect(held.evaluations.map((e) => [e.agent, e.seed, e.trackId])).toEqual([
      ['A4', 7601, HELD], ['A5', 7601, HELD], ['A4', 7602, HELD], ['A5', 7602, HELD],
    ]);
    for (const e of held.evaluations) {
      expect(e.starts.map((x) => x.start)).toEqual([...E5_STARTS]);
      for (const st of e.starts) {
        expect(st.brakeUsage.ticks).toBe(st.episode.ticks);
        if (e.agent === 'A4') expect(st.brakeUsage.brakeTicks).toBe(0);
      }
    }
    expect(held.opening.protocolHash).toBe(e5ManifestHash(manifest as never));
    expect(parseHeld(held).resultsHash).toBe(held.resultsHash);
  });
  it('opens once: the ledger refuses a second look at the same protocol, from a new gate too', () => {
    expect(ledger.openings()).toHaveLength(1);
    expect(() => runE5HeldOut(manifest, E4_MANIFEST, E4_RECORDS, newGate(ledger), CONTEXT, SPLITS)).toThrow(/already been opened/);
    expect(e5LedgerFromRecords([held]).openings()).toHaveLength(1);
    expect(() => runE5HeldOut(manifest, E4_MANIFEST, E4_RECORDS, newGate(e5LedgerFromRecords([held])), CONTEXT, SPLITS)).toThrow(HeldOutAccessError);
  });
  it('never uses up the look on a bad input: a bad E4 record is refused before the gate opens', () => {
    const gate = newGate();
    const bad = clone(E4_RECORDS[0]) as Json;
    bad.agents.A5.model.parameters[0] += 1;
    expect(() => runE5HeldOut(manifest, E4_MANIFEST, [bad, E4_RECORDS[1]!], gate, CONTEXT, SPLITS)).toThrow();
    expect(gate.opened).toBe(false);
    expect(() => runE5HeldOut(manifest, E4_MANIFEST, E4_RECORDS, gate, CONTEXT, SPLITS)).not.toThrow();
  });
  it('refuses a gate made for another protocol (other authorisation, circuits or agents)', () => {
    const wrong = createHeldOutGate({ ...e5HeldOutProtocol(manifest, pairs, SPLITS), authorisationId: 'someone-else' }, createMemoryLedger(), SPLITS);
    expect(() => runE5HeldOut(manifest, E4_MANIFEST, E4_RECORDS, wrong, CONTEXT, SPLITS)).toThrow(HeldOutAccessError);
    expect(wrong.opened).toBe(false);
  });
  it('refuses a frozen-commit manifest from a dirty or other checkout', () => {
    const frozen = MANIFEST();
    frozen.code.revision = 'a'.repeat(40);
    expect(() => runE5HeldOut(frozen, E4_MANIFEST, E4_RECORDS, newGate(), CONTEXT, SPLITS)).toThrow(/revision is unknown/);
  });
  it('is deterministic and replays identically through a fresh gate without touching the real ledger', () => {
    const second = runE5HeldOut(manifest, E4_MANIFEST, E4_RECORDS, newGate(), CONTEXT, SPLITS);
    expect(canonicalJson(second)).toBe(canonicalJson(held));
    const replay = replayE5HeldOutRecord(held, manifest, E4_MANIFEST, E4_RECORDS, ENGINE, undefined, SPLITS);
    expect(replay).toEqual({ identical: true, differences: [], sameSourceRevision: null });
    expect(ledger.openings()).toHaveLength(1);
  });
  it('replay names a changed start', () => {
    const bad = clone(held) as Json;
    const u = bad.evaluations[1].starts[2].brakeUsage;
    u.brakeTicks = u.brakeTicks === 0 ? 1 : 0;
    const replay = replayE5HeldOutRecord(rehash(bad), manifest, E4_MANIFEST, E4_RECORDS, ENGINE, undefined, SPLITS);
    expect(replay.identical).toBe(false);
    expect(replay.differences.join(' ')).toMatch(/starts.*brakeUsage|brakeUsage/);
  });
  it.each<[string, (r: Json) => void, RegExp, boolean]>([
    ['an unknown field', (r) => { r.extra = 1; }, /unknown field/, false],
    ['a wrong format', (r) => { r.format = 'x'; }, /format/, false],
    ['another manifest hash', (r) => { r.manifestHash = `sha256:${'6'.repeat(64)}`; }, /another manifest/, false],
    ['another opening (agents)', (r) => { r.opening.agentIds = [...r.opening.agentIds].reverse(); }, /opening/, true],
    ['another authorisation in the opening', (r) => { r.opening.authorisationId = 'other'; }, /opening/, true],
    ['a missing evaluation', (r) => { r.evaluations.pop(); }, /must hold 4 evaluations/, true],
    ['evaluations in another order', (r) => { r.evaluations.reverse(); }, /agent, seed, model, circuit/, true],
    ['a missing start', (r) => { r.evaluations[0].starts.pop(); }, /must hold 5 starts/, true],
    ['an extra start', (r) => { r.evaluations[0].starts.push(clone(r.evaluations[0].starts[0])); }, /must hold 5 starts/, true],
    ['a wrong start index', (r) => { r.evaluations[0].starts[1].start = 3; }, /starts\[1\]\.start/, true],
    ['a legacy single-episode shape', (r) => { r.evaluations[0] = { agent: 'A4', seed: 7601, modelId: r.evaluations[0].modelId, trackId: HELD, episode: r.evaluations[0].starts[0].episode, brakeUsage: r.evaluations[0].starts[0].brakeUsage }; }, /unknown field|missing|incomplete/, true],
    ['an A4 start recording brake ticks', (r) => { r.evaluations[0].starts[0].brakeUsage.brakeTicks = 1; }, /cannot brake/, true],
    ['brake ticks beyond the ticks', (r) => { r.evaluations[1].starts[0].brakeUsage.brakeTicks = r.evaluations[1].starts[0].episode.ticks + 1; }, /brakeTicks/, true],
    ['brake usage ticks that differ from the episode', (r) => { r.evaluations[1].starts[4].brakeUsage.ticks += 1; }, /brakeUsage\.ticks/, true],
    ['an episode that is not the score of its own values', (r) => { r.evaluations[0].starts[2].episode.fitness.total += 1; }, /fitness/, true],
    ['a progress that is not gates over the circuit', (r) => { r.evaluations[0].starts[0].episode.orderedProgress = 0.123; }, /orderedProgress/, true],
    ['a stale results hash', (r) => { r.evaluations[0].starts[0].episode.partialProgress = 0; }, /resultsHash|partialProgress|fitness/, false],
  ])('refuses %s', (_name, mutate, pattern, rehashed) => {
    const bad = clone(held) as Json;
    mutate(bad);
    expect(() => parseHeld(rehashed ? rehash(bad) : bad)).toThrow(pattern);
  });
  it('refuses a record made for another engine', () => {
    const bad = clone(held) as Json;
    bad.engine.version = 'v0.0.0';
    expect(() => parseHeld(bad)).toThrow(StudyCompatibilityError);
  });
});

// ---- The analysis, analytically (pure functions of hand-made rows) ----
const SETTINGS = { collisionDelta: E5_ENDPOINTS.collisionDelta, lapTimeDeltaSeconds: E5_ENDPOINTS.lapTimeDeltaSeconds, minEligiblePairs: E5_ENDPOINTS.minEligiblePairs, bootstrap: E5_BOOTSTRAP };
const sr = (over: Partial<E5StartRow> = {}): E5StartRow => ({ crashed: true, firstLapSeconds: null, progress: 0.3, ticks: 100, brakeTicks: 0, ...over });
/** Five starts for one champion: `crashes` of them crashed (the first ones), `lap` seconds on start 0 when given. */
const five = (crashes: number, lap: number | null = null, over: Partial<E5StartRow> = {}): E5StartRow[] =>
  [0, 1, 2, 3, 4].map((i) => sr({ crashed: i < crashes, firstLapSeconds: i === 0 ? lap : null, ...over }));
/** Ten pairs built from per-pair functions. */
const tenPairs = (a4: (i: number) => E5StartRow[], a5: (i: number) => E5StartRow[]): E5PairRows[] =>
  Array.from({ length: 10 }, (_, i) => ({ seed: 2001 + i, a4: a4(i), a5: a5(i) }));
const ep = (label: E5EndpointResult['label'], harm5 = false, harm4 = false): E5EndpointResult => ({ label, harmExcludedForA5: harm5, harmExcludedForA4: harm4 });

describe('one endpoint label (negative favours A5 for both endpoints)', () => {
  it.each<[number, number, number, number, string]>([
    [-0.3, -0.5, -0.1, 0.25, 'favours-a5'],
    [-0.2, -0.5, -0.1, 0.25, 'no-clear-difference'], // interval clear of zero but the mean is below the meaningful difference
    [-0.3, -0.5, 0.1, 0.25, 'no-clear-difference'], // meaningful point estimate, interval includes zero
    [0.3, 0.1, 0.5, 0.25, 'favours-a4'],
    [0.2, 0.1, 0.5, 0.25, 'no-clear-difference'],
    [0, 0, 0, 0.25, 'no-clear-difference'],
  ])('mean %f, interval [%f, %f], delta %f is %s', (mean, lo, hi, delta, label) => {
    expect(classifyE5Endpoint(mean, lo, hi, delta)).toBe(label);
  });
});

describe('the per-circuit headline', () => {
  it.each<[string, E5EndpointResult, E5EndpointResult, string, RegExp]>([
    ['both endpoints favour A5', ep('favours-a5'), ep('favours-a5'), 'a5-net-benefit', /fewer collisions and A5 is faster/],
    ['both endpoints favour A4', ep('favours-a4'), ep('favours-a4'), 'a4-net-benefit', /A4 has fewer collisions and A4 is faster/],
    ['collisions favour A5 and lap-time harm to A5 is excluded', ep('favours-a5'), ep('no-clear-difference', true), 'a5-net-benefit', /harm to A5 is excluded/],
    ['lap time favours A5 and collision harm to A5 is excluded', ep('no-clear-difference', true), ep('favours-a5'), 'a5-net-benefit', /harm to A5 is excluded/],
    ['collisions favour A5 and the lap-time interval still allows a harm', ep('favours-a5'), ep('no-clear-difference', false, false), 'a5-partial', /fewer collisions; the lap-time effect is unresolved/],
    ['collisions favour A5 and lap time is inconclusive', ep('favours-a5'), ep('inconclusive'), 'a5-partial', /lap-time effect is unresolved/],
    ['lap time favours A5 and the collision interval allows a harm', ep('no-clear-difference'), ep('favours-a5'), 'a5-partial', /faster on matched starts; the collision effect is unresolved/],
    ['collisions favour A4, lap-time harm to A4 excluded (the mirror)', ep('favours-a4'), ep('no-clear-difference', false, true), 'a4-net-benefit', /harm to A4 is excluded/],
    ['collisions favour A4, lap-time harm to A4 not excluded (the mirror)', ep('favours-a4'), ep('no-clear-difference', true, false), 'a4-partial', /lap-time effect is unresolved/],
    ['collisions favour A5 but lap time favours A4', ep('favours-a5'), ep('favours-a4'), 'mixed', /fewer collisions; A4 is faster/],
    ['collisions favour A4 but lap time favours A5', ep('favours-a4'), ep('favours-a5'), 'mixed', /A5 is faster on matched starts; A4 has fewer collisions/],
    ['neither endpoint is clear', ep('no-clear-difference'), ep('no-clear-difference'), 'no-clear-difference', /not a statement of no effect or equivalence/],
    ['no clear collisions and lap time inconclusive', ep('no-clear-difference'), ep('inconclusive'), 'inconclusive', /too few eligible pairs/],
  ])('%s', (_name, collision, lapTime, headline, statement) => {
    const h = e5Headline(collision, lapTime);
    expect(h.headline).toBe(headline);
    expect(h.statement).toMatch(statement);
  });
  it('a harm flag on the OTHER agent never turns a partial into a net benefit', () => {
    expect(e5Headline(ep('favours-a5', false, true), ep('no-clear-difference', false, true)).headline).toBe('a5-partial');
  });
});

describe('the collision endpoint, analytically', () => {
  it('A5 crashes 2 of 5 starts and A4 5 of 5 for every pair: the difference is exactly -0.6 and favours A5', () => {
    const r = analyseE5Circuit(tenPairs(() => five(5), () => five(2)), SETTINGS) as Json;
    expect(r.collision.differences).toEqual(Array(10).fill(2 / 5 - 1));
    expect(r.collision.meanDifference).toBeCloseTo(-0.6, 12);
    expect(r.collision.interval[0]).toBeCloseTo(-0.6, 12);
    expect(r.collision.interval[1]).toBeCloseTo(-0.6, 12);
    expect(r.collision.label).toBe('favours-a5');
    expect(r.collision.pairsA5Fewer).toBe(10);
  });
  it('exactly the meaningful difference (one start in five, which is 0.19999999999999996 in floating point) meets it; a smaller one does not', () => {
    const r = analyseE5Circuit(tenPairs(() => five(3), () => five(2)), SETTINGS) as Json; // -0.2, every pair
    expect(r.collision.meanDifference).toBeCloseTo(-0.2, 12);
    expect(r.collision.label).toBe('favours-a5');
    const smaller = analyseE5Circuit(tenPairs((i) => five(i % 2 === 0 ? 3 : 2), (i) => five(i % 2 === 0 ? 2 : 2)), SETTINGS) as Json; // mean -0.1
    expect(smaller.collision.label).toBe('no-clear-difference');
  });
  it('the mirror: A4 with fewer crashes favours A4', () => {
    const r = analyseE5Circuit(tenPairs(() => five(1), () => five(4)), SETTINGS) as Json;
    expect(r.collision.label).toBe('favours-a4');
  });
  it('all champions crash on every start: the collision difference is zero and nothing is inferred', () => {
    const r = analyseE5Circuit(tenPairs(() => five(5), () => five(5)), SETTINGS) as Json;
    expect(r.collision.meanDifference).toBe(0);
    expect(r.collision.label).toBe('no-clear-difference');
  });
});

describe('the lap-time endpoint, analytically (matched starts, eligibility, no imputation)', () => {
  /** A pair where both complete a lap on start 0 only: A4 at `t4`, A5 at `t4 + d`. */
  const lapPairs = (diffs: readonly (number | null)[], crashesA5 = 5, crashesA4 = 5): E5PairRows[] =>
    diffs.map((d, i) => ({ seed: 2001 + i, a4: five(crashesA4, d === null ? null : 60), a5: five(crashesA5, d === null ? null : 60 + d) }));
  it('a constant 2 s faster A5 on the matched start: exactly -2 s, clear, with the eligible count shown', () => {
    const r = analyseE5Circuit(lapPairs(Array(10).fill(-2)), SETTINGS) as Json;
    expect(r.lapTime.eligiblePairs).toBe(10);
    expect(r.lapTime.differences).toEqual(Array(10).fill(-2));
    expect(r.lapTime.meanDifference).toBeCloseTo(-2, 12);
    expect(r.lapTime.label).toBe('favours-a5');
  });
  it('exactly 5 eligible pairs of 10 is inconclusive: no interval, no label beyond inconclusive, the pairs named', () => {
    const r = analyseE5Circuit(lapPairs([-2, -2, -2, -2, -2, null, null, null, null, null]), SETTINGS) as Json;
    expect(r.lapTime.eligiblePairs).toBe(5);
    expect(r.lapTime.label).toBe('inconclusive');
    expect(r.lapTime.interval).toBeNull();
    expect(r.lapTime.meanDifference).toBeNull();
    expect(r.lapTime.differences).toBeNull();
    expect(r.lapTime.excludedPairs).toEqual([2006, 2007, 2008, 2009, 2010]);
  });
  it('exactly 6 eligible pairs is decided', () => {
    const r = analyseE5Circuit(lapPairs([-2, -2, -2, -2, -2, -2, null, null, null, null]), SETTINGS) as Json;
    expect(r.lapTime.eligiblePairs).toBe(6);
    expect(r.lapTime.label).toBe('favours-a5');
    expect(r.lapTime.interval).not.toBeNull();
  });
  it('asymmetric completion counts: A4 completes 5 starts, A5 1 of the same: only the 1 matched start is used, the rest are named', () => {
    const a4 = [0, 1, 2, 3, 4].map((i) => sr({ firstLapSeconds: 60 + i, crashed: false }));
    const a5 = [0, 1, 2, 3, 4].map((i) => sr({ firstLapSeconds: i === 3 ? 70 : null, crashed: i !== 3 }));
    const r = analyseE5Circuit([{ seed: 1, a4, a5 }], { ...SETTINGS, minEligiblePairs: 1 }) as Json;
    const d = r.lapTime.pairDetails[0];
    expect(d.matchedStarts).toBe(1);
    expect(d.excludedStarts).toEqual({ a4OnlyCompleted: 4, a5OnlyCompleted: 0, neitherCompleted: 0 });
    expect(d.meanSecondsA4).toBe(63); // start 3 only, not the mean of all five of A4's laps
    expect(d.meanSecondsA5).toBe(70);
    expect(r.lapTime.meanDifference).toBe(7);
  });
  it('starts where neither completed a lap are excluded and counted; a pair with no matched start is ineligible with null times, never zero', () => {
    const pair: E5PairRows = { seed: 5, a4: five(5, 60, { }), a5: [sr({ firstLapSeconds: null }), sr({ firstLapSeconds: 50, crashed: false }), sr(), sr(), sr()] };
    const r = analyseE5Circuit([pair], { ...SETTINGS, minEligiblePairs: 1 }) as Json;
    const d = r.lapTime.pairDetails[0];
    expect(d.matchedStarts).toBe(0);
    expect(d.eligible).toBe(false);
    expect(d.meanSecondsA4).toBeNull();
    expect(d.meanSecondsA5).toBeNull();
    expect(d.excludedStarts).toEqual({ a4OnlyCompleted: 1, a5OnlyCompleted: 1, neitherCompleted: 3 });
    expect(r.lapTime.excludedPairs).toEqual([5]);
    expect(r.lapTime.label).toBe('inconclusive');
  });
  it('no champion completes any lap: inconclusive, every start counted as neither-completed', () => {
    const r = analyseE5Circuit(tenPairs(() => five(5), () => five(5)), SETTINGS) as Json;
    expect(r.lapTime.eligiblePairs).toBe(0);
    expect(r.lapTime.label).toBe('inconclusive');
    const total = (r.lapTime.pairDetails as { excludedStarts: { neitherCompleted: number } }[]).reduce((n, p) => n + p.excludedStarts.neitherCompleted, 0);
    expect(total).toBe(50);
  });
  it('a missing lap time on one side never enters the mean as zero: the mean uses only the matched starts', () => {
    const a4 = [sr({ firstLapSeconds: 60 }), sr({ firstLapSeconds: 62 }), sr(), sr(), sr()];
    const a5 = [sr({ firstLapSeconds: 58 }), sr({ firstLapSeconds: null }), sr(), sr(), sr()];
    const r = analyseE5Circuit([{ seed: 1, a4, a5 }], { ...SETTINGS, minEligiblePairs: 1 }) as Json;
    expect(r.lapTime.pairDetails[0].meanSecondsA4).toBe(60);
    expect(r.lapTime.pairDetails[0].meanSecondsA5).toBe(58);
  });
});

describe('combining the endpoints from rows (the harm bound by interval, not by a non-significant opposing endpoint)', () => {
  const pairsWith = (collision: 'a5-fewer' | 'a4-fewer' | 'none', lapDiffs: readonly number[] | 'none'): E5PairRows[] =>
    Array.from({ length: 10 }, (_, i) => {
      const c4 = collision === 'a5-fewer' ? 5 : collision === 'a4-fewer' ? 1 : 5;
      const c5 = collision === 'a5-fewer' ? 2 : collision === 'a4-fewer' ? 4 : 5;
      const d = lapDiffs === 'none' ? null : lapDiffs[i]!;
      return { seed: 2001 + i, a4: five(c4, d === null ? null : 60), a5: five(c5, d === null ? null : 60 + d) };
    });
  it('collisions favour A5 and the lap-time effect is clearly harmless (a narrow interval below +1 s): net benefit, harm excluded', () => {
    const r = analyseE5Circuit(pairsWith('a5-fewer', Array(10).fill(0.2)), SETTINGS) as Json;
    expect(r.collision.label).toBe('favours-a5');
    expect(r.lapTime.label).toBe('no-clear-difference');
    expect(r.harm.lapTimeForA5Excluded).toBe(true);
    expect(r.headline).toBe('a5-net-benefit');
  });
  it('the reviewer\'s example: collisions favour A5 but lap time is +1.5 s with a wide interval reaching beyond +1 s: only partial', () => {
    const r = analyseE5Circuit(pairsWith('a5-fewer', [-3, -2, -1, 0, 1, 2, 3, 4, 5, 6]), SETTINGS) as Json;
    expect(r.lapTime.meanDifference).toBeCloseTo(1.5, 12);
    expect(r.lapTime.interval[1]).toBeGreaterThan(E5_ENDPOINTS.lapTimeDeltaSeconds);
    expect(r.lapTime.interval[0]).toBeLessThan(0);
    expect(r.lapTime.label).toBe('no-clear-difference');
    expect(r.harm.lapTimeForA5Excluded).toBe(false);
    expect(r.headline).toBe('a5-partial');
    expect(r.statement).toMatch(/fewer collisions; the lap-time effect is unresolved/);
  });
  it('collisions favour A5 and lap time is inconclusive (no completed laps): partial, never a net benefit', () => {
    const r = analyseE5Circuit(pairsWith('a5-fewer', 'none'), SETTINGS) as Json;
    expect(r.lapTime.label).toBe('inconclusive');
    expect(r.headline).toBe('a5-partial');
  });
  it('both endpoints favour A5: net benefit', () => {
    const r = analyseE5Circuit(pairsWith('a5-fewer', Array(10).fill(-2)), SETTINGS) as Json;
    expect(r.headline).toBe('a5-net-benefit');
  });
  it('collisions favour A5 but A5 is clearly slower: mixed', () => {
    const r = analyseE5Circuit(pairsWith('a5-fewer', Array(10).fill(3)), SETTINGS) as Json;
    expect(r.lapTime.label).toBe('favours-a4');
    expect(r.headline).toBe('mixed');
  });
  it('the A4 mirror cases', () => {
    expect((analyseE5Circuit(pairsWith('a4-fewer', 'none'), SETTINGS) as Json).headline).toBe('a4-partial');
    expect((analyseE5Circuit(pairsWith('a4-fewer', Array(10).fill(2)), SETTINGS) as Json).headline).toBe('a4-net-benefit');
    expect((analyseE5Circuit(pairsWith('a4-fewer', Array(10).fill(-0.2)), SETTINGS) as Json).harm.lapTimeForA4Excluded).toBe(true);
    expect((analyseE5Circuit(pairsWith('a4-fewer', Array(10).fill(-0.2)), SETTINGS) as Json).headline).toBe('a4-net-benefit');
  });
  it('nothing clear: no-clear-difference when lap time is decided, inconclusive when it is not', () => {
    expect((analyseE5Circuit(pairsWith('none', Array(10).fill(0)), SETTINGS) as Json).headline).toBe('no-clear-difference');
    expect((analyseE5Circuit(pairsWith('none', 'none'), SETTINGS) as Json).headline).toBe('inconclusive');
  });
  it('is deterministic (the seeded bootstrap)', () => {
    const rows = pairsWith('a5-fewer', [-3, -2, -1, 0, 1, 2, 3, 4, 5, 6]);
    expect(canonicalJson(analyseE5Circuit(rows, SETTINGS))).toBe(canonicalJson(analyseE5Circuit(rows, SETTINGS)));
  });
  it('refuses an empty circuit and pairs with unequal starts', () => {
    expect(() => analyseE5Circuit([], SETTINGS)).toThrow(RangeError);
    expect(() => analyseE5Circuit([{ seed: 1, a4: five(0), a5: five(0).slice(0, 4) }], SETTINGS)).toThrow(/same, non-empty starts/);
  });
});

describe('the descriptive measures and the floor wording (no cause inferred from crashes)', () => {
  it('progress, crashes, lap completions and brake usage are counted factually per agent', () => {
    const a5 = [sr({ crashed: false, firstLapSeconds: 50, progress: 1, ticks: 100, brakeTicks: 10 }), sr({ progress: 0.5, ticks: 100, brakeTicks: 0 }), sr(), sr(), sr()];
    const r = analyseE5Circuit([{ seed: 1, a4: five(5), a5 }], { ...SETTINGS, minEligiblePairs: 1 }) as Json;
    expect(r.descriptive.a5.crashedStarts).toBe(4);
    expect(r.descriptive.a5.lapCompletedStarts).toBe(1);
    expect(r.descriptive.a5.progress.startsAtOrAboveOneLap).toBe(1);
    expect(r.descriptive.a5.brakeUsage).toMatchObject({ ticks: 500, brakeTicks: 10, championsThatBraked: 1 });
    expect(r.descriptive.a4.brakeUsage.brakeTicks).toBe(0);
  });
  it('REGRESSION: every start crashes but A5 progresses clearly farther: no floor is flagged and the progress difference is descriptive only', () => {
    const r = analyseE5Circuit(tenPairs(() => five(5, null, { progress: 0.1 }), () => five(5, null, { progress: 0.6 })), SETTINGS) as Json;
    expect(r.descriptive.progressMeanDifferenceA5MinusA4).toBeCloseTo(0.5, 12);
    expect(r.descriptive.lowProgressNoLaps).toBe(false);
    expect(r.collision.meanDifference).toBe(0);
    expect(r.headline).toBe('inconclusive'); // progress does not decide
    const report = renderE5Report({ ...fullAnalysis(), tracks: [{ trackId: 't', ...r }] });
    expect(report).not.toMatch(/floor effect/i);
    expect(report).not.toMatch(/likeliest|says nothing about the brake/i);
    expect(report).toMatch(/Crashed starts/);
  });
  it('a possible floor is mentioned only with low progress for both agents and no completed lap, as an untested possibility', () => {
    const r = analyseE5Circuit(tenPairs(() => five(5, null, { progress: 0.05 }), () => five(5, null, { progress: 0.1 })), SETTINGS) as Json;
    expect(r.descriptive.lowProgressNoLaps).toBe(true);
    const report = renderE5Report({ ...fullAnalysis(), tracks: [{ trackId: 't', ...r }] });
    expect(report).toMatch(/floor effect is a possibility that has not been tested here; the cause of a weak result is not established/);
    expect(report).not.toMatch(/likeliest/);
  });
});

const fullAnalysis = (): Json => analyseE5(manifest, E4_MANIFEST, E4_RECORDS, held, ENGINE, SPLITS) as Json;

describe('the analysis of a record', () => {
  const analysis = fullAnalysis();
  it('gives one block per held-out circuit with no pooled headline', () => {
    expect(analysis.tracks).toHaveLength(1);
    expect(analysis.pooledHeadline).toBeNull();
    expect(analysis.decisionRule).toBe(E5_DECISION_RULE);
    expect(analysis.label).toBe('mechanics');
    expect(analysis.evidence).toMatch(/MECHANICS ONLY/);
    expect(analysis.circuitsAgree).toBe(true);
    expect(analysis.startsPerChampion).toBe(5);
    const t = analysis.tracks[0];
    expect(t.collision.differences).toHaveLength(2);
    expect(['favours-a5', 'favours-a4', 'no-clear-difference']).toContain(t.collision.label);
    expect(t.lapTime.pairs).toBe(2);
    expect(t.lapTime.label).toBe('inconclusive'); // two pairs can never reach the six-pair minimum
    expect(t.descriptive.a4.brakeUsage.brakeTicks).toBe(0);
    expect(t.descriptive.a4.starts).toBe(10);
  });
  it('is a pure, deterministic function of the records, and its report states the rules and the limits without a p-value or an inferred cause', () => {
    const again = fullAnalysis();
    expect(e5AnalysisJson(again)).toBe(e5AnalysisJson(analysis));
    const report = renderE5Report(analysis);
    expect(report).toBe(renderE5Report(again));
    expect(report).toMatch(/MECHANICS ONLY/);
    expect(report).toMatch(/no pooled headline/i);
    expect(report).toMatch(/not independent of E4/);
    expect(report).toMatch(/not independent samples/);
    expect(report).toMatch(/pointwise per circuit/);
    expect(report).toMatch(/inconclusive/);
    expect(report).not.toMatch(/p-value|significant|learned to brake|likeliest/i);
  });
  it('refuses a record that does not belong to the manifest and records', () => {
    const bad = clone(held) as Json;
    bad.evaluations.pop();
    expect(() => analyseE5(manifest, E4_MANIFEST, E4_RECORDS, rehash(bad), ENGINE, SPLITS)).toThrow(StudyRecordError);
  });
  it('says the circuits give different headlines, and that there is no pooled headline, when they differ', () => {
    const disagree = clone(analysis) as Json;
    disagree.circuitsAgree = false;
    expect(renderE5Report(disagree)).toMatch(/different headlines.*no pooled headline/s);
  });
});

describe('the real committed E4 records can build the pins (Design A is feasible); nothing is evaluated on a held-out circuit', () => {
  const root = join(__dirname, '..', '..', 'experiments');
  const e4Manifest = JSON.parse(readFileSync(join(root, 'manifests', 'p2-09-e4.json'), 'utf8')) as unknown;
  const records = E4_SEEDS.map((s) => JSON.parse(gunzipSync(readFileSync(join(root, 'results', 'p2-09', 'e4', `seed-${s}.json.gz`))).toString('utf8')) as unknown);
  const realEngine = ((records[0] as Json).engine) as { name: string; version: string; v8: string };
  const pins = e5PairPins(e4Manifest, records, realEngine);
  it('pins ten pairs, seeds 2001 to 2010 in order, with twenty distinct A4 and A5 identities', () => {
    expect(pins.pairs.map((p) => p.seed)).toEqual([...E4_SEEDS]);
    expect(new Set(pins.pairs.flatMap((p) => [p.a4, p.a5])).size).toBe(20);
  });
  it('rebuilds the ten pairs from the real records through the strict E4 parser (read only: no evaluation)', () => {
    const loaded = readE5PairsFromE4(parseE4Manifest(e4Manifest), records, realEngine);
    expect(loaded).toHaveLength(10);
    expect(loaded.every((p) => p.a4.provenance.agent === 'A4' && p.a5.provenance.agent === 'A5')).toBe(true);
    expect(loaded.map((p) => p.a4.id)).toEqual(pins.pairs.map((p) => p.a4));
  });
  it('a confirmatory-shaped manifest that lists any of today\'s held-out circuits is refused as spent', () => {
    const m = {
      format: E5_MANIFEST_FORMAT, version: 1, id: 'p5-02-e5-shape-check', label: 'confirmatory', description: 'Shape check only: never frozen, never run.',
      e4: { manifestHash: pins.e4ManifestHash }, pairs: clone(pins.pairs), configuration: clone((e4Manifest as Json).configuration),
      tracks: { heldOut: [{ id: 'hairpin-chicane', contentHash: trackContentHash(loadTrack(hairpinChicane)) }], splitManifestHash: manifestRecord().hash },
      analysis: ANALYSIS(), authorisation: 'issue-34#shape-check', code: { revision: 'a'.repeat(40) },
    };
    expect(() => parseE5Manifest(m)).toThrow(/already exposed.*spent/);
  });
});
