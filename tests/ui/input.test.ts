import { describe, expect, it } from 'vitest';
import { NO_INPUT } from '../../src/ai/drivers';
import {
  KEY_BINDINGS,
  attachHoldButton,
  attachKeyboard,
  attachSafetyRelease,
  createHeldInputs,
} from '../../src/ui/controls/input';

/** A plain DOM-like event carrying the fields the handlers read. */
function event(type: string, fields: Record<string, unknown> = {}) {
  const e = new Event(type, { cancelable: true });
  return Object.assign(e, { code: '', repeat: false, ctrlKey: false, metaKey: false, altKey: false, pointerId: 1, button: 0, ...fields });
}

function keyboard() {
  const target = new EventTarget();
  const held = createHeldInputs();
  let restarts = 0;
  const detach = attachKeyboard(target, held, () => (restarts += 1));
  const key = (type: 'keydown' | 'keyup', code: string, fields: Record<string, unknown> = {}) => {
    const e = event(type, { code, ...fields });
    target.dispatchEvent(e);
    return e;
  };
  return { held, key, restarts: () => restarts, detach };
}

describe('held inputs', () => {
  it('holds an action while any source holds it', () => {
    const held = createHeldInputs();
    held.press('accelerate', 'key:ArrowUp');
    held.press('accelerate', 'pointer:3');
    held.release('key:ArrowUp');
    expect(held.read().accelerate).toBe(true);
    held.release('pointer:3');
    expect(held.read()).toEqual(NO_INPUT);
  });

  it('holds several actions at once, and releases everything together', () => {
    const held = createHeldInputs();
    held.press('left', 'pointer:1');
    held.press('accelerate', 'pointer:2');
    expect(held.read()).toEqual({ left: true, right: false, accelerate: true, brake: false });
    held.releaseAll();
    expect(held.read()).toEqual(NO_INPUT);
  });
});

describe('keyboard', () => {
  it('binds arrows and WASD to steering, throttle and brake, Space to brake and R to restart', () => {
    expect(KEY_BINDINGS).toMatchObject({
      ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
      ArrowUp: 'accelerate', KeyW: 'accelerate', ArrowDown: 'brake', KeyS: 'brake', Space: 'brake', KeyR: 'restart',
    });
  });

  it('holds keys while down, several at once, and releases each on key-up', () => {
    const { held, key } = keyboard();
    key('keydown', 'KeyW');
    key('keydown', 'ArrowRight');
    expect(held.read()).toEqual({ left: false, right: true, accelerate: true, brake: false });
    key('keyup', 'KeyW');
    expect(held.read()).toEqual({ left: false, right: true, accelerate: false, brake: false });
    key('keyup', 'ArrowRight');
    expect(held.read()).toEqual(NO_INPUT);
  });

  it('keeps an action held by two keys until both are released', () => {
    const { held, key } = keyboard();
    key('keydown', 'Space');
    key('keydown', 'ArrowDown');
    key('keyup', 'Space');
    expect(held.read().brake).toBe(true);
    key('keyup', 'ArrowDown');
    expect(held.read().brake).toBe(false);
  });

  it('prevents the default action (page scroll) for bound keys only', () => {
    const { key } = keyboard();
    expect(key('keydown', 'Space').defaultPrevented).toBe(true);
    expect(key('keydown', 'ArrowDown').defaultPrevented).toBe(true);
    expect(key('keydown', 'Tab').defaultPrevented).toBe(false);
  });

  it('ignores shortcuts with Ctrl, Cmd or Alt', () => {
    const { held, key, restarts } = keyboard();
    key('keydown', 'KeyR', { metaKey: true });
    key('keydown', 'KeyW', { ctrlKey: true });
    expect(restarts()).toBe(0);
    expect(held.read()).toEqual(NO_INPUT);
  });

  it('restarts once per press of R, not on auto-repeat, and R holds nothing', () => {
    const { held, key, restarts } = keyboard();
    key('keydown', 'KeyR');
    key('keydown', 'KeyR', { repeat: true });
    key('keydown', 'KeyR', { repeat: true });
    expect(restarts()).toBe(1);
    expect(held.read()).toEqual(NO_INPUT);
  });

  it('stops listening when detached', () => {
    const { held, key, detach } = keyboard();
    detach();
    key('keydown', 'KeyW');
    expect(held.read()).toEqual(NO_INPUT);
  });
});

describe('touch buttons', () => {
  function button(action: 'left' | 'right' | 'accelerate' | 'brake', held = createHeldInputs()) {
    const captured: number[] = [];
    const target = Object.assign(new EventTarget(), {
      setPointerCapture: (id: number) => {
        if (id === 99) throw new Error('NotFoundError'); // a pointer that has already ended
        captured.push(id);
      },
    });
    attachHoldButton(target, action, held);
    const fire = (type: string, pointerId: number, fields: Record<string, unknown> = {}) => {
      const e = event(type, { pointerId, ...fields });
      target.dispatchEvent(e);
      return e;
    };
    return { held, fire, captured };
  }

  it('holds while a finger is down, captures the pointer, and releases on lift', () => {
    const { held, fire, captured } = button('accelerate');
    const down = fire('pointerdown', 7);
    expect(down.defaultPrevented).toBe(true);
    expect(captured).toEqual([7]);
    expect(held.read().accelerate).toBe(true);
    fire('pointerup', 7);
    expect(held.read().accelerate).toBe(false);
  });

  it.each(['pointercancel', 'lostpointercapture'])('releases on %s', (type) => {
    const { held, fire } = button('brake');
    fire('pointerdown', 4);
    fire(type, 4);
    expect(held.read().brake).toBe(false);
  });

  it('lets two fingers hold two buttons at once: steer while accelerating', () => {
    const held = createHeldInputs();
    const steer = button('left', held);
    const gas = button('accelerate', held);
    steer.fire('pointerdown', 1);
    gas.fire('pointerdown', 2);
    expect(held.read()).toEqual({ left: true, right: false, accelerate: true, brake: false });
    steer.fire('pointerup', 1);
    expect(held.read()).toEqual({ left: false, right: false, accelerate: true, brake: false });
  });

  it('keeps holding when one of two fingers on the same button lifts', () => {
    const { held, fire } = button('accelerate');
    fire('pointerdown', 1);
    fire('pointerdown', 2);
    fire('pointerup', 1);
    expect(held.read().accelerate).toBe(true);
    fire('pointerup', 2);
    expect(held.read().accelerate).toBe(false);
  });

  it('ignores the right and middle mouse buttons, and blocks the long-press menu', () => {
    const { held, fire } = button('accelerate');
    fire('pointerdown', 1, { button: 2 });
    expect(held.read().accelerate).toBe(false);
    expect(fire('contextmenu', 1).defaultPrevented).toBe(true);
  });

  it('still holds when pointer capture fails', () => {
    const { held, fire } = button('right');
    fire('pointerdown', 99);
    expect(held.read().right).toBe(true);
    fire('pointerup', 99);
    expect(held.read().right).toBe(false);
  });
});

describe('safety release', () => {
  function setup() {
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    const held = createHeldInputs();
    attachSafetyRelease(win, doc, held);
    held.press('accelerate', 'key:KeyW');
    held.press('left', 'pointer:1');
    return { win, doc, held };
  }

  it.each(['blur', 'pagehide'])('releases everything on window %s', (type) => {
    const { win, held } = setup();
    win.dispatchEvent(new Event(type));
    expect(held.read()).toEqual(NO_INPUT);
  });

  it('releases everything when the page is hidden, but not when it becomes visible', () => {
    const { doc, held } = setup();
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(held.read().accelerate).toBe(true);
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(held.read()).toEqual(NO_INPUT);
  });
});
