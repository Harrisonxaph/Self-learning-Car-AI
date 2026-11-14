// Controlled held-out access for E3 (P5-01 step 4; docs/plans/p5-01-plan.md §4). Headless and deterministic.
//
// Nothing here runs a study. This module is the ONE entry point through which a frozen agent may be evaluated on a
// held-out track, and it makes a held-out look hard to repeat or widen by accident:
//  - `createEvaluationSetup` (evaluation.ts) still refuses held-out tracks; this module reaches them only through
//    `heldOutTrack(id, frozenModel)`, which refuses anything that did not come unchanged from `freezeModel` and hands
//    back the registered track itself (a renamed or edited copy is never evaluated);
//  - a gate is created for one protocol (its hash, one authorisation ID, the listed held-out tracks and the listed
//    frozen agents) with an OPENING LEDGER supplied by the caller, and the protocol can be OPENED ONCE: the opening is
//    claimed in the ledger before any access is returned, so a gate re-created for the same protocol (in the same
//    process or after a restart, from the persisted ledger) is refused; a wrong authorisation ID is refused without
//    claiming anything. There is deliberately NO hidden module-level state: persistence is the caller's, and the E3
//    runner must pass a ledger restored from the record's recorded openings;
//  - an opened session evaluates each listed (agent, track) pair at most once, and nothing outside the lists.
// Evolved networks are frozen as A5 (the brake output on) or, for E5 (docs/plans/p5-02-plan.md), A4 (the brake output masked); an agent's brake binding is part of its identity and is checked before a driver is built.
// The rule-based drivers are frozen the same way as networks: their five constants become a FrozenModel's parameters,
// with the agent name, algorithm and brake setting in its provenance, so their identity is a content hash too.
import { createNetworkDriver, type EpisodeDriver } from '../ai/drivers';
import {
  createRuleBasedDriver,
  RULE_A3_NB_PARAMS,
  RULE_A3_PARAMS,
  RULE_BASED_ALGORITHM,
  type RuleParams,
} from '../ai/ruleBasedDriver';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../sim/config';
import { buildEvaluationSetup, evaluateDriver, type DriverEvaluation } from './evaluation';
import { modelBrakeEnabled } from './frozenModelBrake';
import {
  BUILT_IN_TRACK_SPLITS,
  freezeModel,
  heldOutTrack,
  isFrozenModel,
  TrackLeakageError,
  type FrozenModel,
  type TrackSplits,
} from './trackSplits';

/** The three rule agents E3 evaluates (plan §3): tuned A3, separately tuned A3-nb, and the derived brake ablation. */
export const RULE_AGENTS = Object.freeze(['A3', 'A3-nb', 'A3-nb-same'] as const);
export type RuleAgent = (typeof RULE_AGENTS)[number];
/** The evolved agent. Its frozen models carry `provenance.agent = 'A5'` and `provenance.brakeEnabled = true`. */
export const NETWORK_AGENT = 'A5';
/** The evolved no-brake agent of E4 and E5. Its frozen models carry `provenance.agent = 'A4'` and `provenance.brakeEnabled = false`. */
export const NO_BRAKE_NETWORK_AGENT = 'A4';
/** Every agent name a frozen model may record. */
export type FrozenAgentName = RuleAgent | typeof NETWORK_AGENT | typeof NO_BRAKE_NETWORK_AGENT;

const RULE_SETTINGS: Readonly<Record<RuleAgent, { readonly params: RuleParams; readonly brakeEnabled: boolean }>> = Object.freeze({
  A3: Object.freeze({ params: RULE_A3_PARAMS, brakeEnabled: true }),
  'A3-nb': Object.freeze({ params: RULE_A3_NB_PARAMS, brakeEnabled: false }),
  'A3-nb-same': Object.freeze({ params: RULE_A3_PARAMS, brakeEnabled: false }),
});

const PARAM_ORDER = ['steerGain', 'frontClear', 'speedCap', 'brakeFront', 'brakeSpeed'] as const;

/** A rule agent as a frozen model: its constants in a fixed order as `parameters`, the rest in `provenance`. */
export function freezeRuleAgent(agent: RuleAgent): FrozenModel {
  const settings = RULE_SETTINGS[agent];
  if (settings === undefined) throw new RangeError(`Unknown rule agent "${String(agent)}"; allowed: ${RULE_AGENTS.join(', ')}.`);
  return freezeModel(
    PARAM_ORDER.map((key) => settings.params[key]),
    { agent, algorithm: RULE_BASED_ALGORITHM, brakeEnabled: settings.brakeEnabled },
  );
}

/** An evolved champion as a frozen model, recorded as A5 with the brake enabled. */
export function freezeNetworkAgent(parameters: ArrayLike<number>, provenance: Readonly<Record<string, string | number | boolean>> = {}): FrozenModel {
  return freezeModel(parameters, { ...provenance, agent: NETWORK_AGENT, brakeEnabled: true });
}

/** An evolved no-brake champion as a frozen model, recorded as A4 with the brake masked (E4's and E5's no-brake agent). */
export function freezeNoBrakeNetworkAgent(parameters: ArrayLike<number>, provenance: Readonly<Record<string, string | number | boolean>> = {}): FrozenModel {
  return freezeModel(parameters, { ...provenance, agent: NO_BRAKE_NETWORK_AGENT, brakeEnabled: false });
}

/** The agent a frozen model records (`provenance.agent`), or throws RangeError for a model that records none. */
export function frozenAgentName(model: FrozenModel): FrozenAgentName {
  if (!isFrozenModel(model)) throw new RangeError('model must be an unchanged frozen model (freezeModel).');
  const agent: unknown = model.provenance.agent;
  if (agent === NETWORK_AGENT || agent === NO_BRAKE_NETWORK_AGENT || (RULE_AGENTS as readonly unknown[]).includes(agent)) return agent as FrozenAgentName;
  throw new RangeError(`model.provenance.agent must be ${[NETWORK_AGENT, NO_BRAKE_NETWORK_AGENT, ...RULE_AGENTS].join(', ')}, got ${String(agent)}.`);
}

/**
 * The driver for a frozen agent, exactly as it was frozen: a rule agent's constants and brake setting from the model, or
 * an A5 network with the brake enabled. Throws RangeError for a model that is not a valid agent.
 */
export function driverForFrozenAgent(model: FrozenModel): EpisodeDriver {
  const agent = frozenAgentName(model);
  const brakeEnabled = modelBrakeEnabled(model);
  if (agent === NETWORK_AGENT) {
    if (!brakeEnabled) throw new RangeError('An A5 model must record brakeEnabled = true.');
    return createNetworkDriver(model.parameters, { brakeEnabled });
  }
  if (agent === NO_BRAKE_NETWORK_AGENT) {
    // The brake binding is part of an agent's identity: an A4 model that records the brake on is not the agent it names.
    if (brakeEnabled) throw new RangeError('An A4 model must record brakeEnabled = false.');
    return createNetworkDriver(model.parameters, { brakeEnabled });
  }
  checkRuleModel(agent as RuleAgent, model, brakeEnabled);
  const params = Object.fromEntries(PARAM_ORDER.map((key, i) => [key, model.parameters[i]!])) as unknown as RuleParams;
  return createRuleBasedDriver(params, { brakeEnabled });
}

/**
 * A frozen rule model must be exactly the agent it names under the supported rule contract: the supported algorithm
 * version, that agent's brake binding (A3 on, A3-nb and A3-nb-same off) and that agent's frozen constants. An
 * unchanged `freezeModel` only proves integrity, not that today's rule is what the model describes.
 */
function checkRuleModel(agent: RuleAgent, model: FrozenModel, brakeEnabled: boolean): void {
  const settings = RULE_SETTINGS[agent];
  if (model.provenance.algorithm !== RULE_BASED_ALGORITHM) {
    throw new RangeError(`A rule agent's model must record algorithm ${RULE_BASED_ALGORITHM}, got ${String(model.provenance.algorithm)}.`);
  }
  if (brakeEnabled !== settings.brakeEnabled) {
    throw new RangeError(`${agent} is defined with brakeEnabled = ${settings.brakeEnabled}, but the model records ${brakeEnabled}.`);
  }
  if (model.parameters.length !== PARAM_ORDER.length) throw new RangeError(`A rule agent's model needs exactly ${PARAM_ORDER.length} parameters.`);
  PARAM_ORDER.forEach((key, i) => {
    if (model.parameters[i] !== settings.params[key]) throw new RangeError(`${agent}'s ${key} must be ${settings.params[key]}, got ${model.parameters[i]}.`);
  });
}

// ---------------------------------------------------------------------------------------------------------------
// The opening ledger.

/**
 * The record of which protocols have been opened, supplied by the caller. `claim` records an opening and throws if the
 * protocol's hash is already there; checking and recording happen in one step, so a repeat is refused whoever asks.
 * A study persists `openings()` in its record and restores the ledger from it on restart.
 */
export interface OpeningLedger {
  openings(): readonly HeldOutOpening[];
  claim(opening: HeldOutOpening): void;
}

/** An in-memory ledger, optionally restored from recorded openings (refused if malformed or a protocol repeats). */
export function createMemoryLedger(recorded: readonly HeldOutOpening[] = []): OpeningLedger {
  const openings: HeldOutOpening[] = [];
  const add = (opening: HeldOutOpening): void => {
    const checked = checkOpening(opening);
    if (openings.some((o) => o.protocolHash === checked.protocolHash)) {
      throw new HeldOutAccessError(`Protocol ${checked.protocolHash} has already been opened (recorded in the opening ledger).`);
    }
    openings.push(checked);
  };
  if (!Array.isArray(recorded)) throw new HeldOutAccessError('Recorded openings must be an array.');
  for (const opening of recorded) add(opening);
  return { openings: () => openings.map((o) => ({ ...o })), claim: add };
}

function checkOpening(value: unknown): HeldOutOpening {
  if (value === null || typeof value !== 'object') throw new HeldOutAccessError('An opening must be an object.');
  const o = value as Record<string, unknown>;
  if (typeof o.protocolHash !== 'string' || !HASH.test(o.protocolHash)) throw new HeldOutAccessError('An opening\'s protocolHash must be a sha256 hash.');
  if (typeof o.authorisationId !== 'string' || !AUTHORISATION_ID.test(o.authorisationId)) throw new HeldOutAccessError('An opening\'s authorisationId is malformed.');
  const trackIds = copyList(o.trackIds, 'opening.trackIds', (v) => typeof v === 'string' && v.length > 0, 'a track ID');
  const agentIds = copyList(o.agentIds, 'opening.agentIds', (v) => typeof v === 'string' && HASH.test(v), 'a frozen model ID (sha256:…)');
  return Object.freeze({ protocolHash: o.protocolHash, authorisationId: o.authorisationId, trackIds, agentIds });
}

// ---------------------------------------------------------------------------------------------------------------
// The gate.

export class HeldOutAccessError extends Error {
  override name = 'HeldOutAccessError';
}

const HASH = /^sha256:[0-9a-f]{64}$/;
const AUTHORISATION_ID = /^[A-Za-z0-9._:/#-]{1,200}$/;

/** What a protocol lists: only these agents may be evaluated on only these held-out tracks. */
export interface HeldOutProtocol {
  /** The hash of the predeclared protocol or manifest (`sha256:…`), carried into the opening record. */
  readonly protocolHash: string;
  /** The owner's authorisation for this opening, for example an issue-comment reference. */
  readonly authorisationId: string;
  /** Held-out track IDs, distinct. */
  readonly trackIds: readonly string[];
  /** Frozen model IDs (`sha256:…`), distinct. */
  readonly agentIds: readonly string[];
}

/** The record of an opening, for the study's record file. It holds no time, so a replay is deterministic. */
export interface HeldOutOpening {
  readonly protocolHash: string;
  readonly authorisationId: string;
  readonly trackIds: readonly string[];
  readonly agentIds: readonly string[];
}

export interface HeldOutSession {
  readonly opening: HeldOutOpening;
  /** Evaluates one listed frozen agent on one listed held-out track, once. */
  evaluate(model: FrozenModel, trackId: string, config?: unknown): DriverEvaluation;
  /** The pairs evaluated so far, in order. */
  evaluated(): readonly { readonly modelId: string; readonly trackId: string }[];
}

export interface HeldOutGate {
  readonly protocol: HeldOutProtocol;
  /** True once `open` has succeeded. */
  readonly opened: boolean;
  /** Opens the gate for the protocol's own authorisation ID, once. A wrong ID is refused and does not use the opening up. */
  open(authorisationId: string): HeldOutSession;
}

const copyList = (values: unknown, name: string, check: (v: unknown) => boolean, what: string): readonly string[] => {
  if (!Array.isArray(values) || values.length === 0) throw new HeldOutAccessError(`${name} must be a non-empty array.`);
  const copy: string[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const value: unknown = values[i];
    if (typeof value !== 'string' || !check(value)) throw new HeldOutAccessError(`${name}[${i}] must be ${what}.`);
    copy.push(value);
  }
  if (new Set(copy).size !== copy.length) throw new HeldOutAccessError(`${name} must be distinct.`);
  return Object.freeze(copy);
};

/**
 * A gate for one protocol. Throws HeldOutAccessError for a malformed protocol and TrackLeakageError if a listed track
 * is not a registered held-out track. `splits` is for tests (a synthetic registry); the default is the built-in one.
 */
export function createHeldOutGate(protocol: HeldOutProtocol, ledger: OpeningLedger, splits: TrackSplits = BUILT_IN_TRACK_SPLITS): HeldOutGate {
  if (ledger === null || typeof ledger !== 'object' || typeof ledger.claim !== 'function' || typeof ledger.openings !== 'function') {
    throw new HeldOutAccessError('A held-out gate needs an opening ledger (createMemoryLedger, restored from the record\'s recorded openings).');
  }
  if (protocol === null || typeof protocol !== 'object') throw new HeldOutAccessError('The protocol must be an object.');
  if (typeof protocol.protocolHash !== 'string' || !HASH.test(protocol.protocolHash)) throw new HeldOutAccessError('protocolHash must be a sha256 hash.');
  if (typeof protocol.authorisationId !== 'string' || !AUTHORISATION_ID.test(protocol.authorisationId)) {
    throw new HeldOutAccessError('authorisationId must be 1 to 200 letters, digits or . _ : / # - characters.');
  }
  const trackIds = copyList(protocol.trackIds, 'trackIds', (v) => typeof v === 'string' && v.length > 0, 'a track ID');
  const agentIds = copyList(protocol.agentIds, 'agentIds', (v) => typeof v === 'string' && HASH.test(v), 'a frozen model ID (sha256:…)');
  for (const id of trackIds) {
    const entry = splits.tracks.find((t) => t.id === id);
    if (entry === undefined || entry.split !== 'held-out') throw new TrackLeakageError(`"${id}" is not a registered held-out track; a held-out gate lists held-out tracks only.`);
  }
  const frozenProtocol: HeldOutProtocol = Object.freeze({ protocolHash: protocol.protocolHash, authorisationId: protocol.authorisationId, trackIds, agentIds });
  let opened = false;
  return {
    protocol: frozenProtocol,
    get opened() {
      return opened;
    },
    open(authorisationId: string): HeldOutSession {
      if (authorisationId !== frozenProtocol.authorisationId) throw new HeldOutAccessError('The authorisation ID does not match the protocol\'s; the gate stays closed.');
      if (opened) throw new HeldOutAccessError('This protocol\'s held-out gate has already been opened; it opens once.');
      const opening: HeldOutOpening = Object.freeze({ ...frozenProtocol });
      // Claimed in the ledger BEFORE access is returned: a protocol already recorded there (by another gate, or restored
      // after a restart) is refused here, and a ledger that cannot record the opening leaves the gate closed.
      if (ledger.openings().some((o) => o.protocolHash === opening.protocolHash)) {
        throw new HeldOutAccessError(`Protocol ${opening.protocolHash} has already been opened (recorded in the opening ledger); it opens once.`);
      }
      ledger.claim(opening);
      opened = true;
      const seen: { modelId: string; trackId: string }[] = [];
      return Object.freeze({
        opening,
        evaluate(model: FrozenModel, trackId: string, config: unknown = {}): DriverEvaluation {
          if (!isFrozenModel(model)) throw new TrackLeakageError('Held-out tracks are only for frozen models (freezeModel).');
          if (!frozenProtocol.agentIds.includes(model.id)) throw new HeldOutAccessError(`Agent ${model.id} is not listed in the protocol.`);
          if (!frozenProtocol.trackIds.includes(trackId)) throw new HeldOutAccessError(`Track "${trackId}" is not listed in the protocol.`);
          if (seen.some((s) => s.modelId === model.id && s.trackId === trackId)) {
            throw new HeldOutAccessError(`Agent ${model.id} has already been evaluated on "${trackId}"; each pair is evaluated once.`);
          }
          const track = heldOutTrack(trackId, model, splits);
          const driver = driverForFrozenAgent(model);
          // The track comes from heldOutTrack, so it is the registered held-out track of that ID by construction.
          const setup = buildEvaluationSetup(config, { track, physics: DEFAULT_VEHICLE_PHYSICS, timestepSeconds: DEFAULT_SIM_CONFIG.timestepSeconds }, () => 'held-out');
          // Recorded before the episode runs: a pair that started counts as looked at, even if the run were interrupted.
          seen.push({ modelId: model.id, trackId });
          return evaluateDriver(driver, setup);
        },
        evaluated: () => seen.map((s) => ({ ...s })),
      });
    },
  };
}
