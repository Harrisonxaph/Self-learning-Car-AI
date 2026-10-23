// Proves the architecture rules in eslint.config.js actually fire, by linting small
// snippets as if they lived in each source folder. The files do not need to exist.
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint();

async function ruleIdsFor(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((message) => message.ruleId ?? 'parse-error');
}

describe('architecture import boundaries', () => {
  it.each([
    ['src/sim/vehicle.ts', "import { drawPlaceholder } from '../render/placeholder';"],
    ['src/sim/world.ts', "import { trainer } from '../training/trainer';"],
    ['src/sim/fixedStep.ts', "import { startFrameLoop } from '../ui/frameLoop';"],
    ['src/ai/network.ts', "import { mutate } from '../evolution/mutation';"],
    ['src/sensors/rays.ts', "import { network } from '../ai/network';"],
    ['src/training/trainer.ts', "import { panel } from '../ui/dashboard/panel';"],
    ['src/utils/math.ts', "import { config } from '../sim/config';"],
    ['src/render/renderer.ts', "import { controls } from '../ui/controls/touch';"],
  ])('rejects the forbidden import in %s', async (filePath, code) => {
    expect(await ruleIdsFor(filePath, `${code}\nexport { };\n`)).toContain('no-restricted-imports');
  });

  it.each([
    ['src/sensors/rays.ts', "import { config } from '../sim/config';"],
    ['src/ai/inputs.ts', "import { castRays } from '../sensors/rays';"],
    ['src/training/trainer.ts', "import { mutate } from '../evolution/mutation';"],
    ['src/render/renderer.ts', "import { world } from '../sim/world';"],
    ['src/main.ts', "import { createViewport } from './render/viewport';"],
    ['src/ui/frameLoop.ts', "import type { FixedStepClock } from '../sim/fixedStep';"],
  ])('allows the permitted import in %s', async (filePath, code) => {
    expect(await ruleIdsFor(filePath, `${code}\nexport { };\n`)).not.toContain('no-restricted-imports');
  });
});

describe('headless determinism rules', () => {
  it.each([
    ['Math.random', 'export const r = Math.random();', 'no-restricted-properties'],
    ['Date.now', 'export const t = Date.now();', 'no-restricted-globals'],
    ['document', "export const el = document.querySelector('canvas');", 'no-restricted-globals'],
    ['performance', 'export const t = performance.now();', 'no-restricted-globals'],
    ['requestAnimationFrame', 'export const h = requestAnimationFrame(() => {});', 'no-restricted-globals'],
    ['window', 'export const w = window.innerWidth;', 'no-restricted-globals'],
  ])('rejects %s in simulation code', async (_name, code, rule) => {
    expect(await ruleIdsFor('src/sim/world.ts', code)).toContain(rule);
  });

  it('still allows DOM access in rendering code', async () => {
    const rules = await ruleIdsFor('src/render/renderer.ts', "export const el = document.querySelector('canvas');");
    expect(rules).toEqual([]);
  });
});
