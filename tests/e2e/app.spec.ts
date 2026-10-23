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

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  // Fail on any runtime error during start-up.
  await page.waitForLoadState('load');
  expect(errors).toEqual([]);
});

test('starts with a visible, painted canvas and readable heading', async ({ page }) => {
  await expect(page).toHaveTitle('Self-Driving AI Evolution');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Self-Driving AI Evolution');
  await expect(page.getByRole('img', { name: /simulation area/i })).toBeVisible();
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
