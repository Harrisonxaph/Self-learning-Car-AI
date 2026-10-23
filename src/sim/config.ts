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
