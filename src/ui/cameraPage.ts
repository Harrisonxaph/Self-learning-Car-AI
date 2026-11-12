// Wires the camera's controls and gestures to the DOM (P4-07): the Fit, Zoom −, Zoom + and Follow buttons (and Follow A/B on the comparison
// replay), a pinch, a drag and the wheel on the RACE CANVAS ONLY, and the keys + - 0 F on the focused canvas. All decisions are in
// ui/cameraController.ts; this file is covered by the browser tests. Gestures never reach the simulation: they only change the camera.
import type { CameraController } from './cameraController';

function must<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`The camera controls need ${selector} on the page.`);
  return found;
}

export interface CameraPageDeps {
  readonly canvas: HTMLCanvasElement;
  readonly controller: CameraController;
  /** What is being followed, for the announcement ("the best car"), or null. */
  readonly targetName: () => string | null;
  /** Whether the comparison replay's A/B toggle is offered, and which champion it follows now. */
  readonly compare: () => { readonly offered: boolean; readonly label: string };
  readonly onToggleCompare: () => void;
  /** Called after any camera change, so the page can redraw at once (the loop also redraws every frame). */
  readonly changed: () => void;
}

/** What the training page supplies to start the camera's controls (the canvas is added by the wiring in main.ts). */
export type CameraUiDeps = Omit<CameraPageDeps, 'canvas'>;

export interface CameraPage {
  /** Refreshes the buttons and the announcement from the controller (call once per frame is fine; it only writes what changed). */
  refresh(): void;
  stop(): void;
}

export function startCameraPage(deps: CameraPageDeps): CameraPage {
  const { canvas, controller } = deps;
  const panel = must<HTMLElement>('#camera-controls');
  const fit = must<HTMLButtonElement>('#cam-fit');
  const zoomOut = must<HTMLButtonElement>('#cam-out');
  const zoomIn = must<HTMLButtonElement>('#cam-in');
  const followButton = must<HTMLButtonElement>('#cam-follow');
  const compareButton = must<HTMLButtonElement>('#cam-follow-ab');
  const status = must<HTMLElement>('#cam-status');
  const cleanups: (() => void)[] = [];
  const on = <K extends keyof HTMLElementEventMap>(target: HTMLElement, type: K, handler: (event: HTMLElementEventMap[K]) => void, options?: AddEventListenerOptions): void => {
    target.addEventListener(type, handler as EventListener, options);
    cleanups.push(() => target.removeEventListener(type, handler as EventListener));
  };

  panel.hidden = false;
  const previous = { tabIndex: canvas.getAttribute('tabindex'), label: canvas.getAttribute('aria-label') };
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', `${previous.label ?? 'Racetrack'}. Keys: plus and minus zoom, 0 shows the whole track, F follows the car.`);

  let lastText = '';
  const refresh = (): void => {
    const text = controller.describe(deps.targetName());
    if (text !== lastText) {
      lastText = text;
      status.textContent = text;
    }
    const following = controller.following();
    followButton.setAttribute('aria-pressed', String(following));
    fit.disabled = controller.atFit();
    const compare = deps.compare();
    compareButton.hidden = !compare.offered;
    if (compare.offered && compareButton.textContent !== compare.label) compareButton.textContent = compare.label;
    const dataset = controller.dataset();
    for (const [key, value] of Object.entries(dataset)) if (canvas.dataset[key] !== value) canvas.dataset[key] = value;
  };
  const act = (action: () => void): void => {
    action();
    deps.changed();
    refresh();
  };

  on(fit, 'click', () => act(() => controller.fit()));
  on(zoomOut, 'click', () => act(() => controller.zoomOut()));
  on(zoomIn, 'click', () => act(() => controller.zoomIn()));
  on(followButton, 'click', () => act(() => controller.toggleFollow()));
  on(compareButton, 'click', () => act(() => deps.onToggleCompare()));

  // Pointer Events on the canvas only: one pointer drags, two pointers pinch and pan. The canvas's `touch-action: none` (on its stage) keeps
  // the page from scrolling or zooming under the gesture; nothing here is registered on the document or the driving controls.
  const local = (event: PointerEvent): { x: number; y: number } => {
    const box = canvas.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  on(canvas, 'pointerdown', (event) => {
    const p = local(event);
    controller.pointerDown(event.pointerId, p.x, p.y);
    canvas.setPointerCapture?.(event.pointerId);
  });
  on(canvas, 'pointermove', (event) => {
    const p = local(event);
    if (controller.pointerMove(event.pointerId, p.x, p.y)) {
      deps.changed();
      refresh();
    }
  });
  const end = (event: PointerEvent): void => {
    controller.pointerUp(event.pointerId);
    refresh();
  };
  on(canvas, 'pointerup', end);
  on(canvas, 'pointercancel', (event) => {
    controller.pointerCancel(event.pointerId);
    refresh();
  });
  on(canvas, 'lostpointercapture', (event) => controller.pointerCancel(event.pointerId));
  on(
    canvas,
    'wheel',
    (event) => {
      const box = canvas.getBoundingClientRect();
      if (controller.wheel(event.deltaY, event.clientX - box.left, event.clientY - box.top)) {
        event.preventDefault();
        deps.changed();
        refresh();
      }
    },
    { passive: false },
  );

  // Keys on the focused canvas only (never while a text field has focus: the target must be the canvas itself). They do not use the
  // driving keys (arrows, space, R).
  on(canvas, 'keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key;
    if (key === '+' || key === '=') act(() => controller.zoomIn());
    else if (key === '-' || key === '_') act(() => controller.zoomOut());
    else if (key === '0') act(() => controller.fit());
    else if (key === 'f' || key === 'F') act(() => controller.toggleFollow());
    else return;
    event.preventDefault();
  });

  refresh();
  return {
    refresh,
    stop() {
      for (const cleanup of cleanups.splice(0)) cleanup();
      panel.hidden = true;
      if (previous.tabIndex === null) canvas.removeAttribute('tabindex');
      else canvas.setAttribute('tabindex', previous.tabIndex);
      if (previous.label !== null) canvas.setAttribute('aria-label', previous.label);
    },
  };
}
