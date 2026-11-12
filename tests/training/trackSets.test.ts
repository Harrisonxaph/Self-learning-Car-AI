// P4-04: the expanded built-in track sets. Split sizes, the design bounds of the NEW circuits (the existing three are exempt
// and unchanged), distinct identities, provenance, the deterministic generator, split enforcement for EVERY circuit, the
// source-scan allowlists, and the split-manifest epoch rules. No model is evaluated on any validation or held-out circuit
// here, and nothing is a result or evidence of learning.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateTrack } from '../../src/sim/trackValidation';
import { BUILT_IN_FILES } from '../helpers/builtInTrackFiles';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { loadTrack, type Track } from '../../src/sim/track';
import { createEvaluationSetup } from '../../src/training/evaluation';
import { manifestEpochOf, manifestRecord, parseExperimentRecord } from '../../src/training/experiment';
import { parseE4Manifest } from '../../src/training/e4Study';
import { parseE3Manifest } from '../../src/training/e3Study';
import { parseStudyManifest, StudyManifestError, trackReferences } from '../../src/training/study';
import { createTrainer, DEFAULT_TRAINING_CONFIG } from '../../src/training/trainer';
import {
  assertTrainingTrack,
  BUILT_IN_TRACK_SPLITS,
  epochIds,
  freezeModel,
  heldOutTrack,
  LATEST_SPLIT_EPOCH,
  loadTrackSplits,
  selectByValidation,
  SPLIT_EPOCHS,
  trackGeometryHash,
  tracksIn,
  TrackLeakageError,
  TrackSplitError,
  type FrozenModel,
} from '../../src/training/trackSplits';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ROOT = join(__dirname, '../..');
const NEW_IDS = ['kidney-loop', 's-sweepers', 'long-sweepers', 'technical-narrow'] as const;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const entries = BUILT_IN_TRACK_SPLITS.tracks;
const ids = (split: 'training' | 'validation' | 'held-out') => tracksIn(split).map((t) => t.id);
const env = (track: Track) => ({ track, physics: DEFAULT_VEHICLE_PHYSICS, timestepSeconds: DEFAULT_SIM_CONFIG.timestepSeconds });
const lap = (track: Track): number => track.inner.reduce((sum, a, i) => {
  const b = track.inner[(i + 1) % track.inner.length]!;
  const c = track.outer[i]!;
  const d = track.outer[(i + 1) % track.outer.length]!;
  return sum + (Math.hypot(b.x - a.x, b.y - a.y) + Math.hypot(d.x - c.x, d.y - c.y)) / 2;
}, 0);
const width = (track: Track): number => Math.hypot(track.gates[0]!.a.x - track.gates[0]!.b.x, track.gates[0]!.a.y - track.gates[0]!.b.y);
const FROZEN: FrozenModel = freezeModel([0.1, 0.2, 0.3], { agent: 'test' });

describe('the track sets', () => {
  it('have exactly 2 training, 2 validation and 3 held-out circuits', () => {
    expect(ids('training')).toEqual(['stadium-oval', 'kidney-loop']);
    expect(ids('validation')).toEqual(['rounded-rectangle', 's-sweepers']);
    expect(ids('held-out')).toEqual(['hairpin-chicane', 'long-sweepers', 'technical-narrow']);
  });
  it('every circuit validates with no errors and its manifest version and content hash match its own file', () => {
    for (const e of entries) {
      const result = validateTrack(JSON.parse(readFileSync(join(ROOT, 'src/data/tracks', `${e.id}.json`), 'utf8')));
      expect(result.ok, e.id).toBe(true);
      expect(e.version).toBe(e.track.version);
    }
  });
  it('IDs, content hashes and geometry hashes are all distinct (no circuit is a copy of another); shared version strings are fine', () => {
    for (const key of ['id', 'contentHash', 'geometryHash'] as const) expect(new Set(entries.map((e) => e[key])).size).toBe(entries.length);
    expect(new Set(entries.map((e) => e.version))).toEqual(new Set(['1']));
  });
  it('the NEW circuits meet the design bounds (8 to 14 m wide, 400 to 650 m lap); the existing ones are exempt and unchanged', () => {
    for (const id of NEW_IDS) {
      const track = entries.find((e) => e.id === id)!.track;
      expect(width(track), id).toBeGreaterThanOrEqual(8);
      expect(width(track), id).toBeLessThanOrEqual(14);
      expect(lap(track), id).toBeGreaterThanOrEqual(400);
      expect(lap(track), id).toBeLessThanOrEqual(650);
    }
    expect(Math.round(lap(entries.find((e) => e.id === 'rounded-rectangle')!.track))).toBeLessThan(400); // exempt, unchanged
    expect(entries.find((e) => e.id === 'stadium-oval')!.contentHash).toBe('sha256:f1c3e1a7f9ef938d7a1ffd4bcb79e4260fd870b4c637fdf43389ee7f4aefe8c2');
    expect(entries.find((e) => e.id === 'hairpin-chicane')!.contentHash).toBe('sha256:313f00c635d3667dfdfa5c37ba1f2731d1810a91b0801fb4234699d38a5f5770');
    expect(entries.find((e) => e.id === 'rounded-rectangle')!.contentHash).toBe('sha256:9d9908c388bc685829d92d5e1f846421c008cf9302303ec6d572578bb0cb9dc9');
  });
  it('the design criteria of each new circuit hold (corner geometry the plan fixed before anything was evaluated)', () => {
    const spec = (id: string): Json => JSON.parse(readFileSync(join(ROOT, 'src/data/tracks/specs', `${id}.spec.json`), 'utf8')) as Json;
    const arcs = (id: string): Json[] => spec(id).half.filter((s: Json) => s.type === 'arc');
    expect(spec('kidney-loop').half.some((s: Json) => s.type === 'straight')).toBe(false); // no straights
    expect(spec('s-sweepers').half.filter((s: Json) => s.type === 'arc' && s.radius >= 60).length).toBe(arcs('s-sweepers').length); // sweepers: radius at least 60 m
    expect(arcs('s-sweepers').some((s) => s.turn === 'right')).toBe(true); // an S with a right-hand bend
    expect(arcs('long-sweepers').every((s) => s.radius >= 60)).toBe(true);
    expect(arcs('technical-narrow').some((s) => s.degrees === 135)).toBe(true); // one 135-degree corner
    expect(arcs('technical-narrow').filter((s) => s.turn === 'right').length).toBeGreaterThanOrEqual(3); // right-hand heavy kinks
    expect(spec('technical-narrow').width).toBe(8);
  });
  it('every entry has non-empty provenance and the new circuits say they were designed before any evaluation', () => {
    for (const e of entries) {
      expect(e.provenance, e.id).not.toBeNull();
      expect(e.provenance!.introducedBy.length).toBeGreaterThan(0);
      expect(e.provenance!.designCriteria.length).toBeGreaterThan(10);
    }
    for (const id of NEW_IDS) {
      const p = entries.find((e) => e.id === id)!.provenance!;
      expect(p.introducedBy).toBe('P4-04');
      expect(p.designedBeforeAnyEvaluation).toBe(true);
    }
  });
  it.each<[string, (p: Json) => void, RegExp]>([
    ['an empty introducedBy', (p) => { p.introducedBy = ''; }, /provenance.introducedBy/],
    ['a missing designCriteria', (p) => { delete p.designCriteria; }, /provenance.designCriteria/],
    ['a non-boolean designedBeforeAnyEvaluation', (p) => { p.designedBeforeAnyEvaluation = 'yes'; }, /designedBeforeAnyEvaluation/],
    ['an unknown field', (p) => { p.extra = 1; }, /unknown field "extra"/],
  ])('a manifest with %s in its provenance is refused', (_name, change, message) => {
    const m = clone(JSON.parse(readFileSync(join(ROOT, 'src/data/tracks/index.json'), 'utf8')) as Json);
    change(m.tracks[0].provenance);
    expect(() => loadTrackSplits(m, BUILT_IN_FILES)).toThrow(message);
    const notObject = clone(m);
    notObject.tracks[0].provenance = 'P2-10';
    expect(() => loadTrackSplits(notObject, BUILT_IN_FILES)).toThrow(/provenance must be an object/);
  });
  it('a manifest without provenance still loads (provenance is optional) and reports none', () => {
    const m = clone(JSON.parse(readFileSync(join(ROOT, 'src/data/tracks/index.json'), 'utf8')) as Json);
    for (const t of m.tracks) delete t.provenance;
    expect(loadTrackSplits(m, BUILT_IN_FILES).tracks.every((t) => t.provenance === null)).toBe(true);
  });
});

describe('the generator', () => {
  it('regenerates every committed circuit byte for byte (--check exits 0), and each spec has its file', () => {
    const run = spawnSync(process.execPath, ['scripts/makeTracks.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    const specs = readdirSync(join(ROOT, 'src/data/tracks/specs')).filter((f) => f.endsWith('.spec.json')).map((f) => f.replace('.spec.json', '')).sort();
    expect(specs).toEqual([...NEW_IDS].sort());
  });
  describe('--check on a scratch copy', () => {
    const scratch = (change: (dir: string) => void) => {
      const dir = mkdtempSync(join(tmpdir(), 'tracks-'));
      try {
        cpSync(join(ROOT, 'src/data/tracks'), dir, { recursive: true });
        change(dir);
        return spawnSync(process.execPath, ['scripts/makeTracks.mjs', '--check'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, MAKE_TRACKS_DIR: dir } });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };
    it('passes on an unchanged copy', () => {
      expect(scratch(() => undefined).status).toBe(0);
    });
    it('fails when a committed file is edited by one coordinate', () => {
      const run = scratch((dir) => writeFileSync(join(dir, 'kidney-loop.json'), readFileSync(join(dir, 'kidney-loop.json'), 'utf8').replace('"x": 0,', '"x": 0.001,')));
      expect(run.status).toBe(1);
      expect(run.stderr).toContain('kidney-loop: the committed file differs');
    });
    it('fails when a spec changes but its file does not, and when a committed file is missing', () => {
      const edited = scratch((dir) => {
        const path = join(dir, 'specs/s-sweepers.spec.json');
        writeFileSync(path, readFileSync(path, 'utf8').replace('"length": 10', '"length": 12'));
      });
      expect(edited.status).toBe(1);
      expect(edited.stderr).toContain('s-sweepers');
      expect(scratch((dir) => rmSync(join(dir, 'technical-narrow.json'))).status).toBe(1);
    });
  });
});

describe('split enforcement holds for EVERY circuit', () => {
  const renamed = (track: Track, id: string): Track => loadTrack({ ...clone(track), id });
  it.each(entries.filter((e) => e.split !== 'training').map((e) => [e.id, e.split] as const))('the trainer refuses the %s (%s) circuit, by ID and as a renamed copy', (id) => {
    const track = entries.find((e) => e.id === id)!.track;
    expect(() => assertTrainingTrack(track)).toThrow(TrackLeakageError);
    expect(() => createTrainer({ ...DEFAULT_TRAINING_CONFIG, populationSize: 2, eliteCount: 0, selection: { type: 'tournament', size: 2 } }, env(track))).toThrow(TrackLeakageError);
    expect(() => assertTrainingTrack(renamed(track, `copy-of-${id}`))).toThrow(TrackLeakageError);
  });
  it.each(entries.filter((e) => e.split === 'training').map((e) => e.id))('the trainer accepts the %s training circuit', (id) => {
    expect(assertTrainingTrack(entries.find((e) => e.id === id)!.track)).toBe('training');
  });
  it.each(entries.filter((e) => e.split === 'held-out').map((e) => e.id))('evaluation refuses the held-out %s circuit, its renamed copy and a copy under another registered ID', (id) => {
    const track = entries.find((e) => e.id === id)!.track;
    expect(() => createEvaluationSetup({}, env(track))).toThrow(TrackLeakageError);
    expect(() => createEvaluationSetup({}, env(renamed(track, `copy-of-${id}`)))).toThrow(TrackLeakageError);
    expect(() => createEvaluationSetup({}, env(renamed(track, 'stadium-oval')))).toThrow(TrackLeakageError);
  });
  it.each(entries.filter((e) => e.split === 'held-out').map((e) => e.id))('heldOutTrack gives the %s circuit to a frozen model only, and no wrong-split ID', (id) => {
    expect(heldOutTrack(id, FROZEN).id).toBe(id);
    expect(() => heldOutTrack(id, { parameters: [0.1], id: FROZEN.id, provenance: {} } as never)).toThrow(TrackLeakageError);
    expect(() => heldOutTrack(id, undefined as never)).toThrow(TrackLeakageError);
    for (const other of entries.filter((e) => e.split !== 'held-out')) expect(() => heldOutTrack(other.id, FROZEN)).toThrow(TrackLeakageError);
  });
  it('selectByValidation accepts validation scores only, for every circuit', () => {
    for (const e of entries) {
      const run = () => selectByValidation([{ modelId: 'm', trackId: e.id, score: 1 }]);
      if (e.split === 'validation') expect(run()).toBe('m');
      else expect(run).toThrow(TrackLeakageError);
    }
  });
  it('a held-out circuit cannot be reached through the training registry or the training listing', () => {
    expect(tracksIn('training').every((t) => t.split === 'training')).toBe(true);
    for (const id of ids('held-out')) expect(ids('training')).not.toContain(id);
  });
});

describe('source scan: which modules may reach restricted accessors (test enforced)', () => {
  const files = (dir: string): string[] => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(join(dir, d.name)) : d.name.endsWith('.ts') ? [join(dir, d.name)] : []));
  const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const sources = files('src').map((path) => ({ path: path.replace(/\\/g, '/'), text: code(readFileSync(join(ROOT, path), 'utf8')) }));
  const users = (pattern: RegExp) => sources.filter((s) => pattern.test(s.text)).map((s) => s.path).sort();
  it('heldOutTrack is referenced only by trackSplits.ts and heldOutAccess.ts', () => {
    expect(users(/\bheldOutTrack\b/)).toEqual(['src/training/heldOutAccess.ts', 'src/training/trackSplits.ts']);
  });
  it('validationTrack is referenced only by the named evaluation modules', () => {
    expect(users(/\bvalidationTrack\b/)).toEqual([
      'src/training/agents.ts',
      'src/training/analysis.ts',
      'src/training/e3Study.ts',
      'src/training/e4Agents.ts',
      'src/training/e4Analysis.ts',
      'src/training/e4Study.ts',
      'src/training/feasibility.ts',
      'src/training/study.ts',
      'src/training/trackSplits.ts',
      'src/ui/modelEvaluation.ts', // P4-05: evaluates a saved model on training and validation circuits only, by ID
    ]);
  });
  it('no module outside trackSplits.ts asks the registry for the held-out listing, and only the page wiring asks for the validation one', () => {
    expect(users(/tracksIn\(\s*['"]held-out['"]/).filter((p) => p !== 'src/training/trackSplits.ts')).toEqual([]);
    // P4-05: src/main.ts builds the evaluate page's validation group; nothing else may.
    expect(users(/tracksIn\(\s*['"]validation['"]/).filter((p) => p !== 'src/training/trackSplits.ts')).toEqual(['src/main.ts']);
  });
  it('the UI and the trainer never name a validation or held-out circuit', () => {
    for (const s of sources.filter((x) => x.path.startsWith('src/ui/') || x.path === 'src/training/trainer.ts' || x.path === 'src/main.ts')) {
      for (const id of [...ids('validation'), ...ids('held-out')]) expect(s.text.includes(`'${id}'`) || s.text.includes(`"${id}"`), `${s.path} names ${id}`).toBe(false);
    }
  });
});

describe('split-manifest epochs', () => {
  it('are an append-only registry: epoch 1 is the three P2-10 circuits, each later epoch extends the one before it', () => {
    expect(SPLIT_EPOCHS.map((e) => e.epoch)).toEqual([1, 2]);
    expect([...epochIds(1)]).toEqual(['stadium-oval', 'rounded-rectangle', 'hairpin-chicane']);
    expect(epochIds(LATEST_SPLIT_EPOCH).length).toBe(entries.length);
    for (let i = 1; i < SPLIT_EPOCHS.length; i += 1) expect([...SPLIT_EPOCHS[i]!.ids.slice(0, SPLIT_EPOCHS[i - 1]!.ids.length)]).toEqual([...SPLIT_EPOCHS[i - 1]!.ids]);
    expect(() => epochIds(99)).toThrow(TrackSplitError);
  });
  it('epoch 1\'s manifest record is exactly the one recorded before P4-04 (hash pinned from the pre-expansion code)', () => {
    expect(manifestRecord(BUILT_IN_TRACK_SPLITS, 1).hash).toBe('sha256:3cb594e2cdf4ed07728a8a50a54d558fc20f3d8e01628acd376eb9ff940772c3');
    expect(manifestRecord().hash).not.toBe(manifestRecord(BUILT_IN_TRACK_SPLITS, 1).hash);
    expect(manifestEpochOf(manifestRecord(BUILT_IN_TRACK_SPLITS, 1).hash)).toBe(1);
    expect(manifestEpochOf(manifestRecord().hash)).toBe(2);
    expect(manifestEpochOf(`sha256:${'0'.repeat(64)}`)).toBeNull();
    expect(() => manifestRecord({ tracks: [] } as never, 1)).toThrow(TrackSplitError);
  });
  it('new manifests and records use the latest epoch', () => {
    expect(trackReferences('kidney-loop', 's-sweepers').splitManifestHash).toBe(manifestRecord().hash);
    expect(() => trackReferences('kidney-loop', 's-sweepers', 1)).toThrow(TrackLeakageError);
  });
  const fixture = (name: string): Json => JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/pre-p4-04', name), 'utf8')) as Json;
  it('an epoch-1 manifest may not name a circuit that predates it, and may not name a held-out or validation training track', () => {
    const study = fixture('study-manifest.json');
    expect(parseStudyManifest(study).id).toBe('pre-p4-04-study');
    const later = clone(study);
    later.tracks.training = { id: 'kidney-loop', contentHash: entries.find((e) => e.id === 'kidney-loop')!.contentHash };
    expect(() => parseStudyManifest(later)).toThrow();
    const leak = clone(study);
    leak.tracks.training = { id: 'hairpin-chicane', contentHash: entries.find((e) => e.id === 'hairpin-chicane')!.contentHash };
    expect(() => parseStudyManifest(leak)).toThrow(TrackLeakageError);
    const e4 = fixture('e4-manifest.json');
    expect(parseE4Manifest(e4).id).toBe('pre-p4-04-e4');
    const e4later = clone(e4);
    e4later.tracks.validation = { id: 's-sweepers', contentHash: entries.find((e) => e.id === 's-sweepers')!.contentHash };
    expect(() => parseE4Manifest(e4later)).toThrow();
  });
  it('an E3 manifest on epoch 1 may not list a circuit of epoch 2, and one on epoch 2 may list the new held-out circuits', () => {
    const e3 = fixture('e3-manifest.json');
    expect(parseE3Manifest(e3).id).toBe('pre-p4-04-e3');
    const later = clone(e3);
    later.label = 'mechanics';
    later.tracks.heldOut = [{ id: 'long-sweepers', contentHash: entries.find((e) => e.id === 'long-sweepers')!.contentHash }];
    later.authorisation = 'x#1';
    expect(() => parseE3Manifest(later)).toThrow(); // mechanics on the built-in registry may list no held-out circuit
    const latest = clone(e3);
    latest.tracks.splitManifestHash = manifestRecord().hash;
    expect(parseE3Manifest(latest).tracks.splitManifestHash).toBe(manifestRecord().hash);
  });
  it.each<[string, unknown]>([
    ['null', null],
    ['a number', 7],
    ['a string', 'long-sweepers'],
    ['an array', []],
    ['an object', {}],
    ['an id that is not a string', { id: 1, contentHash: 'x' }],
    ['a missing hash', { id: 'hairpin-chicane' }],
    ['an unknown field', { id: 'hairpin-chicane', contentHash: 'x', extra: 1 }],
  ])('a malformed held-out reference (%s) is a manifest error, not a raw TypeError, on every epoch', (_name, entry) => {
    for (const hash of [manifestRecord(BUILT_IN_TRACK_SPLITS, 1).hash, manifestRecord().hash]) {
      const m = clone(fixture('e3-manifest.json'));
      m.tracks.splitManifestHash = hash;
      m.tracks.heldOut = [entry];
      m.authorisation = 'issue-33#test';
      m.label = 'confirmatory';
      expect(() => parseE3Manifest(m)).toThrow(StudyManifestError);
      m.label = 'mechanics';
      expect(() => parseE3Manifest(m)).toThrow(StudyManifestError);
    }
    for (const bad of [null, 7, 'x', {}, undefined]) {
      const m = clone(fixture('e3-manifest.json'));
      m.tracks.heldOut = bad;
      expect(() => parseE3Manifest(m)).toThrow(StudyManifestError);
    }
  });
  it('a tampered epoch-1 experiment record, a record with another manifest and a leaked training track are refused', () => {
    const record = fixture('experiment-record.json');
    const parse = (r: Json) => parseExperimentRecord(r, r.engine);
    expect(parse(record).tracks.training.id).toBe('stadium-oval');
    const entry = clone(record);
    entry.tracks.manifest.entries[0].contentHash = `sha256:${'1'.repeat(64)}`;
    expect(() => parse(entry)).toThrow();
    const dropped = clone(record);
    dropped.tracks.manifest.entries.pop();
    expect(() => parse(dropped)).toThrow();
    const unknown = clone(record);
    unknown.tracks.manifest.entries.push(clone(manifestRecord().entries[3]));
    expect(() => parse(unknown)).toThrow();
    const leak = clone(record);
    leak.tracks.training = { id: 'hairpin-chicane', version: '1', split: 'held-out', contentHash: entries.find((e) => e.id === 'hairpin-chicane')!.contentHash };
    expect(() => parse(leak)).toThrow();
    const later = clone(record);
    later.tracks.training = { id: 'kidney-loop', version: '1', split: 'training', contentHash: entries.find((e) => e.id === 'kidney-loop')!.contentHash };
    expect(() => parse(later)).toThrow(/not part of the track set/);
  });
  it('geometry hashes are stable (a circuit keeps its identity under any ID)', () => {
    for (const e of entries) expect(trackGeometryHash(e.track)).toBe(e.geometryHash);
  });
});
