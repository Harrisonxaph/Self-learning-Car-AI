// The E4 command line (scripts/e4.mjs, P2-09 step 5), run as a separate Node process exactly as `npm run e4` runs it.
// Tiny mechanics manifests with 77xx seeds, written to a temporary directory. A confirmatory-shaped manifest is used
// only to show that the command refuses to run it away from its frozen commit; no seed in 2001–2010 is ever run,
// nothing is committed, and nothing here is a study result or evidence of learning.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { BRAKE_USAGE_THRESHOLD } from '../../src/training/e4Agents';
import { c1Training, E4_BOOTSTRAP, E4_DECISION_RULE, E4_DELTA, E4_MANIFEST_FORMAT, parseE4Record } from '../../src/training/e4Study';
import { resolveBaselineConfig } from '../../src/training/baselines';
import { canonicalJson } from '../../src/training/experiment';
import { currentStreams, E4_SEEDS, METRIC, trackReferences, WILCOXON } from '../../src/training/study';
import { sha256Hex } from '../../src/utils/sha256';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ROOT = join(__dirname, '../..');
const DIR = mkdtempSync(join(tmpdir(), 'e4-cli-'));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const cli = (...args: string[]) => {
  const result = spawnSync(process.execPath, ['scripts/e4.mjs', ...args], { cwd: ROOT, encoding: 'utf8' });
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
const leftovers = (dir = DIR) => readdirSync(dir).filter((name) => name.includes('.tmp-'));

const { setup } = resolveBaselineConfig({ training: { populationSize: 3, eliteCount: 1, maxEpisodeSeconds: 2, stallSeconds: 1 }, generations: 2, trackId: 'stadium-oval' }, 0);
const MANIFEST: Json = {
  format: E4_MANIFEST_FORMAT,
  version: 1,
  id: 'mechanics-e4-cli',
  label: 'mechanics',
  description: 'Tiny mechanics fixture for the E4 command-line tests.',
  agents: ['A4', 'A5'],
  brake: { A4: false, A5: true },
  seeds: [7711, 7712],
  configuration: { generations: 2, training: Object.fromEntries(Object.entries(setup.config).filter(([key]) => key !== 'seed' && key !== 'brakeEnabled')) },
  streams: currentStreams(),
  tracks: trackReferences('stadium-oval', 'rounded-rectangle'),
  metric: METRIC,
  analysis: { delta: E4_DELTA, bootstrap: { ...E4_BOOTSTRAP }, wilcoxon: WILCOXON, decisionRule: E4_DECISION_RULE, brakeUsageThreshold: BRAKE_USAGE_THRESHOLD },
  code: { revision: null },
};
const MANIFEST_FILE = write('manifest.json', MANIFEST);
const ENGINE = { name: 'node', version: process.version, v8: process.versions.v8 };
const RECORD_A = join(DIR, 'seed-7711.json');
const RECORD_B = join(DIR, 'seed-7712.json');
const withManifest = (name: string, change: (m: Json) => void) => {
  const m = clone(MANIFEST);
  change(m);
  return write(name, m);
};

describe('npm run e4: usage and refusals before anything runs', () => {
  it('is wired as an npm script', () => {
    const scripts = JSON.parse(spawnSync('node', ['-p', 'JSON.stringify(require("./package.json").scripts)'], { cwd: ROOT, encoding: 'utf8' }).stdout) as Record<string, string>;
    expect(scripts.e4).toBe('node scripts/e4.mjs');
  });

  it.each([
    ['no command', [], /Unknown command \(none\)/],
    ['an unknown command', ['evolve'], /Unknown command evolve/],
    ['run without a manifest', ['run', '--seed', '7711', '--out', 'x.json'], /exactly one manifest file/],
    ['run without --seed', ['run', MANIFEST_FILE, '--out', 'x.json'], /needs --seed/],
    ['run without --out', ['run', MANIFEST_FILE, '--seed', '7711'], /needs --out/],
    ['a seed written oddly', ['run', MANIFEST_FILE, '--seed', '07711', '--out', 'x.json'], /whole number written plainly/],
    ['a repeated --seed', ['run', MANIFEST_FILE, '--seed', '7711', '--seed', '7712', '--out', 'x.json'], /--seed is given more than once/],
    ['an unexpected option', ['run', MANIFEST_FILE, '--seed', '7711', '--out', 'x.json', '--grid'], /Unexpected option --grid/],
    ['replay with one file', ['replay', MANIFEST_FILE], /manifest file and a record file/],
    ['analyse without --out-dir', ['analyse', MANIFEST_FILE, 'r.json'], /needs --out-dir/],
    ['analyse without a record', ['analyse', MANIFEST_FILE, '--out-dir', DIR], /at least one record file/],
  ])('exits 2 with the usage for %s', (_label, args, message) => {
    const result = cli(...(args as string[]));
    expect(result.code).toBe(2);
    expect(result.err).toMatch(message);
    expect(result.err).toContain('Usage:');
  });

  it('exits 2 for an unreadable or invalid manifest, and for one that breaks the brake binding, writing nothing', () => {
    const out = join(DIR, 'never.json');
    expect(cli('run', join(DIR, 'missing.json'), '--seed', '7711', '--out', out).err).toMatch(/Cannot read the E4 manifest/);
    expect(cli('run', write('not-json.json', '{nope'), '--seed', '7711', '--out', out).err).toMatch(/not valid JSON/);
    const bad = cli('run', withManifest('bad-brake.json', (m) => (m.configuration.training.brakeEnabled = true)), '--seed', '7711', '--out', out);
    expect(bad.code).toBe(2);
    expect(bad.err).toMatch(/brakeEnabled must not be set/);
    expect(cli('run', withManifest('bad-agents.json', (m) => (m.brake = { A4: true, A5: true })), '--seed', '7711', '--out', out).code).toBe(2);
    expect(existsSync(out)).toBe(false);
    expect(leftovers()).toEqual([]);
  });

  it('exits 2 for a seed the manifest does not list, an E4 seed in a mechanics manifest, and a held-out track', () => {
    const out = join(DIR, 'never2.json');
    expect(cli('run', MANIFEST_FILE, '--seed', '7799', '--out', out).err).toMatch(/not one of the manifest's seeds/);
    expect(cli('run', MANIFEST_FILE, '--seed', '2001', '--out', out).err).toMatch(/not one of the manifest's seeds/);
    expect(cli('run', withManifest('e4-seed.json', (m) => (m.seeds = [2001])), '--seed', '2001', '--out', out).err).toMatch(/reserved seed/);
    expect(cli('run', withManifest('held-out.json', (m) => (m.tracks.validation.id = 'hairpin-chicane')), '--seed', '7711', '--out', out).err).toMatch(/held-out|leak|split/i);
    expect(existsSync(out)).toBe(false);
  });

  it('refuses to run a confirmatory manifest away from its frozen commit, before any seed runs', () => {
    const confirmatory = write('confirmatory.json', {
      ...clone(MANIFEST),
      id: 'p2-09-e4-cli-fixture',
      label: 'confirmatory',
      seeds: [...E4_SEEDS],
      configuration: { generations: 100, training: c1Training() },
      code: { revision: 'a'.repeat(40) },
    });
    const out = join(DIR, 'never3.json');
    const result = cli('run', confirmatory, '--seed', '2001', '--out', out);
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/runs only at its frozen commit a{40}/);
    expect(existsSync(out)).toBe(false);
    expect(leftovers()).toEqual([]);
  });
});

describe('npm run e4: run, replay and analyse on the tiny mechanics fixture', () => {
  it('runs a seed and writes a complete record that parses against the manifest', () => {
    const result = cli('run', MANIFEST_FILE, '--seed', '7711', '--out', RECORD_A);
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/E4 study mechanics-e4-cli \(mechanics\), seed 7711: agents A4, A5 \(A4 brake off, A5 brake on\)/);
    expect(result.out).toMatch(/6 A4 and 6 A5 evaluations \(planned 6 each\)/);
    expect(result.out).toContain('Raw record only: no analysis was run');
    const record = read(RECORD_A);
    // The printed total is every car-tick the seed simulated, split into the search, the validation episodes and the
    // frozen champions' verification episodes (Codex's P2 on #117), and agrees with the record's own accounting.
    const sum = (key: string) => Object.values(record.budgets.ticks as Record<string, Record<string, number>>).reduce((n, t) => n + t[key]!, 0);
    expect(sum('verification')).toBeGreaterThan(0);
    expect(result.out).toContain(
      `${sum('training') + sum('validation') + sum('verification')} car-ticks simulated (search ${sum('training')}, validation ${sum('validation')}, verification of the frozen champions ${sum('verification')})`,
    );
    expect(record.budgets.actual.verificationEpisodes).toEqual({ A4: 1, A5: 1 });
    expect(() => parseE4Record(record, MANIFEST, ENGINE)).not.toThrow();
    expect(record.agents.A4.brakeEnabled).toBe(false);
    expect(record.agents.A5.brakeEnabled).toBe(true);
    expect(record.agents.A4.brakeUsage.training.brakeTicks).toBe(0);
    expect(cli('run', MANIFEST_FILE, '--seed', '7712', '--out', RECORD_B).code).toBe(0);
    expect(leftovers()).toEqual([]);
  });

  it('replays a record identically, exit 0, and reports an edited one as different, exit 1', () => {
    const same = cli('replay', MANIFEST_FILE, RECORD_A);
    expect(same.code).toBe(0);
    expect(same.out).toMatch(/Replay identical: seed 7711, A4's and A5's results and both frozen models reproduced/);
    const edited = read(RECORD_A);
    const e = edited.agents.A5.generations[0][0].training;
    e.outcome = e.outcome === 'stalled' ? 'timeout' : 'stalled';
    const result = cli('replay', MANIFEST_FILE, write('edited.json', rehash(edited)));
    expect(result.code).toBe(1);
    expect(result.out).toMatch(/Replay differs from the record/);
    expect(result.out).toContain('agents.A5.generations[0][0].training.outcome');
  });

  it('refuses records that break the brake binding, naming the path, exit 2', () => {
    const moved = read(RECORD_A);
    moved.agents.A4.model.provenance.brakeEnabled = true;
    const result = cli('replay', MANIFEST_FILE, write('moved.json', rehash(moved)));
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/agents\.A4\.model\.provenance/);
    const braked = read(RECORD_A);
    braked.agents.A4.brakeUsage.training.brakeTicks = 3;
    expect(cli('replay', MANIFEST_FILE, write('braked.json', rehash(braked))).err).toMatch(/agents\.A4\.brakeUsage\.training\.brakeTicks must be 0/);
  });

  it('analyses every record and writes analysis.json and report.md, reporting nothing for a mechanics study', () => {
    const outDir = join(DIR, 'analysis');
    mkdirSync(outDir);
    const result = cli('analyse', MANIFEST_FILE, RECORD_A, RECORD_B, '--out-dir', outDir);
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/E4 analysis of mechanics-e4-cli \(mechanics\): n = 2 training seed\(s\), every record replayed identically/);
    expect(result.out).toContain('Reported as: nothing (not a result)');
    const analysis = read(join(outDir, 'analysis.json'));
    expect(analysis.format).toBe('self-driving-ai-evolution/p2-09-e4-analysis');
    expect(analysis.reportable).toBe(false);
    expect(analysis.a4BrakeTicksZero).toBe(true);
    expect(readFileSync(join(outDir, 'report.md'), 'utf8')).toContain('# P2-09 E4 analysis: mechanics-e4-cli');
    // The same input gives byte-identical outputs.
    const second = join(DIR, 'analysis-2');
    mkdirSync(second);
    expect(cli('analyse', MANIFEST_FILE, RECORD_B, RECORD_A, '--out-dir', second).code).toBe(0);
    expect(readFileSync(join(second, 'analysis.json'), 'utf8')).toBe(readFileSync(join(outDir, 'analysis.json'), 'utf8'));
    expect(readFileSync(join(second, 'report.md'), 'utf8')).toBe(readFileSync(join(outDir, 'report.md'), 'utf8'));
    expect(leftovers(outDir)).toEqual([]);
  });

  it('refuses to analyse a missing seed, a non-replaying record or another manifest, writing nothing', () => {
    const outDir = join(DIR, 'analysis-bad');
    mkdirSync(outDir);
    expect(cli('analyse', MANIFEST_FILE, RECORD_A, '--out-dir', outDir).err).toMatch(/Missing records for seed\(s\) 7712/);
    const edited = read(RECORD_B);
    const e = edited.agents.A5.generations[0][0].training;
    e.outcome = e.outcome === 'stalled' ? 'timeout' : 'stalled';
    expect(cli('analyse', MANIFEST_FILE, RECORD_A, write('edited-b.json', rehash(edited)), '--out-dir', outDir).err).toMatch(/does not replay identically/);
    const other = withManifest('other.json', (m) => (m.description = 'another manifest'));
    expect(cli('analyse', other, RECORD_A, RECORD_B, '--out-dir', outDir).err).toMatch(/another manifest/);
    expect(readdirSync(outDir)).toEqual([]);
  });
});

describe('npm run e4: output safety', () => {
  it('never replaces an existing record without --force, and replaces it with it', () => {
    const out = join(DIR, 'exists.json');
    writeFileSync(out, 'original');
    const refused = cli('run', MANIFEST_FILE, '--seed', '7711', '--out', out);
    expect(refused.code).toBe(2);
    expect(refused.err).toMatch(/already exists; pass --force/);
    expect(readFileSync(out, 'utf8')).toBe('original');
    expect(cli('run', MANIFEST_FILE, '--seed', '7711', '--out', out, '--force').code).toBe(0);
    expect(read(out).seed).toBe(7711);
    expect(leftovers()).toEqual([]);
  });

  it('refuses a directory or the manifest itself as the record, and a missing folder', () => {
    const dir = join(DIR, 'a-directory.json');
    mkdirSync(dir);
    expect(cli('run', MANIFEST_FILE, '--seed', '7711', '--out', dir, '--force').err).toMatch(/is a directory/);
    expect(cli('run', MANIFEST_FILE, '--seed', '7711', '--out', MANIFEST_FILE, '--force').err).toMatch(/is the manifest itself/);
    expect(cli('run', MANIFEST_FILE, '--seed', '7711', '--out', join(DIR, 'no-such-folder', 'r.json')).err).toMatch(/folder for .* does not exist/);
    expect(readFileSync(MANIFEST_FILE, 'utf8')).toBe(JSON.stringify(MANIFEST));
  });

  it('refuses analysis outputs that exist, are directories, or are the inputs, leaving them alone', () => {
    const outDir = join(DIR, 'analysis-safety');
    mkdirSync(outDir);
    writeFileSync(join(outDir, 'analysis.json'), 'keep');
    const exists = cli('analyse', MANIFEST_FILE, RECORD_A, RECORD_B, '--out-dir', outDir);
    expect(exists.code).toBe(2);
    expect(exists.err).toMatch(/analysis\.json already exists; pass --force/);
    expect(readFileSync(join(outDir, 'analysis.json'), 'utf8')).toBe('keep');
    const directory = join(DIR, 'analysis-directory');
    mkdirSync(join(directory, 'report.md', 'precious'), { recursive: true });
    expect(cli('analyse', MANIFEST_FILE, RECORD_A, RECORD_B, '--out-dir', directory, '--force').err).toMatch(/report\.md is a directory/);
    expect(existsSync(join(directory, 'report.md', 'precious'))).toBe(true);
    const link = join(DIR, 'link-dir');
    symlinkSync(directory, link);
    // An input file named like an output is never overwritten, even with --force.
    const inputDir = join(DIR, 'analysis-input');
    mkdirSync(inputDir);
    const asInput = join(inputDir, 'analysis.json');
    writeFileSync(asInput, JSON.stringify(read(RECORD_A)));
    expect(cli('analyse', MANIFEST_FILE, asInput, RECORD_B, '--out-dir', inputDir, '--force').err).toMatch(/one of the input files/);
    expect(read(asInput).seed).toBe(7711);
  });
});
