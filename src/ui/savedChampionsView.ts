// The "Saved champions" list (P3-05): rows for what the store found, with Replay and a two-step Delete. It builds nodes
// through a small factory, so the same code runs against the page and against fakes in Node. It only presents; the page
// decides what the buttons do. Damaged entries get only Delete, and a model this app cannot run cannot be replayed.
import type { StoreEntry, StoreListing } from '../persistence/modelStore';

/** The part of a DOM element the list uses. */
export interface UiNode {
  textContent: string | null;
  disabled?: boolean;
  setAttribute(name: string, value: string): void;
  append(...children: UiNode[]): void;
  addEventListener(type: 'click', listener: () => void): void;
}
export interface UiList extends UiNode {
  replaceChildren(...children: UiNode[]): void;
}
export interface UiFactory {
  create(tag: 'li' | 'span' | 'button'): UiNode;
}

export interface SavedRowHandlers {
  replay(id: string): void;
  requestDelete(id: string): void;
  confirmDelete(id: string): void;
  cancelDelete(): void;
}

/** One line describing an entry: name, generation (numbered from 1 as everywhere in the app), fitness and the day it was saved, or why it is damaged. */
export function describeEntry(entry: StoreEntry): string {
  if (entry.status === 'damaged') return `Damaged saved champion (${entry.id}). ${entry.problem}`;
  const { summary } = entry;
  return `${summary.name ?? 'Unnamed champion'} · generation ${summary.generation + 1} · fitness ${summary.fitness.toFixed(1)} · saved ${summary.createdAt.slice(0, 10)}${summary.reproducible ? '' : ' · seed unavailable, not reproducible'}`;
}

/** A short label for buttons and announcements: the name, or "damaged champion". */
export function entryLabel(entry: StoreEntry): string {
  return entry.status === 'damaged' ? 'damaged champion' : (entry.summary.name ?? 'unnamed champion');
}

export function renderSavedList(list: UiList, ui: UiFactory, listing: StoreListing, pendingDelete: string | null, handlers: SavedRowHandlers): void {
  if (!listing.available) {
    list.replaceChildren();
    list.setAttribute('data-count', '0');
    return;
  }
  list.setAttribute('data-count', String(listing.entries.length));
  const button = (text: string, label: string, onClick: () => void, disabled = false): UiNode => {
    const node = ui.create('button');
    node.setAttribute('type', 'button');
    node.setAttribute('class', 'tc-button replay-button');
    node.setAttribute('aria-label', label);
    node.textContent = text;
    node.disabled = disabled;
    node.addEventListener('click', onClick);
    return node;
  };
  const rows = listing.entries.map((entry) => {
    const row = ui.create('li');
    row.setAttribute('data-id', entry.id);
    row.setAttribute('data-status', entry.status);
    const text = ui.create('span');
    text.textContent = describeEntry(entry);
    row.append(text);
    const label = entryLabel(entry);
    if (entry.status === 'ok' && entry.warnings.length > 0) {
      const warning = ui.create('span');
      warning.setAttribute('class', 'saved-warning');
      warning.textContent = entry.warnings.join(' ');
      row.append(warning);
    }
    const actions = ui.create('span');
    actions.setAttribute('class', 'saved-actions');
    if (entry.status === 'ok') actions.append(button('Replay', `Replay ${label}`, () => handlers.replay(entry.id), !entry.drivable));
    if (pendingDelete === entry.id) {
      actions.append(button('Yes, delete', `Confirm delete ${label}`, () => handlers.confirmDelete(entry.id)), button('Keep', `Keep ${label}`, () => handlers.cancelDelete()));
    } else {
      actions.append(button('Delete', `Delete ${label}`, () => handlers.requestDelete(entry.id)));
    }
    row.append(actions);
    return row;
  });
  list.replaceChildren(...rows);
}
