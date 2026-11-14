// A geometry-only similarity guard for circuits (docs/plans/p5-02-fresh-circuits-plan.md section 3.2): is one circuit a uniform scaling, a
// rotation, a mirror image, a reversed traversal or another cyclic start of another? The exact-copy protection in trackSplits.ts (ID,
// geometry hash, road fingerprint) compares exact coordinates and cannot see these. This module compares the SHAPE of the centre line only.
//
// The shape is the centre line's TURNING MEASURE: the heading change at each vertex of the polygon through the midpoints of facing outer and
// inner vertices, placed at that vertex's fraction of the lap. Dividing by the lap length removes scale; using heading changes removes
// rotation and translation. Two layouts are the same shape when, after one of the transformations below, their turning measures agree:
//   - identity;
//   - mirror image driven the same way round: the turning is negated AND the traversal is reversed (a mirrored counter-clockwise
//     circuit is clockwise, so it is driven counter-clockwise by reversing it);
//   - and the two orientation-changing ones (reversal alone, negation alone), included so a clockwise fixture is still recognised.
// The comparison is the circular earth-mover distance between the two cumulative turning functions, minimised over every cyclic start, in
// radians (an average cumulative-turning gap over the lap). It is a bounded, deterministic computation: no simulation, no model, no driver.
//
// It is NOT a similarity of difficulty or of driving behaviour, and it ignores the road width. Two different layouts are "similar" only if
// their centre-line shape matches within the threshold; the threshold is calibrated in tests/training/trackSimilarity.test.ts against
// transformed copies (which sit at numerical zero) and against every pair of registered circuits (which sit far above it).
import type { Track, Vec2 } from '../sim/track';

/** Samples of the cumulative turning function per comparison. */
const SAMPLES = 512;
/** Two layouts closer than this (radians, see above) are treated as the same shape. Exact transformed copies measure about 1e-14; the nearest pair of distinct registered circuits measures about 0.11. */
export const SIMILARITY_THRESHOLD = 0.02;

/** One heading change and where it happens: a vertex of the centre line. `at` is the fraction of the lap length in [0, 1). */
interface Turn {
  readonly at: number;
  readonly angle: number;
}

const wrap = (a: number): number => {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x <= -Math.PI) x += 2 * Math.PI;
  return x;
};

/** The centre line's closed polygon: the midpoint of each facing outer/inner vertex pair. Throws for a track whose boundaries do not pair up. */
function centreLine(track: Track): Vec2[] {
  if (track.outer.length !== track.inner.length) throw new RangeError(`Track "${track.id}": the outer and inner boundaries must have the same number of vertices.`);
  return track.outer.map((p, i) => ({ x: (p.x + track.inner[i]!.x) / 2, y: (p.y + track.inner[i]!.y) / 2 }));
}

/** The turning measure of a closed polygon: a heading change at each vertex, at the vertex's fraction of the perimeter. */
function turningMeasure(points: readonly Vec2[]): Turn[] {
  const n = points.length;
  const lengths = points.map((p, i) => Math.hypot(points[(i + 1) % n]!.x - p.x, points[(i + 1) % n]!.y - p.y));
  const total = lengths.reduce((a, b) => a + b, 0);
  const heading = (i: number): number => Math.atan2(points[(i + 1) % n]!.y - points[i]!.y, points[(i + 1) % n]!.x - points[i]!.x);
  const turns: Turn[] = [];
  let travelled = 0;
  for (let i = 0; i < n; i += 1) {
    // the vertex i joins edge i-1 to edge i; it sits `travelled` along the lap (edge 0 starts at vertex 0)
    turns.push({ at: travelled / total, angle: wrap(heading(i) - heading((i + n - 1) % n)) });
    travelled += lengths[i]!;
  }
  return turns;
}

/** The cumulative turning function sampled at SAMPLES equally spaced lap fractions, with the cyclic start moved to fraction `shift`. */
function cumulative(turns: readonly Turn[], shift: number): Float64Array {
  const out = new Float64Array(SAMPLES);
  const shifted = turns.map((t) => ({ at: (((t.at - shift) % 1) + 1) % 1, angle: t.angle })).sort((a, b) => a.at - b.at);
  let sum = 0;
  let k = 0;
  for (let s = 0; s < SAMPLES; s += 1) {
    const x = (s + 0.5) / SAMPLES; // mid-bin, so a vertex sitting exactly on a bin edge cannot flip bins on rounding noise
    while (k < shifted.length && shifted[k]!.at <= x) {
      sum += shifted[k]!.angle;
      k += 1;
    }
    out[s] = sum;
  }
  return out;
}

/** The mean absolute gap between two cumulative functions after removing the best constant offset (the median of the differences). */
function gap(a: Float64Array, b: Float64Array): number {
  const diff = Float64Array.from(a, (v, i) => v - b[i]!).sort();
  const median = diff[SAMPLES >> 1]!;
  let sum = 0;
  for (let i = 0; i < SAMPLES; i += 1) sum += Math.abs(a[i]! - b[i]! - median);
  return sum / SAMPLES;
}

/** The turning measure of a track as a plain, comparable value. */
export function turningProfile(track: Track): readonly { readonly at: number; readonly angle: number }[] {
  return turningMeasure(centreLine(track));
}

/**
 * The shape distance between two circuits, in radians: 0 for the same centre-line shape however it is scaled, rotated, mirrored, reversed or
 * started. Larger means more different. Symmetric. Compares centre lines only (not road widths).
 */
export function layoutDistance(a: Track, b: Track): number {
  const ta = turningMeasure(centreLine(a));
  const tb = turningMeasure(centreLine(b));
  // B as it is, reversed (the order and the sign of every turn flip, and the lap fractions run backwards), negated (mirror image), and both
  const variants: Turn[][] = [
    tb,
    tb.map((t) => ({ at: (1 - t.at) % 1, angle: -t.angle })), // reversed traversal: the same road driven the other way round
    tb.map((t) => ({ at: t.at, angle: -t.angle })), // mirror image, same order
    tb.map((t) => ({ at: (1 - t.at) % 1, angle: t.angle })), // mirror image driven the other way round
  ];
  // The same turning total is needed to compare: a counter-clockwise lap sums to +2 pi, a clockwise one to -2 pi. Variants whose total does
  // not match A's are not the same way round and are skipped (a layout is never "similar" to the opposite orientation of itself).
  const totalA = ta.reduce((s, t) => s + t.angle, 0);
  let best = Infinity;
  const base = cumulative(ta, 0);
  for (const v of variants) {
    const total = v.reduce((s, t) => s + t.angle, 0);
    if (Math.abs(total - totalA) > 0.5) continue;
    // Every cyclic start of B: each vertex of B is tried as the start, which aligns B's copy of A's first vertex with A's first vertex.
    const starts = new Set<number>();
    for (const t of v) starts.add(t.at);
    for (const start of starts) {
      const d = gap(base, cumulative(v, start));
      if (d < best) best = d;
    }
  }
  return best;
}

/** True when two circuits have the same centre-line shape (see `layoutDistance`), whatever their scale, rotation, mirroring, direction or start. */
export function similarLayouts(a: Track, b: Track, threshold: number = SIMILARITY_THRESHOLD): boolean {
  return layoutDistance(a, b) < threshold;
}
