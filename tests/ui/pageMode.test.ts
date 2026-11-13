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
    ['?mode=edit', 'edit'],
    ['?mode=%20edit%20', 'edit'],
    ['?mode=train&mode=edit', 'edit'],
    ['?mode=edit&mode=train', 'train'],
    ['?mode=Edit', 'drive'],
    ['?mode=editor', 'drive'],
    ['?mode=evaluate', 'evaluate'],
    ['?mode=%20evaluate%20', 'evaluate'],
    ['?mode=edit&mode=evaluate', 'evaluate'],
    ['?mode=evaluate&mode=train', 'train'],
    ['?mode=Evaluate', 'drive'],
    ['?mode=evaluation', 'drive'],
    ['?mode=bench', 'bench'],
    ['?mode=%20bench%20', 'bench'],
    ['?mode=Bench', 'drive'],
    ['?mode=benchmark', 'drive'],
    ['?mode=train&mode=bench', 'bench'],
    ['?mode=bench&mode=train', 'train'],
    ['?mode=race', 'race'],
    ['?mode=%20race%20', 'race'],
    ['?mode=train&mode=race', 'race'],
    ['?mode=race&mode=edit', 'edit'],
    ['?mode=Race', 'drive'],
    ['?mode=racing', 'drive'],
  ])('%s → %s', (search, mode) => {
    expect(pageMode(search)).toBe(mode);
  });
});
