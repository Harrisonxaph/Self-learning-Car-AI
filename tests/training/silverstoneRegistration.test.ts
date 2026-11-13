// P4-06 step 2b: Silverstone is registered as a TRAINING circuit in the split manifest, with its own epoch (3), its proposed episode limits and its
// provenance. The claims: the registration is exact; `limits` are strictly validated and are part of no hash (so no record is invalidated); every earlier
// epoch is untouched, an epoch-2 record cannot name Silverstone and an epoch-3 one can; every split boundary treats it as a training circuit and nothing else;
// the pages do not offer it yet (step 3). The genuine epoch-2 fixtures replay in tests/training/preP406Compat.test.ts. Nothing here trains a model for any
// length of time, evaluates a model on it, or is a result or evidence of learning.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILT_IN_FILES } from '../helpers/builtInTrackFiles';
import manifestData from '../../src/data/tracks/index.json';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { manifestEpochOf, manifestRecord, parseExperimentRecord } from '../../src/training/experiment';
import { parseStudyManifest } from '../../src/training/study';
import { createTrainer, DEFAULT_TRAINING_CONFIG } from '../../src/training/trainer';
import {
  assertEvaluationTrack,
  assertTrainingTrack,
  BUILT_IN_TRACK_SPLITS,
  epochIds,
  findRegistered,
  LATEST_SPLIT_EPOCH,
  loadTrackSplits,
  SPLIT_EPOCHS,
  trackGeometryHash,
  trainingTrack,
  TrackLeakageError,
  TrackSplitError,
  validationTrack,
} from '../../src/training/trackSplits';
import { circuitFromSearch, NOT_YET_OFFERED, offered } from '../../src/ui/trainingCircuit';
import { tracksIn } from '../../src/training/trackSplits';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ROOT = join(__dirname, '../..');
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const entry = BUILT_IN_TRACK_SPLITS.tracks.find((t) => t.id === 'silverstone')!;
const fixture = (name: string): Json => JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/pre-p4-06', name), 'utf8')) as Json;
const manifestWith = (change: (silverstone: Json) => void): unknown => {
  const m = clone(manifestData) as Json;
  change(m.tracks.find((t: Json) => t.id === 'silverstone'));
  return m;
};

describe('the registration', () => {
  it('is a training circuit with the source commit and file hash as its version, a content hash that matches its file, and its provenance', () => {
    expect(entry.split).toBe('training');
    expect(entry.version).toBe('e59595d-27c51454e817');
    expect(entry.contentHash).toBe('sha256:47a93c709c41d0d1fdd1b6de25f151db7bb07cc4cd7b668832e622d1f00ab90e');
    expect(entry.geometryHash).toBe(trackGeometryHash(entry.track));
    expect(entry.track.gates).toHaveLength(118);
    expect(entry.provenance?.introducedBy).toBe('P4-06');
    expect(entry.provenance?.designCriteria).toContain('27c51454e81780a75c353d3e6c9f73dbbcd1e82139782e95bd722ade19736e39');
    expect(entry.provenance?.designedBeforeAnyEvaluation).toBe(true);
  });
  it('proposes the plan\'s limits for new runs (420 s, a 10 s stall rule, one lap); every other circuit keeps the defaults (no limits)', () => {
    expect(entry.limits).toEqual({ maxEpisodeSeconds: 420, stallSeconds: 10, maxLaps: 1 });
    for (const t of BUILT_IN_TRACK_SPLITS.tracks) if (t.id !== 'silverstone') expect(t.limits, t.id).toBeNull();
  });
  it('is the last manifest entry, so every earlier entry keeps its position', () => {
    expect(BUILT_IN_TRACK_SPLITS.tracks.map((t) => t.id)).toEqual(['stadium-oval', 'rounded-rectangle', 'hairpin-chicane', 'kidney-loop', 's-sweepers', 'long-sweepers', 'technical-narrow', 'silverstone']);
  });
  it('is exactly the track file the importer wrote (the file named by the entry)', () => {
    expect((manifestData as Json).tracks.find((t: Json) => t.id === 'silverstone').file).toBe('silverstone.json');
    expect(JSON.parse(readFileSync(join(ROOT, 'src/data/tracks/silverstone.json'), 'utf8')).version).toBe(entry.version);
  });
});

describe('the limits are strictly validated and are part of no hash', () => {
  it.each<[string, (s: Json) => void, RegExp]>([
    ['not an object', (s) => (s.limits = 5), /limits must be an object/],
    ['null', (s) => (s.limits = null), /limits must be an object/],
    ['an array', (s) => (s.limits = []), /limits must be an object/],
    ['an unknown field', (s) => (s.limits.extra = 1), /unknown field "extra"/],
    ['a missing episode length', (s) => delete s.limits.maxEpisodeSeconds, /maxEpisodeSeconds must be a finite number/],
    ['a zero episode length', (s) => (s.limits.maxEpisodeSeconds = 0), /maxEpisodeSeconds must be a finite number/],
    ['a negative stall limit', (s) => (s.limits.stallSeconds = -1), /stallSeconds must be a finite number/],
    ['a string stall limit', (s) => (s.limits.stallSeconds = '10'), /stallSeconds must be a finite number/],
    ['an episode length too large to be a real limit', (s) => (s.limits.maxEpisodeSeconds = 1e9), /at most 36000/],
    ['zero laps', (s) => (s.limits.maxLaps = 0), /maxLaps must be a whole number from 1 to 100/],
    ['a fractional lap count', (s) => (s.limits.maxLaps = 1.5), /maxLaps must be a whole number/],
    ['more laps than the cap', (s) => (s.limits.maxLaps = 101), /maxLaps must be a whole number/],
    ['a stall limit longer than the episode', (s) => (s.limits.stallSeconds = 500), /stallSeconds \(500\) must not exceed/],
  ])('refuses %s with a message naming the circuit and the field', (_name, change, message) => {
    expect(() => loadTrackSplits(manifestWith(change), BUILT_IN_FILES)).toThrow(TrackSplitError);
    expect(() => loadTrackSplits(manifestWith(change), BUILT_IN_FILES)).toThrow(message);
    expect(() => loadTrackSplits(manifestWith(change), BUILT_IN_FILES)).toThrow(/"silverstone"/);
  });
  it('JSON that cannot carry a number (Infinity becomes null) is refused, and an absent `limits` is allowed (the default rules)', () => {
    expect(() => loadTrackSplits(manifestWith((s) => (s.limits.maxEpisodeSeconds = JSON.parse(JSON.stringify(Infinity)))), BUILT_IN_FILES)).toThrow(TrackSplitError);
    const without = loadTrackSplits(manifestWith((s) => delete s.limits), BUILT_IN_FILES);
    expect(without.tracks.find((t) => t.id === 'silverstone')!.limits).toBeNull();
  });
  it('changing the limits or the provenance changes no content hash, no geometry hash and no epoch record, so no recorded manifest is invalidated', () => {
    const changed = loadTrackSplits(manifestWith((s) => ((s.limits = { maxEpisodeSeconds: 900, stallSeconds: 30, maxLaps: 2 }), (s.provenance.designCriteria = 'changed'))), BUILT_IN_FILES);
    const changedSilverstone = changed.tracks.find((t) => t.id === 'silverstone')!;
    expect(changedSilverstone.limits).toEqual({ maxEpisodeSeconds: 900, stallSeconds: 30, maxLaps: 2 });
    expect(changedSilverstone.contentHash).toBe(entry.contentHash);
    expect(changedSilverstone.geometryHash).toBe(entry.geometryHash);
    const record = (splits: typeof changed) => manifestRecord(splits);
    expect(record(changed)).toEqual(record(loadTrackSplits(manifestData, BUILT_IN_FILES)));
    // The built-in epochs recompute from the committed data and never mention limits.
    for (const { epoch } of SPLIT_EPOCHS) expect(JSON.stringify(manifestRecord(BUILT_IN_TRACK_SPLITS, epoch))).not.toContain('maxEpisodeSeconds');
  });
});

describe('the epochs', () => {
  it('append epoch 3 (the seven circuits of epoch 2 plus Silverstone) and redefine nothing', () => {
    expect(SPLIT_EPOCHS.map((e) => [e.epoch, e.introducedBy])).toEqual([[1, 'P2-10'], [2, 'P4-04'], [3, 'P4-06']]);
    expect(LATEST_SPLIT_EPOCH).toBe(3);
    expect([...epochIds(3)]).toEqual([...epochIds(2), 'silverstone']);
    expect([...epochIds(2)]).toEqual(['stadium-oval', 'rounded-rectangle', 'hairpin-chicane', 'kidney-loop', 's-sweepers', 'long-sweepers', 'technical-narrow']);
    expect(manifestRecord(BUILT_IN_TRACK_SPLITS, 1).hash).toBe('sha256:3cb594e2cdf4ed07728a8a50a54d558fc20f3d8e01628acd376eb9ff940772c3');
    expect(manifestRecord(BUILT_IN_TRACK_SPLITS, 2).hash).toBe('sha256:4a56521e1e89b6cf58409181a7c6d3bcb1675dff8076a9df87aa675b9e2df91e');
    expect(new Set([1, 2, 3].map((e) => manifestRecord(BUILT_IN_TRACK_SPLITS, e).hash)).size).toBe(3);
  });
  it('the record of an epoch-2 experiment (made by the unchanged code) is still recognised as epoch 2, and a new record is epoch 3', () => {
    const old = fixture('experiment-record.json');
    expect(manifestEpochOf(old.tracks.manifest)).toBe(2);
    expect(manifestEpochOf(manifestRecord())).toBe(3);
    expect(manifestEpochOf(manifestRecord().hash)).toBe(3);
  });
  it('an epoch-2 record cannot name Silverstone: an eighth circuit is never absorbed into an earlier epoch', () => {
    const study = fixture('study-manifest.json');
    expect(parseStudyManifest(study).id).toBe('pre-p4-06-study');
    const named = clone(study);
    named.tracks.training = { id: 'silverstone', contentHash: entry.contentHash };
    expect(() => parseStudyManifest(named)).toThrow();
    const record = fixture('experiment-record.json');
    const later = clone(record);
    later.tracks.training = { id: 'silverstone', version: entry.version, split: 'training', contentHash: entry.contentHash };
    expect(() => parseExperimentRecord(later, later.engine)).toThrow(/not part of the track set/);
    const padded = clone(record);
    padded.tracks.manifest.entries.push({ id: 'silverstone', version: entry.version, split: 'training', contentHash: entry.contentHash });
    expect(() => parseExperimentRecord(padded, padded.engine)).toThrow();
  });
  it('an epoch-3 manifest can name Silverstone as its training track, and a wrong hash for it is refused', () => {
    const study = clone(fixture('study-manifest.json'));
    study.tracks.splitManifestHash = manifestRecord().hash;
    study.tracks.training = { id: 'silverstone', contentHash: entry.contentHash };
    expect(parseStudyManifest(study).tracks.training.id).toBe('silverstone');
    const wrong = clone(study);
    wrong.tracks.training.contentHash = `sha256:${'2'.repeat(64)}`;
    expect(() => parseStudyManifest(wrong)).toThrow();
  });
  it('a tampered epoch-3 experiment record (another hash for Silverstone, a dropped circuit) is refused', () => {
    const record = clone(fixture('experiment-record.json'));
    record.tracks.manifest = manifestRecord();
    record.tracks.training = { id: 'stadium-oval', version: '1', split: 'training', contentHash: BUILT_IN_TRACK_SPLITS.tracks[0]!.contentHash };
    const tampered = clone(record);
    tampered.tracks.manifest.entries.find((e: Json) => e.id === 'silverstone').contentHash = `sha256:${'3'.repeat(64)}`;
    expect(() => parseExperimentRecord(tampered, tampered.engine)).toThrow();
    const dropped = clone(record);
    dropped.tracks.manifest.entries.pop();
    expect(() => parseExperimentRecord(dropped, dropped.engine)).toThrow();
  });
});

describe('every boundary treats Silverstone as a training circuit and nothing else', () => {
  it('is a training track and neither a validation nor a held-out one', () => {
    expect(trainingTrack('silverstone').id).toBe('silverstone');
    expect(() => validationTrack('silverstone')).toThrow(TrackLeakageError);
    expect(tracksIn('training').map((t) => t.id)).toContain('silverstone');
    expect(tracksIn('validation').map((t) => t.id)).not.toContain('silverstone');
    expect(tracksIn('held-out').map((t) => t.id)).not.toContain('silverstone');
  });
  it('the trainer and the evaluation accept it as a training circuit, and a copy under another ID is still found as Silverstone', () => {
    const track = trainingTrack('silverstone');
    expect(assertTrainingTrack(track)).toBe('training');
    expect(assertEvaluationTrack(track)).toBe('training');
    const copy = { ...track, id: 'my-copy', version: 'x' };
    expect(findRegistered(copy).map((t) => t.id)).toEqual(['silverstone']);
    expect(assertTrainingTrack(copy)).toBe('training');
  });
  it('a tiny seeded run on it builds and steps (a mechanics check: no claim about learning)', () => {
    const trainer = createTrainer(
      { ...DEFAULT_TRAINING_CONFIG, seed: 1, populationSize: 4, eliteCount: 1, maxEpisodeSeconds: 2, stallSeconds: 1, maxLaps: 1 },
      { track: trainingTrack('silverstone'), physics: DEFAULT_VEHICLE_PHYSICS, timestepSeconds: DEFAULT_SIM_CONFIG.timestepSeconds },
    );
    const stats = trainer.runGeneration();
    expect(stats.generation).toBe(0);
    expect(Number.isFinite(stats.bestFitness)).toBe(true);
  });
});

describe('the pages do not offer it yet (step 3 selects it and reads its limits)', () => {
  it('is registered but not offered: the page lists, and the address, ignore it', () => {
    expect([...NOT_YET_OFFERED]).toEqual(['silverstone']);
    const lists = offered(tracksIn('training')).map((t) => t.id);
    expect(lists).toEqual(['stadium-oval', 'kidney-loop']);
    expect(circuitFromSearch('?mode=train&circuit=silverstone', lists)).toBe('stadium-oval');
    expect(circuitFromSearch('?mode=train&circuit=kidney-loop', lists)).toBe('kidney-loop');
    expect(offered(tracksIn('validation')).map((t) => t.id)).toEqual(['rounded-rectangle', 's-sweepers']);
  });
});
