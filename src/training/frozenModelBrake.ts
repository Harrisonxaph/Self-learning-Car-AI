// The brake mask of a frozen model (P2-09 plan step 2, docs/experiments/p2-09-plan.md §3 part 1).
//
// A model trained with the brake masked (A4) and one trained with it enabled (A5) have the same 9-12-3 shape, so the
// parameters alone cannot say which mask a model was made for. A frozen model may therefore carry
// `provenance.brakeEnabled` (boolean). Provenance is part of the model's ID (trackSplits.ts, freezeModel), so the
// same parameters with the brake enabled and disabled are two different models, and changing the flag afterwards
// breaks the ID. These two helpers read the flag with validation and drive the model with exactly that mask.
//
// The key is optional in the frozen-model format: P2-07 and P2-08 models do not carry it, their IDs are unchanged,
// and neither helper is applied to them.
import { createNetworkDriver, type EpisodeDriver } from '../ai/drivers';
import { isFrozenModel, type FrozenModel } from './trackSplits';

/**
 * The brake mask recorded in a frozen model's provenance. Throws RangeError if `model` is not an unchanged frozen
 * model (see freezeModel), or if `model.provenance.brakeEnabled` is missing or not a boolean.
 */
export function modelBrakeEnabled(model: FrozenModel): boolean {
  if (!isFrozenModel(model)) throw new RangeError('model must be an unchanged frozen model (freezeModel).');
  if (!Object.prototype.hasOwnProperty.call(model.provenance, 'brakeEnabled')) {
    throw new RangeError('model.provenance.brakeEnabled is missing; it must be a boolean.');
  }
  const value: unknown = model.provenance.brakeEnabled;
  if (typeof value !== 'boolean') throw new RangeError(`model.provenance.brakeEnabled must be a boolean, got ${typeof value} ${String(value)}.`);
  return value;
}

/**
 * A driver for a frozen model with exactly the brake mask its provenance records: createNetworkDriver on the model's
 * parameters with `{ brakeEnabled: modelBrakeEnabled(model) }`. Throws RangeError for the same reasons as
 * modelBrakeEnabled, or if the parameters are not a valid network.
 */
export function createFrozenModelDriver(model: FrozenModel): EpisodeDriver {
  return createNetworkDriver(model.parameters, { brakeEnabled: modelBrakeEnabled(model) });
}
