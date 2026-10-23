import { describe, expect, it } from 'vitest';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { createTrackLayer, type LayerSurface, type TrackLayerContext } from '../../src/render/trackLayer';
import { fitBounds, trackMargin, worldToScreen } from '../../src/render/trackView';
import { computeViewportSize } from '../../src/render/viewport';
import { loadTrack, trackBounds } from '../../src/sim/track';

/** A fake offscreen canvas that records every drawing call. */
function fakeSurface() {
  const calls: { name: string; args: unknown[] }[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push({ name, args });
    };
  const context = {
    setTransform: record('setTransform'),
    clearRect: record('clearRect'),
    fillRect: record('fillRect'),
    beginPath: record('beginPath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    closePath: record('closePath'),
    fill: record('fill'),
    stroke: record('stroke'),
    setLineDash: record('setLineDash'),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'miter',
  } as unknown as TrackLayerContext;
  const surface: LayerSurface<{ id: string }> = { canvas: { id: 'layer', width: 300, height: 150 }, context };
  return { surface, calls };
}

function setup() {
  const fake = fakeSurface();
  let created = 0;
  const layer = createTrackLayer(() => {
    created += 1;
    return fake.surface;
  });
  return { layer, calls: fake.calls, surface: fake.surface, created: () => created };
}

const track = loadTrack(stadiumOval);

describe('createTrackLayer', () => {
  it('draws the layer once and reuses it while nothing changes', () => {
    const { layer, calls, created } = setup();
    const first = layer.get(track, computeViewportSize(800, 600, 2));
    const drawCalls = calls.length;
    // A new but equal size object, as the viewport reports after a resize event that changed nothing.
    for (let i = 0; i < 60; i += 1) layer.get(track, computeViewportSize(800, 600, 2));
    expect(layer.builds()).toBe(1);
    expect(calls.length).toBe(drawCalls);
    expect(created()).toBe(1);
    expect(layer.get(track, computeViewportSize(800, 600, 2))?.canvas).toBe(first?.canvas);
  });

  it('sizes the layer to the drawing buffer at the capped pixel ratio', () => {
    const { layer, surface } = setup();
    layer.get(track, computeViewportSize(390, 664, 3));
    expect(surface.canvas.width).toBe(780);
    expect(surface.canvas.height).toBe(1328);
  });

  it.each([
    ['the window is resized', computeViewportSize(1024, 600, 2)],
    ['the phone is rotated', computeViewportSize(600, 800, 2)],
    ['the pixel ratio changes (browser zoom)', computeViewportSize(800, 600, 1.5)],
    ['only the height changes (a mobile toolbar hides)', computeViewportSize(800, 640, 2)],
    // Same 1600 x 1200 buffer, but a different CSS size and ratio, so the track must be drawn differently.
    ['the CSS size and pixel ratio change but the buffer size does not', computeViewportSize(1600, 1200, 1)],
  ])('redraws when %s', (_label, newSize) => {
    const { layer } = setup();
    layer.get(track, computeViewportSize(800, 600, 2));
    layer.get(track, newSize);
    expect(layer.builds()).toBe(2);
  });

  it('redraws when the track changes, even to an equal copy', () => {
    const { layer } = setup();
    const size = computeViewportSize(800, 600, 1);
    layer.get(track, size);
    layer.get(loadTrack(stadiumOval), size);
    expect(layer.builds()).toBe(2);
  });

  it('draws nothing for a canvas with no area', () => {
    const { layer, created } = setup();
    expect(layer.get(track, computeViewportSize(0, 0, 2))).toBeUndefined();
    expect(layer.builds()).toBe(0);
    expect(created()).toBe(0);
  });

  it('draws at the device pixel ratio, with the track fitted to the CSS size', () => {
    const { layer, calls } = setup();
    const size = computeViewportSize(800, 600, 2);
    const result = layer.get(track, size);
    const expected = fitBounds(trackBounds(track), 800, 600, trackMargin(800, 600));
    expect(result?.view).toEqual(expected);
    expect(calls[0]).toEqual({ name: 'setTransform', args: [2, 0, 0, 2, 0, 0] });
    expect(calls).toContainEqual({ name: 'fillRect', args: [0, 0, 800, 600] });
    const firstOuter = worldToScreen(expected, track.outer[0]!);
    expect(calls).toContainEqual({ name: 'moveTo', args: [firstOuter.x, firstOuter.y] });
  });
});
