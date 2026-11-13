// Choosing the training circuit (P4-04), pure and DOM-free. The training page trains on ONE circuit per run: the circuit is
// chosen from the page address (`?mode=train&circuit=<id>`), and changing it in the page starts a new run by loading the
// address for the new circuit. Only training circuits are ever offered or accepted: a validation or held-out ID in the
// address is ignored, so the page can never be pointed at one. Evolving across several circuits is the approval-gated R-06.
import { DEFAULT_TRAINING_CONFIG, type TrainingConfig } from '../training/trainer';
import type { TrackLimits } from '../training/trackSplits';

export const DEFAULT_TRAINING_CIRCUIT = 'stadium-oval';

/**
 * Built-in circuits offered on the TRAINING page only (P4-06 step 3). Silverstone's episode limits (420 s, a 10 s stall rule, one lap) are read by the
 * training page, which records them in the run's configuration. The evaluate page (a fixed 60 s, 5 s, 3-lap protocol, so that evaluations are comparable)
 * and the race page (its own 60 s per lap rule) cannot complete a 5.9 km lap, so neither offers it as a circuit to run on: a champion trained on
 * Silverstone is still listed and usable there, on the other circuits. Widening those protocols is a separate, owner-approved change.
 */
export const TRAINING_PAGE_ONLY: readonly string[] = Object.freeze(['silverstone']);

/** The tracks the evaluate and race pages may list: every one except those only the training page offers. */
export function offered<T extends { readonly id: string }>(tracks: readonly T[]): T[] {
  return tracks.filter((t) => !TRAINING_PAGE_ONLY.includes(t.id));
}

/**
 * The trainer configuration for a NEW run on a circuit: the defaults, with the circuit's own episode limits when its manifest entry proposes
 * them (null keeps the 60 s, 5 s and 3-lap defaults). A saved model's or checkpoint's own recorded configuration always wins on a replay or a resume;
 * this is only where a new run starts.
 */
export function trainingConfigFor(limits: TrackLimits | null): TrainingConfig {
  if (limits === null) return DEFAULT_TRAINING_CONFIG;
  return Object.freeze({
    ...DEFAULT_TRAINING_CONFIG,
    maxEpisodeSeconds: limits.maxEpisodeSeconds,
    stallSeconds: limits.stallSeconds,
    maxLaps: limits.maxLaps,
  });
}

/** The credit shown while a circuit made from third-party data is selected, or null. The wording follows src/data/tracks/NOTICE.md. */
export function circuitCredit(id: string): string | null {
  if (id !== 'silverstone') return null;
  return 'Silverstone: centre line and widths from the TUM racetrack-database (LGPL-3.0), which is derived from OpenStreetMap data, © OpenStreetMap contributors (ODbL 1.0). The layout is the real circuit driven the opposite way round, as a simplified model with no kerbs, run-offs or elevation.';
}

/** The circuit named by the query string's last `circuit` parameter if it is one of `available`, otherwise the default. */
export function circuitFromSearch(search: string, available: readonly string[]): string {
  const values = new URLSearchParams(search).getAll('circuit');
  const last = values[values.length - 1]?.trim();
  if (last !== undefined && available.includes(last)) return last;
  return available.includes(DEFAULT_TRAINING_CIRCUIT) ? DEFAULT_TRAINING_CIRCUIT : (available[0] ?? DEFAULT_TRAINING_CIRCUIT);
}

/** The query string for a circuit: every other parameter kept (mode, debug flags), `circuit` set once. */
export function searchForCircuit(search: string, id: string): string {
  const params = new URLSearchParams(search);
  params.delete('circuit');
  params.set('circuit', id);
  return `?${params.toString()}`;
}

export interface CircuitControlState {
  readonly disabled: boolean;
  readonly hint: string;
}

/**
 * The control is available before the first generation of a run has completed, and while training is paused (so a run in
 * progress is never replaced by a stray tap); otherwise it is disabled and says how to change it.
 */
export function circuitControlState(input: { readonly paused: boolean; readonly completedGenerations: number }): CircuitControlState {
  if (input.completedGenerations === 0) return { disabled: false, hint: 'Changing the circuit starts a new run.' };
  if (input.paused) return { disabled: false, hint: 'Changing the circuit starts a new run and ends this one.' };
  return { disabled: true, hint: 'Pause training to change the circuit.' };
}
