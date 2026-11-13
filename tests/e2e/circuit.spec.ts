// The Training circuit choice (P4-04) on the real page: the circuit comes from the address (training circuits only), is
// drawn and published, is disabled mid-run, and changing it starts a new run on the other circuit. Emulated browsers only:
// the iPhone and iPad checks of plan section 7 are outstanding manual checks.
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

test('the default is the stadium oval and the choice offers the training circuits only', async ({ page }) => {
  await page.goto('/?mode=train');
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-track-id', 'stadium-oval');
  await page.locator('#champion-replay > summary').click();
  const options = await page.locator('#training-circuit option').evaluateAll((nodes) => nodes.map((n) => [(n as HTMLOptionElement).value, n.textContent]));
  expect(options.map((o) => o[0])).toEqual(['stadium-oval', 'kidney-loop', 'silverstone']);
  expect(options[0]).toEqual(['stadium-oval', 'Stadium oval']);
  expect(options[1]).toEqual(['kidney-loop', 'Kidney loop']);
  await expect(page.locator('#training-circuit')).toHaveValue('stadium-oval');
  await expect(page.locator('#training-circuit')).toBeEnabled();
});

test('the circuit comes from the address, and a validation, held-out or unknown circuit is ignored', async ({ page }) => {
  await page.goto('/?mode=train&circuit=kidney-loop');
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-track-id', 'kidney-loop');
  await page.locator('#champion-replay > summary').click();
  await expect(page.locator('#training-circuit')).toHaveValue('kidney-loop');
  await expect(page.locator('#sim-canvas')).toHaveAttribute('aria-label', /Kidney loop/);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-track-scale', /\d/);
  for (const id of ['hairpin-chicane', 's-sweepers', 'long-sweepers', 'technical-narrow', 'rounded-rectangle', 'nonsense']) {
    await page.goto(`/?mode=train&circuit=${id}`);
    await expect(page.locator('#sim-canvas')).toHaveAttribute('data-track-id', 'stadium-oval');
  }
});

test('mid-run the choice is disabled; pausing enables it, and choosing the other circuit starts a new run on it', async ({ page }) => {
  await page.goto('/?mode=train');
  await page.locator('[data-speed="max"]').click();
  await expect.poll(async () => Number(await data(page, 'completed-generations')), { timeout: 60_000 }).toBeGreaterThanOrEqual(1);
  await expect(page.locator('#training-circuit')).toBeDisabled();
  await expect(page.locator('#training-circuit-hint')).toHaveText('Pause training to change the circuit.');
  await page.locator('#speed-pause').click();
  await page.locator('#champion-replay > summary').click();
  await expect(page.locator('#training-circuit')).toBeEnabled();
  await page.locator('#training-circuit').selectOption('kidney-loop');
  await page.waitForURL(/circuit=kidney-loop/);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-track-id', 'kidney-loop');
  await expect(page.locator('#training-circuit')).toHaveValue('kidney-loop');
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-completed-generations', '0');
});

test('the control is at least 44 px and nothing scrolls sideways at 320 px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/?mode=train&circuit=kidney-loop');
  await page.locator('#champion-replay > summary').click();
  const box = (await page.locator('#training-circuit').boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(43.5);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('the default page and the editor page do not show the circuit choice', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#training-circuit')).toBeHidden();
  await page.goto('/?mode=edit');
  await expect(page.locator('#training-circuit')).toBeHidden();
});

test('Silverstone can be chosen from the address: it is drawn whole, credited, and trains under its own limits; the others keep the defaults and show no credit', async ({ page }) => {
  await page.goto('/?mode=train');
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-episode-limits', '60/5/3');
  await page.locator('#champion-replay > summary').click();
  await expect(page.locator('#training-circuit-credit')).toBeHidden();

  await page.goto('/?mode=train&circuit=silverstone');
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-track-id', 'silverstone');
  await expect(page.locator('#sim-canvas')).toHaveAttribute('aria-label', /Silverstone/);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-episode-limits', '420/10/1');
  await page.locator('#champion-replay > summary').click();
  await expect(page.locator('#training-circuit')).toHaveValue('silverstone');
  const credit = page.locator('#training-circuit-credit');
  await expect(credit).toBeVisible();
  await expect(credit).toContainText('TUM racetrack-database');
  await expect(credit).toContainText('OpenStreetMap contributors');
  await expect(credit).toContainText('opposite way round');

  // The whole circuit is fitted: its bounds (about 1,020 m by 1,724 m) lie inside the canvas at the fitted scale.
  const view = await page.locator('#sim-canvas').evaluate((c) => {
    const el = c as HTMLCanvasElement;
    return { scale: Number(el.dataset.trackScale), x: Number(el.dataset.trackOffsetX), y: Number(el.dataset.trackOffsetY), w: el.width, h: el.height };
  });
  expect(view.scale).toBeGreaterThan(0);
  expect(1020 * view.scale).toBeLessThanOrEqual(view.w + 1);
  expect(1724 * view.scale).toBeLessThanOrEqual(view.h + 1);
});

test('a run on Silverstone advances at maximum speed under its own limits (cars crash within seconds; a whole generation is covered by the unit smoke run)', async ({ page }) => {
  await page.goto('/?mode=train&circuit=silverstone');
  await page.locator('[data-speed="max"]').click();
  // Random brains hit a wall or stall within a few simulated seconds, so the dashboard's crashed count rises well before any 420 s limit.
  await expect.poll(async () => Number(await page.locator('#dash-crashed').textContent()), { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-episode-limits', '420/10/1');
});
