// Aggregates a V8 sampling CPU profile (the `Profiler` domain's `Profile`, as `node:inspector` returns it) into the groups the P2-11 plan names
// (docs/plans/p2-11-plan.md, step 2): the ray casts, the collision sweep, `pointOnRoad`, the rest of the physics, the checkpoint gates, and so on. Pure: it
// reads a profile object and nothing else (no file, no clock, no inspector), so tests feed it synthetic profiles. It decides nothing about the simulation and
// is never part of a model, a record or a hash. `scripts/profile.mjs` is the only caller that collects a real profile.
//
// Method: each sample is attributed to the function the sample was taken in (self time). Sample i is weighted by the gap that FOLLOWS it
// (`timeDeltas[i + 1]`; the last sample has no following gap and gets weight 0), because V8 stores each delta as the time since the previous sample. The
// weights are microseconds. Limit: the optimising compiler may inline a small function into its caller, and then its time is credited to the caller; the
// script has an option that turns inlining off to show how much that moves the split.

export interface ProfileCallFrame {
  readonly functionName: string;
  readonly url: string;
  /** The script the frame belongs to. A frame optimised by V8 can have an empty `url`; its `scriptId` still names the same script as the frames that have one. */
  readonly scriptId?: string;
}
export interface ProfileNode {
  readonly id: number;
  readonly callFrame: ProfileCallFrame;
}
export interface CpuProfile {
  readonly nodes: readonly ProfileNode[];
  readonly samples?: readonly number[];
  readonly timeDeltas?: readonly number[];
}

/** The groups, in the order they are reported. */
export const PROFILE_GROUPS = ['rays', 'sweep', 'on-road', 'physics', 'gates', 'network-inputs', 'training-harness', 'other-src', 'outside-src'] as const;
export type ProfileGroup = (typeof PROFILE_GROUPS)[number];

export interface GroupShare {
  readonly group: ProfileGroup;
  readonly microseconds: number;
  /** Fraction of all attributed time, 0 to 1 (0 when nothing was sampled). */
  readonly share: number;
}
export interface FunctionShare {
  readonly name: string;
  readonly file: string;
  readonly group: ProfileGroup;
  readonly microseconds: number;
  readonly share: number;
}
export interface ProfileSummary {
  readonly samples: number;
  readonly totalMicroseconds: number;
  readonly groups: readonly GroupShare[];
  /** The functions with the most self time, largest first (ties by name, so the order is deterministic). */
  readonly topFunctions: readonly FunctionShare[];
}

// The exact functions of src/sim/collision.ts that belong to the sweep (the bounding-box pass and the exact tests it hands survivors to) and to pointOnRoad.
const SWEEP_FUNCTIONS: ReadonlySet<string> = new Set([
  'footprintHitsTrack',
  'sweepHitsTrack',
  'shapeTouchesBoundary',
  'segmentNearConvex',
  'segmentsTouch',
  'pointSegmentDistance',
  'convexHull',
  'inConvex',
  'orient',
  'withinBox',
  'vehicleFootprint',
  'footprintReach',
  'turnMargin',
]);
const ON_ROAD_FUNCTIONS: ReadonlySet<string> = new Set(['pointOnRoad', 'inPolygon']);

/** The path of a frame's url relative to the repository, or null for a frame that is not a source file of this repository (Node, V8, node_modules). */
export function sourcePath(url: string): string | null {
  const cleaned = url.replace(/^file:\/\//, '').replace(/[?#].*$/, '');
  const at = cleaned.lastIndexOf('/src/');
  if (at < 0) return null;
  if (cleaned.includes('/node_modules/')) return null;
  return cleaned.slice(at + 1);
}

/** Which group one function belongs to. */
export function groupOf(file: string | null, functionName: string): ProfileGroup {
  if (file === null) return 'outside-src';
  if (file === 'src/sensors/rays.ts') return 'rays';
  if (file === 'src/sim/collision.ts') {
    if (ON_ROAD_FUNCTIONS.has(functionName)) return 'on-road';
    if (SWEEP_FUNCTIONS.has(functionName)) return 'sweep';
    return 'physics';
  }
  if (file === 'src/sim/checkpoints.ts') return 'gates';
  if (file.startsWith('src/sim/')) return 'physics';
  if (file.startsWith('src/ai/')) return 'network-inputs';
  if (file.startsWith('src/training/')) return 'training-harness';
  return 'other-src';
}

/** Summarises a profile. Throws RangeError for a profile that is not usable (no nodes, or samples and deltas of different lengths). */
export function summariseProfile(profile: CpuProfile, topCount = 15): ProfileSummary {
  if (profile === null || typeof profile !== 'object' || !Array.isArray(profile.nodes) || profile.nodes.length === 0) {
    throw new RangeError('The profile needs a non-empty "nodes" list.');
  }
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  if (samples.length !== deltas.length) throw new RangeError('The profile\'s "samples" and "timeDeltas" must have the same length.');
  const byId = new Map<number, ProfileNode>();
  for (const node of profile.nodes) byId.set(node.id, node);
  // A frame with an empty url takes its file from any other frame of the same script (same scriptId) that has one.
  const urlOfScript = new Map<string, string>();
  for (const node of profile.nodes) {
    const { scriptId, url } = node.callFrame;
    if (scriptId !== undefined && url !== '' && !urlOfScript.has(scriptId)) urlOfScript.set(scriptId, url);
  }
  const perGroup = new Map<ProfileGroup, number>();
  const perFunction = new Map<string, { name: string; file: string; group: ProfileGroup; microseconds: number }>();
  let total = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const node = byId.get(samples[i] as number);
    if (node === undefined) throw new RangeError(`The profile has a sample of unknown node ${String(samples[i])}.`);
    const weight = i + 1 < samples.length ? Math.max(0, deltas[i + 1] as number) : 0;
    const url = node.callFrame.url !== '' ? node.callFrame.url : (urlOfScript.get(node.callFrame.scriptId ?? '') ?? '');
    const file = sourcePath(url);
    const name = node.callFrame.functionName === '' ? '(anonymous)' : node.callFrame.functionName;
    const group = groupOf(file, name);
    perGroup.set(group, (perGroup.get(group) ?? 0) + weight);
    const key = `${file ?? url}\u0000${name}`;
    const entry = perFunction.get(key) ?? { name, file: file ?? url, group, microseconds: 0 };
    entry.microseconds += weight;
    perFunction.set(key, entry);
    total += weight;
  }
  const share = (us: number): number => (total > 0 ? us / total : 0);
  const groups = PROFILE_GROUPS.map((group) => ({ group, microseconds: perGroup.get(group) ?? 0, share: share(perGroup.get(group) ?? 0) }));
  const topFunctions = [...perFunction.values()]
    .sort((a, b) => b.microseconds - a.microseconds || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .slice(0, Math.max(0, topCount))
    .map((f) => ({ ...f, share: share(f.microseconds) }));
  return { samples: samples.length, totalMicroseconds: total, groups, topFunctions };
}
