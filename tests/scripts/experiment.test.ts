// The experiment command line (scripts/experiment.mjs, P2-07), run as a separate Node process exactly as
// `npm run experiment` runs it: record then replay the example configuration, and the exit codes for a differing
// replay and for invalid, incompatible or unreadable input. Training oval only; no held-out track is evaluated.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { canonicalJson } from '../../src/training/experiment';
import { sha256Hex } from '../../src/utils/sha256';

const ROOT = join(__dirname, '../..');
const DIR = mkdtempSync(join(tmpdir(), 'experiment-cli-'));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const cli = (...args: string[]) => {
  const result = spawnSync(process.execPath, ['scripts/experiment.mjs', ...args], { cwd: ROOT, encoding: 'utf8' });
  return { code: result.status, out: result.stdout, err: result.stderr };
};
const RECORD = join(DIR, 'smoke.json');
const write = (name: string, data: unknown) => {
  const path = join(DIR, name);
  writeFileSync(path, typeof data === 'string' ? data : JSON.stringify(data));
  return path;
};

describe('experiment command line', () => {
  it('records the example configuration and replays it to identical results', () => {
    const run = cli('run', 'experiments/configs/smoke-oval.json', '--out', RECORD);
    expect(run.err.replace(/^Warning: the worktree.*\n/m, '')).toBe('');
    expect(run.code).toBe(0);
    expect(run.out).toContain('Experiment smoke-oval: 2 run(s) of 3 generation(s) on stadium-oval.');
    expect(run.out).toContain('not evidence of learning');
    const record = JSON.parse(readFileSync(RECORD, 'utf8'));
    expect(record.engine).toEqual({ name: 'node', version: process.version, v8: process.versions.v8 });
    expect(record.source.appVersion).toBe('0.0.0');
    expect(record.source.revision === null || /^[0-9a-f]{40}$/.test(record.source.revision)).toBe(true);
    expect(Number.isNaN(Date.parse(record.recordedAt))).toBe(false);

    const replay = cli('replay', RECORD);
    expect(replay.code).toBe(0);
    expect(replay.out).toContain('Replay identical: 2 run(s)');
  });

  it('refuses to overwrite a record unless told to', () => {
    const again = cli('run', 'experiments/configs/smoke-oval.json', '--out', RECORD);
    expect(again.code).toBe(2);
    expect(again.err).toContain('already exists; pass --force');
  });

  it('exits 1 and names the path when a consistently edited record replays differently', () => {
    const record = JSON.parse(readFileSync(RECORD, 'utf8'));
    const final = record.runs[0].generations[2];
    const other = (final.stats.championIndex + 1) % final.cars.length;
    final.cars[other].fitness.total += 1;
    record.resultsHash = `sha256:${sha256Hex(canonicalJson(record.runs))}`;
    const replay = cli('replay', write('edited.json', record));
    expect(replay.code).toBe(1);
    expect(replay.out).toContain(`runs[0].generations[2].cars[${other}].fitness.total`);
  });

  it('exits 1, not 2, when a replayed car completes a different number of laps', () => {
    const record = JSON.parse(readFileSync(RECORD, 'utf8'));
    const final = record.runs[1].generations[2];
    const other = (final.stats.championIndex + 1) % final.cars.length;
    final.cars[other].lapTicks.push(5);
    record.resultsHash = `sha256:${sha256Hex(canonicalJson(record.runs))}`;
    const replay = cli('replay', write('extra-lap.json', record));
    expect(replay.err).toBe('');
    expect(replay.code).toBe(1);
    expect(replay.out).toContain(`runs[1].generations[2].cars[${other}].lapTicks[`);
    expect(replay.out).toContain('missing from the replay');
  });

  it.each([
    ['a record edited without its hash', () => {
      const record = JSON.parse(readFileSync(RECORD, 'utf8'));
      record.runs[0].generations[0].cars[0].ticks += 1;
      return write('tampered.json', record);
    }, /resultsHash does not match/],
    ['a record from another engine', () => {
      const record = JSON.parse(readFileSync(RECORD, 'utf8'));
      record.engine.version = 'v22.0.0';
      return write('other-engine.json', record);
    }, /only reproducible within one engine/],
    ['an incomplete record', () => {
      const record = JSON.parse(readFileSync(RECORD, 'utf8'));
      delete record.budgets;
      return write('incomplete.json', record);
    }, /incomplete: record.budgets is missing/],
    ['a file that is not JSON', () => write('broken.json', '{"format": '), /not valid JSON/],
    ['a missing file', () => join(DIR, 'missing.json'), /Cannot read/],
  ])('exits 2 for %s', (_, file, message) => {
    const replay = cli('replay', file());
    expect(replay.code).toBe(2);
    expect(replay.err).toMatch(message);
  });

  it.each([
    ['a held-out track', { trackId: 'hairpin-chicane' }, /hairpin-chicane" is a held-out track/],
    ['a validation track', { trackId: 'rounded-rectangle' }, /rounded-rectangle" is a validation track/],
    ['an invalid setting', { generations: 0 }, /"generations"/],
  ])('exits 2 for a configuration naming %s, writing nothing', (_, change, message) => {
    const config = { ...JSON.parse(readFileSync(join(ROOT, 'experiments/configs/smoke-oval.json'), 'utf8')), ...change };
    const out = join(DIR, `never-${Object.values(change).join('-')}.json`);
    const run = cli('run', write('config.json', config), '--out', out);
    expect(run.code).toBe(2);
    expect(run.err).toMatch(message);
    expect(() => readFileSync(out)).toThrow();
  });

  it.each([[[]], [['train', 'x']], [['run', 'x.json']], [['replay']], [['replay', 'x.json', '--out', 'y']]])('exits 2 with usage for %j', (args) => {
    const result = cli(...args);
    expect(result.code).toBe(2);
    expect(result.err).toContain('Usage:');
  });
});
