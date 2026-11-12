// The track editor in a real browser (P4-02): build a track with pointer events (or the keyboard alone), see it validated,
// drive it, and come back to the editor with its state intact. The page publishes the editor's state on the canvas's
// data attributes; these tests read it there and map world metres to the screen through the published transform.
import { expect, test, type Page } from '@playwright/test';

let errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/?mode=edit');
  await expect(page.locator('#editor-panel')).toBeVisible();
});
test.afterEach(() => {
  expect(errors).toEqual([]);
});

const RING = [[-60, -30], [0, -40], [60, -30], [70, 0], [60, 30], [0, 40], [-60, 30], [-70, 0]] as const;

async function screenOf(page: Page, wx: number, wy: number): Promise<{ x: number; y: number }> {
  const canvas = page.locator('#sim-canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  const d = await canvas.evaluate((node) => ({ ...(node as HTMLCanvasElement).dataset }));
  return { x: box.x + Number(d.editorOffsetX) + wx * Number(d.editorScale), y: box.y + Number(d.editorOffsetY) + wy * Number(d.editorScale) };
}
async function tap(page: Page, wx: number, wy: number): Promise<void> {
  const p = await screenOf(page, wx, wy);
  await page.mouse.click(p.x, p.y);
}
const data = (page: Page, key: string) => page.locator('#sim-canvas').evaluate((node, k) => (node as HTMLCanvasElement).dataset[k], key);

async function buildWithPointer(page: Page): Promise<void> {
  for (const [x, y] of RING) await tap(page, x, y);
  await tap(page, RING[0][0], RING[0][1]); // the first point again closes the loop
}

test('builds a loop with pointer events, sees Valid, drives it and comes back to the editor', async ({ page }) => {
  await expect(page.locator('#ed-status')).toContainText('Tap the canvas');
  await expect(page.locator('#ed-drive')).toBeDisabled();
  await buildWithPointer(page);
  await expect(page.locator('#ed-status')).toContainText('Valid: ready to drive');
  expect(await data(page, 'editorPoints')).toBe('8');
  await expect(page.locator('#ed-drive')).toBeEnabled();
  await page.locator('#ed-drive').click();
  await expect(page.locator('#drive-notice')).toBeVisible();
  await expect(page.locator('#editor-panel')).toBeHidden();
  await expect(page.locator('#hud-laps')).toBeVisible();
  const before = Number(await data(page, 'carX'));
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(1500);
  await page.keyboard.up('ArrowUp');
  expect(Math.abs(Number(await data(page, 'carX')) - before) + Math.abs(Number(await data(page, 'carY')))).toBeGreaterThan(1);
  await page.locator('#ed-back').click();
  await expect(page.locator('#editor-panel')).toBeVisible();
  await expect(page.locator('#drive-notice')).toBeHidden();
  expect(await data(page, 'editorPoints')).toBe('8');
  await expect(page.locator('#ed-status')).toContainText('Valid');
});

test('undo, redo, move, delete and width work, and a too-tight corner gives a readable message', async ({ page }) => {
  await buildWithPointer(page);
  await page.locator('[data-editor-mode="delete"]').click();
  await tap(page, 0, -40);
  expect(await data(page, 'editorPoints')).toBe('7');
  await page.locator('#ed-undo').click();
  expect(await data(page, 'editorPoints')).toBe('8');
  await page.locator('#ed-redo').click();
  expect(await data(page, 'editorPoints')).toBe('7');
  await page.keyboard.press('Control+z');
  expect(await data(page, 'editorPoints')).toBe('8');

  await page.locator('[data-editor-mode="move"]').click();
  const from = await screenOf(page, 60, 30);
  const to = await screenOf(page, 80, 50);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2);
  await page.mouse.move(to.x, to.y);
  await page.mouse.up();
  await expect(page.locator('#ed-message')).toContainText('moved to (80, 50)');

  for (let i = 0; i < 18; i += 1) await page.locator('#ed-width-plus').click();
  await expect(page.locator('#ed-width-plus')).toBeDisabled();
  await expect(page.locator('#ed-status')).toHaveAttribute('data-kind', 'invalid');
  await expect(page.locator('#ed-drive')).toBeDisabled();
  expect((await page.locator('#ed-status').textContent())!.length).toBeGreaterThan(20);
  for (let i = 0; i < 18; i += 1) await page.locator('#ed-width-minus').click();
  await expect(page.locator('#ed-status')).toHaveAttribute('data-kind', 'valid');
});

test('a keyboard-only build: crosshair, close the loop, insert a point, nudge it, move the start', async ({ page }) => {
  await page.locator('#sim-canvas').focus();
  const at = { x: 0, y: 0 };
  const goto = async (x: number, y: number): Promise<void> => {
    for (; at.x < x; at.x += 5) await page.keyboard.press('Shift+ArrowRight');
    for (; at.x > x; at.x -= 5) await page.keyboard.press('Shift+ArrowLeft');
    for (; at.y < y; at.y += 5) await page.keyboard.press('Shift+ArrowDown');
    for (; at.y > y; at.y -= 5) await page.keyboard.press('Shift+ArrowUp');
  };
  for (const [x, y] of RING) {
    await goto(x, y);
    await page.keyboard.press('Enter');
  }
  expect(await data(page, 'editorPoints')).toBe('8');
  await expect(page.locator('#ed-close')).toBeEnabled();
  await page.keyboard.press('c');
  await expect(page.locator('#ed-status')).toContainText('Valid');

  await page.locator('#ed-points li').nth(1).focus();
  await page.keyboard.press('i');
  expect(await data(page, 'editorPoints')).toBe('9');
  await page.keyboard.press('Shift+ArrowUp');
  await expect(page.locator('#ed-message')).toContainText('Point 3 at');
  await page.keyboard.press('Delete');
  expect(await data(page, 'editorPoints')).toBe('8');

  const start = page.locator('#ed-start');
  await start.focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect(start).toHaveAttribute('aria-valuetext', /^Start position, 10 m along a \d+ m line$/);
  await page.keyboard.press('Home');
  await expect(start).toHaveAttribute('aria-valuenow', '0');
  await expect(page.locator('#ed-status')).toContainText('Valid');
});

test('every toolbar control is at least 44 px and visible without scrolling the page sideways', async ({ page }) => {
  const small = await page.locator('#editor-panel button, #editor-panel [role="slider"]').evaluateAll((nodes) =>
    nodes.map((n) => ({ id: n.id || n.textContent, box: n.getBoundingClientRect() })).filter((x) => x.box.width > 0 && (x.box.width < 43.5 || x.box.height < 43.5)).map((x) => x.id),
  );
  expect(small).toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('the default page and the training page are unchanged', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#editor-panel')).toBeHidden();
  await expect(page.locator('.controls')).toBeVisible();
});
