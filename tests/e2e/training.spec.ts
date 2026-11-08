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
 * time moves only through `page.clock.runFor`. The pause instant is 10 seconds in, not 0: the installed clock runs in
 * real time until it is paused, so a pause at 0 throws "Cannot fast-forward to the past" whenever the host takes any
 * time to get there (seen on WebKit). Nothing has loaded yet, so moving the clock forward costs nothing.
 */
async function installPausedClock(page: Page) {
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(10_000);
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

test('the training graph draws a point for each completed generation and keeps a text summary', async ({ page }) => {
  await installPausedClock(page);
  await page.goto('/?mode=train');
  await page.clock.runFor(100);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-mode', 'train');
  // Shown in training mode, collapsed by default, with nothing to plot yet.
  await expect(page.locator('#training-graph')).toBeVisible();
  expect(await page.locator('#training-graph').evaluate((d: HTMLDetailsElement) => d.open)).toBe(false);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-chart-points', '0');
  await expect(page.locator('#graph-summary')).toHaveText('No generation completed yet, so there is nothing to plot.');
  // The canvas names its text summary for assistive technology.
  await expect(page.locator('#graph-canvas')).toHaveAttribute('aria-describedby', 'graph-summary');

  await page.locator('#training-graph > summary').click();
  expect(await page.locator('#training-graph').evaluate((d: HTMLDetailsElement) => d.open)).toBe(true);

  const inked = () =>
    page.evaluate(() => {
      const canvas = document.getElementById('graph-canvas') as HTMLCanvasElement;
      const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
      let count = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) count += 1;
      return count;
    });

  // One point after the first generation ends: a summary and a drawing appear.
  const first = await advanceUntil(page, (v) => v.data.chartPoints === '1');
  await page.clock.runFor(400);
  expect(first.data.lastGeneration).toBe('1');
  await expect(page.locator('#graph-summary')).toHaveText(/^1 completed generation is plotted\. Latest, generation 1: best fitness /);
  expect(Number(await data(page, 'chart-draws'))).toBeGreaterThanOrEqual(1);
  const afterOne = await inked();
  expect(afterOne).toBeGreaterThan(50);

  // And a second point after the second.
  const second = await advanceUntil(page, (v) => v.data.chartPoints === '2');
  await page.clock.runFor(400);
  const text = (await page.locator('#graph-summary').textContent())!;
  expect(text).toMatch(/^2 completed generations are plotted\. Latest, generation 2:/);
  expect(text).toContain(`best fitness ${Number(second.data.lastBest).toFixed(2)}`);
  expect(text).toContain(`mean fitness ${Number(second.data.lastMean).toFixed(2)}`);
  expect(await inked()).toBeGreaterThan(50);
  // The page never shows a learning claim in the summary.
  expect(text).not.toMatch(/learn|improv|better|smarter/i);
});

test('the speed controls are real buttons of at least 44 px, and pause, resume and change the speed of the run', async ({ page }) => {
  await installPausedClock(page);
  await page.goto('/?mode=train');
  await page.clock.runFor(200);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-mode', 'train');
  await expect(page.locator('#training-controls')).toBeVisible();

  // Every control is at least 44 x 44 CSS pixels and on screen.
  const boxes = await page.locator('#training-controls button, #training-controls select').evaluateAll((els) =>
    els.map((el) => {
      const b = el.getBoundingClientRect();
      return { name: el.id || (el as HTMLElement).dataset.speed, w: b.width, h: b.height, inside: b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight };
    }),
  );
  expect(boxes).toHaveLength(5);
  for (const box of boxes) {
    expect(box.w, box.name).toBeGreaterThanOrEqual(44);
    expect(box.h, box.name).toBeGreaterThanOrEqual(44);
    expect(box.inside, box.name).toBe(true);
  }

  const tick = async () => Number(await data(page, 'tick'));
  const ticksIn = async (ms: number) => {
    const before = await tick();
    await page.clock.runFor(ms);
    return (await tick()) - before;
  };
  // At 1× about 60 ticks pass in a second of page time.
  const normal = await ticksIn(1000);
  expect(normal).toBeGreaterThanOrEqual(55);
  expect(normal).toBeLessThanOrEqual(65);

  // Pause: nothing advances, the button says Resume and the status line says so; a real-time wait changes nothing either.
  await page.locator('#speed-pause').click();
  await expect(page.locator('#speed-pause')).toHaveText('Resume');
  // The status line and page data follow on the next rendered frame, and the page's clock only moves when told to.
  await page.clock.runFor(100);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-paused', 'true');
  expect(await ticksIn(5000)).toBe(0);
  await expect(page.locator('#hud-message')).toHaveText(/ · paused$/);
  // Resume: it carries on at the same pace, with no burst of catch-up ticks.
  await page.locator('#speed-pause').click();
  await expect(page.locator('#speed-pause')).toHaveText('Pause');
  const resumed = await ticksIn(1000);
  expect(resumed).toBeGreaterThanOrEqual(55);
  expect(resumed).toBeLessThanOrEqual(65);

  // 4× is about four times as fast.
  await page.locator('[data-speed="fast"]').click();
  await expect(page.locator('[data-speed="fast"]')).toHaveAttribute('aria-pressed', 'true');
  await page.clock.runFor(100);
  await expect(page.locator('#hud-message')).toHaveText(/ · 4×$/);
  const fast = await ticksIn(1000);
  expect(fast).toBeGreaterThanOrEqual(4 * 55);
  expect(fast).toBeLessThanOrEqual(4 * 65);

  // Max runs far more ticks per frame (here the page's clock is frozen during a frame, so the cap per frame applies).
  await page.locator('[data-speed="max"]').click();
  await page.clock.runFor(100);
  await expect(page.locator('#hud-message')).toHaveText(/ · max$/);
  expect(await ticksIn(500)).toBeGreaterThan(10 * 30);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-speed', 'max');
});

test('the cars-drawn choice changes how many cars are drawn, defaulting lower on a phone, and never what is trained', async ({ page }, testInfo) => {
  await installPausedClock(page);
  await page.goto('/?mode=train');
  await page.clock.runFor(200);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-mode', 'train');
  const phone = /phone/.test(testInfo.project.name);
  // A phone starts with fewer cars drawn than a desktop; the population is 50 either way.
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-cars', '50');
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-drawn', phone ? '25' : '50');
  await expect(page.locator('#draw-cap')).toHaveValue(phone ? '25' : '50');

  await page.locator('#draw-cap').selectOption('10');
  await page.clock.runFor(100);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-drawn', '10');
  // At max speed no more than 10 are drawn.
  await page.locator('#draw-cap').selectOption('50');
  await page.locator('[data-speed="max"]').click();
  await page.clock.runFor(100);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-drawn', '10');
  await page.locator('[data-speed="normal"]').click();
  await page.clock.runFor(100);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-drawn', '50');
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

test('with the populated graph open, the track keeps its space, the page does not scroll and the graph stays reachable', async ({ page }, testInfo) => {
  test.skip(!/phone|tablet/.test(testInfo.project.name), 'a small-screen check');
  await installPausedClock(page);
  await page.goto('/?mode=train');
  await page.clock.runFor(100);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-mode', 'train');
  // Populated: one completed generation, so the dashboard, the charts and the wrapped text summary all exist.
  await advanceUntil(page, (v) => v.data.chartPoints === '1');
  await page.locator('#training-graph > summary').click();
  const original = page.viewportSize()!;
  const sizes = [original, { width: original.height, height: original.width }, { width: 568, height: 320 }, { width: 320, height: 568 }];
  for (const size of sizes) {
    await page.setViewportSize(size);
    await page.clock.runFor(400);
    const fit = await page.evaluate(() => {
      const rect = (id: string) => document.getElementById(id)!.getBoundingClientRect();
      const graph = document.getElementById('training-graph')!;
      const track = rect('sim-canvas');
      const box = graph.getBoundingClientRect();
      // Scroll the graph block to its end: the text summary must then be fully inside the block.
      graph.scrollTop = graph.scrollHeight;
      const summary = rect('graph-summary');
      const after = graph.getBoundingClientRect();
      const root = document.documentElement;
      return {
        viewport: window.innerHeight,
        trackHeight: track.height,
        graphInside: box.left >= 0 && box.right <= window.innerWidth && box.top >= 0 && box.bottom <= window.innerHeight,
        summaryReachable: summary.top >= after.top - 1 && summary.bottom <= after.bottom + 1,
        graphCanvasWide: rect('graph-canvas').width >= 150,
        noScrollX: root.scrollWidth <= root.clientWidth,
        noScrollY: root.scrollHeight <= root.clientHeight,
      };
    });
    const label = `${size.width}x${size.height}`;
    // The track is still there to watch the cars: a usable share of the screen, not a sliver.
    expect(fit.trackHeight, label).toBeGreaterThanOrEqual(Math.max(80, 0.2 * fit.viewport));
    expect(fit, label).toMatchObject({ graphInside: true, summaryReachable: true, graphCanvasWide: true, noScrollX: true, noScrollY: true });
  }
});

test('the first completed generation shows as a visible dot on the graph, not only axes and legend', async ({ page }) => {
  await installPausedClock(page);
  await page.goto('/?mode=train');
  await page.clock.runFor(100);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-mode', 'train');
  await page.locator('#training-graph > summary').click();
  await advanceUntil(page, (v) => v.data.chartPoints === '1');
  await page.clock.runFor(400);
  // Find the best-fitness colour (#7fe0bd) and group touching pixels. The legend sample is a thin line (a few pixels
  // tall) and the labels are another colour, so a blob that is as tall as it is wide is the data dot.
  const blobs = await page.evaluate(() => {
    const canvas = document.getElementById('graph-canvas') as HTMLCanvasElement;
    const { width, height } = canvas;
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, width, height);
    const near = (i: number) => data[i + 3]! > 200 && Math.abs(data[i]! - 0x7f) < 24 && Math.abs(data[i + 1]! - 0xe0) < 24 && Math.abs(data[i + 2]! - 0xbd) < 24;
    const seen = new Uint8Array(width * height);
    const found: { w: number; h: number; n: number }[] = [];
    for (let start = 0; start < width * height; start += 1) {
      if (seen[start] || !near(start * 4)) continue;
      const stack = [start];
      seen[start] = 1;
      let minX = width, maxX = 0, minY = height, maxY = 0, n = 0;
      while (stack.length > 0) {
        const at = stack.pop()!;
        const x = at % width, y = (at - x) / width;
        n += 1;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (!seen[next] && near(next * 4)) { seen[next] = 1; stack.push(next); }
        }
      }
      found.push({ w: maxX - minX + 1, h: maxY - minY + 1, n });
    }
    return { found, ratio: width / canvas.getBoundingClientRect().width };
  });
  const dots = blobs.found.filter((b) => b.h >= 4 * blobs.ratio && b.w >= 4 * blobs.ratio && b.w <= 14 * blobs.ratio && b.h <= 14 * blobs.ratio && b.n >= 12);
  expect(dots.length, JSON.stringify(blobs.found)).toBeGreaterThanOrEqual(1);
});

test('the default page is still manual driving', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.controls')).toBeVisible();
  await expect(page.locator('.app-header > .hud')).toBeVisible();
  expect(await data(page, 'mode')).toBeNull();
  expect(await data(page, 'cars')).toBeNull();
});
