// The text of the champion replay panel (P3-04): what the network was asked and chose on the tick being shown, and how
// the replay ended. It only formats; it never drives the replay. Like the dashboard, it changes a text node only when its
// text changes. The decision shown is the one taken in the DECISION state (the pose drawn), see training/championReplay.ts.
import type { ReplayFrame } from '../training/championReplay';
import type { EpisodeState } from '../training/episodeStep';
import { lapSeconds } from '../sim/checkpoints';
import type { TextTarget } from './trainingDashboard';

export const REPLAY_NO_VALUE = '—';

export interface ReplayOutputs {
  /** One output per network input, in input order (ai/inputs.ts INPUT_NAMES). */
  readonly inputs: readonly TextTarget[];
  readonly steering: TextTarget;
  readonly throttle: TextTarget;
  readonly brake: TextTarget;
  /** Which decision is shown and when it was taken. */
  readonly decision: TextTarget;
  /** How the replay ended, or that it is running. */
  readonly result: TextTarget;
  /** One polite sentence, written once when the replay ends and cleared when a new one starts. */
  readonly status: TextTarget;
}

export interface ReplayText {
  readonly inputs: readonly string[];
  readonly steering: string;
  readonly throttle: string;
  readonly brake: string;
  readonly decision: string;
  readonly result: string;
  readonly status: string;
}

const seconds = (ticks: number, dt: number) => `${(ticks * dt).toFixed(2)} s`;
const value = (x: number) => x.toFixed(3);

/** How a finished episode ended, in words: its outcome, time, gates and any completed laps. */
export function resultText(state: EpisodeState, ticks: number, dt: number): string {
  const { outcome } = state.episode;
  if (outcome === null) return 'Running';
  const { gatesPassed, lapTicks } = state.racer.progress;
  const laps = lapTicks.length === 0 ? 'no laps' : lapTicks.map((t, i) => `lap ${i + 1} ${lapSeconds(t, dt).toFixed(2)} s`).join(', ');
  return `${outcome} after ${seconds(ticks, dt)} · ${gatesPassed} gates · ${laps}`;
}

/**
 * The panel's text. `frame` is the latest decision (null before the first tick) and `state` the latest state, which is the
 * result state once the replay has ended. After the end the last decision stays on show, labelled with its tick.
 */
export function replayText(frame: ReplayFrame | null, state: EpisodeState, ticks: number, dt: number, label: string, inputCount: number): ReplayText {
  const finished = state.episode.outcome !== null;
  const result = resultText(state, ticks, dt);
  return {
    inputs: frame ? frame.decision.inputs.map(value) : Array.from({ length: inputCount }, () => REPLAY_NO_VALUE),
    steering: frame ? value(frame.decision.controls.steering) : REPLAY_NO_VALUE,
    throttle: frame ? value(frame.decision.controls.throttle) : REPLAY_NO_VALUE,
    brake: frame ? value(frame.decision.controls.brake) : REPLAY_NO_VALUE,
    decision: frame ? `Decision ${frame.tick} at ${seconds(frame.tick - 1, dt)}${finished ? ' (the last)' : ''}` : 'No decision yet',
    result,
    status: finished ? `Replay of ${label} finished: ${result}.` : '',
  };
}

/** The text before any replay, and after one is closed: no values, no result, no status. */
export function emptyReplayText(inputCount: number): ReplayText {
  return {
    inputs: Array.from({ length: inputCount }, () => REPLAY_NO_VALUE),
    steering: REPLAY_NO_VALUE,
    throttle: REPLAY_NO_VALUE,
    brake: REPLAY_NO_VALUE,
    decision: 'No decision yet',
    result: '',
    status: '',
  };
}

/** Writes the text, touching only the outputs whose text changed. */
export function renderReplay(outputs: ReplayOutputs, text: ReplayText): void {
  const set = (target: TextTarget, next: string) => {
    if (target.textContent !== next) target.textContent = next;
  };
  outputs.inputs.forEach((target, i) => set(target, text.inputs[i] ?? REPLAY_NO_VALUE));
  set(outputs.steering, text.steering);
  set(outputs.throttle, text.throttle);
  set(outputs.brake, text.brake);
  set(outputs.decision, text.decision);
  set(outputs.result, text.result);
  set(outputs.status, text.status);
}
