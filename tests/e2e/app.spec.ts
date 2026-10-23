import { expect, test, type Page } from '@playwright/test';

/** What the page reports about the canvas, read from the real DOM. */
async function canvasState(page: Page) {
  return page.locator('#sim-canvas').evaluate((node) => {
    const canvas = node as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const centre = canvas
      .getContext('2d')
      ?.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 4), 1, 1).data;
    return {
      cssWidth: rect.width,
      cssHeight: rect.height,
      bufferWidth: canvas.width,
      bufferHeight: canvas.height,
      expectedWidth: Math.round(rect.width * ratio),
      expectedHeight: Math.round(rect.height * ratio),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      pageScrollWidth: document.documentElement.scrollWidth,
      pageScrollHeight: document.documentElement.scrollHeight,
      paintedAlpha: centre ? centre[3] : 0,
    };
  });
}

/** The drawing buffer matches the displayed size at the capped pixel ratio. */
async function expectSharpCanvas(page: Page) {
  await expect
    .poll(async () => {
      const s = await canvasState(page);
      return s.bufferWidth === s.expectedWidth && s.bufferHeight === s.expectedHeight;
    })
    .toBe(true);
}

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await page.waitForLoadState('load');
});

// Fail on any runtime error or console error during start-up or the test itself.
test.afterEach(() => {
  expect(errors).toEqual([]);
});

test('starts with a visible, painted canvas and readable heading', async ({ page }) => {
  await expect(page).toHaveTitle('Self-Driving AI Evolution');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Self-Driving AI Evolution');
  await expect(page.getByRole('img', { name: /racetrack/i })).toBeVisible();
  await expectSharpCanvas(page);

  const state = await canvasState(page);
  expect(state.cssWidth).toBeGreaterThan(0);
  expect(state.cssHeight).toBeGreaterThan(0);
  expect(state.paintedAlpha).toBe(255);
});

test('fits the screen without scrolling', async ({ page }) => {
  await expectSharpCanvas(page);
  const state = await canvasState(page);
  expect(state.pageScrollWidth).toBeLessThanOrEqual(state.viewportWidth);
  expect(state.pageScrollHeight).toBeLessThanOrEqual(state.viewportHeight);
  expect(state.cssWidth).toBeLessThanOrEqual(state.viewportWidth);
  // The canvas takes most of the screen, not a fixed small box.
  expect(state.cssWidth).toBeGreaterThan(state.viewportWidth * 0.9);
  expect(state.cssHeight).toBeGreaterThan(state.viewportHeight * 0.5);
});

test('resizes the drawing buffer when the window resizes or the device rotates', async ({ page }) => {
  const before = await canvasState(page);
  // Swap width and height: a phone or tablet turning between portrait and landscape,
  // or a desktop window changing shape.
  await page.setViewportSize({ width: before.viewportHeight, height: before.viewportWidth });
  await expect.poll(async () => (await canvasState(page)).viewportWidth).toBe(before.viewportHeight);
  await expectSharpCanvas(page);

  const after = await canvasState(page);
  expect(after.bufferWidth).not.toBe(before.bufferWidth);
  expect(after.paintedAlpha).toBe(255);
  expect(after.pageScrollWidth).toBeLessThanOrEqual(after.viewportWidth);
});

/** The number of simulation ticks the page has run, read from the time readout. */
async function simTick(page: Page): Promise<number> {
  return Number(await page.locator('#sim-time').getAttribute('data-tick'));
}

/**
 * Makes the page report itself hidden or visible and fires `visibilitychange`, as a browser does when
 * the user switches tab or app. Animation frames keep running, so only the app's own pause can stop
 * the simulation.
 */
async function setPageHidden(page: Page, hidden: boolean) {
  await page.evaluate((isHidden) => {
    const state = isHidden ? 'hidden' : 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => isHidden });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

/**
 * Shows the page again and counts the ticks run in the first two animation frames after that, all inside one
 * page.evaluate so no frames can slip in between (separate calls let a busy runner draw several frames during
 * the round trip, each adding a normal tick). Our frame callback is queued after the app's, so in each frame
 * the app has already run when we read the tick.
 */
async function ticksInTwoFramesAfterShowing(page: Page): Promise<{ before: number; after: number }> {
  return page.evaluate(
    () =>
      new Promise<{ before: number; after: number }>((resolve) => {
        const tick = () => Number(document.querySelector('#sim-time')?.getAttribute('data-tick'));
        const before = tick();
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        document.dispatchEvent(new Event('visibilitychange'));
        requestAnimationFrame(() => requestAnimationFrame(() => resolve({ before, after: tick() })));
      }),
  );
}

test('runs the simulation clock while the page is visible', async ({ page }) => {
  await expect.poll(() => simTick(page)).toBeGreaterThan(30);
  await expect(page.locator('#sim-time')).toHaveText(/^\d+\.\d s$/);
});

test('pauses while the page is hidden and resumes without a catch-up jump', async ({ page }) => {
  await expect.poll(() => simTick(page)).toBeGreaterThan(0);

  await setPageHidden(page, true);
  const paused = await simTick(page);
  // One second hidden: about 60 ticks would run if the app did not pause.
  await page.waitForTimeout(1000);
  expect(await simTick(page)).toBe(paused);

  // The first frame back only records the time, so the first two frames run at most one frame's worth
  // of ticks (at most 5 under the per-frame cap). An app that caught up on the hidden second would
  // already run 5 in the first frame, and more in the second.
  const { before, after } = await ticksInTwoFramesAfterShowing(page);
  expect(before).toBe(paused);
  expect(after - before).toBeLessThanOrEqual(5);
  await expect.poll(() => simTick(page)).toBeGreaterThan(after);
});

// The built-in track's bounds in world metres, and points known to be on the road and in the infield.
const TRACK_BOUNDS = { minX: -107, minY: -47, maxX: 107, maxY: 47 };
const ROAD_POINT = { x: 15, y: 40 }; // bottom straight, between gates
const INFIELD_POINT = { x: 0, y: 0 };
const ROAD_RGB = [0x3b, 0x46, 0x54];
const BACKGROUND_RGB = [0x1f, 0x2a, 0x36];

/** Reads the track transform the page uses and samples real canvas pixels at given world points. */
async function trackState(page: Page) {
  return page.locator('#sim-canvas').evaluate(
    (node, args) => {
      const canvas = node as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      const scale = Number(canvas.dataset.trackScale);
      const offsetX = Number(canvas.dataset.trackOffsetX);
      const offsetY = Number(canvas.dataset.trackOffsetY);
      const toCss = (p: { x: number; y: number }) => ({ x: p.x * scale + offsetX, y: p.y * scale + offsetY });
      const ratio = canvas.width / rect.width;
      const context = canvas.getContext('2d');
      const sample = (p: { x: number; y: number }) => {
        const css = toCss(p);
        const data = context?.getImageData(Math.round(css.x * ratio), Math.round(css.y * ratio), 1, 1).data;
        return data ? [data[0], data[1], data[2]] : [];
      };
      const topLeft = toCss({ x: args.bounds.minX, y: args.bounds.minY });
      const bottomRight = toCss({ x: args.bounds.maxX, y: args.bounds.maxY });
      return {
        cssWidth: rect.width,
        cssHeight: rect.height,
        builds: Number(canvas.dataset.trackLayerBuilds),
        track: { left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y },
        road: sample(args.road),
        infield: sample(args.infield),
      };
    },
    { bounds: TRACK_BOUNDS, road: ROAD_POINT, infield: INFIELD_POINT },
  );
}

function expectColour(actual: (number | undefined)[], expected: number[]) {
  expected.forEach((channel, i) => expect(Math.abs((actual[i] ?? -999) - channel)).toBeLessThanOrEqual(3));
}

/** The track sits inside the canvas with its margin, fills the limiting direction and keeps its shape. */
function expectTrackFits(state: Awaited<ReturnType<typeof trackState>>) {
  const { cssWidth, cssHeight, track } = state;
  const margin = Math.max(8, 0.04 * Math.min(cssWidth, cssHeight));
  expect(track.left).toBeGreaterThanOrEqual(margin - 0.5);
  expect(track.top).toBeGreaterThanOrEqual(margin - 0.5);
  expect(track.right).toBeLessThanOrEqual(cssWidth - margin + 0.5);
  expect(track.bottom).toBeLessThanOrEqual(cssHeight - margin + 0.5);
  const fillsWidth = Math.abs(track.right - track.left - (cssWidth - 2 * margin)) < 0.5;
  const fillsHeight = Math.abs(track.bottom - track.top - (cssHeight - 2 * margin)) < 0.5;
  expect(fillsWidth || fillsHeight).toBe(true);
  expect((track.right - track.left) / (track.bottom - track.top)).toBeCloseTo(214 / 94, 3);
}

test('draws the racetrack fitted to the screen, keeping its shape', async ({ page }) => {
  await expect.poll(async () => (await trackState(page)).builds).toBeGreaterThan(0);
  const state = await trackState(page);
  expectTrackFits(state);
  expectColour(state.road, ROAD_RGB);
  expectColour(state.infield, BACKGROUND_RGB);
});

test('keeps reusing the cached track layer while the size stays the same', async ({ page }) => {
  await expect.poll(async () => (await simTick(page))).toBeGreaterThan(10);
  const before = (await trackState(page)).builds;
  // About 30 more frames, each copying the layer to the screen.
  await expect.poll(async () => (await simTick(page))).toBeGreaterThan(40);
  expect((await trackState(page)).builds).toBe(before);
});

test('redraws and refits the track when the device rotates', async ({ page }) => {
  await expect.poll(async () => (await trackState(page)).builds).toBeGreaterThan(0);
  const before = await trackState(page);
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('No viewport size');
  await page.setViewportSize({ width: viewport.height, height: viewport.width });
  await expect.poll(async () => (await trackState(page)).builds).toBeGreaterThan(before.builds);
  const after = await trackState(page);
  expectTrackFits(after);
  expectColour(after.road, ROAD_RGB);
  expect(after.cssWidth).not.toBe(before.cssWidth);
});
