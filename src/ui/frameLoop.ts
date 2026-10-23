// Runs the simulation in fixed ticks and draws once per animation frame, pausing while the page is hidden.
import type { FixedStepClock } from '../sim/fixedStep';

/** The browser features the loop needs, so tests can drive it with fake frames. */
export interface FrameEnvironment {
  requestFrame(callback: (timeMs: number) => void): number;
  cancelFrame(handle: number): void;
  isHidden(): boolean;
  /** Calls `onChange` when the page is hidden or shown; returns a function that stops listening. */
  onVisibilityChange(onChange: () => void): () => void;
}

export interface FrameLoopHandlers {
  /** Runs one fixed simulation tick. It is never told the frame time. */
  step(): void;
  /** Draws the current state once per frame. */
  render(): void;
}

export interface FrameLoop {
  stop(): void;
}

export function startFrameLoop(env: FrameEnvironment, clock: FixedStepClock, handlers: FrameLoopHandlers): FrameLoop {
  let handle: number | undefined;
  let lastTimeMs: number | undefined;

  const frame = (timeMs: number) => {
    handle = undefined;
    // The first frame after starting or returning only records the time, so time spent hidden never counts.
    const steps = lastTimeMs === undefined ? 0 : clock.advance((timeMs - lastTimeMs) / 1000);
    lastTimeMs = timeMs;
    for (let i = 0; i < steps; i += 1) handlers.step();
    handlers.render();
    handle = env.requestFrame(frame);
  };

  const pause = () => {
    if (handle !== undefined) env.cancelFrame(handle);
    handle = undefined;
    lastTimeMs = undefined;
    clock.reset();
  };

  const resume = () => {
    if (handle === undefined) handle = env.requestFrame(frame);
  };

  const unsubscribe = env.onVisibilityChange(() => (env.isHidden() ? pause() : resume()));
  if (!env.isHidden()) resume();

  return {
    stop() {
      unsubscribe();
      pause();
    },
  };
}

export function browserFrameEnvironment(win: Window = window): FrameEnvironment {
  const doc = win.document;
  return {
    requestFrame: (callback) => win.requestAnimationFrame(callback),
    cancelFrame: (handle) => win.cancelAnimationFrame(handle),
    isHidden: () => doc.visibilityState === 'hidden',
    onVisibilityChange(onChange) {
      doc.addEventListener('visibilitychange', onChange);
      return () => doc.removeEventListener('visibilitychange', onChange);
    },
  };
}
