// The committed P2-08 confirmatory manifest (plan step 5, docs/experiments/p2-08-confirmatory-protocol.md). It is
// rebuilt here from the trainer's own resolvers and from the pilot's chosen candidate (C1), and must match exactly.
// Parsing only: no seed is run, so no confirmatory seed is ever executed by the tests.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { acceptanceEligibility } from '../../src/training/analysis';
import { resolveBaselineConfig } from '../../src/training/baselines';
import {
  AGENT_ORDER,
  BOOTSTRAP,
  CONFIRMATORY_SEED_SETS,
  currentStreams,
  DECISION_RULE,
  manifestHash,
  METRIC,
  parseStudyManifest,
  STUDY_MANIFEST_FORMAT,
  trackReferences,
  WILCOXON,
} from '../../src/training/study';

const ROOT = join(__dirname, '../..');
const FROZEN_REVISION = 'c14f36862c72463bd8eee5371d2a4ad7dad2adba';
const load = (name: string) => JSON.parse(readFileSync(join(ROOT, `experiments/manifests/${name}.json`), 'utf8')) as Record<string, unknown>;

const expected = () => {
  const { setup } = resolveBaselineConfig({ training: {}, generations: 100, trackId: 'stadium-oval' }, 0);
  const training = Object.fromEntries(Object.entries(setup.config).filter(([key]) => key !== 'seed'));
  return {
    format: STUDY_MANIFEST_FORMAT,
    version: 1,
    id: 'p2-08-confirmatory',
    label: 'confirmatory',
    description:
      'P2-08 confirmatory study (plan step 5, §6 and §8): configuration C1 (the trainer defaults with G = 100), chosen by the exploratory pilot (#108). Preregistered: reviewed and approved before any confirmatory seed runs; nothing in it changes afterwards.',
    agents: [...AGENT_ORDER],
    seeds: [1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009, 1010],
    configuration: { generations: 100, episodesPerTrack: setup.config.populationSize, holdTicks: 30, training },
    streams: currentStreams(),
    tracks: trackReferences('stadium-oval', 'rounded-rectangle', 1),
    metric: METRIC,
    analysis: { delta: 0.25, bootstrap: { ...BOOTSTRAP }, wilcoxon: WILCOXON, decisionRule: DECISION_RULE },
    code: { revision: FROZEN_REVISION },
  };
};

describe('P2-08 confirmatory manifest', () => {
  it('is exactly the preregistered study and a valid, acceptance-eligible confirmatory manifest', () => {
    const manifest = load('p2-08-confirmatory');
    expect(manifest).toEqual(expected());
    const parsed = parseStudyManifest(manifest);
    expect(parsed).toEqual(manifest);
    expect(acceptanceEligibility(parsed, parsed.seeds)).toEqual({ eligible: true, reason: null });
    expect(manifestHash(parsed)).toBe('sha256:4ace8cf8c14b828d51953fc61cd2ec0b48a0a880fa439cf8cc006915bbd3ccc0');
  });

  it('applies the pilot decisions: C1, n = 10 (seeds 1001–1010), δ = 0.25, E = P = 50, hold 30, the frozen commit', () => {
    const m = load('p2-08-confirmatory') as { seeds: number[]; configuration: { generations: number; episodesPerTrack: number; holdTicks: number; training: { populationSize: number } }; analysis: { delta: number }; code: { revision: string } };
    expect(m.seeds).toEqual([...CONFIRMATORY_SEED_SETS[0]!]);
    expect(m.seeds.some((s) => s >= 9001 && s <= 9003)).toBe(false);
    expect(m.configuration.generations).toBe(100);
    expect(m.configuration.episodesPerTrack).toBe(50);
    expect(m.configuration.training.populationSize).toBe(50);
    expect(m.configuration.holdTicks).toBe(30);
    expect(m.analysis.delta).toBe(0.25);
    expect(m.code.revision).toBe(FROZEN_REVISION);
  });

  it('differs from the pilot candidate C1 only in id, label, description and seeds', () => {
    const strip = (m: Record<string, unknown>) => ({ ...m, id: null, label: null, description: null, seeds: null });
    expect(strip(load('p2-08-confirmatory'))).toEqual(strip(load('p2-08-pilot-c1')));
  });
});
