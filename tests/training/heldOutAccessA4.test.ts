// The A4 (brake-masked) frozen agent in the held-out gate (P5-02 step 2, docs/plans/p5-02-plan.md): its identity, its brake binding, that it
// drives exactly like the driver it was frozen from, that E4's ten committed A4 and A5 champions are accepted unchanged, and that the
// gate can evaluate one on a SYNTHETIC held-out track (the real held-out circuits are never evaluated here).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import manifestData from '../../src/data/tracks/index.json';
import roundedRectangle from '../../src/data/tracks/rounded-rectangle.json';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { createNetworkDriver } from '../../src/ai/drivers';
import { PARAMETER_COUNT } from '../../src/ai/network';
import { loadTrack } from '../../src/sim/track';
import {
  createHeldOutGate,
  createMemoryLedger,
  driverForFrozenAgent,
  freezeNetworkAgent,
  freezeNoBrakeNetworkAgent,
  frozenAgentName,
  HeldOutAccessError,
  NO_BRAKE_NETWORK_AGENT,
  type HeldOutProtocol,
} from '../../src/training/heldOutAccess';
import { freezeModel, loadTrackSplits, trackContentHash } from '../../src/training/trackSplits';

const parameters = (seed = 1): number[] => Array.from({ length: PARAMETER_COUNT }, (_, i) => Math.sin(i * 12.9898 + seed) * 0.8);
const INPUTS = [0.9, 0.7, 0.4, 0.2, 0.8, 0.6, 0.9, 0.7, 0.1];

describe('the A4 frozen agent', () => {
  it('is recorded as A4 with the brake masked, and is a different identity from an A5 with the same weights', () => {
    const a4 = freezeNoBrakeNetworkAgent(parameters(), { seed: 1 });
    const a5 = freezeNetworkAgent(parameters(), { seed: 1 });
    expect(NO_BRAKE_NETWORK_AGENT).toBe('A4');
    expect(frozenAgentName(a4)).toBe('A4');
    expect(frozenAgentName(a5)).toBe('A5');
    expect(a4.provenance).toMatchObject({ agent: 'A4', brakeEnabled: false });
    expect(a4.id).not.toBe(a5.id); // the brake binding is part of the identity
  });

  it('drives exactly like a no-brake network and never brakes; the same weights as an A5 can brake', () => {
    const a4 = driverForFrozenAgent(freezeNoBrakeNetworkAgent(parameters(3)));
    const direct = createNetworkDriver(parameters(3), { brakeEnabled: false });
    const a5 = createNetworkDriver(parameters(3), { brakeEnabled: true });
    const car = {} as never;
    let a5Braked = false;
    for (let k = 0; k < 40; k += 1) {
      const inputs = INPUTS.map((v, i) => Math.abs(Math.sin(k * 1.7 + i)) * v);
      const controls = a4.decide({ car, inputs });
      expect(controls).toEqual(direct.decide({ car, inputs }));
      expect(controls.brake).toBe(0);
      if (a5.decide({ car, inputs }).brake > 0) a5Braked = true;
    }
    expect(a5Braked).toBe(true); // so "never brakes" above is the mask, not an accident of these inputs
  });

  it('refuses an A4 that records the brake on, an A5 that records it off, and an unsupported agent name', () => {
    expect(() => driverForFrozenAgent(freezeModel(parameters(), { agent: 'A4', brakeEnabled: true }))).toThrow(/A4 model must record brakeEnabled = false/);
    expect(() => driverForFrozenAgent(freezeModel(parameters(), { agent: 'A5', brakeEnabled: false }))).toThrow(/A5 model must record brakeEnabled = true/);
    expect(() => driverForFrozenAgent(freezeModel(parameters(), { agent: 'A6', brakeEnabled: false }))).toThrow(RangeError);
    expect(() => driverForFrozenAgent(freezeModel([1, 2, 3], { agent: 'A4', brakeEnabled: false }))).toThrow(); // a wrong network size
  });
});

describe("E4's ten committed A4 and A5 champions are accepted by the gate's identity checks, unchanged", () => {
  const dir = join(__dirname, '../../experiments/results/p2-09/e4');
  type Champion = { readonly id: string; readonly parameters: number[]; readonly provenance: Record<string, string | number | boolean> };
  const seeds = Array.from({ length: 10 }, (_, i) => 2001 + i);
  const champions = (seed: number): { A4: Champion; A5: Champion } => {
    const record = JSON.parse(gunzipSync(readFileSync(join(dir, `seed-${seed}.json.gz`))).toString()) as { agents: { A4: { model: Champion }; A5: { model: Champion } } };
    return { A4: record.agents.A4.model, A5: record.agents.A5.model };
  };
  it.each(seeds)('seed %i: both champions rebuild to their recorded identity, are named A4 and A5, and build a driver', (seed) => {
    const { A4, A5 } = champions(seed);
    for (const [name, champion] of [['A4', A4], ['A5', A5]] as const) {
      const rebuilt = freezeModel(champion.parameters, champion.provenance);
      expect(rebuilt.id).toBe(champion.id);
      expect(frozenAgentName(rebuilt)).toBe(name);
      expect(rebuilt.provenance.brakeEnabled).toBe(name === 'A5');
      expect(() => driverForFrozenAgent(rebuilt)).not.toThrow();
    }
    expect(A4.id).not.toBe(A5.id);
  });
});

describe('the gate evaluates an A4 once, on a synthetic held-out track', () => {
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
  const protocol = (agents: readonly string[]): HeldOutProtocol => ({ protocolHash: `sha256:${'b'.repeat(64)}`, authorisationId: 'issue-34#comment-1', trackIds: ['synthetic-held-out'], agentIds: agents });

  it('lists an A4 and an A5, evaluates each once on the synthetic circuit, refuses a repeat and an unlisted A4', () => {
    const a4 = freezeNoBrakeNetworkAgent(parameters(5), { seed: 5 });
    const a5 = freezeNetworkAgent(parameters(5), { seed: 5 });
    const other = freezeNoBrakeNetworkAgent(parameters(6), { seed: 6 });
    const session = createHeldOutGate(protocol([a4.id, a5.id]), createMemoryLedger(), SPLITS).open('issue-34#comment-1');
    const r4 = session.evaluate(a4, 'synthetic-held-out');
    const r5 = session.evaluate(a5, 'synthetic-held-out');
    expect(r4.episode.outcome).not.toBeNull();
    expect(r5.episode.outcome).not.toBeNull();
    expect(() => session.evaluate(a4, 'synthetic-held-out')).toThrow(/already been evaluated/);
    expect(() => session.evaluate(other, 'synthetic-held-out')).toThrow(HeldOutAccessError);
    expect(session.evaluated().map((e) => e.modelId)).toEqual([a4.id, a5.id]);
  });

  it('an observing wrapper sees every tick of the gate-built driver and leaves the episode unchanged', () => {
    const a5 = freezeNetworkAgent(parameters(5), { seed: 5 });
    const open = () => createHeldOutGate(protocol([a5.id]), createMemoryLedger(), SPLITS).open('issue-34#comment-1');
    const plain = open().evaluate(a5, 'synthetic-held-out');
    let decisions = 0;
    let resets = 0;
    const watched = open().evaluate(a5, 'synthetic-held-out', {}, (driver) => ({
      decide(observation) {
        decisions += 1;
        return driver.decide(observation);
      },
      reset() {
        resets += 1;
        driver.reset();
      },
    }));
    expect(resets).toBeGreaterThanOrEqual(1);
    expect(decisions).toBeGreaterThan(0);
    expect(watched.episode).toEqual(plain.episode);
  });
});
