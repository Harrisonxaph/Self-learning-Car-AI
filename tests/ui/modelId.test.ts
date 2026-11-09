import { describe, expect, it } from 'vitest';
import { MODEL_ID_PATTERN } from '../../src/persistence/modelFormat';
import { formatUuid, newModelId } from '../../src/ui/modelId';
import { createRng } from '../../src/utils/rng';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newModelId', () => {
  it('uses the browser UUID when there is one', () => {
    expect(newModelId({ crypto: { randomUUID: () => 'fixed-uuid' } })).toBe('fixed-uuid');
  });
  it('falls back to random bytes when randomUUID throws or is missing (an insecure page)', () => {
    const bytes = (array: Uint8Array) => array.forEach((_, i) => (array[i] = i * 7));
    const thrown = newModelId({ crypto: { randomUUID: () => { throw new Error('insecure'); }, getRandomValues: (a) => bytes(a) } });
    const missing = newModelId({ crypto: { getRandomValues: (a) => bytes(a) } });
    expect(thrown).toMatch(UUID);
    expect(thrown).toBe(missing);
  });
  it('falls back to the clock and Math.random when there is no crypto at all', () => {
    const id = newModelId({ crypto: {}, random: () => 0.5, now: () => 1_700_000_000_000 });
    expect(id).toMatch(UUID);
  });
  it('makes ids that are valid storage keys and differ between calls', () => {
    const a = newModelId();
    const b = newModelId();
    expect(MODEL_ID_PATTERN.test(a)).toBe(true);
    expect(a).not.toBe(b);
  });
  it('consumes nothing from the seeded generators, whichever source is used', () => {
    for (const sources of [{}, { crypto: {} }, { crypto: { getRandomValues: (a: Uint8Array) => a } }]) {
      const rng = createRng(42);
      const reference = createRng(42);
      newModelId(sources);
      newModelId(sources);
      expect(rng.nextUint32()).toBe(reference.nextUint32());
    }
  });
  it('formats the version and variant bits', () => {
    expect(formatUuid(new Uint8Array(16))).toBe('00000000-0000-4000-8000-000000000000');
    expect(formatUuid(new Uint8Array(16).fill(255))).toMatch(UUID);
  });
});
