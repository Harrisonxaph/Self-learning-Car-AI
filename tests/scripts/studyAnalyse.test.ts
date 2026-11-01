// The `analyse` command (D2, docs/experiments/p2-08-step3-design.md §5.2), run as its own Node process exactly as
// `npm run study -- analyse` runs it, on a temporary mechanics manifest with seeds 7371 and 7372. The records are
// produced here by runStudySeed, the library code `run` uses. No pilot or confirmatory seed is run, nothing is
// committed, and nothing here is a study result or evidence of learning.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { analyseRecords, analysisJson, renderReport } from '../../src/training/analysis';
import { resolveBaselineConfig } from '../../src/training/baselines';
import { canonicalJson } from '../../src/training/experiment';
import { AGENT_ORDER, BOOTSTRAP, currentStreams, DECISION_RULE, METRIC, runStudySeed, STUDY_MANIFEST_FORMAT, trackReferences, WILCOXON } from '../../src/training/study';
import { sha256Hex } from '../../src/utils/sha256';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ROOT = join(__dirname, '../..');
const DIR = mkdtempSync(join(tmpdir(), 'study-analyse-'));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const cli = (...args: string[]) => {
  const result = spawnSync(process.execPath, ['scripts/study.mjs', 'analyse', ...args], { cwd: ROOT, encoding: 'utf8' });
  return { code: result.status, out: result.stdout, err: result.stderr };
};
const write = (name: string, data: unknown) => {
  const path = join(DIR, name);
  writeFileSync(path, typeof data === 'string' ? data : JSON.stringify(data));
  return path;
};
const folder = (name: string) => {
  const path = join(DIR, name);
  mkdirSync(path);
  return path;
};

const { setup } = resolveBaselineConfig({ training: { populationSize: 3, eliteCount: 1, maxEpisodeSeconds: 2, stallSeconds: 1 }, generations: 2, trackId: 'stadium-oval' }, 0);
const MANIFEST: Json = {
  format: STUDY_MANIFEST_FORMAT,
  version: 1,
  id: 'mechanics-d2',
  label: 'mechanics',
  description: 'Tiny mechanics fixture for the D2 analyse tests.',
  agents: [...AGENT_ORDER],
  seeds: [7371, 7372],
  configuration: { generations: 2, episodesPerTrack: 2, holdTicks: 30, training: Object.fromEntries(Object.entries(setup.config).filter(([key]) => key !== 'seed')) },
  streams: currentStreams(),
  tracks: trackReferences('stadium-oval', 'rounded-rectangle'),
  metric: METRIC,
  analysis: { delta: 0.25, bootstrap: { ...BOOTSTRAP }, wilcoxon: WILCOXON, decisionRule: DECISION_RULE },
  code: { revision: null },
};
const ENGINE = { name: 'node', version: process.version, v8: process.versions.v8 };
const CONTEXT = { engine: ENGINE, source: { revision: null, dirty: null, unavailableReason: 'test', appVersion: '0.0.0' }, recordedAt: '2026-11-01T23:30:00.000Z' };
const RECORDS = MANIFEST.seeds.map((seed: number) => JSON.parse(JSON.stringify(runStudySeed(MANIFEST, seed, CONTEXT))) as Json);
const MANIFEST_FILE = write('manifest.json', MANIFEST);
const RECORD_FILES = RECORDS.map((r: Json) => write(`seed-${r.seed}.json`, r));
const EXPECTED = analyseRecords(MANIFEST, RECORDS, ENGINE);

describe('study analyse', () => {
  it('uses mechanics seeds only', () => {
    for (const seed of MANIFEST.seeds) expect((seed >= 1001 && seed <= 1020) || (seed >= 9001 && seed <= 9003)).toBe(false);
  });

  it('replays every record and writes analysis.json and report.md exactly as the library computes them', () => {
    const out = folder('out');
    const run = cli(MANIFEST_FILE, ...RECORD_FILES, '--out-dir', out);
    expect(run.err).toBe('');
    expect(run.code).toBe(0);
    expect(readFileSync(join(out, 'analysis.json'), 'utf8')).toBe(analysisJson(EXPECTED));
    expect(readFileSync(join(out, 'report.md'), 'utf8')).toBe(renderReport(EXPECTED));
    expect(readdirSync(out).sort()).toEqual(['analysis.json', 'report.md']);
    expect(run.out).toContain('Analysis of mechanics-d2 (mechanics): n = 2 training seed(s), every record replayed identically.');
    expect(run.out).toContain('Acceptance eligible: no. Decision (p2-08-decision-v1): not evaluated: mechanics analysis is acceptance-ineligible. Claim: none.');

    // Records in any order give the same bytes; a forced re-run replaces both files with identical content.
    const again = cli(MANIFEST_FILE, ...[...RECORD_FILES].reverse(), '--out-dir', out, '--force');
    expect(again.code).toBe(0);
    expect(readFileSync(join(out, 'analysis.json'), 'utf8')).toBe(analysisJson(EXPECTED));
    expect(readdirSync(out).sort()).toEqual(['analysis.json', 'report.md']);
  });

  describe('safe writing', () => {
    it('refuses existing outputs without --force, leaving them untouched', () => {
      const out = folder('existing');
      writeFileSync(join(out, 'report.md'), 'keep me');
      const run = cli(MANIFEST_FILE, ...RECORD_FILES, '--out-dir', out);
      expect(run.code).toBe(2);
      expect(run.err).toContain('report.md already exists; pass --force');
      expect(readdirSync(out)).toEqual(['report.md']);
      expect(readFileSync(join(out, 'report.md'), 'utf8')).toBe('keep me');
    });

    it('refuses a missing output folder, or one that is a file', () => {
      expect(cli(MANIFEST_FILE, ...RECORD_FILES, '--out-dir', join(DIR, 'nowhere')).err).toContain('does not exist or is not a folder');
      expect(existsSync(join(DIR, 'nowhere'))).toBe(false);
      expect(cli(MANIFEST_FILE, ...RECORD_FILES, '--out-dir', MANIFEST_FILE).code).toBe(2);
    });

    it('never writes over an input, even with --force or through a symbolic link', () => {
      const inputs = folder('inputs');
      const record = join(inputs, 'analysis.json');
      writeFileSync(record, JSON.stringify(RECORDS[0]));
      const before = readFileSync(record, 'utf8');
      const run = cli(MANIFEST_FILE, record, RECORD_FILES[1]!, '--out-dir', inputs, '--force');
      expect(run.code).toBe(2);
      expect(run.err).toContain('is one of the input files');
      expect(readFileSync(record, 'utf8')).toBe(before);

      const linked = folder('linked');
      symlinkSync(MANIFEST_FILE, join(linked, 'report.md'));
      const viaLink = cli(MANIFEST_FILE, ...RECORD_FILES, '--out-dir', linked, '--force');
      expect(viaLink.code).toBe(2);
      expect(viaLink.err).toContain('is one of the input files');
      expect(readFileSync(MANIFEST_FILE, 'utf8')).toBe(JSON.stringify(MANIFEST));
    });
  });

  describe('invalid input, writing nothing', () => {
    const edited = () => {
      const r = JSON.parse(JSON.stringify(RECORDS[0])) as Json;
      const sample = r.agents.A8.samples[(r.agents.A8.index + 1) % r.agents.A8.samples.length].training;
      sample.outcome = sample.outcome === 'stalled' ? 'timeout' : 'stalled';
      r.resultsHash = `sha256:${sha256Hex(canonicalJson(r.agents))}`;
      return write('edited.json', r);
    };
    it.each([
      ['a record that does not replay identically', () => [edited(), RECORD_FILES[1]!], /does not replay identically/],
      ['a missing seed', () => [RECORD_FILES[0]!], /Missing records for seed\(s\) 7372/],
      ['a duplicate seed', () => [RECORD_FILES[0]!, RECORD_FILES[0]!, RECORD_FILES[1]!], /more than once/],
      ['a record from another manifest', () => [write('other.json', runStudySeed({ ...MANIFEST, seeds: [7373] }, 7373, CONTEXT)), ...RECORD_FILES], /manifest/],
      ['a record that is not JSON', () => [write('broken.json', '{'), RECORD_FILES[1]!], /not valid JSON/],
      ['a missing record', () => [join(DIR, 'missing.json'), RECORD_FILES[1]!], /Cannot read the study record/],
    ])('exits 2 for %s', (_, records, message) => {
      const out = folder(`never-${_.replace(/\W+/g, '-')}`);
      const run = cli(MANIFEST_FILE, ...records(), '--out-dir', out);
      expect(run.code).toBe(2);
      expect(run.err).toMatch(message);
      expect(run.err).not.toContain('Unexpected error');
      expect(readdirSync(out)).toEqual([]);
    });
  });

  it.each([
    [['m.json']],
    [['m.json', '--out-dir', 'x']],
    [['m.json', 'r.json']],
    [['m.json', 'r.json', '--out-dir']],
    [['m.json', 'r.json', '--out-dir', 'x', '--out-dir', 'y']],
    [['m.json', 'r.json', '--out-dir', 'x', '--force', '--force']],
    [['m.json', 'r.json', '--out-dir', 'x', '--seed', '7371']],
    [['m.json', 'r.json', '--out-dir', 'x', '--out', 'y']],
  ])('exits 2 with usage for analyse %j', (args) => {
    const result = cli(...args);
    expect(result.code).toBe(2);
    expect(result.err).toContain('Usage:');
  });
});
