// Entry point: finds the canvas, keeps it sized to the screen and draws the start-up screen.
import './style.css';
import { drawPlaceholder } from './render/placeholder';
import { browserViewportEnvironment, createViewport } from './render/viewport';

const canvas = document.querySelector<HTMLCanvasElement>('#sim-canvas');
const context = canvas?.getContext('2d');

if (!canvas || !context) {
  throw new Error('Self-Driving AI Evolution needs a <canvas id="sim-canvas"> with 2D drawing support.');
}

createViewport(canvas, browserViewportEnvironment(canvas), (size) => drawPlaceholder(context, size));
