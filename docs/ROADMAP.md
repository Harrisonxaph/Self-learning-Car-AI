# Roadmap — Self-Driving AI Evolution

A free, browser-based sandbox where 2D cars learn steering, acceleration and braking through small neural networks evolved by a genetic algorithm. It runs on iPhone, iPad and desktop browsers and uses Vite, TypeScript and Canvas 2D, with no paid AI APIs. Target complexity is **8/10**, with optional **9/10** research extensions in Phase 6.

## Verified project status

_Last verified: 2026-10-23, against `main` at `ec6f51c` ("Initial commit")._

| Area | State |
|------|-------|
| Application code | **None.** `main` contains only `README.md` and `LICENSE` (MIT). |
| Tests and CI | None. No `package.json`, test runner or workflows. |
| Deployment | None. |
| Planning docs | Added by this roadmap PR: `AGENTS.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/AI_EVALUATION.md`, `docs/MODEL_FORMAT.md`, `docs/TESTING.md`. |
| GitHub issues | Existing issues #1–#39 are preserved. Reconciliation adds #41–#50 for two missing primary-release entries and eight approval-gated research entries; #40 is the existing documentation PR. |
| AI learning results | None. No experiments have been run, so no learning claims can be made. |

All 40 primary-release implementation features are **Not Started**. Eight research entries are **Blocked** pending explicit approval; Q-01 remains **In Review**. No implementation is marked Complete. The initial master specification is the owner's detailed project request; no separate specification was found. Re-verify this table against code and tests whenever statuses change.

### Existing work and reconciliation

Claude Code's existing [PR #40](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/40), branch `docs/master-roadmap` at `59f63a6`, already supplied these documents, issues #1–#39, a PR template and README links. This revision preserves that work on a separate `docs/roadmap-reconciliation` branch and a follow-up PR targeting the documentation branch. The original PR targets `main`; neither PR is merged automatically. Baseline and feature statuses refer to main, while planning changes remain under review.

## How to use this file

- **Statuses:** `Not Started`, `In Progress`, `Blocked`, `In Review`, `Complete`. Change a status in the same PR that changes the work. `Complete` requires every item in the Definition of Done below.
- **Priority:** `P0` is needed for the phase acceptance, `P1` is needed for the 8/10 release, `P2` is optional research requiring separate approval. Required release behaviour is P0/P1.
- **IDs are permanent.** Never reuse or renumber them. Add new features with the next free number in their phase.
- **Labels:** `phase-1` to `phase-5`, `process`, `simulation`, `ai-learning`, `user-interface`, `persistence`, `evaluation`, `infrastructure`, `documentation`, `stretch-target`, `bug`. Use `phase-6` for research tracking; that label and an open issue do not authorize implementation. Apply `bug` only to verified defects, not to unimplemented features.

## Definition of Done

A feature is **Complete** only when:

1. The implementation exists and can be demonstrated.
2. Its required automated tests have been run and pass (output pasted in the PR).
3. Relevant mobile-browser behaviour has been tested (device and browser recorded), or the gap is listed as an outstanding manual check, in which case the feature stays `In Review`.
4. Existing functionality still works.
5. It meets its acceptance criteria below.
6. Documentation is updated.
7. Codex independently reviews Claude's implementation at the current head, with no blocking findings; Codex-authored exceptions require a separate development agent. Human review does not replace this gate.
8. Codex technical approval and the owner's explicit merge approval are recorded for the reviewed version. Under the chosen shared-account workflow, GitHub review comments are valid evidence; a formal Approved badge is not required.

Documentation-only checks are recorded as such; no application/device execution is implied. Q-01 stays In Review until independent review and owner PR approval. Missing relevant manual checks prevent application features from becoming Complete. Claude Code is now the main developer and Codex the independent reviewer; follow [AGENTS.md](../AGENTS.md) for commit-specific review comments, re-review after changes and owner merge approval. This role assignment supersedes earlier role descriptions; historical authorship remains recorded below.

## Stretch targets (must stay visible in every revision)

| ID | Feature | Phase | Roadmap items | Issues | Status |
|----|---------|-------|---------------|--------|--------|
| ST1 | Save/load champion neural-network brain | 3 | P3-05, P3-06 | [#25](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/25), [#26](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/26) | Not Started |
| ST2 | Live training fitness graph and analytics | 3 | P3-02 | [#22](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/22) | Not Started |
| ST3 | Interactive track editor | 4 | P4-02, P4-03 | [#29](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/29), [#30](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/30) | Not Started |
| ST4 | Learned braking and comparative experiments | 2 and 5 | P2-09, P5-02 | [#20](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/20), [#34](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/34) | Not Started |
| ST5 | Human vs AI racing | 5 | P5-03 | [#35](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/35) | Not Started |

## Overview

| ID | Feature | Phase | Priority | Status | Depends on | Issue |
|----|---------|-------|----------|--------|------------|-------|
| P1-01 | Project scaffold: Vite, TypeScript, lint and test tooling | 1 | P0 | Not Started | — | [#1](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/1) |
| P1-02 | Fixed-timestep loop with simulation/render separation | 1 | P0 | Not Started | P1-01 | [#2](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/2) |
| P1-03 | Seeded pseudorandom generator | 1 | P0 | Not Started | P1-01 | [#3](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/3) |
| P1-04 | Track model and responsive Canvas 2D racetrack | 1 | P0 | Not Started | P1-02 | [#4](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/4) |
| P1-05 | Vehicle physics: acceleration, steering, braking and drag | 1 | P0 | Not Started | P1-02 | [#5](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/5) |
| P1-06 | Collision detection with track boundaries | 1 | P0 | Not Started | P1-04, P1-05 | [#6](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/6) |
| P1-07 | Ordered checkpoints, lap counting and lap timing | 1 | P0 | Not Started | P1-04, P1-05 | [#7](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/7) |
| P1-08 | Manual driving with keyboard and mobile touch controls | 1 | P0 | Not Started | P1-05, P1-06, P1-07 | [#8](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/8) |
| P1-09 | Deterministic physics test suite | 1 | P0 | Not Started | P1-03, P1-05, P1-06, P1-07 | [#9](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/9) |
| P1-10 | GitHub Actions CI | 1 | P0 | Not Started | P1-01 | [#10](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/10) |
| P1-11 | Vercel deployment compatibility | 1 | P1 | Not Started | P1-01 | [#11](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/11) |
| P2-01 | Seven forward ray sensors | 2 | P0 | Not Started | P1-06 | [#12](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/12) |
| P2-02 | Nine network inputs: rays, speed and checkpoint heading error | 2 | P0 | Not Started | P2-01, P1-07 | [#13](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/13) |
| P2-03 | Feedforward network 9-12-3 with independent steering, throttle and brake | 2 | P0 | Not Started | P1-01 | [#14](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/14) |
| P2-04 | Genetic operators: selection, crossover, mutation and elitism | 2 | P0 | Not Started | P1-03, P2-03 | [#15](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/15) |
| P2-05 | Population training loop over multiple generations (headless and rendered) | 2 | P0 | Not Started | P2-02, P2-04, P2-06 | [#16](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/16) |
| P2-06 | Fitness function with anti-exploitation guards | 2 | P0 | Not Started | P1-07 | [#17](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/17) |
| P2-07 | Seeded training experiments and configuration recording | 2 | P0 | Not Started | P2-05, P2-10 | [#18](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/18) |
| P2-08 | Random-driving baselines and controlled improvement experiment | 2 | P0 | Not Started | P2-07 | [#19](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/19) |
| P2-09 | Braking output experiment toggle and braking feasibility check **(ST4)** | 2 | P1 | Not Started | P2-03, P2-05, P2-07, P2-10 | [#20](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/20) |
| P2-10 | Built-in track splits and evaluation fixtures | 2 | P0 | Not Started | P1-04, P1-07 | [#41](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/41) |
| P3-01 | Training dashboard: generation, population, collision and lap metrics | 3 | P1 | Not Started | P2-05 | [#21](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/21) |
| P3-02 | Live training fitness graph and analytics **(ST2)** | 3 | P1 | Not Started | P3-01 | [#22](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/22) |
| P3-03 | Training speed controls, pause/resume and accelerated headless mode | 3 | P1 | Not Started | P2-05 | [#23](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/23) |
| P3-04 | Champion replay with sensor and decision overlay | 3 | P1 | Not Started | P2-05 | [#24](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/24) |
| P3-05 | Save and load champion brain (localStorage) **(ST1)** | 3 | P0 | Not Started | P2-03, P2-07 | [#25](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/25) |
| P3-06 | JSON export/import, validation, versioning and compatibility checks **(ST1)** | 3 | P0 | Not Started | P3-05 | [#26](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/26) |
| P3-07 | Performance monitoring, iOS suspension handling and training checkpoints | 3 | P1 | Not Started | P3-03, P3-06, P1-03 | [#27](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/27) |
| P3-08 | Initial saved-model comparison | 3 | P1 | Not Started | P3-04, P3-06 | [#42](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/42) |
| P4-01 | Track data format and validation | 4 | P1 | Not Started | P1-04, P1-07 | [#28](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/28) |
| P4-02 | Touch-friendly interactive track editor **(ST3)** | 4 | P1 | Not Started | P4-01, P1-08 | [#29](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/29) |
| P4-03 | Save and load custom tracks **(ST3)** | 4 | P1 | Not Started | P4-01, P4-05 | [#30](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/30) |
| P4-04 | Training, validation and held-out track sets | 4 | P1 | Not Started | P4-01, P2-10 | [#31](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/31) |
| P4-05 | Evaluate trained models on unfamiliar tracks | 4 | P1 | Not Started | P4-04, P3-05 | [#32](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/32) |
| P5-01 | Rule-based baseline driver | 5 | P1 | Not Started | P2-02, P2-07, P2-10 | [#33](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/33) |
| P5-02 | Learned braking comparative study **(ST4)** | 5 | P1 | Not Started | P2-09, P4-04, P5-01 | [#34](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/34) |
| P5-03 | Human vs AI racing **(ST5)** | 5 | P1 | Not Started | P1-08, P3-05 | [#35](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/35) |
| P5-04 | Generalisation test suite and report | 5 | P1 | Not Started | P4-04, P4-05, P5-01 | [#36](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/36) |
| P5-05 | Model comparison dashboard | 5 | P1 | Not Started | P4-05, P3-08 | [#37](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/37) |
| P5-06 | Training performance improvements | 5 | P1 | Not Started | P3-07 | [#38](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/38) |
| Q-01 | Definition of Done and independent review workflow | Process | P0 | In Review | — | [#39](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/39) |

## Ready now vs waiting

Dependencies are taken from the table above.

- **Ready to start now:** P1-01 (scaffold). Q-01 is in review as part of this PR.
- **Ready as soon as P1-01 merges:** P1-02, P1-03, P1-10 and P1-11, and P2-03 (the network is pure maths and can be built alongside the simulator).
- **Next wave:** P1-04 and P1-05 (after P1-02), then P1-06 and P1-07, then P1-08 and P1-09.
- **Phase 2 critical path:** P1-06 → P2-01 → P2-02, and P1-07 → P2-06, then P2-04 → P2-05 → P2-07 → P2-08.
- **Early evaluation:** P1-04 + P1-07 → P2-10 supplies built-in training/validation/held-out fixtures before P2-07/P2-08; the editor is not a prerequisite.
- **Later work:** follow the explicit dependency table rather than treating every earlier phase as a blanket blocker. Phase 4 track validation/editor work can proceed after its Phase 1 prerequisites; dashboard and persistence wait for their respective inference/trainer/experiment dependencies. P3-08 supplies Phase 3 comparisons; P5-05 extends them.
- **Research:** R-01–R-08 require explicit approval and their listed technical dependencies; no research implementation is ready under the current authorization.

## Phase 1 — Simulation foundation

**Phase acceptance:** A user can drive, brake, crash, restart and complete laps using an iPhone or iPad.

### P1-01 — Project scaffold: Vite, TypeScript, lint and test tooling

- **Priority:** P0 · **Status:** Not Started · **Issue:** [#1](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/1)
- **Depends on:** none
- **Description:** Create the Vite + strict TypeScript project for Node 24 with ESLint (including import-boundary rules), Vitest, Playwright, the `src/` and `tests/` layout from ARCHITECTURE.md and the npm scripts from TESTING.md.
- **Acceptance criteria:**
  - `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` and `npm run test:e2e` all exist and succeed on a clean clone.
  - An empty page shows a responsive canvas on desktop and iPhone Safari.
  - `package-lock.json` committed; runtime dependencies pinned exactly.
- **Test requirements:**
  - One smoke unit test and one Playwright smoke test (Chromium and WebKit).

### P1-02 — Fixed-timestep loop with simulation/render separation

- **Priority:** P0 · **Status:** Not Started · **Issue:** [#2](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/2)
- **Depends on:** P1-01
- **Description:** Accumulator loop that steps `world.step(DT)` at a fixed 1/60 s, caps steps per frame, renders once per frame, and pauses on `visibilitychange`. Simulation modules have no DOM imports.
- **Acceptance criteria:**
  - Simulation state after N ticks is identical whatever the render frame rate.
  - Hiding then showing the tab does not cause a catch-up jump.
  - Lint rule blocks DOM/render imports from `src/sim`.
- **Test requirements:**
  - Unit: same tick count gives the same state with simulated 30/60/120 Hz frame timings.
  - E2E: pause on hidden tab.

### P1-03 — Seeded pseudorandom generator

- **Priority:** P0 · **Status:** Not Started · **Issue:** [#3](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/3)
- **Depends on:** P1-01
- **Description:** Add `src/utils/rng.ts` (mulberry32 or sfc32, documented choice) with helpers for uniform floats, ranges, Gaussian and integer picks. All sim/AI/evolution randomness uses it.
- **Acceptance criteria:**
  - Same seed gives identical sequences; first values pinned in tests.
  - No `Math.random()` in sim, sensors, ai, evolution or training (lint rule).
- **Test requirements:**
  - Unit: determinism, ranges, Gaussian mean and variance within tolerance over 10k samples.

### P1-04 — Track model and responsive Canvas 2D racetrack

- **Priority:** P0 · **Status:** Not Started · **Issue:** [#4](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/4)
- **Depends on:** P1-02
- **Description:** Track type (inner/outer boundary polylines, start pose, ordered checkpoint gates) with one built-in track, rendered responsively with capped devicePixelRatio and a cached static track layer.
- **Acceptance criteria:**
  - Track fills the screen on iPhone portrait and landscape, iPad and desktop without distortion.
  - Static layer is redrawn only on resize.
- **Test requirements:**
  - Unit: track loading and coordinate scaling.
  - E2E: canvas visible at mobile and desktop viewports.

### P1-05 — Vehicle physics: acceleration, steering, braking and drag

- **Priority:** P0 · **Status:** Not Started · **Issue:** [#5](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/5)
- **Depends on:** P1-02
- **Description:** Kinematic car model with throttle, brake, quadratic drag, rolling resistance and speed-dependent steering; constants in `src/sim/config.ts`.
- **Acceptance criteria:**
  - Throttle accelerates to a terminal speed; brake decelerates faster than coasting; speed never goes negative.
  - Car cannot turn while stationary.
- **Test requirements:**
  - Unit tests for each property above with fixed inputs over N ticks.

### P1-06 — Collision detection with track boundaries

- **Priority:** P0 · **Status:** Not Started · **Issue:** [#6](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/6)
- **Depends on:** P1-04, P1-05
- **Description:** Test the car rectangle against boundary segments each tick, with swept checks so fast cars cannot tunnel through walls.
- **Acceptance criteria:**
  - Crash detected for every hand-made contact case; no tunnelling at maximum speed.
  - Crashed car stops and is flagged.
- **Test requirements:**
  - Unit: edge, corner, parallel and high-speed cases.

### P1-07 — Ordered checkpoints, lap counting and lap timing

- **Priority:** P0 · **Status:** Not Started · **Issue:** [#7](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/7)
- **Depends on:** P1-04, P1-05
- **Description:** Gates crossed only in order and in the forward direction count; crossing gate 0 after the last completes a lap; lap time measured in simulation time.
- **Acceptance criteria:**
  - Out-of-order or backwards crossings are ignored.
  - Lap count and lap time are correct for a scripted lap.
- **Test requirements:**
  - Unit: in-order lap, back-and-forth on one gate, reverse lap, lap timing in ticks × DT.

### P1-08 — Manual driving with keyboard and mobile touch controls

- **Priority:** P0 · **Status:** Not Started · **Issue:** [#8](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/8)
- **Depends on:** P1-05, P1-06, P1-07
- **Description:** Human driver via the Driver interface: keyboard (arrows/WASD, space to brake, R to restart) and on-screen touch controls (steer left/right, accelerate, brake, restart) with 44 px targets and no page scroll or zoom during play.
- **Acceptance criteria:**
  - **Phase 1 acceptance:** a user can drive, brake, crash, restart and complete laps on iPhone and iPad.
  - Lap count and current/best lap time shown.
- **Test requirements:**
  - E2E: keyboard and touch (mobile viewport) drive, crash, restart, lap.
  - Manual: real iPhone and iPad Safari (record device).

### P1-09 — Deterministic physics test suite

- **Priority:** P0 · **Status:** Not Started · **Issue:** [#9](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/9)
- **Depends on:** P1-03, P1-05, P1-06, P1-07
- **Description:** Golden tests that run a scripted control sequence and compare the full car state and lap events to stored expectations.
- **Acceptance criteria:**
  - Two runs with the same seed and inputs are bit-identical in Node.
  - Golden files documented and only regenerated deliberately.
- **Test requirements:**
  - The suite itself, in CI.

### P1-10 — GitHub Actions CI

- **Priority:** P0 · **Status:** Not Started · **Issue:** [#10](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/10)
- **Depends on:** P1-01
- **Description:** Workflow on pull requests and `main`: `npm ci`, lint, typecheck, unit tests, build and Playwright (Chromium and WebKit).
- **Acceptance criteria:**
  - CI runs on every PR and blocks on failure.
  - Playwright reports uploaded on failure.
- **Test requirements:**
  - A deliberately failing test is shown to fail CI (in a throwaway branch).

### P1-11 — Vercel deployment compatibility

- **Priority:** P1 · **Status:** Not Started · **Issue:** [#11](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/11)
- **Depends on:** P1-01
- **Description:** Static build with correct base path and no server code; document deployment in the README. Do not add paid plans.
- **Acceptance criteria:**
  - `npm run build` output serves correctly from a static host; a Vercel preview loads on iPhone Safari.
- **Test requirements:**
  - E2E runs against `vite preview` of the production build.

## Phase 2 — AI learning engine

**Phase acceptance:** Training runs over multiple generations and produces demonstrable improvement over random-driving baselines under controlled, seeded experiments. A negative or inconclusive experiment is reported honestly and leaves this phase acceptance unmet.

### P2-01 — Seven forward ray sensors

- **Priority:** P0 · **Status:** Not Started · **Issue:** [#12](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/12)
- **Depends on:** P1-06
- **Description:** Cast 7 rays (−90° to +90°) from the car against track boundaries, returning distance ÷ RAY_LENGTH (1 = clear).
- **Acceptance criteria:**
  - Distances match known geometry within 1e-9.
  - Rays can be drawn for any car (debug layer).
- **Test requirements:**
  - Unit: straight wall, angled wall, nothing in range, ray from inside a corner.

### P2-02 — Nine network inputs: rays, speed and checkpoint heading error

- **Priority:** P0 · **Status:** Not Started · **Issue:** [#13](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/13)
- **Depends on:** P2-01, P1-07
- **Description:** Build the 9-value input vector: 7 ray distances, forward speed ÷ MAX_SPEED and signed heading error to the next checkpoint ÷ π.
- **Acceptance criteria:**
  - All inputs within documented ranges; heading-error sign matches left/right.
- **Test requirements:**
  - Unit: known poses give known vectors.

### P2-03 — Feedforward network 9-12-3 with independent steering, throttle and brake

- **Priority:** P0 · **Status:** Not Started · **Issue:** [#14](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/14)
- **Depends on:** P1-01
- **Description:** Pure inference module: flat parameter array (documented order), tanh hidden layer, outputs mapped to steering tanh, throttle sigmoid, brake sigmoid; optional brake mask.
- **Acceptance criteria:**
  - 159 parameters; hand-computed small network matches; outputs in range; inference does not import evolution code.
- **Test requirements:**
  - Unit: forward pass, parameter order, output ranges, brake mask.

### P2-04 — Genetic operators: selection, crossover, mutation and elitism

- **Priority:** P0 · **Status:** Not Started · **Issue:** [#15](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/15)
- **Depends on:** P1-03, P2-03
- **Description:** Tournament selection, uniform crossover, Gaussian mutation (rate and scale) and elitism over flat genomes, all using the seeded RNG.
- **Acceptance criteria:**
  - Elites copied unchanged; mutation rate 0 is identity; population size constant; same seed gives same next generation.
- **Test requirements:**
  - Unit tests for each operator and a determinism test.

### P2-05 — Population training loop over multiple generations (headless and rendered)

- **Priority:** P0 · **Status:** Not Started · **Issue:** [#16](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/16)
- **Depends on:** P2-02, P2-04, P2-06
- **Description:** Trainer that evaluates a population under identical start conditions, records per-generation stats and versioned champion/configuration references for replay and builds the next generation; runs headless in Node and rendered in the browser.
- **Acceptance criteria:**
  - Runs ≥ 50 generations headless without errors; per-generation stats recorded.
  - Same seed and config give identical stats.
- **Test requirements:**
  - Integration: 5-generation headless run is deterministic.

### P2-06 — Fitness function with anti-exploitation guards

- **Priority:** P0 · **Status:** Not Started · **Issue:** [#17](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/17)
- **Depends on:** P1-07
- **Description:** Fitness from ordered checkpoint progress, laps and completed-lap time bonus, with stall timeout, max episode time and no reward for distance or speed alone (AI_EVALUATION.md §6).
- **Acceptance criteria:**
  - Each exploit in §6 is scripted and cannot accumulate repeated credit without new valid ordered progress. Bounded legitimate partial progress is distinguished from farming.
  - Fitness formula versioned (`fitnessVersion`).
- **Test requirements:**
  - Unit: one test per exploit plus normal-lap scoring.

### P2-07 — Seeded training experiments and configuration recording

- **Priority:** P0 · **Status:** Not Started · **Issue:** [#18](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/18)
- **Depends on:** P2-05, P2-10
- **Description:** Experiment config type and runner that saves complete resolved config (including physics and control/normalisation contracts), PRNG algorithm/version, seeds, commit, simulation/track versions, split manifest, budgets, frozen model IDs and raw episode/per-generation results as JSON (headless script, e.g. `npm run experiment -- <config>`).
- **Acceptance criteria:**
  - A recorded experiment can be re-run from its file to identical results in the same engine.
- **Test requirements:**
  - Integration: record then replay a short experiment.

### P2-08 — Random-driving baselines and controlled improvement experiment

- **Priority:** P0 · **Status:** Not Started · **Issue:** [#19](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/19)
- **Depends on:** P2-07
- **Description:** Implement random-action (A1), correlated random-action (A7), untrained-network (A2), best-of-initial-population (A9) and equal-budget random-search (A8) baselines and run experiments E1 and E2 from AI_EVALUATION.md over 10 training seeds.
- **Acceptance criteria:**
  - **Phase 2 acceptance:** controlled results demonstrate improvement over equal-budget random search (A8) on ordered progress, with random-action floors (A1, A7), the best-of-initial-population baseline (A9), lap completion and collisions reported, at least one valid evolved lap, ≥10 independent training seeds and the predeclared effect/uncertainty criteria in AI_EVALUATION.md. Built-in training/validation fixtures come from P2-10; held-out data stays reserved for final evaluation.
  - An honest negative/inconclusive study can complete the experiment-reporting task but leaves Phase 2 acceptance unmet and requires a follow-up; rising fitness alone cannot pass the phase.
  - No claim made beyond what the data shows.
- **Test requirements:**
  - Unit: baseline drivers deterministic.
  - Experiment output files checked into `experiments/results/`.

### P2-09 — Braking output experiment toggle and braking feasibility check

- **Priority:** P1 · **Status:** Not Started · **Issue:** [#20](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/20) · **Stretch target:** ST4
- **Depends on:** P2-03, P2-05, P2-07, P2-10
- **Description:** Add a brake-enabled/no-brake training switch (brake masked, same 9-12-3 shape) and confirm the default tracks contain corners where braking is physically useful; run E4.
- **Acceptance criteria:**
  - Toggle recorded in experiment config and saved models.
  - Feasibility note documented: a scripted driver is faster or crashes less with braking on at least one track (or the limitation is reported and any physics/track redesign is approved and versioned before a fresh study; do not tune conditions using held-out results).
- **Test requirements:**
  - Unit: mask forces brake 0.
  - Integration: paired no-brake and brake runs with the same seed.

### P2-10 — Built-in track splits and evaluation fixtures

- **Priority:** P0 · **Status:** Not Started · **Issue:** [#41](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/41)
- **Depends on:** P1-04, P1-07
- **Description:** Supply at least one versioned built-in training, validation and held-out circuit with different corner geometry before early experiments. No editor prerequisite.
- **Acceptance criteria:** Split manifest records stable IDs and content versions/hashes; training uses training tracks only, selection uses validation only, and final held-out evaluation uses frozen models. P4-04 later expands the circuits.
- **Test requirements:** Geometry validity, disjoint split IDs, deterministic loading and leakage rejection.

## Phase 3 — Training dashboard and persistence

**Phase acceptance:** Users can observe, save, replay and compare genuine training results.

### P3-01 — Training dashboard: generation, population, collision and lap metrics

- **Priority:** P1 · **Status:** Not Started · **Issue:** [#21](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/21)
- **Depends on:** P2-05
- **Description:** Panel showing generation, alive/crashed counts, best and mean fitness, collision rate and lap-completion rate for the current and previous generations.
- **Acceptance criteria:**
  - Values match the trainer's recorded stats; readable on iPhone.
- **Test requirements:**
  - Unit: stats aggregation.
  - E2E: dashboard updates during training.

### P3-02 — Live training fitness graph and analytics

- **Priority:** P1 · **Status:** Not Started · **Issue:** [#22](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/22) · **Stretch target:** ST2
- **Depends on:** P3-01
- **Description:** Canvas line chart of best and mean fitness per generation, plus collision and lap-completion rates, updated live and redrawn at most a few times per second.
- **Acceptance criteria:**
  - Graph matches recorded data; stays responsive at 500 generations; accessible text summary available.
- **Test requirements:**
  - Unit: chart scaling.
  - E2E: graph points appear as generations finish.

### P3-03 — Training speed controls, pause/resume and accelerated headless mode

- **Priority:** P1 · **Status:** Not Started · **Issue:** [#23](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/23)
- **Depends on:** P2-05
- **Description:** Speed options (1×, 4×, max) where max runs many ticks per frame without drawing every car; pause/resume; auto-pause when the tab is hidden.
- **Acceptance criteria:**
  - Changing speed does not change results (same seed gives same stats).
  - UI stays responsive at max speed on iPhone (record frame rate).
- **Test requirements:**
  - Integration: 1× vs max produce identical stats.
  - E2E: pause/resume.

### P3-04 — Champion replay with sensor and decision overlay

- **Priority:** P1 · **Status:** Not Started · **Issue:** [#24](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/24)
- **Depends on:** P2-05
- **Description:** Replay the best car of any recorded generation on its track, showing rays, the 9 inputs and the steering/throttle/brake outputs each tick.
- **Acceptance criteria:**
  - Replay is identical to the original evaluation (same events and lap time).
  - Inputs and outputs shown match inference values.
- **Test requirements:**
  - Integration: replay determinism.
  - E2E: replay controls.

### P3-05 — Save and load champion brain (localStorage)

- **Priority:** P0 · **Status:** Not Started · **Issue:** [#25](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/25) · **Stretch target:** ST1
- **Depends on:** P2-03, P2-07
- **Description:** Implement MODEL_FORMAT.md v1: save champion with full metadata to localStorage, list and load compatible models, handle storage failures, warn that storage is not permanent.
- **Acceptance criteria:**
  - Saved then loaded model drives identically.
  - Throwing or empty localStorage handled with clear messages.
- **Test requirements:**
  - Unit: round-trip, validation failures, storage exceptions.
  - E2E: save, reload page, load.

### P3-06 — JSON export/import, validation, versioning and compatibility checks

- **Priority:** P0 · **Status:** Not Started · **Issue:** [#26](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/26) · **Stretch target:** ST1
- **Depends on:** P3-05
- **Description:** Export a model as a `.json` download and import from a file with size limit, schema validation, version checks and migration hooks.
- **Acceptance criteria:**
  - Every invalid case in TESTING.md is rejected without side effects.
  - Exported file re-imports identically.
- **Test requirements:**
  - Unit: validator and migration.
  - E2E: export then import (Chromium and WebKit).

### P3-07 — Performance monitoring, iOS suspension handling and training checkpoints

- **Priority:** P1 · **Status:** Not Started · **Issue:** [#27](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/27)
- **Depends on:** P3-03, P3-06, P1-03
- **Description:** Debug panel with FPS and mean step time; save a separate versioned generation-boundary checkpoint containing the population, champion, next-generation index, all PRNG states/caches, full configuration, track versions and metrics. Save periodically while active; tab-hide delivery is not guaranteed. Champion JSON alone cannot resume evolution. Handle quota/storage failures and offer file export.
- **Acceptance criteria:**
  - Metrics visible on a named device/browser with recorded population, track and render mode; resuming at a generation boundary matches an uninterrupted run. Storage failures leave training usable and are reported.
- **Test requirements:**
  - Integration: checkpoint and resume determinism, PRNG state/cache recovery and unavailable/quota-limited storage; manual iOS background/resume and termination recovery checks.

### P3-08 — Initial saved-model comparison

- **Phase:** 3 · **Priority:** P1 · **Status:** Not Started · **Issue:** [#42](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/42)
- **Depends on:** P3-04, P3-06
- **Description:** Initial saved-model comparison provides the primary-release comparison capability.
- **Acceptance criteria:** Two saved models can be inspected side by side in Phase 3 using architecture, configuration, seed, generation, training track/version and recorded metrics. Compatible models can be replayed under the same conditions; incompatible fitness values are not ranked. P5-05 adds repeated multi-track statistical comparisons.
- **Test requirements:** Unit: comparison compatibility and missing evaluations; E2E: compare two imported models and show a mismatch warning.

## Phase 4 — Interactive track editor

**Phase acceptance:** Users can create valid tracks and evaluate trained models on unfamiliar layouts.

### P4-01 — Track data format and validation

- **Priority:** P1 · **Status:** Not Started · **Issue:** [#28](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/28)
- **Depends on:** P1-04, P1-07
- **Description:** Versioned track JSON (boundaries, start pose, ordered gates, split label) and a validator: closed, non-self-intersecting boundaries, start inside the road, ≥ 3 gates spanning the road, minimum road width.
- **Acceptance criteria:**
  - Built-in tracks pass; each invalid case returns a readable error.
- **Test requirements:**
  - Unit: one test per validation rule.

### P4-02 — Touch-friendly interactive track editor

- **Priority:** P1 · **Status:** Not Started · **Issue:** [#29](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/29) · **Stretch target:** ST3
- **Depends on:** P4-01, P1-08
- **Description:** Create and edit boundaries, start position and ordered checkpoints by touch and mouse, with undo, snapping and live validation messages.
- **Acceptance criteria:**
  - **Phase 4 acceptance (part):** a user can build a valid track on an iPad and drive it.
  - All controls ≥ 44 px and keyboard accessible.
- **Test requirements:**
  - Unit: editor state operations.
  - E2E: create a simple track with pointer events.
  - Manual: iPad Safari.

### P4-03 — Save and load custom tracks

- **Priority:** P1 · **Status:** Not Started · **Issue:** [#30](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/30) · **Stretch target:** ST3
- **Depends on:** P4-01, P4-05
- **Description:** Store custom tracks in localStorage with JSON export/import, using the same safety rules as models, and make saved custom tracks selectable in the P4-05 evaluation runner.
- **Acceptance criteria:**
  - Round-trip identical; invalid or corrupt tracks rejected safely.
  - A saved custom track can be chosen as an evaluation track in P4-05 (completing the custom-layout part of the Phase 4 acceptance).
- **Test requirements:**
  - Unit: track store.
  - E2E: save, reload, load.
  - E2E: evaluate a saved model on a saved custom track.

### P4-04 — Training, validation and held-out track sets

- **Priority:** P1 · **Status:** Not Started · **Issue:** [#31](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/31)
- **Depends on:** P4-01, P2-10
- **Description:** Expand the built-in split manifest from P2-10 with varied corner geometry. Users select one training circuit per run and evaluate on separate circuits; evolving across several training tracks is approval-gated R-06.
- **Acceptance criteria:**
  - At least 2 training, 2 validation and 3 held-out tracks; validation/held-out tracks never used by the trainer and held-out tracks never used for tuning/champion selection (test enforced). Record content versions and split provenance.
- **Test requirements:**
  - Unit: split enforcement.

### P4-05 — Evaluate trained models on unfamiliar tracks

- **Priority:** P1 · **Status:** Not Started · **Issue:** [#32](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/32)
- **Depends on:** P4-04, P3-05
- **Description:** Evaluation runner and UI that runs a saved model on chosen built-in tracks with fixed evaluation seeds and stores results in the model's `evaluation` field. It does not depend on the editor, so the generalisation study (P5-04) and comparisons (P5-05) are not blocked by it; P4-03 later adds saved custom tracks as selectable evaluation tracks.
- **Acceptance criteria:**
  - **Phase 4 acceptance (part):** users can evaluate trained models on built-in layouts they did not train on and see lap completion, collisions and lap time. Custom layouts are covered by P4-03.
- **Test requirements:**
  - Integration: evaluation deterministic.
  - E2E: evaluate a saved model on a built-in held-out track.

## Phase 5 — Advanced driving intelligence

**Phase acceptance:** Show, with data, whether learned braking improves performance and whether trained models generalise to unseen circuits.

### P5-01 — Rule-based baseline driver

- **Priority:** P1 · **Status:** Not Started · **Issue:** [#33](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/33)
- **Depends on:** P2-02, P2-07, P2-10
- **Description:** Hand-written driver (steer toward more free space, brake when the front ray is short at speed) plus a no-braking rule variant; run E3.
- **Acceptance criteria:**
  - Driver documented and deterministic; results recorded per AI_EVALUATION.md.
- **Test requirements:**
  - Unit: decisions for known sensor inputs.

### P5-02 — Learned braking comparative study

- **Priority:** P1 · **Status:** Not Started · **Issue:** [#34](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/34) · **Stretch target:** ST4
- **Depends on:** P2-09, P4-04, P5-01
- **Description:** Run E5: paired no-brake vs brake training over 10 seeds, evaluated on held-out tracks, with lap time and collision comparisons and statistics.
- **Acceptance criteria:**
  - **Phase 5 acceptance (part):** a written conclusion on whether learned braking helps, supported by committed data, including a 'no clear difference' outcome if that is the result.
- **Test requirements:**
  - Experiment files and analysis script committed; analysis script unit-tested.

### P5-03 — Human vs AI racing

- **Priority:** P1 · **Status:** Not Started · **Issue:** [#35](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/35) · **Stretch target:** ST5
- **Depends on:** P1-08, P3-05
- **Description:** Race a human-driven car against a loaded model on the same track (simultaneous non-colliding cars, as selected by the owner; physical competition is R-01), with lap time comparison.
- **Acceptance criteria:**
  - Human and AI use the same physics and start; results screen shows both lap times, completion/failure and independent wall collisions; playable on iPhone.
- **Test requirements:**
  - Integration: AI car deterministic during races.
  - E2E: start and finish a race with touch controls.

### P5-04 — Generalisation test suite and report

- **Priority:** P1 · **Status:** Not Started · **Issue:** [#36](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/36)
- **Depends on:** P4-04, P4-05, P5-01
- **Description:** Run E6 across all agents on held-out tracks; publish a results page in AI_EVALUATION.md with limitations.
- **Acceptance criteria:**
  - **Phase 5 acceptance (part):** honest statement of whether models generalise to unseen circuits, with data.
- **Test requirements:**
  - Analysis reproducible from committed raw data.

### P5-05 — Model comparison dashboard

- **Priority:** P1 · **Status:** Not Started · **Issue:** [#37](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/37)
- **Depends on:** P4-05, P3-08
- **Description:** Extend the Phase 3 P3-08 comparison to repeated multi-track evaluation. Compare saved models side by side on shared evaluation tracks and seeds; refuse or warn when tracks, fitness version or physics differ.
- **Acceptance criteria:**
  - Comparison shows lap completion, collisions, lap time and spread; mismatched conditions warned.
- **Test requirements:**
  - Unit: compatibility rules.
  - E2E: compare two imported models.

### P5-06 — Training performance improvements

- **Priority:** P1 · **Status:** Not Started · **Issue:** [#38](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/38)
- **Depends on:** P3-07
- **Description:** Profile and speed up headless training (spatial grid for collision/rays, typed arrays, Web Worker if the UI stutters), without changing results.
- **Acceptance criteria:**
  - Before implementation, record target device/browser, workload and responsiveness budget in the issue. Publish before/after FPS, mean/p95 update cost and simulation throughput under the same configuration; the agreed budget and determinism checks pass. Adopt a Worker only if profiling demonstrates main-thread blocking.
- **Test requirements:**
  - Benchmark script; existing determinism tests.

## Process

**Phase acceptance:** Every feature is reviewed and verified against the same Definition of Done.

### Q-01 — Definition of Done and independent review workflow

- **Priority:** P0 · **Status:** In Review · **Issue:** [#39](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/39)
- **Depends on:** none
- **Description:** Adopt AGENTS.md completion criteria: Claude Code implements approved tasks and addresses findings; Codex independently reviews the current commit through GitHub review comments. Include actual tests, relevant device checks and explicit owner merge approval. A formal same-account approval badge is not required.
- **Acceptance criteria:**
  - PR template in `.github/`; every feature PR lists roadmap ID, actual command results, manual checks done/outstanding, current head SHA, Codex review link/outcome and the owner's separate merge-approval reference. Later commits receive re-review; no agent merges automatically.
- **Test requirements:**
  - Documentation consistency checks and independent review; no simulator/mobile checks apply to this documentation-only PR. Owner approval is outstanding.

## Phase 6 — Optional advanced research (9/10, not approved)

Documented and tracked only. **Do not implement without explicit approval.** All eight entries are **Blocked** by approval; technical dependencies are additional. Issue creation and the phase-6 label are tracking aids, not authorization. IDs R-01–R-08 are permanent.

### R-01 — Multi-car competitive racing

- **Phase:** 6 · **Priority:** P2 · **Status:** Blocked · **Issue:** [#43](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/43)
- **Depends on:** P5-03, P1-06; explicit owner approval before implementation
- **Description:** Multi-car competitive racing is an optional 9/10 research extension; this entry authorizes documentation only.
- **Acceptance criteria:** After explicit approval, implement deterministic car-car collisions and fair starts; demonstrate repeatable multi-car race results and record collision and lap metrics.
- **Test requirements:** Unit/integration: collisions and simultaneous events; repeated-seed race; mobile performance checks.

### R-02 — Overtaking and collision avoidance

- **Phase:** 6 · **Priority:** P2 · **Status:** Blocked · **Issue:** [#44](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/44)
- **Depends on:** R-01, P2-01; explicit owner approval before implementation
- **Description:** Overtaking and collision avoidance is an optional 9/10 research extension; this entry authorizes documentation only.
- **Acceptance criteria:** After approval, compare a driver observing other cars against a frozen baseline over at least 10 seeds; report overtakes, collisions and completion on unseen traffic scenarios. Version changed observations and model compatibility.
- **Test requirements:** Occlusion/other-car sensors, stationary and moving hazards, seeded scenario replay.

### R-03 — NEAT neural architecture evolution

- **Phase:** 6 · **Priority:** P2 · **Status:** Blocked · **Issue:** [#45](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/45)
- **Depends on:** P2-04, P2-07, P5-04; explicit owner approval before implementation
- **Description:** NEAT neural architecture evolution is an optional 9/10 research extension; this entry authorizes documentation only.
- **Acceptance criteria:** After approval, support topology evolution and compare against the fixed 9-12-3 baseline under matched evaluation budgets and held-out tracks; record topology sizes and statistical uncertainty.
- **Test requirements:** Innovation/speciation consistency, topology evaluation, seeded evolution, new model-format validation.

### R-04 — Changing tyre grip and road conditions

- **Phase:** 6 · **Priority:** P2 · **Status:** Blocked · **Issue:** [#46](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/46)
- **Depends on:** P1-05, P4-01, P5-04; explicit owner approval before implementation
- **Description:** Changing tyre grip and road conditions is an optional 9/10 research extension; this entry authorizes documentation only.
- **Acceptance criteria:** After approval, add versioned grip conditions and appropriate physics; report completion, collisions and lap times across at least three grip settings using repeated seeds.
- **Test requirements:** Grip-force limits, boundary transitions, deterministic scenarios and model compatibility.

### R-05 — Weather and moving obstacles

- **Phase:** 6 · **Priority:** P2 · **Status:** Blocked · **Issue:** [#47](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/47)
- **Depends on:** P1-06, P2-01, P5-04; explicit owner approval before implementation
- **Description:** Weather and moving obstacles is an optional 9/10 research extension; this entry authorizes documentation only.
- **Acceptance criteria:** After approval, introduce seeded time-varying conditions and obstacles; compare completion/collision metrics with frozen baselines over at least 10 seeds and held-out scenario schedules.
- **Test requirements:** Swept moving collisions, sensor visibility, schedule replay, pause/resume equivalence.

### R-06 — Multi-track evolutionary training

- **Phase:** 6 · **Priority:** P2 · **Status:** Blocked · **Issue:** [#48](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/48)
- **Depends on:** P4-04, P2-07, P5-04; explicit owner approval before implementation
- **Description:** Multi-track evolutionary training is an optional 9/10 research extension; this entry authorizes documentation only.
- **Acceptance criteria:** After approval, compare single-track training with a documented multi-track schedule under equal total simulation-tick budgets and at least 10 seeds; report held-out generalisation, not just training fitness.
- **Test requirements:** Track scheduling determinism, no validation/test leakage, budget accounting and per-track fitness aggregation.

### R-07 — Autonomous traffic navigation

- **Phase:** 6 · **Priority:** P2 · **Status:** Blocked · **Issue:** [#49](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/49)
- **Depends on:** R-02, R-05, P4-01; explicit owner approval before implementation
- **Description:** Autonomous traffic navigation is an optional 9/10 research extension; this entry authorizes documentation only.
- **Acceptance criteria:** After separate design approval, define junction and traffic-rule scenarios and measure route completion, rule violations and collisions across at least 10 seeds including unseen routes.
- **Test requirements:** Right-of-way scenarios, route progress, traffic interactions and seeded replay.

### R-08 — Evolutionary training comparisons

- **Phase:** 6 · **Priority:** P2 · **Status:** Blocked · **Issue:** [#50](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/50)
- **Depends on:** P2-07, P5-04; explicit owner approval before implementation
- **Description:** Evolutionary training comparisons is an optional 9/10 research extension; this entry authorizes documentation only.
- **Acceptance criteria:** After approval, compare at least two evolutionary methods/settings using matched total evaluation budgets, the same track splits and at least 10 seeds; publish effect sizes, uncertainty and negative findings.
- **Test requirements:** Budget accounting, deterministic configuration replay and analysis verification; R-03 is additionally required only if NEAT is selected.

## Cross-cutting engineering practices

These apply to every phase and are checked in review.

- **Reproducibility:** fixed timestep (P1-02), simulation separate from rendering, seeded PRNG (P1-03), determinism tests for physics (P1-09) and evolution (P2-04, P2-05), and a recorded configuration for every experiment (P2-07).
- **Performance:** measure FPS and step time (P3-07). Cache the static track layer (P1-04). Train fast without drawing every frame (P3-03). Use a Web Worker only if measurements show UI stutter (P5-06). Pause and resume on iOS tab suspension (P1-02, P3-03), with training checkpoints (P3-07).
- **Transparency:** inputs and outputs documented (ARCHITECTURE.md), per-car sensor inspection (P2-01), champion decision overlay (P3-04), inference kept separate from evolution (P2-03), and mutation and population settings recorded (P2-07).
- **Generalisation:** separate training, validation and held-out fixtures (P2-10; expanded in P4-04) with varied corner geometry, braking compared across circuits (P5-02), and limitations documented honestly (P5-04).
- **Code quality:** modular strict TypeScript, import-boundary lint rules, unit and integration tests mirrored under `tests/`, required CI (P1-10), one branch and PR per feature, no paid dependencies.

## Architectural risks and open concerns

1. **Braking may not matter.** With a simple kinematic model and drag, releasing the throttle may be enough to take every corner. Then ST4 cannot show a benefit, whatever the network does. P2-09 checks this before the braking study.
2. **Cross-engine determinism.** `Math.sin` and `Math.cos` can differ between JavaScript engines, so "same seed, same result" is guaranteed only within one engine. Run statistical experiments headless in Node, and do not compare runs across browsers.
3. **Reward exploitation.** The fitness guards (P2-06) must be tested before any training results are trusted.
4. **iOS Safari limits.** Background tabs are suspended, localStorage can be evicted, and older phones may be slow. P3-03, P3-07 and MODEL_FORMAT.md address this. Real-device checks are needed because Playwright WebKit is only an approximation.
5. **Overfitting to one track.** P2-10 supplies split fixtures before experiments; no generalisation claim is permitted until the frozen held-out evaluation is run. Selecting training circuits is required; multi-track evolutionary training remains R-06.
6. **Scope.** 49 roadmap items including blocked research is a lot for a beginner-friendly codebase. Keep each PR to one roadmap ID where possible.

## Revision history

| Date | Change |
|------|--------|
| 2026-10-23 | Initial documentation work in Claude Code PR #40; verified main had no code and created issues #1–#39. |
| 2026-10-23 | Codex reconciliation preserves existing work; adds issues #41–#50, early evaluation fixtures and Phase 3 comparison, requires full model provenance, separates research training, and makes completion/recovery evidence explicit. |
| 2026-10-23 | Owner selects Claude Code as main developer and Codex as reviewer, using explicit commit-specific technical approval in GitHub comments and separate owner merge approval. Role/workflow changes are proposed in a dedicated follow-up PR; feature statuses are unchanged. |
