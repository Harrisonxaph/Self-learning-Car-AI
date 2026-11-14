// The evaluation protocol's fixed starts (P4-05): the circuit's nominal start (seed 0) and four small perturbed starts drawn from
// the repository's seeded RNG. They live in `sim` (which depends only on `utils`) so that both the persisted evaluation entry and
// the headless held-out gate (P5-02) derive exactly the same starts from a track's own start pose. Pure and deterministic.
import { createRng } from '../utils/rng';

/** The fixed perturbed-start seeds; seed 0 is the nominal start. */
export const EVALUATION_SEEDS: readonly number[] = Object.freeze([1, 2, 3, 4]);
/** The largest start offsets: 1.0 m sideways and 3 degrees of heading. */
export const START_BOUNDS = Object.freeze({ lateralMetres: 1.0, headingRadians: (3 * Math.PI) / 180 });

export interface EvaluationStart {
  readonly seed: number;
  /** Offset from the nominal start, metres to the left (negative: right) of its heading. */
  readonly lateralMetres: number;
  /** Heading offset from the nominal start, radians. */
  readonly headingRadians: number;
  readonly x: number;
  readonly y: number;
  readonly heading: number;
}

/** The start of seed `seed` for a nominal start pose: the nominal start for 0, otherwise a bounded offset from the seeded RNG. */
export function evaluationStartFor(nominal: { readonly position: { readonly x: number; readonly y: number }; readonly heading: number }, seed: number): EvaluationStart {
  const { position, heading } = nominal;
  if (seed === 0) return { seed, lateralMetres: 0, headingRadians: 0, x: position.x, y: position.y, heading };
  const rng = createRng(seed);
  const lateral = Math.round(rng.range(-START_BOUNDS.lateralMetres, START_BOUNDS.lateralMetres) * 1000) / 1000;
  const turn = Math.round(rng.range(-START_BOUNDS.headingRadians, START_BOUNDS.headingRadians) * 1e6) / 1e6;
  // To the left of the heading on the y-down screen is (sin h, -cos h).
  return { seed, lateralMetres: lateral, headingRadians: turn, x: position.x + Math.sin(heading) * lateral, y: position.y - Math.cos(heading) * lateral, heading: heading + turn };
}
