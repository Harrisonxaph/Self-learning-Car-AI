// The camera controller's gestures and commands in Node (P4-07): buttons, a one-pointer drag, a two-pointer pinch about its midpoint, the
// wheel about the cursor, follow by elapsed render time with a fake clock, resize, cancel, and hostile input. A seeded, pure check.
import { describe, expect, it } from 'vitest';
import { maxZoom } from '../../src/render/camera';
import { ZOOM_STEP, createCameraController } from '../../src/ui/cameraController';

const BOUNDS = { minX: -300, minY: -100, maxX: 500, maxY: 400 };
function make(width = 900, height = 500) {
  let clock = 0;
  const controller = createCameraController({ bounds: BOUNDS, cssWidth: width, cssHeight: height, now: () => clock });
  return { controller, advance: (ms: number) => (clock += ms) };
}
const close = (a: number, b: number, tol = 1e-6) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(a), Math.abs(b)));
const worldAt = (c: ReturnType<typeof make>['controller'], x: number, y: number) => {
  const v = c.view();
  return { x: (x - v.offsetX) / v.scale, y: (y - v.offsetY) / v.scale };
};

describe('commands', () => {
  it('starts at the whole-track view; Zoom + and Zoom − step by ZOOM_STEP about the middle; Fit returns', () => {
    const { controller } = make();
    expect(controller.atFit()).toBe(true);
    controller.zoomIn();
    close(controller.camera().zoom, ZOOM_STEP);
    expect(controller.atFit()).toBe(false);
    controller.zoomIn();
    close(controller.camera().zoom, ZOOM_STEP * ZOOM_STEP);
    controller.zoomOut();
    close(controller.camera().zoom, ZOOM_STEP);
    controller.fit();
    expect(controller.atFit()).toBe(true);
    controller.zoomOut();
    expect(controller.atFit()).toBe(true);
  });
  it('Follow toggles follow mode on and off (off keeps the zoom); describe says what the view is', () => {
    const { controller } = make();
    expect(controller.describe('the best car')).toBe('Whole track in view.');
    controller.toggleFollow();
    expect(controller.following()).toBe(true);
    expect(controller.describe('the best car')).toMatch(/^Zoom \d\.\d×, following the best car\.$/);
    controller.toggleFollow();
    expect(controller.following()).toBe(false);
    expect(controller.camera().mode).toBe('zoom');
    expect(controller.describe(null)).toMatch(/^Zoom \d\.\d×\.$/);
  });
  it('publishes its state as strings for the browser tests', () => {
    const { controller } = make();
    expect(controller.dataset()).toMatchObject({ cameraMode: 'fit', cameraZoom: '1' });
    controller.zoomIn();
    expect(controller.dataset().cameraMode).toBe('zoom');
  });
  it('setBounds (a new track) returns to the whole-track view and forgets any gesture', () => {
    const { controller } = make();
    controller.zoomIn();
    controller.pointerDown(1, 10, 10);
    controller.setBounds({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
    expect(controller.atFit()).toBe(true);
    expect(controller.pointerMove(1, 20, 20)).toBe(false);
  });
});

describe('gestures', () => {
  it('a one-pointer drag pans by the same number of pixels at a zoom; nothing happens at the whole-track view', () => {
    const { controller } = make();
    expect(controller.pointerMove(1, 5, 5)).toBe(false); // no pointer down
    controller.pointerDown(1, 200, 200);
    controller.pointerMove(1, 260, 230);
    expect(controller.atFit()).toBe(true);
    controller.pointerUp(1);
    for (let i = 0; i < 4; i += 1) controller.zoomIn();
    const under = worldAt(controller, 400, 250);
    controller.pointerDown(2, 400, 250);
    controller.pointerMove(2, 460, 290);
    controller.pointerUp(2);
    const moved = worldAt(controller, 460, 290);
    close(moved.x, under.x, 1e-6);
    close(moved.y, under.y, 1e-6);
  });
  it('a two-pointer pinch zooms about the midpoint (the world point under it stays put) and pans with the midpoint', () => {
    const { controller } = make();
    controller.zoomIn();
    controller.zoomIn();
    const mid = { x: 450, y: 250 };
    const world = worldAt(controller, mid.x, mid.y);
    controller.pointerDown(1, 400, 250);
    controller.pointerDown(2, 500, 250);
    const before = controller.camera().zoom;
    controller.pointerMove(2, 600, 250); // spread 100 -> 200 about a moving midpoint
    expect(controller.camera().zoom).toBeGreaterThan(before);
    // the world point that started under the (original) midpoint is under the new midpoint (500, 250)
    const now = worldAt(controller, 500, 250);
    close(now.x, world.x, 1e-3);
    close(now.y, world.y, 1e-3);
    controller.pointerUp(1);
    controller.pointerUp(2);
    // releasing one finger then dragging with the other pans, with no jump
    const zoom = controller.camera().zoom;
    controller.pointerDown(3, 300, 300);
    controller.pointerMove(3, 310, 300);
    close(controller.camera().zoom, zoom);
  });
  it('a pinch outwards then inwards returns to the starting zoom, and a cancelled pointer leaves a consistent camera', () => {
    const { controller } = make();
    controller.zoomIn();
    const start = controller.camera().zoom;
    controller.pointerDown(1, 300, 250);
    controller.pointerDown(2, 400, 250);
    controller.pointerMove(2, 500, 250);
    controller.pointerMove(2, 400, 250);
    close(controller.camera().zoom, start, 1e-6);
    controller.pointerCancel(2);
    expect(controller.pointerMove(2, 450, 250)).toBe(false);
    controller.pointerCancel(1);
    expect(controller.pointerMove(1, 450, 250)).toBe(false);
  });
  it('a drag in follow mode pauses following (zoom mode)', () => {
    const { controller } = make();
    controller.toggleFollow();
    controller.pointerDown(1, 300, 250);
    controller.pointerMove(1, 320, 250);
    expect(controller.following()).toBe(false);
    expect(controller.camera().mode).toBe('zoom');
  });
  it('the wheel zooms about the cursor (that world point stays under it), up and down, and is limited per event', () => {
    const { controller } = make();
    const cursor = { x: 600, y: 120 };
    const world = worldAt(controller, cursor.x, cursor.y);
    expect(controller.wheel(-100, cursor.x, cursor.y)).toBe(true);
    expect(controller.camera().zoom).toBeGreaterThan(1);
    const now = worldAt(controller, cursor.x, cursor.y);
    close(now.x, world.x, 1e-6);
    close(now.y, world.y, 1e-6);
    const z = controller.camera().zoom;
    controller.wheel(-1e9, cursor.x, cursor.y);
    expect(controller.camera().zoom).toBeLessThanOrEqual(z * 2 + 1e-9);
    controller.wheel(1e9, cursor.x, cursor.y);
    controller.wheel(1e9, cursor.x, cursor.y);
    controller.wheel(1e9, cursor.x, cursor.y);
    expect(controller.atFit()).toBe(true);
    expect(controller.wheel(Number.NaN, 1, 1)).toBe(false);
  });
  it('zoom is capped so a 4 m car is about 40 CSS px long', () => {
    const { controller } = make();
    for (let i = 0; i < 60; i += 1) controller.zoomIn();
    close(controller.camera().zoom, maxZoom(controller.context()), 1e-9);
  });
});

describe('follow by elapsed render time, resize and rotation', () => {
  it('frame() moves a following camera towards the target by elapsed render time and jumps after a long gap', () => {
    const { controller, advance } = make();
    controller.toggleFollow();
    controller.frame({ x: 100, y: 50 }); // first frame: no elapsed time
    const start = { ...controller.camera().centre };
    advance(1000 / 60);
    controller.frame({ x: 100, y: 50 });
    const c1 = controller.camera().centre;
    close(c1.x, start.x + (100 - start.x) * 0.15, 1e-6);
    advance(5000);
    controller.frame({ x: 100, y: 50 });
    expect(controller.camera().centre).toEqual({ x: 100, y: 50 });
  });
  it('frame() does nothing when not following or when there is no target', () => {
    const { controller, advance } = make();
    controller.zoomIn();
    const before = controller.camera();
    advance(16);
    controller.frame({ x: 5, y: 5 });
    expect(controller.camera()).toBe(before);
    controller.toggleFollow();
    const following = controller.camera();
    advance(16);
    controller.frame(null);
    expect(controller.camera()).toEqual(following);
  });
  it('a resize or rotation keeps the world centre and relative zoom, and a followed car stays in view', () => {
    const { controller, advance } = make();
    controller.toggleFollow();
    const car = { x: 200, y: 120 };
    controller.frame(car);
    advance(5000);
    controller.frame(car);
    for (const [w, h] of [[390, 700], [320, 240], [900, 500], [1024, 768]] as const) {
      controller.setCanvas(w, h);
      advance(16);
      controller.frame(car);
      const v = controller.view();
      const x = car.x * v.scale + v.offsetX;
      const y = car.y * v.scale + v.offsetY;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(w);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(h);
    }
  });
  it('a resize or rotation keeps the latest followed target visible even before smoothing has settled', () => {
    const { controller, advance } = make(900, 500);
    controller.frame({ x: 0, y: 0 });
    controller.toggleFollow(); // the camera starts following from far away: the centre lags the target
    const target = { x: 400, y: 330 };
    advance(16);
    controller.frame(target);
    for (const [w, h] of [[390, 700], [700, 390], [320, 568], [568, 320], [900, 500]] as const) {
      controller.setCanvas(w, h);
      const v = controller.view();
      const x = target.x * v.scale + v.offsetX;
      const y = target.y * v.scale + v.offsetY;
      expect(x, `${w}x${h} x`).toBeGreaterThanOrEqual(0);
      expect(x, `${w}x${h} x`).toBeLessThanOrEqual(w);
      expect(y, `${w}x${h} y`).toBeGreaterThanOrEqual(0);
      expect(y, `${w}x${h} y`).toBeLessThanOrEqual(h);
      advance(16);
      controller.frame(target);
    }
    // switching to another target (champion B) while the camera lags keeps that one visible after the next resize too
    const other = { x: -250, y: -60 };
    controller.frame(other);
    controller.setCanvas(390, 700);
    const v = controller.view();
    expect(other.x * v.scale + v.offsetX).toBeGreaterThanOrEqual(0);
    expect(other.x * v.scale + v.offsetX).toBeLessThanOrEqual(390);
  });
  it("the reported lagging case: a target visible at 900x500 stays visible after a resize to 390x700 (a plain resize loses it)", () => {
    let clock = 0;
    const square = { minX: -100, minY: -100, maxX: 100, maxY: 100 };
    const controller = createCameraController({ bounds: square, cssWidth: 900, cssHeight: 500, now: () => clock });
    const target = { x: 48, y: 0 };
    controller.frame(target);
    controller.zoomIn();
    controller.zoomIn();
    controller.zoomIn();
    controller.toggleFollow();
    clock += 16;
    controller.frame(target);
    const at = (w: number, h: number) => {
      const v = controller.view();
      const x = target.x * v.scale + v.offsetX;
      const y = target.y * v.scale + v.offsetY;
      return x >= 0 && x <= w && y >= 0 && y <= h;
    };
    expect(at(900, 500)).toBe(true);
    controller.setCanvas(390, 700);
    expect(at(390, 700)).toBe(true); // immediately, before any further frame
    clock += 16;
    controller.frame(target);
    expect(at(390, 700)).toBe(true);
    controller.setCanvas(700, 390);
    expect(at(700, 390)).toBe(true);
  });
  it('never throws on hostile numbers', () => {
    const { controller } = make();
    for (const v of [Number.NaN, Infinity, -Infinity, 1e308, -1e308, 0]) {
      expect(() => {
        controller.pointerDown(1, v, v);
        controller.pointerMove(1, v, 0);
        controller.pointerUp(1);
        controller.wheel(v, v, v);
        controller.setCanvas(v, v);
        controller.frame({ x: v, y: v });
        controller.view();
        controller.describe(null);
      }).not.toThrow();
    }
  });
});
