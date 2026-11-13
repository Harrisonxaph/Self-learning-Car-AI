// The DOM side of `?debug=drawtime` (P4-07): wraps the camera draw of a page with two clock reads, feeds the meter (ui/drawTimeMeter.ts) and refreshes a
// readout about four times a second. Opt in only: a page that is not given a probe never reads the clock for this. The probe only reads time and writes its own
// element and `data-draw-*` attributes; it never touches the simulation, the trainer or the camera, so a run is bit-identical with or without it (tested).
import { createDrawTimeMeter, formatDrawTimeReadout, type DrawTimeMeter } from './drawTimeMeter';

/** The part of an element the readout writes. */
export interface ReadoutElement {
  hidden: boolean | string;
  textContent: string | null;
}

export interface LongTaskSource {
  /** Whether the browser reports long tasks at all. */
  readonly supported: boolean;
  /** Long tasks counted since the last reset. */
  count(): number;
  reset(): void;
  stop(): void;
}

export interface DrawTimeProbeDeps {
  readonly element: ReadoutElement;
  /** A monotonic clock in milliseconds (performance.now in the browser). */
  readonly now: () => number;
  /** Where this reading was taken: camera zoom and mode, circuit, population, build. Read when the text is refreshed. */
  readonly context: () => string;
  /** Where the dataset (for the browser tests) is written, if anywhere. */
  readonly dataset?: Record<string, string | undefined> | undefined;
  readonly longTasks?: LongTaskSource | undefined;
  readonly meter?: DrawTimeMeter | undefined;
}

export interface DrawTimeProbe {
  /** Runs `draw` and times it. */
  measure(draw: () => void): void;
  /**
   * Ends a rendered frame at `timeMs` whose whole render callback took `renderMs` and whose simulation tick(s) took `updateMs` (optional, P4-06 step 4);
   * refreshes the readout about four times a second.
   */
  endFrame(timeMs: number, renderMs: number, updateMs?: number): void;
  reset(): void;
  stop(): void;
}

/** Counts long tasks (50 ms or more) with a PerformanceObserver where the browser has one; Safari does not, and then `supported` is false. */
export function browserLongTasks(win: { PerformanceObserver?: typeof PerformanceObserver } = globalThis as never): LongTaskSource {
  const Observer = win.PerformanceObserver;
  let total = 0;
  let observer: PerformanceObserver | null = null;
  const supported = Observer !== undefined && (Observer.supportedEntryTypes ?? []).includes('longtask');
  if (supported) {
    try {
      observer = new Observer((list) => {
        total += list.getEntries().length;
      });
      observer.observe({ type: 'longtask', buffered: false });
    } catch {
      observer = null;
    }
  }
  return {
    supported: observer !== null,
    count: () => total,
    reset: () => void (total = 0),
    stop: () => observer?.disconnect(),
  };
}

export function createDrawTimeProbe(deps: DrawTimeProbeDeps): DrawTimeProbe {
  const meter = deps.meter ?? createDrawTimeMeter();
  let lastDrawMs = 0;
  let lastReadoutMs = Number.NEGATIVE_INFINITY;
  deps.element.hidden = false;
  const refresh = (): void => {
    const snapshot = meter.snapshot();
    deps.element.textContent = formatDrawTimeReadout(snapshot, deps.longTasks?.supported ? deps.longTasks.count() : null, deps.context());
    const { dataset } = deps;
    if (dataset) {
      dataset.drawFrames = String(snapshot.frames);
      if (snapshot.drawP50 !== null) dataset.drawP50Ms = snapshot.drawP50.toFixed(3);
      else delete dataset.drawP50Ms;
      if (snapshot.drawP95 !== null) dataset.drawP95Ms = snapshot.drawP95.toFixed(3);
      else delete dataset.drawP95Ms;
      if (snapshot.updateP95 !== null) dataset.updateP95Ms = snapshot.updateP95.toFixed(3);
      else delete dataset.updateP95Ms;
    }
  };
  return {
    measure(draw) {
      const started = deps.now();
      draw();
      lastDrawMs = Math.max(0, deps.now() - started);
    },
    endFrame(timeMs, renderMs, updateMs) {
      meter.record(timeMs, lastDrawMs, renderMs, updateMs);
      lastDrawMs = 0;
      if (timeMs - lastReadoutMs < 250 && timeMs >= lastReadoutMs) return;
      lastReadoutMs = timeMs;
      refresh();
    },
    reset() {
      meter.reset();
      deps.longTasks?.reset();
      lastReadoutMs = Number.NEGATIVE_INFINITY;
    },
    stop() {
      deps.longTasks?.stop();
      deps.element.hidden = true;
    },
  };
}
