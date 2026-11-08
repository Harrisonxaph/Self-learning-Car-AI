// Speed, pause and drawing controls for the training view (P3-03). Everything here changes only how many fixed
// ticks run per rendered frame, and how many cars are drawn: the trainer still steps one fixed tick at a time and
// drawing only reads, so the results of a run are the same at every speed (tests/ui/trainingPageSpeed.test.ts).
import { createFixedStepClock, type FixedStepClock } from '../sim/fixedStep';
import type { SimConfig } from '../sim/config';

/** 1×, 4× and the fastest the device can manage. */
export type SpeedMode = 'normal' | 'fast' | 'max';

export const SPEED_MODES: readonly SpeedMode[] = ['normal', 'fast', 'max'];
export const SPEED_LABELS: Readonly<Record<SpeedMode, string>> = { normal: '1×', fast: '4×', max: 'Max' };

/** Real-time multiplier of the timed modes. */
export const FAST_MULTIPLIER = 4;
/** The most ticks one frame may be asked for at max speed. A time budget usually stops it far sooner. */
export const MAX_TICKS_PER_FRAME = 1000;
/** At max speed a frame stops running ticks once this much time has passed, so the page keeps drawing and responding. */
export const MAX_FRAME_BUDGET_MS = 8;
/** At max speed no more than this many cars are drawn, so drawing does not eat the time the ticks need. */
export const MAX_SPEED_DRAW_CAP = 10;
/** The choices for how many cars to draw. */
export const DRAW_CAPS: readonly number[] = [10, 25, 50];

/** How many cars to draw by default: fewer on a phone. Capped at the population. */
export function defaultDrawCap(isPhone: boolean, population: number): number {
  return Math.min(population, isPhone ? 25 : 50);
}

/** The number of cars actually drawn: the chosen cap, lowered at max speed, never above the population. */
export function effectiveDrawCap(mode: SpeedMode, cap: number, population: number): number {
  const limit = mode === 'max' ? Math.min(cap, MAX_SPEED_DRAW_CAP) : cap;
  return Math.max(0, Math.min(limit, population));
}

/**
 * Which cars to draw when only `cap` are drawn: cars that are still running come first, then the others, each in
 * population order. A pure choice of what to show; it changes nothing about the cars.
 */
export function pickCars<T extends { readonly episode: { readonly outcome: unknown } }>(cars: readonly T[], cap: number): T[] {
  if (cap >= cars.length) return [...cars];
  const picked: T[] = [];
  for (const car of cars) if (picked.length < cap && car.episode.outcome === null) picked.push(car);
  for (const car of cars) if (picked.length < cap && car.episode.outcome !== null) picked.push(car);
  return picked;
}

export interface SpeedControl extends FixedStepClock {
  readonly mode: SpeedMode;
  readonly paused: boolean;
  setMode(mode: SpeedMode): void;
  setPaused(paused: boolean): void;
}

/**
 * Turns elapsed time into ticks for the chosen speed: one tick per 1/60 s at 1×, four times that at 4×, and a large
 * number at max (which the stepper's time budget cuts short). While paused it returns no ticks and keeps no time,
 * and it drops any banked time whenever the mode or pause state changes, so nothing jumps or catches up afterwards.
 */
export function createSpeedControl(config: SimConfig): SpeedControl {
  const normal = createFixedStepClock(config);
  const fast = createFixedStepClock({ ...config, maxStepsPerFrame: config.maxStepsPerFrame * FAST_MULTIPLIER });
  let mode: SpeedMode = 'normal';
  let paused = false;
  const reset = () => {
    normal.reset();
    fast.reset();
  };
  return {
    get mode() {
      return mode;
    },
    get paused() {
      return paused;
    },
    setMode(next) {
      if (next !== mode) reset();
      mode = next;
    },
    setPaused(next) {
      if (next !== paused) reset();
      paused = next;
    },
    advance(elapsedSeconds) {
      if (paused) return 0;
      if (mode === 'normal') return normal.advance(elapsedSeconds);
      if (mode === 'fast') return fast.advance(elapsedSeconds * FAST_MULTIPLIER);
      return elapsedSeconds > 0 && Number.isFinite(elapsedSeconds) ? MAX_TICKS_PER_FRAME : 0;
    },
    reset,
  };
}

export interface FrameStepper {
  /** One tick for the frame loop. Returns false to stop the frame's remaining ticks (max speed, time budget used). */
  step(): boolean;
  /** Called once per rendered frame, after its ticks: the next frame gets a fresh budget. */
  endFrame(): void;
}

/**
 * The step handler for the frame loop. At 1× and 4× every tick the clock asks for runs. At max, ticks run until the
 * frame's time budget is used, but always at least one, so the run never stalls on a slow device.
 */
export function createFrameStepper(options: { readonly runTick: () => void; readonly mode: () => SpeedMode; readonly now: () => number; readonly budgetMs?: number }): FrameStepper {
  const budget = options.budgetMs ?? MAX_FRAME_BUDGET_MS;
  let startedAt: number | undefined;
  return {
    step() {
      if (options.mode() === 'max') {
        const now = options.now();
        if (startedAt === undefined) startedAt = now;
        else if (now - startedAt >= budget) return false;
      }
      options.runTick();
      return true;
    },
    endFrame() {
      startedAt = undefined;
    },
  };
}

/**
 * The part of the status line about speed and pause; empty at 1× while running. How many cars are drawn is shown by the
 * "Cars drawn" control itself, not here, so the status line stays short enough for a narrow phone.
 */
export function speedStatus(mode: SpeedMode, paused: boolean): string {
  const parts: string[] = [];
  if (paused) parts.push('paused');
  if (mode === 'fast') parts.push('4×');
  if (mode === 'max') parts.push('max');
  return parts.map((part) => ` · ${part}`).join('');
}
