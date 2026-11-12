// P4-05: held-out stays out of the browser evaluation (decided with the owner, plan sections 3 and 6). Narrow: the scan covers the
// production access boundary (the evaluation module, the controller, the page and the evaluate wiring in main.ts) and the tests that
// RUN evaluations. Refusal tests (tests/ui/modelEvaluation.test.ts) may name held-out IDs to prove the refusal, and the existing
// split-enforcement and study-gate tests are untouched.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tracksIn } from '../../src/training/trackSplits';

const ROOT = join(__dirname, '../..');
const HELD_OUT = tracksIn('held-out').map((t) => t.id);
const code = (path: string): string => readFileSync(join(ROOT, path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const BOUNDARY = [
  'src/ui/modelEvaluation.ts',
  'src/ui/evaluateController.ts',
  'src/ui/evaluatePage.ts',
  'src/persistence/evaluationEntry.ts',
  // P4-03: the saved-track code reaches the split boundary only through classifyCustomTrack (training/trackSplits.ts)
  'src/persistence/trackStore.ts',
  'src/ui/trackLibrary.ts',
  'src/ui/editorPage.ts',
];
/** The evaluate wiring in main.ts only: from startEvaluating to the next top-level function. */
const evaluateWiring = (): string => {
  const text = code('src/main.ts');
  const from = text.indexOf('function startEvaluating');
  return text.slice(from, text.indexOf('\n}\n', from));
};

describe('the production access boundary of the evaluation', () => {
  it.each(BOUNDARY)('%s names no held-out circuit and imports neither the held-out accessor nor the study gate\'s setup builder', (path) => {
    const text = code(path);
    for (const id of HELD_OUT) expect(text.includes(id), `${path} names ${id}`).toBe(false);
    expect(/\bheldOutTrack\b/.test(text)).toBe(false);
    expect(/\bbuildEvaluationSetup\b/.test(text)).toBe(false);
    expect(/heldOutAccess/.test(text)).toBe(false);
    expect(/tracksIn\(\s*['"]held-out['"]/.test(text)).toBe(false);
  });
  it('the evaluate wiring in main.ts lists training and validation circuits only', () => {
    const wiring = evaluateWiring();
    expect(wiring.length).toBeGreaterThan(200);
    expect(wiring).toContain("tracksIn('training')");
    expect(wiring).toContain("tracksIn('validation')");
    expect(/held-out|heldOut/.test(wiring)).toBe(false);
    for (const id of HELD_OUT) expect(wiring.includes(id)).toBe(false);
  });
  it('the evaluation module resolves circuits only through trainingTrack and validationTrack', () => {
    const text = code('src/ui/modelEvaluation.ts');
    expect(text).toContain('trainingTrack(');
    expect(text).toContain('validationTrack(');
    expect(/BUILT_IN_TRACK_SPLITS\.tracks\.find/.test(text)).toBe(false);
  });
});

describe('tests that run evaluations use training and validation circuits only', () => {
  const RUNNING = ['tests/ui/evaluateController.test.ts', 'tests/persistence/appendEvaluation.test.ts', 'tests/persistence/evaluationEntry.test.ts', 'tests/e2e/evaluate.spec.ts'];
  it.each(RUNNING)('%s never names a held-out circuit', (path) => {
    let text: string;
    try {
      text = code(path);
    } catch {
      return; // the E2E file is added in the same change; a missing file is not a held-out reference
    }
    // evaluateController.test.ts names them only through tracksIn('held-out') to prove they are NOT offered.
    const allowed = path.endsWith('evaluateController.test.ts') ? text.replace(/tracksIn\('held-out'\)/g, '') : text;
    for (const id of HELD_OUT) expect(allowed.includes(id), `${path} names ${id}`).toBe(false);
  });
});
