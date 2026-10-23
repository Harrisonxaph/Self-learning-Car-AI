import { describe, expect, it } from 'vitest';
import { PLACEHOLDER_MESSAGE, drawPlaceholder, type PlaceholderContext } from '../../src/render/placeholder';
import { computeViewportSize } from '../../src/render/viewport';

/** Records drawing calls in order, in the CSS-pixel coordinates the caller used. */
function recordingContext() {
  const calls: { name: string; args: unknown[] }[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push({ name, args });
    };
  const ctx = {
    setTransform: record('setTransform'),
    clearRect: record('clearRect'),
    fillRect: record('fillRect'),
    strokeRect: record('strokeRect'),
    fillText: record('fillText'),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
  } as unknown as PlaceholderContext;
  return { ctx, calls };
}

describe('drawPlaceholder', () => {
  it('scales drawing to the capped pixel ratio before drawing, so it stays sharp', () => {
    const { ctx, calls } = recordingContext();
    drawPlaceholder(ctx, computeViewportSize(390, 664, 3));
    expect(calls[0]).toEqual({ name: 'setTransform', args: [2, 0, 0, 2, 0, 0] });
  });

  it('fills the whole CSS area and centres the message', () => {
    const { ctx, calls } = recordingContext();
    drawPlaceholder(ctx, computeViewportSize(800, 600, 1));
    expect(calls).toContainEqual({ name: 'fillRect', args: [0, 0, 800, 600] });
    expect(calls).toContainEqual({ name: 'fillText', args: [PLACEHOLDER_MESSAGE, 400, 300] });
  });
});
