// The evaluate page's logic with no DOM (P4-05): which models can be run, which circuits are offered, running the chosen
// circuits one slice at a time, storing each finished circuit, cancelling, and the messages. The page (ui/evaluatePage.ts)
// only draws it. Only built-in TRAINING and VALIDATION circuits are ever offered: the circuit lists come from the caller
// and are filtered again here, so a held-out ID cannot be offered or ticked.
import { recogniseEvaluations, type EvaluationEntry } from '../persistence/evaluationEntry';
import type { ModelStore, StoreEntry } from '../persistence/modelStore';
import { describeEntry } from './savedChampionsView';
import { SLICE_TICKS, entryContext, startEvaluationJob, type CustomSource, type EvaluateOptions, type EvaluationJob } from './modelEvaluation';

export interface CircuitChoice {
  readonly id: string;
  readonly name: string;
}

export interface ModelChoice {
  readonly id: string;
  readonly label: string;
  readonly usable: boolean;
  /** Why it cannot be run (when `usable` is false). */
  readonly reason: string | null;
  /** The circuit it was trained on. */
  readonly trainedOn: string | null;
}

export interface CircuitOption extends CircuitChoice {
  readonly split: 'training' | 'validation' | 'custom';
  readonly checked: boolean;
  /** The circuit the selected model was trained on: marked, and ticking it is allowed. */
  readonly trainedOn: boolean;
}

export interface EvaluateDeps {
  readonly store: ModelStore;
  readonly trainingCircuits: readonly CircuitChoice[];
  readonly validationCircuits: readonly CircuitChoice[];
  /** The saved custom track an ID names, read and checked again on every call (P4-03). Absent, no custom track can be evaluated. */
  readonly customTracks?: CustomSource | undefined;
  /** The saved custom tracks to offer now (their IDs and names), read again whenever the page refreshes. */
  readonly savedTracks?: (() => readonly CircuitChoice[]) | undefined;
  readonly now: () => string;
  readonly appVersion: string;
  readonly codeVersion: string;
  /** Runs `callback` after the page has had a chance to draw; returns a function that cancels it. */
  readonly defer: (callback: () => void) => () => void;
  /** For tests: starts a job (default: the real one), so slices and refusals can be observed. */
  readonly startJob?: typeof startEvaluationJob;
  /** Simulation ticks of work per slice (default SLICE_TICKS): small enough for the page to paint and take a Cancel between slices. */
  readonly sliceTicks?: number;
}

export interface EvaluateController {
  models(): readonly ModelChoice[];
  selected(): string | null;
  select(id: string | null): void;
  circuits(): readonly CircuitOption[];
  toggle(circuitId: string): void;
  canRun(): boolean;
  state(): 'idle' | 'running';
  run(): void;
  cancel(): void;
  /** The line shown while and after running. */
  progress(): string;
  /** A refusal or storage message, or ''. */
  message(): string;
  /** The recognised entries of the selected model, newest first. */
  results(): readonly EvaluationEntry[];
  /** Entries on the selected model that this app does not show (other kinds, or invalid claims). */
  hiddenEntries(): number;
  /** Whether a custom entry's track is still saved (a result for a deleted track is labelled "no longer saved"). */
  trackSaved(id: string): boolean;
  refresh(): void;
  subscribe(listener: () => void): () => void;
}

export function createEvaluateController(deps: EvaluateDeps): EvaluateController {
  const { store } = deps;
  const startJob = deps.startJob ?? startEvaluationJob;
  const sliceTicks = deps.sliceTicks ?? SLICE_TICKS;
  // The only circuits this page can ever offer: the caller's built-in training and validation lists, each ID once, then the saved
  // custom tracks (never an ID a built-in circuit uses, so a saved track cannot stand in for a built-in or held-out circuit).
  const builtIn: { id: string; name: string; split: 'training' | 'validation' }[] = [];
  const builtInIds = new Set<string>();
  for (const [list, split] of [[deps.trainingCircuits, 'training'], [deps.validationCircuits, 'validation']] as const) {
    for (const c of list) {
      if (builtInIds.has(c.id)) continue;
      builtInIds.add(c.id);
      builtIn.push({ id: c.id, name: c.name, split });
    }
  }
  let savedNow: { id: string; name: string; split: 'custom' }[] = [];
  const readSaved = (): void => {
    const seenSaved = new Set<string>();
    savedNow = [];
    try {
      for (const c of deps.savedTracks?.() ?? []) {
        if (builtInIds.has(c.id) || seenSaved.has(c.id)) continue;
        seenSaved.add(c.id);
        savedNow.push({ id: c.id, name: c.name, split: 'custom' });
      }
    } catch {
      savedNow = [];
    }
    for (const id of [...ticked]) if (!builtInIds.has(id) && !seenSaved.has(id)) ticked.delete(id);
  };
  const offered = (): readonly { id: string; name: string; split: 'training' | 'validation' | 'custom' }[] => [...builtIn, ...savedNow];
  const contextFor = (model: Parameters<typeof entryContext>[0]) => entryContext(model, deps.customTracks);
  const ticked = new Set<string>();
  readSaved();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());
  let modelList: ModelChoice[] = [];
  let selectedId: string | null = null;
  let stateNow: 'idle' | 'running' = 'idle';
  let progressText = '';
  let messageText = '';
  let cancelDefer: (() => void) | null = null;
  let cancelRequested = false;
  let storageMessage = '';

  const choiceOf = (entry: StoreEntry): ModelChoice => {
    if (entry.status === 'damaged') return { id: entry.id, label: describeEntry(entry), usable: false, reason: entry.problem, trainedOn: null };
    return {
      id: entry.id,
      label: describeEntry(entry),
      usable: entry.drivable,
      reason: entry.drivable ? null : `This app cannot run this champion. ${entry.warnings.join(' ')}`.trim(),
      trainedOn: entry.summary.circuit,
    };
  };

  const refresh = (): void => {
    readSaved();
    const listing = store.list();
    if (!listing.available) {
      modelList = [];
      storageMessage = listing.message;
    } else {
      modelList = listing.entries.map(choiceOf);
      storageMessage = listing.partial ? 'Some saved champions may not be shown, because browser storage could not be fully read.' : '';
    }
    if (selectedId !== null && !modelList.some((m) => m.id === selectedId)) selectedId = null;
    notify();
  };

  const current = (): ModelChoice | undefined => modelList.find((m) => m.id === selectedId);

  const results = (): readonly EvaluationEntry[] => {
    if (selectedId === null) return [];
    const inspected = store.inspect(selectedId);
    if (!inspected.ok) return [];
    return [...recogniseEvaluations(inspected.model.evaluation, contextFor(inspected.model)).entries].reverse();
  };

  const finish = (text: string): void => {
    stateNow = 'idle';
    cancelDefer = null;
    cancelRequested = false;
    progressText = text;
    notify();
  };

  const runNext = (modelId: string, queue: readonly string[], index: number, stored: number): void => {
    if (cancelRequested) {
      finish(`Cancelled. ${stored} of ${queue.length} circuit${queue.length === 1 ? '' : 's'} finished and stored; the circuit in progress was discarded and nothing partial was kept.`);
      return;
    }
    if (index >= queue.length) {
      finish(`Done: ${stored} circuit${stored === 1 ? '' : 's'} evaluated and stored.`);
      return;
    }
    const id = queue[index]!;
    const name = offered().find((c) => c.id === id)?.name ?? id;
    const stop = (why: string): void => {
      messageText = why;
      finish(`Stopped after ${stored} of ${queue.length}: ${why}`);
    };
    progressText = `Evaluating ${name} (${index + 1} of ${queue.length})…`;
    notify();
    let job: EvaluationJob | null = null;
    const slice = (): void => {
      cancelDefer = null;
      if (cancelRequested) return runNext(modelId, queue, index, stored);
      if (job === null) {
        const loaded = store.load(modelId);
        if (!loaded.ok) return stop(loaded.message);
        const options: EvaluateOptions = { recordedAt: deps.now(), appVersion: deps.appVersion, codeVersion: deps.codeVersion, customTracks: deps.customTracks };
        const started = startJob(loaded.model, id, options);
        if (!started.ok) return stop(started.message);
        job = started.job;
      }
      job.step(sliceTicks);
      if (!job.done()) {
        const p = job.progress();
        progressText = `Evaluating ${name} (${index + 1} of ${queue.length}): episode ${p.episode} of ${p.episodes}, tick ${p.tick}…`;
        notify();
        cancelDefer = deps.defer(slice);
        return;
      }
      const result = job.result();
      if (!result.ok) return stop(result.message);
      const appended = store.appendEvaluation(modelId, result.entry);
      if (!appended.ok) return stop(appended.message);
      runNext(modelId, queue, index + 1, stored + 1);
    };
    cancelDefer = deps.defer(slice);
  };

  return {
    models: () => modelList,
    selected: () => selectedId,
    select(id) {
      if (stateNow === 'running') return;
      selectedId = id !== null && modelList.some((m) => m.id === id) ? id : null;
      messageText = '';
      progressText = '';
      notify();
    },
    circuits() {
      const own = current()?.trainedOn ?? null;
      return offered().map((c) => ({ ...c, checked: ticked.has(c.id), trainedOn: c.id === own }));
    },
    toggle(circuitId) {
      if (stateNow === 'running' || !offered().some((c) => c.id === circuitId)) return;
      if (ticked.has(circuitId)) ticked.delete(circuitId);
      else ticked.add(circuitId);
      notify();
    },
    canRun() {
      const m = current();
      return stateNow === 'idle' && m !== undefined && m.usable && offered().some((c) => ticked.has(c.id));
    },
    state: () => stateNow,
    run() {
      const m = current();
      if (stateNow !== 'idle') return;
      if (m === undefined) {
        messageText = 'Choose a saved champion first.';
        return notify();
      }
      if (!m.usable) {
        messageText = m.reason ?? 'This champion cannot be run.';
        return notify();
      }
      const queue = offered().filter((c) => ticked.has(c.id)).map((c) => c.id);
      if (queue.length === 0) {
        messageText = 'Tick at least one circuit.';
        return notify();
      }
      messageText = '';
      cancelRequested = false;
      stateNow = 'running';
      runNext(m.id, queue, 0, 0);
    },
    cancel() {
      if (stateNow !== 'running') return;
      cancelRequested = true;
      if (cancelDefer !== null) {
        // Nothing is in flight: stop now, and the circuits already finished stay stored.
        cancelDefer();
        cancelDefer = null;
        finish('Cancelled. The circuits already finished stay stored; the circuit in progress was discarded and nothing partial was kept.');
      }
    },
    progress: () => progressText,
    message: () => (messageText !== '' ? messageText : storageMessage),
    results,
    hiddenEntries() {
      if (selectedId === null) return 0;
      const inspected = store.inspect(selectedId);
      if (!inspected.ok) return 0;
      const r = recogniseEvaluations(inspected.model.evaluation, contextFor(inspected.model));
      return inspected.model.evaluation.length - r.entries.length;
    },
    trackSaved: (id) => savedNow.some((c) => c.id === id),
    refresh,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
