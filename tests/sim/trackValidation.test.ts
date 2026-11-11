// Track validation (P4-01): one test per rule, all errors collected, the built-in tracks, the optional format fields,
// hostile input, winding order, size caps and the manifest integration. Fixtures are the built-in tracks with one small
// mutation each; nothing here trains or evaluates anything.
import { describe, expect, it } from 'vitest';
import manifestData from '../../src/data/tracks/index.json';
import hairpinChicane from '../../src/data/tracks/hairpin-chicane.json';
import roundedRectangle from '../../src/data/tracks/rounded-rectangle.json';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { advanceProgress, createProgress, forwardCrossing } from '../../src/sim/checkpoints';
import { loadTrack, TrackFormatError, type Track, type Vec2 } from '../../src/sim/track';
import {
  describeTrackErrors,
  loadValidatedTrack,
  TRACK_FORMAT,
  TRACK_LIMITS,
  validateTrack,
  type TrackRule,
} from '../../src/sim/trackValidation';
import { BUILT_IN_TRACK_SPLITS, loadTrackSplits, trackContentHash, TrackSplitError } from '../../src/training/trackSplits';

type Doc = {
  id: string;
  version: string;
  name: string;
  outer: { x: number; y: number }[];
  inner: { x: number; y: number }[];
  start: { position: { x: number; y: number }; heading: number };
  gates: { a: { x: number; y: number }; b: { x: number; y: number } }[];
  [key: string]: unknown;
};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const oval = (): Doc => clone(stadiumOval) as unknown as Doc;
const rulesOf = (result: ReturnType<typeof validateTrack>): TrackRule[] => (result.ok ? [] : result.errors.map((e) => e.rule));
const messageOf = (result: ReturnType<typeof validateTrack>, rule: TrackRule): string => {
  if (result.ok) throw new Error('expected a refusal');
  const found = result.errors.find((e) => e.rule === rule);
  if (found === undefined) throw new Error(`no ${rule} error in ${JSON.stringify(result.errors)}`);
  return found.message;
};
/** The track must fail with this rule, and its message must be a sentence naming what to do. */
function expectRule(doc: unknown, rule: TrackRule, options?: Parameters<typeof validateTrack>[1]): string {
  const result = validateTrack(doc, options);
  expect(rulesOf(result)).toContain(rule);
  const message = messageOf(result, rule);
  expect(message.length).toBeGreaterThan(20);
  expect(message).toMatch(/[.)]$/);
  return message;
}

describe('the built-in tracks', () => {
  it.each([
    ['stadium-oval', stadiumOval],
    ['rounded-rectangle', roundedRectangle],
    ['hairpin-chicane', hairpinChicane],
  ])('%s passes with no warnings', (_name, data) => {
    const result = validateTrack(data);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings).toEqual([]);
  });

  it('keeps every content hash: the manifest still loads and the optional fields do not change a hash', () => {
    const splits = BUILT_IN_TRACK_SPLITS;
    for (const entry of manifestData.tracks) {
      expect(splits.tracks.find((t) => t.id === entry.id)?.contentHash).toBe(entry.contentHash);
    }
    const labelled = { ...oval(), format: TRACK_FORMAT, schemaVersion: 1, split: 'training' };
    expect(trackContentHash(loadTrack(labelled))).toBe(trackContentHash(loadTrack(stadiumOval)));
  });
});

describe('rule 1: shape and the optional format fields', () => {
  it('reports a missing field with the shape message', () => {
    const doc = oval() as Partial<Doc>;
    delete doc.start;
    expect(expectRule(doc, 'shape')).toContain('start must be an object');
  });
  it('accepts valid format, schemaVersion and split, and refuses wrong ones', () => {
    expect(validateTrack({ ...oval(), format: TRACK_FORMAT, schemaVersion: 1, split: 'validation' }).ok).toBe(true);
    expect(expectRule({ ...oval(), format: 'other' }, 'shape')).toContain('format');
    expect(expectRule({ ...oval(), schemaVersion: 2 }, 'shape')).toContain('schema version 1');
    expect(expectRule({ ...oval(), split: 'test' }, 'shape')).toContain('split');
  });
});

describe('rule 2: identity', () => {
  it('refuses an id with capitals or spaces, and over-long names and versions', () => {
    expect(expectRule({ ...oval(), id: 'Bad Id' }, 'identity')).toContain('Bad Id');
    expect(expectRule({ ...oval(), name: 'x'.repeat(81) }, 'identity')).toContain('80');
    expect(expectRule({ ...oval(), version: 'x'.repeat(65) }, 'identity')).toContain('64');
  });
});

describe('rule 3: size caps (checked before any pairwise work)', () => {
  it('refuses too many boundary points, too many gates and a far coordinate', () => {
    const many = oval();
    many.outer = Array.from({ length: TRACK_LIMITS.maxPoints + 1 }, (_, i) => ({ x: 100 * Math.cos(i), y: 100 * Math.sin(i) }));
    expect(expectRule(many, 'size')).toContain('2001');
    const gates = oval();
    gates.gates = Array.from({ length: TRACK_LIMITS.maxGates + 1 }, () => gates.gates[0]!);
    expect(expectRule(gates, 'size')).toContain('201');
    const far = oval();
    far.outer[3] = { x: 1e6, y: 0 };
    expect(expectRule(far, 'size')).toContain('10000');
  });
  it('refuses a boundary of fewer than three points as a size error', () => {
    const doc = oval();
    doc.outer = doc.outer.slice(0, 2);
    expect(expectRule(doc, 'size')).toContain('outer');
  });
});

describe('rule 4: degenerate edges', () => {
  it('refuses two coincident points and names them', () => {
    const doc = oval();
    doc.outer.splice(4, 0, { ...doc.outer[3]! });
    expect(expectRule(doc, 'degenerate')).toContain('point 3');
  });
  it('only warns about a very short edge', () => {
    const doc = oval();
    const p = doc.inner[5]!;
    doc.inner.splice(6, 0, { x: p.x + 0.05, y: p.y });
    const result = validateTrack(doc);
    expect(rulesOf(result)).not.toContain('degenerate');
  });
});

describe('rule 5: each boundary is a simple closed polygon', () => {
  it('refuses a crossing (two swapped points) in either boundary', () => {
    const outer = oval();
    [outer.outer[3], outer.outer[4]] = [outer.outer[4]!, outer.outer[3]!];
    expect(expectRule(outer, 'boundary-simple')).toContain('outer boundary');
    const inner = oval();
    [inner.inner[3], inner.inner[4]] = [inner.inner[4]!, inner.inner[3]!];
    expect(expectRule(inner, 'boundary-simple')).toContain('inner boundary');
  });
  it('refuses an edge that folds back over its neighbour', () => {
    const doc = oval();
    const a = doc.outer[0]!;
    const b = doc.outer[1]!;
    doc.outer.splice(2, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    expect(expectRule(doc, 'boundary-simple')).toContain('outer boundary');
  });
});

describe('rule 6: the boundaries do not touch', () => {
  it('refuses an inner point on the outer boundary', () => {
    const doc = oval();
    doc.inner[0] = { ...doc.outer[0]! };
    expect(expectRule(doc, 'boundaries-apart')).toContain('touches the inner edge');
  });
});

describe('rule 7: the inner boundary is inside the outer one', () => {
  it('refuses swapped boundaries', () => {
    const doc = oval();
    [doc.outer, doc.inner] = [doc.inner, doc.outer];
    expect(expectRule(doc, 'inner-inside-outer')).toContain('not inside');
  });
  it('refuses an inner boundary entirely outside', () => {
    const doc = oval();
    doc.inner = doc.inner.map((p) => ({ x: p.x + 500, y: p.y }));
    expect(expectRule(doc, 'inner-inside-outer')).toContain('outside');
  });
});

describe('rule 8: minimum road width', () => {
  it('refuses a road narrower than the minimum and reports the width', () => {
    const message = expectRule(stadiumOval, 'road-width', { minRoadWidth: 20 });
    expect(message).toContain('13.88 m wide');
    expect(message).toContain('at least 20 m');
  });
  it('follows the vehicle: a wider car needs a wider road', () => {
    expectRule(stadiumOval, 'road-width', { physics: { ...DEFAULT_VEHICLE_PHYSICS, vehicleWidth: 8 } });
  });
  it('refuses a pinched road', () => {
    const doc = oval();
    // Pull the inner boundary's first straight to 2 m from the outer one (the road must be at least 4 m).
    for (const i of [0, 12]) doc.inner[i] = { x: doc.inner[i]!.x, y: doc.outer[i]!.y - Math.sign(doc.outer[i]!.y) * 2 };
    expect(rulesOf(validateTrack(doc))).toContain('road-width');
  });
  it('ignores a non-positive or non-finite option and uses the default', () => {
    expect(validateTrack(stadiumOval, { minRoadWidth: -1 }).ok).toBe(true);
    expect(validateTrack(stadiumOval, { minRoadWidth: Number.NaN }).ok).toBe(true);
  });
});

describe('rule 9: the start is on the road', () => {
  it('refuses a start in the infield and a start outside the circuit', () => {
    const infield = oval();
    infield.start.position = { x: 0, y: 0 };
    expect(expectRule(infield, 'start-on-road')).toContain('(0, 0) is not on the road');
    const outside = oval();
    outside.start.position = { x: -6, y: 60 };
    expect(expectRule(outside, 'start-on-road')).toContain('is not on the road');
  });
  it('refuses a start whose body touches a wall', () => {
    const doc = oval();
    doc.start.position = { x: -6, y: 46.5 };
    expect(expectRule(doc, 'start-on-road')).toContain('touches a boundary');
  });
});

describe('rule 10: at least three gates', () => {
  it('refuses two gates with the gate-count message', () => {
    const doc = oval();
    doc.gates = doc.gates.slice(0, 2);
    expect(expectRule(doc, 'gate-count')).toContain('at least 3');
  });
});

describe('rule 11: each gate spans the road', () => {
  it('refuses a gate whose outer end is off the outer boundary', () => {
    const doc = oval();
    doc.gates[5]!.b = { x: doc.gates[5]!.b.x, y: doc.gates[5]!.b.y - 0.5 };
    expect(expectRule(doc, 'gate-spans-road')).toContain('Gate 5');
  });
  it('refuses a gate whose inner end is off the inner boundary', () => {
    const doc = oval();
    doc.gates[5]!.a = { x: doc.gates[5]!.a.x, y: doc.gates[5]!.a.y + 0.5 };
    expect(expectRule(doc, 'gate-spans-road')).toContain('inner end');
  });
  it('refuses a gate with its ends swapped (inner end on the outer boundary)', () => {
    const doc = oval();
    const g = doc.gates[5]!;
    [g.a, g.b] = [g.b, g.a];
    expect(expectRule(doc, 'gate-spans-road')).toContain('Gate 5');
  });
  it('refuses a gate that crosses a boundary between its ends', () => {
    const doc = oval();
    // From the inner boundary on one straight to the outer boundary on the other: it crosses the inner boundary.
    doc.gates[2] = { a: doc.gates[2]!.a, b: { x: 0, y: -47 } };
    expect(expectRule(doc, 'gate-spans-road')).toContain('crosses the inner boundary');
  });
  it('refuses a gate with no length', () => {
    const doc = oval();
    doc.gates[3] = { a: { ...doc.inner[2]! }, b: { ...doc.inner[2]! } };
    expect(expectRule(doc, 'gate-spans-road')).toContain('Gate 3');
  });
});

describe('rule 12: gates are apart', () => {
  it('refuses two gates that touch', () => {
    const doc = oval();
    doc.gates[6] = clone(doc.gates[5]!);
    expect(expectRule(doc, 'gates-apart')).toContain('Gates 5 and 6');
  });
});

describe('rule 13: gates are in driving order, once around', () => {
  it('refuses two gates swapped', () => {
    const doc = oval();
    [doc.gates[4], doc.gates[5]] = [doc.gates[5]!, doc.gates[4]!];
    expect(expectRule(doc, 'gate-order')).toContain('driving order');
  });
  it('refuses gates that go round twice or skip back', () => {
    const doc = oval();
    doc.gates = [...doc.gates.slice(0, 10), ...doc.gates.slice(0, 10)].map(clone);
    expect(rulesOf(validateTrack(doc))).toEqual(expect.arrayContaining(['gates-apart']));
  });
  it('refuses the whole list reversed: the order is fine, but every gate now counts forwards the wrong way round', () => {
    const doc = oval();
    doc.gates.reverse();
    const result = validateTrack(doc);
    expect(messageOf(result, 'gate-order')).toContain('wrong way');
    expect(rulesOf(result)).toContain('start-heading');
  });
});

describe('rule 14: the start faces the gate-0 forward direction and is behind gate 0', () => {
  it('refuses a start that faces backwards and reports the angle', () => {
    const doc = oval();
    doc.start.heading = Math.PI;
    expect(expectRule(doc, 'start-heading')).toContain('180');
    expect(expectRule(doc, 'start-heading')).toContain('forward direction of gate 0');
  });
  it('refuses a start that is past gate 0', () => {
    const doc = oval();
    doc.start.position = { x: 6, y: 40 };
    expect(expectRule(doc, 'start-heading')).toContain('not behind gate 0');
  });
  it('accepts a heading within 45 degrees and refuses one beyond it', () => {
    const near = oval();
    near.start.heading = 0.7;
    expect(validateTrack(near).ok).toBe(true);
    const far = oval();
    far.start.heading = 0.9;
    expectRule(far, 'start-heading');
  });
});

describe('warnings', () => {
  it('warns, but does not fail, about gates far apart', () => {
    const doc = oval();
    doc.gates.splice(3, 3);
    const result = validateTrack(doc);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings.join(' ')).toContain('apart');
  });
});

describe('all errors are collected', () => {
  it('reports several rules at once, and skips only what depends on the walls', () => {
    const doc = oval();
    doc.id = 'Bad Id';
    doc.outer.splice(4, 0, { ...doc.outer[3]! });
    doc.gates[6] = clone(doc.gates[5]!);
    const result = validateTrack(doc);
    expect(result.ok).toBe(false);
    expect(rulesOf(result)).toEqual(expect.arrayContaining(['identity', 'degenerate', 'gates-apart']));
    if (!result.ok) expect(result.skipped).toContain('gate-spans-road');
  });
  it('lists every message and counts the ones beyond the cap', () => {
    const errors = Array.from({ length: TRACK_LIMITS.maxErrors + 3 }, (_, i) => ({ rule: 'shape' as const, message: `Problem ${i}.` }));
    const text = describeTrackErrors(errors);
    expect(text).toContain('Problem 0.');
    expect(text).toContain(`Problem ${TRACK_LIMITS.maxErrors - 1}.`);
    expect(text).not.toContain(`Problem ${TRACK_LIMITS.maxErrors}.`);
    expect(text).toContain('(and 3 more problems)');
  });
  it('loadValidatedTrack returns a track or throws a TrackFormatError with the messages', () => {
    expect(loadValidatedTrack(stadiumOval).id).toBe('stadium-oval');
    const doc = oval();
    doc.start.heading = Math.PI;
    expect(() => loadValidatedTrack(doc)).toThrow(TrackFormatError);
    expect(() => loadValidatedTrack(doc)).toThrow(/forward direction of gate 0/);
  });
});

describe('hostile input is a refusal, never an exception', () => {
  const nested: Record<string, unknown> = {};
  let cursor = nested;
  for (let i = 0; i < 12_000; i += 1) {
    const next: Record<string, unknown> = {};
    cursor.next = next;
    cursor = next;
  }
  const throwing = Object.defineProperty(oval(), 'outer', {
    get() {
      throw new Error('boom');
    },
    enumerable: true,
  });
  const proxy = new Proxy(
    {},
    {
      get() {
        throw new Error('trap');
      },
      has() {
        throw new Error('trap');
      },
    },
  );
  const sparse = oval();
  sparse.outer = new Array(26) as Doc['outer'];
  const polluted = JSON.parse('{"__proto__": {"outer": []}, "id": "x"}') as unknown;
  const nonFinite = oval();
  nonFinite.outer[2] = { x: Number.NaN, y: 0 };
  const infinite = oval();
  infinite.inner[2] = { x: Number.POSITIVE_INFINITY, y: 0 };
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an array', []],
    ['a string', 'track'],
    ['a number', 7],
    ['an empty object', {}],
    ['a very deep object', nested],
    ['a throwing getter', throwing],
    ['a throwing proxy', proxy],
    ['a sparse boundary', sparse],
    ['a polluted object', polluted],
    ['a NaN coordinate', nonFinite],
    ['an Infinity coordinate', infinite],
  ])('%s', (_name, value) => {
    const result = validateTrack(value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
  });
});

/** The points just ahead of each gate (in the checkpoint engine's forward direction) and the gate's midpoint. */
function lap(track: Track): { gate: number; from: Vec2; to: Vec2 }[] {
  const ahead = (k: number, distance: number): Vec2 => {
    const g = track.gates[k]!;
    const dx = g.b.x - g.a.x;
    const dy = g.b.y - g.a.y;
    const length = Math.hypot(dx, dy);
    return { x: (g.a.x + g.b.x) / 2 + (dy / length) * distance, y: (g.a.y + g.b.y) / 2 - (dx / length) * distance };
  };
  const moves: { gate: number; from: Vec2; to: Vec2 }[] = [];
  let from = track.start.position;
  const order = [...track.gates.keys(), 0];
  for (const k of order) {
    const to = ahead(k, 0.5);
    moves.push({ gate: k, from, to });
    from = to;
  }
  return moves;
}

describe('the validated direction is the checkpoint engine\'s direction (behaviour, not only geometry)', () => {
  /** Drive the validated circuit gate by gate through the real checkpoint code and return the final progress. */
  function drive(data: unknown): ReturnType<typeof createProgress> {
    const result = validateTrack(data);
    expect(rulesOf(result)).toEqual([]);
    const track = loadTrack(data);
    let progress = createProgress();
    for (const move of lap(track)) progress = advanceProgress(progress, move.from, move.to, track);
    return progress;
  }
  it.each([
    ['stadium-oval', stadiumOval],
    ['rounded-rectangle', roundedRectangle],
    ['hairpin-chicane', hairpinChicane],
  ])('%s: crossing every gate in the validated direction earns one full lap of ordered credit', (_name, data) => {
    const progress = drive(data);
    const gates = (data as unknown as Doc).gates.length;
    expect(progress.gatesPassed).toBe(gates + 1);
    expect(progress.lapTicks).toHaveLength(1);
  });

  it('a track stored with the opposite boundary winding (gates unchanged) validates and earns the same credit', () => {
    const doc = oval();
    doc.outer.reverse();
    doc.inner.reverse();
    const progress = drive(doc);
    expect(progress.gatesPassed).toBe(doc.gates.length + 1);
  });

  it('a horizontally mirrored circuit is refused, and its intended crossing earns no credit', () => {
    const doc = oval();
    const flip = (p: Vec2) => ({ x: -p.x, y: p.y });
    doc.outer = doc.outer.map(flip);
    doc.inner = doc.inner.map(flip);
    doc.gates = doc.gates.map((g) => ({ a: flip(g.a), b: flip(g.b) }));
    doc.start = { position: flip(doc.start.position), heading: Math.PI };
    const result = validateTrack(doc);
    expect(rulesOf(result)).toEqual(expect.arrayContaining(['gate-order', 'start-heading']));
    // The crossing a car facing the mirrored start would make (towards -x through gate 0) is not forward credit.
    expect(forwardCrossing(doc.gates[0]!, { x: 1, y: 40 }, { x: -1, y: 40 })).toBeNull();
  });

  it('reversing the gate list after gate 0 with a repositioned start is refused, and that crossing earns no credit', () => {
    const doc = oval();
    doc.gates = [doc.gates[0]!, ...doc.gates.slice(1).reverse()];
    doc.start = { position: { x: 6, y: 40 }, heading: Math.PI };
    expect(validateTrack(doc).ok).toBe(false);
    expect(forwardCrossing(doc.gates[0]!, { x: 1, y: 40 }, { x: -1, y: 40 })).toBeNull();
  });
});

describe('cost', () => {
  it('validates a maximum-size valid track within a generous time, and it is drivable through the checkpoint engine', () => {
    const n = TRACK_LIMITS.maxPoints;
    const ring = (radius: number) => Array.from({ length: n }, (_, i) => ({ x: radius * Math.cos((2 * Math.PI * i) / n), y: radius * Math.sin((2 * Math.PI * i) / n) }));
    const outer = ring(1000);
    const inner = ring(980);
    const step = n / TRACK_LIMITS.maxGates;
    // The outer boundary must be on the car's right: the ring is driven with the angle decreasing.
    const gates = Array.from({ length: TRACK_LIMITS.maxGates }, (_, k) => {
      const i = (n - k * step) % n;
      return { a: inner[i]!, b: outer[i]! };
    });
    const angle = 0.004;
    const doc = {
      id: 'big-ring',
      version: '1',
      name: 'Big ring',
      outer,
      inner,
      start: { position: { x: 990 * Math.cos(angle), y: 990 * Math.sin(angle) }, heading: Math.atan2(-Math.cos(angle), Math.sin(angle)) },
      gates,
    };
    const started = performance.now();
    const result = validateTrack(doc);
    const elapsed = performance.now() - started;
    expect(rulesOf(result)).toEqual([]);
    expect(result.ok).toBe(true);
    expect(elapsed).toBeLessThan(5000);
    const track = loadTrack(doc);
    let progress = createProgress();
    for (const move of lap(track)) progress = advanceProgress(progress, move.from, move.to, track);
    expect(progress.gatesPassed).toBe(TRACK_LIMITS.maxGates + 1);
  });
});

describe('manifest integration', () => {
  const FILES = { 'stadium-oval.json': stadiumOval, 'rounded-rectangle.json': roundedRectangle, 'hairpin-chicane.json': hairpinChicane };
  it('a built-in file that is not a valid track fails the manifest load with the validation message', () => {
    const broken = oval();
    broken.start.heading = Math.PI;
    // Keep the content hash in step so the geometry rule, not the hash check, is what refuses it.
    const manifest = clone(manifestData);
    manifest.tracks[0]!.contentHash = trackContentHash(loadTrack(broken));
    expect(() => loadTrackSplits(manifest, { ...FILES, 'stadium-oval.json': broken })).toThrow(TrackSplitError);
    expect(() => loadTrackSplits(manifest, { ...FILES, 'stadium-oval.json': broken })).toThrow(/not a valid track.*forward direction of gate 0/);
  });
  it('a split label in a file that disagrees with the manifest fails the load', () => {
    const labelled = { ...oval(), split: 'held-out' };
    expect(() => loadTrackSplits(manifestData, { ...FILES, 'stadium-oval.json': labelled })).toThrow(/labelled "held-out".*manifest says "training"/);
  });
  it('a matching split label loads', () => {
    const labelled = { ...oval(), split: 'training' };
    expect(loadTrackSplits(manifestData, { ...FILES, 'stadium-oval.json': labelled }).tracks).toHaveLength(3);
  });
});
