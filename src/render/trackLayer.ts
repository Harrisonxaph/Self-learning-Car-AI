// The static track layer: the background, road, boundaries, gates and start pose drawn once onto a
// separate canvas, then copied onto the screen every frame. It is rebuilt only when the track or the
// canvas size changes, so the geometry is not redrawn 60 times a second.
import type { Track } from '../sim/track';
import { fitBounds, trackMargin, worldToScreen, type WorldToScreen } from './trackView';
import type { ViewportSize } from './viewport';
import { trackBounds } from '../sim/track';

/** The drawing calls the track layer needs (a subset of CanvasRenderingContext2D). */
export type TrackLayerContext = Pick<
  CanvasRenderingContext2D,
  | 'setTransform'
  | 'clearRect'
  | 'fillRect'
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'closePath'
  | 'fill'
  | 'stroke'
  | 'setLineDash'
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'lineJoin'
>;

/** An offscreen drawing surface: a canvas element in the browser, a fake in tests. */
export interface LayerSurface<C> {
  readonly canvas: C & { width: number; height: number };
  readonly context: TrackLayerContext;
}

export interface TrackLayer<C> {
  /** The drawn layer and the transform used, or undefined when the canvas has no area. */
  get(track: Track, size: ViewportSize): { readonly canvas: C; readonly view: WorldToScreen } | undefined;
  /** How many times the layer has been drawn; tests and the page use it to check caching. */
  builds(): number;
}

export const TRACK_COLOURS = Object.freeze({
  background: '#1f2a36',
  road: '#3b4654',
  boundary: '#e8eef4',
  gate: 'rgba(255, 210, 80, 0.45)',
  startLine: '#ffd250',
  startPose: '#5fd0a8',
});

/** Length of the start-pose arrow in world metres (about one car length). */
const START_ARROW_METRES = 6;

export function createTrackLayer<C>(createSurface: () => LayerSurface<C>): TrackLayer<C> {
  let surface: LayerSurface<C> | undefined;
  let built: { track: Track; size: ViewportSize; view: WorldToScreen } | undefined;
  let buildCount = 0;

  const sameSize = (a: ViewportSize, b: ViewportSize) =>
    a.width === b.width && a.height === b.height && a.pixelRatio === b.pixelRatio &&
    a.cssWidth === b.cssWidth && a.cssHeight === b.cssHeight;

  return {
    get(track, size) {
      if (size.width === 0 || size.height === 0) return undefined;
      surface ??= createSurface();
      if (!built || built.track !== track || !sameSize(built.size, size)) {
        const view = fitBounds(trackBounds(track), size.cssWidth, size.cssHeight, trackMargin(size.cssWidth, size.cssHeight));
        if (surface.canvas.width !== size.width) surface.canvas.width = size.width;
        if (surface.canvas.height !== size.height) surface.canvas.height = size.height;
        drawTrack(surface.context, track, size, view);
        built = { track, size, view };
        buildCount += 1;
      }
      return { canvas: surface.canvas, view: built.view };
    },
    builds: () => buildCount,
  };
}

/** Draws the whole track layer. Coordinates are mapped to CSS pixels; the transform scales to device pixels. */
export function drawTrack(ctx: TrackLayerContext, track: Track, size: ViewportSize, view: WorldToScreen): void {
  ctx.setTransform(size.pixelRatio, 0, 0, size.pixelRatio, 0, 0);
  ctx.clearRect(0, 0, size.cssWidth, size.cssHeight);
  ctx.fillStyle = TRACK_COLOURS.background;
  ctx.fillRect(0, 0, size.cssWidth, size.cssHeight);

  const shape = (points: Track['outer']) => {
    ctx.beginPath();
    points.forEach((point, i) => {
      const p = worldToScreen(view, point);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
  };
  const line = (from: Track['start']['position'], to: Track['start']['position']) => {
    const a = worldToScreen(view, from);
    const b = worldToScreen(view, to);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  };

  // Road: fill the outer shape, then paint the infield back in the background colour.
  ctx.fillStyle = TRACK_COLOURS.road;
  shape(track.outer);
  ctx.fill();
  ctx.fillStyle = TRACK_COLOURS.background;
  shape(track.inner);
  ctx.fill();

  ctx.lineJoin = 'round';
  ctx.strokeStyle = TRACK_COLOURS.boundary;
  ctx.lineWidth = 2;
  shape(track.outer);
  ctx.stroke();
  shape(track.inner);
  ctx.stroke();

  // Gates: faint dashed lines, with gate 0 (start/finish) drawn solid and brighter.
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = TRACK_COLOURS.gate;
  ctx.lineWidth = 1;
  track.gates.slice(1).forEach((gate) => line(gate.a, gate.b));
  ctx.setLineDash([]);
  const finish = track.gates[0];
  if (finish) {
    ctx.strokeStyle = TRACK_COLOURS.startLine;
    ctx.lineWidth = 3;
    line(finish.a, finish.b);
  }

  // Start pose: an arrow from the start position in the heading direction.
  const { position, heading } = track.start;
  const tip = {
    x: position.x + Math.cos(heading) * START_ARROW_METRES,
    y: position.y + Math.sin(heading) * START_ARROW_METRES,
  };
  ctx.strokeStyle = TRACK_COLOURS.startPose;
  ctx.lineWidth = 3;
  line(position, tip);
}
