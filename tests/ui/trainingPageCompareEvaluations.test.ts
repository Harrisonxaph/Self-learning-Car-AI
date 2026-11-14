// The recorded evaluations in the Compare panel, on the page's real wiring (P5-05): fake saves in a fake localStorage whose models carry
// REAL evaluation entries (made by the real evaluator), fake nodes, fake frames. The claims: the entries are recognised exactly as the
// Evaluate page recognises them (an invalid or foreign claim is opaque), shared circuits are compared, a one-sided circuit is named, a
// missing evaluation is a message, nothing is written, and the block clears with the comparison.
import { describe, expect, it } from 'vitest';
import type { ModelDocument } from '../../src/persistence/modelFormat';
import { startTrainingPage } from '../../src/ui/trainingPage';
import { DEFAULT_SIM_CONFIG } from '../../src/sim/config';
import { makeModel, realEntry } from '../helpers/evaluationFixtures';
import { FakeFrames } from './fakeFrames';
import { FakeLocalStorage, fakePage, type FakeNode } from './fakeTrainingPage';

const FRAME_MS = DEFAULT_SIM_CONFIG.timestepSeconds * 1000;
const base = (seed: number, id: string) => makeModel(seed, id);
const withEvaluation = (model: ModelDocument, evaluation: unknown[]): ModelDocument => ({ ...model, evaluation }) as ModelDocument;
const A0 = base(5, 'pe-a');
const B0 = base(6, 'pe-b');
const aKidney = realEntry(A0, 'kidney-loop');
const aSweepers = realEntry(A0, 's-sweepers');
const bKidney = realEntry(B0, 'kidney-loop');
const bSweepers = realEntry(B0, 's-sweepers');

function setup(models: readonly ModelDocument[]) {
  const storage = new FakeLocalStorage();
  for (const m of models) storage.setItem(`sdae:model:${m.id}`, JSON.stringify(m));
  storage.setItem('sdae:models:index', JSON.stringify(models.map((m) => m.id)));
  const frames = new FakeFrames();
  const made = fakePage(frames, { now: () => 0, storage: () => storage, compare: true });
  startTrainingPage(made.page);
  frames.fire(-FRAME_MS);
  const compare = made.compare!;
  const textOf = (node: FakeNode): string => [node.textContent ?? '', ...node.children.map(textOf)].join('\n');
  const evaluationText = () => textOf(compare.evaluations);
  return { ...made, compare, storage, evaluationText };
}

describe('Compare shows the recorded evaluations', () => {
  it('compares the shared circuit side by side, names the one-sided circuit, and writes nothing', () => {
    const p = setup([withEvaluation(A0, [aKidney, aSweepers]), withEvaluation(B0, [bKidney])]);
    const before = new Map(p.storage.data);
    p.compare.run.click();
    expect(p.canvas.dataset.compareEvaluations).toBe('circuits');
    const text = p.evaluationText();
    expect(text).toContain('Recorded evaluations on shared circuits');
    expect(text).toContain('kidney-loop (training)');
    expect(text).toContain('s-sweepers was evaluated for A only');
    expect(text).toContain('Spread shows how one saved champion varies across its fixed start changes');
    expect(p.compare.evaluations.find((n) => n.tag === 'table')).toHaveLength(1); // kidney-loop only; the one-sided circuit is a warning
    expect(p.storage.data).toEqual(before);
  });

  it('two shared circuits give the aggregate table', () => {
    const p = setup([withEvaluation(A0, [aKidney, aSweepers]), withEvaluation(B0, [bKidney, bSweepers])]);
    p.compare.run.click();
    expect(p.canvas.dataset.compareEvaluations).toBe('aggregate');
    expect(p.compare.evaluations.find((n) => n.tag === 'table' && n.attributes['data-circuits'] === '2')).toHaveLength(1);
    expect(p.evaluationText()).toContain('Across the 2 compared circuits');
  });

  it('a champion with no recorded evaluation is a plain message pointing to the Evaluate page, and the P3-08 table is unaffected', () => {
    const p = setup([withEvaluation(A0, [aKidney]), B0]);
    p.compare.run.click();
    expect(p.canvas.dataset.compareEvaluations).toBe('refused');
    expect(p.evaluationText()).toContain('no recorded evaluation this app can read. Evaluate it on the Evaluate page first.');
    expect(p.compare.result.find((n) => n.tag === 'table')).toHaveLength(1);
    expect(p.canvas.dataset.compare).toBe('comparable');
  });

  it('an invalid claim, an entry of another kind and an entry belonging to another champion are opaque and never shown', () => {
    const forged = { ...bKidney, modelId: 'pe-a' }; // claims to be A's, sits in B's array
    const garbage = { kind: 'p4-05-evaluation-v1', summary: { episodes: 5 } };
    const p = setup([withEvaluation(A0, [aKidney, { kind: 'something-else', x: 1 }, 7, null]), withEvaluation(B0, [forged, garbage, bKidney])]);
    p.compare.run.click();
    expect(p.canvas.dataset.compareEvaluations).toBe('circuits');
    expect(p.compare.evaluations.find((n) => n.tag === 'table')).toHaveLength(1);
    expect(p.evaluationText()).not.toContain('something-else');
    expect(p.evaluationText()).not.toMatch(/garbage|forged/);
  });
});
