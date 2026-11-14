// The E5 command-line logic (P5-02 step 4, docs/plans/p5-02-plan.md section 4), separated from the outside world so the tests run it with
// injected modules and a synthetic registry. scripts/e5.mjs is the thin wrapper that loads the real study and gate modules through Vite and
// passes the built-in registry. Nothing here reads process.argv, the clock, git or the engine itself: they come in through `deps`.
//
//   validate  <e5-manifest.json>
//   pins      --e4-manifest <p2-09-e4.json> --e4-dir <dir>
//   run-held-out <e5-manifest.json> --e4-manifest <p2-09-e4.json> --e4-dir <dir> --ledger <ledger.json> --out <held-out.json> --open-held-out
//   replay    <e5-manifest.json> <held-out.json> --e4-manifest <p2-09-e4.json> --e4-dir <dir>
//   analyse   <e5-manifest.json> <held-out.json> --e4-manifest <p2-09-e4.json> --e4-dir <dir> --out-dir <dir> [--force]
//
// **run-held-out is the one command that opens the held-out boundary.** It needs --open-held-out (so it is never run by accident), a
// ledger file and a manifest that lists held-out circuits. The E4 records are read and checked BEFORE the ledger is touched, the claim is
// written to disk before any access and is never overwritten, and a second run for the same manifest is refused. There is no --force for a
// held-out record. validate, pins, replay and analyse never open the boundary (replay uses a separate gate with a fresh in-memory ledger).
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createFileLedger, LedgerFileError } from './ledgerFile.mjs';
import { OutputDirectoryError, OutputExistsError, writeRecordFile, writeRecordPair } from './recordFile.mjs';

export const USAGE = [
  'Usage:',
  '  npm run e5 -- validate <e5-manifest.json>',
  '  npm run e5 -- pins --e4-manifest <p2-09-e4.json> --e4-dir <dir>',
  '  npm run e5 -- run-held-out <e5-manifest.json> --e4-manifest <p2-09-e4.json> --e4-dir <dir> --ledger <ledger.json> --out <held-out.json> --open-held-out',
  '  npm run e5 -- replay <e5-manifest.json> <held-out.json> --e4-manifest <p2-09-e4.json> --e4-dir <dir>',
  '  npm run e5 -- analyse <e5-manifest.json> <held-out.json> --e4-manifest <p2-09-e4.json> --e4-dir <dir> --out-dir <dir> [--force]',
].join('\n');
export const COMMANDS = ['validate', 'pins', 'run-held-out', 'replay', 'analyse'];

export class UsageError extends Error {}
export class ArgumentError extends UsageError {}

const VALUE_OPTIONS = { '--e4-manifest': 'e4Manifest', '--e4-dir': 'e4Dir', '--ledger': 'ledger', '--out': 'out', '--out-dir': 'outDir' };
const ALLOWED = {
  validate: [],
  pins: ['--e4-manifest', '--e4-dir'],
  // No --force: a held-out record is never overwritten.
  'run-held-out': ['--e4-manifest', '--e4-dir', '--ledger', '--out', '--open-held-out'],
  replay: ['--e4-manifest', '--e4-dir'],
  analyse: ['--e4-manifest', '--e4-dir', '--out-dir', '--force'],
};

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!COMMANDS.includes(command)) throw new ArgumentError(`Unknown command ${command ?? '(none)'}.`);
  const options = { command, files: [], e4Manifest: null, e4Dir: null, ledger: null, out: null, outDir: null, force: false, openHeldOut: false };
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
  const needE4 = () => {
    need(options.e4Manifest !== null, `"${command}" needs --e4-manifest <p2-09-e4.json>.`);
    need(options.e4Dir !== null, `"${command}" needs --e4-dir <dir> (the folder with seed-<n>.json.gz).`);
  };
  if (command === 'validate') need(options.files.length === 1, '"validate" needs exactly one E5 manifest file.');
  else if (command === 'pins') {
    need(options.files.length === 0, '"pins" takes no positional file.');
    needE4();
  } else if (command === 'run-held-out') {
    need(options.files.length === 1, '"run-held-out" needs exactly one E5 manifest file.');
    needE4();
    need(options.ledger !== null, '"run-held-out" needs --ledger <ledger.json>.');
    need(options.out !== null, '"run-held-out" needs --out <held-out-record.json>.');
    need(options.openHeldOut, '"run-held-out" opens the held-out boundary and needs the explicit option --open-held-out.');
  } else if (command === 'replay') {
    need(options.files.length === 2, '"replay" needs an E5 manifest file and a held-out record file.');
    needE4();
  } else {
    need(options.files.length === 2, '"analyse" needs an E5 manifest file and a held-out record file.');
    needE4();
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

/** The E4 seed records a manifest's pairs name, in manifest order, from `<dir>/seed-<seed>.json.gz` (or `.json`). Returns the records and their paths. */
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
 * Runs one parsed command. `deps`: { study (e5Study), access (heldOutAccess), registry (a TrackSplits, or undefined for the built-in one),
 * engine(), source(), now(), log(line), warn(line) }. Returns the exit code: 0 written / identical, 1 a replay that differs. Throws
 * UsageError (and the library's own errors) for anything refused, with nothing written.
 */
export async function execute(options, deps) {
  const { study, access, registry, log } = deps;
  const context = () => ({ engine: deps.engine(), source: deps.source(), recordedAt: deps.now() });

  if (options.command === 'pins') {
    const e4ManifestInput = readJson(resolve(options.e4Manifest), 'E4 manifest');
    const e4Manifest = study.parseE4Manifest(e4ManifestInput);
    const { records } = readE4Records(resolve(options.e4Dir), e4Manifest.seeds);
    // Reading the pins is not reproducing the E4 run: the records are checked against the engine they were recorded on.
    const recordedEngine = records[0]?.engine ?? deps.engine();
    log(JSON.stringify(study.e5PairPins(e4ManifestInput, records, recordedEngine), null, 2));
    return 0;
  }

  const manifestPath = resolve(options.files[0]);
  const manifestInput = readJson(manifestPath, 'E5 manifest');
  const manifest = study.parseE5Manifest(manifestInput, registry);

  if (options.command === 'validate') {
    log(`E5 manifest ${manifest.id} (${manifest.label}): ${manifest.pairs.length} pairs (seeds ${manifest.pairs.map((p) => p.seed).join(', ')}), held-out circuits ${manifest.tracks.heldOut.map((t) => t.id).join(', ')}.`);
    log(`Manifest hash (the held-out protocol hash): ${study.e5ManifestHash(manifest)}.`);
    return 0;
  }

  const e4ManifestPath = resolve(options.e4Manifest);
  const e4ManifestInput = readJson(e4ManifestPath, 'E4 manifest');
  const { records: e4Records, paths: e4Paths } = readE4Records(resolve(options.e4Dir), manifest.pairs.map((p) => p.seed));

  if (options.command === 'run-held-out') {
    const ledgerPath = resolve(options.ledger);
    const out = resolve(options.out);
    checkOutput(out, [manifestPath, e4ManifestPath, ledgerPath, ...e4Paths]);
    const ctx = context();
    if (ctx.source.dirty) deps.warn('Warning: the worktree has uncommitted or untracked changes; the record names the commit, not those changes.');
    // The pairs are read and checked against the manifest's pins BEFORE the ledger is read or the gate built: a bad record cannot use up the look.
    const pairs = study.loadE5Pairs(manifestInput, e4ManifestInput, e4Records, ctx.engine, registry);
    const ledger = createFileLedger(ledgerPath, access.createMemoryLedger);
    const gate = access.createHeldOutGate(study.e5HeldOutProtocol(manifestInput, pairs, registry), ledger, registry);
    let record;
    try {
      record = study.runE5HeldOut(manifestInput, e4ManifestInput, e4Records, gate, ctx, registry);
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
    log(`E5 study ${manifest.id} (${manifest.label}): the held-out boundary was opened ONCE (${record.evaluations.length} champion-circuit evaluations of five starts each on ${manifest.tracks.heldOut.map((t) => t.id).join(', ')}).`);
    log(`Claimed in the ledger ${ledgerPath}; recorded ${out} (results ${record.resultsHash.slice(0, 19)}…).`);
    return 0;
  }

  const heldPath = resolve(options.files[1]);
  const held = readJson(heldPath, 'E5 held-out record');

  if (options.command === 'replay') {
    const src = deps.source();
    // Through a separate replay gate with a fresh in-memory ledger; the study's ledger is never touched.
    const result = study.replayE5HeldOutRecord(held, manifestInput, e4ManifestInput, e4Records, deps.engine(), src, registry);
    if (result.sameSourceRevision === false) deps.warn(`Note: recorded at ${held.source?.revision}, replayed at a different revision.`);
    if (result.identical) {
      log(`Replay identical: held-out record (${String(held.resultsHash).slice(0, 19)}…).`);
      return 0;
    }
    log('Replay differs from the record:');
    for (const difference of result.differences) log(`  ${difference}`);
    return 1;
  }

  // analyse
  const outDir = resolve(options.outDir);
  checkOutputDir(outDir, [manifestPath, e4ManifestPath, heldPath, ...e4Paths], options.force);
  const result = study.analyseE5(manifestInput, e4ManifestInput, e4Records, held, deps.engine(), registry);
  const texts = { 'analysis.json': study.e5AnalysisJson(result), 'report.md': study.renderE5Report(result) };
  try {
    writeRecordPair(OUTPUTS.map((name) => ({ out: join(outDir, name), text: texts[name] })), options.force);
  } catch (error) {
    if (error instanceof OutputExistsError || error instanceof OutputDirectoryError) throw new UsageError(error.message);
    throw error;
  }
  log(`E5 analysis (${result.label}): ${result.pairCount} champion pairs on ${result.tracks.length} held-out circuit(s); decision rule ${result.decisionRule}.`);
  log(`Wrote ${join(outDir, 'analysis.json')} and ${join(outDir, 'report.md')}.`);
  if (result.label === 'mechanics') log('MECHANICS ONLY: not study evidence and not acceptance evidence.');
  return 0;
}
