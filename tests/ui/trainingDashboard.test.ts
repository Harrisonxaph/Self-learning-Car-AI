// P3-01: formatting, the placeholder before the first generation, no needless DOM writes, and the session that runs
// the page's per-frame dashboard path. Plain Node: the outputs are counting text targets, not DOM elements.
import { describe, expect, it } from 'vitest';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { createFixedStepClock } from '../../src/sim/fixedStep';
import { loadTrack } from '../../src/sim/track';
import type { CompletedMetrics, LiveCounts } from '../../src/training/generationMetrics';
import { createTrainer, DEFAULT_TRAINING_CONFIG, type TrainingConfig } from '../../src/training/trainer';
import { startFrameLoop } from '../../src/ui/frameLoop';
import {
  createTrainingSession,
  dashboardText,
  formatFitness,
  formatShare,
  NO_GENERATION_NOTE,
  NO_VALUE,
  renderDashboard,
} from '../../src/ui/trainingDashboard';
import { fakeDashboard } from './dashboardFakes';
import { FakeFrames } from './fakeFrames';

const ENV = { track: loadTrack(stadiumOval), physics: DEFAULT_VEHICLE_PHYSICS, timestepSeconds: DEFAULT_SIM_CONFIG.timestepSeconds };
const SMALL: TrainingConfig = { ...DEFAULT_TRAINING_CONFIG, seed: 7, populationSize: 8, eliteCount: 2, maxEpisodeSeconds: 15 };

const LIVE: LiveCounts = { generation: 3, population: 50, running: 20, crashed: 11, stalled: 4, finished: 15 };
const DONE: CompletedMetrics = {
  generation: 2,
  population: 50,
  bestFitness: 12.3456,
  meanFitness: 3.5,
  crashed: 31,
  crashRate: 31 / 50,
  stalled: 2,
  stallRate: 2 / 50,
  carsWithLap: 5,
  lapCompletionRate: 5 / 50,
};

describe('formatting', () => {
  it('shows fitness to 2 decimals and a rate with its count', () => {
    expect(formatFitness(12.3456)).toBe('12.35');
    expect(formatFitness(-0.004)).toBe('-0.00');
    expect(formatShare(31, 31 / 50, 50)).toBe('62.0% (31/50)');
    expect(formatShare(0, 0, 50)).toBe('0.0% (0/50)');
    expect(formatShare(1, 1 / 3, 3)).toBe('33.3% (1/3)');
  });

  it('shows a placeholder and a note for every last-completed value before the first generation ends', () => {
    const text = dashboardText(LIVE, null);
    expect([text.lastGeneration, text.bestFitness, text.meanFitness, text.crashRate, text.stalls, text.lapRate]).toEqual(Array(6).fill(NO_VALUE));
    expect(text.note).toBe(NO_GENERATION_NOTE);
    expect([text.generation, text.running, text.crashed, text.stalled, text.finished]).toEqual(['3', '20', '11', '4', '15']);
  });

  it('shows the last completed generation, separately from the live counts, with stalls apart from crashes', () => {
    const text = dashboardText(LIVE, DONE);
    expect(text).toMatchObject({
      lastGeneration: '2',
      bestFitness: '12.35',
      meanFitness: '3.50',
      crashRate: '62.0% (31/50)',
      stalls: '4.0% (2/50)',
      lapRate: '10.0% (5/50)',
      note: '',
    });
    // The live crashed count (11) is not the last generation's crashed figure (31).
    expect(text.crashed).toBe('11');
  });

  it('uses no learning or skill wording', () => {
    const everything = JSON.stringify(dashboardText(LIVE, DONE)) + NO_GENERATION_NOTE;
    expect(everything).not.toMatch(/learn|skill|improv|smart|better/i);
  });
});

describe('renderDashboard', () => {
  it('writes every output once, and writes nothing when the values have not changed', () => {
    const dashboard = fakeDashboard();
    renderDashboard(dashboard.outputs, LIVE, DONE);
    expect(Object.values(dashboard.writes)).toEqual(Array(12).fill(1));
    renderDashboard(dashboard.outputs, { ...LIVE }, { ...DONE });
    expect(Object.values(dashboard.writes)).toEqual(Array(12).fill(1));
  });

  it('rewrites only the outputs whose text changed', () => {
    const dashboard = fakeDashboard();
    renderDashboard(dashboard.outputs, LIVE, DONE);
    renderDashboard(dashboard.outputs, { ...LIVE, running: 19, finished: 16 }, DONE);
    expect(dashboard.writes.running).toBe(2);
    expect(dashboard.writes.finished).toBe(2);
    expect(dashboard.writes.crashed).toBe(1);
    expect(dashboard.writes.bestFitness).toBe(1);
  });
});

describe('the training session (the per-frame dashboard path)', () => {
  /** The dashboard sees only the trainer's step and current generation: any other access would throw. */
  const restricted = (trainer: ReturnType<typeof createTrainer>) =>
    new Proxy(trainer, {
      get(target, property) {
        if (property !== 'step' && property !== 'generation') throw new Error(`The dashboard path read trainer.${String(property)}`);
        return target[property];
      },
    });

  it('keeps the stats returned when a generation ends and reports them until the next one ends', () => {
    const trainer = createTrainer(SMALL, ENV);
    const dashboard = fakeDashboard();
    const session = createTrainingSession(restricted(trainer), dashboard.outputs);
    expect(session.frame().completed).toBeNull();
    expect(dashboard.text().note).toBe(NO_GENERATION_NOTE);
    let ended = 0;
    for (let tick = 0; ended < 2 && tick < 100_000; tick += 1) {
      const before = trainer.record().generations.length;
      session.step();
      if (trainer.record().generations.length > before) {
        ended += 1;
        const last = session.frame();
        expect(last.completed?.generation).toBe(ended);
        expect(last.completed?.bestFitness).toBe(trainer.record().generations[ended - 1]!.bestFitness);
        expect(dashboard.text().lastGeneration).toBe(String(ended));
        // A new generation has started: all cars are running again while the last figures stay.
        expect(last.live.running).toBe(SMALL.populationSize);
        expect(last.live.generation).toBe(ended + 1);
      }
    }
    expect(ended).toBe(2);
  });

  it('writes the dashboard at most once per rendered frame, however many ticks the frame ran, and reads no history', () => {
    const trainer = createTrainer(SMALL, ENV);
    const dashboard = fakeDashboard();
    const session = createTrainingSession(restricted(trainer), dashboard.outputs);
    const env = new FakeFrames();
    let ticks = 0;
    let frames = 0;
    const loop = startFrameLoop(env, createFixedStepClock(DEFAULT_SIM_CONFIG), {
      step: () => {
        ticks += 1;
        session.step();
      },
      render: () => {
        frames += 1;
        session.frame();
      },
    });
    // 4 ticks per frame at 60 ticks per second.
    const frameMs = (4 * 1000) / 60;
    for (let frame = 0; frame < 120; frame += 1) env.fire(frame * frameMs);
    loop.stop();
    expect(ticks).toBeGreaterThan(3 * frames);
    for (const [name, count] of Object.entries(dashboard.writes)) expect(count, name).toBeLessThanOrEqual(frames);
    // The running count changes on most frames but is never written once per tick.
    expect(dashboard.writes.running).toBeLessThanOrEqual(frames);
  });

  it('writes nothing on a frame where no tick ran and nothing changed', () => {
    const trainer = createTrainer(SMALL, ENV);
    const dashboard = fakeDashboard();
    const session = createTrainingSession(restricted(trainer), dashboard.outputs);
    session.frame();
    const before = JSON.stringify(dashboard.writes);
    session.frame();
    session.frame();
    expect(JSON.stringify(dashboard.writes)).toBe(before);
  });
});
