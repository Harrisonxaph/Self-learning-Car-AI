// The camera draw-time readout (P4-07, `?debug=drawtime`) in a real browser: absent by default, present with the flag on both the driving page and the
// training page, counting frames toward the plan's 600, showing the camera state, never blocking a tap, and not moving the page's own controls. Emulated browsers
// only: the figures here are NOT the plan's measurement (that needs the owner's reference phone).
import { expect, test, type Page } from '@playwright/test';

let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
});
test.afterEach(() => {
  expect(errors).toEqual([]);
});

const readout = (page: Page) => page.locator('#drawtime-readout');
const canvas = (page: Page) => page.locator('#sim-canvas');

test('the readout is absent by default on the driving and training pages', async ({ page }) => {
  for (const url of ['/', '/?mode=train']) {
    await page.goto(url);
    await expect(page.locator('.stage')).toBeVisible();
    await expect(readout(page)).toBeHidden();
    await expect(canvas(page)).not.toHaveAttribute('data-draw-frames', /.*/);
  }
});

for (const [name, url] of [['driving', '/?debug=drawtime'], ['training', '/?mode=train&debug=drawtime']] as const) {
  test(`the ${name} page shows the readout with the flag, counting frames and showing finite figures and the camera state`, async ({ page }) => {
    await page.goto(url);
    await expect(readout(page)).toBeVisible();
    await expect(readout(page)).toContainText('Camera draw time');
    await expect(readout(page)).toContainText('Plan budget');
    await expect.poll(async () => Number(await canvas(page).getAttribute('data-draw-frames')), { timeout: 15_000 }).toBeGreaterThan(30);
    const p50 = Number(await canvas(page).getAttribute('data-draw-p50-ms'));
    const p95 = Number(await canvas(page).getAttribute('data-draw-p95-ms'));
    expect(Number.isFinite(p50) && p50 >= 0).toBe(true);
    expect(Number.isFinite(p95) && p95 >= p50).toBe(true);
    await expect(readout(page)).toContainText('zoom 1.00x free');
    // Zooming changes the camera state the readout reports with its figures.
    await page.locator('#cam-in').click();
    await expect(readout(page)).toContainText(/zoom 1\.50x/);
    // It names where it was taken, so a figure can be quoted with its context.
    await expect(readout(page)).toContainText(/canvas \d+x\d+ css px at \d+(\.\d+)?x/);
  });
}

test('the readout is out of the layout and never in the way of a tap', async ({ page }) => {
  await page.goto('/');
  const before = await page.locator('button[data-action="accelerate"]').boundingBox();
  const stageBefore = await page.locator('.stage').boundingBox();
  await page.goto('/?debug=drawtime');
  await expect(readout(page)).toBeVisible();
  const after = await page.locator('button[data-action="accelerate"]').boundingBox();
  const stageAfter = await page.locator('.stage').boundingBox();
  expect(after).toEqual(before);
  expect(stageAfter).toEqual(stageBefore);
  await expect(readout(page)).toHaveCSS('pointer-events', 'none');
  await expect(readout(page)).toHaveCSS('position', 'absolute');
  // No sideways scroll with the readout showing, at the narrowest phone width.
  await page.setViewportSize({ width: 320, height: 568 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
