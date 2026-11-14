// Comparing two saved models' recorded evaluations on the circuits they share (P5-05, docs/plans/p5-05-plan.md). Pure: it reads two
// validated models and each model's RECOGNISED evaluation entries (the caller runs recogniseEvaluations with entryContext, so a hostile
// or invalid entry is already opaque) and returns labelled numbers, every reason a circuit was not compared, and aggregates under
// exact rules. It runs no episode, reads no storage, writes nothing and never throws: anything unreadable is a refusal.
//
// What it does NOT do (plan section 4): no verdict, no ranking, no p-value or interval. An evaluation entry is one deterministic model
// on one circuit from five fixed starts, so the "spread" here is variation of that model across its start perturbations, never
// sampling uncertainty. It imports only the evaluation entry, the model format and the model comparison's physics helper; nothing in
// the simulation, the training layer, the studies or the held-out gate (a test scans for that). Held-out circuits cannot appear: the
// validator refuses entries for them, and this module accepts only recognised entries.
import type { EvaluationEntry, EvaluationRow } from './evaluationEntry';
import { physicsDifferences } from './modelCompare';
import type { ModelDocument } from './modelFormat';

/** Population spread of a set of values: how many, the smallest, the largest and the standard deviation (null for fewer than two). */
export interface Spread {
  readonly n: number;
  readonly min: number;
  readonly max: number;
  readonly sd: number | null;
}

/** One model's recorded evaluation of one circuit (the most recent recognised entry), as recorded. */
export interface CircuitSide {
  readonly episodes: number;
  readonly lapCompletion: number;
  readonly collisionRate: number;
  readonly outcomes: Readonly<Record<'completed' | 'crashed' | 'stalled' | 'timeout', number>>;
  readonly meanOrderedProgress: number;
  /** Mean simulated seconds of the first completed lap; null when no episode completed a lap (never zero). */
  readonly meanFirstLapSeconds: number | null;
  /** How many episodes completed a lap: the sample size of the lap time. */
  readonly firstLapSamples: number;
  readonly brakeEnabled: boolean;
  readonly recordedAt: string;
  /** Spread of the first-lap seconds over the starts that completed a lap (null when none did). */
  readonly firstLapSpread: Spread | null;
  /** Spread of ordered progress over all the starts. */
  readonly progressSpread: Spread | null;
  /** Recognised entries for this circuit that were NOT used because a more recent one was. */
  readonly olderIgnored: number;
}

export type CircuitState = 'compared' | 'not-compared' | 'a-only' | 'b-only';

export interface CircuitComparison {
  readonly trackId: string;
  readonly split: string;
  readonly state: CircuitState;
  /** Every reason the circuit was not compared (empty when compared). */
  readonly reasons: readonly string[];
  readonly a: CircuitSide | null;
  readonly b: CircuitSide | null;
  /** A minus B for a compared circuit; null for each value either side lacks. No judgement is attached. */
  readonly difference: {
    readonly lapCompletion: number;
    readonly collisionRate: number;
    readonly meanOrderedProgress: number;
    readonly meanFirstLapSeconds: number | null;
  } | null;
}

export interface LapTimeAggregate {
  /** `values`: shown over the paired circuits (two or more). `single`: one paired circuit, so its own row stands. `unavailable`: none. */
  readonly state: 'values' | 'single' | 'unavailable';
  /** The compatible circuits where BOTH models completed a lap. */
  readonly pairedCircuits: readonly string[];
  /** Compatible circuits kept out of this aggregate because one model, or both, completed no lap there. */
  readonly excludedCircuits: readonly string[];
  readonly a: number | null;
  readonly b: number | null;
  /** A minus B, over exactly the paired circuits. */
  readonly difference: number | null;
  /** Each model's own count of lap-time samples (episodes that completed a lap) on the paired circuits. */
  readonly samplesA: number;
  readonly samplesB: number;
  readonly note: string;
}

export interface Aggregate {
  /** The compatible circuits every figure below except the lap time is taken over, and the episodes per circuit. */
  readonly circuits: readonly string[];
  readonly episodesPerCircuit: number | null;
  readonly lapCompletion: { readonly a: number; readonly b: number; readonly difference: number };
  readonly collisionRate: { readonly a: number; readonly b: number; readonly difference: number };
  readonly meanOrderedProgress: { readonly a: number; readonly b: number; readonly difference: number };
  readonly lapTime: LapTimeAggregate;
}

export interface EvaluationComparison {
  readonly ok: true;
  readonly circuits: readonly CircuitComparison[];
  /** Present only when at least two circuits were compared; unweighted means of per-circuit values. */
  readonly aggregate: Aggregate | null;
  /** Plain sentences: mismatches, one-sided circuits, entries ignored. */
  readonly warnings: readonly string[];
}
export type EvaluationCompareResult = EvaluationComparison | { readonly ok: false; readonly message: string };

export const SCENARIO_SPREAD_CAVEAT =
  'Spread shows how one saved champion varies across its fixed start changes. It is not uncertainty about how well a training method works, and no ranking is made.';
export const NO_EVALUATIONS = 'At least one of these champions has no recorded evaluation this app can read. Evaluate it on the Evaluate page first.';
export const NOTHING_COMPARABLE = 'These two champions have no circuit that was evaluated under the same conditions, so nothing is compared. The reasons are listed below.';

const same = (a: unknown, b: unknown): boolean => Object.is(a, b);
const mean = (values: readonly number[]): number => values.reduce((sum, v) => sum + v, 0) / values.length;

/** Population spread of `values`, or null when there are none. The standard deviation is null for fewer than two values. */
export function spreadOf(values: readonly number[]): Spread | null {
  const n = values.length;
  if (n === 0) return null;
  let min = values[0]!;
  let max = values[0]!;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const m = mean(values);
  const sd = n < 2 ? null : Math.sqrt(values.reduce((sum, v) => sum + (v - m) * (v - m), 0) / n);
  return Object.freeze({ n, min, max, sd });
}

/** The most recent entry per circuit, keyed by track id: recordedAt decides, a later position in the array breaks ties. Deterministic. */
function latestPerCircuit(entries: readonly EvaluationEntry[]): Map<string, { entry: EvaluationEntry; older: number }> {
  const best = new Map<string, { entry: EvaluationEntry; older: number; at: number }>();
  for (const entry of entries) {
    const parsed = Date.parse(entry.recordedAt);
    const at = Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
    const held = best.get(entry.track.id);
    if (held === undefined) best.set(entry.track.id, { entry, older: 0, at });
    else if (at >= held.at) best.set(entry.track.id, { entry, older: held.older + 1, at });
    else best.set(entry.track.id, { ...held, older: held.older + 1 });
  }
  return best;
}

function sideOf(entry: EvaluationEntry, older: number): CircuitSide {
  const rows: readonly EvaluationRow[] = entry.rows;
  const summary = entry.summary;
  return Object.freeze({
    episodes: summary.episodes,
    lapCompletion: summary.lapCompletion,
    collisionRate: summary.collisionRate,
    outcomes: summary.outcomes,
    meanOrderedProgress: summary.meanOrderedProgress,
    meanFirstLapSeconds: summary.meanFirstLapSeconds,
    firstLapSamples: summary.firstLapSamples,
    brakeEnabled: entry.brakeEnabled,
    recordedAt: entry.recordedAt,
    firstLapSpread: spreadOf(rows.flatMap((r) => (r.firstLapSeconds === null ? [] : [r.firstLapSeconds]))),
    progressSpread: spreadOf(rows.map((r) => r.orderedProgress)),
    olderIgnored: older,
  });
}

const startsEqual = (a: EvaluationEntry, b: EvaluationEntry): boolean =>
  a.starts.length === b.starts.length &&
  a.starts.every((s, i) => {
    const t = b.starts[i]!;
    return same(s.seed, t.seed) && same(s.lateralMetres, t.lateralMetres) && same(s.headingRadians, t.headingRadians) && same(s.x, t.x) && same(s.y, t.y) && same(s.heading, t.heading);
  });

/** Every reason two recognised entries for the same circuit were not run under the same conditions. */
function mismatchReasons(a: EvaluationEntry, b: EvaluationEntry): string[] {
  const reasons: string[] = [];
  if (!same(a.track.version, b.track.version)) reasons.push(`The track version differs (A ${a.track.version}, B ${b.track.version}).`);
  if (!same(a.track.contentHash, b.track.contentHash)) reasons.push('The track content differs (different content hash).');
  if (!same(a.track.split, b.track.split)) reasons.push(`The track is in a different split for each (A ${a.track.split}, B ${b.track.split}).`);
  if (!same(a.configHash, b.configHash)) reasons.push('The evaluation settings differ (episode limit, stall limit, laps, fitness version or timestep).');
  if (!same(a.fitnessVersion, b.fitnessVersion)) reasons.push(`The fitness version differs (A ${a.fitnessVersion}, B ${b.fitnessVersion}).`);
  if (!same(a.timestepSeconds, b.timestepSeconds)) reasons.push(`The timestep differs (A ${a.timestepSeconds} s, B ${b.timestepSeconds} s).`);
  if (!startsEqual(a, b)) reasons.push('The recorded starts differ, so they are not the same scenarios.');
  return reasons;
}

const diff = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : a - b);

function build(a: ModelDocument, b: ModelDocument, entriesA: readonly EvaluationEntry[], entriesB: readonly EvaluationEntry[]): EvaluationCompareResult {
  const warnings: string[] = [];
  // Entries that belong to another champion are never used (the caller's recognition already checks; this keeps the module safe alone).
  const own = (model: ModelDocument, entries: readonly EvaluationEntry[], side: string): EvaluationEntry[] => {
    const kept = entries.filter((e) => e.modelId === model.id);
    if (kept.length !== entries.length) warnings.push(`${entries.length - kept.length} evaluation ${entries.length - kept.length === 1 ? 'entry' : 'entries'} of ${side} belong to another champion and were ignored.`);
    return kept;
  };
  const ownA = own(a, entriesA, 'A');
  const ownB = own(b, entriesB, 'B');
  if (ownA.length === 0 || ownB.length === 0) return { ok: false, message: NO_EVALUATIONS };

  const latestA = latestPerCircuit(ownA);
  const latestB = latestPerCircuit(ownB);
  const physics = physicsDifferences(a, b);
  const physicsReason = physics.length > 0 ? `The two champions' vehicle physics differ: ${physics.join(', ')}.` : null;

  const ids = [...new Set([...latestA.keys(), ...latestB.keys()])].sort();
  const circuits: CircuitComparison[] = [];
  for (const id of ids) {
    const left = latestA.get(id);
    const right = latestB.get(id);
    const split = (left ?? right)!.entry.track.split;
    if (left === undefined || right === undefined) {
      const only = left ?? right!;
      const sideValue = sideOf(only.entry, only.older);
      circuits.push({ trackId: id, split, state: left !== undefined ? 'a-only' : 'b-only', reasons: [], a: left !== undefined ? sideValue : null, b: right !== undefined ? sideValue : null, difference: null });
      continue;
    }
    const reasons = mismatchReasons(left.entry, right.entry);
    if (physicsReason !== null) reasons.push(physicsReason);
    const sideA = sideOf(left.entry, left.older);
    const sideB = sideOf(right.entry, right.older);
    if (reasons.length > 0) {
      circuits.push({ trackId: id, split, state: 'not-compared', reasons, a: sideA, b: sideB, difference: null });
      continue;
    }
    circuits.push({
      trackId: id,
      split,
      state: 'compared',
      reasons: [],
      a: sideA,
      b: sideB,
      difference: {
        lapCompletion: sideA.lapCompletion - sideB.lapCompletion,
        collisionRate: sideA.collisionRate - sideB.collisionRate,
        meanOrderedProgress: sideA.meanOrderedProgress - sideB.meanOrderedProgress,
        meanFirstLapSeconds: diff(sideA.meanFirstLapSeconds, sideB.meanFirstLapSeconds),
      },
    });
  }

  const compared = circuits.filter((c) => c.state === 'compared');
  if (compared.length === 0) {
    const reasons = [...new Set(circuits.flatMap((c) => c.reasons))];
    const sharedNone = circuits.every((c) => c.state === 'a-only' || c.state === 'b-only');
    return { ok: false, message: `${NOTHING_COMPARABLE}${sharedNone ? ' They share no evaluated circuit.' : ''} ${reasons.join(' ')}`.trim() };
  }

  for (const c of circuits) {
    if (c.state === 'a-only') warnings.push(`${c.trackId} was evaluated for A only, so there is nothing to compare there.`);
    if (c.state === 'b-only') warnings.push(`${c.trackId} was evaluated for B only, so there is nothing to compare there.`);
    if (c.state === 'not-compared') warnings.push(`${c.trackId} was evaluated for both but not under the same conditions, so it is shown but not compared.`);
    for (const side of [c.a, c.b]) if (side !== null && side.olderIgnored > 0) warnings.push(`${c.trackId}: ${side.olderIgnored} older recorded ${side.olderIgnored === 1 ? 'evaluation was' : 'evaluations were'} not used (the most recent is shown).`);
  }
  if (compared.some((c) => c.a!.brakeEnabled !== c.b!.brakeEnabled)) warnings.push('One champion has its brake output masked and the other does not. They are different drivers, not different tests; the evaluations are still comparable.');

  let aggregate: Aggregate | null = null;
  if (compared.length >= 2) {
    const mine = (pick: (s: CircuitSide) => number): { a: number; b: number; difference: number } => {
      const av = mean(compared.map((c) => pick(c.a!)));
      const bv = mean(compared.map((c) => pick(c.b!)));
      return { a: av, b: bv, difference: av - bv };
    };
    const paired = compared.filter((c) => c.a!.meanFirstLapSeconds !== null && c.b!.meanFirstLapSeconds !== null);
    const excluded = compared.filter((c) => !paired.includes(c)).map((c) => c.trackId);
    const episodes = new Set(compared.flatMap((c) => [c.a!.episodes, c.b!.episodes]));
    let lapTime: LapTimeAggregate;
    if (paired.length === 0) {
      lapTime = { state: 'unavailable', pairedCircuits: [], excludedCircuits: excluded, a: null, b: null, difference: null, samplesA: 0, samplesB: 0, note: 'No circuit where both champions completed a lap, so there is no lap time to aggregate.' };
    } else if (paired.length === 1) {
      lapTime = { state: 'single', pairedCircuits: [paired[0]!.trackId], excludedCircuits: excluded, a: null, b: null, difference: null, samplesA: paired[0]!.a!.firstLapSamples, samplesB: paired[0]!.b!.firstLapSamples, note: `Only one circuit (${paired[0]!.trackId}) where both completed a lap, so its own row stands and no aggregate is shown.` };
    } else {
      const av = mean(paired.map((c) => c.a!.meanFirstLapSeconds!));
      const bv = mean(paired.map((c) => c.b!.meanFirstLapSeconds!));
      lapTime = {
        state: 'values',
        pairedCircuits: paired.map((c) => c.trackId),
        excludedCircuits: excluded,
        a: av,
        b: bv,
        difference: av - bv,
        samplesA: paired.reduce((sum, c) => sum + c.a!.firstLapSamples, 0),
        samplesB: paired.reduce((sum, c) => sum + c.b!.firstLapSamples, 0),
        note: `Mean over ${paired.length} circuits where both completed a lap.`,
      };
    }
    aggregate = {
      circuits: compared.map((c) => c.trackId),
      episodesPerCircuit: episodes.size === 1 ? [...episodes][0]! : null,
      lapCompletion: mine((s) => s.lapCompletion),
      collisionRate: mine((s) => s.collisionRate),
      meanOrderedProgress: mine((s) => s.meanOrderedProgress),
      lapTime,
    };
  }
  return { ok: true, circuits, aggregate, warnings };
}

/**
 * Compares two validated models' recorded evaluations on the circuits both were evaluated on. `entriesA` and `entriesB` are each model's
 * recognised entries. Never throws: a model or entry list that cannot be read is a refusal with a message.
 */
export function compareEvaluations(a: ModelDocument, b: ModelDocument, entriesA: readonly EvaluationEntry[], entriesB: readonly EvaluationEntry[]): EvaluationCompareResult {
  try {
    return build(a, b, entriesA, entriesB);
  } catch {
    return { ok: false, message: 'These two champions could not be compared: one of them holds data this app cannot read.' };
  }
}
