// P3-07 end to end below the page: a trainer's state goes through the checkpoint format as JSON text (parse and validate),
// back into a new trainer, and the resumed run matches an uninterrupted one. This is the plan's section 5 proof with the
// format in the loop: part 1 (the future is exact) and part 2 (the restored history is a stated projection).
import { describe, expect, it } from 'vitest';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { loadTrack } from '../../src/sim/track';
import { checkpointFile, parseCheckpointText } from '../../src/persistence/checkpointStore';
import { compactOf, createTrainer, DEFAULT_TRAINING_CONFIG, type HistoryEntry, type Trainer } from '../../src/training/trainer';
import { checkpointFromTrainer, checkpointValidateOptions, resolveConfigAdapter, resumeFromCheckpoint } from '../../src/ui/checkpointAdapter';

const ENV = { track: loadTrack(stadiumOval), physics: DEFAULT_VEHICLE_PHYSICS, timestepSeconds: DEFAULT_SIM_CONFIG.timestepSeconds };
const config = (seed: number, populationSize: number, brakeEnabled = true) => ({ ...DEFAULT_TRAINING_CONFIG, seed, populationSize, eliteCount: 1, maxEpisodeSeconds: 10, brakeEnabled });
const OPTIONS = checkpointValidateOptions();
const META = { id: 'cp-adapter', createdAt: '2026-11-09T22:00:00.000Z', codeVersion: 'test' };
const run = (trainer: Trainer, generations: number) => Array.from({ length: generations }, () => trainer.runGeneration());
const bits = (a: Float64Array, b: Float64Array) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

/** Runs the plan's proof through the real format. `viaFile` uses the downloaded (indented) text instead of the stored (compact) one. */
function proofThroughText(seed: number, population: number, split: number, more: number, keepLast: number | undefined, viaFile = false, brake = true) {
  const whole = createTrainer(config(seed, population, brake), ENV);
  const wholeStats = run(whole, split + more);
  const first = createTrainer(config(seed, population, brake), ENV);
  run(first, split);
  const doc = checkpointFromTrainer(first, META, keepLast);
  let body: string;
  if (viaFile) {
    const file = checkpointFile(doc);
    if (!file.ok) throw new Error(file.message);
    body = file.text;
  } else {
    body = JSON.stringify(doc);
  }
  const parsed = parseCheckpointText(body, OPTIONS);
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  const setup = first.setup;
  const resumed = resumeFromCheckpoint(parsed.checkpoint, setup);
  if (!resumed.ok) throw new Error(resumed.reasons.join('; '));
  const second = createTrainer(resumed.configuration, ENV, resumed.resume);
  const secondStats = run(second, more);

  // Part 1: the future is exactly the same.
  expect(secondStats).toEqual(wholeStats.slice(split));
  const a = whole.checkpointState();
  const b = second.checkpointState();
  expect(b.runState).toEqual(a.runState);
  b.genomes.forEach((genome, i) => expect(bits(genome, a.genomes[i]!)).toBe(true));

  // Part 2: the restored history is a stated projection of the uninterrupted one.
  const projected = second.record().history;
  const original = whole.record().history;
  const keep = keepLast ?? 20;
  const best = original.slice(0, split).reduce((bi, e, i, all) => (e.retained && (all[bi] as Extract<HistoryEntry, { retained: true }>).stats.bestFitness < e.stats.bestFitness ? i : bi), 0);
  projected.forEach((entry, i) => {
    const truth = original[i]!;
    if (!truth.retained) throw new Error('uninterrupted history is full');
    if (i >= split || i >= split - keep || i === best) expect(entry).toEqual(truth);
    else {
      expect(entry.retained).toBe(false);
      expect(entry).toEqual(compactOf(truth.stats));
    }
  });
  return { second, projected };
}

describe('resume through the checkpoint format matches an uninterrupted run', () => {
  for (const split of [0, 1, 3]) {
    it(`split after ${split} generations (stored text)`, () => {
      proofThroughText(1, 5, split, 3, 2);
    });
  }
  it('from the downloaded (indented) file text', () => {
    proofThroughText(3, 5, 4, 2, 2, true);
  });
  it('beyond the retention window with the default of 20 kept (25 generations, then 3 more)', () => {
    const { projected } = proofThroughText(5, 4, 25, 3, undefined);
    expect(projected.slice(0, 5).some((entry) => !entry.retained)).toBe(true);
    expect(projected.slice(5).every((entry) => entry.retained)).toBe(true);
  });
  it('both brake settings', () => {
    proofThroughText(8, 4, 3, 2, 1, false, false);
    proofThroughText(8, 4, 3, 2, 1, false, true);
  });
});

describe('whether this build can resume a checkpoint', () => {
  const trainer = createTrainer(config(1, 5), ENV);
  run(trainer, 2);
  const doc = checkpointFromTrainer(trainer, META);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Doc = Record<string, any>;
  const edit = (fn: (d: Doc) => void) => {
    const copy = JSON.parse(JSON.stringify(doc));
    fn(copy);
    return copy;
  };
  it('accepts its own checkpoint', () => {
    expect(resumeFromCheckpoint(doc, trainer.setup).ok).toBe(true);
  });
  const cases: [string, (d: Doc) => void][] = [
    ['a different simulation version', (d) => { d.simulationVersion += 1; }],
    ['a different timestep', (d) => { d.training.environment.timestepSeconds = 0.05; }],
    ['different vehicle physics', (d) => { d.training.environment.physics.maxSpeed += 1; }],
    ['a different sensor layout', (d) => { d.training.environment.sensors.maxDistance += 1; }],
    ['a different random-stream layout', (d) => { d.training.rngStreams = 'other'; }],
    ['different training settings (another seed)', (d) => { d.training.configuration.seed = 2; }],
  ];
  for (const [label, fn] of cases) {
    it(`refuses ${label}, with a reason`, () => {
      const result = resumeFromCheckpoint(edit(fn), trainer.setup);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reasons.length).toBeGreaterThan(0);
    });
  }
});

describe('the configuration adapter', () => {
  it('is the trainer\'s own validator: it accepts a valid configuration and refuses an invalid one with a message', () => {
    expect(resolveConfigAdapter(config(1, 5), 1 / 30).ok).toBe(true);
    const bad = resolveConfigAdapter({ ...config(1, 5), seed: -1 }, 1 / 30);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors[0]).toContain('seed');
  });
  it('never throws, whatever it is given', () => {
    for (const hostile of [null, undefined, 1, 'x', [], { toString: null }, { seed: {} }]) expect(() => resolveConfigAdapter(hostile, 1 / 30)).not.toThrow();
  });
});
