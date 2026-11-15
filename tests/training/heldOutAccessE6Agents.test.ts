// The E6 baselines as frozen agents in the held-out gate (P5-04 step 2, docs/plans/p5-04-plan.md): A2 (an untrained network, all outputs
// active) and the random-action drivers A1 and A7. Identity, brake and algorithm binding, that each drives exactly like the driver it was
// frozen from, that the existing agents' identities are untouched, and that the gate evaluates each once on a SYNTHETIC held-out track.
// The real held-out circuits are never evaluated here, and nothing here is a study result.
import { describe, expect, it } from 'vitest';
import manifestData from '../../src/data/tracks/index.json';
import roundedRectangle from '../../src/data/tracks/rounded-rectangle.json';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { createNetworkDriver } from '../../src/ai/drivers';
import { PARAMETER_COUNT } from '../../src/ai/network';
import { CORRELATED_HOLD_TICKS, createCorrelatedRandomDriver, createRandomDriver, RANDOM_ACTION_ALGORITHM } from '../../src/ai/randomDrivers';
import { loadTrack } from '../../src/sim/track';
import {
  createHeldOutGate,
  createMemoryLedger,
  driverForFrozenAgent,
  freezeNetworkAgent,
  freezeNoBrakeNetworkAgent,
  freezeRandomAgent,
  freezeRuleAgent,
  freezeUntrainedNetworkAgent,
  frozenAgentName,
  HeldOutAccessError,
  type HeldOutProtocol,
} from '../../src/training/heldOutAccess';
import { freezeModel, loadTrackSplits, trackContentHash } from '../../src/training/trackSplits';

const parameters = (seed = 1): number[] => Array.from({ length: PARAMETER_COUNT }, (_, i) => Math.sin(i * 12.9898 + seed) * 0.8);
const INPUTS = [0.9, 0.7, 0.4, 0.2, 0.8, 0.6, 0.9, 0.7, 0.1];
const car = {} as never;

describe('A2, the untrained network', () => {
  it('is recorded as A2 with every output active, and is a different identity from an A5 with the same weights', () => {
    const a2 = freezeUntrainedNetworkAgent(parameters(), { trainingSeed: 2001, genomeIndex: 0 });
    const a5 = freezeNetworkAgent(parameters(), { trainingSeed: 2001, genomeIndex: 0 });
    expect(frozenAgentName(a2)).toBe('A2');
    expect(a2.provenance).toMatchObject({ agent: 'A2', brakeEnabled: true, trainingSeed: 2001, genomeIndex: 0 });
    expect(a2.id).not.toBe(a5.id); // the agent name is part of the identity: an untrained network is not an evolved champion
  });
  it('drives exactly like a network with the brake enabled', () => {
    const a2 = driverForFrozenAgent(freezeUntrainedNetworkAgent(parameters(3)));
    const direct = createNetworkDriver(parameters(3), { brakeEnabled: true });
    for (let k = 0; k < 40; k += 1) {
      const inputs = INPUTS.map((v, i) => Math.abs(Math.sin(k * 1.7 + i)) * v);
      expect(a2.decide({ car, inputs })).toEqual(direct.decide({ car, inputs }));
    }
  });
  it('refuses an A2 that records the brake off and a wrong network size', () => {
    expect(() => driverForFrozenAgent(freezeModel(parameters(), { agent: 'A2', brakeEnabled: false }))).toThrow(/A2 model must record brakeEnabled = true/);
    expect(() => driverForFrozenAgent(freezeModel([1, 2, 3], { agent: 'A2', brakeEnabled: true }))).toThrow();
  });
});

describe('A1 and A7, the random-action drivers', () => {
  it('are recorded with the published algorithm, their hold and every output active, and differ by agent and by seed', () => {
    const a1 = freezeRandomAgent('A1', 7);
    const a7 = freezeRandomAgent('A7', 7);
    expect(frozenAgentName(a1)).toBe('A1');
    expect(frozenAgentName(a7)).toBe('A7');
    expect(a1.provenance).toMatchObject({ agent: 'A1', algorithm: RANDOM_ACTION_ALGORITHM, holdTicks: 1, brakeEnabled: true });
    expect(a7.provenance).toMatchObject({ agent: 'A7', algorithm: RANDOM_ACTION_ALGORITHM, holdTicks: CORRELATED_HOLD_TICKS, brakeEnabled: true });
    expect([...a1.parameters]).toEqual([7]);
    expect(new Set([a1.id, a7.id, freezeRandomAgent('A1', 8).id, freezeRandomAgent('A7', 8).id]).size).toBe(4);
    expect(freezeRandomAgent('A1', 7).id).toBe(a1.id); // deterministic
  });
  it('drive exactly like the driver they were frozen from, and a reset restarts the stream', () => {
    const cases = [
      [freezeRandomAgent('A1', 12345), createRandomDriver(12345)],
      [freezeRandomAgent('A7', 12345), createCorrelatedRandomDriver(12345)],
    ] as const;
    for (const [model, direct] of cases) {
      const driver = driverForFrozenAgent(model);
      const first = Array.from({ length: 100 }, () => driver.decide({ car, inputs: INPUTS }));
      for (const c of first) expect(c).toEqual(direct.decide({ car, inputs: INPUTS }));
      driver.reset();
      const again = Array.from({ length: 100 }, () => driver.decide({ car, inputs: INPUTS }));
      expect(again).toEqual(first);
    }
  });
  it('A7 holds each action for 30 ticks and A1 draws a new one every tick', () => {
    const a7 = driverForFrozenAgent(freezeRandomAgent('A7', 9));
    const held = Array.from({ length: 61 }, () => a7.decide({ car, inputs: INPUTS }));
    expect(new Set(held.slice(0, 30).map((c) => JSON.stringify(c))).size).toBe(1);
    expect(new Set(held.slice(30, 60).map((c) => JSON.stringify(c))).size).toBe(1);
    expect(JSON.stringify(held[29])).not.toBe(JSON.stringify(held[30]));
    const a1 = driverForFrozenAgent(freezeRandomAgent('A1', 9));
    const drawn = Array.from({ length: 20 }, () => JSON.stringify(a1.decide({ car, inputs: INPUTS })));
    expect(new Set(drawn).size).toBe(20);
  });
  it('are refused when the model is not exactly the agent it names', () => {
    const base = { algorithm: RANDOM_ACTION_ALGORITHM, brakeEnabled: true };
    expect(() => driverForFrozenAgent(freezeModel([5], { ...base, agent: 'A1', holdTicks: 1, algorithm: 'other-v2' }))).toThrow(/must record algorithm/);
    expect(() => driverForFrozenAgent(freezeModel([5], { ...base, agent: 'A1', holdTicks: 30 }))).toThrow(/A1's hold is 1/);
    expect(() => driverForFrozenAgent(freezeModel([5], { ...base, agent: 'A7', holdTicks: 1 }))).toThrow(/A7's hold is 30/);
    expect(() => driverForFrozenAgent(freezeModel([5], { ...base, agent: 'A7', holdTicks: 15 }))).toThrow(/A7's hold is 30/);
    expect(() => driverForFrozenAgent(freezeModel([5], { ...base, agent: 'A1', holdTicks: 1, brakeEnabled: false }))).toThrow(/brakeEnabled = true/);
    expect(() => driverForFrozenAgent(freezeModel([5, 6], { ...base, agent: 'A1', holdTicks: 1 }))).toThrow(/exactly one parameter/);
    expect(() => driverForFrozenAgent(freezeModel([2.5], { ...base, agent: 'A1', holdTicks: 1 }))).toThrow(RangeError); // not an integer seed
    expect(() => driverForFrozenAgent(freezeModel([-1], { ...base, agent: 'A7', holdTicks: 30 }))).toThrow(RangeError);
    expect(() => driverForFrozenAgent(freezeModel([2 ** 32], { ...base, agent: 'A1', holdTicks: 1 }))).toThrow(RangeError);
    expect(() => driverForFrozenAgent(freezeModel([5], { agent: 'A1', holdTicks: 1, brakeEnabled: true }))).toThrow(/must record algorithm/);
    expect(() => freezeRandomAgent('A5' as never, 1)).toThrow(RangeError);
  });
  it('a model altered after freezing is refused (the integrity check, not only the contract)', () => {
    const model = freezeRandomAgent('A1', 4);
    const altered = Object.freeze({ ...model, parameters: Object.freeze([5]) });
    expect(() => driverForFrozenAgent(altered)).toThrow(RangeError);
  });
});

describe('the existing agents are untouched, and agents outside E6 are still refused', () => {
  it('every supported name resolves, with its own binding, and A6, A8 and A9 are not agents of the gate', () => {
    expect(frozenAgentName(freezeNetworkAgent(parameters()))).toBe('A5');
    expect(frozenAgentName(freezeNoBrakeNetworkAgent(parameters()))).toBe('A4');
    expect(frozenAgentName(freezeRuleAgent('A3'))).toBe('A3');
    expect(driverForFrozenAgent(freezeNoBrakeNetworkAgent(parameters())).decide({ car, inputs: INPUTS }).brake).toBe(0);
    for (const name of ['A6', 'A8', 'A9']) expect(() => driverForFrozenAgent(freezeModel(parameters(), { agent: name, brakeEnabled: true }))).toThrow(RangeError);
  });
});

describe('the gate evaluates the E6 baselines once each, on a synthetic held-out track', () => {
  const scale = (p: { x: number; y: number }, k: number) => ({ x: p.x * k, y: p.y * k });
  const t = stadiumOval as unknown as { outer: { x: number; y: number }[]; inner: { x: number; y: number }[]; start: { position: { x: number; y: number }; heading: number }; gates: { a: { x: number; y: number }; b: { x: number; y: number } }[] };
  const scaledOval = {
    ...stadiumOval,
    id: 'synthetic-held-out',
    name: 'Synthetic held-out (scaled oval)',
    outer: t.outer.map((p) => scale(p, 1.3)),
    inner: t.inner.map((p) => scale(p, 1.3)),
    start: { position: scale(t.start.position, 1.3), heading: t.start.heading },
    gates: t.gates.map((g) => ({ a: scale(g.a, 1.3), b: scale(g.b, 1.3) })),
  };
  const SPLITS = loadTrackSplits(
    {
      ...manifestData,
      tracks: [
        { id: 'stadium-oval', version: '1', split: 'training', file: 'stadium-oval.json', contentHash: trackContentHash(loadTrack(stadiumOval)), description: 'training' },
        { id: 'rounded-rectangle', version: '1', split: 'validation', file: 'rounded-rectangle.json', contentHash: trackContentHash(loadTrack(roundedRectangle)), description: 'validation' },
        { id: 'synthetic-held-out', version: '1', split: 'held-out', file: 'synthetic.json', contentHash: trackContentHash(loadTrack(scaledOval)), description: 'held-out' },
      ],
    },
    { 'stadium-oval.json': stadiumOval, 'rounded-rectangle.json': roundedRectangle, 'synthetic.json': scaledOval },
  );
  const protocol = (agents: readonly string[]): HeldOutProtocol => ({ protocolHash: `sha256:${'c'.repeat(64)}`, authorisationId: 'issue-36#comment-1', trackIds: ['synthetic-held-out'], agentIds: agents });
  const roster = () => [freezeRandomAgent('A1', 11), freezeRandomAgent('A7', 12), freezeUntrainedNetworkAgent(parameters(7), { trainingSeed: 2001, genomeIndex: 0 }), freezeRuleAgent('A3')];

  it('lists A1, A7, A2 and A3, evaluates each once through the five protocol starts, and refuses a repeat and an unlisted agent', () => {
    const agents = roster();
    const session = createHeldOutGate(protocol(agents.map((m) => m.id)), createMemoryLedger(), SPLITS).open('issue-36#comment-1');
    for (const model of agents) {
      const results = session.evaluateStarts(model, 'synthetic-held-out');
      expect(results).toHaveLength(5);
      for (const r of results) expect(r.episode.outcome).not.toBeNull();
    }
    expect(() => session.evaluateStarts(agents[0]!, 'synthetic-held-out')).toThrow(/already been evaluated/);
    expect(() => session.evaluate(agents[1]!, 'synthetic-held-out')).toThrow(/already been evaluated/);
    expect(() => session.evaluateStarts(freezeRandomAgent('A1', 99), 'synthetic-held-out')).toThrow(HeldOutAccessError);
  });
  it('is deterministic: the same frozen random agent gives the same five results through two separate gates', () => {
    const run = () => {
      const model = freezeRandomAgent('A7', 31);
      const session = createHeldOutGate(protocol([model.id]), createMemoryLedger(), SPLITS).open('issue-36#comment-1');
      return JSON.stringify(session.evaluateStarts(model, 'synthetic-held-out'));
    };
    expect(run()).toBe(run());
  });
  it('refuses a random agent on a training or validation circuit (the gate evaluates held-out circuits only)', () => {
    const model = freezeRandomAgent('A1', 3);
    for (const trackId of ['stadium-oval', 'rounded-rectangle']) {
      expect(() => createHeldOutGate({ ...protocol([model.id]), trackIds: [trackId] }, createMemoryLedger(), SPLITS)).toThrow();
    }
  });
});
