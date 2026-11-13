// The sliced fixed-work benchmark job (the in-page headless benchmark): the work is a fixed number of car-ticks and is bit-identical however it is sliced, the
// warm-up is not timed, only time inside slices counts, and every bad option is refused. Hand-checked with a fake clock that advances one millisecond per read.
// Nothing here measures a machine or says anything about learning.
import { describe, expect, it } from 'vitest';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { createCarTickBenchmarkJob, runCarTickBenchmark } from '../../src/training/benchmark';
import { createTrainer } from '../../src/training/trainer';
import { BUILT_IN_TRACK_SPLITS, trainingTrack } from '../../src/training/trackSplits';
import { trainingConfigFor } from '../../src/ui/trainingCircuit';

const environment = (id: string) => ({ track: trainingTrack(id), physics: DEFAULT_VEHICLE_PHYSICS, timestepSeconds: DEFAULT_SIM_CONFIG.timestepSeconds });
const configFor = (id: string, seed: number, populationSize: number) => ({
  ...trainingConfigFor(BUILT_IN_TRACK_SPLITS.tracks.find((t) => t.id === id)!.limits),
  seed,
  populationSize,
  eliteCount: 1,
});
/** A clock that advances by one millisecond on every read. */
const oneMsClock = () => {
  let t = 0;
  return () => (t += 1);
};

describe('the work is fixed and does not depend on how it is sliced', () => {
  const run = (sliceMs: number) =>
    runCarTickBenchmark({ environment: environment('silverstone'), config: configFor('silverstone', 7, 6), warmupCarTicks: 300, measureCarTicks: 1500, clock: oneMsClock() }, sliceMs);

  it('gives the same car-ticks, ticks and mean running cars with a tiny slice, a medium one and one huge slice', () => {
    const a = run(1);
    const b = run(7);
    const c = run(1e9);
    for (const r of [b, c]) expect([r.carTicks, r.ticks, r.meanRunningCars]).toEqual([a.carTicks, a.ticks, a.meanRunningCars]);
    expect(a.carTicks).toBeGreaterThanOrEqual(1500);
    expect(a.carTicks).toBeLessThan(1500 + 6); // it stops at the tick that reaches the target: at most one tick's six cars over
  });

  it('is the same work as the trainer\'s own first generation: a target equal to its total ends on its last tick', () => {
    const config = configFor('stadium-oval', 5, 6);
    const trainer = createTrainer(config, environment('stadium-oval'));
    const first = trainer.runGeneration();
    const r = runCarTickBenchmark({ environment: environment('stadium-oval'), config, warmupCarTicks: 0, measureCarTicks: first.totalEpisodeTicks, clock: oneMsClock() }, 3);
    expect(r.carTicks).toBe(first.totalEpisodeTicks);
    expect(r.ticks).toBe(first.generationTicks);
  });

  it('differs for another seed, and reports the circuit, its version and its boundary', () => {
    const a = run(50);
    const other = runCarTickBenchmark({ environment: environment('silverstone'), config: configFor('silverstone', 8, 6), warmupCarTicks: 300, measureCarTicks: 1500, clock: oneMsClock() });
    expect([other.carTicks, other.ticks]).not.toEqual([a.carTicks, a.ticks]);
    expect(a).toMatchObject({ trackId: 'silverstone', trackVersion: 'e59595d-27c51454e817', boundarySegments: 2356, populationSize: 6, seed: 7, warmupCarTicks: 300, measureCarTicks: 1500 });
  });
});

describe('only the measured time inside slices counts', () => {
  it('with no warm-up, one huge slice times exactly its ticks (one read per tick, the last tick reads once at the end), by hand', () => {
    const r = runCarTickBenchmark({ environment: environment('stadium-oval'), config: configFor('stadium-oval', 3, 6), warmupCarTicks: 0, measureCarTicks: 800, clock: oneMsClock() }, 1e9);
    // Reads: the slice start (timing begins), then one budget check per tick except the finishing tick, then the end read: ticks - 1 + 1 reads after the start.
    expect(r.computeMs).toBe(r.ticks);
  });

  it('a warm-up is run but not timed: the timing begins at the tick that ends it, so exactly one more read than the measured ticks is timed', () => {
    const r = runCarTickBenchmark({ environment: environment('stadium-oval'), config: configFor('stadium-oval', 3, 6), warmupCarTicks: 400, measureCarTicks: 800, clock: oneMsClock() }, 1e9);
    // The warm-up ticks cost no timed reads. After the timing start: the warm-up-ending tick's budget check, one check per measured tick except the last, the end read.
    expect(r.computeMs).toBe(r.ticks + 1);
    expect(r.carTicks).toBeGreaterThanOrEqual(800);
  });

  it('a slice ends at the warm-up boundary, even with a huge budget, so nothing measured runs before the caller can act (Codex, #185)', () => {
    const job = createCarTickBenchmarkJob({ environment: environment('stadium-oval'), config: configFor('stadium-oval', 3, 6), warmupCarTicks: 400, measureCarTicks: 50, clock: oneMsClock() });
    expect(job.progress().phase).toBe('warm-up');
    expect(job.advance(1e9)).toBe(false);
    expect(job.progress()).toEqual({ phase: 'measuring', carTicks: 0, target: 50 });
    expect(job.result()).toBeNull();
    expect(job.advance(1e9)).toBe(true);
    expect(job.result()!.carTicks).toBeGreaterThanOrEqual(50);
  });
  it('the pauses between slices are not counted: a clock that jumps a long way between slices adds nothing', () => {
    let t = 0;
    let inSlice = false;
    const clock = () => (t += inSlice ? 1 : 0);
    const job = createCarTickBenchmarkJob({ environment: environment('stadium-oval'), config: configFor('stadium-oval', 3, 6), warmupCarTicks: 0, measureCarTicks: 600, clock });
    let slices = 0;
    for (;;) {
      inSlice = true;
      const finished = job.advance(5);
      inSlice = false;
      t += 1_000_000; // the page yields to the browser for a long time
      slices += 1;
      if (finished) break;
    }
    expect(slices).toBeGreaterThan(1);
    expect(job.result()!.computeMs).toBeLessThan(1_000_000);
  });

  it('a clock that never advances gives no rates, never Infinity', () => {
    const r = runCarTickBenchmark({ environment: environment('stadium-oval'), config: configFor('stadium-oval', 3, 4), warmupCarTicks: 0, measureCarTicks: 200, clock: () => 5 });
    expect(r.computeMs).toBe(0);
    expect(r).toMatchObject({ carTicksPerSecond: null, ticksPerSecondFullPopulation: null });
  });

  it('with a one-second clock budget the rates follow by hand', () => {
    const r = runCarTickBenchmark({ environment: environment('stadium-oval'), config: configFor('stadium-oval', 3, 5), warmupCarTicks: 0, measureCarTicks: 500, clock: oneMsClock() }, 1e9);
    expect(r.carTicksPerSecond).toBeCloseTo(r.carTicks / (r.computeMs / 1000), 6);
    expect(r.ticksPerSecondFullPopulation).toBeCloseTo(r.carTicks / (r.computeMs / 1000) / 5, 6);
  });
});

describe('progress and the job\'s contract', () => {
  it('reports the warm-up, then the measuring phase, then done, with counts that only grow', () => {
    const job = createCarTickBenchmarkJob({ environment: environment('stadium-oval'), config: configFor('stadium-oval', 3, 6), warmupCarTicks: 200, measureCarTicks: 400, clock: oneMsClock() });
    expect(job.progress()).toEqual({ phase: 'warm-up', carTicks: 0, target: 200 });
    expect(job.result()).toBeNull();
    const phases: string[] = [];
    let last = -1;
    while (!job.advance(2)) {
      const p = job.progress();
      if (phases.at(-1) !== p.phase) {
        phases.push(p.phase);
        last = -1;
      }
      expect(p.carTicks).toBeGreaterThanOrEqual(last);
      last = p.carTicks;
    }
    phases.push(job.progress().phase);
    expect(phases).toEqual(['warm-up', 'measuring', 'done']);
    expect(job.progress().target).toBe(400);
    expect(job.advance(2)).toBe(true); // advancing a finished job changes nothing
    expect(job.result()!.carTicks).toBeGreaterThanOrEqual(400);
  });

  it('refuses bad options and a bad slice budget, naming the field', () => {
    const base = { environment: environment('stadium-oval'), config: configFor('stadium-oval', 1, 4), warmupCarTicks: 0, measureCarTicks: 100, clock: oneMsClock() };
    expect(() => createCarTickBenchmarkJob({ ...base, measureCarTicks: 0 })).toThrow(/"measureCarTicks"/);
    expect(() => createCarTickBenchmarkJob({ ...base, measureCarTicks: 10_000_001 })).toThrow(/"measureCarTicks"/);
    expect(() => createCarTickBenchmarkJob({ ...base, warmupCarTicks: -1 })).toThrow(/"warmupCarTicks"/);
    expect(() => createCarTickBenchmarkJob({ ...base, warmupCarTicks: 1.5 })).toThrow(/"warmupCarTicks"/);
    expect(() => createCarTickBenchmarkJob({ ...base, clock: undefined as never })).toThrow(/clock/);
    expect(() => createCarTickBenchmarkJob(null as never)).toThrow(/options/);
    const job = createCarTickBenchmarkJob(base);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => job.advance(bad)).toThrow(/budget/);
  });
});

describe('the pinned work of the in-page benchmark (what the owner\'s phone must report)', () => {
  // The default population (50), seed 1, 5,000 warm-up car-ticks and 1,000 measured: the simulated work is bit-identical on every machine, so the phone's page
  // (`?mode=bench&carticks=1000`) and `npm run bench -- --car-ticks 1000` must print exactly these counts; only the timing differs.
  it.each([
    ['silverstone', 1043, 21],
    ['stadium-oval', 1046, 21],
  ])('%s: %i car-ticks over %i ticks', (id, carTicks, ticks) => {
    const r = runCarTickBenchmark({ environment: environment(id), config: configFor(id, 1, 50), warmupCarTicks: 5000, measureCarTicks: 1000, clock: oneMsClock() });
    expect([r.carTicks, r.ticks]).toEqual([carTicks, ticks]);
  });
});
