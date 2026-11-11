// Controlled held-out access (P5-01 step 4): frozen rule and network agents, and the once-per-protocol gate.
// Every evaluation here runs on a SYNTHETIC held-out track in a synthetic registry (a scaled copy of the stadium oval
// under its own ID); the real held-out circuit is only ever refused, never evaluated.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import manifestData from '../../src/data/tracks/index.json';
import hairpinChicane from '../../src/data/tracks/hairpin-chicane.json';
import roundedRectangle from '../../src/data/tracks/rounded-rectangle.json';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { createNetworkDriver } from '../../src/ai/drivers';
import { PARAMETER_COUNT } from '../../src/ai/network';
import { createRuleBasedDriver, RULE_A3_NB_PARAMS, RULE_A3_PARAMS } from '../../src/ai/ruleBasedDriver';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { loadTrack } from '../../src/sim/track';
import { createEvaluationSetup, evaluateDriver } from '../../src/training/evaluation';
import {
  createHeldOutGate,
  driverForFrozenAgent,
  freezeNetworkAgent,
  freezeRuleAgent,
  frozenAgentName,
  HeldOutAccessError,
  RULE_AGENTS,
  type HeldOutProtocol,
} from '../../src/training/heldOutAccess';
import { freezeModel, heldOutTrack, loadTrackSplits, trackContentHash, TrackLeakageError } from '../../src/training/trackSplits';

// ---- A synthetic registry: the oval (training), the rounded rectangle (validation), a scaled oval (held-out) ----
const scale = (p: { x: number; y: number }, k: number) => ({ x: p.x * k, y: p.y * k });
const scaledOval = (() => {
  const t = stadiumOval as unknown as { outer: { x: number; y: number }[]; inner: { x: number; y: number }[]; start: { position: { x: number; y: number }; heading: number }; gates: { a: { x: number; y: number }; b: { x: number; y: number } }[] };
  return {
    ...stadiumOval,
    id: 'synthetic-held-out',
    name: 'Synthetic held-out (scaled oval)',
    outer: t.outer.map((p) => scale(p, 1.3)),
    inner: t.inner.map((p) => scale(p, 1.3)),
    start: { position: scale(t.start.position, 1.3), heading: t.start.heading },
    gates: t.gates.map((g) => ({ a: scale(g.a, 1.3), b: scale(g.b, 1.3) })),
  };
})();
const FILES = { 'stadium-oval.json': stadiumOval, 'rounded-rectangle.json': roundedRectangle, 'synthetic.json': scaledOval };
const SYNTHETIC_MANIFEST = {
  ...manifestData,
  tracks: [
    { id: 'stadium-oval', version: '1', split: 'training', file: 'stadium-oval.json', contentHash: trackContentHash(loadTrack(stadiumOval)), description: 'training' },
    { id: 'rounded-rectangle', version: '1', split: 'validation', file: 'rounded-rectangle.json', contentHash: trackContentHash(loadTrack(roundedRectangle)), description: 'validation' },
    { id: 'synthetic-held-out', version: '1', split: 'held-out', file: 'synthetic.json', contentHash: trackContentHash(loadTrack(scaledOval)), description: 'held-out' },
  ],
};
const SPLITS = loadTrackSplits(SYNTHETIC_MANIFEST, FILES);
const HELD = 'synthetic-held-out';

const network = (seed = 1) => freezeNetworkAgent(Array.from({ length: PARAMETER_COUNT }, (_, i) => Math.sin(i * 12.9898 + seed) * 0.8), { seed });
const protocol = (agents: readonly string[], over: Partial<HeldOutProtocol> = {}): HeldOutProtocol => ({
  protocolHash: `sha256:${'a'.repeat(64)}`,
  authorisationId: 'issue-33#comment-1',
  trackIds: [HELD],
  agentIds: agents,
  ...over,
});
const gateFor = (...models: { id: string }[]) => createHeldOutGate(protocol(models.map((m) => m.id)), SPLITS);

describe('the existing guards are untouched', () => {
  it('createEvaluationSetup still refuses the real held-out track and a renamed copy of it', () => {
    const env = (track: ReturnType<typeof loadTrack>) => ({ track, physics: DEFAULT_VEHICLE_PHYSICS, timestepSeconds: DEFAULT_SIM_CONFIG.timestepSeconds });
    expect(() => createEvaluationSetup({}, env(loadTrack(hairpinChicane)))).toThrow(TrackLeakageError);
    expect(() => createEvaluationSetup({}, env(loadTrack({ ...hairpinChicane, id: 'renamed-copy' })))).toThrow(TrackLeakageError);
  });
  it('heldOutTrack refuses anything that is not an unchanged frozen model (the real track is only refused, not evaluated)', () => {
    expect(() => heldOutTrack('hairpin-chicane', { parameters: [1], provenance: {}, id: 'x' } as never)).toThrow(TrackLeakageError);
  });
  it('only the evaluation module and the access module use buildEvaluationSetup', () => {
    const dir = join(__dirname, '../../src');
    const hits: string[] = [];
    const walk = (d: string): void => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const path = join(d, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry.name) && /\bbuildEvaluationSetup\b/.test(readFileSync(path, 'utf8'))) hits.push(path.replace(`${dir}/`, ''));
      }
    };
    walk(dir);
    expect(hits.sort()).toEqual(['training/evaluation.ts', 'training/heldOutAccess.ts']);
  });
});

describe('frozen agents', () => {
  it('the three rule agents are distinct frozen models carrying their agent name, algorithm and brake setting', () => {
    const models = RULE_AGENTS.map(freezeRuleAgent);
    expect(new Set(models.map((m) => m.id)).size).toBe(3);
    expect(models.map(frozenAgentName)).toEqual([...RULE_AGENTS]);
    expect(models.map((m) => m.provenance.brakeEnabled)).toEqual([true, false, false]);
    expect(models.every((m) => m.provenance.algorithm === 'rule-based-v1')).toBe(true);
  });
  it('A3-nb-same differs from A3 only in the brake setting; A3-nb has its own constants', () => {
    const [a3, nb, same] = RULE_AGENTS.map(freezeRuleAgent);
    expect(same!.parameters).toEqual(a3!.parameters);
    expect(same!.provenance.brakeEnabled).toBe(false);
    expect(a3!.provenance.brakeEnabled).toBe(true);
    expect(Array.from(nb!.parameters)).toEqual([RULE_A3_NB_PARAMS.steerGain, RULE_A3_NB_PARAMS.frontClear, RULE_A3_NB_PARAMS.speedCap, RULE_A3_NB_PARAMS.brakeFront, RULE_A3_NB_PARAMS.brakeSpeed]);
    expect(Array.from(a3!.parameters)).toEqual([RULE_A3_PARAMS.steerGain, RULE_A3_PARAMS.frontClear, RULE_A3_PARAMS.speedCap, RULE_A3_PARAMS.brakeFront, RULE_A3_PARAMS.brakeSpeed]);
  });
  it('the frozen identity is stable and changes with any constant', () => {
    expect(freezeRuleAgent('A3').id).toBe(freezeRuleAgent('A3').id);
    expect(freezeModel([...freezeRuleAgent('A3').parameters].map((v, i) => (i === 0 ? v + 0.01 : v)), { agent: 'A3', algorithm: 'rule-based-v1', brakeEnabled: true }).id).not.toBe(freezeRuleAgent('A3').id);
  });
  it('driverForFrozenAgent drives exactly like the driver it was frozen from', () => {
    const inputs = [0.9, 0.7, 0.4, 0.2, 0.8, 0.6, 0.9, 0.7, 0.1];
    const car = {} as never;
    for (const agent of RULE_AGENTS) {
      const frozen = driverForFrozenAgent(freezeRuleAgent(agent));
      const direct = createRuleBasedDriver(agent === 'A3-nb' ? RULE_A3_NB_PARAMS : RULE_A3_PARAMS, { brakeEnabled: agent === 'A3' });
      expect(frozen.decide({ car, inputs })).toEqual(direct.decide({ car, inputs }));
    }
    const net = network();
    expect(driverForFrozenAgent(net).decide({ car, inputs })).toEqual(createNetworkDriver(net.parameters, { brakeEnabled: true }).decide({ car, inputs }));
  });
  it('refuses a model that records no valid agent, an A5 without the brake, and a rule model of the wrong length', () => {
    expect(() => driverForFrozenAgent(freezeModel([1, 2, 3, 4, 5], {}))).toThrow(RangeError);
    expect(() => driverForFrozenAgent(freezeModel([1, 2, 3, 4, 5], { agent: 'A9', brakeEnabled: true }))).toThrow(RangeError);
    expect(() => driverForFrozenAgent(freezeModel(Array.from({ length: PARAMETER_COUNT }, () => 0), { agent: 'A5', brakeEnabled: false }))).toThrow(RangeError);
    expect(() => driverForFrozenAgent(freezeModel([1, 2, 3], { agent: 'A3', brakeEnabled: true }))).toThrow(RangeError);
    expect(() => freezeRuleAgent('A9' as never)).toThrow(RangeError);
    expect(() => frozenAgentName({ parameters: [1], provenance: { agent: 'A5' }, id: 'x' } as never)).toThrow(RangeError);
  });
});

describe('the gate: protocol checks', () => {
  const m = freezeRuleAgent('A3');
  it('accepts a valid protocol and freezes a copy', () => {
    const p = protocol([m.id]);
    const gate = createHeldOutGate(p, SPLITS);
    expect(gate.opened).toBe(false);
    expect(Object.isFrozen(gate.protocol)).toBe(true);
    (p.agentIds as string[]).push('sha256:' + 'b'.repeat(64));
    expect(gate.protocol.agentIds).toEqual([m.id]);
  });
  it.each([
    ['a bad protocol hash', { protocolHash: 'nope' }],
    ['an empty authorisation', { authorisationId: '' }],
    ['an authorisation with spaces', { authorisationId: 'a b' }],
    ['no tracks', { trackIds: [] }],
    ['a repeated track', { trackIds: [HELD, HELD] }],
    ['no agents', { agentIds: [] }],
    ['a malformed agent ID', { agentIds: ['x'] }],
    ['a repeated agent', { agentIds: [m.id, m.id] }],
  ])('refuses %s', (_name, over) => {
    expect(() => createHeldOutGate(protocol([m.id], over as never), SPLITS)).toThrow(HeldOutAccessError);
  });
  it('refuses a listed track that is not a registered held-out track (training, validation or unknown)', () => {
    for (const id of ['stadium-oval', 'rounded-rectangle', 'nope']) expect(() => createHeldOutGate(protocol([m.id], { trackIds: [id] }), SPLITS)).toThrow(TrackLeakageError);
  });
  it('the default registry is the built-in one: the real held-out track is accepted in a protocol, and a synthetic one is not', () => {
    expect(createHeldOutGate(protocol([m.id], { trackIds: ['hairpin-chicane'] })).opened).toBe(false);
    expect(() => createHeldOutGate(protocol([m.id]))).toThrow(TrackLeakageError);
  });
});

describe('the gate: opening once', () => {
  const m = freezeRuleAgent('A3');
  it('a wrong authorisation is refused and does not use up the opening', () => {
    const gate = gateFor(m);
    expect(() => gate.open('other')).toThrow(HeldOutAccessError);
    expect(gate.opened).toBe(false);
    expect(gate.open('issue-33#comment-1').opening.authorisationId).toBe('issue-33#comment-1');
    expect(gate.opened).toBe(true);
  });
  it('a second opening is refused', () => {
    const gate = gateFor(m);
    gate.open('issue-33#comment-1');
    expect(() => gate.open('issue-33#comment-1')).toThrow(/already been opened/);
  });
  it('the opening record carries the protocol hash, authorisation, tracks and agents and no time', () => {
    const opening = gateFor(m).open('issue-33#comment-1').opening;
    expect(opening).toEqual({ protocolHash: `sha256:${'a'.repeat(64)}`, authorisationId: 'issue-33#comment-1', trackIds: [HELD], agentIds: [m.id] });
    expect(Object.isFrozen(opening)).toBe(true);
  });
});

describe('the session: evaluating', () => {
  const rule = freezeRuleAgent('A3');
  const other = freezeRuleAgent('A3-nb');
  const net = network();

  it('evaluates a listed agent on the listed track and matches evaluating that driver directly on the same track', () => {
    const session = gateFor(rule).open('issue-33#comment-1');
    const result = session.evaluate(rule, HELD);
    const track = SPLITS.tracks.find((t) => t.id === HELD)!.track;
    // The same episode through the ordinary path on the same geometry, using a setup that is allowed (unregistered copy).
    const direct = evaluateDriver(driverForFrozenAgent(rule), createEvaluationSetup({}, { track: loadTrack({ ...scaledOval, id: 'direct-copy' }), physics: DEFAULT_VEHICLE_PHYSICS, timestepSeconds: DEFAULT_SIM_CONFIG.timestepSeconds }));
    expect(track.id).toBe(HELD);
    expect(result.episode).toEqual(direct.episode);
    expect(result.orderedProgress).toBe(direct.orderedProgress);
  });
  it('evaluates a network agent too, and records the pairs in order', () => {
    const session = gateFor(rule, net).open('issue-33#comment-1');
    session.evaluate(net, HELD);
    session.evaluate(rule, HELD);
    expect(session.evaluated()).toEqual([{ modelId: net.id, trackId: HELD }, { modelId: rule.id, trackId: HELD }]);
  });
  it('refuses a pair a second time (a held-out look is not repeated)', () => {
    const session = gateFor(rule).open('issue-33#comment-1');
    session.evaluate(rule, HELD);
    expect(() => session.evaluate(rule, HELD)).toThrow(/already been evaluated/);
  });
  it('refuses an agent or track the protocol does not list, and an unfrozen model', () => {
    const session = gateFor(rule).open('issue-33#comment-1');
    expect(() => session.evaluate(other, HELD)).toThrow(/not listed/);
    expect(() => session.evaluate(rule, 'stadium-oval')).toThrow(/not listed/);
    expect(() => session.evaluate({ ...rule } as never, HELD)).toThrow(TrackLeakageError);
    expect(() => session.evaluate({ ...rule, parameters: [...rule.parameters] } as never, HELD)).toThrow(TrackLeakageError);
    expect(session.evaluated()).toEqual([]);
  });
  it('a refused call does not count as a look', () => {
    const session = gateFor(rule).open('issue-33#comment-1');
    expect(() => session.evaluate(other, HELD)).toThrow(HeldOutAccessError);
    session.evaluate(rule, HELD);
    expect(session.evaluated()).toHaveLength(1);
  });
  it('still refuses an unknown evaluation config field', () => {
    const session = gateFor(rule).open('issue-33#comment-1');
    expect(() => session.evaluate(rule, HELD, { bogus: 1 })).toThrow(RangeError);
  });
});
