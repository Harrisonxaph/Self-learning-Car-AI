import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS, terminalSpeed } from '../../src/sim/config';
import { createFixedStepClock } from '../../src/sim/fixedStep';
import {
  NO_CONTROLS,
  acceleration,
  clampControls,
  createVehicle,
  maxSteerAngle,
  stepVehicle,
  wrapAngle,
  type Controls,
  type VehicleState,
} from '../../src/sim/vehicle';
import { startFrameLoop, type FrameEnvironment } from '../../src/ui/frameLoop';
import { createRng } from '../../src/utils/rng';

const PHYSICS = DEFAULT_VEHICLE_PHYSICS;
const DT = DEFAULT_SIM_CONFIG.timestepSeconds;
const TICKS_PER_SECOND = 60;
const ORIGIN = { position: { x: 0, y: 0 }, heading: 0 };

/** Runs `ticks` steps with fixed controls and returns every state, starting with the initial one. */
function drive(start: VehicleState, controls: Controls, ticks: number): VehicleState[] {
  return driveWith(PHYSICS, start, controls, ticks);
}
function driveWith(physics: typeof PHYSICS, start: VehicleState, controls: Controls, ticks: number): VehicleState[] {
  const states = [start];
  for (let i = 0; i < ticks; i += 1) states.push(stepVehicle(states[i]!, controls, physics, DT));
  return states;
}
const last = <T>(items: readonly T[]) => items[items.length - 1]!;
const atSpeed = (speed: number): VehicleState => ({ ...createVehicle(ORIGIN), speed });
const FULL_THROTTLE: Controls = { steering: 0, throttle: 1, brake: 0 };
const FULL_BRAKE: Controls = { steering: 0, throttle: 0, brake: 1 };

describe('physics constants', () => {
  it('derive maxSpeed as the full-throttle terminal speed, matching docs/MODEL_FORMAT.md', () => {
    expect(PHYSICS.maxSpeed).toBe(terminalSpeed(PHYSICS));
    expect(PHYSICS.maxSpeed).toBeCloseTo(23.722813232690147, 12);
    expect(acceleration(PHYSICS.maxSpeed, FULL_THROTTLE, PHYSICS)).toBeCloseTo(0, 12);
    expect(Object.isFrozen(PHYSICS)).toBe(true);
  });

  it('match the physics block of the saved-model example in docs/MODEL_FORMAT.md exactly', () => {
    const doc = readFileSync(new URL('../../docs/MODEL_FORMAT.md', import.meta.url), 'utf8');
    const json = /```json\n([\s\S]*?)```/.exec(doc)?.[1];
    const example = JSON.parse(json ?? 'null') as { training: { configuration: { physics: unknown } } };
    expect(example.training.configuration.physics).toEqual({ ...PHYSICS });
  });

  it('use engine / rolling resistance as the terminal speed when there is no drag', () => {
    expect(terminalSpeed({ engineAcceleration: 8, quadraticDrag: 0, rollingResistance: 0.5 })).toBe(16);
  });

  it('stay accurate for tiny positive drag, where the textbook quadratic formula cancels to 0', () => {
    for (const quadraticDrag of [1e-20, 1e-12, 1e-6, 1e-3, 0.01, 1, 100]) {
      for (const rollingResistance of [0, 0.1, 2]) {
        const coefficients = { engineAcceleration: 8, quadraticDrag, rollingResistance };
        const v = terminalSpeed(coefficients);
        expect(v).toBeGreaterThan(0);
        // Force balance: the drag and resistance at v cancel the full-throttle acceleration.
        expect((quadraticDrag * v * v + rollingResistance * v) / 8).toBeCloseTo(1, 12);
      }
    }
    expect(terminalSpeed({ engineAcceleration: 8, quadraticDrag: 1e-20, rollingResistance: 0.1 })).toBeCloseTo(80, 9);
  });

  it('let a car with tiny drag actually move at full throttle', () => {
    const physics = { ...PHYSICS, quadraticDrag: 1e-20 };
    const lowDrag = { ...physics, maxSpeed: terminalSpeed(physics) };
    const end = last(driveWith(lowDrag, createVehicle(ORIGIN), FULL_THROTTLE, TICKS_PER_SECOND));
    expect(end.speed).toBeGreaterThan(7);
    expect(end.position.x).toBeGreaterThan(3);
  });

  it('give an unlimited terminal speed with no drag and no rolling resistance', () => {
    expect(terminalSpeed({ engineAcceleration: 8, quadraticDrag: 0, rollingResistance: 0 })).toBe(Infinity);
  });
});

describe('acceleration and terminal speed', () => {
  it('speeds up from rest under full throttle towards maxSpeed and never passes it', () => {
    const states = drive(createVehicle(ORIGIN), FULL_THROTTLE, 120 * TICKS_PER_SECOND);
    states.slice(1).forEach((s, i) => {
      expect(s.speed).toBeGreaterThanOrEqual(states[i]!.speed);
      expect(s.speed).toBeLessThanOrEqual(PHYSICS.maxSpeed);
    });
    expect(states[TICKS_PER_SECOND]!.speed).toBeGreaterThan(6); // about 7.5 m/s after 1 s
    expect(last(states).speed).toBeGreaterThan(PHYSICS.maxSpeed * 0.999);
  });

  it('reaches a lower terminal speed at half throttle', () => {
    const half = last(drive(createVehicle(ORIGIN), { steering: 0, throttle: 0.5, brake: 0 }, 120 * TICKS_PER_SECOND));
    const expected = terminalSpeed({ ...PHYSICS, engineAcceleration: 4 });
    expect(half.speed).toBeCloseTo(expected, 3);
    expect(half.speed).toBeLessThan(PHYSICS.maxSpeed);
  });

  it('moves along its heading in world metres', () => {
    const facingDown = createVehicle({ position: { x: 10, y: -5 }, heading: Math.PI / 2 });
    const after = last(drive(facingDown, FULL_THROTTLE, TICKS_PER_SECOND));
    expect(after.position.x).toBeCloseTo(10, 9);
    expect(after.position.y).toBeGreaterThan(-5 + 3); // y grows downwards
  });
});

describe('braking and coasting', () => {
  it('brakes from top speed to a full stop and never reverses', () => {
    const states = drive(atSpeed(PHYSICS.maxSpeed), FULL_BRAKE, 5 * TICKS_PER_SECOND);
    expect(states.every((s) => s.speed >= 0)).toBe(true);
    const stopTick = states.findIndex((s) => s.speed === 0);
    expect(stopTick).toBeGreaterThan(0);
    expect(stopTick / TICKS_PER_SECOND).toBeLessThan(2); // about 1.5 s with drag helping
    expect(states.slice(stopTick).every((s) => s.speed === 0)).toBe(true);
    // Once stopped, it stays exactly where it is.
    expect(last(states).position).toEqual(states[stopTick]!.position);
  });

  it('slows faster when braking than when coasting', () => {
    for (const speed of [2, 10, PHYSICS.maxSpeed]) {
      const braked = last(drive(atSpeed(speed), FULL_BRAKE, 30));
      const coasted = last(drive(atSpeed(speed), NO_CONTROLS, 30));
      expect(braked.speed).toBeLessThan(coasted.speed);
    }
  });

  it('coasts to rest without reversing, slowing down every tick', () => {
    const states = drive(atSpeed(PHYSICS.maxSpeed), NO_CONTROLS, 120 * TICKS_PER_SECOND);
    states.slice(1).forEach((s, i) => {
      expect(s.speed).toBeGreaterThanOrEqual(0);
      expect(s.speed).toBeLessThanOrEqual(states[i]!.speed);
    });
    expect(last(states).speed).toBe(0);
  });

  it('holds a stopped car when the brake is stronger than the throttle', () => {
    const held = drive(createVehicle(ORIGIN), { steering: 0, throttle: 0.5, brake: 1 }, 120);
    expect(held.every((s) => s.speed === 0 && s.position.x === 0)).toBe(true);
  });

  it('moves off when the throttle beats the brake, without flickering between moving and stopped', () => {
    const states = drive(createVehicle(ORIGIN), { steering: 0, throttle: 1, brake: 0.5 }, 120);
    states.slice(1).forEach((s, i) => expect(s.speed).toBeGreaterThan(states[i]!.speed));
  });
});

describe('steering', () => {
  it('cannot turn while stationary', () => {
    for (const steering of [-1, -0.3, 0.7, 1]) {
      const states = drive(createVehicle({ position: { x: 3, y: 4 }, heading: 1 }), { steering, throttle: 0, brake: 0 }, 300);
      expect(last(states)).toEqual({ position: { x: 3, y: 4 }, heading: 1, speed: 0 });
    }
  });

  it('turns right (clockwise on screen, heading increasing) for positive steering', () => {
    const right = last(drive(atSpeed(8), { steering: 1, throttle: 0.3, brake: 0 }, 30));
    expect(right.heading).toBeGreaterThan(0);
    expect(right.position.y).toBeGreaterThan(0);
  });

  it('turns left and right symmetrically', () => {
    for (const steering of [0.25, 0.6, 1]) {
      const right = last(drive(atSpeed(12), { steering, throttle: 0.5, brake: 0 }, 90));
      const left = last(drive(atSpeed(12), { steering: -steering, throttle: 0.5, brake: 0 }, 90));
      expect(left.speed).toBe(right.speed);
      expect(left.heading).toBeCloseTo(-right.heading, 12);
      expect(left.position.x).toBeCloseTo(right.position.x, 12);
      expect(left.position.y).toBeCloseTo(-right.position.y, 12);
    }
  });

  it('uses the full wheel angle at low speed and a smaller one at high speed', () => {
    expect(maxSteerAngle(0, PHYSICS)).toBe(PHYSICS.maxSteerRadians);
    expect(maxSteerAngle(3, PHYSICS)).toBe(PHYSICS.maxSteerRadians);
    expect(maxSteerAngle(PHYSICS.maxSpeed, PHYSICS)).toBeLessThan(0.05);
    for (let v = 1; v < PHYSICS.maxSpeed; v += 1) {
      expect(maxSteerAngle(v + 1, PHYSICS)).toBeLessThanOrEqual(maxSteerAngle(v, PHYSICS));
    }
  });

  it('never asks for more sideways acceleration than maxLateralAcceleration at full steering', () => {
    for (let v = 0.5; v <= PHYSICS.maxSpeed; v += 0.5) {
      const next = stepVehicle(atSpeed(v), { steering: 1, throttle: 0, brake: 0 }, PHYSICS, DT);
      const yawRate = (next.heading - 0) / DT;
      expect(next.speed * yawRate).toBeLessThanOrEqual(PHYSICS.maxLateralAcceleration + 1e-9);
    }
  });
});

describe('controls', () => {
  it('clamps finite values into their ranges', () => {
    expect(clampControls({ steering: 3, throttle: -2, brake: 7 })).toEqual({ steering: 1, throttle: 0, brake: 1 });
    expect(clampControls({ steering: -3, throttle: 2, brake: -1 })).toEqual({ steering: -1, throttle: 1, brake: 0 });
    // Clamped controls behave exactly like the in-range ones.
    const s = atSpeed(10);
    expect(stepVehicle(s, { steering: 5, throttle: 9, brake: 0 }, PHYSICS, DT)).toEqual(
      stepVehicle(s, { steering: 1, throttle: 1, brake: 0 }, PHYSICS, DT),
    );
  });

  it.each([
    ['NaN steering', { steering: Number.NaN, throttle: 0, brake: 0 }],
    ['infinite throttle', { steering: 0, throttle: Number.POSITIVE_INFINITY, brake: 0 }],
    ['a string brake', { steering: 0, throttle: 0, brake: '1' }],
    ['a missing steering value', { throttle: 1, brake: 0 }],
  ])('rejects %s instead of corrupting the car', (_label, controls) => {
    expect(() => stepVehicle(atSpeed(5), controls as unknown as Controls, PHYSICS, DT)).toThrow(RangeError);
  });

  it.each([
    ['NaN heading', { position: { x: 0, y: 0 }, heading: Number.NaN }],
    ['infinite heading', { position: { x: 0, y: 0 }, heading: Number.NEGATIVE_INFINITY }],
    ['NaN position', { position: { x: Number.NaN, y: 0 }, heading: 0 }],
    ['infinite position', { position: { x: 0, y: Number.POSITIVE_INFINITY }, heading: 0 }],
  ])('rejects a start pose with a %s', (_label, pose) => {
    expect(() => createVehicle(pose)).toThrow(RangeError);
  });

  it('starts stationary at a given pose without sharing the pose object', () => {
    const pose = { position: { x: -6, y: 40 }, heading: 0 };
    const car = createVehicle(pose);
    expect(car).toEqual({ position: { x: -6, y: 40 }, heading: 0, speed: 0 });
    expect(car.position).not.toBe(pose.position);
  });
});

describe('integration (semi-implicit Euler)', () => {
  it('updates speed first, then heading from the new speed, then position along the new heading', () => {
    const start = { position: { x: 1, y: 2 }, heading: 0.3, speed: 10 };
    const controls = { steering: 0.5, throttle: 0.4, brake: 0 };
    const { engineAcceleration, quadraticDrag, rollingResistance, wheelbase } = PHYSICS;
    const speed = 10 + (0.4 * engineAcceleration - quadraticDrag * 100 - rollingResistance * 10) * DT;
    const heading = 0.3 + ((speed * Math.tan(0.5 * maxSteerAngle(speed, PHYSICS))) / wheelbase) * DT;
    expect(stepVehicle(start, controls, PHYSICS, DT)).toEqual({
      position: { x: 1 + Math.cos(heading) * speed * DT, y: 2 + Math.sin(heading) * speed * DT },
      heading,
      speed,
    });
  });

  it('keeps the heading in (-π, π] when it passes ±π', () => {
    const nearPi = { position: { x: 0, y: 0 }, heading: Math.PI - 0.001, speed: 5 };
    const turned = stepVehicle(nearPi, { steering: 1, throttle: 0.5, brake: 0 }, PHYSICS, DT);
    expect(turned.heading).toBeLessThan(0);
    expect(turned.heading).toBeCloseTo(-Math.PI - 0.001 + (turned.speed * Math.tan(maxSteerAngle(turned.speed, PHYSICS))) / PHYSICS.wheelbase * DT, 12);
  });
});

describe('heading range', () => {
  const inRange = (heading: number) => heading > -Math.PI && heading <= Math.PI;

  it.each([
    ['π stays π', Math.PI, Math.PI],
    ['-π becomes π', -Math.PI, Math.PI],
    ['0 stays 0', 0, 0],
    ['2π becomes 0', 2 * Math.PI, 0],
    ['3π becomes π', 3 * Math.PI, Math.PI],
    ['7π becomes π', 7 * Math.PI, Math.PI],
    ['-7π becomes π', -7 * Math.PI, Math.PI],
    ['5 turns plus 1 rad becomes 1', 10 * Math.PI + 1, 1],
    ['-5 turns minus 1 rad becomes -1', -10 * Math.PI - 1, -1],
    ['π + 0.001 becomes -π + 0.001', Math.PI + 0.001, -Math.PI + 0.001],
  ])('wrapAngle: %s', (_label, angle, expected) => {
    const wrapped = wrapAngle(angle);
    expect(inRange(wrapped)).toBe(true);
    expect(wrapped).toBeCloseTo(expected, 9);
  });

  it('returns angles already in range unchanged, bit for bit', () => {
    for (const angle of [0, 1e-300, -1e-300, 1, -1, Math.PI, -Math.PI + 1e-15, Math.PI - 1e-15]) {
      expect(wrapAngle(angle)).toBe(angle);
    }
  });

  it('stays in range for huge angles', () => {
    for (const angle of [1e6, 1e15, 1e16, 1e17, 1e18, 1e19, 1e20, 2 ** 60 + 2 ** 9, 1e100, 1e300, Number.MAX_VALUE]) {
      expect(inRange(wrapAngle(angle))).toBe(true);
      expect(inRange(wrapAngle(-angle))).toBe(true);
      // Already wrapped, so wrapping again changes nothing.
      expect(wrapAngle(wrapAngle(angle))).toBe(wrapAngle(angle));
    }
  });

  it('keeps a huge start heading in range and unchanged by a stationary step', () => {
    for (const heading of [1e18, -1e18, Number.MAX_VALUE]) {
      const car = createVehicle({ position: { x: 0, y: 0 }, heading });
      expect(inRange(car.heading)).toBe(true);
      expect(stepVehicle(car, NO_CONTROLS, PHYSICS, DT).heading).toBe(car.heading);
    }
  });

  it.each([7 * Math.PI, -7 * Math.PI, 9 * Math.PI + 0.5, -9 * Math.PI - 0.5, Math.PI, -Math.PI, 2 * Math.PI])(
    'keeps a start heading of %s in (-π, π] after creation and after stepping',
    (heading) => {
      const car = createVehicle({ position: { x: 0, y: 0 }, heading });
      expect(inRange(car.heading)).toBe(true);
      expect(Math.cos(car.heading)).toBeCloseTo(Math.cos(heading), 9);
      expect(Math.sin(car.heading)).toBeCloseTo(Math.sin(heading), 9);
      for (const controls of [NO_CONTROLS, FULL_THROTTLE, { steering: 1, throttle: 1, brake: 0 }]) {
        expect(inRange(stepVehicle(car, controls, PHYSICS, DT).heading)).toBe(true);
      }
    },
  );
});

describe('determinism and stability', () => {
  /** Seeded random controls, changed every 20 ticks, as an AI driver might produce. */
  function randomRun(seed: number, ticks: number) {
    const rng = createRng(seed);
    let controls: Controls = NO_CONTROLS;
    let state = createVehicle(ORIGIN);
    const states = [state];
    for (let i = 0; i < ticks; i += 1) {
      if (i % 20 === 0) controls = { steering: rng.range(-1, 1), throttle: rng.next(), brake: rng.next() < 0.2 ? rng.next() : 0 };
      state = stepVehicle(state, controls, PHYSICS, DT);
      states.push(state);
    }
    return states;
  }

  it('stays finite and within its limits over 20,000 ticks of varied controls', () => {
    for (const s of randomRun(7, 20_000)) {
      expect([s.position.x, s.position.y, s.heading, s.speed].every(Number.isFinite)).toBe(true);
      expect(s.speed).toBeGreaterThanOrEqual(0);
      expect(s.speed).toBeLessThanOrEqual(PHYSICS.maxSpeed);
      expect(s.heading).toBeGreaterThan(-Math.PI);
      expect(s.heading).toBeLessThanOrEqual(Math.PI);
    }
  });

  it('gives bit-identical states for the same start, inputs and number of ticks', () => {
    expect(randomRun(42, 5000)).toEqual(randomRun(42, 5000));
    expect(last(randomRun(42, 5000))).not.toEqual(last(randomRun(43, 5000)));
  });
});

describe('render schedule independence', () => {
  /** Fake animation frames, as in tests/ui/frameLoop.test.ts. */
  function fakeFrames() {
    const pending = new Map<number, (time: number) => void>();
    let next = 1;
    const env: FrameEnvironment = {
      requestFrame: (callback) => {
        pending.set(next, callback);
        return next++;
      },
      cancelFrame: (handle) => pending.delete(handle),
      isHidden: () => false,
      onVisibilityChange: () => () => {},
    };
    const fire = (time: number) => {
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach((callback) => callback(time));
    };
    return { env, fire };
  }

  /** Controls chosen by tick number only, so the same tick always gets the same input. */
  const script = (tick: number): Controls =>
    tick < 180
      ? FULL_THROTTLE
      : tick < 360
        ? { steering: 0.6, throttle: 0.5, brake: 0 }
        : tick < 480
          ? NO_CONTROLS
          : FULL_BRAKE;

  /** Drives the scripted car through the real frame loop with frames every intervalMs, for 10 s. */
  function runAt(intervalMs: number) {
    const { env, fire } = fakeFrames();
    let car = createVehicle(ORIGIN);
    let tick = 0;
    startFrameLoop(env, createFixedStepClock(DEFAULT_SIM_CONFIG), {
      step: () => {
        car = stepVehicle(car, script(tick), PHYSICS, DT);
        tick += 1;
      },
      render: () => {},
    });
    const frames = Math.round(10_000 / intervalMs);
    for (let i = 0; i <= frames; i += 1) fire(i * intervalMs);
    return { tick, car };
  }

  it('gives the same car state at 30, 60 and 120 Hz and with uneven 25/45 ms frames', () => {
    const at60 = runAt(1000 / 60);
    expect(at60.tick).toBe(600);
    // Golden values pin the model: any change to the physics or integration order changes them.
    // Update them only together with a deliberate, documented physics change. (Computed in Node; Math.tan,
    // cos and sin may differ in their last bits in other engines, which is why only Node runs this.)
    expect(at60.car).toEqual({
      position: { x: 92.81889403138392, y: 42.322893234946086 },
      heading: 0.867645726492568,
      speed: 0,
    });
    expect(runAt(1000 / 30)).toEqual(at60);
    expect(runAt(1000 / 120)).toEqual(at60);
    // Uneven frames, all short enough that the 5-tick cap never drops time.
    const { env, fire } = fakeFrames();
    let car = createVehicle(ORIGIN);
    let tick = 0;
    startFrameLoop(env, createFixedStepClock(DEFAULT_SIM_CONFIG), {
      step: () => {
        car = stepVehicle(car, script(tick), PHYSICS, DT);
        tick += 1;
      },
      render: () => {},
    });
    let time = 0;
    fire(time);
    while (tick < 600) {
      time += tick % 2 === 0 ? 25 : 45;
      fire(time);
    }
    // Compare at the same tick count: replay the 60 Hz run to exactly this many ticks.
    let reference = createVehicle(ORIGIN);
    for (let t = 0; t < tick; t += 1) reference = stepVehicle(reference, script(t), PHYSICS, DT);
    expect(car).toEqual(reference);
  });
});
