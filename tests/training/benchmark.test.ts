// The headless benchmark core (P4-06 step 4): its arithmetic by hand with a fake clock, that the simulated work is deterministic and excludes the warm-up,
// its refusals, and the segment count of the two circuits it is run on. The wall-clock figures of a real run are a measurement of one machine; nothing here
// measures anything, and nothing is a result about learning.
import { describe, expect, it } from 'vitest';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { HEADLESS_BUDGET_TICKS_PER_SECOND, runBenchmark } from '../../src/training/benchmark';
import { createTrainer, DEFAULT_TRAINING_CONFIG } from '../../src/training/trainer';
import { trainingTrack } from '../../src/training/trackSplits';
import { trainingConfigFor } from '../../src/ui/trainingCircuit';
import { BUILT_IN_TRACK_SPLITS } from '../../src/training/trackSplits';

const environment = (id: string) => ({ track: trainingTrack(id), physics: DEFAULT_VEHICLE_PHYSICS, timestepSeconds: DEFAULT_SIM_CONFIG.timestepSeconds });
const configFor = (id: string, seed: number, populationSize: number) => ({
  ...trainingConfigFor(BUILT_IN_TRACK_SPLITS.tracks.find((t) => t.id === id)!.limits),
  seed,
  populationSize,
  eliteCount: 1,
});
/** A clock that advances by `step` ms on every read. */
const steppingClock = (step: number) => {
  let t = 0;
  return () => (t += step);
};

describe('the arithmetic, by hand with a fake clock', () => {
  it('times each measured generation with two reads, so wall time is generations x the step, and the rates follow', () => {
    const r = runBenchmark({ environment: environment('stadium-oval'), config: configFor('stadium-oval', 3, 6), warmupGenerations: 0, generations: 3, clock: steppingClock(10) });
    expect(r.wallMs).toBe(30); // three generations, 10 ms each
    expect(r.carTicksPerSecond).toBeCloseTo(r.carTicks / 0.03, 6);
    expect(r.ticksPerSecondFullPopulation).toBeCloseTo(r.carTicks / 0.03 / 6, 6);
    expect(r.ticksPerSecondObserved).toBeCloseTo(r.ticks / 0.03, 6);
    expect(r.meanRunningCars).toBeCloseTo(r.carTicks / r.ticks, 9);
    expect(r.meanRunningCars!).toBeGreaterThan(0);
    expect(r.meanRunningCars!).toBeLessThanOrEqual(6);
    expect(r.populationSize).toBe(6);
    expect(r.seed).toBe(3);
    expect(HEADLESS_BUDGET_TICKS_PER_SECOND).toBe(600);
  });

  it('a clock that does not advance gives no rates (never Infinity), and a backwards read counts as zero', () => {
    const frozen = runBenchmark({ environment: environment('stadium-oval'), config: configFor('stadium-oval', 1, 4), warmupGenerations: 0, generations: 1, clock: () => 5 });
    expect(frozen.wallMs).toBe(0);
    expect(frozen).toMatchObject({ carTicksPerSecond: null, ticksPerSecondFullPopulation: null, ticksPerSecondObserved: null });
    let t = 100;
    const backwards = runBenchmark({ environment: environment('stadium-oval'), config: configFor('stadium-oval', 1, 4), warmupGenerations: 0, generations: 1, clock: () => (t -= 1) });
    expect(backwards.wallMs).toBe(0);
  });
});

describe('the simulated work', () => {
  it('is bit-identical for the same inputs whatever the clock says, and differs for another seed', () => {
    const run = (seed: number, step: number) => runBenchmark({ environment: environment('silverstone'), config: configFor('silverstone', seed, 6), warmupGenerations: 1, generations: 2, clock: steppingClock(step) });
    const a = run(7, 1);
    const b = run(7, 977);
    expect([a.ticks, a.carTicks, a.bestFitness]).toEqual([b.ticks, b.carTicks, b.bestFitness]);
    expect(run(8, 1).bestFitness).not.toEqual(a.bestFitness);
  });

  it('does not count the warm-up: the measured generation is the one after it, the same one a plain trainer produces', () => {
    const config = configFor('stadium-oval', 5, 6);
    const trainer = createTrainer(config, environment('stadium-oval'));
    trainer.runGeneration();
    const second = trainer.runGeneration();
    const r = runBenchmark({ environment: environment('stadium-oval'), config, warmupGenerations: 1, generations: 1, clock: steppingClock(1) });
    expect(r.carTicks).toBe(second.totalEpisodeTicks);
    expect(r.ticks).toBe(second.generationTicks);
    expect(r.bestFitness).toEqual([second.bestFitness]);
  });

  it('runs the circuit\'s own limits and reports its boundary: Silverstone has 2,356 segments, the oval far fewer', () => {
    const s = runBenchmark({ environment: environment('silverstone'), config: configFor('silverstone', 1, 4), warmupGenerations: 0, generations: 1, clock: steppingClock(1) });
    const o = runBenchmark({ environment: environment('stadium-oval'), config: configFor('stadium-oval', 1, 4), warmupGenerations: 0, generations: 1, clock: steppingClock(1) });
    expect(s.trackId).toBe('silverstone');
    expect(s.trackVersion).toBe('e59595d-27c51454e817');
    expect(s.boundarySegments).toBe(2356);
    expect(o.boundarySegments).toBeLessThan(s.boundarySegments);
    expect(o.boundarySegments).toBe(trainingTrack('stadium-oval').outer.length + trainingTrack('stadium-oval').inner.length);
  });
});

describe('refusals', () => {
  const base = { environment: environment('stadium-oval'), config: { ...DEFAULT_TRAINING_CONFIG, populationSize: 4, eliteCount: 1 }, warmupGenerations: 0, generations: 1, clock: steppingClock(1) };
  it('names the field for a bad generation or warm-up count and a missing clock', () => {
    expect(() => runBenchmark({ ...base, generations: 0 })).toThrow(/"generations"/);
    expect(() => runBenchmark({ ...base, generations: 1.5 })).toThrow(/"generations"/);
    expect(() => runBenchmark({ ...base, generations: 1001 })).toThrow(/"generations"/);
    expect(() => runBenchmark({ ...base, warmupGenerations: -1 })).toThrow(/"warmupGenerations"/);
    expect(() => runBenchmark({ ...base, warmupGenerations: 101 })).toThrow(/"warmupGenerations"/);
    expect(() => runBenchmark({ ...base, clock: undefined as never })).toThrow(/clock/);
    expect(() => runBenchmark(null as never)).toThrow(/options/);
  });
});
