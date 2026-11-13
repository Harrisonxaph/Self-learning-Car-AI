// The benchmark page (`?mode=bench`): a thin shell over ui/benchController.ts. It lists the training circuits, runs the headless benchmark in slices and shows
// the result in a real table. Everything it decides is in the controller (tested in Node); this file is covered by the browser tests.
import type { BenchController } from './benchController';

const must = <T extends Element>(selector: string): T => {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`The benchmark page needs ${selector} on the page.`);
  return found;
};

export interface BenchPage {
  stop(): void;
}

export function startBenchPage(controller: BenchController): BenchPage {
  const panel = must<HTMLElement>('#bench-panel');
  const select = must<HTMLSelectElement>('#bench-circuit');
  const run = must<HTMLButtonElement>('#bench-run');
  const cancel = must<HTMLButtonElement>('#bench-cancel');
  const progress = must<HTMLElement>('#bench-progress');
  const message = must<HTMLElement>('#bench-message');
  const table = must<HTMLTableElement>('#bench-table');
  const body = must<HTMLElement>('#bench-body');
  const root = document.documentElement;
  panel.hidden = false;
  root.classList.add('evaluating');

  const options = controller.circuits().map((c) => {
    const option = document.createElement('option');
    option.value = c.id;
    option.textContent = c.name;
    return option;
  });
  select.replaceChildren(...options);

  const render = (): void => {
    const state = controller.state();
    const running = state === 'running';
    if (select.value !== controller.selected()) select.value = controller.selected();
    select.disabled = running;
    run.disabled = running;
    cancel.disabled = !running;
    panel.dataset.state = state;
    const p = controller.progress();
    progress.textContent = p === null ? '' : p.label;
    if (message.textContent !== controller.message()) message.textContent = controller.message();
    const rows = controller.rows();
    table.hidden = rows.length === 0;
    if (rows.length === 0) body.replaceChildren();
    else {
      body.replaceChildren(
        ...rows.map((row) => {
          const tr = document.createElement('tr');
          const th = document.createElement('th');
          th.scope = 'row';
          th.textContent = row.label;
          const td = document.createElement('td');
          td.textContent = row.value;
          tr.append(th, td);
          return tr;
        }),
      );
    }
    const result = controller.result();
    if (result) {
      panel.dataset.carTicks = String(result.carTicks);
      panel.dataset.ticks = String(result.ticks);
      panel.dataset.carTicksPerSecond = result.carTicksPerSecond === null ? '' : result.carTicksPerSecond.toFixed(1);
      panel.dataset.ticksFullPopulation = result.ticksPerSecondFullPopulation === null ? '' : result.ticksPerSecondFullPopulation.toFixed(2);
    } else {
      delete panel.dataset.carTicks;
      delete panel.dataset.ticks;
      delete panel.dataset.carTicksPerSecond;
      delete panel.dataset.ticksFullPopulation;
    }
  };

  const unsubscribe = controller.subscribe(render);
  const onRun = (): void => controller.run();
  const onCancel = (): void => controller.cancel();
  const onSelect = (): void => controller.select(select.value);
  // A background page is throttled, so its timing is not a measurement: leaving the foreground ends the run.
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') controller.interrupt();
  };
  run.addEventListener('click', onRun);
  cancel.addEventListener('click', onCancel);
  select.addEventListener('change', onSelect);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onVisibility);
  render();

  return {
    stop() {
      unsubscribe();
      run.removeEventListener('click', onRun);
      cancel.removeEventListener('click', onCancel);
      select.removeEventListener('change', onSelect);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onVisibility);
      controller.cancel();
    },
  };
}
