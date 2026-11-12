// Entry point: finds the page elements, loads the built-in track, wires human input to the simulation,
// runs the fixed-step loop and draws each frame. Input, simulation and drawing stay in their own modules;
// this file only connects them. With `?mode=train` it runs the population training view instead
// (ui/trainingPage.ts, P2-05); the default page is manual driving.
import './style.css';
import { createHumanDriver } from './ai/drivers';
import stadiumOval from './data/tracks/stadium-oval.json';
import { drawRace } from './render/raceView';
import { drawSensors } from './render/sensorView';
import { createTrackLayer } from './render/trackLayer';
import { browserViewportEnvironment, createViewport, type ViewportSize } from './render/viewport';
import { castRays, DEFAULT_SENSOR_CONFIG } from './sensors/rays';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from './sim/config';
import { createFixedStepClock } from './sim/fixedStep';
import { loadTrack, type Track } from './sim/track';
import type { EditorHistory } from './editor/trackEditor';
import { startEditorPage } from './ui/editorPage';
import { tracksIn, trainingTrack } from './training/trackSplits';
import { circuitFromSearch, searchForCircuit } from './ui/trainingCircuit';
import { createWorld, elapsedSeconds, restartWorld, stepWorld, type World } from './sim/world';
import {
  attachHoldButton,
  attachKeyboard,
  attachSafetyRelease,
  createHeldInputs,
  type HoldAction,
} from './ui/controls/input';
import { debugFpsEnabled, debugRaysEnabled } from './ui/debugFlags';
import { browserFrameEnvironment, startFrameLoop } from './ui/frameLoop';
import { hudView, nextFeedback, type Feedback } from './ui/hud';
import { pageMode } from './ui/pageMode';
import { downloadJson } from './ui/download';
import { newModelId } from './ui/modelId';
import type { UiList, UiNode } from './ui/savedChampionsView';
import { startTrainingPage, type CompareSelect } from './ui/trainingPage';

const element = <T extends Element>(selector: string): T => {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Self-Driving AI Evolution needs ${selector} on the page.`);
  return found;
};
const canvas = element<HTMLCanvasElement>('#sim-canvas');
const canvasContext = canvas.getContext('2d');
if (!canvasContext) throw new Error('Canvas 2D drawing is not supported.');
const context: CanvasRenderingContext2D = canvasContext;
const simTime = element<HTMLOutputElement>('#sim-time');
const hud = {
  laps: element<HTMLOutputElement>('#hud-laps'),
  current: element<HTMLOutputElement>('#hud-current'),
  last: element<HTMLOutputElement>('#hud-last'),
  best: element<HTMLOutputElement>('#hud-best'),
  gate: element<HTMLOutputElement>('#hud-gate'),
  speed: element<HTMLOutputElement>('#hud-speed'),
  message: element<HTMLElement>('#hud-message'),
};
const holdButtons = [...document.querySelectorAll<HTMLButtonElement>('button[data-action]')];

const config = DEFAULT_SIM_CONFIG;
// Ray sensor debug layer (P2-01): drawn only with `?debug=rays`. Sensors only read the world, so the
// simulation is the same with or without it.
const showRays = debugRaysEnabled(window.location.search);
const dt = config.timestepSeconds;
const track = loadTrack(stadiumOval);
// The static track is drawn onto its own canvas, which is only redrawn when the size or track changes.
const trackLayer = createTrackLayer(() => {
  const layerCanvas = document.createElement('canvas');
  const layerContext = layerCanvas.getContext('2d');
  if (!layerContext) throw new Error('Canvas 2D drawing is not supported.');
  return { canvas: layerCanvas, context: layerContext };
});

if (pageMode(window.location.search) === 'train') {
  // One training circuit per run (P4-04): chosen from the address, training circuits only; the default is the stadium oval.
  const trainingCircuits = tracksIn('training');
  const circuitSelect = element<HTMLSelectElement>('#training-circuit');
  for (const entry of trainingCircuits) {
    const option = document.createElement('option');
    option.value = entry.id;
    option.textContent = entry.track.name;
    circuitSelect.append(option);
  }
  const trainingCircuit = trainingTrack(circuitFromSearch(window.location.search, trainingCircuits.map((t) => t.id)));
  const graphCanvas = element<HTMLCanvasElement>('#graph-canvas');
  const graphContext = graphCanvas.getContext('2d');
  if (!graphContext) throw new Error('Canvas 2D drawing is not supported.');
  startTrainingPage({
    canvas,
    context,
    status: hud.message,
    hide: [element<HTMLElement>('.hud'), element<HTMLElement>('.controls'), element<HTMLElement>('.keys-help')],
    fps: debugFpsEnabled(window.location.search) ? element<HTMLElement>('#fps-readout') : undefined,
    controls: {
      group: element<HTMLElement>('#training-controls'),
      pause: element<HTMLButtonElement>('#speed-pause'),
      speeds: {
        normal: element<HTMLButtonElement>('[data-speed="normal"]'),
        fast: element<HTMLButtonElement>('[data-speed="fast"]'),
        max: element<HTMLButtonElement>('[data-speed="max"]'),
      },
      drawCap: element<HTMLSelectElement>('#draw-cap'),
    },
    replay: {
      details: element<HTMLDetailsElement>('#champion-replay'),
      generation: element<HTMLInputElement>('#replay-generation'),
      start: element<HTMLButtonElement>('#replay-start'),
      stop: element<HTMLButtonElement>('#replay-stop'),
      note: element<HTMLElement>('#replay-note'),
      outputs: {
        inputs: [...document.querySelectorAll<HTMLElement>('#champion-replay [data-input]')],
        steering: element('#replay-steering'),
        throttle: element('#replay-throttle'),
        brake: element('#replay-brake'),
        decision: element('#replay-decision'),
        result: element('#replay-result'),
        status: element('#replay-status'),
      },
    },
    compare: {
      a: element<HTMLSelectElement>('#compare-a') as unknown as CompareSelect,
      b: element<HTMLSelectElement>('#compare-b') as unknown as CompareSelect,
      run: element<HTMLButtonElement>('#compare-run'),
      replay: element<HTMLButtonElement>('#compare-replay'),
      status: element<HTMLElement>('#compare-status'),
      result: element<HTMLElement>('#compare-result') as unknown as UiList,
    },
    checkpoint: {
      status: element<HTMLElement>('#checkpoint-status'),
      offer: {
        container: element<HTMLElement>('#checkpoint-offer'),
        text: element<HTMLElement>('#checkpoint-offer-text'),
        resume: element<HTMLButtonElement>('#checkpoint-resume'),
        discard: element<HTMLButtonElement>('#checkpoint-discard'),
      },
      download: element<HTMLButtonElement>('#checkpoint-download'),
      importInput: element<HTMLInputElement>('#checkpoint-import'),
      storage: () => window.localStorage,
      newId: () => newModelId(),
      isoNow: () => new Date().toISOString(),
      codeVersion: __CODE_VERSION__,
      appVersion: __APP_VERSION__,
      saveFile: downloadJson,
      defer: (callback) => {
        const handle = window.setTimeout(callback, 0);
        return () => window.clearTimeout(handle);
      },
      onHide: (listener) => {
        const onVisibility = () => {
          if (document.visibilityState === 'hidden') listener();
        };
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('pagehide', listener);
        return () => {
          document.removeEventListener('visibilitychange', onVisibility);
          window.removeEventListener('pagehide', listener);
        };
      },
    },
    saved: {
      name: element<HTMLInputElement>('#saved-name'),
      save: element<HTMLButtonElement>('#saved-save'),
      importInput: element<HTMLInputElement>('#saved-import'),
      status: element<HTMLElement>('#saved-status'),
      // Real elements satisfy the small node interface the list is built through (see ui/savedChampionsView.ts).
      list: element<HTMLElement>('#saved-list') as unknown as UiList,
      ui: { create: (tag) => document.createElement(tag) as unknown as UiNode },
      storage: () => window.localStorage,
      newId: () => newModelId(),
      download: downloadJson,
      isoNow: () => new Date().toISOString(),
      codeVersion: __CODE_VERSION__,
      appVersion: __APP_VERSION__,
    },
    graph: {
      details: element<HTMLDetailsElement>('#training-graph'),
      canvas: graphCanvas,
      context: graphContext,
      summary: element<HTMLElement>('#graph-summary'),
    },
    dashboard: {
      panel: element<HTMLElement>('#training-dashboard'),
      outputs: {
        generation: element('#dash-generation'),
        running: element('#dash-running'),
        crashed: element('#dash-crashed'),
        stalled: element('#dash-stalled'),
        finished: element('#dash-finished'),
        lastGeneration: element('#dash-last-generation'),
        bestFitness: element('#dash-best'),
        meanFitness: element('#dash-mean'),
        crashRate: element('#dash-crash-rate'),
        stalls: element('#dash-stalls'),
        lapRate: element('#dash-lap-rate'),
        note: element('#dash-note'),
      },
    },
    trackLayer,
    track: trainingCircuit,
    circuit: {
      select: circuitSelect,
      hint: element<HTMLElement>('#training-circuit-hint'),
      navigate: (id) => window.location.assign(`${window.location.pathname}${searchForCircuit(window.location.search, id)}`),
    },
    physics: DEFAULT_VEHICLE_PHYSICS,
    config,
  });
} else if (pageMode(window.location.search) === 'edit') {
  startEditing();
} else {
  startDrivingPage(track);
}

/** The track editor (P4-02): the manual-driving panels are hidden while editing. */
function startEditing(history?: EditorHistory): void {
  const driving = [element<HTMLElement>('.hud'), element<HTMLElement>('.controls'), element<HTMLElement>('.keys-help')];
  const notice = element<HTMLElement>('#drive-notice');
  for (const panel of driving) panel.hidden = true;
  notice.hidden = true;
  startEditorPage({
    canvas,
    context,
    history,
    onDrive: (built, kept) => {
      // Drive the custom track with the ordinary manual-driving page; Back to editing restores the editor as it was.
      for (const panel of driving) panel.hidden = false;
      notice.hidden = false;
      const stopDriving = startDrivingPage(built);
      const back = element<HTMLButtonElement>('#ed-back');
      const onBack = () => {
        back.removeEventListener('click', onBack);
        stopDriving();
        startEditing(kept);
      };
      back.addEventListener('click', onBack);
      back.focus({ preventScroll: true });
    },
  });
}

/**
 * Manual driving (P1-08): the human driver, the HUD and the optional ray debug layer, on the given track. Returns a
 * function that stops it (listeners, frame loop, viewport), so the editor can drive a track and come back (P4-02).
 */
function startDrivingPage(track: Track): () => void {
  const detach: (() => void)[] = [];
  // Input: keys and on-screen buttons record what is held; the simulation reads it once per tick.
  const held = createHeldInputs();
  let restartRequested = false;
  const requestRestart = () => {
    restartRequested = true;
  };
  const restartButton = element<HTMLButtonElement>('#restart');
  // Space on a focused Restart or Back to editing button activates it, as on any button, instead of braking.
  const isNativeButton = (target: unknown) => target === restartButton || target === document.getElementById('ed-back');
  detach.push(attachKeyboard(window, held, requestRestart, isNativeButton));
  detach.push(attachSafetyRelease(window, document, held));
  for (const button of holdButtons) detach.push(attachHoldButton(button, button.dataset.action as HoldAction, held));
  const onRestartClick = (event: MouseEvent) => {
    requestRestart();
    // A tap or click (detail > 0) leaves no focus behind, so Space brakes again straight away. Keyboard
    // activation (detail 0) keeps focus on the button, as keyboard users expect.
    if (event.detail > 0) restartButton.blur();
  };
  restartButton.addEventListener('click', onRestartClick);
  detach.push(() => restartButton.removeEventListener('click', onRestartClick));
  const driver = createHumanDriver(held.read);

  let world: World = createWorld(track, DEFAULT_VEHICLE_PHYSICS);
  let shownWorld = world;
  let restartedSinceShown = false;
  let feedback: Feedback | null = null;

  /** Draws the track and the car, and records the transform and car state for the browser tests. */
  const draw = (size: ViewportSize) => {
    const layer = trackLayer.get(track, size);
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, size.width, size.height);
    if (!layer) return;
    context.drawImage(layer.canvas, 0, 0);
    drawRace(context, size, layer.view, world);
    const { dataset } = canvas;
    if (showRays) {
      const readings = castRays(world.racer.car.vehicle, track, world.physics, DEFAULT_SENSOR_CONFIG);
      drawSensors(context, size, layer.view, readings);
      // World coordinates of the drawn rays, for the browser tests; they map them through the published transform.
      dataset.rays = JSON.stringify({
        origin: readings.origin,
        rays: readings.rays.map(({ distance, hit, end }) => ({ distance, hit, end })),
      });
    }
    dataset.trackScale = String(layer.view.scale);
    dataset.trackOffsetX = String(layer.view.offsetX);
    dataset.trackOffsetY = String(layer.view.offsetY);
    dataset.trackLayerBuilds = String(trackLayer.builds());
  };

  const setText = (target: HTMLElement, text: string) => {
    if (target.textContent !== text) target.textContent = text;
  };

  /** Copies the world into the page: HUD text, the event message, and data attributes for the browser tests. */
  const showState = () => {
    const view = hudView(world, dt);
    setText(hud.laps, String(view.laps));
    setText(hud.current, view.currentLap);
    setText(hud.last, view.lastLap);
    setText(hud.best, view.bestLap);
    setText(hud.gate, view.nextGate);
    setText(hud.speed, String(view.speedKmh));
    feedback = nextFeedback(shownWorld, world, feedback, dt, restartedSinceShown);
    shownWorld = world;
    restartedSinceShown = false;
    setText(hud.message, feedback?.text ?? (view.crashed ? 'Crashed! Press R or tap Restart.' : ''));
    hud.message.dataset.kind = feedback?.kind ?? '';

    const { car, progress } = world.racer;
    Object.assign(canvas.dataset, {
      carX: String(car.vehicle.position.x),
      carY: String(car.vehicle.position.y),
      carHeading: String(car.vehicle.heading),
      carSpeed: String(car.vehicle.speed),
      crashed: String(car.crashed),
      laps: String(progress.lapTicks.length),
      gatesPassed: String(progress.gatesPassed),
      nextGate: String(progress.nextGate),
    });
    const input = held.read();
    for (const button of holdButtons) button.classList.toggle('held', input[button.dataset.action as HoldAction]);

    const label = `${elapsedSeconds(world, config).toFixed(1)} s`;
    if (simTime.textContent !== label) simTime.textContent = label;
    simTime.dataset.tick = String(world.tick);
  };

  const viewport = createViewport(canvas, browserViewportEnvironment(canvas), draw);

  const loop = startFrameLoop(browserFrameEnvironment(), createFixedStepClock(config), {
    // One simulation path: every tick applies a pending restart, asks the driver, then steps the world.
    step: () => {
      if (restartRequested) {
        restartRequested = false;
        world = restartWorld(world);
        restartedSinceShown = true;
      }
      world = stepWorld(world, driver.decide({ car: world.racer.car }), config);
    },
    render: () => {
      draw(viewport.current());
      showState();
    },
  });
  return () => {
    loop.stop();
    viewport.stop();
    for (const remove of detach.splice(0)) remove();
    held.releaseAll();
    for (const button of holdButtons) button.classList.remove('held');
  };
}
