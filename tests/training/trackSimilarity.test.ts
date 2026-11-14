// The geometry-only similarity guard (src/training/trackSimilarity.ts; docs/plans/p5-02-fresh-circuits-plan.md section 3.2): positive fixtures
// (a uniform scaling, a rotation, a mirror image, a reversed traversal and another cyclic start of a circuit are all the SAME shape) and the
// real registry (no two registered circuits share a shape). Nothing here runs a simulation, a model or a driver.
import { describe, expect, it } from 'vitest';
import type { Track, Vec2 } from '../../src/sim/track';
import { BUILT_IN_TRACK_SPLITS, findRegistered, roadFingerprint } from '../../src/training/trackSplits';
import { layoutDistance, similarLayouts, SIMILARITY_THRESHOLD, turningProfile } from '../../src/training/trackSimilarity';

const entries = BUILT_IN_TRACK_SPLITS.tracks;
const FRESH = ['hairpin-run', 'sweep-hook', 'hook-chicane'] as const;
const track = (id: string): Track => entries.find((e) => e.id === id)!.track;

const mapPoints = (t: Track, f: (p: Vec2) => Vec2): Track => ({
  ...t,
  outer: t.outer.map(f),
  inner: t.inner.map(f),
  start: { position: f(t.start.position), heading: t.start.heading },
  gates: t.gates.map((g) => ({ a: f(g.a), b: f(g.b) })),
});
const scaled = (t: Track, k: number): Track => mapPoints(t, (p) => ({ x: p.x * k, y: p.y * k }));
const rotated = (t: Track, angle: number): Track => mapPoints(t, (p) => ({ x: p.x * Math.cos(angle) - p.y * Math.sin(angle), y: p.x * Math.sin(angle) + p.y * Math.cos(angle) }));
const moved = (t: Track, dx: number, dy: number): Track => mapPoints(t, (p) => ({ x: p.x + dx, y: p.y + dy }));
/** The boundaries driven the other way round (the polygons' vertex order reversed). */
const reversed = (t: Track): Track => ({ ...t, outer: [...t.outer].reverse(), inner: [...t.inner].reverse() });
/** The mirror image, still counter-clockwise: reflect x, then reverse the vertex order of both boundaries. */
const mirrored = (t: Track): Track => reversed(mapPoints(t, (p) => ({ x: -p.x, y: p.y })));
/** The same road with another vertex as the first. */
const restarted = (t: Track, by: number): Track => ({ ...t, outer: [...t.outer.slice(by), ...t.outer.slice(0, by)], inner: [...t.inner.slice(by), ...t.inner.slice(0, by)] });

const TRANSFORMS: [string, (t: Track) => Track][] = [
  ['a uniform scaling by 1.1', (t) => scaled(t, 1.1)],
  ['a uniform scaling by 0.5', (t) => scaled(t, 0.5)],
  ['a rotation by 37 degrees', (t) => rotated(t, (37 * Math.PI) / 180)],
  ['a translation', (t) => moved(t, 1234.5, -987.6)],
  ['a mirror image (still counter-clockwise)', mirrored],
  ['a reversed traversal', reversed],
  ['another cyclic start', (t) => restarted(t, 7)],
  ['scaling, rotation, mirroring and a new start together', (t) => restarted(mirrored(rotated(scaled(t, 1.7), 1.1)), 11)],
];

describe('a transformed copy of any registered circuit is the same shape (positive fixtures)', () => {
  it.each(entries.map((e) => e.id))('%s: every transformation is within the threshold, by a wide margin', (id) => {
    const t = track(id);
    for (const [name, f] of TRANSFORMS) {
      const d = layoutDistance(t, f(t));
      expect(d, `${id}: ${name}`).toBeLessThan(1e-6); // exact copies measure at numerical zero, far below the threshold
      expect(similarLayouts(t, f(t)), `${id}: ${name}`).toBe(true);
    }
  });
  it('the exact-copy protection does NOT see a scaled or rotated copy, which is the gap this guard fills', () => {
    const t = track('hairpin-run');
    const copy = { ...scaled(t, 1.1), id: 'a-scaled-copy' };
    expect(findRegistered(copy)).toEqual([]);
    expect(roadFingerprint(copy)).not.toBe(roadFingerprint(t));
    expect(similarLayouts(t, copy)).toBe(true);
    const turned = { ...rotated(t, 0.8), id: 'a-rotated-copy' };
    expect(findRegistered(turned)).toEqual([]);
    expect(similarLayouts(t, turned)).toBe(true);
  });
  it('is symmetric', () => {
    for (const [, f] of TRANSFORMS.slice(0, 5)) {
      const a = track('sweep-hook');
      const b = f(a);
      expect(layoutDistance(a, b)).toBeCloseTo(layoutDistance(b, a), 6);
    }
  });
});

describe('the shapes of the registered circuits are all different (the real registry)', () => {
  const pairs: [string, string][] = [];
  for (let i = 0; i < entries.length; i += 1) for (let j = i + 1; j < entries.length; j += 1) pairs.push([entries[i]!.id, entries[j]!.id]);
  it('every pair of distinct registered circuits is farther apart than the threshold, by a wide margin (and the nearest pair is reported)', () => {
    const distances = pairs.map(([a, b]) => ({ pair: `${a} / ${b}`, d: layoutDistance(track(a), track(b)) }));
    const nearest = distances.reduce((m, x) => (x.d < m.d ? x : m));
    expect(nearest.d, `nearest pair: ${nearest.pair}`).toBeGreaterThan(SIMILARITY_THRESHOLD * 4);
    for (const { pair } of distances) expect(similarLayouts(track(pair.split(' / ')[0]!), track(pair.split(' / ')[1]!)), pair).toBe(false);
    expect(distances.every((x) => Number.isFinite(x.d))).toBe(true);
  });
  it.each(FRESH)('%s: no transformed copy of it matches any OTHER registered circuit, and no transformed copy of another circuit matches it', (id) => {
    const fresh = track(id);
    for (const other of entries.filter((e) => e.id !== id)) {
      for (const [name, f] of TRANSFORMS.slice(0, 6)) {
        expect(similarLayouts(f(fresh), other.track), `${id} (${name}) vs ${other.id}`).toBe(false);
        expect(similarLayouts(fresh, f(other.track)), `${other.id} (${name}) vs ${id}`).toBe(false);
      }
    }
  });
  it('the three fresh circuits differ from each other and from all five validation circuits and the three training circuits', () => {
    for (const id of FRESH) for (const other of entries.filter((e) => e.id !== id)) expect(similarLayouts(track(id), other.track), `${id} vs ${other.id}`).toBe(false);
  });
});

describe('the guard\'s own behaviour', () => {
  it('a different layout of the same size is not the same shape', () => {
    expect(similarLayouts(track('hairpin-run'), track('sweep-hook'))).toBe(false);
  });
  it('a circuit with different numbers of outer and inner vertices is refused, not guessed', () => {
    const t = track('hairpin-run');
    expect(() => layoutDistance({ ...t, inner: t.inner.slice(1) }, t)).toThrow(RangeError);
  });
  it('the turning profile of a lap sums to one full turn (counter-clockwise on the engine\'s screen axes) and its positions do not depend on scale', () => {
    const total = (t: Track) => turningProfile(t).reduce((s, x) => s + x.angle, 0);
    expect(Math.abs(total(track('hairpin-run')))).toBeCloseTo(2 * Math.PI, 6);
    const base = turningProfile(track('hairpin-run')).map((x) => x.at);
    const big = turningProfile(scaled(track('hairpin-run'), 3)).map((x) => x.at);
    big.forEach((v, i) => expect(v).toBeCloseTo(base[i]!, 9));
  });
});
