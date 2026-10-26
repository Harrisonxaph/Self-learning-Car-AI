// The rendered training view (P2-05) on the real page: `?mode=train` runs the population trainer under the
// frame loop, draws the cars and advances generations; the default page stays manual driving. Emulated browsers
// only: real iPhone/iPad Safari behaviour of the training view is an outstanding manual device check.
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

const data = (page: Page, name: string) => page.locator('#sim-canvas').getAttribute(`data-${name}`);

test('?mode=train draws a population of 50 cars and moves on to the next generation', async ({ page }) => {
  await page.goto('/?mode=train');
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-mode', 'train');
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-cars', '50');
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-track-scale', /\d/);
  // Manual-driving controls and the lap display are hidden; the status line names the generation.
  await expect(page.locator('.controls')).toBeHidden();
  await expect(page.locator('.hud')).toBeHidden();
  await expect(page.locator('#hud-message')).toHaveText(/^Training · generation 1 · \d+ of 50 cars running$/);
  // Generation 0 with the default seed lasts 348 ticks (about 6 s of real time at 60 ticks per second).
  await expect.poll(async () => Number(await data(page, 'completed-generations')), { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  expect(Number(await data(page, 'generation'))).toBeGreaterThanOrEqual(1);
  await expect(page.locator('#hud-message')).toHaveText(/^Training · generation [2-9]\d* · \d+ of 50 cars running$/);
});

test('the default page is still manual driving', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.controls')).toBeVisible();
  await expect(page.locator('.hud')).toBeVisible();
  expect(await data(page, 'mode')).toBeNull();
  expect(await data(page, 'cars')).toBeNull();
});
