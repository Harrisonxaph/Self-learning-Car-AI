// Command line for the P5-04 E6 study (docs/plans/p5-04-plan.md section 4, step 4). Exploratory and descriptive; headless; nothing is deployed or served.
//
//   npm run e6 -- validate <e6-manifest.json>
//   npm run e6 -- pins
//   npm run e6 -- run-held-out <e6-manifest.json> --e5-manifest <p5-02-e5.json> --e5-record <held-out.json> --e4-manifest <p2-09-e4.json> --e4-dir <dir> --ledger <ledger.json> --out <held-out.json> --open-held-out
//   npm run e6 -- replay <e6-manifest.json> <e6-held-out.json> --e5-manifest ... --e5-record ... --e4-manifest ... --e4-dir ...
//   npm run e6 -- analyse <e6-manifest.json> <e6-held-out.json> --e5-manifest ... --e5-record ... --e4-manifest ... --e4-dir ... --out-dir <dir> [--force]
//
// **run-held-out is the one command that opens the held-out boundary**, once, for the NEW agents only, through the controlled gate and a ledger
// file outside the worktree; see scripts/e6Commands.mjs for the rules. It must run on the Node version E5's record was recorded on, from a clean
// checkout of the manifest's frozen commit. This file only handles the outside world (arguments, git, the engine and the date); the study is
// src/training/e6Study.ts, loaded through Vite so the command line and the tests run the same TypeScript.
// Exit codes: 0 written (or identical replay), 1 a replay that differs, 2 invalid, incompatible, refused or unreadable input, with nothing written.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';
import { LedgerFileError } from './ledgerFile.mjs';
import { ArgumentError, execute, parseArgs, USAGE, UsageError } from './e6Commands.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { module: e6 } = await runnerImport(resolve(ROOT, 'src/training/e6Study.ts'));
  const { module: analysis } = await runnerImport(resolve(ROOT, 'src/training/e6Analysis.ts'));
  const { module: e5 } = await runnerImport(resolve(ROOT, 'src/training/e5Study.ts'));
  const { module: shared } = await runnerImport(resolve(ROOT, 'src/training/study.ts'));
  const { module: access } = await runnerImport(resolve(ROOT, 'src/training/heldOutAccess.ts'));
  return execute(options, {
    study: { ...e6, ...analysis, parseE5Manifest: e5.parseE5Manifest, E4_SEEDS: shared.E4_SEEDS },
    access,
    registry: undefined, // the built-in registry
    engine,
    source,
    now: () => new Date().toISOString(),
    log: (line) => console.log(line),
    warn: (line) => console.error(line),
  });
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
