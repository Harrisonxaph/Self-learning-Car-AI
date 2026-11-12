// P4-07: the camera is render-only. Nothing that computes a result (the simulation, sensors, inference, evolution, training or saved data)
// imports or names the camera, and the trainer's generation step and the frame loop's simulation step take no camera argument. The
// lint boundaries already forbid `render` importing those folders; this keeps the camera out of them.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../..');
const files = (dir: string): string[] =>
  readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(ROOT, path)).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
  });
const code = (path: string): string => readFileSync(join(ROOT, path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('no result-computing code names the camera', () => {
  for (const folder of ['src/sim', 'src/sensors', 'src/ai', 'src/evolution', 'src/training', 'src/persistence', 'src/utils']) {
    it(`${folder} neither imports nor mentions the camera`, () => {
      for (const path of files(folder)) {
        const text = code(path);
        expect(/render\/camera|cameraController|cameraScene|cameraPage/.test(text), `${path} imports a camera module`).toBe(false);
        expect(/\bcamera\b/i.test(text), `${path} names the camera`).toBe(false);
      }
    });
  }
  it('the frame loop and the speed control that advance the simulation take no camera', () => {
    for (const path of ['src/ui/frameLoop.ts', 'src/ui/trainingSpeed.ts', 'src/sim/fixedStep.ts']) expect(/\bcamera\b/i.test(code(path)), path).toBe(false);
  });
  it('the camera modules import nothing from simulation state beyond geometry types', () => {
    for (const path of ['src/render/camera.ts', 'src/render/cameraScene.ts']) {
      const imports = code(path).match(/from '[^']+'/g) ?? [];
      for (const i of imports) expect(/training|persistence|evolution|\/ai\/|sensors|sim\/world|sim\/vehicle|sim\/collision|sim\/checkpoints/.test(i), `${path}: ${i}`).toBe(false);
    }
  });
});
