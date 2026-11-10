// The comparison of two saved champions (P3-08), presented: the warnings, the reasons fitness is not ranked or the pair
// cannot be replayed together, and an accessible table (a real <table> with scoped headers, so a screen reader reads
// "label, A, B"). It builds nodes through the same small factory as the saved list, so the same code runs against the page
// and against fakes in Node. It only presents: it never ranks anything the comparison did not allow, never renders model
// data it has not been given as plain text, and says nothing about one model being better.
import { FITNESS_CAVEAT, type CompareResult, type Comparison } from '../persistence/modelCompare';
import type { UiList, UiFactory, UiNode } from './savedChampionsView';

const text = (ui: UiFactory, tag: 'p' | 'span' | 'li' | 'th' | 'td' | 'caption', content: string, cls?: string): UiNode => {
  const node = ui.create(tag);
  node.textContent = content;
  if (cls) node.setAttribute('class', cls);
  return node;
};

/** The sentence for the ranking marker, only when the two were scored the same way. */
export function markerText(comparison: Comparison): string | null {
  if (comparison.marker === null) return null;
  const { a, b } = comparison.rows.find((row) => row.label === 'Fitness') ?? { a: '', b: '' };
  if (comparison.marker === 'tie') return `Scored the same way, with equal fitness (${a}).`;
  return `Scored the same way. Higher fitness: ${comparison.marker === 'a' ? 'A' : 'B'} (A ${a}, B ${b}).`;
}

/** Replaces the container's contents with the comparison, or with the message if the two could not be compared. */
export function renderComparison(container: UiList, ui: UiFactory, result: CompareResult | null): void {
  if (result === null) {
    container.replaceChildren();
    return;
  }
  if (!result.ok) {
    container.replaceChildren(text(ui, 'p', result.message, 'saved-warning'));
    return;
  }
  const children: UiNode[] = [];
  for (const warning of result.warnings) children.push(text(ui, 'p', warning, 'saved-warning'));
  const marker = markerText(result);
  if (marker !== null) children.push(text(ui, 'p', marker, 'graph-summary compare-marker'));
  children.push(text(ui, 'p', FITNESS_CAVEAT, 'graph-summary'));

  const table = ui.create('table');
  table.setAttribute('class', 'compare-table');
  table.append(text(ui, 'caption', 'Side-by-side comparison of saved champions A and B'));
  const head = ui.create('thead');
  const headRow = ui.create('tr');
  for (const label of ['Item', 'A', 'B']) {
    const th = text(ui, 'th', label);
    th.setAttribute('scope', 'col');
    headRow.append(th);
  }
  head.append(headRow);
  table.append(head);
  const body = ui.create('tbody');
  let group = '';
  for (const row of result.rows) {
    if (row.group !== group) {
      group = row.group;
      const groupRow = ui.create('tr');
      const th = text(ui, 'th', group, 'compare-group');
      th.setAttribute('colspan', '3');
      th.setAttribute('scope', 'colgroup');
      groupRow.append(th);
      body.append(groupRow);
    }
    const tr = ui.create('tr');
    tr.setAttribute('data-state', row.state);
    const label = text(ui, 'th', row.label);
    label.setAttribute('scope', 'row');
    tr.append(label, text(ui, 'td', row.a), text(ui, 'td', row.b));
    body.append(tr);
  }
  table.append(body);
  children.push(table);

  const list = (title: string, reasons: readonly string[]) => {
    children.push(text(ui, 'p', title, 'graph-summary compare-why'));
    const ul = ui.create('ul');
    for (const reason of reasons) ul.append(text(ui, 'li', reason));
    children.push(ul);
  };
  if (!result.fitness.comparable) list('Why fitness is not ranked:', result.fitness.reasons);
  if (!result.sharedReplay.ok) list('Why they cannot be replayed together:', result.sharedReplay.reasons);
  container.replaceChildren(...children);
}
