// Maps track coordinates (metres) onto the canvas (CSS pixels) so the whole track fits with a margin,
// keeping its shape: one scale for both axes, centred in the leftover space.
import type { Bounds, Vec2 } from '../sim/track';

/** screen = world × scale + offset, in CSS pixels. */
export interface WorldToScreen {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

/** Margin around the track: 4% of the shorter side, at least 8 CSS pixels. */
export function trackMargin(cssWidth: number, cssHeight: number): number {
  return Math.max(8, 0.04 * Math.min(cssWidth, cssHeight));
}

/**
 * The largest uniform scale that fits `bounds` inside the canvas minus `margin` on every side, centred.
 * A canvas too small to hold anything gives scale 0, so nothing is drawn rather than something inverted.
 */
export function fitBounds(bounds: Bounds, cssWidth: number, cssHeight: number, margin: number): WorldToScreen {
  const worldWidth = bounds.maxX - bounds.minX;
  const worldHeight = bounds.maxY - bounds.minY;
  if (!(worldWidth > 0) || !(worldHeight > 0)) {
    throw new RangeError('Track bounds must have a positive width and height.');
  }
  const availableWidth = cssWidth - 2 * margin;
  const availableHeight = cssHeight - 2 * margin;
  const scale = Math.max(0, Math.min(availableWidth / worldWidth, availableHeight / worldHeight));
  // Centre the scaled track in the whole canvas, so any spare space is split evenly on both sides.
  return {
    scale,
    offsetX: cssWidth / 2 - ((bounds.minX + bounds.maxX) / 2) * scale,
    offsetY: cssHeight / 2 - ((bounds.minY + bounds.maxY) / 2) * scale,
  };
}

export function worldToScreen(view: WorldToScreen, point: Vec2): Vec2 {
  return { x: point.x * view.scale + view.offsetX, y: point.y * view.scale + view.offsetY };
}
