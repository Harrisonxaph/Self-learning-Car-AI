// Track geometry in world units (metres). Headless: no canvas or pixel sizes here; the renderer maps
// these coordinates onto the screen.
//
// Coordinates: x grows to the right and y grows downwards, matching the canvas, so the renderer only
// scales and shifts. Headings are in radians measured from the +x axis, turning towards +y.

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** Where a car starts: a position and the direction it faces. */
export interface Pose {
  readonly position: Vec2;
  readonly heading: number;
}

/** A checkpoint line across the road, from the inner boundary (a) to the outer boundary (b). */
export interface Gate {
  readonly a: Vec2;
  readonly b: Vec2;
}

export interface Track {
  /** Stable identifier, for example "stadium-oval". */
  readonly id: string;
  /** Content version: change it whenever the geometry changes, so saved runs can tell tracks apart. */
  readonly version: string;
  readonly name: string;
  /** Closed boundaries: the last point joins back to the first, so it is not repeated. */
  readonly outer: readonly Vec2[];
  readonly inner: readonly Vec2[];
  readonly start: Pose;
  /** Checkpoint gates in driving order; gate 0 is the start/finish line. */
  readonly gates: readonly Gate[];
}

/** The smallest axis-aligned rectangle containing the track. */
export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** Thrown when track data does not have the expected shape. */
export class TrackFormatError extends Error {
  override name = 'TrackFormatError';
}

/**
 * Turns track data (for example parsed JSON) into a frozen Track, checking only its shape: strings,
 * finite numbers and enough points. It does not check the geometry (closed, non-crossing boundaries,
 * gates spanning the road); full track validation is a later roadmap task (P4-01).
 */
export function loadTrack(data: unknown): Track {
  const fail = (what: string): never => {
    throw new TrackFormatError(`Invalid track: ${what}.`);
  };
  const object = (value: unknown, what: string): Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : fail(`${what} must be an object`);
  const text = (value: unknown, what: string): string =>
    typeof value === 'string' && value.length > 0 ? value : fail(`${what} must be a non-empty string`);
  const finite = (value: unknown, what: string): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fail(`${what} must be a finite number`);
  const point = (value: unknown, what: string): Vec2 => {
    const p = object(value, what);
    return Object.freeze({ x: finite(p.x, `${what}.x`), y: finite(p.y, `${what}.y`) });
  };
  const list = <T>(value: unknown, minimum: number, what: string, item: (v: unknown, w: string) => T): readonly T[] => {
    if (!Array.isArray(value) || value.length < minimum) fail(`${what} must be an array of at least ${minimum}`);
    const items = value as unknown[];
    // Index loop rather than map(), so holes in a sparse array are checked too.
    const result: T[] = [];
    for (let i = 0; i < items.length; i += 1) result.push(item(items[i], `${what}[${i}]`));
    return Object.freeze(result);
  };

  const track = object(data, 'track');
  const start = object(track.start, 'start');
  return Object.freeze({
    id: text(track.id, 'id'),
    version: text(track.version, 'version'),
    name: text(track.name, 'name'),
    outer: list(track.outer, 3, 'outer', point),
    inner: list(track.inner, 3, 'inner', point),
    start: Object.freeze({ position: point(start.position, 'start.position'), heading: finite(start.heading, 'start.heading') }),
    gates: list(track.gates, 3, 'gates', (value, what) => {
      const gate = object(value, what);
      return Object.freeze({ a: point(gate.a, `${what}.a`), b: point(gate.b, `${what}.b`) });
    }),
  });
}

/** The bounding rectangle of the outer boundary, which contains everything drawn for the track. */
export function trackBounds(track: Track): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { x, y } of track.outer) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}
