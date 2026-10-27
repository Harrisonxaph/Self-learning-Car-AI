// Command line for seeded training experiments (P2-07). Headless; nothing is deployed or served.
//
//   npm run experiment -- run <config.json> --out <record.json> [--force]
//   npm run experiment -- replay <record.json>
//
// `run` reads an experiment configuration, runs it and writes the complete record. `replay` re-runs a record in
// this engine and checks that every result is identical. This file only handles the outside world (arguments,
// files, git, the engine and the date); the experiment itself is src/training/experiment.ts, loaded through Vite
// so that the command line and the tests run the same TypeScript.
//
// Exit codes: 0 success (or an identical replay), 1 a replay that differs, 2 invalid, incompatible or unreadable
// input. Fitness printed here is a training signal on one track, not evidence of learning (docs/AI_EVALUATION.md).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'Usage:\n  npm run experiment -- run <config.json> --out <record.json> [--force]\n  npm run experiment -- replay <record.json>';

class UsageError extends Error {}

function parseArgs(argv) {
  const [command, file, ...rest] = argv;
  if (command !== 'run' && command !== 'replay') throw new UsageError(`Unknown command ${command ?? '(none)'}.`);
  if (!file) throw new UsageError(`"${command}" needs a file.`);
  const options = { command, file, out: null, force: false };
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '--out' && command === 'run' && rest[i + 1]) options.out = rest[(i += 1)];
    else if (rest[i] === '--force' && command === 'run') options.force = true;
    else throw new UsageError(`Unexpected argument ${rest[i]}.`);
  }
  if (command === 'run' && !options.out) throw new UsageError('"run" needs --out <record.json>.');
  return options;
}

function readJson(path, what) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new UsageError(`Cannot read the ${what} ${path}: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new UsageError(`The ${what} ${path} is not valid JSON: ${error.message}`);
  }
}

function engine() {
  return { name: 'node', version: process.version, v8: process.versions.v8 };
}

function source() {
  const appVersion = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version;
  try {
    const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const revision = git('rev-parse', 'HEAD');
    // Untracked files count: a new source file can change results as much as an edited one.
    const dirty = git('status', '--porcelain').length > 0;
    return { revision, dirty, unavailableReason: null, appVersion };
  } catch (error) {
    return { revision: null, dirty: null, unavailableReason: `git is unavailable: ${error.message.split('\n')[0]}`, appVersion };
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { module: experiment } = await runnerImport(resolve(ROOT, 'src/training/experiment.ts'));

  if (options.command === 'run') {
    const config = readJson(options.file, 'experiment config');
    const out = resolve(options.out);
    if (existsSync(out) && !options.force) throw new UsageError(`${out} already exists; pass --force to replace it.`);
    const context = { engine: engine(), source: source(), recordedAt: new Date().toISOString() };
    if (context.source.dirty) console.warn('Warning: the worktree has uncommitted or untracked changes; the record names the commit, not those changes.');
    const record = experiment.runExperiment(config, context);
    writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
    console.log(`Experiment ${record.experiment.id}: ${record.runs.length} run(s) of ${record.configuration.generations} generation(s) on ${record.tracks.training.id}.`);
    for (const run of record.runs) {
      const final = run.generations[run.generations.length - 1].stats;
      console.log(
        `  seed ${run.seed}: ${run.simulatedTicks} of at most ${record.budgets.maxSimulatedTicksPerRun} simulated car-ticks; ` +
          `final generation best training fitness ${final.bestFitness.toFixed(1)}; champion ${run.champion.id.slice(0, 19)}…`,
      );
    }
    console.log(`Recorded ${out} (results ${record.resultsHash.slice(0, 19)}…).`);
    console.log('Training-track fitness only: not evidence of learning, and no validation or held-out track was used.');
    return 0;
  }

  const record = readJson(options.file, 'experiment record');
  const result = experiment.replayExperiment(record, engine(), source());
  if (result.sameSourceRevision === false) console.warn(`Note: recorded at ${record.source.revision}, replayed at a different revision.`);
  if (result.identical) {
    console.log(`Replay identical: ${record.runs.length} run(s), every result and every frozen champion reproduced (${record.resultsHash.slice(0, 19)}…).`);
    return 0;
  }
  console.log('Replay differs from the record:');
  for (const difference of result.differences) console.log(`  ${difference}`);
  result.championsReplayed.forEach((ok, i) => {
    if (!ok) console.log(`  runs[${i}].champion: evaluated alone, the frozen champion did not reproduce its recorded episode.`);
  });
  return 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    const known = error instanceof UsageError || /^(Experiment\w*Error|TrackLeakageError|TrackSplitError)$/.test(error?.name ?? '');
    console.error(`${known ? '' : 'Unexpected error: '}${error?.message ?? error}`);
    if (error instanceof UsageError) console.error(USAGE);
    process.exitCode = 2;
  },
);
