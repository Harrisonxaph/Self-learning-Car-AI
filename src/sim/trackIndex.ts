// A uniform-grid index over a track's boundary segments (P2-11 step 3; docs/plans/p2-11-plan.md). NOT YET USED by the simulation: step 4 wires it in.
//
// The index is an optimisation and nothing else. Every query here hands the EXACT existing per-segment routines (`raySegment`, `segmentNearConvex`, the even-odd
// crossing expression) only the segments that could change the answer, and takes the answer from them unchanged, so each result is the same IEEE-754 value
// (and the same boolean) as the brute-force function that tests every segment. That holds because every result is a minimum, an "any" or a parity count over
// segments, which does not depend on the order candidates are visited (the one place where order could show, the sign of a zero distance, is handled by
// breaking ties towards the lower segment number, which is the first one brute force meets).
//
// What it is not: it is derived from the track's geometry only; it is never stored in a model, a checkpoint, an experiment record, the manifest or any hash;
// it holds no randomness and no dependence on query order; it never changes the track. A built index is immutable. The only mutable state is a per-index
// scratch buffer (a stamp array, to list each candidate once), which results never depend on.
//
// The grid: the union of both boundaries' bounds, cut into square cells; each segment is registered in every cell its bounding box overlaps (conservative: an
// extra candidate is harmless, a missing one is not). The cell edge is a fixed multiple of the mean segment length, raised when needed so that the number of
// cells and of registrations stay under fixed caps (so building is bounded for any valid track). A coordinate maps to its cell with one monotone expression
// (floor of a division), so "the segment's box overlaps the query box" implies "their cell ranges overlap", with no rounding gap. The ray and point queries
// also widen their reach by INDEX_EPSILON, far above float error and far below a cell, for the cases the exact routines treat specially (an origin on a
// segment, a segment within LINE_TOLERANCE of a ray's line, a hit at exactly the range, a crossing that rounds a hair outside its segment's box).
import type { VehiclePhysics } from './config';
import { convexHull, MAX_SWEEP_ROTATION, segmentNearConvex, turnMargin, vehicleFootprint } from './collision';
import type { Pose, Track, Vec2 } from './track';
import { wrapAngle } from './vehicle';

/** How far queries reach beyond the exact geometry, m. Far above float error on any realistic track, far below a cell. */
export const INDEX_EPSILON = 1e-6;
/** The cell edge is this many mean segment lengths (before the floor and the caps). Chosen from measured candidate counts (docs/plans/p2-11-plan.md 4b). */
export const CELL_EDGE_FACTOR = 2;
/** The smallest cell edge, m. */
export const MIN_CELL_EDGE = 1;
/** The most cells a grid may have. */
export const MAX_CELLS = 262_144;
/** The most (segment, cell) registrations a grid may hold: bounds the build time and memory whatever the geometry. */
export const MAX_REGISTRATIONS = 4_000_000;
/** The most times the cell edge is doubled while sizing the grid. A finite edge reaches a single cell long before this (the doubles overflow a float after about 1,100). */
const MAX_COARSENINGS = 2048;

/** An immutable grid over a track's boundary segments. Built by `buildTrackIndex`, never changed. */
export interface TrackIndex {
  /** Segment k is from `segA[k]` to `segB[k]`: the outer boundary's segments first, then the inner's, each as in the brute-force loops (point i to point i+1, wrapping). */
  readonly segA: readonly Vec2[];
  readonly segB: readonly Vec2[];
  /** The number of outer-boundary segments: segments below this number are the outer boundary's. */
  readonly outerCount: number;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly cellEdge: number;
  readonly cols: number;
  readonly rows: number;
  /** Compressed rows: cell c holds `cellItems[cellStart[c] .. cellStart[c + 1])`, segment numbers in increasing order. Cell c = row * cols + column. */
  readonly cellStart: Int32Array;
  readonly cellItems: Int32Array;
}

export interface TrackIndexStats {
  readonly segments: number;
  readonly cells: number;
  readonly registrations: number;
  readonly cellEdge: number;
  readonly cols: number;
  readonly rows: number;
}

const finite = (p: Vec2): boolean => Number.isFinite(p.x) && Number.isFinite(p.y);

/** The cell column (or row) of a coordinate: monotone, clamped into the grid, NaN to 0. */
const cellOf = (v: number, min: number, edge: number, count: number): number => {
  const k = Math.floor((v - min) / edge);
  return k > 0 ? (k >= count ? count - 1 : k) : 0;
};

/**
 * Builds the grid for a track. Deterministic: it depends only on the geometry (and the factor, which only the measurement script varies). Throws RangeError for a
 * `cellEdgeFactor` that is not a finite number above 0, for a track whose extent or total segment length is too large to measure in floating point, and for a boundary point that is not finite (track data is
 * validated before it gets here; `loadTrack` already refuses such points).
 */
export function buildTrackIndex(track: Track, cellEdgeFactor: number = CELL_EDGE_FACTOR): TrackIndex {
  if (typeof cellEdgeFactor !== 'number' || !Number.isFinite(cellEdgeFactor) || !(cellEdgeFactor > 0)) {
    throw new RangeError(`The index's "cellEdgeFactor" must be a finite number above 0, got ${String(cellEdgeFactor)}.`);
  }
  const segA: Vec2[] = [];
  const segB: Vec2[] = [];
  for (const loop of [track.outer, track.inner]) {
    for (let i = 0; i < loop.length; i += 1) {
      const a = loop[i]!;
      const b = loop[(i + 1) % loop.length]!;
      if (!finite(a) || !finite(b)) throw new RangeError(`Cannot index a track with a non-finite boundary point (track "${track.id}").`);
      segA.push(a);
      segB.push(b);
    }
  }
  const segCount = segA.length;
  const outerCount = track.outer.length;
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  let totalLength = 0;
  for (let k = 0; k < segCount; k += 1) {
    const a = segA[k]!;
    const b = segB[k]!;
    if (k === 0) {
      minX = Math.min(a.x, b.x);
      maxX = Math.max(a.x, b.x);
      minY = Math.min(a.y, b.y);
      maxY = Math.max(a.y, b.y);
    } else {
      minX = Math.min(minX, a.x, b.x);
      maxX = Math.max(maxX, a.x, b.x);
      minY = Math.min(minY, a.y, b.y);
      maxY = Math.max(maxY, a.y, b.y);
    }
    totalLength += Math.hypot(b.x - a.x, b.y - a.y);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(totalLength)) {
    throw new RangeError(`Cannot index a track whose extent is too large to measure (track "${track.id}").`);
  }
  const meanLength = segCount > 0 ? totalLength / segCount : 0;
  let cellEdge = Math.max(MIN_CELL_EDGE, cellEdgeFactor * meanLength);
  const registrationsFor = (edge: number, columns: number, rowCount: number): number => {
    let total = 0;
    for (let k = 0; k < segCount; k += 1) {
      const a = segA[k]!;
      const b = segB[k]!;
      const c0 = cellOf(Math.min(a.x, b.x), minX, edge, columns);
      const c1 = cellOf(Math.max(a.x, b.x), minX, edge, columns);
      const r0 = cellOf(Math.min(a.y, b.y), minY, edge, rowCount);
      const r1 = cellOf(Math.max(a.y, b.y), minY, edge, rowCount);
      total += (c1 - c0 + 1) * (r1 - r0 + 1);
    }
    return total;
  };
  // Coarsen (double the edge) until both caps hold. Bounded by construction: it stops as soon as the grid is a single cell (nothing is coarser, and one cell
  // holds every segment once, so the registration cap cannot be met by going on), and a finite edge doubles to a single cell well inside the attempt limit.
  for (let attempt = 0; ; attempt += 1) {
    const columns = Math.floor(width / cellEdge) + 1;
    const rowCount = Math.floor(height / cellEdge) + 1;
    if (columns === 1 && rowCount === 1) break;
    if (columns * rowCount <= MAX_CELLS && registrationsFor(cellEdge, columns, rowCount) <= MAX_REGISTRATIONS) break;
    if (attempt >= MAX_COARSENINGS) throw new RangeError(`Cannot size an index grid for track "${track.id}".`);
    cellEdge *= 2;
  }
  const cols = Math.floor(width / cellEdge) + 1;
  const rows = Math.floor(height / cellEdge) + 1;
  const registrations = registrationsFor(cellEdge, cols, rows);
  const cells = cols * rows;
  const cellStart = new Int32Array(cells + 1);
  const eachCell = (visit: (cell: number, segment: number) => void): void => {
    for (let k = 0; k < segCount; k += 1) {
      const a = segA[k]!;
      const b = segB[k]!;
      const c0 = cellOf(Math.min(a.x, b.x), minX, cellEdge, cols);
      const c1 = cellOf(Math.max(a.x, b.x), minX, cellEdge, cols);
      const r0 = cellOf(Math.min(a.y, b.y), minY, cellEdge, rows);
      const r1 = cellOf(Math.max(a.y, b.y), minY, cellEdge, rows);
      for (let r = r0; r <= r1; r += 1) {
        for (let c = c0; c <= c1; c += 1) visit(r * cols + c, k);
      }
    }
  };
  eachCell((cell) => {
    cellStart[cell + 1] = (cellStart[cell + 1] as number) + 1;
  });
  for (let c = 0; c < cells; c += 1) cellStart[c + 1] = (cellStart[c + 1] as number) + (cellStart[c] as number);
  const next = cellStart.slice(0, cells);
  const cellItems = new Int32Array(registrations);
  eachCell((cell, segment) => {
    cellItems[next[cell] as number] = segment;
    next[cell] = (next[cell] as number) + 1;
  });
  return Object.freeze({ segA, segB, outerCount, minX, minY, maxX, maxY, cellEdge, cols, rows, cellStart, cellItems });
}

/** Counts about a built index, for the benchmark and the tests. */
export function trackIndexStats(index: TrackIndex): TrackIndexStats {
  return { segments: index.segA.length, cells: index.cols * index.rows, registrations: index.cellItems.length, cellEdge: index.cellEdge, cols: index.cols, rows: index.rows };
}

// A track is immutable once loaded and a custom track is a new object each load, so an index is cached by the track object.
const cache = new WeakMap<Track, TrackIndex>();
/** The index for a track, built on first use and kept for as long as the track object lives. */
export function trackIndexFor(track: Track): TrackIndex {
  let index = cache.get(track);
  if (index === undefined) {
    index = buildTrackIndex(track);
    cache.set(track, index);
  }
  return index;
}

// ---- Query scratch: candidate ids and the stamps that list each one once. Results never depend on it. ----
interface Scratch {
  readonly ids: Int32Array;
  readonly stamp: Uint32Array;
  mark: number;
}
const scratches = new WeakMap<TrackIndex, Scratch>();
function scratchOf(index: TrackIndex): Scratch {
  let s = scratches.get(index);
  if (s === undefined) {
    s = { ids: new Int32Array(index.segA.length), stamp: new Uint32Array(index.segA.length), mark: 0 };
    scratches.set(index, s);
  }
  return s;
}
function nextMark(s: Scratch): number {
  s.mark += 1;
  if (s.mark > 0xffff_fffe) {
    s.stamp.fill(0);
    s.mark = 1;
  }
  return s.mark;
}
/** Adds the segments of one cell, each once; returns the new count. */
function addCell(index: TrackIndex, s: Scratch, mark: number, cell: number, count: number): number {
  const end = index.cellStart[cell + 1] as number;
  for (let k = index.cellStart[cell] as number; k < end; k += 1) {
    const id = index.cellItems[k] as number;
    if (s.stamp[id] !== mark) {
      s.stamp[id] = mark;
      s.ids[count] = id;
      count += 1;
    }
  }
  return count;
}

/** Candidates for a ray: every segment in a cell the ray's INDEX_EPSILON neighbourhood touches, within the grid. Fills `s.ids`; returns the count. */
function collectRay(index: TrackIndex, s: Scratch, ox: number, oy: number, dx: number, dy: number, maxDistance: number): number {
  const pad = 4 * INDEX_EPSILON;
  // Clip the ray (parameter 0 to maxDistance) to the grid's bounds, widened a little: nothing outside them can be a segment.
  let t0 = 0;
  let t1 = maxDistance;
  for (let axis = 0; axis < 2; axis += 1) {
    const o = axis === 0 ? ox : oy;
    const d = axis === 0 ? dx : dy;
    const low = (axis === 0 ? index.minX : index.minY) - pad;
    const high = (axis === 0 ? index.maxX : index.maxY) + pad;
    if (d === 0) {
      if (o < low || o > high) return 0;
    } else {
      const ta = (low - o) / d;
      const tb = (high - o) / d;
      const near = ta < tb ? ta : tb;
      const far = ta < tb ? tb : ta;
      if (near > t0) t0 = near;
      if (far < t1) t1 = far;
    }
  }
  if (t0 > t1) return 0;
  const ax = ox + dx * t0;
  const ay = oy + dy * t0;
  const bx = ox + dx * t1;
  const by = oy + dy * t1;
  const mark = nextMark(s);
  let count = 0;
  const { cols, rows, cellEdge, minX, minY } = index;
  if (Math.abs(dx) >= Math.abs(dy)) {
    // x-major: for each column the ray crosses, the rows its widened y-range touches.
    const xmin = Math.min(ax, bx);
    const xmax = Math.max(ax, bx);
    const slope = dy / dx;
    const c0 = cellOf(xmin - INDEX_EPSILON, minX, cellEdge, cols);
    const c1 = cellOf(xmax + INDEX_EPSILON, minX, cellEdge, cols);
    for (let c = c0; c <= c1; c += 1) {
      const left = minX + c * cellEdge - INDEX_EPSILON;
      const right = minX + (c + 1) * cellEdge + INDEX_EPSILON;
      const xa = Math.min(Math.max(left, xmin), xmax);
      const xb = Math.min(Math.max(right, xmin), xmax);
      const ya = ay + (xa - ax) * slope;
      const yb = ay + (xb - ax) * slope;
      const r0 = cellOf(Math.min(ya, yb) - INDEX_EPSILON, minY, cellEdge, rows);
      const r1 = cellOf(Math.max(ya, yb) + INDEX_EPSILON, minY, cellEdge, rows);
      for (let r = r0; r <= r1; r += 1) count = addCell(index, s, mark, r * cols + c, count);
    }
  } else {
    // y-major: the same with the axes swapped.
    const ymin = Math.min(ay, by);
    const ymax = Math.max(ay, by);
    const slope = dx / dy;
    const r0 = cellOf(ymin - INDEX_EPSILON, minY, cellEdge, rows);
    const r1 = cellOf(ymax + INDEX_EPSILON, minY, cellEdge, rows);
    for (let r = r0; r <= r1; r += 1) {
      const top = minY + r * cellEdge - INDEX_EPSILON;
      const bottom = minY + (r + 1) * cellEdge + INDEX_EPSILON;
      const ya = Math.min(Math.max(top, ymin), ymax);
      const yb = Math.min(Math.max(bottom, ymin), ymax);
      const xa = ax + (ya - ay) * slope;
      const xb = ax + (yb - ay) * slope;
      const c0 = cellOf(Math.min(xa, xb) - INDEX_EPSILON, minX, cellEdge, cols);
      const c1 = cellOf(Math.max(xa, xb) + INDEX_EPSILON, minX, cellEdge, cols);
      for (let c = c0; c <= c1; c += 1) count = addCell(index, s, mark, r * cols + c, count);
    }
  }
  return count;
}

/** Candidates for a box: every segment in a cell the closed box touches. Returns -1 if the box has a NaN side (the caller then tests every segment). */
function collectBox(index: TrackIndex, s: Scratch, x0: number, y0: number, x1: number, y1: number): number {
  if (Number.isNaN(x0) || Number.isNaN(y0) || Number.isNaN(x1) || Number.isNaN(y1)) return -1;
  const { cols, rows, cellEdge, minX, minY } = index;
  const mark = nextMark(s);
  let count = 0;
  const c0 = cellOf(x0, minX, cellEdge, cols);
  const c1 = cellOf(x1, minX, cellEdge, cols);
  const r0 = cellOf(y0, minY, cellEdge, rows);
  const r1 = cellOf(y1, minY, cellEdge, rows);
  for (let r = r0; r <= r1; r += 1) {
    for (let c = c0; c <= c1; c += 1) count = addCell(index, s, mark, r * cols + c, count);
  }
  return count;
}

/** Candidates for the even-odd test at p: the segments in p's row from just left of p's column to the end of the row. Returns 0 when no edge can cross. */
function collectRow(index: TrackIndex, s: Scratch, px: number, py: number): number {
  if (Number.isNaN(px) || Number.isNaN(py)) return 0;
  // No edge straddles a y outside the grid's, and none reaches a point to the right of the grid's far edge.
  if (py < index.minY || py > index.maxY || px > index.maxX + INDEX_EPSILON) return 0;
  const { cols, rows, cellEdge, minX, minY } = index;
  const mark = nextMark(s);
  const r = cellOf(py, minY, cellEdge, rows);
  let count = 0;
  for (let c = cellOf(px - INDEX_EPSILON, minX, cellEdge, cols); c < cols; c += 1) count = addCell(index, s, mark, r * cols + c, count);
  return count;
}

// ---- Collision ----

/** The even-odd road test at p, as `pointOnRoad`, looking only at the edges that can cross. The crossing expression is the one in `inPolygon`, edge by edge. */
export function pointOnRoadIndexed(p: Vec2, index: TrackIndex): boolean {
  const s = scratchOf(index);
  const count = collectRow(index, s, p.x, p.y);
  let outer = false;
  let inner = false;
  for (let k = 0; k < count; k += 1) {
    const id = s.ids[k] as number;
    // `inPolygon` pairs point i with point i-1 as (a, b); segment id runs from point i-1 to point i, so a is its end and b its start.
    const a = index.segB[id]!;
    const b = index.segA[id]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      if (id < index.outerCount) outer = !outer;
      else inner = !inner;
    }
  }
  return outer && !inner;
}

/** As `shapeTouchesBoundary`, with only the segments whose bounding box meets the (widened) shape box tested. */
export function shapeTouchesBoundaryIndexed(points: readonly Vec2[], index: TrackIndex, margin = 0): boolean {
  const convex = convexHull(points);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of convex) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  minX -= margin;
  minY -= margin;
  maxX += margin;
  maxY += margin;
  const s = scratchOf(index);
  const count = collectBox(index, s, minX, minY, maxX, maxY);
  const total = count < 0 ? index.segA.length : count;
  for (let k = 0; k < total; k += 1) {
    const id = count < 0 ? k : (s.ids[k] as number);
    const a = index.segA[id]!;
    const b = index.segB[id]!;
    if (Math.max(a.x, b.x) < minX || Math.min(a.x, b.x) > maxX || Math.max(a.y, b.y) < minY || Math.min(a.y, b.y) > maxY) continue;
    if (segmentNearConvex(a, b, convex, margin)) return true;
  }
  return false;
}

/** As `footprintHitsTrack`. */
export function footprintHitsTrackIndexed(footprint: readonly Vec2[], index: TrackIndex): boolean {
  return shapeTouchesBoundaryIndexed(footprint, index) || !pointOnRoadIndexed(footprint[0]!, index);
}

/** As `sweepHitsTrack`: the same slices and margin, with the indexed boundary test. */
export function sweepHitsTrackIndexed(before: Pose, after: Pose, index: TrackIndex, physics: VehiclePhysics): boolean {
  const turn = wrapAngle(after.heading - before.heading);
  const slices = Math.max(1, Math.ceil(Math.abs(turn) / MAX_SWEEP_ROTATION));
  const margin = turnMargin(turn / slices, physics);
  let from = vehicleFootprint(before, physics);
  for (let i = 1; i <= slices; i += 1) {
    const t = i / slices;
    const pose: Pose =
      i === slices
        ? after
        : {
            position: {
              x: before.position.x + (after.position.x - before.position.x) * t,
              y: before.position.y + (after.position.y - before.position.y) * t,
            },
            heading: before.heading + turn * t,
          };
    const to = vehicleFootprint(pose, physics);
    if (shapeTouchesBoundaryIndexed([...from, ...to], index, margin)) return true;
    from = to;
  }
  return !pointOnRoadIndexed(from[0]!, index);
}

// ---- Ray candidates (used by sensors/rayIndex.ts, which may import sensors; this file may not) ----

/**
 * Lists the segments a ray could hit within `maxDistance`: every segment in a cell the ray's INDEX_EPSILON neighbourhood touches. The numbers are written to the
 * buffer `candidateBuffer(index)` and the count is returned; they stay valid until the next query on this index. The ray is origin (ox, oy), unit direction
 * (dx, dy), range `maxDistance` (finite, above 0: the caller has validated them).
 */
export function collectRayCandidates(index: TrackIndex, ox: number, oy: number, dx: number, dy: number, maxDistance: number): number {
  return collectRay(index, scratchOf(index), ox, oy, dx, dy, maxDistance);
}
/** The buffer `collectRayCandidates` writes to. Shared per index: read it before the next query. */
export function candidateBuffer(index: TrackIndex): Int32Array {
  return scratchOf(index).ids;
}

// ---- Candidate lists, for the tests and the measurement script (not used by the queries above) ----

/** The segment numbers a ray query would test, increasing. */
export function rayCandidateIds(index: TrackIndex, origin: Vec2, angle: number, maxDistance: number): number[] {
  const s = scratchOf(index);
  const count = collectRay(index, s, origin.x, origin.y, Math.cos(angle), Math.sin(angle), maxDistance);
  return Array.from(s.ids.subarray(0, count)).sort((a, b) => a - b);
}

/** The segment numbers a box query would test, increasing (every segment for a NaN box). */
export function boxCandidateIds(index: TrackIndex, x0: number, y0: number, x1: number, y1: number): number[] {
  const s = scratchOf(index);
  const count = collectBox(index, s, x0, y0, x1, y1);
  if (count < 0) return Array.from({ length: index.segA.length }, (_, k) => k);
  return Array.from(s.ids.subarray(0, count)).sort((a, b) => a - b);
}

/** The segment numbers the road test at p would test, increasing. */
export function pointCandidateIds(index: TrackIndex, p: Vec2): number[] {
  const s = scratchOf(index);
  const count = collectRow(index, s, p.x, p.y);
  return Array.from(s.ids.subarray(0, count)).sort((a, b) => a - b);
}
