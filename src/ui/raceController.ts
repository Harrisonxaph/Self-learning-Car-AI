// The race page's logic with no DOM (P5-03): which champions can be raced, which circuits are offered, the countdown, one
// fixed tick at a time, the restart and the results. The page (ui/racePage.ts) only draws it. Only training circuits,
// validation circuits and the person's saved custom tracks are ever offered, and every circuit is resolved through
// `resolveCircuit` (P4-05/P4-03), so a held-out circuit cannot be offered, ticked or started from here.
//
// The countdown runs on RENDER time (`frame(timeMs)`), never on the simulation: no tick runs during it. One frame's
// contribution is capped, so a tab that was in the background cannot skip the countdown or start the race with a time jump.
import { modelParameters } from '../persistence/modelFormat';
import type { ModelStore, StoreEntry } from '../persistence/modelStore';
import { DEFAULT_SIM_CONFIG, type SimConfig } from '../sim/config';
import type { Controls } from '../sim/vehicle';
import {
  createRaceRunner,
  createRaceSetup,
  raceDone,
  raceResult,
  type RaceResult,
  type RaceRunner,
  type RaceSetup,
  type RaceState,
} from '../training/race';
import { describeEntry } from './savedChampionsView';
import { modelProblem, resolveCircuit, type CustomSource } from './modelEvaluation';

export interface CircuitChoice {
  readonly id: string;
  readonly name: string;
}

export interface RaceModelChoice {
  readonly id: string;
  readonly label: string;
  readonly usable: boolean;
  /** Why it cannot be raced (when `usable` is false). */
  readonly reason: string | null;
  /** The circuit it was trained on, by ID. */
  readonly trainedOn: string | null;
}

export interface RaceCircuitOption extends CircuitChoice {
  readonly split: 'training' | 'validation' | 'custom';
}

export type RacePhase = 'setup' | 'countdown' | 'racing' | 'finished';

/** Seconds of countdown before the race runs, on render time. */
export const COUNTDOWN_SECONDS = 3;
/** The most one frame may add to the countdown: a backgrounded tab's long gap is never counted as time passed. */
export const MAX_FRAME_SECONDS = 0.1;
/** The race lengths offered. */
export const LAP_CHOICES = Object.freeze([1, 3] as const);
export const DEFAULT_LAPS = 3;

export interface RaceDeps {
  readonly store: ModelStore;
  readonly trainingCircuits: readonly CircuitChoice[];
  readonly validationCircuits: readonly CircuitChoice[];
  /** The saved custom track an ID names, read and checked again on every call (P4-03). */
  readonly customTracks?: CustomSource | undefined;
  /** The saved custom tracks to offer now, read again whenever the page refreshes. */
  readonly savedTracks?: (() => readonly CircuitChoice[]) | undefined;
  /** For tests: the countdown length in seconds. */
  readonly countdownSeconds?: number;
}

export interface RaceView {
  readonly setup: RaceSetup;
  readonly state: RaceState;
}

export interface RaceController {
  models(): readonly RaceModelChoice[];
  selected(): string | null;
  select(id: string | null): void;
  circuits(): readonly RaceCircuitOption[];
  circuit(): string | null;
  selectCircuit(id: string): void;
  laps(): number;
  selectLaps(laps: number): void;
  canStart(): boolean;
  /** Begins the countdown. A refusal sets `message()` and changes nothing else. */
  start(): boolean;
  phase(): RacePhase;
  message(): string;
  /** Render-time frame: advances the countdown (never the simulation). `timeMs` is any monotonic clock in milliseconds. */
  frame(timeMs: number): void;
  /** Forgets the last frame time, so time away (a hidden page) is never counted. */
  resync(): void;
  /** The countdown's whole seconds left (3, 2, 1), or null when not counting down. */
  countdown(): number | null;
  /** One fixed tick of the race with the human's controls; does nothing unless the race is running. */
  step(controls: Controls): void;
  /** Starts the whole race again from the same start (the AI repeats exactly): back to the countdown. */
  restart(): boolean;
  /** Back to choosing; the race is dropped. */
  back(): void;
  view(): RaceView | null;
  /** The results, once both cars have ended. */
  result(): RaceResult | null;
  /** Simulated seconds elapsed in the race. */
  elapsedSeconds(): number;
  refresh(): void;
  subscribe(listener: () => void): () => void;
}

/**
 * The fixed-step clock's settings for a race: the champion's OWN recorded timestep (each `step()` advances the physics and the race timers by it,
 * so the clock must schedule ticks at that length), with the default catch-up limit kept.
 */
export function raceClockConfig(setup: RaceSetup): SimConfig {
  return { ...DEFAULT_SIM_CONFIG, timestepSeconds: setup.context.environment.timestepSeconds };
}

/** True when `id` resolves to a built-in circuit of exactly `split`: a held-out or unknown ID throws and is refused. */
function isOfferedCircuit(id: string, split: 'training' | 'validation'): boolean {
  try {
    return resolveCircuit(id).split === split;
  } catch {
    return false;
  }
}

export function createRaceController(deps: RaceDeps): RaceController {
  const { store } = deps;
  const countdownTotal = deps.countdownSeconds ?? COUNTDOWN_SECONDS;
  // The only circuits this page can ever offer: the caller's built-in training and validation lists, each ID once, then the
  // saved custom tracks (never an ID a built-in circuit uses).
  const builtIn: RaceCircuitOption[] = [];
  const builtInIds = new Set<string>();
  for (const [list, split] of [[deps.trainingCircuits, 'training'], [deps.validationCircuits, 'validation']] as const) {
    for (const c of list) {
      if (builtInIds.has(c.id)) continue;
      // Filtered again here: an ID that is not a training or validation circuit (a held-out one, or any other) is never offered.
      if (!isOfferedCircuit(c.id, split)) continue;
      builtInIds.add(c.id);
      builtIn.push({ id: c.id, name: c.name, split });
    }
  }
  let saved: RaceCircuitOption[] = [];
  const readSaved = (): void => {
    saved = [];
    const seen = new Set<string>();
    try {
      for (const c of deps.savedTracks?.() ?? []) {
        if (builtInIds.has(c.id) || seen.has(c.id)) continue;
        seen.add(c.id);
        saved.push({ id: c.id, name: c.name, split: 'custom' });
      }
    } catch {
      saved = [];
    }
  };
  const offered = (): readonly RaceCircuitOption[] => [...builtIn, ...saved];

  const listeners = new Set<() => void>();
  const notify = (): void => listeners.forEach((l) => l());
  let modelList: RaceModelChoice[] = [];
  let selectedId: string | null = null;
  let circuitId: string | null = null;
  let lapCount: number = DEFAULT_LAPS;
  let phaseNow: RacePhase = 'setup';
  let messageText = '';
  let setup: RaceSetup | null = null;
  let runner: RaceRunner | null = null;
  let state: RaceState | null = null;
  let remaining = 0;
  let lastFrameMs: number | null = null;
  let finished: RaceResult | null = null;

  const choiceOf = (entry: StoreEntry): RaceModelChoice => {
    if (entry.status === 'damaged') return { id: entry.id, label: describeEntry(entry), usable: false, reason: entry.problem, trainedOn: null };
    return {
      id: entry.id,
      label: describeEntry(entry),
      usable: entry.drivable,
      reason: entry.drivable ? null : `This app cannot drive this champion. ${entry.warnings.join(' ')}`.trim(),
      trainedOn: entry.summary.circuit,
    };
  };

  const defaultCircuit = (model: RaceModelChoice | undefined): string | null => {
    const trained = model?.trainedOn;
    if (trained && offered().some((c) => c.id === trained)) return trained;
    return offered()[0]?.id ?? null;
  };

  const dropRace = (): void => {
    setup = null;
    runner = null;
    state = null;
    finished = null;
    remaining = 0;
    lastFrameMs = null;
    phaseNow = 'setup';
  };

  const refresh = (): void => {
    readSaved();
    const listing = store.list();
    if (!listing.available) {
      modelList = [];
      messageText = listing.message;
    } else {
      modelList = listing.entries.map(choiceOf);
    }
    if (selectedId !== null && !modelList.some((m) => m.id === selectedId)) {
      selectedId = null;
      if (phaseNow === 'setup') dropRace();
    }
    // A circuit is always chosen (the first offered one until a champion or the person picks another), so the selector is never blank.
    if (circuitId === null || !offered().some((c) => c.id === circuitId)) circuitId = defaultCircuit(modelList.find((m) => m.id === selectedId));
    notify();
  };
  refresh();

  const current = (): RaceModelChoice | undefined => modelList.find((m) => m.id === selectedId);

  const startCountdown = (): void => {
    state = runner!.start();
    finished = null;
    remaining = countdownTotal;
    lastFrameMs = null;
    phaseNow = 'countdown';
  };

  const controller: RaceController = {
    models: () => modelList,
    selected: () => selectedId,
    select(id) {
      if (phaseNow !== 'setup') return;
      messageText = '';
      const found = id === null ? undefined : modelList.find((m) => m.id === id);
      selectedId = found ? found.id : null;
      // Choosing a champion selects the circuit it was trained on; clearing the choice keeps the circuit already picked.
      circuitId = found ? defaultCircuit(found) : (circuitId ?? defaultCircuit(undefined));
      notify();
    },
    circuits: offered,
    circuit: () => circuitId,
    selectCircuit(id) {
      if (phaseNow !== 'setup') return;
      if (!offered().some((c) => c.id === id)) return;
      circuitId = id;
      messageText = '';
      notify();
    },
    laps: () => lapCount,
    selectLaps(laps) {
      if (phaseNow !== 'setup') return;
      if (!(LAP_CHOICES as readonly number[]).includes(laps)) return;
      lapCount = laps;
      notify();
    },
    canStart: () => phaseNow === 'setup' && current()?.usable === true && circuitId !== null,
    start() {
      if (phaseNow !== 'setup') return false;
      const chosen = current();
      if (!chosen || circuitId === null) {
        messageText = 'Choose a saved champion first.';
        notify();
        return false;
      }
      if (!chosen.usable) {
        messageText = chosen.reason ?? 'This champion cannot be raced.';
        notify();
        return false;
      }
      const loaded = store.load(chosen.id);
      if (!loaded.ok) {
        messageText = loaded.message;
        notify();
        return false;
      }
      const problem = modelProblem(loaded.model);
      if (problem !== null) {
        messageText = problem;
        notify();
        return false;
      }
      try {
        // resolveCircuit throws for a held-out circuit (or any ID that is not a training, validation or saved custom track).
        const circuit = resolveCircuit(circuitId, deps.customTracks);
        const c = loaded.model.training.configuration;
        setup = createRaceSetup({
          track: circuit.track,
          physics: c.physics,
          timestepSeconds: c.timestepSeconds,
          laps: lapCount,
          genome: modelParameters(loaded.model),
          brakeEnabled: c.brakeEnabled,
        });
      } catch (error) {
        setup = null;
        messageText = error instanceof Error ? error.message : 'This race cannot be started.';
        notify();
        return false;
      }
      runner = createRaceRunner(setup);
      messageText = '';
      startCountdown();
      notify();
      return true;
    },
    phase: () => phaseNow,
    message: () => messageText,
    frame(timeMs) {
      if (phaseNow !== 'countdown') return;
      if (typeof timeMs !== 'number' || !Number.isFinite(timeMs)) return;
      if (lastFrameMs === null) {
        lastFrameMs = timeMs;
        return;
      }
      const seconds = Math.min(MAX_FRAME_SECONDS, Math.max(0, (timeMs - lastFrameMs) / 1000));
      lastFrameMs = timeMs;
      remaining -= seconds;
      if (remaining <= 0) {
        remaining = 0;
        phaseNow = 'racing';
      }
      notify();
    },
    resync() {
      lastFrameMs = null;
    },
    countdown: () => (phaseNow === 'countdown' ? Math.max(1, Math.ceil(remaining - 1e-9)) : null),
    step(controls) {
      if (phaseNow !== 'racing' || runner === null || state === null || setup === null) return;
      state = runner.step(state, controls);
      if (raceDone(state)) {
        phaseNow = 'finished';
        finished = raceResult(setup, state);
        notify();
      }
    },
    restart() {
      if (setup === null || runner === null) return false;
      if (phaseNow === 'setup') return false;
      startCountdown();
      notify();
      return true;
    },
    back() {
      dropRace();
      notify();
    },
    view: () => (setup !== null && state !== null ? { setup, state } : null),
    result: () => finished,
    elapsedSeconds: () => (setup !== null && state !== null ? state.tick * setup.context.environment.timestepSeconds : 0),
    refresh,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return controller;
}
