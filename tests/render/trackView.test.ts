import { describe, expect, it } from 'vitest';
import { fitBounds, trackMargin, worldToScreen } from '../../src/render/trackView';
import type { Bounds } from '../../src/sim/track';

const OVAL: Bounds = { minX: -107, minY: -47, maxX: 107, maxY: 47 };

/** The screen rectangle the bounds map to. */
function screenRect(bounds: Bounds, cssWidth: number, cssHeight: number, margin: number) {
  const view = fitBounds(bounds, cssWidth, cssHeight, margin);
  const topLeft = worldToScreen(view, { x: bounds.minX, y: bounds.minY });
  const bottomRight = worldToScreen(view, { x: bounds.maxX, y: bounds.maxY });
  return { view, left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y };
}

describe('fitBounds', () => {
  it('uses the largest scale that fits, and centres the result', () => {
    const view = fitBounds({ minX: 0, minY: 0, maxX: 100, maxY: 50 }, 400, 300, 10);
    expect(view.scale).toBeCloseTo(3.8); // min(380 / 100, 280 / 50)
    expect(view.offsetX).toBeCloseTo(10);
    expect(view.offsetY).toBeCloseTo(55);
  });

  it('maps negative world coordinates inside the canvas and the world centre to the canvas centre', () => {
    const { view, left, top, right, bottom } = screenRect(OVAL, 800, 600, 24);
    expect(left).toBeGreaterThanOrEqual(24 - 1e-9);
    expect(top).toBeGreaterThanOrEqual(24 - 1e-9);
    expect(right).toBeLessThanOrEqual(800 - 24 + 1e-9);
    expect(bottom).toBeLessThanOrEqual(600 - 24 + 1e-9);
    expect(worldToScreen(view, { x: 0, y: 0 })).toEqual({ x: 400, y: 300 });
  });

  it('fills the width on a portrait phone and the height on a landscape phone', () => {
    // 214 m x 94 m is wider than tall, so a portrait screen is limited by width.
    const portrait = screenRect(OVAL, 390, 600, 16);
    expect(portrait.left).toBeCloseTo(16);
    expect(portrait.right).toBeCloseTo(390 - 16);
    expect(portrait.top).toBeGreaterThan(16);

    const landscape = screenRect(OVAL, 844, 300, 12);
    expect(landscape.top).toBeCloseTo(12);
    expect(landscape.bottom).toBeCloseTo(300 - 12);
    expect(landscape.left).toBeGreaterThan(12);
  });

  it('keeps the shape: one world metre is the same number of pixels across and down', () => {
    for (const [w, h] of [
      [390, 600],
      [844, 300],
      [1280, 600],
      [600, 1000],
    ] as const) {
      const { left, top, right, bottom } = screenRect(OVAL, w, h, trackMargin(w, h));
      expect((right - left) / (bottom - top)).toBeCloseTo(214 / 94, 9);
    }
  });

  it('works for bounds that do not include the origin', () => {
    const bounds = { minX: -300, minY: 50, maxX: -100, maxY: 450 };
    const { left, top, right, bottom } = screenRect(bounds, 500, 500, 10);
    expect(bottom - top).toBeCloseTo(480);
    expect((left + right) / 2).toBeCloseTo(250);
    expect((top + bottom) / 2).toBeCloseTo(250);
  });

  it('gives scale 0, not a flipped track, when the canvas is smaller than its margins', () => {
    expect(fitBounds(OVAL, 10, 10, 8).scale).toBe(0);
    expect(fitBounds(OVAL, 0, 0, 8).scale).toBe(0);
  });

  it.each([
    ['zero width', { minX: 5, minY: 0, maxX: 5, maxY: 10 }],
    ['zero height', { minX: 0, minY: 3, maxX: 10, maxY: 3 }],
    ['NaN bounds', { minX: Number.NaN, minY: 0, maxX: 10, maxY: 10 }],
  ])('rejects bounds with %s', (_label, bounds) => {
    expect(() => fitBounds(bounds, 400, 300, 10)).toThrow(RangeError);
  });
});

describe('trackMargin', () => {
  it('is 4% of the shorter side, but at least 8 CSS pixels', () => {
    expect(trackMargin(1280, 600)).toBeCloseTo(24);
    expect(trackMargin(390, 600)).toBeCloseTo(15.6);
    expect(trackMargin(150, 100)).toBe(8);
  });
});
