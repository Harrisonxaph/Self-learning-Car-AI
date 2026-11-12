// P5-01 step 4b: the E3 study kind (src/training/e3Study.ts): manifest, seed / rules / held-out records, strict parsing, replay,
// the once-only held-out opening and the analysis. Tiny mechanics fixtures (seeds 75xx) and a SYNTHETIC held-out registry (a
// scaled copy of the oval under its own ID): no confirmatory seed (3001–3010) is run and no real held-out circuit is evaluated,
// so nothing here is a study result or evidence of learning.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import manifestData from '../../src/data/tracks/index.json';
import hairpinChicane from '../../src/data/tracks/hairpin-chicane.json';
import roundedRectangle from '../../src/data/tracks/rounded-rectangle.json';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { resolveBaselineConfig } from '../../src/training/baselines';
import {
  analyseE3,
  classifyE3,
  e3AnalysisJson,
  e3Contrast,
  e3HeldOutProtocol,
  e3ManifestHash,
  E3_BOOTSTRAP,
  E3_DECISION_RULE,
  E3_HELDOUT_FORMAT,
  E3_MANIFEST_FORMAT,
  E3_SEEDS,
  ledgerFromHeldOutRecords,
  parseE3HeldOutRecord,
  parseE3Manifest,
  parseE3RulesRecord,
  parseE3SeedRecord,
  renderE3Report,
  replayE3HeldOutRecord,
  replayE3RulesRecord,
  replayE3SeedRecord,
  ruleIds,
  runE3HeldOut,
  runE3Rules,
  runE3Seed,
  type E3Manifest,
} from '../../src/training/e3Study';
import { createHeldOutGate, createMemoryLedger, HeldOutAccessError } from '../../src/training/heldOutAccess';

import { canonicalJson, manifestRecord } from '../../src/training/experiment';
import { E4_DELTA } from '../../src/training/e4Study';
import { hashOf, METRIC, StudyCompatibilityError, StudyManifestError, StudyRecordError, type StudyContext } from '../../src/training/study';
import { freezeModel, loadTrackSplits, trackContentHash, trainingTrack, validationTrack } from '../../src/training/trackSplits';
import { loadTrack } from '../../src/sim/track';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

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
const FILES = { 'stadium-oval.json': stadiumOval, 'rounded-rectangle.json': roundedRectangle, 'synthetic.json': scaledOval };
const SPLITS = loadTrackSplits(
  {
    ...manifestData,
    tracks: [
      { id: 'stadium-oval', version: '1', split: 'training', file: 'stadium-oval.json', contentHash: trackContentHash(loadTrack(stadiumOval)), description: 'training' },
      { id: 'rounded-rectangle', version: '1', split: 'validation', file: 'rounded-rectangle.json', contentHash: trackContentHash(loadTrack(roundedRectangle)), description: 'validation' },
      { id: 'synthetic-held-out', version: '1', split: 'held-out', file: 'synthetic.json', contentHash: trackContentHash(loadTrack(scaledOval)), description: 'held-out' },
    ],
  },
  FILES,
);
const HELD = 'synthetic-held-out';

const P = 3;
const G = 2;
const trainingBlock = () => {
  const { setup } = resolveBaselineConfig({ training: { populationSize: P, eliteCount: 1, maxEpisodeSeconds: 3, stallSeconds: 1 }, generations: G, trackId: 'stadium-oval' }, 0);
  return Object.fromEntries(Object.entries(setup.config).filter(([key]) => key !== 'seed' && key !== 'brakeEnabled'));
};
const MANIFEST = (): Json => ({
  format: E3_MANIFEST_FORMAT,
  version: 1,
  id: 'mechanics-e3',
  label: 'mechanics',
  description: 'Tiny mechanics fixture for the E3 tests.',
  seeds: [7501, 7502],
  configuration: { generations: G, training: trainingBlock() },
  tracks: {
    training: { id: 'stadium-oval', contentHash: trackContentHash(trainingTrack('stadium-oval', SPLITS)) },
    validation: { id: 'rounded-rectangle', contentHash: trackContentHash(validationTrack('rounded-rectangle', SPLITS)) },
    heldOut: [{ id: HELD, contentHash: trackContentHash(loadTrack(scaledOval)) }],
    splitManifestHash: manifestRecord(SPLITS).hash,
  },
  rules: ruleIds(),
  analysis: { metric: METRIC, delta: E4_DELTA, bootstrap: { ...E3_BOOTSTRAP }, decisionRule: E3_DECISION_RULE },
  authorisation: 'issue-33#mechanics',
  code: { revision: null },
});
const ENGINE = { name: 'node', version: process.version, v8: process.versions.v8 };
const CONTEXT: StudyContext = { engine: ENGINE, source: { revision: null, dirty: null, unavailableReason: 'test fixture', appVersion: '0.0.0' }, recordedAt: '2026-11-12T00:00:00Z' };

const manifest = MANIFEST();
const seed1 = runE3Seed(manifest, 7501, CONTEXT, SPLITS);
const seed2 = runE3Seed(manifest, 7502, CONTEXT, SPLITS);
const rules = runE3Rules(manifest, CONTEXT, SPLITS);
const seedRecords = [seed1, seed2];
const newGate = (ledger = createMemoryLedger()) => createHeldOutGate(e3HeldOutProtocol(manifest, seedRecords, SPLITS), ledger, SPLITS);
const ledger = createMemoryLedger();
const held = runE3Held(ledger);
function runE3Held(l = createMemoryLedger()) {
  return runE3HeldOut(manifest, seedRecords, rules, newGate(l), CONTEXT, SPLITS);
}

describe('the manifest', () => {
  it('parses the fixture and hashes it', () => {
    expect(parseE3Manifest(manifest, SPLITS).id).toBe('mechanics-e3');
    expect(e3ManifestHash(manifest as E3Manifest)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
  it.each<[string, (m: Json) => void, RegExp]>([
    ['an unknown field', (m) => { m.extra = 1; }, /unknown field/],
    ['a missing field', (m) => { delete m.code; }, /missing|incomplete/],
    ['a wrong delta', (m) => { m.analysis.delta = 0.5; }, /delta/],
    ['another bootstrap', (m) => { m.analysis.bootstrap.resamples = 5; }, /bootstrap/],
    ['a reserved seed in a mechanics manifest', (m) => { m.seeds = [3001]; }, /reserved/],
    ['a repeated seed', (m) => { m.seeds = [7501, 7501]; }, /distinct/],
    ['brakeEnabled in the training block', (m) => { m.configuration.training.brakeEnabled = true; }, /brakeEnabled/],
    ['an incomplete training block', (m) => { delete m.configuration.training.mutation; }, /training/],
    ['a tampered rule identity', (m) => { m.rules.A3 = `sha256:${'0'.repeat(64)}`; }, /rules/],
    ['a held-out circuit that is not registered as held-out', (m) => { m.tracks.heldOut = [{ id: 'stadium-oval', contentHash: m.tracks.training.contentHash }]; }, /not a registered held-out/],
    ['a held-out circuit with the wrong hash', (m) => { m.tracks.heldOut[0].contentHash = `sha256:${'1'.repeat(64)}`; }, /contentHash/],
    ['a repeated held-out circuit', (m) => { m.tracks.heldOut.push({ ...m.tracks.heldOut[0] }); }, /distinct/],
    ['a held-out circuit without an authorisation', (m) => { m.authorisation = null; }, /authorisation/],
    ['an authorisation without a held-out circuit', (m) => { m.tracks.heldOut = []; }, /authorisation/],
    ['a wrong split manifest hash', (m) => { m.tracks.splitManifestHash = `sha256:${'2'.repeat(64)}`; }, /splitManifestHash/],
    ['a validation circuit as the training circuit', (m) => { m.tracks.training = { id: 'rounded-rectangle', contentHash: m.tracks.validation.contentHash }; }, /./],
  ])('refuses %s', (_name, mutate, pattern) => {
    const bad = MANIFEST();
    mutate(bad);
    expect(() => parseE3Manifest(bad, SPLITS)).toThrow(pattern);
  });
  it('refuses a mechanics manifest that lists a REAL held-out circuit on the built-in registry (mechanics never touches held-out data)', () => {
    const bad = MANIFEST();
    bad.tracks.heldOut = [{ id: 'hairpin-chicane', contentHash: trackContentHash(loadTrack(hairpinChicane)) }];
    bad.tracks.splitManifestHash = manifestRecord().hash;
    expect(() => parseE3Manifest(bad)).toThrow(StudyManifestError);
  });
  it('a confirmatory manifest needs exactly 3001 to 3010, a commit, and the built-in registry', () => {
    const bad = MANIFEST();
    bad.label = 'confirmatory';
    expect(() => parseE3Manifest(bad, SPLITS)).toThrow(StudyManifestError);
    expect(E3_SEEDS).toEqual([3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009, 3010]);
  });
});

describe('seed records (A5, validation circuit only)', () => {
  it('are deterministic and parse', () => {
    expect(runE3Seed(manifest, 7501, CONTEXT, SPLITS).resultsHash).toBe(seed1.resultsHash);
    expect(parseE3SeedRecord(seed1, manifest, ENGINE, SPLITS).seed).toBe(7501);
    expect((seed1.a5.model as Json).provenance).toMatchObject({ agent: 'A5', brakeEnabled: true, seed: 7501 });
  });
  it('refuse a seed the manifest does not list', () => {
    expect(() => runE3Seed(manifest, 9999, CONTEXT, SPLITS)).toThrow(StudyManifestError);
  });
  it.each<[string, (r: Json) => void, RegExp]>([
    ['a tampered model parameter', (r) => { r.a5.model.parameters[0] += 1; }, /model\.id|resultsHash/],
    ['a tampered validation episode', (r) => { r.a5.validation.gatesPassed += 1; }, /orderedProgress|fitness|resultsHash/],
    ['a stale resultsHash', (r) => { r.resultsHash = `sha256:${'3'.repeat(64)}`; }, /resultsHash/],
    ['a seed outside the manifest', (r) => { r.seed = 9999; }, /seed/],
    ['a wrong selection', (r) => { r.a5.selection = 'other'; }, /selection/],
    ['an unknown field', (r) => { r.extra = 1; }, /unknown field/],
    ['a wrong generation', (r) => { r.a5.generation = 0; }, /generation/],
  ])('refuse %s', (_name, mutate, pattern) => {
    const bad = clone(seed1) as Json;
    mutate(bad);
    expect(() => parseE3SeedRecord(bad, manifest, ENGINE, SPLITS)).toThrow(pattern);
  });
  it('refuse another manifest, another engine and other contracts as incompatible', () => {
    const other = MANIFEST();
    other.description = 'changed';
    expect(() => parseE3SeedRecord(seed1, other, ENGINE, SPLITS)).toThrow(StudyCompatibilityError);
    expect(() => parseE3SeedRecord(seed1, manifest, { ...ENGINE, version: 'other' }, SPLITS)).toThrow(StudyCompatibilityError);
    const bad = clone(seed1) as Json;
    bad.contracts.fitnessVersion = 99;
    expect(() => parseE3SeedRecord(bad, manifest, ENGINE, SPLITS)).toThrow(StudyCompatibilityError);
  });
  it('replay reproduces the evolution exactly', () => {
    const replay = replayE3SeedRecord(seed1, manifest, ENGINE, CONTEXT.source, SPLITS);
    expect(replay.identical).toBe(true);
    expect(replay.differences).toEqual([]);
  });
  it('contain no held-out data', () => {
    expect(JSON.stringify(seed1)).not.toContain(HELD);
  });
});

describe('the rules record', () => {
  it('parses, replays and pins the three rule agents', () => {
    expect(parseE3RulesRecord(rules, manifest, ENGINE, SPLITS).format).toContain('rules');
    expect(Object.keys(rules.agents)).toEqual(['A3', 'A3-nb', 'A3-nb-same']);
    expect(replayE3RulesRecord(rules, manifest, ENGINE, CONTEXT.source, SPLITS).identical).toBe(true);
    expect(runE3Rules(manifest, CONTEXT, SPLITS).resultsHash).toBe(rules.resultsHash);
  });
  it('refuses a tampered model id, episode or hash', () => {
    for (const mutate of [(r: Json) => { r.agents.A3.modelId = `sha256:${'4'.repeat(64)}`; }, (r: Json) => { r.agents['A3-nb'].validation.ticks += 1; }, (r: Json) => { r.resultsHash = `sha256:${'5'.repeat(64)}`; }]) {
      const bad = clone(rules) as Json;
      mutate(bad);
      expect(() => parseE3RulesRecord(bad, manifest, ENGINE, SPLITS)).toThrow(StudyRecordError);
    }
  });
});

describe('the held-out record: the one opening', () => {
  it('evaluates every frozen agent once on each listed circuit and records the opening', () => {
    expect(held.format).toBe(E3_HELDOUT_FORMAT);
    expect(held.evaluations).toHaveLength(1 * (2 + 3));
    expect(held.evaluations.map((e) => e.agent)).toEqual(['A5', 'A5', 'A3', 'A3-nb', 'A3-nb-same']);
    expect(held.opening).toEqual(e3HeldOutProtocol(manifest, seedRecords, SPLITS));
    expect(held.opening.protocolHash).toBe(e3ManifestHash(manifest as E3Manifest));
    expect(ledger.openings()).toEqual([held.opening]); // the opening was claimed in the ledger the run was given
  });
  it('is deterministic, and parses', () => {
    expect(runE3Held().resultsHash).toBe(held.resultsHash);
    expect(parseE3HeldOutRecord(held, manifest, seedRecords, ENGINE, SPLITS).evaluations).toHaveLength(5);
  });
  it('the opening is claimed in the ledger: a second run on the same ledger is refused', () => {
    const shared = createMemoryLedger();
    runE3Held(shared);
    expect(shared.openings()).toHaveLength(1);
    expect(() => runE3Held(shared)).toThrow(/already been opened/);
  });
  it('a gate restored from the recorded opening refuses (restart)', () => {
    const restored = ledgerFromHeldOutRecords([clone(held)]);
    expect(() => runE3Held(restored)).toThrow(/already been opened/);
  });
  it('refuses a gate made for another protocol, and incomplete or reordered seed records', () => {
    const other = createHeldOutGate({ ...e3HeldOutProtocol(manifest, seedRecords, SPLITS), authorisationId: 'someone-else' }, createMemoryLedger(), SPLITS);
    expect(() => runE3HeldOut(manifest, seedRecords, rules, other, CONTEXT, SPLITS)).toThrow(HeldOutAccessError);
    expect(() => runE3HeldOut(manifest, [seed1], rules, newGate(), CONTEXT, SPLITS)).toThrow(StudyRecordError);
    expect(() => runE3HeldOut(manifest, [seed2, seed1], rules, newGate(), CONTEXT, SPLITS)).toThrow(StudyRecordError);
  });
  it('refuses a gate made for another protocol hash BEFORE opening it (nothing is claimed)', () => {
    const shared = createMemoryLedger();
    const other = createHeldOutGate({ ...e3HeldOutProtocol(manifest, seedRecords, SPLITS), protocolHash: `sha256:${'9'.repeat(64)}` }, shared, SPLITS);
    expect(() => runE3HeldOut(manifest, seedRecords, rules, other, CONTEXT, SPLITS)).toThrow(/not made for this study/);
    expect(shared.openings()).toEqual([]);
    expect(other.opened).toBe(false);
  });
  it('refuses to run before the rules record is valid', () => {
    const bad = clone(rules) as Json;
    bad.resultsHash = `sha256:${'6'.repeat(64)}`;
    expect(() => runE3HeldOut(manifest, seedRecords, bad, newGate(), CONTEXT, SPLITS)).toThrow(StudyRecordError);
  });
  it('a refused run does not consume the opening (it fails before opening the gate)', () => {
    const shared = createMemoryLedger();
    const gate = newGate(shared);
    expect(() => runE3HeldOut(manifest, [seed1], rules, gate, CONTEXT, SPLITS)).toThrow();
    expect(shared.openings()).toEqual([]);
    expect(gate.opened).toBe(false);
  });
  it.each<[string, (r: Json) => void, RegExp]>([
    ['a tampered episode', (r) => { r.evaluations[0].episode.gatesPassed += 1; }, /orderedProgress|fitness|resultsHash/],
    ['a swapped agent', (r) => { r.evaluations[0].agent = 'A3'; }, /agent/],
    ['a missing evaluation', (r) => { r.evaluations.pop(); }, /must hold/],
    ['a wrong opening', (r) => { r.opening.authorisationId = 'x'; }, /opening/],
    ['a stale resultsHash', (r) => { r.resultsHash = `sha256:${'7'.repeat(64)}`; }, /resultsHash/],
  ])('refuses %s', (_name, mutate, pattern) => {
    const bad = clone(held) as Json;
    mutate(bad);
    expect(() => parseE3HeldOutRecord(bad, manifest, seedRecords, ENGINE, SPLITS)).toThrow(pattern);
  });
  it('replay re-evaluates through a REPLAY gate and never touches the real ledger', () => {
    const real = createMemoryLedger();
    const record = runE3Held(real);
    const replay = replayE3HeldOutRecord(record, manifest, seedRecords, ENGINE, CONTEXT.source, SPLITS);
    expect(replay.identical).toBe(true);
    expect(real.openings()).toHaveLength(1);
  });
  it('is a plain separate kind: the module never reads held-out circuits by itself', () => {
    const code = readFileSync(join(__dirname, '../../src/training/e3Study.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const name of ['heldOutTrack', 'buildEvaluationSetup', 'createHeldOutEvaluationSetup', 'tracksIn']) expect(code).not.toMatch(new RegExp(`\\b${name}\\b`));
  });
});

describe('the analysis', () => {
  const analysis = analyseE3(manifest, seedRecords, rules, held, ENGINE, SPLITS);
  it('has the validation circuit and the held-out circuit, and is deterministic', () => {
    expect((analysis.tracks as Json[]).map((x) => x.trackId)).toEqual(['rounded-rectangle', HELD]);
    expect(e3AnalysisJson(analyseE3(manifest, seedRecords, rules, held, ENGINE, SPLITS))).toBe(e3AnalysisJson(analysis));
    expect(analysis.heldOutIncluded).toBe(true);
  });
  it('without a held-out record it has the validation circuit only and no held-out data', () => {
    const validationOnly = analyseE3(manifest, seedRecords, rules, null, ENGINE, SPLITS);
    expect((validationOnly.tracks as Json[]).map((x) => x.trackId)).toEqual(['rounded-rectangle']);
    expect(validationOnly.heldOutIncluded).toBe(false);
  });
  it('the mean difference is A5 minus the rule, by hand, on the validation circuit', () => {
    const validation = validationTrack('rounded-rectangle', SPLITS).gates.length;
    const a5 = seedRecords.map((r) => (r.a5.validation as Json).gatesPassed / validation);
    const rule = ((rules.agents as Json).A3.validation as Json).gatesPassed / validation;
    const mean = a5.reduce((s, v) => s + (v - rule), 0) / a5.length;
    const row = (analysis.tracks as Json[])[0]!;
    expect(row.contrasts.A3.meanDifference).toBeCloseTo(mean, 12);
    expect(row.contrasts.A3.seedsA5Higher + row.contrasts.A3.seedsTied + row.contrasts.A3.seedsRuleHigher).toBe(2);
    expect(row.agents.A5.n).toBe(2);
    expect(row.agents.A3.n).toBe(1);
  });
  it('e3Contrast: the difference is A5 minus the rule, with counts and a deterministic seed-cluster interval', () => {
    const analysisSettings = { delta: 0.25, bootstrap: E3_BOOTSTRAP };
    const high = e3Contrast([0.5, 0.9, 0.7], 0.3, analysisSettings);
    expect(high.meanDifference).toBeCloseTo(0.4, 12);
    expect([high.seedsA5Higher, high.seedsTied, high.seedsRuleHigher]).toEqual([3, 0, 0]);
    expect((high.interval as number[])[0]).toBeGreaterThan(0.19);
    expect(high.outcome).toBe('a5-higher');
    const low = e3Contrast([0.1, 0.2, 0.3], 0.8, analysisSettings);
    expect(low.meanDifference).toBeCloseTo(-0.6, 12);
    expect([low.seedsA5Higher, low.seedsTied, low.seedsRuleHigher]).toEqual([0, 0, 3]);
    expect(low.outcome).toBe('rule-higher');
    const tie = e3Contrast([0.4, 0.4], 0.4, analysisSettings);
    expect([tie.seedsA5Higher, tie.seedsTied, tie.seedsRuleHigher]).toEqual([0, 2, 0]);
    expect(tie.outcome).toBe('no-clear-difference');
    expect(e3Contrast([0.5, 0.9, 0.7], 0.3, analysisSettings)).toEqual(high);
  });
  it('classifies by the predeclared delta and the interval, never by the mean alone', () => {
    expect(classifyE3(0.3, 0.1, 0.5, 0.25)).toBe('a5-higher');
    expect(classifyE3(0.3, -0.1, 0.5, 0.25)).toBe('no-clear-difference');
    expect(classifyE3(0.1, 0.05, 0.2, 0.25)).toBe('no-clear-difference');
    expect(classifyE3(-0.3, -0.5, -0.1, 0.25)).toBe('rule-higher');
    expect(classifyE3(-0.1, -0.2, -0.05, 0.25)).toBe('no-clear-difference');
    expect(classifyE3(0.25, 0, 0.5, 0.25)).toBe('no-clear-difference');
  });
  it('refuses a held-out record from another study and renders an honest report', () => {
    expect(() => analyseE3(manifest, seedRecords, rules, { ...held, manifestHash: `sha256:${'8'.repeat(64)}` }, ENGINE, SPLITS)).toThrow();
    const report = renderE3Report(analysis);
    expect(report).toContain('supports no statement about learning');
    expect(report).toContain('A3-nb-same');
    expect(report).toContain('no clear difference');
    expect(renderE3Report(analysis)).toBe(report);
  });
  it('is canonical JSON', () => {
    expect(e3AnalysisJson(analysis)).toBe(`${canonicalJson(JSON.parse(JSON.stringify(analysis)))}\n`);
  });
});

describe('A5 network dimensions are checked before anything is accepted or opened', () => {
  const withParameters = (parameters: number[]): Json => {
    const bad = clone(seed1) as Json;
    bad.a5.model.parameters = parameters;
    bad.a5.model.id = freezeModel(parameters, bad.a5.model.provenance).id;
    bad.resultsHash = hashOf(bad.a5);
    return bad;
  };
  it.each([[[0]], [[...(seed1.a5.model as Json).parameters, 0]], [(seed1.a5.model as Json).parameters.slice(1)]])(
    'a consistent-hash record with %j parameters is refused by the parser',
    (parameters) => {
      expect(() => parseE3SeedRecord(withParameters(parameters), manifest, ENGINE, SPLITS)).toThrow(/not a usable A5 network/);
    },
  );
  it('the held-out run refuses it before the opening is claimed', () => {
    const shared = createMemoryLedger();
    const gate = newGate(shared);
    expect(() => runE3HeldOut(manifest, [withParameters([0]), seed2], rules, gate, CONTEXT, SPLITS)).toThrow(StudyRecordError);
    expect(shared.openings()).toEqual([]);
    expect(gate.opened).toBe(false);
  });
  it('a valid record still parses and replays', () => {
    expect(parseE3SeedRecord(seed1, manifest, ENGINE, SPLITS).seed).toBe(7501);
    expect(replayE3SeedRecord(seed1, manifest, ENGINE, undefined, SPLITS).identical).toBe(true);
  });
});

describe('the manifest\'s frozen source is enforced', () => {
  const A = 'a'.repeat(40);
  const B = 'b'.repeat(40);
  const at = (revision: string | null, dirty: boolean | null = revision === null ? null : false): StudyContext => ({
    ...CONTEXT,
    source: revision === null ? CONTEXT.source : { revision, dirty, unavailableReason: null, appVersion: '0.0.0' },
  });
  const pinned = (): Json => ({ ...MANIFEST(), code: { revision: A } });
  const pm = pinned();
  const p1 = runE3Seed(pm, 7501, at(A), SPLITS);
  const p2 = runE3Seed(pm, 7502, at(A), SPLITS);
  const pr = runE3Rules(pm, at(A), SPLITS);
  it('runs refuse another commit, a dirty tree and an unknown revision', () => {
    expect(() => runE3Seed(pm, 7501, at(B), SPLITS)).toThrow(/differs from the manifest's frozen commit/);
    expect(() => runE3Seed(pm, 7501, at(A, true), SPLITS)).toThrow(/modified/);
    expect(() => runE3Rules(pm, at(null), SPLITS)).toThrow(/unknown/);
    expect(p1.source.revision).toBe(A);
  });
  it.each<[string, (r: Json) => void]>([
    ['another commit', (r) => { r.source.revision = B; }],
    ['a dirty tree', (r) => { r.source.dirty = true; }],
  ])('the parsers refuse a seed or rules record from %s', (_name, mutate) => {
    const seed = clone(p1) as Json;
    mutate(seed);
    expect(() => parseE3SeedRecord(seed, pm, ENGINE, SPLITS)).toThrow(StudyRecordError);
    const rule = clone(pr) as Json;
    mutate(rule);
    expect(() => parseE3RulesRecord(rule, pm, ENGINE, SPLITS)).toThrow(StudyRecordError);
  });
  it('mixed-source records fail before the held-out opening is claimed', () => {
    const mixed = clone(p2) as Json;
    mixed.source.revision = B;
    const shared = createMemoryLedger();
    const gate = createHeldOutGate(e3HeldOutProtocol(pm, [p1, p2], SPLITS), shared, SPLITS);
    expect(() => runE3HeldOut(pm, [p1, mixed], pr, gate, at(A), SPLITS)).toThrow(/frozen commit/);
    const mixedRules = clone(pr) as Json;
    mixedRules.source.revision = B;
    expect(() => runE3HeldOut(pm, [p1, p2], mixedRules, gate, at(A), SPLITS)).toThrow(/frozen commit/);
    expect(() => runE3HeldOut(pm, [p1, p2], pr, gate, at(B), SPLITS)).toThrow(/frozen commit/);
    expect(shared.openings()).toEqual([]);
    expect(gate.opened).toBe(false);
  });
  it('matching clean records run, parse and replay (replay may report a different current source)', () => {
    const gate = createHeldOutGate(e3HeldOutProtocol(pm, [p1, p2], SPLITS), createMemoryLedger(), SPLITS);
    const record = runE3HeldOut(pm, [p1, p2], pr, gate, at(A), SPLITS);
    expect(parseE3HeldOutRecord(record, pm, [p1, p2], ENGINE, SPLITS).source.revision).toBe(A);
    const replay = replayE3HeldOutRecord(record, pm, [p1, p2], ENGINE, at(B).source, SPLITS);
    expect(replay.identical).toBe(true);
    expect(replay.sameSourceRevision).toBe(false);
  });
  it('a confirmatory manifest has no null pin to fall back on; an unpinned mechanics manifest imposes nothing', () => {
    expect(() => parseE3Manifest({ ...MANIFEST(), label: 'confirmatory', code: { revision: null } }, SPLITS)).toThrow();
    expect(runE3Seed(manifest, 7501, at(B), SPLITS).source.revision).toBe(B);
  });
});

describe('the analysis says what it is', () => {
  const analysis = analyseE3(manifest, seedRecords, rules, held, ENGINE, SPLITS);
  it('carries the label, the actual seed count and a mechanics-only notice', () => {
    expect(analysis.label).toBe('mechanics');
    expect(analysis.seedCount).toBe(2);
    expect(String(analysis.evidence)).toContain('MECHANICS ONLY');
    expect(String(analysis.evidence)).toContain('Not study evidence and not acceptance evidence');
  });
  it('the report prints the label and the real n, never a hardcoded ten', () => {
    const report = renderE3Report(analysis);
    expect(report).toContain('(mechanics)');
    expect(report).toContain('MECHANICS ONLY');
    expect(report).toContain('2 independent seeds');
    expect(report).not.toContain('Ten seeds');
    const one = renderE3Report({ ...analysis, seedCount: 1 });
    expect(one).toContain('1 independent seed ');
    expect(one).toContain('- 1 independent seed and');
  });
  it('a numerically positive mechanics contrast is still labelled mechanics', () => {
    const tracks = (analysis.tracks as Json[]).map((x) => ({ ...x, contrasts: Object.fromEntries(Object.entries(x.contrasts).map(([k, c]) => [k, { ...(c as Json), meanDifference: 0.9, interval: [0.8, 1], outcome: 'a5-higher' }])) }));
    const report = renderE3Report({ ...analysis, tracks });
    expect(report).toContain('a5-higher');
    expect(report).toContain('MECHANICS ONLY');
    expect(report.indexOf('MECHANICS ONLY')).toBeLessThan(report.indexOf('a5-higher'));
  });
});
