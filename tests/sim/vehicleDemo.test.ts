// A reproducible demonstration of the car model: accelerate, turn, coast, then brake, using the same
// stepVehicle the simulation uses. Run `npm run demo:vehicle` to print the table; the checks below keep the
// demonstration honest in CI (where `npm test` runs it quietly). There is no track or collision here: cars leaving the road is expected until P1-06.
import { expect, it } from 'vitest';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { createVehicle, stepVehicle, type Controls } from '../../src/sim/vehicle';

const DT = DEFAULT_SIM_CONFIG.timestepSeconds;
const PHASES: { name: string; seconds: number; controls: Controls }[] = [
  { name: 'accelerate', seconds: 5, controls: { steering: 0, throttle: 1, brake: 0 } },
  { name: 'turn right', seconds: 3, controls: { steering: 1, throttle: 0.5, brake: 0 } },
  { name: 'coast', seconds: 3, controls: { steering: 0, throttle: 0, brake: 0 } },
  { name: 'brake', seconds: 3, controls: { steering: 0, throttle: 0, brake: 1 } },
];

function runDemo() {
  let car = createVehicle({ position: { x: 0, y: 0 }, heading: 0 });
  const rows: { t: number; phase: string; speed: number; headingDeg: number; x: number; y: number }[] = [];
  let tick = 0;
  const record = (phase: string) =>
    rows.push({ t: tick * DT, phase, speed: car.speed, headingDeg: (car.heading * 180) / Math.PI, x: car.position.x, y: car.position.y });
  record('start');
  for (const phase of PHASES) {
    for (let i = 0; i < Math.round(phase.seconds / DT); i += 1) {
      car = stepVehicle(car, phase.controls, DEFAULT_VEHICLE_PHYSICS, DT);
      tick += 1;
      if (tick % 60 === 0) record(phase.name);
    }
  }
  return rows;
}

it('demonstrates accelerating, turning, coasting and braking', () => {
  const rows = runDemo();
  const table = rows
    .map((r) => `${r.t.toFixed(0).padStart(3)} s  ${r.phase.padEnd(10)} ${r.speed.toFixed(2).padStart(6)} m/s  heading ${r.headingDeg.toFixed(1).padStart(6)}°  at (${r.x.toFixed(1)}, ${r.y.toFixed(1)}) m`)
    .join('\n');
  console.log(`Vehicle demo (dt = 1/60 s, maxSpeed ${DEFAULT_VEHICLE_PHYSICS.maxSpeed.toFixed(2)} m/s):\n${table}`);

  const at = (seconds: number) => rows.find((r) => Math.round(r.t) === seconds)!;
  // Accelerating: faster each second, heading unchanged.
  expect(at(1).speed).toBeLessThan(at(3).speed);
  expect(at(5).speed).toBeGreaterThan(at(3).speed);
  expect(at(5).headingDeg).toBe(0);
  // Turning right: heading increases (clockwise on screen), and the car drifts towards +y.
  expect(at(8).headingDeg).toBeGreaterThan(30);
  expect(at(8).y).toBeGreaterThan(at(5).y);
  // Coasting: slower each second, still moving.
  expect(at(11).speed).toBeLessThan(at(9).speed);
  expect(at(11).speed).toBeGreaterThan(0);
  // Braking: stopped, and never negative.
  expect(at(14).speed).toBe(0);
  expect(rows.every((r) => r.speed >= 0)).toBe(true);
});
