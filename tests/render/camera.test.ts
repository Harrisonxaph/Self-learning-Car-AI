// The P4-07 camera: a pure, headless view transform. Checked against hand calculations: exact fit, a zoom that keeps its anchor fixed at
// two canvas sizes, clamps, panning in metres, follow by ELAPSED time (the same result at 30, 60, 120 and 144 Hz), snap after a pause,
// resize and rotation, the best-car chooser and the followed car's slot inside the drawing cap. Never throws on hostile numbers.
import { describe, expect, it } from 'vitest';
import {
  CAR_PIXELS_AT_MAX_ZOOM,
  FOLLOW_ALPHA_60,
  FOLLOW_DEFAULT_ZOOM,
  MAX_SCALE_PIXELS_PER_METRE,
  bestCarIndex,
  fitCamera,
  follow,
  isVisible,
  maxZoom,
  panBy,
  resized,
  setMode,
  viewOf,
  withFollowedSlot,
  zoomBy,
  type Camera,
  type CameraContext,
} from '../../src/render/camera';
import { fitBounds, trackMargin } from '../../src/render/trackView';

const BOUNDS = { minX: -300, minY: -100, maxX: 500, maxY: 400 };
const ctx = (cssWidth: number, cssHeight: number, bounds = BOUNDS): CameraContext => ({ bounds, cssWidth, cssHeight });
const LANDSCAPE = ctx(900, 500);
const PORTRAIT = ctx(390, 700);
const close = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(a), Math.abs(b)));

describe('viewOf', () => {
  it('at fit is EXACTLY fitBounds, for several canvas sizes and aspect ratios', () => {
    for (const [w, h] of [[900, 500], [390, 700], [320, 320], [1920, 1080], [50, 2000]] as const) {
      const context = ctx(w, h);
      expect(viewOf(fitCamera(BOUNDS), context)).toEqual(fitBounds(BOUNDS, w, h, trackMargin(w, h)));
    }
  });
  it('a canvas too small to hold anything, or no size, gives scale 0 and never throws', () => {
    expect(viewOf(fitCamera(BOUNDS), ctx(10, 10)).scale).toBe(0);
    for (const bad of [ctx(0, 0), ctx(-5, 100), ctx(Number.NaN, 100), ctx(100, Infinity), ctx(100, 100, { minX: 1, minY: 1, maxX: 1, maxY: 1 })]) {
      expect(() => viewOf(fitCamera(BOUNDS), bad)).not.toThrow();
      expect(viewOf(fitCamera(BOUNDS), bad).scale).toBe(0);
    }
  });
  it('zoomed, the scale is the fit scale times the zoom and the centre sits at the middle of the canvas', () => {
    const base = viewOf(fitCamera(BOUNDS), LANDSCAPE);
    const cam: Camera = { mode: 'zoom', zoom: 3, centre: { x: 100, y: 50 } };
    const view = viewOf(cam, LANDSCAPE);
    close(view.scale, base.scale * 3);
    close(100 * view.scale + view.offsetX, LANDSCAPE.cssWidth / 2);
    close(50 * view.scale + view.offsetY, LANDSCAPE.cssHeight / 2);
  });
  it('is deterministic, and clamps an out-of-range camera instead of misdrawing', () => {
    const cam: Camera = { mode: 'zoom', zoom: 1e9, centre: { x: 1e12, y: -1e12 } };
    const view = viewOf(cam, LANDSCAPE);
    expect(view).toEqual(viewOf(cam, LANDSCAPE));
    close(view.scale, MAX_SCALE_PIXELS_PER_METRE);
    expect(viewOf({ mode: 'zoom', zoom: Number.NaN, centre: { x: Number.NaN, y: 0 } }, LANDSCAPE).scale).toBeGreaterThan(0);
  });
});

describe('maxZoom', () => {
  it('shows a 4 m car about 40 CSS px long at the largest zoom, and is never below 1', () => {
    const base = viewOf(fitCamera(BOUNDS), LANDSCAPE).scale;
    close(maxZoom(LANDSCAPE) * base * 4, CAR_PIXELS_AT_MAX_ZOOM);
    expect(maxZoom(ctx(10, 10))).toBe(1);
    // a track already larger than that on screen cannot zoom in
    expect(maxZoom(ctx(900, 500, { minX: 0, minY: 0, maxX: 20, maxY: 10 }))).toBe(1);
  });
});

describe('zoomBy keeps the world point under its screen anchor fixed, at two canvas sizes', () => {
  for (const context of [LANDSCAPE, PORTRAIT]) {
    it(`${context.cssWidth}x${context.cssHeight}`, () => {
      const start = fitCamera(BOUNDS);
      for (const anchor of [{ x: 100, y: 100 }, { x: context.cssWidth / 2, y: context.cssHeight / 2 }, { x: context.cssWidth - 20, y: 30 }]) {
        let camera = start;
        for (const factor of [1.5, 2, 1.25, 0.8, 3]) {
          const before = viewOf(camera, context);
          const world = { x: (anchor.x - before.offsetX) / before.scale, y: (anchor.y - before.offsetY) / before.scale };
          const next = zoomBy(camera, factor, anchor, context);
          const after = viewOf(next, context);
          const stillThere = { x: world.x * after.scale + after.offsetX, y: world.y * after.scale + after.offsetY };
          // the anchor stays fixed unless the zoom was clamped at an end or the centre had to be clamped into the bounds
          if (next.zoom > 1 && next.zoom < maxZoom(context) && next.zoom === Math.min(maxZoom(context), camera.zoom * factor)) {
            const centreClamped = next.centre.x === BOUNDS.minX || next.centre.x === BOUNDS.maxX || next.centre.y === BOUNDS.minY || next.centre.y === BOUNDS.maxY;
            if (!centreClamped) {
              close(stillThere.x, anchor.x, 1e-6);
              close(stillThere.y, anchor.y, 1e-6);
            }
          }
          camera = next;
        }
        expect(camera.zoom).toBeGreaterThan(1);
      }
    });
  }
  it('clamps at both ends: never below 1 (back to fit) and never above the maximum', () => {
    const anchor = { x: 450, y: 250 };
    expect(zoomBy(fitCamera(BOUNDS), 0.1, anchor, LANDSCAPE)).toEqual(fitCamera(BOUNDS));
    const big = zoomBy(fitCamera(BOUNDS), 1e9, anchor, LANDSCAPE);
    close(big.zoom, maxZoom(LANDSCAPE));
    expect(big.mode).toBe('zoom');
    const back = zoomBy(big, 1e-9, anchor, LANDSCAPE);
    expect(back).toEqual(fitCamera(BOUNDS));
  });
  it('non-finite or invalid input returns the same camera', () => {
    const cam = fitCamera(BOUNDS);
    for (const [factor, anchor] of [[Number.NaN, { x: 1, y: 1 }], [0, { x: 1, y: 1 }], [-2, { x: 1, y: 1 }], [Infinity, { x: 1, y: 1 }], [2, { x: Number.NaN, y: 1 }], [2, null as never]] as const) {
      expect(zoomBy(cam, factor, anchor, LANDSCAPE)).toBe(cam);
    }
  });
});

describe('panBy', () => {
  const zoomed: Camera = { mode: 'zoom', zoom: 4, centre: { x: 100, y: 100 } };
  it('converts screen pixels to metres with the current scale, so the same drag is a different distance at two canvas sizes', () => {
    for (const context of [LANDSCAPE, PORTRAIT]) {
      const scale = viewOf(zoomed, context).scale;
      const panned = panBy(zoomed, 40, -20, context);
      close(panned.centre.x, 100 - 40 / scale);
      close(panned.centre.y, 100 + 20 / scale);
    }
    expect(panBy(zoomed, 40, 0, LANDSCAPE).centre.x).not.toBeCloseTo(panBy(zoomed, 40, 0, PORTRAIT).centre.x, 6);
  });
  it('does nothing at the whole-track view, and clamps the centre so the track never leaves the view', () => {
    const fit = fitCamera(BOUNDS);
    expect(panBy(fit, 100, 100, LANDSCAPE)).toBe(fit);
    const far = panBy(zoomed, -1e12, 1e12, LANDSCAPE);
    expect(far.centre.x).toBe(BOUNDS.maxX);
    expect(far.centre.y).toBe(BOUNDS.minY);
  });
  it('a drag in follow mode pauses following (zoom mode); non-finite input is ignored', () => {
    const following: Camera = { ...zoomed, mode: 'follow' };
    expect(panBy(following, 10, 10, LANDSCAPE).mode).toBe('zoom');
    expect(panBy(zoomed, Number.NaN, 1, LANDSCAPE)).toBe(zoomed);
  });
});

describe('follow smooths by ELAPSED time, not by frame count', () => {
  const start: Camera = { mode: 'follow', zoom: 4, centre: { x: 0, y: 0 } };
  const target = { x: 200, y: 100 };
  const run = (schedule: readonly number[]): Camera => schedule.reduce((c, dt) => follow(c, target, dt, LANDSCAPE), start);
  const steps = (hz: number, seconds: number): number[] => Array.from({ length: Math.round(hz * seconds) }, () => 1 / hz);
  it('one 60 Hz frame covers FOLLOW_ALPHA_60 of the distance', () => {
    const one = follow(start, target, 1 / 60, LANDSCAPE);
    close(one.centre.x, 200 * FOLLOW_ALPHA_60);
    close(one.centre.y, 100 * FOLLOW_ALPHA_60);
  });
  it('equal elapsed time gives the same centre at 30, 60, 120 and 144 Hz and under an irregular schedule', () => {
    const reference = run(steps(60, 1));
    for (const hz of [30, 120, 144, 240]) {
      const at = run(steps(hz, 1));
      close(at.centre.x, reference.centre.x, 1e-9);
      close(at.centre.y, reference.centre.y, 1e-9);
    }
    const irregular = run([1 / 60, 1 / 30, 1 / 120, 1 / 120, 0.05, 1 / 60, 0.0125, 1 / 40, 1 / 60, 0.03, 0.0083333333333, 1 / 20]);
    const total = [1 / 60, 1 / 30, 1 / 120, 1 / 120, 0.05, 1 / 60, 0.0125, 1 / 40, 1 / 60, 0.03, 0.0083333333333, 1 / 20].reduce((a, b) => a + b, 0);
    const steady = run(Array.from({ length: 60 * 8 }, () => total / (60 * 8)));
    close(irregular.centre.x, steady.centre.x, 1e-6);
    close(irregular.centre.y, steady.centre.y, 1e-6);
  });
  it('dt is made finite and clamped; an elapsed time of 0.5 s or more snaps to the target', () => {
    const base = follow(start, target, 0.1, LANDSCAPE);
    expect(follow(start, target, 0.4, LANDSCAPE)).toEqual(base); // clamped to 0.1 s
    expect(follow(start, target, 0.49, LANDSCAPE)).toEqual(base);
    for (const bad of [Number.NaN, -1, -Infinity]) expect(follow(start, target, bad, LANDSCAPE)).toEqual(follow(start, target, 0, LANDSCAPE));
    expect(follow(start, target, 0.5, LANDSCAPE).centre).toEqual(target);
    expect(follow(start, target, 5, LANDSCAPE).centre).toEqual(target);
    expect(follow(start, target, Infinity, LANDSCAPE).centre).toEqual(follow(start, target, 0, LANDSCAPE).centre);
  });
  it('settles on the target, ignores a non-following camera and an invalid target', () => {
    const settled = run(steps(60, 10));
    close(settled.centre.x, 200, 1e-6);
    const zoomed: Camera = { ...start, mode: 'zoom' };
    expect(follow(zoomed, target, 0.016, LANDSCAPE)).toBe(zoomed);
    expect(follow(start, { x: Number.NaN, y: 0 }, 0.016, LANDSCAPE)).toBe(start);
    expect(follow(start, null as never, 0.016, LANDSCAPE)).toBe(start);
  });
});

describe('modes, resize and rotation', () => {
  it('setMode: fit is the whole track; follow from the whole-track view raises the zoom; zoom keeps the view', () => {
    const fit = fitCamera(BOUNDS);
    expect(setMode(fit, 'zoom', LANDSCAPE)).toBe(fit);
    const following = setMode(fit, 'follow', LANDSCAPE);
    expect(following.mode).toBe('follow');
    close(following.zoom, Math.min(maxZoom(LANDSCAPE), FOLLOW_DEFAULT_ZOOM));
    expect(setMode(following, 'fit', LANDSCAPE)).toEqual(fit);
    const zoomed: Camera = { mode: 'follow', zoom: 6, centre: { x: 5, y: 5 } };
    expect(setMode(zoomed, 'zoom', LANDSCAPE)).toMatchObject({ mode: 'zoom', zoom: 6, centre: { x: 5, y: 5 } });
  });
  it('a resize or rotation keeps the world centre and relative zoom and recomputes the view; a followed car stays visible', () => {
    const car = { x: 320, y: 140 };
    let camera: Camera = { mode: 'follow', zoom: 5, centre: car };
    for (const context of [LANDSCAPE, PORTRAIT, ctx(320, 240), ctx(1024, 768)]) {
      camera = resized(camera, context);
      expect(camera.zoom).toBeLessThanOrEqual(maxZoom(context));
      expect(camera.centre).toEqual(car);
      expect(isVisible(camera, context, car)).toBe(true);
      camera = follow(camera, car, 1 / 60, context);
      expect(isVisible(camera, context, car)).toBe(true);
    }
    expect(resized(fitCamera(BOUNDS), PORTRAIT)).toEqual(fitCamera(BOUNDS));
  });
  it('never throws on hostile numbers', () => {
    const weird = [Number.NaN, Infinity, -Infinity, 1e308, -1e308, 0, -0, 5e-324];
    for (const a of weird) {
      for (const b of weird) {
        const cam: Camera = { mode: 'follow', zoom: a, centre: { x: b, y: a } };
        expect(() => viewOf(cam, LANDSCAPE)).not.toThrow();
        expect(() => zoomBy(cam, a, { x: b, y: b }, LANDSCAPE)).not.toThrow();
        expect(() => panBy(cam, a, b, LANDSCAPE)).not.toThrow();
        expect(() => follow(cam, { x: a, y: b }, b, LANDSCAPE)).not.toThrow();
        expect(() => setMode(cam, 'follow', ctx(a, b))).not.toThrow();
      }
    }
  });
});

describe('bestCarIndex: from the WHOLE generation', () => {
  it('the running car with the most progress, ties to the lowest index', () => {
    expect(bestCarIndex([{ running: true, progress: 3 }, { running: true, progress: 9 }, { running: true, progress: 9 }, { running: false, progress: 50 }])).toBe(1);
  });
  it('a finished car with more progress does not beat a running one; when none runs the best finished car is chosen; empty is -1', () => {
    expect(bestCarIndex([{ running: false, progress: 99 }, { running: true, progress: 1 }])).toBe(1);
    expect(bestCarIndex([{ running: false, progress: 4 }, { running: false, progress: 7 }, { running: false, progress: 7 }])).toBe(1);
    expect(bestCarIndex([])).toBe(-1);
  });
});

describe('withFollowedSlot: the followed car is drawn within the existing cap', () => {
  it('is unchanged when nothing is followed or the car is already drawn', () => {
    expect(withFollowedSlot([0, 1, 2], -1, 3)).toEqual([0, 1, 2]);
    expect(withFollowedSlot([0, 1, 2], 1, 3)).toEqual([0, 1, 2]);
  });
  it('is added when there is room, and replaces the last picked car at the cap, so the count never exceeds the cap', () => {
    expect(withFollowedSlot([0, 1], 7, 3)).toEqual([0, 1, 7]);
    expect(withFollowedSlot([0, 1, 2], 7, 3)).toEqual([0, 1, 7]);
    expect(withFollowedSlot([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 42, 10)).toHaveLength(10);
    expect(withFollowedSlot([0], 42, 1)).toEqual([42]);
    expect(withFollowedSlot([], 3, 0)).toEqual([]);
  });
});
