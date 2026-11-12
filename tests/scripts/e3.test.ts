// The E3 command line (scripts/e3.mjs, P5-01 step 4c), run as a separate Node process exactly as `npm run e3` runs it.
// Tiny mechanics manifests with 77xx seeds on the BUILT-IN registry, so no held-out circuit can be listed or evaluated:
// the held-out command is tested only through its refusals (it never reaches the gate). No seed in 3001–3010 is run,
// nothing is committed, and nothing here is a study result or evidence of learning.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import hairpinChicane from '../../src/data/tracks/hairpin-chicane.json';
import { loadTrack } from '../../src/sim/track';
import { E3_BOOTSTRAP, E3_DECISION_RULE, E3_MANIFEST_FORMAT, ruleIds } from '../../src/training/e3Study';
import { resolveBaselineConfig } from '../../src/training/baselines';
import { c1Training, E4_DELTA } from '../../src/training/e4Study';
import { E3_SEEDS, METRIC } from '../../src/training/study';
import { BUILT_IN_TRACK_SPLITS, trackContentHash, trainingTrack, validationTrack } from '../../src/training/trackSplits';
import { manifestRecord } from '../../src/training/experiment';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ROOT = join(__dirname, '../..');
const DIR = mkdtempSync(join(tmpdir(), 'e3-cli-'));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const cli = (...args: string[]) => {
  const result = spawnSync(process.execPath, ['scripts/e3.mjs', ...args], { cwd: ROOT, encoding: 'utf8' });
  return { code: result.status, out: result.stdout, err: result.stderr.replace(/^Warning: the worktree.*\n/m, '') };
};
const write = (name: string, data: unknown) => {
  const path = join(DIR, name);
  writeFileSync(path, typeof data === 'string' ? data : JSON.stringify(data));
  return path;
};
const read = (path: string): Json => JSON.parse(readFileSync(path, 'utf8')) as Json;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const { setup } = resolveBaselineConfig({ training: { populationSize: 3, eliteCount: 1, maxEpisodeSeconds: 2, stallSeconds: 1 }, generations: 2, trackId: 'stadium-oval' }, 0);
const MANIFEST: Json = {
  format: E3_MANIFEST_FORMAT,
  version: 1,
  id: 'mechanics-e3-cli',
  label: 'mechanics',
  description: 'Tiny mechanics fixture for the E3 command-line tests.',
  seeds: [7711, 7712],
  configuration: { generations: 2, training: Object.fromEntries(Object.entries(setup.config).filter(([key]) => key !== 'seed' && key !== 'brakeEnabled')) },
  tracks: {
    training: { id: 'stadium-oval', contentHash: trackContentHash(trainingTrack('stadium-oval')) },
    validation: { id: 'rounded-rectangle', contentHash: trackContentHash(validationTrack('rounded-rectangle')) },
    heldOut: [],
    splitManifestHash: manifestRecord(BUILT_IN_TRACK_SPLITS).hash,
  },
  rules: ruleIds(),
  analysis: { metric: METRIC, delta: E4_DELTA, bootstrap: { ...E3_BOOTSTRAP }, decisionRule: E3_DECISION_RULE },
  authorisation: null,
  code: { revision: null },
};
const MANIFEST_FILE = write('manifest.json', MANIFEST);
const SEED_A = join(DIR, 'seed-7711.json');
const SEED_B = join(DIR, 'seed-7712.json');
const RULES = join(DIR, 'rules.json');
const leftovers = () => readdirSync(DIR).filter((name) => name.includes('.tmp-'));

describe('npm run e3: usage and refusals before anything runs', () => {
  it('is wired as an npm script', () => {
    const scripts = JSON.parse(spawnSync('node', ['-p', 'JSON.stringify(require("./package.json").scripts)'], { cwd: ROOT, encoding: 'utf8' }).stdout) as Record<string, string>;
    expect(scripts.e3).toBe('node scripts/e3.mjs');
  });
  it.each([
    ['no command', [], /Unknown command \(none\)/],
    ['an unknown command', ['evolve'], /Unknown command evolve/],
    ['run-seed without --seed', ['run-seed', MANIFEST_FILE, '--out', 'x.json'], /needs --seed/],
    ['run-seed without --out', ['run-seed', MANIFEST_FILE, '--seed', '7711'], /needs --out/],
    ['a seed written oddly', ['run-seed', MANIFEST_FILE, '--seed', '07711', '--out', 'x.json'], /whole number written plainly/],
    ['a repeated --seed', ['run-seed', MANIFEST_FILE, '--seed', '7711', '--seed', '7712', '--out', 'x.json'], /given more than once/],
    ['--force on run-held-out', ['run-held-out', MANIFEST_FILE, 'a.json', '--rules', 'r.json', '--ledger', 'l.json', '--out', 'o.json', '--open-held-out', '--force'], /Unexpected option --force/],
    ['run-held-out without the explicit option', ['run-held-out', MANIFEST_FILE, 'a.json', '--rules', 'r.json', '--ledger', 'l.json', '--out', 'o.json'], /explicit option --open-held-out/],
    ['run-held-out without a ledger', ['run-held-out', MANIFEST_FILE, 'a.json', '--rules', 'r.json', '--out', 'o.json', '--open-held-out'], /needs --ledger/],
    ['run-held-out without seed records', ['run-held-out', MANIFEST_FILE, '--rules', 'r.json', '--ledger', 'l.json', '--out', 'o.json', '--open-held-out'], /every seed record/],
    ['replay with one file', ['replay', MANIFEST_FILE], /manifest file and a record file/],
    ['analyse without --rules', ['analyse', MANIFEST_FILE, 'a.json', '--out-dir', DIR], /needs --rules/],
    ['an unexpected option', ['run-rules', MANIFEST_FILE, '--out', 'x.json', '--grid'], /Unexpected option --grid/],
  ])('refuses %s', (_name, args, pattern) => {
    const result = cli(...args);
    expect(result.code).toBe(2);
    expect(result.err).toMatch(pattern);
  });
  it('refuses a manifest that is not valid', () => {
    const bad = clone(MANIFEST);
    bad.seeds = [3001];
    const result = cli('run-seed', write('bad.json', bad), '--seed', '3001', '--out', join(DIR, 'never.json'));
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/reserved/);
    expect(existsSync(join(DIR, 'never.json'))).toBe(false);
  });
  it('refuses a confirmatory manifest away from its frozen commit before running anything', () => {
    const confirmatory = clone(MANIFEST);
    confirmatory.label = 'mechanics';
    confirmatory.code = { revision: 'a'.repeat(40) };
    const file = write('pinned.json', confirmatory);
    for (const args of [['run-seed', file, '--seed', '7711', '--out', join(DIR, 'pinned-seed.json')], ['run-rules', file, '--out', join(DIR, 'pinned-rules.json')]]) {
      const result = cli(...args);
      expect(result.code).toBe(2);
      expect(result.err).toMatch(/frozen commit|modified/);
    }
    expect(existsSync(join(DIR, 'pinned-seed.json'))).toBe(false);
    expect(existsSync(join(DIR, 'pinned-rules.json'))).toBe(false);
  });
  it('run-held-out refuses a manifest with no held-out circuit and touches no ledger', () => {
    const ledger = join(DIR, 'ledger-none.json');
    const result = cli('run-held-out', MANIFEST_FILE, SEED_A, '--rules', RULES, '--ledger', ledger, '--out', join(DIR, 'held.json'), '--open-held-out');
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/lists no held-out circuit/);
    expect(existsSync(ledger)).toBe(false);
    expect(existsSync(join(DIR, 'held.json'))).toBe(false);
  });
});

describe('npm run e3: run, replay and analyse (mechanics, validation circuit only)', () => {
  it('runs two seeds and the rules, writes each record once, and replays them identically', () => {
    for (const [seed, out] of [['7711', SEED_A], ['7712', SEED_B]] as const) {
      const run = cli('run-seed', MANIFEST_FILE, '--seed', seed, '--out', out);
      expect(run.err).toBe('');
      expect(run.code).toBe(0);
      expect(run.out).toMatch(/validation circuit only/);
      expect(run.out).toMatch(/no held-out circuit was used/);
    }
    expect(cli('run-rules', MANIFEST_FILE, '--out', RULES).code).toBe(0);
    expect(read(SEED_A).seed).toBe(7711);
    expect(Object.keys(read(RULES).agents)).toEqual(['A3', 'A3-nb', 'A3-nb-same']);
    for (const record of [SEED_A, SEED_B, RULES]) {
      const replay = cli('replay', MANIFEST_FILE, record);
      expect(replay.code).toBe(0);
      expect(replay.out).toMatch(/Replay identical/);
    }
    expect(leftovers()).toEqual([]);
  });
  it('will not overwrite a record without --force, and replaces it with it', () => {
    const again = cli('run-seed', MANIFEST_FILE, '--seed', '7711', '--out', SEED_A);
    expect(again.code).toBe(2);
    expect(again.err).toMatch(/already exists/);
    expect(cli('run-seed', MANIFEST_FILE, '--seed', '7711', '--out', SEED_A, '--force').code).toBe(0);
  });
  it('a tampered record fails replay with a differing path or a refusal', () => {
    const tampered = read(SEED_A);
    tampered.a5.validation.gatesPassed += 1;
    const file = write('tampered.json', tampered);
    const replay = cli('replay', MANIFEST_FILE, file);
    expect(replay.code).toBe(2);
    expect(replay.err).toMatch(/record|resultsHash|orderedProgress/);
  });
  it('analyses validation only, labels it mechanics with the real seed count, and writes both outputs', () => {
    const out = join(DIR, 'analysis');
    rmSync(out, { recursive: true, force: true });
    writeFileSync(join(DIR, 'placeholder'), '');
    const made = spawnSync(process.execPath, ['-e', `require('fs').mkdirSync(${JSON.stringify(out)})`]);
    expect(made.status).toBe(0);
    const result = cli('analyse', MANIFEST_FILE, SEED_A, SEED_B, '--rules', RULES, '--out-dir', out);
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/\(mechanics\): 2 independent seed/);
    expect(result.out).toMatch(/MECHANICS ONLY/);
    const analysis = read(join(out, 'analysis.json'));
    expect(analysis.label).toBe('mechanics');
    expect(analysis.heldOutIncluded).toBe(false);
    expect(readFileSync(join(out, 'report.md'), 'utf8')).toContain('2 independent seeds');
    const repeat = cli('analyse', MANIFEST_FILE, SEED_A, SEED_B, '--rules', RULES, '--out-dir', out);
    expect(repeat.code).toBe(2);
    expect(repeat.err).toMatch(/already exists/);
  });
});

describe('npm run e3 run-held-out: refusals that never reach the gate (the real held-out circuit is never evaluated here)', () => {
  // A confirmatory-shaped manifest on the real registry. It is only parsed; the records below are junk, so the command
  // refuses at the seed-record check, before the ledger is created or the gate is made.
  const confirmatory = (): Json => ({
    ...clone(MANIFEST),
    id: 'confirmatory-shaped-cli',
    label: 'confirmatory',
    seeds: [...E3_SEEDS],
    configuration: { generations: 100, training: c1Training() },
    tracks: {
      ...clone(MANIFEST).tracks,
      heldOut: [{ id: 'hairpin-chicane', contentHash: trackContentHash(loadTrack(hairpinChicane)) }],
    },
    authorisation: 'issue-33#cli-test',
    code: { revision: 'a'.repeat(40) },
  });
  it('refuses junk or incomplete seed records, writes no ledger and no record', () => {
    const manifestFile = write('confirmatory.json', confirmatory());
    const junk = write('junk-seed.json', { not: 'a record' });
    const rules = write('junk-rules.json', { not: 'a record' });
    const ledger = join(DIR, 'ledger-junk.json');
    const out = join(DIR, 'held-junk.json');
    const result = cli('run-held-out', manifestFile, junk, '--rules', rules, '--ledger', ledger, '--out', out, '--open-held-out');
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/record/i);
    expect(existsSync(ledger)).toBe(false);
    expect(existsSync(out)).toBe(false);
  });
  it('refuses an existing output file and never overwrites a held-out record', () => {
    const manifestFile = write('confirmatory2.json', confirmatory());
    const out = write('held-existing.json', 'precious');
    const result = cli('run-held-out', manifestFile, SEED_A, '--rules', RULES, '--ledger', join(DIR, 'ledger-exists.json'), '--out', out, '--open-held-out');
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/already exists/);
    expect(readFileSync(out, 'utf8')).toBe('precious');
    expect(existsSync(join(DIR, 'ledger-exists.json'))).toBe(false);
  });
  it('refuses an output that is the ledger or an input', () => {
    const manifestFile = write('confirmatory3.json', confirmatory());
    const ledger = join(DIR, 'ledger-same.json');
    const result = cli('run-held-out', manifestFile, SEED_A, '--rules', RULES, '--ledger', ledger, '--out', ledger, '--open-held-out');
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/one of the input files/);
  });
});
