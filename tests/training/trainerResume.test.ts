// P3-07: resuming a run at a generation boundary. The contract (docs/plans/p3-07-plan.md, section 5) has two parts:
//  1. everything the future depends on and every generation run after the split is deep-equal and bit for bit the same as
//     an uninterrupted run (the population, the run generator's state, and each later generation's full statistics);
//  2. the restored history is compared as a stated projection: compact fields for every earlier generation, full stats for
//     the retained ones, and `null`/absent fitness and champion for the rest (never zeros or copies).
// Bitwise equality is claimed on one engine and build only.
import { describe, expect, it } from 'vitest';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { loadTrack } from '../../src/sim/track';
import { compactOf, createTrainer, DEFAULT_RETAINED_GENERATIONS, DEFAULT_TRAINING_CONFIG, retainHistory, type HistoryEntry, type Trainer, type TrainerState } from '../../src/training/trainer';

const ENV = { track: loadTrack(stadiumOval), physics: DEFAULT_VEHICLE_PHYSICS, timestepSeconds: DEFAULT_SIM_CONFIG.timestepSeconds };
const config = (seed: number, populationSize: number, brakeEnabled = true) => ({ ...DEFAULT_TRAINING_CONFIG, seed, populationSize, eliteCount: 1, maxEpisodeSeconds: 10, brakeEnabled });
const run = (trainer: Trainer, generations: number) => Array.from({ length: generations }, () => trainer.runGeneration());
/** What a checkpoint would carry: the state with its history compacted by the retention rule. */
const checkpoint = (trainer: Trainer, keepLast: number): TrainerState => {
  const state = trainer.checkpointState();
  return { ...state, history: retainHistory(state.history, keepLast) };
};
const bits = (a: Float64Array, b: Float64Array) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

function proof(seed: number, population: number, split: number, more: number, keepLast: number, brake = true) {
  const whole = createTrainer(config(seed, population, brake), ENV);
  const wholeStats = run(whole, split + more);
  const first = createTrainer(config(seed, population, brake), ENV);
  run(first, split);
  const resumed = createTrainer(config(seed, population, brake), ENV, checkpoint(first, keepLast));
  const resumedStats = run(resumed, more);

  // Part 1: the future is exactly the same.
  expect(resumedStats).toEqual(wholeStats.slice(split));
  const a = whole.checkpointState();
  const b = resumed.checkpointState();
  expect(b.generationIndex).toBe(a.generationIndex);
  expect(b.runState).toEqual(a.runState);
  expect(b.genomes).toHaveLength(a.genomes.length);
  b.genomes.forEach((genome, i) => expect(bits(genome, a.genomes[i]!)).toBe(true));

  // Part 2: the restored history is a stated projection of the uninterrupted one.
  const projected = resumed.record().history;
  const original = whole.record().history;
  expect(projected).toHaveLength(split + more);
  const lastKept = split - keepLast;
  const best = original.slice(0, split).reduce((bestIndex, entry, i, all) => (entry.retained && entry.stats.bestFitness > (all[bestIndex] as Extract<HistoryEntry, { retained: true }>).stats.bestFitness ? i : bestIndex), 0);
  projected.forEach((entry, i) => {
    const truth = original[i]!;
    if (!truth.retained) throw new Error('an uninterrupted run holds every generation in full');
    if (i >= split || i >= lastKept || i === best) {
      expect(entry.retained, `generation ${i} should be full`).toBe(true);
      expect(entry).toEqual(truth);
    } else {
      expect(entry.retained, `generation ${i} should be compact`).toBe(false);
      expect(entry).toEqual(compactOf(truth.stats));
      expect('fitness' in entry).toBe(false);
      expect('champion' in entry).toBe(false);
    }
  });
  return { resumed, whole };
}

describe('resuming at a generation boundary matches an uninterrupted run', () => {
  for (const seed of [1, 7]) {
    for (const split of [0, 1, 3]) {
      it(`seed ${seed}, split after ${split} generations, population 6`, () => {
        proof(seed, 6, split, 3, 2);
      });
    }
  }
  it('both brake settings, and a second population size', () => {
    proof(3, 4, 2, 2, 5, false);
    proof(3, 9, 2, 2, 5, true);
  });
  it('a split beyond the retention window (25 generations, 20 kept) exercises compact history', () => {
    const { resumed } = proof(5, 4, 25, 3, DEFAULT_RETAINED_GENERATIONS);
    const history = resumed.record().history;
    expect(history.slice(0, 5).some((entry) => !entry.retained)).toBe(true);
    expect(resumed.record().complete).toBe(false);
  });
  it('a small retention window with several compact entries, including the best being kept', () => {
    proof(11, 4, 8, 2, 3);
  });
  it('a resume of a resume: compact entries survive a second round trip unchanged', () => {
    const whole = createTrainer(config(2, 5), ENV);
    run(whole, 9);
    const one = createTrainer(config(2, 5), ENV);
    run(one, 4);
    const two = createTrainer(config(2, 5), ENV, checkpoint(one, 2));
    run(two, 3);
    const three = createTrainer(config(2, 5), ENV, checkpoint(two, 2));
    run(three, 2);
    expect(three.checkpointState().runState).toEqual(whole.checkpointState().runState);
    three.checkpointState().genomes.forEach((genome, i) => expect(bits(genome, whole.checkpointState().genomes[i]!)).toBe(true));
    const history = three.record().history;
    expect(history).toHaveLength(9);
    const original = whole.record().history;
    history.forEach((entry, i) => {
      const truth = original[i]!;
      if (!entry.retained) expect(entry).toEqual(compactOf((truth as Extract<HistoryEntry, { retained: true }>).stats));
      else expect(entry).toEqual(truth);
    });
    expect(history.some((entry) => !entry.retained)).toBe(true);
  });
  it('no cache: the resume is built from exactly the run generator state words and the population', () => {
    const whole = createTrainer(config(4, 5), ENV);
    run(whole, 5);
    const first = createTrainer(config(4, 5), ENV);
    run(first, 2);
    const state = first.checkpointState();
    const rebuilt: TrainerState = { generationIndex: state.generationIndex, genomes: state.genomes.map((g) => Float64Array.from(g)), runState: { algorithm: state.runState.algorithm, words: [...state.runState.words] as [number, number, number, number] }, history: state.history };
    const resumed = createTrainer(config(4, 5), ENV, rebuilt);
    run(resumed, 3);
    expect(resumed.checkpointState().runState).toEqual(whole.checkpointState().runState);
  });
  it('a fresh run is unchanged by the new state accessors, and checkpointState never aliases live arrays', () => {
    const trainer = createTrainer(config(1, 4), ENV);
    const before = trainer.checkpointState();
    before.genomes[0]![0] = 999;
    expect(trainer.generation().cars[0]!.genome[0]).not.toBe(999);
    run(trainer, 2);
    expect(trainer.record().complete).toBe(true);
    expect(trainer.record().generations).toHaveLength(2);
    expect(trainer.record().history).toHaveLength(2);
  });
});

describe('createTrainer refuses a bad resume state with a RangeError', () => {
  const base = () => {
    const trainer = createTrainer(config(1, 4), ENV);
    run(trainer, 2);
    return trainer.checkpointState();
  };
  const bad: [string, (s: TrainerState) => unknown][] = [
    ['a negative generation index', (s) => ({ ...s, generationIndex: -1 })],
    ['a fractional generation index', (s) => ({ ...s, generationIndex: 1.5 })],
    ['history shorter than the index', (s) => ({ ...s, history: s.history.slice(1) })],
    ['history out of order', (s) => ({ ...s, history: [...s.history].reverse() })],
    ['too few genomes', (s) => ({ ...s, genomes: s.genomes.slice(1) })],
    ['a short genome', (s) => ({ ...s, genomes: [new Float64Array(3), ...s.genomes.slice(1)] })],
    ['a non-finite parameter', (s) => ({ ...s, genomes: [Float64Array.from(s.genomes[0]!, () => Number.NaN), ...s.genomes.slice(1)] })],
    ['a finite but enormous parameter that would overflow inference', (s) => ({ ...s, genomes: [Float64Array.from(s.genomes[0]!, () => 1e308), ...s.genomes.slice(1)] })],
    ['a plain array instead of a Float64Array', (s) => ({ ...s, genomes: [Array.from(s.genomes[0]!), ...s.genomes.slice(1)] })],
    ['an invalid generator state', (s) => ({ ...s, runState: { algorithm: s.runState.algorithm, words: [1, 2, 3] } })],
    ['a null state', () => null],
  ];
  for (const [label, make] of bad) {
    it(label, () => {
      expect(() => createTrainer(config(1, 4), ENV, make(base()) as TrainerState)).toThrow(RangeError);
    });
  }
});

describe('retainHistory', () => {
  const entries = (): HistoryEntry[] => {
    const trainer = createTrainer(config(6, 4), ENV);
    run(trainer, 6);
    return [...trainer.record().history];
  };
  it('keeps the last K and the best so far in full, the rest compact, and never makes a compact entry full', () => {
    const all = entries();
    const kept = retainHistory(all, 2);
    expect(kept.filter((e) => e.retained).length).toBeGreaterThanOrEqual(2);
    expect(kept[5]!.retained && kept[4]!.retained).toBe(true);
    expect(retainHistory(kept, 2).map((e) => e.retained)).toEqual(kept.map((e) => e.retained));
    expect(retainHistory(all, 0).filter((e) => e.retained)).toHaveLength(1);
    expect(retainHistory(all, 100).every((e) => e.retained)).toBe(true);
  });
  it('rejects a bad K', () => {
    expect(() => retainHistory([], -1)).toThrow(RangeError);
    expect(() => retainHistory([], 1.5)).toThrow(RangeError);
  });
});
