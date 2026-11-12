import { describe, expect, it } from 'vitest';
import { circuitControlState, circuitFromSearch, DEFAULT_TRAINING_CIRCUIT, searchForCircuit } from '../../src/ui/trainingCircuit';

const available = ['stadium-oval', 'kidney-loop'];

describe('circuitFromSearch', () => {
  it.each([
    ['', 'stadium-oval'],
    ['?mode=train', 'stadium-oval'],
    ['?mode=train&circuit=kidney-loop', 'kidney-loop'],
    ['?circuit=%20kidney-loop%20', 'kidney-loop'],
    ['?circuit=stadium-oval&circuit=kidney-loop', 'kidney-loop'],
    ['?circuit=kidney-loop&circuit=stadium-oval', 'stadium-oval'],
    // Only training circuits are ever accepted: validation, held-out and unknown IDs fall back to the default.
    ['?circuit=s-sweepers', 'stadium-oval'],
    ['?circuit=hairpin-chicane', 'stadium-oval'],
    ['?circuit=long-sweepers', 'stadium-oval'],
    ['?circuit=technical-narrow', 'stadium-oval'],
    ['?circuit=rounded-rectangle', 'stadium-oval'],
    ['?circuit=nonsense', 'stadium-oval'],
    ['?circuit=', 'stadium-oval'],
    ['?circuit=Kidney-Loop', 'stadium-oval'],
    ['?circuit=kidney-loop&circuit=hairpin-chicane', 'stadium-oval'],
  ])('%s → %s', (search, expected) => {
    expect(circuitFromSearch(search, available)).toBe(expected);
  });
  it('falls back to the first available circuit when the default is not offered', () => {
    expect(circuitFromSearch('', ['kidney-loop'])).toBe('kidney-loop');
    expect(DEFAULT_TRAINING_CIRCUIT).toBe('stadium-oval');
  });
});

describe('searchForCircuit', () => {
  it('keeps the other parameters and sets the circuit once', () => {
    expect(searchForCircuit('?mode=train', 'kidney-loop')).toBe('?mode=train&circuit=kidney-loop');
    expect(searchForCircuit('?mode=train&circuit=stadium-oval&debug=fps', 'kidney-loop')).toBe('?mode=train&debug=fps&circuit=kidney-loop');
    expect(searchForCircuit('?circuit=a&circuit=b', 'kidney-loop')).toBe('?circuit=kidney-loop');
    expect(searchForCircuit('', 'stadium-oval')).toBe('?circuit=stadium-oval');
  });
  it('round trips through circuitFromSearch', () => {
    for (const id of available) expect(circuitFromSearch(searchForCircuit('?mode=train', id), available)).toBe(id);
  });
});

describe('circuitControlState', () => {
  it('is available before the first generation completes and while paused, and disabled mid-run', () => {
    expect(circuitControlState({ paused: false, completedGenerations: 0 }).disabled).toBe(false);
    expect(circuitControlState({ paused: true, completedGenerations: 0 }).disabled).toBe(false);
    expect(circuitControlState({ paused: true, completedGenerations: 5 }).disabled).toBe(false);
    const running = circuitControlState({ paused: false, completedGenerations: 1 });
    expect(running.disabled).toBe(true);
    expect(running.hint).toContain('Pause');
    expect(circuitControlState({ paused: true, completedGenerations: 5 }).hint).toContain('new run');
  });
});
