// Fake dashboard outputs for tests in plain Node: each output is a text target that counts how often it is written.
import type { DashboardOutputs, TextTarget } from '../../src/ui/trainingDashboard';

export interface FakeDashboard {
  readonly outputs: DashboardOutputs;
  /** How many times each output's text was assigned. */
  readonly writes: Record<keyof DashboardOutputs, number>;
  /** The text each output currently holds. */
  text(): Record<keyof DashboardOutputs, string | null>;
}

const KEYS: readonly (keyof DashboardOutputs)[] = [
  'generation',
  'running',
  'crashed',
  'stalled',
  'finished',
  'lastGeneration',
  'bestFitness',
  'meanFitness',
  'crashRate',
  'stalls',
  'lapRate',
  'note',
];

export function fakeDashboard(): FakeDashboard {
  const writes = Object.fromEntries(KEYS.map((key) => [key, 0])) as Record<keyof DashboardOutputs, number>;
  const held = Object.fromEntries(KEYS.map((key) => [key, null])) as Record<keyof DashboardOutputs, string | null>;
  const outputs = Object.fromEntries(
    KEYS.map((key) => {
      const target: TextTarget = {
        get textContent() {
          return held[key];
        },
        set textContent(value: string | null) {
          writes[key] += 1;
          held[key] = value;
        },
      };
      return [key, target];
    }),
  ) as unknown as DashboardOutputs;
  return { outputs, writes, text: () => ({ ...held }) };
}
