// Simulation settings. Every run and saved model records these, so change them deliberately.

export interface SimConfig {
  /** Simulated time per tick, in seconds. The simulation only ever advances by this amount. */
  readonly timestepSeconds: number;
  /** Most ticks run in one animation frame; a slow device slows down instead of falling further behind. */
  readonly maxStepsPerFrame: number;
}

export const DEFAULT_SIM_CONFIG: SimConfig = Object.freeze({
  timestepSeconds: 1 / 60,
  maxStepsPerFrame: 5,
});

/**
 * Car physics constants, in metres, seconds and radians. These are the `physics` block saved with every
 * experiment and model (docs/MODEL_FORMAT.md), so the names match that document.
 */
export interface VehiclePhysics {
  /** Distance between the axles, m. Sets how tightly a given wheel angle turns the car. */
  readonly wheelbase: number;
  /** Forward acceleration at full throttle, before drag, m/s². */
  readonly engineAcceleration: number;
  /** Deceleration at full brake, m/s². */
  readonly brakeDeceleration: number;
  /** Air drag: deceleration = quadraticDrag × speed², 1/m. */
  readonly quadraticDrag: number;
  /** Rolling resistance: deceleration = rollingResistance × speed, 1/s. */
  readonly rollingResistance: number;
  /** Largest front-wheel angle, used at low speed, rad. */
  readonly maxSteerRadians: number;
  /** Sideways acceleration the steering may ask for; limits the wheel angle at high speed, m/s². */
  readonly maxLateralAcceleration: number;
  /** Below this speed with no throttle the car is treated as stopped, m/s. */
  readonly stopSpeed: number;
  /** Car body size, m. Used by collision (P1-06) and drawing; not by the motion itself. */
  readonly vehicleLength: number;
  readonly vehicleWidth: number;
  /**
   * Top speed, m/s: the terminal speed at full throttle, where engine acceleration equals drag plus rolling
   * resistance. Always derived with terminalSpeed(), never set by hand.
   */
  readonly maxSpeed: number;
}

/**
 * Speed where full throttle is balanced by drag and rolling resistance: the positive root of
 * quadraticDrag·v² + rollingResistance·v = engineAcceleration.
 *
 * Uses the form 2a / (r + √(r² + 4ca)), which equals the textbook (−r + √(r² + 4ca)) / 2c but has no
 * subtraction, so it stays accurate when drag is tiny (the textbook form cancels to 0 there) and needs no
 * special case for zero drag, where it gives a / r. With no drag and no rolling resistance nothing limits
 * the speed, so it returns Infinity.
 */
export function terminalSpeed(physics: Pick<VehiclePhysics, 'engineAcceleration' | 'quadraticDrag' | 'rollingResistance'>): number {
  const { engineAcceleration: a, quadraticDrag: c, rollingResistance: r } = physics;
  const denominator = r + Math.sqrt(r * r + 4 * c * a);
  return denominator === 0 ? Infinity : (2 * a) / denominator;
}

const PHYSICS_WITHOUT_MAX_SPEED = {
  wheelbase: 2.5,
  engineAcceleration: 8,
  brakeDeceleration: 12,
  quadraticDrag: 0.01,
  rollingResistance: 0.1,
  maxSteerRadians: 0.5,
  maxLateralAcceleration: 8,
  stopSpeed: 0.05,
  vehicleLength: 4,
  vehicleWidth: 2,
};

export const DEFAULT_VEHICLE_PHYSICS: VehiclePhysics = Object.freeze({
  ...PHYSICS_WITHOUT_MAX_SPEED,
  maxSpeed: terminalSpeed(PHYSICS_WITHOUT_MAX_SPEED),
});
