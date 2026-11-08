// P3-01: the dashboard's figures come from the trainer's own records. These tests check the counts and rates against
// values recomputed independently from each generation's finished cars, and the bookkeeping that keeps the four live
// counts disjoint. Plain Node, no DOM. A small seeded run only; nothing here is a study result.
import { describe, expect, it } from 'vitest';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { loadTrack } from '../../src/sim/track';
import { completedMetrics, liveCounts } from '../../src/training/generationMetrics';
import { createTrainer, DEFAULT_TRAINING_CONFIG, type Generation, type GenerationStats, type TrainingConfig } from '../../src/training/trainer';

const ENV = { track: loadTrack(stadiumOval), physics: DEFAULT_VEHICLE_PHYSICS, timestepSeconds: DEFAULT_SIM_CONFIG.timestepSeconds };
const SMALL: TrainingConfig = { ...DEFAULT_TRAINING_CONFIG, seed: 7, populationSize: 8, eliteCount: 2, maxEpisodeSeconds: 15 };

/** A generation whose cars carry only the outcomes, which is all `liveCounts` reads. */
function withOutcomes(outcomes: readonly (string | null)[], index = 0): Generation {
  return { index, tick: 0, cars: outcomes.map((outcome) => ({ episode: { outcome } })) } as unknown as Generation;
}

describe('liveCounts', () => {
  it('counts each outcome once: running is null, finished is completed or timeout, stalls are not crashes', () => {
    const counts = liveCounts(withOutcomes([null, null, 'crashed', 'stalled', 'stalled', 'stalled', 'completed', 'timeout', 'timeout'], 4));
    expect(counts).toEqual({ generation: 5, population: 9, running: 2, crashed: 1, stalled: 3, finished: 3 });
    expect(counts.running + counts.crashed + counts.stalled + counts.finished).toBe(counts.population);
  });

  it('shows the generation from 1, and handles all-running and all-ended generations', () => {
    expect(liveCounts(withOutcomes([null, null, null])).running).toBe(3);
    const ended = liveCounts(withOutcomes(['crashed', 'crashed']));
    expect([ended.running, ended.crashed, ended.stalled, ended.finished]).toEqual([0, 2, 0, 0]);
    expect(ended.generation).toBe(1);
  });

  it('rejects an outcome it does not know instead of dropping the car from the counts', () => {
    expect(() => liveCounts(withOutcomes(['exploded']))).toThrow(/Unexpected episode outcome/);
  });

  it('partitions the real population at every tick of a seeded run', () => {
    const trainer = createTrainer(SMALL, ENV);
    let seen = 0;
    while (trainer.record().generations.length < 2) {
      const counts = liveCounts(trainer.generation());
      expect(counts.running + counts.crashed + counts.stalled + counts.finished).toBe(SMALL.populationSize);
      expect(counts.population).toBe(SMALL.populationSize);
      seen += 1;
      trainer.step();
    }
    expect(seen).toBeGreaterThan(100);
  });
});

describe('completedMetrics', () => {
  it('is null before any generation has ended', () => {
    expect(completedMetrics(null, 50)).toBeNull();
  });

  it('rejects a population that is not a positive integer', () => {
    const stats = {} as GenerationStats;
    for (const population of [0, -1, 2.5, Number.NaN]) expect(() => completedMetrics(stats, population)).toThrow(RangeError);
  });

  it('matches the recorded GenerationStats, recomputed independently from each generation\'s finished cars', () => {
    const trainer = createTrainer(SMALL, ENV);
    const recorded: GenerationStats[] = [];
    while (recorded.length < 4) {
      const stats = trainer.step();
      if (!stats) continue;
      recorded.push(stats);
      const metrics = completedMetrics(stats, SMALL.populationSize)!;
      const cars = trainer.finished()!.cars;
      // Recomputed from the cars, not from the stats object.
      const crashed = cars.filter((car) => car.episode.outcome === 'crashed').length;
      const stalled = cars.filter((car) => car.episode.outcome === 'stalled').length;
      const withLap = cars.filter((car) => car.episode.lapTicks.length > 0).length;
      expect(metrics.generation).toBe(recorded.length);
      expect(metrics.bestFitness).toBe(stats.bestFitness);
      expect(metrics.meanFitness).toBe(stats.meanFitness);
      expect(metrics.bestFitness).toBe(Math.max(...stats.fitness));
      expect(metrics.crashed).toBe(crashed);
      expect(metrics.crashRate).toBe(crashed / SMALL.populationSize);
      expect(metrics.stalled).toBe(stalled);
      expect(metrics.stallRate).toBe(stalled / SMALL.populationSize);
      expect(metrics.carsWithLap).toBe(withLap);
      expect(metrics.lapCompletionRate).toBe(withLap / SMALL.populationSize);
      // Once the generation has ended nothing is running, and the live counts agree with the recorded outcomes.
      const live = liveCounts(trainer.finished()!);
      expect([live.running, live.crashed, live.stalled]).toEqual([0, stats.outcomes.crashed, stats.outcomes.stalled]);
      expect(live.finished).toBe(stats.outcomes.completed + stats.outcomes.timeout);
    }
  });

  it('keeps stalls out of the collision rate', () => {
    const stats = { generation: 0, bestFitness: 3, meanFitness: 1, outcomes: { completed: 0, crashed: 1, stalled: 5, timeout: 2 }, carsWithLap: 0 } as GenerationStats;
    const metrics = completedMetrics(stats, 8)!;
    expect(metrics.crashRate).toBe(1 / 8);
    expect(metrics.stallRate).toBe(5 / 8);
  });

  it('gives identical metrics for the same seed and configuration', () => {
    const run = () => {
      const trainer = createTrainer(SMALL, ENV);
      const out: unknown[] = [];
      while (out.length < 3) {
        const stats = trainer.step();
        if (stats) out.push(completedMetrics(stats, SMALL.populationSize));
      }
      return out;
    };
    expect(run()).toEqual(run());
  });
});
