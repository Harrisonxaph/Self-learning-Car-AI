// Entry point: finds the page elements, loads the built-in track, wires human input to the simulation,
// runs the fixed-step loop and draws each frame. Input, simulation and drawing stay in their own modules;
// this file only connects them.
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
import { loadTrack } from './sim/track';
import { createWorld, elapsedSeconds, restartWorld, stepWorld, type World } from './sim/world';
import {
  attachHoldButton,
  attachKeyboard,
  attachSafetyRelease,
  createHeldInputs,
  type HoldAction,
} from './ui/controls/input';
import { debugRaysEnabled } from './ui/debugFlags';
import { browserFrameEnvironment, startFrameLoop } from './ui/frameLoop';
import { hudView, nextFeedback, type Feedback } from './ui/hud';

const element = <T extends Element>(selector: string): T => {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Self-Driving AI Evolution needs ${selector} on the page.`);
  return found;
};
const canvas = element<HTMLCanvasElement>('#sim-canvas');
const context = canvas.getContext('2d');
if (!context) throw new Error('Canvas 2D drawing is not supported.');
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

// Input: keys and on-screen buttons record what is held; the simulation reads it once per tick.
const held = createHeldInputs();
let restartRequested = false;
const requestRestart = () => {
  restartRequested = true;
};
const restartButton = element<HTMLButtonElement>('#restart');
// Space on the focused Restart button activates it, as on any button, instead of braking.
attachKeyboard(window, held, requestRestart, (target) => target === restartButton);
attachSafetyRelease(window, document, held);
for (const button of holdButtons) attachHoldButton(button, button.dataset.action as HoldAction, held);
restartButton.addEventListener('click', (event) => {
  requestRestart();
  // A tap or click (detail > 0) leaves no focus behind, so Space brakes again straight away. Keyboard
  // activation (detail 0) keeps focus on the button, as keyboard users expect.
  if (event.detail > 0) restartButton.blur();
});
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

startFrameLoop(browserFrameEnvironment(), createFixedStepClock(config), {
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
