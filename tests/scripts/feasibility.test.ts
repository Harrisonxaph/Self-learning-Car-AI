// The feasibility command line (scripts/feasibility.mjs, P2-09 plan step 3), run as a separate Node process exactly as
// `npm run feasibility` runs it. Only the refusal paths are tested: every case here fails in argument or directory
// checking BEFORE the grid is run, so no feasibility check is executed and nothing is written. The run itself is plan
// step 4, which needs its own authorisation.
import { spawnSync } from 'node:child_process';
import { existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { checkOutputEntries, OutputDirectoryError, OutputExistsError, RollbackIncompleteError, writeRecordPair } from '../../scripts/recordFile.mjs';

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

// Codex review of 4dafb57 (P1): with --force, a directory named feasibility.json or feasibility.md in the output folder
// was silently deleted with its contents, because writeRecordPair moves an existing entry aside and removes it. Every
// case below fails in the output check BEFORE the grid would run.
describe('npm run feasibility: existing outputs are checked before the grid runs', () => {
  const fresh = (name: string) => {
    const dir = join(DIR, name);
    mkdirSync(dir);
    return dir;
  };

  it.each(['feasibility.json', 'feasibility.md'])('never deletes a directory named %s, with or without --force', (name) => {
    for (const force of [false, true]) {
      const dir = fresh(`dir-${name}-${force}`);
      mkdirSync(join(dir, name, 'precious'), { recursive: true });
      writeFileSync(join(dir, name, 'precious', 'file.txt'), 'keep');
      const result = run('run', '--out-dir', dir, ...(force ? ['--force'] : []));
      expect(result.status).toBe(2);
      expect(result.stderr).toContain(`${join(dir, name)} is a directory`);
      expect(result.stdout).not.toContain('Feasibility check');
      expect(readFileSync(join(dir, name, 'precious', 'file.txt'), 'utf8')).toBe('keep');
      expect(readdirSync(dir)).toEqual([name]); // and nothing else was created
    }
  });

  it.each(['feasibility.json', 'feasibility.md'])('refuses an existing %s without --force, and leaves it and the other output alone', (name) => {
    const dir = fresh(`file-${name}`);
    writeFileSync(join(dir, name), 'original');
    const result = run('run', '--out-dir', dir);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(`${join(dir, name)} already exists; pass --force to replace it.`);
    expect(readFileSync(join(dir, name), 'utf8')).toBe('original');
    expect(readdirSync(dir)).toEqual([name]);
  });

  it('refuses a dangling symbolic link at an output name without --force, naming it as a link', () => {
    const dir = fresh('dangling');
    symlinkSync(join(DIR, 'nowhere'), join(dir, 'feasibility.json'));
    const result = run('run', '--out-dir', dir);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('already exists as a symbolic link');
    expect(lstatSync(join(dir, 'feasibility.json')).isSymbolicLink()).toBe(true);
  });
});

describe('checkOutputEntries', () => {
  const fresh = (name: string) => {
    const dir = join(DIR, `check-${name}`);
    mkdirSync(dir);
    return dir;
  };
  const NAMES = ['feasibility.json', 'feasibility.md'];

  it('passes when no output exists, and with --force when each is an existing file', () => {
    const dir = fresh('clear');
    expect(() => checkOutputEntries(dir, NAMES, false)).not.toThrow();
    expect(() => checkOutputEntries(dir, NAMES, true)).not.toThrow();
    writeFileSync(join(dir, 'feasibility.json'), '{}');
    writeFileSync(join(dir, 'feasibility.md'), 'x');
    expect(() => checkOutputEntries(dir, NAMES, true)).not.toThrow();
  });

  it('throws OutputExistsError for an existing file without --force, whichever output it is', () => {
    for (const name of NAMES) {
      const dir = fresh(`exists-${name}`);
      writeFileSync(join(dir, name), 'x');
      expect(() => checkOutputEntries(dir, NAMES, false)).toThrow(OutputExistsError);
    }
  });

  it('throws OutputDirectoryError for a directory, with and without --force, whichever output it is', () => {
    for (const name of NAMES) {
      for (const force of [false, true]) {
        const dir = fresh(`directory-${name}-${force}`);
        mkdirSync(join(dir, name));
        expect(() => checkOutputEntries(dir, NAMES, force)).toThrow(OutputDirectoryError);
      }
    }
  });

  it('checks every output: a directory at the second name is refused even when the first is a file and --force is given', () => {
    const dir = fresh('second');
    writeFileSync(join(dir, 'feasibility.json'), 'x');
    mkdirSync(join(dir, 'feasibility.md'));
    expect(() => checkOutputEntries(dir, NAMES, true)).toThrow(OutputDirectoryError);
  });

  it('looks at the entry itself, not its target: a link to a directory is replaceable with --force, a dangling link counts as existing', () => {
    const dir = fresh('links');
    const target = join(DIR, 'link-target');
    mkdirSync(target);
    symlinkSync(target, join(dir, 'feasibility.json'));
    symlinkSync(join(DIR, 'nowhere-either'), join(dir, 'feasibility.md'));
    expect(() => checkOutputEntries(dir, NAMES, true)).not.toThrow(); // the links are replaced, never their targets
    expect(() => checkOutputEntries(dir, NAMES, false)).toThrow(OutputExistsError);
  });
});

// Codex review of 54c186f (P1): the preflight check runs BEFORE the grid, and the grid takes a while, so a directory can
// appear at an output name between that check and the write. writeRecordPair must then refuse it and put it back; it
// must never delete it. No grid is run: the sequence is checkOutputEntries, then a directory appears, then the writer.
describe('writeRecordPair: a directory that appears after the preflight check (--force)', () => {
  const NAMES = ['feasibility.json', 'feasibility.md'];
  const pair = (dir: string) => NAMES.map((name) => ({ out: join(dir, name), text: `new ${name}` }));
  const fresh = (name: string) => {
    const dir = join(DIR, `late-${name}`);
    mkdirSync(dir);
    return dir;
  };
  const ops = (over: Record<string, unknown> = {}) => ({ link: linkSync, rename: renameSync, lstat: lstatSync, unlink: unlinkSync, ...over });
  const keepDirectory = (dir: string, name: string) => {
    mkdirSync(join(dir, name, 'inner'), { recursive: true });
    writeFileSync(join(dir, name, 'keep.txt'), 'keep');
    writeFileSync(join(dir, name, 'inner', 'deep.txt'), 'deep');
  };
  const expectIntact = (dir: string, name: string) => {
    expect(lstatSync(join(dir, name)).isDirectory()).toBe(true);
    expect(readFileSync(join(dir, name, 'keep.txt'), 'utf8')).toBe('keep');
    expect(readFileSync(join(dir, name, 'inner', 'deep.txt'), 'utf8')).toBe('deep');
  };

  it.each(NAMES)('refuses a directory at %s, keeps its contents, and leaves nothing else behind', (name) => {
    const dir = fresh(`only-${name}`);
    expect(() => checkOutputEntries(dir, NAMES, true)).not.toThrow(); // the preflight passes: nothing is there yet
    keepDirectory(dir, name); // ... then the directory appears while the grid runs
    expect(() => writeRecordPair(pair(dir), true)).toThrow(OutputDirectoryError);
    expectIntact(dir, name);
    expect(readdirSync(dir)).toEqual([name]);
  });

  it.each([
    ['feasibility.json', 'feasibility.md'],
    ['feasibility.md', 'feasibility.json'],
  ])('with a directory at %s and an existing file at %s, both previous outputs are preserved on refusal', (directory, file) => {
    const dir = fresh(`mixed-${directory}`);
    writeFileSync(join(dir, file), 'previous file');
    expect(() => checkOutputEntries(dir, NAMES, true)).not.toThrow();
    keepDirectory(dir, directory);
    expect(() => writeRecordPair(pair(dir), true)).toThrow(OutputDirectoryError);
    expectIntact(dir, directory);
    expect(readFileSync(join(dir, file), 'utf8')).toBe('previous file');
    expect(readdirSync(dir).sort()).toEqual([...NAMES].sort());
  });

  it('keeps both directories when both outputs became directories', () => {
    const dir = fresh('both');
    for (const name of NAMES) keepDirectory(dir, name);
    expect(() => writeRecordPair(pair(dir), true)).toThrow(OutputDirectoryError);
    for (const name of NAMES) expectIntact(dir, name);
    expect(readdirSync(dir).sort()).toEqual([...NAMES].sort());
  });

  it('refuses a directory without --force as well, and keeps it', () => {
    const dir = fresh('no-force');
    keepDirectory(dir, 'feasibility.md');
    expect(() => writeRecordPair(pair(dir), false)).toThrow(OutputExistsError);
    expectIntact(dir, 'feasibility.md');
    expect(readdirSync(dir)).toEqual(['feasibility.md']);
  });

  it('a directory that appears between the check and the move-aside is still kept (it is the captured entry that is inspected)', () => {
    const dir = fresh('between');
    writeFileSync(join(dir, 'feasibility.md'), 'previous file');
    const out = join(dir, 'feasibility.md');
    // The path holds a file when the writer looks, and a directory when it is moved aside.
    let swapped = false;
    const racing = ops({
      rename: (from: string, to: string) => {
        if (from === out && !swapped) {
          swapped = true;
          rmSync(out);
          keepDirectory(dir, 'feasibility.md');
        }
        renameSync(from, to);
      },
    });
    expect(() => writeRecordPair(pair(dir), true, racing as never)).toThrow(OutputDirectoryError);
    expectIntact(dir, 'feasibility.md');
    expect(readdirSync(dir)).toEqual(['feasibility.md']);
  });

  it('if a directory cannot be put back, it is kept and its recovery path is named', () => {
    const dir = fresh('restore-fails');
    keepDirectory(dir, 'feasibility.md');
    const failing = ops({
      rename: (from: string, to: string) => {
        if (basename(from).startsWith('old-')) throw Object.assign(new Error('injected EIO'), { code: 'EIO' });
        renameSync(from, to);
      },
    });
    let error: unknown;
    try {
      writeRecordPair(pair(dir), true, failing as never);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(RollbackIncompleteError);
    const recovery = (error as Error).message.match(/previous content is at (\S+?)(\)|\.$|;)/)![1]!;
    expect(readFileSync(join(recovery, 'keep.txt'), 'utf8')).toBe('keep');
    expect(readFileSync(join(recovery, 'inner', 'deep.txt'), 'utf8')).toBe('deep');
    rmSync(join(recovery, '..'), { recursive: true, force: true });
  });

  it('an entry created at the moment of the restore is kept, never replaced, and the directory is named', () => {
    const dir = fresh('restore-race');
    keepDirectory(dir, 'feasibility.md');
    const out = join(dir, 'feasibility.md');
    const racing = ops({
      rename: (from: string, to: string) => {
        if (basename(from).startsWith('old-') && to === out) writeFileSync(out, 'someone else');
        renameSync(from, to);
      },
    });
    let error: unknown;
    try {
      writeRecordPair(pair(dir), true, racing as never);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(RollbackIncompleteError);
    expect(readFileSync(out, 'utf8')).toBe('someone else');
    const recovery = (error as Error).message.match(/previous content is at (\S+?)(\)|\.$|;)/)![1]!;
    expect(readFileSync(join(recovery, 'keep.txt'), 'utf8')).toBe('keep');
    rmSync(join(recovery, '..'), { recursive: true, force: true });
  });
});
