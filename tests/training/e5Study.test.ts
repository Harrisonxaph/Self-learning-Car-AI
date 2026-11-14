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
import { E4_BOOTSTRAP, E4_DECISION_RULE, E4_DELTA, E4_MANIFEST_FORMAT, runE4Seed, type E4Manifest } from '../../src/training/e4Study';
import { resolveBaselineConfig } from '../../src/training/baselines';
import { canonicalJson, manifestRecord } from '../../src/training/experiment';
import {
  analyseE5,
  classifyE5,
  e5AgentBlock,
  e5AnalysisJson,
  e5HeldOutProtocol,
  e5LedgerFromRecords,
  e5ManifestHash,
  e5PairedFirstLap,
  e5PairPins,
  E5_BOOTSTRAP,
  E5_DECISION_RULE,
  E5_HELDOUT_FORMAT,
  E5_MANIFEST_FORMAT,
  loadE5Pairs,
  parseE5HeldOutRecord,
  parseE5Manifest,
  renderE5Report,
  replayE5HeldOutRecord,
  runE5HeldOut,
  type E5HeldOutEvaluation,
} from '../../src/training/e5Study';
import { createHeldOutGate, createMemoryLedger, HeldOutAccessError } from '../../src/training/heldOutAccess';
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
  analysis: { metric: METRIC, delta: E4_DELTA, bootstrap: { ...E5_BOOTSTRAP }, decisionRule: E5_DECISION_RULE, brakeUsageThreshold: BRAKE_USAGE_THRESHOLD },
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
    ['a wrong delta', (m) => { m.analysis.delta = 0.5; }, /delta/],
    ['another bootstrap', (m) => { m.analysis.bootstrap.resamples = 5; }, /bootstrap/],
    ['another decision rule', (m) => { m.analysis.decisionRule = 'p5-01-e3-decision-v1'; }, /decisionRule/],
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
    // A manifest changed after pinning is still a valid manifest; the pairs check is what refuses it.
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
  it('evaluates each frozen champion once on each listed circuit, A4 then A5 per seed, with brake usage', () => {
    expect(held.format).toBe(E5_HELDOUT_FORMAT);
    expect(held.evaluations.map((e) => [e.agent, e.seed, e.trackId])).toEqual([
      ['A4', 7601, HELD], ['A5', 7601, HELD], ['A4', 7602, HELD], ['A5', 7602, HELD],
    ]);
    for (const e of held.evaluations) {
      expect(e.brakeUsage.ticks).toBe(e.episode.ticks);
      if (e.agent === 'A4') expect(e.brakeUsage.brakeTicks).toBe(0);
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
  it('replay names a changed evaluation', () => {
    const bad = clone(held) as Json;
    bad.evaluations[1].episode.gatesPassed += 0; // keep valid; change the brake count instead
    bad.evaluations[1].brakeUsage.brakeTicks = bad.evaluations[1].brakeUsage.brakeTicks === 0 ? 1 : 0;
    const replay = replayE5HeldOutRecord(rehash(bad), manifest, E4_MANIFEST, E4_RECORDS, ENGINE, undefined, SPLITS);
    expect(replay.identical).toBe(false);
    expect(replay.differences.join(' ')).toMatch(/brakeUsage/);
  });
  it.each<[string, (r: Json) => void, RegExp, boolean]>([
    ['an unknown field', (r) => { r.extra = 1; }, /unknown field/, false],
    ['a wrong format', (r) => { r.format = 'x'; }, /format/, false],
    ['another manifest hash', (r) => { r.manifestHash = `sha256:${'6'.repeat(64)}`; }, /another manifest/, false],
    ['another opening (agents)', (r) => { r.opening.agentIds = [...r.opening.agentIds].reverse(); }, /opening/, true],
    ['another authorisation in the opening', (r) => { r.opening.authorisationId = 'other'; }, /opening/, true],
    ['a missing evaluation', (r) => { r.evaluations.pop(); }, /must hold 4 evaluations/, true],
    ['evaluations in another order', (r) => { r.evaluations.reverse(); }, /agent, seed, model, circuit/, true],
    ['an A4 evaluation recording brake ticks', (r) => { r.evaluations[0].brakeUsage.brakeTicks = 1; }, /cannot brake/, true],
    ['brake ticks beyond the ticks', (r) => { r.evaluations[1].brakeUsage.brakeTicks = r.evaluations[1].episode.ticks + 1; }, /brakeTicks/, true],
    ['brake usage ticks that differ from the episode', (r) => { r.evaluations[1].brakeUsage.ticks += 1; }, /brakeUsage\.ticks/, true],
    ['an episode that is not the score of its own values', (r) => { r.evaluations[0].episode.fitness.total += 1; }, /fitness/, true],
    ['a progress that is not gates over the circuit', (r) => { r.evaluations[0].episode.orderedProgress = 0.123; }, /orderedProgress/, true],
    ['a stale results hash', (r) => { r.evaluations[0].episode.partialProgress = 0; }, /resultsHash|partialProgress|fitness/, false],
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

const ep = (over: Partial<{ crashed: boolean; gatesPassed: number; lapTicks: number[]; ticks: number }> = {}) => ({
  outcome: 'crashed', ticks: 100, gatesPassed: 0, lapTicks: [] as number[], crashed: true, partialProgress: 0, fitness: {}, orderedProgress: 0, ...over,
});
const row = (agent: 'A4' | 'A5', seed: number, over: Parameters<typeof ep>[0] = {}, brakeTicks = 0, ticks = 100): E5HeldOutEvaluation =>
  ({ agent, seed, modelId: `sha256:${'0'.repeat(64)}`, trackId: 't', episode: ep(over) as never, brakeUsage: { ticks, brakeTicks } });

describe('the decision wording', () => {
  it.each<[number, number, number, string]>([
    [0.3, 0.1, 0.5, 'a5-higher'],
    [0.2, 0.1, 0.5, 'no-clear-difference'], // interval clear of zero but below the meaningful difference
    [0.3, -0.1, 0.5, 'no-clear-difference'], // meaningful point estimate, interval includes zero
    [-0.3, -0.5, -0.1, 'a4-higher'],
    [-0.2, -0.5, -0.1, 'no-clear-difference'],
    [0, 0, 0, 'no-clear-difference'],
  ])('mean %f, interval [%f, %f] is %s', (mean, lo, hi, outcome) => {
    expect(classifyE5(mean, lo, hi, 0.25)).toBe(outcome);
  });
});

describe('the secondary measures, analytically', () => {
  const dt = 1 / 60;
  it('counts crashes, lap completions, medians and brake usage per agent', () => {
    const a5 = [row('A5', 1, { gatesPassed: 5, crashed: false, lapTicks: [] }, 10, 100), row('A5', 2, { gatesPassed: 10, crashed: true }, 0, 100)];
    const block = e5AgentBlock(a5, 10) as Json;
    expect(block.n).toBe(2);
    expect(block.progress).toEqual([0.5, 1]);
    expect(block.crashes).toBe(1);
    expect(block.lapCompletions).toBe(0);
    expect(block.brakeUsage).toEqual({ ticks: 200, brakeTicks: 10, fraction: 0.05, championsThatBraked: 1 });
  });
  it('first-lap time is only over pairs where both completed a lap, with each own count and the excluded pairs named', () => {
    const a4 = [row('A4', 1, { lapTicks: [600] }), row('A4', 2, { lapTicks: [] }), row('A4', 3, { lapTicks: [720] }), row('A4', 4, {})];
    const a5 = [row('A5', 1, { lapTicks: [540] }), row('A5', 2, { lapTicks: [660] }), row('A5', 3, { lapTicks: [] }), row('A5', 4, {})];
    const f = e5PairedFirstLap(a4, a5) as Json;
    expect(f.pairsWithBoth).toBe(1);
    expect(f.a4Completed).toBe(2);
    expect(f.a5Completed).toBe(2);
    expect(f.excludedPairs).toEqual([{ seed: 2, completed: 'A5 only' }, { seed: 3, completed: 'A4 only' }]);
    expect(f.meanSecondsA4).toBeCloseTo(600 * dt, 12);
    expect(f.meanSecondsA5).toBeCloseTo(540 * dt, 12);
    expect(f.meanDifferenceA5MinusA4).toBeCloseTo(-60 * dt, 12);
  });
  it('no pair where both completed a lap: the time is unavailable (null), never zero', () => {
    const f = e5PairedFirstLap([row('A4', 1, { lapTicks: [600] }), row('A4', 2, {})], [row('A5', 1, {}), row('A5', 2, { lapTicks: [500] })]) as Json;
    expect(f.pairsWithBoth).toBe(0);
    expect(f.meanSecondsA4).toBeNull();
    expect(f.meanSecondsA5).toBeNull();
    expect(f.meanDifferenceA5MinusA4).toBeNull();
    expect(f.excludedPairs).toHaveLength(2);
  });
  it('a pair where neither crashes nor completes a lap is not named as excluded', () => {
    expect((e5PairedFirstLap([row('A4', 1, {})], [row('A5', 1, {})]) as Json).excludedPairs).toEqual([]);
  });
});

describe('the analysis', () => {
  const analysis = analyseE5(manifest, E4_MANIFEST, E4_RECORDS, held, ENGINE, SPLITS) as Json;
  it('gives one block per held-out circuit with no pooled headline', () => {
    expect(analysis.tracks).toHaveLength(1);
    expect(analysis.pooledHeadline).toBeNull();
    expect(analysis.decisionRule).toBe(E5_DECISION_RULE);
    expect(analysis.label).toBe('mechanics');
    expect(analysis.evidence).toMatch(/MECHANICS ONLY/);
    expect(analysis.circuitsAgree).toBe(true);
    const track = analysis.tracks[0];
    expect(track.primary.differences).toHaveLength(2);
    expect(['a5-higher', 'a4-higher', 'no-clear-difference']).toContain(track.primary.outcome);
    expect(track.primary.seedsA5Higher + track.primary.seedsTied + track.primary.seedsA4Higher).toBe(2);
    expect(track.agents.A4.brakeUsage.brakeTicks).toBe(0);
  });
  it('is a pure, deterministic function of the records, and its report names the limits and states no p-value', () => {
    const again = analyseE5(manifest, E4_MANIFEST, E4_RECORDS, held, ENGINE, SPLITS);
    expect(e5AnalysisJson(again)).toBe(e5AnalysisJson(analysis));
    const report = renderE5Report(analysis);
    expect(report).toBe(renderE5Report(again));
    expect(report).toMatch(/MECHANICS ONLY/);
    expect(report).toMatch(/no pooled headline/i);
    expect(report).toMatch(/not independent of E4/);
    expect(report).toMatch(/looked at once before/);
    expect(report).toMatch(/pointwise per circuit/);
    expect(report).not.toMatch(/p-value|significant|learned to brake/i);
  });
  it('refuses a record that does not belong to the manifest and records', () => {
    const bad = clone(held) as Json;
    bad.evaluations.pop();
    expect(() => analyseE5(manifest, E4_MANIFEST, E4_RECORDS, rehash(bad), ENGINE, SPLITS)).toThrow(StudyRecordError);
  });
  it('says the circuits disagree, and that there is no pooled headline, when the labels differ', () => {
    const disagree = clone(analysis) as Json;
    disagree.circuitsAgree = false;
    expect(renderE5Report(disagree)).toMatch(/The circuits disagree/);
  });
  it('names a floor effect when every champion crashed', () => {
    const floor = clone(analysis) as Json;
    floor.tracks[0].allEpisodesCrashed = true;
    expect(renderE5Report(floor)).toMatch(/floor effect/);
  });
});

describe('the real committed E4 records can build the pins (Design A is feasible); nothing is evaluated on a held-out circuit', () => {
  const root = join(__dirname, '..', '..', 'experiments');
  const e4Manifest = JSON.parse(readFileSync(join(root, 'manifests', 'p2-09-e4.json'), 'utf8')) as unknown;
  const records = E4_SEEDS.map((s) => JSON.parse(gunzipSync(readFileSync(join(root, 'results', 'p2-09', 'e4', `seed-${s}.json.gz`))).toString('utf8')) as unknown);
  const realEngine = ((records[0] as Json).engine) as { name: string; version: string; v8: string };
  const pins = e5PairPins(e4Manifest, records, realEngine);
  const confirmatory = (): Json => ({
    format: E5_MANIFEST_FORMAT,
    version: 1,
    id: 'p5-02-e5-shape-check',
    label: 'confirmatory',
    description: 'Shape check only: never frozen, never run.',
    e4: { manifestHash: pins.e4ManifestHash },
    pairs: clone(pins.pairs),
    configuration: clone((e4Manifest as Json).configuration),
    tracks: { heldOut: [{ id: 'hairpin-chicane', contentHash: trackContentHash(loadTrack(hairpinChicane)) }], splitManifestHash: manifestRecord().hash },
    analysis: { metric: METRIC, delta: E4_DELTA, bootstrap: { ...E5_BOOTSTRAP }, decisionRule: E5_DECISION_RULE, brakeUsageThreshold: BRAKE_USAGE_THRESHOLD },
    authorisation: 'issue-34#shape-check',
    code: { revision: 'a'.repeat(40) },
  });
  it('pins ten pairs, seeds 2001 to 2010 in order, with distinct A4 and A5 identities', () => {
    expect(pins.pairs.map((p) => p.seed)).toEqual([...E4_SEEDS]);
    expect(new Set(pins.pairs.flatMap((p) => [p.a4, p.a5])).size).toBe(20);
  });
  it('a confirmatory-shaped manifest parses on the built-in registry and its pairs load', () => {
    const m = confirmatory();
    expect(parseE5Manifest(m).label).toBe('confirmatory');
    const loaded = loadE5Pairs(m, e4Manifest, records, realEngine);
    expect(loaded).toHaveLength(10);
    expect(loaded.every((p) => p.a4.provenance.agent === 'A4' && p.a5.provenance.agent === 'A5')).toBe(true);
    // The protocol it would open (not opened here): 20 agents on one circuit.
    expect(e5HeldOutProtocol(m, loaded).agentIds).toHaveLength(20);
  });
  it.each<[string, (m: Json) => void]>([
    ['a different configuration than C1', (m) => { m.configuration.generations = 50; }],
    ['a non-E4 seed list', (m) => { m.pairs = m.pairs.slice(0, 9); }],
    ['a missing revision', (m) => { m.code.revision = null; }],
    ['a training circuit listed as held-out', (m) => { m.tracks.heldOut = [{ id: 'stadium-oval', contentHash: trackContentHash(loadTrack(stadiumOval)) }]; }],
  ])('a confirmatory manifest with %s is refused', (_name, mutate) => {
    const m = confirmatory();
    mutate(m);
    expect(() => parseE5Manifest(m)).toThrow(StudyManifestError);
  });
});
