// Track validation (P4-01): is this track data a closed, drivable circuit? Headless, pure and deterministic: it reads
// the data and returns a result, so a refusal has no side effect. docs/TRACK_FORMAT.md describes the format and every
// rule below.
//
// `loadTrack` (track.ts) checks only the SHAPE and stays as it is, because the content hashes of the built-in tracks
// are computed from its output. This module checks the GEOMETRY and reports every problem it finds (not only the
// first), each as a stable rule id and one readable sentence that says what to change. It never throws, whatever it
// is given. A pass means "well-formed and drivable by these rules", not that a track is good for training.
import { footprintHitsTrack, segmentsTouch, vehicleFootprint } from './collision';
import { DEFAULT_VEHICLE_PHYSICS, type VehiclePhysics } from './config';
import { loadTrack, TrackFormatError, type Track, type Vec2 } from './track';

export const TRACK_FORMAT = 'self-driving-ai-evolution/track';
export const TRACK_SCHEMA_VERSION = 1;
export const TRACK_SPLIT_LABELS = Object.freeze(['training', 'validation', 'held-out'] as const);

/** The limits the rules use. The size caps are checked before any pairwise work, so hostile input is cheap to refuse. */
export const TRACK_LIMITS = Object.freeze({
  maxPoints: 2000,
  maxGates: 200,
  maxCoordinate: 10_000,
  maxIdLength: 64,
  maxVersionLength: 64,
  maxNameLength: 80,
  /** Shortest boundary edge, m. */
  minSegmentLength: 0.01,
  /** A boundary edge shorter than this is only a warning, m. */
  warnSegmentLength: 0.1,
  /** How far a gate's end may be from its boundary, m. */
  gateTolerance: 1e-6,
  /** The start heading may differ from the driving direction at gate 0 by at most this, rad. */
  maxStartAngle: Math.PI / 4,
  /** A longer distance between neighbouring gates is only a warning, m. */
  warnGateGap: 60,
  /** Errors listed before "and N more". */
  maxErrors: 20,
});

export type TrackRule =
  | 'shape'
  | 'identity'
  | 'size'
  | 'degenerate'
  | 'boundary-simple'
  | 'boundaries-apart'
  | 'inner-inside-outer'
  | 'road-width'
  | 'start-on-road'
  | 'gate-count'
  | 'gate-spans-road'
  | 'gates-apart'
  | 'gate-order'
  | 'start-heading';

export interface TrackIssue {
  readonly rule: TrackRule;
  readonly message: string;
}

export interface TrackValidationOptions {
  /** The vehicle the start pose and road width are checked against. Default: the default vehicle. */
  readonly physics?: VehiclePhysics;
  /** The smallest allowed road width, m. Default: twice the vehicle's width. */
  readonly minRoadWidth?: number;
}

export type TrackValidation =
  | { readonly ok: true; readonly track: Track; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly errors: readonly TrackIssue[]; readonly skipped: readonly TrackRule[] };

/** The result of validating a track: every error found and the geometry rules that could not run because of them. */
const REFUSED_UNCHECKED: TrackValidation = Object.freeze({
  ok: false,
  errors: Object.freeze([{ rule: 'shape', message: 'This track could not be checked.' } as TrackIssue]),
  skipped: Object.freeze([] as TrackRule[]),
});

export function validateTrack(data: unknown, options: TrackValidationOptions = {}): TrackValidation {
  try {
    return validate(data, options);
  } catch {
    return REFUSED_UNCHECKED;
  }
}

/** The validated Track, or a TrackFormatError whose message lists every problem. */
export function loadValidatedTrack(data: unknown, options: TrackValidationOptions = {}): Track {
  const result = validateTrack(data, options);
  if (result.ok) return result.track;
  throw new TrackFormatError(describeTrackErrors(result.errors));
}

/** The errors as one message: each sentence on its own line, with a count of any beyond the cap. */
export function describeTrackErrors(errors: readonly TrackIssue[]): string {
  const shown = errors.slice(0, TRACK_LIMITS.maxErrors).map((e) => e.message);
  const more = errors.length - shown.length;
  return `Invalid track: ${shown.join(' ')}${more > 0 ? ` (and ${more} more problem${more === 1 ? '' : 's'})` : ''}`;
}

const fmt = (n: number): string => String(Math.round(n * 1000) / 1000);
const at = (p: Vec2): string => `(${fmt(p.x)}, ${fmt(p.y)})`;
const GEOMETRY_RULES: readonly TrackRule[] = ['degenerate', 'boundary-simple', 'boundaries-apart', 'inner-inside-outer'];

function validate(data: unknown, options: TrackValidationOptions): TrackValidation {
  const errors: TrackIssue[] = [];
  const skipped: TrackRule[] = [];
  const fail = (rule: TrackRule, message: string): void => {
    errors.push({ rule, message });
  };
  const physics = options.physics ?? DEFAULT_VEHICLE_PHYSICS;
  const minRoadWidth =
    typeof options.minRoadWidth === 'number' && Number.isFinite(options.minRoadWidth) && options.minRoadWidth > 0
      ? options.minRoadWidth
      : 2 * physics.vehicleWidth;

  // Rule 1: shape, and the optional format fields.
  const document = typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  const label = document?.split;
  if (document !== null) {
    if (document.format !== undefined && document.format !== TRACK_FORMAT) {
      fail('shape', `"format" must be "${TRACK_FORMAT}" when present.`);
    }
    if (document.schemaVersion !== undefined && document.schemaVersion !== TRACK_SCHEMA_VERSION) {
      fail('shape', `This app reads track schema version ${TRACK_SCHEMA_VERSION}, but the file says ${String(document.schemaVersion)}.`);
    }
    if (label !== undefined && !(TRACK_SPLIT_LABELS as readonly unknown[]).includes(label)) {
      fail('shape', `"split" must be one of ${TRACK_SPLIT_LABELS.join(', ')} when present.`);
    }
  }
  let track: Track;
  try {
    track = loadTrack(data);
  } catch (error) {
    const message = error instanceof TrackFormatError ? error.message : 'The track could not be read.';
    const rule: TrackRule = message.includes('gates must be an array of at least')
      ? 'gate-count'
      : message.includes('outer must be an array of at least') || message.includes('inner must be an array of at least')
        ? 'size'
        : 'shape';
    fail(rule, message.startsWith('Invalid track: ') ? `${message.slice('Invalid track: '.length)}` : message);
    return { ok: false, errors, skipped };
  }

  // Rule 2: identity.
  const L = TRACK_LIMITS;
  if (!/^[a-z0-9-]{1,64}$/.test(track.id)) fail('identity', `The id "${clip(track.id)}" must be 1 to ${L.maxIdLength} characters: lower-case letters, digits and hyphens.`);
  if (track.version.length > L.maxVersionLength) fail('identity', `The version is longer than ${L.maxVersionLength} characters.`);
  if (track.name.length > L.maxNameLength) fail('identity', `The name is longer than ${L.maxNameLength} characters.`);

  // Rule 3: size. Nothing quadratic runs unless every cap holds.
  let sizeOk = true;
  for (const [name, points] of [['outer', track.outer], ['inner', track.inner]] as const) {
    if (points.length > L.maxPoints) {
      fail('size', `The ${name} boundary has ${points.length} points; the limit is ${L.maxPoints}.`);
      sizeOk = false;
    }
  }
  if (track.gates.length > L.maxGates) {
    fail('size', `There are ${track.gates.length} gates; the limit is ${L.maxGates}.`);
    sizeOk = false;
  }
  const everyPoint = [...track.outer, ...track.inner, track.start.position, ...track.gates.flatMap((g) => [g.a, g.b])];
  const far = everyPoint.find((p) => Math.abs(p.x) > L.maxCoordinate || Math.abs(p.y) > L.maxCoordinate);
  if (far !== undefined) {
    fail('size', `The point ${at(far)} is outside the allowed range of ±${L.maxCoordinate} m.`);
    sizeOk = false;
  }
  if (!sizeOk) return { ok: false, errors, skipped: [] };

  const warnings: string[] = [];

  // Rule 4: degenerate edges.
  for (const [name, points] of [['outer', track.outer], ['inner', track.inner]] as const) {
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i]!;
      const b = points[(i + 1) % points.length]!;
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length < L.minSegmentLength) {
        fail('degenerate', `The ${name} boundary has an edge from point ${i} ${at(a)} to point ${(i + 1) % points.length} ${at(b)} that is shorter than ${L.minSegmentLength} m; remove or move one of the two points.`);
      } else if (length < L.warnSegmentLength) {
        warnings.push(`The ${name} boundary edge from point ${i} is very short (${fmt(length)} m).`);
      }
    }
  }

  // Rule 5: each boundary is a simple closed polygon.
  checkSimple('outer', track.outer, fail);
  checkSimple('inner', track.inner, fail);

  // Rule 6: the boundaries do not touch each other.
  let touches = 0;
  outerLoop: for (let i = 0; i < track.outer.length; i += 1) {
    const a = track.outer[i]!;
    const b = track.outer[(i + 1) % track.outer.length]!;
    for (let j = 0; j < track.inner.length; j += 1) {
      const c = track.inner[j]!;
      const d = track.inner[(j + 1) % track.inner.length]!;
      if (boxesApart(a, b, c, d) || !segmentsTouch(a, b, c, d)) continue;
      fail('boundaries-apart', `The outer edge from point ${i} ${at(a)} touches the inner edge from point ${j} ${at(c)}; the boundaries must not meet. Move one of them.`);
      touches += 1;
      if (touches >= 3) break outerLoop;
    }
  }

  // Rule 7: the inner boundary lies inside the outer one. Only meaningful once nothing touches.
  const wallsOk = !errors.some((e) => GEOMETRY_RULES.includes(e.rule));
  if (wallsOk && !insidePolygon(track.outer, track.inner[0]!)) {
    fail('inner-inside-outer', `The inner boundary is not inside the outer boundary (its first point ${at(track.inner[0]!)} is outside). Swap the two boundaries or move the inner one inside.`);
  }
  const geometryOk = !errors.some((e) => GEOMETRY_RULES.includes(e.rule));

  // Rules 12 and 10 do not need the walls: gates apart from each other.
  checkGatesApart(track, fail);

  if (!geometryOk) {
    skipped.push('road-width', 'start-on-road', 'gate-spans-road', 'gate-order', 'start-heading');
  } else {
    // Rule 8: road width.
    const narrowest = narrowestRoad(track);
    if (narrowest.width < minRoadWidth) {
      fail('road-width', `The road is only ${fmt(narrowest.width)} m wide near ${at(narrowest.at)}; it must be at least ${fmt(minRoadWidth)} m${options.minRoadWidth === undefined ? " (twice the car's width)" : ''}. Move the boundaries apart there.`);
    }
    // Rule 9: the start is on the road.
    const start = track.start.position;
    if (!insidePolygon(track.outer, start) || insidePolygon(track.inner, start)) {
      fail('start-on-road', `The start position ${at(start)} is not on the road (it must be inside the outer boundary and outside the inner one).`);
    } else if (footprintHitsTrack(vehicleFootprint(track.start, physics), track)) {
      fail('start-on-road', `The car's body at the start ${at(start)} touches a boundary or leaves the road. Move the start away from the walls or turn it to face along the road.`);
    }
    // Rules 11, 13 and 14: the gates.
    const located = checkGates(track, fail);
    if (located !== null) {
      const listed = checkGateOrder(located, track.outer.length, fail);
      if (listed !== 0) checkGateDirection(track, listed, fail);
      checkStartHeading(track, fail);
    } else {
      skipped.push('gate-order', 'start-heading');
    }
  }

  for (let i = 0; i + 1 <= track.gates.length; i += 1) {
    const g = track.gates[i]!;
    const h = track.gates[(i + 1) % track.gates.length]!;
    const gap = Math.hypot((g.a.x + g.b.x) / 2 - (h.a.x + h.b.x) / 2, (g.a.y + g.b.y) / 2 - (h.a.y + h.b.y) / 2);
    if (gap > L.warnGateGap) warnings.push(`Gates ${i} and ${(i + 1) % track.gates.length} are ${fmt(gap)} m apart; a car could cut a corner between them.`);
  }

  if (errors.length > 0) return { ok: false, errors, skipped };
  return { ok: true, track, warnings };
}

const clip = (text: string): string => (text.length > 40 ? `${text.slice(0, 40)}…` : text);

function boxesApart(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  return (
    Math.max(a.x, b.x) < Math.min(c.x, d.x) ||
    Math.max(c.x, d.x) < Math.min(a.x, b.x) ||
    Math.max(a.y, b.y) < Math.min(c.y, d.y) ||
    Math.max(c.y, d.y) < Math.min(a.y, b.y)
  );
}

/** Even-odd test for a point that is not on the polygon's edges (the walls rules have already excluded contact). */
function insidePolygon(polygon: readonly Vec2[], p: Vec2): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function checkSimple(name: string, points: readonly Vec2[], fail: (rule: TrackRule, message: string) => void): void {
  const n = points.length;
  let found = 0;
  for (let i = 0; i < n && found < 3; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % n]!;
    for (let j = i + 1; j < n && found < 3; j += 1) {
      const c = points[j]!;
      const d = points[(j + 1) % n]!;
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      let bad: boolean;
      if (adjacent) {
        // Neighbouring edges share one point; they must not fold back over each other.
        const [shared, p, q] = j === i + 1 ? [b, a, d] : [a, b, c];
        const cross = (shared.x - p.x) * (q.y - shared.y) - (shared.y - p.y) * (q.x - shared.x);
        const dot = (shared.x - p.x) * (q.x - shared.x) + (shared.y - p.y) * (q.y - shared.y);
        const scale = Math.hypot(shared.x - p.x, shared.y - p.y) * Math.hypot(q.x - shared.x, q.y - shared.y);
        bad = Math.abs(cross) <= 1e-9 * scale && dot < 0;
      } else {
        bad = !boxesApart(a, b, c, d) && segmentsTouch(a, b, c, d);
      }
      if (bad) {
        found += 1;
        fail('boundary-simple', `The ${name} boundary crosses or touches itself: the edge from point ${i} ${at(a)} meets the edge from point ${j} ${at(c)}. Move a point so the edges do not touch.`);
      }
    }
  }
}

function narrowestRoad(track: Track): { width: number; at: Vec2 } {
  let width = Infinity;
  let where: Vec2 = track.outer[0]!;
  const scan = (points: readonly Vec2[], other: readonly Vec2[]): void => {
    for (const p of points) {
      for (let j = 0; j < other.length; j += 1) {
        const d = pointSegmentDistance(p, other[j]!, other[(j + 1) % other.length]!);
        if (d < width) {
          width = d;
          where = p;
        }
      }
    }
  };
  scan(track.inner, track.outer);
  scan(track.outer, track.inner);
  return { width, at: where };
}

function checkGatesApart(track: Track, fail: (rule: TrackRule, message: string) => void): void {
  const gates = track.gates;
  let found = 0;
  for (let i = 0; i < gates.length && found < 3; i += 1) {
    for (let j = i + 1; j < gates.length && found < 3; j += 1) {
      if (segmentsTouch(gates[i]!.a, gates[i]!.b, gates[j]!.a, gates[j]!.b)) {
        found += 1;
        fail('gates-apart', `Gates ${i} and ${j} touch each other; gates must be separate lines across the road.`);
      }
    }
  }
}

/** Where a point lies on a closed polyline: the index of its edge plus the fraction along it, or null if it is off the line. */
function positionOn(points: readonly Vec2[], p: Vec2): { s: number; distance: number } {
  let best = { s: 0, distance: Infinity };
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const d = pointSegmentDistance(p, a, b);
    if (d < best.distance) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      best = { s: i + t, distance: d };
    }
  }
  return best;
}

/** Rule 11. Returns each gate's position along the outer boundary, or null if any gate failed. */
function checkGates(track: Track, fail: (rule: TrackRule, message: string) => void): number[] | null {
  const positions: number[] = [];
  let ok = true;
  const tolerance = TRACK_LIMITS.gateTolerance;
  track.gates.forEach((gate, k) => {
    const onInner = positionOn(track.inner, gate.a);
    const onOuter = positionOn(track.outer, gate.b);
    let gateOk = true;
    if (onInner.distance > tolerance) {
      fail('gate-spans-road', `Gate ${k}: its inner end ${at(gate.a)} is ${fmt(onInner.distance)} m from the inner boundary; it must lie on it, so the gate spans the whole road.`);
      gateOk = false;
    }
    if (onOuter.distance > tolerance) {
      fail('gate-spans-road', `Gate ${k}: its outer end ${at(gate.b)} is ${fmt(onOuter.distance)} m from the outer boundary; it must lie on it, so the gate spans the whole road.`);
      gateOk = false;
    }
    if (gateOk) {
      // Shorten the gate a little at both ends, so touching its own two boundary edges is allowed but nothing else is.
      const dx = gate.b.x - gate.a.x;
      const dy = gate.b.y - gate.a.y;
      const length = Math.hypot(dx, dy);
      if (length === 0) {
        fail('gate-spans-road', `Gate ${k} has no length.`);
        gateOk = false;
      } else {
        const trim = Math.min(1e-4, length / 4) / length;
        const p = { x: gate.a.x + dx * trim, y: gate.a.y + dy * trim };
        const q = { x: gate.b.x - dx * trim, y: gate.b.y - dy * trim };
        for (const [name, points] of [['outer', track.outer], ['inner', track.inner]] as const) {
          for (let i = 0; i < points.length && gateOk; i += 1) {
            const c = points[i]!;
            const d = points[(i + 1) % points.length]!;
            if (!boxesApart(p, q, c, d) && segmentsTouch(p, q, c, d)) {
              fail('gate-spans-road', `Gate ${k} crosses the ${name} boundary between its ends (at the edge from point ${i} ${at(c)}); it must cross only the road.`);
              gateOk = false;
            }
          }
        }
      }
    }
    if (gateOk) positions.push(onOuter.s);
    else ok = false;
  });
  return ok ? positions : null;
}

/** Rule 13. The gates' positions along the outer boundary must run one way round the loop, once, in the listed order. */
/** Returns +1 or -1 for the direction (by increasing outer-boundary index) the gates are listed in, or 0 after reporting an order error. */
function checkGateOrder(positions: readonly number[], n: number, fail: (rule: TrackRule, message: string) => void): 1 | -1 | 0 {
  const step = (from: number, to: number, direction: 1 | -1): number => (((direction * (to - from)) % n) + n) % n;
  const attempt = (direction: 1 | -1): { sum: number; bad: number } => {
    let sum = 0;
    let bad = -1;
    for (let i = 0; i < positions.length; i += 1) {
      const d = step(positions[i]!, positions[(i + 1) % positions.length]!, direction);
      if (bad < 0 && (d < 1e-9 || sum + d > n + 1e-9)) bad = i;
      sum += d;
    }
    return { sum, bad };
  };
  const forward = attempt(1);
  const backward = attempt(-1);
  const good = (r: { sum: number; bad: number }): boolean => r.bad < 0 && Math.abs(r.sum - n) < 1e-6;
  if (good(forward)) return 1;
  if (good(backward)) return -1;
  const best = forward.bad >= 0 && backward.bad >= 0 ? (forward.sum <= backward.sum ? forward : backward) : forward.bad >= 0 ? backward : forward;
  const i = best.bad >= 0 ? best.bad : positions.length - 1;
  fail('gate-order', `The gates are not in driving order once around the loop: gate ${(i + 1) % positions.length} does not follow gate ${i}. List the gates in the order a car passes them, going round the track one way.`);
  return 0;
}

/** Rule 14. The start faces the way the checkpoint engine counts gate 0 forwards, and sits just behind it. */
function checkStartHeading(track: Track, fail: (rule: TrackRule, message: string) => void): void {
  const g0 = track.gates[0]!;
  const m0 = { x: (g0.a.x + g0.b.x) / 2, y: (g0.a.y + g0.b.y) / 2 };
  const [nx, ny] = forwardNormal(g0);
  const heading = track.start.heading;
  const cosine = Math.cos(heading) * nx + Math.sin(heading) * ny;
  const angle = Math.acos(Math.max(-1, Math.min(1, cosine)));
  if (angle > TRACK_LIMITS.maxStartAngle) {
    fail('start-heading', `The start faces ${fmt((angle * 180) / Math.PI)}° away from the forward direction of gate 0 (the way a car must cross it to earn a checkpoint: the outer boundary on its right); it must be within ${fmt((TRACK_LIMITS.maxStartAngle * 180) / Math.PI)}°. Turn the start to face that way.`);
  }
  const p = track.start.position;
  if ((p.x - m0.x) * nx + (p.y - m0.y) * ny >= 0) {
    fail('start-heading', `The start ${at(p)} is not behind gate 0; it must start before the start/finish line, on the side a car crosses it from.`);
  }
}

/**
 * The unit direction in which the checkpoint engine counts the gate: for a gate from the inner end `a` to the outer
 * end `b` it is (dy, -dx) of b - a (sim/checkpoints.ts), so a car drives with the outer boundary on its right.
 */
function forwardNormal(gate: { readonly a: Vec2; readonly b: Vec2 }): [number, number] {
  const dx = gate.b.x - gate.a.x;
  const dy = gate.b.y - gate.a.y;
  const length = Math.hypot(dx, dy);
  return [dy / length, -dx / length];
}

/**
 * Rule 13 (direction). The engine credits a gate only when it is crossed with the outer boundary on the car's right, so
 * the gates must be listed in the direction that keeps the outer boundary on the right. That is decided by the outer
 * polygon's orientation (its signed area), which is topological: it holds at concave and reflex vertices, where the
 * local tangent says nothing about the way round. In screen coordinates (y down), a car keeps the outer boundary on its
 * right going counter-clockwise, which is the direction of increasing point index when the signed area is negative.
 */
function checkGateDirection(track: Track, listed: 1 | -1, fail: (rule: TrackRule, message: string) => void): void {
  const required = signedArea(track.outer) < 0 ? 1 : -1;
  if (listed !== required) {
    fail('gate-order', `The gates are listed going the wrong way round: the checkpoint engine credits a gate only when the car crosses it with the outer boundary on its right (a gate runs from its inner end a to its outer end b), so the gates must follow one another counter-clockwise on the screen. Drive the circuit the other way round, or mirror the track so the outer boundary is on the right.`);
  }
}

/** The shoelace sum of a closed polygon: negative for counter-clockwise on the screen (y down). */
function signedArea(points: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}
