// The render-only camera (P4-07): fit the whole track, zoom, or follow a car, so a large circuit stays legible on a phone. Pure and
// headless: every function takes numbers and a `Bounds` and returns a new camera (or the same one), never throws, and never reads
// simulation state. Nothing in sim, sensors, ai, evolution, training or persistence imports this file (the lint boundaries forbid the
// reverse direction for `render`, and a source scan keeps the camera out of those folders). The camera shows what was computed, larger.
//
// A camera stores a mode, a zoom (a multiple of the fit scale, 1 = the whole track) and a world-space centre. Because the fit scale
// depends on the canvas size, every screen-space operation takes a `CameraContext` (the track's bounds and the canvas size in CSS
// pixels), and `viewOf` takes the same context, so a camera is never interpreted against a transform other than the one it is drawn with.
import type { Bounds, Vec2 } from '../sim/track';
import { fitBounds, trackMargin, type WorldToScreen } from './trackView';

export type CameraMode = 'fit' | 'zoom' | 'follow';

export interface Camera {
  readonly mode: CameraMode;
  /** A multiple of the fit scale: 1 shows the whole track. */
  readonly zoom: number;
  /** The world point at the middle of the canvas. */
  readonly centre: Vec2;
}

export interface CameraContext {
  readonly bounds: Bounds;
  /** The canvas size in CSS pixels. */
  readonly cssWidth: number;
  readonly cssHeight: number;
}

/** The largest zoom shows a 4 m car about this many CSS pixels long: an absolute scale of CAR_PIXELS_AT_MAX_ZOOM / 4 pixels per metre. */
export const CAR_PIXELS_AT_MAX_ZOOM = 40;
export const MAX_SCALE_PIXELS_PER_METRE = CAR_PIXELS_AT_MAX_ZOOM / 4;
/** The zoom a camera takes when it starts following from the whole-track view. */
export const FOLLOW_DEFAULT_ZOOM = 4;
/** The fraction of the remaining distance to the target covered in one 1/60 s frame (the documented response at 60 Hz). */
export const FOLLOW_ALPHA_60 = 0.15;
/** An elapsed time above this is clamped; one at or above SNAP_SECONDS (a pause, a background tab) jumps to the target instead. */
export const MAX_FOLLOW_STEP_SECONDS = 0.1;
export const SNAP_SECONDS = 0.5;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const point = (p: unknown): p is Vec2 => typeof p === 'object' && p !== null && finite((p as Vec2).x) && finite((p as Vec2).y);

const centreOf = (b: Bounds): Vec2 => ({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });

/** The camera that shows the whole track. */
export function fitCamera(bounds: Bounds): Camera {
  return { mode: 'fit', zoom: 1, centre: centreOf(bounds) };
}

/** The fit view for a context, or null when the canvas or the track bounds cannot hold a view (nothing is then drawn). */
function baseView(context: CameraContext): WorldToScreen | null {
  try {
    const { bounds, cssWidth, cssHeight } = context;
    if (!finite(cssWidth) || !finite(cssHeight) || cssWidth <= 0 || cssHeight <= 0) return null;
    return fitBounds(bounds, cssWidth, cssHeight, trackMargin(cssWidth, cssHeight));
  } catch {
    return null;
  }
}

/** The largest zoom for a context: where the absolute scale reaches MAX_SCALE_PIXELS_PER_METRE, and never below 1. */
export function maxZoom(context: CameraContext): number {
  const base = baseView(context);
  return base === null || !(base.scale > 0) ? 1 : Math.max(1, MAX_SCALE_PIXELS_PER_METRE / base.scale);
}

const clampCentre = (centre: Vec2, bounds: Bounds): Vec2 => ({
  x: Math.min(bounds.maxX, Math.max(bounds.minX, centre.x)),
  y: Math.min(bounds.maxY, Math.max(bounds.minY, centre.y)),
});

/**
 * The world to screen transform for a camera. At zoom 1 in fit mode it is EXACTLY `fitBounds(...)`, so a page that never zooms draws as
 * it did before the camera existed. Otherwise the scale is the fit scale times the zoom and the camera's centre sits at the canvas
 * centre. A canvas too small to hold anything gives scale 0 (nothing drawn), as the fit does.
 */
export function viewOf(camera: Camera, context: CameraContext): WorldToScreen {
  const base = baseView(context);
  if (base === null) return { scale: 0, offsetX: 0, offsetY: 0 };
  if (camera.mode === 'fit' && camera.zoom === 1) return base;
  const zoom = Math.min(maxZoom(context), Math.max(1, finite(camera.zoom) ? camera.zoom : 1));
  const centre = point(camera.centre) ? clampCentre(camera.centre, context.bounds) : centreOf(context.bounds);
  const scale = base.scale * zoom;
  return { scale, offsetX: context.cssWidth / 2 - centre.x * scale, offsetY: context.cssHeight / 2 - centre.y * scale };
}

/** A camera with its zoom and centre forced into range for a context (zoom 1 snaps to the whole-track view in fit or zoom mode). */
function normalised(camera: Camera, context: CameraContext): Camera {
  const zoom = Math.min(maxZoom(context), Math.max(1, camera.zoom));
  const centre = clampCentre(camera.centre, context.bounds);
  if (zoom === 1 && camera.mode !== 'follow') return fitCamera(context.bounds);
  return { mode: camera.mode, zoom, centre };
}

/**
 * Zooms by `factor` about a screen point, so the world point under the anchor (the fingers of a pinch, the cursor of a wheel) stays
 * under it: the anchor is converted to the world with the CURRENT view, the zoom is changed and clamped, and the centre is moved so that
 * world point maps back to the same screen point. Non-finite input returns the same camera.
 */
export function zoomBy(camera: Camera, factor: number, anchor: Vec2, context: CameraContext): Camera {
  if (!finite(factor) || factor <= 0 || !point(anchor)) return camera;
  const base = baseView(context);
  if (base === null || !(base.scale > 0)) return camera;
  const before = viewOf(camera, context);
  if (!(before.scale > 0)) return camera;
  const zoom = Math.min(maxZoom(context), Math.max(1, camera.zoom * factor));
  const world = { x: (anchor.x - before.offsetX) / before.scale, y: (anchor.y - before.offsetY) / before.scale };
  const scale = base.scale * zoom;
  const offsetX = anchor.x - world.x * scale;
  const offsetY = anchor.y - world.y * scale;
  const centre = { x: (context.cssWidth / 2 - offsetX) / scale, y: (context.cssHeight / 2 - offsetY) / scale };
  const mode: CameraMode = camera.mode === 'follow' ? 'follow' : zoom > 1 ? 'zoom' : 'fit';
  return normalised({ mode, zoom, centre }, context);
}

/** Pans by a drag of (dx, dy) screen pixels, converted to metres with the current scale. In follow mode a drag pauses following (zoom mode). */
export function panBy(camera: Camera, dx: number, dy: number, context: CameraContext): Camera {
  if (!finite(dx) || !finite(dy)) return camera;
  const view = viewOf(camera, context);
  if (!(view.scale > 0)) return camera;
  if (camera.mode === 'fit' && camera.zoom === 1) return camera;
  const centre = { x: camera.centre.x - dx / view.scale, y: camera.centre.y - dy / view.scale };
  return normalised({ mode: camera.mode === 'follow' ? 'zoom' : camera.mode, zoom: camera.zoom, centre }, context);
}

/**
 * Moves a following camera towards a world-space target by ELAPSED render time, not by frame count: alpha = 1 - (1 - alpha60)^(60 dt)
 * with dt made finite and clamped to [0, MAX_FOLLOW_STEP_SECONDS], so equal elapsed time gives the same result at 30, 60, 120 and
 * 144 Hz, and the exponential form composes (an irregular schedule equals a steady one over the same total time for a constant target).
 * An elapsed time of SNAP_SECONDS or more (a pause, a background tab, a long frame) jumps to the target. A camera that is not following
 * is returned unchanged. This is render time only: nothing in the simulation reads it.
 */
export function follow(camera: Camera, target: Vec2, elapsedSeconds: number, context: CameraContext): Camera {
  if (camera.mode !== 'follow' || !point(target)) return camera;
  const elapsed = finite(elapsedSeconds) ? elapsedSeconds : 0;
  const snap = elapsed >= SNAP_SECONDS;
  const dt = Math.min(MAX_FOLLOW_STEP_SECONDS, Math.max(0, elapsed));
  const alpha = snap ? 1 : 1 - Math.pow(1 - FOLLOW_ALPHA_60, 60 * dt);
  const centre = { x: camera.centre.x + (target.x - camera.centre.x) * alpha, y: camera.centre.y + (target.y - camera.centre.y) * alpha };
  return normalised({ mode: 'follow', zoom: camera.zoom, centre }, context);
}

/**
 * Switches mode. `fit` shows the whole track; `zoom` keeps the current view; `follow` keeps the zoom, raised to FOLLOW_DEFAULT_ZOOM
 * (clamped) when it was the whole-track view, and keeps the centre until `follow` moves it.
 */
export function setMode(camera: Camera, mode: CameraMode, context: CameraContext): Camera {
  if (mode === 'fit') return fitCamera(context.bounds);
  if (mode === 'zoom') return camera.mode === 'fit' && camera.zoom === 1 ? camera : normalised({ ...camera, mode: 'zoom' }, context);
  const zoom = camera.zoom > 1 ? camera.zoom : Math.min(maxZoom(context), FOLLOW_DEFAULT_ZOOM);
  return normalised({ mode: 'follow', zoom, centre: camera.centre }, context);
}

/** A canvas resize or rotation changes only the context: the world centre and the relative zoom are kept, clamped into range for the new size. */
export function resized(camera: Camera, context: CameraContext): Camera {
  return camera.mode === 'fit' ? fitCamera(context.bounds) : normalised(camera, context);
}

/** The share of the shorter canvas side kept clear around a followed target when the view has to move to keep it visible. */
export const FOLLOW_MARGIN_FRACTION = 0.1;

/**
 * Keeps a followed target inside the view (with a margin) while smoothing has not settled, for example after a resize or rotation: the
 * centre is moved by the least amount that brings the target back inside the inner rectangle, in world units, and is then clamped into the
 * track's bounds. A camera that is not following, a target already inside, or a canvas that cannot hold a view is returned unchanged. When the
 * inner rectangle is empty the centre goes to the target. Render only: it reads a position and writes a camera.
 */
export function keepInView(camera: Camera, target: Vec2, context: CameraContext): Camera {
  if (camera.mode !== 'follow' || !point(target)) return camera;
  const view = viewOf(camera, context);
  if (!(view.scale > 0)) return camera;
  const margin = Math.min(Math.max(0, FOLLOW_MARGIN_FRACTION * Math.min(context.cssWidth, context.cssHeight)), Math.min(context.cssWidth, context.cssHeight) / 2);
  const x = target.x * view.scale + view.offsetX;
  const y = target.y * view.scale + view.offsetY;
  const dx = x < margin ? x - margin : x > context.cssWidth - margin ? x - (context.cssWidth - margin) : 0;
  const dy = y < margin ? y - margin : y > context.cssHeight - margin ? y - (context.cssHeight - margin) : 0;
  if (dx === 0 && dy === 0) return camera;
  return normalised({ mode: 'follow', zoom: camera.zoom, centre: { x: camera.centre.x + dx / view.scale, y: camera.centre.y + dy / view.scale } }, context);
}

/** Whether a world point is inside the canvas under a camera (for tests and for keeping a followed car in view). */
export function isVisible(camera: Camera, context: CameraContext, world: Vec2): boolean {
  const view = viewOf(camera, context);
  const x = world.x * view.scale + view.offsetX;
  const y = world.y * view.scale + view.offsetY;
  return x >= 0 && y >= 0 && x <= context.cssWidth && y <= context.cssHeight;
}

/** A car as the follow chooser sees it: whether it is still running, and its ordered progress (gates credited). */
export interface FollowCandidate {
  readonly running: boolean;
  readonly progress: number;
}

/**
 * The index of the car to follow: the running car with the most ordered progress (ties to the lowest index); when none is running, the
 * finished car with the most progress; -1 for an empty population. Chosen from the WHOLE generation, not the drawn subset.
 */
export function bestCarIndex(cars: readonly FollowCandidate[]): number {
  let best = -1;
  const better = (i: number): boolean => {
    if (best < 0) return true;
    const a = cars[i]!;
    const b = cars[best]!;
    if (a.running !== b.running) return a.running;
    return a.progress > b.progress;
  };
  for (let i = 0; i < cars.length; i += 1) if (better(i)) best = i;
  return best;
}

/**
 * The cars to draw (as indices) once the followed car is given a slot WITHIN the existing drawing cap: unchanged when it is already
 * drawn or nothing is followed; added when there is room; otherwise it replaces the last (least-prioritised) picked car, so the number
 * drawn never exceeds the cap. The picking rule for the other cars is untouched.
 */
export function withFollowedSlot(picked: readonly number[], followed: number, cap: number): number[] {
  if (followed < 0 || picked.includes(followed) || cap <= 0) return [...picked];
  if (picked.length < cap) return [...picked, followed];
  return [...picked.slice(0, cap - 1), followed];
}
