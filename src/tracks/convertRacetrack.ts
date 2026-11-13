// Converts a racetrack-database centre line (TUM `tracks/<Name>.csv`: a `#` header comment, then one row per point of
// `x_m, y_m, w_tr_right_m, w_tr_left_m`, in metres, y up, in the circuit's real driving direction) into a P4-01 track
// document (docs/TRACK_FORMAT.md). Pure and headless: text in, a document out, no files, no clock, no randomness, so the
// same text and options always give the same bytes (P4-06 step 2a, docs/plans/p4-06-plan.md section 3).
//
// Construction, in this order, so a reviewer can follow it:
//   1. Parse strictly: a `#` comment line, then rows of exactly four finite numbers (the widths positive). Anything else is
//      refused with a message naming the line.
//   2. The picture: y is negated, so the circuit looks on the y-down canvas as it does on a map (not mirrored).
//   3. The direction (one convention, an honest approximation): the engine credits one direction, the outer boundary on the
//      car's right, counter-clockwise on the screen. The real circuit is run clockwise, so the points are listed in REVERSE
//      order (row 0 stays first, so the start/finish line stays where the database puts it) and the simulated cars drive the
//      true layout the opposite way round. The database's "right" width is then the car's LEFT (the inner boundary) and its
//      "left" width the car's right (the outer boundary).
//   4. Boundaries: each centre point is offset along the normal of its central-difference tangent (the direction from the
//      previous point to the next, cyclically), exactly one boundary point per row, rounded to 3 decimals.
//   5. Gates on every `gateEveryRows`-th row, the inner end on the inner boundary and the outer end on the outer one.
//   6. The start on the centre line `startBehindMetres` behind gate 0 along the polyline, facing forward.
// The caller validates the result with `validateTrack` (a conversion that does not validate is a failure) and records the
// source, commit and hash in `options.source`; nothing here claims the result is a faithful simulation of the real circuit.

/** Largest points per boundary the P4-01 validator accepts. */
export const MAX_BOUNDARY_POINTS = 2000;
/** Most gates the P4-01 validator accepts. */
export const MAX_GATES = 200;

export class RacetrackFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RacetrackFormatError';
  }
}

export interface RacetrackRow {
  readonly x: number;
  readonly y: number;
  /** Width to the right of the direction of travel, metres. */
  readonly right: number;
  /** Width to the left of the direction of travel, metres. */
  readonly left: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Where the data came from, copied into the track file's own header so the file names its source. */
export interface RacetrackSource {
  readonly name: string;
  readonly url: string;
  readonly commit: string;
  readonly sha256: string;
  readonly licence: string;
  readonly attribution: string;
}

export interface ConvertOptions {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly source: RacetrackSource;
  /** A gate on every this-many-th row (default 10: about 50 m at a 5 m row spacing). */
  readonly gateEveryRows?: number;
  /** The start this many metres behind gate 0 (default 10). */
  readonly startBehindMetres?: number;
  /** A note stored in the file about the direction, shown wherever the track is described. */
  readonly directionNote?: string;
}

export interface RacetrackDocument {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly source: RacetrackSource & { readonly directionNote?: string };
  readonly outer: readonly Point[];
  readonly inner: readonly Point[];
  readonly start: { readonly position: Point; readonly heading: number };
  readonly gates: readonly { readonly a: Point; readonly b: Point }[];
}

export interface Conversion {
  readonly document: RacetrackDocument;
  /** The centre line's length in metres (the sum of its segments, closed). */
  readonly lengthMetres: number;
  readonly rows: number;
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Parses the CSV text strictly. Throws RacetrackFormatError naming the line. */
export function parseRacetrackCsv(text: unknown): RacetrackRow[] {
  if (typeof text !== 'string') throw new RacetrackFormatError('The racetrack file must be text.');
  if (text.trim() === '') throw new RacetrackFormatError('The racetrack file is empty.');
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop(); // one trailing newline
  const first = lines[0] ?? '';
  if (!first.startsWith('#')) throw new RacetrackFormatError('Line 1 must be the "#" header comment naming the columns (x_m, y_m, w_tr_right_m, w_tr_left_m).');
  const rows: RacetrackRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    const number = i + 1;
    if (line.trim() === '') throw new RacetrackFormatError(`Line ${number} is empty; every row must hold four numbers.`);
    const parts = line.split(',');
    if (parts.length !== 4) throw new RacetrackFormatError(`Line ${number} has ${parts.length} values; every row must hold exactly four numbers (x, y, right width, left width).`);
    const values = parts.map((part) => (part.trim() === '' ? Number.NaN : Number(part)));
    if (!values.every((v) => Number.isFinite(v))) throw new RacetrackFormatError(`Line ${number} holds a value that is not a finite number.`);
    const [x, y, right, left] = values as [number, number, number, number];
    if (!(right > 0) || !(left > 0)) throw new RacetrackFormatError(`Line ${number} has a width that is not greater than 0 (right ${right}, left ${left}).`);
    rows.push({ x, y, right, left });
  }
  if (rows.length < 3) throw new RacetrackFormatError(`The racetrack file has ${rows.length} rows; a loop needs at least 3.`);
  if (rows.length > MAX_BOUNDARY_POINTS) throw new RacetrackFormatError(`The racetrack file has ${rows.length} rows; each boundary may hold at most ${MAX_BOUNDARY_POINTS} points.`);
  return rows;
}

/** The track document for a racetrack file. Throws RacetrackFormatError for a malformed file or unusable options. */
export function convertRacetrack(text: unknown, options: ConvertOptions): Conversion {
  const gateEvery = options.gateEveryRows ?? 10;
  const startBehind = options.startBehindMetres ?? 10;
  if (!Number.isInteger(gateEvery) || gateEvery < 1) throw new RacetrackFormatError(`gateEveryRows must be a whole number of at least 1, got ${String(gateEvery)}.`);
  if (!(Number.isFinite(startBehind) && startBehind > 0)) throw new RacetrackFormatError(`startBehindMetres must be a finite number greater than 0, got ${String(startBehind)}.`);
  const rows = parseRacetrackCsv(text);
  const n = rows.length;
  const gateCount = Math.ceil(n / gateEvery);
  if (gateCount < 3) throw new RacetrackFormatError(`${n} rows with a gate every ${gateEvery} rows give ${gateCount} gates; a track needs at least 3.`);
  if (gateCount > MAX_GATES) throw new RacetrackFormatError(`${n} rows with a gate every ${gateEvery} rows give ${gateCount} gates; the limit is ${MAX_GATES}.`);

  // The picture (y negated) and the driving order (row 0 first, then the rest reversed).
  const order = [0, ...Array.from({ length: n - 1 }, (_, k) => n - 1 - k)];
  const centre: Point[] = order.map((i) => ({ x: rows[i]!.x, y: -rows[i]!.y }));
  const widthRight = order.map((i) => rows[i]!.right); // the database's right: the car's LEFT after reversing (inner)
  const widthLeft = order.map((i) => rows[i]!.left); // the database's left: the car's RIGHT after reversing (outer)

  const outer: Point[] = [];
  const inner: Point[] = [];
  for (let k = 0; k < n; k += 1) {
    const previous = centre[(k + n - 1) % n]!;
    const next = centre[(k + 1) % n]!;
    const tx = next.x - previous.x;
    const ty = next.y - previous.y;
    const length = Math.hypot(tx, ty);
    if (!(length > 0)) throw new RacetrackFormatError(`Rows ${order[(k + n - 1) % n]! + 2} and ${order[(k + 1) % n]! + 2} (either side of row ${order[k]! + 2}'s point) coincide, so the direction there is undefined.`);
    // The right of the direction of travel on a y-down screen is (-ty, tx) / length.
    const nx = -ty / length;
    const ny = tx / length;
    const c = centre[k]!;
    outer.push({ x: r3(c.x + nx * widthLeft[k]!), y: r3(c.y + ny * widthLeft[k]!) });
    inner.push({ x: r3(c.x - nx * widthRight[k]!), y: r3(c.y - ny * widthRight[k]!) });
  }

  const gates: { a: Point; b: Point }[] = [];
  for (let k = 0; k < n; k += gateEvery) gates.push({ a: inner[k]!, b: outer[k]! });

  // The start: walk back from gate 0 (centre point 0) along the polyline by startBehind metres.
  let remaining = startBehind;
  let index = 0; // the point we are walking from
  let position: Point = centre[0]!;
  let heading = 0;
  for (let steps = 0; steps < n; steps += 1) {
    const from = centre[index]!;
    const toIndex = (index + n - 1) % n;
    const to = centre[toIndex]!;
    const segment = Math.hypot(to.x - from.x, to.y - from.y);
    if (remaining <= segment) {
      const t = remaining / segment;
      position = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
      // Facing forward: the direction from the earlier point (to) towards the later one (from).
      heading = Math.atan2(from.y - to.y, from.x - to.x);
      break;
    }
    remaining -= segment;
    index = toIndex;
    position = to;
    heading = Math.atan2(from.y - to.y, from.x - to.x);
  }

  let lengthMetres = 0;
  for (let k = 0; k < n; k += 1) {
    const a = centre[k]!;
    const b = centre[(k + 1) % n]!;
    lengthMetres += Math.hypot(b.x - a.x, b.y - a.y);
  }

  const document: RacetrackDocument = {
    id: options.id,
    version: options.version,
    name: options.name,
    source: options.directionNote === undefined ? { ...options.source } : { ...options.source, directionNote: options.directionNote },
    outer,
    inner,
    start: { position: { x: r3(position.x), y: r3(position.y) }, heading: r3(heading) },
    gates,
  };
  return { document, lengthMetres, rows: n };
}

const point = (p: Point): string => `{ "x": ${p.x}, "y": ${p.y} }`;
const list = <T>(items: readonly T[], format: (item: T) => string): string => `[\n${items.map((item) => `    ${format(item)}`).join(',\n')}\n  ]`;

/** The canonical text of a converted document (the same layout as the generated circuits: one point per line), so the committed file can be compared byte for byte. */
export function serialiseRacetrack(t: RacetrackDocument): string {
  const source = JSON.stringify(t.source, null, 2).replace(/\n/g, '\n  ');
  return `{\n  "id": ${JSON.stringify(t.id)},\n  "version": ${JSON.stringify(t.version)},\n  "name": ${JSON.stringify(t.name)},\n  "source": ${source},\n  "outer": ${list(t.outer, point)},\n  "inner": ${list(t.inner, point)},\n  "start": { "position": ${point(t.start.position)}, "heading": ${t.start.heading} },\n  "gates": ${list(t.gates, (g) => `{ "a": ${point(g.a)}, "b": ${point(g.b)} }`)}\n}\n`;
}
