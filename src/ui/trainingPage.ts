// The rendered training view (P2-05), shown with `?mode=train`: the population trainer runs under the same
// fixed-step frame loop as manual driving, one trainer tick per simulation tick, and every frame draws all the
// cars of the current generation. Drawing only reads the trainer's state, so what is trained is the same as a
// headless run with the same configuration (tests/training/trainer.test.ts checks this).
//
// Shown: the cars, one status line and (P3-01) the dashboard of live counts and last-completed-generation figures.
// Graphs, speed controls, saving, champion replay and performance readouts belong to later Phase 3 items.
import { drawCars } from '../render/raceView';
import type { TrackLayer } from '../render/trackLayer';
import { browserViewportEnvironment, createViewport, type Viewport, type ViewportEnvironment, type ViewportSize } from '../render/viewport';
import type { SimConfig, VehiclePhysics } from '../sim/config';
import { createFixedStepClock } from '../sim/fixedStep';
import type { Track } from '../sim/track';
import { createTrainer, DEFAULT_TRAINING_CONFIG, type Generation } from '../training/trainer';
import { browserFrameEnvironment, startFrameLoop, type FrameEnvironment } from './frameLoop';
import { createTrainingChart, type GraphContext } from './trainingChart';
import { createTrainingSession, type DashboardOutputs } from './trainingDashboard';

export interface TrainingPage {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  /** Where the one-line status is written. */
  readonly status: HTMLElement;
  /** Manual-driving elements that are hidden in training mode. */
  readonly hide: readonly HTMLElement[];
  /** The dashboard panel, which is shown in training mode, and the elements its values are written to. */
  readonly dashboard: { readonly panel: HTMLElement; readonly outputs: DashboardOutputs };
  readonly trackLayer: TrackLayer<HTMLCanvasElement>;
  readonly track: Track;
  readonly physics: VehiclePhysics;
  readonly config: SimConfig;
  /** The training graph (P3-02): a collapsible block that is shown in training mode, with its canvas and text summary. */
  readonly graph: {
    readonly details: HTMLDetailsElement;
    readonly canvas: HTMLCanvasElement;
    readonly context: GraphContext;
    readonly summary: HTMLElement;
  };
  /** The browser's frame, size and clock sources by default; tests pass fakes to drive the real page wiring in Node. */
  readonly frames?: FrameEnvironment;
  readonly viewportEnvironment?: ViewportEnvironment;
  readonly graphViewportEnvironment?: ViewportEnvironment;
  readonly now?: () => number;
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

  page.dashboard.panel.hidden = false;
  const trainer = createTrainer(DEFAULT_TRAINING_CONFIG, { track, physics, timestepSeconds: config.timestepSeconds });
  const session = createTrainingSession(trainer, page.dashboard.outputs);
  let ticks = 0;

  // The graph reads the session's history and is redrawn at most a few times a second, only while it is open.
  const { graph } = page;
  graph.details.hidden = false;
  graph.canvas.setAttribute('aria-describedby', 'graph-summary');
  const graphView: { viewport?: Viewport } = {};
  const chart = createTrainingChart({
    history: () => session.history,
    context: graph.context,
    summary: graph.summary,
    isOpen: () => graph.details.open,
    size: () => graphView.viewport?.current() ?? null,
    now: page.now ?? (() => performance.now()),
  });
  graphView.viewport = createViewport(graph.canvas, page.graphViewportEnvironment ?? browserViewportEnvironment(graph.canvas), () => chart.invalidate());
  graph.details.addEventListener('toggle', () => {
    // The page lays out differently with the graph open on a short landscape screen (see style.css).
    graph.details.closest?.('.app')?.classList.toggle('graph-open', graph.details.open);
    graphView.viewport?.update();
    chart.invalidate();
  });

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
    const { live, completed } = session.frame();
    Object.assign(canvas.dataset, {
      mode: 'train',
      generation: String(generation.index),
      generationTick: String(generation.tick),
      cars: String(generation.cars.length),
      running: String(live.running),
      crashed: String(live.crashed),
      stalled: String(live.stalled),
      finished: String(live.finished),
      completedGenerations: String(trainer.record().generations.length),
      chartPoints: String(session.history.length),
      chartDraws: String(chart.draws),
      tick: String(ticks),
    });
    // The last completed generation's recorded values, unformatted, for the browser tests; absent before the first.
    const last: Record<string, string | null> = {
      lastGeneration: completed ? String(completed.generation) : null,
      lastBest: completed ? String(completed.bestFitness) : null,
      lastMean: completed ? String(completed.meanFitness) : null,
      lastCrashed: completed ? String(completed.crashed) : null,
      lastStalled: completed ? String(completed.stalled) : null,
      lastLaps: completed ? String(completed.carsWithLap) : null,
    };
    for (const [name, value] of Object.entries(last)) {
      if (value === null) delete canvas.dataset[name];
      else canvas.dataset[name] = value;
    }
  };

  const viewport = createViewport(canvas, page.viewportEnvironment ?? browserViewportEnvironment(canvas), draw);
  startFrameLoop(page.frames ?? browserFrameEnvironment(), createFixedStepClock(config), {
    step: () => {
      ticks += 1;
      session.step();
    },
    render: () => {
      draw(viewport.current());
      show();
      chart.frame();
    },
  });
}
