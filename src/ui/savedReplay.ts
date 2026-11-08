// A saved champion (P3-05) replayed through the same code as a live one. The model's own recorded physics, timestep,
// episode limits and brake setting are used, so the replay is what that brain did under the conditions it was saved with;
// the loaded brain never enters a trainer. Cars are independent and a replay reads only the genome and the setup, so a
// saved-then-loaded champion takes exactly the path the original took (tested tick by tick).
import { modelParameters, type ModelDocument } from '../persistence/modelFormat';
import { createChampionReplay, type ChampionReplay } from '../training/championReplay';
import { DEFAULT_FITNESS_CONFIG, FITNESS_VERSION } from '../training/fitness';
import { trainingTrack } from '../training/trackSplits';
import { createTrainingSetup, type TrainingSetup } from '../training/trainer';

export interface SavedReplay {
  readonly replay: ChampionReplay;
  readonly setup: TrainingSetup;
  /** Things that differ from this build and may change how scores compare; the replay itself is unaffected. */
  readonly warnings: readonly string[];
}

/**
 * The training setup a validated model was saved with. Throws only for a model `validateModel` would have refused (an
 * unregistered track), which a caller that validated first never sees.
 */
export function setupForModel(model: ModelDocument): { setup: TrainingSetup; warnings: string[] } {
  const c = model.training.configuration;
  const warnings: string[] = [];
  // Replaying drives a genome and reads no fitness, but a setup needs one it can resolve.
  let fitness: unknown = c.fitness;
  if (c.fitness.version !== FITNESS_VERSION) {
    fitness = DEFAULT_FITNESS_CONFIG;
    warnings.push(`It was scored under fitness version ${c.fitness.version}; this app uses version ${FITNESS_VERSION}, so its fitness is not comparable with new scores.`);
  }
  const track = trainingTrack(model.training.trackIds[0]!);
  const setup = createTrainingSetup(
    {
      seed: model.training.seed ?? 0,
      populationSize: c.populationSize,
      eliteCount: c.eliteCount,
      selection: c.selection,
      crossover: c.crossover,
      mutation: c.mutation,
      maxEpisodeSeconds: c.maxEpisodeSeconds,
      stallSeconds: c.stallSeconds,
      maxLaps: c.maxLaps,
      brakeEnabled: c.brakeEnabled,
      fitness,
    },
    { track, physics: c.physics, timestepSeconds: c.timestepSeconds },
  );
  return { setup, warnings };
}

/** A replay of a validated, drivable model under its own recorded conditions. */
export function replayForModel(model: ModelDocument): SavedReplay {
  const { setup, warnings } = setupForModel(model);
  return { replay: createChampionReplay(modelParameters(model), setup), setup, warnings };
}
