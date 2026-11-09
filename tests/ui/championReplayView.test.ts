import { describe, expect, it } from 'vitest';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { INPUT_COUNT } from '../../src/ai/inputs';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { loadTrack } from '../../src/sim/track';
import { createChampionReplay } from '../../src/training/championReplay';
import { createTrainer, DEFAULT_TRAINING_CONFIG } from '../../src/training/trainer';
import { emptyReplayText, renderReplay, replayText, resultText, type ReplayOutputs } from '../../src/ui/championReplayView';

const DT = DEFAULT_SIM_CONFIG.timestepSeconds;
const trainer = createTrainer({ ...DEFAULT_TRAINING_CONFIG, populationSize: 8, eliteCount: 2 }, { track: loadTrack(stadiumOval), physics: DEFAULT_VEHICLE_PHYSICS, timestepSeconds: DT });
const champion = trainer.runGeneration().champion;

function outputs() {
  const counter = { writes: 0 };
  const target = () => {
    let text: string | null = '';
    return {
      get textContent() {
        return text;
      },
      set textContent(value: string | null) {
        text = value;
        counter.writes += 1;
      },
    };
  };
  const o: ReplayOutputs = { inputs: Array.from({ length: INPUT_COUNT }, target), steering: target(), throttle: target(), brake: target(), decision: target(), result: target(), status: target() };
  return { o, counter };
}

describe('replayText', () => {
  it('has no values before the first tick', () => {
    const replay = createChampionReplay(champion, trainer.setup);
    const text = replayText(null, replay.state(), 0, DT, 'generation 1', INPUT_COUNT);
    expect(text).toEqual({ ...emptyReplayText(INPUT_COUNT), result: 'Running' });
    expect(text.inputs).toHaveLength(INPUT_COUNT);
  });

  it('shows the decision of the frame to three decimals, labelled with its tick and the time it was taken', () => {
    const replay = createChampionReplay(champion, trainer.setup);
    for (let i = 0; i < 10; i += 1) replay.step();
    const frame = replay.step()!;
    const text = replayText(frame, replay.state(), replay.ticks(), DT, 'generation 3', INPUT_COUNT);
    expect(text.inputs).toEqual(frame.decision.inputs.map((v) => v.toFixed(3)));
    expect(text.steering).toBe(frame.decision.controls.steering.toFixed(3));
    expect(text.decision).toBe(`Decision 11 at ${(10 * DT).toFixed(2)} s`);
    expect(text.status).toBe('');
    expect(text.result).toBe('Running');
  });

  it('says how it ended once, and marks the last decision', () => {
    const replay = createChampionReplay(champion, trainer.setup);
    let last = replay.step()!;
    for (let f = replay.step(); f; f = replay.step()) last = f;
    const text = replayText(last, replay.state(), replay.ticks(), DT, 'generation 2', INPUT_COUNT);
    expect(text.decision).toContain('(the last)');
    expect(text.result).toBe(resultText(replay.state(), replay.ticks(), DT));
    expect(text.result).toMatch(/^(completed|crashed|stalled|timeout) after \d+\.\d{2} s · \d+ gates · /);
    expect(text.status).toBe(`Replay of generation 2 finished: ${text.result}.`);
  });
});

describe('renderReplay', () => {
  it('writes only the outputs whose text changed', () => {
    const { o, counter } = outputs();
    const replay = createChampionReplay(champion, trainer.setup);
    const text = replayText(replay.step(), replay.state(), replay.ticks(), DT, 'generation 1', INPUT_COUNT);
    renderReplay(o, text);
    const first = counter.writes;
    renderReplay(o, text);
    expect(counter.writes).toBe(first);
    renderReplay(o, emptyReplayText(INPUT_COUNT));
    expect(counter.writes).toBeGreaterThan(first);
  });
});
