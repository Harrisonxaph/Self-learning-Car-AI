// Paints the track for a camera (P4-07). At the whole-track view it uses the cached track layer exactly as before the camera existed
// (same `drawImage`, same build counter); at any other view it draws the track directly through the camera's view with `drawTrack`, the
// function the cached layer itself uses, so the picture is the same. The returned view is the one cars, rays and the locator ring must be
// drawn through, so track and cars share one alignment by construction.
import type { ViewportSize } from './viewport';
import type { Track } from '../sim/track';
import { drawTrack, type TrackLayer, type TrackLayerContext } from './trackLayer';
import type { WorldToScreen } from './trackView';

export type ScenePaintContext = TrackLayerContext & Pick<CanvasRenderingContext2D, 'drawImage'>;

/**
 * Clears the canvas and paints the track. Returns the view to draw cars through, or undefined when the canvas holds nothing.
 * `view` is the camera's view for this frame and `atFit` says whether the camera shows the whole track.
 */
export function paintTrack<C extends CanvasImageSource>(
  context: ScenePaintContext,
  trackLayer: TrackLayer<C>,
  track: Track,
  size: ViewportSize,
  view: WorldToScreen,
  atFit: boolean,
): WorldToScreen | undefined {
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, size.width, size.height);
  if (size.width === 0 || size.height === 0) return undefined;
  if (atFit) {
    const layer = trackLayer.get(track, size);
    if (!layer) return undefined;
    context.drawImage(layer.canvas, 0, 0);
    return layer.view;
  }
  if (!(view.scale > 0)) return undefined;
  drawTrack(context, track, size, view);
  return view;
}
