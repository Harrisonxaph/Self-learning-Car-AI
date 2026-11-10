// Comparing two saved models (P3-08, docs/plans/p3-08-plan.md). Pure: it reads two validated models and returns labelled
// rows, whether their fitness values may be ranked, and whether they can be replayed together. It imports only the model
// format, writes nothing, and never throws: anything that is not a validated model is a refusal.
//
// Two separate questions (plan section 3):
//  - `fitness.comparable`: were the two scored the same way, on the same task and under the same conditions? Only then may
//    a "higher fitness" marker be shown. Every difference found is listed, not only the first.
//  - `sharedReplay`: can both be driven together under the same conditions? Independent of scoring: a model saved under
//    another fitness version can still be driven (MODEL_FORMAT.md), so that difference alone never blocks it.
// Fitness is one training generation's score on the training track. It is never described as an evaluation, and nothing
// here says one model is better than another.
import { compatibility, type ModelDocument } from './modelFormat';

export type RowState = 'same' | 'different' | 'unavailable';

export interface ComparisonRow {
  readonly group: 'Identity' | 'Architecture' | 'Training' | 'Task' | 'Scoring' | 'Recorded metrics';
  readonly label: string;
  readonly a: string;
  readonly b: string;
  readonly state: RowState;
}

export interface Comparison {
  readonly ok: true;
  readonly rows: readonly ComparisonRow[];
  /** Whether fitness values may be ranked, and every reason they may not. */
  readonly fitness: { readonly comparable: boolean; readonly reasons: readonly string[] };
  /** Whether both can be replayed together under the same conditions, and every reason they cannot. */
  readonly sharedReplay: { readonly ok: true } | { readonly ok: false; readonly reasons: readonly string[] };
  /** Which side has the higher fitness, only when the two are comparable; `tie` when equal; null when not ranked. */
  readonly marker: 'a' | 'b' | 'tie' | null;
  /** Plain sentences for the top of the table. */
  readonly warnings: readonly string[];
}
export type CompareResult = Comparison | { readonly ok: false; readonly message: string };

export const FITNESS_CAVEAT = 'Fitness is a training score on the training track, not an evaluation of general driving.';
/** The three honest states of a model's `evaluation` field (the validator checks only that it is an array). */
export const EVALUATION_ABSENT = 'No evaluation recorded';
export const evaluationPresent = (count: number): string => `Recorded evaluation data present: ${count} ${count === 1 ? 'entry' : 'entries'}, unsupported and unverified in Phase 3`;

const same = (a: unknown, b: unknown): boolean => Object.is(a, b);
const num = (value: number, digits = 2): string => (Number.isFinite(value) ? value.toFixed(digits) : 'unavailable');
const short = (hash: string): string => (hash.length > 16 ? `${hash.slice(0, 16)}…` : hash);

/** Names of the keys of `a` whose values differ from `b`'s (both plain records of numbers). */
function differing(a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((key) => !same(a[key], b[key])).sort();
}

const evaluationText = (model: ModelDocument): { text: string; present: boolean } => {
  const list: unknown = model.evaluation;
  const count = Array.isArray(list) ? list.length : 0;
  // Only the count is ever shown: the entries are not interpreted, summarised, rendered or ranked.
  return count === 0 ? { text: EVALUATION_ABSENT, present: false } : { text: evaluationPresent(count), present: true };
};

function build(a: ModelDocument, b: ModelDocument): Comparison {
  const rows: ComparisonRow[] = [];
  const add = (group: ComparisonRow['group'], label: string, left: string, right: string, state?: RowState) => {
    rows.push({ group, label, a: left, b: right, state: state ?? (left === right ? 'same' : 'different') });
  };
  const ca = a.training.configuration;
  const cb = b.training.configuration;

  add('Identity', 'Name', a.name ?? 'Unnamed champion', b.name ?? 'Unnamed champion');
  add('Identity', 'Generation', String(a.training.generation + 1), String(b.training.generation + 1));
  add('Identity', 'Saved', a.createdAt.slice(0, 10), b.createdAt.slice(0, 10));
  add('Identity', 'Code version', a.codeVersion, b.codeVersion);
  add('Identity', 'App version', a.appVersion ?? 'unavailable', b.appVersion ?? 'unavailable', a.appVersion === undefined || b.appVersion === undefined ? 'unavailable' : undefined);

  add('Architecture', 'Layers', a.architecture.layers.join(' → '), b.architecture.layers.join(' → '));
  add('Architecture', 'Activations', `${a.architecture.hiddenActivation}; ${a.architecture.outputActivations.join(', ')}`, `${b.architecture.hiddenActivation}; ${b.architecture.outputActivations.join(', ')}`);
  add('Architecture', 'Brake output', a.architecture.brakeEnabled ? 'enabled' : 'masked to 0', b.architecture.brakeEnabled ? 'enabled' : 'masked to 0');

  const seed = (m: ModelDocument) => (m.training.seed === null ? `unavailable: ${m.training.seedUnavailableReason ?? 'no reason recorded'}` : String(m.training.seed));
  add('Training', 'Seed', seed(a), seed(b), a.training.seed === null || b.training.seed === null ? 'unavailable' : undefined);
  add('Training', 'Population', String(ca.populationSize), String(cb.populationSize));
  add('Training', 'Elite count', String(ca.eliteCount), String(cb.eliteCount));
  add('Training', 'Selection', `${ca.selection.type}, size ${ca.selection.size}`, `${cb.selection.type}, size ${cb.selection.size}`);
  add('Training', 'Crossover', `${ca.crossover.type}, rate ${ca.crossover.rate}`, `${cb.crossover.type}, rate ${cb.crossover.rate}`);
  add('Training', 'Mutation', `rate ${ca.mutation.rate}, scale ${ca.mutation.scale}`, `rate ${cb.mutation.rate}, scale ${cb.mutation.scale}`);
  add('Training', 'Episode time limit', `${ca.maxEpisodeSeconds} s`, `${cb.maxEpisodeSeconds} s`);
  add('Training', 'Stall limit', `${ca.stallSeconds} s`, `${cb.stallSeconds} s`);
  add('Training', 'Laps per episode', String(ca.maxLaps), String(cb.maxLaps));
  add('Training', 'Timestep', `${ca.timestepSeconds} s`, `${cb.timestepSeconds} s`);
  const physics = differing(ca.physics as unknown as Record<string, unknown>, cb.physics as unknown as Record<string, unknown>);
  add('Training', 'Vehicle physics', physics.length === 0 ? 'as recorded' : `differs: ${physics.join(', ')}`, physics.length === 0 ? 'as recorded' : `differs: ${physics.join(', ')}`, physics.length === 0 ? 'same' : 'different');
  const sensorsSame = same(ca.sensors.maxDistance, cb.sensors.maxDistance) && ca.sensors.anglesDegrees.length === cb.sensors.anglesDegrees.length && ca.sensors.anglesDegrees.every((v, i) => same(v, cb.sensors.anglesDegrees[i]));
  add('Training', 'Sensors', `${ca.sensors.anglesDegrees.length} rays, range ${ca.sensors.maxDistance}`, `${cb.sensors.anglesDegrees.length} rays, range ${cb.sensors.maxDistance}`, sensorsSame ? 'same' : 'different');

  add('Task', 'Training track', a.training.trackIds.join(', '), b.training.trackIds.join(', '));
  const versions = (m: ModelDocument) => m.training.trackIds.map((id) => m.training.trackVersions[id]).join(', ');
  const hashes = (m: ModelDocument) => m.training.trackIds.map((id) => short(m.training.trackHashes[id] ?? '')).join(', ');
  add('Task', 'Track version', versions(a), versions(b));
  add('Task', 'Track content hash', hashes(a), hashes(b));
  add('Task', 'Simulation version', String(a.simulationVersion), String(b.simulationVersion));

  add('Scoring', 'Fitness version', String(ca.fitness.version), String(cb.fitness.version));
  const weights = differing(ca.fitness as unknown as Record<string, unknown>, cb.fitness as unknown as Record<string, unknown>).filter((key) => key !== 'version');
  add('Scoring', 'Fitness weights', weights.length === 0 ? 'as recorded' : `differs: ${weights.join(', ')}`, weights.length === 0 ? 'as recorded' : `differs: ${weights.join(', ')}`, weights.length === 0 ? 'same' : 'different');

  add('Recorded metrics', 'Fitness', num(a.fitness), num(b.fitness));
  const ea = evaluationText(a);
  const eb = evaluationText(b);
  add('Recorded metrics', 'Evaluation', ea.text, eb.text, !ea.present && !eb.present ? 'unavailable' : undefined);

  // Score comparability: every difference in how the scores were produced, listed completely.
  const reasons: string[] = [];
  if (!same(ca.fitness.version, cb.fitness.version)) reasons.push(`The fitness version differs (A ${ca.fitness.version}, B ${cb.fitness.version}).`);
  if (weights.length > 0) reasons.push(`The fitness weights differ: ${weights.join(', ')}.`);
  if (!same(a.simulationVersion, b.simulationVersion)) reasons.push(`The simulation version differs (A ${a.simulationVersion}, B ${b.simulationVersion}).`);
  if (a.training.trackIds.join(',') !== b.training.trackIds.join(',')) reasons.push('The training track differs.');
  if (versions(a) !== versions(b)) reasons.push('The track version differs.');
  if (a.training.trackIds.some((id) => a.training.trackHashes[id] !== b.training.trackHashes[id])) reasons.push('The track content differs (different content hash).');
  for (const [label, left, right] of [['episode time limit', ca.maxEpisodeSeconds, cb.maxEpisodeSeconds], ['stall limit', ca.stallSeconds, cb.stallSeconds], ['laps per episode', ca.maxLaps, cb.maxLaps], ['timestep', ca.timestepSeconds, cb.timestepSeconds]] as const) {
    if (!same(left, right)) reasons.push(`The ${label} differs (A ${left}, B ${right}).`);
  }
  if (physics.length > 0) reasons.push(`The vehicle physics differ: ${physics.join(', ')}.`);
  const comparable = reasons.length === 0;

  // Replay compatibility: can both be driven together under the same conditions? Scoring does not matter here.
  const replayReasons: string[] = [];
  for (const [side, model] of [['A', a], ['B', b]] as const) {
    const c = compatibility(model);
    if (!c.drivable) replayReasons.push(`${side} cannot be driven by this version of the app. ${c.reasons.join(' ')}`);
  }
  if (!same(a.simulationVersion, b.simulationVersion)) replayReasons.push('They were made for different simulation versions.');
  if (a.training.trackIds.join(',') !== b.training.trackIds.join(',') || versions(a) !== versions(b) || a.training.trackIds.some((id) => a.training.trackHashes[id] !== b.training.trackHashes[id])) replayReasons.push('They were trained on different tracks or track versions.');
  if (physics.length > 0) replayReasons.push(`Their vehicle physics differ: ${physics.join(', ')}.`);
  if (!same(ca.timestepSeconds, cb.timestepSeconds)) replayReasons.push('Their timesteps differ.');
  if (!same(ca.maxEpisodeSeconds, cb.maxEpisodeSeconds) || !same(ca.stallSeconds, cb.stallSeconds) || !same(ca.maxLaps, cb.maxLaps)) replayReasons.push('Their episode limits differ.');

  const warnings: string[] = [];
  if (!comparable) warnings.push('Their fitness values are shown but not ranked: they were not scored the same way, on the same task, under the same conditions.');
  if (replayReasons.length > 0) warnings.push('They cannot be replayed together.');
  const marker = !comparable ? null : a.fitness > b.fitness ? 'a' : b.fitness > a.fitness ? 'b' : 'tie';
  return { ok: true, rows, fitness: { comparable, reasons }, sharedReplay: replayReasons.length === 0 ? { ok: true } : { ok: false, reasons: replayReasons }, marker, warnings };
}

/** Compares two validated models. Never throws: anything else is a refusal with a message. */
export function compareModels(a: ModelDocument, b: ModelDocument): CompareResult {
  try {
    return build(a, b);
  } catch {
    return { ok: false, message: 'These two models could not be compared: one of them holds data this app cannot read.' };
  }
}
