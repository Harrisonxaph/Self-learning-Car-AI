// Entry point: finds the page elements, loads the built-in track, runs the simulation loop and draws each frame.
import './style.css';
import stadiumOval from './data/tracks/stadium-oval.json';
import { createTrackLayer } from './render/trackLayer';
import { browserViewportEnvironment, createViewport, type ViewportSize } from './render/viewport';
import { DEFAULT_SIM_CONFIG } from './sim/config';
import { createFixedStepClock } from './sim/fixedStep';
import { loadTrack } from './sim/track';
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

const track = loadTrack(stadiumOval);
// The static track is drawn onto its own canvas, which is only redrawn when the size or track changes.
const trackLayer = createTrackLayer(() => {
  const layerCanvas = document.createElement('canvas');
  const layerContext = layerCanvas.getContext('2d');
  if (!layerContext) throw new Error('Canvas 2D drawing is not supported.');
  return { canvas: layerCanvas, context: layerContext };
});

/** Copies the cached track layer onto the screen, and records its transform for the browser tests. */
const draw = (size: ViewportSize) => {
  const layer = trackLayer.get(track, size);
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, size.width, size.height);
  if (!layer) return;
  context.drawImage(layer.canvas, 0, 0);
  const { dataset } = canvas;
  dataset.trackScale = String(layer.view.scale);
  dataset.trackOffsetX = String(layer.view.offsetX);
  dataset.trackOffsetY = String(layer.view.offsetY);
  dataset.trackLayerBuilds = String(trackLayer.builds());
};

let world = createWorld();
const viewport = createViewport(canvas, browserViewportEnvironment(canvas), draw);

startFrameLoop(browserFrameEnvironment(), createFixedStepClock(DEFAULT_SIM_CONFIG), {
  step: () => {
    world = stepWorld(world);
  },
  render: () => {
    draw(viewport.current());
    const label = `${elapsedSeconds(world, DEFAULT_SIM_CONFIG).toFixed(1)} s`;
    if (simTime.textContent !== label) simTime.textContent = label;
    simTime.dataset.tick = String(world.tick);
  },
});
