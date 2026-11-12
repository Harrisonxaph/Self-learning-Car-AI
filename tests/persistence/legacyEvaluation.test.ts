// P4-05 compatibility: model files whose `evaluation` array is long. The fixtures in tests/fixtures/pre-p4-05 were written
// BEFORE the evaluation entry format existed (51 and 120 opaque entries from "another tool"); they import, round-trip through
// a store and export byte for byte, and no later change may reject, truncate or rewrite them. Synthetic test data, not results.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importModelText } from '../../src/persistence/modelImport';
import { createModelStore, type StorageLike } from '../../src/persistence/modelStore';
import { tracksIn } from '../../src/training/trackSplits';

class MemoryStorage implements StorageLike {
  readonly data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
}
const REGISTRY = tracksIn('training');
const fixture = (name: string) => readFileSync(new URL(`../fixtures/pre-p4-05/${name}`, import.meta.url), 'utf8');

describe.each([['champion-opaque-51.json', 51], ['champion-opaque-120.json', 120]])('%s (%i legacy entries)', (name, count) => {
  it('imports, keeps every entry untouched, and a store re-exports it byte for byte', () => {
    const text = fixture(name);
    const result = importModelText(text, { registry: REGISTRY });
    if (!result.ok) throw new Error(result.errors.join(' '));
    expect(result.model.evaluation).toHaveLength(count);
    expect(result.model.evaluation).toEqual((JSON.parse(text) as { evaluation: unknown[] }).evaluation);
    const storage = new MemoryStorage();
    const store = createModelStore({ storage: () => storage, registry: REGISTRY });
    expect(store.importModel(result.model, () => 'copy')).toMatchObject({ ok: true, status: 'added' });
    const out = store.exportFile(result.model.id);
    if (!out.ok) throw new Error(out.message);
    expect(out.text).toBe(text);
  });
});
