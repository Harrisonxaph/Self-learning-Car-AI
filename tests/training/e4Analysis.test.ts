// P2-09 step 5: the E4 analysis and report (src/training/e4Analysis.ts): hand-computed paired differences, the exact
// Wilcoxon and bootstrap checks on synthetic data, the four outcome labels at their exact boundaries, the A4 brake-usage
// check, and the report. Synthetic summaries and a tiny mechanics fixture (seeds 74xx) only. A confirmatory manifest is
// parsed here but never run, and no seed in 2001–2010 is ever executed.
import { describe, expect, it } from 'vitest';
import { StudyAnalysisError } from '../../src/training/analysis';
import { BRAKE_USAGE_THRESHOLD } from '../../src/training/e4Agents';
import {
  analyseE4Records,
  analyseE4Summaries,
  classifyE4Outcome,
  e4AnalysisJson,
  e4OutcomeWording,
  E4_OUTCOME_IDS,
  renderE4Report,
  type E4Contrast,
  type E4SeedSummary,
} from '../../src/training/e4Analysis';
import { c1Training, E4_BOOTSTRAP, E4_DECISION_RULE, E4_DELTA, E4_MANIFEST_FORMAT, runE4Seed, type E4Manifest } from '../../src/training/e4Study';
import { resolveBaselineConfig } from '../../src/training/baselines';
import { canonicalJson } from '../../src/training/experiment';
import { currentStreams, E4_SEEDS, METRIC, trackReferences, WILCOXON, type StudyContext } from '../../src/training/study';
import { sha256Hex } from '../../src/utils/sha256';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
// The analysis is a plain JSON record; the tests read its fields by name.
const analyse = (...args: Parameters<typeof analyseE4Summaries>): Json => analyseE4Summaries(...args) as Json;
const analyseRecords = (...args: Parameters<typeof analyseE4Records>): Json => analyseE4Records(...args) as Json;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const OVAL_GATES = 20;
const RECT_GATES = 14;
const baseManifest = (): Json => ({
  format: E4_MANIFEST_FORMAT,
  version: 1,
  id: 'e4-analysis-fixture',
  label: 'confirmatory',
  description: 'A confirmatory-shaped fixture for the analysis tests. It is parsed, never run.',
  agents: ['A4', 'A5'],
  brake: { A4: false, A5: true },
  seeds: [...E4_SEEDS],
  configuration: { generations: 100, training: c1Training() },
  streams: currentStreams(),
  tracks: trackReferences('stadium-oval', 'rounded-rectangle'),
  metric: METRIC,
  analysis: { delta: E4_DELTA, bootstrap: { ...E4_BOOTSTRAP }, wilcoxon: WILCOXON, decisionRule: E4_DECISION_RULE, brakeUsageThreshold: BRAKE_USAGE_THRESHOLD },
  code: { revision: 'a'.repeat(40) },
});
const CONFIRMATORY = baseManifest() as unknown as E4Manifest;
const MECHANICS_10 = { ...baseManifest(), label: 'mechanics', id: 'e4-analysis-mechanics', seeds: Array.from({ length: 10 }, (_, i) => 7500 + i), code: { revision: null } } as unknown as E4Manifest;

const episode = (gatesPassed: number, extra: Partial<{ outcome: string; crashed: boolean; lapTicks: number[]; fitness: number }> = {}) => ({
  outcome: (extra.outcome ?? 'timeout') as 'timeout',
  gatesPassed,
  crashed: extra.crashed ?? false,
  lapTicks: extra.lapTicks ?? [],
  fitness: extra.fitness ?? gatesPassed * 10,
});
/** One summary per seed from the per-seed (A4 gates, A5 gates); the validation track uses the same gate counts. */
const summaries = (manifest: E4Manifest, pairs: readonly (readonly [number, number])[], options: { a5Brake?: number; a4Brake?: number } = {}): E4SeedSummary[] =>
  manifest.seeds.map((seed, i) => {
    const [a4, a5] = pairs[i]!;
    return {
      seed,
      gates: { training: OVAL_GATES, validation: RECT_GATES },
      episodes: {
        A4: { training: episode(a4), validation: episode(a4) },
        A5: { training: episode(a5), validation: episode(a5) },
      },
      brakeUsage: {
        A4: { training: { ticks: 100, brakeTicks: options.a4Brake ?? 0 }, validation: { ticks: 50, brakeTicks: 0 } },
        A5: { training: { ticks: 100, brakeTicks: options.a5Brake ?? 20 }, validation: { ticks: 50, brakeTicks: 10 } },
      },
    };
  });
/** Ten seeds whose A5 − A4 training difference is `diff` gates each (A4 at 10 gates). */
const constant = (diff: number): [number, number][] => Array.from({ length: 10 }, () => [10, 10 + diff]);
const primaryOf = (analysis: Json): E4Contrast => analysis.primary as E4Contrast;

describe('the four outcome labels, at their exact boundaries', () => {
  const label = (sum: number, lower: number, upper: number, n = 10, unitsPerLap = OVAL_GATES) => classifyE4Outcome({ sum, n, unitsPerLap, lower, upper }, 0.25);

  it('A5 meaningfully ahead: lower bound above 0 and the mean at least 0.25 lap (exactly 0.25 counts)', () => {
    // Ten differences of exactly +5 gates = +0.25 lap each: sum 50, δ × n × unitsPerLap = 0.25 × 10 × 20 = 50.
    expect(label(50, 5, 5).id).toBe(E4_OUTCOME_IDS.a5Meaningful);
    expect(label(60, 1, 11).id).toBe(E4_OUTCOME_IDS.a5Meaningful);
  });
  it('A4 meaningfully ahead: upper bound below 0 and the mean at most −0.25 lap (exactly −0.25 counts)', () => {
    expect(label(-50, -5, -5).id).toBe(E4_OUTCOME_IDS.a4Meaningful);
    expect(label(-60, -11, -1).id).toBe(E4_OUTCOME_IDS.a4Meaningful);
  });
  it('a direction below the threshold: ten differences of exactly +0.20 lap are not "no direction"', () => {
    const c = label(40, 4, 4); // +4 gates = +0.20 lap each
    expect(c.id).toBe(E4_OUTCOME_IDS.belowThreshold);
    expect(c.direction).toBe('A5');
    expect(c.wording).toBe('A5 reached more training-track progress than A4, but the difference is below the predeclared 0.25-lap meaningful threshold');
    const d = label(-40, -4, -4);
    expect(d.id).toBe(E4_OUTCOME_IDS.belowThreshold);
    expect(d.direction).toBe('A4');
    expect(d.wording).toBe('A4 reached more training-track progress than A5, but the difference is below the predeclared 0.25-lap meaningful threshold');
  });
  it('just below the threshold is below it, just at it is meaningful (one gate either side)', () => {
    expect(label(49, 4.9, 4.9).id).toBe(E4_OUTCOME_IDS.belowThreshold); // mean 4.9 gates = 0.245 lap
    expect(label(50, 4.9, 5.1).id).toBe(E4_OUTCOME_IDS.a5Meaningful);
    expect(label(-49, -4.9, -4.9).id).toBe(E4_OUTCOME_IDS.belowThreshold);
    expect(label(-50, -5.1, -4.9).id).toBe(E4_OUTCOME_IDS.a4Meaningful);
  });
  it('no direction when the interval spans zero, including an interval that touches zero', () => {
    expect(label(0, -3, 3).id).toBe(E4_OUTCOME_IDS.noDirection);
    expect(label(30, 0, 6).id).toBe(E4_OUTCOME_IDS.noDirection); // lower bound exactly 0 includes 0
    expect(label(-30, -6, 0).id).toBe(E4_OUTCOME_IDS.noDirection); // upper bound exactly 0 includes 0
    expect(label(0, 0, 0).id).toBe(E4_OUTCOME_IDS.noDirection);
    expect(label(0, 0, 0).direction).toBeNull();
    expect(label(0, 0, 0).wording).toBe('no direction established: the interval spans zero');
  });
  it('is exhaustive and exclusive: every sign and size combination gets exactly one label, and impossible ones refuse', () => {
    const ids = new Set<string>();
    for (const sum of [-100, -50, -49, -10, 0, 10, 49, 50, 100]) {
      for (const lower of [-8, -1, 0, 1, 8]) {
        for (const upper of [-8, -1, 0, 1, 8]) {
          if (lower > upper) continue;
          const consistent = !((lower > 0 && sum <= -50) || (upper < 0 && sum >= 50));
          if (consistent) ids.add(label(sum, lower, upper).id);
          else expect(() => label(sum, lower, upper)).toThrow(StudyAnalysisError);
        }
      }
    }
    expect([...ids].sort()).toEqual(Object.values(E4_OUTCOME_IDS).sort());
  });
  it('words the labels as the plan does', () => {
    expect(e4OutcomeWording(E4_OUTCOME_IDS.a5Meaningful, null)).toBe('A5 (braking) reached meaningfully more training-track progress than A4');
    expect(e4OutcomeWording(E4_OUTCOME_IDS.a4Meaningful, null)).toBe('A4 (no braking) reached meaningfully more training-track progress than A5');
  });
});

describe('the paired analysis on synthetic summaries (hand-computed)', () => {
  it('ten seeds all +5 gates (+0.25 lap): mean 0.25, interval [0.25, 0.25], exact Wilcoxon p = 2/1024, A5 meaningfully ahead', () => {
    const analysis = analyse(CONFIRMATORY, summaries(CONFIRMATORY, constant(5)));
    const primary = primaryOf(analysis);
    expect(primary.contrast).toBe('A5 - A4');
    expect(primary.track).toBe('training');
    expect(primary.units).toEqual(Array(10).fill(5));
    expect(primary.unitsPerLap).toBe(OVAL_GATES);
    expect(primary.mean).toBe(0.25);
    expect(primary.interval).toEqual({ lower: 0.25, upper: 0.25 });
    expect(primary.median).toBe(0.25);
    expect(primary.iqr).toEqual([0.25, 0.25]);
    // All ten differences positive and equal: W = 55, and only the all-positive and all-negative assignments are as extreme.
    expect(primary.wilcoxon).toEqual({ m: 10, w: 55, p: 2 / 1024, note: null });
    expect(analysis.outcome.label).toBe('a5-meaningful-advantage');
    expect(analysis.outcome.wording).toBe('A5 (braking) reached meaningfully more training-track progress than A4');
    expect(analysis.outcome.result).toBe('a5-meaningful-advantage');
    expect(analysis.reportable).toBe(true);
  });

  it('ten seeds all +4 gates (+0.20 lap) are "below threshold", with the direction', () => {
    const analysis = analyse(CONFIRMATORY, summaries(CONFIRMATORY, constant(4)));
    expect(primaryOf(analysis).mean).toBeCloseTo(0.2, 15);
    expect(analysis.outcome.label).toBe('below-threshold-direction');
    expect(analysis.outcome.direction).toBe('A5');
    expect(analysis.outcome.wording).toMatch(/below the predeclared 0\.25-lap meaningful threshold$/);
  });

  it('A4 ahead by 0.25 lap or more gives the A4 label; by less, the below-threshold label naming A4', () => {
    expect(analyse(CONFIRMATORY, summaries(CONFIRMATORY, constant(-5))).outcome.label).toBe('a4-meaningful-advantage');
    const smaller = analyse(CONFIRMATORY, summaries(CONFIRMATORY, constant(-3)));
    expect(smaller.outcome.label).toBe('below-threshold-direction');
    expect(smaller.outcome.direction).toBe('A4');
  });

  it('all-zero differences give no direction, with Wilcoxon p = 1 and no non-zero differences', () => {
    const analysis = analyse(CONFIRMATORY, summaries(CONFIRMATORY, constant(0)));
    expect(analysis.outcome.label).toBe('no-direction');
    expect(analysis.outcome.direction).toBeNull();
    expect(primaryOf(analysis).wilcoxon).toEqual({ m: 0, w: 0, p: 1, note: 'no non-zero differences' });
  });

  it('mixed signs: the per-seed differences, median and IQR are those of the integers, and the interval spans zero', () => {
    const diffs = [6, -2, 3, 0, -5, 7, 1, -1, 4, -3];
    const pairs = diffs.map((d): [number, number] => [10, 10 + d]);
    const primary = primaryOf(analyse(CONFIRMATORY, summaries(CONFIRMATORY, pairs)));
    expect(primary.units).toEqual(diffs);
    expect(primary.differences).toEqual(diffs.map((d) => d / OVAL_GATES));
    expect(primary.mean).toBe(10 / (10 * OVAL_GATES)); // Σ = 10 gates over 10 seeds: 0.05 lap
    // Sorted: −5 −3 −2 −1 0 1 3 4 6 7. Type 7 median = (0 + 1) / 2 = 0.5 gate; q1 at position 2.25 = −2 + 0.25 = −1.75; q3 at 6.75 = 3 + 0.75 = 3.75.
    expect(primary.median).toBe(0.5 / OVAL_GATES);
    expect(primary.iqr).toEqual([-1.75 / OVAL_GATES, 3.75 / OVAL_GATES]);
    expect(primary.interval.lower).toBeLessThan(0);
    expect(primary.interval.upper).toBeGreaterThan(0);
    expect(primary.wilcoxon.m).toBe(9); // the one zero is dropped
  });

  it('is deterministic: the same summaries give the same analysis and the same JSON text', () => {
    const a = analyse(CONFIRMATORY, summaries(CONFIRMATORY, constant(5)));
    const b = analyse(CONFIRMATORY, summaries(CONFIRMATORY, constant(5)));
    expect(e4AnalysisJson(a)).toBe(e4AnalysisJson(b));
    expect(e4AnalysisJson(a).endsWith('\n')).toBe(true);
    expect(renderE4Report(a)).toBe(renderE4Report(b));
  });

  it('puts the validation-track contrast alongside, descriptive only', () => {
    const analysis = analyse(CONFIRMATORY, summaries(CONFIRMATORY, constant(5)));
    const validation = analysis.validation as E4Contrast;
    expect(validation.track).toBe('validation');
    expect(validation.unitsPerLap).toBe(RECT_GATES);
    expect(validation.units).toEqual(Array(10).fill(5));
    expect(analysis.outcome.label).toBe('a5-meaningful-advantage'); // decided by the training track alone
    expect(canonicalJson(analysis.outcome)).not.toContain('validation');
  });

  it('is not a result for a mechanics manifest: the label is computed, but no outcome wording is reported', () => {
    const analysis = analyse(MECHANICS_10, summaries(MECHANICS_10, constant(5)));
    expect(analysis.reportable).toBe(false);
    expect(analysis.outcome.label).toBe('a5-meaningful-advantage');
    expect(analysis.outcome.wording).toBeNull();
    expect(analysis.outcome.result).toMatch(/^not evaluated: a mechanics analysis is a tooling check, not a result$/);
  });
});

describe('secondary and descriptive measures', () => {
  const lapped = (manifest: E4Manifest) =>
    manifest.seeds.map((seed, i): E4SeedSummary => {
      const base = summaries(manifest, constant(2))[i]!;
      // Seeds 0 and 1: both complete a lap (A4 in 1,000 ticks, A5 in 800); seed 2: only A5 does; the rest: neither.
      const a4Lap = i < 2 ? [1000] : [];
      const a5Lap = i < 3 ? [800] : [];
      return {
        ...base,
        episodes: {
          A4: { ...base.episodes.A4, training: episode(10, { lapTicks: a4Lap, outcome: a4Lap.length ? 'completed' : 'timeout', crashed: i === 9 }) },
          A5: { ...base.episodes.A5, training: episode(12, { lapTicks: a5Lap, outcome: a5Lap.length ? 'completed' : 'timeout' }) },
        },
      };
    });

  it('pairs first-lap times by seed, only where both agents completed a lap, with n', () => {
    const analysis = analyse(CONFIRMATORY, lapped(CONFIRMATORY));
    const training = analysis.firstLap.training;
    expect(training.seeds).toBe(2);
    expect(training.of).toBe(10);
    expect(training.differences).toHaveLength(2);
    for (const d of training.differences) expect(d).toBeCloseTo(-200 / 60, 12);
    expect(training.meanDifference).toBeCloseTo(-200 / 60, 12);
    expect(training.pairs.map((p: Json) => p.seed)).toEqual([2001, 2002]);
    expect(analysis.firstLap.validation.seeds).toBe(0);
    expect(analysis.firstLap.validation.meanDifference).toBeNull();
  });

  it('reports lap completion, collisions, terminal outcomes and mean progress per agent and track', () => {
    const agents = analyse(CONFIRMATORY, lapped(CONFIRMATORY)).agents;
    expect(agents.A4.training.lapCompletion).toEqual({ episodes: 2, rate: 0.2 });
    expect(agents.A5.training.lapCompletion).toEqual({ episodes: 3, rate: 0.3 });
    expect(agents.A4.training.collisions).toEqual({ episodes: 1, rate: 0.1 });
    expect(agents.A5.training.collisions).toEqual({ episodes: 0, rate: 0 });
    expect(agents.A4.training.outcomes).toEqual({ completed: 2, crashed: 0, stalled: 0, timeout: 8 });
    expect(agents.A5.training.outcomes).toEqual({ completed: 3, crashed: 0, stalled: 0, timeout: 7 });
    expect(agents.A4.training.progress.mean).toBe(10 / OVAL_GATES);
    expect(agents.A5.training.progress.mean).toBeCloseTo(12 / OVAL_GATES, 12);
    expect(agents.A5.training.firstLapSeconds.episodes).toBe(3);
    expect(agents.A5.training.firstLapSeconds.mean).toBeCloseTo(800 / 60, 12);
  });

  it('reports brake usage as the share of ticks, with A4 exactly 0', () => {
    const analysis = analyse(CONFIRMATORY, summaries(CONFIRMATORY, constant(5)));
    expect(analysis.brakeUsage.A4.training).toEqual({ ticks: 1000, brakeTicks: 0, share: 0, perSeed: Array(10).fill(0) });
    expect(analysis.brakeUsage.A5.training).toEqual({ ticks: 1000, brakeTicks: 200, share: 0.2, perSeed: Array(10).fill(0.2) });
    expect(analysis.brakeUsage.A5.validation.share).toBe(0.2);
    expect(analysis.a4BrakeTicksZero).toBe(true);
  });

  it('refuses an A4 that braked at all, on either track', () => {
    expect(() => analyse(CONFIRMATORY, summaries(CONFIRMATORY, constant(5), { a4Brake: 1 }))).toThrow(/A4 braked on the training track/);
    const onValidation = summaries(CONFIRMATORY, constant(5));
    (onValidation[3]!.brakeUsage.A4.validation as { brakeTicks: number }).brakeTicks = 2;
    expect(() => analyse(CONFIRMATORY, onValidation)).toThrow(/Seed 2004: A4 braked on the validation track/);
  });
});

describe('input checks', () => {
  it('refuses missing, duplicate and extra seeds, and different gate counts', () => {
    const all = summaries(CONFIRMATORY, constant(5));
    expect(() => analyse(CONFIRMATORY, all.slice(1))).toThrow(/Missing records for seed\(s\) 2001/);
    expect(() => analyse(CONFIRMATORY, [...all, all[0]!])).toThrow(/given more than once/);
    expect(() => analyse(CONFIRMATORY, [{ ...all[0]!, seed: 7 }, ...all.slice(1)])).toThrow(/not one of the manifest's seeds/);
    const odd = clone(all);
    (odd[4]!.gates as { training: number }).training = 21;
    expect(() => analyse(CONFIRMATORY, odd)).toThrow(/different number of gates/);
  });
});

describe('the report', () => {
  const report = renderE4Report(analyse(CONFIRMATORY, summaries(CONFIRMATORY, constant(5))));
  const mechanics = renderE4Report(analyse(MECHANICS_10, summaries(MECHANICS_10, constant(5))));

  it('states the outcome wording, the primary measure, the validation contrast and the brake usage', () => {
    expect(report).toContain('A5 (braking) reached meaningfully more training-track progress than A4');
    expect(report).toContain('## Primary measure (A5 − A4, training track)');
    expect(report).toContain('| A5 - A4 | training | 0.2500 | [0.2500, 0.2500] | 0.2500 | [0.2500, 0.2500] | 10 | 0.0020 |');
    expect(report).toContain('## Validation track (A5 − A4, descriptive: it decides nothing)');
    expect(report).toContain('| A4 | training | 0 / 1000 | 0.00% |');
    expect(report).toContain('| A5 | training | 200 / 1000 | 20.00% |');
    expect(report).toContain('A4 has its brake output masked, so its share is exactly 0');
  });

  it('explains what the weaker labels do not mean, and states its limits', () => {
    expect(report).toContain('does not mean "no effect" or "equivalent"');
    expect(report).toContain('no held-out track was evaluated');
    expect(report).toContain('not evidence that learned braking improves driving on unseen tracks');
  });

  it('reports nothing for a mechanics analysis, whatever the label', () => {
    expect(mechanics).toContain('**Reported as:** nothing (not a result)');
    expect(mechanics).not.toContain('reached meaningfully more training-track progress');
  });

  it('is deterministic text with no dates', () => {
    expect(report).not.toMatch(/20\d\d-\d\d-\d\d/);
    expect(report.endsWith('\n')).toBe(true);
  });
});

describe('analysing real records (a tiny mechanics fixture)', () => {
  const SMALL = { populationSize: 3, eliteCount: 1, maxEpisodeSeconds: 2, stallSeconds: 1 };
  const training = Object.fromEntries(
    Object.entries(resolveBaselineConfig({ training: SMALL, generations: 2, trackId: 'stadium-oval' }, 0).setup.config).filter(([key]) => key !== 'seed' && key !== 'brakeEnabled'),
  );
  const manifest = { ...baseManifest(), label: 'mechanics', id: 'e4-records-fixture', seeds: [7601, 7602], configuration: { generations: 2, training }, code: { revision: null } } as unknown as E4Manifest;
  const ENGINE = { name: 'node', version: process.version, v8: process.versions.v8 };
  const CONTEXT: StudyContext = {
    engine: ENGINE,
    source: { revision: null, dirty: null, unavailableReason: 'not a git checkout (test)', appVersion: '0.0.0' },
    recordedAt: '2026-11-03T20:00:00.000Z',
  };
  const records = manifest.seeds.map((seed) => runE4Seed(manifest, seed, CONTEXT));

  it('replays every record, then analyses them: n = 2, not reportable, A4 never braked', () => {
    const analysis = analyseRecords(manifest, records, ENGINE);
    expect(analysis.n).toBe(2);
    expect(analysis.seeds).toEqual([7601, 7602]);
    expect(analysis.reportable).toBe(false);
    expect(analysis.a4BrakeTicksZero).toBe(true);
    expect(analysis.brakeUsage.A4.training.brakeTicks).toBe(0);
    expect(analysis.brakeUsage.A5.training.ticks).toBeGreaterThan(0);
    expect(analysis.manifestHash).toBe(`sha256:${sha256Hex(canonicalJson(manifest))}`);
    expect(renderE4Report(analysis)).toContain('# P2-09 E4 analysis: e4-records-fixture');
    expect(analyseRecords(manifest, [...records].reverse(), ENGINE)).toEqual(analysis); // record order does not matter
  });

  it('refuses a record that does not replay identically, and a missing seed', () => {
    const edited = clone(records[0]!) as Json;
    const e = edited.agents.A5.generations[0][0].training;
    e.outcome = e.outcome === 'stalled' ? 'timeout' : 'stalled';
    edited.resultsHash = `sha256:${sha256Hex(canonicalJson(edited.agents))}`;
    expect(() => analyseRecords(manifest, [edited, records[1]], ENGINE)).toThrow(/does not replay identically/);
    expect(() => analyseRecords(manifest, [records[0]], ENGINE)).toThrow(/Missing records for seed\(s\) 7602/);
  });
});
