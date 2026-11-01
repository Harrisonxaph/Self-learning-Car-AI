// The executed car-tick total printed by `npm run study -- run` (C2, Codex review of ad8f667 on #102). The shared
// per-tick step (src/training/episodeStep.ts) is wrapped to count every tick actually simulated while the same seed
// runs in-process; the command line, run as its own process, must print exactly that number. Reused episodes (A2's
// training is A5's generation 0, A9's is one of them) must not be counted twice. Mechanics seed 7311 only.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';

const steps = { executed: 0 };
vi.mock('../../src/training/episodeStep', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/training/episodeStep')>();
  return {
    ...original,
    stepEpisode: (...args: Parameters<typeof original.stepEpisode>) => {
      if (args[0].episode.outcome === null) steps.executed += 1; // a finished episode is returned unchanged
      return original.stepEpisode(...args);
    },
  };
});

const { resolveBaselineConfig } = await import('../../src/training/baselines');
const study = await import('../../src/training/study');

const ROOT = join(__dirname, '../..');
const DIR = mkdtempSync(join(tmpdir(), 'study-ticks-'));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const { setup } = resolveBaselineConfig({ training: { populationSize: 3, eliteCount: 1, maxEpisodeSeconds: 2, stallSeconds: 1 }, generations: 2, trackId: 'stadium-oval' }, 0);
const MANIFEST = {
  format: study.STUDY_MANIFEST_FORMAT,
  version: 1,
  id: 'mechanics-c2-ticks',
  label: 'mechanics',
  description: 'Tiny mechanics fixture for the executed-tick total.',
  agents: [...study.AGENT_ORDER],
  seeds: [7311],
  configuration: { generations: 2, episodesPerTrack: 2, holdTicks: 30, training: Object.fromEntries(Object.entries(setup.config).filter(([key]) => key !== 'seed')) },
  streams: study.currentStreams(),
  tracks: study.trackReferences('stadium-oval', 'rounded-rectangle'),
  metric: study.METRIC,
  analysis: { delta: 0.25, bootstrap: { ...study.BOOTSTRAP }, wilcoxon: study.WILCOXON, decisionRule: study.DECISION_RULE },
  code: { revision: null },
};

it('prints the car-ticks actually simulated, counting reused A2 and A9 training episodes once', () => {
  const context = { engine: { name: 'node', version: process.version, v8: process.versions.v8 }, source: { revision: null, dirty: null, unavailableReason: 'test', appVersion: '0.0.0' }, recordedAt: '2026-11-01T22:30:00.000Z' };
  steps.executed = 0;
  const record = study.runStudySeed(MANIFEST, 7311, context);
  const ticks = record.budgets.ticks as Record<string, { training: number; validation: number }>;
  const attributed = Object.values(ticks).reduce((n, t) => n + t.training + t.validation, 0);
  expect(steps.executed).toBe(attributed - ticks.A2!.training - ticks.A9!.training);
  expect(steps.executed).toBeLessThan(attributed);

  const manifest = join(DIR, 'manifest.json');
  writeFileSync(manifest, JSON.stringify(MANIFEST));
  const run = spawnSync(process.execPath, ['scripts/study.mjs', 'run', manifest, '--seed', '7311', '--out', join(DIR, 'record.json')], { cwd: ROOT, encoding: 'utf8' });
  expect(run.status).toBe(0);
  expect(run.stdout).toContain(`; ${steps.executed} car-ticks simulated (A2 and A9 training reused from A5's generation 0).`);
});
