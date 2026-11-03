// P2-09 step 5, Codex's P2 on #117 (22bf6c8): the E4 record's tick accounting must match what was actually simulated.
// generateE4Agent re-drives each frozen champion alone on the training track (to count its brake usage and check that
// it reproduces itself), and that extra episode was executed but not accounted for. This test counts the ticks the
// simulator really steps (every unfinished stepEpisode call, in the trainer and in the headless evaluation alike) and
// requires the record's totals to equal them, while the equal P × G search budget stays exactly as it was.
// A tiny mechanics fixture with seed 79xx only; no reserved seed is run and nothing here is a study result.
import { describe, expect, it, vi } from 'vitest';
import { canonicalJson } from '../../src/training/experiment';
import { sha256Hex } from '../../src/utils/sha256';
import { BRAKE_USAGE_THRESHOLD } from '../../src/training/e4Agents';
import { E4_BOOTSTRAP, E4_DECISION_RULE, E4_DELTA, E4_MANIFEST_FORMAT, parseE4Record, runE4Seed, type E4Manifest } from '../../src/training/e4Study';
import { resolveBaselineConfig } from '../../src/training/baselines';
import { currentStreams, METRIC, trackReferences, WILCOXON, type StudyContext } from '../../src/training/study';

const counter = vi.hoisted(() => ({ steps: 0 }));
vi.mock('../../src/training/episodeStep', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/training/episodeStep')>();
  return {
    ...actual,
    // One tick of one car: a finished episode is returned unchanged and is not a simulated tick.
    stepEpisode: (...args: Parameters<typeof actual.stepEpisode>) => {
      if (args[0].episode.outcome === null) counter.steps += 1;
      return actual.stepEpisode(...args);
    },
  };
});

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const P = 3;
const G = 2;
const { setup } = resolveBaselineConfig({ training: { populationSize: P, eliteCount: 1, maxEpisodeSeconds: 2, stallSeconds: 1 }, generations: G, trackId: 'stadium-oval' }, 0);
const MANIFEST: E4Manifest = {
  format: E4_MANIFEST_FORMAT,
  version: 1,
  id: 'mechanics-e4-accounting',
  label: 'mechanics',
  description: 'Tiny mechanics fixture for the E4 tick-accounting test.',
  agents: ['A4', 'A5'],
  brake: { A4: false, A5: true },
  seeds: [7901],
  configuration: { generations: G, training: Object.fromEntries(Object.entries(setup.config).filter(([key]) => key !== 'seed' && key !== 'brakeEnabled')) as E4Manifest['configuration']['training'] },
  streams: currentStreams(),
  tracks: trackReferences('stadium-oval', 'rounded-rectangle'),
  metric: METRIC,
  analysis: { delta: E4_DELTA, bootstrap: { ...E4_BOOTSTRAP }, wilcoxon: WILCOXON, decisionRule: E4_DECISION_RULE, brakeUsageThreshold: BRAKE_USAGE_THRESHOLD },
  code: { revision: null },
};
const ENGINE = { name: 'node', version: process.version, v8: process.versions.v8 };
const CONTEXT: StudyContext = {
  engine: ENGINE,
  source: { revision: null, dirty: null, unavailableReason: 'not a git checkout (test)', appVersion: '0.0.0' },
  recordedAt: '2026-11-03T20:00:00.000Z',
};

counter.steps = 0;
const RECORD = runE4Seed(MANIFEST, 7901, CONTEXT);
const SIMULATED = counter.steps;
const budgets = RECORD.budgets as Json;
const agents = RECORD.agents as Json;
const AGENT_IDS = ['A4', 'A5'] as const;

describe('the record\'s tick accounting equals the ticks actually simulated (Codex P2 on #117)', () => {
  it('sums to every tick the simulator stepped while the seed ran', () => {
    expect(SIMULATED).toBeGreaterThan(0);
    const recorded = AGENT_IDS.reduce((n, agent) => n + budgets.ticks[agent].training + budgets.ticks[agent].validation + (budgets.ticks[agent].verification ?? 0), 0);
    expect(recorded).toBe(SIMULATED);
  });

  it('records the frozen-champion verification separately: one training-track episode per agent, as long as the champion\'s own training episode', () => {
    for (const agent of AGENT_IDS) {
      const block = agents[agent];
      const champion = block.generations[G - 1][block.index].training;
      expect(budgets.actual.verificationEpisodes[agent]).toBe(1);
      expect(budgets.ticks[agent].verification).toBe(champion.ticks);
      expect(budgets.ticks[agent].verification).toBe(block.brakeUsage.training.ticks);
    }
  });

  it('keeps the equal P × G search budget exactly as it was: the search ticks cover the generation episodes only', () => {
    expect(budgets.planned.evolutionEvaluations).toBe(P * G);
    expect(budgets.actual.evaluations).toEqual({ A4: P * G, A5: P * G });
    expect(budgets.actual.eliteReevaluations).toBe(1 * (G - 1));
    for (const agent of AGENT_IDS) {
      const search = agents[agent].generations.flat().reduce((n: number, c: Json) => n + c.training.ticks, 0);
      expect(agents[agent].generations.flat()).toHaveLength(P * G);
      expect(budgets.ticks[agent].training).toBe(search);
      expect(budgets.ticks[agent].validation).toBe(agents[agent].validation.ticks);
    }
  });

  it('is validated by the record parser: an edited verification total or episode count is rejected', () => {
    expect(() => parseE4Record(JSON.parse(JSON.stringify(RECORD)), MANIFEST, ENGINE)).not.toThrow();
    const edit = (change: (r: Json) => void) => {
      const r = JSON.parse(JSON.stringify(RECORD)) as Json;
      change(r);
      return r;
    };
    expect(() => parseE4Record(edit((r) => (r.budgets.ticks.A4.verification += 1)), MANIFEST, ENGINE)).toThrow(/record\.budgets/);
    expect(() => parseE4Record(edit((r) => delete r.budgets.ticks.A5.verification), MANIFEST, ENGINE)).toThrow(/record\.budgets/);
    expect(() => parseE4Record(edit((r) => (r.budgets.actual.verificationEpisodes.A5 = 2)), MANIFEST, ENGINE)).toThrow(/record\.budgets/);
    expect(() => parseE4Record(edit((r) => delete r.budgets.actual.verificationEpisodes), MANIFEST, ENGINE)).toThrow(/record\.budgets/);
  });

  it('takes the verification ticks from the champion\'s training episode, not from the validation episode', () => {
    // In this fixture both episodes run to the time limit, so their ticks are equal and could be confused. Shorten
    // A5's champion training episode (ticks are not an input to any fitness term) and keep the record consistent: the
    // verification total must follow that episode, and the parser must accept it.
    const r = JSON.parse(JSON.stringify(RECORD)) as Json;
    const block = r.agents.A5;
    const champion = block.generations[G - 1][block.index].training;
    const validationTicks = block.validation.ticks;
    const shorter = Math.max(1, Math.min(champion.ticks, validationTicks) - 30);
    expect(shorter).not.toBe(validationTicks);
    r.budgets.ticks.A5.training -= champion.ticks - shorter;
    champion.ticks = shorter;
    block.brakeUsage.training = { ticks: shorter, brakeTicks: 0 };
    r.budgets.ticks.A5.verification = shorter;
    r.resultsHash = `sha256:${sha256Hex(canonicalJson(r.agents))}`;
    expect(() => parseE4Record(r, MANIFEST, ENGINE)).not.toThrow();
    // And a verification total that follows the validation episode instead is rejected.
    const confused = JSON.parse(JSON.stringify(r)) as Json;
    confused.budgets.ticks.A5.verification = validationTicks;
    expect(() => parseE4Record(confused, MANIFEST, ENGINE)).toThrow(/record\.budgets/);
  });
});
