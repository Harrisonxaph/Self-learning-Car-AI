// The page's camera logic with no DOM (P4-07): one camera, the canvas size, the follow target for this frame, the zoom and fit commands,
// and the pointer, pinch and wheel gestures. The page (ui/cameraPage.ts) only wires events to it. It calls the pure functions in
// render/camera.ts and reads the render clock for follow smoothing; it never reads or writes simulation state, so a camera change can
// never change a result (a test runs a seeded training run under every camera and compares the records).
import { fitCamera, follow, panBy, resized, setMode, viewOf, zoomBy, type Camera, type CameraContext } from '../render/camera';
import type { WorldToScreen } from '../render/trackView';
import type { Bounds, Vec2 } from '../sim/track';

/** One button press multiplies the zoom by this. */
export const ZOOM_STEP = 1.5;
/** The wheel: one notch (deltaY 100) multiplies the zoom by about this much, each event limited to a factor of two either way. */
const WHEEL_EXPONENT = 0.0015;

export interface CameraController {
  camera(): Camera;
  /** The canvas size in CSS pixels; a change is a resize or rotation (the centre and relative zoom are kept). */
  setCanvas(cssWidth: number, cssHeight: number): void;
  /** A new track: the whole-track view again. */
  setBounds(bounds: Bounds): void;
  context(): CameraContext;
  /** The world to screen transform to draw with, for the current camera and canvas. */
  view(): WorldToScreen;
  /** Whether the camera shows the whole track (so the cached track layer can be used exactly as before the camera existed). */
  atFit(): boolean;
  following(): boolean;
  /** Called once per rendered frame with the world position to follow (or null when there is none): smooths the centre by elapsed render time. */
  frame(target: Vec2 | null): void;
  zoomIn(): void;
  zoomOut(): void;
  fit(): void;
  toggleFollow(): void;
  /** A wheel event at a canvas point; returns whether it was handled (so the page can stop the page scrolling). */
  wheel(deltaY: number, x: number, y: number): boolean;
  pointerDown(id: number, x: number, y: number): void;
  pointerMove(id: number, x: number, y: number): boolean;
  pointerUp(id: number): void;
  pointerCancel(id: number): void;
  /** A polite announcement of the current view ("Zoom 4.0×, following the best car"). */
  describe(targetName: string | null): string;
  /** The camera's state as strings, for the browser tests. */
  dataset(): Record<string, string>;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function createCameraController(initial: { bounds: Bounds; cssWidth: number; cssHeight: number; now: () => number }): CameraController {
  let context: CameraContext = { bounds: initial.bounds, cssWidth: initial.cssWidth, cssHeight: initial.cssHeight };
  let camera: Camera = fitCamera(context.bounds);
  let lastMs: number | null = null;
  const pointers = new Map<number, Vec2>();
  let pinch: { distance: number; mid: Vec2 } | null = null;

  const centreAnchor = (): Vec2 => ({ x: context.cssWidth / 2, y: context.cssHeight / 2 });
  const spread = (a: Vec2, b: Vec2): { distance: number; mid: Vec2 } => ({ distance: Math.hypot(b.x - a.x, b.y - a.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } });
  const pair = (): [Vec2, Vec2] | null => {
    const [a, b] = [...pointers.values()];
    return a && b ? [a, b] : null;
  };

  return {
    camera: () => camera,
    context: () => context,
    setCanvas(cssWidth, cssHeight) {
      if (context.cssWidth === cssWidth && context.cssHeight === cssHeight) return;
      context = { ...context, cssWidth, cssHeight };
      camera = resized(camera, context);
    },
    setBounds(bounds) {
      context = { ...context, bounds };
      camera = fitCamera(bounds);
      pointers.clear();
      pinch = null;
    },
    view: () => viewOf(camera, context),
    atFit: () => camera.mode === 'fit' && camera.zoom === 1,
    following: () => camera.mode === 'follow',
    frame(target) {
      const now = initial.now();
      const elapsed = lastMs === null || !finite(now) ? 0 : Math.max(0, (now - lastMs) / 1000);
      lastMs = finite(now) ? now : lastMs;
      if (camera.mode === 'follow' && target !== null) camera = follow(camera, target, elapsed, context);
    },
    zoomIn() {
      camera = zoomBy(camera, ZOOM_STEP, centreAnchor(), context);
    },
    zoomOut() {
      camera = zoomBy(camera, 1 / ZOOM_STEP, centreAnchor(), context);
    },
    fit() {
      camera = fitCamera(context.bounds);
    },
    toggleFollow() {
      camera = camera.mode === 'follow' ? setMode(camera, 'zoom', context) : setMode(camera, 'follow', context);
    },
    wheel(deltaY, x, y) {
      if (!finite(deltaY) || !finite(x) || !finite(y)) return false;
      const factor = Math.min(2, Math.max(0.5, Math.exp(-deltaY * WHEEL_EXPONENT)));
      const next = zoomBy(camera, factor, { x, y }, context);
      const changed = next !== camera;
      camera = next;
      return changed || deltaY !== 0;
    },
    pointerDown(id, x, y) {
      if (!finite(x) || !finite(y)) return;
      pointers.set(id, { x, y });
      const two = pair();
      pinch = two ? spread(two[0], two[1]) : null;
    },
    pointerMove(id, x, y) {
      const before = pointers.get(id);
      if (!before || !finite(x) || !finite(y)) return false;
      pointers.set(id, { x, y });
      const two = pair();
      if (two && pinch) {
        const now = spread(two[0], two[1]);
        if (pinch.distance > 0 && now.distance > 0) // Zoom about the PREVIOUS midpoint (the world point under the fingers stays under them), then pan by how far the midpoint moved.
        camera = zoomBy(camera, now.distance / pinch.distance, pinch.mid, context);
        camera = panBy(camera, now.mid.x - pinch.mid.x, now.mid.y - pinch.mid.y, context);
        pinch = now;
        return true;
      }
      camera = panBy(camera, x - before.x, y - before.y, context);
      return true;
    },
    pointerUp(id) {
      pointers.delete(id);
      const two = pair();
      pinch = two ? spread(two[0], two[1]) : null;
    },
    pointerCancel(id) {
      pointers.delete(id);
      const two = pair();
      pinch = two ? spread(two[0], two[1]) : null;
    },
    describe(targetName) {
      if (camera.mode === 'fit') return 'Whole track in view.';
      const zoom = `Zoom ${camera.zoom.toFixed(1)}×`;
      return camera.mode === 'follow' ? `${zoom}, following ${targetName ?? 'the car'}.` : `${zoom}.`;
    },
    dataset() {
      return { cameraMode: camera.mode, cameraZoom: String(camera.zoom), cameraCentreX: String(camera.centre.x), cameraCentreY: String(camera.centre.y) };
    },
  };
}
