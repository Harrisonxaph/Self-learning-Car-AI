// Choosing the training circuit (P4-04), pure and DOM-free. The training page trains on ONE circuit per run: the circuit is
// chosen from the page address (`?mode=train&circuit=<id>`), and changing it in the page starts a new run by loading the
// address for the new circuit. Only training circuits are ever offered or accepted: a validation or held-out ID in the
// address is ignored, so the page can never be pointed at one. Evolving across several circuits is the approval-gated R-06.
export const DEFAULT_TRAINING_CIRCUIT = 'stadium-oval';

/**
 * Built-in circuits that are registered (P4-06 step 2b) but not yet OFFERED in any page list or accepted from the address: Silverstone's episode limits
 * (420 s, 10 s, one lap) are not read by the pages yet, so training on it with the 60 s default would only time out. Step 3 (selection, scaled limits, the
 * credit line) empties this list. Nothing else changes: the circuit is registered, hashed and recognised by every split check.
 */
export const NOT_YET_OFFERED: readonly string[] = Object.freeze(['silverstone']);

/** The tracks a page may list: every one except those not yet offered. */
export function offered<T extends { readonly id: string }>(tracks: readonly T[]): T[] {
  return tracks.filter((t) => !NOT_YET_OFFERED.includes(t.id));
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
