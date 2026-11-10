// Comparing two saved champions on the page's real wiring (P3-08): fake saves in a fake localStorage, fake nodes, fake frames.
// The claims: only valid saves are offered; Compare renders the table and warnings and writes nothing; a fitness-version-only
// mismatch is "not ranked" but still replays together, a timestep mismatch is refused with reasons; a present evaluation is
// shown as unsupported; the combined replay runs on the training wait and ends with each car's outcome; deleting a compared
// save clears the comparison.
import { describe, expect, it } from 'vitest';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { buildModel, type ModelDocument } from '../../src/persistence/modelFormat';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { loadTrack } from '../../src/sim/track';
import { createTrainer, DEFAULT_TRAINING_CONFIG } from '../../src/training/trainer';
import { startTrainingPage } from '../../src/ui/trainingPage';
import { FakeFrames } from './fakeFrames';
import { FakeLocalStorage, fakePage, type FakeNode } from './fakeTrainingPage';

const DT = DEFAULT_SIM_CONFIG.timestepSeconds;
const FRAME_MS = DT * 1000;
const ENV = { track: loadTrack(stadiumOval), physics: DEFAULT_VEHICLE_PHYSICS, timestepSeconds: DT };

const make = (seed: number, id: string, generations = 1): ModelDocument => {
  const trainer = createTrainer({ ...DEFAULT_TRAINING_CONFIG, seed, populationSize: 6, eliteCount: 1, maxEpisodeSeconds: 10 }, ENV);
  let stats = trainer.runGeneration();
  for (let g = 1; g < generations; g += 1) stats = trainer.runGeneration();
  return buildModel({ champion: stats.champion, fitness: stats.bestFitness, generation: stats.generation, record: trainer.record(), id, createdAt: '2026-11-10T09:00:00.000Z', codeVersion: 'test', name: `Champion ${id}` });
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;
const edit = (m: ModelDocument, fn: (o: Loose) => void): ModelDocument => {
  const o = JSON.parse(JSON.stringify(m)) as Loose;
  fn(o);
  return o as ModelDocument;
};
const put = (storage: FakeLocalStorage, models: readonly ModelDocument[]) => {
  for (const m of models) storage.setItem(`sdae:model:${m.id}`, JSON.stringify(m));
  storage.setItem('sdae:models:index', JSON.stringify(models.map((m) => m.id)));
};

function setup(models: readonly ModelDocument[], extra: Record<string, string> = {}) {
  const storage = new FakeLocalStorage();
  put(storage, models);
  for (const [k, v] of Object.entries(extra)) storage.setItem(k, v);
  const frames = new FakeFrames();
  const made = fakePage(frames, { now: () => 0, storage: () => storage, compare: true });
  startTrainingPage(made.page);
  let lastMs = -FRAME_MS;
  const run = (count = 1) => {
    for (let i = 0; i < count; i += 1) frames.fire((lastMs += FRAME_MS));
  };
  const compare = made.compare!;
  const ids = (select: { options: FakeNode[] }) => select.options.map((o) => o.attributes.value);
  const text = () => {
    const out: string[] = [];
    const walk = (n: FakeNode) => {
      if (n.textContent) out.push(n.textContent);
      n.children.forEach(walk);
    };
    compare.result.children.forEach(walk);
    return out.join('\n');
  };
  const choose = (a: string, b: string) => {
    compare.a.choose(a);
    compare.b.choose(b);
  };
  return { ...made, frames, run, compare, ids, text, choose, storage };
}

const A = make(3, 'a-1');
const B = make(3, 'b-1', 3);

describe('choosing two saves', () => {
  it('offers only valid saves, and keeps Compare off until two different ones are chosen', () => {
    const p = setup([A, B], { 'sdae:model:broken': '{nope', 'sdae:models:index': JSON.stringify(['a-1', 'b-1', 'broken']) });
    expect(p.ids(p.compare.a)).toEqual(['a-1', 'b-1']);
    expect(p.ids(p.compare.b)).toEqual(['a-1', 'b-1']);
    expect(p.compare.run.disabled).toBe(false);
    p.choose('a-1', 'a-1');
    expect(p.compare.run.disabled).toBe(true);
    p.compare.run.click();
    expect(p.compare.status.textContent).toBe('Choose two different saved champions.');
    expect(p.compare.result.children).toHaveLength(0);
  });
  it('with fewer than two valid saves there is nothing to compare', () => {
    const p = setup([A]);
    expect(p.compare.run.disabled).toBe(true);
    expect(p.compare.replay.disabled).toBe(true);
  });
});

describe('Compare', () => {
  it('two saves of one run: a table, a ranking marker, an available combined replay, and nothing written', () => {
    const p = setup([A, B]);
    const before = new Map(p.storage.data);
    p.compare.run.click();
    expect(p.compare.status.textContent).toContain('Compared A (Champion a-1) with B (Champion b-1)');
    expect(p.canvas.dataset.compare).toBe('comparable');
    expect(p.canvas.dataset.compareReplay).toBe('available');
    expect(p.compare.replay.disabled).toBe(false);
    const table = p.compare.result.children.find((n) => n.tag === 'table')!;
    expect(table.find((n) => n.tag === 'th' && n.attributes.scope === 'row').length).toBeGreaterThan(10);
    expect(p.text()).toContain('Scored the same way');
    expect(p.text()).toContain('not an evaluation of general driving');
    expect(p.storage.data).toEqual(before);
  });

  it('a fitness-version-only mismatch: warning and not ranked, but the combined replay stays available', () => {
    const other = edit(B, (o) => { o.id = 'b-2'; o.training.configuration.fitness.version = 2; o.training.fitnessVersion = 2; });
    const p = setup([A, other]);
    p.choose('a-1', 'b-2');
    p.compare.run.click();
    expect(p.canvas.dataset.compare).toBe('not-ranked');
    expect(p.canvas.dataset.compareReplay).toBe('available');
    expect(p.compare.replay.disabled).toBe(false);
    expect(p.text()).toContain('shown but not ranked');
    expect(p.text()).toContain('The fitness version differs');
    expect(p.text()).not.toContain('Higher fitness');
    expect(p.text()).not.toContain('cannot be replayed together');
  });

  it('a timestep mismatch: not ranked, and the combined replay is refused with reasons', () => {
    const other = edit(B, (o) => { o.id = 'b-3'; o.training.configuration.timestepSeconds = 0.02; });
    const p = setup([A, other]);
    p.choose('a-1', 'b-3');
    p.compare.run.click();
    expect(p.canvas.dataset.compare).toBe('not-ranked');
    expect(p.canvas.dataset.compareReplay).toBe('refused');
    expect(p.compare.replay.disabled).toBe(true);
    expect(p.text()).toContain('Why they cannot be replayed together:');
    expect(p.text()).toContain('timesteps differ');
    p.compare.replay.click();
    expect(p.canvas.dataset.pairReplay).not.toBe('running');
  });

  it('a non-empty evaluation is shown as recorded but unsupported and unverified, and never changes ranking', () => {
    const other = edit(B, (o) => { o.id = 'b-4'; o.evaluation = [{ made: 'up' }, 5]; });
    const p = setup([A, other]);
    p.choose('a-1', 'b-4');
    p.compare.run.click();
    expect(p.text()).toContain('Recorded evaluation data present: 2 entries, unsupported and unverified in Phase 3');
    expect(p.text()).not.toContain('made');
    expect(p.canvas.dataset.compare).toBe('comparable');
  });

  it('a model this build cannot drive can be compared but not replayed', () => {
    const other = edit(B, (o) => { o.id = 'b-5'; o.simulationVersion = 999; });
    const p = setup([A, other]);
    p.choose('a-1', 'b-5');
    p.compare.run.click();
    expect(p.compare.status.textContent).toContain('Compared');
    expect(p.compare.replay.disabled).toBe(true);
    expect(p.text()).toContain('cannot be driven');
  });
});

describe('the combined replay', () => {
  it('runs on the training wait, labels the cars, ends with each car\'s outcome, and Back to training restores the run', () => {
    const p = setup([A, B]);
    p.compare.run.click();
    p.run(3);
    const trainingTicks = p.canvas.dataset.tick;
    p.compare.replay.click();
    p.run(2);
    expect(p.canvas.dataset.pairReplay).toBe('running');
    expect(p.replay.stop.disabled).toBe(false);
    expect(p.controls.speeds.max.disabled).toBe(true);
    for (let i = 0; i < 20_000 && p.canvas.dataset.pairReplay === 'running'; i += 1) p.run();
    expect(p.canvas.dataset.pairReplay).toBe('done');
    // Training did not advance while the pair ran.
    expect(p.canvas.dataset.tick).toBe(trainingTicks);
    expect(p.compare.status.textContent).toMatch(/^Replay finished\. A \(Champion a-1\): .+\. B \(Champion b-1\): .+\.$/);
    expect(['completed', 'crashed', 'stalled', 'timeout']).toContain(p.canvas.dataset.pairOutcomeA);
    expect(['completed', 'crashed', 'stalled', 'timeout']).toContain(p.canvas.dataset.pairOutcomeB);
    p.replay.stop.click();
    p.run(2);
    expect(p.canvas.dataset.pairReplay).toBe('off');
    expect(p.controls.speeds.max.disabled).toBe(false);
    expect(Number(p.canvas.dataset.tick)).toBeGreaterThan(Number(trainingTicks));
  });

  it('starting a single champion replay stops the pair first', () => {
    const p = setup([A, B]);
    p.compare.run.click();
    p.run(3);
    p.compare.replay.click();
    p.run(2);
    expect(p.canvas.dataset.pairReplay).toBe('running');
    p.replay.stop.click();
    p.run();
    expect(p.canvas.dataset.pairReplay).toBe('off');
  });
});

describe('deleting a compared save', () => {
  it('clears the comparison and the combined replay', () => {
    const p = setup([A, B]);
    p.compare.run.click();
    expect(p.compare.result.children.length).toBeGreaterThan(0);
    const row = p.saved.list.children.find((r) => r.attributes['data-id'] === 'b-1')!;
    const button = (text: string) => row.find((n) => n.tag === 'button' && n.textContent === text)[0]!;
    button('Delete').click();
    p.saved.list.children.find((r) => r.attributes['data-id'] === 'b-1')!.find((n) => n.tag === 'button' && n.textContent === 'Yes, delete')[0]!.click();
    expect(p.compare.result.children).toHaveLength(0);
    expect(p.compare.replay.disabled).toBe(true);
    expect(p.compare.run.disabled).toBe(true);
  });
});
