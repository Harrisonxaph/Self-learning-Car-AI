// P3-02: the graph's points come from the trainer's own records, and its text summary reports only what was
// recorded. Plain Node; a small seeded run only, nothing here is a study result.
import { describe, expect, it } from 'vitest';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { loadTrack } from '../../src/sim/track';
import { historyPoint, summariseHistory, type HistoryPoint } from '../../src/training/generationHistory';
import { createTrainer, DEFAULT_TRAINING_CONFIG, type GenerationStats, type TrainingConfig } from '../../src/training/trainer';

const ENV = { track: loadTrack(stadiumOval), physics: DEFAULT_VEHICLE_PHYSICS, timestepSeconds: DEFAULT_SIM_CONFIG.timestepSeconds };
const SMALL: TrainingConfig = { ...DEFAULT_TRAINING_CONFIG, seed: 7, populationSize: 8, eliteCount: 2, maxEpisodeSeconds: 15 };

const point = (generation: number, best: number, mean = 0, crash = 0, lap = 0): HistoryPoint => ({ generation, bestFitness: best, meanFitness: mean, crashRate: crash, lapCompletionRate: lap });

describe('historyPoint', () => {
  it('equals the trainer\'s recorded statistics for every generation of a seeded run', () => {
    const trainer = createTrainer(SMALL, ENV);
    const stepped: GenerationStats[] = [];
    while (stepped.length < 4) {
      const stats = trainer.step();
      if (stats) stepped.push(stats);
    }
    const recorded = trainer.record().generations;
    expect(recorded).toHaveLength(4);
    stepped.forEach((stats, i) => {
      const p = historyPoint(stats, SMALL.populationSize);
      const r = recorded[i]!;
      expect(p).toEqual({
        generation: r.generation + 1,
        bestFitness: r.bestFitness,
        meanFitness: r.meanFitness,
        crashRate: r.outcomes.crashed / SMALL.populationSize,
        lapCompletionRate: r.carsWithLap / SMALL.populationSize,
      });
      // The recorded fitness array gives the same best and mean.
      expect(p.bestFitness).toBe(Math.max(...r.fitness));
    });
  });

  it('counts crashes only in the crash rate', () => {
    const stats = { generation: 2, bestFitness: 1, meanFitness: 0.5, outcomes: { completed: 0, crashed: 2, stalled: 5, timeout: 1 }, carsWithLap: 1 } as GenerationStats;
    expect(historyPoint(stats, 8).crashRate).toBe(2 / 8);
  });
});

describe('summariseHistory', () => {
  it('says there is nothing to plot before the first generation ends', () => {
    expect(summariseHistory([])).toBe('No generation completed yet, so there is nothing to plot.');
  });

  it('reports the latest figures and the highest best fitness, as plain text', () => {
    expect(summariseHistory([point(1, 2)])).toBe(
      '1 completed generation is plotted. Latest, generation 1: best fitness 2.00, mean fitness 0.00, 0.0% of cars crashed, 0.0% completed a lap. Highest best fitness so far: 2.00 in generation 1.',
    );
    const text = summariseHistory([point(1, 2.5, 1, 0.5, 0), point(2, 9.123, 4, 0.25, 0.125), point(3, 7, 3.333, 0.75, 0.25)]);
    expect(text).toContain('3 completed generations are plotted');
    expect(text).toContain('Latest, generation 3: best fitness 7.00, mean fitness 3.33, 75.0% of cars crashed, 25.0% completed a lap');
    expect(text).toContain('Highest best fitness so far: 9.12 in generation 2');
  });

  it('makes no learning, improvement or trend claim', () => {
    const text = summariseHistory([point(1, 1), point(2, 5), point(3, 9)]);
    expect(text).not.toMatch(/learn|improv|skill|better|smarter|progress|increas|decreas|rising|trend/i);
  });
});
