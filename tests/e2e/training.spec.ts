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
  await expect(page.locator('.app-header > .hud')).toBeHidden();
  await expect(page.locator('#hud-message')).toHaveText(/^Training · generation 1 · \d+ of 50 cars running$/);
  // Generation 0 with the default seed lasts 348 ticks (about 6 s of real time at 60 ticks per second).
  await expect.poll(async () => Number(await data(page, 'completed-generations')), { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  expect(Number(await data(page, 'generation'))).toBeGreaterThanOrEqual(1);
  await expect(page.locator('#hud-message')).toHaveText(/^Training · generation [2-9]\d* · \d+ of 50 cars running$/);
});

/** One synchronous read of every dashboard value, so all of it comes from the same rendered frame. */
const snapshot = (page: Page) =>
  page.evaluate(() => {
    const text = (id: string) => document.getElementById(id)!.textContent;
    const canvas = document.getElementById('sim-canvas')!;
    return {
      generation: text('dash-generation'),
      running: Number(text('dash-running')),
      crashed: Number(text('dash-crashed')),
      stalled: Number(text('dash-stalled')),
      finished: Number(text('dash-finished')),
      lastGeneration: text('dash-last-generation'),
      best: text('dash-best'),
      mean: text('dash-mean'),
      crashRate: text('dash-crash-rate'),
      stalls: text('dash-stalls'),
      lapRate: text('dash-lap-rate'),
      note: text('dash-note'),
      data: { ...canvas.dataset },
    };
  });

test('the training dashboard shows live counts that sum to the population and updates as generations finish', async ({ page }) => {
  await page.goto('/?mode=train');
  await expect(page.locator('#training-dashboard')).toBeVisible();
  await expect(page.locator('.app-header > .hud')).toBeHidden();

  // Before the first generation ends: placeholders and the note, and live counts that already sum to 50.
  const first = await snapshot(page);
  expect(first.running + first.crashed + first.stalled + first.finished).toBe(50);
  expect(first.generation).toBe('1');
  if (first.data.completedGenerations === '0') {
    expect([first.lastGeneration, first.best, first.mean, first.crashRate, first.stalls, first.lapRate]).toEqual(Array(6).fill('—'));
    expect(first.note).toBe('No generation completed yet');
  }

  // Running cars fall as cars crash, and every snapshot stays a partition of the population.
  await expect.poll(async () => (await snapshot(page)).running, { timeout: 30_000 }).toBeLessThan(50);
  for (let i = 0; i < 5; i += 1) {
    const now = await snapshot(page);
    expect(now.running + now.crashed + now.stalled + now.finished).toBe(50);
  }

  // After the first generation ends, the last-completed group equals the recorded values the page exposes.
  await expect.poll(async () => (await snapshot(page)).data.lastGeneration, { timeout: 30_000 }).toBe('1');
  const done = await snapshot(page);
  expect(done.lastGeneration).toBe('1');
  expect(done.best).toBe(Number(done.data.lastBest).toFixed(2));
  expect(done.mean).toBe(Number(done.data.lastMean).toFixed(2));
  expect(done.crashRate).toBe(`${((Number(done.data.lastCrashed) / 50) * 100).toFixed(1)}% (${done.data.lastCrashed}/50)`);
  expect(done.stalls).toBe(`${((Number(done.data.lastStalled) / 50) * 100).toFixed(1)}% (${done.data.lastStalled}/50)`);
  expect(done.lapRate).toBe(`${((Number(done.data.lastLaps) / 50) * 100).toFixed(1)}% (${done.data.lastLaps}/50)`);
  expect(done.note).toBe('');

  // It moves on to the next completed generation.
  await expect.poll(async () => (await snapshot(page)).data.lastGeneration, { timeout: 30_000 }).toBe('2');
  const later = await snapshot(page);
  expect(later.lastGeneration).toBe('2');
  expect(Number(later.data.lastBest)).not.toBeNaN();
});

test('the dashboard stays inside the screen without scrolling the page, in portrait and landscape', async ({ page }, testInfo) => {
  test.skip(!/phone|tablet/.test(testInfo.project.name), 'a small-screen check');
  await page.goto('/?mode=train');
  await expect(page.locator('#training-dashboard')).toBeVisible();
  const original = page.viewportSize()!;
  for (const size of [original, { width: original.height, height: original.width }]) {
    await page.setViewportSize(size);
    const fit = await page.evaluate(() => {
      const box = document.getElementById('training-dashboard')!.getBoundingClientRect();
      const canvas = document.getElementById('sim-canvas')!.getBoundingClientRect();
      const root = document.documentElement;
      return {
        insideWidth: box.left >= 0 && box.right <= window.innerWidth,
        insideHeight: box.top >= 0 && box.bottom <= window.innerHeight,
        noScrollX: root.scrollWidth <= root.clientWidth,
        noScrollY: root.scrollHeight <= root.clientHeight,
        canvasShare: canvas.height / window.innerHeight,
      };
    });
    expect(fit, `${size.width}x${size.height}`).toMatchObject({ insideWidth: true, insideHeight: true, noScrollX: true, noScrollY: true });
    // The track keeps a useful share of the screen (the cars stay visible).
    expect(fit.canvasShare, `${size.width}x${size.height}`).toBeGreaterThan(0.3);
  }
});

test('the default page is still manual driving', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.controls')).toBeVisible();
  await expect(page.locator('.app-header > .hud')).toBeVisible();
  expect(await data(page, 'mode')).toBeNull();
  expect(await data(page, 'cars')).toBeNull();
});
