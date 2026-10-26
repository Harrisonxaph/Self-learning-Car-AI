// A reproducible headless training run on the built-in oval with the default configuration (the MODEL_FORMAT
// example: 50 cars, seed 1). `npm run demo:train` (Vitest in mode `train-demo`) runs 50 generations and prints one
// line per generation, in about a minute and a half; ordinary test runs do the first 3, so CI stays fast and the
// checks below still run. The printed fitness is a training signal on one track: it is not evidence of learning
// or of general driving ability (docs/AI_EVALUATION.md), and no experiment has been run.
import { expect, it } from 'vitest';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { loadTrack } from '../../src/sim/track';
import { createTrainer, DEFAULT_TRAINING_CONFIG } from '../../src/training/trainer';

const GENERATIONS = import.meta.env.MODE === 'train-demo' ? 50 : 3;

it(`runs ${GENERATIONS} generations headless with the default configuration`, () => {
  const environment = { track: loadTrack(stadiumOval), physics: DEFAULT_VEHICLE_PHYSICS, timestepSeconds: DEFAULT_SIM_CONFIG.timestepSeconds };
  const trainer = createTrainer(DEFAULT_TRAINING_CONFIG, environment);
  const lines: string[] = [];
  for (let g = 0; g < GENERATIONS; g += 1) {
    const s = trainer.runGeneration();
    const { completed, crashed, stalled, timeout } = s.outcomes;
    lines.push(
      `gen ${String(s.generation).padStart(2)}  best ${s.bestFitness.toFixed(0).padStart(6)}  mean ${s.meanFitness.toFixed(0).padStart(6)}  ` +
        `gates ≤ ${String(s.maxGatesPassed).padStart(2)}  laps ${s.carsWithLap}  ` +
        `crashed ${crashed} stalled ${stalled} timeout ${timeout} completed ${completed}  ticks ${s.generationTicks}`,
    );
    expect(Object.values(s.outcomes).reduce((a, b) => a + b, 0)).toBe(DEFAULT_TRAINING_CONFIG.populationSize);
  }
  const record = trainer.record();
  console.log(`Seed ${record.config.seed}, ${record.config.populationSize} cars, track ${record.versions.trackId} v${record.versions.trackVersion}, fitness v${record.versions.fitnessVersion}`);
  console.log(lines.join('\n'));
  expect(record.generations).toHaveLength(GENERATIONS);
}, 300_000);
