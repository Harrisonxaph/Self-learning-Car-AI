// The saved model format (P3-05, docs/MODEL_FORMAT.md): building a document from a real champion, and one test per
// validation rule. Seeded runs of the real trainer; nothing here is evidence of learning (docs/AI_EVALUATION.md).
import { describe, expect, it } from 'vitest';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { PARAMETER_COUNT } from '../../src/ai/network';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS, SIMULATION_VERSION, terminalSpeed, type VehiclePhysics } from '../../src/sim/config';
import { loadTrack } from '../../src/sim/track';
import { buildModel, compatibility, MAX_MODEL_BYTES, modelParameters, validateModel, type BuildModelInput, type ModelDocument } from '../../src/persistence/modelFormat';
import { tracksIn } from '../../src/training/trackSplits';
import { createChampionReplay } from '../../src/training/championReplay';
import { createTrainer, DEFAULT_TRAINING_CONFIG } from '../../src/training/trainer';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const ENV = { track: loadTrack(stadiumOval), physics: DEFAULT_VEHICLE_PHYSICS, timestepSeconds: DEFAULT_SIM_CONFIG.timestepSeconds };
const trainer = createTrainer({ ...DEFAULT_TRAINING_CONFIG, seed: 7, populationSize: 8, eliteCount: 2, maxEpisodeSeconds: 15 }, ENV);
const stats = trainer.runGeneration();
const record = trainer.record();
const REGISTRY = tracksIn('training');
const validateModelWith = (value: unknown) => validateModel(value, REGISTRY);

const input = (overrides: Partial<BuildModelInput> = {}): BuildModelInput => ({
  champion: stats.champion,
  fitness: stats.bestFitness,
  generation: stats.generation,
  record,
  id: '4f1c2b8e-1d2a-4c9b-9a0e-0d1f2e3a4b5c',
  createdAt: '2026-11-08T22:00:00.000Z',
  codeVersion: 'abc1234',
  appVersion: '0.0.0',
  name: 'Generation 1 champion',
  ...overrides,
});

const model = (): ModelDocument => buildModel(input());
/** The document as it comes back from storage: through JSON text. */
const roundTrip = (m: ModelDocument = model()): unknown => JSON.parse(JSON.stringify(m));
/** A fresh parsed copy, edited by `edit`. */
function broken(edit: (doc: Json) => void): unknown {
  const doc = roundTrip() as Json;
  edit(doc);
  return doc;
}
const errorsOf = (value: unknown): readonly string[] => {
  const result = validateModelWith(value);
  if (result.ok) throw new Error('Expected the model to be rejected.');
  return result.errors;
};

describe('buildModel', () => {
  it('builds a document that validates, from a real champion and run', () => {
    const result = validateModelWith(roundTrip());
    expect(result.ok).toBe(true);
    const m = model();
    expect(m.format).toBe('self-driving-ai-evolution/model');
    expect(m.schemaVersion).toBe(1);
    expect(m.simulationVersion).toBe(SIMULATION_VERSION);
    expect(m.parameters.count).toBe(PARAMETER_COUNT);
    expect(m.training.configuration.generations).toBeNull();
    expect(m.training.seed).toBe(7);
    expect(m.training.trackIds).toEqual(['stadium-oval']);
    expect(m.training.trackHashes['stadium-oval']).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(m.fitness).toBe(stats.bestFitness);
    expect(m.training.generation).toBe(stats.generation);
  });

  it('keeps every parameter exactly through JSON, including subnormals and the extremes', () => {
    const special = Float64Array.from(stats.champion);
    special[0] = 0;
    special[1] = 5e-324;
    special[2] = Number.MAX_VALUE;
    special[3] = -Number.MAX_VALUE;
    special[4] = 0.1 + 0.2;
    special[5] = 1 / 3;
    const back = validateModelWith(roundTrip(buildModel(input({ champion: special }))));
    if (!back.ok) throw new Error(back.errors.join('; '));
    const values = modelParameters(back.model);
    expect(values).toHaveLength(PARAMETER_COUNT);
    special.forEach((v, i) => expect(Object.is(values[i], v), `value ${i}`).toBe(true));
  });

  it('stores negative zero as zero, which JSON would do anyway, and a network with either drives identically', () => {
    const withNegativeZero = Float64Array.from(stats.champion);
    withNegativeZero[0] = -0;
    withNegativeZero[40] = -0;
    withNegativeZero[158] = -0;
    const built = buildModel(input({ champion: withNegativeZero }));
    expect(built.parameters.values.every((v) => !Object.is(v, -0))).toBe(true);
    expect(JSON.parse(JSON.stringify(built)).parameters.values).toEqual(built.parameters.values);
    const normalised = Float64Array.from(built.parameters.values);
    const a = createChampionReplay(withNegativeZero, trainer.setup);
    const b = createChampionReplay(normalised, trainer.setup);
    let frames = 0;
    for (let fa = a.step(), fb = b.step(); fa && fb; fa = a.step(), fb = b.step()) {
      expect(fb.decision.controls).toEqual(fa.decision.controls);
      expect(fb.after).toEqual(fa.after);
      frames += 1;
    }
    expect(frames).toBeGreaterThan(10);
    expect(b.done()).toBe(a.done());
  });

  it('does not share memory with the champion it was built from', () => {
    const champion = Float64Array.from(stats.champion);
    const m = buildModel(input({ champion }));
    champion.fill(0);
    expect(m.parameters.values).toEqual(Array.from(stats.champion));
  });

  it('omits an optional name and app version that were not given', () => {
    const m = buildModel(input({ name: undefined, appVersion: undefined }));
    expect('name' in m).toBe(false);
    expect('appVersion' in m).toBe(false);
    expect(validateModelWith(JSON.parse(JSON.stringify(m))).ok).toBe(true);
  });

  it('refuses a champion from a run that was not on a registered training track', () => {
    const unregistered = { ...record, versions: { ...record.versions, trackSplit: 'unregistered' as const } };
    expect(() => buildModel(input({ record: unregistered }))).toThrow(RangeError);
  });

  it('takes its id and time from the caller and reads no clock or random source', () => {
    expect(buildModel(input({ id: 'x-1', createdAt: '2020-01-01T00:00:00Z' }))).toMatchObject({ id: 'x-1', createdAt: '2020-01-01T00:00:00Z' });
    expect(buildModel(input())).toEqual(buildModel(input()));
  });
});

describe('validateModel: shape, format and version', () => {
  it.each([null, undefined, 3, 'text', [], true])('rejects %j, which is not an object', (value) => {
    expect(errorsOf(value)[0]).toContain('not a model');
  });
  it('rejects a wrong format and checks it before anything else', () => {
    const errors = errorsOf(broken((d) => {
      d.format = 'something-else';
      delete d.parameters;
    }));
    expect(errors).toEqual(['"format" must be "self-driving-ai-evolution/model".']);
  });
  it.each([0, -1, 1.5, '1', null])('rejects schemaVersion %j', (schemaVersion) => {
    expect(errorsOf(broken((d) => (d.schemaVersion = schemaVersion))).join(' ')).toContain('schemaVersion');
  });
  it('refuses a newer schema as made by a newer version, without reading the rest', () => {
    const errors = errorsOf(broken((d) => {
      d.schemaVersion = 2;
      delete d.parameters;
    }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('newer version');
  });
  it('accepts the real document and returns it', () => {
    const result = validateModelWith(roundTrip());
    expect(result.ok && result.model.id).toBe('4f1c2b8e-1d2a-4c9b-9a0e-0d1f2e3a4b5c');
  });
});

describe('validateModel: required top-level fields', () => {
  it.each([
    ['id missing', (d: Json) => delete d.id, '"id"'],
    ['id empty', (d: Json) => (d.id = ''), '"id"'],
    ['id a number', (d: Json) => (d.id = 5), '"id"'],
    ['id with a slash', (d: Json) => (d.id = 'a/b'), '"id"'],
    ['id with a space', (d: Json) => (d.id = 'a b'), '"id"'],
    ['id too long', (d: Json) => (d.id = 'x'.repeat(101)), '"id"'],
    ['name a number', (d: Json) => (d.name = 5), '"name"'],
    ['name too long', (d: Json) => (d.name = 'x'.repeat(201)), '"name"'],
    ['createdAt missing', (d: Json) => delete d.createdAt, '"createdAt"'],
    ['createdAt not ISO', (d: Json) => (d.createdAt = 'yesterday'), '"createdAt"'],
    ['createdAt impossible', (d: Json) => (d.createdAt = '2026-13-45T25:61:61Z'), '"createdAt"'],
    ['createdAt not UTC', (d: Json) => (d.createdAt = '2026-11-08T22:00:00+01:00'), '"createdAt"'],
    ['codeVersion missing', (d: Json) => delete d.codeVersion, '"codeVersion"'],
    ['codeVersion empty', (d: Json) => (d.codeVersion = ''), '"codeVersion"'],
    ['appVersion a number', (d: Json) => (d.appVersion = 1), '"appVersion"'],
    ['simulationVersion missing', (d: Json) => delete d.simulationVersion, '"simulationVersion"'],
    ['simulationVersion zero', (d: Json) => (d.simulationVersion = 0), '"simulationVersion"'],
    ['simulationVersion fractional', (d: Json) => (d.simulationVersion = 1.5), '"simulationVersion"'],
    ['fitness missing', (d: Json) => delete d.fitness, '"fitness"'],
    ['fitness null', (d: Json) => (d.fitness = null), '"fitness"'],
    ['fitness a string', (d: Json) => (d.fitness = '5'), '"fitness"'],
    ['evaluation not an array', (d: Json) => (d.evaluation = {}), '"evaluation"'],
  ])('rejects %s', (_name, edit, fragment) => {
    expect(errorsOf(broken(edit)).join(' ')).toContain(fragment);
  });
  it('accepts a document without a name, an app version or an evaluation', () => {
    expect(validateModelWith(broken((d) => {
      delete d.name;
      delete d.appVersion;
      delete d.evaluation;
    })).ok).toBe(true);
  });
});

describe('validateModel: architecture', () => {
  it.each([
    ['not an object', (d: Json) => (d.architecture = 'x'), '"architecture"'],
    ['type', (d: Json) => (d.architecture.type = 'recurrent'), 'architecture.type'],
    ['layers [9,8,3]', (d: Json) => (d.architecture.layers = [9, 8, 3]), 'architecture.layers'],
    ['layers [9,12,4]', (d: Json) => (d.architecture.layers = [9, 12, 4]), 'architecture.layers'],
    ['layers missing', (d: Json) => delete d.architecture.layers, 'architecture.layers'],
    ['hiddenActivation', (d: Json) => (d.architecture.hiddenActivation = 'relu'), 'hiddenActivation'],
    ['outputActivations', (d: Json) => (d.architecture.outputActivations = ['tanh', 'tanh', 'sigmoid']), 'outputActivations'],
    ['inputs reordered', (d: Json) => d.architecture.inputs.reverse(), 'architecture.inputs'],
    ['inputs short', (d: Json) => d.architecture.inputs.pop(), 'architecture.inputs'],
    ['outputs', (d: Json) => (d.architecture.outputs = ['steering', 'brake', 'throttle']), 'architecture.outputs'],
    ['brakeEnabled missing', (d: Json) => delete d.architecture.brakeEnabled, 'brakeEnabled'],
    ['brakeEnabled a string', (d: Json) => (d.architecture.brakeEnabled = 'true'), 'brakeEnabled'],
  ])('rejects %s', (_name, edit, fragment) => {
    expect(errorsOf(broken(edit)).join(' ')).toContain(fragment);
  });
  it('names what was expected for an unknown architecture', () => {
    expect(errorsOf(broken((d) => (d.architecture.layers = [9, 8, 3])))[0]).toContain('[9, 12, 3]');
  });
});

describe('validateModel: parameters', () => {
  it.each([
    ['not an object', (d: Json) => (d.parameters = []), '"parameters"'],
    ['count 158', (d: Json) => (d.parameters.count = 158), 'parameters.count'],
    ['count 160', (d: Json) => (d.parameters.count = 160), 'parameters.count'],
    ['count a string', (d: Json) => (d.parameters.count = '159'), 'parameters.count'],
    ['order wrong', (d: Json) => (d.parameters.order = 'row-major'), 'parameters.order'],
    ['order missing', (d: Json) => delete d.parameters.order, 'parameters.order'],
    ['values not an array', (d: Json) => (d.parameters.values = 'abc'), 'parameters.values'],
    ['values an object', (d: Json) => (d.parameters.values = { length: 159 }), 'parameters.values'],
    ['158 values', (d: Json) => d.parameters.values.pop(), 'exactly 159'],
    ['160 values', (d: Json) => d.parameters.values.push(0), 'exactly 159'],
    ['a null value', (d: Json) => (d.parameters.values[10] = null), 'values[10]'],
    ['a string value', (d: Json) => (d.parameters.values[11] = '0.5'), 'values[11]'],
    ['a boolean value', (d: Json) => (d.parameters.values[12] = true), 'values[12]'],
    ['a missing (undefined) value', (d: Json) => (d.parameters.values[13] = undefined), 'values[13]'],
  ])('rejects %s', (_name, edit, fragment) => {
    expect(errorsOf(broken(edit)).join(' ')).toContain(fragment);
  });

  it('rejects NaN, Infinity and -Infinity that never came from JSON text', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(errorsOf(broken((d) => (d.parameters.values[20] = bad))).join(' ')).toContain('values[20]');
    }
  });

  it('rejects an exponent that overflows to Infinity when the text is parsed', () => {
    const text = JSON.stringify(model()).replace(/"values":\[[^,\]]+/, '"values":[1e999');
    expect(text).toContain('1e999');
    const parsed = JSON.parse(text);
    expect(parsed.parameters.values[0]).toBe(Number.POSITIVE_INFINITY);
    expect(errorsOf(parsed).join(' ')).toContain('values[0]');
  });

  it('checks the length before reading a huge array element by element', () => {
    const huge = new Array(5_000_000).fill(0);
    const errors = errorsOf(broken((d) => (d.parameters.values = huge)));
    expect(errors.join(' ')).toContain('exactly 159');
    expect(errors.join(' ')).not.toContain('values[');
  });
});

describe('validateModel: training configuration', () => {
  const cfg = (edit: (c: Json, d: Json) => void) => (d: Json) => edit(d.training.configuration, d);
  it.each([
    ['training missing', (d: Json) => delete d.training, '"training"'],
    ['generation negative', (d: Json) => (d.training.generation = -1), 'training.generation'],
    ['generation fractional', (d: Json) => (d.training.generation = 1.5), 'training.generation'],
    ['seed negative', (d: Json) => (d.training.seed = -1), 'training.seed'],
    ['seed too large', (d: Json) => (d.training.seed = 2 ** 32), 'training.seed'],
    ['seed fractional', (d: Json) => (d.training.seed = 1.5), 'training.seed'],
    ['seed missing', (d: Json) => delete d.training.seed, 'training.seed'],
    ['null seed without a reason', (d: Json) => (d.training.seed = null), 'seedUnavailableReason'],
    ['configuration missing', (d: Json) => delete d.training.configuration, 'training.configuration'],
    ['timestep zero', cfg((c) => (c.timestepSeconds = 0)), 'timestepSeconds'],
    ['timestep a string', cfg((c) => (c.timestepSeconds = '0.016')), 'timestepSeconds'],
    ['prng algorithm', cfg((c) => (c.prng.algorithm = 'mulberry32')), 'training.configuration.prng'],
    ['prng version', cfg((c) => (c.prng.version = 2)), 'training.configuration.prng'],
    ['prng missing', cfg((c) => delete c.prng), 'training.configuration.prng'],
    ['generations zero', cfg((c) => (c.generations = 0)), 'generations'],
    ['generations fractional', cfg((c) => (c.generations = 2.5)), 'generations'],
    ['generations missing', cfg((c) => delete c.generations), 'generations'],
    ['populationSize negative', cfg((c) => (c.populationSize = -1)), 'populationSize'],
    ['eliteCount a string', cfg((c) => (c.eliteCount = '2')), 'eliteCount'],
    ['maxLaps missing', cfg((c) => delete c.maxLaps), 'maxLaps'],
    ['maxEpisodeSeconds zero', cfg((c) => (c.maxEpisodeSeconds = 0)), 'maxEpisodeSeconds'],
    ['stallSeconds NaN', cfg((c) => (c.stallSeconds = Number.NaN)), 'stallSeconds'],
    ['brakeEnabled missing', cfg((c) => delete c.brakeEnabled), 'training.configuration.brakeEnabled'],
    ['brakeEnabled disagrees', cfg((c) => (c.brakeEnabled = false)), 'must agree with "architecture.brakeEnabled"'],
    ['selection missing', cfg((c) => delete c.selection), 'selection'],
    ['inputContract', cfg((c) => (c.inputContract = 'other-v2')), 'inputContract'],
    ['outputContract', cfg((c) => (c.outputContract = 'other-v2')), 'outputContract'],
    ['summary populationSize disagrees', (d: Json) => (d.training.populationSize = 51), 'training.populationSize'],
    ['summary eliteCount disagrees', (d: Json) => (d.training.eliteCount = 3), 'training.eliteCount'],
    ['summary selection disagrees', (d: Json) => (d.training.selection.size = 9), 'training.selection'],
    ['summary crossover disagrees', (d: Json) => (d.training.crossover.rate = 0.1), 'training.crossover'],
    ['summary mutation disagrees', (d: Json) => (d.training.mutation.scale = 5), 'training.mutation'],
    ['summary maxEpisodeSeconds disagrees', (d: Json) => (d.training.maxEpisodeSeconds = 99), 'training.maxEpisodeSeconds'],
    ['summary fitnessVersion disagrees', (d: Json) => (d.training.fitnessVersion = 9), 'fitnessVersion'],
  ])('rejects %s', (_name, edit, fragment) => {
    expect(errorsOf(broken(edit)).join(' ')).toContain(fragment);
  });

  it.each([0, 1, 4_294_967_295])('accepts the seed %i, the ends of the unsigned 32-bit range included', (seed) => {
    expect(validateModelWith(broken((d) => (d.training.seed = seed))).ok).toBe(true);
  });
  it.each([['a string', '7'], ['negative', -1], ['fractional', 0.5], ['2^32', 4_294_967_296], ['NaN', Number.NaN], ['an object', {}]])('rejects a seed that is %s', (_name, seed) => {
    expect(errorsOf(broken((d) => (d.training.seed = seed))).join(' ')).toContain('training.seed');
  });
  it.each([['empty', ''], ['a number', 5], ['missing', undefined]])('rejects a null seed whose reason is %s', (_name, reason) => {
    expect(errorsOf(broken((d) => {
      d.training.seed = null;
      d.training.seedUnavailableReason = reason;
    })).join(' ')).toContain('seedUnavailableReason');
  });
  it('accepts a null seed with a reason, and a positive generation budget', () => {
    expect(validateModelWith(broken((d) => {
      d.training.seed = null;
      d.training.seedUnavailableReason = 'imported from an unseeded run';
      d.training.configuration.generations = 50;
    })).ok).toBe(true);
  });
});

describe('validateModel: nested settings and their ranges', () => {
  const both = (key: string, edit: (o: Json) => void) => (d: Json) => {
    edit(d.training.configuration[key]);
    edit(d.training[key]);
  };
  const cfg = (edit: (c: Json) => void) => (d: Json) => edit(d.training.configuration);
  it.each([
    ['selection {} in both places', (d: Json) => { d.training.configuration.selection = {}; d.training.selection = {}; }, 'selection.type'],
    ['selection type unknown', both('selection', (o) => (o.type = 'roulette')), 'selection.type'],
    ['selection size 0', both('selection', (o) => (o.size = 0)), 'selection.size'],
    ['selection size above the population', both('selection', (o) => (o.size = 9)), 'selection.size'],
    ['selection size fractional', both('selection', (o) => (o.size = 2.5)), 'selection.size'],
    ['crossover type unknown', both('crossover', (o) => (o.type = 'one-point')), 'crossover.type'],
    ['crossover rate above 1', both('crossover', (o) => (o.rate = 1.5)), 'crossover.rate'],
    ['crossover rate negative', both('crossover', (o) => (o.rate = -0.1)), 'crossover.rate'],
    ['mutation rate above 1', both('mutation', (o) => (o.rate = 2)), 'mutation.rate'],
    ['mutation scale negative', both('mutation', (o) => (o.scale = -1)), 'mutation.scale'],
    ['mutation scale NaN', both('mutation', (o) => (o.scale = Number.NaN)), 'mutation.scale'],
    ['populationSize 0 in both places', (d: Json) => { d.training.configuration.populationSize = 0; d.training.populationSize = 0; }, 'populationSize'],
    ['populationSize 1', (d: Json) => { d.training.configuration.populationSize = 1; d.training.populationSize = 1; }, 'populationSize'],
    ['populationSize above the limit', (d: Json) => { d.training.configuration.populationSize = 100_001; d.training.populationSize = 100_001; }, 'populationSize'],
    ['eliteCount above the population', (d: Json) => { d.training.configuration.eliteCount = 99; d.training.eliteCount = 99; }, 'eliteCount'],
    ['eliteCount negative', (d: Json) => { d.training.configuration.eliteCount = -1; d.training.eliteCount = -1; }, 'eliteCount'],
    ['maxLaps 0', cfg((c) => (c.maxLaps = 0)), 'maxLaps'],
    ['maxEpisodeSeconds beyond the limit', (d: Json) => { d.training.configuration.maxEpisodeSeconds = 1e9; d.training.maxEpisodeSeconds = 1e9; }, 'maxEpisodeSeconds'],
    ['stallSeconds beyond the limit', cfg((c) => (c.stallSeconds = 1e9)), 'stallSeconds'],
    ['timestep too small', cfg((c) => (c.timestepSeconds = 0.0001)), 'timestepSeconds'],
    ['timestep too large', cfg((c) => (c.timestepSeconds = 1)), 'timestepSeconds'],
    ['wheelbase negative', cfg((c) => (c.physics.wheelbase = -1)), 'physics.wheelbase'],
    ['wheelbase zero', cfg((c) => (c.physics.wheelbase = 0)), 'physics.wheelbase'],
    ['engine acceleration zero', cfg((c) => (c.physics.engineAcceleration = 0)), 'engineAcceleration'],
    ['brake deceleration negative', cfg((c) => (c.physics.brakeDeceleration = -1)), 'brakeDeceleration'],
    ['drag negative', cfg((c) => (c.physics.quadraticDrag = -0.01)), 'quadraticDrag'],
    ['rolling resistance negative', cfg((c) => (c.physics.rollingResistance = -0.1)), 'rollingResistance'],
    ['steer angle at a right angle', cfg((c) => (c.physics.maxSteerRadians = Math.PI / 2)), 'maxSteerRadians'],
    ['lateral acceleration zero', cfg((c) => (c.physics.maxLateralAcceleration = 0)), 'maxLateralAcceleration'],
    ['vehicle length zero', cfg((c) => (c.physics.vehicleLength = 0)), 'vehicleLength'],
    ['vehicle width negative', cfg((c) => (c.physics.vehicleWidth = -2)), 'vehicleWidth'],
    ['stop speed negative', cfg((c) => (c.physics.stopSpeed = -1)), 'stopSpeed'],
    ['fitness weight negative', cfg((c) => (c.fitness.lapWeight = -1)), 'fitness.lapWeight'],
    ['fitness reference lap time zero', cfg((c) => (c.fitness.referenceLapSeconds = 0)), 'referenceLapSeconds'],
    ['fitness lap ratio below 1', cfg((c) => (c.fitness.maxLapTimeRatio = 0.5)), 'maxLapTimeRatio'],
  ])('rejects %s, naming the field', (_name, edit, fragment) => {
    expect(errorsOf(broken(edit)).join(' ')).toContain(fragment);
  });

  it('rejects physics with no drag at all, whose top speed is not finite', () => {
    expect(errorsOf(broken(cfg((c) => { c.physics.quadraticDrag = 0; c.physics.rollingResistance = 0; }))).join(' ')).toContain('maxSpeed');
  });
});

describe('validateModel and compatibility: key order and extra fields do not matter', () => {
  const reorder = (value: Json): Json => Object.fromEntries(Object.entries(value).reverse());
  const compatOf = (doc: unknown) => {
    const result = validateModelWith(doc);
    if (!result.ok) throw new Error(result.errors.join('; '));
    return compatibility(result.model);
  };
  it('accepts the sensors, physics and operators with their keys in another order, and still drives them without a warning', () => {
    const doc = broken((d) => {
      const c = d.training.configuration;
      c.sensors = reorder(c.sensors);
      c.physics = reorder(c.physics);
      c.selection = reorder(c.selection);
      c.crossover = reorder(c.crossover);
      c.mutation = reorder(c.mutation);
      d.training.selection = reorder(d.training.selection);
      d.training.crossover = reorder(d.training.crossover);
      d.training.mutation = reorder(d.training.mutation);
      c.fitness = reorder(c.fitness);
    });
    expect(compatOf(doc)).toEqual({ drivable: true, reasons: [], warnings: [] });
  });
  it('ignores unknown extra fields in the sensors, physics and operators', () => {
    const doc = broken((d) => {
      const c = d.training.configuration;
      c.sensors.futureField = 'x';
      c.physics.futureField = 1;
      c.selection.futureField = true;
      d.training.selection.futureField = false;
      d.extra = { anything: 1 };
    });
    expect(compatOf(doc)).toEqual({ drivable: true, reasons: [], warnings: [] });
  });
  it('still refuses a different angle order, which is a different sensor layout', () => {
    const doc = broken((d) => d.training.configuration.sensors.anglesDegrees.reverse());
    expect(compatOf(doc).drivable).toBe(false);
  });
});

describe('validateModel: physics, sensors and fitness', () => {
  const phys = (edit: (p: Json) => void) => (d: Json) => edit(d.training.configuration.physics);
  it.each(Object.keys(DEFAULT_VEHICLE_PHYSICS))('requires a finite physics field %s, with no default', (key) => {
    expect(errorsOf(broken(phys((p) => delete p[key]))).join(' ')).toContain(key);
    expect(errorsOf(broken(phys((p) => (p[key] = Number.NaN)))).join(' ')).toContain(key);
  });
  it('recomputes the speed limit and rejects a mismatch', () => {
    expect(errorsOf(broken(phys((p) => (p.maxSpeed = p.maxSpeed + 0.5)))).join(' ')).toContain('terminal speed');
    expect(errorsOf(broken(phys((p) => (p.engineAcceleration = 9)))).join(' ')).toContain('terminal speed');
  });
  it('accepts a different but self-consistent physics', () => {
    expect(validateModelWith(broken(phys((p) => {
      p.engineAcceleration = 9;
      p.maxSpeed = terminalSpeed(p as unknown as VehiclePhysics);
    }))).ok).toBe(true);
  });
  it.each([
    ['origin', (s: Json) => (s.origin = 'front-bumper'), 'sensors.origin'],
    ['angles not numbers', (s: Json) => (s.anglesDegrees = ['a']), 'anglesDegrees'],
    ['too few angles', (s: Json) => s.anglesDegrees.pop(), 'must equal the number of network inputs'],
    ['too many angles', (s: Json) => s.anglesDegrees.push(100), 'must equal the number of network inputs'],
    ['maxDistance zero', (s: Json) => (s.maxDistance = 0), 'maxDistance'],
    ['maxDistance missing', (s: Json) => delete s.maxDistance, 'maxDistance'],
  ])('rejects sensors: %s', (_name, edit, fragment) => {
    expect(errorsOf(broken((d) => edit(d.training.configuration.sensors))).join(' ')).toContain(fragment);
  });
  it.each(['checkpointWeight', 'partialProgressWeight', 'lapWeight', 'collisionPenalty', 'lapTimeBonusScale', 'referenceLapSeconds', 'maxLapTimeRatio', 'version'])('requires fitness.%s', (key) => {
    expect(errorsOf(broken((d) => delete d.training.configuration.fitness[key])).join(' ')).toContain(`fitness.${key}`);
  });
  it('rejects a partial progress weight above the checkpoint weight', () => {
    expect(errorsOf(broken((d) => (d.training.configuration.fitness.partialProgressWeight = 1e9))).join(' ')).toContain('partialProgressWeight');
  });
});

describe('validateModel: tracks', () => {
  it.each([
    ['trackIds empty', (d: Json) => (d.training.trackIds = []), 'trackIds'],
    ['trackIds not strings', (d: Json) => (d.training.trackIds = [1]), 'trackIds'],
    ['an unknown track', (d: Json) => (d.training.trackIds = ['nowhere']), 'not a registered training track'],
    ['a validation track', (d: Json) => (d.training.trackIds = ['rounded-rectangle']), 'not a registered training track'],
    ['a held-out track', (d: Json) => (d.training.trackIds = ['hairpin-chicane']), 'not a registered training track'],
    ['trackVersions missing', (d: Json) => delete d.training.trackVersions, 'trackVersions'],
    ['trackHashes missing', (d: Json) => delete d.training.trackHashes, 'trackHashes'],
    ['a wrong version', (d: Json) => (d.training.trackVersions['stadium-oval'] = '2'), 'has version 2'],
    ['a wrong hash', (d: Json) => (d.training.trackHashes['stadium-oval'] = 'sha256:00'), 'content hash'],
    ['an extra track in the versions', (d: Json) => (d.training.trackVersions.extra = '1'), 'exactly the tracks'],
  ])('rejects %s', (_name, edit, fragment) => {
    expect(errorsOf(broken(edit)).join(' ')).toContain(fragment);
  });
});

describe('validateModel: reporting', () => {
  it('returns every error, in a fixed order, and does not throw or change its input', () => {
    const doc = broken((d) => {
      d.id = '';
      d.fitness = null;
      d.parameters.count = 3;
      d.training.generation = -2;
    }) as Json;
    const before = JSON.stringify(doc);
    const errors = errorsOf(doc);
    expect(errors.length).toBeGreaterThanOrEqual(4);
    expect(errors).toEqual(errorsOf(doc));
    expect(JSON.stringify(doc)).toBe(before);
    const ids = errors.map((e) => ['"id"', '"fitness"', 'parameters.count', 'training.generation'].findIndex((k) => e.includes(k)));
    expect(ids.filter((i) => i >= 0)).toEqual([0, 1, 2, 3]);
  });
  it('never throws on hostile values', () => {
    const hostile = [{ format: 'self-driving-ai-evolution/model', schemaVersion: 1, architecture: null, parameters: 5, training: [] }, Object.create(null), { toString: 7 }, new Proxy({}, {})];
    for (const value of hostile) expect(() => validateModelWith(value)).not.toThrow();
  });
});

describe('validateModel never throws, whatever hostile value sits wherever in the document', () => {
  // JSON can hold values whose conversion to text or number would throw ({"toString":null}); every position of a valid
  // document is replaced in turn, and the answer must be an ordinary list of errors, never an exception or a swallowed one.
  const hostile: unknown[] = [null, { toString: null }, { valueOf: null, toString: null }, {}, [], [[]], [{}], 'x', '', 1e308, -1, 0, true, { length: 5 }, { length: 1e9 }];
  const paths = (value: unknown, prefix: (string | number)[] = []): (string | number)[][] => {
    if (value === null || typeof value !== 'object') return [prefix];
    const entries = Array.isArray(value) ? value.slice(0, 3).map((v, i) => [i, v] as const) : Object.entries(value);
    return [prefix, ...entries.flatMap(([key, child]) => paths(child, [...prefix, key]))];
  };
  const base = roundTrip();
  const all = paths(base).filter((path) => path.length > 0);
  it('covers a wide set of positions', () => {
    expect(all.length).toBeGreaterThan(100);
  });
  it('gives errors, not exceptions, for every hostile value at every position', () => {
    for (const path of all) {
      for (const value of hostile) {
        const doc = JSON.parse(JSON.stringify(base)) as Json;
        let node = doc;
        for (const key of path.slice(0, -1)) node = node[key];
        node[path[path.length - 1]!] = JSON.parse(JSON.stringify(value));
        let result;
        expect(() => (result = validateModelWith(doc)), `${path.join('.')} = ${JSON.stringify(value)}`).not.toThrow();
        if (result && !(result as { ok: boolean }).ok) {
          expect((result as { errors: string[] }).errors.join(' '), `${path.join('.')} = ${JSON.stringify(value)}`).not.toContain('could not be checked');
        }
      }
    }
  });
  it('reports a track version that is not a string, the reported case', () => {
    const errors = errorsOf(broken((d) => (d.training.trackVersions['stadium-oval'] = { toString: null })));
    expect(errors.join(' ')).toContain('trackVersions.stadium-oval" must be a string');
    expect(errors.join(' ')).not.toContain('could not be checked');
    expect(errorsOf(broken((d) => (d.training.trackHashes['stadium-oval'] = { toString: null }))).join(' ')).toContain('trackHashes.stadium-oval" must be a string');
  });
});

describe('compatibility', () => {
  it('is drivable without warnings for a model made by this build', () => {
    const result = validateModelWith(roundTrip());
    if (!result.ok) throw new Error('invalid');
    expect(compatibility(result.model)).toEqual({ drivable: true, reasons: [], warnings: [] });
  });
  it('warns, but still drives, when the physics or timestep differ', () => {
    const doc = broken((d) => {
      d.training.configuration.physics.engineAcceleration = 9;
      d.training.configuration.physics.maxSpeed = terminalSpeed(d.training.configuration.physics as VehiclePhysics);
      d.training.configuration.timestepSeconds = 1 / 30;
    });
    const result = validateModelWith(doc);
    if (!result.ok) throw new Error(result.errors.join('; '));
    const c = compatibility(result.model);
    expect(c.drivable).toBe(true);
    expect(c.warnings).toHaveLength(2);
  });
  it('cannot drive another simulation version or sensor layout', () => {
    for (const edit of [(d: Json) => (d.simulationVersion = 2), (d: Json) => (d.training.configuration.sensors.maxDistance = 40)]) {
      const result = validateModelWith(broken(edit));
      if (!result.ok) throw new Error(result.errors.join('; '));
      const c = compatibility(result.model);
      expect(c.drivable).toBe(false);
      expect(c.reasons.length).toBeGreaterThan(0);
    }
  });
});

describe('size', () => {
  it('keeps a real model far below the cap', () => {
    const size = JSON.stringify(model()).length;
    expect(size).toBeGreaterThan(2000);
    expect(size).toBeLessThan(MAX_MODEL_BYTES / 50);
  });
});
