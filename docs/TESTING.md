# Testing

> Status: the commands below exist from P1-01 onwards. Only the project foundation (canvas sizing, page start-up and the architecture lint rules), the fixed-timestep loop, the seeded random generator, the track model and static track layer, the vehicle physics, collision detection, checkpoints and laps, manual driving and the deterministic simulation suite are tested so far; the rest of the table under "What must be tested" applies as each feature lands. Report only results you actually ran.

## Commands

| Command | Purpose |
|---------|---------|
| `npm ci` | Clean install from `package-lock.json` (Node 24). |
| `npm run lint` | ESLint, including import-boundary rules from `docs/ARCHITECTURE.md`. |
| `npm run typecheck` | `tsc --noEmit` with `strict: true`. |
| `npm test` | Vitest unit and integration tests in Node. |
| `npm run build` | Vite production build. |
| `npm run test:golden:update` | Rewrites the golden file `tests/sim/golden/world.json`. Only for a deliberate simulation change; see [Golden files](#golden-files). |
| `npm run test:e2e` | Builds the app, serves it with `vite preview` (and the same `dist/` with a plain static file server, `tests/e2e/staticHost.ts`), then runs the Playwright tests in Chromium and WebKit, including phone and tablet touch projects. |

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
  sim/          fixed-step clock, world ticks, track loading and fixture geometry; later physics, collision, checkpoints, laps
  sensors/      ray casting
  ai/           forward pass, input and output mapping
  evolution/    operators, elitism, determinism
  training/     fitness guards, trainer, experiment records
  persistence/  model validation, migrations, storage failures
  utils/        rng, math
  render/       canvas sizing, world-to-screen fit and the cached track layer
  ui/           frame loop (driven by fake frames and visibility changes)
  config/       tests for the tooling configuration (ESLint boundaries)
  e2e/          Playwright: driving, training, save/load, editor
```

Tests mirror `src/`. No tests next to source files.

## What must be tested

| Area | Required tests |
|------|----------------|
| Loop | The same number of ticks gives the same state at 30, 60 and 120 Hz and with uneven frame times. At most 5 ticks per frame. A hidden page runs no ticks, and showing it again causes no catch-up jump (unit tests with fake frames; e2e by emulating `visibilitychange`). |
| RNG | Same seed gives the same sequence. Different seeds give different sequences. Known first values are pinned against an independent reference implementation. Ranges, integer picks and Gaussian mean and variance are checked over 10k samples. All outputs are finite. Separate generators never affect each other. Seed boundaries (0 and 4294967295) and invalid seeds are covered. A saved state, including after a JSON round trip, continues the same sequence, and invalid states are rejected. `Math.random` is rejected by lint in every headless folder. |
| Physics | Speed rises with throttle and falls with brake and drag. Brake never makes speed negative. Yaw is zero at zero speed; high-speed wheel-angle limits are respected. Results are independent of render frame rate (the same N ticks give the same state). Built in P1-05 (`tests/sim/vehicle.test.ts`): terminal speed equals the derived `maxSpeed`; braking beats coasting; coasting and braking end at exactly 0; left/right symmetry; the integration order and a golden end state are pinned; 20,000 seeded random-control ticks stay finite and in range. `npm run demo:vehicle` prints a scripted run. |
| Determinism | Two runs with the same seed and config give bit-identical car states after N ticks and identical generation-K genomes. Built in P1-09 for the simulation (`tests/sim/golden.test.ts`, `tests/ui/frameLoopDeterminism.test.ts`, scenarios in `tests/sim/scenarios.ts`): two seeded scenarios through the whole world (physics, collision, checkpoints, laps, restart). *Laps* is a seeded centre-line follower with seeded target speeds, steering offsets and brake pulses that completes two timed laps. *Crashes* uses seeded open-loop controls and is restarted 30 ticks after each of its 8 crashes. Each scenario is checked against rules from the documented behaviour (gates strictly in order, lap time = ticks between gate-0 crossings, average lap speed within the drawn targets, crash = stop at the last clear pose, restart = full reset) before it is compared with the golden file. Every run is compared tick by tick, through a hash per 60-tick window plus a state sample and the event list, so an early divergence cannot hide behind the same final state. Also: a fresh run reproduces the same trace and a different seed diverges within 5 windows; two worlds stepped alternately on one shared track match solo runs; deep-frozen states step without error (no in-place writes); driving after a restart matches a fresh world; the frame loop with drawing every frame at 30, 60, 120 and 144 Hz, uneven 7/73 ms and seeded 4–80 ms frames matches the headless run; drawing on or off gives the same ticks; the catch-up cap's dropped time is counted exactly (90 ms frames: 540 ticks of real time, 500 run, 40 dropped; a 1 s stall: 5 run, 55 dropped) and only the ticks that ran are simulated; hiding the page drops the pending part-tick and resumes on the next tick. Generator independence is covered by `tests/utils/rng.test.ts`. |
| Collision | Hand-made cases: touching, crossing a corner, no tunnelling at maximum speed. Built in P1-06 (`tests/sim/collision.test.ts`): flush edges, a single corner on a diagonal wall, a wall corner in the car's side, wholly off-road footprints and an obstacle under the car; 1 mm clearances stay clear; sweeps catch a jump over a 1 cm wall, a corner cut, a mid-turn contact and a top-speed full-lock tick that clips the oval's inner wall by about 1 µm between ticks, and turn the short way through ±π; the turning margin is checked to cover every interpolated corner; crashed cars stop at their last clear pose and stay put. On the stadium oval the centre line is clear, cars at top speed aimed off the track always crash, and every accepted step, from those and from seeded random driving, is also clear when sampled 16 times per step. `npm run demo:collision` prints three scripted crashes. |
| Checkpoints | Only the next gate counts. Backwards crossings are ignored. Laps are counted and timed in simulation time. Built in P1-07 (`tests/sim/checkpoints.test.ts`): single-gate crossing rules (forwards, from the line, end points, backwards, stopping on or moving along the line, beyond the gate's end); a scripted lap timed at exactly 2000 ticks per lap; every gate once per lap in order; reverse laps, turning round, out-of-order and skipped gates, back-and-forth and lingering earn nothing extra; starting on the line; several gates in one long step, in order along the move; with physics and collision, three timed laps by a scripted driver, gates credited on the tick the rear axle passes them at top speed, no credit in a tick rejected by a crash, and separate per-car progress. `npm run demo:laps` prints the timed laps. |
| Sensors | Known geometry gives known distances. Nothing in range returns 1.0. Built in P2-01 (`tests/sensors/rays.test.ts`): config validation (range 0, negative, NaN, ±Infinity, as text; 6 or 8 angles; unsorted, repeated or out-of-range angles; unknown origin) and non-finite angle, origin, pose and wheelbase all throw `RangeError`; the origin is the footprint's centre; from the stadium start the ±90°, ±60° and ±30° rays read 7, 7 / sin 60° and 14 m on the straights, and 0° is clear at 50 m (raw 50, normalised 1), while with a 100 m range it hits outer segment 2 at the line intersection computed from that segment (89.1661871736511 m); straight and angled walls (perpendicular distance ÷ cos incidence); a wall exactly at the range is a hit and 1e-6 m beyond is clear; an origin on a wall reads 0 in every direction; a 1e-3 rad nearly parallel wall reads d / sin a; exactly parallel walls miss, and walls 1e-9 m off the ray line miss; collinear walls ahead (either point order), behind and containing the origin; nearest hit across boundaries; hits behind ignored; a shared vertex is hit and never slipped through at 2001 angles within 1e-9 rad; concave and convex corners; an off-road origin; 400 seeded poses agree with an independent Cramer's-rule intersection within 1e-9 and stay in [0, 1]; rotation, translation and mirroring leave distances unchanged (mirroring swaps left and right); deep-frozen inputs, identical repeats. Debug layer (`tests/render/sensorView.test.ts`): lines end exactly at the mapped ends for several poses and transforms, clear rays use the clear style with no marker, markers only on hits and drawn last, the pixel-ratio transform, and nothing changes the readings or the world; `tests/ui/debugFlags.test.ts` covers the `?debug=rays` flag. |
| Network inputs | Built in P2-02 (`tests/ai/inputs.test.ts`): the contract name, nine names in MODEL_FORMAT order and names that follow custom angles; inputs 0–6 equal the P2-01 normalised readings for 100 seeded poses; the stadium start gives the known rays, speed 0 and heading error 0. Heading error: dead ahead 0, 90° right +0.5, 90° left −0.5, 45° ±0.25, exactly behind +1, just left of behind close to −1, wrapping either side of ±π, many whole turns, the degenerate zero-distance case 0, the rear axle as reference (not the body centre), the next gate's target before and after a gate counts, and the last gate. Steering towards the target shrinks the error and steering away grows it, for targets on both sides. Speed: 0, ¼, ½, the top speed and above it (clamped to 1). Bad gate indexes, `maxSpeed`, speed, pose, wheelbase, sensor config and a gateless track throw `RangeError`. Mirroring the scene reverses the rays, keeps the speed and negates the heading error. Deep-frozen inputs, identical repeats, and the two seeded P1-09 scenarios with inputs built every tick: the run is identical to the golden headless run, and every input is in range on every tick, including crashed ticks. |
| Network | A hand-computed tiny network matches. 9-12-3 has 159 parameters. Parameter order is pinned. Built in P2-03 (`tests/ai/network.test.ts`): `[9, 12, 3]` and 159 parameters; MODEL_FORMAT's JSON example (layers, activations, inputs, outputs, count, order string) matches the code, and its zero parameters run; `weightIndex` and `biasIndex` use every index once; a one-hot sweep over all 159 parameters changes exactly the expected hidden unit or output by the expected amount; hand-computed sparse and dense networks; 200 seeded networks match an independent reference that reads the array as the documentation describes; invalid parameter or input counts, NaN, Infinity, non-numbers, a missing or non-boolean brake option, and overflowing sums throw `RangeError`; seeded initialisation is reproducible, differs between seeds, is exactly 159 `range(-1, 1)` draws and spreads over [−1, 1); frozen and typed arguments are never written, results are fresh arrays, and networks and generators used alternately match each used alone; `src/ai` imports nothing from evolution, training, persistence, rendering or the UI; and P2-02's start-pose inputs give in-range controls. |
| Outputs | Steering is in [−1, 1] and throttle and brake are in [0, 1]. A no-brake mask forces 0. Built in P2-03 (`tests/ai/outputs.test.ts`, `tests/ai/network.test.ts`): known sigmoid values, symmetry, and exactly 0 or 1 without NaN at ±1000 and ±`Number.MAX_VALUE`; the three outputs map independently; extremes give steering ±1 and throttle and brake 0 or 1; with the mask, brake is exactly 0 and steering and throttle are unchanged; 500 seeded networks with large weights and inputs stay finite and in range with the brake on and off; bad raw outputs or masks throw `RangeError`. |
| Evolution | Elites are copied unchanged. Mutation rate 0 changes nothing. Crossover children only contain parent genes (uniform). Population size stays constant. Built in P2-04 (`tests/evolution/operators.test.ts`, `tests/evolution/population.test.ts`, hand-scored fitness fixtures): genome and population checks (lengths, empty, non-arrays, NaN, Infinity, non-numbers, sparse-array holes); fitness checks, including sparse arrays with missing scores, and ranking with ties to the lower index; tournament winners replayed on a cloned generator (exactly `size` draws), uniform choice at size 1, rising selection pressure with size, and ties; crossover genes always from a parent at the same position, rate 0 copies A, rate 1 about half from each, and per-draw replay; mutation rate 0 and scale 0 are the identity, rate 1 changes every gene, mutated fraction, mean and sd match rate and scale over 20,000 genes, per-draw replay and overflow; the config matches MODEL_FORMAT's example, and 15 invalid configs are rejected; elites in rank order, unchanged even at full mutation, with E = 0 and E = N; children are copies of A with crossover and mutation off, and inherit only parent genes; fitter parents are chosen more; population size and genome length are constant for six size, elite and tournament combinations; identical generations from the same seed, including 10 in a row; selection unaffected by crossover or mutation settings and generator state, and crossover unaffected by mutation draws; inputs never written, outputs never aliased, even when a genome appears twice; evolved 159-gene genomes pass `checkParameters` and run; evolution imports only `utils/rng`. |
| Fitness guards | Each exploit in `docs/AI_EVALUATION.md` §6 is scripted and shown not to accumulate repeat credit without new valid ordered progress; a bounded legitimate initial approach is allowed. |
| Persistence | Valid model round-trip. Every invalid case is rejected with an error (bad JSON, wrong count, `NaN`, unknown version, oversized file). localStorage that throws or is empty is handled. |
| Track rendering | World-to-screen fit keeps the aspect ratio for negative coordinates, non-square bounds and portrait/landscape screens. The static layer is reused while the size is unchanged and redrawn on resize, pixel-ratio change or track change. Browser tests sample real pixels for road and infield, check the fit and margins, and check the layer is not redrawn every frame. |
| Manual driving | Built in P1-08: the human driver's input-to-controls mapping, including combined and cancelling inputs (`tests/ai/drivers.test.ts`); held-input sources, key bindings, default prevention, modifier and auto-repeat handling, hold buttons with capture, multi-finger, cancel and capture-failure cases, and blur/pagehide/hidden release (`tests/ui/input.test.ts`, with plain EventTargets); the world stepping physics, collision and laps together, restart resetting the car and progress but keeping the tick and best lap, and best-lap tracking (`tests/sim/world.test.ts`); the lap display and event messages over a crash run and two driven laps (`tests/ui/hud.test.ts`); the car drawn exactly on its footprint, the next gate and the crashed colour (`tests/render/raceView.test.ts`). |
| Track validation | Closed boundaries, no self-intersections, start pose inside the road, at least 3 ordered gates spanning the road. |
| E2E | Drive with keyboard. Drive with touch controls (mobile viewport). Crash and restart. Complete a lap on a test track. Start, pause and resume training. Save, export and import a model. Create and validate a track. Built in P2-01 (`tests/e2e/sensorDebug.spec.ts`, every project): with `?debug=rays` the published rays start at the body centre (−4.75, 40), the ±90°/±60°/±30° rays end on y = 33 and y = 47 at the expected distances and 0° is clear at 50 m; each hit marker's pixel, at the published transform applied to its world end, has the marker colour and the clear end does not; the same holds after rotating the viewport; without the flag nothing is published or drawn and the layout is identical. Real iPhone/iPad alignment, rotation and app-switch checks are manual. Built in P1-11 (`tests/e2e/staticHost.spec.ts`, every project): the production build served by a plain static file server with no rewrites or fallbacks, at the site root and under the sub-path `/nested/app/`, loads its page, script and stylesheet from under that path with no failed request or console error, starts the simulation and draws the track. Built in P1-08 (`tests/e2e/driving.spec.ts`, every project): start state and 44 px targets; at 320 × 568, 568 × 320 and 375 × 667 every control lies fully inside the viewport, unclipped, at least 44 × 44 and not overlapping another; keyboard accelerate, steer while accelerating and brake to a stop without scrolling; crash with feedback, keys ignored while crashed, R restarts at the start; Space and Enter on the focused Restart button restart (holding nothing), while Space elsewhere brakes, also straight after Restart is clicked or tapped; blur and page hiding release held keys, with pause and no catch-up jump; a held mouse button keeps holding when the pointer slides off and releases anywhere (desktop); two touch pointers steer and accelerate together, a cancelled touch releases, a finger brakes to a stop, and a real tap on Restart resets without scroll or zoom (touch projects). Full laps are driven by an in-page scripted controller that sends keyboard events (desktop projects) or touch pointer events to the buttons (phone projects), through the same input path. Playwright cannot hold real touches, so held touches are dispatched pointer events; real touch is a manual device check. |

## Golden files

`tests/sim/golden/world.json` holds the expected results of the two seeded scenarios in `tests/sim/scenarios.ts`. It is written by `tests/sim/golden.test.ts` and compared exactly on every `npm test`. For each scenario it stores:
- the seed and tick count;
- the final world (car, lap progress, best lap);
- every event (gate, lap, crash, restart) with its tick;
- for each 60-tick window, a hash of the exact float bits of every tick's state and a state sample at the window's end.

It also records the generator algorithm, track, sim config and physics constants it was made with. A change anywhere in physics, collision, checkpoints, restart or the scenarios shows up as a failed comparison whose diff points at the first window that changed.

Rules:
- **Regenerate only deliberately:** after a change that is meant to change simulation results, run `npm run test:golden:update` (Vitest in mode `golden-update`, the only mode that writes the file). Review the diff, and say in the pull request why the results changed and which windows moved first.
- **Never regenerate to make a failing test pass** without that explanation.
- Every other run only reads the file: `npm test`, Vitest's `--update`/`-u` and CI. A missing or different file fails rather than being created or rewritten. `npm run test:golden:update` refuses to run when `CI` is set.
- The numbers were produced in Node (V8). They are bit-identical between runs in the same engine. Other engines may differ in the last bits of `Math.sin`, `Math.cos`, `Math.tan` and `Math.atan2`, so the golden comparison runs only in Node, not in the browser tests.

## Mobile and device checks

Playwright's WebKit is an approximation of iOS Safari, not a replacement. For each phase, record manual checks in the pull request:

- iPhone Safari (portrait and landscape): controls reachable, 44 px targets, no page scroll or zoom while driving, readable text.
- iPad Safari: layout, touch editor (Phase 4).
- Ray sensor debug layer (P2-01), on iPhone and iPad Safari with `?debug=rays`:
  1. While driving through both curves, the rays start at the car's centre and end on the walls, or at full length when clear.
  2. After rotating portrait ↔ landscape, they still line up.
  3. After switching apps and returning, the rays and the simulation resume correctly.
  4. Without the flag, the page looks and behaves as before.
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
