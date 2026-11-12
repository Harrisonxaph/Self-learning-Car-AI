// The evaluate page's logic in Node (P4-05), against a real model store over a fake storage and a manual scheduler: choosing a
// model, the circuit lists (training and validation only), running one slice at a time, storing each finished circuit,
// cancelling, storage failures and damaged models. No held-out circuit is ever offered, ticked or evaluated. Seeded and tiny;
// nothing here is a result.
import { describe, expect, it } from 'vitest';
import { createModelStore } from '../../src/persistence/modelStore';
import { createEvaluateController } from '../../src/ui/evaluateController';
import { evaluateModelOnCircuit } from '../../src/ui/modelEvaluation';
import { tracksIn } from '../../src/training/trackSplits';
import { EVALUATION_TRACKS, MemoryStorage, TRAINING_REGISTRY, makeModel } from '../helpers/evaluationFixtures';

const names = (split: 'training' | 'validation') => tracksIn(split).map((t) => ({ id: t.id, name: t.track.name }));
const HELD_OUT = tracksIn('held-out').map((t) => t.id);

function setup() {
  const storage = new MemoryStorage();
  const store = createModelStore({ storage: () => storage, registry: TRAINING_REGISTRY, evaluationTracks: EVALUATION_TRACKS });
  const model = makeModel(21, 'ec-1');
  expect(store.save(model).ok).toBe(true);
  const queue: (() => void)[] = [];
  const evaluated: string[] = [];
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
    evaluate: (m, id, o) => {
      evaluated.push(id);
      return evaluateModelOnCircuit(m, id, o);
    },
  });
  controller.refresh();
  const step = () => queue.shift()?.();
  return { storage, store, controller, queue, step, evaluated, model };
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
  it('evaluates the ticked circuits in order, one slice at a time, stores each, and shows the results newest first', () => {
    const { controller, step, evaluated, queue } = setup();
    controller.select('ec-1');
    controller.toggle('kidney-loop');
    controller.toggle('s-sweepers');
    expect(controller.canRun()).toBe(true);
    controller.run();
    expect(controller.state()).toBe('running');
    expect(controller.progress()).toBe('Evaluating Kidney loop (1 of 2)…');
    expect(evaluated).toEqual([]);
    step();
    expect(evaluated).toEqual(['kidney-loop']);
    expect(controller.progress()).toBe('Evaluating S sweepers (2 of 2)…');
    expect(queue).toHaveLength(1);
    step();
    expect(controller.state()).toBe('idle');
    expect(controller.progress()).toBe('Done: 2 circuits evaluated and stored.');
    const results = controller.results();
    expect(results.map((r) => r.track.id)).toEqual(['s-sweepers', 'kidney-loop']);
    expect(results.every((r) => r.track.split === 'training' || r.track.split === 'validation')).toBe(true);
  });
  it('can run again: each run appends, and the earlier results stay', () => {
    const { controller, step } = setup();
    controller.select('ec-1');
    controller.toggle('rounded-rectangle');
    controller.run();
    step();
    controller.run();
    step();
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
  it('cancel before the next slice keeps what is finished and stores nothing partial', () => {
    const { controller, step, queue } = setup();
    controller.select('ec-1');
    for (const id of ['kidney-loop', 's-sweepers', 'rounded-rectangle']) controller.toggle(id);
    controller.run();
    step();
    controller.cancel();
    expect(controller.state()).toBe('idle');
    expect(controller.progress()).toMatch(/^Cancelled\./);
    expect(queue).toHaveLength(0);
    expect(controller.results()).toHaveLength(1);
    expect(controller.results()[0]!.track.id).toBe('kidney-loop');
  });
  it('cancel before any slice stores nothing', () => {
    const { controller } = setup();
    controller.select('ec-1');
    controller.toggle('kidney-loop');
    controller.run();
    controller.cancel();
    expect(controller.results()).toHaveLength(0);
    expect(controller.state()).toBe('idle');
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
    const { controller, step, storage } = setup();
    controller.select('ec-1');
    controller.toggle('kidney-loop');
    controller.toggle('s-sweepers');
    controller.run();
    step();
    storage.failSet = Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    step();
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
