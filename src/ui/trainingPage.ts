// The rendered training view (P2-05), shown with `?mode=train`: the population trainer runs under the same
// fixed-step frame loop as manual driving, one trainer tick per simulation tick, and every frame draws all the
// cars of the current generation. Drawing only reads the trainer's state, so what is trained is the same as a
// headless run with the same configuration (tests/training/trainer.test.ts checks this).
//
// Only what P2-05 needs is shown: the cars and one status line. Statistics panels, graphs, speed controls,
// saving and champion replay belong to Phase 3 (P3-01 to P3-05).
import { drawCars } from '../render/raceView';
import type { TrackLayer } from '../render/trackLayer';
import { browserViewportEnvironment, createViewport, type ViewportSize } from '../render/viewport';
import type { SimConfig, VehiclePhysics } from '../sim/config';
import { createFixedStepClock } from '../sim/fixedStep';
import type { Track } from '../sim/track';
import { createTrainer, DEFAULT_TRAINING_CONFIG, type Generation } from '../training/trainer';
import { browserFrameEnvironment, startFrameLoop } from './frameLoop';

export interface TrainingPage {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  /** Where the one-line status is written. */
  readonly status: HTMLElement;
  /** Manual-driving elements that are hidden in training mode. */
  readonly hide: readonly HTMLElement[];
  readonly trackLayer: TrackLayer<HTMLCanvasElement>;
  readonly track: Track;
  readonly physics: VehiclePhysics;
  readonly config: SimConfig;
}

/** The status line for a generation: its number (from 1), and how many of its cars are still running. */
export function trainingStatus(generation: Generation): string {
  const running = generation.cars.filter((car) => car.episode.outcome === null).length;
  return `Training · generation ${generation.index + 1} · ${running} of ${generation.cars.length} cars running`;
}

export function startTrainingPage(page: TrainingPage): void {
  const { canvas, context, status, trackLayer, track, physics, config } = page;
  for (const element of page.hide) element.hidden = true;
  canvas.setAttribute('aria-label', 'Racetrack with a population of training cars');

  const trainer = createTrainer(DEFAULT_TRAINING_CONFIG, { track, physics, timestepSeconds: config.timestepSeconds });
  let ticks = 0;

  const draw = (size: ViewportSize) => {
    const layer = trackLayer.get(track, size);
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, size.width, size.height);
    if (!layer) return;
    context.drawImage(layer.canvas, 0, 0);
    const cars = trainer.generation().cars.map((car) => ({ car: car.racer.car, finished: car.episode.outcome !== null }));
    drawCars(context, size, layer.view, cars, physics);
    const { dataset } = canvas;
    dataset.trackScale = String(layer.view.scale);
    dataset.trackOffsetX = String(layer.view.offsetX);
    dataset.trackOffsetY = String(layer.view.offsetY);
  };

  /** Writes the status line, plus data attributes for the browser tests. */
  const show = () => {
    const generation = trainer.generation();
    const text = trainingStatus(generation);
    if (status.textContent !== text) status.textContent = text;
    const running = generation.cars.filter((car) => car.episode.outcome === null).length;
    Object.assign(canvas.dataset, {
      mode: 'train',
      generation: String(generation.index),
      generationTick: String(generation.tick),
      cars: String(generation.cars.length),
      running: String(running),
      completedGenerations: String(trainer.record().generations.length),
      tick: String(ticks),
    });
  };

  const viewport = createViewport(canvas, browserViewportEnvironment(canvas), draw);
  startFrameLoop(browserFrameEnvironment(), createFixedStepClock(config), {
    step: () => {
      ticks += 1;
      trainer.step();
    },
    render: () => {
      draw(viewport.current());
      show();
    },
  });
}
