import { describe, expect, it } from 'vitest';
import {
  MAX_PIXEL_RATIO,
  computeViewportSize,
  createViewport,
  type ViewportEnvironment,
  type ViewportSize,
} from '../../src/render/viewport';

/** A canvas stand-in that counts how often its drawing buffer is reassigned. */
class FakeCanvas {
  assignments = 0;
  private w = 300;
  private h = 150;
  get width(): number {
    return this.w;
  }
  set width(value: number) {
    this.assignments += 1;
    this.w = value;
  }
  get height(): number {
    return this.h;
  }
  set height(value: number) {
    this.assignments += 1;
    this.h = value;
  }
}

/** A controllable browser: tests change size or pixel ratio, then fire the change event. */
class FakeEnvironment implements ViewportEnvironment {
  cssWidth = 0;
  cssHeight = 0;
  ratio = 1;
  listener: (() => void) | undefined;
  unsubscribed = false;
  measure() {
    return { width: this.cssWidth, height: this.cssHeight };
  }
  devicePixelRatio() {
    return this.ratio;
  }
  subscribe(onChange: () => void) {
    this.listener = onChange;
    return () => {
      this.unsubscribed = true;
    };
  }
  change(cssWidth: number, cssHeight: number, ratio = this.ratio) {
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    this.ratio = ratio;
    this.listener?.();
  }
}

describe('computeViewportSize', () => {
  it('scales the drawing buffer by the device pixel ratio', () => {
    expect(computeViewportSize(400, 300, 1.5)).toEqual({
      cssWidth: 400,
      cssHeight: 300,
      pixelRatio: 1.5,
      width: 600,
      height: 450,
    });
  });

  it('caps high-density screens such as a 3x iPhone at the maximum pixel ratio', () => {
    const size = computeViewportSize(390, 664, 3);
    expect(size.pixelRatio).toBe(MAX_PIXEL_RATIO);
    expect(size.width).toBe(780);
    expect(size.height).toBe(1328);
  });

  it('rounds fractional CSS sizes to whole device pixels', () => {
    const size = computeViewportSize(333.4, 200.6, 2);
    expect(size.width).toBe(667);
    expect(size.height).toBe(401);
  });

  it('falls back to a ratio of 1 when the browser reports an unusable pixel ratio', () => {
    for (const ratio of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(computeViewportSize(100, 50, ratio).pixelRatio).toBe(1);
    }
  });

  it('gives an empty buffer, not NaN, for a hidden or collapsed canvas', () => {
    expect(computeViewportSize(0, 0, 2)).toMatchObject({ width: 0, height: 0 });
    expect(computeViewportSize(-10, Number.NaN, 2)).toMatchObject({ cssWidth: 0, cssHeight: 0, width: 0, height: 0 });
  });
});

describe('createViewport', () => {
  function setup(cssWidth: number, cssHeight: number, ratio: number) {
    const canvas = new FakeCanvas();
    const env = new FakeEnvironment();
    env.cssWidth = cssWidth;
    env.cssHeight = cssHeight;
    env.ratio = ratio;
    const resizes: ViewportSize[] = [];
    const viewport = createViewport(canvas, env, (size) => resizes.push(size));
    return { canvas, env, resizes, viewport };
  }

  it('sizes the canvas and reports the size once when created', () => {
    const { canvas, resizes, viewport } = setup(800, 600, 2);
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(1200);
    expect(resizes).toHaveLength(1);
    expect(viewport.current()).toEqual(resizes[0]);
  });

  it('follows the canvas when the window is resized or the phone is rotated', () => {
    const { canvas, env, resizes } = setup(390, 664, 3);
    env.change(844, 290);
    expect(canvas.width).toBe(1688);
    expect(canvas.height).toBe(580);
    expect(resizes.at(-1)).toMatchObject({ cssWidth: 844, cssHeight: 290, pixelRatio: 2 });
  });

  it('does not clear or redraw the canvas when nothing changed', () => {
    const { canvas, env, resizes } = setup(800, 600, 1);
    const assignmentsAfterStart = canvas.assignments;
    env.change(800, 600);
    env.change(800, 600);
    expect(canvas.assignments).toBe(assignmentsAfterStart);
    expect(resizes).toHaveLength(1);
  });

  it('resizes the buffer when only the pixel ratio changes, for example after browser zoom', () => {
    const { canvas, env, resizes } = setup(500, 400, 1);
    env.change(500, 400, 1.25);
    expect(canvas.width).toBe(625);
    expect(canvas.height).toBe(500);
    expect(resizes).toHaveLength(2);
  });

  it('stops listening and ignores later changes after stop()', () => {
    const { canvas, env, resizes, viewport } = setup(800, 600, 1);
    viewport.stop();
    expect(env.unsubscribed).toBe(true);
    env.change(200, 100);
    expect(canvas.width).toBe(800);
    expect(resizes).toHaveLength(1);
  });
});
