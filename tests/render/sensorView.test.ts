import { describe, expect, it } from 'vitest';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { HIT_MARKER_RADIUS_PX, SENSOR_COLOURS, drawSensors, type SensorContext } from '../../src/render/sensorView';
import { worldToScreen, type WorldToScreen } from '../../src/render/trackView';
import { computeViewportSize } from '../../src/render/viewport';
import { DEFAULT_SENSOR_CONFIG, castRays, type SensorReadings } from '../../src/sensors/rays';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { loadTrack } from '../../src/sim/track';
import { createWorld, stepWorld } from '../../src/sim/world';

/** Records drawing calls with the styles in effect at the time. */
function fakeContext() {
  const calls: { name: string; args: unknown[]; fillStyle: unknown; strokeStyle: unknown }[] = [];
  const context = { fillStyle: '' as unknown, strokeStyle: '' as unknown, lineWidth: 1 } as Record<string, unknown>;
  for (const name of ['setTransform', 'beginPath', 'moveTo', 'lineTo', 'arc', 'fill', 'stroke']) {
    context[name] = (...args: unknown[]) => calls.push({ name, args, fillStyle: context.fillStyle, strokeStyle: context.strokeStyle });
  }
  return { context: context as unknown as SensorContext, calls };
}

const track = loadTrack(stadiumOval);
const physics = DEFAULT_VEHICLE_PHYSICS;
const size = computeViewportSize(800, 400, 2);

/** The line segments drawn (moveTo then lineTo), each with the stroke colour it was drawn in. */
function drawnLines(calls: ReturnType<typeof fakeContext>['calls']) {
  const lines: { from: { x: number; y: number }; to: { x: number; y: number }; colour: unknown }[] = [];
  calls.forEach((call, i) => {
    if (call.name !== 'moveTo') return;
    const to = calls[i + 1]!;
    const stroke = calls.slice(i).find((c) => c.name === 'stroke')!;
    lines.push({ from: { x: call.args[0] as number, y: call.args[1] as number }, to: { x: to.args[0] as number, y: to.args[1] as number }, colour: stroke.strokeStyle });
  });
  return lines;
}

const markers = (calls: ReturnType<typeof fakeContext>['calls']) =>
  calls.filter((c) => c.name === 'arc').map((c) => ({ x: c.args[0] as number, y: c.args[1] as number, r: c.args[2] as number }));

describe('drawSensors', () => {
  const poses = [
    track.start,
    { position: { x: 70, y: 20 }, heading: 1.9 },
    { position: { x: -40, y: -39 }, heading: Math.PI },
  ];
  const views: WorldToScreen[] = [
    { scale: 3, offsetX: 400, offsetY: 200 },
    { scale: 1.37, offsetX: 155.5, offsetY: 88.25 },
  ];

  it('draws at the device pixel ratio', () => {
    const { context, calls } = fakeContext();
    drawSensors(context, size, views[0]!, castRays(track.start, track, physics, DEFAULT_SENSOR_CONFIG));
    expect(calls[0]).toMatchObject({ name: 'setTransform', args: [2, 0, 0, 2, 0, 0] });
  });

  for (const pose of poses) {
    for (const view of views) {
      it(`each line runs from the origin to the ray's end, mapped like the track (pose ${pose.position.x}, ${pose.position.y}, scale ${view.scale})`, () => {
        const readings = castRays(pose, track, physics, DEFAULT_SENSOR_CONFIG);
        const { context, calls } = fakeContext();
        drawSensors(context, size, view, readings);
        const lines = drawnLines(calls);
        expect(lines).toHaveLength(7);
        const origin = worldToScreen(view, readings.origin);
        readings.rays.forEach((ray, i) => {
          const end = worldToScreen(view, ray.end);
          expect(Math.abs(lines[i]!.from.x - origin.x)).toBeLessThan(1e-9);
          expect(Math.abs(lines[i]!.from.y - origin.y)).toBeLessThan(1e-9);
          expect(Math.abs(lines[i]!.to.x - end.x)).toBeLessThan(1e-9);
          expect(Math.abs(lines[i]!.to.y - end.y)).toBeLessThan(1e-9);
          expect(lines[i]!.colour).toBe(ray.hit ? SENSOR_COLOURS.hitRay : SENSOR_COLOURS.clearRay);
        });
        // A marker on every hit and only there.
        const expected = readings.rays.filter((r) => r.hit).map((r) => ({ ...worldToScreen(view, r.end), r: HIT_MARKER_RADIUS_PX }));
        expect(markers(calls)).toEqual(expected);
      });
    }
  }

  it('draws a clear ray at full length in the clear style with no marker', () => {
    // At the start, the 0° ray is clear: 50 m ahead of the origin (−4.75, 40).
    const readings = castRays(track.start, track, physics, DEFAULT_SENSOR_CONFIG);
    const view = views[0]!;
    const { context, calls } = fakeContext();
    drawSensors(context, size, view, readings);
    const ahead = drawnLines(calls)[3]!;
    expect(ahead.to).toEqual(worldToScreen(view, { x: 45.25, y: 40 }));
    expect(ahead.colour).toBe(SENSOR_COLOURS.clearRay);
    expect(markers(calls)).toHaveLength(6);
    expect(markers(calls).some((m) => m.x === ahead.to.x && m.y === ahead.to.y)).toBe(false);
    expect(calls.filter((c) => c.name === 'fill').every((c) => c.fillStyle === SENSOR_COLOURS.hitMarker)).toBe(true);
  });

  it('draws the markers after every line, so no line covers a marker', () => {
    const { context, calls } = fakeContext();
    drawSensors(context, size, views[0]!, castRays(track.start, track, physics, DEFAULT_SENSOR_CONFIG));
    const lastStroke = calls.map((c) => c.name).lastIndexOf('stroke');
    const firstArc = calls.findIndex((c) => c.name === 'arc');
    expect(firstArc).toBeGreaterThan(lastStroke);
  });

  it('works for any car and never changes the readings or the world', () => {
    let world = createWorld(track, physics);
    for (let i = 0; i < 120; i += 1) world = stepWorld(world, { steering: 0.3, throttle: 1, brake: 0 }, DEFAULT_SIM_CONFIG);
    const snapshot = structuredClone(world);
    const readings: SensorReadings = castRays(world.racer.car.vehicle, world.track, world.physics, DEFAULT_SENSOR_CONFIG);
    const copy = structuredClone(readings);
    const { context } = fakeContext();
    drawSensors(context, size, views[1]!, readings);
    expect(readings).toEqual(copy);
    expect(world).toEqual(snapshot);
  });
});
