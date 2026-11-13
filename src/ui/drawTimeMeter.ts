// The draw-time measurement behind `?debug=drawtime` (P4-07, plan section 6 "Performance measurement"): per-frame draw time over a trailing window of
// rendered frames, with p50, p95 and the largest value, and two proxies for a long task (frame gaps and single draws over 50 ms), because Safari does not
// provide the Long Tasks API. Pure: no DOM and no clock of its own, the caller passes each frame's time and costs, so tests drive it exactly. It reads and
// writes nothing the simulation uses; it is a measuring instrument for the owner's reference phone, not a result about any model.
//
// Method: a frame is `record(timeMs, drawMs, renderMs)`. The window keeps the newest `capacity` frames (default 600, the plan's minimum). Percentiles are
// nearest-rank on the window's values (p = sorted[ceil(p x n) - 1]). A gap is the time between two consecutive frames; a gap of `interruptMs` (default
// 1000 ms: a hidden or throttled tab) or a clock that goes backwards is an interruption and starts the window again, so paused time is never measured.

/** The plan's frame-count minimum for a reading. */
export const DRAW_TIME_WINDOW_FRAMES = 600;
/** A frame gap or a single draw above this counts as a long-task proxy (the Long Tasks API threshold). */
export const LONG_TASK_MS = 50;
/** The plan's budget: p95 draw time at most this many milliseconds. */
export const DRAW_BUDGET_P95_MS = 4;
/** A gap this long between two frames is an interruption, not a slow frame. */
export const DRAW_INTERRUPT_MS = 1000;
/** The P2-11 budget (rendered 1x only): p95 simulation update time per frame at most this many milliseconds. */
export const UPDATE_BUDGET_P95_MS = 8;

export interface DrawTimeOptions {
  readonly capacity?: number;
  readonly interruptMs?: number;
}

export interface DrawTimeSnapshot {
  /** Frames in the window now. */
  readonly frames: number;
  readonly capacity: number;
  readonly drawP50: number | null;
  readonly drawP95: number | null;
  readonly drawMax: number | null;
  /** The p95 of the whole render callback (camera, draw, readouts), for context. */
  readonly renderP95: number | null;
  /** Frame-to-frame gaps in the window above LONG_TASK_MS. */
  readonly gapsOver: number;
  /** Single draws in the window above LONG_TASK_MS. */
  readonly drawsOver: number;
  /** Frames in the CURRENT window that carry a simulation update time (P4-06 step 4); 0 when none do. */
  readonly updateFrames: number;
  /** The simulation update time per rendered frame: the milliseconds the frame's tick(s) took. At 1x that is one tick; at Max speed it is many. */
  readonly updateP50: number | null;
  readonly updateP95: number | null;
  readonly updateMax: number | null;
}

export interface DrawTimeMeter {
  /**
   * One rendered frame at `timeMs` whose camera draw took `drawMs` and whose whole render callback took `renderMs`; `updateMs` (optional) is the time the frame's
   * simulation tick(s) took. Non-finite or negative required figures drop the frame; a bad or missing `updateMs` only leaves the update series without it.
   */
  record(timeMs: number, drawMs: number, renderMs: number, updateMs?: number): void;
  reset(): void;
  snapshot(): DrawTimeSnapshot;
}

/** Nearest-rank percentile of a list of finite numbers, or null for an empty list. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0 || !(p >= 0 && p <= 1)) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(p * sorted.length));
  return sorted[rank - 1]!;
}

export function createDrawTimeMeter(options: DrawTimeOptions = {}): DrawTimeMeter {
  const capacity = Math.max(1, Math.floor(options.capacity ?? DRAW_TIME_WINDOW_FRAMES));
  const interruptMs = options.interruptMs ?? DRAW_INTERRUPT_MS;
  let times: number[] = [];
  let draws: number[] = [];
  let renders: number[] = [];
  // One entry per frame in the window: the frame's update time, or null when the page gave none, so a sample leaves the window with its own frame.
  let updates: (number | null)[] = [];
  const reset = (): void => {
    times = [];
    draws = [];
    renders = [];
    updates = [];
  };
  return {
    record(timeMs, drawMs, renderMs, updateMs) {
      if (![timeMs, drawMs, renderMs].every((v) => Number.isFinite(v)) || drawMs < 0 || renderMs < 0) return;
      const last = times[times.length - 1];
      if (last !== undefined && (timeMs < last || timeMs - last >= interruptMs)) reset();
      times.push(timeMs);
      draws.push(drawMs);
      renders.push(renderMs);
      updates.push(updateMs !== undefined && Number.isFinite(updateMs) && updateMs >= 0 ? updateMs : null);
      if (times.length > capacity) {
        times.shift();
        draws.shift();
        renders.shift();
        updates.shift();
      }
    },
    reset,
    snapshot() {
      const updateValues = updates.filter((u): u is number => u !== null);
      let gapsOver = 0;
      for (let i = 1; i < times.length; i += 1) if (times[i]! - times[i - 1]! > LONG_TASK_MS) gapsOver += 1;
      return {
        frames: times.length,
        capacity,
        drawP50: percentile(draws, 0.5),
        drawP95: percentile(draws, 0.95),
        drawMax: draws.length === 0 ? null : Math.max(...draws),
        renderP95: percentile(renders, 0.95),
        gapsOver,
        drawsOver: draws.filter((d) => d > LONG_TASK_MS).length,
        updateFrames: updateValues.length,
        updateP50: percentile(updateValues, 0.5),
        updateP95: percentile(updateValues, 0.95),
        updateMax: updateValues.length === 0 ? null : Math.max(...updateValues),
      };
    },
  };
}

/** The plan's verdict on a reading: unknown until the window holds the minimum frames, otherwise whether p95 is within the budget. */
export function budgetVerdict(snapshot: DrawTimeSnapshot): 'needs more frames' | 'within budget' | 'over budget' {
  if (snapshot.frames < snapshot.capacity || snapshot.drawP95 === null) return 'needs more frames';
  return snapshot.drawP95 <= DRAW_BUDGET_P95_MS ? 'within budget' : 'over budget';
}

/** The P2-11 verdict on a reading: unknown until the update series holds the minimum frames, otherwise whether its p95 is within the budget. Meaningful at 1x speed only. */
export function updateBudgetVerdict(snapshot: DrawTimeSnapshot): 'needs more frames' | 'within budget' | 'over budget' {
  if (snapshot.updateFrames < snapshot.capacity || snapshot.updateP95 === null) return 'needs more frames';
  return snapshot.updateP95 <= UPDATE_BUDGET_P95_MS ? 'within budget' : 'over budget';
}

/** The readout text. A figure that cannot be said yet shows "…"; the long-task figure says when the browser cannot report it. */
export function formatDrawTimeReadout(snapshot: DrawTimeSnapshot, longTasks: number | null, context: string): string {
  const ms = (v: number | null): string => (v === null ? '…' : `${v.toFixed(2)} ms`);
  const lines = [
    `Camera draw time: p50 ${ms(snapshot.drawP50)} · p95 ${ms(snapshot.drawP95)} · max ${ms(snapshot.drawMax)} · whole frame p95 ${ms(snapshot.renderP95)}`,
    `Frames ${snapshot.frames}/${snapshot.capacity} · frame gaps over ${LONG_TASK_MS} ms: ${snapshot.gapsOver} · draws over ${LONG_TASK_MS} ms: ${snapshot.drawsOver} · long tasks: ${longTasks === null ? 'not reported by this browser' : longTasks}`,
    `Plan budget (p95 at most ${DRAW_BUDGET_P95_MS} ms, at least ${snapshot.capacity} frames): ${budgetVerdict(snapshot)}`,
  ];
  // The simulation update lines (P4-06 step 4, the P2-11 budget) appear only when the page supplies update times, so a reading without them is unchanged.
  if (snapshot.updateFrames > 0) {
    lines.push(
      `Simulation update per frame: p50 ${ms(snapshot.updateP50)} · p95 ${ms(snapshot.updateP95)} · max ${ms(snapshot.updateMax)} · frames ${snapshot.updateFrames}/${snapshot.capacity}`,
      `P2-11 budget (1x speed only: p95 at most ${UPDATE_BUDGET_P95_MS} ms, at least ${snapshot.capacity} frames): ${updateBudgetVerdict(snapshot)}`,
    );
  }
  lines.push(context);
  return lines.join('\n');
}
