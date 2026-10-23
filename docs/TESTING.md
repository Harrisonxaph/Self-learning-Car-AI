# Testing

> Status: the commands below exist from P1-01 onwards. Only the project foundation is tested so far (canvas sizing, page start-up and the architecture lint rules); the rest of the table under "What must be tested" applies as each feature lands. Report only results you actually ran.

## Commands

| Command | Purpose |
|---------|---------|
| `npm ci` | Clean install from `package-lock.json` (Node 24). |
| `npm run lint` | ESLint, including import-boundary rules from `docs/ARCHITECTURE.md`. |
| `npm run typecheck` | `tsc --noEmit` with `strict: true`. |
| `npm test` | Vitest unit and integration tests in Node. |
| `npm run build` | Vite production build. |
| `npm run test:e2e` | Builds the app, serves it with `vite preview` and runs the Playwright tests in Chromium and WebKit, including phone and tablet touch projects. |

CI (`.github/workflows/ci.yml`, P1-10) runs all of them with Node from `.nvmrc` on every pull request and on every push to `main`, in two parallel jobs on Ubuntu 24.04:

- **Lint, typecheck, unit tests and build:** `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
- **Browser tests:** `npm ci`, `npx playwright install --with-deps chromium webkit`, then `npm run test:e2e` (all six Playwright projects, including the phone and tablet touch projects). If it fails, the Playwright report and traces are uploaded as the `playwright-report` artifact for 14 days.

Any failing command fails the workflow. Actions are pinned to full commit SHAs. CI cannot make a check required; the owner can make the CI jobs required for merging in the repository's branch protection settings.

## Running the tests locally

1. Use Node 24 (`nvm use` reads `.nvmrc`), then `npm ci`.
2. Install the browsers once: `npx playwright install --with-deps chromium webkit`.
3. Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` and `npm run test:e2e`.

`npm run test:e2e` runs these Playwright projects against the production build:

| Project | Browser | Emulated device |
|---------|---------|-----------------|
| `desktop-chromium` | Chromium | Desktop, 1280 × 720 |
| `desktop-webkit` | WebKit | Desktop Safari, 1280 × 720 |
| `phone-webkit` | WebKit | iPhone 13 (touch, 3× pixel ratio) |
| `tablet-webkit` | WebKit | iPad (gen 7) (touch) |
| `phone-chromium` | Chromium | Pixel 7 (touch) |
| `tablet-chromium` | Chromium | Galaxy Tab S4 (touch) |

Run one project with `npx playwright test --project=phone-webkit`. Emulated WebKit approximates iOS Safari but does not replace checks on a real iPhone or iPad.

Lint rules have tests too: `tests/config/eslint-boundaries.test.ts` lints sample imports as if they were in each `src/` folder and checks that the architecture boundaries and determinism rules fire.

## Layout

```
tests/
  sim/          physics, collision, checkpoints, laps
  sensors/      ray casting
  ai/           forward pass, input and output mapping
  evolution/    operators, elitism, determinism
  training/     fitness guards, trainer, experiment records
  persistence/  model validation, migrations, storage failures
  utils/        rng, math
  render/       canvas sizing and drawing helpers
  config/       tests for the tooling configuration (ESLint boundaries)
  e2e/          Playwright: driving, training, save/load, editor
```

Tests mirror `src/`. No tests next to source files.

## What must be tested

| Area | Required tests |
|------|----------------|
| RNG | Same seed gives the same sequence. Different seeds give different sequences. Known first values are pinned. |
| Physics | Speed rises with throttle and falls with brake and drag. Brake never makes speed negative. Yaw is zero at zero speed; high-speed wheel-angle limits are respected. Results are independent of render frame rate (the same N ticks give the same state). |
| Determinism | Two runs with the same seed and config give bit-identical car states after N ticks and identical generation-K genomes. |
| Collision | Hand-made cases: touching, crossing a corner, no tunnelling at maximum speed. |
| Checkpoints | Only the next gate counts. Backwards crossings are ignored. Laps are counted and timed in simulation time. |
| Sensors | Known geometry gives known distances. Nothing in range returns 1.0. |
| Network | A hand-computed tiny network matches. 9-12-3 has 159 parameters. Parameter order is pinned. |
| Outputs | Steering is in [−1, 1] and throttle and brake are in [0, 1]. A no-brake mask forces 0. |
| Evolution | Elites are copied unchanged. Mutation rate 0 changes nothing. Crossover children only contain parent genes (uniform). Population size stays constant. |
| Fitness guards | Each exploit in `docs/AI_EVALUATION.md` §6 is scripted and shown not to accumulate repeat credit without new valid ordered progress; a bounded legitimate initial approach is allowed. |
| Persistence | Valid model round-trip. Every invalid case is rejected with an error (bad JSON, wrong count, `NaN`, unknown version, oversized file). localStorage that throws or is empty is handled. |
| Track validation | Closed boundaries, no self-intersections, start pose inside the road, at least 3 ordered gates spanning the road. |
| E2E | Drive with keyboard. Drive with touch controls (mobile viewport). Crash and restart. Complete a lap on a test track. Start, pause and resume training. Save, export and import a model. Create and validate a track. |

## Mobile and device checks

Playwright's WebKit is an approximation of iOS Safari, not a replacement. For each phase, record manual checks in the pull request:

- iPhone Safari (portrait and landscape): controls reachable, 44 px targets, no page scroll or zoom while driving, readable text.
- iPad Safari: layout, touch editor (Phase 4).
- Switch tabs or lock the screen mid-training, then return: the app pauses and resumes without a jump.
- Low-power check: frame rate and step time on the dashboard stay usable.

If no real device is available, say so in the pull request and leave the item as an outstanding manual check. Do not mark it done.

## Reporting

- Paste the actual command output summary (counts of passed and failed tests) in pull requests.
- Never write "tests pass" for commands that were not run in that change.
- List skipped environments and outstanding manual checks explicitly.

## Additional acceptance checks

- **Evaluation:** deterministic baselines, disjoint versioned track splits before Phase 2 experiments, held-out leakage rejection, metric denominators including failures, and seed-cluster analysis. An all-failure cohort has unavailable lap time, not zero. Run the anti-farming cases in AI_EVALUATION.md against the actual scorer.
- **Persistence:** require full resolved training configuration; reject absent required fields, unsupported observation/output contracts, wrong activation/order, non-finite values (including overflowing JSON exponents), malformed metadata, incompatible versions and oversized files. Test corrupted indexes, quota failures and unavailable storage without deleting other models.
- **Replay and recovery:** replay uses frozen model/configuration/track versions. Test generation-boundary checkpoint continuation against an uninterrupted run with population and PRNG state restored. Champion-only JSON must not be accepted as a population checkpoint.
- **Comparison:** Phase 3 compares two saved models and handles absent evaluations or incompatible fitness conditions. Phase 5 compares repeated evaluations on identical tracks, versions, start conditions and budgets. ST5 verifies simultaneous non-colliding cars with independent wall-collision outcomes.
- **Mobile/performance:** record named hardware, OS/browser, population, render mode, track, duration, FPS, mean/p95 update time and simulated ticks/second. Before performance work, set a device-specific responsiveness budget in its issue; verify it and publish before/after figures. A Worker is conditional on measured UI blocking, not a prerequisite.

## Evidence record for each feature PR

Record roadmap ID and issue, commit, acceptance criteria exercised, exact commands and exit codes/output counts, engine/version, browser/device/OS, manual steps and observed outcomes, skipped checks and reason, independent second-agent findings and dispositions, and owner PR approval. Emulator results do not replace real iPhone/iPad checks. Keep status In Review while a required check or approval is outstanding.

Claude Code is responsible for implementation and test evidence; Codex independently verifies the submitted evidence and reviews the current PR head. Link Codex's commit-specific `Changes required` or `Technical approval` comment and the owner's separate explicit merge approval. Shared-account review comments satisfy the review-record requirement; GitHub's formal Approved badge is optional. Neither role may claim to have run a command it did not execute. New commits require re-review/confirmation covering the new SHA. Codex-authored exceptions require another independent development agent, not Codex self-review. Follow [AGENTS.md](../AGENTS.md) for the complete workflow.

For documentation-only changes, application and mobile execution checks are not applicable when no application behaviour changes. Instead check IDs, dependencies, links, issue mappings, status claims and parseable examples, and obtain independent review. This exception does not waive device testing for future application features.

## Roadmap reconciliation verification record

The baseline `main` commit ec6f51cf0dea5e25310dce8f2e9972b825aa6779 has no package.json, application, tests or CI workflow. The existing documentation branch was reviewed at 59f63a6f09eb047bc15adbc262b1830e1293ed97. No npm checks, simulation experiments, device tests or performance benchmarks have been run for this documentation task. Documentation validation and independent review outcomes are recorded in the reconciliation PR; Q-01 remains In Review until approval. Claude Code authored PR #40; this follow-up receives a separate agent review and does not claim to be a Claude Code approval.
