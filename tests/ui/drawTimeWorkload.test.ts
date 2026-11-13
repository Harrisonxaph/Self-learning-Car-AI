// The draw-time readout (P4-07) names the workload being measured, from the same branches draw() uses: training with its cars-drawn cap, a champion
// replay (one car and its rays) and a comparison replay (two cars). The plan's reference-phone measurement covers the champion replay, so quoting the
// training cap beside a replay's timings would record the wrong workload. Seeded and tiny; nothing here is a measurement.
import { describe, expect, it } from 'vitest';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { buildModel, type ModelDocument } from '../../src/persistence/modelFormat';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { loadTrack } from '../../src/sim/track';
import { createTrainer, DEFAULT_TRAINING_CONFIG } from '../../src/training/trainer';
import { startTrainingPage } from '../../src/ui/trainingPage';
import { FakeFrames } from './fakeFrames';
import { FakeLocalStorage, fakePage } from './fakeTrainingPage';

const DT = DEFAULT_SIM_CONFIG.timestepSeconds;
const FRAME_MS = DT * 1000;
const ENV = { track: loadTrack(stadiumOval), physics: DEFAULT_VEHICLE_PHYSICS, timestepSeconds: DT };

const make = (seed: number, id: string): ModelDocument => {
  const trainer = createTrainer({ ...DEFAULT_TRAINING_CONFIG, seed, populationSize: 6, eliteCount: 1, maxEpisodeSeconds: 10 }, ENV);
  const stats = trainer.runGeneration();
  return buildModel({ champion: stats.champion, fitness: stats.bestFitness, generation: stats.generation, record: trainer.record(), id, createdAt: '2026-11-10T09:00:00.000Z', codeVersion: 'test', name: `Champion ${id}` });
};

function setup() {
  const storage = new FakeLocalStorage();
  const models = [make(3, 'a-1'), make(4, 'b-1')];
  for (const m of models) storage.setItem(`sdae:model:${m.id}`, JSON.stringify(m));
  storage.setItem('sdae:models:index', JSON.stringify(models.map((m) => m.id)));
  let t = 0;
  const frames = new FakeFrames();
  // Each read of the clock costs half a millisecond, so the readout (refreshed about every 250 ms of clock) refreshes every few frames.
  const made = fakePage(frames, { now: () => (t += 0.5), storage: () => storage, compare: true, drawTime: true });
  startTrainingPage(made.page);
  let frame = 0;
  const run = (count = 1) => {
    for (let i = 0; i < count; i += 1) frames.fire(frame++ * FRAME_MS);
  };
  /** Runs frames until the readout text satisfies `done`, or fails. */
  const until = (done: (text: string) => boolean): string => {
    for (let i = 0; i < 2000; i += 1) {
      run();
      const text = made.drawTime?.textContent ?? '';
      if (done(text)) return text;
    }
    throw new Error(`The readout never matched: ${made.drawTime?.textContent}`);
  };
  return { ...made, run, until, frames };
}

describe('the readout names what is being drawn', () => {
  it('training: the cars-drawn cap, as before', () => {
    const p = setup();
    const text = p.until((t) => t.includes('Camera draw time') && t.includes('cars drawn'));
    expect(text).toMatch(/normal · \d+ cars drawn · population \d+/);
    expect(text).not.toContain('replay');
  });

  it('a champion replay: one car with its sensor rays, not the training cap', () => {
    const p = setup();
    p.controls.speeds.max.click();
    for (let i = 0; i < 100_000 && Number(p.canvas.dataset.completedGenerations ?? 0) < 1; i += 1) p.run();
    expect(Number(p.canvas.dataset.completedGenerations)).toBeGreaterThanOrEqual(1);
    p.controls.speeds.normal.click();
    p.run(2);
    p.replay.generation.value = '1';
    p.replay.start.click();
    const text = p.until((t) => t.includes('champion replay'));
    expect(text).toContain('champion replay · 1 car drawn with its sensor rays');
    expect(text).not.toMatch(/\d+ cars drawn/);
  });

  it('a comparison replay: two cars, identified as a replay', () => {
    const p = setup();
    p.compare!.run.click();
    p.run(3);
    p.compare!.replay.click();
    const text = p.until((t) => t.includes('comparison replay'));
    expect(text).toContain('comparison replay · 2 cars drawn');
    expect(text).not.toMatch(/(normal|paused|fast|max) · \d+ cars drawn/);
    expect(p.canvas.dataset.pairReplay).toBe('running');
  });
});
