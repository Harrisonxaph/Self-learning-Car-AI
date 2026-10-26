import { describe, expect, it } from 'vitest';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { loadTrack } from '../../src/sim/track';
import { createTrainer, DEFAULT_TRAINING_CONFIG } from '../../src/training/trainer';
import { trainingStatus } from '../../src/ui/trainingPage';

describe('trainingStatus', () => {
  it('names the generation from 1 and counts the cars still running', () => {
    const env = { track: loadTrack(stadiumOval), physics: DEFAULT_VEHICLE_PHYSICS, timestepSeconds: DEFAULT_SIM_CONFIG.timestepSeconds };
    const trainer = createTrainer({ ...DEFAULT_TRAINING_CONFIG, populationSize: 4, eliteCount: 1 }, env);
    expect(trainingStatus(trainer.generation())).toBe('Training · generation 1 · 4 of 4 cars running');
    trainer.runGeneration();
    const finished = trainer.finished()!;
    expect(trainingStatus(finished)).toBe('Training · generation 1 · 0 of 4 cars running');
    expect(trainingStatus(trainer.generation())).toBe('Training · generation 2 · 4 of 4 cars running');
  });
});
