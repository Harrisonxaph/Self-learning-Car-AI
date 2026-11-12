// P5-03 boundaries: the race stays out of the held-out circuits and nothing in the simulation, the trainer, the model format or the studies
// can depend on it (docs/plans/p5-03-plan.md sections 3 and 6). A source scan, as for P4-05: narrow, over the race code and its wiring.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tracksIn } from '../../src/training/trackSplits';

const ROOT = join(__dirname, '../..');
const HELD_OUT = tracksIn('held-out').map((t) => t.id);
const code = (path: string): string => readFileSync(join(ROOT, path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const RACE_CODE = ['src/training/race.ts', 'src/ui/raceController.ts', 'src/ui/racePage.ts'];

const sources = (dir: string): string[] =>
  readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = `${dir}/${name}`;
    return statSync(join(ROOT, path)).isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : [];
  });

describe('the race never reaches the held-out circuits', () => {
  it.each(RACE_CODE)('%s names no held-out circuit and imports neither the held-out accessor nor the study gate', (path) => {
    const text = code(path);
    for (const id of HELD_OUT) expect(text.includes(id), `${path} names ${id}`).toBe(false);
    expect(/\bheldOutTrack\b/.test(text)).toBe(false);
    expect(/heldOutAccess/.test(text)).toBe(false);
    expect(/tracksIn\(\s*['"]held-out['"]/.test(text)).toBe(false);
  });
  it('the race wiring in main.ts lists training and validation circuits only', () => {
    const text = code('src/main.ts');
    const from = text.indexOf('function startRacing');
    const wiring = text.slice(from, text.indexOf('\n}\n', from));
    expect(wiring.length).toBeGreaterThan(200);
    expect(wiring).toContain("tracksIn('training')");
    expect(wiring).toContain("tracksIn('validation')");
    expect(/held-out|heldOut/.test(wiring)).toBe(false);
  });
  it('the controller resolves every circuit through resolveCircuit', () => {
    const text = code('src/ui/raceController.ts');
    expect(text).toContain('resolveCircuit(');
    expect(/BUILT_IN_TRACK_SPLITS\.tracks\.find/.test(text)).toBe(false);
  });
});

describe('nothing in the simulation, the trainer, the model format or the studies imports the race', () => {
  const importers = ['src/sim', 'src/ai', 'src/evolution', 'src/persistence', 'src/sensors', 'src/render', 'src/training']
    .flatMap(sources)
    .filter((path) => !RACE_CODE.includes(path))
    .filter((path) => /from\s+['"][^'"]*\/(race|raceController|racePage)['"]/.test(code(path)));
  it('has no importer outside the race and its page', () => {
    expect(importers).toEqual([]);
  });
  it('race.ts imports the simulation, drivers and the shared episode path only: no trainer, evolution, persistence, render or ui', () => {
    const imports = [...code('src/training/race.ts').matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!);
    for (const spec of imports) expect(/trainer|evolution|persistence|render|\/ui\//.test(spec), spec).toBe(false);
  });
  it('race.ts reads no clock, draws no random numbers and touches no storage or DOM', () => {
    const text = code('src/training/race.ts');
    expect(/Math\.random|Date\.now|performance\.now|localStorage|document\.|window\./.test(text)).toBe(false);
  });
});
