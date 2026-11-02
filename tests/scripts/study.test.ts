// The study command line (scripts/study.mjs, P2-08 C2, docs/experiments/p2-08-step3-design.md §4.6), run as a
// separate Node process exactly as `npm run study` runs it. Tiny mechanics manifests with 73xx seeds, written to a
// temporary directory; no pilot or confirmatory seed is ever run, nothing is committed, and nothing here is a study
// result or evidence of learning.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { resolveBaselineConfig } from '../../src/training/baselines';
import { canonicalJson } from '../../src/training/experiment';
import {
  AGENT_ORDER,
  BOOTSTRAP,
  currentStreams,
  DECISION_RULE,
  METRIC,
  parseStudyRecord,
  STUDY_MANIFEST_FORMAT,
  trackReferences,
  WILCOXON,
} from '../../src/training/study';
import { sha256Hex } from '../../src/utils/sha256';
import { OutputExistsError, writeRecordFile } from '../../scripts/recordFile.mjs';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ROOT = join(__dirname, '../..');
const DIR = mkdtempSync(join(tmpdir(), 'study-cli-'));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const cli = (...args: string[]) => {
  const result = spawnSync(process.execPath, ['scripts/study.mjs', ...args], { cwd: ROOT, encoding: 'utf8' });
  return { code: result.status, out: result.stdout, err: result.stderr.replace(/^Warning: the worktree.*\n/m, '') };
};
const write = (name: string, data: unknown) => {
  const path = join(DIR, name);
  writeFileSync(path, typeof data === 'string' ? data : JSON.stringify(data));
  return path;
};
const read = (path: string): Json => JSON.parse(readFileSync(path, 'utf8')) as Json;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const rehash = (record: Json): Json => ({ ...record, resultsHash: `sha256:${sha256Hex(canonicalJson(record.agents))}` });

const { setup } = resolveBaselineConfig({ training: { populationSize: 3, eliteCount: 1, maxEpisodeSeconds: 2, stallSeconds: 1 }, generations: 2, trackId: 'stadium-oval' }, 0);
const MANIFEST: Json = {
  format: STUDY_MANIFEST_FORMAT,
  version: 1,
  id: 'mechanics-c2',
  label: 'mechanics',
  description: 'Tiny mechanics fixture for the C2 command-line tests.',
  agents: [...AGENT_ORDER],
  seeds: [7311, 7312],
  configuration: { generations: 2, episodesPerTrack: 2, holdTicks: 30, training: Object.fromEntries(Object.entries(setup.config).filter(([key]) => key !== 'seed')) },
  streams: currentStreams(),
  tracks: trackReferences('stadium-oval', 'rounded-rectangle'),
  metric: METRIC,
  analysis: { delta: 0.25, bootstrap: { ...BOOTSTRAP }, wilcoxon: WILCOXON, decisionRule: DECISION_RULE },
  code: { revision: null },
};
const MANIFEST_FILE = write('manifest.json', MANIFEST);
const ENGINE = { name: 'node', version: process.version, v8: process.versions.v8 };
const RECORD_FILE = join(DIR, 'seed-7311.json');
const withManifest = (name: string, change: (m: Json) => void) => {
  const m = clone(MANIFEST);
  change(m);
  return write(name, m);
};
const editRecord = (name: string, change: (r: Json) => void, hash = true) => {
  const r = read(RECORD_FILE);
  change(r);
  return write(name, hash ? rehash(r) : r);
};
const leftovers = (dir = DIR) => readdirSync(dir).filter((name) => name.includes('.tmp-'));
const isReserved = (seed: number) => (seed >= 1001 && seed <= 1020) || (seed >= 9001 && seed <= 9003);

describe('study command line', () => {
  it('uses mechanics seeds only', () => {
    for (const seed of MANIFEST.seeds) expect(isReserved(seed)).toBe(false);
  });

  it('records a seed and replays it to identical results', () => {
    const run = cli('run', MANIFEST_FILE, '--seed', '7311', '--out', RECORD_FILE);
    expect(run.err).toBe('');
    expect(run.code).toBe(0);
    expect(run.out).toContain('Study mechanics-c2 (mechanics), seed 7311: agents A1, A7, A2, A9, A8, A5.');
    expect(run.out).toContain('6 A5 and 6 A8 evaluations (planned 6 each), 2 A1/A7 episodes per track');
    expect(run.out).toContain('nothing here is evidence of learning');
    const record = read(RECORD_FILE);
    expect(parseStudyRecord(record, MANIFEST, ENGINE).seed).toBe(7311);
    expect(record.engine).toEqual(ENGINE);
    expect(record.source.appVersion).toBe('0.0.0');
    expect(record.source.revision === null || /^[0-9a-f]{40}$/.test(record.source.revision)).toBe(true);
    expect(Number.isNaN(Date.parse(record.recordedAt))).toBe(false);
    expect(record.evaluations).toEqual({ validation: 'descriptive', heldOut: 'none' });
    expect(leftovers()).toEqual([]);

    const replay = cli('replay', MANIFEST_FILE, RECORD_FILE);
    expect(replay.code).toBe(0);
    expect(replay.out).toContain('Replay identical: seed 7311');
  });

  it('records each seed alone, and recording again differs only in recordedAt', () => {
    const other = join(DIR, 'seed-7312.json');
    expect(cli('run', MANIFEST_FILE, '--seed', '7312', '--out', other).code).toBe(0);
    const again = join(DIR, 'seed-7311-again.json');
    expect(cli('run', MANIFEST_FILE, '--seed', '7311', '--out', again).code).toBe(0);
    const [first, second, third] = [read(RECORD_FILE), read(again), read(other)];
    expect({ ...second, recordedAt: first.recordedAt }).toEqual(first);
    expect(third.resultsHash).not.toBe(first.resultsHash);
    expect(cli('replay', MANIFEST_FILE, other).code).toBe(0);
  });

  describe('safe overwrite', () => {
    it('treats a dangling symbolic link at --out as an existing file', () => {
      const link = join(DIR, 'dangling-record.json');
      symlinkSync(join(DIR, 'nothing-here.json'), link);
      const run = cli('run', MANIFEST_FILE, '--seed', '7311', '--out', link);
      expect(run.code).toBe(2);
      expect(run.err).toContain('already exists; pass --force');
      expect(existsSync(join(DIR, 'nothing-here.json'))).toBe(false);
      expect(leftovers()).toEqual([]);
    });

    it('refuses to replace an existing record without --force, leaving it untouched', () => {
      const before = readFileSync(RECORD_FILE, 'utf8');
      const run = cli('run', MANIFEST_FILE, '--seed', '7311', '--out', RECORD_FILE);
      expect(run.code).toBe(2);
      expect(run.err).toContain('already exists; pass --force');
      expect(readFileSync(RECORD_FILE, 'utf8')).toBe(before);
    });

    it('replaces it with --force, completely', () => {
      const path = join(DIR, 'forced.json');
      writeFileSync(path, 'old contents');
      const run = cli('run', MANIFEST_FILE, '--seed', '7311', '--out', path, '--force');
      expect(run.code).toBe(0);
      expect({ ...read(path), recordedAt: null }).toEqual({ ...read(RECORD_FILE), recordedAt: null });
      expect(leftovers()).toEqual([]);
    });

    it('keeps the existing record when a forced run is refused', () => {
      const path = join(DIR, 'kept.json');
      writeFileSync(path, 'keep me');
      expect(cli('run', MANIFEST_FILE, '--seed', '7399', '--out', path, '--force').code).toBe(2);
      expect(cli('run', withManifest('bad-delta.json', (m) => (m.analysis.delta = 0.1)), '--seed', '7311', '--out', path, '--force').code).toBe(2);
      expect(readFileSync(path, 'utf8')).toBe('keep me');
      expect(leftovers()).toEqual([]);
    });

    it('never writes over the manifest, even with --force or through a symbolic link', () => {
      const before = readFileSync(MANIFEST_FILE, 'utf8');
      const link = join(DIR, 'manifest-link.json');
      symlinkSync(MANIFEST_FILE, link);
      for (const out of [MANIFEST_FILE, link]) {
        const run = cli('run', MANIFEST_FILE, '--seed', '7311', '--out', out, '--force');
        expect(run.code).toBe(2);
        expect(run.err).toContain('is the manifest itself');
      }
      expect(readFileSync(MANIFEST_FILE, 'utf8')).toBe(before);
    });

    describe('writing the record file (scripts/recordFile.mjs)', () => {
      const folder = (name: string) => {
        const path = join(DIR, name);
        mkdirSync(path);
        return path;
      };
      const snapshot = (dir: string) => Object.fromEntries(readdirSync(dir).map((name) => [name, readFileSync(join(dir, name), 'utf8')]));

      it.each([false, true])('never removes a file that already has a temporary-looking name beside the output (force %s)', (force) => {
        // The name an earlier version used for its temporary file, for this very process: a file there (here, the
        // manifest) must survive, and the record must still be written.
        const dir = folder(`collision-${force}`);
        const out = join(dir, 'record.json');
        const collision = join(dir, `.record.json.${process.pid}.tmp`);
        writeFileSync(collision, JSON.stringify(MANIFEST));
        writeFileSync(join(dir, '.record.json.tmp-abcdef'), 'another');
        const before = snapshot(dir);
        writeRecordFile(out, 'the record', force);
        expect(readFileSync(out, 'utf8')).toBe('the record');
        expect(snapshot(dir)).toEqual({ ...before, 'record.json': 'the record' });
        expect(leftovers(dir)).toEqual(['.record.json.tmp-abcdef']);
      });

      it('refuses an existing output without force, touching nothing', () => {
        const dir = folder('exists');
        const out = join(dir, 'record.json');
        writeFileSync(out, 'old');
        writeFileSync(join(dir, `.record.json.${process.pid}.tmp`), 'keep');
        const before = snapshot(dir);
        expect(() => writeRecordFile(out, 'new', false)).toThrow(OutputExistsError);
        expect(snapshot(dir)).toEqual(before);
      });

      it('leaves everything in place when moving the record fails', () => {
        const dir = folder('move-fails');
        const out = folder('move-fails/record.json');
        writeFileSync(join(out, 'inside'), 'keep');
        expect(() => writeRecordFile(out, 'new', true)).toThrow();
        expect(snapshot(out)).toEqual({ inside: 'keep' });
        expect(readdirSync(dir)).toEqual(['record.json']);
      });
    });

    it('refuses a directory or a missing folder as the output', () => {
      const folder = join(DIR, 'a-folder');
      mkdirSync(folder);
      const asFolder = cli('run', MANIFEST_FILE, '--seed', '7311', '--out', folder, '--force');
      expect(asFolder.code).toBe(2);
      expect(asFolder.err).toContain('is a directory');
      const missing = cli('run', MANIFEST_FILE, '--seed', '7311', '--out', join(DIR, 'no-such-folder', 'r.json'));
      expect(missing.code).toBe(2);
      expect(missing.err).toContain('does not exist');
      expect(existsSync(join(DIR, 'no-such-folder'))).toBe(false);
    });
  });

  describe('replay', () => {
    it('exits 1 and names the path when a consistently edited result replays differently', () => {
      const file = editRecord('edited.json', (r) => {
        const episode = r.agents.A1.training[0];
        episode.outcome = episode.outcome === 'stalled' ? 'timeout' : 'stalled';
      });
      const replay = cli('replay', MANIFEST_FILE, file);
      expect(replay.err).toBe('');
      expect(replay.code).toBe(1);
      expect(replay.out).toContain('agents.A1.training[0].outcome');
    });

    it('exits 1 and names the model when a frozen model does not reproduce its recorded episodes', () => {
      const file = editRecord('edited-model.json', (r) => {
        const episode = r.agents.A9.validation;
        episode.outcome = episode.outcome === 'stalled' ? 'timeout' : 'stalled';
      });
      const replay = cli('replay', MANIFEST_FILE, file);
      expect(replay.code).toBe(1);
      expect(replay.out).toContain('agents.A9.validation.outcome');
      expect(replay.out).toContain('agents.A9.model: evaluated alone, the frozen model did not reproduce');
      expect(replay.out).not.toContain('agents.A5.model');
    });

    it.each([
      ['a record edited without its hash', () => editRecord('tampered.json', (r) => (r.agents.A1.training[0].outcome = r.agents.A1.training[0].outcome === 'stalled' ? 'timeout' : 'stalled'), false), /resultsHash/],
      ['a record from another engine', () => editRecord('other-engine.json', (r) => (r.engine.version = 'v22.0.0'), false), /engine/],
      ['an incomplete record', () => editRecord('incomplete.json', (r) => delete r.budgets, false), /budgets/],
      ['a record that is not JSON', () => write('broken.json', '{"format": '), /not valid JSON/],
      ['a missing record', () => join(DIR, 'missing.json'), /Cannot read the study record/],
    ])('exits 2 for %s', (_, file, message) => {
      const replay = cli('replay', MANIFEST_FILE, file());
      expect(replay.code).toBe(2);
      expect(replay.err).toMatch(message);
      expect(replay.err).not.toContain('Unexpected error');
    });

    it.each([
      ['another manifest', () => withManifest('other.json', (m) => (m.analysis.delta = 0.3)), /manifest/],
      ['an invalid manifest', () => withManifest('invalid.json', (m) => delete m.metric), /manifest.metric/],
      ['a missing manifest', () => join(DIR, 'missing-manifest.json'), /Cannot read the study manifest/],
    ])('exits 2 when replaying against %s', (_, manifest, message) => {
      const replay = cli('replay', manifest(), RECORD_FILE);
      expect(replay.code).toBe(2);
      expect(replay.err).toMatch(message);
      expect(replay.err).not.toContain('Unexpected error');
    });
  });

  describe('invalid input for run, writing nothing', () => {
    it.each([
      ['a seed the manifest does not list', MANIFEST_FILE, '7399', /Seed 7399 is not one of the manifest's seeds/],
      ['the held-out track', withManifest('held-out.json', (m) => (m.tracks.validation.id = 'hairpin-chicane')), '7311', /held-out|hairpin/],
      ['a reserved seed in a mechanics manifest', withManifest('reserved.json', (m) => (m.seeds = [7311, 1005])), '7311', /reserved/],
      ['an invalid setting', withManifest('no-elites.json', (m) => (m.configuration.training.eliteCount = 0)), '7311', /eliteCount/],
      ['a manifest that is not JSON', write('broken-manifest.json', '{'), '7311', /not valid JSON/],
    ])('exits 2 for %s', (_, manifest, seed, message) => {
      const out = join(DIR, `never-${_.replace(/\W+/g, '-')}.json`);
      const run = cli('run', manifest, '--seed', seed, '--out', out);
      expect(run.code).toBe(2);
      expect(run.err).toMatch(message);
      expect(run.err).not.toContain('Unexpected error');
      expect(existsSync(out)).toBe(false);
    });
  });

  describe('pilot and confirmatory manifests run only at their frozen commit', () => {
    // These manifests list reserved seeds but are given a mechanics seed they do not list. The guard comes before
    // the seed check, so it must refuse with its own message; if it were broken, the seed check would still refuse.
    // No reserved seed is ever run.
    const frozen = (label: string, seeds: number[], revision: string) =>
      withManifest(`${label}-${revision.slice(0, 7)}.json`, (m) => {
        m.label = label;
        m.seeds = seeds;
        m.configuration.episodesPerTrack = m.configuration.training.populationSize;
        m.code.revision = revision;
      });
    const git = (...args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

    it.each([
      ['pilot', [9001, 9002, 9003]],
      ['confirmatory', Array.from({ length: 10 }, (_, i) => 1001 + i)],
    ])('refuses a %s manifest frozen at another commit', (label, seeds) => {
      const out = join(DIR, `never-${label}.json`);
      const run = cli('run', frozen(label, seeds, 'f'.repeat(40)), '--seed', '7311', '--out', out);
      expect(run.code).toBe(2);
      expect(run.err).toContain(`A ${label} manifest runs only at its frozen commit ${'f'.repeat(40)}`);
      expect(existsSync(out)).toBe(false);
    });

    it('refuses an uncommitted worktree at the frozen commit, and checks the seed only after that', () => {
      const head = git('rev-parse', 'HEAD');
      const dirty = git('status', '--porcelain').length > 0;
      const out = join(DIR, 'never-head.json');
      const run = cli('run', frozen('pilot', [9001], head), '--seed', '7311', '--out', out);
      expect(run.code).toBe(2);
      expect(run.err).toContain(dirty ? 'runs only from a clean worktree' : "Seed 7311 is not one of the manifest's seeds");
      expect(existsSync(out)).toBe(false);
    });
  });

  it.each([
    [[]],
    [['train', 'm.json']],
    [['run', 'm.json']],
    [['run', 'm.json', '--seed', '7311']],
    [['run', 'm.json', '--out', 'r.json']],
    [['run', 'm.json', '--seed', '+7311', '--out', 'r.json']],
    [['run', 'm.json', '--seed', '07311', '--out', 'r.json']],
    [['run', 'm.json', '--seed', '7311.0', '--out', 'r.json']],
    [['run', 'm.json', '--seed', '1e3', '--out', 'r.json']],
    [['run', 'm.json', '--seed', '-1', '--out', 'r.json']],
    [['run', 'm.json', '--seed', '7311', '--seed', '7312', '--out', 'r.json']],
    [['run', 'm.json', '--seed', '7311', '--out', 'r.json', '--out', 's.json']],
    [['run', 'm.json', '--seed', '7311', '--out', 'r.json', '--force', '--force']],
    [['run', 'm.json', '--seed', '7311', '--out']],
    [['run', 'm.json', 'x.json', '--seed', '7311', '--out', 'r.json']],
    [['run', 'm.json', '--seed', '7311', '--out', 'r.json', '--verbose']],
    [['replay', 'm.json']],
    [['replay', 'm.json', 'r.json', 'x.json']],
    [['replay', 'm.json', 'r.json', '--force']],
    [['replay', 'm.json', 'r.json', '--seed', '7311']],
  ])('exits 2 with usage for %j', (args) => {
    const result = cli(...args);
    expect(result.code).toBe(2);
    expect(result.err).toContain('Usage:');
    expect(existsSync(join(ROOT, 'r.json'))).toBe(false);
  });
});
