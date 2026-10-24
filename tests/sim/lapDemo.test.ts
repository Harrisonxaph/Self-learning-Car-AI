// A reproducible demonstration of checkpoints and laps on the built-in track: a simple scripted driver follows
// the centre line at about 12 m/s for three laps, through the same physics, collision and progress code the
// simulation uses. Run `npm run demo:laps` to print each gate and lap; the checks below keep it honest in CI.
import { expect, it } from 'vitest';
import stadiumOval from '../../src/data/tracks/stadium-oval.json';
import { createProgress, lapSeconds, stepRacer, type Racer } from '../../src/sim/checkpoints';
import { createCar } from '../../src/sim/collision';
import { DEFAULT_SIM_CONFIG, DEFAULT_VEHICLE_PHYSICS } from '../../src/sim/config';
import { loadTrack } from '../../src/sim/track';
import { pursuit } from './ovalDriver';

const DT = DEFAULT_SIM_CONFIG.timestepSeconds;
const track = loadTrack(stadiumOval);

it('demonstrates ordered gates, lap counting and lap timing', () => {
  let racer: Racer = { car: createCar(track.start, track, DEFAULT_VEHICLE_PHYSICS), progress: createProgress() };
  const lines: string[] = [];
  while (racer.progress.lapTicks.length < 3 && racer.progress.tick < 60 * 200) {
    const before = racer.progress;
    racer = stepRacer(racer, pursuit(racer.car, 12), track, DEFAULT_VEHICLE_PHYSICS, DT);
    const { progress } = racer;
    if (progress.gatesPassed === before.gatesPassed) continue;
    const gate = before.nextGate;
    const lap = progress.lapTicks.length > before.lapTicks.length ? progress.lapTicks[progress.lapTicks.length - 1]! : null;
    if (gate === 0 || lap !== null) {
      lines.push(
        `tick ${String(progress.tick).padStart(5)}  gate ${String(gate).padStart(2)}  ` +
          (lap === null ? 'lap timing starts' : `lap ${progress.lapTicks.length} done: ${lap} ticks = ${lapSeconds(lap, DT).toFixed(3)} s`),
      );
    }
  }
  console.log(`Lap demo on "${track.name}" (${track.gates.length} gates), scripted driver at ~12 m/s, dt = 1/60 s:\n${lines.join('\n')}`);

  expect(racer.car.crashed).toBe(false);
  expect(racer.progress.lapTicks).toHaveLength(3);
  expect(racer.progress.gatesPassed).toBe(1 + 3 * track.gates.length);
  for (const ticks of racer.progress.lapTicks) expect(lapSeconds(ticks, DT)).toBeGreaterThan(38);
});
