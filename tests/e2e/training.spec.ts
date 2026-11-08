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

/**
 * Installs Playwright's fake clock and pauses it before the page loads. `install` alone leaves the clock running, so
 * animation frames, and with them training, would keep advancing between the test's commands. Once paused, the page's
 * time moves only through `page.clock.runFor`.
 */
async function installPausedClock(page: Page) {
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(0);
}

/**
 * Moves the page's clock on in steps of `stepMs` until `done` holds. The page runs on Playwright's fake clock, which the
 * test pauses before loading the page (`installPausedClock`), so time moves only here: this advances simulated time, not
 * wall-clock time, and has no deadline that depends on how fast the runner is. It fails after `maxSteps` steps instead
 * of waiting forever.
 */
async function advanceUntil(page: Page, done: (value: Awaited<ReturnType<typeof snapshot>>) => boolean, stepMs = 1000, maxSteps = 60) {
  for (let step = 0; step < maxSteps; step += 1) {
    await page.clock.runFor(stepMs);
    const value = await snapshot(page);
    if (done(value)) return value;
  }
  throw new Error(`The condition was not reached after ${maxSteps * stepMs} ms of page time.`);
}

test('the training dashboard shows live counts that sum to the population and updates as generations finish', async ({ page }) => {
  // The page runs on a fake clock that is paused before the page loads and moves only when the test moves it, so every
  // state below is reached deterministically: the first rendered frame, the placeholders before any generation ends,
  // and each generation end.
  await installPausedClock(page);
  await page.goto('/?mode=train');
  await expect(page.locator('#training-dashboard')).toBeVisible();
  await expect(page.locator('.app-header > .hud')).toBeHidden();
  // Visibility is not readiness: the values stay "—" until a frame has rendered, which sets data-mode.
  // Advance a few frames and wait for it.
  await page.clock.runFor(100);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-mode', 'train');
  // Proof that the clock is paused: an ordinary real-time wait does not advance training.
  const tickBefore = await data(page, 'tick');
  await page.waitForTimeout(400);
  expect(await data(page, 'tick')).toBe(tickBefore);

  // None of the new outputs is a live region: the status line stays the one polite announcement channel.
  const live = await page.evaluate(() => ({
    outputs: [...document.querySelectorAll('#training-dashboard output')].map((o) => o.getAttribute('aria-live')),
    panel: document.getElementById('training-dashboard')!.getAttribute('aria-live'),
    status: document.getElementById('hud-message')!.getAttribute('aria-live'),
  }));
  expect(live.outputs).toEqual(Array(11).fill('off'));
  expect(live.panel).toBeNull();
  expect(live.status).toBe('polite');

  // About 6 ticks in: no generation has ended, so the last-completed group shows placeholders and the note.
  const first = await snapshot(page);
  expect(first.data.completedGenerations).toBe('0');
  expect(first.running + first.crashed + first.stalled + first.finished).toBe(50);
  expect(first.generation).toBe('1');
  expect([first.lastGeneration, first.best, first.mean, first.crashRate, first.stalls, first.lapRate]).toEqual(Array(6).fill('—'));
  expect(first.note).toBe('No generation completed yet');

  // Running cars fall as cars crash, and every snapshot stays a partition of the population.
  const crashing = await advanceUntil(page, (v) => v.running < 50);
  expect(crashing.running).toBeLessThan(50);
  for (let i = 0; i < 5; i += 1) {
    await page.clock.runFor(200);
    const now = await snapshot(page);
    expect(now.running + now.crashed + now.stalled + now.finished).toBe(50);
  }

  // After the first generation ends, the last-completed group equals the recorded values the page exposes.
  const done = await advanceUntil(page, (v) => v.data.lastGeneration === '1');
  expect(done.lastGeneration).toBe('1');
  expect(done.best).toBe(Number(done.data.lastBest).toFixed(2));
  expect(done.mean).toBe(Number(done.data.lastMean).toFixed(2));
  expect(done.crashRate).toBe(`${((Number(done.data.lastCrashed) / 50) * 100).toFixed(1)}% (${done.data.lastCrashed}/50)`);
  expect(done.stalls).toBe(`${((Number(done.data.lastStalled) / 50) * 100).toFixed(1)}% (${done.data.lastStalled}/50)`);
  expect(done.lapRate).toBe(`${((Number(done.data.lastLaps) / 50) * 100).toFixed(1)}% (${done.data.lastLaps}/50)`);
  expect(done.note).toBe('');

  // It moves on to the next completed generation.
  const later = await advanceUntil(page, (v) => v.data.lastGeneration === '2');
  expect(later.lastGeneration).toBe('2');
  expect(Number(later.data.lastBest)).not.toBeNaN();
});

test('the dashboard stays inside the screen without scrolling the page, in portrait and landscape', async ({ page }, testInfo) => {
  test.skip(!/phone|tablet/.test(testInfo.project.name), 'a small-screen check');
  await page.goto('/?mode=train');
  await expect(page.locator('#training-dashboard')).toBeVisible();
  // Wait for the first rendered frame, so the measured layout holds real values, not the initial placeholders.
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-mode', 'train');
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
