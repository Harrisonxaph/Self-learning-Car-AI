// Command line for the headless throughput benchmark (P4-06 step 4, the P2-11 budget's headless figure). Headless; nothing is deployed or served.
//
//   npm run bench -- [--circuit <id>]... [--generations <n>] [--warmup <n>] [--population <n>] [--seed <n>] [--out <file.json>]
//   npm run bench -- --car-ticks <n> [--warmup-car-ticks <n>] [--circuit <id>]... [--population <n>] [--seed <n>] [--out <file.json>]
//
// With --car-ticks the work is the fixed-work job the in-page benchmark (`?mode=bench`) runs on the owner's phone: that many car-ticks after an untimed warm-up
// (default 5,000), timed in slices, so a desktop figure and a phone figure are for exactly the same simulated work. Without it, the work is whole generations.
//
// It runs the real trainer on each named training circuit (default: stadium-oval, for comparison, and silverstone) with a seeded population and prints how fast
// the simulation ran, with the machine it ran on. This file only handles the outside world (arguments, the clock, the machine, git and the output file); the
// measurement is src/training/benchmark.ts, loaded through Vite so the command line and the tests run the same TypeScript.
//
// The figures describe THIS machine under THIS Node. Desktop figures are for comparison only and never replace the owner's reference phone (the P2-11 budget
// names the phone). Not a result about learning: the work is a seeded training run, and no model is saved or judged.
//
// Exit codes: 0 done, 2 invalid arguments, with nothing run.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { cpus, platform, arch, release } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const USAGE =
  'Usage:\n  npm run bench -- [--circuit <id>]... [--generations <n>] [--warmup <n>] [--population <n>] [--seed <n>] [--out <file.json>]\n  npm run bench -- --car-ticks <n> [--warmup-car-ticks <n>] [--circuit <id>]... [--population <n>] [--seed <n>] [--out <file.json>]';

class UsageError extends Error {}

function wholeArg(name, value, low, high) {
  if (value === undefined || !/^\d+$/.test(value)) throw new UsageError(`${name} needs a whole number.`);
  const n = Number(value);
  if (n < low || n > high) throw new UsageError(`${name} must be from ${low} to ${high}.`);
  return n;
}

function parseArgs(argv) {
  const options = { circuits: [], generations: 5, warmup: 1, population: 50, seed: 1, out: null, carTicks: null, warmupCarTicks: 5000 };
  const seen = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === '--circuit') {
      if (value === undefined || value.startsWith('--')) throw new UsageError('--circuit needs a circuit id.');
      if (!options.circuits.includes(value)) options.circuits.push(value);
      i += 1;
      continue;
    }
    if (!['--generations', '--warmup', '--population', '--seed', '--out', '--car-ticks', '--warmup-car-ticks'].includes(arg ?? '')) throw new UsageError(`Unknown argument ${arg}.`);
    if (seen.has(arg)) throw new UsageError(`${arg} is given more than once.`);
    seen.add(arg);
    if (arg === '--generations') options.generations = wholeArg(arg, value, 1, 1000);
    if (arg === '--warmup') options.warmup = wholeArg(arg, value, 0, 100);
    if (arg === '--population') options.population = wholeArg(arg, value, 2, 1000);
    if (arg === '--seed') options.seed = wholeArg(arg, value, 0, 2 ** 31 - 1);
    if (arg === '--car-ticks') options.carTicks = wholeArg(arg, value, 1, 10_000_000);
    if (arg === '--warmup-car-ticks') options.warmupCarTicks = wholeArg(arg, value, 0, 10_000_000);
    if (arg === '--out') {
      if (value === undefined || value.startsWith('--')) throw new UsageError('--out needs a file name.');
      options.out = value;
    }
    i += 1;
  }
  if (options.circuits.length === 0) options.circuits = ['stadium-oval', 'silverstone'];
  if (options.carTicks === null && seen.has('--warmup-car-ticks')) throw new UsageError('--warmup-car-ticks needs --car-ticks.');
  if (options.carTicks !== null && (seen.has('--generations') || seen.has('--warmup'))) throw new UsageError('--car-ticks replaces --generations and --warmup; give one kind of work.');
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

const fixed = (value, digits) => (value === null ? 'n/a' : value.toFixed(digits));

/** The fixed-work variant: the same job and the same definitions as the in-page benchmark. */
function runCarTicks(options, bench, training, circuit, sim, where, clock) {
  const results = [];
  for (const id of options.circuits) {
    const entry = training.find((t) => t.id === id);
    const config = { ...circuit.trainingConfigFor(entry.limits), seed: options.seed, populationSize: options.population };
    const environment = { track: entry.track, physics: sim.DEFAULT_VEHICLE_PHYSICS, timestepSeconds: sim.DEFAULT_SIM_CONFIG.timestepSeconds };
    results.push(bench.runCarTickBenchmark({ environment, config, warmupCarTicks: options.warmupCarTicks, measureCarTicks: options.carTicks, clock }));
  }
  console.log(`Fixed-work headless benchmark (the in-page ?mode=bench job): ${options.carTicks} car-ticks timed after ${options.warmupCarTicks} warm-up, population ${options.population}, seed ${options.seed}.`);
  console.log(`Machine: ${where.cpu} (${where.logicalCores} logical cores), ${where.platform}, Node ${where.node}, commit ${where.commit ?? 'unknown'}${where.dirty ? ' (uncommitted changes)' : ''}.`);
  console.log('');
  console.log('| circuit | boundary segments | mean running cars | car-ticks measured | compute (s) | car-ticks/s | ticks/s at the full population | budget |');
  console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |');
  for (const r of results) {
    const full = r.ticksPerSecondFullPopulation;
    const verdict = full === null ? 'n/a' : full >= bench.HEADLESS_BUDGET_TICKS_PER_SECOND ? `at least ${bench.HEADLESS_BUDGET_TICKS_PER_SECOND} (this machine only)` : `below ${bench.HEADLESS_BUDGET_TICKS_PER_SECOND} (this machine only)`;
    console.log(`| ${r.trackId} | ${r.boundarySegments} | ${fixed(r.meanRunningCars, 1)} | ${r.carTicks} | ${fixed(r.computeMs / 1000, 2)} | ${fixed(r.carTicksPerSecond, 0)} | ${fixed(full, 1)} | ${verdict} |`);
  }
  console.log('');
  console.log('The car-tick counts must equal the in-page benchmark\'s for the same circuit, population and seed; only the timing differs. This machine is not the owner\'s reference phone and the figures say nothing about learning.');
  if (options.out !== null) {
    writeFileSync(resolve(options.out), `${JSON.stringify({ format: 'self-driving-ai-evolution/headless-benchmark', version: 2, machine: where, options: { carTicks: options.carTicks, warmupCarTicks: options.warmupCarTicks, population: options.population, seed: options.seed }, results }, null, 2)}\n`);
    console.log(`Wrote ${resolve(options.out)}.`);
  }
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
  const { module: bench } = await runnerImport(join(ROOT, 'src/training/benchmark.ts'));
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
  const clock = () => Number(process.hrtime.bigint()) / 1e6;
  if (options.carTicks !== null) {
    runCarTicks(options, bench, training, circuit, sim, where, clock);
    return;
  }
  const results = [];
  for (const id of options.circuits) {
    const entry = training.find((t) => t.id === id);
    const config = { ...circuit.trainingConfigFor(entry.limits), seed: options.seed, populationSize: options.population };
    const environment = { track: entry.track, physics: sim.DEFAULT_VEHICLE_PHYSICS, timestepSeconds: sim.DEFAULT_SIM_CONFIG.timestepSeconds };
    results.push(bench.runBenchmark({ environment, config, warmupGenerations: options.warmup, generations: options.generations, clock }));
  }
  console.log(`Headless benchmark: ${options.generations} timed generations after ${options.warmup} warm-up, population ${options.population}, seed ${options.seed}.`);
  console.log(`Machine: ${where.cpu} (${where.logicalCores} logical cores), ${where.platform}, Node ${where.node}, commit ${where.commit ?? 'unknown'}${where.dirty ? ' (uncommitted changes)' : ''}.`);
  console.log('');
  console.log('| circuit | boundary segments | mean running cars | car-ticks | wall (s) | car-ticks/s | ticks/s at the full population | budget |');
  console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |');
  for (const r of results) {
    const full = r.ticksPerSecondFullPopulation;
    const verdict = full === null ? 'n/a' : full >= bench.HEADLESS_BUDGET_TICKS_PER_SECOND ? `at least ${bench.HEADLESS_BUDGET_TICKS_PER_SECOND} (desktop only)` : `below ${bench.HEADLESS_BUDGET_TICKS_PER_SECOND} (desktop only)`;
    console.log(`| ${r.trackId} | ${r.boundarySegments} | ${fixed(r.meanRunningCars, 1)} | ${r.carTicks} | ${fixed(r.wallMs / 1000, 2)} | ${fixed(r.carTicksPerSecond, 0)} | ${fixed(full, 1)} | ${verdict} |`);
  }
  console.log('');
  console.log(`"ticks/s at the full population" is car-ticks/s divided by ${options.population}: the rate if every car stayed running (conservative, see src/training/benchmark.ts). Compare it with the P2-11 headless budget of ${bench.HEADLESS_BUDGET_TICKS_PER_SECOND} ticks/s.`);
  console.log('These are figures for this machine only. They are not the owner\'s reference phone and not a result about learning.');
  if (options.out !== null) {
    writeFileSync(resolve(options.out), `${JSON.stringify({ format: 'self-driving-ai-evolution/headless-benchmark', version: 1, machine: where, options: { generations: options.generations, warmup: options.warmup, population: options.population, seed: options.seed }, results }, null, 2)}\n`);
    console.log(`Wrote ${resolve(options.out)}.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
