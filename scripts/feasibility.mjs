// Command line for the P2-09 braking feasibility check (docs/experiments/p2-09-plan.md §4 and §8 step 3). Headless;
// nothing is deployed or served.
//
//   npm run feasibility -- run --out-dir <dir> [--force]
//
// `run` runs the whole predeclared grid (src/training/feasibility.ts) and writes feasibility.json and feasibility.md
// into the existing directory <dir> as one unit: both are installed or neither is. It never replaces an existing
// output unless --force is given, and the grid cannot be changed from the command line. This file only handles the
// outside world (arguments, files, git and the engine); the check itself is src/training/feasibility.ts, loaded
// through Vite so the command line and the tests run the same TypeScript.
//
// Exit codes: 0 written, 2 invalid arguments, a missing or unsuitable output directory, or an output that already
// exists, with nothing written. Physical feasibility of a scripted driver only: not an analysis of learning.
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';
import { OutputExistsError, RollbackIncompleteError, writeRecordPair } from './recordFile.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'Usage:\n  npm run feasibility -- run --out-dir <dir> [--force]';

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
  const { module: feasibility } = await runnerImport(join(ROOT, 'src/training/feasibility.ts'));
  const src = source();
  if (src.dirty) console.warn('Note: the worktree has uncommitted changes; the record says so (source.dirty).');
  const record = feasibility.runFeasibility({ engine: engine(), source: src });
  const analysis = feasibility.analyseFeasibility(record);
  writeRecordPair(feasibility.feasibilityFiles(record).map((file) => ({ out: join(dir, file.name), text: file.text })), options.force);
  console.log(`Feasibility check: ${record.episodes.length} episodes (results ${record.resultsHash}).`);
  for (const t of analysis.tracks) console.log(`  ${t.trackId} (${t.split}): braking ${t.useful ? `useful, rule (${t.rule})` : 'not shown'}.`);
  console.log(`Acceptance A2 (braking useful on at least one track): ${analysis.brakingUsefulOnAtLeastOneTrack ? 'met' : 'not met'}.`);
  console.log(`Wrote ${join(dir, 'feasibility.json')} and ${join(dir, 'feasibility.md')}.`);
  console.log('Physical feasibility of a scripted driver only: not evidence that a network learns to brake. No held-out track was used.');
}

main(process.argv.slice(2)).catch((error) => {
  if (error instanceof UsageError) {
    console.error(`${error.message}\n${USAGE}`);
  } else if (error instanceof OutputExistsError || error instanceof RollbackIncompleteError) {
    console.error(error.message);
  } else {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  }
  process.exitCode = 2;
});
