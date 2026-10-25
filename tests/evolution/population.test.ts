// The next-generation builder (P2-04): elitism, selection, crossover and mutation together, with hand-scored
// fitness fixtures (the fitness function is P2-06 and is not used here).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkParameters, initialParameters, runNetwork } from '../../src/ai/network';
import {
  EVOLUTION_OPERATORS,
  MAX_POPULATION_SIZE,
  createEvolutionRngs,
  nextGeneration,
  resolveEvolutionConfig,
  type EvolutionConfig,
  type EvolutionRngs,
} from '../../src/evolution/population';
import { createRng } from '../../src/utils/rng';

const config = (overrides: Partial<Record<keyof EvolutionConfig, unknown>> = {}): EvolutionConfig =>
  ({
    populationSize: 6,
    eliteCount: 2,
    selection: { type: 'tournament', size: 3 },
    crossover: { type: 'uniform', rate: 0.7 },
    mutation: { rate: 0.1, scale: 0.2 },
    ...overrides,
  }) as EvolutionConfig;

/** Six genomes of 8 genes; genome g has genes 100·g + i, so every gene shows where it came from. */
const population = () => Array.from({ length: 6 }, (_, g) => Float64Array.from({ length: 8 }, (_, i) => 100 * g + i));
const fitness = [3, 11, 7, 11, -2, 5]; // ranked: 1, 3, 2, 5, 0, 4
const rngs = (seed: number) => createEvolutionRngs(createRng(seed));

describe('configuration', () => {
  it('matches the MODEL_FORMAT example and is returned frozen', () => {
    const doc = readFileSync(join(__dirname, '../../docs/MODEL_FORMAT.md'), 'utf8');
    const start = doc.indexOf('```json') + 7;
    const example = JSON.parse(doc.slice(start, doc.indexOf('```', start))).training.configuration;
    const resolved = resolveEvolutionConfig(example);
    expect(resolved).toEqual({
      populationSize: 50,
      eliteCount: 2,
      selection: { type: 'tournament', size: 3 },
      crossover: { type: 'uniform', rate: 0.7 },
      mutation: { rate: 0.1, scale: 0.2 },
    });
    expect(Object.isFrozen(resolved) && Object.isFrozen(resolved.mutation)).toBe(true);
    expect(EVOLUTION_OPERATORS).toBe('tournament-uniform-gaussian-v1');
  });

  it.each([
    ['population size 1', { populationSize: 1 }, /populationSize/],
    ['a fractional population size', { populationSize: 6.5 }, /populationSize/],
    ['a population size above the maximum', { populationSize: MAX_POPULATION_SIZE + 1 }, /populationSize/],
    ['a negative elite count', { eliteCount: -1 }, /eliteCount/],
    ['more elites than genomes', { eliteCount: 7 }, /eliteCount/],
    ['tournament size 0', { selection: { type: 'tournament', size: 0 } }, /selection.size/],
    ['a tournament larger than the population', { selection: { type: 'tournament', size: 7 } }, /selection.size/],
    ['roulette selection', { selection: { type: 'roulette', size: 3 } }, /selection.type/],
    ['one-point crossover', { crossover: { type: 'one-point', rate: 0.7 } }, /crossover.type/],
    ['crossover rate 1.1', { crossover: { type: 'uniform', rate: 1.1 } }, /crossover.rate/],
    ['a NaN crossover rate', { crossover: { type: 'uniform', rate: NaN } }, /crossover.rate/],
    ['mutation rate −0.1', { mutation: { rate: -0.1, scale: 0.2 } }, /mutation.rate/],
    ['a negative mutation scale', { mutation: { rate: 0.1, scale: -1 } }, /mutation.scale/],
    ['an infinite mutation scale', { mutation: { rate: 0.1, scale: Infinity } }, /mutation.scale/],
    ['missing mutation settings', { mutation: undefined }, /mutation/],
  ])('rejects %s with a RangeError naming the field', (_name, overrides, message) => {
    expect(() => resolveEvolutionConfig(config(overrides))).toThrow(RangeError);
    expect(() => resolveEvolutionConfig(config(overrides))).toThrow(message);
    expect(() => nextGeneration(population(), fitness, config(overrides), rngs(1))).toThrow(message);
  });

  it('rejects a non-object config, mismatched fitness or population, and missing generators', () => {
    expect(() => resolveEvolutionConfig(null)).toThrow(RangeError);
    expect(() => nextGeneration(population(), fitness.slice(1), config(), rngs(1))).toThrow(/one score per genome/);
    expect(() => nextGeneration(population(), [3, 11, NaN, 11, -2, 5], config(), rngs(1))).toThrow(/Fitness\[2\]/);
    // Codex #84: a partly scored generation (a sparse array) must be rejected before selection.
    const partial = new Array<number>(6);
    partial[0] = 10;
    expect(() => nextGeneration(population(), partial, config(), rngs(1))).toThrow(/Fitness\[1\]/);
    expect(() => nextGeneration(population(), partial, config({ eliteCount: 6 }), rngs(1))).toThrow(/Fitness\[1\]/);
    expect(() => nextGeneration(population().slice(1), fitness, config(), rngs(1))).toThrow(/6 genomes/);
    expect(() => nextGeneration(population(), fitness, config(), { ...rngs(1), mutation: undefined } as unknown as EvolutionRngs)).toThrow(
      /"mutation" generator/,
    );
  });

  it('createEvolutionRngs derives three generators from the parent in a fixed order, using three draws', () => {
    const parent = createRng(42);
    const derived = createEvolutionRngs(parent);
    const reference = createRng(42);
    const seeds = [reference.nextUint32(), reference.nextUint32(), reference.nextUint32()];
    expect(derived.selection.getState()).toEqual(createRng(seeds[0]!).getState());
    expect(derived.crossover.getState()).toEqual(createRng(seeds[1]!).getState());
    expect(derived.mutation.getState()).toEqual(createRng(seeds[2]!).getState());
    expect(parent.getState()).toEqual(reference.getState());
  });
});

describe('elitism', () => {
  it('copies the top eliteCount genomes unchanged, in rank order, as new arrays', () => {
    const pop = population();
    const next = nextGeneration(pop, fitness, config({ eliteCount: 3 }), rngs(1));
    expect(next.eliteSources).toEqual([1, 3, 2]); // fitness 11, 11 (tie → lower index first), 7
    next.eliteSources.forEach((source, place) => {
      expect(next.genomes[place]).toEqual(pop[source]);
      expect(next.genomes[place]).not.toBe(pop[source]);
    });
  });

  it('elites are never mutated, even at mutation rate 1 with a large scale', () => {
    const pop = population();
    const next = nextGeneration(pop, fitness, config({ eliteCount: 2, mutation: { rate: 1, scale: 50 } }), rngs(2));
    expect(next.genomes[0]).toEqual(pop[1]);
    expect(next.genomes[1]).toEqual(pop[3]);
    for (const child of next.genomes.slice(2)) child.forEach((gene) => expect(Number.isInteger(gene)).toBe(false));
  });

  it('eliteCount 0 has no elites; eliteCount N copies the whole population in rank order', () => {
    const none = nextGeneration(population(), fitness, config({ eliteCount: 0 }), rngs(3));
    expect(none.eliteSources).toEqual([]);
    expect(none.parents).toHaveLength(6);
    const all = nextGeneration(population(), fitness, config({ eliteCount: 6 }), rngs(3));
    expect(all.eliteSources).toEqual([1, 3, 2, 5, 0, 4]);
    expect(all.parents).toEqual([]);
    all.genomes.forEach((genome, place) => expect(genome).toEqual(population()[all.eliteSources[place]!]));
  });
});

describe('children', () => {
  it('with crossover and mutation off, each child is an exact copy of its first parent', () => {
    const next = nextGeneration(population(), fitness, config({ crossover: { type: 'uniform', rate: 0 }, mutation: { rate: 0, scale: 0.2 } }), rngs(4));
    next.parents.forEach(([a], k) => expect(next.genomes[2 + k]).toEqual(population()[a]));
  });

  it('with mutation off, every child gene comes from one of its two parents at the same position', () => {
    const rng = rngs(5);
    for (let n = 0; n < 50; n += 1) {
      const next = nextGeneration(population(), fitness, config({ crossover: { type: 'uniform', rate: 1 }, mutation: { rate: 0, scale: 1 } }), rng);
      next.parents.forEach(([a, b], k) => {
        next.genomes[2 + k]!.forEach((gene, i) => expect(gene === 100 * a + i || gene === 100 * b + i).toBe(true));
      });
    }
  });

  it('selection favours fitter parents: over many generations the best genome is chosen most often', () => {
    const counts = new Array<number>(6).fill(0);
    const rng = rngs(6);
    for (let n = 0; n < 500; n += 1) {
      for (const [a, b] of nextGeneration(population(), fitness, config(), rng).parents) {
        counts[a]! += 1;
        counts[b]! += 1;
      }
    }
    // Genome 1 (fitness 11, lowest index of the two best) beats all others; genome 4 (fitness −2) is worst.
    expect(Math.max(...counts)).toBe(counts[1]);
    expect(Math.min(...counts)).toBe(counts[4]);
  });
});

describe('population size and genome shape', () => {
  it.each([
    [2, 0, 1],
    [2, 2, 2],
    [5, 1, 5],
    [10, 3, 4],
    [50, 2, 3],
    [101, 10, 7],
  ])('population %s, %s elites, tournament %s: the size and genome length are unchanged', (size, elites, tournament) => {
    const pop = Array.from({ length: size }, (_, g) => Float64Array.from({ length: 13 }, (_, i) => g - i));
    const scores = Array.from({ length: size }, (_, g) => (g * 37) % 11);
    const next = nextGeneration(pop, scores, config({ populationSize: size, eliteCount: elites, selection: { type: 'tournament', size: tournament } }), rngs(size));
    expect(next.genomes).toHaveLength(size);
    expect(next.eliteSources).toHaveLength(elites);
    expect(next.parents).toHaveLength(size - elites);
    for (const genome of next.genomes) {
      expect(genome).toBeInstanceOf(Float64Array);
      expect(genome).toHaveLength(13);
    }
  });
});

describe('determinism and independent generators', () => {
  it('the same seed, config, population and fitness give an identical next generation; a different seed does not', () => {
    const first = nextGeneration(population(), fitness, config(), rngs(7));
    expect(nextGeneration(population(), fitness, config(), rngs(7))).toEqual(first);
    expect(nextGeneration(population(), fitness, config(), rngs(8))).not.toEqual(first);
  });

  it('ten generations in a row reproduce exactly from the same parent seed', () => {
    const run = () => {
      const parent = createRng(9);
      let pop: Float64Array[] = population();
      for (let g = 0; g < 10; g += 1) {
        const scores = pop.map((genome) => genome.reduce((s, x) => s + x, 0)); // a fixed, hand-made score
        pop = [...nextGeneration(pop, scores, config(), createEvolutionRngs(parent)).genomes];
      }
      return pop;
    };
    expect(run()).toEqual(run());
  });

  it('selection never depends on crossover or mutation settings, or on how far their generators have run', () => {
    // Crossover rate 1 uses 9 crossover draws per child and rate 0 uses 1, so a selection that shared the
    // crossover generator would pick different parents.
    const base = nextGeneration(population(), fitness, config({ crossover: { type: 'uniform', rate: 1 }, mutation: { rate: 0, scale: 0 } }), rngs(10)).parents;
    const other = rngs(10);
    for (let i = 0; i < 1000; i += 1) {
      other.crossover.next();
      other.mutation.next();
    }
    const changed = nextGeneration(population(), fitness, config({ crossover: { type: 'uniform', rate: 0 }, mutation: { rate: 1, scale: 3 } }), other);
    expect(changed.parents).toEqual(base);
  });

  it('crossover results never depend on the mutation settings or the mutation generator', () => {
    const noMutation = config({ mutation: { rate: 0, scale: 0.2 } });
    const a = nextGeneration(population(), fitness, noMutation, rngs(11));
    const r = rngs(11);
    for (let i = 0; i < 777; i += 1) r.mutation.next();
    expect(nextGeneration(population(), fitness, noMutation, r)).toEqual(a);
    // Rate 1 with scale 0 changes no gene but makes two extra Gaussian draws per gene. With separate generators
    // the result is identical to rate 0; a mutation that shared the crossover generator would shift crossover.
    const extraDraws = config({ crossover: { type: 'uniform', rate: 1 }, mutation: { rate: 1, scale: 0 } });
    const fewerDraws = config({ crossover: { type: 'uniform', rate: 1 }, mutation: { rate: 0, scale: 0 } });
    expect(nextGeneration(population(), fitness, extraDraws, rngs(12))).toEqual(nextGeneration(population(), fitness, fewerDraws, rngs(12)));
  });
});

describe('isolation', () => {
  it('never writes the population or fitness, and nothing returned aliases them or each other', () => {
    const pop = population();
    const scores = [...fitness];
    const next = nextGeneration(pop, scores, config({ eliteCount: 3, mutation: { rate: 1, scale: 1 } }), rngs(12));
    expect(pop).toEqual(population());
    expect(scores).toEqual(fitness);
    const all = new Set<Float64Array>([...pop, ...next.genomes]);
    expect(all.size).toBe(pop.length + next.genomes.length);
    for (const genome of next.genomes) genome.fill(-1);
    expect(pop).toEqual(population());
  });

  it('a population that contains the same array twice is handled without aliasing the outputs', () => {
    const shared = Float64Array.from([1, 2, 3]);
    const next = nextGeneration([shared, shared], [1, 0], config({ populationSize: 2, eliteCount: 1, selection: { type: 'tournament', size: 1 } }), rngs(13));
    expect(next.genomes[0]).not.toBe(shared);
    expect(next.genomes[1]).not.toBe(shared);
    expect(next.genomes[0]).not.toBe(next.genomes[1]);
    expect(shared).toEqual(Float64Array.from([1, 2, 3]));
  });
});

describe('compatibility and separation', () => {
  it('evolves 159-parameter networks into genomes the network accepts and can run', () => {
    const seeds = createRng(2026);
    const pop = Array.from({ length: 50 }, () => initialParameters(seeds));
    const scores = pop.map((genome) => genome[0]! - genome[158]!); // a hand-made score; the real fitness is P2-06
    const next = nextGeneration(pop, scores, resolveEvolutionConfig(config({ populationSize: 50 })), rngs(14));
    for (const genome of next.genomes) {
      expect(() => checkParameters(genome)).not.toThrow();
      const controls = runNetwork(genome, new Array(9).fill(0.5), { brakeEnabled: true });
      expect(Math.abs(controls.steering)).toBeLessThanOrEqual(1);
    }
  });

  it('evolution imports nothing from inference, training, persistence, rendering or the UI', () => {
    const dir = join(__dirname, '../../src/evolution');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const source = readFileSync(join(dir, file), 'utf8');
      const imports = [...source.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]!);
      for (const path of imports) expect(path, `${file} imports ${path}`).toMatch(/^\.\/|^\.\.\/utils\//);
    }
  });
});
