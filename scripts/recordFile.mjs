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

/** An output name already holds a directory. It is never replaced, even with `force`, because replacing it would delete its contents. */
export class OutputDirectoryError extends Error {
  name = 'OutputDirectoryError';
}

/**
 * Checks, before any work is done, that every output named in `names` can be written into `outDir`: the entry itself
 * (not what a symbolic link points to, so a dangling link counts as existing) must not be a directory, even with
 * `force`, and must not exist at all unless `force` is given. Throws OutputDirectoryError or OutputExistsError.
 * writeRecordPair moves an existing entry aside and removes it afterwards, so a directory here would be lost.
 */
export function checkOutputEntries(outDir, names, force) {
  for (const name of names) {
    const out = join(outDir, name);
    let existing;
    try {
      existing = lstatSync(out);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (existing.isDirectory()) throw new OutputDirectoryError(`${out} is a directory; choose another output folder or remove it yourself.`);
    if (!force) throw new OutputExistsError(`${out} already exists${existing.isSymbolicLink() ? ' as a symbolic link' : ''}; pass --force to replace it.`);
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
 * this call installed is atomically moved into the owned folder before its inode is inspected. An unexpected
 * replacement is linked back without replacing any entry, or kept and named if it cannot be put back. Only owned
 * content is discarded. Originals are restored with the same no-clobber links. If an original or captured
 * replacement cannot be restored, the folder is kept and RollbackIncompleteError names its recovery path.
 * An existing output that turns out to be a directory (even one created after a preflight check) is put back and
 * refused with OutputDirectoryError, never deleted. Staging is covered by the cleanup guard too. `ops` replaces the file-system calls in tests.
 */
export function writeRecordPair(entries, force, ops = nodeOps) {
  const dir = dirname(entries[0].out);
  if (entries.some((e) => dirname(e.out) !== dir)) throw new RangeError('writeRecordPair writes into one folder.');
  const folder = mkdtempSync(join(dir, '.analysis.tmp-'));
  let keepFolder = false;
  try {
    const staged = entries.map((e, i) => {
      const temporary = join(folder, `new-${i}`);
      writeFileSync(temporary, e.text, { flag: 'wx' });
      return { ...e, temporary, ino: lstatSync(temporary).ino, backup: null, installed: false };
    });
    try {
      for (const [i, s] of staged.entries()) {
        if (force && entryOf(ops, s.out) !== null) {
          const backup = join(folder, `old-${i}`);
          ops.rename(s.out, backup);
          s.backup = backup;
          // Inspect what was actually captured, not what a check saw earlier: a directory that appeared since any
          // preflight check must not be discarded with the owned folder (Codex review of 54c186f).
          if (ops.lstat(backup).isDirectory()) {
            s.backupIsDirectory = true;
            throw new OutputDirectoryError(`${s.out} is a directory; choose another output folder or remove it yourself.`);
          }
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
      // Every rollback step is guarded on its own: a failure here must never lose an original, so any original
      // that cannot be moved back stays in the kept folder and is named.
      const problems = [];
      for (const [i, s] of staged.entries()) {
        if (s.installed) {
          const removed = join(folder, `removed-${i}`);
          let captured = false;
          try {
            // Capture the entry actually withdrawn, rather than checking a path and later unlinking its replacement.
            ops.rename(s.out, removed);
            captured = true;
            if (ops.lstat(removed).ino !== s.ino) ops.link(removed, s.out);
          } catch (undo) {
            if (captured) problems.push(`${s.out} could not be recovered (${undo.message}) (its captured content is at ${removed})`);
            else if (undo.code !== 'ENOENT') problems.push(`${s.out} could not be withdrawn (${undo.message})`);
          }
        }
        if (s.backup === null) continue;
        // A hard link never replaces an entry, so an entry created at any moment before the restore is kept
        // (Codex review of b6b4015: a check-then-rename could overwrite one created between the two steps).
        try {
          // A directory cannot be hard-linked. A rename puts it back and never replaces a file or a non-empty directory.
          if (s.backupIsDirectory) ops.rename(s.backup, s.out);
          else ops.link(s.backup, s.out);
        } catch (restore) {
          if (restore.code === 'EEXIST' || restore.code === 'ENOTEMPTY' || restore.code === 'ENOTDIR') problems.push(`another entry now holds ${s.out} (its previous content is at ${s.backup})`);
          else problems.push(`${s.out} could not be restored (${restore.message}); its previous content is at ${s.backup}`);
        }
      }
      if (problems.length > 0) {
        keepFolder = true;
        throw new RollbackIncompleteError(`${error.message} Rollback incomplete: ${problems.join('; ')}.`);
      }
      throw error;
    }
  } finally {
    if (!keepFolder) rmSync(folder, { recursive: true, force: true });
  }
}
