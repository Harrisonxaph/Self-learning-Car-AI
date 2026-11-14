// The evaluation comparison, presented (P5-05): real tables with scoped headers, the warnings, the reasons a circuit was not compared, the
// aggregates under the plan's exact rules, and the caveat. Fake nodes; synthetic rows. It must never rank, judge or show a p-value.
import { describe, expect, it } from 'vitest';
import { compareEvaluations } from '../../src/persistence/evaluationCompare';
import type { EvaluationEntry, EvaluationRow } from '../../src/persistence/evaluationEntry';
import type { ModelDocument } from '../../src/persistence/modelFormat';
import { renderEvaluationComparison } from '../../src/ui/evaluationCompareView';
import { entryWithRows, makeModel, realEntry, row } from '../helpers/evaluationFixtures';
import { FakeNode } from './fakeTrainingPage';

const ui = { create: (tag: string) => new FakeNode(tag) };
const A = makeModel(5, 'view-a');
const B = makeModel(6, 'view-b');
const BASE = realEntry(A, 'kidney-loop');
const done = (seed: number, ticks: number): EvaluationRow => row(seed, 'timeout', 10, 10, 1, ticks);
const crash = (seed: number, gates: number): EvaluationRow => row(seed, 'crashed', gates, 10);
const five = (make: (seed: number) => EvaluationRow): EvaluationRow[] => [0, 1, 2, 3, 4].map(make);
const entry = (model: ModelDocument, trackId: string, rows: readonly EvaluationRow[], extra: Partial<EvaluationEntry> = {}): EvaluationEntry => ({
  ...entryWithRows(BASE, rows),
  modelId: model.id,
  track: { ...BASE.track, id: trackId },
  ...extra,
});
const render = (a: EvaluationEntry[], b: EvaluationEntry[]) => {
  const container = new FakeNode('div');
  renderEvaluationComparison(container, ui, compareEvaluations(A, B, a, b));
  return container;
};
const textOf = (node: FakeNode): string => [node.textContent ?? '', ...node.children.map(textOf)].join('\n');

describe('renderEvaluationComparison', () => {
  it('renders nothing for null, and the refusal message for a refusal', () => {
    const container = new FakeNode('div');
    renderEvaluationComparison(container, ui, null);
    expect(container.children).toHaveLength(0);
    renderEvaluationComparison(container, ui, compareEvaluations(A, B, [], [entry(B, 'x', five((s) => done(s, 600)))]));
    expect(textOf(container)).toContain('no recorded evaluation this app can read');
    expect(container.find((n) => n.tag === 'table')).toHaveLength(0);
  });

  it('a compared circuit is a real table with scoped headers, both champions side by side, A minus B, sample counts and spread', () => {
    const c = render([entry(A, 'x', [done(0, 600), done(1, 600), done(2, 900), done(3, 1200), crash(4, 3)])], [entry(B, 'x', five((s) => crash(s, 2)))]);
    const table = c.find((n) => n.tag === 'table')[0]!;
    expect(table.attributes['data-circuit']).toBe('x');
    expect(table.attributes['data-state']).toBe('compared');
    expect(table.find((n) => n.tag === 'th' && n.attributes.scope === 'col').map((n) => n.textContent)).toEqual(['Item', 'A', 'B', 'A minus B']);
    expect(table.find((n) => n.tag === 'th' && n.attributes.scope === 'row').length).toBeGreaterThanOrEqual(8);
    const text = textOf(c);
    expect(text).toContain('80% of 5'); // A completed a lap on 4 of 5 starts
    expect(text).toContain('13.75 s (4 of 5 starts)');
    expect(text).toContain('no lap completed'); // B: never "0 s"
    expect(text).toContain('unavailable (a lap time is missing)');
    expect(text).toContain('10.00 s to 20.00 s, SD 4.15 s, 4 starts');
    expect(text).toContain('Spread shows how one saved champion varies across its fixed start changes');
  });

  it('a one-sided circuit is a warning, not a table; a not-compared circuit shows both sets of numbers and every reason', () => {
    const a = [entry(A, 'x', five((s) => done(s, 600))), entry(A, 'y', five((s) => done(s, 600))), entry(A, 'z', five((s) => done(s, 600)))];
    const b = [entry(B, 'x', five((s) => done(s, 600))), entry(B, 'y', five((s) => done(s, 600)), { fitnessVersion: 2, timestepSeconds: 0.02 })];
    const c = render(a, b);
    expect(textOf(c)).toContain('z was evaluated for A only');
    expect(c.find((n) => n.tag === 'table' && n.attributes['data-circuit'] === 'z')).toHaveLength(0);
    const y = c.find((n) => n.tag === 'table' && n.attributes['data-circuit'] === 'y')[0]!;
    expect(y.attributes['data-state']).toBe('not-compared');
    expect(textOf(y)).toContain('not compared');
    const reasons = c.find((n) => n.tag === 'li').map((n) => n.textContent);
    expect(reasons.join(' ')).toMatch(/fitness version differs/);
    expect(reasons.join(' ')).toMatch(/timestep differs/);
  });

  it('shows the aggregates only for two or more compared circuits, and the lap-time rule in words', () => {
    const one = render([entry(A, 'x', five((s) => done(s, 600)))], [entry(B, 'x', five((s) => done(s, 900)))]);
    expect(one.find((n) => n.tag === 'table' && n.attributes['data-circuits'] !== undefined)).toHaveLength(0);
    const a = [entry(A, 'x', five((s) => done(s, 600))), entry(A, 'y', five((s) => done(s, 1200))), entry(A, 'z', five((s) => crash(s, 4)))];
    const b = [entry(B, 'x', five((s) => done(s, 900))), entry(B, 'y', five((s) => done(s, 1800))), entry(B, 'z', five((s) => done(s, 600)))];
    const c = render(a, b);
    const agg = c.find((n) => n.tag === 'table' && n.attributes['data-circuits'] === '3')[0]!;
    const text = textOf(agg);
    expect(text).toContain('Across the 3 compared circuits (each circuit counts once): x, y, z');
    expect(text).toContain('circuits where both completed a lap: x, y');
    expect(text).toContain('15.00 s (10 lap-time samples)');
    expect(text).toContain('22.50 s (10 lap-time samples)');
    expect(textOf(c)).toContain('Left out of the first-lap time because one champion, or both, completed no lap there: z.');
    const none = render([entry(A, 'x', five((s) => crash(s, 3))), entry(A, 'y', five((s) => crash(s, 3)))], [entry(B, 'x', five((s) => crash(s, 2))), entry(B, 'y', five((s) => crash(s, 2)))]);
    expect(textOf(none)).toContain('No circuit where both champions completed a lap');
  });

  it('never ranks or judges: no verdict, p-value, interval or "significant" anywhere, and no marker attribute', () => {
    const a = [entry(A, 'x', five((s) => done(s, 600))), entry(A, 'y', five((s) => crash(s, 2)))];
    const b = [entry(B, 'x', five((s) => done(s, 900))), entry(B, 'y', five((s) => done(s, 600)))];
    const c = render(a, b);
    const text = textOf(c);
    expect(text).not.toMatch(/better|worse|winner|best|outperform|superior|significant|p-value|confidence|interval|ranked|beats|higher fitness/i);
    expect(c.find((n) => 'marker' in n.attributes || 'data-marker' in n.attributes)).toHaveLength(0);
  });
});
