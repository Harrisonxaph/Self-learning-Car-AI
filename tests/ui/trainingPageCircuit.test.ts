// P4-04 against the page's real wiring: the Training circuit control of `startTrainingPage`, run in Node with a fake frame
// source and fake DOM objects. The control is available before the first generation completes and while paused, disabled
// mid-run, and a change asks the browser to load the address for the new circuit. Seeded, nothing here is a result.
import { describe, expect, it } from 'vitest';
import { DEFAULT_SIM_CONFIG } from '../../src/sim/config';
import { startTrainingPage } from '../../src/ui/trainingPage';
import { FakeFrames } from './fakeFrames';
import { fakePage } from './fakeTrainingPage';

const FRAME_MS = DEFAULT_SIM_CONFIG.timestepSeconds * 1000;

function boot() {
  const frames = new FakeFrames();
  const fake = fakePage(frames, { now: (() => { let t = 0; return () => (t += 0.5); })() });
  startTrainingPage(fake.page);
  let frame = 0;
  const run = (until: () => boolean) => {
    for (; frame < 400_000 && !until(); frame += 1) frames.fire(frame * FRAME_MS);
    expect(until()).toBe(true);
  };
  const advance = (count = 1) => {
    for (let i = 0; i < count; i += 1) frames.fire(frame++ * FRAME_MS);
  };
  return { ...fake, run, advance, completed: () => Number(fake.canvas.dataset.completedGenerations ?? '0') };
}

describe('the Training circuit control', () => {
  it('shows the circuit the page trains on, publishes its id, and starts available with a hint', () => {
    const { circuitSelect, circuitHint, canvas, advance } = boot();
    advance();
    expect(circuitSelect.value).toBe('stadium-oval');
    expect(canvas.dataset.trackId).toBe('stadium-oval');
    expect(circuitSelect.disabled).toBe(false);
    expect(circuitHint.textContent).toBe('Changing the circuit starts a new run.');
  });

  it('is disabled mid-run once a generation has completed, and available again while paused', () => {
    const { circuitSelect, circuitHint, controls, run, advance, completed } = boot();
    run(() => completed() >= 1);
    expect(circuitSelect.disabled).toBe(true);
    expect(circuitHint.textContent).toBe('Pause training to change the circuit.');
    controls.pause.click();
    advance();
    expect(circuitSelect.disabled).toBe(false);
    expect(circuitHint.textContent).toContain('new run');
    controls.pause.click();
    advance();
    expect(circuitSelect.disabled).toBe(true);
  });

  it('a change asks the browser to load the new circuit only when the control is available and the circuit differs', () => {
    const { circuitSelect, controls, navigated, run, advance, completed } = boot();
    advance();
    circuitSelect.choose('stadium-oval'); // the same circuit: nothing
    expect(navigated).toEqual([]);
    circuitSelect.choose('kidney-loop');
    expect(navigated).toEqual(['kidney-loop']);
    run(() => completed() >= 1);
    expect(circuitSelect.disabled).toBe(true);
    circuitSelect.choose('kidney-loop'); // mid-run: ignored
    expect(navigated).toEqual(['kidney-loop']);
    controls.pause.click();
    advance();
    circuitSelect.choose('kidney-loop');
    expect(navigated).toEqual(['kidney-loop', 'kidney-loop']);
  });
});
