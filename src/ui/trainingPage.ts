// The rendered training view (P2-05), shown with `?mode=train`: the population trainer runs under the same
// fixed-step frame loop as manual driving, one trainer tick per simulation tick, and every frame draws all the
// cars of the current generation. Drawing only reads the trainer's state, so what is trained is the same as a
// headless run with the same configuration (tests/training/trainer.test.ts checks this).
//
// Shown: the cars, one status line and (P3-01) the dashboard of live counts and last-completed-generation figures.
// (P3-03) speed, pause and drawing controls change only how many ticks run per frame and how many cars are drawn.
// Saving, champion replay and performance readouts belong to later Phase 3 items.
import { INPUT_COUNT } from '../ai/inputs';
import { drawCars } from '../render/raceView';
import { drawSensors } from '../render/sensorView';
import type { TrackLayer } from '../render/trackLayer';
import { browserViewportEnvironment, createViewport, type Viewport, type ViewportEnvironment, type ViewportSize } from '../render/viewport';
import type { SimConfig, VehiclePhysics } from '../sim/config';
import type { Track } from '../sim/track';
import { createChampionReplay, type ChampionReplay, type ReplayFrame } from '../training/championReplay';
import { createTrainer, DEFAULT_TRAINING_CONFIG, type Generation } from '../training/trainer';
import { createModelStore, type StorageLike } from '../persistence/modelStore';
import { buildModel } from '../persistence/modelFormat';
import { tracksIn } from '../training/trackSplits';
import { emptyReplayText, renderReplay, replayText, type ReplayOutputs } from './championReplayView';
import { renderSavedList, type UiFactory, type UiList } from './savedChampionsView';
import { replayForModel } from './savedReplay';
import { browserFrameEnvironment, startFrameLoop, type FrameEnvironment, type FrameLoop } from './frameLoop';
import { createRateMeter, formatRateReadout } from './rateMeter';
import { createTrainingChart, type GraphContext } from './trainingChart';
import { createTrainingSession, type DashboardOutputs } from './trainingDashboard';
import {
  createFrameStepper,
  createSpeedControl,
  DRAW_CAPS,
  defaultDrawCap,
  effectiveDrawCap,
  pickCars,
  SPEED_MODES,
  speedStatus,
  type SpeedMode,
} from './trainingSpeed';

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
  /** The speed, pause and cars-drawn controls (P3-03), shown in training mode. */
  readonly controls: {
    readonly group: HTMLElement;
    readonly pause: HTMLButtonElement;
    readonly speeds: Readonly<Record<SpeedMode, HTMLButtonElement>>;
    readonly drawCap: HTMLSelectElement;
  };
  /**
   * The optional frame-rate readout (P3-03, opt in with `?debug=fps`). When given, it is shown and updated about four
   * times a second with the rate of rendered frames and, separately, the rate of simulation ticks. Absent, nothing is measured.
   */
  readonly fps?: HTMLElement | undefined;
  /** Whether this is a phone, which starts with fewer cars drawn. The browser is asked by default. */
  readonly isPhone?: boolean;
  /** The training graph (P3-02): a collapsible block that is shown in training mode, with its canvas and text summary. */
  readonly graph: {
    readonly details: HTMLDetailsElement;
    readonly canvas: HTMLCanvasElement;
    readonly context: GraphContext;
    readonly summary: HTMLElement;
  };
  /**
   * The champion replay (P3-04): a collapsible block. A replay pauses training (the trainer is not stepped), draws only the
   * replayed car with its rays, and runs at 1× on the same fixed-step clock; Back to training restores the run unchanged.
   */
  readonly replay: {
    readonly details: HTMLDetailsElement;
    readonly generation: HTMLInputElement;
    readonly start: HTMLButtonElement;
    readonly stop: HTMLButtonElement;
    readonly note: HTMLElement;
    readonly outputs: ReplayOutputs;
  };
  /**
   * Saved champions (P3-05): a name field, a Save button, a status sentence, a list, and what saving needs. Saved brains are
   * stored in localStorage on this browser and are replayed, never trained on.
   */
  readonly saved: {
    readonly name: HTMLInputElement;
    readonly save: HTMLButtonElement;
    readonly status: HTMLElement;
    readonly list: UiList;
    readonly ui: UiFactory;
    /** The browser's localStorage, or throws if it is denied. Called on every operation. */
    readonly storage: () => StorageLike | null;
    /** A fresh id (a UUID); it must not draw from a simulation or evolution random stream. */
    readonly newId: () => string;
    /** The current time as an ISO 8601 UTC string. */
    readonly isoNow: () => string;
    readonly codeVersion: string;
    readonly appVersion: string;
  };
  /** The browser's frame, size and clock sources by default; tests pass fakes to drive the real page wiring in Node. */
  readonly frames?: FrameEnvironment;
  readonly viewportEnvironment?: ViewportEnvironment;
  readonly graphViewportEnvironment?: ViewportEnvironment;
  readonly now?: () => number;
}

/**
 * The status line for a generation: its number (from 1), and how many of its cars are still running, followed by
 * the speed, pause and drawing note (empty at 1× with every car drawn).
 */
export function trainingStatus(generation: Generation, note = ''): string {
  const running = generation.cars.filter((car) => car.episode.outcome === null).length;
  return `Training · generation ${generation.index + 1} · ${running} of ${generation.cars.length} cars running${note}`;
}

/** A phone: a touch screen with a small shorter side. Fewer cars are drawn there by default. */
function browserIsPhone(): boolean {
  return window.matchMedia('(pointer: coarse)').matches && Math.min(window.screen.width, window.screen.height) < 600;
}

export function startTrainingPage(page: TrainingPage): void {
  const { canvas, context, status, trackLayer, track, physics, config } = page;
  for (const element of page.hide) element.hidden = true;
  canvas.setAttribute('aria-label', 'Racetrack with a population of training cars');

  page.dashboard.panel.hidden = false;
  const trainer = createTrainer(DEFAULT_TRAINING_CONFIG, { track, physics, timestepSeconds: config.timestepSeconds });
  const session = createTrainingSession(trainer, page.dashboard.outputs);
  let ticks = 0;

  // Speed, pause and the number of cars drawn (P3-03). None of these changes what the trainer computes.
  const { controls } = page;
  const population = trainer.generation().cars.length;
  const speed = createSpeedControl(config);
  let drawCap = defaultDrawCap(page.isPhone ?? browserIsPhone(), population);
  controls.group.hidden = false;
  controls.drawCap.value = String(drawCap);
  const syncControls = () => {
    for (const mode of SPEED_MODES) controls.speeds[mode].setAttribute('aria-pressed', String(speed.mode === mode));
    // "Play" is no wider than "Pause", so the row does not reflow when the label changes.
    controls.pause.textContent = speed.paused ? 'Play' : 'Pause';
    // The accessible name contains the visible label ("Pause" or "Play"), so voice control by what is shown works.
    controls.pause.setAttribute('aria-label', speed.paused ? 'Play / resume training' : 'Pause training');
  };
  for (const mode of SPEED_MODES) {
    controls.speeds[mode].addEventListener('click', () => {
      speed.setMode(mode);
      syncControls();
    });
  }
  // The frame loop, once it is running: a pause or resume rebases its clock so paused time is never run afterwards.
  const running: { loop?: FrameLoop } = {};
  controls.pause.addEventListener('click', () => {
    speed.setPaused(!speed.paused);
    running.loop?.resync();
    syncControls();
  });
  controls.drawCap.addEventListener('change', () => {
    const chosen = Number(controls.drawCap.value);
    if (DRAW_CAPS.includes(chosen)) drawCap = chosen;
  });
  syncControls();

  // Optional frame-rate readout (P3-03). Rendered frames (render callbacks) and simulation ticks are two separate meters:
  // at Max speed many ticks run per frame, so the two rates differ. Both start again whenever the conditions change
  // (pause or play, speed, cars drawn, page hidden or shown) and after any gap or backwards clock (see rateMeter.ts).
  const fpsReadout = page.fps;
  const frameMeter = createRateMeter();
  const tickMeter = createRateMeter();
  let ticksThisFrame = 0;
  let lastReadoutMs = Number.NEGATIVE_INFINITY;
  const resetMeters = () => {
    frameMeter.reset();
    tickMeter.reset();
    ticksThisFrame = 0;
    lastReadoutMs = Number.NEGATIVE_INFINITY;
  };
  if (fpsReadout) {
    fpsReadout.hidden = false;
    for (const mode of SPEED_MODES) controls.speeds[mode].addEventListener('click', resetMeters);
    controls.pause.addEventListener('click', resetMeters);
    controls.drawCap.addEventListener('change', resetMeters);
    (page.frames ?? browserFrameEnvironment()).onVisibilityChange(resetMeters);
  }
  const updateFps = (timeMs: number) => {
    if (!fpsReadout) return;
    frameMeter.add(timeMs);
    tickMeter.add(timeMs, ticksThisFrame);
    ticksThisFrame = 0;
    if (timeMs - lastReadoutMs < 250 && timeMs >= lastReadoutMs) return;
    lastReadoutMs = timeMs;
    const config = `${speed.paused ? 'paused' : speed.mode} · ${effectiveDrawCap(speed.mode, drawCap, population)} cars drawn`;
    const frameRate = frameMeter.rate();
    const tickRate = tickMeter.rate();
    fpsReadout.textContent = formatRateReadout(frameRate, tickRate, config);
    const { dataset } = canvas;
    if (frameRate !== null) dataset.fpsFrames = frameRate.toFixed(1);
    else delete dataset.fpsFrames;
    if (tickRate !== null) dataset.fpsTicks = tickRate.toFixed(1);
    else delete dataset.fpsTicks;
  };

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
  // The graph and the replay share the side panel's layout, so at most one of them is open (see style.css).
  const replayPanel = page.replay;
  const syncPanelLayout = () => {
    // The page lays out differently with a panel open on a short landscape screen.
    graph.details.closest?.('.app')?.classList.toggle('graph-open', graph.details.open || replayPanel.details.open);
  };
  graph.details.addEventListener('toggle', () => {
    if (graph.details.open) replayPanel.details.open = false;
    syncPanelLayout();
    graphView.viewport?.update();
    chart.invalidate();
  });

  // Champion replay (P3-04). A replay runs one recorded champion alone, at 1×, through the same per-tick code as training,
  // and the trainer is not stepped meanwhile, so what is trained does not depend on whether a replay was watched.
  interface ActiveReplay {
    readonly replay: ChampionReplay;
    /** What is being replayed, in words: "generation 3" or a saved champion's name. */
    readonly label: string;
    /** The generation number for a live champion, or null for a saved one. */
    readonly generation: number | null;
    /** The vehicle size to draw with: the physics the replay ran under. */
    readonly physics: typeof physics;
    frame: ReplayFrame | null;
    readonly restore: { readonly mode: SpeedMode; readonly paused: boolean };
  }
  let active: ActiveReplay | null = null;
  let replayCount = 0;
  const replayOutputs = replayPanel.outputs;
  const syncReplayControls = () => {
    const count = session.generations.length;
    const chosen = replayPanel.generation;
    chosen.disabled = count === 0;
    replayPanel.start.disabled = count === 0;
    page.saved.save.disabled = count === 0;
    replayPanel.stop.disabled = active === null;
    replayPanel.start.textContent = active ? 'Restart' : 'Replay';
    if (count > 0) {
      chosen.setAttribute('min', '1');
      chosen.setAttribute('max', String(count));
    }
    replayPanel.note.textContent =
      count === 0 ? 'No generation completed yet, so there is no champion to replay.' : `Replays the best car of a completed generation, 1 to ${count}, alone on the track at normal speed. Training waits meanwhile.`;
    // The speed and cars-drawn controls are for training; a replay always runs at 1×.
    for (const mode of SPEED_MODES) controls.speeds[mode].disabled = active !== null;
    controls.drawCap.disabled = active !== null;
  };
  /** The generation field's value as a whole number from 1 to the number of completed generations, written back clamped. */
  const chosenGeneration = (): number => {
    const count = session.generations.length;
    const typed = replayPanel.generation.value.trim();
    const parsed = typed === '' ? Number.NaN : Math.floor(Number(typed));
    const clamped = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), Math.max(count, 1)) : count;
    replayPanel.generation.value = String(clamped);
    return clamped;
  };
  const startReplay = () => {
    const count = session.generations.length;
    if (count === 0) return;
    const generation = chosenGeneration();
    const stats = session.generations[generation - 1]!;
    beginReplay({ replay: createChampionReplay(stats.champion, trainer.setup), label: `generation ${generation}`, generation, physics });
  };
  /** Starts (or restarts) a replay at 1×, unpaused, remembering the speed and pause state to restore afterwards. */
  const beginReplay = (next: Pick<ActiveReplay, 'replay' | 'label' | 'generation' | 'physics'>) => {
    const restore = active ? active.restore : { mode: speed.mode, paused: speed.paused };
    speed.setMode('normal');
    speed.setPaused(false);
    active = { ...next, frame: null, restore };
    running.loop?.resync();
    syncControls();
    syncReplayControls();
  };
  const stopReplay = () => {
    if (!active) return;
    const { restore } = active;
    active = null;
    speed.setMode(restore.mode);
    speed.setPaused(restore.paused);
    running.loop?.resync();
    renderReplay(replayOutputs, emptyReplayText(INPUT_COUNT));
    syncControls();
    syncReplayControls();
  };
  replayPanel.start.addEventListener('click', startReplay);
  replayPanel.stop.addEventListener('click', stopReplay);
  replayPanel.generation.addEventListener('change', () => {
    chosenGeneration();
  });
  replayPanel.details.addEventListener('toggle', () => {
    if (replayPanel.details.open) {
      graph.details.open = false;
      pendingDelete = null;
      refreshSaved();
    } else {
      stopReplay();
    }
    syncPanelLayout();
    graphView.viewport?.update();
    syncReplayControls();
  });
  replayPanel.details.hidden = false;
  syncReplayControls();

  // Saved champions (P3-05). Reading and writing localStorage never throws out of here: the store turns every failure into a
  // message. The list is rebuilt only when something changes (start, save, delete, the block opening), never per frame.
  const savedPanel = page.saved;
  const store = createModelStore({ storage: savedPanel.storage, registry: tracksIn('training') });
  let pendingDelete: string | null = null;
  const say = (text: string) => {
    if (savedPanel.status.textContent !== text) savedPanel.status.textContent = text;
  };
  const refreshSaved = () => {
    const listing = store.list();
    if (!listing.available) say(listing.message);
    renderSavedList(savedPanel.list, savedPanel.ui, listing, pendingDelete, {
      replay: replaySaved,
      requestDelete: (id) => {
        pendingDelete = id;
        refreshSaved();
      },
      confirmDelete: (id) => {
        pendingDelete = null;
        const removed = store.remove(id);
        say(removed.ok ? 'Deleted.' : removed.message);
        refreshSaved();
      },
      cancelDelete: () => {
        pendingDelete = null;
        refreshSaved();
      },
    });
    savedPanel.save.disabled = session.generations.length === 0;
  };
  const replaySaved = (id: string) => {
    pendingDelete = null;
    const loaded = store.load(id);
    if (!loaded.ok) {
      say(loaded.message);
      refreshSaved();
      return;
    }
    const { model } = loaded;
    if (!model.training.trackIds.includes(track.id)) {
      say(`This champion was trained on ${model.training.trackIds.join(', ')}; this view shows ${track.id}, so it cannot be replayed here.`);
      return;
    }
    try {
      const prepared = replayForModel(model);
      const name = model.name ?? 'unnamed champion';
      beginReplay({ replay: prepared.replay, label: `saved champion "${name}"`, generation: null, physics: prepared.setup.environment.physics });
      say([`Replaying "${name}" from generation ${model.training.generation + 1}.`, ...loaded.warnings, ...prepared.warnings].join(' '));
    } catch {
      say("This saved champion can't be replayed.");
    }
    refreshSaved();
  };
  savedPanel.save.addEventListener('click', () => {
    if (session.generations.length === 0) return;
    const generation = chosenGeneration();
    const stats = session.generations[generation - 1]!;
    const typed = savedPanel.name.value.trim();
    const name = typed === '' ? `Generation ${generation} champion` : typed.slice(0, 60);
    // `record()` copies the whole history, so it is called once per save, never per frame.
    const model = buildModel({
      champion: stats.champion,
      fitness: stats.bestFitness,
      generation: stats.generation,
      record: trainer.record(),
      id: savedPanel.newId(),
      createdAt: savedPanel.isoNow(),
      codeVersion: savedPanel.codeVersion,
      appVersion: savedPanel.appVersion,
      name,
    });
    const result = store.save(model);
    if (result.ok) {
      say(`Saved "${name}" (generation ${generation}).${result.indexed ? '' : ' It may not be listed in order until your next save.'}`);
      savedPanel.name.value = '';
    } else {
      say(result.message);
    }
    refreshSaved();
  });
  refreshSaved();

  const draw = (size: ViewportSize) => {
    const layer = trackLayer.get(track, size);
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, size.width, size.height);
    if (!layer) return;
    context.drawImage(layer.canvas, 0, 0);
    if (active) {
      // Only the replayed car. It is drawn in the DECISION state, with the rays that decision was made from; once the
      // episode has ended it is drawn in its result state, without rays (there is no further decision).
      const { replay, frame } = active;
      const pose = replay.done() ? replay.state() : frame ? frame.before : replay.start;
      drawCars(context, size, layer.view, [{ car: pose.racer.car, finished: pose.episode.outcome !== null }], active.physics);
      if (!replay.done() && frame) drawSensors(context, size, layer.view, frame.decision.readings);
      const { dataset } = canvas;
      dataset.trackScale = String(layer.view.scale);
      dataset.trackOffsetX = String(layer.view.offsetX);
      dataset.trackOffsetY = String(layer.view.offsetY);
      return;
    }
    const shown = pickCars(trainer.generation().cars, effectiveDrawCap(speed.mode, drawCap, population));
    const cars = shown.map((car) => ({ car: car.racer.car, finished: car.episode.outcome !== null }));
    drawCars(context, size, layer.view, cars, physics);
    const { dataset } = canvas;
    dataset.trackScale = String(layer.view.scale);
    dataset.trackOffsetX = String(layer.view.offsetX);
    dataset.trackOffsetY = String(layer.view.offsetY);
  };

  /** Writes the status line, plus data attributes for the browser tests. */
  const show = () => {
    const generation = trainer.generation();
    const drawn = effectiveDrawCap(speed.mode, drawCap, population);
    const text = trainingStatus(generation, speedStatus(speed.mode, speed.paused) + (active ? ` · replaying ${active.label}` : ''));
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
      speed: speed.mode,
      paused: String(speed.paused),
      drawn: String(drawn),
      chartPoints: String(session.history.length),
      chartDraws: String(chart.draws),
      tick: String(ticks),
      replay: active ? (active.replay.done() ? 'done' : 'running') : 'off',
    });
    if (active) {
      const { replay, frame } = active;
      if (active.generation === null) delete canvas.dataset.replayGeneration;
      else canvas.dataset.replayGeneration = String(active.generation);
      canvas.dataset.replaySource = active.generation === null ? 'saved' : 'generation';
      canvas.dataset.replayTick = String(replay.ticks());
      if (replay.done()) canvas.dataset.replayOutcome = replay.state().episode.outcome!;
      else delete canvas.dataset.replayOutcome;
      renderReplay(replayOutputs, replayText(frame, replay.state(), replay.ticks(), config.timestepSeconds, active.label, INPUT_COUNT));
    } else {
      for (const name of ['replayGeneration', 'replayTick', 'replayOutcome', 'replaySource']) delete canvas.dataset[name];
    }
    // The generation field's range follows the completed generations (a cheap check, written only on a change).
    if (session.generations.length !== replayCount) {
      replayCount = session.generations.length;
      syncReplayControls();
    }
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
  const stepper = createFrameStepper({
    runTick: () => {
      ticks += 1;
      ticksThisFrame += 1;
      session.step();
    },
    mode: () => speed.mode,
    now: page.now ?? (() => performance.now()),
  });
  running.loop = startFrameLoop(page.frames ?? browserFrameEnvironment(), speed, {
    step: () => {
      if (active) {
        const frame = active.replay.step();
        if (frame) {
          active.frame = frame;
          ticksThisFrame += 1;
        }
        return;
      }
      return stepper.step();
    },
    render: () => {
      draw(viewport.current());
      show();
      chart.frame();
      stepper.endFrame();
      updateFps(page.now ? page.now() : performance.now());
    },
  });
}
