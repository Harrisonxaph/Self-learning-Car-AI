// The file-backed held-out opening ledger (scripts/ledgerFile.mjs, P5-01 step 4c): a claim is written to disk before any
// access, is never overwritten, survives a restart, and a corrupt ledger is refused rather than repaired.
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
});
