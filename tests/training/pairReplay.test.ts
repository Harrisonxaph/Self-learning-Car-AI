// The pair replay (P3-08): each car equals its solo replay tick for tick (cars are independent), the pair ends correctly
// when one ends early, and a network that cannot be computed stops that car with a flag while the other carries on.
import { describe, expect, it } from 'vitest';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { PARAMETER_COUNT } from '../../src/ai/network';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { loadTrack } from '../../src/sim/track';
import { createChampionReplay } from '../../src/training/championReplay';
import { createPairReplay } from '../../src/training/pairReplay';
import { createTrainer, createTrainingSetup, DEFAULT_TRAINING_CONFIG } from '../../src/training/trainer';

const ENV = { track: loadTrack(stadiumOval), physics: DEFAULT_VEHICLE_PHYSICS, timestepSeconds: DEFAULT_SIM_CONFIG.timestepSeconds };
const config = (seed: number) => ({ ...DEFAULT_TRAINING_CONFIG, seed, populationSize: 6, eliteCount: 1, maxEpisodeSeconds: 10 });
const setup = createTrainingSetup(config(1), ENV);
const champions = (seed: number, generations: number) => {
  const trainer = createTrainer(config(seed), ENV);
  return Array.from({ length: generations }, () => trainer.runGeneration().champion);
};

describe('lockstep equals solo', () => {
  for (const [seedA, seedB, gen] of [[1, 2, 1], [3, 3, 2], [7, 9, 3]] as const) {
    it(`seeds ${seedA} and ${seedB}, generation ${gen}: every tick of each car equals its solo replay`, () => {
      const a = champions(seedA, gen)[gen - 1]!;
      const b = champions(seedB, gen)[gen - 1]!;
      const soloA = createChampionReplay(a, setup);
      const soloB = createChampionReplay(b, setup);
      const pair = createPairReplay(a, setup, b, setup);
      for (let guard = 0; guard < 10_000; guard += 1) {
        const step = pair.step();
        const sa = soloA.step();
        const sb = soloB.step();
        if (step === null) {
          expect(sa).toBeNull();
          expect(sb).toBeNull();
          break;
        }
        expect(step.a).toEqual(sa);
        expect(step.b).toEqual(sb);
      }
      expect(pair.done()).toBe(true);
      expect(pair.a.state()).toEqual(soloA.state());
      expect(pair.b.state()).toEqual(soloB.state());
    });
  }
});

describe('ending', () => {
  it('the pair ends when both have ended; the earlier car stays at its result while the other runs on', () => {
    const [a, b] = [champions(1, 1)[0]!, champions(4, 1)[0]!];
    const pair = createPairReplay(a, setup, b, setup);
    let steps = 0;
    while (pair.step() !== null) steps += 1;
    const [ra, rb] = pair.results();
    expect(ra.outcome).not.toBeNull();
    expect(rb.outcome).not.toBeNull();
    expect(steps).toBe(Math.max(ra.ticks, rb.ticks));
    expect(pair.step()).toBeNull();
  });

  it('a car whose network cannot be computed stops with a flag, and the other carries on to its own end', () => {
    const good = champions(1, 1)[0]!;
    const bad = new Float64Array(PARAMETER_COUNT).fill(1e308);
    const pair = createPairReplay(bad, setup, good, setup);
    const failures: string[] = [];
    let step = pair.step();
    while (step !== null) {
      failures.push(...step.failed);
      step = pair.step();
    }
    const [ra, rb] = pair.results();
    expect(failures).toEqual(['A']);
    expect(ra.failed).toBe(true);
    expect(ra.outcome).toBeNull();
    expect(rb.failed).toBe(false);
    expect(rb.outcome).not.toBeNull();
    // The good car is unaffected by its neighbour's failure.
    const solo = createChampionReplay(good, setup);
    while (solo.step() !== null);
    expect(pair.b.state()).toEqual(solo.state());
  });

  it('both failing ends the pair at once', () => {
    const bad = new Float64Array(PARAMETER_COUNT).fill(1e308);
    const pair = createPairReplay(bad, setup, bad, setup);
    expect(pair.step()?.failed).toEqual(['A', 'B']);
    expect(pair.step()).toBeNull();
    expect(pair.done()).toBe(true);
  });
});
