// P4-03: evaluating a saved model on a saved custom track. The track comes from the (injected) custom source; held-out circuits and
// built-in IDs stay refused; entries for custom tracks are checked against the saved track while it is saved and structurally after.
import { describe, expect, it } from 'vitest';
import { addPoint, buildTrack, closeLoop, createEditorState } from '../../src/editor/trackEditor';
import { validateEvaluationEntry, type EvaluationEntry } from '../../src/persistence/evaluationEntry';
import { loadTrack, type Track, type Vec2 } from '../../src/sim/track';
import { BUILT_IN_TRACK_SPLITS, RESERVED_LAYOUT_MESSAGE, TrackLeakageError, trackGeometryHash } from '../../src/training/trackSplits';
import { entryContext, evaluateModelOnCircuit, replayEntry, resolveCircuit, startEvaluationJob, type CustomSource } from '../../src/ui/modelEvaluation';
import { OPTIONS, makeModel } from '../helpers/evaluationFixtures';

const ring = (rx: number, ry: number, n = 10): Vec2[] => Array.from({ length: n }, (_, i) => ({ x: Math.round(rx * Math.cos((2 * Math.PI * i) / n)), y: Math.round(ry * Math.sin((2 * Math.PI * i) / n)) }));
function custom(rx = 90, ry = 45): Track {
  let state = createEditorState({ snap: 0 });
  for (const p of ring(rx, ry)) {
    const r = addPoint(state, p);
    if (!r.ok) throw new Error(r.message);
    state = r.state;
  }
  const c = closeLoop(state);
  if (!c.ok) throw new Error(c.message);
  const built = buildTrack(c.state);
  if ('message' in built) throw new Error(built.message);
  return loadTrack(built.document);
}
const model = makeModel(5, 'cu-1');
const TRACK = custom();
const source = (...tracks: Track[]): CustomSource => (id) => tracks.find((t) => t.id === id) ?? null;
const run = (track: Track = TRACK, tracks: Track[] = [TRACK]): EvaluationEntry => {
  const r = evaluateModelOnCircuit(model, track.id, { ...OPTIONS, customTracks: source(...tracks) });
  if (!r.ok) throw new Error(r.message);
  return r.entry;
};

describe('evaluating on a saved custom track', () => {
  it('records a custom-split entry with the track identity and its geometry hash, and validates it', () => {
    const entry = run();
    expect(entry.track).toEqual({ id: TRACK.id, version: TRACK.version, split: 'custom', contentHash: trackGeometryHash(TRACK) });
    expect(entry.rows).toHaveLength(5);
    expect(entry.starts).toHaveLength(5);
    expect(validateEvaluationEntry(entry, entryContext(model, source(TRACK))).ok).toBe(true);
  });

  it('is deterministic: twice gives identical entries but for recordedAt, and the entry replays row for row', () => {
    const a = run();
    const b = { ...run(), recordedAt: a.recordedAt };
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(replayEntry(a, model, { ...OPTIONS, customTracks: source(TRACK) })).toEqual({ identical: true, differences: [] });
  });

  it('runs in bounded slices with the same result as one long run', () => {
    const started = startEvaluationJob(model, TRACK.id, { ...OPTIONS, customTracks: source(TRACK) });
    if (!started.ok) throw new Error(started.message);
    let slices = 0;
    while (!started.job.done()) {
      started.job.step(50);
      slices += 1;
    }
    expect(slices).toBeGreaterThan(5);
    const sliced = started.job.result();
    expect(sliced).toEqual({ ok: true, entry: run() });
  });

  it('without a custom source only built-in circuits resolve; the saved track is "not a circuit"', () => {
    const r = evaluateModelOnCircuit(model, TRACK.id, OPTIONS);
    expect(r).toMatchObject({ ok: false });
    expect((r as { message: string }).message).toMatch(/not a training or validation circuit/);
  });

  it('every other ID is refused, and no episode runs: unknown, built-in held-out, and a held-out ID returned by a hostile source', () => {
    for (const heldOut of BUILT_IN_TRACK_SPLITS.tracks.filter((t) => t.split === 'held-out')) {
      let episodes = 0;
      for (const customTracks of [undefined, source(TRACK), () => heldOut.track, () => ({ ...heldOut.track, id: 'x' })]) {
        const r = evaluateModelOnCircuit(model, heldOut.id, { ...OPTIONS, customTracks, onEpisode: () => (episodes += 1) });
        expect(r.ok).toBe(false);
      }
      const copy = evaluateModelOnCircuit(model, 'my-copy', { ...OPTIONS, customTracks: () => ({ ...heldOut.track, id: 'my-copy' }), onEpisode: () => (episodes += 1) });
      expect(copy).toEqual({ ok: false, message: RESERVED_LAYOUT_MESSAGE });
      expect(episodes).toBe(0);
    }
    expect(() => resolveCircuit('nope', source(TRACK))).toThrow(TrackLeakageError);
    expect(() => resolveCircuit(TRACK.id, () => ({ ...TRACK, id: 'something-else' }))).toThrow(TrackLeakageError);
  });
});

describe('entries for custom tracks while the track is saved, and after', () => {
  const ctx = (...tracks: Track[]) => entryContext(model, source(...tracks));
  const tamper = (mutate: (e: Record<string, any>) => void): EvaluationEntry => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const e = JSON.parse(JSON.stringify(run())) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    mutate(e);
    return e as unknown as EvaluationEntry;
  };
  const errors = (e: EvaluationEntry, c = ctx(TRACK)): string => {
    const r = validateEvaluationEntry(e, c);
    return r.ok ? '' : r.errors.join(' ');
  };

  it('with the track saved, an altered hash or version, a start off the derived pose and a wrong gate count are refused', () => {
    expect(errors(tamper((e) => { e.track.contentHash = `sha256:${'1'.repeat(64)}`; }))).toMatch(/does not match the saved custom track/);
    expect(errors(tamper((e) => { e.track.version = '2'; }))).toMatch(/does not match the saved custom track/);
    expect(errors(tamper((e) => { e.starts[1].y += 0.3; }))).toMatch(/not the start the protocol derives/);
    expect(errors(tamper((e) => { e.rows[2].gates = 99; e.rows[2].orderedProgress = e.rows[2].gatesPassed / 99; }))).toMatch(/gate count/);
  });

  it('after the track is deleted, the entry is still valid structurally; start bounds and the rest of the protocol still apply', () => {
    const entry = run();
    expect(validateEvaluationEntry(entry, ctx()).ok).toBe(true);
    expect(validateEvaluationEntry(entry, entryContext(model)).ok).toBe(true);
    expect(errors(tamper((e) => { e.starts[1].lateralMetres = 5; }), ctx())).toMatch(/outside the protocol's start bounds/);
    expect(errors(tamper((e) => { e.rows.length = 3; }), ctx())).toMatch(/exactly 5 items/);
    expect(errors(tamper((e) => { e.rows[0].laps = 0; e.rows[0].outcome = 'completed'; }), ctx())).not.toBe('');
  });

  it('a different track saved later under the same id refuses the old entry (it is for another layout)', () => {
    const entry = run();
    const other = { ...custom(120, 60), id: TRACK.id };
    expect(errors(entry, ctx(other))).toMatch(/does not match the saved custom track/);
  });

  it('a custom entry may not use a built-in circuit ID, and an unknown split is still refused', () => {
    expect(errors(tamper((e) => { e.track.id = 'kidney-loop'; }))).toMatch(/built-in circuit's ID/);
    expect(errors(tamper((e) => { e.track.split = 'held-out'; }))).toMatch(/never evaluated here/);
    expect(errors(tamper((e) => { e.track.split = 'unregistered'; }))).toMatch(/never evaluated here/);
  });

  it('an entry for another champion is refused as for a built-in circuit', () => {
    const entry = run();
    expect(validateEvaluationEntry(entry, entryContext(makeModel(9, 'cu-2'), source(TRACK))).ok).toBe(false);
  });

  it('entries for built-in circuits validate exactly as before, with or without a custom source', () => {
    const r = evaluateModelOnCircuit(model, 'kidney-loop', OPTIONS);
    if (!r.ok) throw new Error(r.message);
    expect(validateEvaluationEntry(r.entry, entryContext(model, source(TRACK))).ok).toBe(true);
    expect(validateEvaluationEntry(r.entry, entryContext(model)).ok).toBe(true);
    const forged = JSON.parse(JSON.stringify(r.entry)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    forged.track.split = 'custom';
    expect(validateEvaluationEntry(forged, entryContext(model, source(TRACK))).ok).toBe(false);
  });
});
