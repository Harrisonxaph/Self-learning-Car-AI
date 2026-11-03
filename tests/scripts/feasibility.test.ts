// The feasibility command line (scripts/feasibility.mjs, P2-09 plan step 3), run as a separate Node process exactly as
// `npm run feasibility` runs it. Only the refusal paths are tested: every case here fails in argument or directory
// checking BEFORE the grid is run, so no feasibility check is executed and nothing is written. The run itself is plan
// step 4, which needs its own authorisation.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../..');
const DIR = mkdtempSync(join(tmpdir(), 'feasibility-cli-'));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const run = (...args: string[]) => spawnSync(process.execPath, [join(ROOT, 'scripts/feasibility.mjs'), ...args], { cwd: ROOT, encoding: 'utf8' });

describe('npm run feasibility: refusals before the grid runs', () => {
  it('is wired as an npm script', () => {
    const scripts = JSON.parse(spawnSync('node', ['-p', 'JSON.stringify(require("./package.json").scripts)'], { cwd: ROOT, encoding: 'utf8' }).stdout) as Record<string, string>;
    expect(scripts.feasibility).toBe('node scripts/feasibility.mjs');
  });

  it.each([
    ['no command', [], 'Unknown command (none)'],
    ['an unknown command', ['analyse'], 'Unknown command analyse'],
    ['a missing --out-dir', ['run'], '--out-dir is required'],
    ['--out-dir without a value', ['run', '--out-dir'], '--out-dir needs a directory'],
    ['--out-dir followed by a flag', ['run', '--out-dir', '--force'], '--out-dir needs a directory'],
    ['a repeated --out-dir', ['run', '--out-dir', DIR, '--out-dir', DIR], '--out-dir is given more than once'],
    ['a repeated --force', ['run', '--out-dir', DIR, '--force', '--force'], '--force is given more than once'],
    ['an unexpected argument', ['run', '--out-dir', DIR, '--grid', 'small'], 'Unexpected argument --grid'],
  ])('exits 2 with the usage for %s', (_label, args, message) => {
    const result = run(...args);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(message);
    expect(result.stderr).toContain('Usage:');
    expect(result.stdout).not.toContain('Feasibility check');
  });

  it('exits 2 for a directory that does not exist, and creates nothing', () => {
    const missing = join(DIR, 'missing');
    const result = run('run', '--out-dir', missing);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('does not exist');
    expect(existsSync(missing)).toBe(false);
  });

  it('exits 2 for a path that is a file', () => {
    const file = join(DIR, 'a-file');
    writeFileSync(file, 'x');
    const result = run('run', '--out-dir', file);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('is not a directory');
  });

  it('exits 2 for a symbolic link to a directory, and writes nothing through it', () => {
    const target = join(DIR, 'target');
    mkdirSync(target);
    const link = join(DIR, 'link');
    symlinkSync(target, link);
    const result = run('run', '--out-dir', link);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('is not a directory');
    expect(readdirSync(target)).toEqual([]);
  });

  it('offers no way to change the grid or the tracks from the command line', () => {
    const result = run('run', '--out-dir', DIR, '--tracks', 'hairpin-chicane');
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Unexpected argument --tracks');
    expect(readdirSync(DIR).filter((name) => name.startsWith('feasibility'))).toEqual([]);
  });
});
