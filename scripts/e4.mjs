// Command line for the P2-09 E4 study (docs/experiments/p2-09-plan.md §5 and §8 step 5). Headless; nothing is deployed
// or served. It mirrors scripts/study.mjs for the A4/A5 study kind.
//
//   npm run e4 -- run <manifest.json> --seed <s> --out <record.json> [--force]
//   npm run e4 -- replay <manifest.json> <record.json>
//   npm run e4 -- analyse <manifest.json> <record.json>… --out-dir <dir> [--force]
//
// `run` runs one seed of a manifest (A4 then A5) and writes its complete record. `replay` checks a record against its
// manifest, re-runs the seed in this engine and checks that every result is identical. `analyse` replays every record
// and writes analysis.json and report.md (src/training/e4Analysis.ts). This file only handles the outside world
// (arguments, files, git, the engine and the date); the study itself is src/training/e4Study.ts, loaded through Vite so
// that the command line and the tests run the same TypeScript.
//
// A confirmatory manifest runs only at its frozen commit, from a clean worktree. Writing the E4 manifest, approving it
// and running its seeds are separate, owner-gated steps; this tool only provides the means.
//
// Exit codes: 0 a written record or analysis (or an identical replay), 1 a replay that differs, 2 invalid,
// incompatible or unreadable input, with nothing written. A record is raw results only: not an analysis, and not
// evidence of learning.
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';
import { OutputDirectoryError, OutputExistsError, writeRecordFile, writeRecordPair } from './recordFile.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const USAGE =
  'Usage:\n  npm run e4 -- run <manifest.json> --seed <s> --out <record.json> [--force]\n  npm run e4 -- replay <manifest.json> <record.json>\n' +
  '  npm run e4 -- analyse <manifest.json> <record.json>... --out-dir <dir> [--force]';
const SEED = /^(0|[1-9][0-9]*)$/;

class UsageError extends Error {}
// A malformed command line: also prints the usage.
class ArgumentError extends UsageError {}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command !== 'run' && command !== 'replay' && command !== 'analyse') throw new ArgumentError(`Unknown command ${command ?? '(none)'}.`);
  const options = { command, files: [], seed: null, out: null, outDir: null, force: false };
  const once = (name, present) => {
    if (present) throw new ArgumentError(`${name} is given more than once.`);
  };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (command === 'run' && arg === '--seed') {
      once('--seed', options.seed !== null);
      const value = rest[(i += 1)];
      if (value === undefined || !SEED.test(value) || !Number.isSafeInteger(Number(value))) {
        throw new ArgumentError(`--seed needs a whole number written plainly, such as 7301, not ${value ?? '(nothing)'}.`);
      }
      options.seed = Number(value);
    } else if (command === 'run' && arg === '--out') {
      once('--out', options.out !== null);
      const value = rest[(i += 1)];
      if (value === undefined || value.startsWith('--')) throw new ArgumentError('--out needs a file.');
      options.out = value;
    } else if (command === 'analyse' && arg === '--out-dir') {
      once('--out-dir', options.outDir !== null);
      const value = rest[(i += 1)];
      if (value === undefined || value.startsWith('--')) throw new ArgumentError('--out-dir needs a folder.');
      options.outDir = value;
    } else if ((command === 'run' || command === 'analyse') && arg === '--force') {
      once('--force', options.force);
      options.force = true;
    } else if (arg.startsWith('--')) throw new ArgumentError(`Unexpected option ${arg}.`);
    else options.files.push(arg);
  }
  if (command === 'analyse') {
    if (options.files.length < 2) throw new ArgumentError('"analyse" needs a manifest file and at least one record file.');
    if (options.outDir === null) throw new ArgumentError('"analyse" needs --out-dir <dir>.');
    return options;
  }
  const wanted = command === 'run' ? 1 : 2;
  if (options.files.length !== wanted) {
    throw new ArgumentError(command === 'run' ? '"run" needs exactly one manifest file.' : '"replay" needs a manifest file and a record file.');
  }
  if (command === 'run' && options.seed === null) throw new ArgumentError('"run" needs --seed <s>.');
  if (command === 'run' && options.out === null) throw new ArgumentError('"run" needs --out <record.json>.');
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

// A confirmatory record must come from exactly the program its manifest was frozen at.
function checkFrozenRevision(manifest, src) {
  if (manifest.label === 'mechanics') return;
  const wanted = manifest.code.revision;
  if (src.revision === null) throw new UsageError(`A ${manifest.label} manifest runs only at its frozen commit ${wanted}, and ${src.unavailableReason}.`);
  if (src.revision !== wanted) throw new UsageError(`A ${manifest.label} manifest runs only at its frozen commit ${wanted}; this worktree is at ${src.revision}.`);
  if (src.dirty) throw new UsageError(`A ${manifest.label} manifest runs only from a clean worktree at ${wanted}; this one has uncommitted or untracked changes.`);
}

const realOrSelf = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

// The folder entry itself, not what a symbolic link points to: a dangling link is an existing entry. Returns null when
// there is no entry at all.
function entry(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function checkOutput(out, manifestPath, force) {
  if (realOrSelf(out) === realOrSelf(manifestPath)) throw new UsageError(`${out} is the manifest itself; choose another output file.`);
  if (!existsSync(dirname(out)) || !statSync(dirname(out)).isDirectory()) throw new UsageError(`The folder for ${out} does not exist.`);
  const existing = entry(out);
  if (existing === null) return;
  if (existing.isDirectory()) throw new UsageError(`${out} is a directory; --out needs a file.`);
  if (!force) throw new UsageError(`${out} already exists; pass --force to replace it.`);
}

const OUTPUTS = ['analysis.json', 'report.md'];

// Both outputs are checked before anything is analysed: an existing folder, no input file among the outputs (even
// with --force, and through symbolic links), and no existing output without --force.
function checkOutputDir(outDir, inputs, force) {
  if (!existsSync(outDir) || !statSync(outDir).isDirectory()) throw new UsageError(`The output folder ${outDir} does not exist or is not a folder.`);
  const inputPaths = new Set(inputs.map(realOrSelf));
  for (const name of OUTPUTS) {
    const out = join(outDir, name);
    if (inputPaths.has(realOrSelf(out))) throw new UsageError(`${out} is one of the input files; choose another output folder.`);
    const existing = entry(out);
    if (existing === null) continue;
    if (existing.isDirectory()) throw new UsageError(`${out} is a directory.`);
    if (!force) throw new UsageError(`${out} already exists${existing.isSymbolicLink() ? ' as a symbolic link' : ''}; pass --force to replace it.`);
  }
}

async function analyse(options) {
  const { module: analysis } = await runnerImport(resolve(ROOT, 'src/training/e4Analysis.ts'));
  const [manifestPath, ...recordPaths] = options.files.map((f) => resolve(f));
  const manifestInput = readJson(manifestPath, 'E4 manifest');
  const records = recordPaths.map((path) => readJson(path, 'E4 record'));
  const outDir = resolve(options.outDir);
  checkOutputDir(outDir, [manifestPath, ...recordPaths], options.force);
  const result = analysis.analyseE4Records(manifestInput, records, engine());
  const texts = { 'analysis.json': analysis.e4AnalysisJson(result), 'report.md': analysis.renderE4Report(result) };
  // Both outputs are installed as one unit: on any failure the folder is returned to its previous state.
  try {
    writeRecordPair(OUTPUTS.map((name) => ({ out: join(outDir, name), text: texts[name] })), options.force);
  } catch (error) {
    if (error instanceof OutputExistsError || error instanceof OutputDirectoryError) throw new UsageError(error.message);
    throw error;
  }
  const { outcome } = result;
  console.log(`E4 analysis of ${result.studyId} (${result.label}): n = ${result.n} training seed(s), every record replayed identically.`);
  console.log(`  Outcome (${outcome.rule}): ${outcome.result}. Reported as: ${outcome.wording ?? 'nothing (not a result)'}.`);
  console.log(`Wrote ${join(outDir, 'analysis.json')} and ${join(outDir, 'report.md')}.`);
  console.log('Training-track result only: validation results are descriptive, no held-out track was used, and nothing here is evidence about unseen tracks.');
  return 0;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === 'analyse') return analyse(options);
  const { module: study } = await runnerImport(resolve(ROOT, 'src/training/e4Study.ts'));
  const manifestPath = resolve(options.files[0]);
  const manifestInput = readJson(manifestPath, 'E4 manifest');

  if (options.command === 'run') {
    const manifest = study.parseE4Manifest(manifestInput);
    const src = source();
    checkFrozenRevision(manifest, src);
    if (!manifest.seeds.includes(options.seed)) throw new UsageError(`Seed ${options.seed} is not one of the manifest's seeds (${manifest.seeds.join(', ')}).`);
    const out = resolve(options.out);
    checkOutput(out, manifestPath, options.force);
    if (src.dirty) console.warn('Warning: the worktree has uncommitted or untracked changes; the record names the commit, not those changes.');
    const record = study.runE4Seed(manifestInput, options.seed, { engine: engine(), source: src, recordedAt: new Date().toISOString() });
    try {
      writeRecordFile(out, `${JSON.stringify(record, null, 2)}\n`, options.force);
    } catch (error) {
      if (error instanceof OutputExistsError) throw new UsageError(error.message);
      throw error;
    }
    const { planned, actual, ticks } = record.budgets;
    // Every car-tick the seed simulated: the search (the equal P x G budget), the descriptive validation episodes and the
    // frozen champions' verification episodes (each champion driven alone once more on the training track).
    const sum = (key) => Object.values(ticks).reduce((n, t) => n + t[key], 0);
    const executed = sum('training') + sum('validation') + sum('verification');
    console.log(`E4 study ${manifest.id} (${manifest.label}), seed ${record.seed}: agents ${manifest.agents.join(', ')} (A4 brake off, A5 brake on).`);
    console.log(`  ${actual.evaluations.A4} A4 and ${actual.evaluations.A5} A5 evaluations (planned ${planned.evolutionEvaluations} each); ${executed} car-ticks simulated ` +
        `(search ${sum('training')}, validation ${sum('validation')}, verification of the frozen champions ${sum('verification')}).`);
    console.log(`Recorded ${out} (results ${record.resultsHash.slice(0, 19)}…).`);
    console.log('Raw record only: no analysis was run, validation is descriptive, no held-out track was used, and nothing here is evidence of learning.');
    return 0;
  }

  const record = readJson(resolve(options.files[1]), 'E4 record');
  const result = study.replayE4Record(record, manifestInput, engine(), source());
  if (result.sameSourceRevision === false) console.warn(`Note: recorded at ${record.source.revision}, replayed at a different revision.`);
  if (result.identical) {
    console.log(`Replay identical: seed ${record.seed}, A4's and A5's results and both frozen models reproduced (${record.resultsHash.slice(0, 19)}…).`);
    return 0;
  }
  console.log('Replay differs from the record:');
  for (const difference of result.differences) console.log(`  ${difference}`);
  for (const [agent, ok] of Object.entries(result.modelsReplayed)) {
    if (!ok) console.log(`  agents.${agent}.model: driven alone with its own brake value, the frozen model did not reproduce its recorded episodes.`);
  }
  return 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    const known = error instanceof UsageError || /^(Study\w*Error|TrackLeakageError|TrackSplitError|RollbackIncompleteError)$/.test(error?.name ?? '');
    console.error(`${known ? '' : 'Unexpected error: '}${error?.message ?? error}`);
    if (error instanceof ArgumentError) console.error(USAGE);
    process.exitCode = 2;
  },
);
