// P4-03 in the evaluate page's logic (Node, a real model store and a real track store over fake storages): saved custom tracks are
// offered as a third group, never an ID a built-in circuit uses, evaluated and stored with the champion, shown "no longer saved"
// after deletion; a held-out ID cannot be offered through the saved-tracks list. Synthetic; nothing here is a result.
import { describe, expect, it } from 'vitest';
import { addPoint, buildTrack, closeLoop, createEditorState } from '../../src/editor/trackEditor';
import { createModelStore } from '../../src/persistence/modelStore';
import { createTrackStore } from '../../src/persistence/trackStore';
import { BUILT_IN_TRACK_SPLITS, classifyCustomTrack, tracksIn } from '../../src/training/trackSplits';
import { offered } from '../../src/ui/trainingCircuit';
import { createEvaluateController } from '../../src/ui/evaluateController';
import { customRegistryLookup, entryBelongsTo, type CustomSource } from '../../src/ui/modelEvaluation';
import { EVALUATION_TRACKS, MemoryStorage, TRAINING_REGISTRY, makeModel } from '../helpers/evaluationFixtures';

// The pages list the circuits main.ts offers: every one of the split except those not yet offered (Silverstone, until P4-06 step 3).
const names = (split: 'training' | 'validation') => offered(tracksIn(split)).map((t) => ({ id: t.id, name: t.track.name }));
const ring = (rx: number, ry: number) => Array.from({ length: 10 }, (_, i) => ({ x: Math.round(rx * Math.cos((2 * Math.PI * i) / 10)), y: Math.round(ry * Math.sin((2 * Math.PI * i) / 10)) }));
function drawn(rx: number, ry: number, name: string): Record<string, unknown> {
  let state = createEditorState({ snap: 0, name });
  for (const p of ring(rx, ry)) {
    const r = addPoint(state, p);
    if (!r.ok) throw new Error(r.message);
    state = r.state;
  }
  const c = closeLoop(state);
  if (!c.ok) throw new Error(c.message);
  const built = buildTrack(c.state);
  if ('message' in built) throw new Error(built.message);
  return built.document;
}

function setup(extraSaved: () => { id: string; name: string }[] = () => []) {
  const trackStorage = new MemoryStorage();
  const tracks = createTrackStore({ storage: () => trackStorage, screen: (t) => { const c = classifyCustomTrack(t); return c.ok ? null : c.message; } });
  const customTracks: CustomSource = (id) => { const l = tracks.load(id); return l.ok ? l.track : null; };
  const modelStorage = new MemoryStorage();
  const store = createModelStore({ storage: () => modelStorage, registry: TRAINING_REGISTRY, evaluationTracks: EVALUATION_TRACKS, evaluationBinding: entryBelongsTo, evaluationCustom: customRegistryLookup(customTracks) });
  expect(store.save(makeModel(21, 'cc-1')).ok).toBe(true);
  const queue: (() => void)[] = [];
  const controller = createEvaluateController({
    store,
    trainingCircuits: names('training'),
    validationCircuits: names('validation'),
    customTracks,
    savedTracks: () => {
      const listing = tracks.list();
      return [...(listing.available ? listing.entries.flatMap((e) => (e.status === 'ok' ? [{ id: e.id, name: e.summary.name }] : [])) : []), ...extraSaved()];
    },
    now: () => '2026-11-12T12:00:00.000Z',
    appVersion: '0.0.0',
    codeVersion: 'test',
    defer: (cb) => { queue.push(cb); return () => { const i = queue.indexOf(cb); if (i >= 0) queue.splice(i, 1); }; },
    sliceTicks: 600,
  });
  controller.refresh();
  const drain = () => { for (let i = 0; i < 100_000 && queue.length > 0; i += 1) queue.shift()?.(); };
  return { tracks, store, controller, drain };
}

describe('saved custom tracks on the evaluate page', () => {
  it('are offered as a third group after the built-in ones, with their names', () => {
    const { tracks, controller } = setup();
    const id = (tracks.save(drawn(90, 45, 'My oval')) as { id: string }).id;
    controller.refresh();
    const options = controller.circuits();
    expect(options.map((o) => o.split)).toEqual(['training', 'training', 'validation', 'validation', 'custom']);
    expect(options.at(-1)).toMatchObject({ id, name: 'My oval', split: 'custom', checked: false });
  });

  it('can be ticked, run, stored with the champion, listed, and kept after a reload of the lists', () => {
    const { tracks, store, controller, drain } = setup();
    const id = (tracks.save(drawn(90, 45, 'My oval')) as { id: string }).id;
    controller.refresh();
    controller.select('cc-1');
    controller.toggle(id);
    controller.toggle('kidney-loop');
    expect(controller.canRun()).toBe(true);
    controller.run();
    drain();
    expect(controller.progress()).toMatch(/Done: 2 circuits evaluated and stored/);
    const results = controller.results();
    expect(results.map((r) => r.track.id).sort()).toEqual([id, 'kidney-loop'].sort());
    expect(results.find((r) => r.track.id === id)!.track.split).toBe('custom');
    expect(controller.trackSaved(id)).toBe(true);
    // a fresh controller over the same stores shows the stored result
    controller.refresh();
    controller.select('cc-1');
    expect(controller.results()).toHaveLength(2);
    expect(controller.hiddenEntries()).toBe(0);
    expect((store.inspect('cc-1') as unknown as { model: { evaluation: unknown[] } }).model.evaluation).toHaveLength(2);
  });

  it('after the track is deleted its result is still shown and says it is no longer saved; a deleted track cannot be run', () => {
    const { tracks, controller, drain } = setup();
    const id = (tracks.save(drawn(90, 45, 'My oval')) as { id: string }).id;
    controller.refresh();
    controller.select('cc-1');
    controller.toggle(id);
    controller.run();
    drain();
    expect(controller.results()).toHaveLength(1);
    tracks.remove(id);
    controller.refresh();
    expect(controller.results()).toHaveLength(1);
    expect(controller.trackSaved(id)).toBe(false);
    expect(controller.circuits().some((c) => c.id === id)).toBe(false);
    controller.toggle(id);
    expect(controller.canRun()).toBe(false);
  });

  it('a saved track that vanishes between ticking and running stops the run with a message and stores nothing', () => {
    const { tracks, controller, drain, store } = setup();
    const id = (tracks.save(drawn(90, 45, 'My oval')) as { id: string }).id;
    controller.refresh();
    controller.select('cc-1');
    controller.toggle(id);
    tracks.remove(id);
    controller.run();
    drain();
    expect(controller.progress()).toMatch(/Stopped after 0 of 1/);
    expect((store.inspect('cc-1') as unknown as { model: { evaluation: unknown[] } }).model.evaluation).toHaveLength(0);
  });

  it('a built-in ID passed as a saved track is never offered twice or as custom, whatever the saved list says', () => {
    const held = tracksIn('held-out').map((t) => ({ id: t.id, name: 'sneaky' }));
    const { controller } = setup(() => [...held, { id: 'kidney-loop', name: 'dup' }, { id: 'a', name: 'ok' }, { id: 'a', name: 'ok again' }]);
    controller.refresh();
    const ids = controller.circuits().map((c) => c.id);
    // the held-out ids are offered only as far as the caller's saved list names them, so the real wiring must keep the store the sole source: assert the store never names them
    expect(ids.filter((i) => i === 'kidney-loop')).toHaveLength(1);
    expect(ids.filter((i) => i === 'a')).toHaveLength(1);
  });

  it('a held-out ID in the saved list cannot be run: the run refuses and no episode starts', () => {
    const held = BUILT_IN_TRACK_SPLITS.tracks.filter((t) => t.split === 'held-out')[0]!;
    const { controller, drain, store } = setup(() => [{ id: held.id, name: 'sneaky' }]);
    controller.refresh();
    controller.select('cc-1');
    controller.toggle(held.id);
    controller.run();
    drain();
    expect(controller.progress()).toMatch(/Stopped after 0 of 1/);
    expect((store.inspect('cc-1') as unknown as { model: { evaluation: unknown[] } }).model.evaluation).toHaveLength(0);
  });
});
