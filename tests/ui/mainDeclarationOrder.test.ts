// main.ts dispatches to a page at module level and the pages' helper functions are hoisted, but a top-level `let`, `const` or `var`
// declared AFTER the dispatch is in its temporal dead zone when a page reads it during start-up. A bundled production build hides
// that, so the failure only shows in the unbundled Vite dev server (the P4-03 review). This keeps every module-level binding above
// the dispatch; the dev server itself was opened in a browser for every page mode when this was fixed.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(__dirname, '../../src/main.ts'), 'utf8').split('\n');

describe('main.ts start-up order', () => {
  it('declares no top-level let, const or var after the page dispatch begins', () => {
    const dispatch = source.findIndex((line) => line.startsWith('if (pageMode(window.location.search)'));
    expect(dispatch).toBeGreaterThan(0);
    const late = source.map((line, i) => ({ line, i })).filter(({ line, i }) => i > dispatch && /^(let|const|var)\s/.test(line));
    expect(late.map((l) => l.line)).toEqual([]);
  });
  it('declares the saved-tracks library binding before the dispatch', () => {
    const dispatch = source.findIndex((line) => line.startsWith('if (pageMode(window.location.search)'));
    const declared = source.findIndex((line) => /^let trackLibrary\b/.test(line));
    expect(declared).toBeGreaterThan(0);
    expect(declared).toBeLessThan(dispatch);
  });
});
