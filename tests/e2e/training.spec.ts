// The rendered training view (P2-05) on the real page: `?mode=train` runs the population trainer under the
// frame loop, draws the cars and advances generations; the default page stays manual driving. Emulated browsers
// only: real iPhone/iPad Safari behaviour of the training view is an outstanding manual device check.
import { expect, test, type Page } from '@playwright/test';

let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
});
test.afterEach(() => {
  expect(errors).toEqual([]);
});

const data = (page: Page, name: string) => page.locator('#sim-canvas').getAttribute(`data-${name}`);

test('?mode=train draws a population of 50 cars and moves on to the next generation', async ({ page }) => {
  await page.goto('/?mode=train');
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-mode', 'train');
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-cars', '50');
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-track-scale', /\d/);
  // Manual-driving controls and the lap display are hidden; the status line names the generation.
  await expect(page.locator('.controls')).toBeHidden();
  await expect(page.locator('.app-header > .hud')).toBeHidden();
  await expect(page.locator('#hud-message')).toHaveText(/^Training · generation 1 · \d+ of 50 cars running$/);
  // Generation 0 with the default seed lasts 348 ticks (about 6 s of real time at 60 ticks per second).
  await expect.poll(async () => Number(await data(page, 'completed-generations')), { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  expect(Number(await data(page, 'generation'))).toBeGreaterThanOrEqual(1);
  await expect(page.locator('#hud-message')).toHaveText(/^Training · generation [2-9]\d* · \d+ of 50 cars running$/);
});

/** One synchronous read of every dashboard value, so all of it comes from the same rendered frame. */
const snapshot = (page: Page) =>
  page.evaluate(() => {
    const text = (id: string) => document.getElementById(id)!.textContent;
    const canvas = document.getElementById('sim-canvas')!;
    return {
      generation: text('dash-generation'),
      running: Number(text('dash-running')),
      crashed: Number(text('dash-crashed')),
      stalled: Number(text('dash-stalled')),
      finished: Number(text('dash-finished')),
      lastGeneration: text('dash-last-generation'),
      best: text('dash-best'),
      mean: text('dash-mean'),
      crashRate: text('dash-crash-rate'),
      stalls: text('dash-stalls'),
      lapRate: text('dash-lap-rate'),
      note: text('dash-note'),
      data: { ...canvas.dataset },
    };
  });

/**
 * Installs Playwright's fake clock and pauses it before the page loads. `install` alone leaves the clock running, so
 * animation frames, and with them training, would keep advancing between the test's commands. Once paused, the page's
 * time moves only through `page.clock.runFor`. The pause instant is 10 seconds in, not 0: the installed clock runs in
 * real time until it is paused, so a pause at 0 throws "Cannot fast-forward to the past" whenever the host takes any
 * time to get there (seen on WebKit). Nothing has loaded yet, so moving the clock forward costs nothing.
 */
async function installPausedClock(page: Page) {
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(10_000);
}

/**
 * Moves the page's clock on in steps of `stepMs` until `done` holds. The page runs on Playwright's fake clock, which the
 * test pauses before loading the page (`installPausedClock`), so time moves only here: this advances simulated time, not
 * wall-clock time, and has no deadline that depends on how fast the runner is. It fails after `maxSteps` steps instead
 * of waiting forever.
 */
async function advanceUntil(page: Page, done: (value: Awaited<ReturnType<typeof snapshot>>) => boolean, stepMs = 1000, maxSteps = 60) {
  for (let step = 0; step < maxSteps; step += 1) {
    await page.clock.runFor(stepMs);
    const value = await snapshot(page);
    if (done(value)) return value;
  }
  throw new Error(`The condition was not reached after ${maxSteps * stepMs} ms of page time.`);
}

test('the training dashboard shows live counts that sum to the population and updates as generations finish', async ({ page }) => {
  // The page runs on a fake clock that is paused before the page loads and moves only when the test moves it, so every
  // state below is reached deterministically: the first rendered frame, the placeholders before any generation ends,
  // and each generation end.
  await installPausedClock(page);
  await page.goto('/?mode=train');
  await expect(page.locator('#training-dashboard')).toBeVisible();
  await expect(page.locator('.app-header > .hud')).toBeHidden();
  // Visibility is not readiness: the values stay "—" until a frame has rendered, which sets data-mode.
  // Advance a few frames and wait for it.
  await page.clock.runFor(100);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-mode', 'train');
  // Proof that the clock is paused: an ordinary real-time wait does not advance training.
  const tickBefore = await data(page, 'tick');
  await page.waitForTimeout(400);
  expect(await data(page, 'tick')).toBe(tickBefore);

  // None of the new outputs is a live region: the status line stays the one polite announcement channel.
  const live = await page.evaluate(() => ({
    outputs: [...document.querySelectorAll('#training-dashboard output')].map((o) => o.getAttribute('aria-live')),
    panel: document.getElementById('training-dashboard')!.getAttribute('aria-live'),
    status: document.getElementById('hud-message')!.getAttribute('aria-live'),
  }));
  expect(live.outputs).toEqual(Array(11).fill('off'));
  expect(live.panel).toBeNull();
  expect(live.status).toBe('polite');

  // About 6 ticks in: no generation has ended, so the last-completed group shows placeholders and the note.
  const first = await snapshot(page);
  expect(first.data.completedGenerations).toBe('0');
  expect(first.running + first.crashed + first.stalled + first.finished).toBe(50);
  expect(first.generation).toBe('1');
  expect([first.lastGeneration, first.best, first.mean, first.crashRate, first.stalls, first.lapRate]).toEqual(Array(6).fill('—'));
  expect(first.note).toBe('No generation completed yet');

  // Running cars fall as cars crash, and every snapshot stays a partition of the population.
  const crashing = await advanceUntil(page, (v) => v.running < 50);
  expect(crashing.running).toBeLessThan(50);
  for (let i = 0; i < 5; i += 1) {
    await page.clock.runFor(200);
    const now = await snapshot(page);
    expect(now.running + now.crashed + now.stalled + now.finished).toBe(50);
  }

  // After the first generation ends, the last-completed group equals the recorded values the page exposes.
  const done = await advanceUntil(page, (v) => v.data.lastGeneration === '1');
  expect(done.lastGeneration).toBe('1');
  expect(done.best).toBe(Number(done.data.lastBest).toFixed(2));
  expect(done.mean).toBe(Number(done.data.lastMean).toFixed(2));
  expect(done.crashRate).toBe(`${((Number(done.data.lastCrashed) / 50) * 100).toFixed(1)}% (${done.data.lastCrashed}/50)`);
  expect(done.stalls).toBe(`${((Number(done.data.lastStalled) / 50) * 100).toFixed(1)}% (${done.data.lastStalled}/50)`);
  expect(done.lapRate).toBe(`${((Number(done.data.lastLaps) / 50) * 100).toFixed(1)}% (${done.data.lastLaps}/50)`);
  expect(done.note).toBe('');

  // It moves on to the next completed generation.
  const later = await advanceUntil(page, (v) => v.data.lastGeneration === '2');
  expect(later.lastGeneration).toBe('2');
  expect(Number(later.data.lastBest)).not.toBeNaN();
});

test('the training graph draws a point for each completed generation and keeps a text summary', async ({ page }) => {
  await installPausedClock(page);
  await page.goto('/?mode=train');
  await page.clock.runFor(100);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-mode', 'train');
  // Shown in training mode, collapsed by default, with nothing to plot yet.
  await expect(page.locator('#training-graph')).toBeVisible();
  expect(await page.locator('#training-graph').evaluate((d: HTMLDetailsElement) => d.open)).toBe(false);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-chart-points', '0');
  await expect(page.locator('#graph-summary')).toHaveText('No generation completed yet, so there is nothing to plot.');
  // The canvas names its text summary for assistive technology.
  await expect(page.locator('#graph-canvas')).toHaveAttribute('aria-describedby', 'graph-summary');

  await page.locator('#training-graph > summary').click();
  expect(await page.locator('#training-graph').evaluate((d: HTMLDetailsElement) => d.open)).toBe(true);

  const inked = () =>
    page.evaluate(() => {
      const canvas = document.getElementById('graph-canvas') as HTMLCanvasElement;
      const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
      let count = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) count += 1;
      return count;
    });

  // One point after the first generation ends: a summary and a drawing appear.
  const first = await advanceUntil(page, (v) => v.data.chartPoints === '1');
  await page.clock.runFor(400);
  expect(first.data.lastGeneration).toBe('1');
  await expect(page.locator('#graph-summary')).toHaveText(/^1 completed generation is plotted\. Latest, generation 1: best fitness /);
  expect(Number(await data(page, 'chart-draws'))).toBeGreaterThanOrEqual(1);
  const afterOne = await inked();
  expect(afterOne).toBeGreaterThan(50);

  // And a second point after the second.
  const second = await advanceUntil(page, (v) => v.data.chartPoints === '2');
  await page.clock.runFor(400);
  const text = (await page.locator('#graph-summary').textContent())!;
  expect(text).toMatch(/^2 completed generations are plotted\. Latest, generation 2:/);
  expect(text).toContain(`best fitness ${Number(second.data.lastBest).toFixed(2)}`);
  expect(text).toContain(`mean fitness ${Number(second.data.lastMean).toFixed(2)}`);
  expect(await inked()).toBeGreaterThan(50);
  // The page never shows a learning claim in the summary.
  expect(text).not.toMatch(/learn|improv|better|smarter/i);
});

test('the speed controls are real buttons of at least 44 px, and pause, resume and change the speed of the run', async ({ page }) => {
  // Several stages on a fake clock, with a Max stage that runs a few thousand ticks: bounded, and explicit about it.
  test.setTimeout(60_000);
  await installPausedClock(page);
  await page.goto('/?mode=train');
  await page.clock.runFor(200);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-mode', 'train');
  await expect(page.locator('#training-controls')).toBeVisible();

  // Every control is at least 44 x 44 CSS pixels and on screen.
  const boxes = await page.locator('#training-controls button, #training-controls select').evaluateAll((els) =>
    els.map((el) => {
      const b = el.getBoundingClientRect();
      return { name: el.id || (el as HTMLElement).dataset.speed, w: b.width, h: b.height, inside: b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight };
    }),
  );
  expect(boxes).toHaveLength(5);
  for (const box of boxes) {
    expect(box.w, box.name).toBeGreaterThanOrEqual(44);
    expect(box.h, box.name).toBeGreaterThanOrEqual(44);
    expect(box.inside, box.name).toBe(true);
  }

  const tick = async () => Number(await data(page, 'tick'));
  const ticksIn = async (ms: number) => {
    const before = await tick();
    await page.clock.runFor(ms);
    return (await tick()) - before;
  };
  // At 1× about 60 ticks pass in a second of page time.
  const normal = await ticksIn(1000);
  expect(normal).toBeGreaterThanOrEqual(55);
  expect(normal).toBeLessThanOrEqual(65);

  // Pause: nothing advances, the button says Play (its name says Play / resume training) and the status line says so.
  await page.locator('#speed-pause').click();
  await expect(page.locator('#speed-pause')).toHaveText('Play');
  await expect(page.locator('#speed-pause')).toHaveAttribute('aria-label', 'Play / resume training');
  // The accessible name contains the visible label, so voice control by what is shown works.
  expect(((await page.locator('#speed-pause').getAttribute('aria-label')) ?? '').toLowerCase()).toContain('play');
  await expect(page.getByRole('button', { name: /play/i })).toHaveCount(1);
  // The status line and page data follow on the next rendered frame, and the page's clock only moves when told to.
  await page.clock.runFor(100);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-paused', 'true');
  expect(await ticksIn(5000)).toBe(0);
  await expect(page.locator('#hud-message')).toHaveText(/ · paused$/);
  // Resume: it carries on at the same pace, with no burst of catch-up ticks.
  await page.locator('#speed-pause').click();
  await expect(page.locator('#speed-pause')).toHaveText('Pause');
  await expect(page.locator('#speed-pause')).toHaveAttribute('aria-label', 'Pause training');
  await expect(page.getByRole('button', { name: /pause/i })).toHaveCount(1);
  const resumed = await ticksIn(1000);
  expect(resumed).toBeGreaterThanOrEqual(55);
  expect(resumed).toBeLessThanOrEqual(65);

  // 4× is about four times as fast.
  await page.locator('[data-speed="fast"]').click();
  await expect(page.locator('[data-speed="fast"]')).toHaveAttribute('aria-pressed', 'true');
  await page.clock.runFor(100);
  await expect(page.locator('#hud-message')).toHaveText(/ · 4×$/);
  const fast = await ticksIn(1000);
  expect(fast).toBeGreaterThanOrEqual(4 * 55);
  expect(fast).toBeLessThanOrEqual(4 * 65);

  // Max runs far more ticks per frame. The page's clock is frozen during a frame here, so the 8 ms budget cannot cut it short
  // and each frame runs the ceiling of 1,000 ticks (the budget itself is covered by the unit tests); so the workload is kept
  // to a couple of frames, then the speed goes back to 1×.
  await page.locator('[data-speed="max"]').click();
  await page.clock.runFor(20);
  await expect(page.locator('#hud-message')).toHaveText(/ · max$/);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-speed', 'max');
  expect(await ticksIn(20)).toBeGreaterThanOrEqual(500);
  await page.locator('[data-speed="normal"]').click();
  await page.clock.runFor(20);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-speed', 'normal');
});

test('the cars-drawn choice changes how many cars are drawn, defaulting lower on a phone, and never what is trained', async ({ page }, testInfo) => {
  await installPausedClock(page);
  await page.goto('/?mode=train');
  await page.clock.runFor(200);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-mode', 'train');
  const phone = /phone/.test(testInfo.project.name);
  // A phone starts with fewer cars drawn than a desktop; the population is 50 either way.
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-cars', '50');
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-drawn', phone ? '25' : '50');
  await expect(page.locator('#draw-cap')).toHaveValue(phone ? '25' : '50');

  await page.locator('#draw-cap').selectOption('10');
  await page.clock.runFor(100);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-drawn', '10');
  // At max speed no more than 10 are drawn.
  await page.locator('#draw-cap').selectOption('50');
  await page.locator('[data-speed="max"]').click();
  await page.clock.runFor(20);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-drawn', '10');
  await page.locator('[data-speed="normal"]').click();
  await page.clock.runFor(20);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-drawn', '50');
});

test('the dashboard stays inside the screen without scrolling the page, in portrait and landscape', async ({ page }, testInfo) => {
  test.skip(!/phone|tablet/.test(testInfo.project.name), 'a small-screen check');
  await page.goto('/?mode=train');
  await expect(page.locator('#training-dashboard')).toBeVisible();
  // Wait for the first rendered frame, so the measured layout holds real values, not the initial placeholders.
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-mode', 'train');
  const original = page.viewportSize()!;
  for (const size of [original, { width: original.height, height: original.width }]) {
    await page.setViewportSize(size);
    const fit = await page.evaluate(() => {
      const box = document.getElementById('training-dashboard')!.getBoundingClientRect();
      const canvas = document.getElementById('sim-canvas')!.getBoundingClientRect();
      const root = document.documentElement;
      return {
        insideWidth: box.left >= 0 && box.right <= window.innerWidth,
        insideHeight: box.top >= 0 && box.bottom <= window.innerHeight,
        noScrollX: root.scrollWidth <= root.clientWidth,
        noScrollY: root.scrollHeight <= root.clientHeight,
        canvasShare: canvas.height / window.innerHeight,
      };
    });
    expect(fit, `${size.width}x${size.height}`).toMatchObject({ insideWidth: true, insideHeight: true, noScrollX: true, noScrollY: true });
    // The track keeps a useful share of the screen (the cars stay visible).
    expect(fit.canvasShare, `${size.width}x${size.height}`).toBeGreaterThan(0.3);
  }
});

test('with the populated graph open, the track keeps its space, the page does not scroll and the graph stays reachable', async ({ page }, testInfo) => {
  test.skip(!/phone|tablet/.test(testInfo.project.name), 'a small-screen check');
  await installPausedClock(page);
  await page.goto('/?mode=train');
  await page.clock.runFor(100);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-mode', 'train');
  // Populated: one completed generation, so the dashboard, the charts and the wrapped text summary all exist.
  await advanceUntil(page, (v) => v.data.chartPoints === '1');
  await page.locator('#training-graph > summary').click();
  const original = page.viewportSize()!;
  const sizes = [original, { width: original.height, height: original.width }, { width: 568, height: 320 }, { width: 320, height: 568 }];
  for (const size of sizes) {
    await page.setViewportSize(size);
    await page.clock.runFor(400);
    // Both states of the pause button: its label changes (Pause / Play), and the row must not reflow when it does.
    for (const state of ['running', 'paused'] as const) {
      if (state === 'paused') {
        await page.locator('#speed-pause').click();
        await page.clock.runFor(100);
        await expect(page.locator('#speed-pause')).toHaveText('Play');
      }
      const fit = await page.evaluate(() => {
        const rect = (id: string) => document.getElementById(id)!.getBoundingClientRect();
        const graph = document.getElementById('training-graph')!;
        const track = rect('sim-canvas');
        const box = graph.getBoundingClientRect();
        // Scroll the graph block to its end: the text summary must then be fully inside the block.
        graph.scrollTop = graph.scrollHeight;
        const summary = rect('graph-summary');
        const after = graph.getBoundingClientRect();
        const root = document.documentElement;
        const tops = [...document.querySelectorAll('#training-controls button, #training-controls select')].map((el) => Math.round(el.getBoundingClientRect().top));
        return {
          viewport: window.innerHeight,
          trackHeight: track.height,
          graphInside: box.left >= 0 && box.right <= window.innerWidth && box.top >= 0 && box.bottom <= window.innerHeight,
          summaryReachable: summary.top >= after.top - 1 && summary.bottom <= after.bottom + 1,
          graphCanvasWide: rect('graph-canvas').width >= 150,
          noScrollX: root.scrollWidth <= root.clientWidth,
          noScrollY: root.scrollHeight <= root.clientHeight,
          // All five controls on one line (they share a top), whichever way the pause button is labelled.
          controlsOneRow: tops.length === 5 && Math.max(...tops) - Math.min(...tops) <= 2,
        };
      });
      const label = `${size.width}x${size.height} ${state}`;
      // The track is still there to watch the cars: a usable share of the screen, not a sliver.
      expect(fit.trackHeight, label).toBeGreaterThanOrEqual(Math.max(80, 0.2 * fit.viewport));
      expect(fit, label).toMatchObject({ graphInside: true, summaryReachable: true, graphCanvasWide: true, noScrollX: true, noScrollY: true, controlsOneRow: true });
      if (state === 'paused') {
        await page.locator('#speed-pause').click();
        await expect(page.locator('#speed-pause')).toHaveText('Pause');
      }
    }
  }
});

test('the controls stay on one line, inside the screen and at least 44 px, with other fonts and larger text at 320 px wide', async ({ page }, testInfo) => {
  test.skip(!/phone|tablet/.test(testInfo.project.name), 'a small-screen check');
  await installPausedClock(page);
  await page.goto('/?mode=train');
  await page.setViewportSize({ width: 320, height: 568 });
  await page.clock.runFor(200);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-mode', 'train');
  // The CI runner's fonts differ from a developer's, so check against generic families with different widths, and larger text.
  const styles = [
    '',
    'html, body, button, select { font-family: serif !important; }',
    'html, body, button, select { font-family: monospace !important; }',
    'html { font-size: 112.5% !important; }',
    'html, body, button, select { font-family: monospace !important; } html { font-size: 112.5% !important; }',
  ];
  for (const css of styles) {
    const handle = css ? await page.addStyleTag({ content: css }) : null;
    await page.clock.runFor(100);
    for (const state of ['running', 'paused']) {
      if (state === 'paused') {
        await page.locator('#speed-pause').click();
        await page.clock.runFor(100);
      }
      const fit = await page.evaluate(() => {
        const controls = [...document.querySelectorAll('#training-controls button, #training-controls select')];
        const rects = controls.map((el) => el.getBoundingClientRect());
        return {
          count: rects.length,
          oneRow: Math.max(...rects.map((r) => Math.round(r.top))) - Math.min(...rects.map((r) => Math.round(r.top))) <= 2,
          inside: rects.every((r) => r.left >= 0 && r.right <= window.innerWidth),
          big: rects.every((r) => r.width >= 44 && r.height >= 44),
          // No two controls overlap (a 1 px tolerance for rounding), and each is what a tap at its centre reaches.
          apart: rects.every((a, i) => rects.every((b, j) => i >= j || a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1)),
          hit: controls.every((el) => {
            const r = el.getBoundingClientRect();
            const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return top === el || el.contains(top);
          }),
        };
      });
      expect(fit, `${css || 'default'} ${state}`).toEqual({ count: 5, oneRow: true, inside: true, big: true, apart: true, hit: true });
      if (state === 'paused') await page.locator('#speed-pause').click();
    }
    await handle?.evaluate((el) => (el as Element).remove());
  }
});

test('the frame-rate readout is absent by default and, with ?debug=fps, reports frames and ticks separately', async ({ page }) => {
  await installPausedClock(page);
  await page.goto('/?mode=train');
  await page.clock.runFor(1000);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-mode', 'train');
  await expect(page.locator('#fps-readout')).toBeHidden();
  await expect(page.locator('#sim-canvas')).not.toHaveAttribute('data-fps-frames', /.*/);
  await page.goto('/?mode=train&debug=fps');
  await page.clock.runFor(2000);
  await expect(page.locator('#fps-readout')).toBeVisible();
  await expect(page.locator('#fps-readout')).toContainText(/Render \d+\.\d frames\/s · Simulation \d+\.\d ticks\/s · normal · \d+ cars drawn/);
  const rate = async () => ({
    frames: Number(await page.locator('#sim-canvas').getAttribute('data-fps-frames')),
    ticks: Number(await page.locator('#sim-canvas').getAttribute('data-fps-ticks')),
  });
  const normal = await rate();
  expect(normal.frames).toBeGreaterThan(30);
  expect(normal.ticks).toBeGreaterThan(30);
  await page.locator('[data-speed="fast"]').click();
  await page.clock.runFor(2000);
  const fast = await rate();
  expect(fast.ticks).toBeGreaterThan(fast.frames * 2);
  // A tap on the readout's corner reaches the controls or the track beneath it, never the readout.
  await expect(page.locator('#fps-readout')).toHaveCSS('pointer-events', 'none');
});

test('the first completed generation shows as a visible dot on the graph, not only axes and legend', async ({ page }) => {
  await installPausedClock(page);
  await page.goto('/?mode=train');
  await page.clock.runFor(100);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-mode', 'train');
  await page.locator('#training-graph > summary').click();
  await advanceUntil(page, (v) => v.data.chartPoints === '1');
  await page.clock.runFor(400);
  // Find the best-fitness colour (#7fe0bd) and group touching pixels. The legend sample is a thin line (a few pixels
  // tall) and the labels are another colour, so a blob that is as tall as it is wide is the data dot.
  const blobs = await page.evaluate(() => {
    const canvas = document.getElementById('graph-canvas') as HTMLCanvasElement;
    const { width, height } = canvas;
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, width, height);
    const near = (i: number) => data[i + 3]! > 200 && Math.abs(data[i]! - 0x7f) < 24 && Math.abs(data[i + 1]! - 0xe0) < 24 && Math.abs(data[i + 2]! - 0xbd) < 24;
    const seen = new Uint8Array(width * height);
    const found: { w: number; h: number; n: number }[] = [];
    for (let start = 0; start < width * height; start += 1) {
      if (seen[start] || !near(start * 4)) continue;
      const stack = [start];
      seen[start] = 1;
      let minX = width, maxX = 0, minY = height, maxY = 0, n = 0;
      while (stack.length > 0) {
        const at = stack.pop()!;
        const x = at % width, y = (at - x) / width;
        n += 1;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (!seen[next] && near(next * 4)) { seen[next] = 1; stack.push(next); }
        }
      }
      found.push({ w: maxX - minX + 1, h: maxY - minY + 1, n });
    }
    return { found, ratio: width / canvas.getBoundingClientRect().width };
  });
  const dots = blobs.found.filter((b) => b.h >= 4 * blobs.ratio && b.w >= 4 * blobs.ratio && b.w <= 14 * blobs.ratio && b.h <= 14 * blobs.ratio && b.n >= 12);
  expect(dots.length, JSON.stringify(blobs.found)).toBeGreaterThanOrEqual(1);
});

test('the champion replay pauses training, shows the decision for each tick, ends with an outcome and goes back to training', async ({ page }) => {
  await installPausedClock(page);
  await page.goto('/?mode=train');
  await page.clock.runFor(100);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-mode', 'train');
  // Closed by default, with nothing to replay before the first generation completes.
  await expect(page.locator('#champion-replay')).toBeVisible();
  await expect(page.locator('#champion-replay')).not.toHaveAttribute('open', '');
  await page.locator('#champion-replay > summary').click();
  await expect(page.locator('#replay-start')).toBeDisabled();
  await expect(page.locator('#replay-note')).toContainText('No generation completed yet');
  await page.locator('#champion-replay > summary').click();
  await advanceUntil(page, (v) => v.data.chartPoints === '1');
  await page.locator('#champion-replay > summary').click();
  await expect(page.locator('#replay-start')).toBeEnabled();
  // The graph and the replay are never open together.
  await expect(page.locator('#training-graph')).not.toHaveAttribute('open', '');

  await page.locator('#replay-generation').fill('1');
  await page.locator('#replay-start').click();
  await page.clock.runFor(500);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-replay', 'running');
  await expect(page.locator('#replay-start')).toHaveText('Restart');
  await expect(page.locator('#speed-pause')).toBeEnabled();
  await expect(page.locator('[data-speed="max"]')).toBeDisabled();
  const training = async () => [await data(page, 'generation'), await data(page, 'generation-tick'), await data(page, 'tick')];
  const before = await training();
  // Values update as it runs: nine inputs, three outputs and a decision label for the tick drawn.
  const first = await page.locator('#replay-decision').textContent();
  await page.clock.runFor(1000);
  expect(await page.locator('#replay-decision').textContent()).not.toBe(first);
  await expect(page.locator('#champion-replay [data-input]')).toHaveCount(9);
  for (const value of await page.locator('#champion-replay [data-input]').allTextContents()) expect(value).toMatch(/^-?\d+\.\d{3}$/);
  for (const id of ['replay-steering', 'replay-throttle', 'replay-brake']) await expect(page.locator(`#${id}`)).toHaveText(/^-?\d+\.\d{3}$/);
  // The canvas shows the replayed car and its rays: drawn pixels in the car colour and in the ray colours.
  const colours = await page.evaluate(() => {
    const canvas = document.getElementById('sim-canvas') as HTMLCanvasElement;
    const { data: px } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    const near = (i: number, r: number, g: number, b: number) => Math.abs(px[i]! - r) < 20 && Math.abs(px[i + 1]! - g) < 20 && Math.abs(px[i + 2]! - b) < 20;
    let rays = 0;
    for (let i = 0; i < px.length; i += 4) if (near(i, 0xff, 0x00, 0xd4) || near(i, 0xff, 0xb0, 0x00)) rays += 1;
    return rays;
  });
  expect(colours).toBeGreaterThan(0);

  // Training waited while it ran.
  expect(await training()).toEqual(before);
  // It runs to an outcome, and says so once.
  await advanceUntil(page, (v) => v.data.replay === 'done', 1000, 120);
  expect(['completed', 'crashed', 'stalled', 'timeout']).toContain(await data(page, 'replay-outcome'));
  await expect(page.locator('#replay-status')).toContainText('Replay of generation 1 finished');
  await expect(page.locator('#replay-result')).toContainText(/after \d+\.\d{2} s/);
  expect(await training()).toEqual(before);

  // Back to training: the same run carries on.
  await page.locator('#replay-stop').click();
  await page.clock.runFor(1500);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-replay', 'off');
  await expect(page.locator('#replay-status')).toHaveText('');
  await expect(page.locator('[data-speed="max"]')).toBeEnabled();
  expect(await training()).not.toEqual(before);
});

test('with the champion replay open, the track keeps its space, the page does not scroll and its controls are big enough', async ({ page }, testInfo) => {
  test.skip(!/phone|tablet/.test(testInfo.project.name), 'a small-screen check');
  await installPausedClock(page);
  await page.goto('/?mode=train');
  await page.clock.runFor(100);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-mode', 'train');
  await advanceUntil(page, (v) => v.data.chartPoints === '1');
  await page.locator('#champion-replay > summary').click();
  // Two saved champions, so the list is part of what must stay reachable.
  await page.locator('#saved-save').click();
  await page.locator('#saved-save').click();
  await expect(page.locator('#saved-list li')).toHaveCount(2);
  await page.locator('#replay-start').click();
  const original = page.viewportSize()!;
  const sizes = [original, { width: original.height, height: original.width }, { width: 568, height: 320 }, { width: 320, height: 568 }];
  // The CI runner's fonts differ from a developer's, so the narrow portrait size is also checked with other font families
  // and larger text (generic families, so no installed font can hide a wrap).
  const styles = ['', 'html, body, button, select, input { font-family: serif !important; }', 'html, body, button, select, input { font-family: monospace !important; } html { font-size: 112.5% !important; }'];
  const cases = sizes.flatMap((size) => (size.width === 320 ? styles : ['']).map((css) => ({ size, css })));
  for (const { size, css } of cases) {
    await page.setViewportSize(size);
    const handle = css ? await page.addStyleTag({ content: css }) : null;
    await page.clock.runFor(400);
    const fit = await page.evaluate(() => {
      const rect = (id: string) => document.getElementById(id)!.getBoundingClientRect();
      const panel = document.getElementById('champion-replay')!;
      const box = panel.getBoundingClientRect();
      panel.scrollTop = panel.scrollHeight;
      const status = document.querySelector('#saved-list li:last-child')!.getBoundingClientRect();
      const after = panel.getBoundingClientRect();
      const root = document.documentElement;
      const small = ['replay-generation', 'replay-start', 'replay-stop', 'saved-name', 'saved-save'].filter((id) => {
        const r = rect(id);
        return r.width < 44 || r.height < 44;
      });
      return {
        viewport: window.innerHeight,
        trackHeight: rect('sim-canvas').height,
        panelInside: box.left >= 0 && box.right <= window.innerWidth && box.top >= 0 && box.bottom <= window.innerHeight,
        lastReachable: status.top >= after.top - 1 && status.bottom <= after.bottom + 1,
        noScrollX: root.scrollWidth <= root.clientWidth,
        noScrollY: root.scrollHeight <= root.clientHeight,
        small,
      };
    });
    const label = `${size.width}x${size.height} ${css ? css.slice(0, 40) : 'default'}`;
    expect(fit.trackHeight, label).toBeGreaterThanOrEqual(Math.max(80, 0.2 * fit.viewport));
    expect(fit, label).toMatchObject({ panelInside: true, lastReachable: true, noScrollX: true, noScrollY: true, small: [] });
    await handle?.evaluate((el) => (el as Element).remove());
  }
});

test('a saved champion survives a page reload, replays and can be deleted', async ({ page }) => {
  await installPausedClock(page);
  await page.goto('/?mode=train');
  await page.clock.runFor(100);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-mode', 'train');
  await advanceUntil(page, (v) => v.data.chartPoints === '1');
  await page.locator('#champion-replay > summary').click();
  await expect(page.locator('#saved-notice')).toContainText('Saved in this browser only');
  await expect(page.locator('#saved-list li')).toHaveCount(0);
  await page.locator('#saved-name').fill('E2E champion');
  await page.locator('#saved-save').click();
  await expect(page.locator('#saved-status')).toHaveText('Saved "E2E champion" (generation 1).');
  await expect(page.locator('#saved-list li')).toHaveCount(1);
  await expect(page.locator('#saved-list li')).toContainText('E2E champion · generation 1');
  // The saved model is real, parseable JSON in this browser's localStorage, at full precision.
  const stored = await page.evaluate(() => {
    const index = JSON.parse(localStorage.getItem('sdae:models:index')!) as string[];
    const doc = JSON.parse(localStorage.getItem(`sdae:model:${index[0]}`)!);
    return { count: index.length, format: doc.format, values: doc.parameters.values.length, name: doc.name };
  });
  expect(stored).toEqual({ count: 1, format: 'self-driving-ai-evolution/model', values: 159, name: 'E2E champion' });

  // Reload: the page starts again from nothing, and the save is still there.
  await page.reload();
  await page.clock.runFor(200);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-mode', 'train');
  await page.locator('#champion-replay > summary').click();
  await expect(page.locator('#saved-list li')).toHaveCount(1);
  await expect(page.locator('#saved-list li')).toContainText('E2E champion');
  await page.getByRole('button', { name: 'Replay E2E champion' }).click();
  await page.clock.runFor(1500);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-replay', 'running');
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-replay-source', 'saved');
  await expect(page.locator('#saved-status')).toContainText('Replaying "E2E champion"');
  await advanceUntil(page, (v) => v.data.replay === 'done', 1000, 120);
  expect(['completed', 'crashed', 'stalled', 'timeout']).toContain(await data(page, 'replay-outcome'));
  await expect(page.locator('#replay-status')).toContainText('Replay of saved champion "E2E champion" finished');

  // Delete takes two taps.
  await page.getByRole('button', { name: 'Delete E2E champion' }).click();
  await expect(page.locator('#saved-list li')).toHaveCount(1);
  await page.getByRole('button', { name: 'Confirm delete E2E champion' }).click();
  await expect(page.locator('#saved-list li')).toHaveCount(0);
  await expect(page.locator('#saved-status')).toHaveText('Deleted.');
});

test('Download JSON gives a file with the validated saved champion', async ({ page }) => {
  await installPausedClock(page);
  await page.goto('/?mode=train');
  await page.clock.runFor(100);
  await advanceUntil(page, (v) => v.data.chartPoints === '1');
  await page.locator('#champion-replay > summary').click();
  await page.locator('#saved-name').fill('Download me');
  await page.locator('#saved-save').click();
  await expect(page.locator('#saved-list li')).toHaveCount(1);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON for Download me' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^sdae-champion-download-me-gen1-[a-z0-9]{1,8}\.json$/);
  const path = await download.path();
  const { readFileSync } = await import('node:fs');
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  expect(doc.format).toBe('self-driving-ai-evolution/model');
  expect(doc.schemaVersion).toBe(1);
  expect(doc.name).toBe('Download me');
  expect(doc.parameters.values).toHaveLength(159);
  expect(doc.training.trackIds).toEqual(['stadium-oval']);
  // The same document the page stores.
  const stored = await page.evaluate(() => {
    const index = JSON.parse(localStorage.getItem('sdae:models:index')!) as string[];
    return JSON.parse(localStorage.getItem(`sdae:model:${index[0]}`)!);
  });
  expect(doc).toEqual(stored);
  await expect(page.locator('#saved-status')).toContainText('Download started');
});

test('Download JSON of stored data nested too deeply gives a message, not an error', async ({ page }) => {
  await installPausedClock(page);
  await page.goto('/?mode=train');
  await page.clock.runFor(100);
  await advanceUntil(page, (v) => v.data.chartPoints === '1');
  await page.locator('#champion-replay > summary').click();
  await page.locator('#saved-save').click();
  await expect(page.locator('#saved-list li')).toHaveCount(1);
  await page.evaluate(() => {
    const index = JSON.parse(localStorage.getItem('sdae:models:index')!) as string[];
    const key = `sdae:model:${index[0]}`;
    const text = localStorage.getItem(key)!;
    const end = text.lastIndexOf('}');
    localStorage.setItem(key, `${text.slice(0, end)},"extra":${'['.repeat(100_000)}${']'.repeat(100_000)}}`);
  });
  await page.locator('#champion-replay > summary').click();
  await page.locator('#champion-replay > summary').click();
  await expect(page.locator('#saved-list li')).toHaveCount(1);
  await page.getByRole('button', { name: /^Download JSON for / }).click();
  await expect(page.locator('#saved-status')).toContainText('nested too deeply');
  await page.clock.runFor(500);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-mode', 'train');
});

test('a saved champion whose network overflows is refused with a message, and the page keeps running without an error', async ({ page }) => {
  await installPausedClock(page);
  await page.goto('/?mode=train');
  await page.clock.runFor(100);
  await advanceUntil(page, (v) => v.data.chartPoints === '1');
  await page.locator('#champion-replay > summary').click();
  await page.locator('#saved-save').click();
  await expect(page.locator('#saved-list li')).toHaveCount(1);
  // Finite numbers pass validation, but a network with the largest doubles overflows when it is run.
  await page.evaluate(() => {
    const index = JSON.parse(localStorage.getItem('sdae:models:index')!) as string[];
    const key = `sdae:model:${index[0]}`;
    const doc = JSON.parse(localStorage.getItem(key)!);
    doc.parameters.values = doc.parameters.values.map(() => Number.MAX_VALUE);
    localStorage.setItem(key, JSON.stringify(doc));
  });
  await page.locator('#champion-replay > summary').click();
  await page.locator('#champion-replay > summary').click();
  await expect(page.locator('#saved-list li')).toHaveCount(1);
  const tick = Number(await data(page, 'tick'));
  await page.locator('#saved-list').getByRole('button', { name: /^Replay / }).click();
  await expect(page.locator('#saved-status')).toContainText('numbers too large to compute');
  await page.clock.runFor(1000);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-replay', 'off');
  expect(Number(await data(page, 'tick'))).toBeGreaterThan(tick);
});

test('with localStorage denied, the page says so and training and replay carry on', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
  });
  await installPausedClock(page);
  await page.goto('/?mode=train');
  await page.clock.runFor(100);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-mode', 'train');
  await page.locator('#champion-replay > summary').click();
  await expect(page.locator('#saved-status')).toContainText('Browser storage is unavailable');
  await advanceUntil(page, (v) => v.data.chartPoints === '1');
  await page.locator('#saved-save').click();
  await expect(page.locator('#saved-status')).toContainText('Browser storage is unavailable');
  await expect(page.locator('#saved-list li')).toHaveCount(0);
  const tick = Number(await data(page, 'tick'));
  await page.locator('#replay-start').click();
  await page.clock.runFor(1000);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-replay', 'running');
  await page.locator('#replay-stop').click();
  await page.clock.runFor(1000);
  expect(Number(await data(page, 'tick'))).toBeGreaterThan(tick);
});

test('with localStorage full, saving says so and nothing is lost or broken', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.startsWith('sdae:')) throw new DOMException('full', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await installPausedClock(page);
  await page.goto('/?mode=train');
  await page.clock.runFor(100);
  await advanceUntil(page, (v) => v.data.chartPoints === '1');
  await page.locator('#champion-replay > summary').click();
  await page.locator('#saved-save').click();
  await expect(page.locator('#saved-status')).toContainText('Browser storage is full');
  await expect(page.locator('#saved-list li')).toHaveCount(0);
  await page.clock.runFor(500);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-mode', 'train');
});

test('the graph and replay summaries never overlap and can always be tapped, in portrait and landscape, with either panel open', async ({ page }, testInfo) => {
  test.skip(!/phone|tablet/.test(testInfo.project.name), 'a small-screen check');
  await installPausedClock(page);
  await page.goto('/?mode=train');
  await page.clock.runFor(100);
  await expect(page.locator('#sim-canvas')).toHaveAttribute('data-mode', 'train');
  await advanceUntil(page, (v) => v.data.chartPoints === '1');
  const original = page.viewportSize()!;
  const sizes = [original, { width: original.height, height: original.width }, { width: 568, height: 320 }, { width: 320, height: 568 }, { width: 667, height: 375 }];
  const probe = () =>
    page.evaluate(() => {
      const summaries = ['#training-graph > summary', '#champion-replay > summary'].map((selector) => document.querySelector(selector)!);
      const rects = summaries.map((el) => el.getBoundingClientRect());
      const [a, b] = rects as [DOMRect, DOMRect];
      return {
        apart: a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1,
        inside: rects.every((r) => r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight),
        big: rects.every((r) => r.width >= 44 && r.height >= 44),
        // A tap at each summary's centre reaches that summary, not the other panel.
        hit: summaries.every((el) => {
          const r = el.getBoundingClientRect();
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return top === el || el.contains(top);
        }),
      };
    });
  for (const size of sizes) {
    await page.setViewportSize(size);
    await page.clock.runFor(300);
    const label = `${size.width}x${size.height}`;
    expect(await probe(), `${label} none open`).toEqual({ apart: true, inside: true, big: true, hit: true });
    await page.locator('#training-graph > summary').click();
    await page.clock.runFor(300);
    expect(await probe(), `${label} graph open`).toEqual({ apart: true, inside: true, big: true, hit: true });
    // A real tap on the other summary switches panels (it is reachable, and the first closes).
    await page.locator('#champion-replay > summary').click();
    await page.clock.runFor(300);
    await expect(page.locator('#champion-replay'), label).toHaveAttribute('open', '');
    await expect(page.locator('#training-graph'), label).not.toHaveAttribute('open', '');
    expect(await probe(), `${label} replay open`).toEqual({ apart: true, inside: true, big: true, hit: true });
    await page.locator('#training-graph > summary').click();
    await page.clock.runFor(300);
    await expect(page.locator('#training-graph'), label).toHaveAttribute('open', '');
    await expect(page.locator('#champion-replay'), label).not.toHaveAttribute('open', '');
    await page.locator('#training-graph > summary').click();
    await page.clock.runFor(300);
  }
});

test('the default page is still manual driving', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.controls')).toBeVisible();
  await expect(page.locator('.app-header > .hud')).toBeVisible();
  expect(await data(page, 'mode')).toBeNull();
  expect(await data(page, 'cars')).toBeNull();
});
