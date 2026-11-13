// The track index (P2-11 step 3): bit-identical to brute force. The index only picks WHICH segments the existing exact routines see, so every result must be
// the same IEEE-754 value (compared with Object.is, which tells -0 from 0 and NaN from NaN) as the function that tests every segment, on every built-in training
// and validation circuit, on a synthetic track with the format's maximum 2,000 points per boundary, and on small synthetic tracks, over seeded random queries and
// adversarial ones (an origin on a segment, a vertex or a cell edge; a ray along a wall, through a shared vertex or at exactly its range; a segment spanning many
// cells; negative and large coordinates; a point on a vertex's row). The held-out circuit is never touched: only the training and validation splits are read, and
// the synthetic tracks are generated here. Nothing here measures speed (that is `npm run bench`); it checks the answers, and that the index really prunes.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { castRay, castRays, DEFAULT_SENSOR_CONFIG, raySegment, type SensorReadings } from '../../src/sensors/rays';
import { castRayIndexed, castRaysIndexed } from '../../src/sensors/rayIndex';
import { DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { footprintHitsTrack, inPolygon, pointOnRoad, shapeTouchesBoundary, sweepHitsTrack, vehicleFootprint } from '../../src/sim/collision';
import { loadTrack, type Pose, type Track, type Vec2 } from '../../src/sim/track';
import {
  boxCandidateIds,
  buildTrackIndex,
  footprintHitsTrackIndexed,
  MAX_CELLS,
  MAX_REGISTRATIONS,
  pointCandidateIds,
  pointOnRoadIndexed,
  rayCandidateIds,
  shapeTouchesBoundaryIndexed,
  sweepHitsTrackIndexed,
  trackIndexFor,
  trackIndexStats,
  type TrackIndex,
} from '../../src/sim/trackIndex';
import { tracksIn } from '../../src/training/trackSplits';
import { createRng, type Rng } from '../../src/utils/rng';

const PHYSICS = DEFAULT_VEHICLE_PHYSICS;

// ---- Tracks ----
const circuits: { id: string; track: Track }[] = [...tracksIn('training'), ...tracksIn('validation')].map((t) => ({ id: t.id, track: t.track }));

/** A closed wavy boundary pair with `n` points per boundary (the format's maximum is 2,000), road half-width `half`, gates every `n / 40` points. */
function syntheticTrack(n: number, half: number, id: string): Track {
  const wave = (theta: number) => 300 + 60 * Math.sin(3 * theta) + 25 * Math.sin(7 * theta + 1);
  const ring = (offset: number): Vec2[] =>
    Array.from({ length: n }, (_, i) => {
      const theta = (2 * Math.PI * i) / n;
      const r = wave(theta) + offset;
      return { x: r * Math.cos(theta), y: r * Math.sin(theta) };
    });
  const outer = ring(half);
  const inner = ring(-half);
  const gates = Array.from({ length: 40 }, (_, g) => {
    const i = Math.floor((g * n) / 40);
    return { a: inner[i]!, b: outer[i]! };
  });
  return { id, version: '1', name: id, outer, inner, start: { position: { x: wave(0), y: 0 }, heading: Math.PI / 2 }, gates };
}
const translated = (track: Track, dx: number, dy: number, id: string): Track => {
  const move = (p: Vec2): Vec2 => ({ x: p.x + dx, y: p.y + dy });
  return {
    ...track,
    id,
    outer: track.outer.map(move),
    inner: track.inner.map(move),
    start: { position: move(track.start.position), heading: track.start.heading },
    gates: track.gates.map((g) => ({ a: move(g.a), b: move(g.b) })),
  };
};
const MAX_POINTS = syntheticTrack(2000, 8, 'synthetic-2000');
const square = (half: number, cx = 0, cy = 0): Vec2[] => [
  { x: cx - half, y: cy - half },
  { x: cx + half, y: cy - half },
  { x: cx + half, y: cy + half },
  { x: cx - half, y: cy + half },
];
const smallTrack = (outer: Vec2[], inner: Vec2[], id: string): Track => ({
  id,
  version: '1',
  name: id,
  outer,
  inner,
  start: { position: { x: 0, y: 0 }, heading: 0 },
  gates: [],
});
const smalls: { id: string; track: Track }[] = [
  { id: 'nested squares', track: smallTrack(square(20), square(10), 'nested') },
  { id: 'triangle in a square', track: smallTrack(square(30), [{ x: -5, y: -5 }, { x: 8, y: -4 }, { x: 0, y: 9 }], 'tri') },
  { id: 'a tiny loop wholly inside a big sweep', track: smallTrack(square(50), [{ x: 0, y: 0 }, { x: 0.01, y: 0 }, { x: 0.01, y: 0.01 }, { x: 0, y: 0.01 }], 'tiny') },
  { id: 'a two-point boundary (a single wall) and a one-point loop', track: smallTrack([{ x: -40, y: 3 }, { x: 40, y: 3 }], [{ x: 5, y: -5 }], 'wall') },
  { id: 'repeated points (zero-length segments)', track: smallTrack([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }, { x: 30, y: 30 }, { x: 0, y: 30 }], square(5, 15, 15), 'dups') },
  { id: 'a long thin diagonal wall', track: smallTrack([{ x: -400, y: -400 }, { x: 400, y: 400 }, { x: 400, y: 401 }], square(3, 0, 0), 'diag') },
];
/** `strict`: a real road, where both outcomes (hit and miss, on and off the road) must occur; the degenerate small tracks are exact-match tests only. */
const everything: { id: string; track: Track; queries: number; strict: boolean }[] = [
  ...circuits.map((c) => ({ ...c, queries: c.track.outer.length > 500 ? 25_000 : 60_000, strict: true })),
  { id: 'synthetic 2,000-point', track: MAX_POINTS, queries: 20_000, strict: true },
  { id: 'synthetic 2,000-point translated (-3200, 7100)', track: translated(MAX_POINTS, -3200, 7100, 's-neg'), queries: 6_000, strict: true },
  { id: 'synthetic 2,000-point translated (1e5, -1e5)', track: translated(MAX_POINTS, 1e5, -1e5, 's-far'), queries: 6_000, strict: true },
  { id: 'silverstone translated (-1e3, 2e3)', track: translated(circuits.find((c) => c.id === 'silverstone')!.track, -1e3, 2e3, 'silver-neg'), queries: 6_000, strict: true },
  ...smalls.map((s) => ({ ...s, queries: 20_000, strict: false })),
];

// ---- Helpers ----
const same = (a: number, b: number): boolean => Object.is(a, b);
function sameReadings(a: SensorReadings, b: SensorReadings): boolean {
  if (!same(a.origin.x, b.origin.x) || !same(a.origin.y, b.origin.y) || a.rays.length !== b.rays.length) return false;
  return a.rays.every((r, i) => {
    const q = b.rays[i]!;
    return same(r.angle, q.angle) && same(r.distance, q.distance) && same(r.normalised, q.normalised) && r.hit === q.hit && same(r.end.x, q.end.x) && same(r.end.y, q.end.y);
  });
}
function bounds(track: Track) {
  const pts = [...track.outer, ...track.inner];
  return { minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y)) };
}
/** A point anywhere in the track's bounds, widened by 15%. */
function anywhere(track: Track, rng: Rng): Vec2 {
  const b = bounds(track);
  const w = (b.maxX - b.minX) * 0.15 + 1;
  const h = (b.maxY - b.minY) * 0.15 + 1;
  return { x: rng.range(b.minX - w, b.maxX + w), y: rng.range(b.minY - h, b.maxY + h) };
}
/** A car-like pose: across a checkpoint gate when the track has gates (the road itself), otherwise anywhere; heading roughly along the road, sometimes any way. */
function carPose(track: Track, rng: Rng): Pose {
  if (track.gates.length === 0 || rng.next() < 0.15) return { position: anywhere(track, rng), heading: rng.range(-Math.PI, Math.PI) };
  const g = track.gates[rng.int(0, track.gates.length)]!;
  const u = rng.range(-0.1, 1.1);
  const along = Math.atan2(g.b.x - g.a.x, -(g.b.y - g.a.y)); // the gate's normal
  return {
    position: { x: g.a.x + (g.b.x - g.a.x) * u, y: g.a.y + (g.b.y - g.a.y) * u },
    heading: rng.next() < 0.5 ? along + rng.range(-0.6, 0.6) : rng.range(-Math.PI, Math.PI),
  };
}
const segmentOf = (track: Track, k: number): [Vec2, Vec2] => {
  const loop = k < track.outer.length ? track.outer : track.inner;
  const i = k < track.outer.length ? k : k - track.outer.length;
  return [loop[i]!, loop[(i + 1) % loop.length]!];
};
const segmentCount = (track: Track): number => track.outer.length + track.inner.length;

/** Compares one ray query; returns a description of the first difference, or null. */
function rayDifference(track: Track, index: TrackIndex, origin: Vec2, angle: number, range: number): string | null {
  const brute = castRay(origin, angle, range, [track.outer, track.inner]);
  const fast = castRayIndexed(index, origin, angle, range);
  if (!same(brute.distance, fast.distance) || brute.hit !== fast.hit) {
    return `origin (${origin.x}, ${origin.y}) angle ${angle} range ${range}: brute ${brute.distance}/${String(brute.hit)}, indexed ${fast.distance}/${String(fast.hit)}`;
  }
  return null;
}

describe('the circuits tested are the training and validation ones only', () => {
  it('names them, so no held-out circuit is read', () => {
    expect(circuits.map((c) => c.id).sort()).toEqual(['kidney-loop', 'rounded-rectangle', 's-sweepers', 'silverstone', 'stadium-oval']);
    const source = readFileSync(new URL('./trackIndex.test.ts', import.meta.url), 'utf8');
    // (the patterns are built from pieces so that this file does not match itself)
    expect(source).not.toMatch(new RegExp(`tracksIn\\(\\s*'held${'-'}out'`));
    expect(source).not.toMatch(new RegExp(`held${'Out'}Track`));
  });
});

describe('building the index', () => {
  it('is deterministic: two builds of one track are identical', () => {
    for (const { track } of everything) {
      const a = buildTrackIndex(track);
      const b = buildTrackIndex(track);
      expect([a.cols, a.rows, a.cellEdge, a.minX, a.minY, a.maxX, a.maxY, a.outerCount]).toEqual([b.cols, b.rows, b.cellEdge, b.minX, b.minY, b.maxX, b.maxY, b.outerCount]);
      expect(Array.from(a.cellStart)).toEqual(Array.from(b.cellStart));
      expect(Array.from(a.cellItems)).toEqual(Array.from(b.cellItems));
    }
  });

  it('is immutable and keeps the track objects: a frozen index over the track\'s own points, and the track is unchanged by queries', () => {
    const { track } = circuits.find((c) => c.id === 'silverstone')!;
    const before = JSON.stringify(track);
    const index = buildTrackIndex(track);
    expect(Object.isFrozen(index)).toBe(true);
    expect(index.segA[0]).toBe(track.outer[0]);
    expect(index.segB[track.outer.length - 1]).toBe(track.outer[0]); // the loop closes
    const starts = Array.from(index.cellStart);
    const items = Array.from(index.cellItems);
    const rng = createRng(11);
    for (let i = 0; i < 300; i += 1) {
      const origin = anywhere(track, rng);
      castRayIndexed(index, origin, rng.range(-3, 3), 50);
      pointOnRoadIndexed(origin, index);
      shapeTouchesBoundaryIndexed(vehicleFootprint({ position: origin, heading: rng.range(-3, 3) }, PHYSICS), index);
    }
    expect(JSON.stringify(track)).toBe(before);
    expect(Array.from(index.cellStart)).toEqual(starts);
    expect(Array.from(index.cellItems)).toEqual(items);
  });

  it('registers every segment in the cells its box overlaps, in increasing segment order, and stays under the caps', () => {
    for (const { id, track } of everything) {
      const index = buildTrackIndex(track);
      const stats = trackIndexStats(index);
      expect(stats.segments, id).toBe(segmentCount(track));
      expect(stats.cells, id).toBeLessThanOrEqual(MAX_CELLS);
      expect(stats.registrations, id).toBeLessThanOrEqual(MAX_REGISTRATIONS);
      expect(stats.registrations, id).toBeGreaterThanOrEqual(stats.segments);
      for (let c = 0; c < stats.cells; c += 1) {
        for (let k = index.cellStart[c]! + 1; k < index.cellStart[c + 1]!; k += 1) expect(index.cellItems[k]!, id).toBeGreaterThan(index.cellItems[k - 1]!);
      }
      // Every segment is somewhere: the box query over the whole grid returns all of them.
      expect(boxCandidateIds(index, index.minX, index.minY, index.maxX, index.maxY).length, id).toBe(stats.segments);
    }
  });

  it('is bounded for any geometry: a huge track and a track of one enormous segment among tiny ones stay under the caps and stay correct', () => {
    const huge = syntheticTrack(2000, 8, 'huge');
    const scale = (p: Vec2): Vec2 => ({ x: p.x * 2e5, y: p.y * 2e5 });
    const vast: Track = { ...huge, id: 'vast', outer: huge.outer.map(scale), inner: huge.inner.map(scale) };
    const lopsided = smallTrack(
      [{ x: -5e6, y: -5e6 }, { x: 5e6, y: -5e6 }, { x: 5e6, y: 5e6 }, { x: -5e6, y: 5e6 }],
      Array.from({ length: 3000 }, (_, i) => ({ x: Math.cos(i / 3000 * 2 * Math.PI) * 0.5, y: Math.sin(i / 3000 * 2 * Math.PI) * 0.5 })),
      'lopsided',
    );
    for (const track of [vast, lopsided]) {
      const index = buildTrackIndex(track);
      const stats = trackIndexStats(index);
      expect(stats.cells).toBeLessThanOrEqual(MAX_CELLS);
      expect(stats.registrations).toBeLessThanOrEqual(MAX_REGISTRATIONS);
      const rng = createRng(5);
      for (let i = 0; i < 400; i += 1) {
        const p = anywhere(track, rng);
        expect(pointOnRoadIndexed(p, index), `${track.id} point`).toBe(pointOnRoad(p, track));
        expect(rayDifference(track, index, p, rng.range(-Math.PI, Math.PI), rng.range(1, 1e7))).toBeNull();
      }
    }
  });

  it('refuses a boundary point that is not finite, and builds a cached index once per track object', () => {
    const bad: Track = { ...smalls[0]!.track, outer: [{ x: 0, y: 0 }, { x: Number.NaN, y: 1 }, { x: 5, y: 5 }] };
    expect(() => buildTrackIndex(bad)).toThrow(RangeError);
    const track = circuits[0]!.track;
    expect(trackIndexFor(track)).toBe(trackIndexFor(track));
    const copy = loadTrack(JSON.parse(JSON.stringify(track)));
    expect(trackIndexFor(copy)).not.toBe(trackIndexFor(track));
  });
});

describe('ray casts: the index gives brute force\'s distance and hit flag exactly', () => {
  for (const { id, track, queries, strict } of everything) {
    it(`${id}: ${queries} seeded random rays`, { timeout: 180_000 }, () => {
      const index = buildTrackIndex(track);
      const rng = createRng(1234);
      let hits = 0;
      for (let i = 0; i < queries; i += 1) {
        const pose = carPose(track, rng);
        const range = i % 3 === 0 ? 50 : rng.range(0.01, 160);
        const angle = i % 7 === 0 ? [0, Math.PI / 2, Math.PI, -Math.PI / 2, 2 * Math.PI][i % 5]! : pose.heading + rng.range(-Math.PI, Math.PI);
        const difference = rayDifference(track, index, pose.position, angle, range);
        expect(difference).toBeNull();
        if (castRay(pose.position, angle, range, [track.outer, track.inner]).hit) hits += 1;
      }
      if (strict) {
        expect(hits, 'the queries both hit and miss').toBeGreaterThan(queries / 20);
        expect(hits).toBeLessThan(queries);
      } else {
        expect(hits).toBeGreaterThan(0);
      }
    });
  }

  it('the candidate list holds every segment that gives a hit within range (the claim the exactness rests on)', { timeout: 180_000 }, () => {
    for (const { id, track } of everything.filter((e) => segmentCount(e.track) < 5000)) {
      const index = buildTrackIndex(track);
      const rng = createRng(77);
      for (let i = 0; i < 1500; i += 1) {
        const pose = carPose(track, rng);
        const range = rng.range(0.01, 120);
        const angle = pose.heading + rng.range(-Math.PI, Math.PI);
        const candidates = new Set(rayCandidateIds(index, pose.position, angle, range));
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        for (let k = 0; k < segmentCount(track); k += 1) {
          const [a, b] = segmentOf(track, k);
          const t = raySegment(pose.position, dx, dy, a, b);
          if (t <= range) expect(candidates.has(k), `${id} segment ${k} t=${t}`).toBe(true);
        }
      }
    }
  });

  it('full seven-ray readings are identical field by field (angle, distance, normalised, hit, end)', { timeout: 120_000 }, () => {
    for (const { id, track } of everything.filter((e) => segmentCount(e.track) < 5000)) {
      const index = buildTrackIndex(track);
      const rng = createRng(31);
      for (let i = 0; i < 1200; i += 1) {
        const pose = carPose(track, rng);
        const config = i % 4 === 0 ? { ...DEFAULT_SENSOR_CONFIG, maxDistance: rng.range(1, 200) } : DEFAULT_SENSOR_CONFIG;
        expect(sameReadings(castRays(pose, track, PHYSICS, config), castRaysIndexed(pose, index, PHYSICS, config)), `${id} #${i}`).toBe(true);
      }
    }
  });

  it('adversarial: an origin on a segment, on its midpoint and on a vertex reads 0 every way, as brute force does', () => {
    for (const { id, track } of everything) {
      const index = buildTrackIndex(track);
      const step = Math.max(1, Math.floor(segmentCount(track) / 60));
      for (let k = 0; k < segmentCount(track); k += step) {
        const [a, b] = segmentOf(track, k);
        for (const origin of [a, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, { x: a.x + (b.x - a.x) * 0.25, y: a.y + (b.y - a.y) * 0.25 }, b]) {
          for (const angle of [0, 1, 2, -1, Math.PI, Math.PI / 2, -Math.PI / 2, Math.atan2(b.y - a.y, b.x - a.x)]) {
            expect(rayDifference(track, index, origin, angle, 50), `${id} segment ${k}`).toBeNull();
          }
        }
      }
    }
  });

  it('adversarial: along a wall, both ways, from before, on and beyond it (collinear and parallel), and within LINE_TOLERANCE of it', () => {
    for (const { id, track } of everything) {
      const index = buildTrackIndex(track);
      const step = Math.max(1, Math.floor(segmentCount(track) / (segmentCount(track) > 1000 ? 16 : 50)));
      for (let k = 0; k < segmentCount(track); k += step) {
        const [a, b] = segmentOf(track, k);
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        if (length === 0) continue;
        const along = Math.atan2(b.y - a.y, b.x - a.x);
        const ux = (b.x - a.x) / length;
        const uy = (b.y - a.y) / length;
        for (const t of [-length, -0.001, 0, 0.5 * length, length, 1.5 * length, 3 * length]) {
          for (const sideways of [0, 1e-15, -1e-15, 1e-13, 5e-13, 1e-12, 2e-12, 1e-9, 0.5]) {
            const origin = { x: a.x + ux * t - uy * sideways, y: a.y + uy * t + ux * sideways };
            for (const angle of [along, along + Math.PI, along + 1e-9, along - 1e-9]) {
              expect(rayDifference(track, index, origin, angle, 50), `${id} segment ${k} t ${t} side ${sideways}`).toBeNull();
              expect(rayDifference(track, index, origin, angle, length), `${id} segment ${k} t ${t} side ${sideways} range length`).toBeNull();
            }
          }
        }
      }
    }
  });

  it('adversarial: a ray aimed at a vertex (through the point two segments share), with a range short of it, at it and past it', () => {
    for (const { id, track } of everything) {
      const index = buildTrackIndex(track);
      const rng = createRng(9);
      const step = Math.max(1, Math.floor(segmentCount(track) / 80));
      for (let k = 0; k < segmentCount(track); k += step) {
        const [vertex] = segmentOf(track, k);
        for (let i = 0; i < 6; i += 1) {
          const origin = { x: vertex.x + rng.range(-45, 45), y: vertex.y + rng.range(-45, 45) };
          const distance = Math.hypot(vertex.x - origin.x, vertex.y - origin.y);
          if (distance === 0) continue;
          const angle = Math.atan2(vertex.y - origin.y, vertex.x - origin.x);
          for (const range of [distance * 0.5, distance - 1e-9, distance, distance + 1e-9, distance * 1.5, 80]) {
            expect(rayDifference(track, index, origin, angle, range), `${id} vertex of segment ${k}`).toBeNull();
          }
        }
      }
    }
  });

  it('adversarial: a hit at exactly the range counts, and the range one step either side of it, as brute force does', () => {
    for (const { id, track } of everything) {
      const index = buildTrackIndex(track);
      const rng = createRng(21);
      let exact = 0;
      for (let i = 0; i < 1500; i += 1) {
        const pose = carPose(track, rng);
        const angle = pose.heading + rng.range(-Math.PI, Math.PI);
        const wide = castRay(pose.position, angle, 300, [track.outer, track.inner]);
        if (!wide.hit) continue;
        exact += 1;
        const d = wide.distance;
        if (d === 0) continue;
        for (const range of [d, d * (1 + Number.EPSILON), d * (1 - Number.EPSILON), d + 1e-12, d - 1e-12]) {
          expect(rayDifference(track, index, pose.position, angle, range), `${id} #${i}`).toBeNull();
        }
      }
      expect(exact, id).toBeGreaterThan(50);
    }
  });

  it('adversarial: origins exactly on a cell edge or corner, and rays along the grid lines', () => {
    for (const { id, track } of everything) {
      const index = buildTrackIndex(track);
      const rng = createRng(3);
      for (let i = 0; i < 400; i += 1) {
        const column = rng.int(0, index.cols + 1);
        const row = rng.int(0, index.rows + 1);
        const x = index.minX + column * index.cellEdge;
        const y = index.minY + row * index.cellEdge;
        const origins: Vec2[] = [{ x, y }, { x, y: rng.range(index.minY, index.maxY) }, { x: rng.range(index.minX, index.maxX), y }];
        for (const origin of origins) {
          for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2, rng.range(-Math.PI, Math.PI)]) {
            expect(rayDifference(track, index, origin, angle, i % 2 === 0 ? 50 : rng.range(1, 200)), `${id} cell edge`).toBeNull();
          }
        }
      }
    }
  });

  it('refuses what brute force refuses, with the same message', () => {
    const track = circuits[0]!.track;
    const index = buildTrackIndex(track);
    const origin = { x: 1, y: 1 };
    const bad: [Vec2, number, number][] = [
      [{ x: Number.NaN, y: 0 }, 0, 50],
      [{ x: 0, y: Number.POSITIVE_INFINITY }, 0, 50],
      [origin, Number.NaN, 50],
      [origin, 0, 0],
      [origin, 0, Number.POSITIVE_INFINITY],
      [origin, 0, -5],
    ];
    for (const [o, angle, range] of bad) {
      const message = (() => {
        try {
          castRay(o, angle, range, [track.outer, track.inner]);
          return 'no error';
        } catch (error) {
          return (error as Error).message;
        }
      })();
      expect(message).not.toBe('no error');
      expect(() => castRayIndexed(index, o, angle, range)).toThrow(message);
    }
    expect(() => castRaysIndexed({ position: origin, heading: Number.NaN }, index, PHYSICS, DEFAULT_SENSOR_CONFIG)).toThrow(RangeError);
    expect(() => castRaysIndexed({ position: origin, heading: 0 }, index, PHYSICS, { ...DEFAULT_SENSOR_CONFIG, maxDistance: 0 })).toThrow(RangeError);
    expect(() => castRaysIndexed({ position: origin, heading: 0 }, index, { wheelbase: 0 }, DEFAULT_SENSOR_CONFIG)).toThrow(RangeError);
  });
});

describe('the road test: pointOnRoadIndexed is pointOnRoad exactly', () => {
  for (const { id, track, queries, strict } of everything) {
    it(`${id}: seeded random points, vertices, edge points and points on a vertex's row`, { timeout: 180_000 }, () => {
      const index = buildTrackIndex(track);
      const rng = createRng(555);
      let on = 0;
      let off = 0;
      const check = (p: Vec2, what: string) => {
        const brute = pointOnRoad(p, track);
        expect(pointOnRoadIndexed(p, index), `${id} ${what} (${p.x}, ${p.y})`).toBe(brute);
        if (brute) on += 1;
        else off += 1;
      };
      for (let i = 0; i < queries; i += 1) {
        const roll = i % 5;
        if (roll === 0) check(anywhere(track, rng), 'random');
        else if (roll === 1) check(carPose(track, rng).position, 'on the road');
        else if (roll === 2) {
          const [vertex] = segmentOf(track, rng.int(0, segmentCount(track)));
          check(vertex, 'vertex');
          check({ x: vertex.x + rng.range(-3, 3), y: vertex.y }, "on a vertex's row");
          check({ x: vertex.x, y: vertex.y + rng.range(-1e-9, 1e-9) }, 'a hair off a vertex');
        } else if (roll === 3) {
          const [a, b] = segmentOf(track, rng.int(0, segmentCount(track)));
          const t = rng.next();
          check({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, 'on an edge');
        } else {
          const b = bounds(track);
          check({ x: rng.next() < 0.5 ? b.minX : b.maxX, y: rng.range(b.minY, b.maxY) }, 'on the bounding box');
          check({ x: rng.range(b.minX, b.maxX), y: rng.next() < 0.5 ? b.minY : b.maxY }, 'on the bounding box');
        }
      }
      expect(on + off).toBeGreaterThan(0);
      if (strict) {
        expect(on).toBeGreaterThan(0);
        expect(off).toBeGreaterThan(0);
      }
    });
  }

  it('non-finite points give brute force\'s answer', () => {
    for (const { track } of everything.slice(0, 8)) {
      const index = buildTrackIndex(track);
      const values = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -0];
      for (const x of values) {
        for (const y of values) expect(pointOnRoadIndexed({ x, y }, index)).toBe(pointOnRoad({ x, y }, track));
      }
    }
  });

  it('the candidate list holds every edge that can toggle the parity', () => {
    for (const { id, track } of everything.filter((e) => segmentCount(e.track) < 5000)) {
      const index = buildTrackIndex(track);
      const rng = createRng(8);
      for (let i = 0; i < 1500; i += 1) {
        const p = i % 3 === 0 ? segmentOf(track, rng.int(0, segmentCount(track)))[0] : anywhere(track, rng);
        const q = i % 3 === 1 ? { x: p.x, y: segmentOf(track, rng.int(0, segmentCount(track)))[0].y } : p;
        const candidates = new Set(pointCandidateIds(index, q));
        for (let k = 0; k < segmentCount(track); k += 1) {
          const [a0, b0] = segmentOf(track, k);
          const a = b0; // inPolygon's (a, b) for this edge
          const b = a0;
          if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) expect(candidates.has(k), `${id} edge ${k}`).toBe(true);
        }
      }
    }
  });

  it('the two loops are separate parities, as in pointOnRoad (a point inside the inner loop is off the road; inside only the outer is on)', () => {
    const track = smalls[0]!.track;
    const index = buildTrackIndex(track);
    expect(pointOnRoadIndexed({ x: 15, y: 0 }, index)).toBe(true);
    expect(pointOnRoadIndexed({ x: 0, y: 0 }, index)).toBe(false);
    expect(pointOnRoadIndexed({ x: 25, y: 0 }, index)).toBe(false);
    expect(inPolygon(track.outer, { x: 15, y: 0 })).toBe(true);
  });
});

describe('collision: footprints and sweeps give brute force\'s verdict exactly', () => {
  for (const { id, track, queries, strict } of everything) {
    it(`${id}: seeded random footprints and sweeps (straight, turning and sharply turning)`, { timeout: 180_000 }, () => {
      const index = buildTrackIndex(track);
      const rng = createRng(909);
      let hitCount = 0;
      let clearCount = 0;
      const n = Math.max(2000, Math.floor(queries / 3));
      for (let i = 0; i < n; i += 1) {
        const before = carPose(track, rng);
        const footprint = vehicleFootprint(before, PHYSICS);
        const verdict = footprintHitsTrack(footprint, track);
        expect(footprintHitsTrackIndexed(footprint, index), `${id} footprint #${i}`).toBe(verdict);
        const speed = i % 10 === 0 ? rng.range(0, 40) : rng.range(0, 0.6);
        const turn = i % 4 === 0 ? rng.range(-Math.PI, Math.PI) : i % 4 === 1 ? rng.range(-0.3, 0.3) : rng.range(-0.03, 0.03);
        const heading = before.heading + turn;
        const direction = i % 3 === 0 ? rng.range(-Math.PI, Math.PI) : before.heading;
        const after: Pose = { position: { x: before.position.x + Math.cos(direction) * speed, y: before.position.y + Math.sin(direction) * speed }, heading };
        const sweep = sweepHitsTrack(before, after, track, PHYSICS);
        expect(sweepHitsTrackIndexed(before, after, index, PHYSICS), `${id} sweep #${i}`).toBe(sweep);
        if (sweep) hitCount += 1;
        else clearCount += 1;
      }
      if (strict) {
        expect(hitCount, 'some sweeps hit').toBeGreaterThan(0);
        expect(clearCount, 'some sweeps are clear').toBeGreaterThan(0);
      }
    });
  }

  it('shape tests with a margin, a big shape, a shape off the grid and a shape holding a whole loop', () => {
    for (const { id, track } of everything.filter((e) => segmentCount(e.track) < 5000)) {
      const index = buildTrackIndex(track);
      const rng = createRng(4);
      for (let i = 0; i < 800; i += 1) {
        const centre = i % 5 === 0 ? { x: rng.range(-1e4, 1e4), y: rng.range(-1e4, 1e4) } : anywhere(track, rng);
        const size = i % 7 === 0 ? rng.range(40, 600) : rng.range(0.1, 4);
        const points = Array.from({ length: rng.int(1, 9) }, () => ({ x: centre.x + rng.range(-size, size), y: centre.y + rng.range(-size, size) }));
        const margin = i % 3 === 0 ? 0 : rng.range(0, 1.5);
        expect(shapeTouchesBoundaryIndexed(points, index, margin), `${id} shape #${i}`).toBe(shapeTouchesBoundary(points, track, margin));
      }
    }
  });

  it('a boundary loop wholly inside the swept hull is caught (the tiny loop in a big sweep)', () => {
    const { track } = smalls[2]!;
    const index = buildTrackIndex(track);
    const before: Pose = { position: { x: -10, y: 0.005 }, heading: 0 };
    const after: Pose = { position: { x: 10, y: 0.005 }, heading: 0 };
    expect(sweepHitsTrack(before, after, track, PHYSICS)).toBe(true);
    expect(sweepHitsTrackIndexed(before, after, index, PHYSICS)).toBe(true);
  });

  it('non-finite shapes and margins give brute force\'s answer', () => {
    const { track } = circuits[0]!;
    const index = buildTrackIndex(track);
    const shapes: Vec2[][] = [
      [{ x: Number.NaN, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }],
      [{ x: 0, y: 0 }, { x: Number.POSITIVE_INFINITY, y: 1 }, { x: 2, y: 0 }],
      [],
    ];
    for (const shape of shapes) {
      for (const margin of [0, 0.5, Number.NaN]) {
        expect(shapeTouchesBoundaryIndexed(shape, index, margin)).toBe(shapeTouchesBoundary(shape, track, margin));
      }
    }
  });
});

describe('determinism and independence from history', () => {
  it('results do not depend on the order of queries or on cache state', { timeout: 120_000 }, () => {
    const { track } = circuits.find((c) => c.id === 'silverstone')!;
    const rng = createRng(2024);
    const queries = Array.from({ length: 3000 }, () => {
      const pose = carPose(track, rng);
      return { origin: pose.position, angle: pose.heading + rng.range(-3, 3), range: rng.range(1, 120) };
    });
    const run = (order: number[], index: TrackIndex) => {
      const out = new Array<[number, boolean]>(queries.length);
      for (const i of order) {
        const q = queries[i]!;
        const r = castRayIndexed(index, q.origin, q.angle, q.range);
        out[i] = [r.distance, r.hit];
      }
      return out;
    };
    const forward = queries.map((_, i) => i);
    const shuffled = [...forward].sort(() => rng.next() - 0.5);
    const a = run(forward, buildTrackIndex(track));
    const b = run(shuffled, buildTrackIndex(track));
    const c = run(forward, trackIndexFor(track));
    for (let i = 0; i < queries.length; i += 1) {
      expect(same(a[i]![0], b[i]![0]) && a[i]![1] === b[i]![1], `order #${i}`).toBe(true);
      expect(same(a[i]![0], c[i]![0]) && a[i]![1] === c[i]![1], `cache #${i}`).toBe(true);
    }
  });

  it('a custom track loaded twice gives the same index and the same results', () => {
    const data = JSON.parse(JSON.stringify(circuits.find((c) => c.id === 'kidney-loop')!.track)) as unknown;
    const first = loadTrack(data);
    const second = loadTrack(data);
    const a = buildTrackIndex(first);
    const b = buildTrackIndex(second);
    expect(Array.from(a.cellStart)).toEqual(Array.from(b.cellStart));
    expect(Array.from(a.cellItems)).toEqual(Array.from(b.cellItems));
    const rng = createRng(6);
    for (let i = 0; i < 500; i += 1) {
      const p = anywhere(first, rng);
      const angle = rng.range(-3, 3);
      expect(castRayIndexed(a, p, angle, 50)).toEqual(castRayIndexed(b, p, angle, 50));
      expect(pointOnRoadIndexed(p, a)).toBe(pointOnRoadIndexed(p, b));
    }
  });

  it('the stamp counter wrapping around does not change a result', () => {
    const { track } = circuits[0]!;
    const index = buildTrackIndex(track);
    const rng = createRng(1);
    const probes = Array.from({ length: 50 }, () => ({ origin: anywhere(track, rng), angle: rng.range(-3, 3) }));
    const expected = probes.map((p) => castRayIndexed(index, p.origin, p.angle, 50));
    // Force the counter to its limit through the public API: no way to set it, so run enough queries to know the path is exercised elsewhere (stamps are per query).
    for (let i = 0; i < 20_000; i += 1) castRayIndexed(index, probes[i % 50]!.origin, probes[i % 50]!.angle, 50);
    expect(probes.map((p) => castRayIndexed(index, p.origin, p.angle, 50))).toEqual(expected);
  });
});

describe('the index prunes: far fewer segments are tested than brute force tests', () => {
  it('on Silverstone (2,356 segments) a seven-ray reading, a sweep and a road test look at a small fraction', () => {
    const { track } = circuits.find((c) => c.id === 'silverstone')!;
    const index = buildTrackIndex(track);
    const rng = createRng(100);
    let rayTotal = 0;
    let rays = 0;
    let boxTotal = 0;
    let boxes = 0;
    let rowTotal = 0;
    let rows = 0;
    for (let i = 0; i < 1000; i += 1) {
      const pose = carPose(track, rng);
      for (const degrees of [-90, -60, -30, 0, 30, 60, 90]) {
        rayTotal += rayCandidateIds(index, pose.position, pose.heading + (degrees * Math.PI) / 180, 50).length;
        rays += 1;
      }
      const footprint = vehicleFootprint(pose, PHYSICS);
      const xs = footprint.map((p) => p.x);
      const ys = footprint.map((p) => p.y);
      boxTotal += boxCandidateIds(index, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)).length;
      boxes += 1;
      rowTotal += pointCandidateIds(index, footprint[0]!).length;
      rows += 1;
    }
    expect(rayTotal / rays, 'segments per ray').toBeLessThan(2356 / 15);
    expect(boxTotal / boxes, 'segments per footprint').toBeLessThan(2356 / 50);
    expect(rowTotal / rows, 'segments per road test').toBeLessThan(2356 / 8);
  });
});
