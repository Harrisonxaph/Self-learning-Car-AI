// Debug layer for the ray sensors (P2-01): a line from the sensor origin to each ray's end, with a marker
// where a ray hits a boundary. Works for any car's readings. Reads the readings and never changes them or the
// world; the page draws it only when asked to (`?debug=rays`, see ui/debugFlags.ts).
import type { SensorReadings } from '../sensors/rays';
import { worldToScreen, type WorldToScreen } from './trackView';
import type { ViewportSize } from './viewport';

/** The drawing calls needed (a subset of CanvasRenderingContext2D). */
export type SensorContext = Pick<
  CanvasRenderingContext2D,
  'setTransform' | 'beginPath' | 'moveTo' | 'lineTo' | 'arc' | 'fill' | 'stroke' | 'fillStyle' | 'strokeStyle' | 'lineWidth'
>;

export const SENSOR_COLOURS = Object.freeze({
  /** A ray that hit a boundary within range. */
  hitRay: '#ffb000',
  /** A ray that reached its full length without a hit. */
  clearRay: 'rgba(255, 255, 255, 0.4)',
  /** The marker at a hit point: a colour used nowhere else, so browser tests can find it. */
  hitMarker: '#ff00d4',
});

/** Radius of a hit marker, CSS pixels. */
export const HIT_MARKER_RADIUS_PX = 4;

export function drawSensors(context: SensorContext, size: ViewportSize, view: WorldToScreen, readings: SensorReadings): void {
  context.setTransform(size.pixelRatio, 0, 0, size.pixelRatio, 0, 0);
  const origin = worldToScreen(view, readings.origin);
  for (const ray of readings.rays) {
    const end = worldToScreen(view, ray.end);
    context.beginPath();
    context.moveTo(origin.x, origin.y);
    context.lineTo(end.x, end.y);
    context.strokeStyle = ray.hit ? SENSOR_COLOURS.hitRay : SENSOR_COLOURS.clearRay;
    context.lineWidth = ray.hit ? 1.5 : 1;
    context.stroke();
  }
  // Markers after all the lines, so no line is drawn over a marker's centre.
  context.fillStyle = SENSOR_COLOURS.hitMarker;
  for (const ray of readings.rays) {
    if (!ray.hit) continue;
    const end = worldToScreen(view, ray.end);
    context.beginPath();
    context.arc(end.x, end.y, HIT_MARKER_RADIUS_PX, 0, 2 * Math.PI);
    context.fill();
  }
}
