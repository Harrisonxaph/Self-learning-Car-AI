# Roadmap — Self-Driving AI Evolution

A free, browser-based sandbox where 2D cars learn steering, acceleration and braking through small neural networks evolved by a genetic algorithm. It runs on iPhone, iPad and desktop browsers and uses Vite, TypeScript and Canvas 2D, with no paid AI APIs. Target complexity is **8/10**, with optional **9/10** research extensions in Phase 6.

## Verified project status

_Last verified: 2026-11-07, against `main` at `0ed3811` (#120 merged: P2-09 completion record) for the P2-09 records; the rest of this table was last verified 2026-11-02 at `757e27d` with the active ruleset 26312591._

| Area | State |
|------|-------|
| Application code | Phase 1 features (P1-01 to P1-11): a Vite + strict TypeScript static page with a responsive Canvas 2D track, a fixed-timestep simulation (seeded generator, vehicle physics, collision, checkpoints and laps), and manual driving by keyboard and touch. P2-01 ray sensors (with a `?debug=rays` debug layer) are Complete (#79, with owner-reported iPhone and iPad checks on the production site). P2-02's nine network inputs are Complete (#81). P2-03's 9-12-3 network (pure inference and seeded initialisation; it drives cars through the P2-05 trainer) is Complete (#82). P2-04's genetic operators (tournament selection, uniform crossover, Gaussian mutation, elitism over flat genomes) are Complete (#84). P2-06's episode fitness and termination rules are Complete (#85). P2-05's population training loop (headless, and rendered with `?mode=train`) is Complete (#86, with owner-reported iPhone and iPad checks on the production site). P2-10's built-in track splits (training `stadium-oval`, validation `rounded-rectangle`, held-out `hairpin-chicane`, with a hashed manifest and enforced split boundaries) are Complete (#88, with a retrospective Codex technical approval). P2-07's seeded experiment runner (`npm run experiment`: complete JSON records and same-engine replay) is Complete (#89). P2-08 (baselines and the controlled study) is Complete: plan step 2 (seeded A1/A7 random drivers and a headless `evaluateDriver` sharing the trainer's per-tick path) is merged in #96, step 3 tooling is merged (#99–#106, `main` at `c14f368`), and the step 4 exploratory pilot ([authorised](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/19#issuecomment-6575209368); manifests and protocol in #107) has been run on seeds 9001–9003, with its artifacts merged in #108 (`docs/experiments/p2-08-plan.md`). The step 5 confirmatory manifest and protocol are merged (#109), and the confirmatory study has been [run with the owner's approval](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/19#issuecomment-6581307850) on seeds 1001–1010. Its analysis decision is `supported` ("outperforms equal-budget random search" on the training track only), and the results are merged in #110 (`experiments/results/p2-08/confirmatory/`). On the validation track A5 did not outperform A8 (descriptive), and the held-out track is untouched. |
| Tests and CI | `package.json` scripts, ESLint with architecture boundary rules, Vitest unit tests (including the P1-09 golden determinism suite) and Playwright browser tests in six Chromium/WebKit desktop, phone and tablet projects, against `vite preview` and a plain static file server. GitHub Actions CI (P1-10, #60) runs all of them on every pull request and push to `main`. Since 2026-11-01 the active ruleset "Protect main" requires pull requests and both CI jobs before merging into `main`, with no bypass ([verified by Codex](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/10#issuecomment-6559229702); [confirmed by the owner](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/10#issuecomment-6559346059)), so P1-10 is Complete. |
| Deployment | The owner's Vercel Git integration builds a preview deployment for every pull request and a production deployment from `main`. The production deployment of `38ff6a6` (#72's merge) was observed as Ready through the Vercel API on 2026-10-24. The owner has loaded previews on a real iPhone 15 and iPad Pro in Safari (P1-02, P1-04, P1-08 records). P1-11 is Complete (#74). |
| Planning docs | Added by this roadmap PR: `AGENTS.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/AI_EVALUATION.md`, `docs/MODEL_FORMAT.md`, `docs/TESTING.md`. |
| GitHub issues | Existing issues #1–#39 are preserved. Reconciliation adds #41–#50 for two missing primary-release entries and eight approval-gated research entries; #40 is the existing documentation PR. |
| AI learning results | One preregistered result (P2-08, #110): evolved A5 frozen models **outperform equal-budget random search (A8) on ordered progress on the training track** (mean 0.590 laps, 95% interval [0.495, 0.690], 10 seeds). That is the only claim. On the validation track A5 did not outperform A8 (A5 − A8 −0.393, descriptive), so no generalisation is claimed, and held-out tracks are untested. The pilot (#108) is acceptance-ineligible. P2-09's E4 (#119, seeds 2001–2010) gave `no-direction` for A5 (braking) against A4 (no braking) on the training track (mean −0.015 lap, 95% interval [−0.040, +0.010]): no direction established. That is not a finding of equivalence or of no effect, and it is no evidence that learned braking helps or harms on any track. |

P1-01 to P1-11 are **Complete**, so **Phase 1 is Complete**. P2-01 (ray sensors) is **Complete** (#79, with owner-reported iPhone and iPad checks). P2-02 (network inputs) is **Complete** (#81). P2-03 (feedforward network) is **Complete** (#82). P2-04 (genetic operators) is **Complete** (#84). P2-06 (fitness function) is **Complete** (#85). P2-05 (training loop) is **Complete** (#86, with owner-reported iPhone and iPad checks of `?mode=train`). P2-10 (track splits) is **Complete** (#88; Codex's technical approval of the merged head came after the owner's merge). P2-07 (experiments) is **Complete** (#89). P2-08 (baselines and the controlled study) is **Complete** (#94–#110; completion record below). Phase 2's acceptance criterion is evidenced on the training track only, and **Phase 2 is Complete** ([owner completion approval](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/20#issuecomment-6714786784), 2026-11-08): P2-01 to P2-10 are Complete, and P2-11 is conditional and not triggered (see "Phase 2 status"). Complete does not remove the recorded limits: the evidence is for one configuration on one training track, validation transfer was poor, held-out generalisation is untested, and E4 found no direction. P2-09 is **Complete** ([owner completion approval](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/20#issuecomment-6713504062); plan merged in #112 and #113; step 2 merged in #114; step 3 merged in #115; step 4, the feasibility run, merged in #116 with A2 met on the validation track only; step 5, the E4 tooling with no study run, merged in #117; step 6, the frozen E4 manifest and protocol, merged in #118; step 7, the E4 run on seeds 2001–2010, run once with every replay identical (outcome `no-direction`: no direction established on the training track, mean −0.015 lap with a 95% interval of [−0.040, +0.010]), merged in #119; step 8, the completion record, [authorised](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/20#issuecomment-6713051591) and merged in #120). P3-01 (training dashboard) is **Complete** (#124, #126; [owner completion approval](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/21#issuecomment-6719729872) and the completion record under P3-01): FPS and step-time instrumentation stays with P3-07. P3-02 to P3-07 are **Complete** ([#128](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/128), [#129](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/129), [#133](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/133), [#136](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/136), [#139](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/139), [#142](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/142)) on the owner's explicit completion approval, recorded under the changelog row of 2026-11-10 (P3 completion); owner-reported device checks without per-device results, and no measured frame-rate or step-time figures, are recorded as such in `docs/TESTING.md`. P3-08 (initial saved-model comparison) is **Complete** (#143, #145; [owner completion approval](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/42#issuecomment-6769697822) and the completion record under P3-08). P1-01 to P1-11, P2-01 to P2-10, **Phase 3 (P3-01 to P3-08) is Complete.** Phase 1's acceptance (drive, brake, crash, restart and complete laps on iPhone and iPad) is recorded under P1-08, and P1-10 closed Phase 1's last open item on 2026-11-01. The initial master specification is the owner's detailed project request; no separate specification was found. Re-verify this table against code and tests whenever statuses change.

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

Documentation-only checks are recorded as such; no application/device execution is implied. Q-01 was completed after independent review and the owner's explicit approval (see its entry). Missing relevant manual checks prevent application features from becoming Complete. Claude Code is now the main developer and Codex the independent reviewer; follow [AGENTS.md](../AGENTS.md) for commit-specific review comments, re-review after changes and owner merge approval. This role assignment supersedes earlier role descriptions; historical authorship remains recorded below.

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
| P1-01 | Project scaffold: Vite, TypeScript, lint and test tooling | 1 | P0 | Complete | — | [#1](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/1) |
| P1-02 | Fixed-timestep loop with simulation/render separation | 1 | P0 | Complete | P1-01 | [#2](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/2) |
| P1-03 | Seeded pseudorandom generator | 1 | P0 | Complete | P1-01 | [#3](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/3) |
| P1-04 | Track model and responsive Canvas 2D racetrack | 1 | P0 | Complete | P1-02 | [#4](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/4) |
| P1-05 | Vehicle physics: acceleration, steering, braking and drag | 1 | P0 | Complete | P1-02 | [#5](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/5) |
| P1-06 | Collision detection with track boundaries | 1 | P0 | Complete | P1-04, P1-05 | [#6](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/6) |
| P1-07 | Ordered checkpoints, lap counting and lap timing | 1 | P0 | Complete | P1-04, P1-05 | [#7](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/7) |
| P1-08 | Manual driving with keyboard and mobile touch controls | 1 | P0 | Complete | P1-05, P1-06, P1-07 | [#8](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/8) |
| P1-09 | Deterministic physics test suite | 1 | P0 | Complete | P1-03, P1-05, P1-06, P1-07 | [#9](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/9) |
| P1-10 | GitHub Actions CI | 1 | P0 | Complete | P1-01 | [#10](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/10) |
| P1-11 | Vercel deployment compatibility | 1 | P1 | Complete | P1-01 | [#11](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/11) |
| P2-01 | Seven forward ray sensors | 2 | P0 | Complete | P1-06 | [#12](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/12) |
| P2-02 | Nine network inputs: rays, speed and checkpoint heading error | 2 | P0 | Complete | P2-01, P1-07 | [#13](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/13) |
| P2-03 | Feedforward network 9-12-3 with independent steering, throttle and brake | 2 | P0 | Complete | P1-01 | [#14](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/14) |
| P2-04 | Genetic operators: selection, crossover, mutation and elitism | 2 | P0 | Complete | P1-03, P2-03 | [#15](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/15) |
| P2-05 | Population training loop over multiple generations (headless and rendered) | 2 | P0 | Complete | P2-02, P2-04, P2-06 | [#16](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/16) |
| P2-06 | Fitness function with anti-exploitation guards | 2 | P0 | Complete | P1-07 | [#17](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/17) |
| P2-07 | Seeded training experiments and configuration recording | 2 | P0 | Complete | P2-05, P2-10 | [#18](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/18) |
| P2-08 | Random-driving baselines and controlled improvement experiment | 2 | P0 | Complete | P2-07 | [#19](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/19) |
| P2-09 | Braking output experiment toggle and braking feasibility check **(ST4)** | 2 | P1 | Complete | P2-03, P2-05, P2-07, P2-10 | [#20](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/20) |
| P2-10 | Built-in track splits and evaluation fixtures | 2 | P0 | Complete | P1-04, P1-07 | [#41](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/41) |
| P2-11 | Spatial index for boundary collision and ray queries | 2 | P1 | Not Started | P1-06, P2-01 | [#56](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/56) |
| P3-01 | Training dashboard: generation, population, collision and lap metrics | 3 | P1 | Complete | P2-05 | [#21](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/21) |
| P3-02 | Live training fitness graph and analytics **(ST2)** | 3 | P1 | Complete | P3-01 | [#22](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/22) |
| P3-03 | Training speed controls, pause/resume and accelerated headless mode | 3 | P1 | Complete | P2-05 | [#23](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/23) |
| P3-04 | Champion replay with sensor and decision overlay | 3 | P1 | Complete | P2-05 | [#24](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/24) |
| P3-05 | Save and load champion brain (localStorage) **(ST1)** | 3 | P0 | Complete | P2-03, P2-07 | [#25](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/25) |
| P3-06 | JSON export/import, validation, versioning and compatibility checks **(ST1)** | 3 | P0 | Complete | P3-05 | [#26](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/26) |
| P3-07 | Performance monitoring, iOS suspension handling and training checkpoints | 3 | P1 | Complete | P3-03, P3-06, P1-03 | [#27](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/27) |
| P3-08 | Initial saved-model comparison | 3 | P1 | Complete | P3-04, P3-06 | [#42](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/42) |
| P4-01 | Track data format and validation | 4 | P1 | Complete | P1-04, P1-07 | [#28](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/28) |
| P4-02 | Touch-friendly interactive track editor **(ST3)** | 4 | P1 | Not Started | P4-01, P1-08 | [#29](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/29) |
| P4-03 | Save and load custom tracks **(ST3)** | 4 | P1 | Not Started | P4-01, P4-05 | [#30](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/30) |
| P4-04 | Training, validation and held-out track sets | 4 | P1 | Not Started | P4-01, P2-10 | [#31](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/31) |
| P4-05 | Evaluate trained models on unfamiliar tracks | 4 | P1 | Not Started | P4-04, P3-05 | [#32](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/32) |
| P4-06 | Silverstone: first real-world circuit (import, validation and selection) | 4 | P1 | Not Started | P4-01, P2-10, P2-05, P2-07, P3-05 | [#57](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/57) |
| P4-07 | Camera zoom and follow for large circuits | 4 | P1 | Not Started | P1-04, P2-05 | [#58](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/58) |
| P5-01 | Rule-based baseline driver | 5 | P1 | In Progress | P2-02, P2-07, P2-10 | [#33](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/33) |
| P5-02 | Learned braking comparative study **(ST4)** | 5 | P1 | Not Started | P2-09, P4-04, P5-01 | [#34](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/34) |
| P5-03 | Human vs AI racing **(ST5)** | 5 | P1 | Not Started | P1-08, P3-05 | [#35](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/35) |
| P5-04 | Generalisation test suite and report | 5 | P1 | Not Started | P4-04, P4-05, P5-01 | [#36](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/36) |
| P5-05 | Model comparison dashboard | 5 | P1 | Not Started | P4-05, P3-08 | [#37](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/37) |
| P5-06 | Training performance improvements | 5 | P1 | Not Started | P3-07 | [#38](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/38) |
| Q-01 | Definition of Done and independent review workflow | Process | P0 | Complete | — | [#39](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/39) |

## Ready now vs waiting

Dependencies are taken from the table above.

- **In review:** none in Phase 3; P3-02 to P3-07 were completed on the owner's explicit approval (see the 2026-11-10 changelog row).
- **Complete:** P1-02 (fixed-timestep loop, #62), P1-03 (seeded generator, #64), P1-04 (track model and static track layer, #65), P1-05 (vehicle physics, #66), P1-06 (collision detection, #67), P1-07 (checkpoints and laps, #69), P1-08 (manual driving, #70), P1-09 (deterministic simulation suite, #72), P1-01 (scaffold, #55, with a retrospective Codex review), P1-10 (CI, #60, with a retrospective Codex review; merge-blocking verified from `main`'s ruleset on 2026-11-01), P1-11 (static deployment, #74), P2-02 (network inputs, #81), P2-03 (feedforward network, #82), P2-04 (genetic operators, #84), P2-06 (fitness function, #85), P2-10 (track splits, #88, with a retrospective Codex technical approval), P2-01 (ray sensors, #79) and P2-05 (training loop, #86), both with owner-reported iPhone and iPad checks,, P2-07 (experiments, #89), P2-08 (baselines and the controlled study, #94–#110; the claim is training-track only) and P2-09 (braking toggle and feasibility check, #112–#120; E4 `no-direction`), P3-01 (training dashboard, #122–#126), P3-02 to P3-07 (#128, #129, #133, #136, #139, #142; owner completion approval 2026-11-10, with the criterion decisions recorded under each item) and P3-08 (#143, #145).
- **Ready now (all dependencies Complete or merged):** P4-02 (track editor, with P1-08), P4-04 (track sets, with P2-10) and P4-06 (Silverstone, with its other Complete dependencies) now that P4-01 is Complete; P4-03 also needs P4-05. P4-07 and P5-01 were ready before. No further P2-09 study run is authorised. Ready means the dependencies are met, not that implementation is authorised.
- **Silverstone (approved 2026-10-23, planning only):** P4-06 (Silverstone import) after P4-01, P2-10, P2-05, P2-07 and P3-05; P2-11 (spatial index, after P1-06 and P2-01) only if P4-06's measured baseline misses the budget or the owner approves an architectural reason; P4-07 (camera) after P1-04 and P2-05, as a separate follow-up. Each still needs explicit owner implementation approval when its dependencies are complete; this planning approval does not authorise implementation. None of these interrupts the current phase.
- **Phase 2 critical path:** P1-06 → P2-01 → P2-02, and P1-07 → P2-06, then P2-04 → P2-05 → P2-07 → P2-08.
- **Early evaluation:** P1-04 + P1-07 → P2-10 supplies built-in training/validation/held-out fixtures before P2-07/P2-08; the editor is not a prerequisite.
- **Later work:** follow the explicit dependency table rather than treating every earlier phase as a blanket blocker. Phase 4 track validation/editor work can proceed after its Phase 1 prerequisites; dashboard and persistence wait for their respective inference/trainer/experiment dependencies. P3-08 supplies Phase 3 comparisons; P5-05 extends them.
- **Research:** R-01–R-08 require explicit approval and their listed technical dependencies; no research implementation is ready under the current authorization.

## Phase 1 — Simulation foundation

**Phase acceptance:** A user can drive, brake, crash, restart and complete laps using an iPhone or iPad.

### P1-01 — Project scaffold: Vite, TypeScript, lint and test tooling

- **Priority:** P0 · **Status:** Complete · **Issue:** [#1](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/1)
- **Depends on:** none
- **Description:** Create the Vite + strict TypeScript project for Node 24 with ESLint (including import-boundary rules), Vitest, Playwright, the `src/` and `tests/` layout from ARCHITECTURE.md and the npm scripts from TESTING.md.
- **Acceptance criteria:**
  - `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` and `npm run test:e2e` all exist and succeed on a clean clone.
  - An empty page shows a responsive canvas on desktop and iPhone Safari.
  - `package-lock.json` committed; runtime dependencies pinned exactly.
- **Test requirements:**
  - One smoke unit test and one Playwright smoke test (Chromium and WebKit).
- **Completion record (#55, merged by the owner at `5a3e494`; reviewed head `9ba08e8`):**
  - Automated, local (2026-10-23, Node 24.22.1, clean clone): `npm ci`, lint, typecheck, 29 unit tests, build and the 9 Chromium browser tests passed. WebKit could not run locally then.
  - CI: WebKit first ran on #60 ([run 39985079357](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/39985079357)), whose application code is identical to P1-01's: 18/18 browser tests passed, including desktop, iPhone 13 and iPad WebKit. `main` at #60's merge `ab1436c` passed ([run 39986957905](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/39986957905)).
  - Real devices (owner-reported, [record](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/62#issuecomment-6371615878), on the Vercel preview of `c3c7b0c` in Safari): iPhone 15 (iOS 27.0.1, 24A446) and iPad Pro 11-inch, 3rd generation (iPadOS 26.6.2, 23G90) loaded the page, fitted it without scrolling and refitted on rotation. `src/render/viewport.ts` and `src/style.css` are identical between P1-01 and that build, so this is attributed evidence for P1-01's responsive canvas, not a separate device test of `9ba08e8`.
  - Independent review: Codex's automated receipt on `9ba08e8` at the time, then a retrospective [Codex technical approval of `9ba08e8`](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/55#pullrequestreview-5638978594), posted on 2026-10-24 and not backdated. Codex reran `npm ci`, lint, typecheck, the 29 unit tests, the build and all 18 browser tests (six Chromium/WebKit projects) on that SHA, and accepted the attributed device evidence above.
  - Owner merge approval: #55 merged by the owner.

### P1-02 — Fixed-timestep loop with simulation/render separation

- **Priority:** P0 · **Status:** Complete · **Issue:** [#2](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/2)
- **Depends on:** P1-01
- **Description:** Accumulator loop that steps `world.step(DT)` at a fixed 1/60 s, caps steps per frame, renders once per frame, and pauses on `visibilitychange`. Simulation modules have no DOM imports.
- **Acceptance criteria:**
  - Simulation state after N ticks is identical whatever the render frame rate.
  - Hiding then showing the tab does not cause a catch-up jump.
  - Lint rule blocks DOM/render imports from `src/sim`.
- **Test requirements:**
  - Unit: same tick count gives the same state with simulated 30/60/120 Hz frame timings.
  - E2E: pause on hidden tab.
- **Completion record (#62, merged by the owner at `0706ad2`; reviewed head `c3c7b0c`):**
  - Automated: lint, typecheck, 53 unit tests and build passed locally. [CI run 39998203123](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/39998203123) passed with 30/30 browser tests, including desktop, iPhone 13 and iPad WebKit.
  - Real devices ([record](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/62#issuecomment-6371615878), owner-reported, on the Vercel preview of `c3c7b0c` in Safari): iPhone 15 (iOS 27.0.1, 24A446) and iPad Pro 11-inch, 3rd generation (iPadOS 26.6.2, 23G90). Load and fit, screen lock, app switch and rotate all passed, with no catch-up jump.
  - Independent review: [Codex technical approval of `c3c7b0c`](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/62#pullrequestreview-5632630779), after running lint, typecheck and all 30 browser tests itself.
  - Owner merge approval: #62 merged by the owner.

### P1-03 — Seeded pseudorandom generator

- **Priority:** P0 · **Status:** Complete · **Issue:** [#3](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/3)
- **Depends on:** P1-01
- **Description:** Add `src/utils/rng.ts` (mulberry32 or sfc32, documented choice) with helpers for uniform floats, ranges, Gaussian and integer picks. All sim/AI/evolution randomness uses it.
- **Acceptance criteria:**
  - Same seed gives identical sequences; first values pinned in tests.
  - No `Math.random()` in sim, sensors, ai, evolution or training (lint rule).
- **Test requirements:**
  - Unit: determinism, ranges, Gaussian mean and variance within tolerance over 10k samples.
- **Choice:** sfc32 (128-bit state) seeded by splitmix32 with 12 warm-up outputs, recorded as `RNG_ALGORITHM = 'sfc32-splitmix32-v1'`. Chosen over mulberry32 for its larger state and period. Seeds are integers from 0 to 4294967295; invalid seeds throw. `getState()` and `restoreRng()` provide checkpoint state; persisting it belongs to P3-07. Usage rules are in ARCHITECTURE.md, "Randomness".
- **Completion record (#64, merged by the owner at `c5fe051`; reviewed head `c0416c0`):**
  - Automated: lint, typecheck, 124 unit tests and build passed locally; [CI run 40008147161](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/40008147161) passed, including WebKit browser tests.
  - Pinned outputs match an independent Python reference; Codex independently matched 1,000 outputs for each of 4 seeds.
  - Devices: not applicable. The generator is headless with no callers; real-device checks start once it affects the simulator (P1-05 onward). Codex agreed.
  - Independent review: [Codex technical approval of `c0416c0`](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/64#pullrequestreview-5633237539), after it ran all checks itself.
  - Owner merge approval: #64 merged by the owner.

### P1-04 — Track model and responsive Canvas 2D racetrack

- **Priority:** P0 · **Status:** Complete · **Issue:** [#4](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/4)
- **Depends on:** P1-02
- **Description:** Track type (inner/outer boundary polylines, start pose, ordered checkpoint gates) with one built-in track, rendered responsively with capped devicePixelRatio and a cached static track layer.
- **Acceptance criteria:**
  - Track fills the screen on iPhone portrait and landscape, iPad and desktop without distortion.
  - Static layer is redrawn only on resize.
- **Test requirements:**
  - Unit: track loading and coordinate scaling.
  - E2E: canvas visible at mobile and desktop viewports.
- **Built:** `stadium-oval` (214 m × 94 m) in `src/data/tracks/`, loaded by `sim/track.ts`, fitted with one uniform scale and a margin by `render/trackView.ts`, and drawn once into a cached layer by `render/trackLayer.ts`, rebuilt only on resize, pixel-ratio change or track change. Gates and start pose are data only; their behaviour is P1-05/P1-07.
- **Completion record (#65, merged by the owner at `26bf599`; reviewed head `7c61906`):**
  - Automated: lint, typecheck, 163 unit tests and build passed locally; [CI run 40011479878](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/40011479878) passed with 48/48 browser tests, including desktop, iPhone 13 and iPad WebKit.
  - Real devices ([record](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/65#issuecomment-6373080700), owner-reported, on the Vercel preview of `7c61906` in Safari): iPhone 15 (iOS 27.0.1, 24A446) and iPad Pro 11-inch, 3rd generation (iPadOS 26.6.2, 23G90). Fit without distortion, portrait/landscape rotation, no page scroll or zoom, and sharp lines all passed.
  - Independent review: [Codex technical approval of `7c61906`](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/65#pullrequestreview-5633514234), after it ran all checks itself.
  - Owner merge approval: #65 merged by the owner.

### P1-05 — Vehicle physics: acceleration, steering, braking and drag

- **Priority:** P0 · **Status:** Complete · **Issue:** [#5](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/5)
- **Depends on:** P1-02
- **Description:** Kinematic car model with throttle, brake, quadratic drag, rolling resistance and speed-dependent steering; constants in `src/sim/config.ts`.
- **Acceptance criteria:**
  - Throttle accelerates to a terminal speed; brake decelerates faster than coasting; speed never goes negative.
  - Car cannot turn while stationary.
- **Test requirements:**
  - Unit tests for each property above with fixed inputs over N ticks.
- **Built:** `sim/vehicle.ts` (kinematic bicycle, semi-implicit Euler) with constants in `sim/config.ts` matching MODEL_FORMAT.md, plus `maxLateralAcceleration` (high-speed steering limit) and `stopSpeed` (coasting to rest). `maxSpeed` is derived as the terminal speed. Headless only: cars are not yet placed in the world or drawn, so no visible behaviour changes. `npm run demo:vehicle` prints a scripted run.
- **Completion record (#66, merged by the owner at `998437e`; reviewed head `45b72bd`):**
  - Automated: lint, typecheck, 218 unit tests, build and `npm run demo:vehicle` passed locally; [CI run 40017368055](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/40017368055) passed at the first attempt with 48/48 browser tests, including desktop, iPhone 13 and iPad WebKit.
  - Review fixes: stable terminal-speed root for tiny drag, and heading normalisation for multi-turn and huge start headings (Codex findings on `03e5ab9` and `8784fbd`). `45b72bd` also made the existing P1-10 pause/resume browser test race-free after a WebKit timing failure, keeping its 5-tick limit.
  - Devices: not applicable. The physics is headless and the page is unchanged; real-device checks apply once cars are drawn and driven (P1-08).
  - Independent review: [Codex technical approval of `45b72bd`](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/66#pullrequestreview-5633928748), after it ran lint, typecheck and all 48 browser tests itself (and the unit tests, build and demo on the physics-identical `f1e74d7`).
  - Owner merge approval: #66 merged by the owner.

### P1-06 — Collision detection with track boundaries

- **Priority:** P0 · **Status:** Complete · **Issue:** [#6](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/6)
- **Depends on:** P1-04, P1-05
- **Description:** Test the car rectangle against boundary segments each tick, with swept checks so fast cars cannot tunnel through walls.
- **Acceptance criteria:**
  - Crash detected for every hand-made contact case; no tunnelling at maximum speed.
  - Crashed car stops and is flagged.
- **Test requirements:**
  - Unit: edge, corner, parallel and high-speed cases.
- **Built:** `sim/collision.ts`. The car's 4 × 2 m footprint (centred between the axles) must lie strictly inside the outer boundary and outside the inner one; touching a boundary counts as a crash. Each step is a swept check: the convex hull of the footprint before and after the step (sharp turns are split into slices of at most 0.05 rad) is tested against every boundary segment, which is exact for straight moves at any speed; turning sweeps also count a boundary within the arcs' bounded bulge (`turnMargin`, about 0.2 mm per default tick) as a hit, so they never miss a contact. On a hit the car stops at its last clear pose, speed 0, flagged `crashed`, and ignores further controls. Headless only: cars are not yet placed in the world or drawn, so the page is unchanged. `npm run demo:collision` prints three scripted crashes on the stadium oval.
- **Completion record (#67, merged by the owner at `31a1a43`; reviewed head `4fcf014`):**
  - Automated: lint, typecheck, 257 unit tests, build and `npm run demo:collision` passed locally; [CI run 40081115909](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/40081115909) passed at the first attempt with 48/48 browser tests, including desktop, iPhone 13 and iPad WebKit.
  - Review fix: Codex found a top-speed, full-lock tick on the stadium oval that clipped the inner wall by about 1 µm mid-step and was missed by the endpoint hull; turning sweeps now add the bounded arc margin (`turnMargin`), and that case is a regression test.
  - Devices: not applicable. Collision is headless and the page is unchanged (identical bundle); real-device checks apply once cars are drawn and driven (P1-08).
  - Independent review: [Codex technical approval of `4fcf014`](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/67#pullrequestreview-5637873593), after it verified the margin bound, reran its reproduction plus three reflected variants and ran lint, typecheck, 257 unit tests, the build and 48 browser tests itself.
  - Owner merge approval: #67 merged by the owner.

### P1-07 — Ordered checkpoints, lap counting and lap timing

- **Priority:** P0 · **Status:** Complete · **Issue:** [#7](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/7)
- **Depends on:** P1-04, P1-05
- **Description:** Gates crossed only in order and in the forward direction count; crossing gate 0 after the last completes a lap; lap time measured in simulation time.
- **Acceptance criteria:**
  - Out-of-order or backwards crossings are ignored.
  - Lap count and lap time are correct for a scripted lap.
- **Test requirements:**
  - Unit: in-order lap, back-and-forth on one gate, reverse lap, lap timing in ticks × DT.
- **Built:** `sim/checkpoints.ts`. The car's rear axle (its state position) is the reference point; a gate counts when that point's straight move between consecutive ticks crosses the gate segment forwards, from behind or on its line to strictly ahead, end points included. Only the next gate in order can count; gate 0's first forward crossing starts lap timing and each later one, after gates 1 … n−1 in order, completes a lap. Lap times are whole ticks (× DT for seconds). Each car has its own immutable `LapProgress`. `stepRacer` advances progress only by the move P1-06's collision check accepted, so a step rejected by a crash credits nothing. Headless only: the page is unchanged. `npm run demo:laps` prints three timed laps by a scripted driver.
- **Completion record (#69, merged by the owner at `0fbc742`; merged head `26fb7cf`):**
  - Automated: lint, typecheck, 288 unit tests, build and `npm run demo:laps` passed locally; [CI run 40088286445](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/40088286445) on the merged head passed at the first attempt with 48/48 browser tests, including desktop, iPhone 13 and iPad WebKit (also green on `f15398e`, run 40086972352).
  - Devices: not applicable. Checkpoints are headless and the page is unchanged (identical bundle); real-device checks apply once laps are shown and cars driven (P1-08).
  - Independent review: [Codex technical approval of `f15398e`](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/69#pullrequestreview-5638007429), after it ran every check itself plus 30,000 independent crossing and progress probes. Its two non-blocking notes were addressed in `26fb7cf`, which changes one documentation sentence and one test-helper line ending only; Codex's automated review of `26fb7cf` found no major issues, and its formal confirmation of that head is requested in the PR recording this completion.
  - Owner merge approval: #69 merged by the owner.

### P1-08 — Manual driving with keyboard and mobile touch controls

- **Priority:** P0 · **Status:** Complete · **Issue:** [#8](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/8)
- **Depends on:** P1-05, P1-06, P1-07
- **Description:** Human driver via the Driver interface: keyboard (arrows/WASD, space to brake, R to restart) and on-screen touch controls (steer left/right, accelerate, brake, restart) with 44 px targets and no page scroll or zoom during play.
- **Acceptance criteria:**
  - **Phase 1 acceptance:** a user can drive, brake, crash, restart and complete laps on iPhone and iPad.
  - Lap count and current/best lap time shown.
- **Test requirements:**
  - E2E: keyboard and touch (mobile viewport) drive, crash, restart, lap.
  - Manual: real iPhone and iPad Safari (record device).
- **Built:** manual driving through one fixed-tick path: `main.ts` reads held inputs through the human driver (`ai/drivers.ts`) and steps `sim/world.ts`, which runs physics, collision and lap progress; restart (R or the Restart button) resets the car and progress at the next tick, keeping the session's best lap. Keyboard (arrows/WASD, Space or ↓ to brake, R to restart) and 56 px touch buttons (steer left/right, brake, gas, restart), any combination at once, with pointer capture and release on cancel, blur, page hide and hidden. The car is drawn on its collision footprint with the next gate highlighted; the header shows lap count, current/last/best lap time, the next gate, speed and crash, restart, checkpoint and lap messages. No page scroll or zoom (`touch-action: none`, fixed-height layout).
- **Completion record (#70, merged by the owner at `b597e37`; merged head `25380c8`, an identical file tree):**
  - Automated: lint, typecheck, 331 unit tests and build passed locally, and the browser suite passed locally in Chromium (59 passed, 7 skipped by design). [CI run 40096285817](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/40096285817) on `25380c8` and [run 40096445158](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/40096445158) on `main` at `b597e37` both passed at the first attempt, including desktop, iPhone 13 and iPad WebKit emulation.
  - Real devices (owner-reported, [confirmation](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/70#issuecomment-6384920591) and [devices](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/70#issuecomment-6384944175)): iPhone 15 (iOS 27.0.1, 24A446) and iPad Pro 11-inch, 3rd generation (iPadOS 26.6.2, 23G90), in Safari. The owner confirmed the manual driving checks on both devices. The confirmation does not itemise the nine steps listed in #70 (drive, steer while accelerating, brake, crash, restart, rotate, app switch or lock and return, complete a lap) or name the tested deployment; the #70 preview and `main` serve the same file snapshot.
  - Independent review: [Codex technical approval of `25380c8`](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/70#pullrequestreview-5638438192), which also verified that `main` at `b597e37` has the same tree. It followed Codex's [full review of `f0c8da0`](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/70#pullrequestreview-5638318474) (Changes required, one P2: Space on the focused Restart button braked), fixed in `25380c8`. An earlier automated P2 (controls clipped at 320 px wide) was fixed in `f0c8da0` and verified by Codex. The approval was posted after the merge, and says so.
  - Owner merge approval: #70 merged by the owner. CI on the merged head was still running at the merge and passed afterwards.

### P1-09 — Deterministic physics test suite

- **Priority:** P0 · **Status:** Complete · **Issue:** [#9](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/9)
- **Depends on:** P1-03, P1-05, P1-06, P1-07
- **Description:** Golden tests that run a scripted control sequence and compare the full car state and lap events to stored expectations.
- **Acceptance criteria:**
  - Two runs with the same seed and inputs are bit-identical in Node.
  - Golden files documented and only regenerated deliberately.
- **Test requirements:**
  - The suite itself, in CI.
- **Built:** tests only; no simulator code changes.
  - Two seeded scenarios run through the whole world (`tests/sim/scenarios.ts`): *laps* (two clean timed laps with seeded speeds, steering offsets and brake pulses) and *crashes* (seeded open-loop controls, 8 crashes, each followed by a restart).
  - `tests/sim/golden.test.ts` checks each scenario against rules from the documented behaviour, then compares its full final state, every lap/gate/crash/restart event and a hash of every 60-tick window with `tests/sim/golden/world.json`.
  - It also covers bit-identical repeat runs, seed sensitivity, two interleaved worlds sharing one track, deep-frozen states, and restart equivalence.
  - `tests/ui/frameLoopDeterminism.test.ts` runs the same scenarios through the real frame loop, drawing every frame, at six frame schedules, at the catch-up cap (with the dropped time counted) and across a hide/show pause, comparing every tick with the headless run.
  - The golden file is documented in `docs/TESTING.md` ("Golden files") and only rewritten with `npm run test:golden:update`.
- **Completion record (#72, merged by the owner at `38ff6a6`; reviewed head `fc2eda8`):**
  - Automated, local (Node 24.22.1, on `fc2eda8`): lint, typecheck, 356 unit tests, build (bundle hash unchanged from `main`), and the browser suite in Chromium (59 passed, 7 skipped by design). WebKit could not launch locally.
  - CI: [run 40103303780](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/40103303780) on `fc2eda8` passed at the first attempt, including the golden comparison under `CI=true` and the Chromium and WebKit browser tests. [Run 40109833771](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/40109833771) on `main` at `38ff6a6` also passed at the first attempt.
  - Deliberate-regeneration checks (local): a missing golden file fails with and without `-u`; an edited file fails with `-u` and is left unchanged; `CI=true npm run test:golden:update` refuses; a deliberate update reproduces the committed file byte for byte.
  - Devices: not applicable. Tests and docs only; the production bundle is byte-identical to `main` by hash.
  - Independent review: [Codex technical approval of `fc2eda8`](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/72#pullrequestreview-5638810706). Codex reran every check, including all 118 browser tests, and compared full serialised worlds after every tick of both scenarios. It also verified the two P2 findings from its automated review of `02ddbca` as fixed: golden-file writes (`942b974`) and the unfinished last window (`fc2eda8`).
  - Owner merge approval: #72 merged by the owner.

### P1-10 — GitHub Actions CI

- **Priority:** P0 · **Status:** Complete · **Issue:** [#10](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/10)
- **Depends on:** P1-01
- **Description:** Workflow on pull requests and `main`: `npm ci`, lint, typecheck, unit tests, build and Playwright (Chromium and WebKit).
- **Acceptance criteria:**
  - CI runs on every PR and blocks on failure.
  - Playwright reports uploaded on failure.
- **Test requirements:**
  - A deliberately failing test is shown to fail CI (in a throwaway branch).
- **Evidence and review (#60, merged by the owner at `ab1436c`; reviewed head `af6350b`):**
  - CI on the head ([run 39985079357](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/39985079357)): both jobs passed (29 unit tests; 18 browser tests including WebKit). `main` at the merge `ab1436c` passed ([run 39986957905](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/39986957905)).
  - Failing-test demonstration: throwaway draft #61 (`9153ead`, closed unmerged), [run 39985132458](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/39985132458). The unit-test step failed and the later build was skipped; the browser-test step failed; the Playwright report was uploaded (artifact 12515840672).
  - Devices: not applicable to the CI workflow itself.
  - Independent review: Codex's automated receipt on `af6350b` at the time, then a retrospective [Codex technical approval of `af6350b`](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/60#pullrequestreview-5638978813), posted on 2026-10-24 and not backdated. Codex inspected the workflow, both runs, the failure-propagation steps and the uploaded artifact.
  - Owner merge approval: #60 merged by the owner.
  - **Limit at the time:** CI failed on any failing step, as demonstrated. Whether a failing check *blocked merging* depended on branch protection, which was not configured or verifiable then, so P1-10 stayed In Review ([Codex finding](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/75#discussion_r4367820775)).
- **Merge-blocking evidence (2026-11-01):**
  - The owner set up the active ruleset ["Protect main" (26312591)](https://github.com/Harrisonxaph/Self-learning-Car-AI/rules/26312591): target exactly `refs/heads/main` with no exclusions; pull requests required with 0 required approvals (the shared-account convention); deletion and force-push blocked; empty bypass list. It requires the status checks `Lint, typecheck, unit tests and build` and `Browser tests (Chromium and WebKit, desktop and touch)`. Branches need not be up to date with `main` (optional; not part of the criterion).
  - Codex read the full ruleset through the API. Its [first record](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/10#issuecomment-6558905157) found the browser check missing (Changes required). After the owner added it, Codex [re-verified the ruleset and gave technical approval](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/10#issuecomment-6559229702) of the enforcement configuration.
  - Owner confirmation on #10: ["main's protection requires both CI checks"](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/10#issuecomment-6559346059).
  - Latest CI on `main`: [run 41310842372](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/41310842372) (#93's merge `3b57bd3`) and [run 41311774395](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/41311774395) (#94's merge `d42bb2a`), both jobs passing, including WebKit.
  - **Limit:** this verifies the saved, active ruleset together with the historical failing run on #61. No live failing PR was observed being refused, and no deliberate failure was introduced for it. The acceptance criterion was not changed.
- **Status:** Complete. Both acceptance criteria and the test requirement are met; devices are not applicable; independent review and owner merge approval are recorded above.

### P1-11 — Vercel deployment compatibility

- **Priority:** P1 · **Status:** Complete · **Issue:** [#11](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/11)
- **Depends on:** P1-01
- **Description:** Static build with correct base path and no server code; document deployment in the README. Do not add paid plans.
- **Acceptance criteria:**
  - `npm run build` output serves correctly from a static host; a Vercel preview loads on iPhone Safari.
- **Test requirements:**
  - E2E runs against `vite preview` of the production build.
- **Built:**
  - `tests/e2e/staticHost.ts` is a plain Node static file server over `dist/`, with no rewrites, fallbacks or server code. It mounts the build at `/` and at `/nested/app/`.
  - `tests/e2e/staticHost.spec.ts` (every Playwright project) checks both mounts. The page, script and stylesheet load from under the mount with no failed request or console error, the simulation starts and the track is drawn.
  - With `base: '/'` the sub-path test fails (`/assets/...` requested from the root), so it guards the relative base path.
  - The README gains a Deployment section: static `dist/`, no server code, any static host, and Vercel build settings (`npm run build`, `dist`, `npm ci`, Node 24.x) on the free plan.
  - The existing browser tests already run against `vite preview` of the production build (P1-01).
- **Existing deployment evidence (not new in P1-11):**
  - Vercel preview deployments were built for every PR from #55 on.
  - The owner loaded previews in Safari on a real iPhone 15 (iOS 27.0.1) and iPad Pro 11-inch, 3rd generation (iPadOS 26.6.2) for P1-02 ([record](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/62#issuecomment-6371615878), preview of `c3c7b0c`), P1-04 ([record](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/65#issuecomment-6373080700), `7c61906`) and P1-08 (#70, owner-reported).
  - Vercel API, read-only, 2026-10-24: the project uses Node.js 24.x with no framework preset. The production deployment of `main` at `38ff6a6` is Ready. Deployment protection (Vercel Authentication) covers all deployments except custom domains.
  - The project's build command, output directory and install command were not visible through the API, so they are not verified here.
- **Completion record (#74, merged by the owner at `52b835c`; reviewed head `0406567`):**
  - Automated, local (Node 24.22.1, on `0d5a5b7`, fresh `npm ci`): lint, typecheck, 356 unit tests, build (bundle unchanged from `main`), and the Chromium browser suite (65 passed, including the 6 new static-host tests; 7 skipped by design). WebKit could not launch locally. `0406567` changes only `docs/ROADMAP.md` relative to `0d5a5b7` (it merges #73).
  - CI: [run 40110560517](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/40110560517) on `0d5a5b7` and [run 40112890832](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/40112890832) on `0406567` passed, including the static-host tests in all six Chromium/WebKit projects.
  - Devices: the existing owner-reported iPhone 15 and iPad Pro Safari records of Vercel previews listed above. Codex accepted them as attributed evidence for "a Vercel preview loads on iPhone Safari", because the application is unchanged. No new physical-device test of #74's preview was made.
  - Independent review: [Codex technical approval of `0d5a5b7`](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/74#pullrequestreview-5638989177), after it reran every check, including 130 browser tests, and confirmed that missing and traversal requests are refused. Then [Codex technical approval of `0406567`](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/74#pullrequestreview-5639009846) after `main` was merged in.
  - Owner merge approval: #74 merged by the owner.
## Phase 2 — AI learning engine

**Phase acceptance:** Training runs over multiple generations and produces demonstrable improvement over random-driving baselines under controlled, seeded experiments. A negative or inconclusive experiment is reported honestly and leaves this phase acceptance unmet.

**Phase 2 status (assessed 2026-11-02, separately from P2-08; Phase 2 marked Complete 2026-11-08):**

- **Phase acceptance evidence:** met on the training track by P2-08 (#110). Controlled, seeded, preregistered results show improvement over random-driving baselines (A1, A7, A2) and over equal-budget random search (A8).
- **Limits carried forward:**
  - validation transfer was poor (descriptive);
  - held-out generalisation is untested and belongs to E6 (P5-04);
  - the result is for one configuration (C1) on one training track.
- **Phase 2 is Complete** ([owner completion approval](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/20#issuecomment-6714786784), 2026-11-08), on this basis:
  - **P2-09** (braking toggle and feasibility check, ST4, P1) is **Complete** ([owner completion approval](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/20#issuecomment-6713504062)): the plan and steps 2–7 are merged (#112–#119; the feasibility check ran once: A2 met on the validation track only, not shown on the training track; the E4 run gave `no-direction`: no direction established on the training track, mean −0.015 lap with a 95% interval of [−0.040, +0.010]). Its step 8 completion record (#120, below) evidences every AGENTS.md gate. That is a statement about the training track only, not evidence about unseen tracks, and ST4 must stay visible (P5-02 carries the learned-braking study).
  - **P2-11** (spatial index, P1) is Not Started. It is conditional on P4-06's measured budget or owner approval, so it does not block the phase unless triggered (not triggered as of 2026-11-07).
  - **Completion rule:** Phase 2 could be marked Complete only when P2-09 was Complete (or the owner explicitly re-scoped it) and the owner approved. P2-09 became Complete on 2026-11-07, and the owner's separate [Phase 2 approval](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/20#issuecomment-6714786784) followed on 2026-11-08. The owner approved Phase 2 as it stands on `main`; the limits above are not resolved by it and stay on record. P2-11 stays conditional (not triggered), and ST1 to ST5 stay visible.

### P2-01 — Seven forward ray sensors

- **Priority:** P0 · **Status:** Complete · **Issue:** [#12](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/12)
- **Depends on:** P1-06
- **Description:** Cast 7 rays (−90° to +90°) from the car against track boundaries, returning distance ÷ RAY_LENGTH (1 = clear).
- **Acceptance criteria:**
  - Distances match known geometry within 1e-9.
  - Rays can be drawn for any car (debug layer).
- **Test requirements:**
  - Unit: straight wall, angled wall, nothing in range, ray from inside a corner.
- **Implementation:**
  - **Plan and authorization:** follows the [revised plan](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/12#issuecomment-6390139856), which has Codex [technical approval as a plan](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/12#issuecomment-6390309481). The owner's instruction to implement it is [relayed on #12](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/12#issuecomment-6390752588).
  - **Code:** `src/sensors/rays.ts` (validated `SensorConfig` with `origin: "body-centre"`, `castRay`, `castRays`, `sensorOrigin`), `src/render/sensorView.ts` (debug layer), `src/ui/debugFlags.ts` (`?debug=rays`, off by default), wired in `src/main.ts` only.
  - **Tests:** `tests/sensors/rays.test.ts`, `tests/render/sensorView.test.ts`, `tests/ui/debugFlags.test.ts` and `tests/e2e/sensorDebug.spec.ts`.
  - **Review:** [Codex technical approval of `2391aba`](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/79#pullrequestreview-5640771501), with green CI (run 40142699454, including WebKit).
  - **Merged:** by the owner in #79 at `5c18365`, with the same tree as `f69d01c`, which has [Codex technical approval](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/79#pullrequestreview-5640915383) and green CI (run 40149613329).
- **Completion record:**
  - **Merge:** #79, merged by the owner at `5c18365` (same tree as `f69d01c`), with Codex technical approval of `2391aba` and of `f69d01c` and green CI (above).
  - **Device checks (owner-reported, not run by either agent; [record](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/12#issuecomment-6445527559), 2026-10-27):** on the production URL `https://self-learning-car-ai.vercel.app/` with `?debug=rays`:
    - **iPhone 15, iOS 27.0.1:** all four TESTING.md sensor-ray checks passed. The rays start at the car's centre and end on the walls or at full length through both curves, still line up after rotation, resume after switching apps, and without the flag the page is unchanged.
    - **iPad Pro 11-inch (3rd generation), iPadOS 26.6.2:** the owner confirms all requested sensor-ray checks passed.
    - **Limits:** the deployed commit was not verified, and no commit is assigned to these results. The iPad screenshot shows an in-app browser and does not establish standalone Safari testing on the iPad. The screenshots were supplied to Codex and are not attached on GitHub. These checks do not show learned driving.
    - **Superseded:** an earlier relayed record named an iPhone 15 Pro, a preview deployment and a production commit range; the owner's corrected report replaces it.
  - **Owner approval:** the owner's merge of #79.

### P2-02 — Nine network inputs: rays, speed and checkpoint heading error

- **Priority:** P0 · **Status:** Complete · **Issue:** [#13](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/13)
- **Depends on:** P2-01, P1-07
- **Description:** Build the 9-value input vector: 7 ray distances, forward speed ÷ MAX_SPEED and signed heading error to the next checkpoint ÷ π.
- **Acceptance criteria:**
  - All inputs within documented ranges; heading-error sign matches left/right.
- **Test requirements:**
  - Unit: known poses give known vectors.
- **Implementation:**
  - **Authorization:** the owner's instruction, [relayed on #13](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/13#issuecomment-6400122416), together with the input contract and test plan.
  - **Code:** `src/ai/inputs.ts` builds the nine inputs headlessly (`buildInputs`), with `INPUT_NAMES` and `INPUT_CONTRACT` (`seven-rays-speed-heading-v1`). The contract is in ARCHITECTURE.md, "Network inputs".
  - **Tests:** `tests/ai/inputs.test.ts`.
  - **Not changed:** `Observation` and the drivers. A neural driver will use the inputs in a later item.
  - **Device checks:** none apply. The inputs are headless; nothing is drawn and the page is unchanged.
- **Completion record:**
  - **Merge:** [#81](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/81), merged by the owner at `4f3abef`. Its tree is identical to the reviewed head `7bda450`.
  - **Review:** [Codex technical approval of `7bda450`](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/81#pullrequestreview-5645364135). Codex independently ran `npm ci`, lint, typecheck, 511 unit tests, the build, and all six browser projects (148 passed, 14 existing skips).
  - **CI:** green, including WebKit (run 40212259053).
  - **Tests:** 40 unit tests: known poses give known vectors, every input stays in range, and the heading-error sign matches left and right.
  - **Device checks:** not applicable. The module is headless, and the production assets are byte-identical to P2-01's.
  - **Owner approval:** the owner's merge, the first form of owner evidence in AGENTS.md.
  - **Dependency:** P2-01 was merged and still In Review for its own device checks when P2-02 was completed; it is now Complete. P2-02 uses only its headless ray readings.

### P2-03 — Feedforward network 9-12-3 with independent steering, throttle and brake

- **Priority:** P0 · **Status:** Complete · **Issue:** [#14](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/14)
- **Depends on:** P1-01
- **Description:** Pure inference module: flat parameter array (documented order), tanh hidden layer, outputs mapped to steering tanh, throttle sigmoid, brake sigmoid; optional brake mask.
- **Acceptance criteria:**
  - 159 parameters; hand-computed small network matches; outputs in range; inference does not import evolution code.
- **Test requirements:**
  - Unit: forward pass, parameter order, output ranges, brake mask.
- **Implementation:**
  - **Authorization:** the owner's instruction, [relayed on #14](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/14#issuecomment-6403981748), together with the plan.
  - **Code:**
    - `src/ai/network.ts`: the fixed 9-12-3 layout, the 159-parameter documented order, `evaluate`, `runNetwork` and `initialParameters` (seeded, `uniform-pm1-v1`).
    - `src/ai/outputs.ts`: tanh steering, sigmoid throttle and brake, and the brake mask.
    - The contract is in ARCHITECTURE.md, "Network".
  - **Tests:** `tests/ai/network.test.ts` and `tests/ai/outputs.test.ts`.
  - **Not changed:** no driver or vehicle wiring, which #14 does not require. No evolution, training or persistence.
- **Completion record:**
  - **Merge:** [#82](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/82), merged by the owner at `814d4e0`. Its tree is identical to the reviewed head `0042f5f`.
  - **Review:** [Codex technical approval of `0042f5f`](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/82#pullrequestreview-5645695024). Codex independently ran `npm ci`, lint, typecheck, 561 unit tests, the build, and all six browser projects (148 passed, 14 existing skips).
  - **CI:** green, including WebKit (run 40239101523).
  - **Tests:** 50 unit tests: hand-computed networks, a one-hot sweep of all 159 positions, output ranges, the brake mask and the inference/evolution separation.
  - **Device checks:** not applicable. The code is headless, and the production assets are byte-identical.
  - **Owner approval:** the owner's merge (AGENTS.md owner evidence).
  - **Known non-blocking finding, tracked in [#83](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/83):** `outputsToControls(null | undefined)` throws `TypeError` rather than `RangeError`. `runNetwork` is unaffected. The fix (`82c8cea`) was pushed after the merge and is not on `main`.

### P2-04 — Genetic operators: selection, crossover, mutation and elitism

- **Priority:** P0 · **Status:** Complete · **Issue:** [#15](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/15)
- **Depends on:** P1-03, P2-03
- **Description:** Tournament selection, uniform crossover, Gaussian mutation (rate and scale) and elitism over flat genomes, all using the seeded RNG.
- **Acceptance criteria:**
  - Elites copied unchanged; mutation rate 0 is identity; population size constant; same seed gives same next generation.
- **Test requirements:**
  - Unit tests for each operator and a determinism test.
- **Implementation:**
  - **Authorization:** the owner's instruction, [relayed on #15](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/15#issuecomment-6404455709), together with the operator choices and validation rules.
  - **Code:** `src/evolution/`, operator set `tournament-uniform-gaussian-v1`:
    - `genome.ts`: flat-genome checks and copies;
    - `selection.ts`: ranking and tournament selection;
    - `crossover.ts`: uniform crossover;
    - `mutation.ts`: Gaussian mutation;
    - `population.ts`: `resolveEvolutionConfig`, `createEvolutionRngs` and `nextGeneration` with elitism.
    - The contract is in ARCHITECTURE.md, "Evolution".
  - **Tests:** `tests/evolution/operators.test.ts` and `tests/evolution/population.test.ts`, using hand-scored fitness fixtures. The fitness function is P2-06.
  - **Not changed:** no training loop, fitness function, driving integration, dashboard or persistence.
- **Completion record:**
  - **Merge:** [#84](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/84), merged by the owner at `1a98ce9`. Its tree is identical to the reviewed head `d429872`.
  - **Review:** [Codex technical approval of `d429872`](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/84#pullrequestreview-5645791332), after its sparse-array finding on `1091494` was fixed in `d429872`.
    - Codex independently ran `npm ci`, lint, typecheck, 637 unit tests and the build on `d429872`.
    - It ran all six browser projects on `1091494` (148 passed, 14 existing skips) and confirmed the production assets are byte-identical after the fix.
  - **CI:**
    - On `d429872` (run 40242573267): both jobs green, including WebKit. The browser job finished after the merge.
    - On `main` at `1a98ce9` (run 40243046217): green.
  - **Tests:** 76 unit tests across the two evolution test files.
  - **Device checks:** not applicable. The code is headless, and the production assets are unchanged.
  - **Owner approval:** the owner's merge (AGENTS.md owner evidence).

### P2-05 — Population training loop over multiple generations (headless and rendered)

- **Priority:** P0 · **Status:** Complete · **Issue:** [#16](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/16)
- **Depends on:** P2-02, P2-04, P2-06
- **Description:** Trainer that evaluates a population under identical start conditions, records per-generation stats and versioned champion/configuration references for replay and builds the next generation; runs headless in Node and rendered in the browser.
- **Acceptance criteria:**
  - Runs ≥ 50 generations headless without errors; per-generation stats recorded.
  - Same seed and config give identical stats.
  - **Car independence (multi-car Option A):** every car has its own genome, vehicle state, checkpoint/lap/collision tracking and fitness. Cars never collide with, obstruct or sense each other (rays and collision test track boundaries only), so overlapping cars are allowed and starts stay fair. A car's episode result is bit-identical whether it is evaluated alone or within the population, in any population order.
- **Test requirements:**
  - Integration: 5-generation headless run is deterministic.
  - Integration: independence test (same genome alone vs in a shuffled population gives identical results).
- **Implementation:**
  - **Authorization:** the owner's instruction, [relayed on #16](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/16#issuecomment-6425226371), together with the lifecycle, independence, RNG and headless/rendered plan documented before coding.
  - **Code:**
    - `src/training/trainer.ts`: `createTrainer`, `runGeneration`, `trainHeadless`, `stepCar`, `stepGeneration` and `evaluateGenome`. It has per-generation statistics and champion copies, and a record of the configuration and version references.
    - `src/ui/trainingPage.ts` and `src/ui/pageMode.ts`: `?mode=train` runs the trainer under the frame loop.
    - `drawCars` in `src/render/raceView.ts`.
    - `OUTPUT_CONTRACT` in `src/ai/outputs.ts`.
    - `npm run demo:train`.
    - The contract is in ARCHITECTURE.md, "Training loop".
  - **Tests:**
    - `tests/training/trainer.test.ts`: lifecycle, independence, transitions and elites, a 5-generation determinism check, frame loop versus headless, 50 generations and separation;
    - `tests/training/trainingDemo.test.ts`;
    - `tests/ui/pageMode.test.ts` and `tests/ui/trainingPage.test.ts`;
    - `drawCars` tests;
    - `tests/e2e/training.spec.ts`.
  - **Not changed:** no dashboard, graphs, speed controls, saving or replay (Phase 3), and no experiments (P2-07, P2-08).
    - No learning is claimed: fitness rising in these runs is a training signal on one track.
    - With the defaults, 3 laps cannot fit in 60 s on the oval, so `completed` is unreachable there. This is recorded as a configuration fact.
  - **Device checks:** see the completion record.
  - **Merged:** [#86](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/86), by the owner at `de904ef`. Its tree is identical to the reviewed head `4e8c6d6`.
    - **Review:** Codex's automated review of `973ca8c` found one P1 (the training record omitted the physics), which was fixed in `4e8c6d6`. Codex then gave [technical approval of `4e8c6d6`](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/86#pullrequestreview-5658212513), including all six browser projects and WebKit iPhone 13 emulation.
    - **CI on `4e8c6d6`** (run 40389883365): both jobs green, including WebKit.
- **Completion record:**
  - **Merge:** #86, merged by the owner at `de904ef` (same tree as the Codex-approved `4e8c6d6`), with green CI (above).
  - **Device checks (owner-reported, not run by either agent; [record](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/16#issuecomment-6445530395), 2026-10-27):** on the production URL `https://self-learning-car-ai.vercel.app/` with `?mode=train`:
    - **iPhone 15, iOS 27.0.1:** manual controls and layout worked, training advanced from generation 8 to 9, and rotation and app-switch/resume passed. Against TESTING.md: the cars move and the status line counts generations, rotation passed, and the default page is manual driving. "The page stays responsive" is not stated separately for the iPhone.
    - **iPad Pro 11-inch (3rd generation), iPadOS 26.6.2:** the owner confirms all requested training checks passed; the screenshot shows generation 8.
    - **Limits:** the deployed commit was not verified, and no commit is assigned to these results. The iPad screenshot shows an in-app browser and does not establish standalone Safari testing on the iPad. The screenshots were supplied to Codex and are not attached on GitHub.
    - **No learning claim:** these checks show that training runs on the devices. They are not evidence of learned driving; controlled experiments (P2-08) are still needed.
    - **Superseded:** an earlier relayed record named an iPhone 15 Pro, a preview deployment and a production commit range; the owner's corrected report replaces it.
  - **Owner approval:** the owner's merge of #86.

### P2-06 — Fitness function with anti-exploitation guards

- **Priority:** P0 · **Status:** Complete · **Issue:** [#17](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/17)
- **Depends on:** P1-07
- **Description:** Fitness from ordered checkpoint progress, laps and completed-lap time bonus, with stall timeout, max episode time and no reward for distance or speed alone (AI_EVALUATION.md §6).
- **Acceptance criteria:**
  - Each exploit in §6 is scripted and cannot accumulate repeated credit without new valid ordered progress. Bounded legitimate partial progress is distinguished from farming.
  - Fitness formula versioned (`fitnessVersion`).
- **Test requirements:**
  - Unit: one test per exploit plus normal-lap scoring.
- **Implementation:**
  - **Authorization:** the owner's instruction, [relayed on #17](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/17#issuecomment-6422048941), together with the formula, credit, termination and exploit-prevention design documented before coding.
  - **Code:** `src/training/fitness.ts`, `fitnessVersion` 1:
    - `resolveFitnessConfig` and `resolveEpisodeRules`;
    - `partialProgressAt` (a bounded high-water mark towards the next gate);
    - `startEpisode` and `recordTick` (completed, crashed, stalled and timeout outcomes);
    - `scoreEpisode` (each term and the total).
    - The contract is in ARCHITECTURE.md, "Fitness". MODEL_FORMAT's example adds `maxLapTimeRatio`.
  - **Tests:** `tests/training/fitness.test.ts`, with hand-calculated values: one scripted test per §6 exploit, normal-lap scoring, boundaries, deterministic replay and validation.
  - **Not changed:** no population training loop, dashboard, persistence or driver wiring. No weights have been tuned and no training has run, so the tests are evidence that the guards work, not of learning.
- **Completion record:**
  - **Merge:** [#85](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/85), merged by the owner at `4e02d70`. Its tree is identical to the reviewed head `6672bea`.
  - **Review:**
    - Codex first returned [Changes required on `8ff1a92`](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/85#pullrequestreview-5656191350), with two P2 findings (overflowing fitness, unusable tick budgets) and one P3 (weight relationship).
    - All three were fixed in `6672bea`, with regression tests.
    - [Codex technical approval of `6672bea`](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/85#pullrequestreview-5657613853).
  - **Codex's own runs:** install, lint, typecheck and build on `6672bea`. Its first default-concurrency unit run had one timeout: the seeded two-lap test took 5062 ms against the 5 s default. It passed alone and in a full run with 2 workers (695 tests). That test gets an explicit 30 s timeout in P2-05's PR. Codex ran the full six-project browser suite on `8ff1a92`.
  - **CI on `6672bea`** (run 40369048174): both jobs green, including WebKit.
  - **CI on `main` at `4e02d70`** (run 40385636959): the lint, typecheck, unit and build job is green. The browser job was cancelled after 20 minutes in its `playwright install` step, before any browser test ran. The same tree's browser tests passed in run 40369048174, and the failure is in browser installation, not the code; a re-run of that job is outstanding.
  - **Tests:** 58 unit tests in `tests/training/fitness.test.ts`.
  - **Device checks:** not applicable. The code is headless, and the production assets were unchanged.
  - **Owner approval:** the owner's merge (AGENTS.md owner evidence).

### P2-07 — Seeded training experiments and configuration recording

- **Priority:** P0 · **Status:** Complete · **Issue:** [#18](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/18)
- **Depends on:** P2-05, P2-10
- **Description:** Experiment config type and runner that saves complete resolved config (including physics and control/normalisation contracts), PRNG algorithm/version, seeds, commit, simulation/track versions, split manifest, budgets, frozen model IDs and raw episode/per-generation results as JSON (headless script, e.g. `npm run experiment -- <config>`).
- **Acceptance criteria:**
  - A recorded experiment can be re-run from its file to identical results in the same engine.
- **Test requirements:**
  - Integration: record then replay a short experiment.
- **Implementation:**
  - **Authorization:** the owner's instruction, [relayed on #18](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/18#issuecomment-6439994327), together with the configuration, record, replay, command-line and test plan documented before coding.
  - **Code:**
    - `src/training/experiment.ts`: `resolveExperimentConfig`, `runExperiment`, `parseExperimentRecord`, `replayExperiment` and `replayChampion`, with the errors `ExperimentConfigError`, `ExperimentRecordError` and `ExperimentCompatibilityError`.
    - `scripts/experiment.mjs`: `npm run experiment -- run <config.json> --out <record.json>` and `npm run experiment -- replay <record.json>`.
    - `experiments/configs/smoke-oval.json`: a small example on the training oval.
    - `SIMULATION_VERSION` in `src/sim/config.ts`, and the trainer's `RNG_STREAMS`, recorded with the other contracts.
    - The contract is in ARCHITECTURE.md, "Experiments".
  - **Records:** the complete resolved configuration and seeds, every contract version, physics, timestep and sensors, the source revision and engine, the split manifest with its hash, the training track's hash, generation and simulated-tick budgets, raw per-car outcomes for every generation, per-generation statistics, and each run's frozen champion (`freezeModel` ID, 159 parameters, provenance and episode), all covered by a `resultsHash`.
  - **Replay:** re-runs every seed from the record's own configuration in the same engine, compares every result, and replays each frozen champion alone. Malformed, incomplete and incompatible records are rejected before anything runs.
  - **Boundaries:** training uses training-split tracks only. The champion is chosen by training fitness and labelled as such. No validation selection or held-out evaluation is run, and records state `evaluations: none`.
  - **Tests:** `tests/training/experiment.test.ts` and `tests/scripts/experiment.test.ts`. They cover record then replay, completeness, isolation, split enforcement, and the rejections and replay mismatches listed in TESTING.md.
  - **Not changed:** the trainer's behaviour, which only gains the `rngStreams` version reference. There are no baselines or controlled studies (P2-08), dashboards, model persistence, resumable checkpoints, Silverstone or racing. No experiment has been run, and no learning is claimed: the example's fitness is a training signal on one track.
  - **Device checks:** none apply. The runner is headless and command-line only, and the page does not import it.
- **Completion record:**
  - **Merge:** [#89](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/89), merged by the owner at `9ea5511` (2026-10-27, about 11:52 UTC). Its tree is identical to the final head `0b2737d`.
  - **Review:**
    - Codex's automated review of `b868f98` found one P2: replayed lap lists of different lengths made the comparison throw (command-line exit 2) instead of reporting a difference (exit 1). It was fixed in `0b2737d`, with regression tests.
    - [Codex technical approval of `0b2737d`](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/89#pullrequestreview-5666451005), posted at 11:38 UTC, before the merge. It verified the P2 fix.
    - It left one **non-blocking P3:** unknown keys inside nested configuration blocks (`selection`, `crossover`, `mutation`, `fitness`) were dropped rather than rejected, although ARCHITECTURE.md says unknown fields are rejected. Recorded settings and replay were unaffected. **Fixed in #94** (the owner authorised it as the P2-08 plan's prerequisite): `resolveExperimentConfig` now rejects them, naming the path. #94 was merged by the owner at `d42bb2a`, the same tree as `57a1371`, after [Codex technical approval of `57a1371`](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/94#pullrequestreview-5728292609). CI was green on the head (run 41311099362) and on the merge (run 41311774395).
  - **Codex's own runs on `0b2737d`:**
    - `npm ci`, lint, typecheck and build;
    - 941 unit tests in 38 files. In Codex's sandbox, 17 command-line tests first failed because the sandbox blocked child processes (`spawnSync` EPERM); they passed with execution permission, with nothing changed;
    - all six browser projects (160 passed, 14 intentional skips);
    - the real command line: record and replay of `smoke-oval` both exited 0;
    - an independent `resultsHash` check, and an extra-lap record exiting 1.
  - **Claude Code's runs:** on `b868f98`, the Chromium browser projects (80 passed, 7 skipped) and the command line on the committed tree. On `0b2737d`, lint, typecheck, 941 unit tests and the build.
  - **CI:** run 40494094023 on `0b2737d` and run 40499436295 on the merge `9ea5511`, both jobs green in each, including WebKit.
  - **Tests:** 125 unit tests in `tests/training/experiment.test.ts` and 17 command-line tests in `tests/scripts/experiment.test.ts`.
  - **Device checks:** not applicable. The runner is headless and command-line only.
  - **Owner approval:** the owner's merge of #89.
  - **Limits:** no experiment from AI_EVALUATION.md has been run. Records from `smoke-oval` show only that recording and replay work.

### P2-08 — Random-driving baselines and controlled improvement experiment

- **Priority:** P0 · **Status:** Complete (2026-11-02; completion record below; claim limited to the training track) · **Issue:** [#19](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/19)
- **Depends on:** P2-07
- **Description:** Implement random-action (A1), correlated random-action (A7), untrained-network (A2), best-of-initial-population (A9) and equal-budget random-search (A8) baselines and run experiments E1 and E2 from AI_EVALUATION.md over 10 training seeds.
- **Acceptance criteria:**
  - **Phase 2 acceptance:** controlled results demonstrate improvement over equal-budget random search (A8) on ordered progress, with random-action floors (A1, A7), the best-of-initial-population baseline (A9), lap completion and collisions reported, at least one valid evolved lap, ≥10 independent training seeds and the predeclared effect/uncertainty criteria in AI_EVALUATION.md. Built-in training/validation fixtures come from P2-10; held-out data stays reserved for final evaluation.
  - An honest negative/inconclusive study can complete the experiment-reporting task but leaves Phase 2 acceptance unmet and requires a follow-up; rising fitness alone cannot pass the phase.
  - No claim made beyond what the data shows.
- **Test requirements:**
  - Unit: baseline drivers deterministic.
  - Experiment output files checked into `experiments/results/`.
- **Plan:** [docs/experiments/p2-08-plan.md](experiments/p2-08-plan.md). Steps 1–3 are done: #94, #96 (below) and the step 3 tooling (#99–#106, `main` at `c14f368`).
  - **Step 4, the exploratory pilot:**
    - [authorised by the owner](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/19#issuecomment-6575209368);
    - manifests and protocol merged in #107 at `8a4b6d5`, after [Codex technical approval](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/107#pullrequestreview-5736644002);
    - run on 2026-11-02 at the frozen commit `c14f368` ([relayed run and storage instruction](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/19#issuecomment-6579857037));
    - artifacts merged in #108 (`experiments/results/p2-08/pilot/`): configuration C1, n = 10, δ = 0.25.
  - **The pilot's limits:**
    - it is exploratory and acceptance-ineligible;
    - the validation track was used only for the predeclared configuration choice and descriptive results;
    - the held-out track was not touched;
    - it makes no claim.
  - **Step 5:** the confirmatory manifest and protocol are [authorised for preparation](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/19#issuecomment-6580274602) (`experiments/manifests/p2-08-confirmatory.json`, `docs/experiments/p2-08-confirmatory-protocol.md`), merged in #109. The confirmatory study was [run with the owner's approval](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/19#issuecomment-6581307850) on 2026-11-02: 10/10 seeds run and replayed identically, and `analyse` decided `supported` (mean A5 − A8 of 0.590 laps on the training track, 95% interval [0.495, 0.690]). On the validation track, A5 did not outperform A8 (descriptive). The results (`experiments/results/p2-08/confirmatory/`, `confirmatory.md`) are merged in #110.
  - Agents A1, A7, A2, A9, A8 and A5, with seeded streams. A8 continues A5's initial-population stream, so its first block is A5's generation 0.
  - Equal evaluation budgets (P × G episodes). A1 and A7 run E1's population-sized cohort: P stochastic episodes per training seed on each track. Deterministic models run one episode per track.
  - Training on the oval only. Validation is used for pilot configuration choice and secondary reporting; the held-out track is untouched.
  - The primary metric is ordered progress on the training track, as a paired A5 − A8 difference per training seed with a 95% seed-cluster bootstrap. The meaningful effect threshold is δ = 0.25 lap, which the pilot may raise but not lower.
  - A separate exploratory pilot (seeds 9001–9003) comes before a preregistered confirmatory study (seeds 1001–1010, or 1020 if the pilot requires it). Raw records, replay and the analysis go under `experiments/results/p2-08/`.
  - The exact Wilcoxon signed-rank test drops zero differences and uses midranks for ties. It is descriptive only.
  - Implementation, the pilot and the confirmatory run each need the owner's authorization.
  - Revised after Codex's [retrospective review of #91](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/91#pullrequestreview-5673337394) (Changes required on the plan; the P2-07 record verified).
- **Step 2 (done in #96; merged by the owner at `5b61db5`, the same tree as the head `e2f1118`):** [Codex technical approval of `cb23a3e`](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/96#pullrequestreview-5728992182) covers `cb23a3e`. Its two non-blocking P3s were fixed in `e2f1118`: nested `fitness` keys rejected, and stale plan wording. That commit had only Codex's automated receipt before the merge; its formal review is requested on the step 2 follow-up PR, as a retrospective review. CI passed on `e2f1118` (run 41325280427, including WebKit). Scope: seeded A1 and A7 random-action drivers (`ai/randomDrivers.ts`), a network driver, one shared episode tick for the trainer and evaluation (`training/episodeStep.ts`) and a headless `evaluateDriver` on training or validation tracks (`training/evaluation.ts`). Design in ARCHITECTURE.md, "Baseline drivers and headless evaluation", committed before the code. Not included: A2/A8/A9 selection, seed derivation, manifests, the study runner, statistics, dashboards and persistence (step 3, not authorised). No pilot or confirmatory run, no held-out track, no learning claim. Devices: not applicable (headless code only; the page is unchanged).

- **Completion record (P2-08 Complete, 2026-11-02; #94–#110, final merge `757e27d`):**
  1. **Implementation exists and can be demonstrated:** A1/A7 drivers and `evaluateDriver` (#96), A2/A9/A8 (#99), A5 and validation evaluation (#100), manifests, records and replay (#101), `npm run study -- run | replay` (#102), the analysis library (#104) and `analyse` (#105, #106). Every committed record replays identically at the frozen commit `c14f368` (Node v24.22.1), In #108 and #110 Codex independently replayed each record with the study CLI (`replay`) at the recorded engine. It also recomputed `analysis.json` and `report.md` from the strictly parsed records with the frozen analysis library, byte-identical, rather than running the `analyse` CLI again.
  2. **Required automated tests:** "baseline drivers deterministic" is `tests/ai/randomDrivers.test.ts` (#96), with the agents, study, analysis and manifest tests from #99–#109. "Experiment output files checked into `experiments/results/`": `experiments/results/p2-08/pilot/` (#108) and `experiments/results/p2-08/confirmatory/` (#110), with gzip records and SHA-256 checksums. `main` at `757e27d`: both required CI jobs passed ([run 41532821865](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/41532821865)).
  3. **Mobile:** not applicable. No page, UI, render or `main.ts` file changed in any P2-08 PR (`git diff d42bb2a~1 757e27d -- src/main.ts src/ui src/render index.html` is empty); the work is headless Node. Existing device evidence is unchanged.
  4. **Existing functionality:** the full unit and browser suites passed in CI on the reviewed and merged head of each P2-08 PR, as recorded in that PR's review, and on `main` at `757e27d` ([run 41532821865](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/41532821865)).
  5. **Acceptance criteria:**
     - *Phase 2 acceptance criterion:* met by the preregistered confirmatory study (#109, #110). A5 improves on equal-budget random search (A8) in ordered progress on the training track: mean 0.590 laps, 95% bootstrap interval [0.495, 0.690], all 10 seeds positive, δ = 0.25. A1, A7 (0/500 episodes completing a lap), A2 (1/500), A9, lap completion and collisions are reported. 10/10 A5 training episodes completed at least one valid lap. 10 independent training seeds (1001–1010). Training and validation fixtures come from P2-10, and the held-out track was not used.
     - *No claim beyond the data:* the only claim is "outperforms equal-budget random search" on the training track. **On the validation track A5 did not outperform A8** (A5 − A8 −0.393 [−0.929, 0.014]; A5 crashed in 10/10 validation episodes), which is reported and is not a generalisation claim.
  6. **Documentation:** the plan, the protocols (`p2-08-pilot-protocol.md`, `p2-08-confirmatory-protocol.md`), ARCHITECTURE/TESTING entries, `AI_EVALUATION.md` §9 and this record.
  7. **Second-agent review:** every P2-08 PR was reviewed by the development agent that did not author it. For Claude Code's PRs that was Codex. #106 was authored by Codex under the owner's [relayed exception](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/105#issuecomment-6573408415), and reviewed by Claude Code ([technical approval of `f7f617a`](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/106#issuecomment-6573793425)). Gaps were closed retrospectively and are labelled as such:
     - #96 (`e2f1118`, [retrospective](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/96#pullrequestreview-5729106028));
     - #98 (`d8b0dc3`, [retrospective](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/98#pullrequestreview-5729725244));
     - #101 (`a9454b0`, [retrospective](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/101#pullrequestreview-5730405423));
     - #102 (final head `310c28d`, after the documentation-only merge of `main`, [retrospective](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/102#pullrequestreview-5730684246));
     - #109 (`971cda9`, [retrospective](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/109#pullrequestreview-5741591844)).

     For #105, Codex's last formal record on the PR was Changes required on `ca8e0c2`. Both findings were fixed by #106, and Codex's [integration verification](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/105#issuecomment-6577306149) shows that #106's head, #105's merged head and `main` at `c14f368` have identical trees.
  8. **Codex technical approval and owner merge:** each PR merged by the owner. #110 is Codex-approved at `cf5579a` ([review](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/110#pullrequestreview-5741851497)), and the merged tree `642f8df` is identical.
  - **Procedural exception:** in #110 the first `analyse` was killed by a session time limit and rerun unchanged without a prior owner instruction. The owner [accepted this as a procedural exception for this study only](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/19#issuecomment-6589544564). It sets no precedent: later protocols still stop and report. `analyse` is deterministic, and Codex reproduced its outputs byte-for-byte.
  - **Chronology:** pilot authorised 2026-11-02 (#107 → #108), confirmatory manifest (#109), confirmatory run 2026-11-02 15:44–18:23 UTC, results merged in #110, and this record.

### P2-09 — Braking output experiment toggle and braking feasibility check

- **Priority:** P1 · **Status:** Complete (2026-11-07; completion record below, merged in #120; A2 met on the validation track only; E4 `no-direction` on the training track) · **Issue:** [#20](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/20) · **Stretch target:** ST4
- **Depends on:** P2-03, P2-05, P2-07, P2-10
- **Description:** Add a brake-enabled/no-brake training switch (brake masked, same 9-12-3 shape) and confirm the default tracks contain corners where braking is physically useful; run E4.
- **Acceptance criteria:**
  - Toggle recorded in experiment config and saved models.
  - Feasibility note documented: a scripted driver is faster or crashes less with braking on at least one track (or the limitation is reported and any physics/track redesign is approved and versioned before a fresh study; do not tune conditions using held-out results).
- **Test requirements:**
  - Unit: mask forces brake 0.
  - Integration: paired no-brake and brake runs with the same seed.
- **Plan:** [docs/experiments/p2-09-plan.md](experiments/p2-09-plan.md), documentation only and [authorised](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/20#issuecomment-6591090802). It contains:
  - an audit: the mask and T1 already exist, the scripted oval driver is reusable, and the saved-model gap is open;
  - persistence option A (`brakeEnabled` in frozen-model provenance) or option B (an owner-approved deferral to P3-05/P3-06);
  - a braking-versus-coasting feasibility check on the training and validation tracks;
  - E4 (A4 vs A5, seeds 2001–2010, training-track progress, descriptive validation);
  - failure handling and seven further steps, each needing its own authorisation. E5 stays in P5-02.
  - Status: Complete. Steps 2–7 are merged (step 5: the E4 tooling in `src/training/e4Agents.ts`, `e4Study.ts`, `e4Analysis.ts` and `npm run e4`; step 6: `experiments/manifests/p2-09-e4.json` and `docs/experiments/p2-09-e4-protocol.md` in #118; step 7: the E4 results in `experiments/results/p2-09/e4/`, merged in #119). Step 8 is the completion record below (#120).

- **Completion record (P2-09 step 8, [authorised 2026-11-07](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/20#issuecomment-6713051591); #112–#119, final merge `970461d`; record merged in #120 at `0ed3811`).**
  1. **Implementation exists and can be demonstrated:** the brake mask (`outputsToControls(raw, brakeEnabled)`, which pre-dates P2-09 and was audited in the plan §2); `brakeEnabled` in the validated training configuration and in P2-07/P2-08 records (pre-existing); the frozen-model brake contract (option A part 1, `src/training/frozenModelBrake.ts`, #114); `GatePursuitDriver` and `npm run feasibility` (#115); the feasibility record (#116); the A4/A5 study kind, per-agent binding, paired analysis and `npm run e4` (#117); the frozen manifest and protocol (#118); and the E4 records, `analysis.json`, `report.md` and `e4.md` (#119). All ten E4 records replayed identically at the frozen commit `3096065` under Node v24.22.1 when the study ran (`npm run e4 -- replay`; author-reported). Codex independently reproduced the ten gzip files, rebuilt `analysis.json` and `report.md` byte-for-byte from the parsed records, and replayed the 20 saved champions on both tracks with matching results; it did not repeat the full-history replay ([review 5766992719](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/119#pullrequestreview-5766992719)).
  2. **Required automated tests:** T1 "mask forces brake 0" is `tests/ai/outputs.test.ts:43` with the masked-training check in `tests/training/trainer.test.ts` (pre-existing, reused). T2 "paired no-brake and brake runs with the same seed" is the paired integration test in `tests/training/e4Study.test.ts` (#117). The step-specific suites are `frozenModelBrake.test.ts` (#114), `feasibility.test.ts` (#115, #116), `e4Study`, `e4Analysis` and `e4Accounting` (#117), `e4Manifest` (#118) and `e4Results` (#119). Both required CI jobs passed on every merged P2-09 `main` commit: `21ca31b` ([41546693945](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/41546693945)), `acb769b` ([41551368516](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/41551368516)), `236c766` ([41635864884](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/41635864884)), `191148a` ([41656608944](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/41656608944)), `31e21f6` ([41663059865](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/41663059865)), `3096065` ([41720832449](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/41720832449)), `be9df05` ([41731646626](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/41731646626)) and `970461d` ([41863642690](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/41863642690)).
  3. **Mobile:** not applicable. No page, UI, render or `main.ts` file changed in any P2-09 PR (`git diff 21ca31b~1 970461d -- src/main.ts src/ui src/render index.html` is empty); the new code is headless Node tooling. Existing device evidence (P1-08, P2-01, P2-05) is unchanged.
  4. **Existing functionality:** the full unit and browser suites passed in CI on each reviewed head and on each resulting `main` commit (item 2).
  5. **Acceptance criteria:**
     - *Toggle recorded in experiment config and saved models:* met for experiment configuration (the validated `brakeEnabled` field, resolved into P2-07 records, P2-08 manifests and E4's per-agent binding, with cross-agent rejection) and for frozen models (`brakeEnabled` in provenance and the model `id`, #114; owner-chosen option A). Standalone saved models do not exist yet; `MODEL_FORMAT.md` already defines `architecture.brakeEnabled` for them, and P3-05/P3-06 must implement it.
     - *Feasibility note:* met on the validation track only (#116): a scripted BRAKE driver's best lap was 2.217 s faster than COAST (margin 0.537 s). On the training oval braking was **not shown** to help (−0.117 s, margin 0.515 s). This is physical feasibility for one scripted driver family, not learned behaviour. No physics or track change was made, and no held-out result was used.
     - *E4 (plan §5):* run once as preregistered (#118, #119). Outcome `no-direction`: "no direction established: the interval spans zero" (mean A5 − A4 −0.0150 lap, 95% interval [−0.0400, +0.0100], median −0.025, n = 10). It is **not** a finding of equivalence or of no effect, it shows neither a benefit nor a harm from learned braking, and it makes no claim about validation or unseen tracks. Validation results are descriptive only (both agents crashed in 10/10 validation episodes). The held-out track was not used.
  6. **Documentation:** the plan (`docs/experiments/p2-09-plan.md`), the E4 protocol, the feasibility record, `e4.md`, `AI_EVALUATION.md` §9–§10, `docs/TESTING.md` entries from #114–#119 and this record.
  7. **Second-agent review:** every P2-09 PR was authored by Claude Code and reviewed by Codex at its final head: #113 `d166828` ([5745017658](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/113#pullrequestreview-5745017658)), #114 `fa14602` ([5745356917](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/114#pullrequestreview-5745356917)) and its final `6553dba` ([retrospective 5752936252](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/114#pullrequestreview-5752936252)), #115 `9344387` ([5753795009](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/115#pullrequestreview-5753795009)), #116 `0c2ff80` ([5754683428](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/116#pullrequestreview-5754683428)), #117 `c2b563a` ([5759578464](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/117#pullrequestreview-5759578464)), #118 `4a0cf4a` ([5760210973](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/118#pullrequestreview-5760210973)) and #119 `3d12f5e` ([5770278527](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/119#pullrequestreview-5770278527)). #112 (`834868d`) was merged with Codex's [Changes required](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/112#pullrequestreview-5744956315) open; #113 applied those corrections and was approved, as recorded in the 2026-11-03 changelog.
  8. **Codex technical approval and owner merge:** each PR was merged by the owner, and each merge tree is identical to its merged head (checked 2026-11-07). **#112 was merged before any technical approval:** its merged head `834868d` (tree-identical to `21ca31b`) had Codex's Changes required, and those findings were corrected in #113, whose head received technical approval (item 7). Tree identity does not make `834868d` an approved head, and no approval is backdated. For #113–#119 the merged head is the Codex-approved head: `acb769b`/`d166828`, `236c766`/`6553dba`, `191148a`/`9344387`, `31e21f6`/`0c2ff80`, `3096065`/`c2b563a`, `be9df05`/`4a0cf4a`, and `970461d`/`3d12f5e` (tree `dedb868`). **Owner completion approval for P2-09:** [relayed owner instruction on #20](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/20#issuecomment-6713504062) (2026-11-07), conditional on this record keeping Codex's technical approval ([review 5815129543](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/120#pullrequestreview-5815129543) of `5c45dae`, tree-identical to the merge `0ed3811`) and passing required CI (`main` [run 42417172698](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/42417172698), both jobs). Both conditions were met when it was given. #120 had already merged, so the status change is in a follow-up PR. Phase 2 completion is a separate owner decision and is pending.
  - **Analysis-interruption chronology (step 7, UTC):** 2026-11-03 23:20 [step 7 authorised](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/20#issuecomment-6618005796); 23:21:57 run started from a clean worktree at `3096065`; 2026-11-04 01:36:44 last of ten identical replays; 01:36:45 first `analyse` started; about 01:53–02:00 the session container restarted and killed it before any output; 02:00 [stopped and reported](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/20#issuecomment-6620498423) with all ten records matching their logged SHA-256; 07:31 [owner's written go-ahead relayed](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/20#issuecomment-6625287392) for the analysis only; 07:32:16–08:49:32 `analyse` re-run and completed; 08:56 #119 opened; 10:37 Codex Changes required on `fac22cb` (one interpretation finding); 14:45 Codex technical approval of `3d12f5e` (correction cycle 1); 16:02 owner merge as `970461d`. No seed was re-run, substituted or skipped, and the protocol's stop-and-report rule was followed, so unlike #110 no procedural exception was needed.
  - **Limits carried forward:** one configuration (C1), one training track and ten seeds; feasibility not shown on the oval; both agents' champions ended every training episode at the 60 s limit (whether that limit explains the clustering is an untested hypothesis). Learned-braking benefit on unseen tracks remains E5 in P5-02 (ST4).

### P2-10 — Built-in track splits and evaluation fixtures

- **Priority:** P0 · **Status:** Complete · **Issue:** [#41](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/41)
- **Depends on:** P1-04, P1-07
- **Description:** Supply at least one versioned built-in training, validation and held-out circuit with different corner geometry before early experiments. No editor prerequisite.
- **Acceptance criteria:** Split manifest records stable IDs and content versions/hashes; training uses training tracks only, selection uses validation only, and final held-out evaluation uses frozen models. P4-04 later expands the circuits.
- **Test requirements:** Geometry validity, disjoint split IDs, deterministic loading and leakage rejection.
- **Implementation:**
  - **Authorization:** the owner's instruction, [relayed on #41](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/41#issuecomment-6427320313), together with the circuits, manifest, boundaries and test plan documented before coding.
  - **Data:**
    - `src/data/tracks/index.json` is the split manifest: ID, version, split, file and `sha256:` content hash.
    - Training is `stadium-oval` v1, unchanged.
    - Validation is `rounded-rectangle` v1: four 90° corners of radius 15 m, 12 m wide.
    - Held-out is `hairpin-chicane` v1: a chicane, left and right 180° hairpins of radius 12 m, 11 m wide.
  - **Code:**
    - `src/training/trackSplits.ts`: `loadTrackSplits`, `BUILT_IN_TRACK_SPLITS`, the split accessors, `assertTrainingTrack` (applied by the trainer), `selectByValidation`, `freezeModel` and `heldOutTrack`.
    - `src/utils/sha256.ts`.
    - The trainer records `trackHash` and `trackSplit`.
    - The contract is in ARCHITECTURE.md, "Track splits".
  - **Tests:** `tests/training/trackSplits.test.ts` and `tests/utils/sha256.test.ts`. They cover geometry validity and driveability, different corner geometry, every manifest rejection rule, deterministic loading and leakage rejection.
  - **Not changed:** simulation and training behaviour on the oval and on synthetic tracks; the page still uses the oval. There is no experiment runner, editor, general validator, Silverstone, dashboard or persistence. No model has been trained or evaluated on the validation or held-out circuits.
  - **Device checks:** none apply. The data and boundaries are headless, and the page is unchanged.
- **Completion record:**
  - **Merge:** [#88](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/88), merged by the owner at `dbb314b`. Its tree is identical to the final head `f3b34a4`.
  - **Review:**
    - Codex's automated review of `987f2ab` found one P2 (a held-out or validation circuit copied under the training ID was accepted). It was fixed in `c75a783`.
    - Codex returned [Changes required on `c75a783`](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/88#pullrequestreview-5664833222): two P2 findings (validation-mean overflow; the frozen-model guard skipped sparse parameters and nested provenance) and one P3 (malformed parameter counts). All three were fixed in `f3b34a4`, with regression tests.
    - [Codex technical approval of `f3b34a4`](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/88#pullrequestreview-5665120862). **This approval is retrospective:** the owner merged #88 at 09:41 UTC on 2026-10-27, before Codex reviewed `f3b34a4` (09:50 UTC). Codex verified that the merged tree equals `f3b34a4` and that all three findings are fixed, with no new findings.
  - **Codex's own runs:** install, lint, typecheck, 799 unit tests and build on `f3b34a4`, plus probes against `c75a783` and `f3b34a4`. The full six-project browser suite ran on `c75a783` (160 passed, 14 intentional skips); the production files of `f3b34a4` are byte-identical to it.
  - **CI:** run 40481310774 on `f3b34a4` and run 40482716207 on the merge `dbb314b`, both jobs green in each, including WebKit.
  - **Tests:** 57 unit tests in `tests/training/trackSplits.test.ts` and 5 in `tests/utils/sha256.test.ts`.
  - **Device checks:** not applicable. The changes are headless, and the production assets were byte-identical to the previous head's.
  - **Owner approval:** the owner's merge of #88 (AGENTS.md owner evidence). It preceded the technical approval, as recorded above.

### P2-11 — Spatial index for boundary collision and ray queries

- **Priority:** P1 · **Status:** Not Started · **Issue:** [#56](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/56)
- **Depends on:** P1-06, P2-01
- **Description:** A deterministic uniform-grid (or equivalent) index over track boundary segments so collision checks and ray casts only test nearby segments. The index must not change any result.
- **Conditional:** this is an optimisation for a **hypothesis**, not a measured problem. Silverstone has about 2,350 boundary segments, so brute force needs about 0.9 million segment tests per tick for an example population of 50 cars × 8 queries, which *may* be too slow on phones. No measurement supports this yet. P2-11 is implemented only if one of these holds:
  1. The brute-force baseline recorded by P4-06 (or a synthetic benchmark track with at least as many boundary segments) misses the budget below on the reference phone.
  2. The owner approves an architectural reason recorded in #56.
- **Performance budget (proposed; the owner may revise it in #56 before any measurement):**
  - Reference device: the owner's iPhone in Safari, with model and iOS version recorded in #56 before measuring. Desktop Chromium figures are recorded for comparison only and never replace the phone result.
  - Workload: Silverstone (or the synthetic stand-in), a population of 50 cars, 7 rays plus collision per car per tick. P2-05 does not fix a default population yet; if its default differs from 50, measure and record both.
    - Rendered training at 1× uses the P3-03 phone draw cap.
    - Headless training runs at maximum speed.
  - Budget:
    - Rendered 1×: sustains 60 ticks/s with p95 simulation update time ≤ 8 ms per frame.
    - Headless: at least 600 ticks/s (10× real time).
- **Acceptance criteria:**
  - The baseline that triggered the work, with device, workload and figures, is linked from #56.
  - Collision results and ray distances are bit-identical to brute force on all test tracks and on seeded random query sets.
  - Before/after figures under the same workload are recorded on the reference phone and the budget is met.
  - The index is derived from track geometry only and is not stored in models or experiment records.
- **Test requirements:**
  - Unit: index vs brute-force equivalence; existing determinism suite unchanged; benchmark output in the PR.

## Phase 3 — Training dashboard and persistence

**Phase acceptance:** Users can observe, save, replay and compare genuine training results.

### P3-01 — Training dashboard: generation, population, collision and lap metrics

- **Priority:** P1 · **Status:** Complete (2026-11-08; implemented and merged in [#124](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/124); completion record below) · **Issue:** [#21](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/21)
- **Depends on:** P2-05
- **Description:** Panel showing, for the **current generation**, live generation number and running, crashed, stalled and finished counts; and, for the **last completed generation**, best and mean fitness, crash rate and lap-completion rate, with stalls shown separately from crashes. ([Owner-approved scope change](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/21#issuecomment-6713339826), 2026-11-07: fitness and rates are no longer required for the current generation.)
- **Acceptance criteria:**
  - Last-completed-generation values match the trainer's recorded `GenerationStats`; live counts sum to the population; readable on iPhone.
  - Completion requires mobile readability, responsiveness and regression checks (plan §6.1). It does **not** require FPS or step-time instrumentation, which stays under P3-07 ([owner clarification](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/21#issuecomment-6713856759), 2026-11-07). No FPS or step-time figure is reported as passed for P3-01.
- **Test requirements:**
  - Unit: stats aggregation.
  - E2E: dashboard updates during training.
- **Plan:** [docs/plans/p3-01-plan.md](plans/p3-01-plan.md) (planning [authorised](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/21#issuecomment-6713504223); merged in #122); implemented in #124 ([authorised](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/21#issuecomment-6714650978)). The existing `docs/TESTING.md` training-view and low-power checks are retained and apply as described in plan §6.
- **Completion record (P3-01, 2026-11-08; #122, #124, #126):**
  1. **Implementation exists and can be demonstrated:** `?mode=train` shows the dashboard: live running, crashed, stalled and finished counts, and best and mean fitness, crash rate (crashes only), stalls and lap-completion rate for the last completed generation (`src/training/generationMetrics.ts`, `src/ui/trainingDashboard.ts`, `src/ui/trainingPage.ts`, `index.html`).
  2. **Required automated tests:** unit: stats aggregation (`tests/training/generationMetrics.test.ts`, `tests/ui/trainingDashboard.test.ts`, the actual page wiring in `tests/ui/trainingPageWiring.test.ts`, the markup in `tests/ui/dashboardMarkup.test.ts`, and the non-interference test in `tests/training/trainer.test.ts`); E2E: the dashboard updates during training (`tests/e2e/training.spec.ts`). Exact-head CI on the approved head `aa8397e`: [run 42432029723](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/42432029723), 1,640 unit tests in 64 files and 170 browser tests passed with 16 skipped. `main` CI on the merge `381fc3c`: [run 42465362250](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/42465362250), both jobs passed.
  3. **Mobile:** the owner reported ["Pass on all"](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/21#issuecomment-6719655761) for the five dashboard checks (owner-reported, not run by either agent; recorded in `docs/TESTING.md`). The device models, OS and browser versions and the deployed commit were not stated, so they are not recorded. The CI browser projects are emulation, not hardware. FPS and step time were not measured and are not required for P3-01 (P3-07).
  4. **Existing functionality still works:** the full unit suite and the full browser suite passed in the CI runs above.
  5. **Acceptance criteria:** last-completed values equal values recomputed independently from the finished cars; the live counts are disjoint and sum to the population at every tick of a seeded run; readable on iPhone and iPad per the owner's report. The criterion clarification applies: completion does not require FPS or step-time instrumentation, which stays under P3-07.
  6. **Documentation:** ARCHITECTURE.md, TESTING.md, this file and the plan.
  7. **Second-agent review:** Codex reviewed each head of #124 (reviews 5815697258 and 5815772927, Changes required; 5817278605, [Technical approval of `aa8397e`](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/124#pullrequestreview-5817278605), after two correction cycles), #122 (technical approval of `790e8fb`, review 5815543276) and #126 ([review 5817331134](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/126#pullrequestreview-5817331134)).
  8. **Codex technical approval and owner approval:** the owner merged #122 (`4e891cd`), #124 (`381fc3c`, tree identical to the approved `aa8397e`) and #126 (`c448afe`). The owner's completion approval is recorded as relayed instructions on #21: ["... approving p3-01 completion ..."](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/21#issuecomment-6719721713) and ["Merged, please continue with developing next step"](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/21#issuecomment-6719729872), read together; the owner's merge of the record PR is the final confirmation of that reading.
  - **Not claimed:** no learning or generalisation claim; the dashboard reports fitness and outcome counts only. ST1 to ST5 stay visible.

### P3-02 — Live training fitness graph and analytics

- **Priority:** P1 · **Status:** Complete (owner completion approval 2026-11-10, see the changelog row; merged in #128; 500-generation graph check recorded 2026-11-11 below) · **Issue:** [#22](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/22) · **Stretch target:** ST2
- **Depends on:** P3-01
- **Description:** Canvas line chart of best and mean fitness per generation, plus collision and lap-completion rates, updated live and redrawn at most a few times per second.
- **Acceptance criteria:**
  - Graph matches recorded data; stays responsive at 500 generations; accessible text summary available.
- **Test requirements:**
  - Unit: chart scaling.
  - E2E: graph points appear as generations finish.
- **Implementation notes ([authorised](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/22#issuecomment-6719730293)):** a collapsible "Training graph" block under the track (closed by default), two panels on one canvas (best and mean fitness; crash and lap-completion rates from 0 to 100%), solid and dashed lines as well as colours, redrawn at most every 250 ms and only while open, long histories thinned to the plot width, and a plain-text summary linked to the canvas. Stalls are not plotted (the dashboard shows them). It reads the P3-01 session's history and adds no per-frame read of the trainer's history. FPS and step time stay in P3-07. See ARCHITECTURE.md and the TESTING.md rows for the details and the tests.
- **500-generation responsiveness check (Claude Code, 2026-11-11; mechanics only, no learning claim; Chromium 141 in the development container, not a phone):** (1) The real page in `?mode=train` at Max speed with the graph open reached 123 completed generations in 9 minutes (generations lengthen as cars survive, so 500 were not reached in a bounded run); across 32,393 animation frames the median and 95th-percentile frame interval were both 16.7 ms and the longest 33.4 ms, with no page errors, and the summary and graph tracked the history. (2) `drawTrainingGraph` plus the text summary, timed on a real canvas with 500 synthetic history points (generated to the `HistoryPoint` shape, not a training result): median 0.4 ms, 95th percentile 0.9 ms (1.5 ms worst of 200) at pixel ratio 1; median 0.4 ms, 95th percentile 0.6 ms (2.9 ms worst) at pixel ratio 2; at 5,000 points the median was 2.0 ms and 1.2 ms. With the 250 ms redraw floor the graph costs well under 1% of a frame budget at 500 generations. The unit test `tests/ui/trainingChart.test.ts` separately bounds the drawing calls at 500 and 5,000. This is a desktop-Chromium measurement; no iPhone or iPad figure exists and none is claimed.

### P3-03 — Training speed controls, pause/resume and accelerated headless mode

- **Priority:** P1 · **Status:** Complete (owner completion approval 2026-11-10, see the changelog row; merged in #129) · **Issue:** [#23](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/23)
- **Depends on:** P2-05
- **Description:** Speed options (1×, 4×, max) where max runs many ticks per frame without drawing every car; pause/resume; auto-pause when the tab is hidden.
- **Acceptance criteria:**
  - Changing speed does not change results (same seed gives same stats).
  - UI stays responsive at max speed on iPhone (record frame rate).
  - Configurable cap on the number of cars drawn, with a lower default on phones; the cap never changes results. Record the frame rate with the cap on a named phone.
- **Test requirements:**
  - Integration: 1× vs max produce identical stats.
  - Integration: drawing cap does not change results.
  - E2E: pause/resume.
- **Implementation notes ([authorised](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/23#issuecomment-6721125776)):** Pause/Resume, 1×, 4× and Max buttons and a "Cars drawn" choice (10, 25 or 50; 25 by default on a phone) under the track. Max runs up to 1,000 ticks per frame, cut short by an 8 ms frame budget (at least one tick), and draws at most 10 cars. Hidden-tab auto-pause is unchanged. These change only how many fixed ticks run per frame and what is drawn, so results do not change. **The frame-rate figures the acceptance criteria ask for are an owner device measurement, required before merge ([relayed owner instruction](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/23#issuecomment-6722405467): a minimal opt-in render-loop FPS readout is authorised for P3-03, measured as rendered-frame callbacks separately from simulation ticks and reset across interruptions; other P3-07 work stays deferred).** Open with `?debug=fps`; the method is in ARCHITECTURE.md. **The owner reported device checks on their iPhone and iPad and accepted those two devices as the physical-device scope ([#23](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/23#issuecomment-6722970641), 2026-11-08 14:52 UTC), and #129 was merged afterwards as `3733ac2` (16:51 UTC). No numerical frame-rate figures, device or OS versions or per-check results were supplied before the merge, and none have been recorded since: the frame rate remains not measured and this is not a quantitative performance result. **Criterion decision:** the "record the frame rate" criteria are not met; the owner waived them: "Unmeasured frame rate is accepted." ([#138](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/138#issuecomment-6745908947), 2026-11-09, covering P3-02 to P3-05), and approved completion on 2026-11-10.** "Accelerated headless mode" is the Max speed in the page; the headless Node runs are unchanged (`trainHeadless`). See ARCHITECTURE.md and the TESTING.md rows.

### P3-04 — Champion replay with sensor and decision overlay

- **Priority:** P1 · **Status:** Complete (owner completion approval 2026-11-10, see the changelog row; merged in #133) · **Issue:** [#24](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/24)
- **Depends on:** P2-05
- **Description:** Replay the best car of any recorded generation on its track, showing rays, the 9 inputs and the steering/throttle/brake outputs each tick.
- **Acceptance criteria:**
  - Replay is identical to the original evaluation (same events and lap time).
  - Inputs and outputs shown match inference values.
- **Test requirements:**
  - Integration: replay determinism.
  - E2E: replay controls.
- **Implementation notes ([authorised](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/24#issuecomment-6726924348), as specified in the merged plan `docs/plans/p3-04-plan.md`):** a headless `championReplay` through the shared `stepEpisode` with a frame that keeps the decision state apart from the result state, a collapsible "Champion replay" block (generation picker, Replay/Restart, Back to training), training paused while a replay runs, one car drawn in its decision state with its rays, and the nine inputs and three outputs as text. See ARCHITECTURE.md and the TESTING.md row. No saving (P3-05, P3-06), comparison (P3-08) or step-time work (P3-07), and no learning claim. **Merged as `9c2a93f` ([#133](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/133)). Historical state at the merge: no P3-04 device checks had been reported. Later, the owner wrote "Device checks complete p3-02 through p3-05" ([#138](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/138#issuecomment-6745908947), 2026-11-09), with no per-check results, and approved completion on 2026-11-10 (see the changelog).**

### P3-05 — Save and load champion brain (localStorage)

- **Priority:** P0 · **Status:** Complete (owner completion approval 2026-11-10, see the changelog row; merged in #136) · **Issue:** [#25](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/25) · **Stretch target:** ST1
- **Depends on:** P2-03, P2-07
- **Description:** Implement MODEL_FORMAT.md v1: save champion with full metadata to localStorage, list and load compatible models, handle storage failures, warn that storage is not permanent.
- **Acceptance criteria:**
  - Saved then loaded model drives identically.
  - Throwing or empty localStorage handled with clear messages.
- **Test requirements:**
  - Unit: round-trip, validation failures, storage exceptions.
  - E2E: save, reload page, load.
- **Implementation notes ([authorised](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/25#issuecomment-6727944973), as specified in `docs/plans/p3-05-plan.md`):** a pure `persistence/modelFormat.ts` (build and validate MODEL_FORMAT.md v1, every error reported), an injected-storage `persistence/modelStore.ts` (`sdae:model:<id>` and an index, a cap of 20, damaged and recovered entries, every failure a message), and a "Saved champions" section in the Champion replay block (save the picked generation's champion, list, replay, two-step delete, a permanence notice). "Load" means replaying the saved brain under its own recorded conditions; it never enters the trainer. **Specification amendments (owner-approved defaults, listed in MODEL_FORMAT.md):** `generations` may be `null`, `trackHashes` is added, and the build identifier is injected from the commit variables. **Merged as `5dbb99e` (#136).** **Device checks: owner-reported, not run by either agent.** The owner confirmed completion of the six P3-05 iPhone/iPad checks in `docs/TESTING.md`, including Download JSON, relayed on [#25](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/25#issuecomment-6742744158) (2026-11-09 14:37:41 UTC, before the merge at 16:20:44 UTC), with no problems reported. Individual results, device/OS/browser versions and the tested deployment SHA were not supplied and are not invented; there is no established deployment-to-SHA mapping. The owner later wrote "Device checks complete p3-02 through p3-05. Unmeasured frame rate is accepted." ([#138](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/138#issuecomment-6745908947)); that is neither a separate completion approval nor measured performance. No repeat checks are requested. **Export:** the owner chose ([#25](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/25#issuecomment-6741305815)) to take the recommendation, so a minimal "Download JSON" per valid save is in P3-05 (the page also says saves live in this browser only); importing a file and its checks, the file size limit, migrations and the re-import test stay in P3-06. See ARCHITECTURE.md and the TESTING.md rows. No learning claim.

### P3-06 — JSON export/import, validation, versioning and compatibility checks

- **Priority:** P0 · **Status:** Complete (owner completion approval 2026-11-10, see the changelog row; merged in #139) · **Issue:** [#26](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/26) · **Stretch target:** ST1
- **Depends on:** P3-05
- **Description:** Export a model as a `.json` download and import from a file with size limit, schema validation, version checks and migration hooks.
- **Acceptance criteria:**
  - Every invalid case in TESTING.md is rejected without side effects.
  - Exported file re-imports identically.
- **Test requirements:**
  - Unit: validator and migration.
  - E2E: export then import (Chromium and WebKit).
- **Implementation notes ([authorised](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/138#issuecomment-6745908947), as specified in `docs/plans/p3-06-plan.md`):** `persistence/modelImport.ts` (pure: size cap before `JSON.parse`, byte-order mark stripped, parse, migrate, validate, compatibility; it writes nothing, so a refusal has no side effect), `persistence/migrations.ts` (`migrateToCurrent`; **the real registry is empty, so no migration is claimed to exist**; the hook is tested with a synthetic registry), `store.importModel` (identical content under a taken id is a no-op, different content becomes a copy under a new id, never an overwrite; the cap of 20 applies), and an Import JSON file control in the Saved champions section (one file; `file.size` is checked before the file is read; the file name is never used or shown). The plan's five defaults are implemented as proposed. Tests: `tests/persistence/modelImport.test.ts` (every invalid case refused with nothing written, oversize refused before parsing, migration, re-import identical for several seeds, a committed synthetic fixture `tests/fixtures/champion-v1.json`), `tests/ui/trainingPageImport.test.ts` (page wiring) and an E2E in `tests/e2e/training.spec.ts` (download, delete, import, byte-identical re-export, invalid and oversized files). **Correction cycle 1 (Codex changes required, three findings, all fixed):** one UTF-8 byte limit for import, save and export (an offered download can always be imported again; compact fallback near the limit), a refusal when the storage inventory is incomplete plus a direct destination-key check (no overwrite of an orphan save), and guarded serialization (a refusal message, never an exception). **Merged as `2485f52` ([#139](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/139), 2026-11-09 18:53:28 UTC).** **Complete on 2026-11-10 (owner approval; see the changelog).** Until then (historical state at the merge) the owner's import device checks had not been reported; the owner later wrote "Device checks completed" ([#42](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/42#issuecomment-6769697822)), read as covering them, with no per-check results.


### P3-07 — Performance monitoring, iOS suspension handling and training checkpoints

- **Priority:** P1 · **Status:** Complete (owner completion approval 2026-11-10, see the changelog row; merged in #142) · **Issue:** [#27](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/27)
- **Depends on:** P3-03, P3-06, P1-03
- **Description:** Debug panel with FPS and mean step time; save a separate versioned generation-boundary checkpoint containing the population, champion, next-generation index, all PRNG states/caches, full configuration, track versions and metrics. Save periodically while active; tab-hide delivery is not guaranteed. Champion JSON alone cannot resume evolution. Handle quota/storage failures and offer file export.
- **Acceptance criteria:**
  - The FPS and mean step-time readouts remain a P3-07 requirement; they are not moved to P3-01. TESTING.md's low-power check takes its frame-rate and step-time figures from them. Metrics visible on a named device/browser with recorded population, track and render mode; resuming at a generation boundary matches an uninterrupted run. Storage failures leave training usable and are reported.
- **Test requirements:**
  - Integration: checkpoint and resume determinism, PRNG state/cache recovery and unavailable/quota-limited storage; manual iOS background/resume and termination recovery checks.
- **Implementation notes ([authorised](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/27#issuecomment-6753497819), as specified in the merged plan `docs/plans/p3-07-plan.md` with its six proposed defaults):** a generation-boundary checkpoint, a new versioned format separate from the model format ([CHECKPOINT_FORMAT.md](CHECKPOINT_FORMAT.md)); `createTrainer` resume and `checkpointState()` (a fresh run is unchanged); compact history (the last 20 generations and the best so far in full, the rest compact with champion and per-car fitness unavailable); an injected `resolveConfig` adapter so no lint boundary changed; a one-slot store where a failed write keeps the previous checkpoint; one saver that orders every write; best-effort hide-time saves; a stored checkpoint only **offered**, never resumed automatically; Download checkpoint (from memory, independent of storage) and Load checkpoint file; and a step-time and draw-time readout with population, track and build named. **Merged as `b40b652` ([#142](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/142), 2026-11-10 08:46:22 UTC).** **Complete on 2026-11-10 (owner approval; see the changelog).** Until then (historical state at the merge) the four iPhone/iPad checks had not been reported; the owner later wrote "Device checks completed" ([#42](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/42#issuecomment-6769697822)), read as covering them, with no per-check results. **Criterion decision:** the "metrics visible on a named device/browser with recorded population, track and render mode" figures were not measured and are **waived by the owner for completion**, on the question and answer quoted in the changelog row of 2026-11-10 (P3-02 to P3-07 Complete); this waiver is specific to P3-07 and is not an extension of the earlier P3-02 to P3-05 waiver. The readout itself exists (`?debug=fps`); no figures are recorded. Real iOS suspension and termination remain manual checks only. Resume reproduces the same run on the same engine and build and claims nothing about learning.

### P3-08 — Initial saved-model comparison

- **Phase:** 3 · **Priority:** P1 · **Status:** Complete · **Issue:** [#42](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/42)
- **Depends on:** P3-04, P3-06
- **Description:** Initial saved-model comparison provides the primary-release comparison capability.
- **Acceptance criteria:** Two saved models can be inspected side by side in Phase 3 using architecture, configuration, seed, generation, training track/version and recorded metrics. Compatible models can be replayed under the same conditions; incompatible fitness values are not ranked. P5-05 adds repeated multi-track statistical comparisons.
- **Test requirements:** Unit: comparison compatibility and missing evaluations; E2E: compare two imported models and show a mismatch warning.
- **Implementation notes ([authorised](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/42#issuecomment-6764100706), relayed by Codex: "I authorize p3-08"; as specified in `docs/plans/p3-08-plan.md`, Codex design approval [review 5839706097](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/143#pullrequestreview-5839706097), with its five proposed defaults):** a pure `persistence/modelCompare.ts` (side-by-side rows; **fitness ranked only when the scoring, simulation version, track and conditions all match**, every reason listed; **score comparability and replay compatibility are separate questions**, so a fitness-version-only difference blocks ranking but not the combined replay; absent evaluation shown as unavailable and a present one as recorded but unsupported and unverified, with only a count); a headless lockstep `training/pairReplay.ts` (each car equals its solo replay); `ModelStore.inspect`; and a Compare section in the Champion replay panel (accessible table, two cars drawn with identity colours and an A/B label, the combined replay refused with reasons when driving conditions differ). **Merged as `4a4aa1b` ([#145](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/145), 2026-11-10 11:17:37 UTC).** **Complete** (see the completion record below; the device checks were owner-reported after the merge). No ranking beyond what the rules allow, no evaluation run, no learning claim; P5-05 owns repeated statistical comparison.
- **Completion record (P3-08, 2026-11-10; #143, #145, #146):**
  1. **Implementation exists and can be demonstrated:** `?mode=train`, Champion replay panel, "Compare two saved champions": two saves side by side (`src/persistence/modelCompare.ts`, `src/ui/compareView.ts`), and a combined replay of both under the same conditions (`src/training/pairReplay.ts`), merged in [#145](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/145) as `4a4aa1b`.
  2. **Required automated tests:** unit: comparison compatibility and missing evaluations (`tests/persistence/modelCompare.test.ts`, `tests/training/pairReplay.test.ts`, page wiring in `tests/ui/trainingPageCompare.test.ts`); E2E: compares two saves and three imported synthetic models and shows the mismatch warning (`tests/e2e/training.spec.ts`). Exact-head CI [run 42802475076](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/42802475076) and `main` CI [run 42806280813](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/42806280813) passed both required jobs, including Chromium and WebKit.
  3. **Mobile:** the owner reported ["Device checks completed"](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/42#issuecomment-6769697822) (owner-reported, not run by either agent; recorded in `docs/TESTING.md`). Individual results for the four checks, device models, OS and browser versions and the deployed commit were not stated and are not invented. The CI browser projects are emulation, not physical Safari.
  4. **Existing functionality still works:** the full unit suite and the full browser suite passed in the CI runs above.
  5. **Acceptance criteria:** two saved models are inspected side by side by architecture, configuration (every supported physics field and fitness weight with both recorded values), seed, generation, training track and version, and recorded metrics; compatible models replay together under the same conditions; **incompatible fitness values are not ranked** (ranking only when scoring, simulation version, track and conditions all match, with every reason listed). P5-05 adds repeated multi-track statistical comparison.
  6. **Documentation:** ARCHITECTURE.md, TESTING.md, this file and `docs/plans/p3-08-plan.md`.
  7. **Second-agent review:** Codex reviewed the plan #143 (review 5839422490, Changes required; [5839706097](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/143#pullrequestreview-5839706097), design approval of `d45d19e`) and the implementation #145 ([5840565585](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/145#pullrequestreview-5840565585), Changes required; [5840917500](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/145#pullrequestreview-5840917500), Technical approval of `e51724b`, after two correction cycles), and the merge record #146 ([5842936460](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/146#pullrequestreview-5842936460)).
  8. **Codex technical approval and owner approval:** the owner merged #143 (`b388a39`), #145 (`4a4aa1b`, tree identical to the approved `e51724b`) and #146 (`d19dc5d`). The owner's completion approval is recorded as relayed instructions on #42: ["145 merged and p3-08 approved, continue development of p3-08"](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/42#issuecomment-6765953785) and, when asked what "approved" covered, ["Device checks completed, and it was my completion approval"](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/42#issuecomment-6769697822).
  - **Not claimed:** fitness is a training score on the training track, not an evaluation; no statement that one model is better; no learning or generalisation claim. Imported `evaluation` data is shown as unsupported and unverified. ST1 to ST5 stay visible.

## Phase 4 — Interactive track editor

**Phase acceptance:** Users can create valid tracks and evaluate trained models on unfamiliar layouts.

### P4-01 — Track data format and validation

- **Priority:** P1 · **Status:** Complete (owner completion approval 2026-11-11; implemented and merged in #151 as `dd8d841`; device checks are not applicable, there is no UI) · **Issue:** [#28](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/28)
- **Plan (merged in [#150](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/150)):** [`docs/plans/p4-01-plan.md`](plans/p4-01-plan.md) on `docs/p4-01-plan`.
- **Depends on:** P1-04, P1-07
- **Description:** Versioned track JSON (boundaries, start pose, ordered gates, split label) and a validator: closed, non-self-intersecting boundaries, start inside the road, ≥ 3 gates spanning the road, minimum road width.
- **Acceptance criteria:**
  - Built-in tracks pass; each invalid case returns a readable error.
- **Test requirements:**
  - Unit: one test per validation rule.
- **Implementation notes ([authorised](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/28#issuecomment-6796133012), as specified in `docs/plans/p4-01-plan.md`, #150 under review):** `src/sim/trackValidation.ts` (pure; `validateTrack`, `loadValidatedTrack`, `describeTrackErrors`) with 14 rules each reporting a stable rule id and a readable sentence, all errors collected, hostile input never throwing; format version 1 is the existing shape with optional `format`, `schemaVersion` and `split` (the three built-in files and every content hash are unchanged); `loadTrack` stays shape-only; the built-in manifest loader validates each file and refuses a split label that disagrees with the manifest. Documented in `docs/TRACK_FORMAT.md`. One deviation from the plan, listed for review: when a wall rule fails, the rules that need valid walls are skipped and reported in `skipped` instead of producing meaningless follow-on errors. No UI, storage or device check; no claim about learning.
- **Completion record (all eight AGENTS.md gates):**
  1. **Implemented and demonstrable:** `validateTrack`, `loadValidatedTrack` and `describeTrackErrors` (`src/sim/trackValidation.ts`), the format document `docs/TRACK_FORMAT.md` and the manifest integration, merged in [#151](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/151) as `dd8d841`; the three built-in tracks pass with no warnings.
  2. **Automated tests run and pass:** 65 new tests in `tests/sim/trackValidation.test.ts` (the exact-head run, `7669a55`) (one or more per rule, the concave L-shaped road and its reversed-array variant driven through `advanceProgress`, hostile input, a maximum-size ring, the manifest checks); exact-head CI [run 43043796688](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/43043796688) (attempt 4) passed both required jobs on `7669a55`, after three browser-job failures that were `apt` mirror timeouts during `playwright install` (no test ran); `main` CI [run 43074469870](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/43074469870) on the merge passed both jobs.
  3. **Mobile browser behaviour:** **not applicable**: P4-01 adds no screen, control or stored data. CI browsers are emulation, not physical Safari; the track editor (P4-02) will carry the iPad checks.
  4. **Existing functionality still works:** the full suite passed unchanged apart from the new tests; the built-in tracks' content hashes, the checkpoint engine and the simulation are unchanged (hash and golden tests).
  5. **Acceptance criteria:** "built-in tracks pass" (tested) and "each invalid case returns a readable error" (one test per rule asserting the rule id and a readable sentence), plus the direction contract added in review.
  6. **Documentation:** `docs/TRACK_FORMAT.md`, `ARCHITECTURE.md`, `TESTING.md` and this file.
  7. **Second-agent review:** Codex reviewed each head of #151 and of the plan [#150](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/150) (merged before the implementation; for #151 the reviews were [5859147823](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/151#pullrequestreview-5859147823) and [5859329039](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/151#pullrequestreview-5859329039), Changes required, then [Technical approval of `7669a55`](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/151#pullrequestreview-5860803708)) after **two correction cycles**: cycle 1 tied gate order and start heading to the checkpoint engine's direction; cycle 2 replaced a local-tangent check, which falsely rejected a valid concave corner, with the outer polygon's signed area.
  8. **Codex technical approval and owner approval:** the owner merged #151 at `7669a55`'s tree (`dd8d841`, 2026-11-11 18:05 UTC). Relayed owner instruction (Claude Code, 2026-11-11): asked "Do you approve P4-01 as Complete?", the owner answered "I'll approve p4-01" (record on [#28](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/28)).
  - **Not claimed:** a passing track is well-formed and drivable by the rules, not good for training; no learning or generalisation claim. The validator is headless and not wired into any editor or storage yet (P4-02, P4-03).

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
- **Plan (under review, not authorised for implementation):** [`docs/plans/p4-04-plan.md`](plans/p4-04-plan.md) on `docs/p4-04-plan`.
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

### P4-06 — Silverstone: first real-world circuit (import, validation and selection)

- **Priority:** P1 · **Status:** Not Started · **Issue:** [#57](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/57)
- **Depends on:** P4-01, P2-10, P2-05, P2-07, P3-05 (P2-07 supplies experiment manifests and P3-05 saved models, which both record the track version). P2-11 is a conditional prerequisite: see the performance criterion below.
- **Description:** Import Silverstone from the TUMFTM racetrack-database (`tracks/Silverstone.csv`: centre line and right/left widths in metres) into the P4-01 track format, as the first real-world circuit. Silverstone is in the **training** split, so generalisation claims use other held-out tracks. Importer and data only, not combined with unrelated changes. Excludes the `racelines/` files, any precomputed racing line as a network input, scripted steering and car-to-car interaction (R-01/R-02).
- **Acceptance criteria:**
  - A deterministic conversion script in `scripts/` records source URL, commit and file hash; the committed track file equals its output.
  - Boundaries built from the centre line and widths pass the P4-01 validator. Ordered gates (about every 50 m) and a documented start pose behind gate 0 are included.
  - Track ID `silverstone` and a source-commit-plus-content-hash version are recorded in experiment manifests and saved models. Episode duration and stall timeout are scaled to the ~5.9 km lap.
  - Users can select the synthetic circuits or Silverstone. Synthetic tracks and their tests are unchanged.
  - A seeded population training run on Silverstone is deterministic, with car independence as in P2-05.
  - The brute-force baseline is measured against the P2-11 budget, using its reference phone and workload, and the figures are recorded in #56 and #57.
    - If the budget is met, P2-11 is not needed for Silverstone.
    - If it is missed, P2-11 is triggered, and P4-06 stays In Review until P2-11 is Complete and the budget is met.
  - Display: the whole circuit is fitted to the canvas on desktop, phone and tablet. Legible individual cars on phones (zoom and follow) are P4-07, a separate display follow-up and PR, not a P4-06 completion prerequisite.
  - Licence confirmed before data is committed: the database is LGPL-3.0 and its centre lines come from OpenStreetMap (ODbL 1.0). The data file carries its own licence notice and attribution (TUM racetrack-database; "© OpenStreetMap contributors"), with owner sign-off.
- **Test requirements:**
  - Converter golden test; validator on Silverstone; gate order and spacing; start pose inside the road; deterministic training smoke run; E2E track selection and display.

### P4-07 — Camera zoom and follow for large circuits

- **Priority:** P1 · **Status:** Not Started · **Issue:** [#58](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/58)
- **Depends on:** P1-04, P2-05
- **Description:** A render-only camera with fit-whole-track, zoom and follow-a-car (default: current best car) modes, so large circuits stay legible on phones. Silverstone is about 1.0 × 1.7 km, so a fitted 4 m car is about 1 px on a phone. The camera never changes simulation state, sensors or results.
- **Acceptance criteria:**
  - Fit, zoom and follow work on desktop, phone and tablet. Zoom controls are keyboard accessible and at least 44 px. Pinch zoom affects the canvas only.
  - Camera changes leave training results identical for the same seed (test enforced).
- **Test requirements:**
  - Unit: world↔screen transforms and clamping; integration: results unchanged by camera; E2E fit/zoom/follow in Chromium and WebKit phone projects; manual real iPhone/iPad check.

## Phase 5 — Advanced driving intelligence

**Phase acceptance:** Show, with data, whether learned braking improves performance and whether trained models generalise to unseen circuits.

### P5-01 — Rule-based baseline driver

- **Priority:** P1 · **Status:** In Progress (steps 2 and 3 of the seven-step plan done: the driver, merged in #153, and the training-track tuning in #154; step 4 (E3 machinery) in progress: 4a, the controlled held-out access, on `feat/p5-01-e3-access`; 4b (records, parser, replay, analysis), the protocol, the run and the record not started) · **Issue:** [#33](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/33)
- **Plan (merged in [#152](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/152); owner authorised all steps, see issue #33):** [`docs/plans/p5-01-plan.md`](plans/p5-01-plan.md) on `docs/p5-01-plan`.
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
- **Description:** Profile and speed up headless training (typed arrays, Web Worker if the UI stutters, further work beyond the boundary spatial index if P2-11 was triggered earlier), without changing results.
- **Acceptance criteria:**
  - Before implementation, record target device/browser, workload and responsiveness budget in the issue. Publish before/after FPS, mean/p95 update cost and simulation throughput under the same configuration; the agreed budget and determinism checks pass. Adopt a Worker only if profiling demonstrates main-thread blocking.
- **Test requirements:**
  - Benchmark script; existing determinism tests.

## Process

**Phase acceptance:** Every feature is reviewed and verified against the same Definition of Done.

### Q-01 — Definition of Done and independent review workflow

- **Priority:** P0 · **Status:** Complete · **Issue:** [#39](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/39)
- **Depends on:** none
- **Description:** Adopt AGENTS.md completion criteria: Claude Code implements approved tasks and addresses findings; Codex independently reviews the current commit through GitHub review comments. Include actual tests, relevant device checks and explicit owner merge approval. A formal same-account approval badge is not required.
- **Acceptance criteria:**
  - PR template in `.github/`; every feature PR lists roadmap ID, actual command results, manual checks done/outstanding, current head SHA, Codex review link/outcome and the owner's separate merge-approval reference. Later commits receive re-review; no agent merges automatically.
- **Test requirements:**
  - Documentation consistency checks and independent review; no simulator/mobile checks apply to this documentation-only PR.
- **Completion record:**
  - **The workflow on `main`:**
    - The owner merged the stacked PRs #51, #52 and #53 into their branches, not into `main`, and then merged #40 into `main` without #53's changes.
    - The owner then merged [#54](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/54) into `main` at `dbb0782`. #54's tree matches [#53](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/53)'s head `0e501a2`.
    - Codex authored #52–#54, so its comments there are not independent review of the workflow.
  - **Independent (non-Codex) review:**
    - Claude Code's review of #53 at `0e501a2` (Changes required) had a blocking finding on stale base and integration order. #54 resolved it.
    - Claude Code's [review of the merged workflow](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/39#issuecomment-6390608815) at `844c33a` (Changes required) found one should-fix and no other blocking findings. On the shared account, owner approval written "in a GitHub comment" could not be told apart from agent text.
  - **Fix:**
    - [#78](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/78) added "Owner evidence on a shared account" to AGENTS.md and pointed the PR template there.
    - Codex gave it [technical approval at `ae0b4dd`](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/78#pullrequestreview-5640534695), with green CI on that head (run 40141607399).
    - The owner merged it at `787f185`.
  - **Acceptance:**
    - `.github/pull_request_template.md` on `main` has fields for the roadmap ID, actual command results, manual checks done and outstanding, the current head SHA, the Codex review link and reviewed SHA, and the owner's separate merge-approval reference.
    - AGENTS.md requires re-review after new commits and forbids automatic merges by agents.
    - The workflow is in use: P1-01 to P1-09 and P1-11 each have a recorded Codex technical approval and an owner merge (see the revision history; P1-01's approval was retrospective, and P1-08's was posted after its merge).
  - **Owner approval:** [relayed owner instruction](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/39#issuecomment-6391301136) (Claude Code, 2026-10-25): "I approve Q-01 as Complete, subject to Codex verifying the evidence." Codex's verification of this record is the condition, and is reviewed on the completion PR.
  - **Checks:** documentation only. No simulator, emulation or device checks apply.

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
6. **Scope.** 52 roadmap items including blocked research is a lot for a beginner-friendly codebase. Keep each PR to one roadmap ID where possible.

## Revision history

| Date | Change |
|------|--------|
| 2026-10-23 | Initial documentation work in Claude Code PR #40; verified main had no code and created issues #1–#39. |
| 2026-10-23 | Codex reconciliation preserves existing work; adds issues #41–#50, early evaluation fixtures and Phase 3 comparison, requires full model provenance, separates research training, and makes completion/recovery evidence explicit. |
| 2026-10-23 | Owner selects Claude Code as main developer and Codex as reviewer, using explicit commit-specific technical approval in GitHub comments and separate owner merge approval. Role/workflow changes are proposed in a dedicated follow-up PR; feature statuses are unchanged. |
| 2026-10-23 | P1-01 implemented and merged into `main` (#55); it stays In Review because real-device checks and a full Codex review record are outstanding. WebKit later passed in CI (run 39985079357 on #60). |
| 2026-10-23 | P1-10 CI workflow merged into `main` (#60). CI passed on its head (run 39985079357) and the throwaway failing-test PR (#61) failed both jobs as intended; it stays In Review until Codex's full review record with technical approval is posted. |
| 2026-10-23 | Owner approves the Silverstone and multi-car (Option A: independent, non-interacting cars) plan. Planning only: adds P2-11 (#56), P4-06 (#57) and P4-07 (#58), adds car-independence criteria to P2-05 and a drawing cap to P3-03, and narrows P5-06. No implementation. |
| 2026-10-23 | Codex review of #59 (`6de9693`): P2-11 becomes conditional on a measured brute-force baseline missing a recorded phone budget (or an owner-approved architectural reason) and no longer blocks P4-06. P4-06 now depends on P2-07 and P3-05, which record the track version; P4-07 is a separate display follow-up. Each item still needs owner implementation approval. The budget's workload fixes a population of 50 cars. |
| 2026-10-23 | P1-02 fixed-timestep loop implemented on `feat/p1-02-fixed-timestep` and moved to In Review; not Complete until real-device pause checks, Codex review and owner approval are recorded. |
| 2026-10-23 | P1-03 seeded generator (sfc32 with splitmix32 seeding) implemented on `feat/p1-03-seeded-rng` and moved to In Review; not Complete until Codex review and owner approval are recorded. |
| 2026-10-23 | P1-02 Complete: #62 merged by the owner after Codex technical approval of `c3c7b0c`, green CI and owner-reported real iPhone 15 and iPad Pro checks. The same device checks are recorded as evidence for P1-01, which stays In Review. |
| 2026-10-23 | P1-03 Complete: #64 merged by the owner after Codex technical approval of `c0416c0` and green CI (run 40008147161). No device check applies: the generator is headless and has no callers yet. |
| 2026-10-23 | P1-04 track model, stadium-oval fixture and cached static track layer implemented on `feat/p1-04-track-foundation` and moved to In Review; not Complete until real iPhone/iPad rendering checks, Codex review and owner approval are recorded. |
| 2026-10-23 | P1-04 Complete: #65 merged by the owner after Codex technical approval of `7c61906`, green CI (run 40011479878, 48/48 browser tests including WebKit) and owner-reported real iPhone 15 and iPad Pro rendering checks. |
| 2026-10-23 | P1-05 vehicle physics (kinematic bicycle, derived terminal speed, high-speed steering limit) implemented on `feat/p1-05-vehicle-physics` and moved to In Review; not Complete until Codex review and owner approval are recorded. MODEL_FORMAT physics gains `maxLateralAcceleration` and `stopSpeed`. |
| 2026-10-23 | P1-05 Complete: #66 merged by the owner at `998437e` after Codex technical approval of `45b72bd` and green CI (run 40017368055, 48/48 browser tests including WebKit, first attempt). Headless physics; no device check applies until cars are drawn (P1-08). |
| 2026-10-24 | P1-06 collision detection (swept footprint-versus-boundary checks, stop-and-flag response) implemented on `feat/p1-06-collision` and moved to In Review; not Complete until Codex review and owner approval are recorded. |
| 2026-10-24 | P1-06 Complete: #67 merged by the owner at `31a1a43` after Codex technical approval of `4fcf014` and green CI (run 40081115909, 48/48 browser tests including WebKit). Headless collision; no device check applies until cars are drawn (P1-08). P2-01 is now ready. |
| 2026-10-24 | P1-07 ordered checkpoints, lap counting and tick-based lap timing implemented on `feat/p1-07-checkpoints` and moved to In Review; not Complete until Codex review and owner approval are recorded. |
| 2026-10-24 | P1-07 Complete: #69 merged by the owner at `0fbc742` after Codex technical approval of `f15398e` (its notes addressed in the docs-only `26fb7cf`) and green CI (run 40088286445, 48/48 browser tests including WebKit). Headless; no device check applies until laps are shown (P1-08). P1-08, P1-09, P2-06, P2-10 and P4-01 are now ready by dependencies. |
| 2026-10-24 | P1-08 manual driving (keyboard and touch controls, car drawing, lap display, restart) implemented on `feat/p1-08-manual-driving` and moved to In Review; not Complete until real iPhone/iPad Safari checks, Codex review and owner approval are recorded. |
| 2026-10-24 | P1-08 Complete: #70 merged by the owner at `b597e37` (same tree as the reviewed head `25380c8`), with Codex technical approval of `25380c8` posted after the merge, green CI on both (runs 40096285817 and 40096445158) and owner-reported real iPhone 15 and iPad Pro Safari confirmation. P1-01 and P1-10 still await Codex's full review records. |
| 2026-10-24 | P1-09 deterministic simulation suite (seeded world scenarios, golden file, frame-loop, catch-up, pause and restart determinism tests) implemented on `feat/p1-09-deterministic-suite` and moved to In Review; not Complete until Codex review and owner approval are recorded. |
| 2026-10-24 | P1-09 Complete: #72 merged by the owner at `38ff6a6` after Codex technical approval of `fc2eda8` and green CI (run 40103303780, including WebKit; `main` run 40109833771 also green). Tests and docs only; no device check applies. |
| 2026-10-24 | P1-11 static-host compatibility (plain static file server tests at the root and a sub-path, README deployment section) implemented on `feat/p1-11-static-deployment` and moved to In Review; not Complete until Codex review and owner approval, including the owner's decision on the iPhone preview evidence, are recorded. |
| 2026-10-24 | P1-11 Complete: #74 merged by the owner at `52b835c` after Codex technical approval of `0d5a5b7` and of the reconciled head `0406567`, and green CI (runs 40110560517 and 40112890832, including WebKit). Device criterion met by existing owner-reported iPhone records of Vercel previews, accepted by Codex. |
| 2026-10-24 | P1-01 Complete: retrospective Codex technical approval of `9ba08e8` (#55, merged at `5a3e494`) supplies the missing review record; no new implementation was needed. P1-10 also has a retrospective Codex technical approval of `af6350b` (#60, merged at `ab1436c`) but stays In Review: its "blocks on failure" criterion needs the owner's branch protection (or an explicit criterion change), which is not verified. Earlier rows named the reviewed heads as merge points; the merge commits are `5a3e494` and `ab1436c`. |
| 2026-10-24 | P2-01 ray sensors (seven validated rays from the body centre, `?debug=rays` debug layer) implemented on `feat/p2-01-ray-sensors` and moved to In Review; not Complete until Codex review, owner approval and real iPhone/iPad Safari checks are recorded. |
| 2026-10-25 | Q-01 Complete: the non-Codex review of the merged workflow (should-fix fixed in #78, Codex technical approval of `ae0b4dd`, merged by the owner at `787f185`) and the owner's completion approval, relayed on #39 on condition that Codex verifies the evidence. |
| 2026-10-25 | P2-02 nine network inputs (seven normalised rays, normalised speed, signed heading error to the next gate's centre from the rear axle ÷ π) implemented on `feat/p2-02-network-inputs` and moved to In Review. P2-01 reconciled: merged in #79 at `5c18365`, still In Review because no real iPhone/iPad results are recorded. |
| 2026-10-25 | P2-02 Complete: #81 merged by the owner at `4f3abef` (same tree as `7bda450`), after Codex technical approval and green CI (run 40212259053, including WebKit); device checks not applicable. P2-03 9-12-3 feedforward network (pure inference, documented parameter order, tanh/sigmoid outputs, brake mask, seeded uniform initialisation) implemented on `feat/p2-03-feedforward-network` and moved to In Review. P2-01 remains In Review for real iPhone/iPad checks. |
| 2026-10-25 | P2-03 Complete: #82 merged by the owner at `814d4e0` (same tree as `0042f5f`), after Codex technical approval and green CI (run 40239101523, including WebKit); device checks not applicable. Its non-blocking null-vector finding is tracked in #83. P2-04 genetic operators (tournament selection, uniform crossover, Gaussian mutation, elitism; separate seeded generators) implemented on `feat/p2-04-genetic-operators` and moved to In Review. P2-01 remains In Review for real iPhone/iPad checks. |
| 2026-10-26 | P2-04 Complete: #84 merged by the owner at `1a98ce9` (same tree as `d429872`), after Codex technical approval of `d429872` and green CI (run 40242573267 including WebKit; `main` run 40243046217); device checks not applicable. P2-06 episode fitness (ordered gates, a bounded partial-progress high-water mark, capped lap-time bonus, crash penalty; completed, crashed, stalled and timeout outcomes) implemented on `feat/p2-06-fitness` and moved to In Review. P2-01 remains In Review for real iPhone/iPad checks. |
| 2026-10-26 | P2-06 Complete: #85 merged by the owner at `4e02d70` (same tree as `6672bea`), after Codex's Changes required on `8ff1a92` was fixed and Codex gave technical approval of `6672bea`, with green CI (run 40369048174, including WebKit); device checks not applicable. P2-05 population training loop (independent neural cars through one simulation path, seeded run generator, elites, per-generation statistics; headless, and rendered with `?mode=train`) implemented on `feat/p2-05-training-loop` and moved to In Review; real iPhone/iPad checks of the training view are outstanding. P1-10 and P2-01 remain In Review. |
| 2026-10-26 | P2-05 merged by the owner in #86 at `de904ef` (same tree as Codex-approved `4e8c6d6`, CI run 40389883365 green); it stays In Review until real iPhone/iPad checks of `?mode=train` are recorded. Follow-up corrects stale status summaries in AI_EVALUATION, ARCHITECTURE and TESTING (Codex P3 on #86) and sets a 30 s unit-test limit for slow deterministic tests. |
| 2026-10-26 | P2-10 built-in track splits (training `stadium-oval`, validation `rounded-rectangle`, held-out `hairpin-chicane`; SHA-256-hashed manifest; trainer, selection and frozen-model held-out boundaries) implemented on `feat/p2-10-track-splits` and moved to In Review. P1-10, P2-01 and P2-05 remain In Review. |
| 2026-10-27 | P2-10 Complete: #88 merged by the owner at `dbb314b` (same tree as the final head `f3b34a4`), with green CI on the head and the merge (runs 40481310774 and 40482716207, including WebKit). Codex's Changes required on `c75a783` (two P2, one P3) was fixed in `f3b34a4`, and Codex's technical approval of `f3b34a4` was given after the merge, retrospectively; device checks not applicable. P1-10, P2-01 and P2-05 remain In Review. |
| 2026-10-27 | P2-07 seeded experiments (configuration, complete JSON records with contracts, track and split hashes, budgets, raw per-car results and frozen champions; same-engine replay; `npm run experiment`) implemented on `feat/p2-07-experiments` and moved to In Review. No experiment has been run. P1-10, P2-01 and P2-05 remain In Review. |
| 2026-10-27 | P2-01 and P2-05 Complete: owner-reported physical-device checks (not run by either agent), relayed on #12 and #16, on the production URL with the deployed commit unverified. iPhone 15 (iOS 27.0.1): all four sensor-ray checks passed; manual controls and layout worked, training advanced from generation 8 to 9, and rotation and app-switch/resume passed. iPad Pro 11-inch (3rd generation, iPadOS 26.6.2): the owner confirms all requested training and sensor-ray checks passed; its screenshot shows an in-app browser and does not establish standalone Safari testing. These checks show usability and that training runs, not learned driving. P2-07 merged in #89 at `9ea5511` and stays In Review pending its completion record. P1-10 remains In Review. |
| 2026-10-27 | P2-07 Complete: #89 merged by the owner at `9ea5511` (same tree as the final head `0b2737d`), after Codex's technical approval of `0b2737d` and green CI on the head and the merge (runs 40494094023 and 40499436295, including WebKit); device checks not applicable. Codex's non-blocking P3 (nested unknown configuration keys) stays open. P2-08 plan proposed in `docs/experiments/p2-08-plan.md` (planning only; nothing implemented or run). P1-10 remains In Review. |
| 2026-10-27 | P2-08 plan revised after Codex's retrospective review of #91 (Changes required on the plan, P2-07 record verified; #91 was merged before that review). A1/A7 episode counts are consistent across tracks, E1 keeps AI_EVALUATION's population-sized cohort (P episodes per training seed per track), and the exact Wilcoxon convention for zeros and ties is fixed. Planning only; P2-08 stays Not Started. |
| 2026-11-01 | P2-08 plan: the per-agent, per-track evaluation budgets (A1, A7, A2, A9, A8, A5) are collected in one table, and the reuse of A1/A7 action seeds across tracks is stated. This completes the consistency asked for in Codex's review of #91; Codex approved the earlier fixes on #92. Planning only; P2-08 stays Not Started. |
| 2026-11-01 | #89's non-blocking P3 fixed on `fix/experiment-nested-config-keys`, authorised by the owner as the P2-08 plan's prerequisite. Experiment configurations now reject unknown fields inside the `selection`, `crossover`, `mutation` and `fitness` blocks. Valid configurations, defaults, records and replay are unchanged. P2-07 stays Complete; P2-08 stays Not Started. |
| 2026-11-01 | Records reconciled after #93 and #94. The #89 P3 is recorded as fixed in #94 (merged at `d42bb2a` after Codex's technical approval of `57a1371`), and `main`'s green CI runs 41310842372 and 41311774395 are recorded. GitHub now reported `main` as protected, but the required checks were not yet visible to the agents. |
| 2026-11-01 | **P1-10 Complete, and with it Phase 1.** The active ruleset "Protect main" (26312591) requires pull requests and both CI jobs for `main`, with no bypass. Codex [verified it through the API](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/10#issuecomment-6559229702) after the owner added the browser check that its [first record](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/10#issuecomment-6558905157) found missing, and the owner [confirmed it on #10](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/10#issuecomment-6559346059). This verifies the saved configuration together with #61's historical failing run, not a live refused merge. |
| 2026-11-01 | P2-08 In Progress, plan step 2 only (authorised alone): A1 and A7 seeded random-action drivers, a network driver, the trainer's per-tick path extracted into `episodeStep.ts` and shared with a headless `evaluateDriver` (training or validation tracks, never held-out, never trained on). The trainer's results are unchanged, checked against hashes recorded on `main` at `ee4b269`. Steps 3 to 5 (A2/A8/A9, study runner, analysis, pilot and confirmatory runs) are not authorised; no study has run and no learning is claimed. |
| 2026-11-01 | P2-08 step 2 merged in #96 at `5b61db5` (the same tree as `e2f1118`). Codex's formal technical approval covers `cb23a3e`; the follow-up commit `e2f1118` fixed its two P3s and had only the automated receipt before the merge, so its formal review is requested retrospectively. The step 2 follow-up also corrects the stale plan wording in AI_EVALUATION.md and adds a JSON `__proto__` regression test. Step 3 tooling is authorised to start after that follow-up is approved. P2-08 stays In Progress; no study has been run. |
| 2026-11-01 | P2-08 step 3 (tooling), first part: baseline generation and selection on `feat/p2-08-baselines`. A2 is the evolutionary run's generation 0, A9 its best by training fitness, and A8 P × G random networks continuing the same initialisation stream (`trainerStreams`), with one selection rule (earliest wins ties), frozen selected models and P × G accounting including elite re-evaluations. Design committed before the code. No manifests, records, study command or analysis; no study run; no learning claim. |
| 2026-11-01 | P2-08 step 3 B2 on `feat/p2-08-agents`: A5's full run and frozen champion (checked against the trainer's), A1/A7 episodes from SHA-256 action seeds on both tracks, and a descriptive validation-track evaluation of A2, A9, A8 and A5 (`training/agents.ts`, the only step 3 module that calls `validationTrack`). Genome diversity is recorded as evaluations, `maxDistinctGenomes` and `actualDistinctGenomes`. Design notes committed before the code. The overall design (#98) is merged, with Codex's technical approval of `d8b0dc3` given retrospectively after the merge. No manifests, records, study command or analysis; no study run; no learning claim. |
| 2026-11-01 | P2-08 step 3 C1 on `feat/p2-08-study-records`: versioned study manifest and per-seed record formats (`training/study.ts`), strict parsing with recomputed selections, models, action seeds, budgets and hashes, compatibility checks, and same-engine replay. The manifest enforces the label seed sets, E = P and hold 30 for pilot and confirmatory studies, δ ≥ 0.25 and the training/validation tracks; the held-out track is refused. B2 (#100) merged at `f5bb25a`, the same tree as the approved head `3527c61`. The command line is C2. No pilot or confirmatory manifest or result committed; no study run; no learning claim. |
| 2026-11-01 | Workflow (Q-01 follow-up, documentation only) on `docs/usage-efficient-workflow`: AGENTS.md gains a permanent usage-efficient development workflow (INSPECT → PLAN → IMPLEMENT → VERIFY → REVIEW → RECORD). It covers all approved work in Phases 1 to 6 and cross-cutting tasks; research still needs its own authorisation. It asks for targeted inspection, reuse and bounded scope. One verification contract, reconciled with §Tests, sets out targeted checks while developing; every required check on the first head submitted for review; impact-based local reruns on later heads, covering dependants and integration contracts, or the full suite when the impact is broad; every required CI job, review and device evidence on each head proposed for merge; and a separate post-merge check of CI on `main`. Review corrections are batched, with at most three correction cycles before a blocker report. Reports stay concise. Preventable follow-up PRs are avoided, but focused ones are allowed for later evidence, discovered errors and required records when the original PR is closed, keeping the real chronology. No gate is removed or relaxed. Q-01 stays Complete, and this change needs independent Codex review and the owner's approval. No application code or acceptance criteria changed. |
| 2026-11-01 | P2-08 step 3 C2 on `feat/p2-08-study-cli`: the `npm run study -- run <manifest> --seed <s> --out <record> [--force]` and `replay <manifest> <record>` command line (`scripts/study.mjs`), with exit codes 0, 1 and 2, safe overwrite (`--force` only, written in full before it is moved into place, never over the manifest) and pilot and confirmatory runs only from a clean worktree at the manifest's frozen commit. C1 (#101) merged at `bce9cc6`, the same tree as `a9454b0`; its formal review is requested retrospectively. Design notes committed before the code. No pilot or confirmatory manifest or result committed; no analysis; no study run; no learning claim. |
| 2026-11-01 | P2-08 step 3 D1 on `feat/p2-08-analysis`: the analysis and report library (`training/analysis.ts`), under the step 3 tooling authorisation ("deterministic analysis and reporting"). It parses and replays every record before analysing it, refuses missing, duplicate or extra seeds, and computes per-seed summaries, the A5 - A8 primary contrast (seeded percentile bootstrap, type 7 median and IQR, exact Wilcoxon), descriptive secondary contrasts, A5 by generation, acceptance eligibility and the p2-08-decision-v1 result, as `analysis.json` data and `report.md` text. Only an acceptance-eligible confirmatory analysis meeting every condition can state the one claim. C2 (#102) merged at `deffd9c`, the same tree as `310c28d`. Design notes committed before the code. The `analyse` command is D2. No study run, no results, no learning claim. |
| 2026-11-01 | P2-08 step 3 D2 on `feat/p2-08-analyse-cli`: `npm run study -- analyse <manifest> <record>… --out-dir <dir> [--force]` replays every record and writes the deterministic `analysis.json` and `report.md` (exit 0 or 2; nothing written on any refusal; never over an input; `--force` only for existing outputs). D1 (#104) merged at `49dcded`, the same tree as the approved head `79f1d9a`. Design notes committed before the code. This completes the step 3 tooling; no study run, no results committed, no learning claim. Steps 4 and 5 (pilot and confirmatory runs) need their own authorisation. |
| 2026-11-02 | P2-08 D2 correction on `fix/p2-08-pair-rollback-ownership`, based on #105 at `ca8e0c2`: rollback captures each public entry before checking ownership, restores or retains and names competing content, and cleans failed staging inside the cleanup guard. Codex implements this bounded exception under the [relayed owner instruction](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/105#issuecomment-6573408415); Claude must independently review it. P2-08 remains In Progress; no technical approval or merge is implied, and no study is run. |
| 2026-11-02 | P2-08 plan step 4 (pilot) authorised by the owner. First gate on `feat/p2-08-pilot-manifests`: three frozen pilot manifests (C0, C1, C2; seeds 9001–9003; E = P = 50; frozen commit `c14f368`, which contains all of step 3) and a protocol fixing the run procedure, the configuration choice (`selectByValidation`), the n = 10 or 20 rule, δ, the lap check, the measurements and the storage question, all written before any seed runs. No seed has run; no result; no learning claim. P2-08 stays In Progress. |
| 2026-11-02 | P2-08 plan step 4 (pilot) results on `feat/p2-08-pilot-results`: the exploratory pilot ran under the merged #107 protocol at frozen commit `c14f368` (Node v24.22.1). All nine runs of C0–C2 on seeds 9001–9003 completed, replayed identically and were analysed, with each analysis acceptance-ineligible (`not evaluated`, no claim). Committed under `experiments/results/p2-08/pilot/`: gzip records with the SHA-256 of each uncompressed record, the three `analysis.json`/`report.md` pairs, and `pilot.md`. The predeclared decisions (`scripts/pilotSummary.mjs`) are configuration **C1** (A5 validation means 0.262, 0.310 and 0.262 laps), confirmatory **n = 10** (projected half-width 0.129 ≤ δ), δ unchanged at 0.25, and the lap check passed (C1 A5 3/3). No confirmatory seed and no held-out track were used, and no learning is claimed. The confirmatory manifest (step 5) still needs review and the owner's approval. |
| 2026-11-02 | P2-08 step 4 pilot results merged by the owner in #108 at `05ccb88`, the same tree as `123dc69`, after [Codex technical approval](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/108#pullrequestreview-5738332902). P2-08 plan step 5, preparation only ([relayed owner instruction](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/19#issuecomment-6580274602)), on `feat/p2-08-confirmatory-manifest`: the frozen confirmatory manifest `experiments/manifests/p2-08-confirmatory.json` (the pilot's C1; seeds 1001–1010; δ = 0.25; frozen commit `c14f368`; `manifestHash` `sha256:4ace8cf8…`) and `docs/experiments/p2-08-confirmatory-protocol.md` (the run procedure, the result reported unchanged from `analyse`, and the storage choice needed from the owner). The confirmatory run needs the owner's separate approval. No confirmatory seed has run, there is no held-out evaluation, and there is no claim. |
| 2026-11-02 | P2-08 step 5, the confirmatory study: run with the owner's approval ([relayed instruction](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/19#issuecomment-6581307850)) on `feat/p2-08-confirmatory-results`. The manifest from #109 (C1, seeds 1001–1010, δ = 0.25) ran at frozen commit `c14f368` on Node v24.22.1: 10/10 runs and replays were identical, and `analyse` exited 0. The first `analyse` was interrupted by the session's time limit without writing output, and was rerun unchanged. The decision is `supported`: mean A5 − A8 of 0.590 laps on the training track, 95% interval [0.495, 0.690]. On the validation track, A5 − A8 is −0.393 (descriptive). Committed: gzip records with SHA-256 checksums, `analysis.json` and `report.md` unchanged, and `confirmatory.md`. P2-08 stays In Progress until the owner decides; the held-out track is untouched. |
| 2026-11-02 | **P2-08 Complete** (completion record PR on `docs/p2-08-completion-record`). #110 merged at `757e27d`, the same tree as the Codex-approved `cf5579a`; `main` CI [run 41532821865](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/41532821865). The owner [accepted the disclosed `analyse` restart as a procedural exception for this study only](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/19#issuecomment-6589544564). The claim is training-track only, and validation transfer was poor (descriptive). Phase 2's acceptance criterion is evidenced, but Phase 2 is not Complete: P2-09 (ST4) is outstanding, and P2-11 is conditional. |
| 2026-11-02 | P2-09 plan (documentation only, [authorised](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/20#issuecomment-6591090802)) on `docs/p2-09-plan`: `docs/experiments/p2-09-plan.md`. It covers the audit of the existing mask, tests and scripted oval driver; the saved-model persistence options (A recommended, B a deferral); a predeclared braking-versus-coasting feasibility grid on the training and validation tracks; E4 as a paired A4/A5 study on seeds 2001–2010; failure handling with no automatic restarts; and separately authorised steps. Nothing is implemented or run, and P2-09 stays Not Started. |
| 2026-11-02 | P2-09 plan merged in #112 at `21ca31b`, the tree of `834868d`. That head had Codex's Changes required (two P2s), and the merge came before the correction was pushed. The correction follows on `docs/p2-09-plan-review-fixes`: per-agent `brakeEnabled` binding (A4 = `false`, A5 = `true`) split into a step 2 model contract and step 5 record integration, and four exhaustive E4 outcome labels, with below-threshold results kept distinct from an interval spanning zero. Documentation only; P2-09 stays Not Started. |
| 2026-11-03 | P2-09 step 2 on `feat/p2-09-brake-model-contract` (owner chose persistence option A and [authorised step 2 only](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/20#issuecomment-6591922425)): the frozen-model brake mask contract. `provenance.brakeEnabled` (optional, boolean) enters the model ID; `modelBrakeEnabled` reads it with validation and `createFrozenModelDriver` drives with exactly that mask, in `src/training/frozenModelBrake.ts` with `tests/training/frozenModelBrake.test.ts`. No new record kind, no change to P2-07 or P2-08 formats or IDs, and no run. Per-agent binding in E4 records (step 5), the feasibility driver and run (steps 3–4), and E4 remain unauthorised. P2-09 moves to In Progress. |
| 2026-11-03 | P2-09 step 3 on `feat/p2-09-feasibility-driver` ([owner authorised step 3 only](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/20#issuecomment-6603831373)): the feasibility driver and harness. `GatePursuitDriver` (`src/ai/gatePursuitDriver.ts`, BRAKE and COAST modes differing only in the brake above the speed target), the harness with the predeclared 240-episode grid, the plan's usefulness rule, the record and report (`src/training/feasibility.ts`), `npm run feasibility -- run --out-dir <dir>` (`scripts/feasibility.mjs`), and tests that do not run the grid. **The feasibility check has not been run** (step 4 needs its own authorisation), no result exists, and nothing is claimed about braking. Step 2 merged in #114 at `236c766`, with Codex's formal approval of `fa14602` and only an automated receipt on the final `6553dba` (retrospective confirmation requested). P2-09 stays In Progress. |
| 2026-11-03 | P2-09 step 4 on `results/p2-09-feasibility` ([owner authorised step 4 only](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/20#issuecomment-6604859679)): the feasibility check ran once on a clean worktree at `54c186f`, exit 0. 240 episodes, results hash `sha256:bedc67a8e1d9bea0ea669fa27c40281fa8a3bc8b39f72a06bfb681b0c62fcf47`, record in `experiments/results/p2-09/feasibility/`. Acceptance A2 met: braking useful on the validation track by rule (ii) (best BRAKE lap 2.217 s faster, margin 0.537 s), not shown on the training track (-0.117 s, margin 0.515 s). Physical feasibility of a scripted driver only: no learning claim, no held-out track. P2-09 stays In Progress; steps 5–8 are not authorised. |
| 2026-11-03 | P2-09 steps 3 and 4 merged: #115 (the feasibility driver, harness and command, with Codex's technical approval of `9344387`) and #116 (the feasibility record, approved at `0c2ff80`; the independent review reproduced it byte-for-byte). The step 3 and 4 status text that still said "in review" is reconciled here (Codex's non-blocking P3 on #116). [The owner gave E4 authorisation](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/20#issuecomment-6607887038), read as **step 5 only**: the E4 tooling on `feat/p2-09-e4-tooling`, with no study run. It adds an A4/A5 study kind (`e4Agents.ts`, `e4Study.ts`: manifest, record, strict parser and same-engine replay, reusing the P2-08 helpers, with seeds 2001–2010 reserved and A4 = no brake, A5 = brake bound per agent and rejected across agents), the paired A5 − A4 analysis with the four outcome labels and the brake-usage measure (`e4Analysis.ts`) and `npm run e4`. Nothing was run on the reserved seeds, no E4 manifest was written (step 6) and no study was run (step 7). P2-09 stays In Progress. |
| 2026-11-03 | P2-09 step 5 merged: #117 (the E4 tooling, no study run), merged by the owner as `3096065` with the same tree as the head that had Codex's independent technical approval (`c2b563a`, after one correction batch for the champions' verification ticks); `main` CI passed. P2-09 step 6 on `docs/p2-09-e4-manifest` ([owner authorised step 6 only](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/20#issuecomment-6615763036), conditional on #117 merging and `main` CI passing, both met): the frozen E4 manifest `experiments/manifests/p2-09-e4.json` (C1, seeds 2001–2010, A4 no brake and A5 brake, frozen commit `309606550957c01e9e199f7a06f676d62210add3`, Node v24.22.1; `manifestHash` `sha256:6abd4cb7…50b0`) and the preregistered protocol `docs/experiments/p2-09-e4-protocol.md` (metrics, analysis, the four outcome labels in their exact words, gzip storage with the SHA-256 of each uncompressed record, complete execution accounting, the stop-on-failure rules, and the training-track feasibility limitation carried forward), with `tests/training/e4Manifest.test.ts`. **No E4 seed has run, and none is run by the tests.** The manifest needs Codex's review and the owner's approval, and the run (step 7) needs the owner's separate authorisation and reconfirmation of the storage format. P2-09 stays In Progress. |
| 2026-11-04 | P2-09 step 6 merged: #118 (the frozen E4 manifest and preregistered protocol), merged by the owner as `be9df05` with the same tree as the head that had Codex's independent technical approval (`4a0cf4a`); `main` CI passed. P2-09 step 7 on `results/p2-09-e4` ([owner authorised step 7 and confirmed the gzip storage format](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/20#issuecomment-6618005796)): the E4 study ran once, seeds 2001–2010 in order from a clean worktree at the frozen commit `309606550957c01e9e199f7a06f676d62210add3` under Node v24.22.1 (2026-11-03 23:21 to 2026-11-04 01:36 UTC); all 10 runs exited 0 and all 10 replays were identical. **Outcome `p2-09-e4-decision-v1`: `no-direction`** ("no direction established: the interval spans zero"): the paired A5 − A4 training-track mean is −0.0150 lap, 95% bootstrap interval [−0.0400, +0.0100], median −0.0250, Wilcoxon m = 7, p = 0.4531 (descriptive); every per-seed difference was 0 or one gate (0.05 lap). Both champions' training episodes ended at the 60 s limit after about 2.5 laps and none crashed; A5 used the brake in 8 of 10 seeds (20.1% of training ticks), A4 never (0 of 36,000, as masked); both crashed in every validation episode. Carried forward: the feasibility check showed no braking advantage on the oval, and this result does not show that braking is useless. **Interruption, disclosed:** the session container restarted during the first `analyse` and killed it before it wrote anything; the study was stopped and [reported to the owner](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/20#issuecomment-6620498423), nothing was restarted, and only the analysis was re-run (77.3 min) after the owner's [written go-ahead](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/20#issuecomment-6625287392); no seed was re-run. Results (ten gzip records with the SHA-256 of each uncompressed record, `analysis.json`, `report.md`, `e4.md`) and `tests/training/e4Results.test.ts` are in the results PR, which needs Codex's review and the owner's merge. P2-09 stays In Progress (step 8, the completion record, is not authorised) and Phase 2 is not Complete. |
| 2026-11-07 | P2-09 step 8 on `docs/p2-09-completion-record` ([owner authorised the completion-record update only](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/20#issuecomment-6713051591)). #119 merged by the owner as `970461d` on 2026-11-04, with the same tree as the Codex-approved `3d12f5e` ([review 5770278527](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/119#pullrequestreview-5770278527)); `main` CI [run 41863642690](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/41863642690) passed. P2-09 moves to **In Review**: the completion record evidences every AGENTS.md gate except the owner's completion approval, which is pending and separate from Codex review and from this PR's merge. E4 stays `no-direction` on the training track (no equivalence, learned-braking-benefit or generalisation claim). Documentation only: no study re-run, no code change. Phase 2 is not Complete. |
| 2026-11-07 | **P2-09 Complete.** #120 (the completion record) was merged by the owner as `0ed3811`, tree-identical to the Codex-approved `5c45dae` ([review 5815129543](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/120#pullrequestreview-5815129543), after one correction cycle); `main` CI [run 42417172698](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/42417172698) passed. The owner then gave [completion approval](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/20#issuecomment-6713504062), conditional on that approval and CI, both met. #120 could no longer be updated, so this follow-up on `docs/p2-09-complete` records it. The claim stays as before: E4 `no-direction` on the training track, with no equivalence, braking-benefit or generalisation claim. **Phase 2 is not Complete**: its completion is pending the owner's separate decision. |
| 2026-11-07 | Workflow clarification (documentation only) on `docs/workflow-coordination` (owner-authorised focused workflow-documentation PR; the relayed instruction is recorded on the PR): AGENTS.md gains one section, "Coordination and owner decisions", as the single policy for who coordinates the work and when the owner is asked (Claude owns coordination and requests Codex review directly; GitHub is the record; automated receipts are distinguished from formal technical approval; recorded decisions are checked before asking; routine reversible choices are made and noted, with `main` merged into reviewed branches; one status while a review is pending; owner decisions batched with a recommendation; one merge request after approval and green CI). It lists the owner's existing gates and adds none, and it keeps independent Codex review at the current head, required CI, applicable tests, scientific safeguards, the owner-evidence rules and the three-correction-cycle limit. Conflicting wording in the shared-account review steps, the PLAN stage and the correction-cycle rule is reconciled to refer to it. `CLAUDE.md` is unchanged. No code, study or feature change. |
| 2026-11-07 | P3-01 plan on `docs/p3-01-plan` ([owner authorised plan preparation only](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/21#issuecomment-6713504223)): `docs/plans/p3-01-plan.md` (architecture, metric definitions, tests, mobile acceptance). The P3-01 entry is reconciled with the [owner-approved scope change](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/21#issuecomment-6713339826): live counts for the current generation; best and mean fitness, crash rate and lap-completion rate for the last completed generation; stalls separate from crashes. The owner's [criterion clarification](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/21#issuecomment-6713856759) keeps the FPS and step-time instrumentation in P3-07 and does not require it for P3-01 completion; `docs/TESTING.md`'s low-power line is reworded to match. P3-01 stays Not Started; implementation is not authorised. |
| 2026-11-08 | **Phase 2 Complete** (recorded on `docs/phase-2-complete`, documentation only). The owner's [Phase 2 completion approval](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/20#issuecomment-6714786784) (a relayed owner instruction, 2026-11-08) is the separate decision the P2-09 record left pending. Basis: P2-08 (#110) evidences the Phase 2 acceptance criterion on the training track (A5 outperforms equal-budget random search, A8, on ordered progress), P2-09 is Complete (#112–#121), and P2-01 to P2-10 are Complete. **Limits carried forward, unchanged:** one configuration (C1) on one training track; validation transfer was poor (descriptive); held-out generalisation is untested (E6, P5-04); E4 gave `no-direction` for braking (no equivalence, no-effect or braking-benefit claim); P2-11 is conditional and not triggered. No code, test, study or claim changes. |
| 2026-11-08 | P3-01 implementation on `feat/p3-01-dashboard` ([owner authorised implementation](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/21#issuecomment-6714650978), as specified in the merged plan): `training/generationMetrics.ts` (pure live counts and last-completed-generation figures), `ui/trainingDashboard.ts` (formatting, write-on-change rendering and the per-frame session that reads only the trainer's `step` and `generation`), the panel in `index.html`, and tests (`generationMetrics`, `trainingDashboard`, an extended non-interference test that runs the real dashboard update every rendered frame, and `training.spec.ts`). The page caches the `GenerationStats` from `trainer.step()`; the dashboard never calls `trainer.record()`. FPS and step-time instrumentation stay in P3-07 and no such figure is claimed. P3-01 moves to **In Review**; it can be marked Complete only after the owner's iPhone and iPad checks are recorded and the owner approves. No training, fitness, evolution or study change. |
| 2026-11-08 | P3-01 implementation merged: [#124](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/124) was merged by the owner as `381fc3c`, with the same tree (`69928169`) as the head Codex technically approved, `aa8397e` ([review 5817278605](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/124#pullrequestreview-5817278605)), after two correction cycles; `main` CI [run 42465362250](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/42465362250) passed. The owner reported ["Pass on all"](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/21#issuecomment-6719655761) for the five requested device checks (owner-reported, not run by either agent; device models, OS and browser versions and the deployed commit were not stated; recorded in `docs/TESTING.md`). Frame rate and step time were not measured (P3-07). **P3-01 stays In Review:** it can be marked Complete only with the owner's completion approval, which is not given. Documentation only. |
| 2026-11-08 | **P3-01 Complete** (recorded on `docs/p3-01-complete`, documentation only). All eight AGENTS.md gates are checked against #122, #124 and #126 in the completion record under P3-01. The owner's completion approval is read from two relayed instructions on #21 (["... approving p3-01 completion ..."](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/21#issuecomment-6719721713) and ["Merged, please continue with developing next step"](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/21#issuecomment-6719729872)); the owner's merge of this PR confirms that reading. Limits: device evidence is owner-reported with no device details; FPS and step-time instrumentation stays in P3-07; no scientific claim. |
| 2026-11-08 | P3-02 implementation on `feat/p3-02-fitness-graph` ([owner authorised the next step](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/22#issuecomment-6719730293)): `training/generationHistory.ts`, `render/lineChart.ts`, `ui/trainingChart.ts`, the "Training graph" block in `index.html`, the session's history in `ui/trainingDashboard.ts`, and tests (scaling, thinning, drawing against the data, redraw rate, the actual page wiring, and the browser). P3-02 moves to **In Review**; it can be marked Complete only after the owner's device checks are recorded and the owner approves. No change to training, fitness, evolution or records, and no learning claim. |
| 2026-11-08 | P3-02 implementation merged: [#128](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/128) was merged by the owner as `ab9cd91`, with the same tree (`6c1de99c`) as the head Codex technically approved, `4e21e98` (reviews [5817711836](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/128#pullrequestreview-5817711836) and [5817736208](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/128#pullrequestreview-5817736208)), after two correction cycles; exact-head CI [run 42476165381](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/42476165381) and `main` CI [run 42477431074](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/42477431074) passed. The owner reported the graph device checks completed (["Device checks completed"](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/22#issuecomment-6721112157), owner-reported, relayed by Codex in the context of #128's approved head; individual results, device and OS and browser versions and the tested deployment commit were not supplied; recorded in `docs/TESTING.md`). **P3-02 stays In Review:** a 500-generation run in a browser or on a device was not done (the drawing-call bound and the redraw cap cover that criterion only in part), and the owner's completion approval is not given. Documentation only. |
| 2026-11-08 | P3-03 implementation on `feat/p3-03-speed-controls` ([owner asked to continue the development plan](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/23#issuecomment-6721125776), read as the next roadmap step): `ui/trainingSpeed.ts` (speed policy, time-budgeted stepper, cars-drawn cap), the controls in `index.html`, the page wiring, an early-stop return for the frame loop's step handler, and tests (the policy, the real page wiring including identical statistics at every speed and cap, pause and resume, and the browser). P3-03 moves to **In Review**; it can be marked Complete only after the owner's device checks and frame-rate figures are recorded and the owner approves. No change to training, fitness, evolution or records, and no learning claim. |
| 2026-11-08 | P3-03 correction cycle 3: opt-in `?debug=fps` readout (rendered frames and simulation ticks measured separately, restarted across interruptions; method in ARCHITECTURE.md) and the Max / Cars drawn overlap fix at 320 px with larger text, with pairwise non-overlap tests. No other P3-07 work. Device frame-rate figures remain an owner measurement required before merge. |
| 2026-11-08 | P3-03 implementation merged (recorded on `docs/p3-03-merged-record`, documentation only): [#129](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/129) was merged by the owner as `3733ac2` with the head Codex technically approved, `aa1dc09` ([review 5818252491](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/129#pullrequestreview-5818252491)), after three correction cycles; `main` CI [run 42501995632](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/42501995632) passed. Chronology: the owner [reported device checks](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/23#issuecomment-6722970641) on their iPhone and iPad and accepted those two devices as the testing scope at 14:52 UTC, **before** #129 merged at 16:51 UTC. This is owner-reported, not run by either agent, and no frame-rate figures, versions or per-check results were supplied before the merge or since; the frame-rate criteria are neither shown as met nor waived. P3-03 **stays In Review**: it is marked Complete only on the owner's explicit completion approval. No code, test or claim changed. |
| 2026-11-08 | P3-04 implementation on `feat/p3-04-champion-replay` ([owner authorised implementation](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/24#issuecomment-6726924348), as specified in the merged plan): `training/championReplay.ts`, `ui/championReplayView.ts`, the replay block in `index.html`, the page wiring and the session's by-reference list of completed generations, and tests (determinism and tick-by-tick equality with the population run, decision versus result state, the page wiring, the view and the browser). P3-04 moves to **In Review**; it can be marked Complete only after Codex's technical approval, the owner's iPhone and iPad checks and the owner's completion approval. No change to training, fitness, evolution or records, and no learning claim. |
| 2026-11-09 | P3-06 implementation on `feat/p3-06-import` ([owner authorised implementation](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/138#issuecomment-6745908947), relayed from "I Authorise p3-06."): import of a champion from a JSON file with the size limit applied before reading and parsing, validation, version checks, an empty-registry migration hook (no migration is claimed), id-collision handling without overwriting, and tests (unit, page and Chromium E2E). P3-06 is In Review pending Codex review and the owner's device checks. The same message also said "Device checks complete p3-02 through p3-05. Unmeasured frame rate is accepted."; it is recorded as given, gives no per-device results, and changes no status here. |
| 2026-11-08 | P3-04 implementation merged (recorded on `docs/p3-04-merged-record`, documentation only): [#133](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/133) was merged by the owner as `9c2a93f` (22:07:50 UTC), with the same tree (`e582ce2c`) as the head Codex technically approved, `3e878e5` ([review 5819873509](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/133#pullrequestreview-5819873509), 22:07:36 UTC), after one Codex correction cycle (the landscape summary overlap) and one CI fix (the narrow-portrait panel height); exact-head CI [run 42526869225](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/42526869225) passed. `main` CI [run 42528667339](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/42528667339) on the merge passed (checked after it finished). Codex's review said the owner's P3-04 iPhone and iPad checks come next and that the evidence should be recorded before a merge request; **no P3-04 device evidence had been reported when #133 merged, and none has been reported since**, so the checks remain outstanding and are not inferred from the merge. P3-04 **stays In Review**: it is marked Complete only on the owner's explicit completion approval. Codex's nonblocking note (an extra blank line at `src/training/championReplay.ts:84`) is left for the next code change. No code, test or claim changed. |
| 2026-11-08 | P3-05 implementation on `feat/p3-05-save-load-champion` ([owner authorised implementation](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/25#issuecomment-6727944973), as specified in the plan `docs/plans/p3-05-plan.md`, which was under Codex review at the time): `persistence/modelFormat.ts`, `persistence/modelStore.ts`, `ui/savedReplay.ts`, `ui/savedChampionsView.ts`, `ui/modelId.ts`, the Saved champions section in `index.html`, build identifiers in `vite.config.ts`, the MODEL_FORMAT.md amendments, and tests (round trip, one case per validation rule, storage failures, the page wiring and the browser). P3-05 moves to **In Review**; it can be marked Complete only after Codex's technical approval, the owner's iPhone and iPad checks and the owner's completion approval. No change to training, fitness, evolution or records, and no learning claim. |
| 2026-11-09 | P3-05 merged (recorded on `docs/p3-05-merged-record`, documentation only). The plan [#135](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/135) was merged by the owner as `150e8a0` (2026-11-09 16:20:26 UTC) and the implementation [#136](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/136) as `5dbb99e` (16:20:44 UTC). **#136:** Codex technically approved head `0d22155` ([review 5827269447](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/136#pullrequestreview-5827269447), 14:27:16 UTC) after three correction cycles (nine findings over reviews 5820029584, 5825685679 and 5826698165, all recorded as resolved) and the owner's decision to add a minimal Download JSON ([#25](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/25#issuecomment-6741305815)). Codex noted that approval was posted while the exact-head browser job was still running; that job, [run 42633222641](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/42633222641), finished green (both jobs, including Chromium and WebKit). The merge commit differs from the approved head only by the plan file that #135 had already merged. **#135:** Codex technically approved the plan at `cb02016` (design only, [review 5825685443](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/135#pullrequestreview-5825685443)); the plan was then changed once more, to `4052122`, to record the owner's export decision, and **that final head has no formal Codex review** (a review was requested; none was posted before the merge); CI on `4052122` ([run 42629257994](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/42629257994)) passed. `main` CI [run 42653801264](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/42653801264) on the #136 merge passed (the run on the #135 merge was cancelled by the next push). **Device checks (owner-reported, not run by either agent):** the owner's confirmation of the six P3-05 iPhone/iPad checks, including Download JSON, was relayed on [#25](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/25#issuecomment-6742744158) at 14:37:41 UTC, **before** the merge; an earlier version of this record wrongly said none had been reported. Per-device results, versions and the tested deployment SHA were not supplied and are not invented. The owner later wrote "Device checks complete p3-02 through p3-05. Unmeasured frame rate is accepted." ([#138](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/138#issuecomment-6745908947)), which is not a separate completion approval or measured performance. P3-05 **stays In Review**: it is marked Complete only on the owner's explicit completion approval. P3-06 (import and file checks) is the next item and is Not Started. No code, test or claim changed. |
| 2026-11-09 | P3-06 merged (recorded on `docs/p3-06-merged-record`, documentation only). The owner merged [#137](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/137) (`42e2e8e`), the plan [#138](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/138) (`f521b8c`) and the implementation [#139](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/139) (`2485f52`, 18:53:28 UTC), all at the heads Codex technically approved: #139 at `ebc35ae` ([review 5830752376](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/139#pullrequestreview-5830752376), 18:34:25 UTC) after one correction cycle ([review 5829774397](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/139#pullrequestreview-5829774397), three findings: an overwrite with an incomplete storage inventory, a byte-limit mismatch between export and import, and an unguarded serialization exception; all recorded resolved); #138 at `92eef43` ([review 5830692306](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/138#pullrequestreview-5830692306)); #137 at `e549515` ([review 5830691998](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/137#pullrequestreview-5830691998)). Exact-head CI hit a GitHub workflow-level internal error on attempt 1 (no browser job created); attempt 2 passed both required jobs including Chromium and WebKit, and `main` CI [run 42678090579](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/42678090579) on the #139 merge passed. Codex recorded one **non-blocking** note: three tests (`tests/persistence/modelImport.test.ts` and `tests/ui/trainingPageImport.test.ts`) assume a fixed 12,000-level nesting always fails to serialize, which depends on the worker's stack (they failed under `--pool=threads --maxWorkers=2`; the required default `npm test` passes); the follow-up is to inject a deterministic serialization failure. **No P3-06 device checks have been reported** (the owner's broad "Device checks complete p3-02 through p3-05" message predates P3-06 and does not cover import). P3-06 **stays In Review** pending those checks and the owner's explicit completion approval. The P3-07 plan [#140](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/140) was merged by the owner as `055d56a` (2026-11-09 21:23:04 UTC) at head `af17200`, which Codex technically approved as a design only ([review 5831889744](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/140#pullrequestreview-5831889744), 20:00:34 UTC) after one correction cycle; both required jobs passed on that head. **P3-07 implementation is not authorised** and P3-07 stays Not Started until the owner separately authorises it. No code, test or claim changed. |
| 2026-11-09 | P3-07 plan (plan only, `docs/plans/p3-07-plan.md`, on `docs/p3-07-plan`; no code). Relayed owner instruction (Claude Code, 2026-11-09): "All open PR merged, continue with development"; read as the next roadmap step, and, as for earlier Phase 3 items, as authorising a **plan only**. Design: a generation-boundary checkpoint (a new versioned format separate from the model format; the only random state at a boundary is the run generator's four words, there is no cache), `createTrainer` resume with a determinism proof against an uninterrupted run, a one-slot checkpoint store with the P3-05 and P3-06 lessons built in (one UTF-8 byte limit, guarded serialization, no overwrite, failed writes keep the previous checkpoint), periodic and best-effort hide-time saves with an offer (never an automatic resume), Download and import of a checkpoint file, and a step-time readout with recorded context. Six routine defaults are listed for the owner. P3-07 stays Not Started until the owner authorises implementation. |
| 2026-11-09 | P3-07 implementation on `feat/p3-07-checkpoints` ([owner authorised implementation](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/27#issuecomment-6753497819), relayed from "Implement P3-07 under the approved #140 plan and its proposed defaults…"): generation-boundary checkpoints with exact resume, compact history, ordered saves, an offered (never automatic) resume, Download and Load checkpoint file, and a step-time readout. P3-07 is In Review pending Codex review and the owner's device checks; nothing is claimed about learning. |
| 2026-11-10 | P3-07 merged (recorded on `docs/p3-07-merged-record`, documentation only). The owner merged the implementation [#142](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/142) as `b40b652` (2026-11-10 08:46:22 UTC) at head `67f86c4`, which Codex technically approved ([review 5835378739](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/142#pullrequestreview-5835378739), 01:31:43 UTC) after **two correction cycles**: cycle 1 fixed four automated findings on `0620b2f` (a finite but enormous checkpoint genome that overflowed inference, the saver not seeded after Resume, an unreadable startup slot leaving saving on, and replay ticks missing from the step-time numerator); [review 5835146586](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/142#pullrequestreview-5835146586) on `4773a4b` found one remaining P2 (resuming a file after a storage-read failure could later overwrite an unanswered stored-checkpoint offer), which cycle 2 fixed. Exact-head CI [run 42734956897](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/42734956897) passed both required jobs (including Chromium and WebKit), and `main` CI [run 42785253652](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/42785253652) on the merge passed. Codex recorded one **non-blocking** nit, an extra blank line at `src/persistence/checkpointStore.ts:156`, left as is. **No P3-07 device checks have been reported** (the owner's "Device checks complete p3-02 through p3-05" does not cover it); the four checks, named-device metrics and the owner's explicit completion approval are outstanding, and real iOS background and termination behaviour is a manual check only. P3-07 **stays In Review**. **Open follow-up (not done):** Codex's earlier non-blocking portability note on three P3-06 tests that assume a fixed 12,000-level nesting always fails to serialize (they failed under `--pool=threads --maxWorkers=2`; the default `npm test` passes): inject a deterministic serialization failure. The P3-08 plan [#143](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/143) was merged by the owner as `b388a39` (2026-11-10 10:03:05 UTC) at head `d45d19e`, which Codex technically approved as a design only ([review 5839706097](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/143#pullrequestreview-5839706097), 09:38:35 UTC). **The owner authorised P3-08 implementation earlier than that merge**, at 09:43 UTC on [#42](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/42#issuecomment-6764100706) ("I authorize p3-08", relayed by Codex, for the plan at `d45d19e`); the implementation [#145](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/145) was then merged by the owner as `4a4aa1b` (11:17:37 UTC) at head `e51724b`, technically approved by Codex ([review 5840917500](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/145#pullrequestreview-5840917500)) after two correction cycles; P3-08 stays In Review (its own merge record follows separately). No code, test or claim changed. |
| 2026-11-10 | P3-08 plan (plan only, `docs/plans/p3-08-plan.md`, on `docs/p3-08-plan`; no code). Relayed owner instruction (Claude Code, 2026-11-10): "Continue with development"; read as the next roadmap step and, as for earlier Phase 3 items, as authorising a **plan only**. Design: a pure `modelCompare` (side-by-side rows; fitness ranked only when scoring, simulation version, track and conditions all match, with every reason listed; unavailable results shown as unavailable), a headless lockstep `pairReplay` whose cars equal their solo replays, a Compare section in Saved champions (accessible table, labelled A/B cars, combined replay refused with reasons when conditions differ), and tests including an E2E with a mismatching imported model. Five routine defaults are listed for the owner. P3-08 stayed Not Started until the owner authorised implementation, which came afterwards (chronology preserved, not backdated): 2026-11-10 09:43 UTC on [#42](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/42#issuecomment-6764100706), before #143 merged at 10:03:05 UTC as `b388a39`; see the implementation row and the P3-07 merge-record row. |
| 2026-11-10 | P3-08 implementation on `feat/p3-08-compare` ([owner authorised implementation](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/42#issuecomment-6764100706), relayed by Codex: "I authorize p3-08", at plan head `d45d19e`, Codex design approval [review 5839706097](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/143#pullrequestreview-5839706097); the plan PR #143 is not yet merged, and its browser job needed one re-run after attempt 1 was cancelled at the time limit): two saved champions side by side, fitness ranked only when scoring, task and conditions match, a combined replay of two cars under the same conditions, and tests (unit, page and a Chromium E2E). P3-08 is In Review pending Codex review and the owner's device checks; nothing is claimed about learning. |
| 2026-11-10 | P3-08 merged (recorded on `docs/p3-08-merged-record`, documentation only). The owner merged the implementation [#145](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/145) as `4a4aa1b` (2026-11-10 11:17:37 UTC) at head `e51724b`, which Codex technically approved ([review 5840917500](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/145#pullrequestreview-5840917500), 11:13:26 UTC) after **two correction cycles**: cycle 1 fixed one automated finding on `fe58938` (a saved-list Replay while the combined replay ran left both replay modes active); [review 5840565585](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/145#pullrequestreview-5840565585) on `9b9a2b9` found three P2s (a new Compare left the old pair running; physics and fitness rows hid the recorded values; unknown metadata changed the ranking and replay verdicts), all fixed in cycle 2. Exact-head CI [run 42802475076](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/42802475076) passed both required jobs (including Chromium and WebKit), and `main` CI [run 42806280813](https://github.com/Harrisonxaph/Self-learning-Car-AI/actions/runs/42806280813) on the merge passed. Relayed owner instruction (Claude Code, 2026-11-10): "145 merged and p3-08 approved, continue development of p3-08" ([record](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/42#issuecomment-6765953785)). "Approved" is recorded as given: it does not say it is the separate completion approval and reports no result for the four P3-08 iPhone/iPad checks, so **no P3-08 device checks are recorded as reported and P3-08 stays In Review**; the owner has been asked which is meant. No code, test or claim changed; no learning claim. |
| 2026-11-10 | **P3-08 Complete** (recorded on `docs/p3-08-complete`, documentation only). All eight AGENTS.md gates are checked against #143, #145 and #146 in the completion record under P3-08. Relayed owner instruction (Claude Code, 2026-11-10): "Device checks completed, and it was my completion approval" ([record](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/42#issuecomment-6769697822)), answering what the earlier "p3-08 approved" covered. The device checks are owner-reported, not run by either agent, with no individual results, devices, versions or deployed commit stated. The same message is read as covering the outstanding P3-06 and P3-07 device checks (my question named them together); **P3-06 and P3-07 stay In Review**: the completion approval names P3-08 only, and P3-07's named-device frame-rate and step-time figures were not supplied. No code, test or claim changed. |
| 2026-11-10 | Test hardening (test-only, on `test/deterministic-serialization-failure`; no application code changed). Closes the open follow-up from Codex's non-blocking portability note on #139 ([review 5830752376](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/139#pullrequestreview-5830752376)): three P3-06 tests assumed a 12,000-level nested value always fails to serialize, which depends on the runtime's stack size (they failed under `--pool=threads --maxWorkers=2`). They now inject a deterministic `JSON.stringify` failure (`tests/helpers/failingStringify.ts`), with a control test that the same model saves normally when serialization works and a depth test that accepts either outcome but never an exception. Relayed owner instruction (Claude Code, 2026-11-10): "Merged, please continue as developer" (after #144 and #146 merged). No roadmap status changes.  **CI follow-up (Codex, owner-requested exception):** the owner asked "147 failed check - please review and fix" ([record](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/147#issuecomment-6770421355)). Run 42832516021 exceeded the shared 20-minute browser-job budget after dependency installation took roughly nine minutes; no assertion failure was reported before cancellation. The browser job now has a 40-minute overall limit, separate 15-minute dependency-install and 20-minute full-suite limits, with all six browser projects and required job names preserved. Current-head GitHub Actions execution and independent Claude review are required; this note does not claim that the corrected workflow has passed. |
| 2026-11-10 | **P3-02 to P3-07 Complete; Phase 3 Complete** (recorded on `docs/p3-complete`, documentation only). Relayed owner instruction (Claude Code, 2026-11-10): asked which of P3-02 to P3-07 the owner explicitly approves as Complete, the owner chose "All six (Recommended)", i.e. P3-02, P3-03, P3-04, P3-05, P3-06 and P3-07, accepting P3-07 without measured frame-rate or step-time figures, as for P3-02 to P3-05. Relayed owner question and answer (Claude Code, 2026-11-10, session record; quoted exactly): the question asked "Which of P3-02 to P3-07 do you explicitly approve as Complete?" and stated that "P3-07 also has no named-device frame-rate/step-time figures"; the option the owner chose, "All six (Recommended)", read: "I record your approval for P3-02 to P3-07, accept P3-07 without measured figures (as for P3-02 to P3-05), and open one docs-only PR marking them Complete. Phase 3 then closes.". Gates: each was implemented and merged by the owner (#128, #129, #133, #136, #139, #142) after exact-head CI passed both required jobs and Codex recorded technical approval of the reviewed head; Codex was the independent second reviewer; documentation and tests are in the merged PRs. Device checks are owner-reported and not run by either agent: P3-02 to P3-05 per the earlier reports, and P3-06 and P3-07 per "Device checks completed" ([#42](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/42#issuecomment-6769697822)), read as covering them. **Not claimed:** no measured frame-rate or step-time figure for any item, no named-device figures for P3-07 (waived by the owner on the question and answer above, specifically for P3-07), and no phone measurement of P3-02's 500-generation responsiveness (a desktop-Chromium check was run and recorded on 2026-11-11 under P3-02, after review of this PR found the criterion open; the question put to the owner did not mention it). Device and browser versions and per-check results were not supplied and are not invented; CI browsers are emulation, not physical Safari. No code changed, and no learning or generalisation claim is made. |
| 2026-11-11 | P4-01 plan (plan only, `docs/plans/p4-01-plan.md`, on `docs/p4-01-plan`; no code). Relayed owner instruction (Claude Code, 2026-11-11): "Let's close p3 and mark as complete and move to p4-01. Close #21,42"; the P3 issues #21 to #27 and #42 were closed as completed and P4-01 is read as the next roadmap step and, as for earlier items, as authorising a **plan only**. Design: format version 1 is the existing track shape with optional `format`, `schemaVersion` and `split` fields (built-in files and every hash untouched), a pure `validateTrack` with fourteen rules each with its own readable error and test (closed simple boundaries, inner inside outer, minimum road width, start on the road and facing the driving direction, at least 3 ordered gates that span the road), all errors collected, `loadTrack` unchanged, built-ins validated at manifest load. Seven routine defaults are listed for the owner. P4-01 stays Not Started until the owner authorises implementation. |
| 2026-11-11 | P4-01 implementation on `feat/p4-01-track-validation` ([owner authorised implementation](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/28#issuecomment-6796133012), relayed: "I authorise p4-01", at plan head `b383f58`; the plan PR #150 is not yet merged or reviewed): `validateTrack` with 14 rules, the format document `docs/TRACK_FORMAT.md`, manifest integration, and 57 unit tests including one per rule, the built-ins and hostile input. P4-01 is In Review pending Codex review and the owner's merge; no device checks apply. Nothing is claimed about learning. |
| 2026-11-11 | P5-01 plan (plan only, `docs/plans/p5-01-plan.md`, on `docs/p5-01-plan`; no code). Owner choice (Claude Code, 2026-11-11): asked which ready item to plan while P4-01 is in review, the owner chose "P5-01 rule-based baseline driver (Recommended)"; read as authorising a **plan only**. Design: a pure `ruleBasedDriver` (A3) reading only the seven rays and the speed, with a no-braking variant identical except the brake; five parameters tuned on the training track only over a predeclared grid, each variant separately; seven separately authorised steps (plan, driver and tests, training-track tuning, E3 machinery with a controlled once-only held-out entry point, E3 protocol, E3 run that opens the held-out boundary, record); A3, A3-nb and A3-nb-same are reported, and only A3 against A3-nb-same is a brake ablation; E3's primary metric ordered checkpoint progress with a seed-cluster bootstrap on A5 minus A3. Seven routine defaults are listed for the owner. P5-01 stays Not Started until the owner authorises implementation; nothing is claimed about learning. |
| 2026-11-11 | P5-01 step 2 on `feat/p5-01-rule-driver` ([owner authorised all steps](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/33#issuecomment-6801667981), relayed: "I authorise all steps", in answer to plan PR #152 at head `445a6bf`, not yet merged or reviewed; read as steps 2 to 6 as written, each through its own branch, Codex review and owner merge, with the E3 protocol merged before the run): `ruleBasedDriver.ts` (A3 and A3-nb: steering from the freer side's rays, throttle easing, brake when the front is short at speed; reads only rays and speed), 45 unit tests, ARCHITECTURE and TESTING entries. The constants are labelled placeholders; the later steps (tuning, E3 machinery, protocol, run, record) are not started and no held-out track has been used. P5-01 is In Progress; nothing is claimed about learning. |
| 2026-11-11 | P5-01 step 3 on `feat/p5-01-tuning` (authorised with all steps on [#33](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/33#issuecomment-6801667981); step 2 merged in #153 by the owner): tuning of the rule-based driver on the **training track only**. The predeclared grid (A3 72 variants, A3-nb 18) was committed first (`ab18b2a`); the run took about 3 s and wrote `docs/experiments/p5-01-tuning.json` and `.md` (results hash `sha256:27451a5f…`). Selected: A3 steerGain 4, frontClear 0.3, speedCap 1, brakeFront 0.3, brakeSpeed 0.6 (2 laps, 48 checkpoints, first lap 25.5 s, in the 60 s episode); A3-nb steerGain 4, frontClear 0.3, speedCap 0.75 (2 laps, 42 checkpoints, first lap 28.3 s). **A3-nb-same (A3's constants with only the brake masked) crashed at 5 checkpoints** on the training track, which is a descriptive fact about this rule and not a claim about learned braking. Constants are frozen in `ruleBasedDriver.ts` and a test ties them to the record. No validation or held-out track was used. P5-01 stays In Progress (E3 machinery, protocol, run and record remain); nothing is claimed about learning. |
| 2026-11-11 | P5-01 step 4a on `feat/p5-01-e3-access` (stacked on #154; authorised with all steps on [#33](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/33#issuecomment-6801667981), then "Start now"): the E3 machinery's controlled held-out access, **no study run and no held-out evaluation**. `heldOutAccess.ts`: frozen identities for the three rule agents and A5 champions, and a gate created for one protocol that opens once (wrong authorisation refused without using the opening), evaluates only listed agents on only listed held-out tracks and each pair at most once, and writes a time-free opening record; `createEvaluationSetup` still refuses held-out tracks. 40 tests (including the ledger and rule-model validation added after review) on a synthetic held-out track in a synthetic registry (the real held-out circuit is never evaluated). Step 4b (E3 record, parser, replay, analysis), the protocol, the run and the record are not started; P5-01 stays In Progress; nothing is claimed about learning. |
| 2026-11-11 | **P4-01 Complete** (recorded on `docs/p4-01-complete`, documentation only). All eight AGENTS.md gates are checked against #150 and #151 in the completion record under P4-01. Relayed owner instruction (Claude Code, 2026-11-11): asked "Do you approve P4-01 as Complete?", the owner answered "I'll approve p4-01". Device checks are not applicable (no UI). P4-02, P4-04 and P4-06 are no longer blocked by P4-01; each starts as a plan-only PR. No code, test or claim changed; no learning claim. |
| 2026-11-11 | P4-04 plan (plan only, `docs/plans/p4-04-plan.md`, on `docs/p4-04-plan`; no code). Relayed owner instruction (Claude Code, 2026-11-11): "156 is merged, let's do p4 still"; read as the next unblocked Phase 4 step (the P4-02 plan #157 is awaiting review) and as authorising a **plan only**. Design: four new circuits specified by geometric criteria **before anything is evaluated** (training `kidney-loop`, validation `s-sweepers`, held-out `long-sweepers` and `technical-narrow`, giving 2 / 2 / 3), made by a committed deterministic generator whose JSON output stays the source of truth; an optional manifest `provenance` field; split enforcement tests for every circuit plus a source-scan allowlist for `heldOutTrack` and `validationTrack`; a Training circuit selector on the training page. "Mirrored" layouts are right-hand-heavy sections inside a counter-clockwise lap (the engine's one direction). Seven routine defaults are listed for the owner, with iPhone and iPad checks. P4-04 stays Not Started until the owner authorises implementation; nothing is claimed about learning or generalisation. |
