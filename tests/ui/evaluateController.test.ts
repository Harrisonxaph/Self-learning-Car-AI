// The evaluate page's logic in Node (P4-05), against a real model store over a fake storage and a manual scheduler: choosing a
// model, the circuit lists (training and validation only), running one slice at a time, storing each finished circuit,
// cancelling, storage failures and damaged models. No held-out circuit is ever offered, ticked or evaluated. Seeded and tiny;
// nothing here is a result.
import { describe, expect, it } from 'vitest';
import { createModelStore } from '../../src/persistence/modelStore';
import { createEvaluateController } from '../../src/ui/evaluateController';
import { entryBelongsTo, startEvaluationJob } from '../../src/ui/modelEvaluation';
import { tracksIn } from '../../src/training/trackSplits';
import { offered } from '../../src/ui/trainingCircuit';
import { EVALUATION_TRACKS, MemoryStorage, TRAINING_REGISTRY, makeModel } from '../helpers/evaluationFixtures';

// The pages list the circuits main.ts offers: every one of the split except those not yet offered (Silverstone, until P4-06 step 3).
const names = (split: 'training' | 'validation') => offered(tracksIn(split)).map((t) => ({ id: t.id, name: t.track.name }));
const HELD_OUT = tracksIn('held-out').map((t) => t.id);

function setup() {
  const storage = new MemoryStorage();
  const store = createModelStore({ storage: () => storage, registry: TRAINING_REGISTRY, evaluationTracks: EVALUATION_TRACKS, evaluationBinding: entryBelongsTo });
  const model = makeModel(21, 'ec-1');
  expect(store.save(model).ok).toBe(true);
  const queue: (() => void)[] = [];
  const evaluated: string[] = [];
  const budgets: number[] = [];
  const controller = createEvaluateController({
    store,
    trainingCircuits: names('training'),
    validationCircuits: names('validation'),
    now: () => '2026-11-12T12:00:00.000Z',
    appVersion: '0.0.0',
    codeVersion: 'test',
    defer: (cb) => {
      queue.push(cb);
      return () => {
        const i = queue.indexOf(cb);
        if (i >= 0) queue.splice(i, 1);
      };
    },
    startJob: (m, id, o) => {
      evaluated.push(id);
      const started = startEvaluationJob(m, id, o);
      if (!started.ok) return started;
      const job = started.job;
      return { ok: true as const, job: { ...job, step: (ticks: number) => { budgets.push(ticks); job.step(ticks); } } };
    },
    sliceTicks: 400,
  });
  controller.refresh();
  const step = () => queue.shift()?.();
  /** Runs deferred callbacks until the run ends (or `limit` slices). */
  const drain = (limit = 100_000) => {
    for (let i = 0; i < limit && queue.length > 0; i += 1) step();
  };
  return { storage, store, controller, queue, step, drain, evaluated, budgets, model };
}

describe('the circuits offered', () => {
  it('are the training and validation circuits only, never a held-out one, whatever is passed in', () => {
    const { controller } = setup();
    const ids = controller.circuits().map((c) => c.id);
    expect(ids).toEqual(['stadium-oval', 'kidney-loop', 'rounded-rectangle', 's-sweepers']);
    for (const held of HELD_OUT) expect(ids).not.toContain(held);
    const sneaky = createEvaluateController({
      store: createModelStore({ storage: () => new MemoryStorage(), registry: TRAINING_REGISTRY }),
      trainingCircuits: [...names('training'), ...HELD_OUT.map((id) => ({ id, name: id }))].slice(0, 2),
      validationCircuits: names('validation'),
      now: () => '', appVersion: '', codeVersion: '', defer: () => () => undefined,
    });
    expect(sneaky.circuits().map((c) => c.split)).toEqual(['training', 'training', 'validation', 'validation']);
  });
  it('marks the circuit the selected model was trained on', () => {
    const { controller } = setup();
    controller.select('ec-1');
    expect(controller.circuits().find((c) => c.trainedOn)?.id).toBe('stadium-oval');
  });
  it('ignores a toggle of anything it does not offer (a held-out ID cannot be ticked)', () => {
    const { controller } = setup();
    controller.select('ec-1');
    for (const id of HELD_OUT) controller.toggle(id);
    expect(controller.circuits().some((c) => c.checked)).toBe(false);
    expect(controller.canRun()).toBe(false);
  });
});

describe('running', () => {
  it('evaluates the ticked circuits in order, in slices, stores each, and shows the results newest first', () => {
    const { controller, drain, evaluated, queue, budgets } = setup();
    controller.select('ec-1');
    controller.toggle('kidney-loop');
    controller.toggle('s-sweepers');
    expect(controller.canRun()).toBe(true);
    controller.run();
    expect(controller.state()).toBe('running');
    expect(controller.progress()).toBe('Evaluating Kidney loop (1 of 2)…');
    expect(evaluated).toEqual([]);
    expect(queue).toHaveLength(1);
    drain();
    expect(evaluated).toEqual(['kidney-loop', 's-sweepers']);
    expect(controller.state()).toBe('idle');
    expect(controller.progress()).toBe('Done: 2 circuits evaluated and stored.');
    expect(budgets.length).toBeGreaterThan(2);
    expect(budgets.every((b) => b === 400)).toBe(true);
    const results = controller.results();
    expect(results.map((r) => r.track.id)).toEqual(['s-sweepers', 'kidney-loop']);
    expect(results.every((r) => r.track.split === 'training' || r.track.split === 'validation')).toBe(true);
  });
  it('can run again: each run appends, and the earlier results stay', () => {
    const { controller, drain } = setup();
    controller.select('ec-1');
    controller.toggle('rounded-rectangle');
    controller.run();
    drain();
    controller.run();
    drain();
    expect(controller.results()).toHaveLength(2);
  });
  it('asks for a model and a circuit, with messages', () => {
    const { controller } = setup();
    controller.run();
    expect(controller.message()).toBe('Choose a saved champion first.');
    controller.select('ec-1');
    controller.run();
    expect(controller.message()).toBe('Tick at least one circuit.');
  });
  it('cancel BETWEEN circuits keeps what is finished and stores nothing partial', () => {
    const { controller, drain, step, queue, evaluated } = setup();
    controller.select('ec-1');
    for (const id of ['kidney-loop', 's-sweepers', 'rounded-rectangle']) controller.toggle(id);
    controller.run();
    // Run kidney-loop to completion, then cancel as the next circuit is about to start.
    for (let i = 0; i < 100_000 && !(evaluated.length === 1 && controller.results().length === 1 && queue.length > 0); i += 1) step();
    expect(controller.results().map((r) => r.track.id)).toEqual(['kidney-loop']);
    controller.cancel();
    expect(controller.state()).toBe('idle');
    expect(controller.progress()).toMatch(/^Cancelled\./);
    expect(queue).toHaveLength(0);
    drain();
    expect(controller.results().map((r) => r.track.id)).toEqual(['kidney-loop']);
  });
  it('cancel IN THE MIDDLE of a circuit discards that circuit: nothing is appended, not even the episodes already run', () => {
    const { controller, step, queue, store, evaluated } = setup();
    controller.select('ec-1');
    controller.toggle('kidney-loop');
    controller.run();
    step(); // starts the job and runs one slice
    step();
    expect(evaluated).toEqual(['kidney-loop']);
    expect(controller.progress()).toMatch(/^Evaluating Kidney loop \(1 of 1\): episode \d of 5, tick \d+…$/);
    expect(queue).toHaveLength(1); // more work is pending: the circuit is NOT finished
    controller.cancel();
    expect(controller.state()).toBe('idle');
    expect(queue).toHaveLength(0);
    expect(controller.progress()).toMatch(/the circuit in progress was discarded and nothing partial was kept/);
    expect(controller.results()).toHaveLength(0);
    const stored = store.inspect('ec-1');
    if (!stored.ok) throw new Error(stored.message);
    expect(stored.model.evaluation).toEqual([]);
  });
  it('an expensive supported model keeps yielding: many bounded slices with progress in each, and Cancel stops it promptly', () => {
    const { storage, store, queue, step, budgets } = setup();
    const slow = makeModel(22, 'ec-slow');
    (slow.training.configuration as { timestepSeconds: number }).timestepSeconds = 0.001;
    expect(store.save(slow).ok).toBe(true);
    const controller = createEvaluateController({
      store, trainingCircuits: names('training'), validationCircuits: names('validation'),
      now: () => '2026-11-12T12:00:00.000Z', appVersion: '0', codeVersion: 't',
      defer: (cb) => { queue.push(cb); return () => { const i = queue.indexOf(cb); if (i >= 0) queue.splice(i, 1); }; },
      startJob: (m, id, o) => {
        const started = startEvaluationJob(m, id, o);
        if (!started.ok) return started;
        return { ok: true as const, job: { ...started.job, step: (ticks: number) => { budgets.push(ticks); started.job.step(ticks); } } };
      },
      sliceTicks: 300,
    });
    controller.refresh();
    controller.select('ec-slow');
    controller.toggle('kidney-loop');
    controller.run();
    const seen = new Set<string>();
    for (let i = 0; i < 60; i += 1) {
      step();
      seen.add(controller.progress());
    }
    expect(controller.state()).toBe('running'); // 60 slices of 300 ticks did not finish five stalled episodes at 0.001 s
    expect(seen.size).toBeGreaterThan(5); // the progress line changed: a heartbeat the page can paint
    expect(budgets.every((b) => b === 300)).toBe(true);
    controller.cancel();
    expect(controller.state()).toBe('idle');
    expect(queue).toHaveLength(0);
    expect(storage.data.get('sdae:model:ec-slow')).toBeDefined();
    const inspected = store.inspect('ec-slow');
    if (!inspected.ok) throw new Error(inspected.message);
    expect(inspected.model.evaluation).toEqual([]);
  });
  it('does not change the model or the ticks while running', () => {
    const { controller } = setup();
    controller.select('ec-1');
    controller.toggle('kidney-loop');
    controller.run();
    controller.toggle('s-sweepers');
    controller.select(null);
    expect(controller.selected()).toBe('ec-1');
    expect(controller.circuits().filter((c) => c.checked).map((c) => c.id)).toEqual(['kidney-loop']);
  });
});

describe('failures', () => {
  it('a storage failure stops the run, says so, and stores nothing for that circuit', () => {
    const { controller, step, drain, storage } = setup();
    controller.select('ec-1');
    controller.toggle('kidney-loop');
    controller.toggle('s-sweepers');
    controller.run();
    // First circuit to completion and stored; then storage fails for the second.
    for (let i = 0; i < 100_000 && controller.results().length < 1; i += 1) step();
    storage.failSet = Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    drain();
    storage.failSet = null;
    expect(controller.state()).toBe('idle');
    expect(controller.message()).toMatch(/full/i);
    expect(controller.progress()).toMatch(/^Stopped after 1 of 2/);
    expect(controller.results().map((r) => r.track.id)).toEqual(['kidney-loop']);
  });
  it('a damaged or unusable model is listed with its reason and cannot be run', () => {
    const { controller, storage } = setup();
    storage.data.set('sdae:model:broken', '{not json');
    storage.data.set('sdae:models:index', JSON.stringify(['ec-1', 'broken']));
    controller.refresh();
    const broken = controller.models().find((m) => m.id === 'broken')!;
    expect(broken.usable).toBe(false);
    controller.select('broken');
    controller.toggle('kidney-loop');
    expect(controller.canRun()).toBe(false);
    controller.run();
    expect(controller.message()).not.toBe('');
    expect(controller.state()).toBe('idle');
  });
  it('unavailable storage lists nothing and says why', () => {
    const controller = createEvaluateController({
      store: createModelStore({ storage: () => { throw new Error('denied'); }, registry: TRAINING_REGISTRY }),
      trainingCircuits: names('training'), validationCircuits: names('validation'),
      now: () => '', appVersion: '', codeVersion: '', defer: () => () => undefined,
    });
    controller.refresh();
    expect(controller.models()).toEqual([]);
    expect(controller.message()).toMatch(/unavailable/i);
  });
  it('a model removed while the page is open ends the run with the store\'s message', () => {
    const { controller, step, store } = setup();
    controller.select('ec-1');
    controller.toggle('kidney-loop');
    controller.run();
    store.remove('ec-1');
    step();
    expect(controller.state()).toBe('idle');
    expect(controller.progress()).toMatch(/^Stopped after 0 of 1/);
  });
});
