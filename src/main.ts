// Entry point: finds the page elements, runs the simulation loop and draws each frame.
import './style.css';
import { drawPlaceholder } from './render/placeholder';
import { browserViewportEnvironment, createViewport } from './render/viewport';
import { DEFAULT_SIM_CONFIG } from './sim/config';
import { createFixedStepClock } from './sim/fixedStep';
import { createWorld, elapsedSeconds, stepWorld } from './sim/world';
import { browserFrameEnvironment, startFrameLoop } from './ui/frameLoop';

const canvas = document.querySelector<HTMLCanvasElement>('#sim-canvas');
const context = canvas?.getContext('2d');
const simTime = document.querySelector<HTMLOutputElement>('#sim-time');
if (!canvas || !context || !simTime) {
  throw new Error(
    'Self-Driving AI Evolution needs a <canvas id="sim-canvas"> with 2D drawing support and an <output id="sim-time">.',
  );
}

let world = createWorld();
const viewport = createViewport(canvas, browserViewportEnvironment(canvas), (size) => drawPlaceholder(context, size));

startFrameLoop(browserFrameEnvironment(), createFixedStepClock(DEFAULT_SIM_CONFIG), {
  step: () => {
    world = stepWorld(world);
  },
  render: () => {
    drawPlaceholder(context, viewport.current());
    const label = `${elapsedSeconds(world, DEFAULT_SIM_CONFIG).toFixed(1)} s`;
    if (simTime.textContent !== label) simTime.textContent = label;
    simTime.dataset.tick = String(world.tick);
  },
});
