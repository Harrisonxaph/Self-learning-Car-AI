// P5-01 step 3: the tuning module (training track only), the selection rule and the files. A small grid is used for the
// run tests; the committed full-grid record is checked in a separate describe block.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RULE_A3_NB_PARAMS, RULE_A3_PARAMS, type RuleParams } from '../../src/ai/ruleBasedDriver';
import {
  betterEpisode,
  MAX_VARIANTS,
  RULE_SELECTION,
  runRuleTuning,
  selectBest,
  TUNING_GRID,
  TUNING_TRACK_ID,
  tuningFiles,
  tuningReport,
  variantsOf,
  type TuningEpisode,
  type TuningGrid,
} from '../../src/training/ruleTuning';

const P: RuleParams = { steerGain: 2, frontClear: 0.6, speedCap: 0.75, brakeFront: 0.3, brakeSpeed: 0.4 };
const ep = (over: Partial<TuningEpisode>): TuningEpisode => ({
  agent: 'A3',
  index: 0,
  params: P,
  outcome: 'crash',
  crashed: true,
  gatesPassed: 5,
  lapsCompleted: 0,
  firstLapTicks: null,
  orderedProgress: 0.25,
  ticks: 100,
  ...over,
});
const SMALL: TuningGrid = { steerGain: [2, 4], frontClear: [0.6], speedCap: [0.75], brakeFront: [0.3], brakeSpeed: [0.4] };
const ENGINE = { name: 'test' };
const SOURCE = { revision: null };

describe('the predeclared grid', () => {
  it('has the documented sizes, within the limit: A3 72 variants, A3-nb 18', () => {
    expect(variantsOf(TUNING_GRID, true)).toHaveLength(72);
    expect(variantsOf(TUNING_GRID, false)).toHaveLength(18);
    expect(72).toBeLessThanOrEqual(MAX_VARIANTS);
  });
  it('every variant has valid constants and the order is steerGain, frontClear, speedCap, brakeFront, brakeSpeed', () => {
    const variants = variantsOf(TUNING_GRID, true);
    expect(variants[0]).toEqual({ steerGain: 1, frontClear: 0.3, speedCap: 0.5, brakeFront: 0.15, brakeSpeed: 0.4 });
    expect(variants[1]).toEqual({ steerGain: 1, frontClear: 0.3, speedCap: 0.5, brakeFront: 0.15, brakeSpeed: 0.6 });
    expect(variants[variants.length - 1]).toEqual({ steerGain: 4, frontClear: 0.6, speedCap: 1, brakeFront: 0.3, brakeSpeed: 0.6 });
  });
  it('A3-nb\'s variants fix the unused brake constants at 0', () => {
    for (const v of variantsOf(TUNING_GRID, false)) expect([v.brakeFront, v.brakeSpeed]).toEqual([0, 0]);
  });
  it('is frozen', () => {
    expect(Object.isFrozen(TUNING_GRID)).toBe(true);
  });
});

describe('the selection rule (checkpoints, then laps, then first lap, then grid index)', () => {
  it('more checkpoints win over everything else', () => {
    expect(betterEpisode(ep({ gatesPassed: 6 }), ep({ gatesPassed: 5, lapsCompleted: 2, firstLapTicks: 10 }))).toBe(true);
  });
  it('then more laps', () => {
    expect(betterEpisode(ep({ lapsCompleted: 2, firstLapTicks: 900 }), ep({ lapsCompleted: 1, firstLapTicks: 10 }))).toBe(true);
  });
  it('then the fastest first lap, a lap beating no lap', () => {
    expect(betterEpisode(ep({ lapsCompleted: 1, firstLapTicks: 400 }), ep({ lapsCompleted: 1, firstLapTicks: 500 }))).toBe(true);
    expect(betterEpisode(ep({ lapsCompleted: 1, firstLapTicks: 500 }), ep({ lapsCompleted: 1, firstLapTicks: 400 }))).toBe(false);
    expect(betterEpisode(ep({ firstLapTicks: 400 }), ep({ firstLapTicks: null }))).toBe(true);
    expect(betterEpisode(ep({ firstLapTicks: null }), ep({ firstLapTicks: 400 }))).toBe(false);
  });
  it('a full tie is not better, so the lowest grid index wins', () => {
    const a = ep({ index: 3 });
    const b = ep({ index: 1 });
    expect(betterEpisode(a, b)).toBe(false);
    expect(selectBest([a, b, ep({ index: 7 })]).index).toBe(3); // the first in grid order among equals
    expect(selectBest([b, a]).index).toBe(1);
  });
  it('selects the best of several', () => {
    const best = selectBest([ep({ index: 0 }), ep({ index: 1, gatesPassed: 9 }), ep({ index: 2, gatesPassed: 9, lapsCompleted: 1, firstLapTicks: 700 }), ep({ index: 3, gatesPassed: 9, lapsCompleted: 1, firstLapTicks: 650 })]);
    expect(best.index).toBe(3);
  });
  it('refuses an empty list', () => {
    expect(() => selectBest([])).toThrow(RangeError);
  });
});

describe('running the tuning (small grid)', () => {
  const record = runRuleTuning({ engine: ENGINE, source: SOURCE, grid: SMALL });
  it('records the single training track and no other split', () => {
    expect(record.track.split).toBe('training');
    expect(record.track.id).toBe(TUNING_TRACK_ID);
    // Exactly one track is recorded (there is no `tracks` list), and every episode ran on it.
    expect(Object.keys(record)).not.toContain('tracks');
    expect(record.rules.fitnessVersion).toBe(1);
  });
  it('evaluates every variant of A3 and A3-nb once, then A3-nb-same', () => {
    expect(record.episodes.filter((e) => e.agent === 'A3')).toHaveLength(2);
    expect(record.episodes.filter((e) => e.agent === 'A3-nb')).toHaveLength(2);
    expect(record.episodes.filter((e) => e.agent === 'A3-nb-same')).toHaveLength(1);
    expect(record.episodes[record.episodes.length - 1]!.agent).toBe('A3-nb-same');
  });
  it('A3-nb-same uses exactly A3\'s selected constants', () => {
    const same = record.episodes.find((e) => e.agent === 'A3-nb-same')!;
    expect(same.params).toEqual(record.selected.A3.params);
    expect(same.index).toBeNull();
  });
  it('the selected variants are the ones the rule picks from the recorded episodes', () => {
    for (const agent of ['A3', 'A3-nb'] as const) {
      const best = selectBest(record.episodes.filter((e) => e.agent === agent));
      expect(record.selected[agent]).toEqual({ index: best.index, params: best.params });
    }
  });
  it('says the grid is not the predeclared one, and names the selection rule', () => {
    expect(record.preregisteredGrid).toBe(false);
    expect(record.selectionRule).toBe(RULE_SELECTION);
  });
  it('is deterministic: the same code gives the same episodes and hash', () => {
    const again = runRuleTuning({ engine: ENGINE, source: SOURCE, grid: SMALL });
    expect(again.resultsHash).toBe(record.resultsHash);
    expect(again.episodes).toEqual(record.episodes);
    expect(record.resultsHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
  it('writes a JSON and a Markdown file, and the report names the limits', () => {
    const files = tuningFiles(record);
    expect(files.map((f) => f.name)).toEqual(['p5-01-tuning.json', 'p5-01-tuning.md']);
    expect(JSON.parse(files[0]!.text).resultsHash).toBe(record.resultsHash);
    const report = tuningReport(record);
    expect(report).toContain('not a learning result');
    expect(report).toContain('A3-nb-same');
    expect(report).toContain('**no** (a test grid)');
    expect(tuningReport(record)).toBe(report);
  });
});

describe('refusals', () => {
  it('refuses a grid with an empty list or more than the limit of A3 variants', () => {
    expect(() => runRuleTuning({ engine: ENGINE, source: SOURCE, grid: { ...SMALL, steerGain: [] } })).toThrow(RangeError);
    const big = Array.from({ length: 101 }, (_, i) => 1 + i / 1000);
    expect(() => runRuleTuning({ engine: ENGINE, source: SOURCE, grid: { ...SMALL, steerGain: big } })).toThrow(RangeError);
  });
});

describe('the committed tuning record (docs/experiments/p5-01-tuning.json)', () => {
  const committed = JSON.parse(readFileSync(join(__dirname, '../../docs/experiments/p5-01-tuning.json'), 'utf8')) as ReturnType<typeof runRuleTuning>;
  it('used the predeclared grid, the training track only, and the documented selection rule', () => {
    expect(committed.preregisteredGrid).toBe(true);
    expect(committed.grid).toEqual(TUNING_GRID);
    expect(committed.track.split).toBe('training');
    expect(committed.track.id).toBe(TUNING_TRACK_ID);
    expect(committed.selectionRule).toBe(RULE_SELECTION);
    expect(committed.episodes).toHaveLength(72 + 18 + 1);
  });
  it('the frozen constants in the driver equal the record\'s selected constants', () => {
    expect(RULE_A3_PARAMS).toEqual(committed.selected.A3.params);
    expect(RULE_A3_NB_PARAMS).toEqual(committed.selected['A3-nb'].params);
  });
  it('the recorded selections are what the rule picks from the recorded episodes', () => {
    for (const agent of ['A3', 'A3-nb'] as const) {
      const best = selectBest(committed.episodes.filter((e) => e.agent === agent));
      expect(committed.selected[agent]).toEqual({ index: best.index, params: best.params });
    }
  });
  it('re-running the full grid reproduces the committed results hash and episodes (determinism and drift guard)', () => {
    const again = runRuleTuning({ engine: ENGINE, source: SOURCE });
    expect(again.resultsHash).toBe(committed.resultsHash);
    expect(again.episodes).toEqual(committed.episodes);
  });
  it('the committed report is the one the record produces', () => {
    expect(readFileSync(join(__dirname, '../../docs/experiments/p5-01-tuning.md'), 'utf8')).toBe(tuningReport(committed));
  });
});
