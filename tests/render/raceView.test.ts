import { describe, expect, it } from 'vitest';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { RACE_COLOURS, drawRace, type RaceContext } from '../../src/render/raceView';
import { worldToScreen } from '../../src/render/trackView';
import { computeViewportSize } from '../../src/render/viewport';
import { vehicleFootprint } from '../../src/sim/collision';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { loadTrack } from '../../src/sim/track';
import { createWorld, stepWorld, type World } from '../../src/sim/world';

/** Records drawing calls with the fill and stroke style in effect at the time. */
function fakeContext() {
  const calls: { name: string; args: unknown[]; fillStyle: unknown; strokeStyle: unknown }[] = [];
  const context = {
    fillStyle: '' as unknown,
    strokeStyle: '' as unknown,
    lineWidth: 1,
    lineJoin: 'miter',
  } as Record<string, unknown>;
  for (const name of ['setTransform', 'beginPath', 'moveTo', 'lineTo', 'arc', 'closePath', 'fill', 'stroke']) {
    context[name] = (...args: unknown[]) => calls.push({ name, args, fillStyle: context.fillStyle, strokeStyle: context.strokeStyle });
  }
  return { context: context as unknown as RaceContext, calls };
}

const track = loadTrack(stadiumOval);
const view = { scale: 3, offsetX: 400, offsetY: 200 };
const size = computeViewportSize(800, 400, 2);

function draw(world: World) {
  const { context, calls } = fakeContext();
  drawRace(context, size, view, world);
  return calls;
}

describe('drawRace', () => {
  it('draws at the device pixel ratio', () => {
    expect(draw(createWorld(track, DEFAULT_VEHICLE_PHYSICS))[0]).toMatchObject({ name: 'setTransform', args: [2, 0, 0, 2, 0, 0] });
  });

  it('draws the car exactly on its collision footprint, mapped like the track', () => {
    let world = createWorld(track, DEFAULT_VEHICLE_PHYSICS);
    for (let i = 0; i < 90; i += 1) world = stepWorld(world, { steering: 0.4, throttle: 1, brake: 0 }, DEFAULT_SIM_CONFIG);
    const calls = draw(world);
    const expected = vehicleFootprint(world.racer.car.vehicle, DEFAULT_VEHICLE_PHYSICS).map((p) => worldToScreen(view, p));
    const fillIndex = calls.findIndex((c) => c.name === 'fill' && c.fillStyle === RACE_COLOURS.car);
    const body = calls.slice(0, fillIndex).filter((c) => c.name === 'moveTo' || c.name === 'lineTo').slice(-4);
    expect(body.map((c) => ({ x: c.args[0], y: c.args[1] }))).toEqual(expected);
  });

  it('marks the next gate, and colours a crashed car differently', () => {
    const world = createWorld(track, DEFAULT_VEHICLE_PHYSICS);
    const gate = track.gates[0]!;
    const calls = draw(world);
    expect(calls).toContainEqual(expect.objectContaining({ name: 'moveTo', args: [worldToScreen(view, gate.a).x, worldToScreen(view, gate.a).y] }));
    expect(calls).toContainEqual(expect.objectContaining({ name: 'stroke', strokeStyle: RACE_COLOURS.nextGate }));
    const crashed = { ...world, racer: { ...world.racer, car: { ...world.racer.car, crashed: true } } };
    expect(draw(crashed)).toContainEqual(expect.objectContaining({ name: 'fill', fillStyle: RACE_COLOURS.crashedCar }));
    expect(draw(world)).not.toContainEqual(expect.objectContaining({ name: 'fill', fillStyle: RACE_COLOURS.crashedCar }));
  });

  it('never changes the world', () => {
    const world = createWorld(track, DEFAULT_VEHICLE_PHYSICS);
    const copy = structuredClone(world);
    draw(world);
    expect(world).toEqual(copy);
  });
});
