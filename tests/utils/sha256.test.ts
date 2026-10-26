import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/utils/rng';
import { sha256Hex } from '../../src/utils/sha256';

const node = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

describe('sha256Hex', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
  ])('matches the FIPS 180-4 example for %j', (text, digest) => {
    expect(sha256Hex(text)).toBe(digest);
  });

  it('matches node:crypto across the padding boundaries and for multi-byte UTF-8', () => {
    for (let n = 0; n <= 130; n += 1) expect(sha256Hex('a'.repeat(n))).toBe(node('a'.repeat(n)));
    for (const text of ['é', '∑', '😀', 'naïve café — 速い', '\u0000\u0001']) expect(sha256Hex(text)).toBe(node(text));
  });

  it('matches node:crypto for 200 seeded random strings up to 2000 characters', () => {
    const rng = createRng(20261026);
    for (let i = 0; i < 200; i += 1) {
      const length = rng.int(0, 2000);
      const text = Array.from({ length }, () => String.fromCodePoint(rng.int(32, 0x2fff))).join('');
      expect(sha256Hex(text)).toBe(node(text));
    }
  });
});
