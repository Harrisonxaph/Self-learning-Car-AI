// The evaluate page (P4-05, `?mode=evaluate`): a thin shell over ui/evaluateController.ts. It lists the saved champions, offers
// the built-in TRAINING and VALIDATION circuits (never a held-out one), runs the evaluation and shows the stored results in a
// real table. Everything it decides is in the controller (tested in Node); this file is covered by the browser tests.
import type { EvaluationEntry } from '../persistence/evaluationEntry';
import type { EvaluateController } from './evaluateController';

const must = <T extends Element>(selector: string): T => {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`The evaluate page needs ${selector} on the page.`);
  return found;
};

export interface EvaluatePage {
  stop(): void;
}

const percent = (fraction: number, episodes: number): string => `${Math.round(fraction * 100)}% (${Math.round(fraction * episodes)} of ${episodes})`;

export function startEvaluatePage(controller: EvaluateController): EvaluatePage {
  const panel = must<HTMLElement>('#evaluate-panel');
  const select = must<HTMLSelectElement>('#ev-model');
  const note = must<HTMLElement>('#ev-model-note');
  const circuitList = must<HTMLElement>('#ev-circuit-list');
  const run = must<HTMLButtonElement>('#ev-run');
  const cancel = must<HTMLButtonElement>('#ev-cancel');
  const progress = must<HTMLElement>('#ev-progress');
  const message = must<HTMLElement>('#ev-message');
  const body = must<HTMLElement>('#ev-body');
  const hidden = must<HTMLElement>('#ev-hidden');
  const root = document.documentElement;
  panel.hidden = false;
  root.classList.add('evaluating');

  const cleanups: (() => void)[] = [];
  const on = <K extends keyof HTMLElementEventMap>(target: HTMLElement, type: K, handler: () => void): void => {
    target.addEventListener(type, handler);
    cleanups.push(() => target.removeEventListener(type, handler));
  };

  let modelSignature = '';
  const renderModels = (): void => {
    const models = controller.models();
    const chosen = controller.selected();
    // The options are rebuilt only when the list itself changes, so a focused select is never replaced under the person.
    const signature = JSON.stringify(models.map((m) => [m.id, m.label, m.usable]));
    if (signature !== modelSignature) {
      modelSignature = signature;
      const options: HTMLOptionElement[] = [];
      const none = document.createElement('option');
      none.value = '';
      none.textContent = models.length === 0 ? 'No saved champions' : 'Choose a champion…';
      options.push(none);
      for (const m of models) {
        const option = document.createElement('option');
        option.value = m.id;
        option.textContent = m.usable ? m.label : `${m.label} (cannot be run)`;
        options.push(option);
      }
      select.replaceChildren(...options);
    }
    if (select.value !== (chosen ?? '')) select.value = chosen ?? '';
    const current = models.find((m) => m.id === chosen);
    const text =
      models.length === 0
        ? 'No saved champions yet. Save one in the training view (?mode=train), then come back.'
        : current === undefined
          ? 'Choose a saved champion to evaluate.'
          : current.usable
            ? `Trained on ${current.trainedOn ?? 'an unknown circuit'}.`
            : (current.reason ?? 'This champion cannot be run.');
    if (note.textContent !== text) note.textContent = text;
  };

  // The circuit checkboxes are built ONCE and then updated in place: replacing a focused checkbox would drop keyboard focus.
  const boxes = new Map<string, { box: HTMLInputElement; text: HTMLSpanElement; name: string }>();
  const renderCircuits = (): void => {
    const circuits = controller.circuits();
    const running = controller.state() === 'running';
    if (boxes.size === 0) {
      const groups: [string, 'training' | 'validation' | 'custom'][] = [
        ['Other training circuits', 'training'],
        ['Validation circuits', 'validation'],
        ['Your saved tracks (custom layouts: not built-in circuits, not held-out)', 'custom'],
      ];
      circuitList.replaceChildren(
        ...groups.map(([title, split]) => {
          const group = document.createElement('div');
          group.className = 'ev-group';
          group.setAttribute('role', 'group');
          group.setAttribute('aria-label', title);
          const heading = document.createElement('p');
          heading.className = 'ev-group-title';
          heading.textContent = title;
          group.append(heading);
          const members = circuits.filter((x) => x.split === split);
          if (split === 'custom' && members.length === 0) {
            const none = document.createElement('p');
            none.className = 'graph-summary';
            none.textContent = 'No saved tracks yet. Draw one in the track editor (?mode=edit) and press Save track.';
            group.append(none);
          }
          for (const c of members) {
            const label = document.createElement('label');
            label.className = 'ev-circuit';
            const box = document.createElement('input');
            box.type = 'checkbox';
            box.dataset.circuit = c.id;
            box.addEventListener('change', () => controller.toggle(c.id));
            const text = document.createElement('span');
            label.append(box, text);
            group.append(label);
            boxes.set(c.id, { box, text, name: c.name });
          }
          return group;
        }),
      );
    }
    for (const c of circuits) {
      const entry = boxes.get(c.id);
      if (!entry) continue;
      if (entry.box.checked !== c.checked) entry.box.checked = c.checked;
      if (entry.box.disabled !== running) entry.box.disabled = running;
      const text = c.trainedOn ? `${entry.name} (the training circuit)` : entry.name;
      if (entry.text.textContent !== text) entry.text.textContent = text;
    }
  };

  const cell = (text: string): HTMLTableCellElement => {
    const td = document.createElement('td');
    td.textContent = text;
    return td;
  };
  const rowFor = (e: EvaluationEntry): HTMLTableRowElement => {
    const s = e.summary;
    const tr = document.createElement('tr');
    tr.dataset.circuit = e.track.id;
    tr.dataset.split = e.track.split;
    const name = document.createElement('th');
    name.scope = 'row';
    name.textContent = e.track.split === 'custom' ? `${e.track.id} (custom layout${controller.trackSaved(e.track.id) ? '' : ', no longer saved'})` : `${e.track.id} (${e.track.split})`;
    tr.append(
      name,
      cell(percent(s.lapCompletion, s.episodes)),
      cell(percent(s.collisionRate, s.episodes)),
      cell(`${s.outcomes.completed} / ${s.outcomes.crashed} / ${s.outcomes.stalled} / ${s.outcomes.timeout}`),
      cell(s.meanFirstLapSeconds === null ? `none (0 of ${s.episodes} completed a lap)` : `${s.meanFirstLapSeconds.toFixed(1)} s (n = ${s.firstLapSamples})`),
      cell(`${Math.round(s.meanOrderedProgress * 100)}% of a lap`),
      cell(e.recordedAt.slice(0, 16).replace('T', ' ')),
    );
    return tr;
  };

  let wasRunning = false;
  const render = (): void => {
    renderModels();
    renderCircuits();
    const running = controller.state() === 'running';
    // Keyboard focus follows the work: Run is disabled while running, so focus moves to Cancel, and back to Run when it ends.
    const runHadFocus = document.activeElement === run;
    const cancelHadFocus = document.activeElement === cancel;
    run.disabled = !controller.canRun();
    cancel.disabled = !running;
    select.disabled = running;
    if (running && !wasRunning && runHadFocus) cancel.focus();
    if (!running && wasRunning && (cancelHadFocus || document.activeElement === document.body)) (run.disabled ? select : run).focus();
    wasRunning = running;
    progress.textContent = controller.progress();
    message.textContent = controller.message();
    const results = controller.results();
    body.replaceChildren(...results.map(rowFor));
    const extra = controller.hiddenEntries();
    hidden.textContent = extra > 0 ? `${extra} other evaluation entr${extra === 1 ? 'y' : 'ies'} on this champion ${extra === 1 ? 'is' : 'are'} kept untouched and not shown here.` : '';
    Object.assign(panel.dataset, {
      evalState: controller.state(),
      evalEntries: String(results.length),
      evalModels: String(controller.models().length),
      evalSelected: controller.selected() ?? '',
    });
  };

  cleanups.push(controller.subscribe(render));
  select.addEventListener('change', () => controller.select(select.value === '' ? null : select.value));
  cleanups.push(() => select.removeEventListener('change', () => undefined));
  on(run, 'click', () => controller.run());
  on(cancel, 'click', () => controller.cancel());
  controller.refresh();
  render();

  return {
    stop() {
      for (const cleanup of cleanups.splice(0)) cleanup();
      panel.hidden = true;
      root.classList.remove('evaluating');
    },
  };
}
