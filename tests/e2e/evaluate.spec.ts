// Evaluating a saved champion on the real page (P4-05, `?mode=evaluate`): save-less setup (a synthetic fixture champion is put in
// the browser's storage), choose it, evaluate it on ANOTHER TRAINING circuit and a VALIDATION circuit (the roadmap's E2E as
// amended), see the stored results, reload, cancel, and see that no held-out circuit is offered. Emulated browsers only: the
// iPhone and iPad checks of plan section 7 are outstanding manual checks.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/champion-v1.json', import.meta.url)), 'utf8')) as { id: string };

let errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  // Seeded once per context: a saved champion in this browser's storage (the page itself never saves one).
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

const panel = (page: Page) => page.locator('#evaluate-panel');
async function open(page: Page): Promise<void> {
  await page.goto('/?mode=evaluate');
  await expect(panel(page)).toBeVisible();
  await expect(panel(page)).toHaveAttribute('data-eval-models', '1');
}
const tick = (page: Page, id: string) => page.locator(`#ev-circuit-list input[data-circuit="${id}"]`).check();

test('evaluates a saved champion on another training circuit and a validation circuit, stores the results, and keeps them after a reload', async ({ page }) => {
  await open(page);
  await expect(page.locator('#ev-run')).toBeDisabled();
  await page.locator('#ev-model').selectOption(FIXTURE.id);
  await expect(page.locator('#ev-model-note')).toContainText('Trained on stadium-oval');
  await tick(page, 'kidney-loop');
  await tick(page, 's-sweepers');
  await expect(page.locator('#ev-run')).toBeEnabled();
  await page.locator('#ev-run').click();
  await expect(panel(page)).toHaveAttribute('data-eval-state', 'idle', { timeout: 60_000 });
  await expect(page.locator('#ev-progress')).toHaveText('Done: 2 circuits evaluated and stored.');
  await expect(panel(page)).toHaveAttribute('data-eval-entries', '2');
  const rows = page.locator('#ev-body tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toHaveAttribute('data-split', 'validation');
  await expect(rows.nth(1)).toHaveAttribute('data-split', 'training');
  await expect(rows.nth(0)).toContainText('s-sweepers (validation)');
  await expect(rows.nth(1)).toContainText('kidney-loop (training)');
  await expect(rows.nth(0)).toContainText('%');
  await page.reload();
  await expect(panel(page)).toBeVisible();
  await page.locator('#ev-model').selectOption(FIXTURE.id);
  await expect(panel(page)).toHaveAttribute('data-eval-entries', '2');
  await expect(page.locator('#ev-body tr')).toHaveCount(2);
});

test('the same evaluation twice gives identical figures in one browser (deterministic)', async ({ page }) => {
  await open(page);
  await page.locator('#ev-model').selectOption(FIXTURE.id);
  await tick(page, 'rounded-rectangle');
  const figures = async () => page.locator('#ev-body tr').first().locator('td').evaluateAll((cells) => cells.slice(0, 5).map((c) => c.textContent));
  await page.locator('#ev-run').click();
  await expect(panel(page)).toHaveAttribute('data-eval-entries', '1', { timeout: 60_000 });
  const first = await figures();
  await page.locator('#ev-run').click();
  await expect(panel(page)).toHaveAttribute('data-eval-entries', '2', { timeout: 60_000 });
  expect(await figures()).toEqual(first);
});

test('only training and validation circuits are offered: no held-out circuit', async ({ page }) => {
  await open(page);
  await page.locator('#ev-model').selectOption(FIXTURE.id);
  const ids = await page.locator('#ev-circuit-list input').evaluateAll((nodes) => nodes.map((n) => (n as HTMLInputElement).dataset.circuit));
  expect(ids).toEqual(['stadium-oval', 'kidney-loop', 'rounded-rectangle', 's-sweepers']);
  await expect(page.locator('#ev-circuit-list')).toContainText('(the training circuit)');
  // the built-in lists are the same as before; a third, empty group is for the person's own saved tracks (P4-03)
  await expect(page.locator('#ev-circuit-list [role="group"]')).toHaveCount(3);
  await expect(page.locator('#ev-circuit-list')).toContainText('No saved tracks yet');
});

/** The page's clock is installed and paused before it loads, so work happens only when the test moves it: no race with completion. */
async function installPausedClock(page: Page): Promise<void> {
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(10_000);
}

test('Cancel before any work runs discards the run: nothing is stored, and nothing runs afterwards', async ({ page }) => {
  await installPausedClock(page);
  await open(page);
  await page.locator('#ev-model').selectOption(FIXTURE.id);
  await tick(page, 'kidney-loop');
  await page.locator('#ev-run').click();
  await expect(panel(page)).toHaveAttribute('data-eval-state', 'running');
  await expect(page.locator('#ev-progress')).toHaveText('Evaluating Kidney loop (1 of 1)…');
  await expect(page.locator('#ev-cancel')).toBeEnabled();
  await page.locator('#ev-cancel').click();
  await expect(panel(page)).toHaveAttribute('data-eval-state', 'idle');
  await expect(page.locator('#ev-progress')).toContainText('nothing partial was kept');
  await page.clock.runFor(60_000); // time passes: no deferred work is left to run
  await expect(panel(page)).toHaveAttribute('data-eval-entries', '0');
  await expect(page.locator('#ev-body tr')).toHaveCount(0);
});

test('Cancel in the MIDDLE of a circuit (after real work has run) stores nothing for it, and the page stays responsive between slices', async ({ page }) => {
  await installPausedClock(page);
  await open(page);
  await page.locator('#ev-model').selectOption(FIXTURE.id);
  await tick(page, 'kidney-loop');
  await page.locator('#ev-run').click();
  // Move page time one millisecond at a time until the evaluation has visibly started (an episode number and a tick count).
  let progress = '';
  for (let i = 0; i < 200 && !/episode [2-5] of 5/.test(progress); i += 1) {
    await page.clock.runFor(1);
    progress = (await page.locator('#ev-progress').textContent()) ?? '';
    if ((await panel(page).getAttribute('data-eval-state')) === 'idle') break;
  }
  expect(progress).toMatch(/Evaluating Kidney loop \(1 of 1\): episode [2-5] of 5, tick \d+…/);
  await expect(panel(page)).toHaveAttribute('data-eval-state', 'running'); // the circuit is NOT finished
  await expect(panel(page)).toHaveAttribute('data-eval-entries', '0');
  await page.locator('#ev-cancel').click();
  await expect(panel(page)).toHaveAttribute('data-eval-state', 'idle');
  await expect(page.locator('#ev-progress')).toContainText('the circuit in progress was discarded');
  await page.clock.runFor(60_000);
  await expect(panel(page)).toHaveAttribute('data-eval-entries', '0');
  // And a later run from the same state still works and stores its circuit once finished.
  await page.locator('#ev-run').click();
  for (let i = 0; i < 400 && (await panel(page).getAttribute('data-eval-state')) === 'running'; i += 1) await page.clock.runFor(1);
  await expect(panel(page)).toHaveAttribute('data-eval-entries', '1');
});

test('the keyboard alone can choose a champion, tick circuits, run, and keeps its focus', async ({ page }) => {
  await open(page);
  const focused = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute('data-circuit') ?? document.activeElement?.id ?? document.activeElement?.tagName);
  await page.locator('#ev-model').focus();
  await page.keyboard.press('ArrowDown'); // choose the first champion in the list
  await expect(panel(page)).toHaveAttribute('data-eval-selected', FIXTURE.id);
  expect(await focused()).toBe('ev-model');
  const first = page.locator('#ev-circuit-list input').first();
  await first.focus();
  const id = await first.getAttribute('data-circuit');
  await page.keyboard.press('Space');
  await expect(first).toBeChecked();
  // The focus is still on the same checkbox (it was updated in place, not replaced).
  expect(await focused()).toBe(id);
  await page.keyboard.press('Tab');
  const next = await focused();
  expect(next).not.toBe(id);
  await page.keyboard.press('Space');
  await expect(page.locator(`#ev-circuit-list input[data-circuit="${next}"]`)).toBeChecked();
  expect(await focused()).toBe(next);
  await page.keyboard.press('Space'); // toggle it off again; focus still there
  await expect(page.locator(`#ev-circuit-list input[data-circuit="${next}"]`)).not.toBeChecked();
  expect(await focused()).toBe(next);
  await page.keyboard.press('Space');
  // Tab to Run and start it with Enter; focus moves to Cancel while it runs and returns to Run when it ends.
  await page.locator('#ev-run').focus();
  await page.keyboard.press('Enter');
  await expect(panel(page)).toHaveAttribute('data-eval-state', 'idle', { timeout: 60_000 });
  expect(await focused()).toBe('ev-run');
  await expect(panel(page)).toHaveAttribute('data-eval-entries', '2');
});

test('a damaged saved entry is listed with its reason and cannot be run', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('sdae:model:broken-one', '{not json');
    window.localStorage.setItem('sdae:models:index', JSON.stringify(['champion-fixture', 'broken-one']));
  });
  await page.goto('/?mode=evaluate');
  const options = await page.locator('#ev-model option').evaluateAll((nodes) => nodes.map((n) => n.textContent));
  expect(options.some((t) => t?.includes('cannot be run'))).toBe(true);
});

test('controls are at least 44 px, the page scrolls instead of overflowing, and nothing scrolls sideways at 320 px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await open(page);
  await page.locator('#ev-model').selectOption(FIXTURE.id);
  const small = await page.locator('#evaluate-panel button, #evaluate-panel select, #evaluate-panel .ev-circuit').evaluateAll((nodes) =>
    nodes.map((n) => ({ id: n.id || n.textContent, box: n.getBoundingClientRect() })).filter((x) => x.box.width > 0 && (x.box.height < 43.5 || x.box.width < 43.5)).map((x) => x.id),
  );
  expect(small).toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('the default page, the training page and the editor do not show the evaluate panel', async ({ page }) => {
  for (const url of ['/', '/?mode=train', '/?mode=edit']) {
    await page.goto(url);
    await expect(panel(page)).toBeHidden();
  }
});
