// The camera in a real browser (P4-07): fit is the default and draws as before; Zoom + / Zoom − / Fit change the published camera and the
// drawn scale; Follow keeps the car near the middle of the view; a drag pans and pauses following; the wheel zooms about the cursor; a
// two-finger pinch on the canvas zooms the canvas and does NOT zoom or scroll the page (touch projects); keyboard shortcuts on the focused
// canvas work and driving by keyboard is unaffected; every control is at least 44 px; nothing scrolls sideways at 320 px. Emulated
// browsers only: real pinch feel and frame rate on a phone are the owner's device checks.
import { expect, test, type Page } from '@playwright/test';

let errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
});
test.afterEach(() => {
  expect(errors).toEqual([]);
});

const canvas = (page: Page) => page.locator('#sim-canvas');
const data = (page: Page) => canvas(page).evaluate((n) => ({ ...(n as HTMLCanvasElement).dataset }));
const num = async (page: Page, key: string) => Number((await data(page))[key]);

async function openDrive(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#camera-controls')).toBeVisible();
  await expect.poll(async () => (await data(page)).carX).toBeDefined();
}

test('fit is the default: the camera reads fit at zoom 1 and the track draws at its fitted scale', async ({ page }) => {
  await openDrive(page);
  const d = await data(page);
  expect(d.cameraMode).toBe('fit');
  expect(Number(d.cameraZoom)).toBe(1);
  expect(Number(d.trackScale)).toBeGreaterThan(0);
  await expect(page.locator('#cam-fit')).toBeDisabled();
  await expect(page.locator('#cam-status')).toHaveText('Whole track in view.');
});

test('Zoom +, Zoom − and Fit change the published camera and the drawn scale, and Fit returns to the fitted scale', async ({ page }) => {
  await openDrive(page);
  const fitted = await num(page, 'trackScale');
  await page.locator('#cam-in').click();
  await expect.poll(() => num(page, 'cameraZoom')).toBeGreaterThan(1);
  const zoomed = await num(page, 'trackScale');
  expect(zoomed).toBeGreaterThan(fitted);
  await expect(page.locator('#cam-status')).toContainText('Zoom 1.5×');
  await page.locator('#cam-in').click();
  await expect.poll(() => num(page, 'trackScale')).toBeGreaterThan(zoomed);
  await page.locator('#cam-out').click();
  await page.locator('#cam-out').click();
  await expect.poll(() => num(page, 'cameraZoom')).toBe(1);
  await page.locator('#cam-in').click();
  await expect(page.locator('#cam-fit')).toBeEnabled();
  await page.locator('#cam-fit').click();
  await expect.poll(() => num(page, 'trackScale')).toBe(fitted);
  expect((await data(page)).cameraMode).toBe('fit');
});

test('Follow keeps the car near the middle of the view as it drives', async ({ page }) => {
  await openDrive(page);
  await page.locator('#cam-follow').click();
  await expect(page.locator('#cam-follow')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#cam-status')).toContainText('following your car');
  const where = async () => {
    const d = await data(page);
    const box = (await canvas(page).boundingBox())!;
    const x = Number(d.carX) * Number(d.trackScale) + Number(d.trackOffsetX);
    const y = Number(d.carY) * Number(d.trackScale) + Number(d.trackOffsetY);
    return { x, y, w: box.width, h: box.height };
  };
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(2500);
  await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(1500);
  const p = await where();
  expect(Math.abs(p.x - p.w / 2)).toBeLessThan(p.w * 0.2);
  expect(Math.abs(p.y - p.h / 2)).toBeLessThan(p.h * 0.2);
  expect((await num(page, 'carSpeed')) >= 0).toBe(true);
});

test('a drag pans in zoom mode and pauses following; Follow resumes it; the wheel zooms about the cursor (desktop)', async ({ page }, testInfo) => {
  await openDrive(page);
  await page.locator('#cam-in').click();
  await page.locator('#cam-in').click();
  const box = (await canvas(page).boundingBox())!;
  const before = { x: await num(page, 'cameraCentreX'), y: await num(page, 'cameraCentreY') };
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40, { steps: 6 });
  await page.mouse.up();
  const after = { x: await num(page, 'cameraCentreX'), y: await num(page, 'cameraCentreY') };
  expect(after.x).not.toBeCloseTo(before.x, 3);
  await page.locator('#cam-follow').click();
  expect((await data(page)).cameraMode).toBe('follow');
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 120, { steps: 4 });
  await page.mouse.up();
  expect((await data(page)).cameraMode).toBe('zoom');
  await expect(page.locator('#cam-follow')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#cam-follow').click();
  expect((await data(page)).cameraMode).toBe('follow');
  if (!testInfo.project.use.hasTouch) {
    await page.locator('#cam-fit').click();
    const z0 = await num(page, 'cameraZoom');
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.4);
    await page.mouse.wheel(0, -300);
    await expect.poll(() => num(page, 'cameraZoom')).toBeGreaterThan(z0);
  }
});

test('a two-finger pinch on the canvas zooms the canvas and does not zoom or scroll the page (touch projects)', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.use.hasTouch || testInfo.project.name.includes('webkit'), 'needs Chromium touch emulation');
  await openDrive(page);
  const cdp = await page.context().newCDPSession(page);
  const box = (await canvas(page).boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const scrollBefore = await page.evaluate(() => ({ y: window.scrollY, x: window.scrollX, scale: window.visualViewport?.scale ?? 1 }));
  const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd', points: { x: number; y: number; id: number }[]) => {
    await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id })) });
  };
  const z0 = await num(page, 'cameraZoom');
  await touch('touchStart', [{ x: cx - 30, y: cy, id: 1 }, { x: cx + 30, y: cy, id: 2 }]);
  for (let step = 1; step <= 8; step += 1) await touch('touchMove', [{ x: cx - 30 - step * 8, y: cy, id: 1 }, { x: cx + 30 + step * 8, y: cy, id: 2 }]);
  await touch('touchEnd', []);
  await expect.poll(() => num(page, 'cameraZoom')).toBeGreaterThan(z0);
  const scrollAfter = await page.evaluate(() => ({ y: window.scrollY, x: window.scrollX, scale: window.visualViewport?.scale ?? 1 }));
  expect(scrollAfter).toEqual(scrollBefore);
});

test('keys on the focused canvas: + - 0 F; driving by keyboard is unaffected; they do not act from elsewhere', async ({ page }) => {
  await openDrive(page);
  await canvas(page).focus();
  await page.keyboard.press('+');
  await expect.poll(() => num(page, 'cameraZoom')).toBeGreaterThan(1);
  await page.keyboard.press('-');
  await expect.poll(() => num(page, 'cameraZoom')).toBe(1);
  await page.keyboard.press('+');
  await page.keyboard.press('0');
  await expect.poll(() => num(page, 'cameraZoom')).toBe(1);
  await page.keyboard.press('f');
  await expect.poll(async () => (await data(page)).cameraMode).toBe('follow');
  await page.keyboard.press('F');
  await expect.poll(async () => (await data(page)).cameraMode).toBe('zoom');
  // driving keys still work with the canvas focused
  const x0 = await num(page, 'carX');
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(800);
  await page.keyboard.up('ArrowUp');
  expect(await num(page, 'carX')).toBeGreaterThan(x0);
  // a key pressed while another control has focus does not move the camera
  await page.locator('#cam-fit').focus();
  const zoom = await num(page, 'cameraZoom');
  await page.keyboard.press('+');
  expect(await num(page, 'cameraZoom')).toBe(zoom);
});

test('the training page: zoom and follow work, training carries on, and the camera state is published', async ({ page }) => {
  await page.goto('/?mode=train');
  await expect(page.locator('#camera-controls')).toBeVisible();
  await expect.poll(() => num(page, 'generationTick')).toBeGreaterThan(0);
  await page.locator('#cam-in').click();
  await expect.poll(() => num(page, 'cameraZoom')).toBeGreaterThan(1);
  await page.locator('#cam-follow').click();
  await expect(page.locator('#cam-status')).toContainText('following the best car');
  const tick = await num(page, 'generationTick');
  await expect.poll(() => num(page, 'generationTick')).not.toBe(tick);
  await page.locator('#cam-fit').click();
  expect((await data(page)).cameraMode).toBe('fit');
});

test('controls are at least 44 px and nothing scrolls sideways at 320 px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openDrive(page);
  for (const id of ['#cam-fit', '#cam-out', '#cam-in', '#cam-follow']) {
    const box = (await page.locator(id).boundingBox())!;
    expect(box.height, id).toBeGreaterThanOrEqual(43.5);
    expect(box.width, id).toBeGreaterThanOrEqual(43.5);
  }
  const scroll = await page.evaluate(() => ({ x: document.documentElement.scrollWidth, w: document.documentElement.clientWidth }));
  expect(scroll.x).toBeLessThanOrEqual(scroll.w);
});

test('the editor and the evaluate page show no camera controls', async ({ page }) => {
  await page.goto('/?mode=edit');
  await expect(page.locator('#editor-panel')).toBeVisible();
  await expect(page.locator('#camera-controls')).toBeHidden();
  await page.goto('/?mode=evaluate');
  await expect(page.locator('#evaluate-panel')).toBeVisible();
  await expect(page.locator('#camera-controls')).toBeHidden();
});

test('Space and Enter activate a focused camera button on the driving page, instead of braking', async ({ page }) => {
  await openDrive(page);
  await page.locator('#cam-in').focus();
  const z0 = await num(page, 'cameraZoom');
  await page.keyboard.press('Space');
  await expect.poll(() => num(page, 'cameraZoom')).toBeGreaterThan(z0);
  const z1 = await num(page, 'cameraZoom');
  await page.keyboard.press('Enter');
  await expect.poll(() => num(page, 'cameraZoom')).toBeGreaterThan(z1);
  await page.locator('#cam-follow').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#cam-follow')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#cam-fit').focus();
  await page.keyboard.press('Space');
  await expect.poll(async () => (await data(page)).cameraMode).toBe('fit');
  // the brake was never held: pressing Space on a button leaves the car free to be driven away at once
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(700);
  await page.keyboard.up('ArrowUp');
  expect(await num(page, 'carSpeed')).toBeGreaterThan(0);
});

test('a followed car stays inside the canvas through a resize or rotation, even before the smoothing has settled (portrait and landscape)', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 500 });
  await openDrive(page);
  // Follow starts with the view far from the car: the smoothing has not settled when the canvas is resized straight away.
  await page.locator('#cam-in').click();
  await page.locator('#cam-in').click();
  await page.locator('#cam-follow').click();
  for (const size of [{ width: 390, height: 700 }, { width: 700, height: 390 }, { width: 320, height: 568 }, { width: 568, height: 320 }, { width: 900, height: 500 }]) {
    await page.setViewportSize(size);
    await expect.poll(async () => {
      const d = await data(page);
      const box = (await canvas(page).boundingBox())!;
      const x = Number(d.carX) * Number(d.trackScale) + Number(d.trackOffsetX);
      const y = Number(d.carY) * Number(d.trackScale) + Number(d.trackOffsetY);
      return x >= 0 && x <= box.width && y >= 0 && y <= box.height;
    }, `${size.width}x${size.height}`).toBe(true);
  }
});

test('with the comparison replay running and Follow A/B offered, all five camera controls stay inside a narrow viewport with full 44 px targets (portrait and landscape)', async ({ page }) => {
  test.setTimeout(120_000);
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const fixture = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/champion-v1.json', import.meta.url)), 'utf8')) as { id: string; name?: string };
  await page.addInitScript(
    ({ doc }) => {
      if (window.localStorage.getItem('sdae:test-seeded') === null) {
        const ids: string[] = [];
        for (const [id, name] of [['cmp-a', 'Champion A'], ['cmp-b', 'Champion B']] as const) {
          window.localStorage.setItem(`sdae:model:${id}`, JSON.stringify({ ...doc, id, name }));
          ids.push(id);
        }
        window.localStorage.setItem('sdae:models:index', JSON.stringify(ids));
        window.localStorage.setItem('sdae:test-seeded', '1');
      }
    },
    { doc: fixture },
  );
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/?mode=train');
  await expect(page.locator('#camera-controls')).toBeVisible();
  await page.locator('#champion-replay > summary').click();
  await page.locator('#compare-a').selectOption('cmp-a');
  await page.locator('#compare-b').selectOption('cmp-b');
  await page.locator('#compare-run').click();
  await expect(page.locator('#compare-replay')).toBeEnabled({ timeout: 30_000 });
  await page.locator('#compare-replay').click();
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-pair-replay', 'running', { timeout: 30_000 });
  await page.locator('#cam-follow').click();
  await expect(page.locator('#cam-follow-ab')).toBeVisible();
  const ids = ['#cam-fit', '#cam-out', '#cam-in', '#cam-follow', '#cam-follow-ab'];
  const check = async (label: string) => {
    const viewport = page.viewportSize()!;
    for (const id of ids) {
      const box = (await page.locator(id).boundingBox())!;
      expect(box.x, `${label} ${id} x`).toBeGreaterThanOrEqual(-0.5);
      expect(box.x + box.width, `${label} ${id} right`).toBeLessThanOrEqual(viewport.width + 0.5);
      expect(box.height, `${label} ${id} height`).toBeGreaterThanOrEqual(43.5);
      expect(box.width, `${label} ${id} width`).toBeGreaterThanOrEqual(43.5);
    }
    // each control is the element hit at its own centre (not covered by another control or clipped off screen)
    for (const id of ids) {
      const hit = await page.locator(id).evaluate((node) => {
        const r = node.getBoundingClientRect();
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return top === node || node.contains(top);
      });
      expect(hit, `${label} ${id} hit target`).toBe(true);
    }
  };
  await check('320x568');
  const before = await page.locator('#cam-follow-ab').textContent();
  await page.locator('#cam-follow-ab').click();
  expect(await page.locator('#cam-follow-ab').textContent()).not.toBe(before);
  await check('after switching A/B');
  await page.setViewportSize({ width: 568, height: 320 });
  await check('568x320');
  await page.setViewportSize({ width: 360, height: 640 });
  await check('360x640');
});
