// Seeded experiments (P2-07): record then replay, completeness, isolation, split enforcement and rejection of
// malformed, incomplete and incompatible records. Every run here is on the training oval. The fitness values are a
// training signal on one track, not evidence of learning, and no validation or held-out track is evaluated.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INPUT_CONTRACT } from '../../src/ai/inputs';
import { PARAMETER_ORDER } from '../../src/ai/network';
import { EVOLUTION_OPERATORS } from '../../src/evolution/population';
import { DEFAULT_SENSOR_CONFIG } from '../../src/sensors/rays';
import { DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import {
  canonicalJson,
  CHAMPION_SELECTION,
  currentContracts,
  EXPERIMENT_CONFIG_FORMAT,
  EXPERIMENT_RECORD_FORMAT,
  ExperimentCompatibilityError,
  ExperimentConfigError,
  ExperimentRecordError,
  manifestRecord,
  MAX_GENERATIONS,
  parseExperimentRecord,
  replayChampion,
  replayExperiment,
  resolveExperimentConfig,
  runExperiment,
  type ExperimentContext,
  type ExperimentRecord,
} from '../../src/training/experiment';
import { FITNESS_VERSION } from '../../src/training/fitness';
import { BUILT_IN_TRACK_SPLITS, freezeModel, isFrozenModel, TrackLeakageError, trainingTrack } from '../../src/training/trackSplits';
import { createTrainer, DEFAULT_TRAINING_CONFIG, evaluateGenome, RNG_STREAMS } from '../../src/training/trainer';
import { RNG_ALGORITHM } from '../../src/utils/rng';
import { sha256Hex } from '../../src/utils/sha256';

const ENGINE = { name: 'node', version: process.version, v8: process.versions.v8 };
const SOURCE = { revision: 'a'.repeat(40), dirty: false, unavailableReason: null, appVersion: '0.0.0' };
const CONTEXT: ExperimentContext = { engine: ENGINE, source: SOURCE, recordedAt: '2026-10-27T00:00:00.000Z' };
const OVAL_HASH = 'sha256:f1c3e1a7f9ef938d7a1ffd4bcb79e4260fd870b4c637fdf43389ee7f4aefe8c2';

/** A short experiment on the training oval: 2 seeds, 4 cars, 2 generations, 10 s episodes. */
const CONFIG = Object.freeze({
  format: EXPERIMENT_CONFIG_FORMAT,
  version: 1,
  id: 'test-oval',
  description: 'Record and replay check on the training oval.',
  trackId: 'stadium-oval',
  seeds: [1, 2],
  generations: 2,
  training: { populationSize: 4, maxEpisodeSeconds: 10 },
});

const RECORD = runExperiment(CONFIG, CONTEXT);
/** A deep copy of the record, as a reader gets it after JSON. */
const copy = (): ExperimentRecord => JSON.parse(JSON.stringify(RECORD)) as ExperimentRecord;
/** A mutable deep copy for building damaged records. */
const mutable = (): Record<string, any> => JSON.parse(JSON.stringify(RECORD)); // eslint-disable-line @typescript-eslint/no-explicit-any
const rehash = (record: Record<string, unknown>): void => {
  record.resultsHash = `sha256:${sha256Hex(canonicalJson(record.runs))}`;
};
const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

describe('record then replay', () => {
  it('replays a recorded experiment from its JSON file to identical results', () => {
    const json = JSON.stringify(RECORD);
    const result = replayExperiment(JSON.parse(json), ENGINE, SOURCE);
    expect(result).toEqual({ identical: true, differences: [], championsReplayed: [true, true], sameSourceRevision: true });
  });

  it('replays each frozen champion alone to its recorded episode', () => {
    const record = parseExperimentRecord(copy(), ENGINE);
    for (const run of record.runs) expect(replayChampion(record, run)).toBe(true);
  });

  it('records the same experiment twice identically, apart from the time it was recorded', () => {
    const again = runExperiment(CONFIG, { ...CONTEXT, recordedAt: '2026-10-28T12:34:56.789Z' });
    expect({ ...again, recordedAt: RECORD.recordedAt }).toEqual(RECORD);
    expect(again.resultsHash).toBe(RECORD.resultsHash);
  });

  it('reports whether the source revision is the same, without rejecting a different one', () => {
    const other = { ...SOURCE, revision: 'b'.repeat(40) };
    expect(replayExperiment(copy(), ENGINE, other)).toMatchObject({ identical: true, sameSourceRevision: false });
    expect(replayExperiment(copy(), ENGINE).sameSourceRevision).toBeNull();
    const unknown = { revision: null, dirty: null, unavailableReason: 'no git', appVersion: '0.0.0' };
    expect(replayExperiment(copy(), ENGINE, unknown).sameSourceRevision).toBeNull();
  });

  it('replays from the record, not from the configuration file or the defaults', () => {
    // A record with non-default settings everywhere replays identically; nothing is filled in from defaults.
    const config = {
      ...CONFIG,
      id: 'non-default',
      seeds: [7],
      training: {
        populationSize: 5,
        eliteCount: 1,
        selection: { type: 'tournament', size: 2 },
        crossover: { type: 'uniform', rate: 0.5 },
        mutation: { rate: 0.3, scale: 0.5 },
        maxEpisodeSeconds: 8,
        stallSeconds: 3,
        maxLaps: 1,
        fitness: { ...DEFAULT_TRAINING_CONFIG.fitness, lapWeight: 4000, collisionPenalty: 100 },
        brakeEnabled: false,
      },
    };
    const record = runExperiment(config, CONTEXT);
    expect(record.configuration.training).toMatchObject({ populationSize: 5, eliteCount: 1, brakeEnabled: false, maxLaps: 1 });
    expect(replayExperiment(JSON.parse(JSON.stringify(record)), ENGINE).identical).toBe(true);
  });
});

describe('what a record contains', () => {
  it('records the format, the experiment, the engine, the source and the time', () => {
    expect(RECORD.format).toBe(EXPERIMENT_RECORD_FORMAT);
    expect(RECORD.version).toBe(1);
    expect(RECORD.experiment).toEqual({ id: 'test-oval', description: CONFIG.description });
    expect(RECORD.engine).toEqual(ENGINE);
    expect(RECORD.source).toEqual(SOURCE);
    expect(RECORD.recordedAt).toBe(CONTEXT.recordedAt);
    expect(RECORD.evaluations).toEqual({ validation: 'none', heldOut: 'none' });
  });

  it('records every contract, the physics, the timestep and the sensors of the code that ran', () => {
    expect(RECORD.contracts).toEqual(currentContracts());
    expect(RECORD.contracts).toEqual({
      simulationVersion: 1,
      rngAlgorithm: RNG_ALGORITHM,
      rngStreams: RNG_STREAMS,
      evolutionOperators: EVOLUTION_OPERATORS,
      initialisation: 'uniform-pm1-v1',
      parameterOrder: PARAMETER_ORDER,
      parameterCount: 159,
      inputContract: INPUT_CONTRACT,
      outputContract: 'steering-throttle-brake-v1',
      fitnessVersion: FITNESS_VERSION,
      timestepSeconds: 1 / 60,
      physics: { ...DEFAULT_VEHICLE_PHYSICS },
      sensors: { origin: 'body-centre', anglesDegrees: [...DEFAULT_SENSOR_CONFIG.anglesDegrees], maxDistance: 50 },
    });
  });

  it('records the whole split manifest with its hash, and the training track by content hash', () => {
    const { manifest, training } = RECORD.tracks;
    expect(manifest.entries.map((e) => [e.id, e.split])).toEqual([
      ['stadium-oval', 'training'],
      ['rounded-rectangle', 'validation'],
      ['hairpin-chicane', 'held-out'],
    ]);
    expect(manifest.entries.map((e) => e.contentHash)).toEqual(BUILT_IN_TRACK_SPLITS.tracks.map((t) => t.contentHash));
    expect(manifest).toEqual(manifestRecord());
    expect(manifest.hash).toBe(
      `sha256:${sha256Hex(canonicalJson({ format: manifest.format, version: manifest.version, entries: manifest.entries }))}`,
    );
    expect(training).toEqual({ id: 'stadium-oval', version: '1', split: 'training', contentHash: OVAL_HASH });
  });

  it('records the complete resolved training configuration and the seeds', () => {
    const { seed, ...defaults } = DEFAULT_TRAINING_CONFIG;
    void seed;
    expect(RECORD.configuration).toEqual({
      seeds: [1, 2],
      generations: 2,
      training: { ...defaults, populationSize: 4, maxEpisodeSeconds: 10 },
    });
    expect(Object.keys(RECORD.configuration.training).sort()).toEqual(Object.keys(defaults).sort());
  });

  it('records the generation and simulated-tick budgets, and stays within them', () => {
    expect(RECORD.budgets).toEqual({
      generations: 2,
      populationSize: 4,
      evaluationsPerRun: 8,
      maxEpisodeTicks: 600,
      stallTicks: 300,
      maxSimulatedTicksPerRun: 4800,
    });
    for (const run of RECORD.runs) {
      expect(run.generations).toHaveLength(2);
      expect(run.simulatedTicks).toBe(run.generations.reduce((sum, g) => sum + g.stats.totalEpisodeTicks, 0));
      expect(run.simulatedTicks).toBeGreaterThan(0);
      expect(run.simulatedTicks).toBeLessThanOrEqual(RECORD.budgets.maxSimulatedTicksPerRun);
    }
  });

  it('records every car raw, consistent with the per-generation statistics', () => {
    for (const run of RECORD.runs) {
      for (const gen of run.generations) {
        expect(gen.cars).toHaveLength(4);
        const totals = gen.cars.map((car) => car.fitness.total);
        for (const car of gen.cars) {
          const f = car.fitness;
          expect(f.total).toBeCloseTo(f.checkpoints + f.partialProgress + f.laps + f.lapTimeBonus - f.collisionPenalty, 9);
          expect(car.ticks).toBeLessThanOrEqual(RECORD.budgets.maxEpisodeTicks);
          expect(car.crashed).toBe(car.outcome === 'crashed');
        }
        const { stats } = gen;
        expect(stats.bestFitness).toBe(Math.max(...totals));
        expect(stats.worstFitness).toBe(Math.min(...totals));
        expect(stats.meanFitness).toBe(totals.reduce((a, b) => a + b, 0) / totals.length);
        expect(totals[stats.championIndex]).toBe(stats.bestFitness);
        expect(stats.generationTicks).toBe(Math.max(...gen.cars.map((c) => c.ticks)));
        expect(stats.totalEpisodeTicks).toBe(gen.cars.reduce((sum, c) => sum + c.ticks, 0));
        expect(stats.carsWithLap).toBe(gen.cars.filter((c) => c.lapTicks.length > 0).length);
        expect(stats.maxGatesPassed).toBe(Math.max(...gen.cars.map((c) => c.gatesPassed)));
        for (const outcome of ['completed', 'crashed', 'stalled', 'timeout'] as const) {
          expect(stats.outcomes[outcome]).toBe(gen.cars.filter((c) => c.outcome === outcome).length);
        }
      }
    }
  });

  it('records exactly what the trainer computes for each seed', () => {
    const environment = { track: trainingTrack('stadium-oval'), physics: DEFAULT_VEHICLE_PHYSICS, timestepSeconds: 1 / 60 };
    RECORD.runs.forEach((run) => {
      const trainer = createTrainer({ ...RECORD.configuration.training, seed: run.seed }, environment);
      for (const gen of run.generations) {
        const stats = trainer.runGeneration();
        expect(gen.stats.championIndex).toBe(stats.championIndex);
        expect(gen.cars.map((c) => c.fitness.total)).toEqual(stats.fitness);
        expect(gen.cars.map((c) => c.outcome)).toEqual(trainer.finished()!.cars.map((c) => c.episode.outcome));
      }
      const final = trainer.record().generations.at(-1)!;
      expect(run.champion.parameters).toEqual(Array.from(final.champion));
    });
  });

  it('freezes each champion with its parameters and the provenance a replay needs', () => {
    RECORD.runs.forEach((run) => {
      const { champion } = run;
      const final = run.generations.at(-1)!;
      expect(champion.parameters).toHaveLength(159);
      expect(champion.provenance).toEqual({
        experimentId: 'test-oval',
        seed: run.seed,
        generation: 1,
        carIndex: final.stats.championIndex,
        trackId: 'stadium-oval',
        trackContentHash: OVAL_HASH,
        selection: CHAMPION_SELECTION,
      });
      const frozen = freezeModel(champion.parameters, { ...champion.provenance });
      expect(isFrozenModel(frozen)).toBe(true);
      expect(champion.id).toBe(frozen.id);
      expect(champion.episode).toEqual(final.cars[final.stats.championIndex]);
    });
    expect(CHAMPION_SELECTION).toBe('best-training-fitness-final-generation');
  });

  it('keeps full precision through JSON', () => {
    const parsed = copy();
    expect(parsed.runs[0]!.champion.parameters).toEqual(RECORD.runs[0]!.champion.parameters);
    expect(canonicalJson(parsed)).toBe(canonicalJson(RECORD));
  });

  it('has a different result for a different seed', () => {
    expect(RECORD.runs[0]!.champion.parameters).not.toEqual(RECORD.runs[1]!.champion.parameters);
  });
});

describe('isolation', () => {
  it('gives each seed the same run alone, together with others, and in any order', () => {
    const alone = (seed: number) => runExperiment({ ...CONFIG, seeds: [seed] }, CONTEXT).runs[0];
    const reversed = runExperiment({ ...CONFIG, seeds: [2, 1] }, CONTEXT);
    expect(alone(1)).toEqual(RECORD.runs[0]);
    expect(alone(2)).toEqual(RECORD.runs[1]);
    expect(reversed.runs[0]).toEqual(RECORD.runs[1]);
    expect(reversed.runs[1]).toEqual(RECORD.runs[0]);
  });

  it('shares no state between experiments in one process', () => {
    const other = runExperiment({ ...CONFIG, id: 'other', seeds: [9], training: { populationSize: 6, maxEpisodeSeconds: 6 } }, CONTEXT);
    expect(other.runs).toHaveLength(1);
    expect(runExperiment(CONFIG, CONTEXT)).toEqual(RECORD);
  });

  it('never writes the configuration or the record it is given', () => {
    const config = deepFreeze(JSON.parse(JSON.stringify(CONFIG)));
    expect(() => runExperiment(config, CONTEXT)).not.toThrow();
    const record = deepFreeze(copy());
    const before = canonicalJson(record);
    expect(replayExperiment(record, ENGINE).identical).toBe(true);
    expect(canonicalJson(record)).toBe(before);
  });
});

describe('split enforcement', () => {
  it.each(['rounded-rectangle', 'hairpin-chicane'])('refuses to train on %s', (trackId) => {
    expect(() => runExperiment({ ...CONFIG, trackId }, CONTEXT)).toThrow(TrackLeakageError);
    expect(() => resolveExperimentConfig({ ...CONFIG, trackId })).toThrow(/training may only use training tracks/);
  });

  it('rejects an unknown track', () => {
    expect(() => resolveExperimentConfig({ ...CONFIG, trackId: 'no-such-track' })).toThrow(ExperimentConfigError);
    expect(() => resolveExperimentConfig({ ...CONFIG, trackId: 'no-such-track' })).toThrow(/no built-in track "no-such-track"/);
  });

  it.each(['rounded-rectangle', 'hairpin-chicane'])('rejects a record edited to claim %s as its training track', (id) => {
    const record = mutable();
    const entry = record.tracks.manifest.entries.find((e: { id: string }) => e.id === id);
    record.tracks.training = { id, version: '1', split: 'training', contentHash: entry.contentHash };
    expect(() => parseExperimentRecord(record, ENGINE)).toThrow(TrackLeakageError);
  });

  it('never uses the selection or held-out boundaries, in the runner or the command line', () => {
    for (const file of ['../../src/training/experiment.ts', '../../scripts/experiment.mjs']) {
      const source = readFileSync(join(__dirname, file), 'utf8');
      for (const name of ['validationTrack', 'selectByValidation', 'heldOutTrack', 'tracksIn']) expect(source).not.toContain(name);
    }
  });

  it('imports only headless modules', () => {
    const source = readFileSync(join(__dirname, '../../src/training/experiment.ts'), 'utf8');
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]!);
    for (const path of imports) expect(path).toMatch(/^(\.\.\/(ai|evolution|sensors|sim|utils)\/|\.\/)/);
  });
});

describe('configuration rejection', () => {
  const bad: [string, Record<string, unknown>, RegExp][] = [
    ['a wrong format', { format: 'other' }, /"format"/],
    ['a wrong version', { version: 2 }, /"version"/],
    ['an unknown field', { extra: 1 }, /unknown field "extra"/],
    ['a bad ID', { id: 'Has Spaces' }, /"id"/],
    ['a missing ID', { id: undefined }, /"id"/],
    ['a long description', { description: 'x'.repeat(1001) }, /"description"/],
    ['no track', { trackId: undefined }, /"trackId"/],
    ['no seeds', { seeds: [] }, /"seeds"/],
    ['seeds that are not a list', { seeds: 1 }, /"seeds"/],
    ['a repeated seed', { seeds: [1, 1] }, /repeat/],
    ['a fractional seed', { seeds: [1.5] }, /seed/],
    ['a negative seed', { seeds: [-1] }, /seed/],
    ['a seed above 2^32 - 1', { seeds: [2 ** 32] }, /seed/],
    ['zero generations', { generations: 0 }, /"generations"/],
    ['fractional generations', { generations: 1.5 }, /"generations"/],
    ['too many generations', { generations: MAX_GENERATIONS + 1 }, /"generations"/],
    ['a training seed', { training: { seed: 3 } }, /training.seed/],
    ['an unknown training field', { training: { speed: 3 } }, /training.speed/],
    ['training that is not an object', { training: [1] }, /"training"/],
    ['settings the trainer rejects', { training: { populationSize: 1 } }, /populationSize/],
    ['an invalid fitness block', { training: { fitness: { version: 2 } } }, /Fitness config/],
  ];
  it.each(bad)('rejects %s', (_, change, message) => {
    const config: Record<string, unknown> = { ...CONFIG, ...change };
    for (const [key, value] of Object.entries(change)) if (value === undefined) delete config[key];
    expect(() => resolveExperimentConfig(config)).toThrow(ExperimentConfigError);
    expect(() => resolveExperimentConfig(config)).toThrow(message);
  });

  it.each([null, [], 'config', 3])('rejects %j', (value) => {
    expect(() => resolveExperimentConfig(value)).toThrow(ExperimentConfigError);
  });

  it('fills unset training fields from the defaults, whole blocks at a time', () => {
    const plan = resolveExperimentConfig({ ...CONFIG, training: { mutation: { rate: 0.5, scale: 0.1 } } });
    expect(plan.training.mutation).toEqual({ rate: 0.5, scale: 0.1 });
    expect(plan.training.populationSize).toBe(DEFAULT_TRAINING_CONFIG.populationSize);
    expect(() => resolveExperimentConfig({ ...CONFIG, training: { mutation: { rate: 0.5 } } })).toThrow(/mutation.scale/);
  });

  it.each([
    ['a bad time', { recordedAt: 'yesterday' }],
    ['no engine', { engine: undefined }],
    ['a bad revision', { source: { ...SOURCE, revision: 'abc' } }],
    ['an unknown revision without a reason', { source: { ...SOURCE, revision: null, dirty: null } }],
  ])('rejects a context with %s', (_, change) => {
    expect(() => runExperiment(CONFIG, { ...CONTEXT, ...change } as unknown as ExperimentContext)).toThrow(ExperimentConfigError);
  });
});

describe('record rejection', () => {
  const malformed = (record: unknown, message: RegExp) => {
    expect(() => parseExperimentRecord(record, ENGINE)).toThrow(ExperimentRecordError);
    expect(() => parseExperimentRecord(record, ENGINE)).toThrow(message);
    expect(() => replayExperiment(record, ENGINE)).toThrow(ExperimentRecordError);
  };
  const incompatible = (record: unknown, message: RegExp) => {
    expect(() => parseExperimentRecord(record, ENGINE)).toThrow(ExperimentCompatibilityError);
    expect(() => parseExperimentRecord(record, ENGINE)).toThrow(message);
  };

  it('accepts the unchanged record', () => {
    expect(parseExperimentRecord(copy(), ENGINE)).toEqual(RECORD);
  });

  it.each([null, [], 'record', 1])('rejects %j', (value) => malformed(value, /record must be an object/));

  it.each(Object.keys(RECORD))('rejects a record without "%s" as incomplete', (key) => {
    const record = mutable();
    delete record[key];
    malformed(record, new RegExp(`incomplete: record\\.${key} is missing`));
  });

  it.each([
    ['runs[0].champion.provenance.seed', (r: Record<string, any>) => delete r.runs[0].champion.provenance.seed], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['runs[0].generations[1].cars[2].fitness.total', (r: Record<string, any>) => delete r.runs[0].generations[1].cars[2].fitness.total], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['contracts.physics.wheelbase', (r: Record<string, any>) => delete r.contracts.physics.wheelbase], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['configuration.training.fitness', (r: Record<string, any>) => delete r.configuration.training.fitness], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['source.revision', (r: Record<string, any>) => delete r.source.revision], // eslint-disable-line @typescript-eslint/no-explicit-any
  ])('rejects a record without %s as incomplete', (path, remove) => {
    const record = mutable();
    remove(record);
    malformed(record, new RegExp(`incomplete: ${path.replace(/[.[\]]/g, '\\$&')} is missing`));
  });

  it('rejects an incomplete nested training block (a missing fitness weight)', () => {
    const record = mutable();
    delete record.configuration.training.fitness.maxLapTimeRatio;
    malformed(record, /configuration.training/);
  });

  it.each([
    ['a wrong format', (r: Record<string, any>) => (r.format = 'other'), /"format"/], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['a newer version', (r: Record<string, any>) => (r.version = 2), /"version"/], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['an unknown top-level field', (r: Record<string, any>) => (r.notes = 'x'), /unknown field "notes"/], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['an unknown car field', (r: Record<string, any>) => (r.runs[0].generations[0].cars[0].speed = 1), /unknown field "speed"/], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['an extra nested training field', (r: Record<string, any>) => (r.configuration.training.mutation.extra = 1), /not a complete resolved/], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['a seed as text', (r: Record<string, any>) => (r.configuration.seeds[0] = '1'), /configuration.seeds\[0\]/], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['a repeated seed', (r: Record<string, any>) => (r.configuration.seeds[1] = 1), /repeats a seed/], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['an unknown outcome', (r: Record<string, any>) => (r.runs[0].generations[0].cars[0].outcome = 'won'), /outcome/], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['a non-finite fitness', (r: Record<string, any>) => (r.runs[0].generations[0].cars[0].fitness.total = Infinity), /finite/], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['too few cars', (r: Record<string, any>) => r.runs[0].generations[0].cars.pop(), /4 entries/], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['too few generations', (r: Record<string, any>) => r.runs[0].generations.pop(), /2 entries/], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['a missing run', (r: Record<string, any>) => r.runs.pop(), /runs must have 2 entries/], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['a run with the wrong seed', (r: Record<string, any>) => (r.runs[0].seed = 5), /seed must be configuration.seeds\[0\]/], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['a renumbered generation', (r: Record<string, any>) => (r.runs[0].generations[1].generation = 5), /generation must be 1/], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['edited budgets', (r: Record<string, any>) => (r.budgets.maxEpisodeTicks = 99), /budgets do not match/], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['wrong used ticks', (r: Record<string, any>) => (r.runs[0].simulatedTicks += 1), /simulatedTicks/], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['a car over the tick budget', (r: Record<string, any>) => (r.runs[0].generations[0].cars[0].ticks = 601), /ticks must be an integer from 0 to 600/], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['158 champion parameters', (r: Record<string, any>) => r.runs[0].champion.parameters.pop(), /159 entries/], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['an edited champion parameter', (r: Record<string, any>) => (r.runs[0].champion.parameters[5] += 1e-9), /champion.id does not match/], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['a forged champion ID', (r: Record<string, any>) => (r.runs[0].champion.id = `sha256:${'0'.repeat(64)}`), /champion.id does not match/], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['edited provenance', (r: Record<string, any>) => (r.runs[0].champion.provenance.selection = 'validation'), /provenance does not match/], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['a champion episode that is not its car', (r: Record<string, any>) => (r.runs[0].champion.episode.ticks = 0), /champion.episode must equal/], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['a claimed evaluation', (r: Record<string, any>) => (r.evaluations.heldOut = 'hairpin-chicane'), /evaluations/], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['a bad recording time', (r: Record<string, any>) => (r.recordedAt = 'today'), /recordedAt/], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['an edited manifest hash', (r: Record<string, any>) => (r.tracks.manifest.hash = `sha256:${'0'.repeat(64)}`), /manifest.hash does not match/], // eslint-disable-line @typescript-eslint/no-explicit-any
  ])('rejects %s as malformed', (_, change, message) => {
    const record = mutable();
    change(record);
    rehash(record);
    malformed(record, message);
  });

  it('rejects a record whose results were changed without updating resultsHash', () => {
    const record = mutable();
    record.runs[0].generations[0].cars[1].fitness.total += 1;
    malformed(record, /resultsHash does not match/);
  });

  it('rejects a JSON number too large for a double', () => {
    const first = RECORD.runs[0]!.champion.parameters[0]!;
    const json = JSON.stringify(RECORD).replace(`"parameters":[${JSON.stringify(first)},`, '"parameters":[1e999,');
    expect(json).toContain('1e999');
    malformed(JSON.parse(json), /champion.parameters\[0\] must be a finite number, got Infinity/);
    const contract = JSON.stringify(RECORD).replace('"parameterCount":159', '"parameterCount":1e999');
    incompatible(JSON.parse(contract), /contracts.parameterCount/);
  });

  it.each([
    ['another engine version', (r: Record<string, any>) => (r.engine.version = 'v22.0.0'), /engine/], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['another V8', (r: Record<string, any>) => (r.engine.v8 = '1.0'), /engine/], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['another engine', (r: Record<string, any>) => (r.engine.name = 'bun'), /engine/], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['another fitness version', (r: Record<string, any>) => (r.contracts.fitnessVersion = 2), /contracts.fitnessVersion/], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['another simulation version', (r: Record<string, any>) => (r.contracts.simulationVersion = 2), /contracts.simulationVersion/], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['another RNG', (r: Record<string, any>) => (r.contracts.rngAlgorithm = 'mulberry32'), /contracts.rngAlgorithm/], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['another RNG stream layout', (r: Record<string, any>) => (r.contracts.rngStreams = 'v2'), /contracts.rngStreams/], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['other physics', (r: Record<string, any>) => (r.contracts.physics.engineAcceleration = 9), /contracts.physics/], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['another timestep', (r: Record<string, any>) => (r.contracts.timestepSeconds = 1 / 30), /contracts.timestepSeconds/], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['other sensors', (r: Record<string, any>) => (r.contracts.sensors.maxDistance = 60), /contracts.sensors/], // eslint-disable-line @typescript-eslint/no-explicit-any
    [
      'another manifest',
      (r: Record<string, any>) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        r.tracks.manifest.entries[2].contentHash = `sha256:${'1'.repeat(64)}`;
        const { format, version, entries } = r.tracks.manifest;
        r.tracks.manifest.hash = `sha256:${sha256Hex(canonicalJson({ format, version, entries }))}`;
      },
      /manifest/,
    ],
    ['another version of the training track', (r: Record<string, any>) => (r.tracks.training.contentHash = `sha256:${'2'.repeat(64)}`), /tracks.training/], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['an unknown training track', (r: Record<string, any>) => (r.tracks.training.id = 'no-such-track'), /"no-such-track" is not a built-in track/], // eslint-disable-line @typescript-eslint/no-explicit-any
  ])('rejects a record from %s as incompatible', (_, change, message) => {
    const record = mutable();
    change(record);
    incompatible(record, message);
    expect(() => replayExperiment(record, ENGINE)).toThrow(ExperimentCompatibilityError);
  });

  it('rejects a record from another engine, as the current engine sees it', () => {
    expect(() => parseExperimentRecord(copy(), { ...ENGINE, version: 'v26.0.0' })).toThrow(/only reproducible within one engine/);
  });
});

describe('replay detects changed results', () => {
  it('reports the path of a result changed consistently (hash recomputed)', () => {
    const record = mutable();
    const final = record.runs[1].generations[1];
    const other = (final.stats.championIndex + 1) % 4;
    final.cars[other].fitness.total += 0.5;
    rehash(record);
    const result = replayExperiment(record, ENGINE);
    expect(result.identical).toBe(false);
    expect(result.championsReplayed).toEqual([true, true]);
    expect(result.differences).toHaveLength(1);
    expect(result.differences[0]).toContain(`runs[1].generations[1].cars[${other}].fitness.total`);
  });

  it('reports a champion that does not reproduce its episode', () => {
    const record = mutable();
    const run = record.runs[0];
    run.champion.parameters = run.champion.parameters.map((p: number) => -p);
    run.champion.id = freezeModel(run.champion.parameters, run.champion.provenance).id;
    rehash(record);
    const result = replayExperiment(record, ENGINE);
    expect(result.identical).toBe(false);
    expect(result.differences.some((d) => d.startsWith('runs[0].champion.parameters'))).toBe(true);
    expect(result.championsReplayed[1]).toBe(true);
  });

  it('detects a frozen champion whose parameters no longer give its recorded episode', () => {
    const record = parseExperimentRecord(copy(), ENGINE);
    const run = record.runs[0]!;
    const environment = { track: trainingTrack('stadium-oval'), physics: DEFAULT_VEHICLE_PHYSICS, timestepSeconds: 1 / 60 };
    const setup = createTrainer({ ...record.configuration.training, seed: run.seed }, environment).setup;
    const episodeOf = (parameters: readonly number[]) => {
      const { episode } = evaluateGenome(Float64Array.from(parameters), setup);
      return [episode.outcome, episode.tick, episode.gatesPassed, episode.partialProgress];
    };
    const recorded = run.champion.episode;
    // Another network whose episode really differs from the champion's (checked here, not assumed).
    const candidates = [record.runs[1]!.champion.parameters, run.champion.parameters.map((p) => -p), new Array<number>(159).fill(0)];
    const other = candidates.find((p) => canonicalJson(episodeOf(p)) !== canonicalJson([recorded.outcome, recorded.ticks, recorded.gatesPassed, recorded.partialProgress]));
    expect(other).toBeDefined();
    expect(replayChampion(record, { ...run, champion: { ...run.champion, parameters: other! } })).toBe(false);
    expect(replayChampion(record, run)).toBe(true);
  });
});
