// Shared fixtures for the P4-05 tests: a tiny trained champion as a saved model, a memory storage, and valid entries.
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { loadTrack } from '../../src/sim/track';
import { buildModel, type ModelDocument } from '../../src/persistence/modelFormat';
import type { StorageLike } from '../../src/persistence/modelStore';
import { summariseRows, type EvaluationEntry, type EvaluationRow } from '../../src/persistence/evaluationEntry';
import { evaluateModelOnCircuit } from '../../src/ui/modelEvaluation';
import { createTrainer, DEFAULT_TRAINING_CONFIG } from '../../src/training/trainer';
import { tracksIn } from '../../src/training/trackSplits';

const ENV = { track: loadTrack(stadiumOval), physics: DEFAULT_VEHICLE_PHYSICS, timestepSeconds: DEFAULT_SIM_CONFIG.timestepSeconds };
export const TRAINING_REGISTRY = tracksIn('training');
export const EVALUATION_TRACKS = [...tracksIn('training'), ...tracksIn('validation')];
export const OPTIONS = { recordedAt: '2026-11-12T12:00:00.000Z', appVersion: '0.0.0', codeVersion: 'test' };

export function makeModel(seed: number, id: string, generations = 1): ModelDocument {
  const trainer = createTrainer({ ...DEFAULT_TRAINING_CONFIG, seed, populationSize: 8, eliteCount: 2, maxEpisodeSeconds: 15 }, ENV);
  let stats = trainer.runGeneration();
  for (let g = 1; g < generations; g += 1) stats = trainer.runGeneration();
  return buildModel({ champion: stats.champion, fitness: stats.bestFitness, generation: stats.generation, record: trainer.record(), id, createdAt: '2026-11-12T10:00:00.000Z', codeVersion: 'test', name: `Champion ${id}` });
}

export class MemoryStorage implements StorageLike {
  readonly data = new Map<string, string>();
  writes = 0;
  failSet: unknown = null;
  get length() {
    return this.data.size;
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failSet) throw this.failSet;
    this.writes += 1;
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
}

/** A real, valid entry for a model on a circuit. */
export function realEntry(model: ModelDocument, circuit: string): EvaluationEntry {
  const result = evaluateModelOnCircuit(model, circuit, OPTIONS);
  if (!result.ok) throw new Error(result.message);
  return result.entry;
}

/** The same entry with different rows (and the summary recomputed), for tests that need specific outcomes. */
export function entryWithRows(base: EvaluationEntry, rows: readonly EvaluationRow[]): EvaluationEntry {
  return { ...base, rows, summary: summariseRows(rows) };
}

export const row = (seed: number, outcome: EvaluationRow['outcome'], gatesPassed: number, gates: number, laps = 0, firstLapTicks: number | null = null, timestep = 1 / 60): EvaluationRow => ({
  seed,
  outcome,
  ticks: 100 + seed,
  gatesPassed,
  gates,
  laps,
  orderedProgress: gatesPassed / gates,
  firstLapTicks,
  firstLapSeconds: firstLapTicks === null ? null : firstLapTicks * timestep,
});
