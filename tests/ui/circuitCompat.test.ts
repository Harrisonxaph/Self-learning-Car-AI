// P4-04: what the circuit choice means for saved data. A checkpoint made on one circuit cannot be resumed on another (the
// existing track check, shown for the new circuits), and the saved-champions list names the circuit a champion was trained on.
// Seeded and tiny; nothing here is a result.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkpointFromTrainer, currentEnvironment } from '../../src/ui/checkpointAdapter';
import { resumeProblems, type CheckpointDocument } from '../../src/persistence/checkpointFormat';
import { describeEntry } from '../../src/ui/savedChampionsView';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { createTrainer, DEFAULT_TRAINING_CONFIG } from '../../src/training/trainer';
import { trainingTrack } from '../../src/training/trackSplits';

const config = { ...DEFAULT_TRAINING_CONFIG, seed: 1, populationSize: 4, eliteCount: 1, maxEpisodeSeconds: 5 };
const trainerOn = (id: string) => createTrainer(config, { track: trainingTrack(id), physics: DEFAULT_VEHICLE_PHYSICS, timestepSeconds: DEFAULT_SIM_CONFIG.timestepSeconds });
const meta = { id: 'cp-circuit', createdAt: '2026-11-12T00:00:00.000Z', codeVersion: 'test', appVersion: '0.0.0' };

describe('a checkpoint is tied to its circuit', () => {
  it('resumes on the circuit it was made on and is refused on the other training circuit, in both directions', () => {
    for (const [made, other] of [['stadium-oval', 'kidney-loop'], ['kidney-loop', 'stadium-oval']] as const) {
      const trainer = trainerOn(made);
      trainer.runGeneration();
      const doc = checkpointFromTrainer(trainer, meta);
      expect(doc.training.trackId).toBe(made);
      expect(resumeProblems(doc, currentEnvironment(trainer.setup))).toEqual([]);
      const problems = resumeProblems(doc, currentEnvironment(trainerOn(other).setup));
      expect(problems).toContain('It was made on a different track or track version.');
    }
  });
  it('a checkpoint made before the expansion is still tied to the stadium oval', () => {
    const doc = JSON.parse(readFileSync(join(__dirname, '../fixtures/pre-p4-04/checkpoint.json'), 'utf8')) as CheckpointDocument;
    expect(doc.training.trackId).toBe('stadium-oval');
    expect(resumeProblems(doc, currentEnvironment(trainerOn('kidney-loop').setup))).toContain('It was made on a different track or track version.');
  });
});

describe('the saved-champions list names the circuit', () => {
  it('describeEntry includes it', () => {
    const entry = { id: 'a', status: 'ok' as const, drivable: true, warnings: [], summary: { name: 'Best', generation: 2, fitness: 12.34, createdAt: '2026-11-12T10:00:00.000Z', circuit: 'kidney-loop', reproducible: true } };
    expect(describeEntry(entry)).toBe('Best · generation 3 · fitness 12.3 · circuit kidney-loop · saved 2026-11-12');
  });
});
