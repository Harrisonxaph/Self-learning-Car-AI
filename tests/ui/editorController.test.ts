import { describe, expect, it } from 'vitest';
import { createEditorController, type EditorController } from '../../src/ui/editorController';
import { createEditorState, createHistory } from '../../src/editor/trackEditor';

const tap = (c: EditorController, x: number, y: number, reach = 3): void => {
  c.pointerDown({ x, y }, reach);
  c.pointerUp();
};
const loop = (c: EditorController): void => {
  for (const [x, y] of [[-60, -30], [0, -40], [60, -30], [70, 0], [60, 30], [0, 40], [-60, 30], [-70, 0]] as const) tap(c, x, y);
  tap(c, -60, -30); // the first point again closes the loop
};
const fresh = () => createEditorController(createHistory(createEditorState({ snap: 1 })));

describe('pointer gestures', () => {
  it('tap adds points, a tap on the first point closes the loop, and the result is valid', () => {
    const c = fresh();
    loop(c);
    expect(c.state().closed).toBe(true);
    expect(c.state().points.length).toBe(8);
    expect(c.status().kind).toBe('valid');
    expect(c.message()).toBe('Loop closed.');
  });
  it('a tap on the first point with fewer than three points selects it instead of closing', () => {
    const c = fresh();
    tap(c, 0, 0);
    tap(c, 20, 0);
    tap(c, 0, 0);
    expect(c.state().closed).toBe(false);
    expect(c.selected()).toBe(0);
  });
  it('once closed, a tap on empty road inserts a point on the nearest segment', () => {
    const c = fresh();
    loop(c);
    tap(c, 30, -50);
    expect(c.state().points.length).toBe(9);
    expect(c.state().points[2]).toEqual({ x: 30, y: -50 });
  });
  it('Move mode drags one point live and commits one undo step on release; a cancelled drag changes nothing', () => {
    const c = fresh();
    loop(c);
    c.setMode('move');
    const before = c.history().past.length;
    c.pointerDown({ x: 1, y: -39 }, 3);
    c.pointerMove({ x: 5, y: -45 });
    c.pointerMove({ x: 10, y: -50 });
    expect(c.dragging()).toBe(true);
    expect(c.state().points[1]).toEqual({ x: 10, y: -50 });
    expect(c.history().present.points[1]).toEqual({ x: 0, y: -40 });
    c.pointerUp();
    expect(c.history().present.points[1]).toEqual({ x: 10, y: -50 });
    expect(c.history().past.length).toBe(before + 1);
    c.pointerDown({ x: 10, y: -50 }, 3);
    c.pointerMove({ x: 30, y: -70 });
    c.pointerCancel();
    expect(c.state().points[1]).toEqual({ x: 10, y: -50 });
    expect(c.history().past.length).toBe(before + 1);
  });
  it('a drag that ends where it started (or only makes refused moves) records nothing', () => {
    const c = fresh();
    loop(c);
    c.setMode('move');
    const before = c.history();
    c.pointerDown({ x: 0, y: -40 }, 3);
    c.pointerMove({ x: 0, y: -40 });
    c.pointerMove({ x: 60, y: -31 }); // within 2 m of the next point: refused
    c.pointerUp();
    expect(c.history()).toBe(before);
    expect(c.message()).toBe('');
  });
  it('Move mode with nothing in reach does nothing', () => {
    const c = fresh();
    loop(c);
    c.setMode('move');
    c.pointerDown({ x: 100, y: 100 }, 3);
    expect(c.dragging()).toBe(false);
    expect(c.message()).toContain('No point there');
  });
  it('Delete mode removes a tapped point, stops at three, and undo restores it', () => {
    const c = fresh();
    loop(c);
    c.setMode('delete');
    tap(c, 0, -40);
    expect(c.state().points.length).toBe(7);
    c.undo();
    expect(c.state().points.length).toBe(8);
    c.redo();
    expect(c.state().points.length).toBe(7);
    for (const [x, y] of [[60, -30], [70, 0], [60, 30]] as const) tap(c, x, y);
    expect(c.state().points.length).toBe(4);
    tap(c, 0, 40);
    expect(c.state().points.length).toBe(3);
    tap(c, -60, 30);
    expect(c.state().points.length).toBe(3);
    expect(c.message()).toContain('at least 3');
  });
});

describe('toolbar', () => {
  it('width, gate spacing and snap change the state and stop at their limits with a message', () => {
    const c = fresh();
    loop(c);
    c.widen();
    expect(c.state().width).toBe(13);
    for (let i = 0; i < 30; i += 1) c.widen();
    expect(c.state().width).toBe(30);
    expect(c.message()).toContain('widest');
    c.moreGates();
    expect(c.state().gateSpacing).toBe(20);
    c.moreGates();
    c.moreGates();
    expect(c.state().gateSpacing).toBe(15);
    expect(c.message()).toContain('as close');
    c.cycleSnap();
    expect(c.state().snap).toBe(5);
  });
  it('a width that makes a corner too tight gives a readable message and no valid track; narrowing fixes it', () => {
    const c = fresh();
    for (const [x, y] of [[0, 0], [60, 0], [60, 12], [0, 12]] as const) tap(c, x, y);
    c.close();
    for (let i = 0; i < 10; i += 1) c.widen();
    expect(c.status().kind).toBe('invalid');
    for (let i = 0; i < 25; i += 1) c.narrow();
    expect(c.state().width).toBe(8);
  });
  it('undo and redo report when there is nothing to do', () => {
    const c = fresh();
    c.undo();
    expect(c.message()).toBe('Nothing to undo.');
    c.redo();
    expect(c.message()).toBe('Nothing to redo.');
  });
  it('clear starts a new draft but keeps the settings, and is undoable', () => {
    const c = fresh();
    loop(c);
    c.widen();
    c.clear();
    expect(c.state().points.length).toBe(0);
    expect(c.state().width).toBe(13);
    c.undo();
    expect(c.state().points.length).toBe(8);
  });
});

describe('keyboard model', () => {
  it('builds and closes a loop with the crosshair alone', () => {
    const c = fresh();
    const goto = (x: number, y: number): void => {
      const cur = c.crosshair();
      for (let i = 0; i < Math.abs(x - cur.x) / 5; i += 1) c.moveCrosshair(Math.sign(x - cur.x), 0, true);
      for (let i = 0; i < Math.abs(y - cur.y) / 5; i += 1) c.moveCrosshair(0, Math.sign(y - cur.y), true);
    };
    for (const [x, y] of [[-60, -30], [0, -40], [60, -30], [70, 0], [60, 30], [0, 40], [-60, 30], [-70, 0]] as const) {
      goto(x, y);
      c.crosshairEnter();
    }
    goto(-60, -30);
    c.crosshairEnter();
    expect(c.state().closed).toBe(true);
    expect(c.status().kind).toBe('valid');
  });
  it('arrow keys move the crosshair by the snap step, Shift by five, and clamp to the area', () => {
    const c = fresh();
    c.moveCrosshair(1, 0, false);
    expect(c.crosshair()).toEqual({ x: 1, y: 0 });
    c.moveCrosshair(0, 1, true);
    expect(c.crosshair()).toEqual({ x: 1, y: 5 });
    for (let i = 0; i < 100; i += 1) c.moveCrosshair(1, 0, true);
    expect(c.crosshair().x).toBe(150);
  });
  it('selects a point under the crosshair in Move mode only, nudges it, inserts after it and deletes it', () => {
    const c = fresh();
    loop(c);
    c.setMode('move');
    for (let i = 0; i < 12; i += 1) c.moveCrosshair(1, 0, true);
    for (let i = 0; i < 6; i += 1) c.moveCrosshair(0, -1, true);
    c.crosshairEnter();
    expect(c.selected()).toBe(2);
    c.nudgeSelected(1, 0, true);
    expect(c.state().points[2]).toEqual({ x: 65, y: -30 });
    c.insertAfterSelected();
    expect(c.state().points.length).toBe(9);
    expect(c.selected()).toBe(3);
    c.deleteSelected();
    expect(c.state().points.length).toBe(8);
    c.clearSelection();
    c.deleteSelected();
    expect(c.message()).toBe('Select a point first.');
  });
  it('moves the start along the line, announces it, wraps, and keeps the track valid', () => {
    const c = fresh();
    loop(c);
    c.moveStartBy(1);
    const first = c.startInfo()!;
    expect(first.offset).toBeCloseTo(1, 2);
    expect(c.message()).toMatch(/^Start position, 1 m along a \d+ m line\.$/);
    c.moveStartBy(-10);
    expect(c.startInfo()!.offset).toBeCloseTo(first.length - 9, 1);
    c.moveStartByGates(1);
    expect(c.startInfo()!.offset).toBeCloseTo(16, 1);
    c.moveStartToBeginning();
    expect(c.startInfo()!.offset).toBe(0);
    expect(c.status().kind).toBe('valid');
  });
  it('start moves are refused before the loop is closed', () => {
    const c = fresh();
    c.moveStartBy(1);
    expect(c.message()).toContain('Close the loop');
    expect(c.startInfo()).toBeNull();
  });
});
