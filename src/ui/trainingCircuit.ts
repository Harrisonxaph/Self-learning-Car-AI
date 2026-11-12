// Choosing the training circuit (P4-04), pure and DOM-free. The training page trains on ONE circuit per run: the circuit is
// chosen from the page address (`?mode=train&circuit=<id>`), and changing it in the page starts a new run by loading the
// address for the new circuit. Only training circuits are ever offered or accepted: a validation or held-out ID in the
// address is ignored, so the page can never be pointed at one. Evolving across several circuits is the approval-gated R-06.
export const DEFAULT_TRAINING_CIRCUIT = 'stadium-oval';

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
