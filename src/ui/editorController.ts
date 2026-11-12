// The track editor's interaction logic with no DOM (P4-02): pointer gestures and keyboard commands become operations
// on the pure editor state (src/editor/trackEditor.ts). The page (ui/editorPage.ts) only measures the canvas, reads
// events and draws; everything decided here is tested in Node with plain numbers.
import {
  EDITOR_LIMITS,
  addPoint,
  apply,
  centreLength,
  closeLoop,
  commit,
  createEditorState,
  createHistory,
  cycleSnap as cycleSnapState,
  deletePoint,
  evaluateEditor,
  insertPoint,
  movePoint,
  moveStart,
  nudgePoint,
  redo as redoHistory,
  reopenLoop,
  setGateSpacing,
  setStart,
  setWidth,
  undo as undoHistory,
  type EditResult,
  type EditorHistory,
  type EditorState,
  type EditorStatus,
} from '../editor/trackEditor';
import type { Vec2 } from '../sim/track';

export type EditorMode = 'add' | 'move' | 'delete';

/** How far from the first point a tap, or the crosshair, still counts as "on" it (metres). */
const CROSSHAIR_REACH = 2;

export interface EditorController {
  state(): EditorState;
  history(): EditorHistory;
  status(): EditorStatus;
  mode(): EditorMode;
  setMode(mode: EditorMode): void;
  /** Selected control point, or -1. */
  selected(): number;
  select(index: number): void;
  crosshair(): Vec2;
  /** The latest notice or refusal, in plain words (for the polite live region). */
  message(): string;
  /** Metres along the line from the first point, and the line's length; null before the loop is closed. */
  startInfo(): { offset: number; length: number } | null;
  // Pointer gestures; `reach` is the touch radius converted to metres by the page.
  pointerDown(at: Vec2, reach: number): void;
  pointerMove(at: Vec2): void;
  pointerUp(): void;
  pointerCancel(): void;
  dragging(): boolean;
  // Toolbar.
  undo(): void;
  redo(): void;
  widen(): void;
  narrow(): void;
  moreGates(): void;
  fewerGates(): void;
  cycleSnap(): void;
  close(): void;
  reopen(): void;
  insertAfterSelected(): void;
  deleteSelected(): void;
  clear(): void;
  // Keyboard.
  moveCrosshair(dx: number, dy: number, big: boolean): void;
  crosshairEnter(): void;
  nudgeSelected(dx: number, dy: number, big: boolean): void;
  moveStartBy(delta: number): void;
  moveStartToBeginning(): void;
  moveStartByGates(direction: 1 | -1): void;
  clearSelection(): void;
}

const pointText = (p: Vec2): string => `(${p.x}, ${p.y})`;

/** Distance from p to the segment a-b, and the closest point's parameter. */
function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function createEditorController(initial: EditorHistory = createHistory(createEditorState())): EditorController {
  let history = initial;
  let modeNow: EditorMode = 'add';
  let selected = -1;
  let crosshair: Vec2 = { x: 0, y: 0 };
  let message = '';
  /** During a drag: the state the drag started from, the index moved, and the live state shown. */
  let drag: { base: EditorState; index: number; live: EditorState } | null = null;
  let cache: { state: EditorState; status: EditorStatus } | null = null;

  const state = (): EditorState => drag?.live ?? history.present;
  const status = (): EditorStatus => {
    const s = state();
    if (cache === null || cache.state !== s) cache = { state: s, status: evaluateEditor(s) };
    return cache.status;
  };
  const step = (): number => (state().snap > 0 ? state().snap : 1);

  /** Runs an operation through the history; sets the message to the refusal or to `done`. */
  const run = (result: EditResult, done: string): boolean => {
    const applied = apply(history, result);
    history = applied.history;
    message = applied.message ?? done;
    if (result.ok) selected = Math.min(selected, result.state.points.length - 1);
    return result.ok;
  };

  const nearestIndex = (at: Vec2, reach: number): number => {
    let best = -1;
    let bestDistance = reach;
    state().points.forEach((p, i) => {
      const d = Math.hypot(p.x - at.x, p.y - at.y);
      if (d <= bestDistance) {
        best = i;
        bestDistance = d;
      }
    });
    return best;
  };

  /** The control-polygon segment nearest to a point: the new point goes after segment `i` (to i + 1). */
  const nearestSegment = (at: Vec2): number => {
    const pts = state().points;
    let best = 0;
    let bestDistance = Infinity;
    pts.forEach((p, i) => {
      const d = segmentDistance(at, p, pts[(i + 1) % pts.length]!);
      if (d < bestDistance) {
        best = i;
        bestDistance = d;
      }
    });
    return best;
  };

  const tapAdd = (at: Vec2, reach: number): void => {
    const s = history.present;
    const hit = nearestIndex(at, reach);
    if (!s.closed) {
      if (hit === 0 && s.points.length >= EDITOR_LIMITS.minPoints) {
        run(closeLoop(s), 'Loop closed.');
        return;
      }
      if (hit >= 0) {
        selected = hit;
        message = `Point ${hit + 1} selected.`;
        return;
      }
      const ok = run(addPoint(s, at), '');
      if (ok) {
        selected = history.present.points.length - 1;
        message = `Point ${selected + 1} added at ${pointText(history.present.points[selected]!)}.`;
      }
      return;
    }
    if (hit >= 0) {
      selected = hit;
      message = `Point ${hit + 1} selected.`;
      return;
    }
    const after = nearestSegment(at);
    const ok = run(insertPoint(s, after, at), '');
    if (ok) {
      selected = after + 1;
      message = `Point ${selected + 1} inserted at ${pointText(history.present.points[selected]!)}.`;
    }
  };

  const controller: EditorController = {
    state,
    history: () => history,
    status,
    mode: () => modeNow,
    setMode(mode) {
      modeNow = mode;
      message = mode === 'add' ? 'Add mode: tap to add points.' : mode === 'move' ? 'Move mode: drag a point.' : 'Delete mode: tap a point to remove it.';
    },
    selected: () => selected,
    select(index) {
      selected = index >= 0 && index < state().points.length ? index : -1;
    },
    crosshair: () => crosshair,
    message: () => message,
    startInfo() {
      const s = state();
      const length = s.closed ? centreLength(s) : null;
      return length === null ? null : { offset: s.startOffset, length };
    },
    pointerDown(at, reach) {
      if (drag) return;
      if (modeNow === 'add') {
        tapAdd(at, reach);
      } else if (modeNow === 'move') {
        const hit = nearestIndex(at, reach);
        if (hit < 0) {
          message = 'No point there. Drag from a point to move it.';
          return;
        }
        selected = hit;
        drag = { base: history.present, index: hit, live: history.present };
        message = `Moving point ${hit + 1}.`;
      } else {
        const hit = nearestIndex(at, reach);
        if (hit < 0) {
          message = 'No point there to delete.';
          return;
        }
        if (run(deletePoint(history.present, hit), `Point ${hit + 1} deleted.`)) selected = -1;
      }
    },
    pointerMove(at) {
      if (!drag) return;
      const moved = movePoint(drag.base, drag.index, at);
      // A refused move (too close to a neighbour, or no change) keeps the last good position.
      if (moved.ok) drag = { ...drag, live: moved.state };
    },
    pointerUp() {
      if (!drag) return;
      const { live, index } = drag;
      const changed = live !== drag.base;
      drag = null;
      if (changed) {
        history = commit(history, live);
        message = `Point ${index + 1} moved to ${pointText(live.points[index]!)}.`;
      } else {
        message = '';
      }
    },
    pointerCancel() {
      drag = null;
      message = 'Move cancelled.';
    },
    dragging: () => drag !== null,
    undo() {
      const before = history;
      history = undoHistory(history);
      message = history === before ? 'Nothing to undo.' : 'Undone.';
      selected = Math.min(selected, history.present.points.length - 1);
    },
    redo() {
      const before = history;
      history = redoHistory(history);
      message = history === before ? 'Nothing to redo.' : 'Redone.';
      selected = Math.min(selected, history.present.points.length - 1);
    },
    widen() {
      const s = history.present;
      run(setWidth(s, s.width + EDITOR_LIMITS.widthStep), `Road width ${s.width + EDITOR_LIMITS.widthStep} m.`);
    },
    narrow() {
      const s = history.present;
      run(setWidth(s, s.width - EDITOR_LIMITS.widthStep), `Road width ${s.width - EDITOR_LIMITS.widthStep} m.`);
    },
    moreGates() {
      const s = history.present;
      run(setGateSpacing(s, s.gateSpacing - EDITOR_LIMITS.gateSpacingStep), `Gate spacing ${s.gateSpacing - EDITOR_LIMITS.gateSpacingStep} m.`);
    },
    fewerGates() {
      const s = history.present;
      run(setGateSpacing(s, s.gateSpacing + EDITOR_LIMITS.gateSpacingStep), `Gate spacing ${s.gateSpacing + EDITOR_LIMITS.gateSpacingStep} m.`);
    },
    cycleSnap() {
      history = commit(history, cycleSnapState(history.present));
      const snap = history.present.snap;
      message = snap > 0 ? `Snap ${snap} m.` : 'Snap off.';
    },
    close() {
      run(closeLoop(history.present), 'Loop closed.');
    },
    reopen() {
      run(reopenLoop(history.present), 'Loop reopened: add points at the end, then close it again.');
    },
    insertAfterSelected() {
      if (selected < 0) {
        message = 'Select a point first.';
        return;
      }
      const after = selected;
      if (run(insertPoint(history.present, after), '')) {
        selected = after + 1;
        message = `Point ${selected + 1} inserted after point ${after + 1}.`;
      }
    },
    deleteSelected() {
      if (selected < 0) {
        message = 'Select a point first.';
        return;
      }
      const index = selected;
      if (run(deletePoint(history.present, index), `Point ${index + 1} deleted.`)) selected = Math.min(index, history.present.points.length - 1);
    },
    clear() {
      history = commit(history, createEditorState({ snap: history.present.snap, width: history.present.width, gateSpacing: history.present.gateSpacing }));
      selected = -1;
      message = 'Cleared. Tap to add the first point.';
    },
    moveCrosshair(dx, dy, big) {
      const k = step() * (big ? 5 : 1);
      const area = EDITOR_LIMITS.workArea;
      const next = (v: number, d: number): number => Math.max(-area, Math.min(area, Math.round((v + d * k) * 1000) / 1000));
      crosshair = { x: next(crosshair.x, dx), y: next(crosshair.y, dy) };
      message = `Crosshair at ${pointText(crosshair)}.`;
    },
    crosshairEnter() {
      const s = history.present;
      const hit = nearestIndex(crosshair, CROSSHAIR_REACH);
      if (modeNow === 'move') {
        if (hit < 0) {
          message = 'No point under the crosshair.';
        } else {
          selected = hit;
          message = `Point ${hit + 1} selected.`;
        }
        return;
      }
      if (modeNow === 'delete') {
        if (hit < 0) message = 'No point under the crosshair to delete.';
        else if (run(deletePoint(s, hit), `Point ${hit + 1} deleted.`)) selected = -1;
        return;
      }
      tapAdd(crosshair, CROSSHAIR_REACH);
    },
    nudgeSelected(dx, dy, big) {
      if (selected < 0) {
        message = 'Select a point first.';
        return;
      }
      const k = big ? 5 : 1;
      run(nudgePoint(history.present, selected, dx * k, dy * k), '');
      const p = history.present.points[selected];
      if (p) message = `Point ${selected + 1} at ${pointText(p)}.`;
    },
    moveStartBy(delta) {
      if (run(moveStart(history.present, delta), '')) {
        const info = controller.startInfo();
        message = info ? `Start position, ${Math.round(info.offset)} m along a ${Math.round(info.length)} m line.` : '';
      }
    },
    moveStartToBeginning() {
      if (run(setStart(history.present, 0), '')) {
        const info = controller.startInfo();
        message = info ? `Start position, ${Math.round(info.offset)} m along a ${Math.round(info.length)} m line.` : '';
      }
    },
    moveStartByGates(direction) {
      controller.moveStartBy(direction * history.present.gateSpacing);
    },
    clearSelection() {
      selected = -1;
      message = '';
    },
  };
  return controller;
}
