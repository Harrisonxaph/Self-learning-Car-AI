// Writing a study record safely (C2, docs/experiments/p2-08-step3-design.md §4.6). Used by scripts/study.mjs and
// tested directly by tests/scripts/study.test.ts.
import { linkSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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
