// The race page (P5-03, `?mode=race`): a thin shell over ui/raceController.ts. A setup panel (champion, circuit, laps), a
// render-time countdown, one canvas drawn through the P4-07 camera with both cars labelled, the existing on-screen
// Left, Right, Gas and Brake buttons and keys, and a results panel. Everything it decides is in the controller (tested in
// Node) and in training/race.ts; this file is covered by the browser tests. It never reads the simulation to decide
// anything: it draws the controller's state and feeds it the held buttons once per fixed tick.
import { attachHoldButton, attachKeyboard, attachSafetyRelease, createHeldInputs, type HoldAction } from './controls/input';
import { controlsFromInput } from '../ai/drivers';
import { drawCars } from '../render/raceView';
import { RACE_COLOURS } from '../render/raceView';
import { paintTrack } from '../render/cameraScene';
import type { TrackLayer } from '../render/trackLayer';
import { browserViewportEnvironment, createViewport, type Viewport, type ViewportSize } from '../render/viewport';
import { createFixedStepClock } from '../sim/fixedStep';
import { DEFAULT_SIM_CONFIG } from '../sim/config';
import { trackBounds } from '../sim/track';
import type { RacerResult } from '../training/race';
import { createCameraController, type CameraController } from './cameraController';
import { startCameraPage, type CameraPage } from './cameraPage';
import { browserFrameEnvironment, startFrameLoop, type FrameLoop } from './frameLoop';
import type { RaceController } from './raceController';

const must = <T extends Element>(selector: string): T => {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`The race page needs ${selector} on the page.`);
  return found;
};

export interface RacePageDeps {
  readonly controller: RaceController;
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  readonly trackLayer: TrackLayer<HTMLCanvasElement>;
}

export interface RacePage {
  stop(): void;
}

const OUTCOME_TEXT: Readonly<Record<string, string>> = Object.freeze({
  completed: 'Completed',
  crashed: 'Crashed (wall contact)',
  stalled: 'Stalled (no new gate in time)',
  timeout: 'Ran out of race time',
});

const secondsText = (value: number | null): string => (value === null ? '—' : `${value.toFixed(2)} s`);

export function startRacePage(deps: RacePageDeps): RacePage {
  const { controller, canvas, context } = deps;
  const root = document.documentElement;
  const setupPanel = must<HTMLElement>('#race-panel');
  const modelSelect = must<HTMLSelectElement>('#rc-model');
  const modelNote = must<HTMLElement>('#rc-note');
  const circuitSelect = must<HTMLSelectElement>('#rc-circuit');
  const lapsSelect = must<HTMLSelectElement>('#rc-laps');
  const startButton = must<HTMLButtonElement>('#rc-start');
  const messageLine = must<HTMLElement>('#rc-message');
  const hudPanel = must<HTMLElement>('#race-hud');
  const youOut = must<HTMLOutputElement>('#rh-you');
  const aiOut = must<HTMLOutputElement>('#rh-ai');
  const timeOut = must<HTMLOutputElement>('#rh-time');
  const status = must<HTMLElement>('#hud-message');
  const countdownText = must<HTMLElement>('#race-countdown');
  const resultsPanel = must<HTMLElement>('#race-results');
  const comparison = must<HTMLElement>('#rr-comparison');
  const resultBody = must<HTMLElement>('#rr-body');
  const resultNote = must<HTMLElement>('#rr-note');
  const againButton = must<HTMLButtonElement>('#rr-restart');
  const backButton = must<HTMLButtonElement>('#rr-back');
  const restartButton = must<HTMLButtonElement>('#restart');
  const controlsBar = must<HTMLElement>('.controls');
  const keysHelp = must<HTMLElement>('.keys-help');
  const driving = [must<HTMLElement>('.hud')];
  const holdButtons = [...document.querySelectorAll<HTMLButtonElement>('button[data-action]')];
  const config = DEFAULT_SIM_CONFIG;

  const cleanups: (() => void)[] = [];
  const on = <K extends keyof HTMLElementEventMap>(target: HTMLElement, type: K, handler: (event: HTMLElementEventMap[K]) => void): void => {
    target.addEventListener(type, handler as EventListener);
    cleanups.push(() => target.removeEventListener(type, handler as EventListener));
  };

  // Input: keys and on-screen buttons record what is held; the race reads it once per fixed tick.
  const held = createHeldInputs();
  let restartRequested = false;
  const isNativeButton = (target: unknown): boolean =>
    target === restartButton ||
    (target instanceof HTMLElement && target.tagName === 'BUTTON' && target.closest('#camera-controls, #race-panel, #race-results') !== null);
  cleanups.push(attachKeyboard(window, held, () => (restartRequested = true), isNativeButton));
  cleanups.push(attachSafetyRelease(window, document, held));
  for (const button of holdButtons) cleanups.push(attachHoldButton(button, button.dataset.action as HoldAction, held));
  on(restartButton, 'click', (event) => {
    restartRequested = true;
    if (event.detail > 0) restartButton.blur();
  });

  for (const panel of driving) panel.hidden = true;
  setupPanel.hidden = false;

  // ---- the running race: the camera, the viewport and the loop exist only while a race is on screen ----
  let followAi = false;
  let session: { camera: CameraController; cameraPage: CameraPage; viewport: Viewport; loop: FrameLoop; trackId: string } | null = null;

  const draw = (size: ViewportSize): void => {
    const view = controller.view();
    if (!view || !session) return;
    const { setup, state } = view;
    const { track, physics } = setup.context.environment;
    session.camera.setCanvas(size.cssWidth, size.cssHeight);
    const screen = paintTrack(context, deps.trackLayer, track, size, session.camera.view(), session.camera.atFit());
    if (!screen) return;
    const humanEnded = state.human.episode.outcome !== null;
    const aiEnded = state.ai.episode.outcome !== null;
    drawCars(
      context,
      size,
      screen,
      [
        { car: state.ai.racer.car, finished: aiEnded, fill: RACE_COLOURS.ai, label: state.ai.racer.car.crashed ? 'AI (crashed)' : 'AI' },
        { car: state.human.racer.car, finished: humanEnded, fill: RACE_COLOURS.you, label: state.human.racer.car.crashed ? 'You (crashed)' : 'You' },
      ],
      physics,
    );
    const { dataset } = canvas;
    dataset.trackScale = String(screen.scale);
    dataset.trackOffsetX = String(screen.offsetX);
    dataset.trackOffsetY = String(screen.offsetY);
  };

  const followedPosition = () => {
    const view = controller.view();
    if (!view) return null;
    return (followAi ? view.state.ai : view.state.human).racer.car.vehicle.position;
  };

  const racerLine = (who: 'human' | 'ai'): string => {
    const view = controller.view();
    if (!view) return '—';
    const episode = view.state[who].episode;
    const progress = view.state[who].racer.progress;
    const outcome = episode.outcome === null ? 'racing' : (OUTCOME_TEXT[episode.outcome] ?? episode.outcome);
    return `lap ${Math.min(progress.lapTicks.length + 1, view.setup.laps)} of ${view.setup.laps} · gate ${progress.gatesPassed} · ${outcome}`;
  };

  const writeDataset = (): void => {
    const view = controller.view();
    const phase = controller.phase();
    const data: Record<string, string> = { racePhase: phase };
    if (view) {
      const h = view.state.human;
      const a = view.state.ai;
      Object.assign(data, {
        raceTick: String(view.state.tick),
        humanX: String(h.racer.car.vehicle.position.x),
        humanY: String(h.racer.car.vehicle.position.y),
        humanOutcome: h.episode.outcome ?? '',
        humanGates: String(h.racer.progress.gatesPassed),
        aiX: String(a.racer.car.vehicle.position.x),
        aiY: String(a.racer.car.vehicle.position.y),
        aiOutcome: a.episode.outcome ?? '',
        aiGates: String(a.racer.progress.gatesPassed),
      });
    }
    for (const [key, value] of Object.entries(data)) if (canvas.dataset[key] !== value) canvas.dataset[key] = value;
  };

  const setText = (target: HTMLElement, text: string): void => {
    if (target.textContent !== text) target.textContent = text;
  };

  const renderHud = (): void => {
    const phase = controller.phase();
    setText(youOut, racerLine('human'));
    setText(aiOut, racerLine('ai'));
    setText(timeOut, `${controller.elapsedSeconds().toFixed(1)} s`);
    const count = controller.countdown();
    countdownText.hidden = !(phase === 'countdown' || (phase === 'racing' && controller.elapsedSeconds() < 0.6));
    setText(countdownText, count === null ? 'Go!' : String(count));
    setText(status, phase === 'countdown' ? 'Get ready: the race starts when the countdown ends.' : phase === 'racing' ? 'Racing: both cars are on the track.' : phase === 'finished' ? 'Race finished.' : '');
    for (const button of holdButtons) button.classList.toggle('held', held.read()[button.dataset.action as HoldAction]);
    writeDataset();
  };

  const leaveRace = (): void => {
    if (!session) return;
    session.loop.stop();
    session.cameraPage.stop();
    session.viewport.stop();
    session = null;
    held.releaseAll();
    for (const button of holdButtons) button.classList.remove('held');
  };

  const enterRace = (): void => {
    const view = controller.view();
    if (!view || session) return;
    const track = view.setup.context.environment.track;
    followAi = false;
    const camera = createCameraController({ bounds: trackBounds(track), cssWidth: 0, cssHeight: 0, now: () => performance.now() });
    let viewport: Viewport | null = null;
    const cameraPage = startCameraPage({
      canvas,
      controller: camera,
      targetName: () => (followAi ? 'the AI car' : 'your car'),
      compare: () => ({ offered: true, label: followAi ? 'Follow you' : 'Follow AI' }),
      onToggleCompare: () => {
        followAi = !followAi;
      },
      changed: () => {
        if (viewport) draw(viewport.current());
      },
    });
    viewport = createViewport(canvas, browserViewportEnvironment(canvas), draw);
    const loop = startFrameLoop(browserFrameEnvironment(), createFixedStepClock(config), {
      step: () => {
        if (restartRequested) {
          restartRequested = false;
          held.releaseAll();
          controller.restart();
        }
        // One fixed tick of both cars; during the countdown the controller ignores it, so nothing runs.
        controller.step(controlsFromInput(held.read()));
      },
      render: () => {
        controller.frame(performance.now());
        camera.frame(followedPosition());
        draw(viewport!.current());
        cameraPage.refresh();
        renderHud();
      },
    });
    session = { camera, cameraPage, viewport, loop, trackId: track.id };
  };

  const renderResults = (): void => {
    const result = controller.result();
    if (!result) return;
    setText(comparison, result.comparison);
    const rowFor = (measure: string, key: string, human: string, ai: string): HTMLTableRowElement => {
      const tr = document.createElement('tr');
      tr.dataset.measure = key;
      const head = document.createElement('th');
      head.scope = 'row';
      head.textContent = measure;
      const youCell = document.createElement('td');
      youCell.dataset.car = 'human';
      youCell.textContent = human;
      const aiCell = document.createElement('td');
      aiCell.dataset.car = 'ai';
      aiCell.textContent = ai;
      tr.append(head, youCell, aiCell);
      return tr;
    };
    const both = (pick: (r: RacerResult) => string): [string, string] => [pick(result.human), pick(result.ai)];
    const lapText = (value: number | null): string => (value === null ? 'no lap completed' : secondsText(value));
    const outcomeText = (r: RacerResult): string => (r.outcome === null ? 'Still racing' : (OUTCOME_TEXT[r.outcome] ?? r.outcome));
    resultBody.replaceChildren(
      rowFor('Outcome', 'outcome', ...both(outcomeText)),
      rowFor('Laps completed', 'laps', ...both((r) => `${r.laps} of ${result.laps}`)),
      rowFor('First lap', 'first-lap', ...both((r) => lapText(r.firstLapSeconds))),
      rowFor('Best lap', 'best-lap', ...both((r) => lapText(r.bestLapSeconds))),
      rowFor('Total time', 'total', ...both((r) => (r.totalSeconds === null ? '—' : secondsText(r.totalSeconds)))),
      rowFor('Gates credited', 'gates', ...both((r) => String(r.gates))),
      rowFor('Wall collisions', 'collisions', ...both((r) => String(r.wallCollisions))),
    );
    const notes = [
      'Wall collisions are independent for each car: a car\'s run ends at its first wall contact, so this is 0 or 1 per car.',
      `Lap times are simulated seconds (whole ticks × ${result.timestepSeconds.toFixed(4)} s). The race clock was ${result.raceSeconds} s.`,
      'This is one race on one circuit: it says nothing about learning or about who drives better in general.',
    ];
    if (result.aiHadNoBrake) notes.unshift('The AI had no brake (this champion was saved without one); you kept yours.');
    setText(resultNote, notes.join(' '));
  };

  // ---- setup panel ----
  let modelSignature = '';
  let circuitSignature = '';
  const renderSetup = (): void => {
    const models = controller.models();
    const chosen = controller.selected();
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
        option.textContent = m.usable ? m.label : `${m.label} (cannot be raced)`;
        options.push(option);
      }
      modelSelect.replaceChildren(...options);
    }
    if (modelSelect.value !== (chosen ?? '')) modelSelect.value = chosen ?? '';
    const current = models.find((m) => m.id === chosen);
    setText(
      modelNote,
      models.length === 0
        ? 'No saved champions yet. Save one in the training view (?mode=train), then come back.'
        : current === undefined
          ? 'Choose a saved champion to race.'
          : current.usable
            ? `Trained on ${current.trainedOn ?? 'an unknown circuit'}.`
            : (current.reason ?? 'This champion cannot be raced.'),
    );
    const circuits = controller.circuits();
    const circuitKey = JSON.stringify(circuits.map((c) => [c.id, c.name, c.split]));
    if (circuitKey !== circuitSignature) {
      circuitSignature = circuitKey;
      const groups: [string, 'training' | 'validation' | 'custom'][] = [
        ['Training circuits', 'training'],
        ['Validation circuits', 'validation'],
        ['Your saved tracks', 'custom'],
      ];
      circuitSelect.replaceChildren(
        ...groups.flatMap(([label, split]) => {
          const members = circuits.filter((c) => c.split === split);
          if (members.length === 0) return [];
          const group = document.createElement('optgroup');
          group.label = label;
          for (const c of members) {
            const option = document.createElement('option');
            option.value = c.id;
            option.textContent = c.name;
            group.append(option);
          }
          return [group];
        }),
      );
    }
    const circuit = controller.circuit() ?? '';
    if (circuitSelect.value !== circuit) circuitSelect.value = circuit;
    circuitSelect.disabled = chosen === null;
    if (lapsSelect.value !== String(controller.laps())) lapsSelect.value = String(controller.laps());
    startButton.disabled = !controller.canStart();
    setText(messageLine, controller.message());
  };

  const applyPhase = (): void => {
    const phase = controller.phase();
    const setup = phase === 'setup';
    const finished = phase === 'finished';
    root.classList.toggle('race-setup', setup);
    root.classList.toggle('race-running', phase === 'countdown' || phase === 'racing');
    root.classList.toggle('race-finished', finished);
    setupPanel.hidden = !setup;
    resultsPanel.hidden = !finished;
    hudPanel.hidden = setup;
    controlsBar.hidden = setup || finished;
    keysHelp.hidden = setup || finished;
    if (setup) {
      leaveRace();
      setText(status, '');
      countdownText.hidden = true;
      renderSetup();
    } else {
      if (!session) enterRace();
      if (finished) renderResults();
    }
    Object.assign(setupPanel.dataset, { raceModels: String(controller.models().length), raceSelected: controller.selected() ?? '' });
    resultsPanel.dataset.racePhase = phase;
    writeDataset();
  };
  let lastPhase: string | null = null;
  const render = (): void => {
    const phase = controller.phase();
    if (phase !== lastPhase) {
      const wasFinished = lastPhase === 'finished';
      lastPhase = phase;
      applyPhase();
      // Keyboard focus follows the work: onto the canvas when a race starts (so camera keys work), onto the first result action when it ends.
      if (phase === 'countdown' && !wasFinished) canvas.focus({ preventScroll: true });
      if (phase === 'finished') againButton.focus({ preventScroll: true });
    } else if (phase === 'setup') {
      renderSetup();
    }
  };

  cleanups.push(controller.subscribe(render));
  on(modelSelect, 'change', () => controller.select(modelSelect.value === '' ? null : modelSelect.value));
  on(circuitSelect, 'change', () => controller.selectCircuit(circuitSelect.value));
  on(lapsSelect, 'change', () => controller.selectLaps(Number(lapsSelect.value)));
  on(startButton, 'click', () => controller.start());
  on(againButton, 'click', () => {
    held.releaseAll();
    controller.restart();
  });
  on(backButton, 'click', () => controller.back());
  controller.refresh();
  lastPhase = null;
  render();

  return {
    stop() {
      leaveRace();
      for (const cleanup of cleanups.splice(0)) cleanup();
      for (const panel of driving) panel.hidden = false;
      for (const name of ['race-setup', 'race-running', 'race-finished']) root.classList.remove(name);
      setupPanel.hidden = true;
      resultsPanel.hidden = true;
      hudPanel.hidden = true;
      countdownText.hidden = true;
    },
  };
}
