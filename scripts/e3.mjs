// Command line for the P5-01 E3 study (docs/plans/p5-01-plan.md §4, step 4c). Headless; nothing is deployed or served.
//
//   npm run e3 -- run-seed <manifest.json> --seed <s> --out <seed-record.json> [--force]
//   npm run e3 -- run-rules <manifest.json> --out <rules-record.json> [--force]
//   npm run e3 -- run-held-out <manifest.json> --rules <rules.json> --ledger <ledger.json> --out <held-out.json> --open-held-out <seed-record.json>…
//   npm run e3 -- replay <manifest.json> <record.json> [<seed-record.json>…]
//   npm run e3 -- analyse <manifest.json> --rules <rules.json> [--held-out <held-out.json>] --out-dir <dir> [--force] <seed-record.json>…
//
// `run-seed` and `run-rules` touch the training and validation circuits only. **`run-held-out` is the one command that
// opens the held-out boundary.** It needs `--open-held-out` (so it is never run by accident), a ledger file, every seed
// record and the rules record, and a confirmatory manifest that lists held-out circuits with an authorisation. The ledger
// claim is written to disk before any access and is never overwritten; a second run for the same manifest is refused.
// This file only handles the outside world (arguments, files, git, the engine and the date); the study itself is
// src/training/e3Study.ts, loaded through Vite so the command line and the tests run the same TypeScript.
//
// A manifest that names a frozen commit runs, and its records parse, only from a clean worktree at that commit (the
// library enforces it, and the runs refuse before anything is evaluated). Exit codes: 0 written (or identical replay),
// 1 a replay that differs, 2 invalid, incompatible, refused or unreadable input, with nothing written. A record is raw
// results only: not an analysis, and not evidence of learning.
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';
import { createFileLedger, LedgerFileError } from './ledgerFile.mjs';
import { OutputDirectoryError, OutputExistsError, writeRecordFile, writeRecordPair } from './recordFile.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = [
  'Usage:',
  '  npm run e3 -- run-seed <manifest.json> --seed <s> --out <seed-record.json> [--force]',
  '  npm run e3 -- run-rules <manifest.json> --out <rules-record.json> [--force]',
  '  npm run e3 -- run-held-out <manifest.json> --rules <rules.json> --ledger <ledger.json> --out <held-out.json> --open-held-out <seed-record.json>...',
  '  npm run e3 -- replay <manifest.json> <record.json> [<seed-record.json>...]',
  '  npm run e3 -- analyse <manifest.json> --rules <rules.json> [--held-out <held-out.json>] --out-dir <dir> [--force] <seed-record.json>...',
].join('\n');
const SEED = /^(0|[1-9][0-9]*)$/;
const COMMANDS = ['run-seed', 'run-rules', 'run-held-out', 'replay', 'analyse'];

class UsageError extends Error {}
class ArgumentError extends UsageError {}

const VALUE_OPTIONS = { '--seed': 'seed', '--out': 'out', '--out-dir': 'outDir', '--rules': 'rules', '--held-out': 'heldOut', '--ledger': 'ledger' };
const ALLOWED = {
  'run-seed': ['--seed', '--out', '--force'],
  'run-rules': ['--out', '--force'],
  // No --force: a held-out record is never overwritten.
  'run-held-out': ['--rules', '--ledger', '--out', '--open-held-out'],
  replay: [],
  analyse: ['--rules', '--held-out', '--out-dir', '--force'],
};

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!COMMANDS.includes(command)) throw new ArgumentError(`Unknown command ${command ?? '(none)'}.`);
  const options = { command, files: [], seed: null, out: null, outDir: null, rules: null, heldOut: null, ledger: null, force: false, openHeldOut: false };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg.startsWith('--')) {
      if (!ALLOWED[command].includes(arg)) throw new ArgumentError(`Unexpected option ${arg}.`);
      if (arg === '--force') {
        if (options.force) throw new ArgumentError('--force is given more than once.');
        options.force = true;
      } else if (arg === '--open-held-out') {
        if (options.openHeldOut) throw new ArgumentError('--open-held-out is given more than once.');
        options.openHeldOut = true;
      } else {
        const key = VALUE_OPTIONS[arg];
        if (options[key] !== null) throw new ArgumentError(`${arg} is given more than once.`);
        const value = rest[(i += 1)];
        if (value === undefined || value.startsWith('--')) throw new ArgumentError(`${arg} needs a value.`);
        if (arg === '--seed') {
          if (!SEED.test(value) || !Number.isSafeInteger(Number(value))) throw new ArgumentError(`--seed needs a whole number written plainly, such as 7301, not ${value}.`);
          options.seed = Number(value);
        } else options[key] = value;
      }
    } else options.files.push(arg);
  }
  const need = (condition, message) => {
    if (!condition) throw new ArgumentError(message);
  };
  need(options.files.length >= 1, `"${command}" needs a manifest file.`);
  if (command === 'run-seed') {
    need(options.files.length === 1, '"run-seed" needs exactly one manifest file.');
    need(options.seed !== null, '"run-seed" needs --seed <s>.');
    need(options.out !== null, '"run-seed" needs --out <record.json>.');
  } else if (command === 'run-rules') {
    need(options.files.length === 1, '"run-rules" needs exactly one manifest file.');
    need(options.out !== null, '"run-rules" needs --out <record.json>.');
  } else if (command === 'run-held-out') {
    need(options.files.length >= 2, '"run-held-out" needs a manifest file and every seed record.');
    need(options.rules !== null, '"run-held-out" needs --rules <rules-record.json>.');
    need(options.ledger !== null, '"run-held-out" needs --ledger <ledger.json>.');
    need(options.out !== null, '"run-held-out" needs --out <held-out-record.json>.');
    need(options.openHeldOut, '"run-held-out" opens the held-out boundary and needs the explicit option --open-held-out.');
  } else if (command === 'replay') {
    need(options.files.length >= 2, '"replay" needs a manifest file and a record file.');
  } else {
    need(options.files.length >= 2, '"analyse" needs a manifest file and at least one seed record.');
    need(options.rules !== null, '"analyse" needs --rules <rules-record.json>.');
    need(options.outDir !== null, '"analyse" needs --out-dir <dir>.');
  }
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

const engine = () => ({ name: 'node', version: process.version, v8: process.versions.v8 });

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

const realOrSelf = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

function entry(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function checkOutput(out, inputs, force) {
  const real = realOrSelf(out);
  if (inputs.some((input) => realOrSelf(input) === real)) throw new UsageError(`${out} is one of the input files; choose another output file.`);
  if (!existsSync(dirname(out)) || !statSync(dirname(out)).isDirectory()) throw new UsageError(`The folder for ${out} does not exist.`);
  const existing = entry(out);
  if (existing === null) return;
  if (existing.isDirectory()) throw new UsageError(`${out} is a directory; an output file is needed.`);
  if (!force) throw new UsageError(`${out} already exists${force === false ? '; pass --force to replace it (not allowed for a held-out record)' : ''}.`);
}

const OUTPUTS = ['analysis.json', 'report.md'];
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

function write(out, record, force) {
  try {
    writeRecordFile(out, `${JSON.stringify(record, null, 2)}\n`, force);
  } catch (error) {
    if (error instanceof OutputExistsError) throw new UsageError(error.message);
    throw error;
  }
}

const NOTE = 'Raw record only: no analysis was run, no held-out circuit was used, and nothing here is evidence of learning.';

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { module: study } = await runnerImport(resolve(ROOT, 'src/training/e3Study.ts'));
  const manifestPath = resolve(options.files[0]);
  const manifestInput = readJson(manifestPath, 'E3 manifest');
  const context = () => ({ engine: engine(), source: source(), recordedAt: new Date().toISOString() });

  if (options.command === 'run-seed') {
    const manifest = study.parseE3Manifest(manifestInput);
    const out = resolve(options.out);
    checkOutput(out, [manifestPath], options.force);
    const ctx = context();
    if (ctx.source.dirty) console.warn('Warning: the worktree has uncommitted or untracked changes; the record names the commit, not those changes.');
    const record = study.runE3Seed(manifestInput, options.seed, ctx);
    write(out, record, options.force);
    console.log(`E3 study ${manifest.id} (${manifest.label}), seed ${record.seed}: A5 evolved, frozen and evaluated on the validation circuit only.`);
    console.log(`Recorded ${out} (results ${record.resultsHash.slice(0, 19)}…).`);
    console.log(NOTE);
    return 0;
  }

  if (options.command === 'run-rules') {
    const manifest = study.parseE3Manifest(manifestInput);
    const out = resolve(options.out);
    checkOutput(out, [manifestPath], options.force);
    const ctx = context();
    if (ctx.source.dirty) console.warn('Warning: the worktree has uncommitted or untracked changes; the record names the commit, not those changes.');
    const record = study.runE3Rules(manifestInput, ctx);
    write(out, record, options.force);
    console.log(`E3 study ${manifest.id} (${manifest.label}): A3, A3-nb and A3-nb-same evaluated on the validation circuit only.`);
    console.log(`Recorded ${out} (results ${record.resultsHash.slice(0, 19)}…).`);
    console.log(NOTE);
    return 0;
  }

  if (options.command === 'run-held-out') {
    const manifest = study.parseE3Manifest(manifestInput);
    if (manifest.authorisation === null) throw new UsageError('This manifest lists no held-out circuit, so there is nothing to open; no ledger was touched.');
    const seedPaths = options.files.slice(1).map((f) => resolve(f));
    const rulesPath = resolve(options.rules);
    const ledgerPath = resolve(options.ledger);
    const out = resolve(options.out);
    checkOutput(out, [manifestPath, rulesPath, ledgerPath, ...seedPaths], false);
    const ctx = context();
    // Making the gate and reading the ledger claim nothing: the claim happens inside runE3HeldOut, after it has checked the
    // frozen source (a wrong commit or a dirty tree is refused first), every seed record and the rules record.
    const seedRecords = seedPaths.map((p) => readJson(p, 'E3 seed record'));
    const rulesRecord = readJson(rulesPath, 'E3 rules record');
    const { module: access } = await runnerImport(resolve(ROOT, 'src/training/heldOutAccess.ts'));
    const ledger = createFileLedger(ledgerPath, access.createMemoryLedger);
    const gate = access.createHeldOutGate(study.e3HeldOutProtocol(manifestInput, study.parseE3SeedRecords(manifestInput, seedRecords, ctx.engine)), ledger);
    let record;
    try {
      record = study.runE3HeldOut(manifestInput, seedRecords, rulesRecord, gate, ctx);
    } catch (error) {
      if (error?.name === 'HeldOutAccessError' || error instanceof LedgerFileError) throw new UsageError(error.message);
      throw error;
    }
    try {
      write(out, record, false);
    } catch (error) {
      // The look is taken and claimed in the ledger; never lose the result.
      console.error(`The held-out opening was claimed but the record could not be written to ${out}: ${error.message}\nThe complete record follows so that it is not lost:`);
      console.error(JSON.stringify(record, null, 2));
      throw error;
    }
    console.log(`E3 study ${manifest.id} (${manifest.label}): the held-out boundary was opened ONCE (${record.evaluations.length} evaluations on ${manifest.tracks.heldOut.map((t) => t.id).join(', ')}).`);
    console.log(`Claimed in the ledger ${ledgerPath}; recorded ${out} (results ${record.resultsHash.slice(0, 19)}…).`);
    return 0;
  }

  if (options.command === 'replay') {
    const record = readJson(resolve(options.files[1]), 'E3 record');
    const src = source();
    let result;
    if (record?.format === study.E3_SEED_FORMAT) result = study.replayE3SeedRecord(record, manifestInput, engine(), src);
    else if (record?.format === study.E3_RULES_FORMAT) result = study.replayE3RulesRecord(record, manifestInput, engine(), src);
    else if (record?.format === study.E3_HELDOUT_FORMAT) {
      if (options.files.length < 3) throw new UsageError('Replaying a held-out record needs the seed records too.');
      // Through a separate replay gate with a fresh in-memory ledger; the study's ledger is never touched.
      result = study.replayE3HeldOutRecord(record, manifestInput, options.files.slice(2).map((f) => readJson(resolve(f), 'E3 seed record')), engine(), src);
    } else throw new UsageError('That file is not an E3 seed, rules or held-out record.');
    if (result.sameSourceRevision === false) console.warn(`Note: recorded at ${record.source.revision}, replayed at a different revision.`);
    if (result.identical) {
      console.log(`Replay identical: ${record.format.split('/').pop()} (${record.resultsHash.slice(0, 19)}…).`);
      return 0;
    }
    console.log('Replay differs from the record:');
    for (const difference of result.differences) console.log(`  ${difference}`);
    return 1;
  }

  // analyse
  const seedPaths = options.files.slice(1).map((f) => resolve(f));
  const rulesPath = resolve(options.rules);
  const heldPath = options.heldOut === null ? null : resolve(options.heldOut);
  const outDir = resolve(options.outDir);
  checkOutputDir(outDir, [manifestPath, rulesPath, ...(heldPath ? [heldPath] : []), ...seedPaths], options.force);
  const result = study.analyseE3(
    manifestInput,
    seedPaths.map((p) => readJson(p, 'E3 seed record')),
    readJson(rulesPath, 'E3 rules record'),
    heldPath === null ? null : readJson(heldPath, 'E3 held-out record'),
    engine(),
  );
  const texts = { 'analysis.json': study.e3AnalysisJson(result), 'report.md': study.renderE3Report(result) };
  try {
    writeRecordPair(OUTPUTS.map((name) => ({ out: join(outDir, name), text: texts[name] })), options.force);
  } catch (error) {
    if (error instanceof OutputExistsError || error instanceof OutputDirectoryError) throw new UsageError(error.message);
    throw error;
  }
  console.log(`E3 analysis (${result.label}): ${result.seedCount} independent seed(s); held-out ${result.heldOutIncluded ? 'included' : 'not included'}.`);
  console.log(`Wrote ${join(outDir, 'analysis.json')} and ${join(outDir, 'report.md')}.`);
  if (result.label === 'mechanics') console.log('MECHANICS ONLY: not study evidence and not acceptance evidence.');
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    const known = error instanceof UsageError || error instanceof LedgerFileError || /^(Study\w*Error|HeldOutAccessError|TrackLeakageError|TrackSplitError|RollbackIncompleteError)$/.test(error?.name ?? '');
    console.error(`${known ? '' : 'Unexpected error: '}${error?.message ?? error}`);
    if (error instanceof ArgumentError) console.error(USAGE);
    process.exitCode = 2;
  },
);
