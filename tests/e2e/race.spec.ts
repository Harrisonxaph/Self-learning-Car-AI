// Human vs AI racing on the real page (P5-03, `?mode=race`): a synthetic saved champion is put in the browser's storage, chosen with a
// 1-lap race, started (a render-time countdown, no simulation during it), driven with the on-screen touch controls to a finish
// (a human crash is a valid finish), the results panel read, and the race restarted so the AI repeats exactly. Emulated browsers only:
// the iPhone and iPad checks of plan section 7 are outstanding manual checks. The fixture champion is
// tests/fixtures/race-champion-v1.json (a seeded one-generation champion that drives for about 18 simulated seconds).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';

const FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/race-champion-v1.json', import.meta.url)), 'utf8')) as { id: string };

let errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(
    ({ id, text }) => {
      if (window.localStorage.getItem('sdae:test-seeded') === null) {
        window.localStorage.setItem(`sdae:model:${id}`, text);
        window.localStorage.setItem('sdae:models:index', JSON.stringify([id]));
        window.localStorage.setItem('sdae:test-seeded', '1');
      }
    },
    { id: FIXTURE.id, text: JSON.stringify(FIXTURE) },
  );
});
test.afterEach(() => {
  expect(errors).toEqual([]);
});

const canvas = (page: Page) => page.locator('#sim-canvas');
const phase = (page: Page) => canvas(page).getAttribute('data-race-phase');
const button = (page: Page, action: string): Locator => page.locator(`button[data-action="${action}"]`);
const touch = (page: Page, action: string, type: 'pointerdown' | 'pointerup', pointerId: number) =>
  button(page, action).dispatchEvent(type, { pointerId, pointerType: 'touch', isPrimary: true, button: 0, bubbles: true, cancelable: true });

async function open(page: Page): Promise<void> {
  await page.goto('/?mode=race');
  await expect(page.locator('#race-panel')).toBeVisible();
  await expect(page.locator('#race-panel')).toHaveAttribute('data-race-models', '1');
}

async function startOneLap(page: Page): Promise<void> {
  await page.locator('#rc-model').selectOption(FIXTURE.id);
  await page.locator('#rc-laps').selectOption('1');
  await expect(page.locator('#rc-start')).toBeEnabled();
  await page.locator('#rc-start').click();
}

/**
 * Starts the crash scenario on a FRESH race clock: restarts the race (the in-race Restart button, or Race again on the results screen), waits for
 * the new countdown, then holds Gas (a touch pointer on the on-screen button) during it, so the held input applies from tick 0. Nothing slow
 * (drawing checks, polling) can use up the five-second no-new-gate allowance before the car moves. Then waits for the wall contact and lets go.
 */
async function restartAndDriveIntoWall(page: Page): Promise<void> {
  if (await page.locator('#rr-restart').isVisible()) await page.locator('#rr-restart').click();
  else await page.locator('#restart').click();
  await expect(canvas(page)).toHaveAttribute('data-race-phase', 'countdown');
  await expect(canvas(page)).toHaveAttribute('data-race-tick', '0');
  await touch(page, 'accelerate', 'pointerdown', 7);
  await expect(button(page, 'accelerate')).toHaveClass(/held/);
  await expect.poll(async () => await canvas(page).getAttribute('data-human-outcome'), { timeout: 30_000 }).not.toBe('');
  await touch(page, 'accelerate', 'pointerup', 7).catch(() => undefined);
}

/** Counts the pixels near the two cars' identity colours (amber for You, purple for the AI) on the race canvas. */
const carPixels = (page: Page) =>
  page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('#sim-canvas')!;
    const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const near = (r: number, g: number, b: number, tr: number, tg: number, tb: number) => Math.abs(r - tr) < 24 && Math.abs(g - tg) < 24 && Math.abs(b - tb) < 24;
    let you = 0;
    let ai = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (near(data[i]!, data[i + 1]!, data[i + 2]!, 0xff, 0xb0, 0x00)) you += 1;
      else if (near(data[i]!, data[i + 1]!, data[i + 2]!, 0xb3, 0x88, 0xff)) ai += 1;
    }
    return { you, ai };
  });

test('the other pages show no race UI, and the race page offers training and validation circuits and saved champions only', async ({ page }) => {
  for (const url of ['/', '/?mode=train', '/?mode=evaluate', '/?mode=edit']) {
    await page.goto(url);
    await expect(page.locator('#race-panel')).toBeHidden();
    await expect(page.locator('#race-results')).toBeHidden();
    await expect(page.locator('#race-hud')).toBeHidden();
    await expect(page.locator('#race-countdown')).toBeHidden();
  }
  await open(page);
  await expect(page.locator('#rc-start')).toBeDisabled();
  await expect(page.locator('#sim-canvas')).toBeHidden();
  // The circuit selector is usable before a champion is chosen (it showed blank and disabled on a real iPhone), with a circuit already shown.
  await expect(page.locator('#rc-circuit')).toBeEnabled();
  await expect(page.locator('#rc-circuit')).toHaveValue('stadium-oval');
  await page.locator('#rc-circuit').selectOption('kidney-loop');
  await expect(page.locator('#rc-circuit')).toHaveValue('kidney-loop');
  await page.locator('#rc-model').selectOption(FIXTURE.id);
  await expect(page.locator('#rc-note')).toContainText('Trained on stadium-oval');
  const values = await page.locator('#rc-circuit option').evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value));
  expect(values).toEqual(['stadium-oval', 'kidney-loop', 'rounded-rectangle', 's-sweepers']);
  expect(await page.locator('#rc-laps option').evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value))).toEqual(['1', '3']);
  await expect(page.locator('#rc-laps')).toHaveValue('3');
  // While choosing, the driving keys are not attached: the arrow keys change a focused select and nothing is prevented.
  await page.locator('#rc-laps').focus();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#rc-laps')).toHaveValue('1');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#rc-laps')).toHaveValue('3');
});

test('start and finish a race with the touch controls, read the results, and restart so the AI repeats', async ({ page }) => {
  test.setTimeout(180_000);
  await open(page);
  await startOneLap(page);

  // The countdown runs on render time: the simulation does not run during it.
  await expect(page.locator('#race-countdown')).toBeVisible();
  await expect(page.locator('#race-countdown')).toHaveText(/^[123]$/);
  await expect(canvas(page)).toHaveAttribute('data-race-phase', 'countdown');
  await expect(canvas(page)).toHaveAttribute('data-race-tick', '0');
  await expect(page.locator('#race-panel')).toBeHidden();
  await expect(page.locator('#race-hud')).toBeVisible();
  await expect(page.locator('#rh-you')).toContainText('lap 1 of 1');
  await expect(page.locator('#rh-ai')).toContainText('lap 1 of 1');
  await expect(canvas(page)).toBeVisible();

  // Both cars are drawn, in their own colours (and labelled "You" and "AI" on the canvas). At the start they share one pose and "You" is drawn
  // on top, so look once the AI has driven away from the idle human car.
  await expect.poll(() => phase(page), { timeout: 15_000 }).toBe('racing');
  await expect
    .poll(async () => {
      const at = async (name: string): Promise<number> => Number(await canvas(page).getAttribute(name));
      return Math.hypot((await at('data-ai-x')) - (await at('data-human-x')), (await at('data-ai-y')) - (await at('data-human-y')));
    }, { timeout: 15_000 })
    .toBeGreaterThan(8);
  await expect.poll(async () => (await carPixels(page)).you).toBeGreaterThan(1);
  await expect.poll(async () => (await carPixels(page)).ai).toBeGreaterThan(1);

  // The crash scenario runs on its own, fresh race (see restartAndDriveIntoWall), so the checks above cannot decide its outcome.
  await restartAndDriveIntoWall(page);
  await expect.poll(() => phase(page), { timeout: 60_000 }).toBe('finished');

  const results = page.locator('#race-results');
  await expect(results).toBeVisible();
  await expect(results).toHaveAttribute('data-race-phase', 'finished');
  await expect(page.locator('#rr-body tr')).toHaveCount(7);
  const measure = (key: string, car: 'human' | 'ai') => page.locator(`#rr-body tr[data-measure="${key}"] td[data-car="${car}"]`);
  await expect(measure('outcome', 'human')).toContainText('Crashed');
  await expect(measure('collisions', 'human')).toHaveText('1');
  await expect(measure('outcome', 'ai')).not.toContainText('Still racing');
  await expect(measure('first-lap', 'human')).toHaveText('no lap completed');
  await expect(page.locator('#rr-comparison')).toContainText(/No winner is declared/);
  await expect(page.locator('#rr-comparison')).not.toContainText(/faster/);
  await expect(page.locator('#rr-note')).toContainText('0 or 1 per car');
  const first = {
    aiX: await canvas(page).getAttribute('data-ai-x'),
    aiY: await canvas(page).getAttribute('data-ai-y'),
    aiGates: await canvas(page).getAttribute('data-ai-gates'),
    aiOutcome: await canvas(page).getAttribute('data-ai-outcome'),
  };
  expect(first.aiOutcome).not.toBe('');
  expect(Number(first.aiGates)).toBeGreaterThan(0);

  // Race again: the whole race starts over from the same start, and the AI repeats exactly whatever the human did.
  await page.locator('#rr-restart').click();
  await expect(canvas(page)).toHaveAttribute('data-race-phase', 'countdown');
  await expect(canvas(page)).toHaveAttribute('data-race-tick', '0');
  await expect(results).toBeHidden();
  await expect.poll(() => phase(page), { timeout: 15_000 }).toBe('racing');
  // This time the human does nothing and stalls.
  await expect.poll(() => phase(page), { timeout: 60_000 }).toBe('finished');
  await expect(measure('outcome', 'human')).toContainText('Stalled');
  expect({
    aiX: await canvas(page).getAttribute('data-ai-x'),
    aiY: await canvas(page).getAttribute('data-ai-y'),
    aiGates: await canvas(page).getAttribute('data-ai-gates'),
    aiOutcome: await canvas(page).getAttribute('data-ai-outcome'),
  }).toEqual(first);

  // Choose another goes back to choosing.
  await page.locator('#rr-back').click();
  await expect(page.locator('#race-panel')).toBeVisible();
  await expect(results).toBeHidden();
  await expect(canvas(page)).toBeHidden();
});

test('the touch controls are at least 44 px and the page does not scroll sideways at 320 px, while choosing and while racing', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await open(page);
  const sideways = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await sideways()).toBeLessThanOrEqual(0);
  for (const sel of ['#rc-model', '#rc-circuit', '#rc-laps', '#rc-start']) {
    const box = await page.locator(sel).boundingBox();
    expect(box && box.height >= 24 && box.x >= 0 && box.x + box.width <= 320, sel).toBe(true);
  }
  await startOneLap(page);
  await expect(canvas(page)).toBeVisible();
  expect(await sideways()).toBeLessThanOrEqual(0);
  for (const action of ['left', 'right', 'accelerate', 'brake']) {
    const box = await button(page, action).boundingBox();
    expect(box, action).not.toBeNull();
    expect(box!.width, `${action} width`).toBeGreaterThanOrEqual(44);
    expect(box!.height, `${action} height`).toBeGreaterThanOrEqual(44);
    expect(box!.x + box!.width, `${action} within the screen`).toBeLessThanOrEqual(320);
  }
  const restart = await page.locator('#restart').boundingBox();
  expect(restart!.width).toBeGreaterThanOrEqual(44);
  expect(restart!.height).toBeGreaterThanOrEqual(44);
  // The page does not scroll under the canvas while racing.
  expect(await page.evaluate(() => document.documentElement.scrollHeight - document.documentElement.clientHeight)).toBeLessThanOrEqual(0);
});

test('the driving keys work while racing and are released when the race ends', async ({ page }, testInfo) => {
  test.skip(!!testInfo.project.use.hasTouch, 'Keyboard test: desktop projects.');
  await open(page);
  await startOneLap(page);
  await expect.poll(() => phase(page), { timeout: 15_000 }).toBe('racing');
  const startX = Number(await canvas(page).getAttribute('data-human-x'));
  await page.keyboard.down('ArrowUp');
  await expect.poll(async () => Math.abs(Number(await canvas(page).getAttribute('data-human-x')) - startX), { timeout: 10_000 }).toBeGreaterThan(1);
  await page.keyboard.up('ArrowUp');
  await expect.poll(() => phase(page), { timeout: 60_000 }).toBe('finished');
  // On the results screen the page keeps the browser's own key behaviour: Space on a focused button activates it (it does not brake).
  await expect(page.locator('#rr-restart')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(canvas(page)).toHaveAttribute('data-race-phase', 'countdown');
});
