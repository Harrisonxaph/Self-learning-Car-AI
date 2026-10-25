// The ray sensor debug layer (P2-01) on the real page: off by default; with `?debug=rays` the rays are cast
// from the car's body centre, published as data attributes, and drawn where the published track transform
// puts them. Emulated browsers only: real iPhone/iPad alignment is a manual device check (docs/TESTING.md).
import { expect, test, type Page } from '@playwright/test';

const MARKER_RGB = [0xff, 0x00, 0xd4];

interface RayData {
  origin: { x: number; y: number };
  rays: { distance: number; hit: boolean; end: { x: number; y: number } }[];
}

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

/** The published rays, the transform, and the canvas pixel colours at the given world points. */
async function rayState(page: Page, worldPoints: { x: number; y: number }[] = []) {
  return page.locator('#sim-canvas').evaluate((node, points) => {
    const canvas = node as HTMLCanvasElement;
    const scale = Number(canvas.dataset.trackScale);
    const offsetX = Number(canvas.dataset.trackOffsetX);
    const offsetY = Number(canvas.dataset.trackOffsetY);
    const ratio = canvas.width / canvas.getBoundingClientRect().width;
    const context = canvas.getContext('2d');
    const pixels = points.map((p) => {
      const x = (p.x * scale + offsetX) * ratio;
      const y = (p.y * scale + offsetY) * ratio;
      const data = context?.getImageData(Math.round(x), Math.round(y), 1, 1).data;
      return data ? [data[0]!, data[1]!, data[2]!] : [];
    });
    return { rays: canvas.dataset.rays ?? null, scale, offsetX, offsetY, viewportWidth: window.innerWidth, pixels };
  }, worldPoints);
}

const isMarker = (rgb: number[]) => MARKER_RGB.every((channel, i) => Math.abs((rgb[i] ?? -999) - channel) <= 3);

/** Waits for the page to publish rays, then checks them against the start-pose geometry. */
async function expectStartRays(page: Page): Promise<RayData> {
  await expect.poll(async () => (await rayState(page)).rays).not.toBeNull();
  const data = JSON.parse((await rayState(page)).rays!) as RayData;
  // The car waits at its start pose: rear axle (−6, 40), heading 0, so the origin is (−4.75, 40).
  expect(data.origin.x).toBeCloseTo(-4.75, 9);
  expect(data.origin.y).toBeCloseTo(40, 9);
  expect(data.rays).toHaveLength(7);
  // −90°, −60°, −30° meet the inner straight y = 33; 30°, 60°, 90° the outer straight y = 47.
  [0, 1, 2].forEach((i) => expect(data.rays[i]!.end.y).toBeCloseTo(33, 9));
  [4, 5, 6].forEach((i) => expect(data.rays[i]!.end.y).toBeCloseTo(47, 9));
  expect(data.rays[0]!.distance).toBeCloseTo(7, 9);
  expect(data.rays[6]!.distance).toBeCloseTo(7, 9);
  expect(data.rays[1]!.distance).toBeCloseTo(7 / Math.sin(Math.PI / 3), 9);
  expect(data.rays[2]!.distance).toBeCloseTo(14, 9);
  // Straight ahead is clear for the whole 50 m.
  expect(data.rays[3]).toMatchObject({ distance: 50, hit: false });
  expect(data.rays[3]!.end.x).toBeCloseTo(45.25, 9);
  expect(data.rays[3]!.end.y).toBeCloseTo(40, 9);
  return data;
}

/** Every hit marker is drawn exactly where the published transform puts its world point; the clear end has none. */
async function expectMarkersOnScreen(page: Page, data: RayData) {
  const hits = data.rays.filter((r) => r.hit).map((r) => r.end);
  const clear = data.rays.filter((r) => !r.hit).map((r) => r.end);
  await expect
    .poll(async () => {
      const { pixels } = await rayState(page, [...hits, ...clear]);
      return pixels.map(isMarker);
    })
    .toEqual([...hits.map(() => true), ...clear.map(() => false)]);
}

test('with ?debug=rays the rays start at the body centre and are drawn on the walls they hit', async ({ page }) => {
  await page.goto('/?debug=rays');
  const data = await expectStartRays(page);
  await expectMarkersOnScreen(page, data);
});

test('the rays stay aligned after the screen rotates', async ({ page }) => {
  await page.goto('/?debug=rays');
  await expectStartRays(page);
  const before = await rayState(page);
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: size.height, height: size.width });
  await expect.poll(async () => (await rayState(page)).viewportWidth).toBe(size.height);
  await expect.poll(async () => (await rayState(page)).scale).not.toBe(before.scale);
  const data = await expectStartRays(page);
  await expectMarkersOnScreen(page, data);
});

test('without the flag nothing about the rays is published or drawn, and the layout is the same', async ({ page }) => {
  const layout = async () =>
    page.evaluate(() =>
      [...document.querySelectorAll('#sim-canvas, button, #hud-laps, #sim-time')].map((element) => {
        const r = element.getBoundingClientRect();
        return [element.id || element.textContent, r.x, r.y, r.width, r.height];
      }),
    );

  await page.goto('/?debug=rays');
  const data = await expectStartRays(page);
  const withRays = await layout();

  await page.goto('/');
  await expect.poll(async () => Number(await page.locator('#sim-time').getAttribute('data-tick'))).toBeGreaterThan(10);
  const plain = await rayState(page, data.rays.filter((r) => r.hit).map((r) => r.end));
  expect(plain.rays).toBeNull();
  expect(plain.pixels.some(isMarker)).toBe(false);
  expect(await layout()).toEqual(withRays);
});
