// The P2-09 feasibility harness (src/training/feasibility.ts, plan step 3). Mechanics only. The decision rule is tested on
// synthetic episodes; the harness itself is run on a tiny test grid (one variant), never on the predeclared 240-episode
// grid, and no test asserts what any driver achieves. The feasibility check is plan step 4 and has not been run.
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../src/training/experiment';
import {
  analyseFeasibility,
  decideTrack,
  FEASIBILITY_FORMAT,
  FEASIBILITY_GRID,
  FEASIBILITY_TRACKS,
  feasibilityFiles,
  feasibilityReport,
  runFeasibility,
  USEFUL_MARGIN,
  type FeasibilityEpisode,
  type FeasibilityGrid,
  type FeasibilityRecord,
} from '../../src/training/feasibility';
import { BUILT_IN_TRACK_SPLITS, trackContentHash, tracksIn } from '../../src/training/trackSplits';
import { sha256Hex } from '../../src/utils/sha256';

const ENGINE = { name: 'node', version: 'v0.0.0-test', v8: 'test' };
const SOURCE = { revision: 'test', dirty: false, appVersion: '0.0.0' };
const TINY: FeasibilityGrid = { aLat: [6], lookAheadMeters: [20], vTop: [20] };

type Row = Partial<FeasibilityEpisode> & Pick<FeasibilityEpisode, 'mode'>;
const episode = (row: Row, n = 0): FeasibilityEpisode => ({
  split: 'training',
  trackId: 'stadium-oval',
  aLat: 4 + (n % 5),
  lookAheadMeters: 10,
  vTop: 20,
  outcome: 'timeout',
  crashed: false,
  lapsCompleted: 0,
  firstLapSeconds: null,
  orderedProgress: 0,
  gatesPassed: 0,
  ticks: 3600,
  ...row,
});
const lap = (mode: 'brake' | 'coast', seconds: number, extra: Partial<FeasibilityEpisode> = {}): FeasibilityEpisode =>
  episode({ mode, lapsCompleted: 1, firstLapSeconds: seconds, outcome: 'completed', ...extra });
const miss = (mode: 'brake' | 'coast', extra: Partial<FeasibilityEpisode> = {}): FeasibilityEpisode => episode({ mode, outcome: 'crashed', crashed: true, ...extra });

describe('the predeclared plan values', () => {
  it('has the grid, tracks and margin fixed in plan §4', () => {
    expect(FEASIBILITY_GRID).toEqual({ aLat: [4, 5, 6, 7, 8], lookAheadMeters: [10, 20, 30, 40], vTop: [16, 20, 23.7] });
    const variants = FEASIBILITY_GRID.aLat.length * FEASIBILITY_GRID.lookAheadMeters.length * FEASIBILITY_GRID.vTop.length;
    expect(variants).toBe(60);
    expect(variants * 2 /* modes */ * 2 /* tracks */).toBe(240);
    expect(FEASIBILITY_TRACKS).toEqual({ training: 'stadium-oval', validation: 'rounded-rectangle' });
    expect(USEFUL_MARGIN).toEqual({ seconds: 0.5, fraction: 0.02 });
    expect(Object.isFrozen(FEASIBILITY_GRID)).toBe(true);
    expect(Object.isFrozen(FEASIBILITY_GRID.aLat)).toBe(true);
  });

  it('uses a training track and a validation track and never a held-out one', () => {
    expect(tracksIn('training').map((t) => t.track.id)).toContain(FEASIBILITY_TRACKS.training);
    expect(tracksIn('validation').map((t) => t.track.id)).toContain(FEASIBILITY_TRACKS.validation);
    const heldOut = tracksIn('held-out').map((t) => t.track.id);
    expect(heldOut.length).toBeGreaterThan(0);
    for (const id of Object.values(FEASIBILITY_TRACKS)) expect(heldOut).not.toContain(id);
  });
});

describe('the decision rule (plan §4), on synthetic episodes', () => {
  it('rule (i): useful when at least one BRAKE variant completes a lap and no COAST variant does', () => {
    const d = decideTrack([lap('brake', 40), miss('brake'), miss('coast'), miss('coast')]);
    expect(d.rule).toBe('i');
    expect(d.useful).toBe(true);
    expect(d.coast.best).toBeNull();
    expect(d.gainSeconds).toBeNull();
  });

  it('is not useful when only COAST completes a lap, or when neither mode does', () => {
    expect(decideTrack([miss('brake'), lap('coast', 40)])).toMatchObject({ rule: null, useful: false });
    expect(decideTrack([miss('brake'), miss('coast')])).toMatchObject({ rule: null, useful: false });
  });

  it('rule (ii): needs BRAKE to be faster by max(0.5 s, 2% of the COAST time), with the boundary included', () => {
    // t(C*) = 40 s: 2% is 0.8 s, which beats 0.5 s, so BRAKE must reach 39.2 s.
    expect(decideTrack([lap('brake', 39.2), lap('coast', 40)])).toMatchObject({ rule: 'ii', useful: true });
    expect(decideTrack([lap('brake', 39.21), lap('coast', 40)])).toMatchObject({ rule: null, useful: false });
    // t(C*) = 10 s: 2% is 0.2 s, so the 0.5 s floor applies and BRAKE must reach 9.5 s.
    expect(decideTrack([lap('brake', 9.5), lap('coast', 10)])).toMatchObject({ rule: 'ii', useful: true });
    expect(decideTrack([lap('brake', 9.51), lap('coast', 10)])).toMatchObject({ rule: null, useful: false });
    const d = decideTrack([lap('brake', 39), lap('coast', 40)]);
    expect(d.gainSeconds).toBeCloseTo(1, 12);
    expect(d.requiredSeconds).toBeCloseTo(0.8, 12);
  });

  it('is not useful when BRAKE is slower or equal', () => {
    expect(decideTrack([lap('brake', 41), lap('coast', 40)])).toMatchObject({ rule: null, useful: false });
    expect(decideTrack([lap('brake', 40), lap('coast', 40)])).toMatchObject({ rule: null, useful: false });
  });

  it('compares the fastest lap of each mode, not the first or the average', () => {
    const d = decideTrack([lap('brake', 50, { aLat: 4 }), lap('brake', 38, { aLat: 8 }), lap('coast', 44, { aLat: 4 }), lap('coast', 39, { aLat: 8 })]);
    expect(d.brake.best).toMatchObject({ seconds: 38, aLat: 8 });
    expect(d.coast.best).toMatchObject({ seconds: 39, aLat: 8 });
    // Fastest against fastest: 1 s faster, and the margin is max(0.5, 2% of 39 s = 0.78 s) = 0.78 s, so braking is useful.
    // Comparing the first laps (50 s against 44 s) or the averages would have said the opposite.
    expect(d.rule).toBe('ii');
    expect(d.gainSeconds).toBeCloseTo(1, 12);
    expect(d.requiredSeconds).toBeCloseTo(0.78, 12);
  });

  it('counts a lap as crash-free even if the car crashed later in the episode, and not a timeout without a lap', () => {
    const d = decideTrack([lap('brake', 40, { outcome: 'crashed', crashed: true, lapsCompleted: 1 }), episode({ mode: 'brake' }), miss('coast')]);
    expect(d.brake.crashFree).toBe(1);
    expect(d.brake.variants).toBe(2);
    expect(d.coast.crashFree).toBe(0);
  });

  it('lets the earliest variant win a tie and reports outcome counts in a fixed order', () => {
    const d = decideTrack([lap('brake', 40, { aLat: 5 }), lap('brake', 40, { aLat: 4 }), miss('brake'), episode({ mode: 'brake' }), miss('coast')]);
    expect(d.brake.best).toMatchObject({ seconds: 40, aLat: 5 });
    expect(Object.keys(d.brake.outcomes)).toEqual(['completed', 'crashed', 'timeout']);
    expect(d.brake.outcomes).toEqual({ completed: 2, crashed: 1, timeout: 1 });
  });

  it('rejects an empty track', () => {
    expect(() => decideTrack([])).toThrow(RangeError);
  });

  it('acceptance A2 is met when braking is useful on at least one track, and not otherwise', () => {
    const training = [lap('brake', 40), lap('coast', 40)];
    const validation = [lap('brake', 30, { split: 'validation', trackId: 'rounded-rectangle' }), miss('coast', { split: 'validation', trackId: 'rounded-rectangle' })];
    const both = analyseFeasibility({ episodes: [...training, ...validation] });
    expect(both.tracks.map((t) => [t.trackId, t.useful])).toEqual([['stadium-oval', false], ['rounded-rectangle', true]]);
    expect(both.brakingUsefulOnAtLeastOneTrack).toBe(true);
    const neither = analyseFeasibility({ episodes: [...training, miss('brake', { split: 'validation', trackId: 'rounded-rectangle' })] });
    expect(neither.brakingUsefulOnAtLeastOneTrack).toBe(false);
  });
});

describe('the report', () => {
  const base = runFeasibility({ engine: ENGINE, source: SOURCE, grid: TINY });
  const synthetic = (episodes: FeasibilityEpisode[]): FeasibilityRecord => ({ ...base, episodes });

  it('states A2 as met, naming the rule and the numbers', () => {
    const text = feasibilityReport(synthetic([lap('brake', 39), lap('coast', 40), lap('brake', 30, { split: 'validation', trackId: 'rounded-rectangle' }), miss('coast', { split: 'validation', trackId: 'rounded-rectangle' })]));
    expect(text).toContain('**useful, rule (ii)**: the best BRAKE lap is 1.000 s faster than the best COAST lap, and the required margin was 0.800 s.');
    expect(text).toContain('**useful, rule (i)**');
    expect(text).toContain('**Met:**');
    expect(text).toContain('| BRAKE | 1 | 1/1 (100.0%) | 39.000 |');
    expect(text).toContain('| COAST | 1 | 0/1 (0.0%) | none |');
  });

  it('states A2 as not met, with the stop-for-owner consequence and no suggestion to change physics or tracks', () => {
    const text = feasibilityReport(synthetic([miss('brake'), miss('coast'), miss('brake', { split: 'validation', trackId: 'rounded-rectangle' }), miss('coast', { split: 'validation', trackId: 'rounded-rectangle' })]));
    expect(text).toContain('**not shown**: neither mode completed a crash-free lap.');
    expect(text).toContain('**Not met:**');
    expect(text).toContain('the work stops for the owner\'s decision. No physics or track change is made');
  });

  it('says plainly that it is physical feasibility only and that no held-out track was used', () => {
    const text = feasibilityReport(base);
    expect(text).toContain('**Physical feasibility only.**');
    expect(text).toContain('not evidence that a network learns to brake');
    expect(text).toContain('No held-out track was used.');
    expect(text).not.toContain('hairpin-chicane');
  });
});

describe('running the harness on a tiny test grid (mechanics only; no outcome is asserted)', () => {
  const record = runFeasibility({ engine: ENGINE, source: SOURCE, grid: TINY });

  it('runs every variant once per mode per track, in a fixed order', () => {
    expect(record.episodes.map((e) => [e.split, e.trackId, e.mode])).toEqual([
      ['training', 'stadium-oval', 'brake'],
      ['training', 'stadium-oval', 'coast'],
      ['validation', 'rounded-rectangle', 'brake'],
      ['validation', 'rounded-rectangle', 'coast'],
    ]);
    for (const e of record.episodes) expect([e.aLat, e.lookAheadMeters, e.vTop]).toEqual([6, 20, 20]);
  });

  it('records the grid, the rules, the tracks with their hashes, the engine and the source, and says the grid is not the predeclared one', () => {
    expect(record.format).toBe(FEASIBILITY_FORMAT);
    expect(record.preregisteredGrid).toBe(false);
    expect(record.grid).toEqual(TINY);
    expect(record.rules).toMatchObject({ maxEpisodeSeconds: 60, stallSeconds: 5, maxLaps: 3, fitnessVersion: 1 });
    expect(record.tracks.map((t) => [t.split, t.id])).toEqual([['training', 'stadium-oval'], ['validation', 'rounded-rectangle']]);
    for (const t of record.tracks) {
      const found = [...tracksIn('training'), ...tracksIn('validation')].find((x) => x.track.id === t.id)!;
      expect(t.contentHash).toBe(trackContentHash(found.track));
      expect(t.version).toBe(found.track.version);
    }
    expect(record.engine).toEqual(ENGINE);
    expect(record.source).toEqual(SOURCE);
    expect(BUILT_IN_TRACK_SPLITS).toBeDefined();
  });

  it('has well-formed episodes: ticks within the limit, laps and first-lap time agreeing, a hash of the episodes', () => {
    const limit = 60 * 60; // 60 s at 1/60 s
    for (const e of record.episodes) {
      expect(e.ticks).toBeGreaterThan(0);
      expect(e.ticks).toBeLessThanOrEqual(limit + 1);
      expect(e.lapsCompleted >= 1).toBe(e.firstLapSeconds !== null);
      expect(e.orderedProgress).toBeGreaterThanOrEqual(0);
      expect(e.crashed).toBe(e.outcome === 'crashed');
    }
    expect(record.resultsHash).toBe(`sha256:${sha256Hex(canonicalJson(record.episodes))}`);
  });

  it('is deterministic: a second run gives the same record and byte-identical files', () => {
    const again = runFeasibility({ engine: ENGINE, source: SOURCE, grid: TINY });
    expect(again).toEqual(record);
    expect(feasibilityFiles(again)).toEqual(feasibilityFiles(record));
  });

  it('writes feasibility.json and feasibility.md, and the JSON parses back to the record', () => {
    const files = feasibilityFiles(record);
    expect(files.map((f) => f.name)).toEqual(['feasibility.json', 'feasibility.md']);
    expect(files[0]!.text.endsWith('\n')).toBe(true);
    expect(JSON.parse(files[0]!.text)).toEqual(JSON.parse(JSON.stringify(record)));
    expect(files[1]!.text).toContain('**This is NOT the predeclared grid.**');
  });

  it('changes the results hash with the grid but not with the engine or the source', () => {
    const other = runFeasibility({ engine: { ...ENGINE, version: 'v9' }, source: { ...SOURCE, revision: 'other' }, grid: TINY });
    expect(other.resultsHash).toBe(record.resultsHash);
    expect(other.episodes).toEqual(record.episodes);
    const wider = runFeasibility({ engine: ENGINE, source: SOURCE, grid: { ...TINY, aLat: [6, 7] } });
    expect(wider.episodes).toHaveLength(8);
    expect(wider.resultsHash).not.toBe(record.resultsHash);
  });

  it('rejects an empty or invalid test grid', () => {
    for (const bad of [{ ...TINY, aLat: [] }, { ...TINY, vTop: [0] }, { ...TINY, lookAheadMeters: [NaN] }]) {
      expect(() => runFeasibility({ engine: ENGINE, source: SOURCE, grid: bad as FeasibilityGrid })).toThrow(RangeError);
    }
  });

  it('marks a record made with exactly the predeclared grid object as preregistered (checked without running it)', () => {
    expect(canonicalJson(FEASIBILITY_GRID)).toBe(canonicalJson({ aLat: [4, 5, 6, 7, 8], lookAheadMeters: [10, 20, 30, 40], vTop: [16, 20, 23.7] }));
    expect(canonicalJson(TINY)).not.toBe(canonicalJson(FEASIBILITY_GRID));
  });
});
