# Testing

> Status: **planned**. No tooling, scripts or tests exist yet (verified 2026-10-23). The commands below are what P1-01 must set up. Do not report them as passing until they exist and have been run.

## Commands (to be created in P1-01)

| Command | Purpose |
|---------|---------|
| `npm ci` | Clean install from `package-lock.json` (Node 24). |
| `npm run lint` | ESLint, including import-boundary rules from `docs/ARCHITECTURE.md`. |
| `npm run typecheck` | `tsc --noEmit` with `strict: true`. |
| `npm test` | Vitest unit and integration tests in Node. |
| `npm run build` | Vite production build. |
| `npm run test:e2e` | Playwright tests against the built app in Chromium and WebKit, with mobile-viewport projects. |

CI (P1-10) runs all of them on every pull request and on `main`.

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
  e2e/          Playwright: driving, training, save/load, editor
```

Tests mirror `src/`. No tests next to source files.

## What must be tested

| Area | Required tests |
|------|----------------|
| RNG | Same seed gives the same sequence. Different seeds give different sequences. Known first values are pinned. |
| Physics | Speed rises with throttle and falls with brake and drag. Brake never makes speed negative. Steering rate falls with speed. Results are independent of render frame rate (the same N ticks give the same state). |
| Determinism | Two runs with the same seed and config give bit-identical car states after N ticks and identical generation-K genomes. |
| Collision | Hand-made cases: touching, crossing a corner, no tunnelling at maximum speed. |
| Checkpoints | Only the next gate counts. Backwards crossings are ignored. Laps are counted and timed in simulation time. |
| Sensors | Known geometry gives known distances. Nothing in range returns 1.0. |
| Network | A hand-computed tiny network matches. 9-12-3 has 159 parameters. Parameter order is pinned. |
| Outputs | Steering is in [−1, 1] and throttle and brake are in [0, 1]. A no-brake mask forces 0. |
| Evolution | Elites are copied unchanged. Mutation rate 0 changes nothing. Crossover children only contain parent genes (uniform). Population size stays constant. |
| Fitness guards | Each exploit in `docs/AI_EVALUATION.md` §6 is scripted and shown not to raise fitness. |
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
