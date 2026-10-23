// Keeps the canvas's drawing buffer matched to its on-screen size so drawings stay sharp
// on phones, tablets and desktops. Simulation code never sees these pixel sizes: it works
// in world units, and the renderer maps them onto this viewport.

/** Highest device pixel ratio used for the drawing buffer. Higher ratios cost memory and
 *  fill rate on phones without a visible gain for this app. */
export const MAX_PIXEL_RATIO = 2;

export interface ViewportSize {
  /** Displayed size in CSS pixels. */
  cssWidth: number;
  cssHeight: number;
  /** Device pixels per CSS pixel actually used (capped at MAX_PIXEL_RATIO). */
  pixelRatio: number;
  /** Drawing-buffer size in device pixels. */
  width: number;
  height: number;
}

/** The parts of a canvas the viewport changes. */
export interface CanvasTarget {
  width: number;
  height: number;
}

/** Where the viewport reads sizes from; supplied by the browser, or by fakes in tests. */
export interface ViewportEnvironment {
  /** Current displayed size of the canvas in CSS pixels. */
  measure(): { width: number; height: number };
  devicePixelRatio(): number;
  /** Calls onChange whenever the size or pixel ratio may have changed; returns an unsubscribe function. */
  subscribe(onChange: () => void): () => void;
}

export interface Viewport {
  /** Size applied by the most recent update. */
  current(): ViewportSize;
  /** Re-measure now and resize the drawing buffer if needed. */
  update(): void;
  /** Stop listening for changes. */
  stop(): void;
}

function nonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Works out the drawing-buffer size for a canvas shown at the given CSS size. */
export function computeViewportSize(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  maxPixelRatio: number = MAX_PIXEL_RATIO,
): ViewportSize {
  const width = nonNegative(cssWidth);
  const height = nonNegative(cssHeight);
  const ratio = devicePixelRatio > 0 && Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1;
  const pixelRatio = Math.min(ratio, maxPixelRatio);
  return {
    cssWidth: width,
    cssHeight: height,
    pixelRatio,
    width: Math.round(width * pixelRatio),
    height: Math.round(height * pixelRatio),
  };
}

/**
 * Sizes the canvas now and again whenever the environment reports a change.
 * The drawing buffer is only reassigned when its size actually changes, because assigning
 * canvas.width or canvas.height clears the canvas even when the value is the same.
 */
export function createViewport(
  canvas: CanvasTarget,
  environment: ViewportEnvironment,
  onResize: (size: ViewportSize) => void,
): Viewport {
  let size: ViewportSize | undefined;
  let stopped = false;

  const update = (): void => {
    if (stopped) return;
    const measured = environment.measure();
    const next = computeViewportSize(measured.width, measured.height, environment.devicePixelRatio());
    const bufferChanged = canvas.width !== next.width || canvas.height !== next.height;
    if (bufferChanged) {
      canvas.width = next.width;
      canvas.height = next.height;
    }
    const sizeChanged =
      size === undefined ||
      size.cssWidth !== next.cssWidth ||
      size.cssHeight !== next.cssHeight ||
      size.pixelRatio !== next.pixelRatio;
    size = next;
    if (bufferChanged || sizeChanged) onResize(next);
  };

  const unsubscribe = environment.subscribe(update);
  update();

  return {
    current: () => size ?? computeViewportSize(0, 0, 1),
    update,
    stop: () => {
      stopped = true;
      unsubscribe();
    },
  };
}

/** Browser environment: watches the canvas's own size and window resizes (which also
 *  fire when the pixel ratio changes, for example on zoom or moving between screens). */
export function browserViewportEnvironment(canvas: HTMLCanvasElement, win: Window = window): ViewportEnvironment {
  return {
    measure: () => {
      const rect = canvas.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    },
    devicePixelRatio: () => win.devicePixelRatio,
    subscribe: (onChange) => {
      const observer = new ResizeObserver(() => onChange());
      observer.observe(canvas);
      win.addEventListener('resize', onChange);
      return () => {
        observer.disconnect();
        win.removeEventListener('resize', onChange);
      };
    },
  };
}
