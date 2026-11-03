// P2-09 step 5: the E4 study kind (src/training/e4Study.ts, e4Agents.ts): manifest validation, the per-agent brake
// binding, record building and strict parsing, the paired A4/A5 integration test (plan §6, T2), corruption and
// compatibility, determinism and same-engine replay. Tiny in-memory mechanics fixtures with seeds 74xx only. No E4
// manifest is written and no seed in 2001–2010 is ever run, so nothing here is a study result or evidence of learning.
import { describe, expect, it } from 'vitest';
import type { EpisodeDriver } from '../../src/ai/drivers';
import { BRAKE_USAGE_THRESHOLD, E4_BRAKE, evaluateE4Model, e4Evaluation, generateE4Agent, withBrakeCount } from '../../src/training/e4Agents';
import {
  c1Training,
  E4_BOOTSTRAP,
  E4_DECISION_RULE,
  E4_DELTA,
  E4_MANIFEST_FORMAT,
  e4AgentConfigFor,
  e4ManifestHash,
  parseE4Manifest,
  parseE4Record,
  replayE4Record,
  runE4Seed,
  type E4Manifest,
} from '../../src/training/e4Study';
import { resolveBaselineConfig } from '../../src/training/baselines';
import { canonicalJson } from '../../src/training/experiment';
import { scoreEpisode, type Episode } from '../../src/training/fitness';
import { createFrozenModelDriver } from '../../src/training/frozenModelBrake';
import { currentStreams, E4_SEEDS, METRIC, StudyCompatibilityError, StudyManifestError, StudyRecordError, trackReferences, WILCOXON, type StudyContext } from '../../src/training/study';
import { TrackLeakageError } from '../../src/training/trackSplits';
import { evaluateDriver } from '../../src/training/evaluation';
import { sha256Hex } from '../../src/utils/sha256';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const rehash = (record: Json): Json => ({ ...record, resultsHash: `sha256:${sha256Hex(canonicalJson(record.agents))}` });

const P = 3;
const G = 2;
const SMALL = { populationSize: P, eliteCount: 1, maxEpisodeSeconds: 2, stallSeconds: 1 };
const training = (overrides: object = SMALL) => {
  const { setup } = resolveBaselineConfig({ training: overrides, generations: G, trackId: 'stadium-oval' }, 0);
  return Object.fromEntries(Object.entries(setup.config).filter(([key]) => key !== 'seed' && key !== 'brakeEnabled'));
};
const MANIFEST: E4Manifest = {
  format: E4_MANIFEST_FORMAT,
  version: 1,
  id: 'mechanics-e4',
  label: 'mechanics',
  description: 'Tiny mechanics fixture for the E4 tests.',
  agents: ['A4', 'A5'],
  brake: { A4: false, A5: true },
  seeds: [7401, 7402],
  configuration: { generations: G, training: training() as E4Manifest['configuration']['training'] },
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
const RECORD = runE4Seed(MANIFEST, 7401, CONTEXT);
const withManifest = (change: (m: Json) => void): Json => {
  const m = clone(MANIFEST) as Json;
  change(m);
  return m;
};
const withRecord = (change: (r: Json) => void, hash = true): Json => {
  const r = clone(RECORD) as Json;
  change(r);
  return hash ? rehash(r) : r;
};
const SCORING = resolveBaselineConfig({ training: { ...MANIFEST.configuration.training, brakeEnabled: true }, generations: G, trackId: 'stadium-oval' }, 7401).setup;
const rescore = (episode: Json) => {
  const b = scoreEpisode(episode as unknown as Episode, SCORING.config.fitness, SCORING.rules);
  episode.fitness = { checkpoints: b.checkpoints, partialProgress: b.partialProgress, laps: b.laps, lapTimeBonus: b.lapTimeBonus, collisionPenalty: b.collisionPenalty, total: b.total };
};

describe('mechanics fixtures only', () => {
  it('uses seeds outside every reserved set, and never an E4 seed', () => {
    for (const seed of MANIFEST.seeds) {
      expect(E4_SEEDS.includes(seed)).toBe(false);
      expect((seed >= 1001 && seed <= 1020) || (seed >= 9001 && seed <= 9003)).toBe(false);
    }
    expect(E4_SEEDS).toEqual([2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010]);
  });
});

describe('E4 manifest', () => {
  it('accepts the complete mechanics fixture and hashes its canonical JSON', () => {
    expect(parseE4Manifest(clone(MANIFEST))).toEqual(MANIFEST);
    expect(e4ManifestHash(MANIFEST)).toBe(`sha256:${sha256Hex(canonicalJson(MANIFEST))}`);
    expect(e4ManifestHash(withManifest((m) => (m.description = 'another')) as E4Manifest)).not.toBe(e4ManifestHash(MANIFEST));
  });

  it('fixes the per-agent brake setting: A4 false, A5 true', () => {
    expect(E4_BRAKE).toEqual({ A4: false, A5: true });
    expect(MANIFEST.brake).toEqual({ A4: false, A5: true });
  });

  it.each([
    ['brakeEnabled in the shared training configuration', (m: Json) => (m.configuration.training.brakeEnabled = true), /manifest\.configuration\.training\.brakeEnabled must not be set/],
    ['brakeEnabled false in the shared training configuration', (m: Json) => (m.configuration.training.brakeEnabled = false), /brakeEnabled must not be set/],
    ['A4 given the brake', (m: Json) => (m.brake = { A4: true, A5: true }), /manifest\.brake/],
    ['A5 given no brake', (m: Json) => (m.brake = { A4: false, A5: false }), /manifest\.brake/],
    ['the agents swapped', (m: Json) => (m.agents = ['A5', 'A4']), /manifest\.agents/],
    ['another agent set', (m: Json) => (m.agents = ['A4', 'A5', 'A8']), /manifest\.agents/],
    ['a missing brake block', (m: Json) => delete m.brake, /incomplete: manifest\.brake/],
    ['an unknown field', (m: Json) => (m.extra = 1), /unknown field "extra"/],
    ['an unknown training field', (m: Json) => (m.configuration.training.extra = 1), /unknown field "extra"/],
    ['the wrong format', (m: Json) => (m.format = 'self-driving-ai-evolution/p2-08-manifest'), /manifest\.format/],
    ['a delta other than 0.25', (m: Json) => (m.analysis.delta = 0.3), /exactly 0\.25/],
    ['a delta below 0.25', (m: Json) => (m.analysis.delta = 0.2), /exactly 0\.25/],
    ['another bootstrap seed', (m: Json) => (m.analysis.bootstrap.seed = 1), /manifest\.analysis\.bootstrap/],
    ['another brake-usage threshold', (m: Json) => (m.analysis.brakeUsageThreshold = 0.5), /brakeUsageThreshold/],
    ['another decision rule', (m: Json) => (m.analysis.decisionRule = 'p2-08-decision-v1'), /decisionRule/],
    ['no elites', (m: Json) => (m.configuration.training.eliteCount = 0), /eliteCount must be at least 1/],
    ['an invalid training setting', (m: Json) => (m.configuration.training.maxEpisodeSeconds = 'x'), /manifest\.configuration\.training is invalid/],
    ['an E4 seed in a mechanics manifest', (m: Json) => (m.seeds = [7401, 2003]), /reserved seed/],
    ['a P2-08 confirmatory seed in a mechanics manifest', (m: Json) => (m.seeds = [1005]), /reserved seed/],
    ['a pilot seed in a mechanics manifest', (m: Json) => (m.seeds = [9001]), /reserved seed/],
    ['duplicate seeds', (m: Json) => (m.seeds = [7401, 7401]), /distinct/],
    ['no seeds', (m: Json) => (m.seeds = []), /non-empty/],
    ['an unknown label', (m: Json) => (m.label = 'pilot'), /manifest\.label/],
    ['a malformed code revision', (m: Json) => (m.code.revision = 'abc'), /40-character/],
  ])('rejects %s', (_label, change, message) => {
    expect(() => parseE4Manifest(withManifest(change))).toThrow(StudyManifestError);
    expect(() => parseE4Manifest(withManifest(change))).toThrow(message);
  });

  it('refuses a held-out track as the training or validation track (TrackLeakageError)', () => {
    expect(() => parseE4Manifest(withManifest((m) => (m.tracks.training.id = 'hairpin-chicane')))).toThrow(TrackLeakageError);
    expect(() => parseE4Manifest(withManifest((m) => (m.tracks.validation.id = 'hairpin-chicane')))).toThrow(TrackLeakageError);
    expect(() => parseE4Manifest(withManifest((m) => (m.tracks.validation.id = 'stadium-oval')))).toThrow(TrackLeakageError);
  });

  describe('a confirmatory manifest (parse only: it is never run here)', () => {
    const confirmatory = (change: (m: Json) => void = () => {}): Json => {
      const m = withManifest((x) => {
        x.id = 'p2-09-e4-fixture';
        x.label = 'confirmatory';
        x.seeds = [...E4_SEEDS];
        x.configuration = { generations: 100, training: c1Training() };
        x.code = { revision: 'a'.repeat(40) };
      });
      change(m);
      return m;
    };

    it('accepts exactly 2001–2010 in order, C1, 100 generations, the oval and the rounded rectangle', () => {
      expect(() => parseE4Manifest(confirmatory())).not.toThrow();
    });

    it.each([
      ['a partial seed set', (m: Json) => (m.seeds = [2001, 2002]), /exactly 2001–2010/],
      ['shuffled seeds', (m: Json) => (m.seeds = [2002, 2001, ...E4_SEEDS.slice(2)]), /exactly 2001–2010/],
      ['an extra seed', (m: Json) => (m.seeds = [...E4_SEEDS, 2011]), /exactly 2001–2010/],
      ['the P2-08 confirmatory seeds', (m: Json) => (m.seeds = Array.from({ length: 10 }, (_, i) => 1001 + i)), /exactly 2001–2010/],
      ['another generation count', (m: Json) => (m.configuration.generations = 50), /generations 100/],
      ['a configuration other than C1', (m: Json) => (m.configuration.training = training()), /uses C1/],
      ['another training track', (m: Json) => (m.tracks = trackReferences('stadium-oval', 'rounded-rectangle')) && (m.tracks.training.id = 'rounded-rectangle'), /TrackLeakage|track/i],
      ['no frozen code revision', (m: Json) => (m.code.revision = null), /needs manifest\.code\.revision/],
    ])('rejects %s', (_label, change, message) => {
      let error: unknown;
      try {
        parseE4Manifest(confirmatory(change));
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(message);
    });
  });
});

describe('E4 agents and the paired integration test (T2)', () => {
  const config = e4AgentConfigFor(MANIFEST);
  const A4 = generateE4Agent(config, 'A4', 7401);
  const A5 = generateE4Agent(config, 'A5', 7401);

  it('starts A4 and A5 from the identical generation-0 population', () => {
    expect(A4.genomeIds[0]).toEqual(A5.genomeIds[0]);
    expect(A4.genomeIds[0]!.length).toBe(P);
  });

  it('evolves them separately: only the brake mask differs between the two configurations', () => {
    expect(A4.brakeEnabled).toBe(false);
    expect(A5.brakeEnabled).toBe(true);
    const a = e4Evaluation(config, 7401, false).setup.config;
    const b = e4Evaluation(config, 7401, true).setup.config;
    const { brakeEnabled: ba, ...restA } = a;
    const { brakeEnabled: bb, ...restB } = b;
    expect([ba, bb]).toEqual([false, true]);
    expect(restA).toEqual(restB);
  });

  it('puts the brake value in each frozen model identity, so the two models differ in provenance only by agent and brakeEnabled', () => {
    expect(A4.model.provenance).toMatchObject({ agent: 'A4', brakeEnabled: false, seed: 7401 });
    expect(A5.model.provenance).toMatchObject({ agent: 'A5', brakeEnabled: true, seed: 7401 });
    const without = (provenance: object) =>
      Object.fromEntries(Object.entries(provenance).filter(([key]) => !['agent', 'brakeEnabled', 'generation', 'index'].includes(key)));
    expect(without(A4.model.provenance)).toEqual(without(A5.model.provenance));
  });

  it('never applies the brake for A4: its brake command is 0 on every tick of both tracks', () => {
    const { evaluation } = e4Evaluation(config, 7401, false);
    for (const track of ['training', 'validation'] as const) {
      let ticks = 0;
      let maxBrake = 0;
      const inner = createFrozenModelDriver(A4.model);
      const watching: EpisodeDriver = {
        reset: () => inner.reset(),
        decide: (observation) => {
          const controls = inner.decide(observation);
          ticks += 1;
          maxBrake = Math.max(maxBrake, controls.brake);
          return controls;
        },
      };
      evaluateDriver(watching, evaluation[track]);
      expect(ticks).toBeGreaterThan(0);
      expect(maxBrake).toBe(0);
      expect(A4.brakeUsage[track]).toEqual({ ticks, brakeTicks: 0 });
    }
  });

  it('counts brake usage as the ticks whose brake command is above the threshold, and changes no control', () => {
    const { evaluation } = e4Evaluation(config, 7401, true);
    const inner = createFrozenModelDriver(A5.model);
    const seen: number[] = [];
    const recording: EpisodeDriver = { reset: () => inner.reset(), decide: (o) => { const c = inner.decide(o); seen.push(c.brake); return c; } };
    const counted = withBrakeCount(recording);
    evaluateDriver(counted.driver, evaluation.training);
    expect(counted.counts()).toEqual({ ticks: seen.length, brakeTicks: seen.filter((b) => b > BRAKE_USAGE_THRESHOLD).length });
    // The counted episode equals the uncounted one.
    expect(evaluateE4Model(A5.model, evaluation.training).episode).toEqual(A5.episodes.training);
    expect(A5.brakeUsage.training.ticks).toBe(A5.episodes.training.ticks);
  });

  it('counts a tick as braking only when the brake command is strictly above the threshold, and restarts on reset', () => {
    const brakes = [0, BRAKE_USAGE_THRESHOLD, BRAKE_USAGE_THRESHOLD + 1e-9, 0.5, 1, 0.04];
    let call = 0;
    const scripted: EpisodeDriver = {
      reset: () => {
        call = 0;
      },
      decide: () => ({ steering: 0, throttle: 0, brake: brakes[call++]! }),
    };
    const counted = withBrakeCount(scripted);
    counted.driver.reset();
    for (let i = 0; i < brakes.length; i += 1) counted.driver.decide({ car: undefined as never });
    expect(counted.counts()).toEqual({ ticks: 6, brakeTicks: 3 }); // 0.05 itself does not count; 0.05 + 1e-9, 0.5 and 1 do
    counted.driver.reset();
    expect(counted.counts()).toEqual({ ticks: 0, brakeTicks: 0 });
    expect(BRAKE_USAGE_THRESHOLD).toBe(0.05);
  });

  it('records each champion\'s training episode as its own, and the model reproduces it alone', () => {
    for (const agent of [A4, A5]) {
      const { evaluation } = e4Evaluation(config, 7401, agent.brakeEnabled);
      expect(evaluateE4Model(agent.model, evaluation.training).episode).toEqual(agent.episodes.training);
      expect(evaluateE4Model(agent.model, evaluation.validation).episode).toEqual(agent.episodes.validation);
    }
  });

  it('gives a record that parses and replays identically, A4 and A5 alike', () => {
    expect(RECORD.format).toBe('self-driving-ai-evolution/p2-09-e4-seed-record');
    expect(parseE4Record(clone(RECORD), MANIFEST, ENGINE)).toEqual(RECORD);
    const replay = replayE4Record(clone(RECORD), MANIFEST, ENGINE);
    expect(replay).toEqual({ identical: true, differences: [], modelsReplayed: { A4: true, A5: true }, sameSourceRevision: null });
    expect((RECORD.agents as Json).A4.brakeEnabled).toBe(false);
    expect((RECORD.agents as Json).A5.brakeEnabled).toBe(true);
  });

  it('is deterministic, alone or next to another seed', () => {
    const again = runE4Seed(MANIFEST, 7401, CONTEXT);
    expect(canonicalJson(again)).toBe(canonicalJson(RECORD));
    const other = runE4Seed(MANIFEST, 7402, CONTEXT);
    expect(other.resultsHash).not.toBe(RECORD.resultsHash);
    expect(canonicalJson(runE4Seed(MANIFEST, 7401, CONTEXT))).toBe(canonicalJson(RECORD));
  });

  it('refuses a configuration with no elites, an unknown agent and a held-out track', () => {
    expect(() => generateE4Agent({ ...config, training: { ...config.training, eliteCount: 0 } }, 'A4', 7401)).toThrow(RangeError);
    expect(() => generateE4Agent(config, 'A8' as never, 7401)).toThrow(/A4 and A5/);
    expect(() => generateE4Agent({ ...config, validationTrackId: 'hairpin-chicane' }, 'A4', 7401)).toThrow(TrackLeakageError);
  });
});

describe('E4 record parsing', () => {
  const reject = (record: Json, message: RegExp, error: new (...args: never[]) => Error = StudyRecordError) => {
    expect(() => parseE4Record(record, MANIFEST, ENGINE)).toThrow(error);
    expect(() => parseE4Record(record, MANIFEST, ENGINE)).toThrow(message);
  };

  describe('the per-agent brake binding and cross-agent rejection', () => {
    it('rejects an A4 model carrying brakeEnabled true, naming the path', () => {
      reject(withRecord((r) => (r.agents.A4.model.provenance.brakeEnabled = true)), /agents\.A4\.model\.provenance/);
    });
    it('rejects an A5 model carrying brakeEnabled false, naming the path', () => {
      reject(withRecord((r) => (r.agents.A5.model.provenance.brakeEnabled = false)), /agents\.A5\.model\.provenance/);
    });
    it('rejects an A4 model without brakeEnabled, and one with a non-boolean value', () => {
      reject(withRecord((r) => delete r.agents.A4.model.provenance.brakeEnabled), /agents\.A4\.model\.provenance/);
      reject(withRecord((r) => (r.agents.A5.model.provenance.brakeEnabled = 'true')), /agents\.A5\.model\.provenance/);
    });
    it('rejects a model moved into the other agent\'s slot, whichever way', () => {
      reject(withRecord((r) => ([r.agents.A4.model, r.agents.A5.model] = [r.agents.A5.model, r.agents.A4.model])), /agents\.A4\.model/);
      reject(withRecord((r) => (r.agents.A4.model = clone(r.agents.A5.model))), /agents\.A4\.model/);
      reject(withRecord((r) => (r.agents.A5.model = clone(r.agents.A4.model))), /agents\.A5\.model/);
    });
    it('rejects a model labelled as the other agent even when its brake value is right', () => {
      reject(withRecord((r) => (r.agents.A4.model.provenance.agent = 'A5')), /agents\.A4\.model\.provenance/);
    });
    it('rejects an agent block whose brakeEnabled is not its own', () => {
      reject(withRecord((r) => (r.agents.A4.brakeEnabled = true)), /agents\.A4\.brakeEnabled must be false/);
      reject(withRecord((r) => (r.agents.A5.brakeEnabled = false)), /agents\.A5\.brakeEnabled must be true/);
      reject(withRecord((r) => (r.agents.A5.brakeEnabled = 1)), /agents\.A5\.brakeEnabled/);
    });
    it('rejects an A4 that ever braked, on either track', () => {
      reject(withRecord((r) => (r.agents.A4.brakeUsage.training.brakeTicks = 1)), /agents\.A4\.brakeUsage\.training\.brakeTicks must be 0/);
      reject(withRecord((r) => (r.agents.A4.brakeUsage.validation.brakeTicks = 1)), /agents\.A4\.brakeUsage\.validation\.brakeTicks must be 0/);
    });
    it('rejects brake-usage counts that do not follow from the episode', () => {
      reject(withRecord((r) => (r.agents.A5.brakeUsage.training.ticks += 1)), /agents\.A5\.brakeUsage\.training\.ticks must be the episode's ticks/);
      reject(withRecord((r) => (r.agents.A5.brakeUsage.validation.brakeTicks = r.agents.A5.brakeUsage.validation.ticks + 1)), /brakeUsage\.validation\.brakeTicks/);
      reject(withRecord((r) => (r.agents.A5.brakeUsage.training.brakeTicks = -1)), /brakeUsage\.training\.brakeTicks/);
      reject(withRecord((r) => delete r.agents.A5.brakeUsage), /agents\.A5\.brakeUsage/);
    });
    it('rejects generation-0 populations that differ between A4 and A5', () => {
      reject(withRecord((r) => (r.agents.A4.generations[0][1].genomeId = `sha256:${'0'.repeat(64)}`)), /generation-0 population/);
    });
  });

  describe('malformed and inconsistent records', () => {
    it.each([
      ['a missing agent', (r: Json) => delete r.agents.A5, /incomplete: record\.agents\.A5/],
      ['another agent', (r: Json) => (r.agents.A8 = clone(r.agents.A5)), /unknown field "A8"/],
      ['an unknown block field', (r: Json) => (r.agents.A5.extra = 1), /unknown field "extra"/],
      ['too few generations', (r: Json) => r.agents.A5.generations.pop(), /generations must have 2 entries/],
      ['too few candidates', (r: Json) => r.agents.A4.generations[1].pop(), /must have 3 entries/],
      ['a non-final generation', (r: Json) => (r.agents.A5.generation = 0), /generation must be 1/],
      ['another selection rule', (r: Json) => (r.agents.A5.selection = 'best'), /selection/],
      ['a champion that is not the best', (r: Json) => (r.agents.A5.index = (r.agents.A5.index + 1) % P), /not the final generation's best/],
      ['a wrong candidate index', (r: Json) => (r.agents.A4.generations[0][0].index = 2), /index must be 0/],
      ['a non-finite model parameter', (r: Json) => (r.agents.A4.model.parameters[0] = null), /parameters\[0\]/],
      ['a wrong parameter count', (r: Json) => r.agents.A4.model.parameters.pop(), /parameters/],
      ['edited model parameters', (r: Json) => (r.agents.A5.model.parameters[0] += 1), /not the selected candidate's genome/],
      ['a wrong model id', (r: Json) => (r.agents.A4.model.id = `sha256:${'1'.repeat(64)}`), /id does not match/],
      ['a wrong validation tick count', (r: Json) => (r.agents.A5.validation.ticks += 1), /brakeUsage\.validation\.ticks|ticks/],
      ['an inconsistent fitness total', (r: Json) => (r.agents.A4.generations[0][0].training.fitness.total += 1), /is not the score of this episode/],
      ['an inconsistent ordered progress', (r: Json) => (r.agents.A5.validation.orderedProgress += 0.5), /orderedProgress/],
      ['an edited budget', (r: Json) => (r.budgets.actual.evaluations.A4 += 1), /record\.budgets/],
      ['an edited tick total', (r: Json) => (r.budgets.ticks.A5.training += 1), /record\.budgets/],
      ['an edited diversity count', (r: Json) => (r.budgets.diversity.A4.actualDistinctGenomes += 1), /record\.budgets/],
      ['held-out evaluation claimed', (r: Json) => (r.evaluations.heldOut = 'run'), /record\.evaluations/],
      ['another format', (r: Json) => (r.format = 'self-driving-ai-evolution/p2-08-seed-record'), /record\.format/],
      ['a seed outside the manifest', (r: Json) => (r.seed = 7499), /not one of the manifest's seeds/],
      ['a bad recordedAt', (r: Json) => (r.recordedAt = 'yesterday'), /recordedAt/],
      ['a sparse array', (r: Json) => delete r.agents.A4.generations[0][0], /missing|must be an object|incomplete/],
    ])('rejects %s', (_label, change, message) => {
      reject(withRecord(change), message);
    });

    it('rejects a stale resultsHash (the results were edited)', () => {
      reject({ ...clone(RECORD), resultsHash: `sha256:${'2'.repeat(64)}` }, /resultsHash does not match/);
    });
  });

  describe('compatibility', () => {
    it('is incompatible with another manifest, engine or contracts', () => {
      const other = withManifest((m) => (m.description = 'another manifest')) as E4Manifest;
      expect(() => parseE4Record(clone(RECORD), other, ENGINE)).toThrow(StudyCompatibilityError);
      expect(() => parseE4Record(clone(RECORD), MANIFEST, { ...ENGINE, version: 'v0.0.0' })).toThrow(StudyCompatibilityError);
      expect(() => parseE4Record(clone(RECORD), MANIFEST, { ...ENGINE, v8: '0.0' })).toThrow(/differs from this engine/);
      expect(() => parseE4Record(withRecord((r) => (r.contracts.randomAction = 'other')), MANIFEST, ENGINE)).toThrow(StudyCompatibilityError);
    });
  });
});

describe('E4 replay', () => {
  it('parses a consistent, rescored edit to a champion\'s result (parsing is structural) and replay reports it as a difference', () => {
    const edited = withRecord((r) => {
      const e = r.agents.A5.generations[1][r.agents.A5.index].training;
      e.gatesPassed += 1;
      e.orderedProgress = e.gatesPassed / 20;
      rescore(e);
    });
    expect(() => parseE4Record(edited, MANIFEST, ENGINE)).not.toThrow();
    const replay = replayE4Record(edited, MANIFEST, ENGINE);
    expect(replay.identical).toBe(false);
    expect(replay.differences.length).toBeGreaterThan(0);
    expect(replay.modelsReplayed.A5).toBe(false); // the frozen model, driven alone, no longer reproduces the edited episode
  });

  it('reports a consistent edit as a difference, not as identical', () => {
    const edited = withRecord((r) => {
      const block = r.agents.A5;
      const e = block.generations[0][0].training; // not the champion: the record stays internally consistent
      e.outcome = e.outcome === 'stalled' ? 'timeout' : 'stalled';
    });
    const replay = replayE4Record(edited, MANIFEST, ENGINE);
    expect(replay.identical).toBe(false);
    expect(replay.differences.some((d) => d.startsWith('agents.A5.generations[0][0].training.outcome'))).toBe(true);
  });

  it('reports each frozen model replaying alone with its own brake value', () => {
    const replay = replayE4Record(clone(RECORD), MANIFEST, ENGINE, { revision: 'b'.repeat(40), dirty: false, unavailableReason: null, appVersion: '0.0.0' });
    expect(replay.modelsReplayed).toEqual({ A4: true, A5: true });
    expect(replay.sameSourceRevision).toBeNull(); // the fixture's record has no revision
  });
});

describe('running a seed', () => {
  it('refuses a seed the manifest does not list and a bad context', () => {
    expect(() => runE4Seed(MANIFEST, 7499, CONTEXT)).toThrow(StudyManifestError);
    expect(() => runE4Seed(MANIFEST, 2001, CONTEXT)).toThrow(/not one of the manifest's seeds/);
    expect(() => runE4Seed(MANIFEST, 7401, { ...CONTEXT, recordedAt: 'now' })).toThrow(StudyRecordError);
    expect(() => runE4Seed(withManifest((m) => (m.brake = { A4: true, A5: true })), 7401, CONTEXT)).toThrow(StudyManifestError);
  });
});
