// Command line for the P5-01 step 3 rule-driver tuning (docs/plans/p5-01-plan.md §3 and §4). Headless;
// nothing is deployed or served.
//
//   npm run rule-tuning -- run --out-dir <dir> [--force]
//
// `run` runs the whole predeclared grid (src/training/ruleTuning.ts) and writes p5-01-tuning.json and p5-01-tuning.md
// into the existing directory <dir> as one unit: both are installed or neither is. It never replaces an existing
// output unless --force is given, and the grid cannot be changed from the command line. This file only handles the
// outside world (arguments, files, git and the engine); the check itself is src/training/ruleTuning.ts, loaded
// through Vite so the command line and the tests run the same TypeScript.
//
// Exit codes: 0 written, 2 invalid arguments, a missing or unsuitable output directory, an output that is a directory
// (even with --force), or an output that already exists without --force, with nothing written. Tuning of a baseline on the training track only: not an analysis of learning.
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';
import { checkOutputEntries, OutputDirectoryError, OutputExistsError, RollbackIncompleteError, writeRecordPair } from './recordFile.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'Usage:\n  npm run rule-tuning -- run --out-dir <dir> [--force]';
const OUTPUTS = ['p5-01-tuning.json', 'p5-01-tuning.md'];

class UsageError extends Error {}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command !== 'run') throw new UsageError(`Unknown command ${command ?? '(none)'}.`);
  const options = { outDir: null, force: false };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--force') {
      if (options.force) throw new UsageError('--force is given more than once.');
      options.force = true;
    } else if (arg === '--out-dir') {
      if (options.outDir !== null) throw new UsageError('--out-dir is given more than once.');
      const value = rest[i + 1];
      if (value === undefined || value.startsWith('--')) throw new UsageError('--out-dir needs a directory.');
      options.outDir = value;
      i += 1;
    } else {
      throw new UsageError(`Unexpected argument ${arg}.`);
    }
  }
  if (options.outDir === null) throw new UsageError('--out-dir is required.');
  return options;
}

// The directory must already exist and be a real directory (not a link to one), so files are never written through a link.
function checkOutDir(dir) {
  let entry;
  try {
    entry = lstatSync(dir);
  } catch (error) {
    if (error.code === 'ENOENT') throw new UsageError(`The output directory ${dir} does not exist.`);
    throw error;
  }
  if (!entry.isDirectory()) throw new UsageError(`${dir} is not a directory (a link to a directory is not accepted either).`);
}

function engine() {
  return { name: 'node', version: process.version, v8: process.versions.v8 };
}

function source() {
  const appVersion = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version;
  try {
    const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    // Untracked files count: a new source file can change results as much as an edited one.
    return { revision: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain').length > 0, unavailableReason: null, appVersion };
  } catch (error) {
    return { revision: null, dirty: null, unavailableReason: `git is unavailable: ${error.message.split('\n')[0]}`, appVersion };
  }
}

async function main(argv) {
  const options = parseArgs(argv);
  const dir = resolve(options.outDir);
  checkOutDir(dir);
  // Before the grid runs: a directory at an output name is refused even with --force (replacing it would delete its
  // contents), and an existing output is refused without --force.
  checkOutputEntries(dir, OUTPUTS, options.force);
  const { module: tuning } = await runnerImport(join(ROOT, 'src/training/ruleTuning.ts'));
  const src = source();
  if (src.dirty) console.warn('Note: the worktree has uncommitted changes; the record says so (source.dirty).');
  const record = tuning.runRuleTuning({ engine: engine(), source: src });
  writeRecordPair(tuning.tuningFiles(record).map((file) => ({ out: join(dir, file.name), text: file.text })), options.force);
  console.log(`Rule tuning: ${record.episodes.length} episodes (results ${record.resultsHash}).`);
  for (const agent of ['A3', 'A3-nb']) console.log(`  ${agent}: variant ${record.selected[agent].index}, ${JSON.stringify(record.selected[agent].params)}`);
  console.log(`Wrote ${join(dir, 'p5-01-tuning.json')} and ${join(dir, 'p5-01-tuning.md')}.`);
  console.log('A baseline was tuned on the training track only: not a learning result. No validation or held-out track was used.');
}

main(process.argv.slice(2)).catch((error) => {
  if (error instanceof UsageError) {
    console.error(`${error.message}\n${USAGE}`);
  } else if (error instanceof OutputExistsError || error instanceof OutputDirectoryError || error instanceof RollbackIncompleteError) {
    console.error(error.message);
  } else {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  }
  process.exitCode = 2;
});
