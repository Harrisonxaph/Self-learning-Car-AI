# Contributor and agent instructions

Self-Driving AI Evolution: a free, browser-based sandbox where 2D cars learn to steer, accelerate and brake through small neural networks evolved by a genetic algorithm. It runs on iPhone, iPad and desktop browsers and is built so a beginner learning software engineering can follow it.

This file is authoritative for every contributor, human or agent (Codex, Claude Code or others). Read it before making changes. `CLAUDE.md` only points here.

## Where the plan lives

- `docs/ROADMAP.md`: every feature with its ID, phase, priority, status, dependencies, acceptance criteria, test requirements and GitHub issue. Update the status in the same pull request that changes it.
- `docs/ARCHITECTURE.md`: module boundaries and data flow.
- `docs/AI_EVALUATION.md`: how learning is measured. Follow it before claiming any improvement.
- `docs/MODEL_FORMAT.md`: the saved-model standard.
- `docs/TESTING.md`: test layers, commands and manual device checks.

## Stack

- Vite, TypeScript (strict mode) and Canvas 2D. No game engine, no WebGL, no server.
- Node 24, `npm ci`, and a committed `package-lock.json`. Pin runtime dependencies to exact versions.
- Free and open-source tools only. Do not add paid AI APIs, paid services, analytics, accounts or tracking without an explicit, agreed requirement. Never commit credentials.
- The build must remain a static site deployable to Vercel (or any static host) with no server code.

## Architecture rules

- Keep these concerns in separate modules (see `docs/ARCHITECTURE.md`): simulation (physics, track, collision, checkpoints), sensors, neural-network inference, evolution, training orchestration, persistence, rendering and UI.
- Simulation code must not import rendering, UI or DOM APIs. It must run headless in Node for tests and accelerated training.
- Network inference (`src/ai/`) must not import evolution code. Evolution (`src/evolution/`) operates on flat genomes and never reads the canvas.
- Use the fixed simulation timestep from `src/sim/config.ts`. Never step physics by the frame's elapsed time.
- All randomness in simulation, sensors, AI and evolution goes through the seeded generator in `src/utils/rng.ts`. Do not call `Math.random()` there.
- Every training run records its full configuration and seed (see `docs/AI_EVALUATION.md`).

## Scientific honesty

- Do not claim that the AI has learned, improved or generalised unless the relevant experiment in `docs/AI_EVALUATION.md` has been run and its results recorded with seeds and configuration. Rising fitness alone is not evidence of general driving ability.
- Never fabricate results, screenshots, benchmark numbers or test output.
- Keep training, validation and held-out test tracks separate. Do not tune on held-out tracks.
- Describe limitations plainly in user-facing text and docs.

## Feature completion

A roadmap feature can be marked **Complete** only when all of the following are true:

1. The implementation exists and can be demonstrated.
2. Its required automated tests have been run and pass.
3. Relevant mobile-browser behaviour has been tested (record which device and browser, or say that it is outstanding).
4. Existing functionality still works.
5. It meets its acceptance criteria in `docs/ROADMAP.md`.
6. Documentation is updated.
7. A second agent or person has reviewed the change.
8. The pull request has been reviewed and approved.

Until then, use `Not Started`, `In Progress`, `Blocked` or `In Review`. Never describe tests as passing unless you ran them in this change and they passed. Report unavailable environments (for example, no real iPhone) and outstanding manual checks explicitly.

## Accessibility and mobile

- Touch targets at least 44 × 44 CSS pixels; controls usable with one thumb in landscape on a phone.
- Full keyboard control on desktop, visible focus, and text readable at default zoom.
- Respect `prefers-reduced-motion` for decorative animation (the simulation itself may still run).
- Keep a low-cost rendering mode for phones and support running training without drawing every frame.
- Handle iOS Safari pausing background tabs: pause cleanly on `visibilitychange` and resume without a time jump.

## Tests

- Unit and integration tests live under `tests/`, mirroring `src/` (for example `src/sim/physics.ts` → `tests/sim/physics.test.ts`). Browser tests go in `tests/e2e/`. No tests next to source files.
- Physics and evolution must have determinism tests: same seed and configuration give identical results.
- Before submitting, run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` and `npm run test:e2e` once those scripts exist (see `docs/TESTING.md`).

## Persistence

- Saved models follow `docs/MODEL_FORMAT.md`. Validate everything you load; treat imported JSON and localStorage contents as untrusted.
- localStorage can be cleared or unavailable (private browsing, storage pressure, iOS eviction). Always offer JSON export and never present localStorage as permanent storage.

## Workflow (Codex and Claude Code)

- GitHub is the source of truth for code and docs.
- Work on a dedicated branch per feature (`feat/<roadmap-id>-short-name`, `docs/...`, `fix/...`) and open a pull request that names the roadmap ID and issue. Never push directly to `main` and never merge without the owner's approval.
- Codex: implements approved phases, writes and maintains tests, prepares pull requests and explains implementation decisions.
- Claude Code: reviews architecture, neural-network and evolution code, reward design, tests and reproducibility, and recommends performance improvements. Reviews Codex pull requests.
- Do not edit the same files as another agent at the same time unless coordinated in the issue or PR.
- Phase 6 items in `docs/ROADMAP.md` are documented research ideas only. Do not implement them without approval.
- Stretch targets ST1 to ST5 must stay visible in every roadmap revision.
