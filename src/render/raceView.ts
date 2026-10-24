// Draws the moving parts over the cached track layer: the next gate to cross, and the car's footprint with
// a mark at its nose. Reads the world and never changes it. Coordinates are mapped to CSS pixels with the
// same transform as the track layer, so the car sits exactly where the simulation says it is.
import { vehicleFootprint } from '../sim/collision';
import type { World } from '../sim/world';
import { worldToScreen, type WorldToScreen } from './trackView';
import type { ViewportSize } from './viewport';

/** The drawing calls needed (a subset of CanvasRenderingContext2D). */
export type RaceContext = Pick<
  CanvasRenderingContext2D,
  'setTransform' | 'beginPath' | 'moveTo' | 'lineTo' | 'arc' | 'closePath' | 'fill' | 'stroke' | 'fillStyle' | 'strokeStyle' | 'lineWidth' | 'lineJoin'
>;

export const RACE_COLOURS = Object.freeze({
  nextGate: '#53d8fb',
  locator: 'rgba(255, 255, 255, 0.55)',
  car: '#4aa3ff',
  crashedCar: '#ff5a5a',
  outline: '#0b1118',
  nose: '#ffffff',
});

export function drawRace(context: RaceContext, size: ViewportSize, view: WorldToScreen, world: World): void {
  context.setTransform(size.pixelRatio, 0, 0, size.pixelRatio, 0, 0);
  const { car, progress } = world.racer;

  // The only gate that can count next.
  const gate = world.track.gates[progress.nextGate]!;
  const a = worldToScreen(view, gate.a);
  const b = worldToScreen(view, gate.b);
  context.beginPath();
  context.moveTo(a.x, a.y);
  context.lineTo(b.x, b.y);
  context.strokeStyle = RACE_COLOURS.nextGate;
  context.lineWidth = 3;
  context.stroke();

  // The car body: the collision footprint itself, so what you see is what collides.
  const corners = vehicleFootprint(car.vehicle, world.physics).map((p) => worldToScreen(view, p));

  // A thin ring around the car so it is easy to find when the whole track fits a phone screen and the car is
  // only a few pixels long. It is a marker only; collision uses the footprint.
  const centre = towards(corners[0]!, corners[2]!, 0.5);
  const reach = Math.hypot(corners[2]!.x - corners[0]!.x, corners[2]!.y - corners[0]!.y) / 2;
  context.beginPath();
  context.arc(centre.x, centre.y, Math.max(LOCATOR_MIN_RADIUS_PX, reach + 4), 0, 2 * Math.PI);
  context.strokeStyle = RACE_COLOURS.locator;
  context.lineWidth = 1.5;
  context.stroke();

  context.beginPath();
  corners.forEach((p, i) => (i === 0 ? context.moveTo(p.x, p.y) : context.lineTo(p.x, p.y)));
  context.closePath();
  context.fillStyle = car.crashed ? RACE_COLOURS.crashedCar : RACE_COLOURS.car;
  context.fill();
  context.strokeStyle = RACE_COLOURS.outline;
  context.lineWidth = 1;
  context.lineJoin = 'round';
  context.stroke();

  // Nose: a white wedge inside the front of the body pointing forwards, so the heading is visible even when
  // the car is small on screen, without drawing anything outside the footprint.
  const [rearRight, frontRight, frontLeft, rearLeft] = corners as [Point, Point, Point, Point];
  const tip = towards(frontRight, frontLeft, 0.5);
  context.beginPath();
  context.moveTo(tip.x, tip.y);
  const right = towards(frontRight, rearRight, 0.4);
  const left = towards(frontLeft, rearLeft, 0.4);
  context.lineTo(right.x, right.y);
  context.lineTo(left.x, left.y);
  context.closePath();
  context.fillStyle = RACE_COLOURS.nose;
  context.fill();
}

type Point = { readonly x: number; readonly y: number };
const towards = (from: Point, to: Point, t: number): Point => ({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });

/** Smallest radius of the ring drawn around the car, in CSS pixels. */
export const LOCATOR_MIN_RADIUS_PX = 14;
