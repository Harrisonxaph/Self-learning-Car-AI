// P2-08 analysis and report (D1, docs/experiments/p2-08-step3-design.md §5 and §5.1). Statistics, eligibility and
// the decision rule are tested on synthetic per-seed summaries; the record summaries on one tiny mechanics record
// (seed 7341). Pilot and confirmatory manifests exist in memory only and are never run; nothing is written, and
// nothing here is a study result or evidence of learning.
import { describe, expect, it } from 'vitest';
import {
  acceptanceEligibility,
  analyseRecords,
  analyseSummaries,
  analysisJson,
  bootstrapMeanInterval,
  CLAIM,
  iqr,
  mean,
  median,
  quantile,
  renderReport,
  selectByValidation,
  StudyAnalysisError,
  summariseRecord,
  wilcoxonSignedRank,
  type EpisodeSummary,
  type SeedSummary,
} from '../../src/training/analysis';
import { resolveBaselineConfig } from '../../src/training/baselines';
import { canonicalJson } from '../../src/training/experiment';
import { AGENT_ORDER, BOOTSTRAP, currentStreams, DECISION_RULE, METRIC, runStudySeed, STUDY_MANIFEST_FORMAT, trackReferences, WILCOXON } from '../../src/training/study';
import { createRng } from '../../src/utils/rng';
import { sha256Hex } from '../../src/utils/sha256';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
// The analysis is plain JSON; the tests read it untyped.
const summaries = (...args: Parameters<typeof analyseSummaries>): Json => analyseSummaries(...args);
const records = (...args: Parameters<typeof analyseRecords>): Json => analyseRecords(...args);

const { setup } = resolveBaselineConfig({ training: { populationSize: 3, eliteCount: 1, maxEpisodeSeconds: 2, stallSeconds: 1 }, generations: 2, trackId: 'stadium-oval' }, 0);
const TRAINING = Object.fromEntries(Object.entries(setup.config).filter(([key]) => key !== 'seed'));
const manifest = (label: string, seeds: number[], change: (m: Json) => void = () => {}): Json => {
  const m: Json = {
    format: STUDY_MANIFEST_FORMAT,
    version: 1,
    id: `${label}-d1`,
    label,
    description: 'In-memory fixture for the D1 analysis tests; never run.',
    agents: [...AGENT_ORDER],
    seeds,
    configuration: { generations: 2, episodesPerTrack: label === 'mechanics' ? 2 : 3, holdTicks: 30, training: clone(TRAINING) },
    streams: currentStreams(),
    tracks: trackReferences('stadium-oval', 'rounded-rectangle'),
    metric: METRIC,
    analysis: { delta: 0.25, bootstrap: { ...BOOTSTRAP }, wilcoxon: WILCOXON, decisionRule: DECISION_RULE },
    code: { revision: label === 'mechanics' ? null : 'a'.repeat(40) },
  };
  change(m);
  return m;
};
const CONFIRMATORY_10 = Array.from({ length: 10 }, (_, i) => 1001 + i);

// A synthetic seed: every agent's episodes have the given progress; A5 and A8 on the training track are set apart.
const episode = (orderedProgress: number, lap = false, crashed = false): EpisodeSummary => ({
  outcome: crashed ? 'crashed' : lap ? 'completed' : 'stalled',
  orderedProgress,
  crashed,
  lapTicks: lap ? [1800] : [],
  fitness: orderedProgress * 100,
});
const synthetic = (seed: number, a5: number, a8: number, options: { a5Lap?: boolean; base?: number } = {}): SeedSummary => {
  const base = options.base ?? 0.1;
  const both = (training: EpisodeSummary[], validation: EpisodeSummary[] = training) => ({ training, validation });
  return {
    seed,
    episodes: {
      A1: both([episode(base), episode(base + 0.1)]),
      A7: both([episode(base), episode(base)]),
      A2: both([episode(base), episode(base + 0.05), episode(base + 0.1)]),
      A9: both([episode(base + 0.2)]),
      A8: both([episode(a8)], [episode(a8 / 2)]),
      A5: both([episode(a5, options.a5Lap ?? true)], [episode(a5 / 2, false, true)]),
    },
    a5Generations: [
      { best: seed % 7, mean: (seed % 7) / 2 },
      { best: (seed % 7) + 1, mean: (seed % 7) / 2 + 1 },
    ],
  };
};

describe('statistics', () => {
  it('computes means and type 7 quantiles by hand', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(quantile([1, 2, 3, 4, 5], 0.25)).toBe(2);
    expect(iqr([1, 2, 3, 4])).toEqual([1.75, 3.25]);
    expect(iqr([7])).toEqual([7, 7]);
    expect(() => mean([])).toThrow(RangeError);
  });

  it('matches an independent bootstrap re-implementation, with nearest ranks 250 and 9,750 of 10,000', () => {
    const values = [0.4, -0.1, 0.25, 0.9, 0.0, 0.35, 0.6, -0.2, 0.15, 0.5];
    const rng = createRng(20261028);
    const means: number[] = [];
    for (let b = 0; b < 10_000; b += 1) {
      let total = 0;
      for (let i = 0; i < values.length; i += 1) total += values[rng.int(0, values.length)]!;
      means.push(total / values.length);
    }
    means.sort((a, b) => a - b);
    expect(bootstrapMeanInterval(values, BOOTSTRAP)).toEqual({ lower: means[249], upper: means[9749] });
    expect(bootstrapMeanInterval(values, BOOTSTRAP)).toEqual(bootstrapMeanInterval(values, BOOTSTRAP));
    const { lower, upper } = bootstrapMeanInterval(values, BOOTSTRAP);
    expect(lower).toBeLessThanOrEqual(mean(values));
    expect(upper).toBeGreaterThanOrEqual(mean(values));
    expect(bootstrapMeanInterval([2, 2, 2], BOOTSTRAP)).toEqual({ lower: 2, upper: 2 });
  });

  it.each([
    ['all zero', [0, 0, 0], { m: 0, w: 0, p: 1, note: 'no non-zero differences' }],
    ['all positive (p = 2/2^m)', [1, 2, 3, 4], { m: 4, w: 10, p: 2 / 16, note: null }],
    ['a single non-zero difference', [0, 0.5, 0], { m: 1, w: 1, p: 1, note: null }],
    // |d| = 1, 1, 2: midranks 1.5, 1.5, 3; W = 1.5 - 1.5 + 3 = 3. The eight signed sums are ±6 (twice), ±3 (four
    // times) and 0 (twice), so |W| ≥ 3 in 6 of 8 assignments.
    ['tied absolute values and mixed signs', [1, -1, 2], { m: 3, w: 3, p: 6 / 8, note: null }],
    // |d| = 1, 2, 3, 4 with signs +, -, +, +: W = 1 - 2 + 3 + 4 = 6; |W| ≥ 6 in 6 of 16 assignments.
    ['mixed signs without ties', [1, -2, 3, 4], { m: 4, w: 6, p: 6 / 16, note: null }],
  ])('Wilcoxon: %s', (_, d, expected) => {
    expect(wilcoxonSignedRank(d)).toEqual(expected);
  });
});

describe('eligibility, decision and claim', () => {
  const strong = (seeds: number[]) => seeds.map((s) => synthetic(s, 1.5, 0.5));

  it('a complete 10-seed confirmatory cohort meeting every condition is the only case that makes the claim', () => {
    const analysis = summaries(manifest('confirmatory', CONFIRMATORY_10), strong(CONFIRMATORY_10));
    expect(analysis.acceptanceEligible).toBe(true);
    expect(analysis.n).toBe(10);
    expect(analysis.decision).toMatchObject({ result: 'supported', claim: CLAIM });
    expect(renderReport(analysis)).toContain(`**Claim:** ${CLAIM}`);
    expect(renderReport(analysis).split(CLAIM).length - 1).toBe(1);
  });

  it.each([
    ['the interval does not lie above 0', (s: number, i: number) => synthetic(s, i % 2 === 0 ? 1.5 : 0, i % 2 === 0 ? 0.5 : 1), 'intervalAboveZero'],
    ['the mean is below δ', (s: number) => synthetic(s, 0.7, 0.5), 'meanAtLeastDelta'],
    ['no A5 model completes a lap', (s: number) => synthetic(s, 1.5, 0.5, { a5Lap: false }), 'a5ValidLap'],
  ])('a confirmatory cohort is negative or inconclusive when %s', (_, make, failing) => {
    const analysis = summaries(manifest('confirmatory', CONFIRMATORY_10), CONFIRMATORY_10.map(make));
    expect(analysis.decision.result).toBe('negative or inconclusive');
    expect(analysis.decision.claim).toBeNull();
    expect(analysis.decision.conditions[failing]).toBe(false);
    expect(renderReport(analysis)).not.toContain(CLAIM);
  });

  it.each([
    ['a mechanics analysis (n = 1, d = [1])', manifest('mechanics', [7341]), [synthetic(7341, 1.5, 0.5)], 'mechanics analysis is acceptance-ineligible'],
    ['a pilot analysis (n = 3, d = [1, 1, 1])', manifest('pilot', [9001, 9002, 9003]), strong([9001, 9002, 9003]), 'pilot analysis is acceptance-ineligible'],
  ])('%s is not evaluated and makes no claim, whatever its numbers', (_, m, seedSummaries, reason) => {
    const analysis = summaries(m, seedSummaries);
    expect(Object.values(analysis.decision.conditions).every(Boolean)).toBe(true);
    expect(analysis.acceptanceEligible).toBe(false);
    expect(analysis.decision).toMatchObject({ result: `not evaluated: ${reason}`, claim: null });
    const report = renderReport(analysis);
    expect(report).toContain('**Acceptance eligible:** no');
    expect(report).not.toContain(CLAIM);
    expect(analysisJson(analysis)).not.toContain(CLAIM);
  });

  it('refuses a confirmatory cohort with a missing seed, and judges the wrong seed set ineligible', () => {
    expect(() => summaries(manifest('confirmatory', CONFIRMATORY_10), strong(CONFIRMATORY_10.slice(1)))).toThrow(/Missing records for seed\(s\) 1001/);
    const wrong = manifest('confirmatory', CONFIRMATORY_10);
    expect(acceptanceEligibility(wrong as never, CONFIRMATORY_10.slice(1)).eligible).toBe(false);
    expect(acceptanceEligibility(manifest('pilot', [9001]) as never, [9001]).eligible).toBe(false);
  });

  it('refuses duplicate and extra seeds', () => {
    const m = manifest('mechanics', [7341, 7342]);
    expect(() => summaries(m, [synthetic(7341, 1, 0), synthetic(7341, 1, 0), synthetic(7342, 1, 0)])).toThrow(/more than once/);
    expect(() => summaries(m, [synthetic(7341, 1, 0), synthetic(7342, 1, 0), synthetic(7343, 1, 0)])).toThrow(StudyAnalysisError);
  });
});

describe('summaries and outputs on synthetic seeds', () => {
  const m = manifest('mechanics', [7341, 7342, 7343]);
  const seeds = [synthetic(7341, 1, 0.5), synthetic(7342, 0.75, 0.5, { base: 0.2 }), synthetic(7343, 0.5, 0.5)];
  const analysis = summaries(m, seeds);

  it('pairs contrasts by seed, aggregates A1/A7/A2 within each seed, and keeps validation descriptive', () => {
    expect(analysis.primary.differences).toEqual([0.5, 0.25, 0]);
    expect(analysis.primary.mean).toBe(0.25);
    expect(analysis.primary.wilcoxon).toEqual({ m: 2, w: 3, p: 0.5, note: null });
    const validation = analysis.secondary.find((c: Json) => c.contrast === 'A5 - A8' && c.track === 'validation');
    expect(validation.differences).toEqual([0.25, 0.125, 0]);
    const a1 = analysis.secondary.find((c: Json) => c.contrast === 'A5 - A1' && c.track === 'training');
    expect(a1.differences.map((d: number) => +d.toFixed(10))).toEqual([0.85, 0.5, 0.35]);
    expect(analysis.agents.A2.training.progress.mean).toBeCloseTo((0.15 + 0.25 + 0.15) / 3, 12);
  });

  it('summarises laps, collisions, outcomes and first-lap times, with unavailable rather than zero', () => {
    expect(analysis.agents.A5.training.lapCompletion).toEqual({ episodes: 3, rate: 1 });
    expect(analysis.agents.A5.training.firstLapSeconds).toEqual({ mean: 30, episodes: 3 });
    expect(analysis.agents.A5.validation.collisions).toEqual({ episodes: 3, rate: 1 });
    expect(analysis.agents.A5.validation.outcomes).toEqual({ completed: 0, crashed: 3, stalled: 0, timeout: 0 });
    expect(analysis.agents.A1.training.firstLapSeconds).toEqual({ mean: null, episodes: 0 });
    expect(renderReport(analysis)).toContain('unavailable (0)');
  });

  it('summarises A5 by generation across seeds with the median and IQR', () => {
    // seed % 7 for 7341, 7342, 7343 is 5, 6, 0.
    expect(analysis.a5Generations[0]).toEqual({ generation: 0, best: { median: 5, iqr: [2.5, 5.5] }, mean: { median: 2.5, iqr: [1.25, 2.75] } });
    expect(analysis.a5Generations[1].best.median).toBe(6);
    expect(renderReport(analysis)).toContain('never evidence of learning');
  });

  it('is byte-identical on every run and states label, n, eligibility and decision first', () => {
    expect(analysisJson(summaries(m, seeds))).toBe(analysisJson(analysis));
    expect(renderReport(summaries(m, seeds))).toBe(renderReport(analysis));
    const top = renderReport(analysis).split('\n').slice(0, 8).join('\n');
    for (const text of ['**Label:** mechanics', '**Independent n (training seeds):** 3', '**Acceptance eligible:** no', '**Decision (p2-08-decision-v1):** not evaluated']) expect(top).toContain(text);
    expect(renderReport(analysis)).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(renderReport(analysis)).toContain('## Descriptive results (not tested, no claims)');
    for (const phrase of ['beats random driving', 'improves on selection alone', 'general driving ability is']) expect(renderReport(analysis)).not.toContain(phrase);
  });
});

describe('selectByValidation', () => {
  it('picks the highest mean validation progress, with the first listed (C0) winning ties', () => {
    expect(selectByValidation([{ id: 'C0', a5ValidationProgress: [0.5, 0.5] }, { id: 'C1', a5ValidationProgress: [0.6, 0.6] }])).toBe('C1');
    expect(selectByValidation([{ id: 'C0', a5ValidationProgress: [0.5] }, { id: 'C1', a5ValidationProgress: [0.25, 0.75] }, { id: 'C2', a5ValidationProgress: [0.4] }])).toBe('C0');
  });
});

describe('real mechanics records', () => {
  const ENGINE = { name: 'node', version: process.version, v8: process.versions.v8 };
  const CONTEXT = { engine: ENGINE, source: { revision: null, dirty: null, unavailableReason: 'test', appVersion: '0.0.0' }, recordedAt: '2026-11-01T23:00:00.000Z' };
  const m = manifest('mechanics', [7341]);
  const record = runStudySeed(m, 7341, CONTEXT);

  it('summarises a record: E, P and single episodes, and A5 by generation', () => {
    const s = summariseRecord(record as never);
    expect(s.episodes.A1.training).toHaveLength(2);
    expect(s.episodes.A2.validation).toHaveLength(3);
    expect(s.episodes.A5.training).toHaveLength(1);
    const a = record.agents as Json;
    expect(s.episodes.A5.training[0]!.orderedProgress).toBe(a.A5.generations[1][a.A5.index].training.orderedProgress);
    expect(s.episodes.A8.training[0]!.orderedProgress).toBe(a.A8.samples[a.A8.index].training.orderedProgress);
    expect(s.a5Generations).toHaveLength(2);
    expect(s.a5Generations[0]!.best).toBe(Math.max(...a.A5.generations[0].map((c: Json) => c.training.fitness.total)));
  });

  it('analyses a replayed record, and refuses one that does not replay identically', () => {
    const analysis = records(m, [clone(record)], ENGINE);
    expect(analysis.seeds).toEqual([7341]);
    expect(analysis.acceptanceEligible).toBe(false);
    const edited = clone(record) as Json;
    const sample = edited.agents.A8.samples[(edited.agents.A8.index + 1) % edited.agents.A8.samples.length].training;
    sample.outcome = sample.outcome === 'stalled' ? 'timeout' : 'stalled';
    edited.resultsHash = `sha256:${sha256Hex(canonicalJson(edited.agents))}`;
    expect(() => records(m, [edited], ENGINE)).toThrow(/does not replay identically/);
    expect(() => records(m, [], ENGINE)).toThrow(/Missing records/);
  });
});
