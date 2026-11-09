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
import { createTrainer, DEFAULT_TRAINING_CONFIG, type Generation, type TrainerState } from '../training/trainer';
import { MAX_CHECKPOINT_BYTES, type CheckpointDocument } from '../persistence/checkpointFormat';
import { checkpointFile, CHECKPOINT_MESSAGES, createCheckpointStore, describeCheckpointRefusal, parseCheckpointText } from '../persistence/checkpointStore';
import { checkpointFromState, checkpointFromTrainer, checkpointValidateOptions, resumeFromCheckpoint } from './checkpointAdapter';
import { createCheckpointSaver } from './checkpointSaver';
import { describeRefusal, importModelText } from '../persistence/modelImport';
import { MAX_MODEL_BYTES } from '../persistence/modelFormat';
import { createModelStore, MESSAGES, type StorageLike } from '../persistence/modelStore';
import { buildModel, modelParameters } from '../persistence/modelFormat';
import { tracksIn } from '../training/trackSplits';
import { emptyReplayText, renderReplay, replayText, type ReplayOutputs } from './championReplayView';
import { renderSavedList, type UiFactory, type UiList } from './savedChampionsView';
import { replayForModel } from './savedReplay';
import { browserFrameEnvironment, startFrameLoop, type FrameEnvironment, type FrameLoop } from './frameLoop';
import { createRateMeter, formatRateReadout, meanMs } from './rateMeter';
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

/** The part of a file chooser the import uses (so Node tests can fake it). */
export interface ImportFile {
  readonly name: string;
  readonly size: number;
  text(): Promise<string>;
}
export interface ImportInput {
  readonly files: ArrayLike<ImportFile> | null;
  value: string;
  addEventListener(type: 'change', listener: () => void): void;
}

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
    /** The file chooser for Import JSON (P3-06): one `.json` file; it is read only after its size is checked. */
    readonly importInput: ImportInput;
    readonly status: HTMLElement;
    readonly list: UiList;
    readonly ui: UiFactory;
    /** The browser's localStorage, or throws if it is denied. Called on every operation. */
    readonly storage: () => StorageLike | null;
    /** A fresh id (a UUID); it must not draw from a simulation or evolution random stream. */
    readonly newId: () => string;
    /** Starts a download of `text` as a file named `filename`; may throw if the browser refuses. */
    readonly download: (filename: string, text: string) => void;
    /** The current time as an ISO 8601 UTC string. */
    readonly isoNow: () => string;
    readonly codeVersion: string;
    readonly appVersion: string;
  };
  /**
   * Training checkpoints (P3-07): a status line, the offer to resume (never automatic), Download checkpoint and a file chooser.
   * Absent, the page has no checkpoint feature. The checkpoint is stored in localStorage and is separate from saved champions.
   */
  readonly checkpoint?: {
    readonly status: HTMLElement;
    readonly offer: { readonly container: HTMLElement; readonly text: HTMLElement; readonly resume: HTMLButtonElement; readonly discard: HTMLButtonElement };
    readonly download: HTMLButtonElement;
    readonly importInput: ImportInput;
    readonly storage: () => StorageLike | null;
    readonly newId: () => string;
    readonly isoNow: () => string;
    readonly codeVersion: string;
    readonly appVersion: string;
    /** Starts a download of `text` as a file named `filename`; may throw if the browser refuses. */
    readonly saveFile: (filename: string, text: string) => void;
    /** Runs a callback after the current frame; returns a function that cancels it. */
    readonly defer: (callback: () => void) => () => void;
    /** Calls the listener when the page is hidden or being left (`visibilitychange` to hidden, `pagehide`); returns an unsubscribe. */
    readonly onHide: (listener: () => void) => () => void;
    readonly everyGenerations?: number;
    readonly minSeconds?: number;
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

/** Ticks a saved champion is run ahead of time to find a network that overflows. */
const PROBE_TICKS = 5000;
/** The most replay ticks one page tick may take, which bounds the work of a very small recorded timestep. */
const MAX_REPLAY_TICKS_PER_STEP = 64;

export function startTrainingPage(page: TrainingPage): void {
  const { canvas, context, status, trackLayer, track, physics, config } = page;
  for (const element of page.hide) element.hidden = true;
  canvas.setAttribute('aria-label', 'Racetrack with a population of training cars');

  page.dashboard.panel.hidden = false;
  const environment = { track, physics, timestepSeconds: config.timestepSeconds };
  // A resume (P3-07) replaces the trainer and its session, so both are rebindable; nothing caches a value derived from them.
  let trainer = createTrainer(DEFAULT_TRAINING_CONFIG, environment);
  let session = createTrainingSession(trainer, page.dashboard.outputs);
  /** Set by the checkpoint code below; called when a generation ends. */
  let onBoundary: () => void = () => {};
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
  // Mean step time (P3-07): milliseconds spent inside the simulation step, fed to a meter at the same sample times as the
  // tick counts, so ms-per-second over ticks-per-second is the mean ms per tick over the same window and resets.
  const stepCostMeter = createRateMeter();
  const drawCostMeter = createRateMeter();
  let stepMsThisFrame = 0;
  let drawMsThisFrame = 0;
  const measureClock = page.now ?? (() => performance.now());
  let ticksThisFrame = 0;
  let lastReadoutMs = Number.NEGATIVE_INFINITY;
  const resetMeters = () => {
    frameMeter.reset();
    tickMeter.reset();
    stepCostMeter.reset();
    drawCostMeter.reset();
    stepMsThisFrame = 0;
    drawMsThisFrame = 0;
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
    stepCostMeter.add(timeMs, stepMsThisFrame);
    drawCostMeter.add(timeMs, drawMsThisFrame);
    ticksThisFrame = 0;
    stepMsThisFrame = 0;
    drawMsThisFrame = 0;
    if (timeMs - lastReadoutMs < 250 && timeMs >= lastReadoutMs) return;
    lastReadoutMs = timeMs;
    const config = `${speed.paused ? 'paused' : speed.mode} · ${effectiveDrawCap(speed.mode, drawCap, population)} cars drawn`;
    const frameRate = frameMeter.rate();
    const tickRate = tickMeter.rate();
    const stepMs = meanMs(stepCostMeter.rate(), tickRate);
    const renderMs = meanMs(drawCostMeter.rate(), frameRate);
    fpsReadout.textContent = formatRateReadout(frameRate, tickRate, config, { stepMs, renderMs, context: `population ${population} · ${track.id} · build ${page.saved.codeVersion}` });
    const { dataset } = canvas;
    if (frameRate !== null) dataset.fpsFrames = frameRate.toFixed(1);
    else delete dataset.fpsFrames;
    if (tickRate !== null) dataset.fpsTicks = tickRate.toFixed(1);
    else delete dataset.fpsTicks;
    if (stepMs !== null) dataset.fpsStepMs = stepMs.toFixed(4);
    else delete dataset.fpsStepMs;
    if (renderMs !== null) dataset.fpsRenderMs = renderMs.toFixed(2);
    else delete dataset.fpsRenderMs;
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
    /** Seconds per tick of the replay's own setup: a saved champion keeps the timestep it was saved with. */
    readonly timestep: number;
    /** Builds a fresh replay of the same champion, so Restart never switches to another one. */
    readonly remake: () => ChampionReplay;
    /** Page time not yet turned into replay ticks, seconds (the replay runs at 1× against the page's clock). */
    credit: number;
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
    // A running saved champion can always be restarted, whether or not a live generation has completed yet.
    replayPanel.start.disabled = count === 0 && !(active && active.generation === null);
    page.saved.save.disabled = count === 0;
    replayPanel.stop.disabled = active === null;
    // A running saved champion restarts itself; the generation picker only chooses what a live replay starts from.
    replayPanel.start.textContent = active ? (active.generation === null ? 'Restart saved' : 'Restart') : 'Replay';
    replayPanel.start.setAttribute('aria-label', active?.generation === null ? 'Restart saved champion' : active ? 'Restart replay' : 'Replay champion');
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
    if (active && active.generation === null) {
      // The active replay is a saved champion: restart that one, never silently switch to a live generation.
      beginReplay({ replay: active.remake(), label: active.label, generation: null, physics: active.physics, timestep: active.timestep, remake: active.remake });
      return;
    }
    const count = session.generations.length;
    if (count === 0) return;
    const generation = chosenGeneration();
    const stats = session.generations[generation - 1];
    if (!stats) {
      // After a resume, an older generation's champion may not have been kept (it is only a graph point).
      say(`The champion of generation ${generation} was not kept in the checkpoint, so it cannot be replayed.`);
      return;
    }
    const remake = () => createChampionReplay(stats.champion, trainer.setup);
    beginReplay({ replay: remake(), label: `generation ${generation}`, generation, physics, timestep: config.timestepSeconds, remake });
  };
  /** Starts (or restarts) a replay at 1×, unpaused, remembering the speed and pause state to restore afterwards. */
  const beginReplay = (next: Pick<ActiveReplay, 'replay' | 'label' | 'generation' | 'physics' | 'timestep' | 'remake'>) => {
    const restore = active ? active.restore : { mode: speed.mode, paused: speed.paused };
    speed.setMode('normal');
    speed.setPaused(false);
    active = { ...next, credit: 0, frame: null, restore };
    running.loop?.resync();
    syncControls();
    syncReplayControls();
  };
  /**
   * One page tick of an active replay. The replay runs at 1× against the page's clock whatever timestep it was recorded
   * with: each page tick adds its duration as credit, and the replay takes a tick of its own for each tick of credit (so a
   * 1/30 s recording takes a tick every second page tick and a 1/120 s one takes two). If running the network throws, the
   * replay is stopped with a message and training carries on, rather than the error escaping the frame.
   */
  const stepReplay = (current: ActiveReplay): boolean => {
    current.credit += config.timestepSeconds;
    for (let taken = 0; taken < MAX_REPLAY_TICKS_PER_STEP && current.credit >= current.timestep - 1e-9 && !current.replay.done(); taken += 1) {
      current.credit -= current.timestep;
      try {
        const frame = current.replay.step();
        if (frame) {
          current.frame = frame;
          ticksThisFrame += 1;
        }
      } catch {
        const label = current.label;
        stopReplay();
        say(`The replay of ${label} stopped: its network produced numbers too large to compute. Training carries on.`);
        // False ends the rest of this frame's ticks (the frame loop's early stop): they were scheduled for the replay, and
        // training, which may have been paused or at another speed before it, must not run them.
        return false;
      }
    }
    if (current.replay.done()) current.credit = 0;
    return true;
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
    else if (listing.partial) say(MESSAGES.partial);
    renderSavedList(savedPanel.list, savedPanel.ui, listing, pendingDelete, {
      replay: replaySaved,
      download: (id) => {
        pendingDelete = null;
        let file: ReturnType<typeof store.exportFile>;
        try {
          file = store.exportFile(id);
        } catch {
          say("This saved champion can't be exported.");
          return;
        }
        if (!file.ok) {
          say(file.message);
          return;
        }
        try {
          savedPanel.download(file.filename, file.text);
          say(`Download started: ${file.filename}. Keep the file somewhere safe: it is a copy that does not depend on this browser's storage.`);
        } catch {
          say('The download could not be started in this browser.');
        }
      },
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
    let prepared: ReturnType<typeof replayForModel>;
    try {
      prepared = replayForModel(model);
    } catch {
      say("This saved champion can't be replayed.");
      refreshSaved();
      return;
    }
    // A model can be valid and finite yet overflow when its network is run. Replays are deterministic, so running a fresh
    // copy ahead of time finds that now, with a message, instead of in the middle of a frame.
    const genome = modelParameters(model);
    const remake = () => createChampionReplay(genome, prepared.setup);
    const probe = remake();
    try {
      for (let i = 0; i < PROBE_TICKS && !probe.done(); i += 1) probe.step();
    } catch {
      say("This saved champion can't be replayed: its network produces numbers too large to compute.");
      refreshSaved();
      return;
    }
    const name = model.name ?? 'unnamed champion';
    beginReplay({
      replay: remake(),
      label: `saved champion "${name}"`,
      generation: null,
      physics: prepared.setup.environment.physics,
      timestep: prepared.setup.environment.timestepSeconds,
      remake,
    });
    say([`Replaying "${name}" from generation ${model.training.generation + 1}.`, ...loaded.warnings, ...prepared.warnings].join(' '));
    refreshSaved();
  };
  // Import JSON (P3-06). The file's size is checked before it is read, and the text is checked in full before anything is
  // written, so a refused file changes nothing. The file's name is never used as a key and is not shown.
  let importing = false;
  const importChosen = async () => {
    const input = savedPanel.importInput;
    const files = input.files;
    const count = files ? files.length : 0;
    if (count === 0 || importing) return;
    pendingDelete = null;
    try {
      if (count > 1) {
        say('Nothing was imported. Choose one file at a time.');
        return;
      }
      const file = files?.[0];
      if (!file) return;
      if (!(file.size <= MAX_MODEL_BYTES)) {
        say('Nothing was imported. This file is larger than the 1 MiB limit for a champion.');
        return;
      }
      importing = true;
      let text: string;
      try {
        text = await file.text();
      } catch {
        say('Nothing was imported. The file could not be read.');
        return;
      }
      const result = importModelText(text, { registry: tracksIn('training') });
      if (!result.ok) {
        say(describeRefusal(result.errors));
        return;
      }
      const outcome = store.importModel(result.model, savedPanel.newId);
      if (!outcome.ok) {
        say(`Nothing was imported. ${outcome.message}`);
        return;
      }
      const name = result.model.name ?? 'Unnamed champion';
      const extra = [...result.warnings, ...(result.drivable ? [] : ['It is listed but cannot be replayed here.'])].join(' ');
      const head =
        outcome.status === 'already-saved'
          ? `"${name}" is already saved; nothing was added.`
          : outcome.status === 'saved-as-copy'
            ? `Imported "${name}" (generation ${result.model.training.generation + 1}) as a new copy, because a different champion already used its id.`
            : `Imported "${name}" (generation ${result.model.training.generation + 1}).`;
      say(`${head}${extra === '' ? '' : ` ${extra}`}${outcome.indexed ? '' : ' It may not be listed in order until your next save.'}`);
      refreshSaved();
    } catch {
      say('Nothing was imported. This file could not be checked.');
    } finally {
      importing = false;
      // Choosing the same file again must fire a change.
      try {
        input.value = '';
      } catch {
        // Some browsers refuse; the next choice of a different file still works.
      }
    }
  };
  savedPanel.importInput.addEventListener('change', () => void importChosen());
  savedPanel.save.addEventListener('click', () => {
    if (session.generations.length === 0) return;
    const generation = chosenGeneration();
    const stats = session.generations[generation - 1];
    if (!stats) {
      say(`The champion of generation ${generation} was not kept in the checkpoint, so it cannot be saved.`);
      return;
    }
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
    const text = trainingStatus(generation, speedStatus(speed.mode, speed.paused) + (active ? ` · replaying ${active.label}` : '') + (canvas.dataset.checkpointOffer ? ' · checkpoint found' : ''));
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
      renderReplay(replayOutputs, replayText(frame, replay.state(), replay.ticks(), active.timestep, active.label, INPUT_COUNT));
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

  // Training checkpoints (P3-07). A checkpoint is the state of this run at a generation boundary, written in the right order by
  // one saver (see checkpointSaver.ts). A stored checkpoint is only ever OFFERED: nothing resumes automatically, and automatic
  // saving stays off until the offer is answered, so a stored checkpoint is never overwritten unseen. Every failure is a
  // message and training carries on; Download checkpoint works from the state in memory whatever the storage does.
  const cp = page.checkpoint;
  if (cp) {
    const options = checkpointValidateOptions();
    const cpStore = createCheckpointStore({ storage: cp.storage, ...options });
    const clock = page.now ?? (() => performance.now());
    const meta = () => ({ id: cp.newId(), createdAt: cp.isoNow(), codeVersion: cp.codeVersion, appVersion: cp.appVersion });
    const cpSay = (text: string) => {
      if (cp.status.textContent !== text) cp.status.textContent = text;
    };
    interface Offer {
      /** The checkpoint offered, or null when the stored one is damaged and there is nothing to resume. */
      readonly doc: CheckpointDocument | null;
      readonly source: 'storage' | 'file';
      readonly text: string;
      readonly canResume: boolean;
    }
    let offered: Offer | null = null;
    /** The stored checkpoint's offer while it is unanswered, so loading and discarding a file brings it back. */
    let storageOffer: Offer | null = null;
    const showOffer = (offer: Offer) => {
      offered = offer;
      cp.offer.text.textContent = offer.text;
      cp.offer.resume.disabled = !offer.canResume;
      cp.offer.container.hidden = false;
    };
    const hideOffer = () => {
      offered = null;
      cp.offer.container.hidden = true;
      delete canvas.dataset.checkpointOffer;
    };
    const saver = createCheckpointSaver<TrainerState>({
      write: (state) => {
        const written = cpStore.write(checkpointFromState(trainer.setup, state, meta()));
        return written.ok ? { ok: true } : { ok: false, message: written.message };
      },
      defer: cp.defer,
      now: clock,
      isRunning: () => !speed.paused,
      ...(cp.everyGenerations === undefined ? {} : { everyGenerations: cp.everyGenerations }),
      ...(cp.minSeconds === undefined ? {} : { minSeconds: cp.minSeconds }),
      onResult: (result) => {
        if (result.kind === 'saved') {
          cpSay(`Checkpoint saved after generation ${result.generationIndex} (${cp.isoNow().slice(11, 19)} UTC). Training continues.`);
          canvas.dataset.checkpointSaved = String(result.generationIndex);
        } else {
          cpSay(result.message);
          canvas.dataset.checkpointFailed = String(result.generationIndex);
        }
      },
    });
    onBoundary = () => saver.boundary(trainer.checkpointState());

    /** Replaces the running trainer with one resumed from `doc`. Training keeps its speed; any replay is stopped first. */
    const resumeFrom = (doc: CheckpointDocument, source: 'storage' | 'file') => {
      const resumed = resumeFromCheckpoint(doc, trainer.setup);
      if (!resumed.ok) {
        cpSay(`This checkpoint cannot be resumed. ${resumed.reasons.join(' ')}`);
        return;
      }
      let next: ReturnType<typeof createTrainer>;
      try {
        next = createTrainer(resumed.configuration, environment, resumed.resume);
      } catch {
        cpSay('This checkpoint cannot be resumed: its state was refused by the trainer.');
        return;
      }
      stopReplay();
      trainer = next;
      session = createTrainingSession(trainer, page.dashboard.outputs, resumed.resume.history);
      ticks = 0;
      replayCount = -1;
      resetMeters();
      chart.invalidate();
      hideOffer();
      storageOffer = null;
      saver.reset(source === 'storage' ? doc.generationIndex : -1);
      saver.setEnabled(true);
      refreshSaved();
      syncReplayControls();
      const kept = resumed.resume.history.filter((entry) => entry.retained).length;
      cpSay(`Resumed from generation ${doc.generationIndex} (the next generation to run is ${doc.generationIndex + 1}). ${kept} of ${doc.generationIndex} past champions were kept; the rest are graph points only.`);
      canvas.dataset.checkpointResumed = String(doc.generationIndex);
    };

    const consider = (doc: CheckpointDocument, source: 'storage' | 'file'): Offer => {
      const check = resumeFromCheckpoint(doc, trainer.setup);
      canvas.dataset.checkpointOffer = check.ok ? 'resumable' : 'unusable';
      const when = doc.createdAt.replace('T', ' ').slice(0, 19);
      const offer: Offer = check.ok
        ? { doc, source, canResume: true, text: `${source === 'file' ? 'A checkpoint file was loaded' : 'A saved checkpoint was found'}: ${doc.generationIndex} completed generations, saved ${when} UTC. Resuming replaces the run now in progress.` }
        : { doc, source, canResume: false, text: `A checkpoint (${doc.generationIndex} generations, saved ${when} UTC) cannot be resumed by this version. ${check.reasons.join(' ')}` };
      showOffer(offer);
      cpSay(check.ok ? (source === 'file' ? 'Checkpoint file loaded. Choose Resume or Discard.' : 'A saved checkpoint was found. Choose Resume or Discard. Automatic checkpoint saving is off until you do.') : 'That checkpoint cannot be resumed here. You can discard it.');
      return offer;
    };

    cp.offer.resume.addEventListener('click', () => {
      if (offered?.doc && offered.canResume) resumeFrom(offered.doc, offered.source);
    });
    cp.offer.discard.addEventListener('click', () => {
      const current = offered;
      if (!current) return;
      hideOffer();
      if (current.source === 'storage') {
        const cleared = cpStore.clear();
        if (!cleared.ok) {
          cpSay(cleared.message);
          showOffer(current);
          return;
        }
        storageOffer = null;
        cpSay('Discarded the stored checkpoint. Checkpoints will be saved again as training runs.');
        saver.reset(-1);
        saver.setEnabled(true);
      } else if (storageOffer) {
        // A loaded file was dropped while the stored checkpoint is still waiting for an answer: bring that offer back.
        cpSay('Discarded the loaded file. The stored checkpoint is still waiting for your answer.');
        showOffer(storageOffer);
      } else {
        cpSay('Discarded the loaded file. The stored checkpoint, if any, is unchanged.');
      }
    });

    // The stored checkpoint, offered once at the start. Autosave stays off until it is answered.
    const stored = cpStore.read();
    if (stored.status === 'ok') {
      saver.setEnabled(false);
      storageOffer = consider(stored.checkpoint, 'storage');
    } else if (stored.status === 'damaged') {
      saver.setEnabled(false);
      canvas.dataset.checkpointOffer = 'damaged';
      storageOffer = { doc: null, source: 'storage', canResume: false, text: `A saved checkpoint is damaged and cannot be used. ${stored.problem} Discard it to start saving checkpoints.` };
      showOffer(storageOffer);
      cpSay('A saved checkpoint is damaged. You can discard it.');
    } else if (stored.status === 'unavailable') {
      cpSay(stored.message);
    } else {
      cpSay('No checkpoint saved yet. One is saved at a generation boundary every 5 generations or 30 seconds while training runs.');
    }


    cp.onHide(() => saver.flush());

    cp.download.addEventListener('click', () => {
      let built: ReturnType<typeof checkpointFromTrainer>;
      try {
        built = checkpointFromTrainer(trainer, meta());
      } catch {
        cpSay(CHECKPOINT_MESSAGES.notWritable);
        return;
      }
      const file = checkpointFile(built);
      if (!file.ok) {
        cpSay(file.message);
        return;
      }
      try {
        cp.saveFile(file.filename, file.text);
        cpSay(`Download started: ${file.filename}. It is a copy of this run at generation ${built.generationIndex}, independent of this browser's storage.`);
      } catch {
        cpSay('The download could not be started in this browser.');
      }
    });

    let loading = false;
    cp.importInput.addEventListener('change', () => {
      void (async () => {
        const input = cp.importInput;
        const files = input.files;
        const count = files ? files.length : 0;
        if (count === 0 || loading) return;
        try {
          if (count > 1) {
            cpSay('Nothing was loaded. Choose one file at a time.');
            return;
          }
          const file = files?.[0];
          if (!file) return;
          if (!(file.size <= MAX_CHECKPOINT_BYTES)) {
            cpSay('Nothing was loaded. This file is larger than the 3 MiB limit for a checkpoint.');
            return;
          }
          loading = true;
          let text: string;
          try {
            text = await file.text();
          } catch {
            cpSay('Nothing was loaded. The file could not be read.');
            return;
          }
          const parsed = parseCheckpointText(text, options);
          if (!parsed.ok) {
            cpSay(describeCheckpointRefusal(parsed.errors));
            return;
          }
          consider(parsed.checkpoint, 'file');
        } catch {
          cpSay('Nothing was loaded. This file could not be checked.');
        } finally {
          loading = false;
          try {
            input.value = '';
          } catch {
            // Some browsers refuse; choosing a different file still works.
          }
        }
      })();
    });
  }

  const viewport = createViewport(canvas, page.viewportEnvironment ?? browserViewportEnvironment(canvas), draw);
  const stepper = createFrameStepper({
    runTick: () => {
      ticks += 1;
      ticksThisFrame += 1;
      const completed = session.generations.length;
      if (fpsReadout) {
        // Only the opt-in readout pays for the two clock reads per tick.
        const started = measureClock();
        session.step();
        stepMsThisFrame += measureClock() - started;
      } else {
        session.step();
      }
      if (session.generations.length !== completed) onBoundary();
    },
    mode: () => speed.mode,
    now: page.now ?? (() => performance.now()),
  });
  running.loop = startFrameLoop(page.frames ?? browserFrameEnvironment(), speed, {
    step: () => {
      if (active) return stepReplay(active) ? undefined : false;
      return stepper.step();
    },
    render: () => {
      const drawStarted = fpsReadout ? measureClock() : 0;
      draw(viewport.current());
      show();
      chart.frame();
      if (fpsReadout) drawMsThisFrame += measureClock() - drawStarted;
      stepper.endFrame();
      updateFps(page.now ? page.now() : performance.now());
    },
  });
}
