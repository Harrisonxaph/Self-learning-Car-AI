import { describe, expect, it } from 'vitest';
import { advanceProgress, createProgress } from '../../src/sim/checkpoints';
import {
  EDITOR_LIMITS,
  addPoint,
  apply,
  buildTrack,
  centreLength,
  closeLoop,
  commit,
  createEditorState,
  createHistory,
  cycleSnap,
  deletePoint,
  evaluateEditor,
  insertPoint,
  movePoint,
  moveStart,
  nudgePoint,
  redo,
  reopenLoop,
  setGateSpacing,
  setName,
  setStart,
  setWidth,
  snapPoint,
  undo,
  type EditorState,
} from '../../src/editor/trackEditor';
import type { Vec2 } from '../../src/sim/track';

const circle = (r: number, n = 8, cw = false): Vec2[] =>
  Array.from({ length: n }, (_, i) => {
    const a = ((cw ? -1 : 1) * 2 * Math.PI * i) / n;
    return { x: Math.round(r * Math.cos(a)), y: Math.round(r * Math.sin(a)) };
  });
const FIXTURES: Record<string, Vec2[]> = {
  circle: circle(60),
  oval: Array.from({ length: 10 }, (_, i) => ({ x: Math.round(90 * Math.cos((2 * Math.PI * i) / 10)), y: Math.round(45 * Math.sin((2 * Math.PI * i) / 10)) })),
  'rounded rectangle': [
    { x: -60, y: -30 }, { x: -20, y: -40 }, { x: 20, y: -40 }, { x: 60, y: -30 }, { x: 70, y: 0 }, { x: 60, y: 30 },
    { x: 20, y: 40 }, { x: -20, y: 40 }, { x: -60, y: 30 }, { x: -70, y: 0 },
  ],
  'L shape': [
    { x: -60, y: -60 }, { x: -20, y: -60 }, { x: -20, y: -10 }, { x: 20, y: -10 }, { x: 60, y: -10 },
    { x: 60, y: 40 }, { x: 20, y: 50 }, { x: -60, y: 50 },
  ],
  'long thin loop': [
    { x: -140, y: -20 }, { x: -70, y: -28 }, { x: 0, y: -30 }, { x: 70, y: -28 }, { x: 140, y: -20 },
    { x: 140, y: 20 }, { x: 70, y: 28 }, { x: 0, y: 30 }, { x: -70, y: 28 }, { x: -140, y: 20 },
  ],
};

function closed(points: Vec2[], over: Partial<EditorState> = {}): EditorState {
  let state = createEditorState({ snap: 0, ...over });
  for (const p of points) {
    const r = addPoint(state, p);
    if (!r.ok) throw new Error(r.message);
    state = r.state;
  }
  const c = closeLoop(state);
  if (!c.ok) throw new Error(c.message);
  return c.state;
}

describe('buildTrack and evaluateEditor', () => {
  const both = Object.entries(FIXTURES).flatMap(([name, points]) => [
    [`${name} (as listed)`, points] as const,
    [`${name} (drawn the other way)`, [...points].reverse()] as const,
  ]);
  it.each(both)('%s builds a track the validator accepts and a lap completes through the checkpoint engine', (_n, points) => {
    const status = evaluateEditor(closed([...points]));
    if (status.kind !== 'valid') throw new Error(JSON.stringify(status));
    const track = status.track;
    let progress = createProgress();
    let from = track.start.position;
    const aheadOf = (k: number): Vec2 => {
      const g = track.gates[k]!;
      const dx = g.b.x - g.a.x;
      const dy = g.b.y - g.a.y;
      const len = Math.hypot(dx, dy);
      return { x: (g.a.x + g.b.x) / 2 + (dy / len) * 0.5, y: (g.a.y + g.b.y) / 2 - (dx / len) * 0.5 };
    };
    for (const k of [...track.gates.keys(), 0]) {
      const to = aheadOf(k);
      progress = advanceProgress(progress, from, to, track);
      from = to;
    }
    expect(progress.gatesPassed).toBe(track.gates.length + 1);
    expect(progress.lapTicks.length).toBe(1);
  });

  it('is deterministic and gives the same id for the same drawing', () => {
    const a = buildTrack(closed(FIXTURES.oval!));
    const b = buildTrack(closed(FIXTURES.oval!));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    if ('message' in a) throw new Error(a.message);
    expect(String(a.document.id)).toMatch(/^custom-[0-9a-f]{8}$/);
    const c = buildTrack(closed(FIXTURES.oval!, { width: 14 }));
    if ('message' in c) throw new Error(c.message);
    expect(c.document.id).not.toBe(a.document.id);
  });

  it('reverses a clockwise drawing, says so, and the result is still valid', () => {
    // On a y-down screen, increasing angle is visually clockwise, so circle(…, cw = true) is the counter-clockwise one.
    const ccw = evaluateEditor(closed(circle(60, 8, true)));
    const cw = evaluateEditor(closed(circle(60)));
    expect(ccw.kind === 'valid' && ccw.reversed).toBe(false);
    expect(cw.kind).toBe('valid');
    if (cw.kind === 'valid') {
      expect(cw.reversed).toBe(true);
      expect(cw.message).toContain('clockwise');
    }
  });

  it('moving the start keeps the track valid all the way round', () => {
    let state = closed(FIXTURES['rounded rectangle']!);
    const total = centreLength(state)!;
    for (let s = 0; s < total; s += 37) {
      const r = setStart(state, s);
      if (!r.ok) throw new Error(r.message);
      expect(evaluateEditor(r.state).kind).toBe('valid');
    }
    state = (moveStart(state, -5) as { state: EditorState }).state;
    expect(state.startOffset).toBeCloseTo(total - 5, 2);
    expect(evaluateEditor(state).kind).toBe('valid');
  });

  it('a corner tighter than the road is wide gives a message, not an exception', () => {
    const tight = closed([{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 4 }, { x: 0, y: 4 }], { width: 12 });
    const status = evaluateEditor(tight);
    expect(status.kind).toBe('invalid');
    if (status.kind === 'invalid') expect(status.message.length).toBeGreaterThan(10);
  });

  it('a very small loop is reported as invalid', () => {
    const status = evaluateEditor(closed([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }]));
    expect(status.kind).toBe('invalid');
  });

  it('an open loop is a draft with a plain message, and builds nothing', () => {
    const state = createEditorState();
    expect(evaluateEditor(state).kind).toBe('draft');
    expect('message' in buildTrack(state)).toBe(true);
  });

  it('survives hostile control points without throwing', () => {
    for (const pts of [
      [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0 }],
      [{ x: -150, y: -150 }, { x: 150, y: 150 }, { x: -150, y: 150 }],
      [{ x: 0, y: 0 }, { x: 150, y: 0 }, { x: 0, y: 2 }],
    ]) {
      expect(() => evaluateEditor(closed(pts))).not.toThrow();
    }
  });
});

describe('operations', () => {
  it('adds, refuses duplicates and too-close points, and respects the point limit', () => {
    let s = createEditorState({ snap: 0 });
    s = (addPoint(s, { x: 0, y: 0 }) as { state: EditorState }).state;
    expect(addPoint(s, { x: 1, y: 0 }).ok).toBe(false);
    expect(addPoint(s, { x: 0, y: 0 }).ok).toBe(false);
    for (let i = 1; i < EDITOR_LIMITS.maxPoints; i += 1) {
      const r = addPoint(s, { x: (i % 50) * 3 - 75, y: Math.floor(i / 50) * 3 - 75 + 2 * Math.floor(i / 50) });
      if (!r.ok) throw new Error(`${i}: ${r.message}`);
      s = r.state;
    }
    expect(s.points.length).toBe(EDITOR_LIMITS.maxPoints);
    expect(addPoint(s, { x: 149, y: 149 }).ok).toBe(false);
  });

  it('snaps to the grid, clamps to the working area and tolerates non-finite input', () => {
    const s = createEditorState({ snap: 5 });
    expect(snapPoint(s, { x: 7.4, y: -2.6 })).toEqual({ x: 5, y: -5 });
    expect(snapPoint(createEditorState({ snap: 0.5 }), { x: 1.3, y: 1.8 })).toEqual({ x: 1.5, y: 2 });
    expect(snapPoint(createEditorState({ snap: 0 }), { x: 1.234, y: 9 })).toEqual({ x: 1.234, y: 9 });
    expect(snapPoint(s, { x: 9999, y: -9999 })).toEqual({ x: 150, y: -150 });
    expect(snapPoint(s, { x: Number.NaN, y: Infinity })).toEqual({ x: 0, y: 0 });
  });

  it('cycles snap 0.5, 1, 5, off, then 0.5', () => {
    let s = createEditorState({ snap: 0.5 });
    const seen: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      s = cycleSnap(s);
      seen.push(s.snap);
    }
    expect(seen).toEqual([1, 5, 0, 0.5, 1]);
  });

  it('closing needs three points; delete stops at three when closed; reopen works', () => {
    let s = createEditorState({ snap: 0 });
    s = (addPoint(s, { x: 0, y: 0 }) as { state: EditorState }).state;
    s = (addPoint(s, { x: 20, y: 0 }) as { state: EditorState }).state;
    expect(closeLoop(s).ok).toBe(false);
    s = (addPoint(s, { x: 20, y: 20 }) as { state: EditorState }).state;
    s = (addPoint(s, { x: 0, y: 20 }) as { state: EditorState }).state;
    s = (closeLoop(s) as { state: EditorState }).state;
    expect(addPoint(s, { x: 50, y: 50 }).ok).toBe(false);
    s = (deletePoint(s, 3) as { state: EditorState }).state;
    expect(deletePoint(s, 0).ok).toBe(false);
    s = (reopenLoop(s) as { state: EditorState }).state;
    expect(deletePoint(s, 0).ok).toBe(true);
  });

  it('inserts at a segment midpoint and moves and nudges points', () => {
    let s = closed([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }]);
    s = (insertPoint(s, 0) as { state: EditorState }).state;
    expect(s.points[1]).toEqual({ x: 20, y: 0 });
    expect(insertPoint(s, 99).ok).toBe(false);
    s = (movePoint(s, 1, { x: 20, y: -10 }) as { state: EditorState }).state;
    expect(s.points[1]).toEqual({ x: 20, y: -10 });
    expect(movePoint(s, 1, { x: 20, y: -10 }).ok).toBe(false);
    expect(movePoint(s, 1, { x: 40, y: 0.5 }).ok).toBe(false);
    s = (nudgePoint({ ...s, snap: 5 }, 1, 1, -2) as { state: EditorState }).state;
    expect(s.points[1]).toEqual({ x: 25, y: -20 });
    expect(nudgePoint(s, -1, 1, 0).ok).toBe(false);
  });

  it('width, gate spacing and name stay within their limits', () => {
    const s = createEditorState();
    expect(setWidth(s, 7).ok).toBe(false);
    expect(setWidth(s, 31).ok).toBe(false);
    expect(setWidth(s, Number.NaN).ok).toBe(false);
    expect(setWidth(s, 12).ok).toBe(false);
    expect((setWidth(s, 13) as { state: EditorState }).state.width).toBe(13);
    expect(setGateSpacing(s, 14).ok).toBe(false);
    expect(setGateSpacing(s, 61).ok).toBe(false);
    expect((setGateSpacing(s, 30) as { state: EditorState }).state.gateSpacing).toBe(30);
    expect(setName(s, '   ').ok).toBe(false);
    expect((setName(s, `a\u0000b${'x'.repeat(200)}`) as { state: EditorState }).state.name.length).toBe(EDITOR_LIMITS.maxNameLength);
  });

  it('moveStart is refused until closed and wraps around the line', () => {
    expect(moveStart(createEditorState(), 5).ok).toBe(false);
    const s = closed(FIXTURES.circle!);
    const total = centreLength(s)!;
    const back = moveStart(s, -1) as { state: EditorState };
    expect(back.state.startOffset).toBeCloseTo(total - 1, 2);
    expect(moveStart(s, 0).ok).toBe(false);
  });
});

describe('undo and redo', () => {
  it('undoes and redoes, clears redo on a new edit, ignores refusals, and caps the depth', () => {
    let h = createHistory(createEditorState({ snap: 0 }));
    const first = apply(h, addPoint(h.present, { x: 0, y: 0 }));
    h = first.history;
    expect(first.message).toBeNull();
    ({ history: h } = apply(h, addPoint(h.present, { x: 20, y: 0 })));
    const refused = apply(h, addPoint(h.present, { x: 20, y: 1 }));
    expect(refused.message).not.toBeNull();
    expect(refused.history).toBe(h);
    h = undo(h);
    expect(h.present.points.length).toBe(1);
    h = redo(h);
    expect(h.present.points.length).toBe(2);
    h = undo(h);
    ({ history: h } = apply(h, addPoint(h.present, { x: 0, y: 30 })));
    expect(h.future.length).toBe(0);
    expect(redo(h)).toBe(h);
    expect(undo(createHistory())).toEqual(createHistory());
    let deep = createHistory(createEditorState());
    for (let i = 0; i < EDITOR_LIMITS.undoDepth + 30; i += 1) deep = commit(deep, { ...deep.present, width: 8 + (i % 20) + 0.01 * i });
    expect(deep.past.length).toBe(EDITOR_LIMITS.undoDepth);
  });
});
