// The track editor's state and operations (P4-02). Pure and headless: no DOM, no canvas, no storage. The page
// (src/ui/editorPage.ts) is a thin shell that turns pointer and keyboard input into these operations.
//
// A track is authored as a closed CENTRE LINE (control points) with a constant road width. buildTrack derives
// the outer and inner boundaries, the ordered gates and the start pose, in the one driving direction the engine
// credits (outer boundary on the car's right, counter-clockwise on screen), and evaluateEditor runs the P4-01
// validator on the result, so every message the user sees is the validator's own.
//
// Every operation returns a new state or a refusal with a plain-words message; nothing here throws on user input.
import { TRACK_FORMAT, TRACK_SCHEMA_VERSION, validateTrack } from '../sim/trackValidation';
import type { Track, Vec2 } from '../sim/track';

export const EDITOR_LIMITS = Object.freeze({
  minPoints: 3,
  maxPoints: 200,
  /** The working area is the square ±workArea m about the origin. */
  workArea: 150,
  minWidth: 8,
  maxWidth: 30,
  defaultWidth: 12,
  widthStep: 1,
  minGateSpacing: 15,
  maxGateSpacing: 60,
  defaultGateSpacing: 25,
  gateSpacingStep: 5,
  /** Control points closer than this are refused (they would make a degenerate spline). */
  minPointGap: 2,
  undoDepth: 100,
  /** The start sits this far (at least) behind gate 0, m. */
  startGap: 6,
  /** Centre-line sampling interval, m. */
  sampleStep: 5,
  maxNameLength: 80,
});

/** The grid choices the Snap control cycles through, m; 0 is off. */
export const SNAP_STEPS: readonly number[] = Object.freeze([0.5, 1, 5, 0]);

export interface EditorState {
  /** Control points of the centre line, in the order drawn. */
  readonly points: readonly Vec2[];
  /** True once the loop is closed; the track is built and validated only then. */
  readonly closed: boolean;
  /** Road width, m. */
  readonly width: number;
  /** Target distance between gates, m. */
  readonly gateSpacing: number;
  /** Where the car starts: metres along the centre line from the first control point, in the order drawn. */
  readonly startOffset: number;
  /** Grid snap step, m; 0 is off. */
  readonly snap: number;
  readonly name: string;
}

export type EditResult = { readonly ok: true; readonly state: EditorState } | { readonly ok: false; readonly message: string };

const ok = (state: EditorState): EditResult => ({ ok: true, state });
const refuse = (message: string): EditResult => ({ ok: false, message });

export function createEditorState(overrides: Partial<EditorState> = {}): EditorState {
  return {
    points: [],
    closed: false,
    width: EDITOR_LIMITS.defaultWidth,
    gateSpacing: EDITOR_LIMITS.defaultGateSpacing,
    startOffset: 0,
    snap: 1,
    name: 'My track',
    ...overrides,
  };
}

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

/** A point forced into the working area and onto the grid. Non-finite input becomes the origin. */
export function snapPoint(state: EditorState, p: Vec2): Vec2 {
  const area = EDITOR_LIMITS.workArea;
  const fix = (v: number): number => {
    const finite = Number.isFinite(v) ? v : 0;
    const snapped = state.snap > 0 ? Math.round(finite / state.snap) * state.snap : finite;
    // Round off float noise from the grid (0.1 steps and the like).
    return clamp(Math.round(snapped * 1000) / 1000, -area, area);
  };
  return { x: fix(p.x), y: fix(p.y) };
}

/** The index of the control point within `radius` m of p (the nearest), or -1. */
export function nearestPoint(state: EditorState, p: Vec2, radius: number): number {
  let best = -1;
  let bestDistance = radius;
  state.points.forEach((q, i) => {
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d <= bestDistance) {
      best = i;
      bestDistance = d;
    }
  });
  return best;
}

function tooClose(state: EditorState, p: Vec2, ignore = -1): boolean {
  return state.points.some((q, i) => i !== ignore && Math.hypot(q.x - p.x, q.y - p.y) < EDITOR_LIMITS.minPointGap);
}

const TOO_CLOSE = `That is too close to another point (at least ${EDITOR_LIMITS.minPointGap} m apart).`;

/** Adds a point to the open line. Refused once the loop is closed (use insertPoint) or at the point limit. */
export function addPoint(state: EditorState, at: Vec2): EditResult {
  if (state.closed) return refuse('The loop is closed. Use Insert point to add a point to it.');
  if (state.points.length >= EDITOR_LIMITS.maxPoints) return refuse(`A track can have at most ${EDITOR_LIMITS.maxPoints} points.`);
  const p = snapPoint(state, at);
  if (tooClose(state, p)) return refuse(TOO_CLOSE);
  return ok({ ...state, points: [...state.points, p] });
}

/** Closes the loop, joining the last point back to the first. */
export function closeLoop(state: EditorState): EditResult {
  if (state.closed) return refuse('The loop is already closed.');
  if (state.points.length < EDITOR_LIMITS.minPoints) {
    return refuse(`Add at least ${EDITOR_LIMITS.minPoints} points before closing the loop (there are ${state.points.length}).`);
  }
  return ok({ ...state, closed: true, startOffset: 0 });
}

/** Opens a closed loop again so points can be added at its end. */
export function reopenLoop(state: EditorState): EditResult {
  if (!state.closed) return refuse('The loop is not closed.');
  return ok({ ...state, closed: false });
}

/**
 * Inserts a point on the segment from point `after` to the next point (wrapping when closed). Without a
 * position it goes at the segment's midpoint.
 */
export function insertPoint(state: EditorState, after: number, at?: Vec2): EditResult {
  if (!state.closed) return refuse('Close the loop first; while drawing, tap to add points at the end.');
  if (!Number.isInteger(after) || after < 0 || after >= state.points.length) return refuse('Select a point first.');
  if (state.points.length >= EDITOR_LIMITS.maxPoints) return refuse(`A track can have at most ${EDITOR_LIMITS.maxPoints} points.`);
  const a = state.points[after]!;
  const b = state.points[(after + 1) % state.points.length]!;
  const p = snapPoint(state, at ?? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  if (tooClose(state, p)) return refuse(TOO_CLOSE);
  const points = [...state.points];
  points.splice(after + 1, 0, p);
  return ok({ ...state, points });
}

export function movePoint(state: EditorState, index: number, to: Vec2): EditResult {
  if (!Number.isInteger(index) || index < 0 || index >= state.points.length) return refuse('Select a point first.');
  const p = snapPoint(state, to);
  const current = state.points[index]!;
  if (p.x === current.x && p.y === current.y) return refuse('The point did not move.');
  if (tooClose(state, p, index)) return refuse(TOO_CLOSE);
  const points = [...state.points];
  points[index] = p;
  return ok({ ...state, points });
}

/** Moves a point by whole snap steps (the keyboard route: `steps` is the number of grid steps in x and y). */
export function nudgePoint(state: EditorState, index: number, stepsX: number, stepsY: number): EditResult {
  if (!Number.isInteger(index) || index < 0 || index >= state.points.length) return refuse('Select a point first.');
  const step = state.snap > 0 ? state.snap : 1;
  const current = state.points[index]!;
  return movePoint(state, index, { x: current.x + stepsX * step, y: current.y + stepsY * step });
}

export function deletePoint(state: EditorState, index: number): EditResult {
  if (!Number.isInteger(index) || index < 0 || index >= state.points.length) return refuse('Select a point first.');
  if (state.closed && state.points.length <= EDITOR_LIMITS.minPoints) {
    return refuse(`A closed track needs at least ${EDITOR_LIMITS.minPoints} points.`);
  }
  return ok({ ...state, points: state.points.filter((_, i) => i !== index), startOffset: state.closed ? 0 : state.startOffset });
}

export function setWidth(state: EditorState, width: number): EditResult {
  if (!Number.isFinite(width)) return refuse('The road width must be a number.');
  if (width < EDITOR_LIMITS.minWidth) return refuse(`The road is already at its narrowest (${EDITOR_LIMITS.minWidth} m).`);
  if (width > EDITOR_LIMITS.maxWidth) return refuse(`The road is already at its widest (${EDITOR_LIMITS.maxWidth} m).`);
  if (width === state.width) return refuse('The road width did not change.');
  return ok({ ...state, width });
}

export function setGateSpacing(state: EditorState, spacing: number): EditResult {
  if (!Number.isFinite(spacing)) return refuse('The gate spacing must be a number.');
  if (spacing < EDITOR_LIMITS.minGateSpacing) return refuse(`Gates are already as close as they go (${EDITOR_LIMITS.minGateSpacing} m).`);
  if (spacing > EDITOR_LIMITS.maxGateSpacing) return refuse(`Gates are already as far apart as they go (${EDITOR_LIMITS.maxGateSpacing} m).`);
  if (spacing === state.gateSpacing) return refuse('The gate spacing did not change.');
  return ok({ ...state, gateSpacing: spacing });
}

export function setName(state: EditorState, name: string): EditResult {
  const clean = [...name].filter((ch) => ch.charCodeAt(0) > 0x1f && ch.charCodeAt(0) !== 0x7f).join('').trim().slice(0, EDITOR_LIMITS.maxNameLength);
  if (clean.length === 0) return refuse('The track needs a name.');
  return ok({ ...state, name: clean });
}

/** The next grid step in SNAP_STEPS (0.5, 1, 5 m, then off, then 0.5 again). */
export function cycleSnap(state: EditorState): EditorState {
  const at = SNAP_STEPS.indexOf(state.snap);
  return { ...state, snap: SNAP_STEPS[(at + 1) % SNAP_STEPS.length]! };
}

/** Moves the start by `delta` m along the centre line (wrapping), or to an absolute position with setStart. */
export function moveStart(state: EditorState, delta: number): EditResult {
  if (!state.closed) return refuse('Close the loop before moving the start.');
  if (!Number.isFinite(delta) || delta === 0) return refuse('The start did not move.');
  const line = centreLine(state);
  if (line === null) return refuse('The start cannot be moved until the loop is a valid line.');
  return ok({ ...state, startOffset: wrap(state.startOffset + delta, line.length) });
}

export function setStart(state: EditorState, offset: number): EditResult {
  if (!state.closed) return refuse('Close the loop before moving the start.');
  const line = centreLine(state);
  if (line === null || !Number.isFinite(offset)) return refuse('The start cannot be placed there.');
  return ok({ ...state, startOffset: wrap(offset, line.length) });
}

function wrap(value: number, length: number): number {
  const w = value % length;
  return Math.round((w < 0 ? w + length : w) * 1000) / 1000;
}

// ---------------------------------------------------------------------------------------------------------------
// Undo and redo: a bounded history of states. Operations are applied through `apply` so a refusal never pushes.

export interface EditorHistory {
  readonly past: readonly EditorState[];
  readonly present: EditorState;
  readonly future: readonly EditorState[];
}

export function createHistory(present: EditorState = createEditorState()): EditorHistory {
  return { past: [], present, future: [] };
}

/** Pushes a new state (clearing redo), keeping at most EDITOR_LIMITS.undoDepth undo steps. */
export function commit(history: EditorHistory, next: EditorState): EditorHistory {
  if (next === history.present) return history;
  const past = [...history.past, history.present].slice(-EDITOR_LIMITS.undoDepth);
  return { past, present: next, future: [] };
}

export function undo(history: EditorHistory): EditorHistory {
  const previous = history.past[history.past.length - 1];
  if (previous === undefined) return history;
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] };
}

export function redo(history: EditorHistory): EditorHistory {
  const [next, ...rest] = history.future;
  if (next === undefined) return history;
  return { past: [...history.past, history.present], present: next, future: rest };
}

/** Applies an operation's result to the history; a refusal leaves the history alone and carries its message. */
export function apply(history: EditorHistory, result: EditResult): { readonly history: EditorHistory; readonly message: string | null } {
  if (!result.ok) return { history, message: result.message };
  return { history: commit(history, result.state), message: null };
}

// ---------------------------------------------------------------------------------------------------------------
// Geometry: the centre line, and the track derived from it.

interface CentreLine {
  /** Samples along the closed centre line, in the order drawn, evenly spaced by arc length. */
  readonly samples: readonly Vec2[];
  readonly length: number;
  readonly step: number;
}

/** Centripetal Catmull-Rom point between p1 and p2 (Barry-Goldman), t in [0, 1]. Control points are at least minPointGap apart. */
function catmullRom(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, u: number): Vec2 {
  const knot = (a: Vec2, b: Vec2): number => Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y));
  const t0 = 0;
  const t1 = t0 + knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const t = t1 + u * (t2 - t1);
  const a1 = mixAcross(p0, p1, t0, t1, t);
  const a2 = mixAcross(p1, p2, t1, t2, t);
  const a3 = mixAcross(p2, p3, t2, t3, t);
  const b1 = mixAcross(a1, a2, t0, t2, t);
  const b2 = mixAcross(a2, a3, t1, t3, t);
  return mixAcross(b1, b2, t1, t2, t);
}

function mixAcross(a: Vec2, b: Vec2, ta: number, tb: number, t: number): Vec2 {
  const f = tb === ta ? 0 : (t - ta) / (tb - ta);
  return { x: a.x * (1 - f) + b.x * f, y: a.y * (1 - f) + b.y * f };
}

/** The closed spline through the control points, resampled evenly by arc length; null unless closed with enough points. */
function centreLine(state: EditorState): CentreLine | null {
  const pts = state.points;
  const n = pts.length;
  if (!state.closed || n < EDITOR_LIMITS.minPoints) return null;
  const dense: Vec2[] = [];
  for (let i = 0; i < n; i += 1) {
    const p0 = pts[(i + n - 1) % n]!;
    const p1 = pts[i]!;
    const p2 = pts[(i + 1) % n]!;
    const p3 = pts[(i + 2) % n]!;
    const chord = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const parts = Math.max(8, Math.ceil(chord / 0.5));
    for (let k = 0; k < parts; k += 1) dense.push(catmullRom(p0, p1, p2, p3, k / parts));
  }
  const cumulative = [0];
  for (let i = 1; i <= dense.length; i += 1) {
    const a = dense[i - 1]!;
    const b = dense[i % dense.length]!;
    cumulative.push(cumulative[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const length = cumulative[dense.length]!;
  if (!(length > 0) || !Number.isFinite(length)) return null;
  const count = Math.max(8, Math.round(length / EDITOR_LIMITS.sampleStep));
  const step = length / count;
  const samples: Vec2[] = [];
  let segment = 0;
  for (let i = 0; i < count; i += 1) {
    const target = i * step;
    while (segment < dense.length - 1 && cumulative[segment + 1]! < target) segment += 1;
    const a = dense[segment]!;
    const b = dense[(segment + 1) % dense.length]!;
    const span = cumulative[segment + 1]! - cumulative[segment]!;
    const f = span > 0 ? (target - cumulative[segment]!) / span : 0;
    samples.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
  }
  return { samples, length, step };
}

/** The centre line's total length in metres, or null when the loop is not closed. */
export function centreLength(state: EditorState): number | null {
  return centreLine(state)?.length ?? null;
}

/** The smooth centre line (for drawing the guide under the control points), or an empty list. */
export function centreSamples(state: EditorState): readonly Vec2[] {
  return centreLine(state)?.samples ?? [];
}

export interface BuiltTrack {
  /** The track document: ordinary track data that validateTrack and loadTrack accept. */
  readonly document: Record<string, unknown>;
  /** True when the loop was drawn clockwise and has been reversed so cars drive counter-clockwise. */
  readonly reversed: boolean;
  readonly gateCount: number;
  readonly length: number;
}

/** Deterministic short id from the geometry-defining state, so the same drawing always has the same id. */
function fingerprint(state: EditorState): string {
  const text = JSON.stringify([state.points.map((p) => [p.x, p.y]), state.width, state.gateSpacing, state.startOffset]);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Derives the track document from a closed loop. Returns a message instead when it cannot (open loop, too many
 * gates). The document may still be invalid in the validator's sense (a corner too tight, two parts too close):
 * evaluateEditor reports that.
 */
export function buildTrack(state: EditorState): BuiltTrack | { readonly message: string } {
  const line = centreLine(state);
  if (line === null) return { message: 'Close the loop to build a track.' };
  let samples = [...line.samples];
  // Counter-clockwise on screen is a negative shoelace sum in these y-down coordinates; reverse a clockwise drawing.
  let area = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const a = samples[i]!;
    const b = samples[(i + 1) % samples.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  const reversed = area > 0;
  let start = state.startOffset % line.length;
  if (reversed) {
    samples = [samples[0]!, ...samples.slice(1).reverse()];
    start = wrap(line.length - start, line.length);
  }
  const n = samples.length;
  const h = line.length / n;
  const half = state.width / 2;
  const outer: Vec2[] = [];
  const inner: Vec2[] = [];
  const normal: Vec2[] = [];
  for (let i = 0; i < n; i += 1) {
    const prev = samples[(i + n - 1) % n]!;
    const next = samples[(i + 1) % n]!;
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const length = Math.hypot(tx, ty) || 1;
    tx /= length;
    ty /= length;
    // The right of the direction of travel on a y-down screen is (-ty, tx); the outer boundary is on the right.
    const r = { x: -ty, y: tx };
    normal.push(r);
    const c = samples[i]!;
    outer.push({ x: c.x + r.x * half, y: c.y + r.y * half });
    inner.push({ x: c.x - r.x * half, y: c.y - r.y * half });
  }
  const gateTotal = Math.max(3, Math.floor(line.length / state.gateSpacing));
  if (gateTotal > 200) return { message: 'This track would need more than 200 gates; widen the gate spacing.' };
  const first = Math.ceil((start + EDITOR_LIMITS.startGap) / h - 1e-9);
  const gates: { a: Vec2; b: Vec2 }[] = [];
  const used = new Set<number>();
  for (let j = 0; j < gateTotal; j += 1) {
    const index = (first + Math.round((j * n) / gateTotal)) % n;
    if (used.has(index)) continue;
    used.add(index);
    gates.push({ a: inner[index]!, b: outer[index]! });
  }
  const at = pointAlong(samples, h, start);
  const tangent = tangentAlong(samples, h, start);
  const document = {
    format: TRACK_FORMAT,
    schemaVersion: TRACK_SCHEMA_VERSION,
    id: `custom-${fingerprint(state)}`,
    version: '1',
    name: state.name,
    outer,
    inner,
    start: { position: at, heading: Math.atan2(tangent.y, tangent.x) },
    gates,
  };
  return { document, reversed, gateCount: gates.length, length: line.length };
}

function pointAlong(samples: readonly Vec2[], step: number, distance: number): Vec2 {
  const n = samples.length;
  const position = distance / step;
  const i = Math.floor(position) % n;
  const f = position - Math.floor(position);
  const a = samples[i]!;
  const b = samples[(i + 1) % n]!;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

function tangentAlong(samples: readonly Vec2[], step: number, distance: number): Vec2 {
  const n = samples.length;
  const i = Math.floor(distance / step) % n;
  const a = samples[i]!;
  const b = samples[(i + 1) % n]!;
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
}

// ---------------------------------------------------------------------------------------------------------------
// Live evaluation.

export type EditorStatus =
  | { readonly kind: 'draft'; readonly message: string }
  | { readonly kind: 'invalid'; readonly message: string; readonly problems: readonly string[] }
  | { readonly kind: 'valid'; readonly message: string; readonly track: Track; readonly warnings: readonly string[]; readonly reversed: boolean };

/** Builds the track and validates it. Never throws. */
export function evaluateEditor(state: EditorState): EditorStatus {
  if (!state.closed) {
    const n = state.points.length;
    const message =
      n === 0
        ? 'Tap the canvas to add the first point.'
        : n < EDITOR_LIMITS.minPoints
          ? `${n} point${n === 1 ? '' : 's'} so far; add at least ${EDITOR_LIMITS.minPoints}, then close the loop.`
          : `${n} points so far; close the loop to build the track.`;
    return { kind: 'draft', message };
  }
  const built = buildTrack(state);
  if ('message' in built) return { kind: 'invalid', message: built.message, problems: [built.message] };
  const result = validateTrack(built.document);
  if (result.ok) {
    const note = built.reversed ? ' You drew it clockwise, so it was reversed: cars drive counter-clockwise.' : '';
    return { kind: 'valid', message: `Valid: ready to drive (${built.gateCount} gates, ${Math.round(built.length)} m).${note}`, track: result.track, warnings: result.warnings, reversed: built.reversed };
  }
  const problems = result.errors.map((e) => e.message);
  const more = problems.length - 1;
  return {
    kind: 'invalid',
    message: `${problems[0]}${more > 0 ? ` (and ${more} more problem${more === 1 ? '' : 's'})` : ''}`,
    problems,
  };
}
