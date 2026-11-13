// The in-page headless benchmark's controller (`?mode=bench`): the address settings, the run, cancel, interrupt and failure paths, that the work it reports is
// exactly the work of the core job whatever the slicing, and the rows it shows. Driven with a fake clock and a fake `defer`, so nothing here times a real machine
// and nothing is a result about learning. The browser run of the page is in tests/e2e/bench.spec.ts.
import { describe, expect, it } from 'vitest';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { runCarTickBenchmark } from '../../src/training/benchmark';
import { tracksIn } from '../../src/training/trackSplits';
import {
  BENCH_DEFAULT_CAR_TICKS,
  BENCH_POPULATION,
  BENCH_SEED,
  BENCH_WARMUP_CAR_TICKS,
  benchSettingsFromSearch,
  createBenchController,
  type BenchCircuit,
  type BenchController,
} from '../../src/ui/benchController';
import { trainingConfigFor } from '../../src/ui/trainingCircuit';

const IDS = ['stadium-oval', 'kidney-loop', 'silverstone'];

describe('the address settings', () => {
  it.each([
    ['', 'silverstone', BENCH_DEFAULT_CAR_TICKS],
    ['?mode=bench', 'silverstone', BENCH_DEFAULT_CAR_TICKS],
    ['?mode=bench&circuit=stadium-oval', 'stadium-oval', BENCH_DEFAULT_CAR_TICKS],
    ['?circuit=kidney-loop&circuit=stadium-oval', 'stadium-oval', BENCH_DEFAULT_CAR_TICKS],
    ['?circuit=s-sweepers', 'silverstone', BENCH_DEFAULT_CAR_TICKS], // a validation circuit is not a benchmark circuit
    ['?circuit=technical-narrow', 'silverstone', BENCH_DEFAULT_CAR_TICKS], // nor is a held-out one
    ['?circuit=%20kidney-loop%20', 'kidney-loop', BENCH_DEFAULT_CAR_TICKS],
    ['?carticks=1000', 'silverstone', 1000],
    ['?carticks=2000000', 'silverstone', 2_000_000],
    ['?carticks=%2020000%20', 'silverstone', 20_000],
    ['?carticks=999', 'silverstone', BENCH_DEFAULT_CAR_TICKS],
    ['?carticks=2000001', 'silverstone', BENCH_DEFAULT_CAR_TICKS],
    ['?carticks=60.5', 'silverstone', BENCH_DEFAULT_CAR_TICKS],
    ['?carticks=abc', 'silverstone', BENCH_DEFAULT_CAR_TICKS],
    ['?carticks=-5000', 'silverstone', BENCH_DEFAULT_CAR_TICKS],
    ['?carticks=5000&carticks=7000', 'silverstone', 7000],
  ])('%s -> %s, %i car-ticks', (search, circuit, carTicks) => {
    expect(benchSettingsFromSearch(search, IDS)).toEqual({ circuit, carTicks });
  });

  it('falls back to the first available circuit when Silverstone is not among them', () => {
    expect(benchSettingsFromSearch('', ['stadium-oval', 'kidney-loop']).circuit).toBe('stadium-oval');
  });
});

const circuits: BenchCircuit[] = tracksIn('training').map((t) => ({ id: t.id, name: t.track.name, track: t.track, limits: t.limits }));

/** A clock that advances one millisecond per read, and a deferral queue the test flushes itself. */
function setup(overrides: { carTicks?: number; circuit?: string; circuits?: BenchCircuit[]; sliceMs?: number } = {}) {
  let t = 0;
  const queue: (() => void)[] = [];
  let cancelled = 0;
  const controller = createBenchController({
    circuits: overrides.circuits ?? circuits,
    settings: { circuit: overrides.circuit ?? 'stadium-oval', carTicks: overrides.carTicks ?? 1000 },
    physics: DEFAULT_VEHICLE_PHYSICS,
    timestepSeconds: DEFAULT_SIM_CONFIG.timestepSeconds,
    clock: () => (t += 1),
    defer: (callback) => {
      const entry = () => callback();
      queue.push(entry);
      return () => {
        cancelled += 1;
        const at = queue.indexOf(entry);
        if (at >= 0) queue.splice(at, 1);
      };
    },
    context: { build: 'test-build', browser: 'Test Browser 1.0' },
    ...(overrides.sliceMs === undefined ? {} : { sliceMs: overrides.sliceMs }),
  });
  const flush = (limit = 100_000): number => {
    let slices = 0;
    while (queue.length > 0 && slices < limit) {
      queue.shift()!();
      slices += 1;
    }
    return slices;
  };
  return { controller, queue, flush, cancelledCount: () => cancelled };
}

const rowMap = (controller: BenchController) => Object.fromEntries(controller.rows().map((r) => [r.label, r.value]));

describe('a run', () => {
  it('starts idle, offers every training circuit, runs in slices through warm-up and measuring, and finishes with rows', () => {
    const { controller, flush, queue } = setup({ sliceMs: 3 });
    expect(controller.state()).toBe('idle');
    expect(controller.circuits().map((c) => c.id)).toEqual(IDS);
    expect(controller.selected()).toBe('stadium-oval');
    expect(controller.progress()).toBeNull();
    expect(controller.rows()).toEqual([]);
    const seen: string[] = [];
    controller.subscribe(() => {
      const p = controller.progress();
      if (p) seen.push(p.label.split(':')[0]!);
    });
    controller.run();
    expect(controller.state()).toBe('running');
    expect(queue).toHaveLength(1);
    expect(controller.message()).toContain('Keep this page in front');
    const slices = flush();
    expect(slices).toBeGreaterThan(2); // more than one slice: the work really was sliced
    expect(controller.state()).toBe('done');
    expect(new Set(seen)).toEqual(new Set(['Warming up (not timed)', 'Measuring']));
    expect(seen.indexOf('Measuring')).toBeGreaterThan(seen.indexOf('Warming up (not timed)'));
    expect(controller.progress()).toBeNull();
    expect(controller.message()).toContain('says nothing about learning');
    const rows = rowMap(controller);
    expect(Object.keys(rows)).toEqual([
      'Circuit',
      'Population and seed',
      'Work',
      'Mean running cars',
      'Compute time (inside slices only)',
      'Car-ticks per second',
      'Ticks per second at the full population of 50',
      'Build',
      'Browser',
    ]);
    expect(rows['Circuit']).toContain('Stadium oval');
    expect(rows['Population and seed']).toContain(`${BENCH_POPULATION} cars, seed ${BENCH_SEED}`);
    expect(rows['Build']).toBe('test-build');
    expect(rows['Browser']).toBe('Test Browser 1.0');
    expect(rows['Ticks per second at the full population of 50']).toMatch(/headless budget 600: (at least|below) 600/);
  });

  it('reports exactly the core job\'s work whatever the slicing, with its own timing', () => {
    const entry = circuits.find((c) => c.id === 'stadium-oval')!;
    const direct = runCarTickBenchmark(
      {
        environment: { track: entry.track, physics: DEFAULT_VEHICLE_PHYSICS, timestepSeconds: DEFAULT_SIM_CONFIG.timestepSeconds },
        config: { ...trainingConfigFor(entry.limits), seed: BENCH_SEED, populationSize: BENCH_POPULATION },
        warmupCarTicks: BENCH_WARMUP_CAR_TICKS,
        measureCarTicks: 1000,
        clock: (() => {
          let t = 0;
          return () => (t += 1);
        })(),
      },
      1e9,
    );
    for (const sliceMs of [1, 5, 40]) {
      const { controller, flush } = setup({ sliceMs });
      controller.run();
      flush();
      const result = controller.result()!;
      expect([result.carTicks, result.ticks, result.meanRunningCars]).toEqual([direct.carTicks, direct.ticks, direct.meanRunningCars]);
      expect(controller.rows()[2]!.value).toContain(`${result.carTicks.toLocaleString('en-GB')} car-ticks measured`);
    }
  });

  it('a second run after a finished one runs again from the start, with the same work', () => {
    const { controller, flush } = setup();
    controller.run();
    flush();
    const first = controller.result()!;
    controller.run();
    expect(controller.state()).toBe('running');
    expect(controller.rows()).toEqual([]); // the old result is cleared while it runs
    flush();
    expect([controller.result()!.carTicks, controller.result()!.ticks]).toEqual([first.carTicks, first.ticks]);
  });

  it('ignores run while running and notifies subscribers, which can unsubscribe', () => {
    const { controller, flush, queue } = setup();
    let calls = 0;
    const off = controller.subscribe(() => (calls += 1));
    controller.run();
    const before = calls;
    controller.run();
    expect(queue).toHaveLength(1);
    expect(calls).toBe(before);
    off();
    flush();
    expect(calls).toBe(before);
  });
});

describe('cancel, interrupt and failure report nothing', () => {
  it('cancel stops the run, cancels the pending slice, and leaves no rows and no result', () => {
    const { controller, queue, cancelledCount, flush } = setup({ sliceMs: 2 });
    controller.run();
    flush(3); // a few slices
    expect(controller.state()).toBe('running');
    controller.cancel();
    expect(controller.state()).toBe('cancelled');
    expect(controller.message()).toBe('Cancelled: nothing is reported.');
    expect(cancelledCount()).toBeGreaterThanOrEqual(1);
    expect(queue).toHaveLength(0);
    expect(controller.rows()).toEqual([]);
    expect(controller.result()).toBeNull();
    controller.cancel(); // cancelling again, or when nothing runs, does nothing
    expect(controller.state()).toBe('cancelled');
  });

  it('interrupt (the page left the foreground) ends a running run with a message and reports nothing; it does nothing when idle or finished', () => {
    const idle = setup();
    idle.controller.interrupt();
    expect(idle.controller.state()).toBe('idle');
    const { controller, flush } = setup({ sliceMs: 2 });
    controller.run();
    flush(2);
    controller.interrupt();
    expect(controller.state()).toBe('interrupted');
    expect(controller.message()).toContain('left the foreground');
    expect(controller.result()).toBeNull();
    expect(controller.rows()).toEqual([]);
    const done = setup();
    done.controller.run();
    done.flush();
    done.controller.interrupt();
    expect(done.controller.state()).toBe('done');
  });

  it('a run that cannot start fails with the reason and reports nothing', () => {
    const broken: BenchCircuit = { ...circuits[0]!, id: 'broken', name: 'Broken', limits: { maxEpisodeSeconds: -1, stallSeconds: 1, maxLaps: 1 } };
    const { controller, queue } = setup({ circuits: [broken], circuit: 'broken' });
    controller.run();
    expect(controller.state()).toBe('failed');
    expect(controller.message().length).toBeGreaterThan(0);
    expect(queue).toHaveLength(0);
    expect(controller.result()).toBeNull();
  });
});

describe('choosing a circuit', () => {
  it('is ignored while running and for an unknown circuit; after a result it clears the result and returns to idle', () => {
    const { controller, flush } = setup();
    controller.select('nonsense');
    controller.select('s-sweepers');
    expect(controller.selected()).toBe('stadium-oval');
    controller.run();
    controller.select('kidney-loop');
    expect(controller.selected()).toBe('stadium-oval');
    flush();
    expect(controller.state()).toBe('done');
    controller.select('kidney-loop');
    expect(controller.selected()).toBe('kidney-loop');
    expect(controller.state()).toBe('idle');
    expect(controller.rows()).toEqual([]);
    expect(controller.message()).toBe('');
  });

  it('runs the circuit chosen, with that circuit\'s own limits, and Silverstone reports its 2,356 segments', () => {
    const { controller, flush } = setup({ circuit: 'silverstone', carTicks: 1000 });
    controller.run();
    flush();
    expect(controller.state()).toBe('done');
    expect(controller.result()).toMatchObject({ trackId: 'silverstone', boundarySegments: 2356, populationSize: 50 });
    expect(controller.rows()[0]!.value).toContain('2,356 boundary segments');
  });
});
