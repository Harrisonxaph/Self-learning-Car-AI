// The comparison of two saved champions' RECORDED evaluations (P5-05), presented: real <table>s with scoped headers (a screen reader
// reads "label, A, B, A minus B"), the warnings, the reasons a circuit was not compared, the aggregates under the plan's exact rules and
// the scenario-spread caveat. It builds nodes through the same small factory as compareView, so the same code runs against the page
// and against fakes in Node. It only presents what persistence/evaluationCompare returned: it never ranks, never says one champion is
// better, shows no p-value, interval or "significant", and writes nothing.
import { SCENARIO_SPREAD_CAVEAT, type Aggregate, type CircuitComparison, type CircuitSide, type EvaluationCompareResult, type Spread } from '../persistence/evaluationCompare';
import type { UiFactory, UiList, UiNode } from './savedChampionsView';

const text = (ui: UiFactory, tag: 'p' | 'span' | 'li' | 'th' | 'td' | 'caption', content: string, cls?: string): UiNode => {
  const node = ui.create(tag);
  node.textContent = content;
  if (cls) node.setAttribute('class', cls);
  return node;
};

const pct = (value: number): string => `${(value * 100).toFixed(0)}%`;
const signed = (value: number, digits: number, unit: string): string => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(digits)}${unit}`;
const pp = (difference: number): string => signed(difference * 100, 0, ' points');
const laps = (value: number): string => `${value.toFixed(2)} laps`;
const seconds = (value: number | null): string => (value === null ? 'no lap completed' : `${value.toFixed(2)} s`);
const lapTimeCell = (side: CircuitSide): string => (side.meanFirstLapSeconds === null ? 'no lap completed' : `${side.meanFirstLapSeconds.toFixed(2)} s (${side.firstLapSamples} of ${side.episodes} starts)`);
const spreadText = (spread: Spread | null, unit: (v: number) => string): string => {
  if (spread === null) return 'unavailable (no start completed a lap)';
  const range = `${unit(spread.min)} to ${unit(spread.max)}`;
  return spread.sd === null ? `${range}, ${spread.n} ${spread.n === 1 ? 'start' : 'starts'}` : `${range}, SD ${unit(spread.sd)}, ${spread.n} starts`;
};
const outcomesText = (side: CircuitSide): string => {
  const o = side.outcomes;
  return `${o.completed} completed, ${o.crashed} crashed, ${o.stalled} stalled, ${o.timeout} timed out`;
};

function headRow(ui: UiFactory, labels: readonly string[]): UiNode {
  const head = ui.create('thead');
  const tr = ui.create('tr');
  for (const label of labels) {
    const th = text(ui, 'th', label);
    th.setAttribute('scope', 'col');
    tr.append(th);
  }
  head.append(tr);
  return head;
}

function dataRow(ui: UiFactory, label: string, cells: readonly string[]): UiNode {
  const tr = ui.create('tr');
  const th = text(ui, 'th', label);
  th.setAttribute('scope', 'row');
  // A cell with nothing to say shows a dash, so the stacked phone layout never shows a label with no value after it.
  tr.append(th, ...cells.map((c) => text(ui, 'td', c === '' ? '—' : c)));
  return tr;
}

function circuitTable(ui: UiFactory, c: CircuitComparison): UiNode {
  const table = ui.create('table');
  table.setAttribute('class', 'compare-table eval-compare-table');
  table.setAttribute('data-circuit', c.trackId);
  table.setAttribute('data-state', c.state);
  table.append(text(ui, 'caption', `${c.trackId} (${c.split})${c.state === 'compared' ? '' : ' - not compared'}`));
  table.append(headRow(ui, ['Item', 'A', 'B', 'A minus B']));
  const body = ui.create('tbody');
  const a = c.a;
  const b = c.b;
  const d = c.difference;
  const both = (pick: (s: CircuitSide) => string): string[] => [a ? pick(a) : 'not evaluated', b ? pick(b) : 'not evaluated'];
  body.append(dataRow(ui, 'Laps completed (of starts)', [...both((s) => `${pct(s.lapCompletion)} of ${s.episodes}`), d ? pp(d.lapCompletion) : 'not compared']));
  body.append(dataRow(ui, 'Crashes (of starts)', [...both((s) => `${pct(s.collisionRate)} of ${s.episodes}`), d ? pp(d.collisionRate) : 'not compared']));
  body.append(dataRow(ui, 'Outcomes', [...both(outcomesText), '']));
  body.append(dataRow(ui, 'Mean ordered progress', [...both((s) => laps(s.meanOrderedProgress)), d ? signed(d.meanOrderedProgress, 2, ' laps') : 'not compared']));
  body.append(dataRow(ui, 'Mean first-lap time', [...both(lapTimeCell), d ? (d.meanFirstLapSeconds === null ? 'unavailable (a lap time is missing)' : signed(d.meanFirstLapSeconds, 2, ' s')) : 'not compared']));
  body.append(dataRow(ui, 'Spread of first-lap time across starts', [...both((s) => spreadText(s.firstLapSpread, (v) => v.toFixed(2) + ' s')), '']));
  body.append(dataRow(ui, 'Spread of progress across starts', [...both((s) => spreadText(s.progressSpread, (v) => v.toFixed(2))), '']));
  body.append(dataRow(ui, 'Brake output', [...both((s) => (s.brakeEnabled ? 'enabled' : 'masked to 0')), '']));
  table.append(body);
  return table;
}

function aggregateTable(ui: UiFactory, g: Aggregate): UiNode {
  const table = ui.create('table');
  table.setAttribute('class', 'compare-table eval-compare-aggregate');
  table.setAttribute('data-circuits', String(g.circuits.length));
  table.append(text(ui, 'caption', `Across the ${g.circuits.length} compared circuits (each circuit counts once): ${g.circuits.join(', ')}`));
  table.append(headRow(ui, ['Item', 'A', 'B', 'A minus B']));
  const body = ui.create('tbody');
  body.append(dataRow(ui, 'Mean laps completed', [pct(g.lapCompletion.a), pct(g.lapCompletion.b), pp(g.lapCompletion.difference)]));
  body.append(dataRow(ui, 'Mean crashes', [pct(g.collisionRate.a), pct(g.collisionRate.b), pp(g.collisionRate.difference)]));
  body.append(dataRow(ui, 'Mean ordered progress', [laps(g.meanOrderedProgress.a), laps(g.meanOrderedProgress.b), signed(g.meanOrderedProgress.difference, 2, ' laps')]));
  const t = g.lapTime;
  if (t.state === 'values') {
    body.append(dataRow(ui, `Mean first-lap time (circuits where both completed a lap: ${t.pairedCircuits.join(', ')})`, [`${seconds(t.a)} (${t.samplesA} lap-time samples)`, `${seconds(t.b)} (${t.samplesB} lap-time samples)`, t.difference === null ? '' : signed(t.difference, 2, ' s')]));
  } else {
    body.append(dataRow(ui, 'Mean first-lap time', [t.state === 'single' ? 'see the circuit above' : 'unavailable', t.state === 'single' ? 'see the circuit above' : 'unavailable', '']));
  }
  table.append(body);
  return table;
}

/** Replaces the container's contents with the evaluation comparison, with the refusal message, or with nothing for `null`. */
export function renderEvaluationComparison(container: UiList, ui: UiFactory, result: EvaluationCompareResult | null): void {
  if (result === null) {
    container.replaceChildren();
    return;
  }
  const children: UiNode[] = [text(ui, 'p', 'Recorded evaluations on shared circuits', 'graph-summary compare-why')];
  if (!result.ok) {
    children.push(text(ui, 'p', result.message, 'saved-warning'));
    container.replaceChildren(...children);
    return;
  }
  for (const warning of result.warnings) children.push(text(ui, 'p', warning, 'saved-warning'));
  for (const c of result.circuits) {
    if (c.state === 'a-only' || c.state === 'b-only') continue; // named in the warnings; there is nothing to put side by side
    children.push(circuitTable(ui, c));
    if (c.state === 'not-compared') {
      children.push(text(ui, 'p', 'Why this circuit was not compared:', 'graph-summary compare-why'));
      const ul = ui.create('ul');
      for (const reason of c.reasons) ul.append(text(ui, 'li', reason));
      children.push(ul);
    }
  }
  if (result.aggregate !== null) {
    children.push(aggregateTable(ui, result.aggregate));
    if (result.aggregate.lapTime.state !== 'values') children.push(text(ui, 'p', result.aggregate.lapTime.note, 'graph-summary'));
    else if (result.aggregate.lapTime.excludedCircuits.length > 0) children.push(text(ui, 'p', `Left out of the first-lap time because one champion, or both, completed no lap there: ${result.aggregate.lapTime.excludedCircuits.join(', ')}.`, 'graph-summary'));
  }
  children.push(text(ui, 'p', SCENARIO_SPREAD_CAVEAT, 'graph-summary'));
  container.replaceChildren(...children);
}
