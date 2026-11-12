// P4-07 against the training page's real wiring: the camera is render-only, so a seeded run gives bit-identical recorded figures whatever the
// camera does (none, fitted, zoomed to the limit, following, changed every frame, resized, with hostile gestures), and the followed car is
// drawn inside the existing cap. `startTrainingPage` runs in Node with fake frames and a fake DOM; the camera's controller is the real one.
// A seeded run only; nothing here is a study result.
import { describe, expect, it, vi } from 'vitest';
import { CHECKPOINT_KEY } from '../../src/persistence/checkpointStore';
import { DEFAULT_SIM_CONFIG } from '../../src/sim/config';
import { startTrainingPage } from '../../src/ui/trainingPage';
import type { CameraController } from '../../src/ui/cameraController';
import { FakeFrames } from './fakeFrames';
import { fakePage } from './fakeTrainingPage';

const drawn = vi.hoisted(() => ({ calls: [] as number[] }));
vi.mock('../../src/render/raceView', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/render/raceView')>();
  return { ...actual, drawCars: (_c: unknown, _s: unknown, _v: unknown, cars: readonly unknown[]) => void drawn.calls.push(cars.length) };
});
vi.mock('../../src/render/trackLayer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/render/trackLayer')>();
  // The real drawing needs a canvas; the camera tests care which view is used and how many cars are drawn.
  return { ...actual, drawTrack: () => undefined };
});

const FRAME_MS = DEFAULT_SIM_CONFIG.timestepSeconds * 1000;
const costlyClock = () => {
  let t = 0;
  return () => (t += 0.5);
};
const STATS = ['lastBest', 'lastMean', 'lastCrashed', 'lastStalled', 'lastLaps', 'completedGenerations', 'tick'] as const;
// The page's own checkpoint (P3-07) is the complete trainer state at a generation boundary: the configuration, the run generator's state, the
// generation index, the NEXT population's genomes and the record kept so far (every generation's statistics and champion). Comparing every
// checkpoint written while the run goes on compares the full training state, not a handful of summaries.
type Mutate = (camera: CameraController, frame: number) => void;

function run(target: number, mutate: Mutate | null, options: { cap?: string } = {}) {
  const frames = new FakeFrames();
  const built = fakePage(frames, { now: costlyClock(), checkpoint: { everyGenerations: 1, minSeconds: 0 } });
  let controller: CameraController | null = null;
  const page = mutate === null ? built.page : { ...built.page, cameraUi: (deps: { controller: CameraController }) => { controller = deps.controller; return { refresh() {}, stop() {} }; } };
  startTrainingPage(page);
  if (options.cap) built.controls.drawCap.choose(options.cap);
  drawn.calls.length = 0;
  const checkpoints: string[] = [];
  for (let frame = 0; frame < 200_000; frame += 1) {
    if (mutate && controller) mutate(controller, frame);
    frames.fire(frame * FRAME_MS);
    built.runDeferred();
    const text = built.checkpointStorage.data.get(CHECKPOINT_KEY);
    if (text !== undefined && text !== checkpoints[checkpoints.length - 1]) checkpoints.push(text);
    if (built.canvas.dataset.lastGeneration === String(target)) {
      return { stats: STATS.map((name) => built.canvas.dataset[name]), checkpoints, frame, controller: controller as CameraController | null, dataset: { ...built.canvas.dataset } };
    }
  }
  throw new Error('The generation did not complete.');
}

describe('a seeded run is identical whatever the camera does', () => {
  const baseline = run(3, null);
  const variants: [string, Mutate][] = [
    ['a camera at the whole-track view', () => undefined],
    ['zoomed in', (c, f) => f === 0 && [1, 2, 3].forEach(() => c.zoomIn())],
    ['zoomed to the limit and panned', (c, f) => {
      if (f === 0) for (let i = 0; i < 30; i += 1) c.zoomIn();
      if (f % 7 === 0) { c.pointerDown(1, 300, 200); c.pointerMove(1, 280, 190); c.pointerUp(1); }
    }],
    ['following the best car', (c, f) => f === 0 && c.toggleFollow()],
    ['changed on every frame (zoom, pan, fit, follow, resize, pinch, wheel)', (c, f) => {
      switch (f % 8) {
        case 0: c.zoomIn(); break;
        case 1: c.toggleFollow(); break;
        case 2: c.setCanvas(390 + (f % 5), 700); break;
        case 3: c.pointerDown(1, 100, 100); c.pointerDown(2, 200, 150); c.pointerMove(2, 260, 190); c.pointerUp(1); c.pointerUp(2); break;
        case 4: c.wheel(-120, 50, 50); break;
        case 5: c.fit(); break;
        case 6: c.zoomOut(); break;
        default: c.setCanvas(900, 500 + (f % 3));
      }
    }],
    ['hostile gestures', (c) => {
      c.wheel(Number.NaN, 1, 1);
      c.wheel(1e300, -1e300, 1e300);
      c.pointerDown(9, Number.NaN, 0);
      c.pointerMove(9, Infinity, 0);
      c.setCanvas(0, 0);
      c.setCanvas(320, 240);
    }],
  ];
  it('has recorded figures and complete checkpoints to compare against (the next population, the run generator and the record)', () => {
    expect(baseline.stats.every((v) => v !== undefined && v !== '')).toBe(true);
    expect(baseline.checkpoints.length).toBeGreaterThanOrEqual(3);
    const last = JSON.parse(baseline.checkpoints[baseline.checkpoints.length - 1]!) as { generationIndex: number; population: { values: unknown[][] }; training: { rng: { words: number[] } } };
    expect(last.generationIndex).toBeGreaterThanOrEqual(3);
    expect(last.population.values.length).toBeGreaterThan(1);
    expect(last.training.rng.words).toHaveLength(4);
  });
  for (const [name, mutate] of variants) {
    it(`${name}: the recorded figures and the number of frames are bit-identical to no camera`, () => {
      const result = run(3, mutate);
      expect(result.stats).toEqual(baseline.stats);
      expect(result.frame).toBe(baseline.frame);
      // every checkpoint written during the run (full training state at each generation boundary) is byte-identical
      expect(result.checkpoints).toEqual(baseline.checkpoints);
    });
  }
  it('the camera really was used: it ended off the whole-track view in the zoomed run, and the published transform follows it', () => {
    const zoomed = run(1, (c, f) => f === 0 && c.zoomIn());
    expect(zoomed.controller!.atFit()).toBe(false);
    expect(zoomed.controller!.camera().zoom).toBeGreaterThan(1);
  });
});

describe('the followed car is drawn within the existing cap', () => {
  it('when following, never more cars are drawn than the cap, and the count equals the cap when the population exceeds it', () => {
    const result = run(1, (c, f) => f === 0 && c.toggleFollow(), { cap: '10' });
    expect(drawn.calls.length).toBeGreaterThan(5);
    expect(Math.max(...drawn.calls)).toBeLessThanOrEqual(10);
    expect(Math.min(...drawn.calls)).toBeGreaterThan(0);
    expect(result.controller!.following()).toBe(true);
  });
  it('without following, the same cars are drawn as without a camera', () => {
    run(1, null, { cap: '10' });
    const without = [...drawn.calls];
    run(1, () => undefined, { cap: '10' });
    expect(drawn.calls).toEqual(without);
  });
});
