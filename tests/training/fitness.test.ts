// Episode scoring (P2-06): the fitness formula, its anti-exploitation guards and the termination rules, checked
// with hand-calculated values. Scripted rear-axle paths go through the real checkpoint rules (advanceProgress);
// physics scenarios go through stepRacer/stepWorld. These are synthetic scoring tests: they show the guards work,
// not that any driver learns.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { advanceProgress, createProgress, stepRacer, type LapProgress, type Racer } from '../../src/sim/checkpoints';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { loadTrack, type Track, type Vec2 } from '../../src/sim/track';
import { NO_CONTROLS } from '../../src/sim/vehicle';
import { createWorld, startRacer, stepWorld } from '../../src/sim/world';
import {
  DEFAULT_EPISODE_LIMITS,
  DEFAULT_FITNESS_CONFIG,
  FITNESS_VERSION,
  PARTIAL_PROGRESS_CAP,
  partialProgressAt,
  recordTick,
  resolveEpisodeRules,
  resolveFitnessConfig,
  scoreEpisode,
  startEpisode,
  type Episode,
  type EpisodeLimits,
  type EpisodeRules,
} from '../../src/training/fitness';
import { LAP_LENGTH, centre } from '../sim/ovalDriver';
import { LAPS } from '../sim/scenarios';

const PHYSICS = DEFAULT_VEHICLE_PHYSICS;
const DT = DEFAULT_SIM_CONFIG.timestepSeconds;
const oval = loadTrack(stadiumOval);
const v = (x: number, y: number): Vec2 => ({ x, y });
const RULES = resolveEpisodeRules(DEFAULT_EPISODE_LIMITS, DT); // 3600 ticks, stall 300 ticks, 3 laps
const rules = (limits: Partial<EpisodeLimits>) => resolveEpisodeRules({ ...DEFAULT_EPISODE_LIMITS, ...limits }, DT);
const START = oval.start.position; // (−6, 40), 6 m behind gate 0 at x = 0
const last = <T>(items: readonly T[]) => items[items.length - 1]!;

/** A racer whose rear axle is at `position` (pose details other than the position do not affect scoring). */
const racerAt = (position: Vec2, progress: LapProgress, crashed = false): Racer => ({
  car: { vehicle: { position, heading: 0, speed: 0 }, crashed },
  progress,
});

/**
 * Scores a scripted path of rear-axle positions, one per tick, starting at points[0]. Gate credit comes from the
 * real checkpoint rules. Stops at the first outcome. Returns the episode after every tick (index = tick).
 */
function scripted(points: readonly Vec2[], track: Track = oval, episodeRules: EpisodeRules = RULES): Episode[] {
  let progress = createProgress();
  let episode = startEpisode(racerAt(points[0]!, progress), track);
  const out = [episode];
  for (let i = 1; i < points.length && episode.outcome === null; i += 1) {
    progress = advanceProgress(progress, points[i - 1]!, points[i]!, track);
    episode = recordTick(episode, racerAt(points[i]!, progress), track, episodeRules);
    out.push(episode);
  }
  return out;
}
const fitness = (episode: Episode, episodeRules: EpisodeRules = RULES) => scoreEpisode(episode, DEFAULT_FITNESS_CONFIG, episodeRules).total;
/** Points along y = 40 from x = from to x = to (inclusive), `step` metres apart. */
const line = (from: number, to: number, step: number) => {
  const count = Math.round((to - from) / step);
  return Array.from({ length: count + 1 }, (_, k) => v(from + k * step, 40));
};

describe('configuration', () => {
  it('matches the MODEL_FORMAT example: fitness weights and episode limits', () => {
    const doc = readFileSync(join(__dirname, '../../docs/MODEL_FORMAT.md'), 'utf8');
    const start = doc.indexOf('```json') + 7;
    const example = JSON.parse(doc.slice(start, doc.indexOf('```', start))).training;
    const config = resolveFitnessConfig(example.configuration.fitness);
    expect(config).toEqual(DEFAULT_FITNESS_CONFIG);
    expect(Object.isFrozen(config)).toBe(true);
    expect(example.fitnessVersion).toBe(FITNESS_VERSION);
    expect(FITNESS_VERSION).toBe(1);
    const limits = example.configuration;
    expect({ maxEpisodeSeconds: limits.maxEpisodeSeconds, stallSeconds: limits.stallSeconds, maxLaps: limits.maxLaps }).toEqual(DEFAULT_EPISODE_LIMITS);
    expect(resolveEpisodeRules(limits, limits.timestepSeconds)).toEqual({ timestepSeconds: 1 / 60, maxEpisodeTicks: 3600, stallTicks: 300, maxLaps: 3 });
  });

  it('converts limits to whole ticks, rounding up a part tick', () => {
    expect(rules({ maxEpisodeSeconds: 1, stallSeconds: 0.5 })).toMatchObject({ maxEpisodeTicks: 60, stallTicks: 30 });
    expect(rules({ maxEpisodeSeconds: 1.001, stallSeconds: 0.001 })).toMatchObject({ maxEpisodeTicks: 61, stallTicks: 1 });
    expect(resolveEpisodeRules({ maxEpisodeSeconds: 1, stallSeconds: 1, maxLaps: 1 }, 0.1)).toMatchObject({ maxEpisodeTicks: 10, stallTicks: 10 });
  });

  it.each([
    ['version', 2],
    ['version', '1'],
    ['checkpointWeight', -1],
    ['partialProgressWeight', NaN],
    ['lapWeight', Infinity],
    ['collisionPenalty', -0.5],
    ['lapTimeBonusScale', '2000'],
    ['referenceLapSeconds', 0],
    ['referenceLapSeconds', -30],
    ['maxLapTimeRatio', 0.5],
    ['maxLapTimeRatio', undefined],
  ])('rejects fitness config %s = %s', (field, value) => {
    expect(() => resolveFitnessConfig({ ...DEFAULT_FITNESS_CONFIG, [field]: value })).toThrow(new RegExp(`"${field}"`));
  });

  it('rejects a fitness config that is not an object, and accepts zero weights', () => {
    expect(() => resolveFitnessConfig(null)).toThrow(RangeError);
    expect(() => resolveFitnessConfig(3)).toThrow(RangeError);
    const zero = { ...DEFAULT_FITNESS_CONFIG, checkpointWeight: 0, partialProgressWeight: 0, lapWeight: 0, collisionPenalty: 0, lapTimeBonusScale: 0 };
    expect(resolveFitnessConfig(zero)).toEqual(zero);
  });

  it.each([
    ['maxEpisodeSeconds', 0],
    ['maxEpisodeSeconds', Infinity],
    ['stallSeconds', -5],
    ['stallSeconds', NaN],
    ['maxLaps', 0],
    ['maxLaps', 1.5],
    ['maxLaps', '3'],
  ])('rejects episode limit %s = %s', (field, value) => {
    expect(() => resolveEpisodeRules({ ...DEFAULT_EPISODE_LIMITS, [field]: value }, DT)).toThrow(new RegExp(`"${field}"`));
  });

  it('rejects bad timesteps and non-object limits', () => {
    for (const dt of [0, -DT, NaN, Infinity]) expect(() => resolveEpisodeRules(DEFAULT_EPISODE_LIMITS, dt)).toThrow(/"timestepSeconds"/);
    expect(() => resolveEpisodeRules(null, DT)).toThrow(RangeError);
  });
});

describe('the formula, term by term (hand-calculated, default weights)', () => {
  const base: Episode = {
    tick: 0,
    startPosition: START,
    gatesPassed: 0,
    nextGate: 0,
    lapTicks: [],
    lastCreditTick: 0,
    partialProgress: 0,
    crashed: false,
    outcome: null,
  };
  const score = (episode: Partial<Episode>) => scoreEpisode({ ...base, ...episode }, DEFAULT_FITNESS_CONFIG, RULES);

  it('gives 0 to a car that has done nothing', () => {
    expect(score({})).toEqual({ fitnessVersion: 1, checkpoints: 0, partialProgress: 0, laps: 0, lapTimeBonus: 0, collisionPenalty: 0, total: 0 });
  });

  it('adds 1000 per gate, 1000 × partial progress, and subtracts 500 once for a crash', () => {
    expect(score({ gatesPassed: 7, partialProgress: 0.25 }).total).toBe(7250);
    expect(score({ gatesPassed: 7, partialProgress: 0.25, crashed: true })).toMatchObject({ collisionPenalty: 500, total: 6750 });
    expect(score({ partialProgress: 0.5, crashed: true }).total).toBe(0);
    expect(score({ crashed: true }).total).toBe(-500);
  });

  it('pays 5000 per completed lap plus 2000 × (30 s ÷ lap time), the ratio capped at 2', () => {
    // 1800 ticks = 30 s → ratio 1; 900 = 15 s → 2; 600 = 10 s → 3, capped to 2; 3600 = 60 s → 0.5; 1 tick → capped.
    expect(score({ lapTicks: [1800] })).toMatchObject({ laps: 5000, lapTimeBonus: 2000, total: 7000 });
    expect(score({ lapTicks: [900] }).lapTimeBonus).toBe(4000);
    expect(score({ lapTicks: [600] }).lapTimeBonus).toBe(4000);
    expect(score({ lapTicks: [3600] }).lapTimeBonus).toBe(1000);
    expect(score({ lapTicks: [1] }).lapTimeBonus).toBe(4000);
    expect(score({ gatesPassed: 41, lapTicks: [1800, 3600] })).toMatchObject({ checkpoints: 41000, laps: 10000, lapTimeBonus: 3000, total: 54000 });
  });

  it('uses the configured weights, and records the fitness version', () => {
    const config = { ...DEFAULT_FITNESS_CONFIG, checkpointWeight: 10, partialProgressWeight: 4, lapWeight: 100, collisionPenalty: 7, lapTimeBonusScale: 3, referenceLapSeconds: 60, maxLapTimeRatio: 5 };
    const result = scoreEpisode({ ...base, gatesPassed: 21, partialProgress: 0.5, lapTicks: [1800], crashed: true }, config, RULES);
    // 210 + 2 + 100 + 3 × min(5, 60 / 30) − 7
    expect(result).toEqual({ fitnessVersion: 1, checkpoints: 210, partialProgress: 2, laps: 100, lapTimeBonus: 6, collisionPenalty: 7, total: 311 });
  });

  it('never exceeds one gate for any approach: a crossing always beats partial progress', () => {
    expect(PARTIAL_PROGRESS_CAP).toBe(0.99);
    expect(score({ gatesPassed: 3, partialProgress: PARTIAL_PROGRESS_CAP }).total).toBeLessThan(score({ gatesPassed: 4 }).total);
  });
});

describe('partial progress geometry', () => {
  it('measures the fraction from the start to gate 0 before the first credit: 0 at the start, 0.5 halfway', () => {
    expect(partialProgressAt(START, 0, 0, START, oval)).toBe(0);
    expect(partialProgressAt(v(-3, 40), 0, 0, START, oval)).toBe(0.5);
    expect(partialProgressAt(v(-1.5, 40), 0, 0, START, oval)).toBe(0.75);
  });

  it('measures from the previous gate centre afterwards, wrapping from gate 19 to gate 0', () => {
    expect(partialProgressAt(v(15, 40), 1, 1, START, oval)).toBe(0.5); // gate 0 (0, 40) → gate 1 (30, 40)
    expect(partialProgressAt(v(-15, 40), 0, 20, START, oval)).toBe(0.5); // gate 19 (−30, 40) → gate 0 (0, 40)
  });

  it('is capped at 0.99, even on the next gate\'s line', () => {
    expect(partialProgressAt(v(-1e-9, 40), 0, 0, START, oval)).toBe(0.99);
    expect(partialProgressAt(v(0, 40), 0, 0, START, oval)).toBe(0.99);
  });

  it('is 0 behind the anchor and ahead of the next gate (arriving the wrong way)', () => {
    expect(partialProgressAt(v(-10, 40), 0, 0, START, oval)).toBe(0);
    expect(partialProgressAt(v(5, 40), 0, 0, START, oval)).toBe(0);
    expect(partialProgressAt(v(35, 40), 1, 1, START, oval)).toBe(0);
  });

  it('counts only within one road width (14 m) of the segment, so the far side of the track gets nothing', () => {
    expect(partialProgressAt(v(15, 33.5), 1, 1, START, oval)).toBe(0.5); // 6.5 m off the centre line
    expect(partialProgressAt(v(15, 54), 1, 1, START, oval)).toBe(0.5); // exactly 14 m
    expect(partialProgressAt(v(15, 54.001), 1, 1, START, oval)).toBe(0);
    expect(partialProgressAt(v(15, -40), 1, 1, START, oval)).toBe(0); // the top straight, 80 m away
  });

  it('is 0 when the anchor is the target, and rejects a bad gate index or a track without gates', () => {
    expect(partialProgressAt(v(0, 40), 0, 0, v(0, 40), oval)).toBe(0);
    expect(() => partialProgressAt(START, 20, 1, START, oval)).toThrow(RangeError);
    expect(() => partialProgressAt(START, -1, 1, START, oval)).toThrow(RangeError);
    expect(() => partialProgressAt(START, 0, 0, START, { ...oval, gates: [] })).toThrow(/no gates/);
  });
});

describe('legitimate ordered progress', () => {
  it('credits a bounded initial approach, then the gate, then partial progress towards the next gate', () => {
    const run = scripted([START, v(-3, 40), v(1, 40)]);
    expect(fitness(run[0]!)).toBe(0);
    expect(fitness(run[1]!)).toBe(500); // halfway to gate 0
    expect(run[2]).toMatchObject({ gatesPassed: 1, nextGate: 1, lastCreditTick: 2 });
    expect(fitness(run[2]!)).toBeCloseTo(1000 + 1000 / 30, 9); // gate 0, then 1 m of the 30 m to gate 1
  });

  it('scores a scripted 30-second lap exactly: 21 gates, 5000 for the lap and a 2000 time bonus', () => {
    // The centre line at LAP_LENGTH / 1800 m per tick: exactly 1800 ticks (30 s) between gate 0 crossings.
    const step = LAP_LENGTH / 1800;
    const points = Array.from({ length: 2000 }, (_, k) => centre(54 + k * step).position);
    const run = scripted(points, oval, rules({ maxLaps: 1 }));
    const end = last(run);
    expect(end.outcome).toBe('completed');
    expect(end.gatesPassed).toBe(21); // gate 0 to start timing, 19 more, gate 0 again
    expect(end.lapTicks).toEqual([1800]);
    // Partial progress: from gate 0's centre (0, 40) towards gate 1's (30, 40), the car's x / 30.
    const x = points[end.tick]!.x;
    expect(scoreEpisode(end, DEFAULT_FITNESS_CONFIG, RULES)).toMatchObject({ checkpoints: 21000, laps: 5000, lapTimeBonus: 2000 });
    expect(fitness(end)).toBeCloseTo(21000 + 5000 + 2000 + (1000 * x) / 30, 6);
    expect(end.tick - run.findIndex((e) => e.gatesPassed === 1)).toBe(1800);
  });

  it('scores a car driven round the oval by the seeded lap scenario, term by term, and replays it identically', () => {
    const lapRules = rules({ maxEpisodeSeconds: 200, maxLaps: 2 });
    const drive = () => {
      const steer = LAPS.driver(LAPS.seed);
      let world = createWorld(oval, PHYSICS);
      let episode = startEpisode(world.racer, oval);
      const episodes = [episode];
      while (episode.outcome === null) {
        world = stepWorld(world, steer(world), DEFAULT_SIM_CONFIG);
        episode = recordTick(episode, world.racer, oval, lapRules);
        episodes.push(episode);
      }
      return { world, episodes };
    };
    const first = drive();
    const second = drive();
    expect(second.episodes).toEqual(first.episodes);
    const end = last(first.episodes);
    expect(end.outcome).toBe('completed');
    expect(end.gatesPassed).toBe(41);
    expect(end.lapTicks).toEqual(first.world.racer.progress.lapTicks);
    const [lap1, lap2] = end.lapTicks as [number, number];
    const bonus = (ticks: number) => 2000 * Math.min(2, 30 / (ticks * DT));
    const partial = partialProgressAt(first.world.racer.car.vehicle.position, 1, 41, START, oval);
    expect(end.partialProgress).toBe(partial);
    expect(fitness(end, lapRules)).toBeCloseTo(41000 + 1000 * partial + 10000 + bonus(lap1) + bonus(lap2), 6);
  });
});

describe('anti-exploitation guards', () => {
  it('checkpoint farming: crossing gate 1 back and forth earns one credit, no more partial progress, then stalls', () => {
    const oscillate = Array.from({ length: 1000 }, (_, k) => v(k % 2 === 0 ? 31 : 29, 40));
    const run = scripted([...line(-6, 29, 1), ...oscillate]);
    const crossing = run.findIndex((e) => e.gatesPassed === 2); // the 29 → 31 move over gate 1
    expect(crossing).toBe(36);
    const farmed = 2000 + 1000 / 30; // gates 0 and 1, plus 1 m of the 30 m towards gate 2
    for (const episode of run.slice(crossing)) {
      expect(episode.gatesPassed).toBe(2);
      expect(fitness(episode)).toBeCloseTo(farmed, 9);
    }
    expect(last(run)).toMatchObject({ outcome: 'stalled', tick: crossing + 300 });
  });

  it('approaching, backing off and approaching again keeps the first high-water mark (no accumulation)', () => {
    const run = scripted([START, v(-1.5, 40), v(-4.5, 40), v(-1.5, 40), v(-4.5, 40), v(-1.5, 40), v(-4.5, 40)]);
    expect(run.map((e) => e.partialProgress)).toEqual([0, 0.75, 0.75, 0.75, 0.75, 0.75, 0.75]);
    expect(run.map((e) => fitness(e))).toEqual([0, 750, 750, 750, 750, 750, 750]);
  });

  it('idling: a car left at rest earns nothing and stalls on exactly tick 300', () => {
    let racer = startRacer(oval, PHYSICS);
    let episode = startEpisode(racer, oval);
    const outcomes: (string | null)[] = [];
    while (episode.outcome === null) {
      racer = stepRacer(racer, NO_CONTROLS, oval, PHYSICS, DT);
      episode = recordTick(episode, racer, oval, RULES);
      outcomes.push(episode.outcome);
    }
    expect(episode.tick).toBe(300);
    expect(outcomes[298]).toBeNull();
    expect(episode.outcome).toBe('stalled');
    expect(fitness(episode)).toBe(0);
  });

  it('creeping: 1 mm per tick earns only its bounded approach (0.3 m of 6 m) and stalls at tick 300', () => {
    const run = scripted(line(-6, -5, 0.001));
    const end = last(run);
    expect(end).toMatchObject({ outcome: 'stalled', tick: 300, gatesPassed: 0 });
    expect(fitness(end)).toBeCloseTo(50, 6);
  });

  it('circling: loops round gate 0 earn the gate once and 0.1 of the way to gate 1, however many loops', () => {
    // A 3 m circle round gate 0's centre, 60 points per loop, starting at (−3, 40) and crossing gate 0 forwards
    // (+x) at its bottom, backwards (−x) at its top.
    const circle = Array.from({ length: 1200 }, (_, k) => {
      const angle = Math.PI + (2 * Math.PI * k) / 60;
      return v(3 * Math.cos(angle), 40 + 3 * Math.sin(angle));
    });
    const run = scripted(circle);
    const crossing = run.findIndex((e) => e.gatesPassed === 1);
    expect(crossing).toBe(16); // just past the bottom of the circle
    const afterOneLoop = run[crossing + 60]!;
    expect(afterOneLoop.partialProgress).toBeCloseTo(0.1, 12); // x = 3 at most: 3 m of the 30 m to gate 1
    for (const episode of run.slice(crossing + 60)) {
      expect(episode.gatesPassed).toBe(1);
      expect(fitness(episode)).toBeCloseTo(1100, 6);
    }
    expect(last(run)).toMatchObject({ outcome: 'stalled', tick: crossing + 300 });
  });

  it('reversing: turning back from the start crosses gate 19 backwards for nothing, then stalls', () => {
    const run = scripted([...line(-6, -50, -1), ...Array.from({ length: 400 }, () => v(-50, 40))]);
    for (const episode of run) expect(fitness(episode)).toBe(0);
    expect(last(run)).toMatchObject({ outcome: 'stalled', tick: 300, gatesPassed: 0 });
  });

  it('reversing: a whole lap the wrong way credits no gate and earns at most the bounded approach to gate 0', () => {
    const points = Array.from({ length: 1900 }, (_, k) => centre(54 - k * 0.27).position);
    const run = scripted(points, oval, rules({ stallSeconds: 100, maxEpisodeSeconds: 100 }));
    expect(last(run).tick).toBe(1899);
    for (const episode of run) expect(episode.gatesPassed).toBe(0);
    // Nothing until the car is back between the start and gate 0, from the wrong side; then the same bounded
    // approach any fresh car can earn, never a gate.
    const backInCorridor = run.findIndex((e) => e.partialProgress > 0);
    expect(points[backInCorridor]!.x).toBeLessThan(0);
    expect(points[backInCorridor]!.x).toBeGreaterThan(-6);
    expect(Math.max(...run.map((e) => fitness(e)))).toBeLessThanOrEqual(990);
  });

  it('collision-rejected movement: a move that would cross a gate while hitting a wall credits nothing and costs 500', () => {
    // As in tests/sim/checkpoints.test.ts: a square track with a gate across the bottom road at x = 50.
    const square = (x0: number, y0: number, x1: number, y1: number) => [v(x0, y0), v(x1, y0), v(x1, y1), v(x0, y1)];
    const gates = [
      { a: v(50, 60), b: v(50, 100) },
      { a: v(60, 50), b: v(100, 50) },
      { a: v(40, 50), b: v(0, 50) },
    ];
    const box = loadTrack({ id: 'box', version: '1', name: 'Box', outer: square(0, 0, 100, 100), inner: square(40, 40, 60, 60), start: { position: v(45, 80), heading: 0 }, gates });
    const vehicle = { position: v(49.9, 98.99), heading: 0.003, speed: PHYSICS.maxSpeed };
    const racer: Racer = { car: { vehicle, crashed: false }, progress: createProgress() };
    const episode = startEpisode(racer, box);
    const next = stepRacer(racer, { steering: 0, throttle: 1, brake: 0 }, box, PHYSICS, DT);
    const ended = recordTick(episode, next, box, RULES);
    expect(ended).toMatchObject({ outcome: 'crashed', gatesPassed: 0, partialProgress: 0, crashed: true });
    expect(scoreEpisode(ended, DEFAULT_FITNESS_CONFIG, RULES)).toMatchObject({ collisionPenalty: 500, total: -500 });
    // The crashed car's further ticks are not scored: the episode is over.
    expect(() => recordTick(ended, stepRacer(next, NO_CONTROLS, box, PHYSICS, DT), box, RULES)).toThrow(/already ended/);
  });

  it('a crash keeps the progress earned before it, minus the penalty', () => {
    const run = scripted([START, v(1, 40), v(15, 40)]);
    // The next tick's move hits a wall, so the car stays at (15, 40) with the same progress, now crashed.
    const progress = advanceProgress(advanceProgress(createProgress(), START, v(1, 40), oval), v(1, 40), v(15, 40), oval);
    const crashed = recordTick(last(run), racerAt(v(15, 40), { ...progress, tick: 3 }, true), oval, RULES);
    expect(crashed.outcome).toBe('crashed');
    expect(fitness(crashed)).toBeCloseTo(1000 + 500 - 500, 9); // gate 0, halfway to gate 1, the penalty
  });

  it('episode length: a longer maximum time adds nothing without new progress', () => {
    const path = [...line(-6, 29, 1), ...Array.from({ length: 1000 }, (_, k) => v(k % 2 === 0 ? 31 : 29, 40))];
    const short = last(scripted(path, oval, rules({ maxEpisodeSeconds: 10 })));
    const long = last(scripted(path, oval, rules({ maxEpisodeSeconds: 60 })));
    expect(short).toEqual(long);
    expect(fitness(short)).toBe(fitness(long));
  });

  it('timeout ends the episode on exactly the last tick, with the fitness earned so far', () => {
    const path = line(-6, 200, 0.5); // steady forwards progress, a gate every 60 ticks: never stalls
    const run = scripted(path, oval, rules({ maxEpisodeSeconds: 1 }));
    expect(run[59]!.outcome).toBeNull();
    expect(last(run)).toMatchObject({ outcome: 'timeout', tick: 60 });
    // 60 ticks × 0.5 m from x = −6 is x = 24: gate 0 crossed, 24 m of the 30 m to gate 1.
    expect(fitness(last(run))).toBeCloseTo(1000 + 800, 9);
    expect(scripted(path, oval, rules({ maxEpisodeSeconds: 2 }))[60]).toEqual({ ...last(run), outcome: null });
  });

  it('a stall and a timeout on the same tick end as stalled', () => {
    const run = scripted(Array.from({ length: 400 }, () => START), oval, rules({ maxEpisodeSeconds: 5, stallSeconds: 5 }));
    expect(last(run)).toMatchObject({ outcome: 'stalled', tick: 300 });
  });

  it('degenerate overlapping gates: back-and-forth "laps" stop at maxLaps and each lap bonus is capped', () => {
    // Three gates 0.5 m apart on one straight: every forward move crosses all three, so each one after the first
    // completes a 2-tick "lap". Track validation (P4-01) should reject this geometry; scoring stays bounded.
    const gates = [0, 0.5, 1].map((x) => ({ a: v(x, 33), b: v(x, 47) }));
    const strip = loadTrack({ ...stadiumOval, id: 'strip', gates });
    const run = scripted(Array.from({ length: 20 }, (_, k) => v(k % 2 === 0 ? -1 : 2, 40)), strip);
    const end = last(run);
    expect(end).toMatchObject({ outcome: 'completed', tick: 7, gatesPassed: 12, lapTicks: [2, 2, 2], partialProgress: 0 });
    // 12 gates + 3 × (5000 + 2000 × min(2, 30 s ÷ 2 ticks)) = 12000 + 3 × 9000.
    expect(fitness(end)).toBe(39000);
  });
});

describe('completion', () => {
  it('ends as completed when maxLaps laps are done, and only completed laps earn the lap terms', () => {
    const step = LAP_LENGTH / 1800;
    const points = Array.from({ length: 6000 }, (_, k) => centre(54 + k * step).position);
    const twoLaps = scripted(points, oval, rules({ maxEpisodeSeconds: 100, maxLaps: 2 }));
    const end = last(twoLaps);
    expect(end).toMatchObject({ outcome: 'completed', gatesPassed: 41, lapTicks: [1800, 1800] });
    const beforeFirstLap = twoLaps[end.tick - 1801]!; // one tick before the first lap completes
    expect(beforeFirstLap.lapTicks).toEqual([]);
    expect(scoreEpisode(beforeFirstLap, DEFAULT_FITNESS_CONFIG, RULES)).toMatchObject({ laps: 0, lapTimeBonus: 0 });
    expect(scoreEpisode(end, DEFAULT_FITNESS_CONFIG, RULES)).toMatchObject({ laps: 10000, lapTimeBonus: 4000 });
  });
});

describe('inputs and validation', () => {
  const deepFreeze = <T>(value: T): T => {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(deepFreeze);
      Object.freeze(value);
    }
    return value;
  };

  it('never writes its inputs, and each car is scored independently', () => {
    const racer = deepFreeze(startRacer(oval, PHYSICS));
    const episode = deepFreeze(startEpisode(racer, oval));
    const moved = deepFreeze(stepRacer(racer, { steering: 0, throttle: 1, brake: 0 }, oval, PHYSICS, DT));
    const before = JSON.stringify(episode);
    const next = recordTick(episode, moved, oval, RULES);
    expect(JSON.stringify(episode)).toBe(before);
    expect(next.tick).toBe(1);
    // Two cars recorded alternately give the same results as each recorded alone.
    const a = scripted([START, v(-3, 40), v(1, 40)]);
    const b = scripted([START, v(-4.5, 40), v(-1.5, 40)]);
    let ea = startEpisode(racerAt(START, createProgress()), oval);
    let eb = startEpisode(racerAt(START, createProgress()), oval);
    let pa = createProgress();
    let pb = createProgress();
    const pathA = [START, v(-3, 40), v(1, 40)];
    const pathB = [START, v(-4.5, 40), v(-1.5, 40)];
    for (let i = 1; i < 3; i += 1) {
      pa = advanceProgress(pa, pathA[i - 1]!, pathA[i]!, oval);
      ea = recordTick(ea, racerAt(pathA[i]!, pa), oval, RULES);
      pb = advanceProgress(pb, pathB[i - 1]!, pathB[i]!, oval);
      eb = recordTick(eb, racerAt(pathB[i]!, pb), oval, RULES);
    }
    expect(ea).toEqual(last(a));
    expect(eb).toEqual(last(b));
  });

  it('a car that starts crashed ends at once as crashed', () => {
    const episode = startEpisode(racerAt(START, createProgress(), true), oval);
    expect(episode.outcome).toBe('crashed');
    expect(fitness(episode)).toBe(-500);
  });

  it('only starts from fresh progress', () => {
    const progress = createProgress();
    expect(() => startEpisode(racerAt(START, { ...progress, tick: 1 }), oval)).toThrow(/fresh/);
    expect(() => startEpisode(racerAt(START, { ...progress, gatesPassed: 1, nextGate: 1 }), oval)).toThrow(/fresh/);
    expect(() => startEpisode(racerAt(START, { ...progress, lapTicks: [100] }), oval)).toThrow(/fresh/);
    expect(() => startEpisode(racerAt(v(NaN, 40), progress), oval)).toThrow(/finite/);
  });

  it('rejects a racer that is not exactly one tick later, or whose gates, laps or crash go backwards', () => {
    const run = scripted([START, v(1, 40)]);
    const episode = last(run); // tick 1, gate 0 credited
    const progress = { ...advanceProgress(createProgress(), START, v(1, 40), oval), tick: 2 };
    const ok = racerAt(v(1, 40), progress);
    expect(() => recordTick(episode, ok, oval, RULES)).not.toThrow();
    expect(() => recordTick(episode, racerAt(v(1, 40), { ...progress, tick: 3 }), oval, RULES)).toThrow(/tick 2/);
    expect(() => recordTick(episode, racerAt(v(1, 40), { ...progress, tick: 1 }), oval, RULES)).toThrow(/tick 2/);
    expect(() => recordTick(episode, racerAt(v(1, 40), { ...progress, gatesPassed: 0 }), oval, RULES)).toThrow(/never decrease/);
    const withLap = { ...episode, lapTicks: [5] };
    expect(() => recordTick(withLap, ok, oval, RULES)).toThrow(/laps must never decrease/);
    expect(() => recordTick({ ...episode, crashed: true }, ok, oval, RULES)).toThrow(/uncrashed/);
    expect(() => recordTick(episode, racerAt(v(1, Infinity), progress), oval, RULES)).toThrow(/finite/);
    expect(() => recordTick(episode, racerAt(v(1, 40), { ...progress, nextGate: 20 }), oval, RULES)).toThrow(RangeError);
    expect(() => recordTick({ ...episode, outcome: 'timeout' }, ok, oval, RULES)).toThrow(/already ended/);
  });
});

describe('separation', () => {
  it('imports only the simulation: no inference, evolution, rendering or DOM', () => {
    const source = readFileSync(join(__dirname, '../../src/training/fitness.ts'), 'utf8');
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const path of imports) expect(path).toMatch(/^\.\.\/sim\//);
  });
});
