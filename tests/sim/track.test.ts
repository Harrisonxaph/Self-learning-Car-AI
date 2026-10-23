import { describe, expect, it } from 'vitest';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { TrackFormatError, loadTrack, trackBounds, type Track, type Vec2 } from '../../src/sim/track';

// Small geometry helpers, used only to check the built-in fixture. General track validation is P4-01.
const sub = (a: Vec2, b: Vec2) => ({ x: a.x - b.x, y: a.y - b.y });
const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x;
const edges = (points: readonly Vec2[]) => points.map((p, i) => [p, points[(i + 1) % points.length] as Vec2] as const);

function pointInPolygon(p: Vec2, polygon: readonly Vec2[]): boolean {
  let inside = false;
  for (const [a, b] of edges(polygon)) {
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function segmentsCross(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2): boolean {
  const d1 = cross(sub(p2, p1), sub(q1, p1));
  const d2 = cross(sub(p2, p1), sub(q2, p1));
  const d3 = cross(sub(q2, q1), sub(p1, q1));
  const d4 = cross(sub(q2, q1), sub(p2, q1));
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function isSimple(polygon: readonly Vec2[]): boolean {
  const all = edges(polygon);
  return all.every(([a, b], i) =>
    all.every(([c, d], j) => Math.abs(i - j) <= 1 || Math.abs(i - j) === all.length - 1 || !segmentsCross(a, b, c, d)),
  );
}

function distanceToPolygon(p: Vec2, polygon: readonly Vec2[]): number {
  return Math.min(
    ...edges(polygon).map(([a, b]) => {
      const ab = sub(b, a);
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / (ab.x ** 2 + ab.y ** 2)));
      return Math.hypot(p.x - (a.x + t * ab.x), p.y - (a.y + t * ab.y));
    }),
  );
}

const onRoad = (track: Track, p: Vec2) => pointInPolygon(p, track.outer) && !pointInPolygon(p, track.inner);
const midpoint = (a: Vec2, b: Vec2) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

describe('loadTrack', () => {
  it('loads the built-in stadium oval', () => {
    const track = loadTrack(stadiumOval);
    expect(track).toMatchObject({ id: 'stadium-oval', version: '1', name: 'Stadium oval' });
    expect(track.outer).toHaveLength(26);
    expect(track.inner).toHaveLength(26);
    expect(track.gates).toHaveLength(20);
    expect(track.start).toEqual({ position: { x: -6, y: 40 }, heading: 0 });
  });

  it('gives an identical result every time, independent of later changes to the input', () => {
    const data = structuredClone(stadiumOval);
    const first = loadTrack(data);
    data.outer[0]!.x = 999;
    data.name = 'changed';
    expect(first).toEqual(loadTrack(stadiumOval));
    expect(first.outer[0]).toEqual({ x: 60, y: 47 });
  });

  it('returns frozen data, so nothing can change the track by accident', () => {
    const track = loadTrack(stadiumOval);
    expect(Object.isFrozen(track)).toBe(true);
    expect(Object.isFrozen(track.outer)).toBe(true);
    expect(Object.isFrozen(track.outer[0])).toBe(true);
    expect(Object.isFrozen(track.gates[0])).toBe(true);
    expect(Object.isFrozen(track.start.position)).toBe(true);
  });

  const broken = (change: (data: Record<string, unknown>) => void) => {
    const data = structuredClone(stadiumOval) as unknown as Record<string, unknown>;
    change(data);
    return data;
  };
  it.each([
    ['null', null],
    ['an array', []],
    ['a missing id', broken((d) => delete d.id)],
    ['an empty name', broken((d) => (d.name = ''))],
    ['a numeric version', broken((d) => (d.version = 1))],
    ['an outer boundary with two points', broken((d) => (d.outer = (d.outer as unknown[]).slice(0, 2)))],
    ['a NaN coordinate', broken((d) => ((d.inner as { x: number }[])[3]!.x = Number.NaN))],
    ['a string coordinate', broken((d) => ((d.inner as { y: unknown }[])[0]!.y = '33'))],
    ['a hole in a boundary', broken((d) => (d.outer = Object.assign(Array(4), { 0: { x: 0, y: 0 }, 1: { x: 1, y: 0 }, 3: { x: 0, y: 1 } })))],
    ['a missing start pose', broken((d) => delete d.start)],
    ['an infinite heading', broken((d) => ((d.start as { heading: number }).heading = Number.POSITIVE_INFINITY))],
    ['two gates', broken((d) => (d.gates = (d.gates as unknown[]).slice(0, 2)))],
    ['a gate without an end', broken((d) => delete (d.gates as { b?: unknown }[])[5]!.b)],
  ])('rejects track data with %s', (_label, data) => {
    expect(() => loadTrack(data)).toThrow(TrackFormatError);
  });
});

describe('the stadium oval fixture', () => {
  const track = loadTrack(stadiumOval);

  it('has simple (non-crossing) closed boundaries', () => {
    expect(isSimple(track.outer)).toBe(true);
    expect(isSimple(track.inner)).toBe(true);
  });

  it('keeps the inner boundary inside the outer one without touching it', () => {
    expect(track.inner.every((p) => pointInPolygon(p, track.outer))).toBe(true);
    const crossings = edges(track.inner).filter(([a, b]) => edges(track.outer).some(([c, d]) => segmentsCross(a, b, c, d)));
    expect(crossings).toEqual([]);
  });

  it('starts on the road, just behind gate 0 and facing it', () => {
    const { position, heading } = track.start;
    expect(onRoad(track, position)).toBe(true);
    const gate0 = track.gates[0]!;
    const toGate = sub(midpoint(gate0.a, gate0.b), position);
    const ahead = toGate.x * Math.cos(heading) + toGate.y * Math.sin(heading);
    expect(ahead).toBeGreaterThan(0);
    expect(Math.hypot(toGate.x, toGate.y)).toBeLessThan(10);
  });

  it('has ordered gates that span the road from the inner to the outer boundary', () => {
    for (const gate of track.gates) {
      expect(distanceToPolygon(gate.a, track.inner)).toBeLessThan(1e-9);
      expect(distanceToPolygon(gate.b, track.outer)).toBeLessThan(1e-9);
      expect(onRoad(track, midpoint(gate.a, gate.b))).toBe(true);
    }
    // In order: the gate midpoints go once around the circuit in the start direction, with no big jumps.
    const mids = track.gates.map((g) => midpoint(g.a, g.b));
    let turned = 0;
    mids.forEach((m, i) => {
      const next = mids[(i + 1) % mids.length]!;
      expect(Math.hypot(next.x - m.x, next.y - m.y)).toBeLessThan(31);
      turned += Math.atan2(cross(m, next), m.x * next.x + m.y * next.y);
    });
    // Driving +x along the bottom straight (y > 0, with y pointing down) goes round in the -angle direction.
    expect(turned).toBeCloseTo(-2 * Math.PI, 6);
  });

  it('has bounds of 214 m by 94 m centred on the origin', () => {
    expect(trackBounds(track)).toEqual({ minX: -107, minY: -47, maxX: 107, maxY: 47 });
  });
});
