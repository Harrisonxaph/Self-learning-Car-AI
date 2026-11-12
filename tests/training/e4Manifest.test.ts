// The committed P2-09 E4 manifest (plan step 6, docs/experiments/p2-09-e4-protocol.md). It is rebuilt here from the
// trainer's own resolvers and from the P2-08 confirmatory manifest's configuration (C1), and must match exactly.
// Parsing and synthetic analysis only: no E4 seed (2001–2010) is ever run, and nothing here invokes `npm run e4 -- run`
// on the real manifest (that command would run the study if it were started in the frozen worktree). Nothing here is
// a study result or evidence of learning.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyseE4Summaries, e4OutcomeWording, E4_OUTCOME_IDS, type E4SeedSummary } from '../../src/training/e4Analysis';
import { BRAKE_USAGE_THRESHOLD, E4_AGENTS, E4_BRAKE } from '../../src/training/e4Agents';
import {
  c1Training,
  E4_BOOTSTRAP,
  E4_CONFIRMATORY_GENERATIONS,
  E4_DECISION_RULE,
  E4_DELTA,
  E4_MANIFEST_FORMAT,
  E4_TRAINING_TRACK,
  E4_VALIDATION_TRACK,
  e4ManifestHash,
  parseE4Manifest,
} from '../../src/training/e4Study';
import { resolveBaselineConfig } from '../../src/training/baselines';
import { currentStreams, E4_SEEDS, METRIC, PILOT_SEEDS, StudyManifestError, trackReferences, WILCOXON } from '../../src/training/study';
import { TrackLeakageError } from '../../src/training/trackSplits';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ROOT = join(__dirname, '../..');
const FROZEN_REVISION = '309606550957c01e9e199f7a06f676d62210add3';
const MANIFEST_HASH = 'sha256:6abd4cb7d43661998169b43aad3f0632568fc3ab84d82358e8d5b6973ec950b0';
const FILE_SHA256 = '6b26131552cd22c46dafd9feb21cc81e8162fe4cbcd1b9e1b0dfdacba2e5d698';
const MANIFEST_PATH = join(ROOT, 'experiments/manifests/p2-09-e4.json');
const text = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const load = (): Json => JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Json;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const withManifest = (change: (m: Json) => void): Json => {
  const m = clone(load());
  change(m);
  return m;
};

const expected = (): Json => {
  // C1 is the trainer defaults with G = 100; the brake mask is not part of the shared configuration.
  const { setup } = resolveBaselineConfig({ training: {}, generations: 100, trackId: 'stadium-oval' }, 0);
  const training = Object.fromEntries(Object.entries(setup.config).filter(([key]) => key !== 'seed' && key !== 'brakeEnabled'));
  return {
    format: E4_MANIFEST_FORMAT,
    version: 1,
    id: 'p2-09-e4',
    label: 'confirmatory',
    description:
      'P2-09 E4 study (plan §5, §6 and §8 step 6): paired A4 (brake masked) against A5 (brake on), configuration C1 (the trainer defaults with G = 100), seeds 2001–2010. Preregistered: reviewed and approved before any E4 seed runs; nothing in it changes afterwards.',
    agents: ['A4', 'A5'],
    brake: { A4: false, A5: true },
    seeds: [2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010],
    configuration: { generations: 100, training },
    streams: currentStreams(),
    tracks: trackReferences('stadium-oval', 'rounded-rectangle', 1),
    metric: METRIC,
    analysis: { delta: 0.25, bootstrap: { resamples: 10_000, seed: 20261103, level: 0.95, method: 'percentile-nearest-rank-v1' }, wilcoxon: WILCOXON, decisionRule: 'p2-09-e4-decision-v1', brakeUsageThreshold: 0.05 },
    code: { revision: FROZEN_REVISION },
  };
};

describe('the committed E4 manifest', () => {
  it('is exactly the preregistered study and a valid confirmatory manifest', () => {
    const manifest = load();
    expect(manifest).toEqual(expected());
    expect(parseE4Manifest(manifest)).toEqual(manifest);
    expect(e4ManifestHash(parseE4Manifest(manifest))).toBe(MANIFEST_HASH);
  });

  it('is byte-for-byte the file whose SHA-256 the protocol records', () => {
    expect(createHash('sha256').update(readFileSync(MANIFEST_PATH)).digest('hex')).toBe(FILE_SHA256);
    expect(readFileSync(MANIFEST_PATH, 'utf8').endsWith('\n')).toBe(true);
  });

  it('applies the plan: C1, n = 10 seeds 2001–2010 in order, δ = 0.25, the oval and the rounded rectangle, the frozen commit', () => {
    const m = load();
    expect(m.label).toBe('confirmatory');
    expect(m.seeds).toEqual([...E4_SEEDS]);
    expect(m.seeds).toHaveLength(10);
    expect(m.configuration.generations).toBe(E4_CONFIRMATORY_GENERATIONS);
    expect(m.configuration.training.populationSize).toBe(50);
    expect(m.configuration.training.eliteCount).toBe(2);
    expect(m.configuration.training).toEqual(c1Training());
    expect(m.tracks.training.id).toBe(E4_TRAINING_TRACK);
    expect(m.tracks.validation.id).toBe(E4_VALIDATION_TRACK);
    expect(m.analysis.delta).toBe(E4_DELTA);
    expect(m.analysis.bootstrap).toEqual(E4_BOOTSTRAP);
    expect(m.analysis.bootstrap.seed).toBe(20261103);
    expect(m.analysis.decisionRule).toBe(E4_DECISION_RULE);
    expect(m.analysis.brakeUsageThreshold).toBe(BRAKE_USAGE_THRESHOLD);
    expect(m.code.revision).toBe(FROZEN_REVISION);
    expect(m.code.revision).toMatch(/^[0-9a-f]{40}$/);
  });

  it('is the same C1 configuration as the P2-08 confirmatory manifest, without the brake mask', () => {
    const p208 = JSON.parse(text('experiments/manifests/p2-08-confirmatory.json')) as Json;
    const { brakeEnabled, ...c1 } = p208.configuration.training;
    expect(brakeEnabled).toBe(true);
    expect(load().configuration.training).toEqual(c1);
    expect(load().configuration.generations).toBe(p208.configuration.generations);
  });

  it('uses seeds disjoint from every other reserved set', () => {
    const p208 = JSON.parse(text('experiments/manifests/p2-08-confirmatory.json')) as Json;
    for (const seed of load().seeds as number[]) {
      expect(p208.seeds).not.toContain(seed);
      expect(PILOT_SEEDS).not.toContain(seed);
      expect(seed >= 1001 && seed <= 1020).toBe(false);
    }
  });
});

describe('separate evolution, fixed brake masks and equal search budgets', () => {
  const m = load();

  it('fixes A4 to no brake and A5 to the brake, and keeps the mask out of the shared configuration', () => {
    expect(m.agents).toEqual([...E4_AGENTS]);
    expect(m.brake).toEqual({ A4: false, A5: true });
    expect(m.brake).toEqual(E4_BRAKE);
    expect('brakeEnabled' in m.configuration.training).toBe(false);
    expect(JSON.stringify(m)).not.toContain('brakeEnabled');
  });

  it('gives both agents the identical configuration but for the mask, and the same P × G search budget', () => {
    const resolve = (brakeEnabled: boolean) =>
      resolveBaselineConfig({ training: { ...m.configuration.training, brakeEnabled }, generations: m.configuration.generations, trackId: m.tracks.training.id }, 2001).setup.config;
    const { brakeEnabled: a4, ...rest4 } = resolve(E4_BRAKE.A4);
    const { brakeEnabled: a5, ...rest5 } = resolve(E4_BRAKE.A5);
    expect([a4, a5]).toEqual([false, true]);
    expect(rest4).toEqual(rest5);
    expect(rest4.populationSize * m.configuration.generations).toBe(5000);
    // The elites are re-evaluated inside the P × G budget, the same for both agents.
    expect(rest4.eliteCount * (m.configuration.generations - 1)).toBe(198);
  });
});

describe('training and validation are kept apart; no held-out track', () => {
  it('names a training and a validation track by split, and never the held-out track', () => {
    const raw = readFileSync(MANIFEST_PATH, 'utf8');
    expect(raw).not.toContain('hairpin-chicane');
    expect(load().tracks).toEqual(trackReferences('stadium-oval', 'rounded-rectangle', 1));
  });

  it.each([
    ['the held-out track as the training track', (m: Json) => (m.tracks.training.id = 'hairpin-chicane')],
    ['the held-out track as the validation track', (m: Json) => (m.tracks.validation.id = 'hairpin-chicane')],
    ['the validation track as the training track', (m: Json) => (m.tracks.training.id = 'rounded-rectangle')],
    ['the training track as the validation track', (m: Json) => (m.tracks.validation.id = 'stadium-oval')],
  ])('refuses %s', (_label, change) => {
    expect(() => parseE4Manifest(withManifest(change))).toThrow(TrackLeakageError);
  });
});

describe('the manifest is frozen: any change to it is refused or changes its hash', () => {
  it.each([
    ['another seed set', (m: Json) => (m.seeds = [2001, 2002, 2003]), /exactly 2001–2010/],
    ['the seeds shuffled', (m: Json) => (m.seeds = [2002, 2001, ...m.seeds.slice(2)]), /exactly 2001–2010/],
    ['an eleventh seed', (m: Json) => m.seeds.push(2011), /exactly 2001–2010/],
    ['the P2-08 confirmatory seeds', (m: Json) => (m.seeds = Array.from({ length: 10 }, (_, i) => 1001 + i)), /exactly 2001–2010/],
    ['another generation count', (m: Json) => (m.configuration.generations = 50), /generations 100/],
    ['another population size', (m: Json) => (m.configuration.training.populationSize = 40), /uses C1/],
    ['the brake mask in the shared configuration', (m: Json) => (m.configuration.training.brakeEnabled = true), /brakeEnabled must not be set/],
    ['A4 given the brake', (m: Json) => (m.brake.A4 = true), /manifest\.brake/],
    ['A5 denied the brake', (m: Json) => (m.brake.A5 = false), /manifest\.brake/],
    ['another meaningful threshold', (m: Json) => (m.analysis.delta = 0.3), /exactly 0\.25/],
    ['another bootstrap seed', (m: Json) => (m.analysis.bootstrap.seed = 20261028), /manifest\.analysis\.bootstrap/],
    ['another decision rule', (m: Json) => (m.analysis.decisionRule = 'p2-08-decision-v1'), /decisionRule/],
    ['another brake-usage threshold', (m: Json) => (m.analysis.brakeUsageThreshold = 0.1), /brakeUsageThreshold/],
    ['no frozen commit', (m: Json) => (m.code.revision = null), /needs manifest\.code\.revision/],
    ['a malformed commit', (m: Json) => (m.code.revision = 'c14f368'), /40-character/],
    ['an unknown field', (m: Json) => (m.extra = true), /unknown field "extra"/],
    ['a missing field', (m: Json) => delete m.analysis, /incomplete: manifest\.analysis/],
  ])('refuses %s', (_label, change, message) => {
    expect(() => parseE4Manifest(withManifest(change))).toThrow(StudyManifestError);
    expect(() => parseE4Manifest(withManifest(change))).toThrow(message);
  });

  it('is not a mechanics manifest: a mechanics manifest may not take the E4 seeds', () => {
    expect(() => parseE4Manifest(withManifest((m) => ((m.label = 'mechanics'), (m.code.revision = null))))).toThrow(/reserved seed/);
  });

  it('changes its hash with any edit, including the description', () => {
    expect(e4ManifestHash(withManifest((m) => (m.description = 'another')) as never)).not.toBe(MANIFEST_HASH);
    expect(e4ManifestHash(withManifest((m) => (m.code.revision = 'f'.repeat(40))) as never)).not.toBe(MANIFEST_HASH);
  });
});

describe('the preregistered outcome wording, applied to synthetic summaries (no seed is run)', () => {
  const manifest = load();
  const episode = (gatesPassed: number) => ({ outcome: 'timeout' as const, gatesPassed, crashed: false, lapTicks: [] as number[], fitness: gatesPassed });
  const summaries = (diff: number): E4SeedSummary[] =>
    (manifest.seeds as number[]).map((seed) => ({
      seed,
      gates: { training: 20, validation: 14 },
      episodes: { A4: { training: episode(10), validation: episode(10) }, A5: { training: episode(10 + diff), validation: episode(10 + diff) } },
      brakeUsage: { A4: { training: { ticks: 10, brakeTicks: 0 }, validation: { ticks: 10, brakeTicks: 0 } }, A5: { training: { ticks: 10, brakeTicks: 2 }, validation: { ticks: 10, brakeTicks: 2 } } },
    }));
  const outcome = (diff: number) => (analyseE4Summaries(manifest, summaries(diff)) as Json).outcome as Json;

  it('is reportable for this manifest, and each of the four labels carries the plan\'s words', () => {
    expect(outcome(5)).toMatchObject({ label: E4_OUTCOME_IDS.a5Meaningful, wording: 'A5 (braking) reached meaningfully more training-track progress than A4', delta: 0.25 });
    expect(outcome(-5)).toMatchObject({ label: E4_OUTCOME_IDS.a4Meaningful, wording: 'A4 (no braking) reached meaningfully more training-track progress than A5' });
    expect(outcome(4)).toMatchObject({ label: E4_OUTCOME_IDS.belowThreshold, direction: 'A5', wording: 'A5 reached more training-track progress than A4, but the difference is below the predeclared 0.25-lap meaningful threshold' });
    expect(outcome(-4)).toMatchObject({ label: E4_OUTCOME_IDS.belowThreshold, direction: 'A4', wording: 'A4 reached more training-track progress than A5, but the difference is below the predeclared 0.25-lap meaningful threshold' });
    expect(outcome(0)).toMatchObject({ label: E4_OUTCOME_IDS.noDirection, wording: 'no direction established: the interval spans zero' });
    expect((analyseE4Summaries(manifest, summaries(5)) as Json).reportable).toBe(true);
  });
});

describe('the protocol records what the manifest and the code fix', () => {
  const protocol = text('docs/experiments/p2-09-e4-protocol.md');
  const feasibility = text('experiments/results/p2-09/feasibility/feasibility.md');

  it('names the frozen commit, the engine, the hashes, the storage format and the stop rules', () => {
    for (const fact of [
      FROZEN_REVISION,
      'Node v24.22.1',
      MANIFEST_HASH,
      FILE_SHA256,
      '`gzip -9 -n`',
      'SHA-256 of each **uncompressed** record',
      'Nothing restarts automatically',
      'written go-ahead',
      'No seed is substituted, skipped or re-run with changed settings',
      'any infrastructure interruption',
      '**No E4 seed (2001–2010) has been run.**',
    ]) expect(protocol).toContain(fact);
  });

  it('names one engine everywhere it names one, and one frozen commit', () => {
    expect([...new Set(protocol.match(/Node v\d+\.\d+\.\d+/g))]).toEqual(['Node v24.22.1']);
    expect([...new Set(protocol.match(/\b[0-9a-f]{40}\b/g))]).toEqual([FROZEN_REVISION]);
  });

  it('records the preregistered numbers', () => {
    for (const fact of ['seeds 2001–2010', '**P × G = 5,000 evaluations for each of A4 and A5 per seed**', '**20261103**', '**0.25 lap**', 'above **0.05**', '`p2-09-e4-decision-v1`', '**A4 `false`, A5 `true`**', 'one per agent per seed (20 in all)']) {
      expect(protocol).toContain(fact);
    }
  });

  it('states the four outcome labels in exactly the words the analysis reports', () => {
    for (const wording of [
      e4OutcomeWording(E4_OUTCOME_IDS.a5Meaningful, null),
      e4OutcomeWording(E4_OUTCOME_IDS.a4Meaningful, null),
      e4OutcomeWording(E4_OUTCOME_IDS.belowThreshold, 'A5'),
      e4OutcomeWording(E4_OUTCOME_IDS.noDirection, null),
    ]) expect(protocol).toContain(wording);
    expect(protocol).toContain('Neither of the last two rows means "no effect" or "equivalent"');
  });

  it('carries the training-track feasibility limitation forward, with the numbers of the committed feasibility record', () => {
    // The record says: oval -0.117 s against a 0.515 s margin (not shown); rounded rectangle +2.217 s against 0.537 s.
    for (const number of ['-0.117', '0.515', '2.217', '0.537']) {
      expect(feasibility).toContain(number);
      expect(protocol.replace(/−/g, '-')).toContain(number);
    }
    expect(feasibility).toContain('Braking on this track: **not shown**');
    for (const fact of ['A2 was met **on the validation track only**', 'A null or below-threshold E4 result on the oval is a plausible outcome', 'No track, physics or condition is changed because of a result', 'the check covers one hand-written driver family on a finite grid']) {
      expect(protocol).toContain(fact);
    }
  });

  it('keeps the held-out track out of scope, and the validation track descriptive', () => {
    expect(protocol).toContain('The held-out track (`hairpin-chicane`) is never evaluated');
    expect(protocol).toContain('Validation results never decide anything');
    expect(protocol).toContain('any held-out or generalisation claim');
  });

  it('presents itself as a preregistration written before any E4 seed runs, and the E4 step stays owner-gated', () => {
    expect(protocol).toContain('Status: **preregistration, written before any E4 seed runs.**');
    expect(protocol).toContain('needs the owner\'s separate authorisation and approval of the reviewed manifest');
  });
});
