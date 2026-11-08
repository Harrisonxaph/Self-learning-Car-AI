// P3-01 plan §6.1 check 1, against the page's real wiring: `startTrainingPage` runs here in Node with a fake frame
// source, a fake viewport and fake DOM objects, and the dashboard's aggregation functions are wrapped with counters.
// Each rendered frame must update the dashboard exactly once however many trainer ticks it ran, including across a
// generation boundary, and a frame that ran no tick still updates it once. Counting the aggregation calls (not the
// text written) means a duplicate update on one frame cannot hide behind the write-on-change suppression.
import { describe, expect, it, vi } from 'vitest';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import type { ViewportEnvironment } from '../../src/render/viewport';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { loadTrack } from '../../src/sim/track';
import { startTrainingPage, type TrainingPage } from '../../src/ui/trainingPage';
import { fakeDashboard } from './dashboardFakes';
import { FakeFrames } from './fakeFrames';

const counts = vi.hoisted(() => ({ live: 0, completed: 0 }));
vi.mock('../../src/training/generationMetrics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/training/generationMetrics')>();
  return {
    ...actual,
    liveCounts: (...args: Parameters<typeof actual.liveCounts>) => {
      counts.live += 1;
      return actual.liveCounts(...args);
    },
    completedMetrics: (...args: Parameters<typeof actual.completedMetrics>) => {
      counts.completed += 1;
      return actual.completedMetrics(...args);
    },
  };
});

/** Just enough of the page's DOM objects for `startTrainingPage` to run in Node. */
function fakePage(frames: FakeFrames) {
  const dashboard = fakeDashboard();
  const canvas = { width: 0, height: 0, dataset: {} as Record<string, string>, setAttribute() {} };
  const context = { setTransform() {}, clearRect() {} };
  const hidden = { hidden: false };
  const panel = { hidden: true };
  const status = { textContent: '' };
  const viewport: ViewportEnvironment = { measure: () => ({ width: 390, height: 600 }), devicePixelRatio: () => 1, subscribe: () => () => {} };
  const page = {
    canvas,
    context,
    status,
    hide: [hidden],
    dashboard: { panel, outputs: dashboard.outputs },
    // No track layer yet: the frame draws nothing, which leaves the per-frame dashboard path under test.
    trackLayer: { get: () => null },
    track: loadTrack(stadiumOval),
    physics: DEFAULT_VEHICLE_PHYSICS,
    config: DEFAULT_SIM_CONFIG,
    frames,
    viewportEnvironment: viewport,
  } as unknown as TrainingPage;
  return { page, canvas, dashboard, panel, hidden };
}

describe('the training page wiring (the actual page, not the test\'s own callbacks)', () => {
  it('reveals the dashboard, and updates it exactly once per rendered frame across multi-tick frames and a generation boundary', () => {
    const frames = new FakeFrames();
    const { page, canvas, dashboard, panel, hidden } = fakePage(frames);
    startTrainingPage(page);
    expect(panel.hidden).toBe(false);
    expect(hidden.hidden).toBe(true);

    counts.live = 0;
    counts.completed = 0;
    // About 4 ticks of time per frame, so each rendered frame runs several trainer ticks.
    const frameMs = 4 * DEFAULT_SIM_CONFIG.timestepSeconds * 1000;
    let rendered = 0;
    let boundaryFrame = false;
    let completedBefore = 0;
    for (let frame = 0; frame < 5000 && Number(canvas.dataset.completedGenerations ?? 0) < 2; frame += 1) {
      const ticksBefore = Number(canvas.dataset.tick ?? 0);
      frames.fire(frame * frameMs);
      rendered += 1;
      const ticksRun = Number(canvas.dataset.tick) - ticksBefore;
      if (frame > 0) expect(ticksRun, `frame ${frame}`).toBeGreaterThan(1);
      const completed = Number(canvas.dataset.completedGenerations);
      if (completed > completedBefore && ticksRun > 1) boundaryFrame = true;
      completedBefore = completed;
      // One update per rendered frame so far, whatever happened on it.
      expect(counts.live, `after frame ${frame}`).toBe(rendered);
      expect(counts.completed, `after frame ${frame}`).toBe(rendered);
    }
    expect(Number(canvas.dataset.completedGenerations)).toBeGreaterThanOrEqual(2);
    expect(Number(canvas.dataset.tick)).toBeGreaterThan(3 * rendered);
    expect(boundaryFrame).toBe(true);
    // The dashboard really shows the run: the last completed generation is 2 and the page exposes the same figures.
    expect(canvas.dataset.lastGeneration).toBe('2');
    expect(dashboard.text().lastGeneration).toBe('2');
    expect(dashboard.text().bestFitness).toBe(Number(canvas.dataset.lastBest).toFixed(2));
  });

  it('updates the dashboard once on a frame that ran no tick, and not at all while the page is hidden', () => {
    const frames = new FakeFrames();
    const { page } = fakePage(frames);
    startTrainingPage(page);
    counts.live = 0;
    // The first frame only records the time, so it runs no tick, yet it still renders.
    frames.fire(0);
    expect(counts.live).toBe(1);
    // A frame much shorter than a tick runs none either.
    frames.fire(1);
    expect(counts.live).toBe(2);
    frames.setHidden(true);
    frames.fire(2);
    frames.fire(1000);
    expect(counts.live).toBe(2);
  });
});
