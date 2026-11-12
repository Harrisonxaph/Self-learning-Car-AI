// The committed P2-08 pilot manifests (plan step 4, docs/experiments/p2-08-pilot-protocol.md). Each is rebuilt here
// from the trainer's own resolvers and must match exactly. Parsing only: no seed is run, so no reserved seed is
// ever executed by the tests.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveBaselineConfig } from '../../src/training/baselines';
import {
  AGENT_ORDER,
  BOOTSTRAP,
  currentStreams,
  DECISION_RULE,
  METRIC,
  parseStudyManifest,
  PILOT_SEEDS,
  STUDY_MANIFEST_FORMAT,
  trackReferences,
  WILCOXON,
} from '../../src/training/study';

const ROOT = join(__dirname, '../..');
const FROZEN_REVISION = 'c14f36862c72463bd8eee5371d2a4ad7dad2adba';
const CANDIDATES = [
  { id: 'c0', generations: 50, training: {}, text: 'C0: the trainer defaults with G = 50.' },
  { id: 'c1', generations: 100, training: {}, text: 'C1: the trainer defaults with G = 100.' },
  { id: 'c2', generations: 50, training: { mutation: { rate: 0.1, scale: 0.5 } }, text: 'C2: the trainer defaults with mutation scale 0.5 and G = 50.' },
] as const;
const load = (id: string) => JSON.parse(readFileSync(join(ROOT, `experiments/manifests/p2-08-pilot-${id}.json`), 'utf8')) as Record<string, unknown>;

const expected = (c: (typeof CANDIDATES)[number]) => {
  const { setup } = resolveBaselineConfig({ training: c.training, generations: c.generations, trackId: 'stadium-oval' }, 0);
  const training = Object.fromEntries(Object.entries(setup.config).filter(([key]) => key !== 'seed'));
  return {
    format: STUDY_MANIFEST_FORMAT,
    version: 1,
    id: `p2-08-pilot-${c.id}`,
    label: 'pilot',
    description: `P2-08 exploratory pilot (plan step 4, §8), candidate ${c.text} Never counted towards acceptance.`,
    agents: [...AGENT_ORDER],
    seeds: [...PILOT_SEEDS],
    configuration: { generations: c.generations, episodesPerTrack: setup.config.populationSize, holdTicks: 30, training },
    streams: currentStreams(),
    tracks: trackReferences('stadium-oval', 'rounded-rectangle', 1),
    metric: METRIC,
    analysis: { delta: 0.25, bootstrap: { ...BOOTSTRAP }, wilcoxon: WILCOXON, decisionRule: DECISION_RULE },
    code: { revision: FROZEN_REVISION },
  };
};

describe('P2-08 pilot manifests', () => {
  it.each(CANDIDATES)('$id is exactly the predeclared candidate and a valid pilot manifest', (c) => {
    const manifest = load(c.id);
    expect(manifest).toEqual(expected(c));
    expect(parseStudyManifest(manifest)).toEqual(manifest);
  });

  it('uses the pilot seeds only, E = P = 50, hold 30, δ = 0.25 and one frozen commit', () => {
    for (const c of CANDIDATES) {
      const m = load(c.id) as { seeds: number[]; configuration: { episodesPerTrack: number; holdTicks: number; training: { populationSize: number } }; analysis: { delta: number }; code: { revision: string } };
      expect(m.seeds).toEqual([9001, 9002, 9003]);
      expect(m.seeds.some((s) => s >= 1001 && s <= 1020)).toBe(false);
      expect(m.configuration.episodesPerTrack).toBe(50);
      expect(m.configuration.training.populationSize).toBe(50);
      expect(m.configuration.holdTicks).toBe(30);
      expect(m.analysis.delta).toBe(0.25);
      expect(m.code.revision).toBe(FROZEN_REVISION);
    }
  });

  it('differs between candidates only where the plan says', () => {
    const strip = (m: Record<string, unknown>) => ({ ...m, id: null, description: null });
    const [c0, c1, c2] = CANDIDATES.map((c) => strip(load(c.id)) as Record<string, any>); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect({ ...c1, configuration: { ...c1!.configuration, generations: 50 } }).toEqual(c0);
    expect(c2!.configuration.training.mutation).toEqual({ rate: 0.1, scale: 0.5 });
    expect({ ...c2, configuration: { ...c2!.configuration, training: { ...c2!.configuration.training, mutation: c0!.configuration.training.mutation } } }).toEqual(c0);
  });
});
