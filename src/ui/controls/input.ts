// Human input: keyboard keys and on-screen touch buttons, both recorded as "held" sources per action. The
// simulation reads a snapshot each tick through a HumanDriver (ai/drivers.ts); nothing here touches the car.
//
// Several sources can hold the same action (a key and a finger), and any actions can be held together
// (steer while accelerating). Every source is released when it ends, and all of them at once when input can
// no longer be trusted: a cancelled pointer, the window losing focus, or the page being hidden.
import { NO_INPUT, type HumanInput } from '../../ai/drivers';

export type HoldAction = keyof HumanInput;

/** Keys by `KeyboardEvent.code` (layout-independent positions). Arrows or WASD; Space also brakes; R restarts. */
export const KEY_BINDINGS: Readonly<Record<string, HoldAction | 'restart'>> = Object.freeze({
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'accelerate',
  KeyW: 'accelerate',
  ArrowDown: 'brake',
  KeyS: 'brake',
  Space: 'brake',
  KeyR: 'restart',
});

/** Which sources (keys, pointers) currently hold each action. */
export interface HeldInputs {
  press(action: HoldAction, source: string): void;
  /** Releases a source from whatever it was holding. */
  release(source: string): void;
  releaseAll(): void;
  read(): HumanInput;
}

export function createHeldInputs(): HeldInputs {
  const held = new Map<string, HoldAction>();
  return {
    press: (action, source) => void held.set(source, action),
    release: (source) => void held.delete(source),
    releaseAll: () => held.clear(),
    read() {
      if (held.size === 0) return NO_INPUT;
      const actions = new Set(held.values());
      return { left: actions.has('left'), right: actions.has('right'), accelerate: actions.has('accelerate'), brake: actions.has('brake') };
    },
  };
}

/** Anything events can be listened to on: window, document, a button, or a plain EventTarget in tests. */
type Listenable = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
// The parts of DOM events these handlers use, so tests can dispatch plain Events with these fields.
interface KeyLike {
  readonly code: string;
  readonly repeat: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  preventDefault(): void;
}
interface PointerLike {
  readonly pointerId: number;
  readonly button: number;
  readonly currentTarget: unknown;
  preventDefault(): void;
}

/** Wires up a listener and returns a function that removes it. */
function listen<E>(target: Listenable, type: string, listener: (event: E) => void) {
  const handler = listener as unknown as EventListener;
  target.addEventListener(type, handler);
  return () => target.removeEventListener(type, handler);
}

/**
 * Keyboard: bound keys are held while down and released on key-up. Their default action (scrolling, or
 * clicking a focused button with Space) is prevented. Shortcuts with Ctrl, Cmd or Alt are left alone.
 * R restarts once per press, not on auto-repeat.
 */
export function attachKeyboard(target: Listenable, held: HeldInputs, onRestart: () => void): () => void {
  const down = listen<KeyLike>(target, 'keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const binding = KEY_BINDINGS[event.code];
    if (!binding) return;
    event.preventDefault();
    if (binding === 'restart') {
      if (!event.repeat) onRestart();
      return;
    }
    held.press(binding, `key:${event.code}`);
  });
  const up = listen<KeyLike>(target, 'keyup', (event) => held.release(`key:${event.code}`));
  return () => {
    down();
    up();
  };
}

/** An on-screen button that holds an action while a finger (or mouse button) is down on it. */
export interface HoldButton extends Listenable {
  setPointerCapture?(pointerId: number): void;
}

/**
 * Touch and mouse: each pointer on a button holds that button's action until the pointer lifts, is
 * cancelled (for example by a system gesture) or loses capture. Pointer capture keeps the hold even if the
 * finger slides off the button, so lifting it anywhere releases it. Several fingers work at once.
 */
export function attachHoldButton(button: HoldButton, action: HoldAction, held: HeldInputs): () => void {
  const source = (event: PointerLike) => `pointer:${event.pointerId}`;
  const press = listen<PointerLike>(button, 'pointerdown', (event) => {
    if (event.button !== 0) return; // primary mouse button, or any touch or pen contact
    event.preventDefault();
    try {
      button.setPointerCapture?.(event.pointerId);
    } catch {
      // Capture can fail for a pointer that has already ended; the release listeners still apply.
    }
    held.press(action, source(event));
  });
  const removers = [press];
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    removers.push(listen<PointerLike>(button, type, (event) => held.release(source(event))));
  }
  // A long press must not open the system menu or start a text selection.
  removers.push(listen<PointerLike>(button, 'contextmenu', (event) => event.preventDefault()));
  return () => removers.forEach((remove) => remove());
}

/**
 * Releases everything when input can no longer be trusted: the window loses focus (key-ups would go
 * elsewhere), or the page is hidden or being left (app switch, lock screen, tab change).
 */
export function attachSafetyRelease(win: Listenable, doc: Listenable & { readonly visibilityState: string }, held: HeldInputs): () => void {
  const releaseAll = () => held.releaseAll();
  const removers = [
    listen(win, 'blur', releaseAll),
    listen(win, 'pagehide', releaseAll),
    listen(doc, 'visibilitychange', () => {
      if (doc.visibilityState === 'hidden') releaseAll();
    }),
  ];
  return () => removers.forEach((remove) => remove());
}
