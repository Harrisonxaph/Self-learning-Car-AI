// Draws the start-up screen shown until the racetrack arrives in a later Phase 1 task.
import type { ViewportSize } from './viewport';

/** The drawing calls placeholder rendering needs (a subset of CanvasRenderingContext2D). */
export type PlaceholderContext = Pick<
  CanvasRenderingContext2D,
  'setTransform' | 'clearRect' | 'fillRect' | 'strokeRect' | 'fillText' | 'fillStyle' | 'strokeStyle' | 'lineWidth' | 'font' | 'textAlign' | 'textBaseline'
>;

export const PLACEHOLDER_MESSAGE = 'Simulation coming soon';

export function drawPlaceholder(ctx: PlaceholderContext, size: ViewportSize): void {
  // Draw in CSS pixels; the transform scales them onto the device-pixel buffer.
  ctx.setTransform(size.pixelRatio, 0, 0, size.pixelRatio, 0, 0);
  ctx.clearRect(0, 0, size.cssWidth, size.cssHeight);

  ctx.fillStyle = '#1f2a36';
  ctx.fillRect(0, 0, size.cssWidth, size.cssHeight);

  ctx.strokeStyle = '#4d6a85';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, Math.max(0, size.cssWidth - 2), Math.max(0, size.cssHeight - 2));

  ctx.fillStyle = '#e8eef4';
  ctx.font = '16px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(PLACEHOLDER_MESSAGE, size.cssWidth / 2, size.cssHeight / 2);
}
