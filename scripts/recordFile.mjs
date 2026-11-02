// Writing study outputs safely (C2 and D2, docs/experiments/p2-08-step3-design.md §4.6 and §5.2). Used by
// scripts/study.mjs and tested directly by tests/scripts/study.test.ts and tests/scripts/studyAnalyse.test.ts.
import { linkSync, lstatSync, mkdtempSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/** The output already exists and replacing it was not allowed. */
export class OutputExistsError extends Error {
  name = 'OutputExistsError';
}

/**
 * Writes `text` to `out` in full or not at all. The text goes first into a new folder beside the output that this
 * call creates (so it owns every name inside it), then is moved into place: by a hard link when `force` is false,
 * which fails if the output exists, or by a rename when it is true. Only that folder is ever removed, so no
 * existing file is touched unless it is `out` itself with `force`.
 */
export function writeRecordFile(out, text, force) {
  const folder = mkdtempSync(join(dirname(out), `.${basename(out)}.tmp-`));
  try {
    const temporary = join(folder, 'record.json');
    writeFileSync(temporary, text, { flag: 'wx' });
    if (force) renameSync(temporary, out);
    else {
      try {
        linkSync(temporary, out); // fails if the output appeared while the seed ran
      } catch (error) {
        if (error.code === 'EEXIST') throw new OutputExistsError(`${out} already exists; pass --force to replace it.`);
        throw error;
      }
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/** Rolling back a failed pair left an original output aside, because a new entry now holds its name. */
export class RollbackIncompleteError extends Error {
  name = 'RollbackIncompleteError';
}

const nodeOps = { link: linkSync, rename: renameSync, lstat: lstatSync, unlink: unlinkSync };

const entryOf = (ops, path) => {
  try {
    return ops.lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
};

/**
 * Writes several outputs in one folder as a single unit (D2, design §5.2): either every output is installed, or
 * the folder is left as it was before the call. Both texts are written first into one new folder that this call
 * creates (so it owns every name inside it). With `force`, each existing output is moved aside into that folder.
 * Each new file is then installed with a hard link, which never replaces an entry. If any step fails, every output
 * this call installed (recognised by its own inode, so a concurrently created entry is never touched) is removed
 * and every original is moved back. If an original cannot be moved back because another entry has taken its name,
 * the folder is kept and RollbackIncompleteError names where the original is. `ops` replaces the file-system calls
 * in tests.
 */
export function writeRecordPair(entries, force, ops = nodeOps) {
  const dir = dirname(entries[0].out);
  if (entries.some((e) => dirname(e.out) !== dir)) throw new RangeError('writeRecordPair writes into one folder.');
  const folder = mkdtempSync(join(dir, '.analysis.tmp-'));
  const staged = entries.map((e, i) => {
    const temporary = join(folder, `new-${i}`);
    writeFileSync(temporary, e.text, { flag: 'wx' });
    return { ...e, temporary, ino: lstatSync(temporary).ino, backup: null, installed: false };
  });
  let keepFolder = false;
  try {
    try {
      for (const [i, s] of staged.entries()) {
        if (force && entryOf(ops, s.out) !== null) {
          const backup = join(folder, `old-${i}`);
          ops.rename(s.out, backup);
          s.backup = backup;
        }
      }
      for (const s of staged) {
        try {
          ops.link(s.temporary, s.out);
        } catch (error) {
          if (error.code === 'EEXIST') throw new OutputExistsError(`${s.out} already exists; pass --force to replace it.`);
          throw error;
        }
        s.installed = true;
      }
    } catch (error) {
      const stranded = [];
      for (const s of staged) {
        const current = entryOf(ops, s.out);
        if (s.installed && current !== null && current.ino === s.ino) ops.unlink(s.out);
        if (s.backup !== null) {
          if (entryOf(ops, s.out) === null) ops.rename(s.backup, s.out);
          else stranded.push(`${s.out} (its previous content is at ${s.backup})`);
        }
      }
      if (stranded.length > 0) {
        keepFolder = true;
        throw new RollbackIncompleteError(`${error.message} Another entry now holds ${stranded.join(', ')}.`);
      }
      throw error;
    }
  } finally {
    if (!keepFolder) rmSync(folder, { recursive: true, force: true });
  }
}
