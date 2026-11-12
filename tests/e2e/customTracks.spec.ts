// Saved custom tracks in a real browser (P4-03): draw a track with pointer events, save it, reload and see it, edit it, drive it,
// export and import it, refuse a bad file and a copy of a built-in study circuit (with one generic message that names nothing),
// and evaluate a saved champion on a saved custom track. Emulated browsers only: the iPad and iPhone checks of plan section 7
// are outstanding manual checks.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const read = (name: string): string => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');
const FIXTURE = JSON.parse(read('../fixtures/champion-v1.json')) as { id: string };
const HELD_OUT_FILE = JSON.parse(read('../../src/data/tracks/long-sweepers.json')) as Record<string, unknown>;
const RING = [[-60, -30], [0, -40], [60, -30], [70, 0], [60, 30], [0, 40], [-60, 30], [-70, 0]] as const;

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

async function screenOf(page: Page, wx: number, wy: number): Promise<{ x: number; y: number }> {
  const canvas = page.locator('#sim-canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  const d = await canvas.evaluate((node) => ({ ...(node as HTMLCanvasElement).dataset }));
  return { x: box.x + Number(d.editorOffsetX) + wx * Number(d.editorScale), y: box.y + Number(d.editorOffsetY) + wy * Number(d.editorScale) };
}
async function tap(page: Page, wx: number, wy: number): Promise<void> {
  const p = await screenOf(page, wx, wy);
  await page.mouse.click(p.x, p.y);
}
async function draw(page: Page): Promise<void> {
  for (const [x, y] of RING) await tap(page, x, y);
  await tap(page, RING[0][0], RING[0][1]);
  await expect(page.locator('#ed-status')).toContainText('Valid: ready to drive');
}
async function openEditor(page: Page): Promise<void> {
  await page.goto('/?mode=edit');
  await expect(page.locator('#editor-panel')).toBeVisible();
}
const savedRows = (page: Page) => page.locator('#ed-saved li');

async function saveOne(page: Page, name = 'E2E loop'): Promise<void> {
  await openEditor(page);
  await draw(page);
  await page.locator('#ed-name').fill(name);
  await page.locator('#ed-name').blur();
  await page.locator('#ed-save').click();
  await expect(page.locator('#ed-saved-status')).toContainText(`Saved "${name}" in this browser`);
  await expect(savedRows(page)).toHaveCount(1);
}

test('save a drawn track, reload and see it listed, edit it, and drive it', async ({ page }) => {
  await openEditor(page);
  await expect(page.locator('#ed-save')).toBeDisabled();
  await draw(page);
  await expect(page.locator('#ed-save')).toBeEnabled();
  await page.locator('#ed-name').fill('E2E loop');
  await page.locator('#ed-name').blur();
  await page.locator('#ed-save').click();
  await expect(page.locator('#ed-saved-status')).toContainText('Saved "E2E loop" in this browser');
  await expect(savedRows(page)).toHaveCount(1);
  await expect(savedRows(page).first()).toContainText('E2E loop');
  // reload: the track is still there
  await page.reload();
  await expect(page.locator('#editor-panel')).toBeVisible();
  await expect(savedRows(page)).toHaveCount(1);
  await expect(page.locator('#ed-status')).toContainText('Tap the canvas');
  // Edit reopens exactly what was drawn
  await page.getByRole('button', { name: 'Edit E2E loop' }).click();
  await expect(page.locator('#ed-status')).toContainText('Valid: ready to drive');
  expect(await page.locator('#sim-canvas').evaluate((n) => (n as HTMLCanvasElement).dataset.editorPoints)).toBe('8');
  await expect(page.locator('#ed-name')).toHaveValue('E2E loop');
  // Drive the saved track from the list and come back
  await page.getByRole('button', { name: 'Drive E2E loop' }).click();
  await expect(page.locator('#drive-notice')).toBeVisible();
  await expect(page.locator('#hud-laps')).toBeVisible();
  await page.locator('#ed-back').click();
  await expect(page.locator('#editor-panel')).toBeVisible();
  await expect(savedRows(page)).toHaveCount(1);
});

test('export, delete (two steps), and import the same file back; a bad file changes nothing', async ({ page }) => {
  await saveOne(page);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export E2E loop' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^custom-[0-9a-f]{8}\.json$/);
  const path = await download.path();
  const text = readFileSync(path, 'utf8');
  expect(JSON.parse(text).format).toBe('self-driving-ai-evolution/track');
  // two-step delete
  await page.getByRole('button', { name: 'Delete E2E loop' }).click();
  await expect(page.getByRole('button', { name: 'Confirm delete E2E loop' })).toBeFocused();
  await page.getByRole('button', { name: 'Keep E2E loop' }).click();
  await expect(savedRows(page)).toHaveCount(1);
  await page.getByRole('button', { name: 'Delete E2E loop' }).click();
  await page.getByRole('button', { name: 'Confirm delete E2E loop' }).click();
  await expect(savedRows(page)).toHaveCount(0);
  await expect(page.locator('#ed-saved-status')).toHaveText('Deleted.');
  // import it back, identically
  await page.locator('#ed-import').setInputFiles(path);
  await expect(page.locator('#ed-saved-status')).toContainText('Imported custom-');
  await expect(savedRows(page)).toHaveCount(1);
  const again = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Export / }).click();
  expect(readFileSync((await (await again).path())!, 'utf8')).toBe(text);
  // importing the same file again changes nothing
  await page.locator('#ed-import').setInputFiles(path);
  await expect(page.locator('#ed-saved-status')).toContainText('already saved');
  await expect(savedRows(page)).toHaveCount(1);
  // bad files are refused with a message and change nothing
  await page.locator('#ed-import').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('not json') });
  await expect(page.locator('#ed-saved-status')).toContainText('Nothing was imported');
  await page.locator('#ed-import').setInputFiles({ name: 'empty.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"self-driving-ai-evolution/track","schemaVersion":1}') });
  await expect(page.locator('#ed-saved-status')).toContainText('Nothing was imported');
  await expect(savedRows(page)).toHaveCount(1);
});

test('a copy of a built-in study circuit is refused with one generic message that names no circuit', async ({ page }) => {
  await openEditor(page);
  const copy = { ...HELD_OUT_FILE, format: 'self-driving-ai-evolution/track', schemaVersion: 1, id: 'my-copy', name: 'My copy', split: 'training' };
  await page.locator('#ed-import').setInputFiles({ name: 'copy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(copy)) });
  const status = page.locator('#ed-saved-status');
  await expect(status).toContainText('Nothing was imported');
  await expect(status).toContainText('built-in study circuit');
  const text = (await status.textContent()) ?? '';
  for (const word of ['long-sweepers', 'technical-narrow', 'held-out', 'validation', 'training']) expect(text.toLowerCase()).not.toContain(word);
  await expect(savedRows(page)).toHaveCount(0);
  const stored = await page.evaluate(() => Object.keys(window.localStorage).filter((k) => k.startsWith('sdae:track:')));
  expect(stored).toEqual([]);
});

test('evaluate a saved champion on a saved custom track, keep the result after a reload, and no held-out circuit is offered', async ({ page }) => {
  await saveOne(page, 'Eval loop');
  await page.goto('/?mode=evaluate');
  await expect(page.locator('#evaluate-panel')).toBeVisible();
  await expect(page.locator('#evaluate-panel')).toHaveAttribute('data-eval-models', '1');
  await page.locator('#ev-model').selectOption(FIXTURE.id);
  const custom = page.locator('#ev-circuit-list input[data-circuit^="custom-"]');
  await expect(custom).toHaveCount(1);
  await expect(page.locator('#ev-circuit-list')).toContainText('Eval loop');
  await custom.check();
  await page.locator('#ev-run').click();
  await expect(page.locator('#evaluate-panel')).toHaveAttribute('data-eval-state', 'idle', { timeout: 60_000 });
  await expect(page.locator('#ev-progress')).toHaveText('Done: 1 circuit evaluated and stored.');
  const row = page.locator('#ev-body tr');
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-split', 'custom');
  await expect(row).toContainText('custom layout');
  await expect(row).not.toContainText('no longer saved');
  await page.reload();
  await page.locator('#ev-model').selectOption(FIXTURE.id);
  await expect(page.locator('#ev-body tr')).toHaveCount(1);
  const ids = await page.locator('#ev-circuit-list input').evaluateAll((nodes) => nodes.map((n) => (n as HTMLInputElement).dataset.circuit));
  for (const held of ['long-sweepers', 'technical-narrow']) expect(ids).not.toContain(held);
  // deleting the track in the editor leaves the result, labelled "no longer saved"
  await openEditor(page);
  await page.getByRole('button', { name: 'Delete Eval loop' }).click();
  await page.getByRole('button', { name: 'Confirm delete Eval loop' }).click();
  await page.goto('/?mode=evaluate');
  await page.locator('#ev-model').selectOption(FIXTURE.id);
  await expect(page.locator('#ev-body tr')).toHaveCount(1);
  await expect(page.locator('#ev-body tr')).toContainText('no longer saved');
});

test('the keyboard alone saves, and focus stays on the control used; controls are 44 px; nothing scrolls sideways at 320 px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await saveOne(page, 'Key loop');
  await page.locator('#ed-save').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#ed-saved-status')).toContainText('already saved');
  await expect(page.locator('#ed-save')).toBeFocused();
  await page.getByRole('button', { name: 'Export Key loop' }).focus();
  const downloadPromise = page.waitForEvent('download');
  await page.keyboard.press('Enter');
  await downloadPromise;
  await expect(page.getByRole('button', { name: 'Export Key loop' })).toBeFocused();
  for (const locator of [page.locator('#ed-save'), page.locator('#ed-import-button'), page.getByRole('button', { name: 'Edit Key loop' }), page.getByRole('button', { name: 'Drive Key loop' }), page.getByRole('button', { name: 'Export Key loop' }), page.getByRole('button', { name: 'Delete Key loop' })]) {
    await locator.scrollIntoViewIfNeeded();
    const box = (await locator.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(43.5);
    expect(box.width).toBeGreaterThanOrEqual(43.5);
  }
  const scroll = await page.evaluate(() => ({ x: document.documentElement.scrollWidth, w: document.documentElement.clientWidth }));
  expect(scroll.x).toBeLessThanOrEqual(scroll.w);
});
