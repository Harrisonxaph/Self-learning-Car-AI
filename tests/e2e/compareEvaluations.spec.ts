// Comparing two saved champions' RECORDED evaluations on the real page (P5-05): two champion files are imported through the real JSON
// import control, each is evaluated through the real Evaluate page (no hand-made entries), then the Compare panel on `?mode=train`
// shows the shared circuit side by side, names the circuit only one was evaluated on, refuses two champions whose vehicle physics
// differ, and writes nothing. The champions are the repository's synthetic fixture (not results): they stall on the circuits, so this
// checks structure, rules and layout, not meaningful values. Emulated browsers only: the iPhone check of the 320 px stacking is an
// outstanding manual check.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

type Fixture = { id: string; name?: string; parameters: { values: number[] }; training: { configuration: { physics: Record<string, number> } } };
const BASE = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/champion-v1.json', import.meta.url)), 'utf8')) as Fixture;
/** A second champion that drives differently: the same record with its weights halved (still valid), under its own id. */
const SECOND: Fixture = { ...BASE, id: 'fixture-v2', name: 'Second fixture (not a result)', parameters: { ...BASE.parameters, values: BASE.parameters.values.map((v) => v / 2) } };
/** A champion made under different vehicle physics (a longer wheelbase, which the maximum-speed consistency rule does not involve). */
const LONG: Fixture = {
  ...BASE,
  id: 'fixture-long',
  name: 'Long wheelbase fixture (not a result)',
  training: { ...BASE.training, configuration: { ...BASE.training.configuration, physics: { ...BASE.training.configuration.physics, wheelbase: 2.9 } } },
};

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

/** Imports each champion through the real import control and returns the saved ids, in import order. */
async function importChampions(page: Page, fixtures: readonly Fixture[]): Promise<string[]> {
  await page.goto('/?mode=train');
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-mode', 'train');
  // The saved-champion panels appear once training has a champion to replay (generation 0 takes a few seconds of real time).
  await expect(page.locator('#champion-replay')).toBeVisible({ timeout: 90_000 });
  await page.locator('#champion-replay > summary').click();
  let count = 0;
  for (const f of fixtures) {
    await page.locator('#saved-import').setInputFiles({ name: `${f.id}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(f)) });
    count += 1;
    await expect(page.locator('#saved-list li')).toHaveCount(count);
  }
  return page.evaluate(() => JSON.parse(window.localStorage.getItem('sdae:models:index') ?? '[]') as string[]);
}

async function evaluate(page: Page, id: string, circuits: readonly string[]): Promise<void> {
  await page.goto('/?mode=evaluate');
  await expect(page.locator('#evaluate-panel')).toBeVisible();
  await page.locator('#ev-model').selectOption(id);
  for (const c of circuits) await page.locator(`#ev-circuit-list input[data-circuit="${c}"]`).check();
  await page.locator('#ev-run').click();
  await expect(page.locator('#evaluate-panel')).toHaveAttribute('data-eval-state', 'idle', { timeout: 90_000 });
  await expect(page.locator('#ev-progress')).toContainText('evaluated and stored');
}

async function openCompare(page: Page, a: string, b: string): Promise<void> {
  await page.goto('/?mode=train');
  await expect(page.locator('#champion-replay')).toBeVisible({ timeout: 90_000 });
  await page.locator('#champion-replay > summary').click();
  await expect(page.locator('#compare-a')).toBeVisible();
  await page.locator('#compare-a').selectOption(a);
  await page.locator('#compare-b').selectOption(b);
}

const storedModels = (page: Page) => page.evaluate(() => JSON.stringify(Object.entries(window.localStorage).filter(([k]) => k.startsWith('sdae:model')).sort()));

for (const width of [null, 320] as const) {
  test(`two imported, evaluated champions are compared on their shared circuit; the circuit only one was evaluated on is named; nothing is written${width === null ? '' : ` (at ${width} px wide)`}`, async ({ page }) => {
    if (width !== null) await page.setViewportSize({ width, height: 700 });
    const [idA, idB] = await importChampions(page, [BASE, SECOND]);
    expect([idA, idB]).toEqual([BASE.id, SECOND.id]);
    await evaluate(page, idA!, ['kidney-loop', 's-sweepers']);
    await evaluate(page, idB!, ['kidney-loop']);
    await openCompare(page, idA!, idB!);
    const before = await storedModels(page);
    await page.locator('#compare-run').click();
    const block = page.locator('#compare-evaluations');
    await expect(block).toContainText('Recorded evaluations on shared circuits');
    await expect(page.locator('#sim-canvas')).toHaveAttribute('data-compare-evaluations', 'circuits');
    const table = block.locator('table[data-circuit="kidney-loop"]');
    await expect(table).toBeVisible();
    await expect(table.locator('th[scope="col"]')).toHaveText(['Item', 'A', 'B', 'A minus B']);
    await expect(table.locator('th[scope="row"]').first()).toBeVisible();
    await expect(table.locator('caption')).toContainText('kidney-loop (training)');
    await expect(table).toContainText('unavailable (0 of 5 starts completed a lap)'); // the spread says n = 0 outright
    await expect(block).toContainText('s-sweepers was evaluated for A only');
    await expect(block.locator('table[data-circuit="s-sweepers"]')).toHaveCount(0);
    await expect(block).toContainText('Spread shows how one saved champion varies across its fixed start changes');
    // No verdict, no p-value, and the page does not scroll sideways because of the new tables.
    const shown = (await block.textContent()) ?? '';
    expect(shown).not.toMatch(/better|worse|winner|outperform|superior|significant|p-value|confidence/i);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    expect(await storedModels(page)).toBe(before);
  });
}

test('two imported champions made under different vehicle physics are refused in the evaluation block, with the reason, and nothing is compared', async ({ page }) => {
  const [idA, idB] = await importChampions(page, [BASE, LONG]);
  expect([idA, idB]).toEqual([BASE.id, LONG.id]);
  await evaluate(page, idA!, ['kidney-loop']);
  await evaluate(page, idB!, ['kidney-loop']);
  await openCompare(page, idA!, idB!);
  const before = await storedModels(page);
  await page.locator('#compare-run').click();
  const block = page.locator('#compare-evaluations');
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-compare-evaluations', 'refused');
  await expect(block).toContainText('Recorded evaluations on shared circuits');
  await expect(block).toContainText('vehicle physics differ: wheelbase');
  await expect(block.locator('table')).toHaveCount(0);
  // The P3-08 table is unaffected, and the evaluation comparison writes nothing.
  await expect(page.locator('#compare-result .compare-table').first()).toBeVisible();
  expect(await storedModels(page)).toBe(before);
});
