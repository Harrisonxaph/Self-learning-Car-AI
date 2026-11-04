// The committed P2-09 E4 results (plan step 7, experiments/results/p2-09/e4/). Integrity only, with no simulation: the ten
// gzip records are decompressed and checked against the SHA-256 values and the execution accounting in e4.md, parsed
// strictly against the committed manifest, and `analysis.json` and `report.md` are recomputed from them and must match
// byte for byte. No seed is run (a replay of one record takes about 7 minutes; the protocol's replay and analysis are
// run by `npm run e4`), and nothing here is a new result.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { analyseE4Summaries, e4AnalysisJson, e4OutcomeWording, E4_OUTCOME_IDS, renderE4Report, summariseE4Record, type E4SeedSummary } from '../../src/training/e4Analysis';
import { E4_AGENTS } from '../../src/training/e4Agents';
import { e4ManifestHash, parseE4Manifest, parseE4Record, type E4Record } from '../../src/training/e4Study';
import { E4_SEEDS } from '../../src/training/study';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ROOT = join(__dirname, '../..');
const DIR = join(ROOT, 'experiments/results/p2-09/e4');
const FROZEN_REVISION = '309606550957c01e9e199f7a06f676d62210add3';
const read = (name: string) => readFileSync(join(DIR, name), 'utf8');
const manifestInput = JSON.parse(readFileSync(join(ROOT, 'experiments/manifests/p2-09-e4.json'), 'utf8')) as Json;
const summary = read('e4.md');
const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

/** The Measurements table in e4.md: seed → [run s, replay s, car-ticks, raw bytes, gz bytes, sha256]. */
const table = new Map<number, { carTicks: number; raw: number; gz: number; sha: string }>();
for (const line of summary.split('\n')) {
  const m = /^\| (20\d\d) \| \d+ \| \d+ \| ([\d,]+) \| ([\d,]+) \| ([\d,]+) \| `([0-9a-f]{64})` \|$/.exec(line);
  if (m) table.set(Number(m[1]), { carTicks: Number(m[2]!.replace(/,/g, '')), raw: Number(m[3]!.replace(/,/g, '')), gz: Number(m[4]!.replace(/,/g, '')), sha: m[5]! });
}

describe('the committed E4 results folder', () => {
  it('holds exactly the ten gzip records, the analysis outputs and the summary', () => {
    expect(readdirSync(DIR).sort()).toEqual(['analysis.json', 'e4.md', 'report.md', ...E4_SEEDS.map((s) => `seed-${s}.json.gz`)].sort());
  });

  it('lists every seed in the Measurements table of e4.md', () => {
    expect([...table.keys()]).toEqual([...E4_SEEDS]);
  });
});

describe('the ten records', () => {
  const records = new Map<number, { record: E4Record; raw: Buffer }>();
  const summaries: E4SeedSummary[] = [];

  beforeAll(() => {
    const manifest = parseE4Manifest(manifestInput);
    for (const seed of E4_SEEDS) {
      const raw = gunzipSync(readFileSync(join(DIR, `seed-${seed}.json.gz`)));
      const parsedJson = JSON.parse(raw.toString('utf8')) as Json;
      // Parsed against the engine each record names: this checks the record, and does not need this machine's Node.
      const record = parseE4Record(parsedJson, manifest, parsedJson.engine);
      records.set(seed, { record, raw });
      summaries.push(summariseE4Record(record as unknown as { seed: number; agents: Json }, manifest));
    }
  }, 120_000);

  it('gunzip back to the bytes whose SHA-256 and sizes e4.md records', () => {
    for (const seed of E4_SEEDS) {
      const row = table.get(seed)!;
      expect(sha256(records.get(seed)!.raw)).toBe(row.sha);
      expect(records.get(seed)!.raw.length).toBe(row.raw);
      expect(statSync(join(DIR, `seed-${seed}.json.gz`)).size).toBe(row.gz);
    }
  });

  it('parse strictly against the committed manifest, and name the frozen commit, a clean worktree and Node v24.22.1', () => {
    const hash = e4ManifestHash(parseE4Manifest(manifestInput) as never);
    for (const seed of E4_SEEDS) {
      const { record } = records.get(seed)!;
      expect(record.seed).toBe(seed);
      expect(record.manifestHash).toBe(hash);
      expect(record.source).toEqual({ revision: FROZEN_REVISION, dirty: false, unavailableReason: null, appVersion: '0.0.0' });
      expect(record.engine).toEqual({ name: 'node', version: 'v24.22.1', v8: '13.6.233.17-node.58' });
      expect(record.evaluations).toEqual({ validation: 'descriptive', heldOut: 'none' });
    }
  });

  it('never mention the held-out track, and A4 never braked', () => {
    for (const seed of E4_SEEDS) {
      const { record, raw } = records.get(seed)!;
      expect(raw.toString('utf8')).not.toContain('hairpin');
      const agents = record.agents as Json;
      expect(agents.A4.brakeEnabled).toBe(false);
      expect(agents.A5.brakeEnabled).toBe(true);
      for (const track of ['training', 'validation']) expect(agents.A4.brakeUsage[track].brakeTicks).toBe(0);
    }
  });

  it('carry the equal search budget and the accounting that e4.md reports', () => {
    let search = 0;
    let validation = 0;
    let verification = 0;
    for (const seed of E4_SEEDS) {
      const budgets = records.get(seed)!.record.budgets as Json;
      expect(budgets.planned.evolutionEvaluations).toBe(5000);
      expect(budgets.actual.evaluations).toEqual({ A4: 5000, A5: 5000 });
      expect(budgets.actual.verificationEpisodes).toEqual({ A4: 1, A5: 1 });
      let total = 0;
      for (const agent of E4_AGENTS) {
        const t = budgets.ticks[agent] as Json;
        search += t.training;
        validation += t.validation;
        verification += t.verification;
        total += t.training + t.validation + t.verification;
      }
      expect(total).toBe(table.get(seed)!.carTicks);
    }
    const stated = (label: string) => Number(new RegExp(`\\*\\*${label}:\\*\\* ([\\d,]+) car-ticks`).exec(summary)![1]!.replace(/,/g, ''));
    expect(search).toBe(stated('Search'));
    expect(validation).toBe(stated('Validation'));
    expect(verification).toBe(stated('Verification'));
    expect(search + validation + verification).toBe(Number(/\*\*All car-ticks simulated by the seed runs:\*\* ([\d,]+)/.exec(summary)![1]!.replace(/,/g, '')));
  });

  it('reproduce analysis.json and report.md byte for byte', () => {
    const analysis = analyseE4Summaries(manifestInput, summaries);
    expect(e4AnalysisJson(analysis)).toBe(read('analysis.json'));
    expect(renderE4Report(JSON.parse(read('analysis.json')) as Json)).toBe(read('report.md'));
  });
});

describe('the result, as the analysis wrote it, and as e4.md states it', () => {
  const analysis = JSON.parse(read('analysis.json')) as Json;

  it('is the preregistered label "no direction established", with all four conditions false', () => {
    expect(analysis.reportable).toBe(true);
    expect(analysis.label).toBe('confirmatory');
    expect(analysis.n).toBe(10);
    expect(analysis.seeds).toEqual([...E4_SEEDS]);
    expect(analysis.a4BrakeTicksZero).toBe(true);
    expect(analysis.outcome).toEqual({
      conditions: { intervalAboveZero: false, intervalBelowZero: false, meanAtLeastDelta: false, meanAtMostMinusDelta: false },
      delta: 0.25,
      direction: null,
      label: E4_OUTCOME_IDS.noDirection,
      result: E4_OUTCOME_IDS.noDirection,
      rule: 'p2-09-e4-decision-v1',
      wording: e4OutcomeWording(E4_OUTCOME_IDS.noDirection, null),
    });
  });

  it('has the primary numbers that e4.md quotes', () => {
    const p = analysis.primary as Json;
    expect(p.mean).toBeCloseTo(-0.015, 12);
    expect(p.interval.lower).toBeCloseTo(-0.04, 12);
    expect(p.interval.upper).toBeCloseTo(0.01, 12);
    expect(p.median).toBeCloseTo(-0.025, 12);
    expect(p.wilcoxon).toMatchObject({ m: 7, p: 0.453125 });
    expect(p.differences.map((d: number) => Math.round(d * 100) / 100)).toEqual([0, -0.05, 0.05, 0, 0, -0.05, 0.05, -0.05, -0.05, -0.05]);
    for (const quoted of ['`no-direction`', '"no direction established: the interval spans zero"', '**−0.0150**', '**[−0.0400, +0.0100]**', 'm = 7, p = 0.4531']) {
      expect(summary).toContain(quoted);
    }
  });

  it('says what the label does not mean, and carries the feasibility limitation forward', () => {
    for (const fact of [
      'It does **not** mean "no effect" or "equivalent"',
      'did not show braking on the training oval',
      '−0.117 s against a 0.515 s margin',
      'does not show that braking is useless',
      'nothing is changed because of the result',
      '**The protocol was followed.**',
      'No seed was re-run',
    ]) expect(summary).toContain(fact);
  });
});
