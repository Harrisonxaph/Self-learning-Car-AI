// Import JSON on the page's real wiring (P3-06): a fake file chooser, fake storage and fake nodes in Node. The claims: a
// valid file is listed and replayable; a refused file leaves the list, the storage and an active replay untouched; the
// file's size is checked before it is read; the same file twice adds nothing; training is unaffected.
import { describe, expect, it } from 'vitest';
import { FAIL_MARKER, installFailingStringify } from '../helpers/failingStringify';
import { MAX_MODEL_BYTES } from '../../src/persistence/modelFormat';
import { startTrainingPage } from '../../src/ui/trainingPage';
import { FakeFrames } from './fakeFrames';
import { fakePage } from './fakeTrainingPage';
import { readFileSync } from 'node:fs';

const fixture = readFileSync(new URL('../fixtures/champion-v1.json', import.meta.url), 'utf8');
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup() {
  const frames = new FakeFrames();
  const made = fakePage(frames, { now: () => 0 });
  startTrainingPage(made.page);
  const reads: string[] = [];
  const file = (name: string, text: string, size = text.length) => ({ name, size, text: () => { reads.push(name); return Promise.resolve(text); } });
  const choose = async (...files: ReturnType<typeof file>[]) => {
    made.saved.importInput.files = files;
    made.saved.importInput.fire('change');
    await flush();
  };
  return { ...made, reads, file, choose, frames };
}

describe('Import JSON', () => {
  it('imports a valid file: it is listed, said so, and the chooser is reset', async () => {
    const p = setup();
    await p.choose(p.file('c.json', fixture));
    expect(p.saved.status.textContent).toBe('Imported "Synthetic test fixture (not a result)" (generation 1).');
    expect(p.saved.list.children).toHaveLength(1);
    expect(p.saved.importInput.value).toBe('');
    expect([...p.savedStorage.data.keys()].sort()).toEqual(['sdae:model:fixture-v1', 'sdae:models:index']);
  });

  it('importing the same file twice says already saved and adds nothing', async () => {
    const p = setup();
    await p.choose(p.file('c.json', fixture));
    const snapshot = new Map(p.savedStorage.data);
    await p.choose(p.file('c.json', fixture));
    expect(p.saved.status.textContent).toContain('already saved');
    expect(p.saved.list.children).toHaveLength(1);
    expect(p.savedStorage.data).toEqual(snapshot);
  });

  it('a different champion with a taken id becomes a copy and never overwrites', async () => {
    const p = setup();
    await p.choose(p.file('c.json', fixture));
    const original = p.savedStorage.data.get('sdae:model:fixture-v1');
    const changed = JSON.stringify({ ...JSON.parse(fixture), name: 'Changed' });
    await p.choose(p.file('d.json', changed));
    expect(p.saved.status.textContent).toContain('as a new copy');
    expect(p.saved.list.children).toHaveLength(2);
    expect(p.savedStorage.data.get('sdae:model:fixture-v1')).toBe(original);
  });

  for (const [label, body] of [['not JSON', 'hello'], ['empty', ''], ['wrong format', '{"format":"x"}'], ['newer schema', JSON.stringify({ ...JSON.parse(fixture), schemaVersion: 2 })]] as const) {
    it(`refuses ${label} with a message and changes nothing`, async () => {
      const p = setup();
      await p.choose(p.file('c.json', fixture));
      const snapshot = new Map(p.savedStorage.data);
      await p.choose(p.file('bad.json', body));
      expect(p.saved.status.textContent).toMatch(/^Nothing was imported\./);
      expect(p.savedStorage.data).toEqual(snapshot);
      expect(p.saved.list.children).toHaveLength(1);
    });
  }

  it('checks the size before reading: an oversized file is never read', async () => {
    const p = setup();
    await p.choose(p.file('big.json', 'x', MAX_MODEL_BYTES + 1));
    expect(p.reads).toEqual([]);
    expect(p.saved.status.textContent).toContain('1 MiB');
    expect(p.savedStorage.data.size).toBe(0);
  });

  it('one file at a time: several are refused unread', async () => {
    const p = setup();
    await p.choose(p.file('a.json', fixture), p.file('b.json', fixture));
    expect(p.reads).toEqual([]);
    expect(p.saved.status.textContent).toBe('Nothing was imported. Choose one file at a time.');
  });

  it('a file that cannot be read, a cancelled chooser and a full store are messages, not exceptions', async () => {
    const p = setup();
    await p.choose({ name: 'x', size: 1, text: () => Promise.reject(new Error('io')) });
    expect(p.saved.status.textContent).toBe('Nothing was imported. The file could not be read.');
    p.saved.status.textContent = 'before';
    await p.choose();
    expect(p.saved.status.textContent).toBe('before');
    for (let i = 0; i < 20; i += 1) await p.choose(p.file('c.json', JSON.stringify({ ...JSON.parse(fixture), id: `m-${i}` })));
    await p.choose(p.file('c.json', JSON.stringify({ ...JSON.parse(fixture), id: 'one-too-many' })));
    expect(p.saved.status.textContent).toMatch(/^Nothing was imported\. You have 20 saved champions/);
    expect(p.saved.list.children).toHaveLength(20);
  });

  it('a hostile file name is never shown or used as a key', async () => {
    const p = setup();
    await p.choose(p.file('<img src=x onerror=1>../../evil', fixture));
    expect(JSON.stringify([...p.savedStorage.data.keys()])).not.toContain('evil');
    expect(p.saved.status.textContent).not.toContain('evil');
  });

  it('an imported champion can be replayed, and a refused file leaves that replay running', async () => {
    const p = setup();
    await p.choose(p.file('c.json', fixture));
    const row = p.saved.list.children[0]!;
    row.find((n) => n.tag === 'button' && n.textContent === 'Replay')[0]!.click();
    p.frames.fire(0);
    p.frames.fire(16);
    const source = p.canvas.dataset.replaySource;
    expect(source).toBe('saved');
    await p.choose(p.file('bad.json', 'nope'));
    p.frames.fire(32);
    expect(p.canvas.dataset.replaySource).toBe('saved');
  });

  it('a valid file that cannot be written out is refused with a message; the list, storage and an active replay are untouched', async () => {
    const p = setup();
    await p.choose(p.file('c.json', fixture));
    p.saved.list.children[0]!.find((n) => n.tag === 'button' && n.textContent === 'Replay')[0]!.click();
    p.frames.fire(0);
    p.frames.fire(16);
    const snapshot = new Map(p.savedStorage.data);
    const base = JSON.parse(fixture) as Record<string, unknown>;
    const body = JSON.stringify({ ...base, id: 'unwritable-1', [FAIL_MARKER]: true });
    // The serialization failure is injected, not provoked by nesting depth (which depends on the runtime's stack size).
    const restore = installFailingStringify();
    try {
      await p.choose(p.file('unwritable.json', body));
    } finally {
      restore();
    }
    expect(p.saved.status.textContent).toMatch(/^Nothing was imported\./);
    expect(p.savedStorage.data).toEqual(snapshot);
    expect(p.saved.list.children).toHaveLength(1);
    p.frames.fire(32);
    expect(p.canvas.dataset.replaySource).toBe('saved');
  });

  it('a multibyte file between 1 MiB in code units and 1 MiB in bytes is refused unread-by-parse, with the size message', async () => {
    const p = setup();
    const base = JSON.parse(fixture) as Record<string, unknown>;
    const body = JSON.stringify({ ...base, extra: '\u754c'.repeat(350_000) });
    expect(body.length).toBeLessThan(MAX_MODEL_BYTES);
    await p.choose(p.file('wide.json', body));
    expect(p.saved.status.textContent).toContain('1 MiB');
    expect(p.savedStorage.data.size).toBe(0);
  });
});
