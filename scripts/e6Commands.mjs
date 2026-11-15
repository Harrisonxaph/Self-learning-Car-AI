// The E6 command-line logic (P5-04 step 4, docs/plans/p5-04-plan.md section 4), separated from the outside world so the tests run it with
// injected modules and a synthetic registry. scripts/e6.mjs is the thin wrapper that loads the real study and gate modules through Vite and
// passes the built-in registry. Nothing here reads process.argv, the clock, git or the engine itself: they come in through `deps`.
//
//   validate  <e6-manifest.json>
//   pins                                         (the derived A2, A1, A7 and A3 identities for the predeclared seeds; reads nothing)
//   run-held-out <e6-manifest.json> --e5-manifest <p5-02-e5.json> --e5-record <held-out.json> --e4-manifest <p2-09-e4.json> --e4-dir <dir>
//                --ledger <ledger.json> --out <held-out.json> --open-held-out
//   replay    <e6-manifest.json> <e6-held-out.json> --e5-manifest ... --e5-record ... --e4-manifest ... --e4-dir ...
//   analyse   <e6-manifest.json> <e6-held-out.json> --e5-manifest ... --e5-record ... --e4-manifest ... --e4-dir ... --out-dir <dir> [--force]
//
// E6 is EXPLORATORY and DESCRIPTIVE (E5's results were known): the outputs say so. **run-held-out is the one command that opens the held-out
// boundary**, for the NEW agents only (A2, A1, A7, A3; A4 and A5 are read from E5's record). It needs --open-held-out (so it is never run by
// accident), a ledger file and an E6 manifest. The E5 and E4 records are read and checked BEFORE the ledger is touched, the claim is written
// to disk before any access and is never overwritten, and a second run for the same manifest is refused. There is no --force for a
// held-out record. validate, pins, replay and analyse never open the boundary (replay uses a separate gate with a fresh in-memory ledger).
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createFileLedger, LedgerFileError } from './ledgerFile.mjs';
import { OutputDirectoryError, OutputExistsError, writeRecordFile, writeRecordPair } from './recordFile.mjs';

const INPUTS = '--e5-manifest <p5-02-e5.json> --e5-record <held-out.json> --e4-manifest <p2-09-e4.json> --e4-dir <dir>';
export const USAGE = [
  'Usage:',
  '  npm run e6 -- validate <e6-manifest.json>',
  '  npm run e6 -- pins',
  `  npm run e6 -- run-held-out <e6-manifest.json> ${INPUTS} --ledger <ledger.json> --out <held-out.json> --open-held-out`,
  `  npm run e6 -- replay <e6-manifest.json> <e6-held-out.json> ${INPUTS}`,
  `  npm run e6 -- analyse <e6-manifest.json> <e6-held-out.json> ${INPUTS} --out-dir <dir> [--force]`,
].join('\n');
export const COMMANDS = ['validate', 'pins', 'run-held-out', 'replay', 'analyse'];

export class UsageError extends Error {}
export class ArgumentError extends UsageError {}

const VALUE_OPTIONS = { '--e5-manifest': 'e5Manifest', '--e5-record': 'e5Record', '--e4-manifest': 'e4Manifest', '--e4-dir': 'e4Dir', '--ledger': 'ledger', '--out': 'out', '--out-dir': 'outDir' };
const READ = ['--e5-manifest', '--e5-record', '--e4-manifest', '--e4-dir'];
const ALLOWED = {
  validate: [],
  pins: [],
  // No --force: a held-out record is never overwritten.
  'run-held-out': [...READ, '--ledger', '--out', '--open-held-out'],
  replay: READ,
  analyse: [...READ, '--out-dir', '--force'],
};

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!COMMANDS.includes(command)) throw new ArgumentError(`Unknown command ${command ?? '(none)'}.`);
  const options = { command, files: [], e5Manifest: null, e5Record: null, e4Manifest: null, e4Dir: null, ledger: null, out: null, outDir: null, force: false, openHeldOut: false };
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
        options[key] = value;
      }
    } else options.files.push(arg);
  }
  const need = (condition, message) => {
    if (!condition) throw new ArgumentError(message);
  };
  const needInputs = () => {
    need(options.e5Manifest !== null, `"${command}" needs --e5-manifest <p5-02-e5.json>.`);
    need(options.e5Record !== null, `"${command}" needs --e5-record <held-out.json> (E5's held-out record, which A4 and A5 are read from).`);
    need(options.e4Manifest !== null, `"${command}" needs --e4-manifest <p2-09-e4.json>.`);
    need(options.e4Dir !== null, `"${command}" needs --e4-dir <dir> (the folder with seed-<n>.json.gz).`);
  };
  if (command === 'validate') need(options.files.length === 1, '"validate" needs exactly one E6 manifest file.');
  else if (command === 'pins') need(options.files.length === 0, '"pins" takes no positional file.');
  else if (command === 'run-held-out') {
    need(options.files.length === 1, '"run-held-out" needs exactly one E6 manifest file.');
    needInputs();
    need(options.ledger !== null, '"run-held-out" needs --ledger <ledger.json>.');
    need(options.out !== null, '"run-held-out" needs --out <held-out-record.json>.');
    need(options.openHeldOut, '"run-held-out" opens the held-out boundary and needs the explicit option --open-held-out.');
  } else if (command === 'replay') {
    need(options.files.length === 2, '"replay" needs an E6 manifest file and a held-out record file.');
    needInputs();
  } else {
    need(options.files.length === 2, '"analyse" needs an E6 manifest file and a held-out record file.');
    needInputs();
    need(options.outDir !== null, '"analyse" needs --out-dir <dir>.');
  }
  return options;
}

export function readJson(path, what) {
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

/** The E4 seed records an E5 manifest's pairs name, in manifest order, from `<dir>/seed-<seed>.json.gz` (or `.json`). Returns the records and their paths. */
export function readE4Records(dir, seeds) {
  const records = [];
  const paths = [];
  for (const seed of seeds) {
    const gz = join(dir, `seed-${seed}.json.gz`);
    const plain = join(dir, `seed-${seed}.json`);
    const path = existsSync(gz) ? gz : plain;
    let text;
    try {
      const data = readFileSync(path);
      text = path === gz ? gunzipSync(data).toString('utf8') : data.toString('utf8');
    } catch (error) {
      throw new UsageError(`Cannot read the E4 seed record for seed ${seed} (${gz} or ${plain}): ${error.message}`);
    }
    try {
      records.push(JSON.parse(text));
    } catch (error) {
      throw new UsageError(`The E4 seed record ${path} is not valid JSON: ${error.message}`);
    }
    paths.push(path);
  }
  return { records, paths };
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

function checkOutput(out, inputs) {
  const real = realOrSelf(out);
  if (inputs.some((input) => realOrSelf(input) === real)) throw new UsageError(`${out} is one of the input files; choose another output file.`);
  if (!existsSync(dirname(out)) || !statSync(dirname(out)).isDirectory()) throw new UsageError(`The folder for ${out} does not exist.`);
  const existing = entry(out);
  if (existing === null) return;
  if (existing.isDirectory()) throw new UsageError(`${out} is a directory; an output file is needed.`);
  throw new UsageError(`${out} already exists (a held-out record is never overwritten).`);
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

function writeHeldOut(out, record) {
  try {
    writeRecordFile(out, `${JSON.stringify(record, null, 2)}\n`, false);
  } catch (error) {
    if (error instanceof OutputExistsError) throw new UsageError(error.message);
    throw error;
  }
}

/**
 * Runs one parsed command. `deps`: { study (e6Study, e6Analysis and the E4/E5 parsers merged), access (heldOutAccess), registry (a TrackSplits,
 * or undefined for the built-in one), engine(), source(), now(), log(line), warn(line) }. Returns the exit code: 0 written / identical,
 * 1 a replay that differs. Throws UsageError (and the library's own errors) for anything refused, with nothing written.
 */
export async function execute(options, deps) {
  const { study, access, registry, log } = deps;
  const context = () => ({ engine: deps.engine(), source: deps.source(), recordedAt: deps.now() });

  if (options.command === 'pins') {
    log(JSON.stringify(study.e6BaselinePins(study.E4_SEEDS, study.E6_ACTION_SEEDS), null, 2));
    return 0;
  }

  const manifestPath = resolve(options.files[0]);
  const manifestInput = readJson(manifestPath, 'E6 manifest');
  const manifest = study.parseE6Manifest(manifestInput, registry);

  if (options.command === 'validate') {
    log(`E6 manifest ${manifest.id} (${manifest.label}, exploratory and descriptive): A2 seeds ${manifest.baselines.a2.map((p) => p.seed).join(', ')}, action seeds ${manifest.baselines.a1.map((p) => p.seed).join(', ')}, held-out circuits ${manifest.tracks.heldOut.map((t) => t.id).join(', ')}.`);
    log(`Manifest hash (the held-out protocol hash): ${study.e6ManifestHash(manifest)}.`);
    return 0;
  }

  const e5ManifestPath = resolve(options.e5Manifest);
  const e5RecordPath = resolve(options.e5Record);
  const e4ManifestPath = resolve(options.e4Manifest);
  const e5ManifestInput = readJson(e5ManifestPath, 'E5 manifest');
  const e5Record = readJson(e5RecordPath, 'E5 held-out record');
  const e4ManifestInput = readJson(e4ManifestPath, 'E4 manifest');
  const e5Manifest = study.parseE5Manifest(e5ManifestInput, registry);
  const { records: e4Records, paths: e4Paths } = readE4Records(resolve(options.e4Dir), e5Manifest.pairs.map((p) => p.seed));
  const inputPaths = [manifestPath, e5ManifestPath, e5RecordPath, e4ManifestPath, ...e4Paths];

  // The evolved cohorts are read and fully checked BEFORE the ledger is read or the gate built: a bad input cannot use up the look.
  const evolved = () => study.loadE6Evolved(manifestInput, e5ManifestInput, e5Record, e4ManifestInput, e4Records, deps.engine(), registry);

  if (options.command === 'run-held-out') {
    const ledgerPath = resolve(options.ledger);
    const out = resolve(options.out);
    checkOutput(out, [...inputPaths, ledgerPath]);
    const ctx = context();
    if (ctx.source.dirty) deps.warn('Warning: the worktree has uncommitted or untracked changes; the record names the commit, not those changes.');
    const cohorts = evolved();
    const ledger = createFileLedger(ledgerPath, access.createMemoryLedger);
    const gate = access.createHeldOutGate(study.e6HeldOutProtocol(manifestInput, registry), ledger, registry);
    let record;
    try {
      record = study.runE6HeldOut(manifestInput, cohorts, gate, ctx, registry);
    } catch (error) {
      if (error?.name === 'HeldOutAccessError' || error instanceof LedgerFileError) throw new UsageError(error.message);
      throw error;
    }
    try {
      writeHeldOut(out, record);
    } catch (error) {
      // The look is taken and claimed in the ledger; never lose the result.
      deps.warn(`The held-out opening was claimed but the record could not be written to ${out}: ${error.message}\nThe complete record follows so that it is not lost:`);
      deps.warn(JSON.stringify(record, null, 2));
      throw error;
    }
    log(`E6 study ${manifest.id} (${manifest.label}, exploratory and descriptive): the held-out boundary was opened ONCE for the new agents (${record.evaluations.length} agent-circuit evaluations of five starts each on ${manifest.tracks.heldOut.map((t) => t.id).join(', ')}); A4 and A5 were read from E5's record, not evaluated.`);
    log(`Claimed in the ledger ${ledgerPath}; recorded ${out} (results ${record.resultsHash.slice(0, 19)}…).`);
    return 0;
  }

  const heldPath = resolve(options.files[1]);
  const held = readJson(heldPath, 'E6 held-out record');

  if (options.command === 'replay') {
    const src = deps.source();
    // Through a separate replay gate with a fresh in-memory ledger; the study's ledger is never touched.
    const result = study.replayE6HeldOutRecord(held, manifestInput, evolved(), deps.engine(), src, registry);
    if (result.sameSourceRevision === false) deps.warn(`Note: recorded at ${held.source?.revision}, replayed at a different revision.`);
    if (result.identical) {
      log(`Replay identical: E6 held-out record (${String(held.resultsHash).slice(0, 19)}…).`);
      return 0;
    }
    log('Replay differs from the record:');
    for (const difference of result.differences) log(`  ${difference}`);
    return 1;
  }

  // analyse
  const outDir = resolve(options.outDir);
  checkOutputDir(outDir, [...inputPaths, heldPath], options.force);
  const result = study.analyseE6Records(manifestInput, e5ManifestInput, e5Record, e4ManifestInput, e4Records, held, deps.engine(), registry);
  const texts = { 'analysis.json': study.e6AnalysisJson(result), 'report.md': study.renderE6Report(result) };
  try {
    writeRecordPair(OUTPUTS.map((name) => ({ out: join(outDir, name), text: texts[name] })), options.force);
  } catch (error) {
    if (error instanceof OutputExistsError || error instanceof OutputDirectoryError) throw new UsageError(error.message);
    throw error;
  }
  log(`E6 analysis (${result.label}, exploratory and descriptive): ${result.circuits.length} held-out circuit(s); decision rule ${result.decisionRule}.`);
  log(`Wrote ${join(outDir, 'analysis.json')} and ${join(outDir, 'report.md')}.`);
  if (result.label === 'mechanics') log('MECHANICS ONLY: not study evidence.');
  return 0;
}
