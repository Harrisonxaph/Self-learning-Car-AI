// Candidate counts and query times for the track index (P2-11 step 3), by cell-edge factor, on the built-in training and validation circuits and a synthetic
// track with the format's maximum 2,000 points per boundary. Headless; nothing is deployed or served.
//
//   npm run index:measure -- [--factors 1,2,4] [--queries 1500] [--out <file.md>]
//
// It times the QUERY FUNCTIONS only (seven-ray reading, one tick's sweep), the brute-force reference against the indexed version, for cars placed across the
// checkpoint gates (on the road). It is not the simulation: the end-to-end figure is `npm run bench -- --car-ticks 60000`. The figures
// describe THIS machine under THIS Node; they are never the owner's reference phone and say nothing about learning.
import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'Usage: npm run index:measure -- [--factors 1,2,4] [--queries 1500] [--out <file.md>]';
const args = process.argv.slice(2);
const options = { factors: [1, 2, 3, 4, 6, 8, 12], queries: 1500, out: null };
for (let i = 0; i < args.length; i += 2) {
  const [name, value] = [args[i], args[i + 1]];
  if (name === '--factors' && value && /^\d+(\.\d+)?(,\d+(\.\d+)?)*$/.test(value)) options.factors = value.split(',').map(Number);
  else if (name === '--queries' && value && /^\d+$/.test(value) && Number(value) >= 10 && Number(value) <= 100000) options.queries = Number(value);
  else if (name === '--out' && value && !value.startsWith('--')) options.out = value;
  else {
    console.error(`Unknown or invalid argument ${name ?? ''}.\n${USAGE}`);
    process.exit(2);
  }
}

const { module: ti } = await runnerImport(join(ROOT, 'src/sim/trackIndex.ts'));
const { module: rays } = await runnerImport(join(ROOT, 'src/sensors/rays.ts'));
const { module: col } = await runnerImport(join(ROOT, 'src/sim/collision.ts'));
const { module: cfg } = await runnerImport(join(ROOT, 'src/sim/config.ts'));
const { module: splits } = await runnerImport(join(ROOT, 'src/training/trackSplits.ts'));
const { module: rngModule } = await runnerImport(join(ROOT, 'src/utils/rng.ts'));
const PHYSICS = cfg.DEFAULT_VEHICLE_PHYSICS;

const wave = (t) => 300 + 60 * Math.sin(3 * t) + 25 * Math.sin(7 * t + 1);
const ring = (n, offset) => Array.from({ length: n }, (_, i) => { const t = (2 * Math.PI * i) / n; const r = wave(t) + offset; return { x: r * Math.cos(t), y: r * Math.sin(t) }; });
const synthOuter = ring(2000, 8);
const synthInner = ring(2000, -8);
const synthetic = { id: 'synthetic-2000', version: '1', name: 'synthetic', outer: synthOuter, inner: synthInner, start: { position: { x: 300, y: 0 }, heading: Math.PI / 2 }, gates: Array.from({ length: 40 }, (_, g) => ({ a: synthInner[g * 50], b: synthOuter[g * 50] })) };
const tracks = [...splits.tracksIn('training'), ...splits.tracksIn('validation')].map((t) => ({ id: t.id, track: t.track })).concat([{ id: synthetic.id, track: synthetic }]);
const clock = () => Number(process.hrtime.bigint()) / 1e6;

const lines = [
  `Machine: ${cpus()[0]?.model ?? 'unknown'} (${cpus().length} logical cores), Node ${process.version}. ${options.queries} cars across the checkpoint gates; times in microseconds per call (brute force / indexed).`,
  '',
  '| track | factor | cell edge (m) | cells | registrations | build (ms) | candidates per ray | per footprint | per road test | 7-ray reading | one tick\'s sweep |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |',
];
for (const { id, track } of tracks) {
  for (const factor of options.factors) {
    const started = clock();
    const index = ti.buildTrackIndex(track, factor);
    const buildMs = clock() - started;
    const stats = ti.trackIndexStats(index);
    const rng = rngModule.createRng(100);
    const poses = Array.from({ length: options.queries }, () => {
      const g = track.gates[rng.int(0, track.gates.length)];
      const u = rng.range(0.1, 0.9);
      const normal = Math.atan2(g.b.x - g.a.x, -(g.b.y - g.a.y));
      return { position: { x: g.a.x + (g.b.x - g.a.x) * u, y: g.a.y + (g.b.y - g.a.y) * u }, heading: normal + rng.range(-0.5, 0.5) };
    });
    let rayCount = 0;
    let rayTotal = 0;
    let boxTotal = 0;
    let pointTotal = 0;
    for (const pose of poses) {
      const origin = rays.sensorOrigin(pose, PHYSICS);
      for (const degrees of rays.DEFAULT_SENSOR_CONFIG.anglesDegrees) {
        rayTotal += ti.rayCandidateIds(index, origin, pose.heading + (degrees * Math.PI) / 180, rays.DEFAULT_SENSOR_CONFIG.maxDistance).length;
        rayCount += 1;
      }
      const f = col.vehicleFootprint(pose, PHYSICS);
      const xs = f.map((p) => p.x);
      const ys = f.map((p) => p.y);
      boxTotal += ti.boxCandidateIds(index, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)).length;
      pointTotal += ti.pointCandidateIds(index, f[0]).length;
    }
    const time = (fn) => {
      for (const p of poses) fn(p);
      const t0 = clock();
      for (let rep = 0; rep < 3; rep += 1) for (const p of poses) fn(p);
      return ((clock() - t0) / (3 * poses.length)) * 1000;
    };
    const stepOf = (p) => ({ position: { x: p.position.x + Math.cos(p.heading) * 0.3, y: p.position.y + Math.sin(p.heading) * 0.3 }, heading: p.heading + 0.01 });
    const readBrute = time((p) => rays.castRaysBruteForce(p, track, PHYSICS, rays.DEFAULT_SENSOR_CONFIG));
    const readFast = time((p) => rays.castRaysIndexed(p, index, PHYSICS, rays.DEFAULT_SENSOR_CONFIG));
    const sweepBrute = time((p) => col.sweepHitsTrackBruteForce(p, stepOf(p), track, PHYSICS));
    const sweepFast = time((p) => col.sweepHitsTrackIndexed(p, stepOf(p), index, PHYSICS));
    lines.push(`| ${id} | ${factor} | ${stats.cellEdge.toFixed(1)} | ${stats.cells} | ${stats.registrations} | ${buildMs.toFixed(1)} | ${(rayTotal / rayCount).toFixed(1)} | ${(boxTotal / poses.length).toFixed(1)} | ${(pointTotal / poses.length).toFixed(1)} | ${readBrute.toFixed(1)} / ${readFast.toFixed(1)} | ${sweepBrute.toFixed(1)} / ${sweepFast.toFixed(1)} |`);
  }
}
lines.push('', `The shipped factor is ${ti.CELL_EDGE_FACTOR}. These are query-function times on this machine, not the simulation and not the owner's phone.`);
console.log(lines.join('\n'));
if (options.out !== null) {
  writeFileSync(resolve(options.out), `${lines.join('\n')}\n`);
  console.log(`Wrote ${resolve(options.out)}.`);
}
