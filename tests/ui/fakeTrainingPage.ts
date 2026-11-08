// Fake DOM objects with just enough behaviour for `startTrainingPage` to run in Node: the canvas and status line, the
// dashboard and graph elements, and the speed controls, whose click and change handlers the tests can fire.
import { INPUT_COUNT } from '../../src/ai/inputs';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import type { ViewportEnvironment } from '../../src/render/viewport';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { loadTrack } from '../../src/sim/track';
import type { TrainingPage } from '../../src/ui/trainingPage';
import type { SpeedMode } from '../../src/ui/trainingSpeed';
import { recordingContext } from '../render/recordingContext';
import { fakeDashboard } from './dashboardFakes';
import type { FakeFrames } from './fakeFrames';

/** A button or select: it keeps its listeners, text, value and attributes, and can be clicked or changed by a test. */
export class FakeControl {
  textContent = '';
  value = '';
  hidden = false;
  readonly attributes: Record<string, string> = {};
  private readonly listeners = new Map<string, (() => void)[]>();
  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }
  getAttribute(name: string) {
    return this.attributes[name] ?? null;
  }
  disabled = false;
  fire(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
  click() {
    this.fire('click');
  }
  choose(value: string) {
    this.value = value;
    this.fire('change');
  }
}

/** A `<details>`: toggling it sets `open` and fires the page's `toggle` listeners, as the browser does. */
export class FakeDetails {
  open = false;
  hidden = true;
  private readonly listeners: (() => void)[] = [];
  addEventListener(_type: string, listener: () => void) {
    this.listeners.push(listener);
  }
  closest() {
    return null;
  }
  /** Opens or closes it as a person would, and fires the toggle listeners. */
  toggle(open: boolean) {
    this.open = open;
    for (const listener of this.listeners) listener();
  }
}

export interface FakePageOptions {
  readonly clock?: { ms: number };
  /** A clock read by the page's time budget; takes precedence over `clock`. */
  readonly now?: () => number;
  readonly isPhone?: boolean;
  /** Gives the page a track layer, so each frame draws (through `drawCars`) instead of returning early. */
  readonly drawing?: boolean;
  /** Gives the page the opt-in frame-rate readout element. */
  readonly fps?: boolean | undefined;
}

/** Just enough of the page's DOM objects for `startTrainingPage` to run in Node. */
export function fakePage(frames: FakeFrames, options: FakePageOptions | { ms: number } = {}) {
  // Older callers passed the clock object itself.
  const opts: FakePageOptions = 'ms' in options ? { clock: options } : options;
  const dashboard = fakeDashboard();
  const canvas = { width: 0, height: 0, dataset: {} as Record<string, string>, setAttribute() {} };
  const context = { setTransform() {}, clearRect() {} };
  const hidden = { hidden: false };
  const panel = { hidden: true };
  const status = { textContent: '' };
  const graph = {
    details: { open: false, hidden: true, addEventListener() {} },
    canvas: { width: 0, height: 0, setAttribute() {} },
    context: Object.assign(recordingContext().ctx, { setTransform() {}, clearRect() {} }),
    summary: { textContent: '' },
  };
  const controls = {
    group: new FakeControl(),
    pause: new FakeControl(),
    speeds: { normal: new FakeControl(), fast: new FakeControl(), max: new FakeControl() } as Record<SpeedMode, FakeControl>,
    drawCap: new FakeControl(),
  };
  controls.group.hidden = true;
  const replay = {
    details: new FakeDetails(),
    generation: Object.assign(new FakeControl(), { value: '1' }),
    start: new FakeControl(),
    stop: new FakeControl(),
    note: { textContent: '' },
    outputs: {
      inputs: Array.from({ length: INPUT_COUNT }, () => ({ textContent: '—' as string | null })),
      steering: { textContent: '—' as string | null },
      throttle: { textContent: '—' as string | null },
      brake: { textContent: '—' as string | null },
      decision: { textContent: '' as string | null },
      result: { textContent: '' as string | null },
      status: { textContent: '' as string | null },
    },
  };
  const fps = opts.fps ? { hidden: true, textContent: '' } : undefined;
  const viewport: ViewportEnvironment = { measure: () => ({ width: 390, height: 600 }), devicePixelRatio: () => 1, subscribe: () => () => {} };
  const page = {
    canvas,
    context: opts.drawing ? { ...context, drawImage() {} } : context,
    status,
    hide: [hidden],
    dashboard: { panel, outputs: dashboard.outputs },
    controls,
    replay,
    fps,
    isPhone: opts.isPhone ?? false,
    // No track layer yet: the frame draws nothing, which leaves the per-frame paths under test.
    trackLayer: { get: () => (opts.drawing ? { canvas: {}, view: { scale: 1, offsetX: 0, offsetY: 0 } } : null) },
    track: loadTrack(stadiumOval),
    physics: DEFAULT_VEHICLE_PHYSICS,
    config: DEFAULT_SIM_CONFIG,
    graph,
    frames,
    viewportEnvironment: viewport,
    graphViewportEnvironment: viewport,
    now: opts.now ?? (opts.clock ? () => opts.clock!.ms : undefined),
  } as unknown as TrainingPage;
  return { page, canvas, dashboard, panel, hidden, graph, controls, replay, status, fps };
}
