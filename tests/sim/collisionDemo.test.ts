// A reproducible demonstration of collision on the built-in track: three scripted drives from the start
// line, each ending against a wall. Run `npm run demo:collision` to print the table; the checks below keep
// the demonstration honest in CI (where `npm test` runs it quietly).
import { expect, it } from 'vitest';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { createCar, footprintHitsTrack, stepCar, vehicleFootprint, type Car } from '../../src/sim/collision';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { loadTrack } from '../../src/sim/track';
import type { Controls } from '../../src/sim/vehicle';

const DT = DEFAULT_SIM_CONFIG.timestepSeconds;
const PHYSICS = DEFAULT_VEHICLE_PHYSICS;
const track = loadTrack(stadiumOval);
const DRIVES: { name: string; controls: Controls }[] = [
  { name: 'straight, full throttle', controls: { steering: 0, throttle: 1, brake: 0 } },
  { name: 'full right, half throttle', controls: { steering: 1, throttle: 0.5, brake: 0 } },
  { name: 'gentle left, full throttle', controls: { steering: -0.15, throttle: 1, brake: 0 } },
];

function drive(controls: Controls) {
  let car: Car = createCar(track.start, track, PHYSICS);
  let ticks = 0;
  let topSpeed = 0;
  while (!car.crashed && ticks < 60 * 60) {
    car = stepCar(car, controls, track, PHYSICS, DT);
    ticks += 1;
    topSpeed = Math.max(topSpeed, car.vehicle.speed);
  }
  return { car, ticks, topSpeed };
}

it('demonstrates cars stopping and being flagged when they reach a wall', () => {
  const results = DRIVES.map((d) => ({ ...d, ...drive(d.controls) }));
  const table = results
    .map(
      ({ name, car, ticks, topSpeed }) =>
        `${name.padEnd(27)} crashed ${String(car.crashed).padEnd(5)} after ${(ticks * DT).toFixed(2).padStart(5)} s` +
        `  top ${topSpeed.toFixed(2).padStart(5)} m/s  stopped at (${car.vehicle.position.x.toFixed(2)}, ${car.vehicle.position.y.toFixed(2)})` +
        ` heading ${((car.vehicle.heading * 180) / Math.PI).toFixed(1)}°  speed ${car.vehicle.speed}`,
    )
    .join('\n');
  console.log(`Collision demo on "${track.name}" from the start pose (-6, 40), heading 0, dt = 1/60 s:\n${table}`);

  for (const { car } of results) {
    expect(car.crashed).toBe(true);
    expect(car.vehicle.speed).toBe(0);
    // Stopped at the last clear pose: touching nothing.
    expect(footprintHitsTrack(vehicleFootprint(car.vehicle, PHYSICS), track)).toBe(false);
  }
  // Straight ahead along y = 40 reaches the right-hand curve's outer wall.
  expect(results[0]!.car.vehicle.position.x).toBeGreaterThan(60);
  // Turning right (towards +y) reaches the bottom outer wall; turning left reaches the infield.
  expect(results[1]!.car.vehicle.position.y).toBeGreaterThan(40);
  expect(results[2]!.car.vehicle.position.y).toBeLessThan(40);
});
