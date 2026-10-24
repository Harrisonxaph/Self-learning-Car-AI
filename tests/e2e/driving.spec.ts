// Manual driving in a real browser: keyboard, on-screen buttons (mouse and touch), combined inputs,
// releasing inputs safely, braking, crashing, restarting and completing a lap. The page publishes the car's
// state on the canvas's data attributes after every frame; these tests read it there.
import { expect, test, type Page } from '@playwright/test';

interface CarState {
  x: number;
  y: number;
  heading: number;
  speed: number;
  crashed: boolean;
  laps: number;
  gatesPassed: number;
  nextGate: number;
}

async function car(page: Page): Promise<CarState> {
  return page.locator('#sim-canvas').evaluate((node) => {
    const d = (node as HTMLCanvasElement).dataset;
    return {
      x: Number(d.carX),
      y: Number(d.carY),
      heading: Number(d.carHeading),
      speed: Number(d.carSpeed),
      crashed: d.crashed === 'true',
      laps: Number(d.laps),
      gatesPassed: Number(d.gatesPassed),
      nextGate: Number(d.nextGate),
    };
  });
}

const START = { x: -6, y: 40, heading: 0 };
const button = (page: Page, action: string) => page.locator(`.controls button[data-action="${action}"]`);

let errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await expect.poll(async () => (await car(page)).x).toBe(START.x);
});
test.afterEach(() => {
  expect(errors).toEqual([]);
});

test('starts at rest on the start pose with the lap display empty', async ({ page }) => {
  expect(await car(page)).toEqual({ ...START, speed: 0, crashed: false, laps: 0, gatesPassed: 0, nextGate: 0 });
  await expect(page.locator('#hud-laps')).toHaveText('0');
  await expect(page.locator('#hud-best')).toHaveText('—');
  await expect(page.locator('#hud-gate')).toHaveText('1 / 20');
  // Every control is a touch target of at least 44 × 44 CSS pixels.
  for (const box of await page.locator('.controls button').evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect()))) {
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
});

test.describe('keyboard', () => {
  test('accelerates, steers while accelerating, and brakes to a stop', async ({ page }) => {
    await page.keyboard.down('KeyW');
    await expect.poll(async () => (await car(page)).speed).toBeGreaterThan(8);
    const straight = await car(page);
    expect(straight.heading).toBe(0);
    expect(straight.x).toBeGreaterThan(START.x);
    // Steer right while still accelerating: the heading increases (clockwise on screen) and speed keeps rising.
    await page.keyboard.down('ArrowRight');
    await expect.poll(async () => (await car(page)).heading).toBeGreaterThan(0.05);
    await page.keyboard.up('ArrowRight');
    await page.keyboard.up('KeyW');
    // Space brakes to a full stop, without scrolling the page.
    await page.keyboard.down('Space');
    await expect.poll(async () => (await car(page)).speed, { timeout: 5000 }).toBe(0);
    await page.keyboard.up('Space');
    expect(await page.evaluate(() => [window.scrollX, window.scrollY])).toEqual([0, 0]);
    expect((await car(page)).crashed).toBe(false);
  });

  test('crashes into a wall with feedback, and R restarts at the start', async ({ page }) => {
    await page.keyboard.down('ArrowUp');
    await expect.poll(async () => (await car(page)).crashed, { timeout: 15_000 }).toBe(true);
    await page.keyboard.up('ArrowUp');
    const crashed = await car(page);
    expect(crashed.speed).toBe(0);
    expect(crashed.gatesPassed).toBe(3); // gates 0, 1 and 2 on the straight before the curve
    await expect(page.locator('#hud-message')).toHaveText(/Crashed/);
    // Held keys do nothing while crashed.
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(300);
    expect((await car(page)).x).toBe(crashed.x);
    await page.keyboard.up('KeyW');

    await page.keyboard.press('KeyR');
    await expect.poll(() => car(page)).toEqual({ ...START, speed: 0, crashed: false, laps: 0, gatesPassed: 0, nextGate: 0 });
    await expect(page.locator('#hud-message')).toHaveText(/Restarted/);
    await expect(page.locator('#hud-current')).toHaveText('—');
  });

  test('releases held keys when the window loses focus', async ({ page }) => {
    await page.keyboard.down('KeyW');
    await expect.poll(async () => (await car(page)).speed).toBeGreaterThan(5);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    const atBlur = (await car(page)).speed;
    // No throttle any more: the car coasts and slows, though the key was never released.
    await expect.poll(async () => (await car(page)).speed).toBeLessThan(atBlur - 0.5);
    await page.keyboard.up('KeyW');
  });

  test('releases held keys when the page is hidden, and resumes without a jump', async ({ page }) => {
    await page.keyboard.down('KeyW');
    await expect.poll(async () => (await car(page)).speed).toBeGreaterThan(5);
    await setPageHidden(page, true);
    const hidden = await car(page);
    await page.waitForTimeout(800);
    expect((await car(page)).x).toBe(hidden.x); // paused while hidden
    await setPageHidden(page, false);
    // Back on screen the throttle is released (it was released on hiding) and there is no catch-up jump.
    await page.waitForTimeout(200);
    const shown = await car(page);
    expect(shown.x - hidden.x).toBeLessThan(hidden.speed * 0.5);
    await expect.poll(async () => (await car(page)).speed).toBeLessThan(hidden.speed);
    await page.keyboard.up('KeyW');
  });

  test('completes a timed lap, driven by keyboard events', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('desktop'), 'One long keyboard lap per desktop browser keeps CI short.');
    test.setTimeout(120_000);
    await driveLap(page, 'keyboard');
    await expect.poll(async () => (await car(page)).laps, { timeout: 100_000, intervals: [1000] }).toBe(1);
    expect((await car(page)).crashed).toBe(false);
    await expect(page.locator('#hud-laps')).toHaveText('1');
    await expect(page.locator('#hud-best')).toHaveText(/^\d+\.\d\d s$/);
    await expect(page.locator('#hud-last')).toHaveText(await page.locator('#hud-best').textContent() ?? '');
  });
});

test.describe('on-screen buttons', () => {
  test('a held mouse button accelerates, keeps holding when the pointer slides off, and releases anywhere', async ({ page }, testInfo) => {
    test.skip(!!testInfo.project.use.hasTouch, 'Mouse pointers on desktop; touch projects use touch below.');
    const gas = await button(page, 'accelerate').boundingBox();
    if (!gas) throw new Error('No Gas button');
    await page.mouse.move(gas.x + gas.width / 2, gas.y + gas.height / 2);
    await page.mouse.down();
    await expect.poll(async () => (await car(page)).speed).toBeGreaterThan(5);
    await expect(button(page, 'accelerate')).toHaveClass(/held/);
    // Pointer capture: sliding off the button keeps it held.
    await page.mouse.move(gas.x - 200, gas.y - 200);
    const off = (await car(page)).speed;
    await expect.poll(async () => (await car(page)).speed).toBeGreaterThan(off);
    await page.mouse.up();
    const released = (await car(page)).speed;
    await expect.poll(async () => (await car(page)).speed).toBeLessThan(released);
    await expect(button(page, 'accelerate')).not.toHaveClass(/held/);
  });

  test('two fingers steer and accelerate at once, a cancelled touch releases, and Restart is tappable', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.use.hasTouch, 'Touch projects only.');
    // Playwright cannot hold real touches, so these are touch PointerEvents dispatched on the buttons; the tap on
    // Restart below is a real touchscreen tap.
    const touch = (action: string, type: string, pointerId: number) =>
      button(page, action).dispatchEvent(type, { pointerId, pointerType: 'touch', isPrimary: pointerId === 1, button: 0, bubbles: true, cancelable: true });
    await touch('accelerate', 'pointerdown', 1);
    await touch('right', 'pointerdown', 2);
    await expect.poll(async () => (await car(page)).heading).toBeGreaterThan(0.05);
    expect((await car(page)).speed).toBeGreaterThan(0);
    await expect(button(page, 'right')).toHaveClass(/held/);
    await expect(button(page, 'accelerate')).toHaveClass(/held/);
    // A system gesture cancels the throttle finger: the throttle is released, steering stays held.
    await touch('accelerate', 'pointercancel', 1);
    await expect(button(page, 'accelerate')).not.toHaveClass(/held/);
    await expect(button(page, 'right')).toHaveClass(/held/);
    await touch('right', 'pointerup', 2);
    // Brake with a finger to a stop.
    await touch('brake', 'pointerdown', 3);
    await expect.poll(async () => (await car(page)).speed, { timeout: 5000 }).toBe(0);
    await touch('brake', 'pointerup', 3);

    // Drive into the wall, then restart with a real tap.
    await touch('accelerate', 'pointerdown', 4);
    await expect.poll(async () => (await car(page)).crashed, { timeout: 15_000 }).toBe(true);
    await touch('accelerate', 'pointerup', 4);
    await page.locator('#restart').tap();
    await expect.poll(() => car(page)).toEqual({ ...START, speed: 0, crashed: false, laps: 0, gatesPassed: 0, nextGate: 0 });
    expect(await page.evaluate(() => [window.scrollX, window.scrollY, visualViewport?.scale ?? 1])).toEqual([0, 0, 1]);
  });

  test('completes a timed lap, driven by touch button events', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('phone'), 'One long touch lap per phone browser keeps CI short.');
    test.setTimeout(120_000);
    await driveLap(page, 'touch');
    await expect.poll(async () => (await car(page)).laps, { timeout: 100_000, intervals: [1000] }).toBe(1);
    expect((await car(page)).crashed).toBe(false);
    await expect(page.locator('#hud-laps')).toHaveText('1');
    await expect(page.locator('#hud-message')).toHaveText(/^Lap 1: \d+\.\d\d s \(best\)$/);
  });
});

/**
 * Starts a scripted driver inside the page: every animation frame it reads the car's published state and
 * presses or releases controls to follow the oval's centre line at about 14 m/s, through the same input path
 * a player uses (keyboard events on the window, or touch pointer events on the buttons).
 */
async function driveLap(page: Page, via: 'keyboard' | 'touch') {
  await page.evaluate((mode) => {
    const canvas = document.querySelector<HTMLCanvasElement>('#sim-canvas')!;
    const STRAIGHT = 120;
    const ARC = 40 * Math.PI;
    const LAP = 2 * STRAIGHT + 2 * ARC;
    const centre = (d: number): [number, number] => {
      const s = ((d % LAP) + LAP) % LAP;
      if (s < STRAIGHT) return [-60 + s, 40];
      if (s < STRAIGHT + ARC) return [60 + 40 * Math.sin((s - STRAIGHT) / 40), 40 * Math.cos((s - STRAIGHT) / 40)];
      if (s < 2 * STRAIGHT + ARC) return [60 - (s - STRAIGHT - ARC), -40];
      const t = (s - 2 * STRAIGHT - ARC) / 40;
      return [-60 - 40 * Math.sin(t), -40 * Math.cos(t)];
    };
    const keys = { left: 'ArrowLeft', right: 'ArrowRight', accelerate: 'ArrowUp', brake: 'Space' } as const;
    const ids = { left: 21, right: 22, accelerate: 23, brake: 24 } as const;
    const held = { left: false, right: false, accelerate: false, brake: false };
    const set = (action: keyof typeof held, on: boolean) => {
      if (held[action] === on) return;
      held[action] = on;
      if (mode === 'keyboard') {
        window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { code: keys[action], bubbles: true, cancelable: true }));
      } else {
        const target = document.querySelector(`.controls button[data-action="${action}"]`)!;
        target.dispatchEvent(
          new PointerEvent(on ? 'pointerdown' : 'pointerup', { pointerId: ids[action], pointerType: 'touch', button: 0, bubbles: true, cancelable: true }),
        );
      }
    };
    const frame = () => {
      const d = canvas.dataset;
      if (d.laps !== '0' || d.crashed === 'true') {
        (Object.keys(held) as (keyof typeof held)[]).forEach((a) => set(a, false));
        return;
      }
      const x = Number(d.carX);
      const y = Number(d.carY);
      const v = Number(d.carSpeed);
      let best = 0;
      let bestDistance = Infinity;
      for (let s = 0; s < LAP; s += 1) {
        const [cx, cy] = centre(s);
        const distance = (cx - x) ** 2 + (cy - y) ** 2;
        if (distance < bestDistance) [best, bestDistance] = [s, distance];
      }
      const [tx, ty] = centre(best + 10);
      let angle = Math.atan2(ty - y, tx - x) - Number(d.carHeading);
      angle = Math.atan2(Math.sin(angle), Math.cos(angle));
      set('left', angle < -0.04);
      set('right', angle > 0.04);
      set('accelerate', v < 13);
      set('brake', v > 15);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }, via);
}

/** Makes the page report itself hidden or visible and fires `visibilitychange`, as on an app switch or lock. */
async function setPageHidden(page: Page, hidden: boolean) {
  await page.evaluate((isHidden) => {
    const state = isHidden ? 'hidden' : 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => isHidden });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}
