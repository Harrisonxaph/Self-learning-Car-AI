// A rate over a short trailing window, for the training view's frame-rate readout (P3-03). It has no DOM and no clock of
// its own: the caller passes the time of each event, so tests can drive it exactly.
//
// Method: events are `add(timeMs, count)` calls. The rate is the number of events after the first sample in the window,
// divided by the time from the first sample to the last, so n frame callbacks spanning s seconds give (n - 1) / s. It
// reports nothing (null) until at least `minSpanMs` has been seen, and it starts again from nothing, instead of averaging
// across an interruption, when the clock goes backwards or when two events are `gapResetMs` or more apart (a hidden or
// throttled tab, a long stall), and whenever `reset()` is called.

export interface RateMeterOptions {
  /** Samples older than this, measured from the newest, are dropped. Default 1000 ms. */
  readonly windowMs?: number;
  /** The span of samples needed before a rate is reported. Default 250 ms. */
  readonly minSpanMs?: number;
  /** A gap this long between two events is an interruption, and starts the measurement again. Default 500 ms. */
  readonly gapResetMs?: number;
}

export interface RateMeter {
  /** Records `count` events at `timeMs` (for a frame callback, count is 1). */
  add(timeMs: number, count?: number): void;
  /** Forgets everything measured so far. */
  reset(): void;
  /** Events per second over the window, or null while there is not enough to say. */
  rate(): number | null;
}

export const DEFAULT_RATE_WINDOW_MS = 1000;
export const DEFAULT_RATE_MIN_SPAN_MS = 250;
export const DEFAULT_RATE_GAP_RESET_MS = 500;

export function createRateMeter(options: RateMeterOptions = {}): RateMeter {
  const windowMs = options.windowMs ?? DEFAULT_RATE_WINDOW_MS;
  const minSpanMs = options.minSpanMs ?? DEFAULT_RATE_MIN_SPAN_MS;
  const gapResetMs = options.gapResetMs ?? DEFAULT_RATE_GAP_RESET_MS;
  let times: number[] = [];
  let counts: number[] = [];
  let head = 0;
  const reset = () => {
    times = [];
    counts = [];
    head = 0;
  };
  return {
    add(timeMs, count = 1) {
      if (!Number.isFinite(timeMs)) return;
      const last = times[times.length - 1];
      if (last !== undefined && (timeMs < last || timeMs - last >= gapResetMs)) reset();
      times.push(timeMs);
      counts.push(count);
      while (head < times.length - 1 && times[head]! < timeMs - windowMs) head += 1;
      if (head > 256) {
        times = times.slice(head);
        counts = counts.slice(head);
        head = 0;
      }
    },
    reset,
    rate() {
      const n = times.length - head;
      if (n < 2) return null;
      const span = times[times.length - 1]! - times[head]!;
      if (span < minSpanMs) return null;
      let events = 0;
      for (let i = head + 1; i < times.length; i += 1) events += counts[i]!;
      return events / (span / 1000);
    },
  };
}

/** The readout text. A rate that cannot be said yet shows "…", and the configuration is named so a reading is self-describing. */
export function formatRateReadout(frameRate: number | null, tickRate: number | null, config: string): string {
  const rate = (value: number | null) => (value === null ? '…' : value.toFixed(1));
  return `Render ${rate(frameRate)} frames/s · Simulation ${rate(tickRate)} ticks/s · ${config}`;
}
