// The checkpoint saver (P3-07): the newest checkpoint always wins. A fake scheduler, clock and writer drive every ordering
// the plan names: coalescing, the freshness check immediately before a write, hide-time writes cancelling a pending one,
// Resume/Discard/Start fresh cancelling it, autosave blocked while an offer is unanswered, and retry after a failure.
import { describe, expect, it } from 'vitest';
import { createCheckpointSaver } from '../../src/ui/checkpointSaver';

interface State {
  readonly generationIndex: number;
}
function harness(options: { running?: () => boolean; fail?: () => boolean; every?: number; minSeconds?: number } = {}) {
  let clock = 0;
  const queue: { run: () => void; cancelled: boolean }[] = [];
  const written: number[] = [];
  const results: string[] = [];
  const saver = createCheckpointSaver<State>({
    write: (state) => {
      if (options.fail?.()) return { ok: false, message: 'full' };
      written.push(state.generationIndex);
      return { ok: true };
    },
    defer: (callback) => {
      const entry = { run: callback, cancelled: false };
      queue.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
    now: () => clock,
    isRunning: options.running ?? (() => true),
    everyGenerations: options.every ?? 5,
    minSeconds: options.minSeconds ?? 30,
    onResult: (r) => results.push(`${r.kind}:${r.generationIndex}`),
  });
  /** Releases every deferred callback, including cancelled ones (a real scheduler may already have fired a callback the saver cancelled). */
  const releaseAll = (includeCancelled = false) => {
    for (const entry of queue.splice(0)) if (includeCancelled || !entry.cancelled) entry.run();
  };
  return { saver, queue, written, results, releaseAll, advance: (ms: number) => (clock += ms) };
}

describe('periodic requests', () => {
  it('saves after every 5th boundary, at the latest state, and not before', () => {
    const h = harness();
    for (let g = 1; g <= 4; g += 1) h.saver.boundary({ generationIndex: g });
    expect(h.saver.pending()).toBe(false);
    h.saver.boundary({ generationIndex: 5 });
    expect(h.saver.pending()).toBe(true);
    h.releaseAll();
    expect(h.written).toEqual([5]);
    expect(h.saver.lastWritten()).toBe(5);
    for (let g = 6; g <= 9; g += 1) h.saver.boundary({ generationIndex: g });
    expect(h.saver.pending()).toBe(false);
  });

  it('saves when 30 seconds have passed even before 5 generations', () => {
    const h = harness();
    h.saver.boundary({ generationIndex: 1 });
    expect(h.saver.pending()).toBe(false);
    h.advance(31_000);
    h.saver.boundary({ generationIndex: 2 });
    expect(h.saver.pending()).toBe(true);
    h.releaseAll();
    expect(h.written).toEqual([2]);
  });

  it('requests nothing while paused', () => {
    let running = false;
    const h = harness({ running: () => running });
    for (let g = 1; g <= 7; g += 1) h.saver.boundary({ generationIndex: g });
    expect(h.saver.pending()).toBe(false);
    running = true;
    h.saver.boundary({ generationIndex: 8 });
    expect(h.saver.pending()).toBe(true);
  });

  it('coalesces: many requests make one write, of the state that is newest when it runs', () => {
    const h = harness({ every: 1 });
    h.saver.boundary({ generationIndex: 1 });
    h.saver.boundary({ generationIndex: 2 });
    h.saver.boundary({ generationIndex: 3 });
    expect(h.queue).toHaveLength(1);
    h.releaseAll();
    expect(h.written).toEqual([3]);
  });
});

describe('the newest checkpoint wins', () => {
  it('a queued generation-5 save released after a hide-time save of generation 6 writes nothing and leaves generation 6', () => {
    const h = harness();
    for (let g = 1; g <= 5; g += 1) h.saver.boundary({ generationIndex: g });
    expect(h.saver.pending()).toBe(true);
    const stale = h.queue[0]!;
    h.saver.boundary({ generationIndex: 6 });
    h.saver.flush();
    expect(h.written).toEqual([6]);
    expect(stale.cancelled).toBe(true);
    // A real scheduler may already have released the callback: even then it must do nothing.
    h.releaseAll(true);
    expect(h.written).toEqual([6]);
    expect(h.saver.lastWritten()).toBe(6);
  });

  it('a hide event with nothing newer writes nothing, and a second hide writes nothing', () => {
    const h = harness();
    h.saver.flush();
    expect(h.written).toEqual([]);
    h.saver.boundary({ generationIndex: 2 });
    h.saver.flush();
    h.saver.flush();
    expect(h.written).toEqual([2]);
  });

  it('Resume, Discard and Start fresh (reset) cancel a pending write and a released stale callback writes nothing', () => {
    const h = harness();
    for (let g = 1; g <= 5; g += 1) h.saver.boundary({ generationIndex: g });
    h.saver.reset(12);
    expect(h.saver.pending()).toBe(false);
    h.releaseAll(true);
    expect(h.written).toEqual([]);
    expect(h.saver.lastWritten()).toBe(12);
    // Nothing older than what is in the slot is written after a resume from generation 12.
    h.saver.boundary({ generationIndex: 13 });
    h.saver.flush();
    expect(h.written).toEqual([13]);
  });

  it('seed makes the resumed boundary the newest state: a hide writes it, but only if newer than the slot, and it requests no save', () => {
    const h = harness();
    h.saver.reset(-1);
    h.saver.seed({ generationIndex: 2 });
    expect(h.saver.pending()).toBe(false);
    h.saver.flush();
    expect(h.written).toEqual([2]);
    const stored = harness();
    stored.saver.reset(2);
    stored.saver.seed({ generationIndex: 2 });
    stored.saver.flush();
    expect(stored.written).toEqual([]);
  });

  it('a stale callback released after a reset does not write the new run early', () => {
    const h = harness();
    for (let g = 1; g <= 5; g += 1) h.saver.boundary({ generationIndex: g });
    h.saver.reset(12);
    // The new run reaches a boundary that is not yet due for a periodic save; the old callback fires anyway.
    h.saver.boundary({ generationIndex: 13 });
    h.releaseAll(true);
    expect(h.written).toEqual([]);
  });

  it('a state that is not newer than what is in the slot is never written', () => {
    const h = harness();
    h.saver.reset(10);
    h.saver.boundary({ generationIndex: 10 });
    h.saver.flush();
    expect(h.written).toEqual([]);
  });
});

describe('autosave while an offer is unanswered', () => {
  it('is blocked, including hide-time writes, until it is enabled', () => {
    const h = harness();
    h.saver.setEnabled(false);
    for (let g = 1; g <= 6; g += 1) h.saver.boundary({ generationIndex: g });
    expect(h.saver.pending()).toBe(false);
    h.saver.flush();
    expect(h.written).toEqual([]);
    h.saver.setEnabled(true);
    h.saver.boundary({ generationIndex: 7 });
    h.saver.flush();
    expect(h.written).toEqual([7]);
  });

  it('disabling cancels a pending write', () => {
    const h = harness();
    for (let g = 1; g <= 5; g += 1) h.saver.boundary({ generationIndex: g });
    h.saver.setEnabled(false);
    expect(h.saver.pending()).toBe(false);
    h.releaseAll(true);
    expect(h.written).toEqual([]);
  });
});

describe('failures', () => {
  it('a failed write is reported, leaves lastWritten unchanged and is retried at the next periodic point', () => {
    let failing = true;
    const h = harness({ fail: () => failing });
    for (let g = 1; g <= 5; g += 1) h.saver.boundary({ generationIndex: g });
    h.releaseAll();
    expect(h.results).toEqual(['failed:5']);
    expect(h.saver.lastWritten()).toBe(-1);
    for (let g = 6; g <= 9; g += 1) h.saver.boundary({ generationIndex: g });
    expect(h.saver.pending()).toBe(false);
    failing = false;
    h.saver.boundary({ generationIndex: 10 });
    h.releaseAll();
    expect(h.written).toEqual([10]);
    expect(h.results).toEqual(['failed:5', 'saved:10']);
  });

  it('a writer that throws is a failure, not an exception', () => {
    const saver = createCheckpointSaver<State>({
      write: () => {
        throw new Error('boom');
      },
      defer: (cb) => {
        cb();
        return () => {};
      },
      now: () => 0,
      isRunning: () => true,
      everyGenerations: 1,
    });
    expect(() => saver.boundary({ generationIndex: 1 })).not.toThrow();
    expect(saver.lastWritten()).toBe(-1);
  });
});
