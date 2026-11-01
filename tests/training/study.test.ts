// P2-08 study formats (C1, docs/experiments/p2-08-step3-design.md §4): manifest validation, record building and
// strict parsing, corruption and compatibility, determinism, isolation and same-engine replay. Tiny in-memory
// mechanics fixtures with seeds 73xx only; no pilot or confirmatory manifest is run or written, and nothing here is
// a study result or evidence of learning.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveBaselineConfig } from '../../src/training/baselines';
import { canonicalJson } from '../../src/training/experiment';
import {
  AGENT_ORDER,
  BOOTSTRAP,
  currentStreams,
  DECISION_RULE,
  manifestHash,
  METRIC,
  parseStudyManifest,
  parseStudyRecord,
  replayStudyRecord,
  runStudySeed,
  STUDY_MANIFEST_FORMAT,
  StudyCompatibilityError,
  StudyManifestError,
  StudyRecordError,
  trackReferences,
  WILCOXON,
  type StudyContext,
  type StudyManifest,
  type StudyRecord,
} from '../../src/training/study';
import { TrackLeakageError } from '../../src/training/trackSplits';
import { sha256Hex } from '../../src/utils/sha256';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const rehash = (record: Json): Json => ({ ...record, resultsHash: `sha256:${sha256Hex(canonicalJson(record.agents))}` });

const SMALL = { populationSize: 3, eliteCount: 1, maxEpisodeSeconds: 2, stallSeconds: 1 };
const resolvedTraining = (overrides: object = SMALL) => {
  const { setup } = resolveBaselineConfig({ training: overrides, generations: 2, trackId: 'stadium-oval' }, 0);
  return Object.fromEntries(Object.entries(setup.config).filter(([key]) => key !== 'seed'));
};
const MANIFEST: StudyManifest = {
  format: STUDY_MANIFEST_FORMAT,
  version: 1,
  id: 'mechanics-c1',
  label: 'mechanics',
  description: 'Tiny mechanics fixture for the C1 tests.',
  agents: [...AGENT_ORDER],
  seeds: [7301, 7302, 7303],
  configuration: { generations: 2, episodesPerTrack: 2, holdTicks: 30, training: resolvedTraining() as StudyManifest['configuration']['training'] },
  streams: currentStreams(),
  tracks: trackReferences('stadium-oval', 'rounded-rectangle'),
  metric: METRIC,
  analysis: { delta: 0.25, bootstrap: { ...BOOTSTRAP }, wilcoxon: WILCOXON, decisionRule: DECISION_RULE },
  code: { revision: null },
};
const ENGINE = { name: 'node', version: process.version, v8: process.versions.v8 };
const CONTEXT: StudyContext = {
  engine: ENGINE,
  source: { revision: null, dirty: null, unavailableReason: 'not a git checkout (test)', appVersion: '0.0.0' },
  recordedAt: '2026-11-01T20:00:00.000Z',
};
const RECORD = runStudySeed(MANIFEST, 7301, CONTEXT);
const P = 3;
const G = 2;
const E = 2;
const withManifest = (change: (m: Json) => void): Json => {
  const m = clone(MANIFEST) as Json;
  change(m);
  return m;
};
const edit = (change: (r: Json) => void, hash = true): Json => {
  const r = clone(RECORD) as Json;
  change(r);
  return hash ? rehash(r) : r;
};

describe('mechanics fixtures only', () => {
  it('uses seeds outside the reserved pilot and confirmatory sets', () => {
    for (const seed of MANIFEST.seeds) expect((seed >= 1001 && seed <= 1020) || (seed >= 9001 && seed <= 9003)).toBe(false);
  });
});

describe('manifest', () => {
  it('accepts the complete mechanics fixture and hashes its canonical JSON', () => {
    expect(parseStudyManifest(clone(MANIFEST))).toEqual(MANIFEST);
    expect(manifestHash(MANIFEST)).toBe(`sha256:${sha256Hex(canonicalJson(MANIFEST))}`);
    expect(manifestHash(withManifest((m) => (m.analysis.delta = 0.3)) as StudyManifest)).not.toBe(manifestHash(MANIFEST));
  });

  it('accepts well-formed pilot and confirmatory manifests (parsed only, never run)', () => {
    const real = (label: string, seeds: number[]) =>
      withManifest((m) => {
        m.label = label;
        m.seeds = seeds;
        m.configuration.episodesPerTrack = P;
        m.code.revision = 'a'.repeat(40);
      });
    expect(() => parseStudyManifest(real('pilot', [9001, 9003]))).not.toThrow();
    expect(() => parseStudyManifest(real('confirmatory', Array.from({ length: 10 }, (_, i) => 1001 + i)))).not.toThrow();
    expect(() => parseStudyManifest(real('confirmatory', Array.from({ length: 20 }, (_, i) => 1001 + i)))).not.toThrow();
  });

  it.each([
    ['a missing field', (m: Json) => delete m.metric, /incomplete: manifest.metric/],
    ['an unknown top-level field', (m: Json) => (m.extra = 1), /unknown field "extra"/],
    ['an unknown training field', (m: Json) => (m.configuration.training.populationSise = 3), /unknown field "populationSise"/],
    ['an unknown nested fitness field', (m: Json) => (m.configuration.training.fitness.lapWieght = 1), /training.fitness has an unknown field "lapWieght"/],
    ['a missing nested field', (m: Json) => delete m.configuration.training.mutation.scale, /incomplete: .*mutation.scale/],
    ['another format', (m: Json) => (m.format = 'x'), /manifest.format/],
    ['another version', (m: Json) => (m.version = 2), /manifest.version/],
    ['a bad ID', (m: Json) => (m.id = 'Bad ID'), /manifest.id/],
    ['an unknown label', (m: Json) => (m.label = 'final'), /manifest.label/],
    ['agents in another order', (m: Json) => (m.agents = ['A7', 'A1', 'A2', 'A9', 'A8', 'A5']), /manifest.agents/],
    ['duplicate seeds', (m: Json) => (m.seeds = [7301, 7301]), /distinct/],
    ['no seeds', (m: Json) => (m.seeds = []), /non-empty/],
    ['a confirmatory seed in mechanics', (m: Json) => (m.seeds = [7301, 1005]), /reserved/],
    ['a pilot seed in mechanics', (m: Json) => (m.seeds = [9002]), /reserved/],
    ['zero generations', (m: Json) => (m.configuration.generations = 0), /generations/],
    ['zero episodes', (m: Json) => (m.configuration.episodesPerTrack = 0), /episodesPerTrack/],
    ['no elites', (m: Json) => (m.configuration.training.eliteCount = 0), /eliteCount/],
    ['an unresolvable setting', (m: Json) => (m.configuration.training.maxLaps = 2.5), /training is invalid/],
    ['other streams', (m: Json) => (m.streams.a8Stream = 'other'), /manifest.streams/],
    ['another metric', (m: Json) => (m.metric = 'fitness'), /manifest.metric/],
    ['δ below 0.25', (m: Json) => (m.analysis.delta = 0.2), /at least 0.25/],
    ['a non-finite δ', (m: Json) => (m.analysis.delta = Infinity), /finite/],
    ['other bootstrap settings', (m: Json) => (m.analysis.bootstrap.resamples = 1000), /bootstrap/],
    ['another Wilcoxon convention', (m: Json) => (m.analysis.wilcoxon = 'normal'), /wilcoxon/],
    ['another decision rule', (m: Json) => (m.analysis.decisionRule = 'x'), /decisionRule/],
    ['a malformed revision', (m: Json) => (m.code.revision = 'abc'), /revision/],
    ['a wrong track hash', (m: Json) => (m.tracks.training.contentHash = `sha256:${'0'.repeat(64)}`), /manifest.tracks/],
    ['a wrong split-manifest hash', (m: Json) => (m.tracks.splitManifestHash = `sha256:${'0'.repeat(64)}`), /manifest.tracks/],
  ])('rejects %s', (_label, change, message) => {
    expect(() => parseStudyManifest(withManifest(change))).toThrow(StudyManifestError);
    expect(() => parseStudyManifest(withManifest(change))).toThrow(message);
  });

  it.each([
    ['pilot seeds outside 9001–9003', 'pilot', [9001, 9004], P, 30, /subset of 9001–9003/],
    ['a partial confirmatory set', 'confirmatory', [1001, 1002], P, 30, /exactly 1001–1010 or 1001–1020/],
    ['a shuffled confirmatory set', 'confirmatory', [1002, 1001, 1003, 1004, 1005, 1006, 1007, 1008, 1009, 1010], P, 30, /exactly/],
    ['E ≠ P in a pilot', 'pilot', [9001], 2, 30, /E = P/],
    ['E ≠ P in a confirmatory study', 'confirmatory', Array.from({ length: 10 }, (_, i) => 1001 + i), 1, 30, /E = P/],
    ['another hold in a pilot', 'pilot', [9001], P, 15, /holdTicks 30/],
  ])('rejects %s', (_label, label, seeds, episodes, hold, message) => {
    const m = withManifest((x) => {
      x.label = label;
      x.seeds = seeds;
      x.configuration.episodesPerTrack = episodes;
      x.configuration.holdTicks = hold;
      x.code.revision = 'b'.repeat(40);
    });
    expect(() => parseStudyManifest(m)).toThrow(message);
  });

  it('requires a code revision outside mechanics', () => {
    const m = withManifest((x) => {
      x.label = 'pilot';
      x.seeds = [9001];
      x.configuration.episodesPerTrack = P;
    });
    expect(() => parseStudyManifest(m)).toThrow(/code.revision/);
  });

  it.each([
    ['the held-out track as validation', (m: Json) => (m.tracks.validation.id = 'hairpin-chicane')],
    ['the held-out track for training', (m: Json) => (m.tracks.training.id = 'hairpin-chicane')],
    ['the validation track for training', (m: Json) => (m.tracks.training.id = 'rounded-rectangle')],
    ['the training track as validation', (m: Json) => (m.tracks.validation.id = 'stadium-oval')],
  ])('refuses %s with TrackLeakageError', (_label, change) => {
    expect(() => parseStudyManifest(withManifest(change))).toThrow(TrackLeakageError);
  });
});

describe('records', () => {
  it('runs one seed into a record that parses, with every raw result and separate budgets', () => {
    expect(parseStudyRecord(clone(RECORD), MANIFEST, ENGINE)).toEqual(RECORD);
    expect(RECORD.manifestHash).toBe(manifestHash(MANIFEST));
    const a = RECORD.agents as Json;
    expect(a.A1.training).toHaveLength(E);
    expect(a.A2.candidates).toHaveLength(P);
    expect(a.A8.samples).toHaveLength(P * G);
    expect(a.A5.generations).toHaveLength(G);
    expect(a.A5.generations[0]).toEqual(a.A2.candidates);
    const b = RECORD.budgets as Json;
    expect(b.planned).toMatchObject({ evolutionEvaluations: P * G, a8Evaluations: P * G, episodesPerTrack: E });
    expect(b.actual).toEqual({ a5Evaluations: P * G, a8Evaluations: P * G, a2Evaluations: P, eliteReevaluations: G - 1 });
    expect(b.diversity.evaluations).toBe(P * G);
    expect(b.diversity.maxDistinctGenomes).toBe(P * G - (G - 1));
    expect(b.diversity.actualDistinctGenomes).toBeLessThanOrEqual(b.diversity.maxDistinctGenomes);
    expect(RECORD.evaluations).toEqual({ validation: 'descriptive', heldOut: 'none' });
  });

  it('refuses a seed the manifest does not list, and an invalid context', () => {
    expect(() => runStudySeed(MANIFEST, 7399, CONTEXT)).toThrow(/not one of the manifest's seeds/);
    expect(() => runStudySeed(MANIFEST, 7301, { ...CONTEXT, recordedAt: 'yesterday' })).toThrow(StudyRecordError);
    expect(() => runStudySeed(MANIFEST, 7301, { ...CONTEXT, source: { ...CONTEXT.source, revision: 'abc' } })).toThrow(StudyRecordError);
  });

  it('is deterministic: identical apart from recordedAt, alone or after other seeds; other seeds differ', () => {
    runStudySeed(MANIFEST, 7303, CONTEXT);
    const again = runStudySeed(MANIFEST, 7301, { ...CONTEXT, recordedAt: '2026-11-02T00:00:00Z' });
    expect(canonicalJson({ ...again, recordedAt: RECORD.recordedAt })).toBe(canonicalJson(RECORD));
    expect(runStudySeed(MANIFEST, 7302, CONTEXT).resultsHash).not.toBe(RECORD.resultsHash);
  });

  it('round-trips through JSON text at full precision', () => {
    const text = JSON.stringify(RECORD);
    expect(parseStudyRecord(JSON.parse(text), MANIFEST, ENGINE).resultsHash).toBe(RECORD.resultsHash);
  });
});

describe('record corruption', () => {
  const A8_LATE = P; // the first A8 sample after generation 0
  it.each([
    ['an unknown top-level field', (r: Json) => (r.extra = 1), /unknown field "extra"/],
    ['a missing field', (r: Json) => delete r.budgets, /incomplete: record.budgets/],
    ['a missing agent', (r: Json) => delete r.agents.A7, /incomplete: record.agents.A7/],
    ['an unknown episode field', (r: Json) => (r.agents.A2.validation[0].bonus = 1), /unknown field "bonus"/],
    ['a non-finite fitness', (r: Json) => (r.agents.A2.validation[0].fitness.total = Infinity), /finite/],
    ['a wrong-typed outcome', (r: Json) => (r.agents.A1.training[0].outcome = 'flew'), /outcome/],
    ['ticks beyond the episode limit', (r: Json) => (r.agents.A1.training[0].ticks = 10_000), /ticks must be an integer/],
    ['a wrong ordered progress', (r: Json) => (r.agents.A1.training[0].orderedProgress += 0.5), /orderedProgress/],
    ['a missing A1 episode', (r: Json) => r.agents.A1.validation.pop(), /must have 2 entries/],
    ['an extra A8 sample', (r: Json) => r.agents.A8.samples.push(r.agents.A8.samples[0]), /must have 6 entries/],
    ['a missing A5 generation', (r: Json) => r.agents.A5.generations.pop(), /must have 2 entries/],
    ['a candidate index out of place', (r: Json) => (r.agents.A8.samples[A8_LATE].index = 0), /index must be 3/],
    ['a malformed genome ID', (r: Json) => (r.agents.A2.candidates[0].genomeId = 'abc'), /genomeId/],
    ['A8 not starting with A2', (r: Json) => (r.agents.A8.samples[0].genomeId = `sha256:${'1'.repeat(64)}`), /must equal A2/],
    ['A5 generation 0 not A2', (r: Json) => (r.agents.A5.generations[0][1].genomeId = `sha256:${'2'.repeat(64)}`), /must equal A2/],
    ['a wrong action seed', (r: Json) => (r.agents.A7.validation[1].actionSeed += 1), /actionSeed/],
    ['another A7 hold', (r: Json) => (r.agents.A7.holdTicks = 7), /holdTicks/],
    ['a wrong A9 index', (r: Json) => (r.agents.A9.index = (r.agents.A9.index + 1) % 3), /A9.index/],
    ['a wrong A5 generation', (r: Json) => (r.agents.A5.generation = 0), /A5.generation/],
    ['a changed model parameter', (r: Json) => (r.agents.A5.model.parameters[0] += 1), /not the selected candidate's genome/],
    ['a short parameter list', (r: Json) => r.agents.A9.model.parameters.pop(), /parameters must have 159/],
    ['a forged model ID', (r: Json) => (r.agents.A8.model.id = `sha256:${'3'.repeat(64)}`), /id does not match/],
    ['changed provenance', (r: Json) => (r.agents.A9.model.provenance.seed = 1), /provenance/],
    ['another A8 stream', (r: Json) => (r.agents.A8.stream = 'x'), /A8.stream/],
    ['another planned budget', (r: Json) => (r.budgets.planned.a8Evaluations += 1), /record.budgets/],
    ['another actual count', (r: Json) => (r.budgets.actual.a5Evaluations -= 1), /record.budgets/],
    ['another diversity count', (r: Json) => (r.budgets.diversity.actualDistinctGenomes += 1), /record.budgets/],
    ['wrong ticks', (r: Json) => (r.budgets.ticks.A1.validation += 1), /record.budgets/],
    ['other evaluations', (r: Json) => (r.evaluations.heldOut = 'evaluated'), /record.evaluations/],
    ['a seed outside the manifest', (r: Json) => (r.seed = 7399), /not one of the manifest's seeds/],
  ])('rejects %s (resultsHash recomputed)', (_label, change, message) => {
    expect(() => parseStudyRecord(edit(change), MANIFEST, ENGINE)).toThrow(StudyRecordError);
    expect(() => parseStudyRecord(edit(change), MANIFEST, ENGINE)).toThrow(message);
  });

  it('rejects a result edited without updating resultsHash', () => {
    const r = edit((x) => (x.agents.A8.samples[A8_LATE].training.partialProgress += 0.01), false);
    expect(() => parseStudyRecord(r, MANIFEST, ENGINE)).toThrow(/resultsHash does not match/);
  });

  it.each([
    ['another engine version', (r: Json) => (r.engine.version = 'v22.0.0'), ENGINE, /engine version/],
    ['another V8', (r: Json) => (r.engine.v8 = '1.0'), ENGINE, /engine v8/],
    ['other physics', (r: Json) => (r.contracts.physics.maxSpeed += 1), ENGINE, /contracts.physics.maxSpeed/],
    ['another random-action algorithm', (r: Json) => (r.contracts.randomAction = 'x'), ENGINE, /contracts.randomAction/],
  ])('reports %s as incompatible', (_label, change, engine, message) => {
    expect(() => parseStudyRecord(edit(change), MANIFEST, engine)).toThrow(StudyCompatibilityError);
    expect(() => parseStudyRecord(edit(change), MANIFEST, engine)).toThrow(message);
  });

  it('reports a record for another manifest as incompatible', () => {
    const other = withManifest((m) => (m.analysis.delta = 0.3));
    expect(() => parseStudyRecord(clone(RECORD), other, ENGINE)).toThrow(StudyCompatibilityError);
  });

  it('rejects non-object input', () => {
    for (const bad of [null, [], 'record', 3]) expect(() => parseStudyRecord(bad, MANIFEST, ENGINE)).toThrow(StudyRecordError);
  });
});

describe('replay', () => {
  it('reproduces an unedited record exactly, and every frozen model alone', () => {
    const result = replayStudyRecord(clone(RECORD), MANIFEST, ENGINE, CONTEXT.source);
    expect(result).toEqual({ identical: true, differences: [], modelsReplayed: { A9: true, A8: true, A5: true }, sameSourceRevision: null });
  });

  it('detects a consistently edited result that passes parsing, naming its path', () => {
    const edited = edit((r) => (r.agents.A8.samples[P + 1].training.partialProgress += 0.01));
    expect(() => parseStudyRecord(edited, MANIFEST, ENGINE)).not.toThrow();
    const result = replayStudyRecord(edited, MANIFEST, ENGINE);
    expect(result.identical).toBe(false);
    expect(result.differences.join('\n')).toContain(`agents.A8.samples[${P + 1}].training.partialProgress`);
  });

  it('detects a consistently edited validation episode of a frozen model', () => {
    const edited = edit((r) => {
      r.agents.A5.validation.partialProgress += 0.01;
    });
    const result = replayStudyRecord(edited, MANIFEST, ENGINE);
    expect(result.identical).toBe(false);
    expect(result.differences.join('\n')).toContain('agents.A5.validation.partialProgress');
  });

  it('reports whether the source revision is the same, without rejecting a different one', () => {
    const recorded = runStudySeed(MANIFEST, 7302, { ...CONTEXT, source: { revision: 'c'.repeat(40), dirty: false, unavailableReason: null, appVersion: '0.0.0' } });
    const elsewhere = { revision: 'd'.repeat(40), dirty: false, unavailableReason: null, appVersion: '0.0.0' };
    expect(replayStudyRecord(recorded, MANIFEST, ENGINE, elsewhere)).toMatchObject({ identical: true, sameSourceRevision: false });
  });

  it('never writes the record or manifest it is given', () => {
    const record = clone(RECORD) as StudyRecord;
    const manifest = clone(MANIFEST);
    replayStudyRecord(record, manifest, ENGINE);
    expect(record).toEqual(RECORD);
    expect(manifest).toEqual(MANIFEST);
  });
});

describe('boundaries', () => {
  it('never references held-out accessors or unseeded randomness', () => {
    const code = readFileSync(join(__dirname, '../../src/training/study.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const name of ['heldOutTrack', 'tracksIn', 'selectByValidation', 'Math\\.random', 'Date']) expect(code).not.toMatch(new RegExp(`\\b${name}\\b`));
  });
});
