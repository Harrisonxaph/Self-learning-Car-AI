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
}

export interface DrawTimeMeter {
  /** One rendered frame at `timeMs` whose camera draw took `drawMs` and whose whole render callback took `renderMs`. Non-finite or negative figures are ignored. */
  record(timeMs: number, drawMs: number, renderMs: number): void;
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
  const reset = (): void => {
    times = [];
    draws = [];
    renders = [];
  };
  return {
    record(timeMs, drawMs, renderMs) {
      if (![timeMs, drawMs, renderMs].every((v) => Number.isFinite(v)) || drawMs < 0 || renderMs < 0) return;
      const last = times[times.length - 1];
      if (last !== undefined && (timeMs < last || timeMs - last >= interruptMs)) reset();
      times.push(timeMs);
      draws.push(drawMs);
      renders.push(renderMs);
      if (times.length > capacity) {
        times.shift();
        draws.shift();
        renders.shift();
      }
    },
    reset,
    snapshot() {
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
      };
    },
  };
}

/** The plan's verdict on a reading: unknown until the window holds the minimum frames, otherwise whether p95 is within the budget. */
export function budgetVerdict(snapshot: DrawTimeSnapshot): 'needs more frames' | 'within budget' | 'over budget' {
  if (snapshot.frames < snapshot.capacity || snapshot.drawP95 === null) return 'needs more frames';
  return snapshot.drawP95 <= DRAW_BUDGET_P95_MS ? 'within budget' : 'over budget';
}

/** The readout text. A figure that cannot be said yet shows "…"; the long-task figure says when the browser cannot report it. */
export function formatDrawTimeReadout(snapshot: DrawTimeSnapshot, longTasks: number | null, context: string): string {
  const ms = (v: number | null): string => (v === null ? '…' : `${v.toFixed(2)} ms`);
  return [
    `Camera draw time: p50 ${ms(snapshot.drawP50)} · p95 ${ms(snapshot.drawP95)} · max ${ms(snapshot.drawMax)} · whole frame p95 ${ms(snapshot.renderP95)}`,
    `Frames ${snapshot.frames}/${snapshot.capacity} · frame gaps over ${LONG_TASK_MS} ms: ${snapshot.gapsOver} · draws over ${LONG_TASK_MS} ms: ${snapshot.drawsOver} · long tasks: ${longTasks === null ? 'not reported by this browser' : longTasks}`,
    `Plan budget (p95 at most ${DRAW_BUDGET_P95_MS} ms, at least ${snapshot.capacity} frames): ${budgetVerdict(snapshot)}`,
    context,
  ].join('\n');
}
