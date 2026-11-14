// The E5 command line (scripts/e5.mjs and scripts/e5Commands.mjs, P5-02 step 4). Two layers:
//  * the real `npm run e5` process on the BUILT-IN registry, tested through its refusals and the read-only commands: today every
//    held-out circuit on the registry is spent (E3 exposed it) and a mechanics manifest cannot use the built-in registry, so
//    `run-held-out` can only be refused and is never able to reach the gate;
//  * `execute` with INJECTED modules and a SYNTHETIC registry (a scaled oval), writing tiny E4 mechanics records (seeds 78xx) as gzip files:
//    the full run-held-out, replay and analyse round trip, the once-only ledger, and the refusals that must happen before the ledger is touched.
// No real held-out circuit is evaluated and no reserved seed is run, so nothing here is a study result or evidence of learning.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import manifestData from '../../src/data/tracks/index.json';
import hairpinChicane from '../../src/data/tracks/hairpin-chicane.json';
import roundedRectangle from '../../src/data/tracks/rounded-rectangle.json';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { loadTrack } from '../../src/sim/track';
import { resolveBaselineConfig } from '../../src/training/baselines';
import { BRAKE_USAGE_THRESHOLD } from '../../src/training/e4Agents';
import * as e4Study from '../../src/training/e4Study';
import * as e5Study from '../../src/training/e5Study';
import * as access from '../../src/training/heldOutAccess';
import { manifestRecord } from '../../src/training/experiment';
import { currentStreams, hashOf, METRIC, trackReferences, WILCOXON, type StudyContext } from '../../src/training/study';
import { BUILT_IN_TRACK_SPLITS, loadTrackSplits, trackContentHash } from '../../src/training/trackSplits';
import { execute, parseArgs, readE4Records, UsageError, type E5Deps } from '../../scripts/e5Commands.mjs';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ROOT = join(__dirname, '../..');
const DIR = mkdtempSync(join(tmpdir(), 'e5-cli-'));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const put = (name: string, data: unknown) => {
  const path = join(DIR, name);
  writeFileSync(path, typeof data === 'string' ? data : JSON.stringify(data));
  return path;
};

const cli = (...args: string[]) => {
  const result = spawnSync(process.execPath, ['scripts/e5.mjs', ...args], { cwd: ROOT, encoding: 'utf8' });
  return { code: result.status, out: result.stdout, err: result.stderr };
};

describe('argument handling (the real process)', () => {
  it.each<[string, string[], RegExp]>([
    ['no command', [], /Unknown command/],
    ['an unknown command', ['frobnicate'], /Unknown command frobnicate/],
    ['run-held-out without --open-held-out', ['run-held-out', 'm.json', '--e4-manifest', 'a', '--e4-dir', 'b', '--ledger', 'l.json', '--out', 'o.json'], /explicit option --open-held-out/],
    ['run-held-out without a ledger', ['run-held-out', 'm.json', '--e4-manifest', 'a', '--e4-dir', 'b', '--out', 'o.json', '--open-held-out'], /needs --ledger/],
    ['run-held-out with --force (a held-out record is never overwritten)', ['run-held-out', 'm.json', '--e4-manifest', 'a', '--e4-dir', 'b', '--ledger', 'l', '--out', 'o', '--open-held-out', '--force'], /Unexpected option --force/],
    ['run-held-out with two manifests', ['run-held-out', 'm.json', 'n.json', '--e4-manifest', 'a', '--e4-dir', 'b', '--ledger', 'l', '--out', 'o', '--open-held-out'], /exactly one E5 manifest/],
    ['analyse without --out-dir', ['analyse', 'm.json', 'h.json', '--e4-manifest', 'a', '--e4-dir', 'b'], /needs --out-dir/],
    ['replay without the E4 records', ['replay', 'm.json', 'h.json', '--e4-manifest', 'a'], /needs --e4-dir/],
    ['an option given twice', ['pins', '--e4-manifest', 'a', '--e4-manifest', 'b', '--e4-dir', 'c'], /given more than once/],
    ['an option with no value', ['pins', '--e4-manifest', '--e4-dir', 'c'], /needs a value/],
  ])('refuses %s with exit 2 and the usage text', (_name, args, pattern) => {
    const r = cli(...args);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(pattern);
    expect(r.err).toMatch(/Usage:/);
  });
  it('parseArgs gives the documented options', () => {
    expect(parseArgs(['run-held-out', 'm.json', '--e4-manifest', 'a', '--e4-dir', 'b', '--ledger', 'l', '--out', 'o', '--open-held-out'])).toMatchObject({ command: 'run-held-out', files: ['m.json'], openHeldOut: true, force: false });
    expect(parseArgs(['analyse', 'm.json', 'h.json', '--e4-manifest', 'a', '--e4-dir', 'b', '--out-dir', 'd', '--force']).force).toBe(true);
  });
});

describe('the real process on the built-in registry', () => {
  const e4ManifestPath = join(ROOT, 'experiments', 'manifests', 'p2-09-e4.json');
  const e4Dir = join(ROOT, 'experiments', 'results', 'p2-09', 'e4');
  it('pins ten pairs from the committed E4 records (read only)', () => {
    const r = cli('pins', '--e4-manifest', e4ManifestPath, '--e4-dir', e4Dir);
    expect(r.code).toBe(0);
    const pins = JSON.parse(r.out) as Json;
    expect(pins.pairs.map((p: Json) => p.seed)).toEqual([2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010]);
    expect(new Set(pins.pairs.flatMap((p: Json) => [p.a4, p.a5])).size).toBe(20);
    expect(pins.e4ManifestHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
  it('refuses a manifest that lists a spent circuit, in validate and in run-held-out, and never touches the ledger', () => {
    const pins = JSON.parse(cli('pins', '--e4-manifest', e4ManifestPath, '--e4-dir', e4Dir).out) as Json;
    const e4Manifest = JSON.parse(readFileSync(e4ManifestPath, 'utf8')) as Json;
    const shaped = {
      format: e5Study.E5_MANIFEST_FORMAT, version: 1, id: 'shape-check', label: 'confirmatory', description: 'Shape check only: never frozen, never run.',
      e4: { manifestHash: pins.e4ManifestHash }, pairs: pins.pairs, configuration: clone(e4Manifest.configuration),
      tracks: { heldOut: [{ id: 'hairpin-chicane', contentHash: trackContentHash(loadTrack(hairpinChicane)) }], splitManifestHash: manifestRecord(BUILT_IN_TRACK_SPLITS, 2).hash }, // epoch 2: the circuit is still held-out there, so the SPENT refusal is what fires
      analysis: { descriptiveMetric: METRIC, starts: [...e5Study.E5_STARTS], endpoints: { ...e5Study.E5_ENDPOINTS }, bootstrap: { ...e5Study.E5_BOOTSTRAP }, decisionRule: e5Study.E5_DECISION_RULE, brakeUsageThreshold: BRAKE_USAGE_THRESHOLD },
      authorisation: 'issue-34#shape-check', code: { revision: 'a'.repeat(40) },
    };
    const manifest = put('shaped.json', shaped);
    const validate = cli('validate', manifest);
    expect(validate.code).toBe(2);
    expect(validate.err).toMatch(/already exposed.*spent/);
    // on today's registry (epoch 4) the spent circuit is a validation circuit, so a manifest naming the latest epoch is refused as not held-out
    const latest = put('shaped-latest.json', { ...shaped, tracks: { ...shaped.tracks, splitManifestHash: manifestRecord().hash } });
    expect(cli('validate', latest).err).toMatch(/not a registered held-out circuit/);
    const ledger = join(DIR, 'never.ledger.json');
    const run = cli('run-held-out', manifest, '--e4-manifest', e4ManifestPath, '--e4-dir', e4Dir, '--ledger', ledger, '--out', join(DIR, 'never.held-out.json'), '--open-held-out');
    expect(run.code).toBe(2);
    expect(run.err).toMatch(/spent/);
    expect(existsSync(ledger)).toBe(false);
    expect(existsSync(join(DIR, 'never.held-out.json'))).toBe(false);
  });
});

// ---- The injected round trip on a synthetic registry ----
const scale = (p: { x: number; y: number }, k: number) => ({ x: p.x * k, y: p.y * k });
const oval = stadiumOval as unknown as { outer: { x: number; y: number }[]; inner: { x: number; y: number }[]; start: { position: { x: number; y: number }; heading: number }; gates: { a: { x: number; y: number }; b: { x: number; y: number } }[] };
const scaledOval = {
  ...stadiumOval, id: 'synthetic-held-out', name: 'Synthetic held-out',
  outer: oval.outer.map((p) => scale(p, 1.3)), inner: oval.inner.map((p) => scale(p, 1.3)),
  start: { position: scale(oval.start.position, 1.3), heading: oval.start.heading }, gates: oval.gates.map((g) => ({ a: scale(g.a, 1.3), b: scale(g.b, 1.3) })),
};
const SPLITS = loadTrackSplits(
  {
    ...manifestData,
    tracks: [
      { id: 'stadium-oval', version: '1', split: 'training', file: 'stadium-oval.json', contentHash: trackContentHash(loadTrack(stadiumOval)), description: 'training' },
      { id: 'rounded-rectangle', version: '1', split: 'validation', file: 'rounded-rectangle.json', contentHash: trackContentHash(loadTrack(roundedRectangle)), description: 'validation' },
      { id: 'synthetic-held-out', version: '1', split: 'held-out', file: 'synthetic.json', contentHash: trackContentHash(loadTrack(scaledOval)), description: 'held-out', provenance: { introducedBy: 'P5-02 step 2b (test fixture)', designCriteria: 'docs/plans/p5-02-fresh-circuits-plan.md section 3.2', designedBeforeAnyEvaluation: true } },
    ],
  },
  { 'stadium-oval.json': stadiumOval, 'rounded-rectangle.json': roundedRectangle, 'synthetic.json': scaledOval },
);
const ENGINE = { name: 'node', version: process.version, v8: process.versions.v8 };
const CONTEXT: StudyContext = { engine: ENGINE, source: { revision: null, dirty: null, unavailableReason: 'test fixture', appVersion: '0.0.0' }, recordedAt: '2026-11-14T00:00:00Z' };
const { setup } = resolveBaselineConfig({ training: { populationSize: 3, eliteCount: 1, maxEpisodeSeconds: 3, stallSeconds: 1 }, generations: 2, trackId: 'stadium-oval' }, 0);
const E4_MANIFEST = {
  format: e4Study.E4_MANIFEST_FORMAT, version: 1, id: 'mechanics-e4-cli', label: 'mechanics', description: 'Tiny E4 mechanics fixture for the E5 command-line tests.',
  agents: ['A4', 'A5'], brake: { A4: false, A5: true }, seeds: [7801, 7802],
  configuration: { generations: 2, training: Object.fromEntries(Object.entries(setup.config).filter(([key]) => key !== 'seed' && key !== 'brakeEnabled')) },
  streams: currentStreams(), tracks: trackReferences('stadium-oval', 'rounded-rectangle'), metric: METRIC,
  analysis: { delta: e4Study.E4_DELTA, bootstrap: { ...e4Study.E4_BOOTSTRAP }, wilcoxon: WILCOXON, decisionRule: e4Study.E4_DECISION_RULE, brakeUsageThreshold: BRAKE_USAGE_THRESHOLD },
  code: { revision: null },
} as unknown as e4Study.E4Manifest;
const E4_RECORDS = [e4Study.runE4Seed(E4_MANIFEST, 7801, CONTEXT), e4Study.runE4Seed(E4_MANIFEST, 7802, CONTEXT)];
const PINS = e5Study.e5PairPins(E4_MANIFEST, E4_RECORDS, ENGINE);
const E5_MANIFEST: Json = {
  format: e5Study.E5_MANIFEST_FORMAT, version: 1, id: 'mechanics-e5-cli', label: 'mechanics', description: 'Tiny mechanics fixture for the E5 command-line tests.',
  e4: { manifestHash: PINS.e4ManifestHash }, pairs: PINS.pairs, configuration: clone(E4_MANIFEST.configuration),
  tracks: { heldOut: [{ id: 'synthetic-held-out', contentHash: trackContentHash(loadTrack(scaledOval)) }], splitManifestHash: manifestRecord(SPLITS).hash },
  analysis: { descriptiveMetric: METRIC, starts: [...e5Study.E5_STARTS], endpoints: { ...e5Study.E5_ENDPOINTS }, bootstrap: { ...e5Study.E5_BOOTSTRAP }, decisionRule: e5Study.E5_DECISION_RULE, brakeUsageThreshold: BRAKE_USAGE_THRESHOLD },
  authorisation: 'issue-34#cli-mechanics', code: { revision: null },
};

const writeE4Dir = (name: string, records: readonly unknown[] = E4_RECORDS, seeds: readonly number[] = [7801, 7802]) => {
  const dir = join(DIR, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  records.forEach((record, i) => writeFileSync(join(dir, `seed-${seeds[i]}.json.gz`), gzipSync(JSON.stringify(record))));
  return dir;
};
const run = async (args: string[], deps: Partial<E5Deps> = {}) => {
  const lines: string[] = [];
  const warnings: string[] = [];
  const code = await execute(parseArgs(args), {
    study: { ...e5Study, parseE4Manifest: e4Study.parseE4Manifest } as unknown as E5Deps['study'],
    access: access as unknown as E5Deps['access'],
    registry: SPLITS,
    engine: () => ENGINE,
    source: () => CONTEXT.source,
    now: () => '2026-11-14T12:00:00.000Z',
    log: (line) => lines.push(line),
    warn: (line) => warnings.push(line),
    ...deps,
  });
  return { code, lines, warnings };
};
const e4ManifestPath = put('e4-manifest.json', E4_MANIFEST);
const e5ManifestPath = put('e5-manifest.json', E5_MANIFEST);
const E4_DIR = writeE4Dir('e4-records');

describe('the round trip with injected modules and a synthetic registry', () => {
  const ledger = join(DIR, 'ledger.json');
  const heldOut = join(DIR, 'held-out.json');
  const common = ['--e4-manifest', e4ManifestPath, '--e4-dir', E4_DIR];

  it('reads the E4 records in manifest order from gzip files', () => {
    const { records, paths } = readE4Records(E4_DIR, [7801, 7802]);
    expect(paths.map((p) => p.split('/').pop())).toEqual(['seed-7801.json.gz', 'seed-7802.json.gz']);
    expect((records[0] as Json).seed).toBe(7801);
    expect(() => readE4Records(E4_DIR, [7801, 9999])).toThrow(UsageError);
  });
  it('validate prints the manifest hash that is the held-out protocol hash', async () => {
    const r = await run(['validate', e5ManifestPath]);
    expect(r.code).toBe(0);
    expect(r.lines.join('\n')).toContain(e5Study.e5ManifestHash(E5_MANIFEST as never));
  });
  it('run-held-out opens the boundary once, writes the record and the ledger claim, and a second run is refused', async () => {
    const r = await run(['run-held-out', e5ManifestPath, ...common, '--ledger', ledger, '--out', heldOut, '--open-held-out']);
    expect(r.code).toBe(0);
    expect(r.lines.join('\n')).toMatch(/opened ONCE \(4 champion-circuit evaluations of five starts each/);
    const record = JSON.parse(readFileSync(heldOut, 'utf8')) as Json;
    expect(record.format).toBe(e5Study.E5_HELDOUT_FORMAT);
    expect(record.evaluations).toHaveLength(4);
    expect(record.evaluations[0].starts).toHaveLength(5);
    const claimed = JSON.parse(readFileSync(ledger, 'utf8')) as Json[];
    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.protocolHash).toBe(e5Study.e5ManifestHash(E5_MANIFEST as never));
    // A second look at the same protocol, even to a new output file, is refused and writes nothing.
    await expect(run(['run-held-out', e5ManifestPath, ...common, '--ledger', ledger, '--out', join(DIR, 'second.json'), '--open-held-out'])).rejects.toThrow(/already been opened/);
    expect(existsSync(join(DIR, 'second.json'))).toBe(false);
    expect(JSON.parse(readFileSync(ledger, 'utf8'))).toHaveLength(1);
    // The record is never overwritten.
    await expect(run(['run-held-out', e5ManifestPath, ...common, '--ledger', join(DIR, 'ledger-other.json'), '--out', heldOut, '--open-held-out'])).rejects.toThrow(/already exists \(a held-out record is never overwritten\)/);
    expect(existsSync(join(DIR, 'ledger-other.json'))).toBe(false);
  });
  it('replay is identical through a separate gate and leaves the study ledger alone', async () => {
    const before = readFileSync(ledger, 'utf8');
    const r = await run(['replay', e5ManifestPath, heldOut, ...common]);
    expect(r.code).toBe(0);
    expect(r.lines.join('\n')).toMatch(/Replay identical/);
    expect(readFileSync(ledger, 'utf8')).toBe(before);
  });
  it('replay reports a difference (exit 1) for a changed record', async () => {
    const bad = JSON.parse(readFileSync(heldOut, 'utf8')) as Json;
    const u = bad.evaluations[1].starts[0].brakeUsage;
    u.brakeTicks = u.brakeTicks === 0 ? 1 : 0;
    const rehashed = { ...bad, resultsHash: hashOf({ opening: bad.opening, evaluations: bad.evaluations }) };
    const r = await run(['replay', e5ManifestPath, put('changed.json', rehashed), ...common]);
    expect(r.code).toBe(1);
    expect(r.lines.join('\n')).toMatch(/Replay differs/);
  });
  it('analyse writes the analysis and the report, equal to the library output, and refuses to overwrite without --force', async () => {
    const outDir = join(DIR, 'analysis');
    mkdirSync(outDir);
    const r = await run(['analyse', e5ManifestPath, heldOut, ...common, '--out-dir', outDir]);
    expect(r.code).toBe(0);
    const expected = e5Study.analyseE5(E5_MANIFEST, E4_MANIFEST, E4_RECORDS, JSON.parse(readFileSync(heldOut, 'utf8')), ENGINE, SPLITS);
    expect(readFileSync(join(outDir, 'analysis.json'), 'utf8')).toBe(e5Study.e5AnalysisJson(expected));
    expect(readFileSync(join(outDir, 'report.md'), 'utf8')).toBe(e5Study.renderE5Report(expected));
    expect(r.lines.join('\n')).toMatch(/MECHANICS ONLY/);
    await expect(run(['analyse', e5ManifestPath, heldOut, ...common, '--out-dir', outDir])).rejects.toThrow(/already exists.*--force/);
    expect((await run(['analyse', e5ManifestPath, heldOut, ...common, '--out-dir', outDir, '--force'])).code).toBe(0);
    expect(readdirSync(outDir).filter((n) => n.includes('.tmp-'))).toEqual([]);
  });
  it('refuses before the ledger is touched: a missing E4 record, a corrupted E4 record, a manifest that lists no held-out circuit', async () => {
    const ledger2 = join(DIR, 'ledger-untouched.json');
    const out2 = join(DIR, 'untouched.json');
    const args = (dir: string) => ['run-held-out', e5ManifestPath, '--e4-manifest', e4ManifestPath, '--e4-dir', dir, '--ledger', ledger2, '--out', out2, '--open-held-out'];
    await expect(run(args(writeE4Dir('e4-missing', [E4_RECORDS[0]], [7801])))).rejects.toThrow(/Cannot read the E4 seed record for seed 7802/);
    const corrupted = clone(E4_RECORDS[1]) as Json;
    corrupted.agents.A5.model.parameters[0] += 1;
    await expect(run(args(writeE4Dir('e4-corrupt', [E4_RECORDS[0], corrupted])))).rejects.toThrow();
    const noHeld = clone(E5_MANIFEST);
    noHeld.tracks.heldOut = [];
    await expect(run(['run-held-out', put('no-held.json', noHeld), ...common, '--ledger', ledger2, '--out', out2, '--open-held-out'])).rejects.toThrow(/at least one held-out/);
    expect(existsSync(ledger2)).toBe(false);
    expect(existsSync(out2)).toBe(false);
  });
});
