import { describe, expect, it } from 'vitest';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import {
  advanceProgress,
  createProgress,
  forwardCrossing,
  lapSeconds,
  stepRacer,
  type LapProgress,
  type Racer,
} from '../../src/sim/checkpoints';
import { createCar, footprintHitsTrack, vehicleFootprint } from '../../src/sim/collision';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { loadTrack, type Pose, type Track, type Vec2 } from '../../src/sim/track';
import { LAP_LENGTH, centre, pursuit } from './ovalDriver';

const PHYSICS = DEFAULT_VEHICLE_PHYSICS;
const DT = DEFAULT_SIM_CONFIG.timestepSeconds;
const oval = loadTrack(stadiumOval);
const v = (x: number, y: number): Vec2 => ({ x, y });

const START_S = 54; // the start pose (−6, 40)

/** Feeds one reference-point position per tick and returns the progress after each tick. */
function follow(points: readonly Vec2[], track: Track = oval, start: LapProgress = createProgress()): LapProgress[] {
  const out: LapProgress[] = [start];
  for (let i = 1; i < points.length; i += 1) out.push(advanceProgress(out[i - 1]!, points[i - 1]!, points[i]!, track));
  return out;
}
const last = <T>(items: readonly T[]) => items[items.length - 1]!;
/** Points along the centre line from distance `from`, `step` metres apart, `count` of them. */
const along = (from: number, step: number, count: number) =>
  Array.from({ length: count }, (_, k) => centre(from + k * step).position);

describe('a single gate crossing', () => {
  const gate = oval.gates[0]!; // x = 0, from (0, 33) to (0, 47); forward is +x

  it.each([
    ['straight through, forwards', v(-1, 40), v(1, 40), 0.5],
    ['from exactly on the line, forwards', v(0, 40), v(1, 40), 0],
    ['through an end point of the gate', v(-1, 32), v(1, 34), 0.5],
    ['diagonally', v(-2, 38), v(2, 42), 0.5],
  ])('counts %s', (_label, from, to, at) => {
    expect(forwardCrossing(gate, from, to)).toBeCloseTo(at, 12);
  });

  it.each([
    ['backwards', v(1, 40), v(-1, 40)],
    ['stopping exactly on the line', v(-1, 40), v(0, 40)],
    ['standing still on the line', v(0, 40), v(0, 40)],
    ['moving along the line', v(0, 35), v(0, 45)],
    ['passing beyond the end of the gate', v(-1, 30), v(1, 30)],
    ['staying behind it', v(-3, 40), v(-1, 40)],
    ['staying ahead of it', v(1, 40), v(3, 40)],
  ])('ignores %s', (_label, from, to) => {
    expect(forwardCrossing(gate, from, to)).toBeNull();
  });

  it('agrees with the built-in track: forward is the start direction', () => {
    const start = oval.start.position;
    const ahead = v(start.x + 10 * Math.cos(oval.start.heading), start.y + 10 * Math.sin(oval.start.heading));
    expect(forwardCrossing(gate, start, ahead)).not.toBeNull();
  });
});

describe('laps', () => {
  it('starts waiting for gate 0 with no laps', () => {
    expect(createProgress()).toEqual({ tick: 0, nextGate: 0, gatesPassed: 0, lapStartTick: null, lapTicks: [] });
  });

  it('times a scripted lap in ticks: crossing gate 0 starts it, the next gate 0 crossing after all others ends it', () => {
    // 2000 evenly spaced points per lap from the start pose, so every lap is exactly 2000 ticks long.
    const step = LAP_LENGTH / 2000;
    const states = follow(along(START_S, step, 4500));
    // Gate 0 (s = 60) is first passed at the first point beyond it: tick ceil(6 / step).
    const firstCross = Math.ceil((60 - START_S) / step);
    expect(states[firstCross - 1]!.lapStartTick).toBeNull();
    expect(states[firstCross]).toMatchObject({ nextGate: 1, gatesPassed: 1, lapStartTick: firstCross });
    expect(states[firstCross + 1999]!.lapTicks).toEqual([]);
    expect(states[firstCross + 2000]).toMatchObject({ lapTicks: [2000], lapStartTick: firstCross + 2000, nextGate: 1 });
    const end = last(states);
    expect(end.tick).toBe(4499);
    expect(end.lapTicks).toEqual([2000, 2000]);
    // Gate 0 once to start, then 20 gates per lap.
    expect(states[firstCross + 4000]!.gatesPassed).toBe(1 + 2 * 20);
    expect(lapSeconds(end.lapTicks[0]!, DT)).toBeCloseTo(2000 / 60, 12);
  });

  it('counts every gate once per lap, in order', () => {
    const states = follow(along(START_S, 0.5, Math.ceil(LAP_LENGTH / 0.5) + 30));
    const order = states.slice(1).filter((s, i) => s.gatesPassed > states[i]!.gatesPassed).map((s, i, all) => (i === 0 ? 0 : all[i - 1]!.nextGate));
    expect(order).toEqual([...Array.from({ length: 20 }, (_, i) => i), 0]);
    expect(last(states).lapTicks).toHaveLength(1);
  });

  it('gives a car driving the circuit backwards no credit at all', () => {
    const states = follow(along(START_S, -0.5, 3 * Math.ceil(LAP_LENGTH / 0.5)));
    expect(last(states)).toMatchObject({ nextGate: 0, gatesPassed: 0, lapStartTick: null, lapTicks: [] });
  });

  it('gives a car that turns round after the start line nothing more, and no lap when it comes back', () => {
    // Cross gate 0, drive back to the start, then all the way round backwards to just before gate 0.
    const forward = along(START_S, 0.5, 30); // to s = 68.5
    const back = along(68.5, -0.5, Math.ceil((LAP_LENGTH - 10) / 0.5)); // backwards to about s = 68.5 − (L − 10)
    const states = follow([...forward, ...back]);
    expect(last(states)).toMatchObject({ nextGate: 1, gatesPassed: 1, lapTicks: [] });
  });

  it('ignores gates crossed out of order, and still counts the right gate when it comes', () => {
    // Over gate 0, then round the end of gate 1 off the road (y = 50, beyond its outer end at y = 47),
    // over gate 2, then back behind gate 1 and properly over it.
    const path = [v(-2, 40), v(2, 40), v(25, 50), v(35, 50), v(65, 40), v(25, 40), v(35, 40)];
    const states = follow(path);
    expect(states[4]).toMatchObject({ nextGate: 1, gatesPassed: 1 }); // gate 2 crossed, ignored
    expect(states[6]).toMatchObject({ nextGate: 2, gatesPassed: 2 }); // gate 1 now counts
  });

  it('needs the whole ordered sequence for a lap: a skipped gate blocks the lap', () => {
    // A full lap that goes round the outside of gate 10 instead of through it.
    const step = 0.5;
    const points = along(START_S, step, Math.ceil(LAP_LENGTH / step) + 30).map((p) =>
      p.y < -30 && Math.abs(p.x) < 5 ? v(p.x, -60) : p, // detour beyond gate 10's outer end (y = −47)
    );
    const end = last(follow(points));
    expect(end.nextGate).toBe(10);
    expect(end.gatesPassed).toBe(10);
    expect(end.lapTicks).toEqual([]);
  });

  it('gives one credit for crossing a gate back and forth', () => {
    const wobble = [v(-1, 40), ...Array.from({ length: 20 }, (_, i) => v(i % 2 === 0 ? 1 : -1, 40))];
    const end = last(follow(wobble));
    expect(end).toMatchObject({ nextGate: 1, gatesPassed: 1, lapStartTick: 1, lapTicks: [] });
  });

  it('gives one credit for lingering on a gate line, when the car leaves it forwards', () => {
    const path = [v(-1, 40), ...Array.from({ length: 10 }, () => v(0, 40)), v(0.5, 40), v(0.5, 40), v(1, 40)];
    const states = follow(path);
    expect(states[10]).toMatchObject({ nextGate: 0, gatesPassed: 0 }); // on the line: not yet
    expect(states[11]).toMatchObject({ nextGate: 1, gatesPassed: 1, lapStartTick: 11 });
    expect(last(states)).toMatchObject({ nextGate: 1, gatesPassed: 1 });
  });

  it('counts a car that starts exactly on the start line when it first moves forwards', () => {
    const states = follow([v(0, 40), v(0, 40), v(0.3, 40)]);
    expect(states[1]!.lapStartTick).toBeNull();
    expect(states[2]).toMatchObject({ nextGate: 1, gatesPassed: 1, lapStartTick: 2 });
  });

  it('counts several gates crossed in one long step, in order, and can complete a lap in that step', () => {
    // One 70 m step from s = 54 crosses gates 0 (x = 0), 1 (x = 30) and 2 (x = 60).
    const states = follow([v(-6, 40), v(64, 40)]);
    expect(states[1]).toMatchObject({ nextGate: 3, gatesPassed: 3, lapStartTick: 1 });
    // From just before gate 19 with everything else done, one step over gates 19 and 0 ends the lap.
    const almost: LapProgress = { tick: 500, nextGate: 19, gatesPassed: 19, lapStartTick: 10, lapTicks: [] };
    expect(follow([v(-35, 40), v(5, 40)], oval, almost)[1]).toMatchObject({
      nextGate: 1,
      gatesPassed: 21,
      lapStartTick: 501,
      lapTicks: [491],
    });
  });

  it('does not count a later gate that a long step crosses before the next one', () => {
    // Waiting for gate 1 (x = 30); this step crosses gate 2 (x = 60) first, then comes back over gate 1
    // backwards: nothing counts.
    const waiting: LapProgress = { tick: 5, nextGate: 1, gatesPassed: 1, lapStartTick: 1, lapTicks: [] };
    expect(follow([v(55, 40), v(65, 40)], oval, waiting)[1]).toMatchObject({ nextGate: 1, gatesPassed: 1 });
  });

  it('within one step, counts a gate only if it is crossed after the one before it', () => {
    // Gate 0 at x = 10 (y 0–11) and gate 1 at x = 5 (y 19–30), both forward in +x. A step from (0, 30)
    // to (12, 6) crosses gate 1 first (at 5/12 of the way) and gate 0 later (at 10/12): only gate 0 counts,
    // because gate 1 was passed before it.
    const outer = [v(-50, -50), v(50, -50), v(50, 50), v(-50, 50)];
    const inner = [v(40, 40), v(45, 40), v(45, 45)];
    const gates = [{ a: v(10, 0), b: v(10, 11) }, { a: v(5, 19), b: v(5, 30) }, { a: v(30, 0), b: v(30, 30) }];
    const track = loadTrack({ id: 'gates', version: '1', name: 'Gates', outer, inner, start: { position: v(0, 0), heading: 0 }, gates });
    expect(forwardCrossing(gates[1]!, v(0, 30), v(12, 6))).toBeCloseTo(5 / 12, 12);
    expect(forwardCrossing(gates[0]!, v(0, 30), v(12, 6))).toBeCloseTo(10 / 12, 12);
    expect(advanceProgress(createProgress(), v(0, 30), v(12, 6), track)).toMatchObject({ nextGate: 1, gatesPassed: 1 });
  });

  it('never changes the progress it was given', () => {
    const before = createProgress();
    const after = advanceProgress(before, v(-1, 40), v(1, 40), oval);
    expect(before).toEqual(createProgress());
    expect(after).not.toBe(before);
    const lapped = follow(along(START_S, LAP_LENGTH / 400, 900));
    const frozenCopy = structuredClone(lapped[500]!);
    advanceProgress(lapped[500]!, v(-1, 40), v(1, 40), oval);
    expect(lapped[500]).toEqual(frozenCopy);
  });
});

describe('driving with physics and collision', () => {
  function drive(ticks: number, targetSpeed: number): Racer[] {
    const racers: Racer[] = [{ car: createCar(oval.start, oval, PHYSICS), progress: createProgress() }];
    for (let i = 0; i < ticks; i += 1) {
      const r = racers[i]!;
      racers.push(stepRacer(r, pursuit(r.car, targetSpeed), oval, PHYSICS, DT));
    }
    return racers;
  }

  it('counts and times laps for a car driven round the oval, without crashing', () => {
    const racers = drive(60 * 130, 12); // 130 s at about 12 m/s: three laps of about 41 s
    const end = last(racers);
    expect(end.car.crashed).toBe(false);
    expect(end.progress.lapTicks).toHaveLength(3);
    for (const ticks of end.progress.lapTicks) {
      // About 491.3 m / 12 m/s = 41 s; the car cuts the corners a little.
      expect(lapSeconds(ticks, DT)).toBeGreaterThan(38);
      expect(lapSeconds(ticks, DT)).toBeLessThan(43);
    }
    // Steady laps take the same number of ticks to within a few.
    expect(Math.abs(end.progress.lapTicks[1]! - end.progress.lapTicks[2]!)).toBeLessThanOrEqual(2);
    expect(end.progress.tick).toBe(60 * 130);
    // Deterministic: the same drive gives the same progress.
    expect(last(drive(60 * 130, 12)).progress).toEqual(end.progress);
  });

  it('credits gates on the tick the rear axle passes them, at top speed', () => {
    // Full throttle from the start along the bottom straight: gates 0, 1 and 2 are at x = 0, 30 and 60.
    const racers: Racer[] = [{ car: createCar(oval.start, oval, PHYSICS), progress: createProgress() }];
    while (!last(racers).car.crashed) racers.push(stepRacer(last(racers), { steering: 0, throttle: 1, brake: 0 }, oval, PHYSICS, DT));
    for (const [gate, x] of [[0, 0], [1, 30], [2, 60]] as const) {
      const tick = racers.findIndex((r) => r.car.vehicle.position.x > x);
      expect(racers[tick]!.progress.gatesPassed).toBe(gate + 1);
      expect(racers[tick - 1]!.progress.gatesPassed).toBe(gate);
    }
    // It crashes on the right-hand curve before gate 3, and earns nothing more however long it sits there.
    const crashed = last(racers);
    expect(crashed.progress.gatesPassed).toBe(3);
    let later = crashed;
    for (let i = 0; i < 120; i += 1) later = stepRacer(later, { steering: 0, throttle: 1, brake: 0 }, oval, PHYSICS, DT);
    expect(later.progress).toEqual({ ...crashed.progress, tick: crashed.progress.tick + 120 });
  });

  it('gives no credit for a gate the car would cross in the same tick it hits a wall', () => {
    // A square track; a gate across the bottom road at x = 50, from the infield (y = 60) to the wall (y = 100).
    const square = (x0: number, y0: number, x1: number, y1: number) => [v(x0, y0), v(x1, y0), v(x1, y1), v(x0, y1)];
    const gates = [
      { a: v(50, 60), b: v(50, 100) },
      { a: v(60, 50), b: v(100, 50) },
      { a: v(40, 50), b: v(0, 50) },
    ];
    const box = loadTrack({ id: 'box', version: '1', name: 'Box', outer: square(0, 0, 100, 100), inner: square(40, 40, 60, 60), start: { position: v(45, 80), heading: 0 }, gates });
    // Rear axle 0.1 m behind the gate, nose angled 0.003 rad into the wall at y = 100: this tick's 0.4 m
    // move would cross the gate, but the front-right corner would touch the wall during it.
    const vehicle = { position: v(49.9, 98.99), heading: 0.003, speed: PHYSICS.maxSpeed };
    expect(footprintHitsTrack(vehicleFootprint(vehicle, PHYSICS), box)).toBe(false);
    const racer: Racer = { car: { vehicle, crashed: false }, progress: createProgress() };
    const next = stepRacer(racer, { steering: 0, throttle: 1, brake: 0 }, box, PHYSICS, DT);
    expect(next.car.crashed).toBe(true);
    expect(next.car.vehicle.position).toEqual(vehicle.position);
    expect(next.progress).toEqual({ ...createProgress(), tick: 1 });
    // The same move without the wall would have counted.
    const moved = v(49.9 + 0.39, 98.99);
    expect(advanceProgress(createProgress(), vehicle.position, moved, box).gatesPassed).toBe(1);
  });

  it('keeps each car\'s progress separate', () => {
    // Two cars stepped side by side, one driving, one parked: the parked car's progress never moves.
    let driving: Racer = { car: createCar(oval.start, oval, PHYSICS), progress: createProgress() };
    const parkedStart: Pose = { position: v(-20, 40), heading: 0 };
    let parked: Racer = { car: createCar(parkedStart, oval, PHYSICS), progress: createProgress() };
    for (let i = 0; i < 600; i += 1) {
      driving = stepRacer(driving, pursuit(driving.car, 12), oval, PHYSICS, DT);
      parked = stepRacer(parked, { steering: 0, throttle: 0, brake: 1 }, oval, PHYSICS, DT);
    }
    expect(driving.progress.gatesPassed).toBeGreaterThan(3);
    expect(parked.progress).toEqual({ ...createProgress(), tick: 600 });
    expect(driving.progress.lapTicks).not.toBe(parked.progress.lapTicks);
  });
});
