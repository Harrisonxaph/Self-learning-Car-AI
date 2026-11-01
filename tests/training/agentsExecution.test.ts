// Execution counts for P2-08 B2 (Codex finding on #100): an A5 run evaluates generation 0 once, and A2/A9 are built
// from it rather than from a second generation-0 run. The trainer module is wrapped (vi.mock) to count trainers,
// generations and standalone genome evaluations; results are unchanged by the wrapping. Mechanics seeds only.
import { describe, expect, it, vi } from 'vitest';

const counts = { trainers: 0, generations: 0, evaluateGenome: 0 };

vi.mock('../../src/training/trainer', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/training/trainer')>();
  return {
    ...original,
    createTrainer: (...args: Parameters<typeof original.createTrainer>) => {
      counts.trainers += 1;
      const trainer = original.createTrainer(...args);
      return {
        ...trainer,
        runGeneration: () => {
          counts.generations += 1;
          return trainer.runGeneration();
        },
      };
    },
    evaluateGenome: (...args: Parameters<typeof original.evaluateGenome>) => {
      counts.evaluateGenome += 1;
      return original.evaluateGenome(...args);
    },
  };
});

const { generateAgents } = await import('../../src/training/agents');
const { generateBaselines } = await import('../../src/training/baselines');

const TRAINING = { populationSize: 3, eliteCount: 1, maxEpisodeSeconds: 2, stallSeconds: 1 };
const reset = () => Object.assign(counts, { trainers: 0, generations: 0, evaluateGenome: 0 });

describe('execution counts', () => {
  it('a combined run uses one trainer for G generations, so generation 0 is evaluated once, plus A8\'s P × G samples', () => {
    reset();
    const result = generateAgents({ training: TRAINING, generations: 2, trackId: 'stadium-oval', validationTrackId: 'rounded-rectangle', episodesPerTrack: 1 }, 7251);
    expect(counts.trainers).toBe(1);
    expect(counts.generations).toBe(2);
    expect(counts.evaluateGenome).toBe(3 * 2);
    // Car episodes on the training track from evaluation work: A5's P × G plus A8's P × G, and no extra P for A2.
    expect(result.A5.generations.flat()).toHaveLength(6);
    expect(result.baselines.A8.samples).toHaveLength(6);
  });

  it('standalone B1 still runs exactly one trainer generation (generation 0) plus A8', () => {
    reset();
    generateBaselines({ training: TRAINING, generations: 2, trackId: 'stadium-oval' }, 7251);
    expect(counts.trainers).toBe(1);
    expect(counts.generations).toBe(1);
    expect(counts.evaluateGenome).toBe(6);
  });
});
