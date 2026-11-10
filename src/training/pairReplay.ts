// Two champions replayed together (P3-08), headless. Each car runs through its own `ChampionReplay` (the same code as one
// champion alone), stepped in lockstep. Cars are independent (rays and collision read the track only, never another car),
// so each car's path equals its solo replay tick for tick (tested). The caller is responsible for giving both the same
// conditions (`persistence/modelCompare` decides that); this module only steps them.
//
// A car whose network cannot be computed (a number too large) stops with `failed: true`; the other car carries on, and the
// pair is done when both have ended or failed. Nothing here draws random numbers or touches a trainer.
import type { EpisodeOutcome } from './fitness';
import { createChampionReplay, type ChampionReplay, type ReplayFrame } from './championReplay';
import type { TrainingSetup } from './trainer';

export type CarLabel = 'A' | 'B';

/** Where one car of the pair stands. `outcome` is null while it is still running. */
export interface CarResult {
  readonly label: CarLabel;
  readonly outcome: EpisodeOutcome | null;
  readonly failed: boolean;
  readonly ticks: number;
  readonly gatesPassed: number;
  readonly laps: number;
}

export interface PairStep {
  readonly a: ReplayFrame | null;
  readonly b: ReplayFrame | null;
  /** Cars that stopped on this step because their network could not be computed. */
  readonly failed: readonly CarLabel[];
}

export interface PairReplay {
  readonly a: ChampionReplay;
  readonly b: ChampionReplay;
  /** Runs one tick of every car still running. Returns null once both have ended or failed. */
  step(): PairStep | null;
  done(): boolean;
  results(): readonly [CarResult, CarResult];
}

export function createPairReplay(genomeA: Float64Array, setupA: TrainingSetup, genomeB: Float64Array, setupB: TrainingSetup): PairReplay {
  const a = createChampionReplay(genomeA, setupA);
  const b = createChampionReplay(genomeB, setupB);
  const failed = { A: false, B: false };
  const running = (label: CarLabel, replay: ChampionReplay) => !failed[label] && !replay.done();
  const result = (label: CarLabel, replay: ChampionReplay): CarResult => {
    const { episode } = replay.state();
    return { label, outcome: episode.outcome, failed: failed[label], ticks: replay.ticks(), gatesPassed: episode.gatesPassed, laps: episode.lapTicks.length };
  };
  const stepOne = (label: CarLabel, replay: ChampionReplay, stopped: CarLabel[]): ReplayFrame | null => {
    if (!running(label, replay)) return null;
    try {
      return replay.step();
    } catch {
      failed[label] = true;
      stopped.push(label);
      return null;
    }
  };
  return {
    a,
    b,
    step() {
      if (!running('A', a) && !running('B', b)) return null;
      const stopped: CarLabel[] = [];
      const frameA = stepOne('A', a, stopped);
      const frameB = stepOne('B', b, stopped);
      return { a: frameA, b: frameB, failed: stopped };
    },
    done: () => !running('A', a) && !running('B', b),
    results: () => [result('A', a), result('B', b)],
  };
}
