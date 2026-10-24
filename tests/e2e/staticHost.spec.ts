// The production build served by a plain static file server (tests/e2e/staticHost.ts), at the site root and
// under a sub-path (P1-11). The page must load every asset from where it is hosted, start the simulation and
// draw the track, with no server code, rewrites or fallbacks to help it.
import { expect, test } from '@playwright/test';
import { MOUNTS, STATIC_PORT } from './staticHost';

const ORIGIN = `http://127.0.0.1:${STATIC_PORT}`;

for (const mount of MOUNTS) {
  test(`the production build runs from a plain static host at ${mount}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    const requests: { path: string; status: number }[] = [];
    page.on('response', (response) => {
      const url = new URL(response.url());
      if (url.origin === ORIGIN) requests.push({ path: url.pathname, status: response.status() });
    });

    await page.goto(`${ORIGIN}${mount}`);
    const canvas = page.locator('#sim-canvas');
    // The app started: the car is on the start pose, the track layer was drawn and simulation ticks advance.
    await expect.poll(() => canvas.getAttribute('data-car-x')).toBe('-6');
    await expect.poll(async () => Number(await canvas.getAttribute('data-track-layer-builds'))).toBeGreaterThanOrEqual(1);
    await expect.poll(async () => Number(await page.locator('#sim-time').getAttribute('data-tick')), { timeout: 10_000 }).toBeGreaterThan(30);

    // Browsers ask for /favicon.ico at the site root on their own; the page itself never refers to it.
    const fromPage = requests.filter((r) => r.path !== '/favicon.ico');
    // The page, its script and its stylesheet, all found, and all fetched from under the mount, so nothing
    // depends on the site root.
    expect(fromPage.map((r) => r.path)).toEqual(expect.arrayContaining([mount, expect.stringMatching(/\.js$/), expect.stringMatching(/\.css$/)]));
    for (const request of fromPage) {
      expect(request.status, request.path).toBeLessThan(400);
      expect(request.path.startsWith(mount), request.path).toBe(true);
    }
    expect(errors).toEqual([]);
  });
}
