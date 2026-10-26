import { describe, expect, it } from 'vitest';
import { pageMode } from '../../src/ui/pageMode';

describe('pageMode', () => {
  it.each([
    ['', 'drive'],
    ['?debug=rays', 'drive'],
    ['?mode=train', 'train'],
    ['?debug=rays&mode=train', 'train'],
    ['?mode=%20train%20', 'train'],
    ['?mode=drive&mode=train', 'train'],
    ['?mode=train&mode=drive', 'drive'],
    ['?mode=Train', 'drive'],
    ['?mode=training', 'drive'],
    ['?train', 'drive'],
  ])('%s → %s', (search, mode) => {
    expect(pageMode(search)).toBe(mode);
  });
});
