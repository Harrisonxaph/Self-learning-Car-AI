// P5-02 step 2b-2 (docs/plans/p5-02-fresh-circuits-plan.md section 3 and docs/plans/p5-02-fresh-circuits-specs.md): the three fresh held-out
// circuits. GEOMETRY ONLY. No model, rule or driver is evaluated on any of them here, and nothing in this file hands one to the evaluator:
// the checks are the validator, the generator's own output, the approved criteria measured on the committed files, the nominal and
// perturbed starts being clear of the walls, the similarity guard, the provenance, and the enforcement of the labels.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCar } from '../../src/sim/collision';
import { DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { EVALUATION_SEEDS, evaluationStartFor } from '../../src/sim/evaluationStarts';
import { validateTrack } from '../../src/sim/trackValidation';
import { manifestRecord } from '../../src/training/experiment';
import {
  assertEvaluationTrack,
  assertTrainingTrack,
  BUILT_IN_TRACK_SPLITS,
  classifyCustomTrack,
  findRegistered,
  heldOutTrack,
  RESERVED_LAYOUT_MESSAGE,
  roadFingerprint,
  SPLIT_EPOCHS,
  TrackLeakageError,
  trackGeometryHash,
  tracksIn,
} from '../../src/training/trackSplits';
import { freezeNoBrakeNetworkAgent } from '../../src/training/heldOutAccess';
import { PARAMETER_COUNT } from '../../src/ai/network';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ROOT = join(__dirname, '../..');
const FRESH = ['hairpin-run', 'sweep-hook', 'hook-chicane'] as const;
const SPENT = ['hairpin-chicane', 'long-sweepers', 'technical-narrow'] as const;
const spec = (id: string): Json => JSON.parse(readFileSync(join(ROOT, 'src/data/tracks/specs', `${id}.spec.json`), 'utf8')) as Json;
const entry = (id: string) => BUILT_IN_TRACK_SPLITS.tracks.find((t) => t.id === id)!;
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** The centre line's length: the closed polygon through the midpoints of facing outer and inner vertices. */
function centreLineLength(id: string): number {
  const { outer, inner } = entry(id).track;
  const mid = outer.map((p, i) => ({ x: (p.x + inner[i]!.x) / 2, y: (p.y + inner[i]!.y) / 2 }));
  return mid.reduce((sum, p, i) => sum + dist(p, mid[(i + 1) % mid.length]!), 0);
}
const roadWidth = (id: string): number => {
  const { outer, inner } = entry(id).track;
  return outer.reduce((sum, p, i) => sum + dist(p, inner[i]!), 0) / outer.length;
};

/**
 * The longest continuous centre-line run of straights and arcs of radius at least 70 m round the closed lap. The lap is the half followed
 * by its mirror image reversed, so the runs join at both seams. The solved straight is counted as ZERO here, so the figure is a lower
 * bound: a run that reaches 150 m without it reaches it with it.
 */
function longestFastRun(half: Json[]): number {
  const full = [...half, ...[...half].reverse()];
  const fast = full.map((s) => (s.type === 'straight' ? s.length : s.radius >= 70 ? (s.radius * s.degrees * Math.PI) / 180 : -1));
  let best = 0;
  for (let start = 0; start < fast.length; start += 1) {
    let run = 0;
    for (let k = 0; k < fast.length; k += 1) {
      const v = fast[(start + k) % fast.length]!;
      if (v < 0) break;
      run += v;
    }
    best = Math.max(best, run);
  }
  return best;
}

describe('the three fresh circuits are registered as held-out, with the provenance the plan requires', () => {
  it('are the only held-out circuits, appended after the eight earlier entries, each version 1 with its own file', () => {
    expect(tracksIn('held-out').map((t) => t.id)).toEqual([...FRESH]);
    expect(BUILT_IN_TRACK_SPLITS.tracks.slice(8).map((t) => t.id)).toEqual([...FRESH]);
    for (const id of FRESH) expect(entry(id).version).toBe('1');
  });
  it('carry provenance: introduced by P5-02 step 2b, the criteria and specs named, designed before any evaluation', () => {
    for (const id of FRESH) {
      const p = entry(id).provenance!;
      expect(p.introducedBy, id).toBe('P5-02 step 2b');
      expect(p.designedBeforeAnyEvaluation, id).toBe(true);
      expect(p.designCriteria, id).toContain('p5-02-fresh-circuits-plan.md section 3.2');
      expect(p.designCriteria, id).toContain('p5-02-fresh-circuits-specs.md');
      expect(p.designCriteria, id).toContain('guarantee no speed change or lap time'); // the criteria are geometric proxies, said where they are recorded
    }
  });
  it('epoch 4 appends exactly the three fresh circuits and relabels exactly the three spent ones to validation; nothing else changes', () => {
    const e3 = SPLIT_EPOCHS[2]!;
    const e4 = SPLIT_EPOCHS[3]!;
    expect(e4.introducedBy).toBe('P5-02 step 2b');
    expect([...e4.ids]).toEqual([...e3.ids, ...FRESH]);
    const changed = e3.ids.filter((id) => e3.splits[id] !== e4.splits[id]);
    expect(changed).toEqual(['hairpin-chicane', 'long-sweepers', 'technical-narrow']);
    for (const id of changed) expect([e3.splits[id], e4.splits[id]]).toEqual(['held-out', 'validation']);
    for (const id of FRESH) expect(e4.splits[id]).toBe('held-out');
    expect(manifestRecord().hash).toBe(manifestRecord(BUILT_IN_TRACK_SPLITS, 4).hash);
  });
});

describe('the fresh circuits meet the approved criteria (geometric proxies measured on the committed files)', () => {
  it.each(FRESH)('%s: valid with no warnings, closed, and its spec is the one that was reviewed (id, version, name)', (id) => {
    const result = validateTrack(JSON.parse(readFileSync(join(ROOT, 'src/data/tracks', `${id}.json`), 'utf8')));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings).toEqual([]);
    const s = spec(id);
    expect([s.id, s.version]).toEqual([id, entry(id).version]);
    expect(s.name).toBe(entry(id).track.name);
  });
  it.each(FRESH)('%s: 8 to 14 m wide and a 400 to 650 m lap', (id) => {
    expect(roadWidth(id)).toBeGreaterThanOrEqual(8);
    expect(roadWidth(id)).toBeLessThanOrEqual(14);
    expect(spec(id).width).toBeGreaterThanOrEqual(8);
    expect(spec(id).width).toBeLessThanOrEqual(14);
    expect(centreLineLength(id)).toBeGreaterThanOrEqual(400);
    expect(centreLineLength(id)).toBeLessThanOrEqual(650);
  });
  it.each(FRESH)('%s: contains a tight corner (an arc of radius at most 30 m turning at least 90 degrees)', (id) => {
    const tight = (spec(id).half as Json[]).filter((s) => s.type === 'arc' && s.radius <= 30 && s.degrees >= 90);
    expect(tight.length).toBeGreaterThanOrEqual(1);
  });
  it.each(FRESH)('%s: contains a fast run (at least 150 m straight or arcs of radius at least 70 m), counting the solved straight as zero', (id) => {
    expect(longestFastRun(spec(id).half as Json[])).toBeGreaterThanOrEqual(150);
  });
  it('the three differ from each other in corner class: the tight corners are 150, 100 and 120 degrees, and the widths 9, 12 and 13 m', () => {
    const tightDegrees = FRESH.map((id) => (spec(id).half as Json[]).find((s) => s.type === 'arc' && s.radius <= 30 && s.degrees >= 90)!.degrees);
    expect(tightDegrees).toEqual([150, 100, 120]);
    expect(FRESH.map((id) => spec(id).width)).toEqual([9, 12, 13]);
  });
  it.each(FRESH)('%s: the nominal start and the four perturbed starts of the evaluation protocol are clear of the walls (geometry only, no driver)', (id) => {
    const track = entry(id).track;
    for (const seed of [0, ...EVALUATION_SEEDS]) {
      const start = evaluationStartFor(track.start, seed);
      const car = createCar({ position: { x: start.x, y: start.y }, heading: start.heading }, track, DEFAULT_VEHICLE_PHYSICS);
      expect(car.crashed, `${id} start ${seed}`).toBe(false);
    }
  });
});

describe('the fresh circuits are independent of every other registered circuit', () => {
  it.each(FRESH)('%s: matched by ID or geometry by itself only, and its road fingerprint belongs to no other circuit', (id) => {
    const track = entry(id).track;
    expect(findRegistered(track).map((t) => t.id)).toEqual([id]);
    for (const other of BUILT_IN_TRACK_SPLITS.tracks.filter((t) => t.id !== id)) {
      expect(trackGeometryHash(track)).not.toBe(other.geometryHash);
      expect(roadFingerprint(track)).not.toBe(roadFingerprint(other.track));
    }
  });
  it('no fresh circuit is a mirror, a reversal or a uniform scaling of another registered circuit by its length, width and gate count signature', () => {
    // A coarse, geometry-only guard; the exact-copy protection (ID, geometry hash, road fingerprint) is the classification above.
    const signature = (id: string) => `${Math.round(centreLineLength(id))}/${roadWidth(id).toFixed(1)}/${entry(id).track.gates.length}`;
    const all = BUILT_IN_TRACK_SPLITS.tracks.map((t) => signature(t.id));
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('enforcement of the new labels (nothing is evaluated)', () => {
  const model = freezeNoBrakeNetworkAgent(Array.from({ length: PARAMETER_COUNT }, (_, i) => Math.sin(i + 1) * 0.3), { seed: 1 });
  it.each(FRESH)('%s: the trainer and the evaluator refuse it, by ID and as a renamed copy', (id) => {
    const track = entry(id).track;
    const renamed = { ...track, id: 'my-copy' };
    for (const t of [track, renamed]) {
      expect(() => assertTrainingTrack(t)).toThrow(TrackLeakageError);
      expect(() => assertEvaluationTrack(t)).toThrow(TrackLeakageError);
    }
  });
  it.each(FRESH)('%s: only heldOutTrack hands it over, and only for a frozen model (the track is returned, nothing is run)', (id) => {
    expect(heldOutTrack(id, model)).toBe(entry(id).track);
    expect(() => heldOutTrack(id, { parameters: [1], provenance: {}, id: 'x' } as never)).toThrow(TrackLeakageError);
  });
  it.each(SPENT)('%s (spent by E3): a validation circuit now: the evaluator accepts it, the trainer and heldOutTrack refuse it', (id) => {
    const track = entry(id).track;
    expect(entry(id).split).toBe('validation');
    expect(assertEvaluationTrack(track)).toBe('validation');
    expect(() => assertTrainingTrack(track)).toThrow(TrackLeakageError);
    expect(() => heldOutTrack(id, model)).toThrow(/may only use held-out tracks/);
  });
  it('custom and imported copies of every built-in circuit stay refused with the SAME generic message, naming no circuit and no split', () => {
    const copies = [...FRESH, ...SPENT, 'rounded-rectangle', 's-sweepers', 'stadium-oval'].flatMap((id) => {
      const track = entry(id).track;
      return [classifyCustomTrack(track), classifyCustomTrack({ ...track, id: 'someone-elses', name: 'Mine' })];
    });
    for (const result of copies) expect(result).toEqual({ ok: false, message: RESERVED_LAYOUT_MESSAGE });
    for (const result of copies) {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        for (const word of [...FRESH, ...SPENT, 'held-out', 'validation', 'training']) expect(result.message).not.toContain(word);
      }
    }
  });
});
