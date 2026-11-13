import { describe, expect, it } from 'vitest';
import { PROFILE_GROUPS, groupOf, sourcePath, summariseProfile, type CpuProfile } from '../../src/training/profileSummary';

const frame = (id: number, functionName: string, url: string, scriptId = '1') => ({ id, callFrame: { functionName, url, scriptId } });
const R = '/home/u/repo/src/sensors/rays.ts';
const C = '/home/u/repo/src/sim/collision.ts';

describe('sourcePath', () => {
  it('keeps the repository-relative path and drops query strings and the file scheme', () => {
    expect(sourcePath('file:///home/u/repo/src/sim/collision.ts?t=1')).toBe('src/sim/collision.ts');
    expect(sourcePath('/home/u/repo/src/ai/network.ts')).toBe('src/ai/network.ts');
  });
  it('is null outside src and for dependencies', () => {
    expect(sourcePath('')).toBeNull();
    expect(sourcePath('node:internal/timers')).toBeNull();
    expect(sourcePath('/home/u/repo/node_modules/vite/src/x.js')).toBeNull();
  });
});

describe('groupOf', () => {
  it('splits collision.ts into the sweep, pointOnRoad and the rest of the physics', () => {
    expect(groupOf('src/sim/collision.ts', 'shapeTouchesBoundary')).toBe('sweep');
    expect(groupOf('src/sim/collision.ts', 'segmentNearConvex')).toBe('sweep');
    expect(groupOf('src/sim/collision.ts', 'pointOnRoad')).toBe('on-road');
    expect(groupOf('src/sim/collision.ts', 'inPolygon')).toBe('on-road');
    expect(groupOf('src/sim/collision.ts', 'stepCar')).toBe('physics');
  });
  it('names the other groups', () => {
    expect(groupOf('src/sensors/rays.ts', '(anonymous)')).toBe('rays');
    expect(groupOf('src/sim/checkpoints.ts', 'x')).toBe('gates');
    expect(groupOf('src/sim/vehicle.ts', 'x')).toBe('physics');
    expect(groupOf('src/ai/network.ts', 'layer')).toBe('network-inputs');
    expect(groupOf('src/training/trainer.ts', 'step')).toBe('training-harness');
    expect(groupOf('src/ui/x.ts', 'x')).toBe('other-src');
    expect(groupOf(null, 'x')).toBe('outside-src');
  });
});

describe('summariseProfile', () => {
  // Sample i is weighted by timeDeltas[i + 1]: node 2 gets 300 + 100 (its two samples), node 3 gets 600, the last sample (node 4) gets 0.
  const profile: CpuProfile = {
    nodes: [frame(1, '(root)', ''), frame(2, 'raySegment', R, '7'), frame(3, 'pointOnRoad', '', '8'), frame(4, 'inPolygon', C, '8')],
    samples: [2, 2, 3, 4],
    timeDeltas: [10, 300, 100, 600],
  };

  it('weights each sample by the gap that follows it, and weights the last sample 0', () => {
    const s = summariseProfile(profile);
    expect(s.samples).toBe(4);
    expect(s.totalMicroseconds).toBe(1000);
    const by = Object.fromEntries(s.groups.map((g) => [g.group, g.microseconds]));
    expect(by['rays']).toBe(400);
    expect(by['on-road']).toBe(600);
  });

  it('credits a frame with an empty url to the file of its scriptId', () => {
    const s = summariseProfile(profile);
    const fn = s.topFunctions.find((f) => f.name === 'pointOnRoad');
    expect(fn).toMatchObject({ file: 'src/sim/collision.ts', group: 'on-road', microseconds: 600 });
  });

  it('reports every group in order, with shares that add to 1', () => {
    const s = summariseProfile(profile);
    expect(s.groups.map((g) => g.group)).toEqual([...PROFILE_GROUPS]);
    expect(s.groups.reduce((a, g) => a + g.share, 0)).toBeCloseTo(1, 12);
  });

  it('orders the top functions by time, then by name, and honours the count', () => {
    const tie: CpuProfile = { nodes: [frame(1, 'b', R), frame(2, 'a', R)], samples: [1, 2, 1], timeDeltas: [0, 5, 5] };
    const s = summariseProfile(tie, 1);
    expect(s.topFunctions).toHaveLength(1);
    expect(s.topFunctions[0]?.name).toBe('a');
  });

  it('gives zero shares for an empty sample list and is deterministic', () => {
    const empty = summariseProfile({ nodes: [frame(1, '(root)', '')] });
    expect(empty.totalMicroseconds).toBe(0);
    expect(empty.groups.every((g) => g.share === 0)).toBe(true);
    expect(summariseProfile(profile)).toEqual(summariseProfile(profile));
  });

  it('rejects an unusable profile', () => {
    expect(() => summariseProfile({ nodes: [] })).toThrow(RangeError);
    expect(() => summariseProfile({ nodes: [frame(1, 'x', R)], samples: [1], timeDeltas: [] })).toThrow(RangeError);
    expect(() => summariseProfile({ nodes: [frame(1, 'x', R)], samples: [9], timeDeltas: [1] })).toThrow(RangeError);
  });
});
