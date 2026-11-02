// The `analyse` command (D2, docs/experiments/p2-08-step3-design.md §5.2), run as its own Node process exactly as
// `npm run study -- analyse` runs it, on a temporary mechanics manifest with seeds 7371 and 7372. The records are
// produced here by runStudySeed, the library code `run` uses. No pilot or confirmatory seed is run, nothing is
// committed, and nothing here is a study result or evidence of learning.
import { spawnSync } from 'node:child_process';
import { existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, renameSync, unlinkSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { OutputExistsError, RollbackIncompleteError, writeRecordPair } from '../../scripts/recordFile.mjs';
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

    it('refuses a dangling symbolic link at an output before writing either file, and --force replaces the link itself (Codex review of 6f863a6)', () => {
      const out = folder('dangling');
      const target = join(DIR, 'nothing-here.md');
      symlinkSync(target, join(out, 'report.md'));
      const run = cli(MANIFEST_FILE, ...RECORD_FILES, '--out-dir', out);
      expect(run.code).toBe(2);
      expect(run.err).toContain('report.md already exists as a symbolic link; pass --force');
      expect(readdirSync(out)).toEqual(['report.md']);
      expect(existsSync(target)).toBe(false);

      const forced = cli(MANIFEST_FILE, ...RECORD_FILES, '--out-dir', out, '--force');
      expect(forced.code).toBe(0);
      expect(lstatSync(join(out, 'report.md')).isSymbolicLink()).toBe(false);
      expect(readFileSync(join(out, 'report.md'), 'utf8')).toBe(renderReport(EXPECTED));
      expect(existsSync(target)).toBe(false);
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

  // Codex review of 521fb9a: the two outputs are one unit. Failures are injected into the file-system calls, so the
  // second installation fails after the first one succeeded.
  describe('the output pair is installed as one unit (writeRecordPair)', () => {
    const contents = (dir: string) => Object.fromEntries(readdirSync(dir).sort().map((name) => [name, lstatSync(join(dir, name)).isDirectory() ? 'folder' : readFileSync(join(dir, name), 'utf8')]));
    const pair = (dir: string) => [
      { out: join(dir, 'analysis.json'), text: 'new analysis' },
      { out: join(dir, 'report.md'), text: 'new report' },
    ];
    const io = Object.assign(new Error('injected EIO'), { code: 'EIO' });
    // The real calls, except that `link` runs `before` and may fail when it installs the given output.
    const ops = (failOn: string | null, before: (created: string) => void = () => {}) => ({
      link: (existing: string, created: string) => {
        before(created);
        if (failOn !== null && created.endsWith(failOn)) throw io;
        linkSync(existing, created);
      },
      rename: renameSync,
      lstat: lstatSync,
      unlink: unlinkSync,
    });

    it.each([false, true])('installs both outputs and leaves nothing else (force %s)', (force) => {
      const dir = folder(`pair-ok-${force}`);
      if (force) writeFileSync(join(dir, 'report.md'), 'old report');
      writeRecordPair(pair(dir), force);
      expect(contents(dir)).toEqual({ 'analysis.json': 'new analysis', 'report.md': 'new report' });
    });

    it('without --force, a failure installing the second output leaves no new output', () => {
      const dir = folder('pair-fail');
      writeFileSync(join(dir, 'unrelated.txt'), 'keep');
      expect(() => writeRecordPair(pair(dir), false, ops('report.md'))).toThrow('injected EIO');
      expect(contents(dir)).toEqual({ 'unrelated.txt': 'keep' });
    });

    it('with --force, a failure installing the second output keeps both previous outputs', () => {
      const dir = folder('pair-fail-force');
      writeFileSync(join(dir, 'analysis.json'), 'old analysis');
      writeFileSync(join(dir, 'report.md'), 'old report');
      expect(() => writeRecordPair(pair(dir), true, ops('report.md'))).toThrow('injected EIO');
      expect(contents(dir)).toEqual({ 'analysis.json': 'old analysis', 'report.md': 'old report' });
    });

    it('with --force, a failure moving the second original aside restores the first', () => {
      const dir = folder('pair-fail-aside');
      writeFileSync(join(dir, 'analysis.json'), 'old analysis');
      writeFileSync(join(dir, 'report.md'), 'old report');
      const failingRename = { ...ops(null), rename: (from: string, to: string) => {
        if (from.endsWith('report.md')) throw io;
        renameSync(from, to);
      } };
      expect(() => writeRecordPair(pair(dir), true, failingRename)).toThrow('injected EIO');
      expect(contents(dir)).toEqual({ 'analysis.json': 'old analysis', 'report.md': 'old report' });
    });

    it('a competing report.md created after the first output is refused, kept, and this run removes only its own file', () => {
      const dir = folder('pair-late');
      const late = ops(null, (created) => {
        if (created.endsWith('report.md')) writeFileSync(created, 'someone else');
      });
      expect(() => writeRecordPair(pair(dir), false, late)).toThrow(OutputExistsError);
      expect(contents(dir)).toEqual({ 'report.md': 'someone else' });
    });

    it('with --force, if restoring an original fails too, the original is kept and named, never deleted', () => {
      const dir = folder('pair-restore-fails');
      writeFileSync(join(dir, 'analysis.json'), 'old analysis');
      writeFileSync(join(dir, 'report.md'), 'old report');
      // Installing report.md fails, and so does moving the old report back onto report.md.
      const failing = { ...ops('report.md'), rename: (from: string, to: string) => {
        if (to.endsWith('report.md')) throw io;
        renameSync(from, to);
      } };
      let error: unknown;
      try {
        writeRecordPair(pair(dir), true, failing);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(RollbackIncompleteError);
      const message = (error as Error).message;
      expect(message).toContain('could not be restored');
      const backup = message.match(/previous content is at (\S+?)(\)|\.$|;)/)![1]!;
      expect(readFileSync(backup, 'utf8')).toBe('old report');
      expect(readFileSync(join(dir, 'analysis.json'), 'utf8')).toBe('old analysis');
      expect(existsSync(join(dir, 'report.md'))).toBe(false);
    });

    it('with --force, a competing entry that takes a moved-aside name is kept, and the original is kept and named', () => {
      const dir = folder('pair-late-force');
      writeFileSync(join(dir, 'analysis.json'), 'old analysis');
      writeFileSync(join(dir, 'report.md'), 'old report');
      const late = ops(null, (created) => {
        if (created.endsWith('report.md')) writeFileSync(created, 'someone else');
      });
      let error: unknown;
      try {
        writeRecordPair(pair(dir), true, late);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(RollbackIncompleteError);
      const message = (error as Error).message;
      expect(message).toContain('previous content is at');
      const backup = message.match(/previous content is at (\S+?)\)/)![1]!;
      expect(readFileSync(backup, 'utf8')).toBe('old report');
      expect(readFileSync(join(dir, 'analysis.json'), 'utf8')).toBe('old analysis');
      expect(readFileSync(join(dir, 'report.md'), 'utf8')).toBe('someone else');
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
