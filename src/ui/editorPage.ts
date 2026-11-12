// The track editor page (P4-02, `?mode=edit`): a thin shell that measures the canvas, turns pointer and keyboard events
// into calls on the DOM-free controller (ui/editorController.ts) and shows the controller's state. All decisions are
// in the controller and the pure editor (src/editor/trackEditor.ts); this file is covered by the browser tests.
import type { EditorHistory } from '../editor/trackEditor';
import { EDITOR_LIMITS } from '../editor/trackEditor';
import { TOUCH_RADIUS_PX, drawEditor, editorView } from '../render/editorView';
import { browserViewportEnvironment, createViewport, type ViewportSize } from '../render/viewport';
import type { Track, Vec2 } from '../sim/track';
import { createEditorController, type EditorMode } from './editorController';

const must = <T extends Element>(selector: string): T => {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`The track editor needs ${selector} on the page.`);
  return found;
};

export interface EditorPageDeps {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  readonly history?: EditorHistory | undefined;
  /** Called with the built track and the editor's history when the user presses Drive it (the editor has been stopped). */
  readonly onDrive: (track: Track, history: EditorHistory) => void;
}

export interface EditorPage {
  /** Stops listening and hides the editor panel. */
  stop(): void;
}

export function startEditorPage(deps: EditorPageDeps): EditorPage {
  const { canvas, context } = deps;
  const panel = must<HTMLElement>('#editor-panel');
  const status = must<HTMLElement>('#ed-status');
  const message = must<HTMLElement>('#ed-message');
  const problems = must<HTMLElement>('#ed-problems');
  const pointsList = must<HTMLElement>('#ed-points');
  const startControl = must<HTMLElement>('#ed-start');
  const modeButtons = [...document.querySelectorAll<HTMLButtonElement>('button[data-editor-mode]')];
  const button = (id: string): HTMLButtonElement => must<HTMLButtonElement>(`#${id}`);
  const undoButton = button('ed-undo');
  const redoButton = button('ed-redo');
  const widthMinus = button('ed-width-minus');
  const widthPlus = button('ed-width-plus');
  const gatesMinus = button('ed-gates-minus');
  const gatesPlus = button('ed-gates-plus');
  const snapButton = button('ed-snap');
  const closeButton = button('ed-close');
  const insertButton = button('ed-insert');
  const clearButton = button('ed-clear');
  const driveButton = button('ed-drive');
  const startButtons: [HTMLButtonElement, number][] = [
    [button('ed-start-back10'), -10],
    [button('ed-start-back1'), -1],
    [button('ed-start-fwd1'), 1],
    [button('ed-start-fwd10'), 10],
  ];

  const controller = createEditorController(deps.history);
  const cleanups: (() => void)[] = [];
  const on = <K extends keyof HTMLElementEventMap>(target: HTMLElement, type: K, handler: (event: HTMLElementEventMap[K]) => void): void => {
    target.addEventListener(type, handler as EventListener);
    cleanups.push(() => target.removeEventListener(type, handler as EventListener));
  };
  const onDocument = (type: 'keydown', handler: (event: KeyboardEvent) => void): void => {
    document.addEventListener(type, handler);
    cleanups.push(() => document.removeEventListener(type, handler));
  };

  panel.hidden = false;
  document.documentElement.classList.add('editing');
  canvas.classList.add('editing');
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'application');
  canvas.setAttribute('aria-label', 'Track editor canvas. Arrow keys move the crosshair, Enter adds a point.');
  let keyboardUsed = false;
  let size: ViewportSize | undefined;

  const worldOf = (event: PointerEvent): Vec2 | null => {
    if (!size) return null;
    const rect = canvas.getBoundingClientRect();
    const view = editorView(size);
    if (!(view.scale > 0) || rect.width === 0 || rect.height === 0) return null;
    const x = ((event.clientX - rect.left) / rect.width) * size.cssWidth;
    const y = ((event.clientY - rect.top) / rect.height) * size.cssHeight;
    return { x: (x - view.offsetX) / view.scale, y: (y - view.offsetY) / view.scale };
  };
  const reach = (): number => (size ? TOUCH_RADIUS_PX / Math.max(editorView(size).scale, 1e-6) : 3);

  let pointsSignature = '';
  const renderPoints = (): void => {
    const state = controller.state();
    const signature = JSON.stringify([state.points, state.closed]);
    const hadFocus = pointsList.contains(document.activeElement);
    if (signature !== pointsSignature) {
      pointsSignature = signature;
      pointsList.replaceChildren(
        ...state.points.map((p, i) => {
          const item = document.createElement('li');
          item.tabIndex = 0;
          item.textContent = String(i + 1);
          item.setAttribute('aria-label', `Point ${i + 1} of ${state.points.length}, x ${p.x}, y ${p.y}`);
          item.addEventListener('focus', () => {
            controller.select(i);
            refresh(false);
          });
          item.addEventListener('click', () => {
            controller.select(i);
            refresh(false);
          });
          return item;
        }),
      );
    }
    [...pointsList.children].forEach((item, i) => item.setAttribute('aria-selected', String(i === controller.selected())));
    if (hadFocus && controller.selected() >= 0) (pointsList.children[controller.selected()] as HTMLElement | undefined)?.focus({ preventScroll: true });
  };

  const draw = (): void => {
    if (!size || size.width === 0) return;
    const view = editorView(size);
    const result = controller.status();
    drawEditor(context, size, view, {
      state: controller.state(),
      selected: controller.selected(),
      crosshair: controller.crosshair(),
      showCrosshair: keyboardUsed && document.activeElement === canvas,
      problems: result.kind === 'invalid' ? result.problems : [],
    });
    Object.assign(canvas.dataset, {
      editorScale: String(view.scale),
      editorOffsetX: String(view.offsetX),
      editorOffsetY: String(view.offsetY),
      editorPoints: String(controller.state().points.length),
      editorClosed: String(controller.state().closed),
      editorStatus: result.kind,
    });
  };

  const refresh = (rerenderPoints = true): void => {
    const state = controller.state();
    const result = controller.status();
    const history = controller.history();
    for (const b of modeButtons) b.setAttribute('aria-pressed', String(b.dataset.editorMode === controller.mode()));
    undoButton.disabled = history.past.length === 0;
    redoButton.disabled = history.future.length === 0;
    widthMinus.disabled = state.width <= EDITOR_LIMITS.minWidth;
    widthPlus.disabled = state.width >= EDITOR_LIMITS.maxWidth;
    gatesMinus.disabled = state.gateSpacing >= EDITOR_LIMITS.maxGateSpacing;
    gatesPlus.disabled = state.gateSpacing <= EDITOR_LIMITS.minGateSpacing;
    snapButton.textContent = state.snap > 0 ? `Snap ${state.snap} m` : 'Snap off';
    closeButton.disabled = state.closed || state.points.length < EDITOR_LIMITS.minPoints;
    insertButton.disabled = !state.closed || controller.selected() < 0;
    clearButton.disabled = state.points.length === 0;
    for (const [b] of startButtons) b.disabled = !state.closed;
    driveButton.disabled = result.kind !== 'valid';
    status.textContent = result.message;
    status.dataset.kind = result.kind;
    problems.replaceChildren(
      ...(result.kind === 'invalid' ? result.problems.slice(1, 6) : []).map((text) => {
        const item = document.createElement('li');
        item.textContent = text;
        return item;
      }),
    );
    message.textContent = controller.message();
    const info = controller.startInfo();
    startControl.setAttribute('aria-disabled', String(info === null));
    startControl.setAttribute('aria-valuemax', String(info ? Math.round(info.length) : 0));
    startControl.setAttribute('aria-valuenow', String(info ? Math.round(info.offset) : 0));
    const text = info ? `Start position, ${Math.round(info.offset)} m along a ${Math.round(info.length)} m line` : 'Close the loop to place the start';
    startControl.setAttribute('aria-valuetext', text);
    startControl.textContent = info ? `Start ${Math.round(info.offset)} m / ${Math.round(info.length)} m` : 'Start (close the loop first)';
    if (rerenderPoints) renderPoints();
    draw();
  };

  const viewport = createViewport(canvas, browserViewportEnvironment(canvas), (next) => {
    size = next;
    draw();
  });
  cleanups.push(() => viewport.stop());

  // ---- Pointer: Pointer Events for mouse, touch and pen alike. ----
  on(canvas, 'pointerdown', (event) => {
    if (event.button !== 0) return;
    const at = worldOf(event);
    if (!at) return;
    keyboardUsed = false;
    event.preventDefault();
    controller.pointerDown(at, reach());
    if (controller.dragging()) canvas.setPointerCapture?.(event.pointerId);
    refresh();
  });
  on(canvas, 'pointermove', (event) => {
    if (!controller.dragging()) return;
    const at = worldOf(event);
    if (!at) return;
    controller.pointerMove(at);
    refresh(false);
  });
  const finish = (cancel: boolean) => (): void => {
    if (!controller.dragging()) return;
    if (cancel) controller.pointerCancel();
    else controller.pointerUp();
    refresh();
  };
  on(canvas, 'pointerup', finish(false));
  on(canvas, 'pointercancel', finish(true));
  on(canvas, 'lostpointercapture', finish(false));

  // ---- Toolbar. ----
  for (const b of modeButtons) {
    on(b, 'click', () => {
      controller.setMode(b.dataset.editorMode as EditorMode);
      refresh();
    });
  }
  const click = (target: HTMLButtonElement, action: () => void): void => on(target, 'click', () => { action(); refresh(); });
  click(undoButton, () => controller.undo());
  click(redoButton, () => controller.redo());
  click(widthMinus, () => controller.narrow());
  click(widthPlus, () => controller.widen());
  click(gatesMinus, () => controller.fewerGates());
  click(gatesPlus, () => controller.moreGates());
  click(snapButton, () => controller.cycleSnap());
  click(closeButton, () => controller.close());
  click(insertButton, () => controller.insertAfterSelected());
  click(clearButton, () => controller.clear());
  for (const [b, delta] of startButtons) click(b, () => controller.moveStartBy(delta));
  on(driveButton, 'click', () => {
    const result = controller.status();
    if (result.kind !== 'valid') return;
    const history = controller.history();
    stop();
    deps.onDrive(result.track, history);
  });

  // ---- Keyboard. ----
  const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  on(canvas, 'keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const arrow = ARROWS[event.key];
    if (arrow) {
      event.preventDefault();
      keyboardUsed = true;
      controller.moveCrosshair(arrow[0], arrow[1], event.shiftKey);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      keyboardUsed = true;
      controller.crosshairEnter();
    } else if (event.key === 'Escape') {
      controller.clearSelection();
    } else {
      return;
    }
    refresh();
  });
  on(pointsList, 'keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const arrow = ARROWS[event.key];
    if (arrow) {
      event.preventDefault();
      controller.nudgeSelected(arrow[0], arrow[1], event.shiftKey);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      controller.deleteSelected();
    } else {
      return;
    }
    refresh();
  });
  on(startControl, 'keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const gate = controller.state().gateSpacing;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') controller.moveStartBy(event.shiftKey ? 10 : 1);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') controller.moveStartBy(event.shiftKey ? -10 : -1);
    else if (event.key === 'PageUp') controller.moveStartBy(gate);
    else if (event.key === 'PageDown') controller.moveStartBy(-gate);
    else if (event.key === 'Home') controller.moveStartToBeginning();
    else return;
    event.preventDefault();
    refresh(false);
  });
  onDocument('keydown', (event) => {
    const mod = event.ctrlKey || event.metaKey;
    if (mod && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) controller.undo();
      else if ((key === 'z' && event.shiftKey) || key === 'y') controller.redo();
      else return;
      event.preventDefault();
      refresh();
      return;
    }
    if (event.altKey || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    switch (event.key.toLowerCase()) {
      case 'c':
        controller.close();
        break;
      case 'i':
        controller.insertAfterSelected();
        break;
      case 'a':
        controller.setMode('add');
        break;
      case 'm':
        controller.setMode('move');
        break;
      case 'd':
        controller.setMode('delete');
        break;
      default:
        return;
    }
    refresh();
  });
  on(canvas, 'focus', () => draw());
  on(canvas, 'blur', () => draw());

  function stop(): void {
    for (const cleanup of cleanups.splice(0)) cleanup();
    panel.hidden = true;
    document.documentElement.classList.remove('editing');
    canvas.classList.remove('editing');
    canvas.removeAttribute('tabindex');
    canvas.removeAttribute('role');
    canvas.removeAttribute('aria-label');
  }

  refresh();
  return { stop };
}
