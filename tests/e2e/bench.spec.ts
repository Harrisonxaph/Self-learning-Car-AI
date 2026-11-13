// The in-page headless benchmark (`?mode=bench`) on the real page: it runs in slices and finishes with a labelled table and finite figures, repeats the same
// simulated work, cancel and leaving the foreground report nothing, no other page shows it, and it fits a 320 px phone. Emulated browsers only, and a tiny run
// (1,000 car-ticks): the figures it prints depend on the machine and say nothing about the owner's phone, which is the point of the page, not of this test.
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

const panel = (page: Page) => page.locator('#bench-panel');

test('runs to a labelled table with finite figures, and a second run does exactly the same simulated work', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?mode=bench&circuit=stadium-oval&carticks=1000');
  await expect(panel(page)).toBeVisible();
  await expect(panel(page)).toHaveAttribute('data-state', 'idle');
  await expect(page.locator('#bench-circuit')).toHaveValue('stadium-oval');
  await expect(page.locator('#bench-table')).toBeHidden();
  await page.locator('#bench-run').click();
  await expect(panel(page)).toHaveAttribute('data-state', 'done', { timeout: 90_000 });
  await expect(page.locator('#bench-table')).toBeVisible();
  const labels = await page.locator('#bench-body th').allTextContents();
  expect(labels).toEqual([
    'Circuit',
    'Population and seed',
    'Work',
    'Mean running cars',
    'Compute time (inside slices only)',
    'Car-ticks per second',
    'Ticks per second at the full population of 50',
    'Build',
    'Browser',
  ]);
  const first = await panel(page).evaluate((el) => ({ ...(el as HTMLElement).dataset }));
  expect(Number(first.carTicks)).toBeGreaterThanOrEqual(1000);
  expect(Number(first.ticks)).toBeGreaterThan(0);
  expect(Number(first.carTicksPerSecond)).toBeGreaterThan(0);
  expect(Number(first.ticksFullPopulation)).toBeGreaterThan(0);
  await expect(page.locator('#bench-message')).toContainText('says nothing about learning');
  // Run again: the same simulated work (the timing may differ).
  await page.locator('#bench-run').click();
  await expect(panel(page)).toHaveAttribute('data-state', 'done', { timeout: 90_000 });
  const second = await panel(page).evaluate((el) => ({ ...(el as HTMLElement).dataset }));
  expect([second.carTicks, second.ticks]).toEqual([first.carTicks, first.ticks]);
});

test('Silverstone is the default circuit and reports its 2,356 boundary segments', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/?mode=bench&carticks=1000');
  await expect(page.locator('#bench-circuit')).toHaveValue('silverstone');
  const options = await page.locator('#bench-circuit option').evaluateAll((nodes) => nodes.map((n) => (n as HTMLOptionElement).value));
  expect(options).toEqual(['stadium-oval', 'kidney-loop', 'silverstone']);
  await page.locator('#bench-run').click();
  await expect(panel(page)).toHaveAttribute('data-state', 'done', { timeout: 120_000 });
  await expect(page.locator('#bench-body')).toContainText('2,356 boundary segments');
});

test('Cancel stops a long run and reports nothing; Run is available again', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/?mode=bench&carticks=2000000');
  await page.locator('#bench-run').click();
  await expect(panel(page)).toHaveAttribute('data-state', 'running');
  await expect(page.locator('#bench-run')).toBeDisabled();
  await expect(page.locator('#bench-circuit')).toBeDisabled();
  await expect(page.locator('#bench-progress')).toContainText(/car-ticks/, { timeout: 30_000 });
  await page.locator('#bench-cancel').click();
  await expect(panel(page)).toHaveAttribute('data-state', 'cancelled');
  await expect(page.locator('#bench-message')).toHaveText('Cancelled: nothing is reported.');
  await expect(page.locator('#bench-table')).toBeHidden();
  await expect(page.locator('#bench-run')).toBeEnabled();
  await expect(page.locator('#bench-cancel')).toBeDisabled();
  await expect(panel(page)).not.toHaveAttribute('data-car-ticks', /.*/);
});

test('leaving the foreground ends a running run with a message and no figures', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/?mode=bench&carticks=2000000');
  await page.locator('#bench-run').click();
  await expect(panel(page)).toHaveAttribute('data-state', 'running');
  await expect(page.locator('#bench-progress')).toContainText(/car-ticks/, { timeout: 30_000 });
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(panel(page)).toHaveAttribute('data-state', 'interrupted');
  await expect(page.locator('#bench-message')).toContainText('left the foreground');
  await expect(page.locator('#bench-table')).toBeHidden();
});

test('no other page shows the benchmark, and the benchmark page hides the driving controls', async ({ page }) => {
  for (const url of ['/', '/?mode=train', '/?mode=edit', '/?mode=evaluate', '/?mode=race']) {
    await page.goto(url);
    await expect(panel(page)).toBeHidden();
  }
  await page.goto('/?mode=bench');
  await expect(panel(page)).toBeVisible();
  await expect(page.locator('.controls')).toBeHidden();
});

test('the controls are at least 44 px and nothing scrolls sideways at 320 px, idle and with a result', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/?mode=bench&circuit=stadium-oval&carticks=1000');
  const check = async () => {
    for (const selector of ['#bench-run', '#bench-cancel', '#bench-circuit']) {
      const box = (await page.locator(selector).boundingBox())!;
      expect(box.height, `${selector} height`).toBeGreaterThanOrEqual(43.5);
      expect(box.x + box.width, `${selector} within the screen`).toBeLessThanOrEqual(320);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  };
  await check();
  await page.locator('#bench-run').click();
  await expect(panel(page)).toHaveAttribute('data-state', 'done', { timeout: 90_000 });
  await check();
});
