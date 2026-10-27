// Built-in track splits (P2-10): the three circuits' geometry, the split manifest, deterministic loading and the
// training / validation-selection / frozen-model held-out boundaries. No network is trained or evaluated on the
// validation or held-out circuits here: the driving below is a scripted centre-line follower checking geometry only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import manifestData from '../../src/data/tracks/index.json';
import hairpinChicane from '../../src/data/tracks/hairpin-chicane.json';
import roundedRectangle from '../../src/data/tracks/rounded-rectangle.json';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { createProgress, forwardCrossing, stepRacer, type Racer } from '../../src/sim/checkpoints';
import { createCar, segmentsTouch } from '../../src/sim/collision';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { loadTrack, type Track, type Vec2 } from '../../src/sim/track';
import { maxSteerAngle, wrapAngle } from '../../src/sim/vehicle';
import {
  assertTrainingTrack,
  BUILT_IN_TRACK_SPLITS,
  findRegistered,
  freezeModel,
  heldOutTrack,
  isFrozenModel,
  loadTrackSplits,
  selectByValidation,
  trackContentHash,
  trackGeometryHash,
  TrackLeakageError,
  TrackSplitError,
  tracksIn,
  trainingTrack,
  validationTrack,
  type FrozenModel,
} from '../../src/training/trackSplits';
import { createTrainer, DEFAULT_TRAINING_CONFIG } from '../../src/training/trainer';

const PHYSICS = DEFAULT_VEHICLE_PHYSICS;
const FILES = { 'stadium-oval.json': stadiumOval, 'rounded-rectangle.json': roundedRectangle, 'hairpin-chicane.json': hairpinChicane };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const env = (track: Track) => ({ track, physics: PHYSICS, timestepSeconds: DEFAULT_SIM_CONFIG.timestepSeconds });

// ---- Geometry helpers (test-only; P4-01 owns a general track validator) ----

/** Edges of a closed polygon. */
const edges = (points: readonly Vec2[]) => points.map((p, i) => [p, points[(i + 1) % points.length]!] as const);

/** Ray-casting point-in-polygon (the point is not on an edge in these tests). */
function inside(p: Vec2, polygon: readonly Vec2[]): boolean {
  let result = false;
  for (const [a, b] of edges(polygon)) {
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}

function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y);
}

/** True if no two non-adjacent edges of the closed polygon touch. */
function isSimple(points: readonly Vec2[]): boolean {
  const list = edges(points);
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 2; j < list.length; j += 1) {
      if (i === 0 && j === list.length - 1) continue; // adjacent through the closing edge
      if (segmentsTouch(list[i]![0], list[i]![1], list[j]![0], list[j]![1])) return false;
    }
  }
  return true;
}

/** The centre line: midpoints of matching inner and outer vertices (both boundaries have one vertex per sample). */
const centreLine = (track: Track) => track.inner.map((a, i) => ({ x: (a.x + track.outer[i]!.x) / 2, y: (a.y + track.outer[i]!.y) / 2 }));

/** The smallest road width: shortest distance from any vertex of one boundary to the other boundary. */
function minWidth(track: Track): number {
  let best = Infinity;
  for (const [from, to] of [[track.inner, track.outer], [track.outer, track.inner]] as const) {
    for (const p of from) for (const [a, b] of edges(to)) best = Math.min(best, distanceToSegment(p, a, b));
  }
  return best;
}

/** Corner signature from the centre line: the tightest turn radius, and whether any turn goes right (clockwise). */
function corners(track: Track) {
  const centre = centreLine(track);
  let minRadius = Infinity;
  let rightTurns = 0;
  const n = centre.length;
  for (let i = 0; i < n; i += 1) {
    const a = centre[(i - 1 + n) % n]!;
    const b = centre[i]!;
    const c = centre[(i + 1) % n]!;
    const turn = wrapAngle(Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x));
    if (Math.abs(turn) < 0.01) continue;
    const length = (Math.hypot(b.x - a.x, b.y - a.y) + Math.hypot(c.x - b.x, c.y - b.y)) / 2;
    minRadius = Math.min(minRadius, length / Math.abs(turn));
    if (turn > 0) rightTurns += 1; // heading increasing turns towards +y: clockwise on screen
  }
  return { minRadius, rightTurns };
}

/** Pure pursuit along the centre line, `ahead` metres beyond the closest point. Test driver only. */
function lookAhead(track: Track, p: Vec2, ahead: number): Vec2 {
  const centre = centreLine(track);
  let best = 0;
  let bestDistance = Infinity;
  let bestT = 0;
  for (let i = 0; i < centre.length; i += 1) {
    const a = centre[i]!;
    const b = centre[(i + 1) % centre.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    const d = Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y);
    if (d < bestDistance) [best, bestDistance, bestT] = [i, d, t];
  }
  let i = best;
  let t = bestT;
  let remaining = ahead;
  for (;;) {
    const a = centre[i]!;
    const b = centre[(i + 1) % centre.length]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length * (1 - t) >= remaining) {
      const u = t + remaining / length;
      return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
    }
    remaining -= length * (1 - t);
    i = (i + 1) % centre.length;
    t = 0;
  }
}

function driveOneLap(track: Track, speed: number) {
  let racer: Racer = { car: createCar(track.start, track, PHYSICS), progress: createProgress() };
  while (racer.progress.lapTicks.length < 1 && !racer.car.crashed && racer.progress.tick < 60 * 120) {
    const { position, heading, speed: v } = racer.car.vehicle;
    const target = lookAhead(track, position, 6);
    const alpha = wrapAngle(Math.atan2(target.y - position.y, target.x - position.x) - heading);
    const steering = Math.max(-1, Math.min(1, alpha / maxSteerAngle(v, PHYSICS)));
    racer = stepRacer(racer, { steering, throttle: v < speed ? 1 : 0, brake: v > speed + 1 ? 0.5 : 0 }, track, PHYSICS, DEFAULT_SIM_CONFIG.timestepSeconds);
  }
  return racer;
}

const BUILT_IN = [
  { id: 'stadium-oval', split: 'training', width: 14, gates: 20, radius: [38, 42], rightTurns: false },
  { id: 'rounded-rectangle', split: 'validation', width: 12, gates: 14, radius: [14, 16], rightTurns: false },
  { id: 'hairpin-chicane', split: 'held-out', width: 11, gates: 18, radius: [11, 13], rightTurns: true },
] as const;

describe('the built-in circuits', () => {
  it('are one per split, with stable IDs and versions, and the manifest hashes match the files', () => {
    expect(BUILT_IN_TRACK_SPLITS.tracks.map(({ id, version, split }) => ({ id, version, split }))).toEqual(
      BUILT_IN.map(({ id, split }) => ({ id, version: '1', split })),
    );
    for (const entry of BUILT_IN_TRACK_SPLITS.tracks) {
      expect(entry.contentHash).toBe(trackContentHash(entry.track));
      expect(entry.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(entry.geometryHash).toBe(trackGeometryHash(entry.track));
    }
  });

  it('leave the existing training oval unchanged (the page and trainer still use it)', () => {
    const oval = BUILT_IN_TRACK_SPLITS.tracks[0]!;
    expect(oval.track).toEqual(loadTrack(stadiumOval));
    expect(oval.contentHash).toBe('sha256:f1c3e1a7f9ef938d7a1ffd4bcb79e4260fd870b4c637fdf43389ee7f4aefe8c2');
    const main = readFileSync(join(__dirname, '../../src/main.ts'), 'utf8');
    expect(main).toContain("import stadiumOval from './data/tracks/stadium-oval.json'");
  });

  describe.each(BUILT_IN)('$id ($split)', ({ id, width, gates, radius }) => {
    const track = BUILT_IN_TRACK_SPLITS.tracks.find((t) => t.id === id)!.track;

    it('has simple, closed, non-crossing boundaries with the infield inside the outer boundary', () => {
      expect(isSimple(track.outer)).toBe(true);
      expect(isSimple(track.inner)).toBe(true);
      for (const p of track.inner) expect(inside(p, track.outer)).toBe(true);
      for (const [a, b] of edges(track.inner)) for (const [c, d] of edges(track.outer)) expect(segmentsTouch(a, b, c, d)).toBe(false);
    });

    it(`is at least ${width} m wide everywhere (within 2 % for chords on curves)`, () => {
      expect(minWidth(track)).toBeGreaterThan(width * 0.98);
      expect(minWidth(track)).toBeLessThanOrEqual(width + 1e-6);
    });

    it(`has ${gates} gates from the inner boundary to the outer boundary, each across the road`, () => {
      expect(track.gates).toHaveLength(gates);
      const onBoundary = (p: Vec2, boundary: readonly Vec2[]) => Math.min(...edges(boundary).map(([a, b]) => distanceToSegment(p, a, b)));
      for (const gate of track.gates) {
        expect(onBoundary(gate.a, track.inner)).toBeLessThan(1e-9);
        expect(onBoundary(gate.b, track.outer)).toBeLessThan(1e-9);
        const middle = { x: (gate.a.x + gate.b.x) / 2, y: (gate.a.y + gate.b.y) / 2 };
        expect(inside(middle, track.outer) && !inside(middle, track.inner)).toBe(true);
      }
    });

    it('starts clear of the walls, facing forwards just behind gate 0', () => {
      expect(createCar(track.start, track, PHYSICS).crashed).toBe(false);
      const { position: p, heading } = track.start;
      const ahead = { x: p.x + 7 * Math.cos(heading), y: p.y + 7 * Math.sin(heading) };
      expect(forwardCrossing(track.gates[0]!, p, ahead)).not.toBeNull();
    });

    it('can be driven: a centre-line follower completes a lap at 6, 8 and 10 m/s, crossing every gate in order', () => {
      for (const speed of [6, 8, 10]) {
        const racer = driveOneLap(track, speed);
        expect(racer.car.crashed).toBe(false);
        expect(racer.progress.lapTicks).toHaveLength(1);
        expect(racer.progress.gatesPassed).toBe(gates + 1);
      }
    });

    it(`has its tightest turn at a radius of ${radius[0]}–${radius[1]} m`, () => {
      const { minRadius } = corners(track);
      expect(minRadius).toBeGreaterThan(radius[0]);
      expect(minRadius).toBeLessThan(radius[1]);
    });
  });

  it('differ in corner geometry: radius, turn direction and width', () => {
    const signatures = BUILT_IN.map(({ id }) => {
      const track = BUILT_IN_TRACK_SPLITS.tracks.find((t) => t.id === id)!.track;
      const { minRadius, rightTurns } = corners(track);
      return { id, minRadius: Math.round(minRadius), right: rightTurns > 0, width: Math.round(minWidth(track)), gates: track.gates.length };
    });
    expect(signatures.map((s) => s.right)).toEqual(BUILT_IN.map((b) => b.rightTurns)); // only held-out turns right
    expect(new Set(signatures.map((s) => s.minRadius)).size).toBe(3);
    expect(new Set(signatures.map((s) => s.width)).size).toBe(3);
  });
});

describe('loadTrackSplits', () => {
  it('loads deterministically: equal and frozen results, whatever the key order of the files', () => {
    const a = loadTrackSplits(manifestData, FILES);
    const b = loadTrackSplits(clone(manifestData), clone(FILES));
    expect(b).toEqual(a);
    expect(Object.isFrozen(a) && Object.isFrozen(a.tracks) && a.tracks.every((t) => Object.isFrozen(t) && Object.isFrozen(t.track))).toBe(true);
    const reversed = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).reverse());
    const shuffled = Object.fromEntries(
      Object.entries(clone(FILES)).map(([file, data]) => [file, { ...reversed(data as Record<string, unknown>), start: reversed((data as { start: Record<string, unknown> }).start) }]),
    );
    expect(loadTrackSplits(manifestData, shuffled).tracks.map((t) => t.contentHash)).toEqual(a.tracks.map((t) => t.contentHash));
  });

  const manifest = () => clone(manifestData) as { format: unknown; version: unknown; tracks: Record<string, unknown>[] };
  const reject = (m: unknown, files: Record<string, unknown> = FILES) => () => loadTrackSplits(m, files);

  it.each([
    ['a wrong format', (m: ReturnType<typeof manifest>) => void (m.format = 'other'), /"format"/],
    ['a wrong version', (m: ReturnType<typeof manifest>) => void (m.version = 2), /"version"/],
    ['tracks that are not an array', (m: ReturnType<typeof manifest>) => void ((m as Record<string, unknown>).tracks = {}), /"tracks"/],
    ['a missing field', (m: ReturnType<typeof manifest>) => void delete m.tracks[1]!.contentHash, /tracks\[1\]\.contentHash/],
    ['an unknown split', (m: ReturnType<typeof manifest>) => void (m.tracks[1]!.split = 'test'), /unknown split "test"/],
    ['a track in two splits', (m: ReturnType<typeof manifest>) => void m.tracks.push({ ...m.tracks[0]!, split: 'validation', file: 'copy.json' }), /listed more than once/],
    ['a file listed twice', (m: ReturnType<typeof manifest>) => void m.tracks.push({ ...m.tracks[0]!, id: 'other' }), /file "stadium-oval.json" is listed more than once/],
    ['an empty split', (m: ReturnType<typeof manifest>) => void m.tracks.splice(2, 1), /"held-out" split has no tracks/],
    ['a missing file', (m: ReturnType<typeof manifest>) => void (m.tracks[1]!.file = 'nowhere.json'), /missing/],
    ['an ID that differs from the file', (m: ReturnType<typeof manifest>) => void (m.tracks[1]!.id = 'square'), /has id "rounded-rectangle"/],
    ['a version that differs from the file', (m: ReturnType<typeof manifest>) => void (m.tracks[1]!.version = '2'), /version "1"/],
    ['a stale content hash', (m: ReturnType<typeof manifest>) => void (m.tracks[1]!.contentHash = `sha256:${'0'.repeat(64)}`), /content hash/],
  ])('rejects %s', (_label, change, message) => {
    const m = manifest();
    change(m);
    expect(reject(m)).toThrow(TrackSplitError);
    expect(reject(m)).toThrow(message);
  });

  it('rejects a track edited by 1 mm without a new hash, and a file that does not load', () => {
    const files = clone(FILES);
    (files['hairpin-chicane.json'] as { outer: { x: number }[] }).outer[0]!.x += 0.001;
    expect(reject(manifestData, files)).toThrow(/"hairpin-chicane" content hash/);
    const broken = { ...clone(FILES), 'rounded-rectangle.json': { id: 'rounded-rectangle' } };
    expect(reject(manifestData, broken)).toThrow(/does not load: Invalid track/);
    expect(reject(null)).toThrow(TrackSplitError);
  });

  it('rejects the same circuit registered twice under different IDs', () => {
    const copy = { ...clone(hairpinChicane), id: 'hairpin-copy', name: 'Copy' };
    const m = manifest();
    m.tracks.push({ id: 'hairpin-copy', version: '1', split: 'training', file: 'copy.json', contentHash: trackContentHash(loadTrack(copy)) });
    expect(reject(m, { ...FILES, 'copy.json': copy })).toThrow(/"hairpin-chicane" and "hairpin-copy" have the same geometry/);
  });
});

describe('split boundaries', () => {
  it('lists each split and gives each accessor only its own split', () => {
    expect(tracksIn('training').map((t) => t.id)).toEqual(['stadium-oval']);
    expect(tracksIn('validation').map((t) => t.id)).toEqual(['rounded-rectangle']);
    expect(tracksIn('held-out').map((t) => t.id)).toEqual(['hairpin-chicane']);
    expect(() => tracksIn('test' as never)).toThrow(TrackLeakageError);
    expect(trainingTrack('stadium-oval').id).toBe('stadium-oval');
    expect(validationTrack('rounded-rectangle').id).toBe('rounded-rectangle');
    for (const id of ['rounded-rectangle', 'hairpin-chicane']) expect(() => trainingTrack(id)).toThrow(TrackLeakageError);
    for (const id of ['stadium-oval', 'hairpin-chicane']) expect(() => validationTrack(id)).toThrow(/may only use validation tracks/);
    expect(() => trainingTrack('silverstone')).toThrow(/No built-in track "silverstone"/);
  });

  describe('training uses training tracks only', () => {
    it('lets the trainer use the training oval and unregistered synthetic tracks, and records the split and hash', () => {
      const oval = trainingTrack('stadium-oval');
      expect(assertTrainingTrack(oval)).toBe('training');
      const versions = createTrainer({ ...DEFAULT_TRAINING_CONFIG, populationSize: 2, eliteCount: 0, selection: { type: 'tournament', size: 2 } }, env(oval)).setup.versions;
      expect(versions).toMatchObject({ trackId: 'stadium-oval', trackSplit: 'training', trackHash: trackContentHash(oval) });
      const synthetic = loadTrack({ ...clone(stadiumOval), id: 'synthetic', start: { position: { x: -5, y: 40 }, heading: 0 } });
      expect(assertTrainingTrack(synthetic)).toBe('unregistered');
    });

    it.each(['rounded-rectangle', 'hairpin-chicane'])('rejects the %s circuit in the trainer, by ID and as a renamed copy', (id) => {
      const track = BUILT_IN_TRACK_SPLITS.tracks.find((t) => t.id === id)!.track;
      expect(() => createTrainer(DEFAULT_TRAINING_CONFIG, env(track))).toThrow(TrackLeakageError);
      const renamed = loadTrack({ ...clone(track), id: 'practice-loop', name: 'Practice', version: '9' });
      expect(findRegistered(renamed).map((t) => t.id)).toEqual([id]);
      expect(() => createTrainer(DEFAULT_TRAINING_CONFIG, env(renamed))).toThrow(new RegExp(`a copy of "${id}" under the ID "practice-loop"`));
    });

    it.each(['rounded-rectangle', 'hairpin-chicane'])('rejects the %s circuit copied under the training ID "stadium-oval"', (id) => {
      const track = BUILT_IN_TRACK_SPLITS.tracks.find((t) => t.id === id)!.track;
      const disguised = loadTrack({ ...clone(track), id: 'stadium-oval', name: 'Stadium oval', version: '1' });
      expect(findRegistered(disguised).map((t) => t.id)).toEqual(['stadium-oval', id]); // the ID and the geometry both match
      expect(() => assertTrainingTrack(disguised)).toThrow(new RegExp(`a copy of "${id}" under the ID "stadium-oval"`));
      expect(() => createTrainer(DEFAULT_TRAINING_CONFIG, env(disguised))).toThrow(TrackLeakageError);
    });

    it('does not call new geometry under a training ID "training": it is recorded as unregistered', () => {
      const moved = loadTrack({ ...clone(stadiumOval), start: { position: { x: -5, y: 40 }, heading: 0 } });
      expect(moved.id).toBe('stadium-oval');
      expect(assertTrainingTrack(moved)).toBe('unregistered');
    });
  });

  describe('selection uses validation only', () => {
    it('chooses the model with the best mean validation score', () => {
      expect(
        selectByValidation([
          { modelId: 'a', trackId: 'rounded-rectangle', score: 10 },
          { modelId: 'b', trackId: 'rounded-rectangle', score: 30 },
          { modelId: 'a', trackId: 'rounded-rectangle', score: 40 },
        ]),
      ).toBe('b'); // a: (10 + 40) / 2 = 25; b: 30
    });

    it('breaks ties to the first model', () => {
      expect(selectByValidation([{ modelId: 'x', trackId: 'rounded-rectangle', score: 5 }, { modelId: 'y', trackId: 'rounded-rectangle', score: 5 }])).toBe('x');
    });

    it.each(['stadium-oval', 'hairpin-chicane'])('rejects any result on %s', (trackId) => {
      const results = [{ modelId: 'a', trackId: 'rounded-rectangle', score: 1 }, { modelId: 'b', trackId, score: 99 }];
      expect(() => selectByValidation(results)).toThrow(TrackLeakageError);
    });

    it('rejects no results and non-finite scores', () => {
      expect(() => selectByValidation([])).toThrow(RangeError);
      expect(() => selectByValidation([{ modelId: 'a', trackId: 'rounded-rectangle', score: NaN }])).toThrow(RangeError);
    });
  });

  describe('held-out evaluation uses frozen models only', () => {
    const parameters = Float64Array.from({ length: 159 }, (_, i) => Math.sin(i));
    const model = freezeModel(parameters, { seed: 1, generation: 49, selectedOn: 'rounded-rectangle' });

    it('freezes a copy with a content ID, deterministically', () => {
      expect(isFrozenModel(model)).toBe(true);
      expect(Object.isFrozen(model) && Object.isFrozen(model.parameters) && Object.isFrozen(model.provenance)).toBe(true);
      expect(model.id).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(freezeModel(parameters, { generation: 49, selectedOn: 'rounded-rectangle', seed: 1 }).id).toBe(model.id); // key order irrelevant
      expect(freezeModel(parameters, { seed: 2, generation: 49, selectedOn: 'rounded-rectangle' }).id).not.toBe(model.id);
      parameters[0] = 123; // changing the source afterwards does not change the frozen model
      expect(model.parameters[0]).toBe(0);
      expect(isFrozenModel(model)).toBe(true);
    });

    it('hands a held-out track to a frozen model, and only a held-out track', () => {
      expect(heldOutTrack('hairpin-chicane', model).id).toBe('hairpin-chicane');
      for (const id of ['stadium-oval', 'rounded-rectangle']) expect(() => heldOutTrack(id, model)).toThrow(/may only use held-out tracks/);
    });

    it('refuses models that are not frozen, have a forged ID or were altered after freezing', () => {
      const plain = { id: model.id, parameters: [...model.parameters], provenance: { ...model.provenance } } as FrozenModel;
      const forged = Object.freeze({ ...model, id: `sha256:${'0'.repeat(64)}` });
      const altered = Object.freeze({ ...model, parameters: Object.freeze(model.parameters.map((p, i) => (i === 3 ? p + 1 : p))) });
      const stolen = Object.freeze({ ...model, provenance: Object.freeze({ ...model.provenance, selectedOn: 'hairpin-chicane' }) });
      for (const bad of [plain, forged, altered, stolen, null as unknown as FrozenModel]) {
        expect(() => heldOutTrack('hairpin-chicane', bad)).toThrow(TrackLeakageError);
      }
    });

    it('rejects parameters and provenance that cannot be frozen faithfully', () => {
      expect(() => freezeModel([])).toThrow(RangeError);
      expect(() => freezeModel([1, NaN])).toThrow(/Parameter 1/);
      expect(() => freezeModel([1], { note: {} as unknown as string })).toThrow(/Provenance "note"/);
      expect(() => freezeModel([1], { x: Infinity })).toThrow(RangeError);
    });
  });
});

describe('separation', () => {
  it('track splits import only the simulation, utilities and track data', () => {
    const source = readFileSync(join(__dirname, '../../src/training/trackSplits.ts'), 'utf8');
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]!);
    for (const path of imports) expect(path).toMatch(/^\.\.\/(sim|utils|data\/tracks)\//);
  });
});
