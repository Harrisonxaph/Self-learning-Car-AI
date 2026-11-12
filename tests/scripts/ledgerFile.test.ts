// The file-backed held-out opening ledger (scripts/ledgerFile.mjs, P5-01 step 4c): a claim is written to disk before any
// access, is never overwritten, survives a restart, and a corrupt ledger is refused rather than repaired.
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createFileLedger, LedgerFileError } from '../../scripts/ledgerFile.mjs';
import { createMemoryLedger, HeldOutAccessError } from '../../src/training/heldOutAccess';

const DIR = mkdtempSync(join(tmpdir(), 'ledger-'));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));
const hash = (c: string) => `sha256:${c.repeat(64)}`;
const opening = (protocol = '1') => ({ protocolHash: hash(protocol), authorisationId: 'issue-33#test', trackIds: ['t'], agentIds: [hash('a')] });
const make = (path: string) => createFileLedger(path, createMemoryLedger as never);

describe('the file ledger', () => {
  it('starts empty, persists a claim to disk, and a new instance (a restart) sees it and refuses a repeat', () => {
    const path = join(DIR, 'a.json');
    const ledger = make(path);
    expect(ledger.openings()).toEqual([]);
    expect(existsSync(path)).toBe(false);
    ledger.claim(opening('1'));
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual([opening('1')]);
    const restarted = make(path);
    expect(restarted.openings()).toEqual([opening('1')]);
    expect(() => restarted.claim(opening('1'))).toThrow(HeldOutAccessError);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual([opening('1')]);
    restarted.claim(opening('2'));
    expect(make(path).openings().length).toBe(2);
  });
  it('refuses a corrupt, malformed or directory ledger and never repairs or overwrites it', () => {
    const bad = join(DIR, 'bad.json');
    writeFileSync(bad, '{not json');
    expect(() => make(bad).openings()).toThrow(LedgerFileError);
    expect(() => make(bad).claim(opening())).toThrow(LedgerFileError);
    expect(readFileSync(bad, 'utf8')).toBe('{not json');
    const malformed = join(DIR, 'malformed.json');
    writeFileSync(malformed, JSON.stringify([{ protocolHash: 'x' }]));
    expect(() => make(malformed).claim(opening())).toThrow(HeldOutAccessError);
    const dir = join(DIR, 'a-directory');
    mkdirSync(dir);
    expect(() => make(dir).openings()).toThrow(/directory/);
  });
  it('a claim that cannot be written is not claimed, and leaves no temporary files', () => {
    expect(() => make(join(DIR, 'missing-folder', 'l.json')).claim(opening())).toThrow(LedgerFileError);
    const locked = join(DIR, 'locked');
    mkdirSync(locked);
    const path = join(locked, 'l.json');
    chmodSync(locked, 0o500);
    try {
      if (process.getuid?.() !== 0) {
        expect(() => make(path).claim(opening())).toThrow(LedgerFileError);
        expect(existsSync(path)).toBe(false);
      }
    } finally {
      chmodSync(locked, 0o700);
    }
    expect(readdirSync(locked).filter((n) => n.includes('.tmp-'))).toEqual([]);
  });

  it('a lock left behind is refused, not broken, and the ledger is untouched', () => {
    const path = join(DIR, 'locked-ledger.json');
    writeFileSync(`${path}.lock`, '');
    expect(() => make(path).claim(opening())).toThrow(/locked/);
    expect(existsSync(path)).toBe(false);
    expect(existsSync(`${path}.lock`)).toBe(true);
  });
  it('the lock is released after a claim, a refused repeat and a failed write', () => {
    const path = join(DIR, 'release.json');
    make(path).claim(opening());
    expect(existsSync(`${path}.lock`)).toBe(false);
    expect(() => make(path).claim(opening())).toThrow(HeldOutAccessError);
    expect(existsSync(`${path}.lock`)).toBe(false);
    expect(() => make(join(DIR, 'missing-folder', 'l.json')).claim(opening())).toThrow(LedgerFileError);
  });
  it('two processes claiming the same opening at once: exactly one succeeds, the ledger holds one opening', async () => {
    const path = join(DIR, 'race.json');
    // Each child claims through the real file ledger with a plain in-memory ledger whose claim pauses inside the lock, so
    // that without the lock both would read an empty ledger and both would claim.
    const script = `
      import { createFileLedger } from ${JSON.stringify(join(__dirname, '../../scripts/ledgerFile.mjs'))};
      const make = (recorded) => {
        const list = [...recorded];
        return { openings: () => list, claim: (o) => { if (list.some((x) => x.protocolHash === o.protocolHash)) throw new Error('already opened'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400); list.push(o); } };
      };
      try { createFileLedger(${JSON.stringify(path)}, make).claim(${JSON.stringify(opening('9'))}); process.exit(0); } catch (e) { console.error(e.message); process.exit(3); }
    `;
    const run = () =>
      new Promise<{ code: number | null; err: string }>((resolve) => {
        const child = spawn(process.execPath, ['--input-type=module', '-e', script]);
        let err = '';
        child.stderr.on('data', (d) => (err += String(d)));
        child.on('close', (code) => resolve({ code, err }));
      });
    const results = await Promise.all([run(), run()]);
    expect(results.map((r) => r.code).sort()).toEqual([0, 3]);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual([opening('9')]);
    expect(existsSync(`${path}.lock`)).toBe(false);
  });
});
