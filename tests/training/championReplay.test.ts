// Champion replay (P3-04): the replay of a recorded champion equals its original evaluation, tick by tick, and what it
// shows as the network's inputs, rays and controls are the values that drove each tick (the decision state), while the
// results are the state after the tick. Seeded runs of the real trainer, physics, sensors and network. These check the
// mechanics; nothing here is evidence of learning (docs/AI_EVALUATION.md).
import { describe, expect, it } from 'vitest';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { buildInputs } from '../../src/ai/inputs';
import { runNetwork } from '../../src/ai/network';
import { castRays } from '../../src/sensors/rays';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { loadTrack } from '../../src/sim/track';
import { createChampionReplay, type ReplayFrame } from '../../src/training/championReplay';
import type { EpisodeState } from '../../src/training/episodeStep';
import {
  carFitness,
  createTrainer,
  DEFAULT_TRAINING_CONFIG,
  evaluateGenome,
  type GenerationStats,
  type TrainingConfig,
} from '../../src/training/trainer';

const track = loadTrack(stadiumOval);
const ENV = { track, physics: DEFAULT_VEHICLE_PHYSICS, timestepSeconds: DEFAULT_SIM_CONFIG.timestepSeconds };
const config = (seed: number): TrainingConfig => ({ ...DEFAULT_TRAINING_CONFIG, seed, populationSize: 8, eliteCount: 2, maxEpisodeSeconds: 15 });

/**
 * Runs `generations` generations tick by tick and, for each, returns its statistics and the population state of every car
 * after every tick (index 0 is the start state, index n is the state after n ticks).
 */
function runPopulation(seed: number, generations: number) {
  const trainer = createTrainer(config(seed), ENV);
  const runs: { stats: GenerationStats; states: EpisodeState[][] }[] = [];
  for (let g = 0; g < generations; g += 1) {
    const states: EpisodeState[][] = [trainer.generation().cars.map((car) => ({ racer: car.racer, episode: car.episode }))];
    for (;;) {
      const stats = trainer.step();
      const snapshot = stats ? trainer.finished()! : trainer.generation();
      states.push(snapshot.cars.map((car) => ({ racer: car.racer, episode: car.episode })));
      if (stats) {
        runs.push({ stats, states });
        break;
      }
    }
  }
  return { trainer, runs };
}

function replayAll(genome: Float64Array, trainer: ReturnType<typeof createTrainer>) {
  const replay = createChampionReplay(genome, trainer.setup);
  const frames: ReplayFrame[] = [];
  for (let frame = replay.step(); frame; frame = replay.step()) frames.push(frame);
  return { replay, frames };
}

const SEEDS = [1, 7, 23];

describe('a replay equals the original evaluation', () => {
  it.each(SEEDS)('ends exactly as the champion did in the population and as evaluateGenome (seed %i)', (seed) => {
    const { trainer, runs } = runPopulation(seed, 3);
    for (const { stats, states } of runs) {
      const { replay, frames } = replayAll(stats.champion, trainer);
      const original = states[states.length - 1]![stats.championIndex]!;
      expect(replay.state()).toEqual(original);
      expect(replay.state().episode.outcome).not.toBeNull();
      // The same events and lap times: outcome, gates and completed-lap durations.
      expect(replay.state().episode.outcome).toBe(original.episode.outcome);
      expect(replay.state().racer.progress.gatesPassed).toBe(original.racer.progress.gatesPassed);
      expect(replay.state().racer.progress.lapTicks).toEqual(original.racer.progress.lapTicks);
      expect(frames.length).toBe(replay.ticks());
      // Alone, from the same genome, it is the same episode as evaluateGenome and scores the recorded best fitness.
      const alone = evaluateGenome(stats.champion, trainer.setup);
      expect({ racer: alone.racer, episode: alone.episode }).toEqual(replay.state());
      expect(carFitness(alone, trainer.setup)).toBe(stats.bestFitness);
    }
  });

  it.each(SEEDS)('matches the population car at every tick, before and after (seed %i)', (seed) => {
    const { trainer, runs } = runPopulation(seed, 3);
    for (const { stats, states } of runs) {
      const { frames } = replayAll(stats.champion, trainer);
      expect(frames.length).toBeGreaterThan(0);
      for (const frame of frames) {
        expect(frame.before).toEqual(states[frame.tick - 1]![stats.championIndex]);
        expect(frame.after).toEqual(states[frame.tick]![stats.championIndex]);
      }
      // Cars that ended earlier stay put in the population, so the champion's last tick is where its replay ends.
      const lastTick = frames[frames.length - 1]!.tick;
      expect(states[lastTick]![stats.championIndex]!.episode.outcome).not.toBeNull();
    }
  });
});

describe('what the replay shows is what drove each tick', () => {
  const { trainer, runs } = runPopulation(7, 2);
  const stats = runs[1]!.stats;
  const { frames } = replayAll(stats.champion, trainer);
  const { track: t, physics } = trainer.setup.environment;
  const brake = { brakeEnabled: trainer.setup.config.brakeEnabled };

  it('has inputs, controls and rays that equal a fresh inference on the decision state', () => {
    expect(frames.length).toBeGreaterThan(20);
    for (const frame of frames) {
      const { vehicle } = frame.before.racer.car;
      const inputs = buildInputs(frame.before.racer, t, physics, trainer.setup.sensors);
      expect(frame.decision.inputs).toEqual(inputs);
      expect(frame.decision.controls).toEqual(runNetwork(stats.champion, inputs, brake));
      expect(frame.decision.readings).toEqual(castRays(vehicle, t, physics, trainer.setup.sensors));
      expect(frame.decision.readings.rays.map((ray) => ray.normalised)).toEqual(inputs.slice(0, 7));
    }
  });

  it('keeps the decision state apart from the result state: the same pose only while the car is at rest', () => {
    // Comparing against the result state would disagree as soon as the car moves; this pins the intended pairing.
    const moved = frames.filter((frame) => frame.after.racer.car.vehicle.speed !== frame.before.racer.car.vehicle.speed);
    expect(moved.length).toBeGreaterThan(0);
    const frame = moved[0]!;
    const fromAfter = buildInputs(frame.after.racer, t, physics, trainer.setup.sensors);
    expect(frame.decision.inputs).not.toEqual(fromAfter);
  });

  it('chains frames: each decision state is the previous result state, and the first starts from rest', () => {
    expect(frames[0]!.tick).toBe(1);
    expect(frames[0]!.before).toEqual(createChampionReplay(stats.champion, trainer.setup).start);
    expect(frames[0]!.before.racer.car.vehicle.speed).toBe(0);
    for (let i = 1; i < frames.length; i += 1) {
      expect(frames[i]!.tick).toBe(frames[i - 1]!.tick + 1);
      expect(frames[i]!.before).toBe(frames[i - 1]!.after);
    }
  });

  it('applies the controls it shows: the result is the physics step of those controls from the decision state', () => {
    // A replay that displayed one set of controls and drove with another would change the trajectory; compare to the population.
    const frame = frames[Math.floor(frames.length / 2)]!;
    const again = createChampionReplay(stats.champion, trainer.setup);
    for (let i = 0; i < frame.tick - 1; i += 1) again.step();
    expect(again.step()).toEqual(frame);
  });
});

describe('the end of a replay', () => {
  const { trainer, runs } = runPopulation(1, 1);
  const { stats } = runs[0]!;

  it('returns null after the episode ends, with no invented decision, and does not move', () => {
    const replay = createChampionReplay(stats.champion, trainer.setup);
    while (replay.step()) {
      // run to the end
    }
    const final = replay.state();
    const ticks = replay.ticks();
    expect(replay.done()).toBe(true);
    expect(replay.step()).toBeNull();
    expect(replay.step()).toBeNull();
    expect(replay.state()).toBe(final);
    expect(replay.ticks()).toBe(ticks);
  });

  it('starts at rest with no outcome, so a replay always has a first decision', () => {
    const replay = createChampionReplay(stats.champion, trainer.setup);
    expect(replay.done()).toBe(false);
    expect(replay.ticks()).toBe(0);
    expect(replay.state()).toBe(replay.start);
    expect(replay.step()).not.toBeNull();
  });

  it('is independent of the caller: changing the genome afterwards changes nothing', () => {
    const genome = Float64Array.from(stats.champion);
    const a = createChampionReplay(genome, trainer.setup);
    genome.fill(0);
    const b = createChampionReplay(stats.champion, trainer.setup);
    for (let i = 0; i < 50; i += 1) expect(a.step()).toEqual(b.step());
  });

  it('is different for a different genome, so the tests above would notice a wrong one', () => {
    const other = runPopulation(2, 1).runs[0]!.stats.champion;
    expect(other).not.toEqual(stats.champion);
    const a = createChampionReplay(stats.champion, trainer.setup);
    const b = createChampionReplay(other, trainer.setup);
    let differs = false;
    for (let i = 0; i < 200 && !differs; i += 1) {
      const fa = a.step();
      const fb = b.step();
      differs = !fa || !fb || JSON.stringify(fa.decision.controls) !== JSON.stringify(fb.decision.controls);
    }
    expect(differs).toBe(true);
  });
});
