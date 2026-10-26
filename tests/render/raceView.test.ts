import { describe, expect, it } from 'vitest';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { RACE_COLOURS, drawCars, drawRace, type RaceContext } from '../../src/render/raceView';
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

describe('drawCars (training mode, P2-05)', () => {
  const physics = DEFAULT_VEHICLE_PHYSICS;
  const at = (x: number, crashed = false) => ({ vehicle: { position: { x, y: 40 }, heading: 0, speed: 0 }, crashed });

  it('draws each car on its footprint: running blue on top, finished grey, crashed red', () => {
    const { context, calls } = fakeContext();
    const cars = [
      { car: at(0), finished: false },
      { car: at(10, true), finished: true },
      { car: at(20), finished: true },
    ];
    drawCars(context, size, view, cars, physics);
    const bodies = calls.filter((c) => c.name === 'fill' && c.fillStyle !== RACE_COLOURS.nose).map((c) => c.fillStyle);
    // Finished cars first (in population order), then the running car, so running cars stay visible.
    expect(bodies).toEqual([RACE_COLOURS.crashedCar, RACE_COLOURS.finishedCar, RACE_COLOURS.car]);
    expect(calls.filter((c) => c.name === 'fill' && c.fillStyle === RACE_COLOURS.nose)).toHaveLength(3);
    // The running car's body starts at its footprint's first corner, mapped to the screen.
    const first = worldToScreen(view, vehicleFootprint(at(0).vehicle, physics)[0]!);
    const moves = calls.filter((c) => c.name === 'moveTo').map((c) => c.args);
    expect(moves).toContainEqual([first.x, first.y]);
  });

  it('never changes the cars, and draws nothing but the transform for an empty population', () => {
    const cars = Object.freeze([Object.freeze({ car: Object.freeze(at(0)), finished: false })]);
    expect(() => drawCars(fakeContext().context, size, view, cars, physics)).not.toThrow();
    const { context, calls } = fakeContext();
    drawCars(context, size, view, [], physics);
    expect(calls.map((c) => c.name)).toEqual(['setTransform']);
  });
});
