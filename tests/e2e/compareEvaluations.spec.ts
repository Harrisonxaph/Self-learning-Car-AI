// Comparing two saved champions' RECORDED evaluations on the real page (P5-05): two champions are put in the browser's storage, each is
// evaluated through the real Evaluate page (no hand-made entries), then the Compare panel on `?mode=train` shows the shared circuit
// side by side, names the circuit only one was evaluated on, and writes nothing. Emulated browsers only: the iPhone check of the
// 320 px stacking is an outstanding manual check.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

type Fixture = { id: string; name?: string; parameters: { values: number[] } };
const BASE = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/champion-v1.json', import.meta.url)), 'utf8')) as Fixture;
/** A second champion that drives differently: the same record with its weights halved (still valid), under its own id. */
const SECOND: Fixture = { ...BASE, id: 'fixture-v2', name: 'Second fixture (not a result)', parameters: { ...BASE.parameters, values: BASE.parameters.values.map((v) => v / 2) } };

let errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(
    ({ models }) => {
      if (window.localStorage.getItem('sdae:test-seeded') === null) {
        for (const m of models) window.localStorage.setItem(`sdae:model:${m.id}`, JSON.stringify(m));
        window.localStorage.setItem('sdae:models:index', JSON.stringify(models.map((m) => m.id)));
        window.localStorage.setItem('sdae:test-seeded', '1');
      }
    },
    { models: [BASE, SECOND] },
  );
});
test.afterEach(() => {
  expect(errors).toEqual([]);
});

async function evaluate(page: Page, id: string, circuits: readonly string[]): Promise<void> {
  await page.goto('/?mode=evaluate');
  await expect(page.locator('#evaluate-panel')).toBeVisible();
  await page.locator('#ev-model').selectOption(id);
  for (const c of circuits) await page.locator(`#ev-circuit-list input[data-circuit="${c}"]`).check();
  await page.locator('#ev-run').click();
  await expect(page.locator('#evaluate-panel')).toHaveAttribute('data-eval-state', 'idle', { timeout: 90_000 });
  await expect(page.locator('#ev-progress')).toContainText('evaluated and stored');
}

for (const width of [null, 320] as const) {
  test(`two evaluated champions are compared on their shared circuit; the circuit only one was evaluated on is named; nothing is written${width === null ? '' : ` (at ${width} px wide)`}`, async ({ page }) => {
    if (width !== null) await page.setViewportSize({ width, height: 700 });
    await evaluate(page, BASE.id, ['kidney-loop', 's-sweepers']);
    await evaluate(page, SECOND.id, ['kidney-loop']);
    await page.goto('/?mode=train');
    await expect(page.locator('#sim-canvas')).toHaveAttribute('data-mode', 'train');
    // The saved-champion panels appear once training has a champion to replay (generation 0 takes a few seconds of real time).
    await expect(page.locator('#champion-replay')).toBeVisible({ timeout: 90_000 });
    await page.locator('#champion-replay > summary').click();
    await expect(page.locator('#compare-a')).toBeVisible();
    await page.locator('#compare-a').selectOption(BASE.id);
    await page.locator('#compare-b').selectOption(SECOND.id);
    const before = await page.evaluate(() => JSON.stringify(Object.entries(window.localStorage).filter(([k]) => k.startsWith('sdae:model')).sort()));
    await page.locator('#compare-run').click();
    const block = page.locator('#compare-evaluations');
    await expect(block).toContainText('Recorded evaluations on shared circuits');
    await expect(page.locator('#sim-canvas')).toHaveAttribute('data-compare-evaluations', 'circuits');
    const table = block.locator('table[data-circuit="kidney-loop"]');
    await expect(table).toBeVisible();
    await expect(table.locator('th[scope="col"]')).toHaveText(['Item', 'A', 'B', 'A minus B']);
    await expect(table.locator('th[scope="row"]').first()).toBeVisible();
    await expect(table.locator('caption')).toContainText('kidney-loop (training)');
    await expect(block).toContainText('s-sweepers was evaluated for A only');
    await expect(block.locator('table[data-circuit="s-sweepers"]')).toHaveCount(0);
    await expect(block).toContainText('Spread shows how one saved champion varies across its fixed start changes');
    // No verdict, no p-value, and the page does not scroll sideways because of the new tables.
    const shown = (await block.textContent()) ?? '';
    expect(shown).not.toMatch(/better|worse|winner|outperform|superior|significant|p-value|confidence/i);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => JSON.stringify(Object.entries(window.localStorage).filter(([k]) => k.startsWith('sdae:model')).sort()))).toBe(before);
  });
}
