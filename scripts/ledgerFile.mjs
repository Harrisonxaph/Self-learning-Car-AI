// A held-out opening ledger kept in a file (P5-01 step 4c), for scripts/e3.mjs. The ledger is a JSON array of openings
// (src/training/heldOutAccess.ts). It is the study's memory of "the held-out look has been taken": a claim is written to
// disk BEFORE the gate gives any access, so a crash, a lost record or a restart can never hand out a second look.
//
// Nothing here knows what an opening is: validation and the "already opened" refusal are the library's own
// (`createMemoryLedger`, passed in), so this file only persists. It never overwrites or deletes a ledger.
import { existsSync, lstatSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export class LedgerFileError extends Error {
  name = 'LedgerFileError';
}

/**
 * @param {string} path the ledger file (created by the first claim)
 * @param {(recorded: readonly unknown[]) => { openings(): readonly unknown[]; claim(opening: unknown): void }} createMemoryLedger
 */
export function createFileLedger(path, createMemoryLedger) {
  const load = () => {
    let text;
    try {
      if (lstatSync(path).isDirectory()) throw new LedgerFileError(`The ledger ${path} is a directory.`);
      text = readFileSync(path, 'utf8');
    } catch (error) {
      if (error instanceof LedgerFileError) throw error;
      if (error.code === 'ENOENT') return createMemoryLedger([]);
      throw new LedgerFileError(`Cannot read the ledger ${path}: ${error.message}`);
    }
    let recorded;
    try {
      recorded = JSON.parse(text);
    } catch (error) {
      throw new LedgerFileError(`The ledger ${path} is not valid JSON (it is refused, not repaired): ${error.message}`);
    }
    // The library refuses a malformed opening or a repeated protocol.
    return createMemoryLedger(recorded);
  };
  return {
    openings: () => load().openings(),
    claim(opening) {
      const ledger = load();
      ledger.claim(opening); // refuses a protocol that is already in the ledger
      const text = `${JSON.stringify(ledger.openings(), null, 2)}\n`;
      const folder = existsSync(dirname(path)) ? mkdtempSync(join(dirname(path), `.${basename(path)}.tmp-`)) : null;
      if (folder === null) throw new LedgerFileError(`The folder for the ledger ${path} does not exist; the opening was not claimed.`);
      try {
        const temporary = join(folder, 'ledger.json');
        writeFileSync(temporary, text, { flag: 'wx' });
        renameSync(temporary, path);
      } catch (error) {
        throw new LedgerFileError(`The opening could not be written to the ledger ${path}, so it was not claimed: ${error.message}`);
      } finally {
        rmSync(folder, { recursive: true, force: true });
      }
    },
  };
}
