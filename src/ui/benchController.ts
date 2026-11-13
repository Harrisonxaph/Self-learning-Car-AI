// The in-page headless benchmark (`?mode=bench`; the small follow-up the owner approved on 2026-11-13, so the reference phone can report its own headless
// ticks per second for the P2-11 budget). DOM-free: a deterministic state machine over the sliced fixed-work job (training/benchmark.ts), driven by an injected
// clock and `defer`, so it is tested in Node and the page (ui/benchPage.ts) is a thin shell.
//
// What it does: runs the REAL trainer on one training circuit (Silverstone by default) with a population of 50 and seed 1 for a fixed number of car-ticks after an
// untimed warm-up, in slices of about 12 ms so the page stays responsive, and reports the car-ticks per second and the ticks per second at the full population.
// Only the time inside slices counts. It stores nothing, saves no model, draws nothing, and the figure is about this phone, this browser and this build on the day:
// it says nothing about learning. A page that goes to the background is interrupted, because a throttled page's timing is not a measurement.
import {
  createCarTickBenchmarkJob,
  HEADLESS_BUDGET_TICKS_PER_SECOND,
  type CarTickBenchmarkJob,
  type CarTickBenchmarkResult,
} from '../training/benchmark';
import type { TrackLimits } from '../training/trackSplits';
import type { Track } from '../sim/track';
import type { VehiclePhysics } from '../sim/config';
import { trainingConfigFor } from './trainingCircuit';

export const BENCH_DEFAULT_CIRCUIT = 'silverstone';
export const BENCH_POPULATION = 50;
export const BENCH_SEED = 1;
/** Car-ticks run before timing starts: enough for the engine's start-up costs, not counted. */
export const BENCH_WARMUP_CAR_TICKS = 5000;
export const BENCH_DEFAULT_CAR_TICKS = 60_000;
export const BENCH_MIN_CAR_TICKS = 1000;
export const BENCH_MAX_CAR_TICKS = 2_000_000;
/** One slice of work, in milliseconds, before the page yields to the browser. */
export const BENCH_SLICE_MS = 12;

export interface BenchCircuit {
  readonly id: string;
  readonly name: string;
  readonly track: Track;
  readonly limits: TrackLimits | null;
}

export interface BenchSettings {
  readonly circuit: string;
  readonly carTicks: number;
}

/** The circuit and the measured car-ticks from the address: the last valid `circuit` (default Silverstone) and `carticks` (a whole number from 1,000 to 2,000,000, default 60,000). */
export function benchSettingsFromSearch(search: string, available: readonly string[]): BenchSettings {
  const params = new URLSearchParams(search);
  const circuits = params.getAll('circuit');
  const wantedCircuit = circuits[circuits.length - 1]?.trim();
  const circuit =
    wantedCircuit !== undefined && available.includes(wantedCircuit)
      ? wantedCircuit
      : available.includes(BENCH_DEFAULT_CIRCUIT)
        ? BENCH_DEFAULT_CIRCUIT
        : (available[0] ?? BENCH_DEFAULT_CIRCUIT);
  const counts = params.getAll('carticks');
  const wantedCount = counts[counts.length - 1]?.trim();
  const parsed = wantedCount !== undefined && /^\d+$/.test(wantedCount) ? Number(wantedCount) : Number.NaN;
  const carTicks = Number.isSafeInteger(parsed) && parsed >= BENCH_MIN_CAR_TICKS && parsed <= BENCH_MAX_CAR_TICKS ? parsed : BENCH_DEFAULT_CAR_TICKS;
  return { circuit, carTicks };
}

export type BenchState = 'idle' | 'running' | 'done' | 'cancelled' | 'interrupted' | 'failed';

export interface BenchProgress {
  readonly label: string;
  /** 0 to 1 within the current phase. */
  readonly fraction: number;
}

export interface BenchRow {
  readonly label: string;
  readonly value: string;
}

export interface BenchController {
  circuits(): readonly { readonly id: string; readonly name: string }[];
  selected(): string;
  select(id: string): void;
  carTicks(): number;
  state(): BenchState;
  /** Starts a run. Ignored while one is running. */
  run(): void;
  /** Cancels a running run: nothing is reported. */
  cancel(): void;
  /** Ends a running run because the page left the foreground: its timing would not be a measurement. */
  interrupt(): void;
  progress(): BenchProgress | null;
  /** The finished result as labelled rows, or an empty list. */
  rows(): readonly BenchRow[];
  /** The finished result itself (for the page's data attributes and the browser tests), or null. */
  result(): CarTickBenchmarkResult | null;
  message(): string;
  subscribe(listener: () => void): () => void;
}

export interface BenchDeps {
  readonly circuits: readonly BenchCircuit[];
  readonly settings: BenchSettings;
  readonly physics: VehiclePhysics;
  readonly timestepSeconds: number;
  /** A monotonic clock in milliseconds (performance.now). */
  readonly clock: () => number;
  /** Runs `callback` after the browser has had a turn; returns a function that cancels it. */
  readonly defer: (callback: () => void) => () => void;
  /** Where this reading was taken, for the result: the build and the browser. */
  readonly context: { readonly build: string; readonly browser: string };
  readonly sliceMs?: number;
}

const grouped = (n: number): string => n.toLocaleString('en-GB');

export function createBenchController(deps: BenchDeps): BenchController {
  const sliceMs = deps.sliceMs ?? BENCH_SLICE_MS;
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };
  let chosen = deps.settings.circuit;
  let stateNow: BenchState = 'idle';
  let messageText = '';
  let job: CarTickBenchmarkJob | null = null;
  let finished: CarTickBenchmarkResult | null = null;
  let cancelDefer: (() => void) | null = null;
  let circuitName = '';

  const stop = (state: BenchState, message: string): void => {
    cancelDefer?.();
    cancelDefer = null;
    stateNow = state;
    messageText = message;
    job = null;
    notify();
  };

  const slice = (): void => {
    cancelDefer = null;
    if (stateNow !== 'running' || job === null) return;
    let done: boolean;
    try {
      done = job.advance(sliceMs);
    } catch (error) {
      stop('failed', error instanceof Error ? error.message : 'The benchmark could not run.');
      return;
    }
    if (!done) {
      notify();
      cancelDefer = deps.defer(slice);
      return;
    }
    finished = job.result();
    stop('done', 'Finished. This is a figure for this phone, this browser and this build, on the day: it says nothing about learning.');
  };

  return {
    circuits: () => deps.circuits.map((c) => ({ id: c.id, name: c.name })),
    selected: () => chosen,
    select(id) {
      if (stateNow === 'running' || !deps.circuits.some((c) => c.id === id)) return;
      chosen = id;
      if (stateNow !== 'idle') {
        stateNow = 'idle';
        finished = null;
        messageText = '';
      }
      notify();
    },
    carTicks: () => deps.settings.carTicks,
    state: () => stateNow,
    run() {
      if (stateNow === 'running') return;
      const circuit = deps.circuits.find((c) => c.id === chosen);
      if (!circuit) return;
      finished = null;
      circuitName = circuit.name;
      try {
        job = createCarTickBenchmarkJob({
          environment: { track: circuit.track, physics: deps.physics, timestepSeconds: deps.timestepSeconds },
          config: { ...trainingConfigFor(circuit.limits), seed: BENCH_SEED, populationSize: BENCH_POPULATION },
          warmupCarTicks: BENCH_WARMUP_CAR_TICKS,
          measureCarTicks: deps.settings.carTicks,
          clock: deps.clock,
        });
      } catch (error) {
        stop('failed', error instanceof Error ? error.message : 'The benchmark could not start.');
        return;
      }
      stateNow = 'running';
      messageText = 'Running. Keep this page in front and the screen on until it finishes; leaving it stops the run.';
      notify();
      cancelDefer = deps.defer(slice);
    },
    cancel() {
      if (stateNow !== 'running') return;
      stop('cancelled', 'Cancelled: nothing is reported.');
    },
    interrupt() {
      if (stateNow !== 'running') return;
      stop('interrupted', 'The page left the foreground, so the timing would not be a measurement. Nothing is reported; keep the page in front and start again.');
    },
    progress() {
      if (stateNow !== 'running' || job === null) return null;
      const p = job.progress();
      const fraction = p.target > 0 ? Math.min(1, p.carTicks / p.target) : 1;
      const phase = p.phase === 'warm-up' ? 'Warming up (not timed)' : 'Measuring';
      return { label: `${phase}: ${grouped(p.carTicks)} of ${grouped(p.target)} car-ticks (${Math.floor(fraction * 100)}%)`, fraction };
    },
    rows() {
      const r = finished;
      if (stateNow !== 'done' || r === null) return [];
      const fixed = (v: number | null, d: number): string => (v === null ? 'no figure (the clock did not advance)' : v.toFixed(d));
      const full = r.ticksPerSecondFullPopulation;
      const verdict =
        full === null ? 'no figure' : full >= HEADLESS_BUDGET_TICKS_PER_SECOND ? `at least ${HEADLESS_BUDGET_TICKS_PER_SECOND}` : `below ${HEADLESS_BUDGET_TICKS_PER_SECOND}`;
      return [
        { label: 'Circuit', value: `${circuitName} (${r.trackId}, version ${r.trackVersion}), ${grouped(r.boundarySegments)} boundary segments` },
        { label: 'Population and seed', value: `${r.populationSize} cars, seed ${r.seed}, the real trainer, 7 rays plus collision per car per tick` },
        { label: 'Work', value: `${grouped(r.carTicks)} car-ticks measured (target ${grouped(r.measureCarTicks)}) after ${grouped(r.warmupCarTicks)} car-ticks of warm-up, ${grouped(r.ticks)} ticks` },
        { label: 'Mean running cars', value: r.meanRunningCars === null ? 'n/a' : r.meanRunningCars.toFixed(1) },
        { label: 'Compute time (inside slices only)', value: `${(r.computeMs / 1000).toFixed(2)} s` },
        { label: 'Car-ticks per second', value: fixed(r.carTicksPerSecond, 0) },
        { label: 'Ticks per second at the full population of 50', value: `${fixed(full, 1)} (headless budget ${HEADLESS_BUDGET_TICKS_PER_SECOND}: ${verdict})` },
        { label: 'Build', value: deps.context.build },
        { label: 'Browser', value: deps.context.browser },
      ];
    },
    result: () => (stateNow === 'done' ? finished : null),
    message: () => messageText,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
