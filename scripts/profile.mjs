// Command line for the P2-11 step 2 profile: where does the time go inside one car-tick? Headless; nothing is deployed or served.
//
//   npm run profile -- [--circuit <id>]... [--car-ticks <n>] [--warmup-car-ticks <n>] [--population <n>] [--seed <n>] [--no-inlining] [--out <file.json>]
//
// It runs the same fixed-work job as `npm run bench -- --car-ticks` and the in-page `?mode=bench` (default 60,000 measured car-ticks after 5,000 untimed
// warm-up, population 50, seed 1) under the V8 sampling profiler (node:inspector), started when the warm-up ends, and splits the sampled self time into the
// groups the P2-11 plan names (src/training/profileSummary.ts). It changes no simulation code and its figures are about THIS machine under THIS Node, never the
// owner's reference phone and never a result about learning. The sampler adds overhead, so use the shares, not the absolute times; npm run bench gives the
// rates. --no-inlining turns off the optimising compiler's inlining (v8 flag --no-turbo-inlining) so a small function's time is not credited to its caller.
//
// Exit codes: 0 done, 2 invalid arguments, with nothing run.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { cpus, platform, arch, release } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setFlagsFromString } from 'node:v8';
import { runnerImport } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'Usage:\n  npm run profile -- [--circuit <id>]... [--car-ticks <n>] [--warmup-car-ticks <n>] [--population <n>] [--seed <n>] [--no-inlining] [--out <file.json>]';
const SAMPLING_INTERVAL_US = 100;

class UsageError extends Error {}

function wholeArg(name, value, low, high) {
  if (value === undefined || !/^\d+$/.test(value)) throw new UsageError(`${name} needs a whole number.`);
  const n = Number(value);
  if (n < low || n > high) throw new UsageError(`${name} must be from ${low} to ${high}.`);
  return n;
}

function parseArgs(argv) {
  const options = { circuits: [], carTicks: 60000, warmupCarTicks: 5000, population: 50, seed: 1, noInlining: false, out: null };
  const seen = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === '--no-inlining') {
      options.noInlining = true;
      continue;
    }
    if (arg === '--circuit') {
      if (value === undefined || value.startsWith('--')) throw new UsageError('--circuit needs a circuit id.');
      if (!options.circuits.includes(value)) options.circuits.push(value);
      i += 1;
      continue;
    }
    if (!['--car-ticks', '--warmup-car-ticks', '--population', '--seed', '--out'].includes(arg ?? '')) throw new UsageError(`Unknown argument ${arg}.`);
    if (seen.has(arg)) throw new UsageError(`${arg} is given more than once.`);
    seen.add(arg);
    if (arg === '--car-ticks') options.carTicks = wholeArg(arg, value, 1, 10_000_000);
    if (arg === '--warmup-car-ticks') options.warmupCarTicks = wholeArg(arg, value, 0, 10_000_000);
    if (arg === '--population') options.population = wholeArg(arg, value, 3, 1000);
    if (arg === '--seed') options.seed = wholeArg(arg, value, 0, 2 ** 31 - 1);
    if (arg === '--out') {
      if (value === undefined || value.startsWith('--')) throw new UsageError('--out needs a file name.');
      options.out = value;
    }
    i += 1;
  }
  if (options.circuits.length === 0) options.circuits = ['stadium-oval', 'silverstone'];
  return options;
}

function git(...args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function machine() {
  const cpu = cpus();
  return {
    node: process.version,
    platform: `${platform()} ${release()} ${arch()}`,
    cpu: cpu[0]?.model ?? 'unknown',
    logicalCores: cpu.length,
    commit: git('rev-parse', 'HEAD'),
    dirty: (git('status', '--porcelain') ?? '') !== '',
  };
}

const pct = (share) => `${(share * 100).toFixed(1)}%`;

async function profileOne(session, entry, options, bench, circuit, sim, summarise) {
  const config = { ...circuit.trainingConfigFor(entry.limits), seed: options.seed, populationSize: options.population };
  const environment = { track: entry.track, physics: sim.DEFAULT_VEHICLE_PHYSICS, timestepSeconds: sim.DEFAULT_SIM_CONFIG.timestepSeconds };
  const clock = () => Number(process.hrtime.bigint()) / 1e6;
  const job = bench.createCarTickBenchmarkJob({ environment, config, warmupCarTicks: options.warmupCarTicks, measureCarTicks: options.carTicks, clock });
  // Warm-up runs unprofiled; a slice ends exactly where the warm-up does (the job returns at that boundary), so no measured work runs before the profiler starts.
  while (job.progress().phase === 'warm-up') job.advance(1);
  await session.post('Profiler.start');
  while (!job.advance(12)) {
    // Advanced until done.
  }
  const { profile } = await session.post('Profiler.stop');
  const result = job.result();
  return { trackId: entry.id, boundarySegments: result.boundarySegments, carTicks: result.carTicks, summary: summarise.summariseProfile(profile, 12) };
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`${error.message}\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  if (options.noInlining) setFlagsFromString('--no-turbo-inlining');
  const { module: bench } = await runnerImport(join(ROOT, 'src/training/benchmark.ts'));
  const { module: summarise } = await runnerImport(join(ROOT, 'src/training/profileSummary.ts'));
  const { module: splits } = await runnerImport(join(ROOT, 'src/training/trackSplits.ts'));
  const { module: circuit } = await runnerImport(join(ROOT, 'src/ui/trainingCircuit.ts'));
  const { module: sim } = await runnerImport(join(ROOT, 'src/sim/config.ts'));
  const training = splits.tracksIn('training');
  const unknown = options.circuits.filter((id) => !training.some((t) => t.id === id));
  if (unknown.length > 0) {
    console.error(`Not a training circuit: ${unknown.join(', ')}. Choose from: ${training.map((t) => t.id).join(', ')}.\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  const where = machine();
  if (where.dirty) console.warn('Note: the worktree has uncommitted changes; the output says so (machine.dirty).');
  const session = new Session();
  session.connect();
  await session.post('Profiler.enable');
  await session.post('Profiler.setSamplingInterval', { interval: SAMPLING_INTERVAL_US });
  const results = [];
  for (const id of options.circuits) results.push(await profileOne(session, training.find((t) => t.id === id), options, bench, circuit, sim, summarise));
  session.disconnect();

  console.log(`Profile of the fixed-work job: ${options.carTicks} car-ticks after ${options.warmupCarTicks} warm-up (warm-up not profiled), population ${options.population}, seed ${options.seed}, sampling every ${SAMPLING_INTERVAL_US} microseconds${options.noInlining ? ', inlining off' : ''}.`);
  console.log(`Machine: ${where.cpu} (${where.logicalCores} logical cores), ${where.platform}, Node ${where.node}, commit ${where.commit ?? 'unknown'}${where.dirty ? ' (uncommitted changes)' : ''}.`);
  for (const r of results) {
    console.log('');
    console.log(`### ${r.trackId} (${r.boundarySegments} boundary segments, ${r.carTicks} car-ticks, ${r.summary.samples} samples, ${(r.summary.totalMicroseconds / 1e6).toFixed(2)} s sampled)`);
    console.log('| group | self time | share |');
    console.log('| --- | ---: | ---: |');
    for (const g of r.summary.groups) console.log(`| ${g.group} | ${(g.microseconds / 1e6).toFixed(2)} s | ${pct(g.share)} |`);
    console.log('');
    console.log('| function | file | group | share |');
    console.log('| --- | --- | --- | ---: |');
    for (const f of r.summary.topFunctions) console.log(`| ${f.name} | ${f.file} | ${f.group} | ${pct(f.share)} |`);
  }
  console.log('');
  console.log('Self time per function; the sampler adds overhead, so read the shares, not the seconds. This machine is not the owner\'s reference phone and the figures say nothing about learning.');
  if (options.out !== null) {
    writeFileSync(resolve(options.out), `${JSON.stringify({ format: 'self-driving-ai-evolution/profile', version: 1, machine: where, options, results }, null, 2)}\n`);
    console.log(`Wrote ${resolve(options.out)}.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
