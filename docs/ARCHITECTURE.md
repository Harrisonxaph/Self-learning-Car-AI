# Architecture

> Status: **Phase 1 built; Phase 2 training pieces built** (P2-01 to P2-06: sensors, inputs, network, genetic operators, fitness and the population training loop, each described in its own section below; see ROADMAP.md for statuses). Experiments, persistence, the dashboard and the editor are still planned. Phase 1 modules built: the project foundation from P1-01 (`src/main.ts`, `src/render/viewport.ts` for canvas sizing) and the fixed-timestep loop from P1-02 (`src/sim/config.ts`, `src/sim/world.ts`, `src/sim/fixedStep.ts`, `src/ui/frameLoop.ts`) the seeded generator from P1-03 (`src/utils/rng.ts`) the track model and static track layer from P1-04 (`src/sim/track.ts`, `src/data/tracks/stadium-oval.json`, `src/render/trackView.ts`, `src/render/trackLayer.ts`) the vehicle model from P1-05 (`src/sim/vehicle.ts`, physics constants in `src/sim/config.ts`) collision from P1-06 (`src/sim/collision.ts`) checkpoints and laps from P1-07 (`src/sim/checkpoints.ts`), and manual driving from P1-08 (`src/ai/drivers.ts`, `src/ui/controls/input.ts`, `src/ui/hud.ts`, `src/render/raceView.ts`, the world in `src/sim/world.ts`). Everything else below is the target design for later tasks. Update this document when the code shows a better design.

## Goals that shape the design

- **Reproducible**: the same seed and configuration produce the same run in the same JavaScript engine. All randomness comes from `utils/rng.ts` (sfc32 with splitmix32 seeding, recorded as `RNG_ALGORITHM`); `Math.random` is banned by lint in headless code. See "Randomness" below.
- **Headless-capable**: simulation, sensors, inference and evolution run without a DOM, so they can be unit-tested in Node and trained faster than real time.
- **Observable**: every number the AI sees and every decision it makes can be shown on screen.
- **Small and beginner-readable**: plain TypeScript modules with pure functions where practical, and no framework until one is needed.

## Module layout

```
src/
  main.ts                 entry point: manual driving, or the training view with ?mode=train (P2-05)
  sim/                    pure simulation, no DOM
    config.ts             fixed timestep, physics constants
    vehicle.ts            car state and physics step
    track.ts              track geometry types, loading and bounds
    collision.ts          car footprint, swept boundary checks, crash response
    checkpoints.ts        ordered gates, lap counting, tick-based lap timing
    world.ts              steps every car once per tick
    fixedStep.ts          turns real elapsed time into whole fixed ticks
  sensors/
    rays.ts               7 ray casts from the body centre → normalised distances (P2-01)
  ai/                     inference only, no evolution imports
    network.ts            feedforward net (9-12-3), forward pass, seeded initialisation (P2-03)
    inputs.ts             builds the 9-value input vector (P2-02)
    outputs.ts            maps raw outputs → steering, throttle, brake; brake mask (P2-03)
    drivers.ts            Driver interface; human driver built (P1-08); neural, random, rule-based later
  evolution/              genomes and genetic operators, no DOM
    genome.ts             flat Float64Array of weights and biases; checks and copies (P2-04)
    selection.ts          fitness ranking and tournament selection (P2-04)
    crossover.ts          uniform crossover (P2-04)
    mutation.ts           Gaussian mutation with rate and scale (P2-04)
    population.ts         config, per-operator generators, next generation with elitism (P2-04)
  training/
    fitness.ts            episode fitness and termination rules, anti-exploitation guards (P2-06)
    trainer.ts            population training loop, headless or under the frame loop (P2-05)
    trackSplits.ts        built-in track splits and the training/selection/held-out boundaries (P2-10)
    experiment.ts         experiment config, seeds, result records
    stats.ts              per-generation statistics
  persistence/
    modelFormat.ts        types and validation for saved models
    modelStore.ts         localStorage + JSON import/export
    trackStore.ts         custom track save/load
  render/                 Canvas 2D only; reads state, never mutates it
    viewport.ts           canvas sizing with capped pixel ratio
    trackView.ts          world-to-screen fit (uniform scale, centred, margin)
    trackLayer.ts         cached static track layer
    raceView.ts           next gate, car footprint, nose and locator ring (P1-08); all training cars (P2-05)
    sensorView.ts         ray sensor debug layer, shown with ?debug=rays (P2-01)
    renderer.ts
    layers/               track, cars, sensors, overlays
  ui/                     DOM controls, dashboard, editor
    frameLoop.ts          animation frames: run ticks, draw, pause when hidden
    controls/input.ts     keyboard and touch input, safe release (P1-08)
    hud.ts                lap display and event messages (P1-08)
    debugFlags.ts         debug views switched on from the address, e.g. ?debug=rays (P2-01)
    pageMode.ts           manual driving by default, training view with ?mode=train (P2-05)
    trainingPage.ts       rendered training: the trainer under the frame loop, all cars drawn (P2-05)
    dashboard/            stats, fitness graph
    editor/               track editor
  utils/
    rng.ts                seeded PRNG: sfc32 seeded by splitmix32
    sha256.ts             SHA-256 for track content hashes and frozen-model IDs (P2-10)
    math.ts               vectors, angles, segment intersection
  data/
    tracks/               built-in training, validation and held-out tracks (JSON) and their split manifest index.json (P2-10)
tests/                    mirrors src/; e2e/ for Playwright
```

## Dependency direction

```
ui ──► training ──► evolution
 │        │   └───► ai ──► sensors ──► sim ──► utils
 │        └───────────────────────────► sim
 ├──► render ──► sim (read-only types)
 └──► persistence ──► ai, sim (types)
```

Rules (enforced by review and by `no-restricted-imports` rules in `eslint.config.js`, which `tests/config/eslint-boundaries.test.ts` checks):

- `sim`, `sensors`, `ai`, `evolution`, `training` and `utils` never import `render`, `ui` or DOM globals.
- `ai` never imports `evolution`. A trained model is just weights plus architecture.
- `render` never changes simulation state.

## Simulation loop

- Fixed timestep `DT = 1/60 s` (`timestepSeconds` in `sim/config.ts`). The simulation only ever advances by `DT`; it is never given the frame time. Simulated time is `tick × DT`, computed from the tick count rather than summed, so it does not drift.
- Rendered mode (built in P1-02): `ui/frameLoop.ts` runs on `requestAnimationFrame`. `sim/fixedStep.ts` turns each frame's real elapsed time into a whole number of ticks, carrying part-ticks to the next frame. At most `maxStepsPerFrame` (5) ticks run per frame; any further backlog is dropped, so a slow device slows the simulation down instead of spiralling. The loop renders once per frame after the ticks. No interpolation yet; add it if motion looks uneven once cars move.
- On `visibilitychange` to hidden, the loop cancels its frame and drops all pending time. The first frame after the page is shown again only records the time, so returning from another tab or app (including iOS Safari suspension) never causes a catch-up jump.
- Headless/accelerated mode (planned, P3-03): run N ticks per batch (for example inside `setTimeout` slices or a Web Worker) without drawing, then hand a snapshot to the renderer every few hundred milliseconds. It uses the same `stepWorld` and `DT`.

## Randomness

Built in P1-03 (`src/utils/rng.ts`).

- **Algorithm:** sfc32 (128-bit state; reference implementation in [PractRand](https://pracrand.sourceforge.net/)). The 32-bit seed sets the three state words through a Weyl sequence (step `0x9e3779b9`) and MurmurHash3's fmix32 finaliser; the counter starts at 1, and the first 12 outputs are discarded. It is recorded as `RNG_ALGORITHM = 'sfc32-splitmix32-v1'`. Chosen over mulberry32 for its larger state and period.
- **Seeds:** an integer from 0 to 4,294,967,295. Anything else (negative, fractional, too large, `NaN`, not a number) throws `RangeError`. Nothing is silently truncated.
- **Outputs:**
  - `nextUint32()`: an integer in [0, 2^32).
  - `next()`: a float in [0, 1).
  - `range(min, max)`: a float in [min, max).
  - `int(min, max)`: an unbiased integer in [min, max).
  - `gaussian(mean, sd)`: Box–Muller.
  - `pick(items)`.
  - All results are finite. Invalid arguments throw `RangeError`.
- **Rules for simulation, AI, evolution and training code:**
  - Create generators from the recorded experiment seed. Never keep a generator in a module-level variable, and never use `Math.random` (lint enforces this in headless folders).
  - Pass the generator in as an argument, so tests can supply their own and runs stay reproducible.
  - Give each independent purpose its own generator, for example mutation, crossover and start positions. Seed each from a parent generator with `nextUint32()`, so extra draws in one place do not shift another.
  - Record the seed and `RNG_ALGORITHM` with every experiment (P2-07). Changing the algorithm means bumping `RNG_ALGORITHM`.
- **Checkpoints:**
  - `getState()` returns a plain-JSON copy: `{ algorithm, words: [a, b, c, counter] }`.
  - `restoreRng(state)` continues exactly where the saved generator stopped. It validates the state, because checkpoint files are untrusted input.
  - Saving checkpoints is P3-07's job. P1-03 only provides the state.
- **Engines:** integer outputs are exact in every JavaScript engine. `gaussian()` uses `Math.log` and `Math.cos`, whose last bits may differ between engines, so results are reproducible within one engine, matching the goal above.

## Vehicle model

Built in P1-05 (`sim/vehicle.ts`): a kinematic bicycle model, pure and headless, stepped only by the fixed timestep.

- **State:** rear-axle `position` (world metres, y down), `heading` (radians from +x towards +y, kept in (−π, π]: `createVehicle` accepts any finite start heading, including several turns, and normalises it; each step re-wraps it; a non-finite start pose throws `RangeError`) and forward `speed` (m/s, never negative). No lateral slide.
- **Controls per tick:** `steering ∈ [−1, 1]` (positive increases the heading: a right turn, clockwise on screen), `throttle ∈ [0, 1]`, `brake ∈ [0, 1]`. Finite out-of-range values are clamped; non-finite or non-number values throw `RangeError`, because they mean a bug in the driver.
- **Acceleration** = throttle × `engineAcceleration` − brake × `brakeDeceleration` − `quadraticDrag` × speed² − `rollingResistance` × speed.
- **Speed limits:** speed is clamped to [0, `maxSpeed`], so brakes and resistance never reverse the car and a stopped car with the brake on stays put. With no throttle, a speed below `stopSpeed` becomes 0, so coasting cars come to rest. `maxSpeed` is the full-throttle terminal speed, derived by `terminalSpeed()` from the positive root of `quadraticDrag·v² + rollingResistance·v = engineAcceleration`, evaluated as `2·a / (r + √(r² + 4·c·a))` so tiny drag does not cancel to 0 (23.72 m/s for the defaults), never set by hand.
- **Steering:** wheel angle = steering × `maxSteerAngle(speed)`, where `maxSteerAngle = min(maxSteerRadians, atan(maxLateralAcceleration × wheelbase / speed²))`. Yaw rate = speed × tan(wheel angle) / `wheelbase`, so it is zero at zero speed (no pivoting on the spot) and sideways acceleration never exceeds `maxLateralAcceleration` (8 m/s² by default) at full steering.
- **Integration:** semi-implicit Euler per tick: speed first, then heading from the new speed, then position along the new heading.
- **Defaults** (`DEFAULT_VEHICLE_PHYSICS`): wheelbase 2.5 m, engine 8 m/s², brake 12 m/s², drag 0.01, rolling resistance 0.1, max steer 0.5 rad, max lateral 8 m/s², stop speed 0.05 m/s, body 4 × 2 m. These match the `physics` block in `docs/MODEL_FORMAT.md`.
- **Demonstration:** `npm run demo:vehicle` prints a scripted accelerate / turn / coast / brake run through the same `stepVehicle`.

All constants live in `sim/config.ts` and are recorded with every experiment and saved model.

## Track, collision and checkpoints

- A track is two closed polylines (inner and outer boundary), a start pose and an ordered list of checkpoint gates (segments across the road). Built in P1-04 (`sim/track.ts`):
  - Coordinates are world metres with x to the right and y **downwards**, matching the canvas; headings are radians from +x towards +y. The renderer only scales and shifts, so world and screen never mix.
  - Boundaries are listed without repeating the first point; the last point joins back to the first. Gates go from the inner boundary (`a`) to the outer (`b`); gate 0 is the start/finish line.
  - `loadTrack(data)` checks only the data's shape (strings, finite numbers, at least 3 points and 3 gates, no holes) and returns a deep-frozen `Track`. Geometric validation (non-crossing boundaries, start on the road, gates spanning the road) is P4-01; until then the built-in fixture's geometry is checked by unit tests.
  - Built-in track: `data/tracks/stadium-oval.json`, id `stadium-oval`, version `1`. Two 120 m straights joined by semicircles of 40 m centre-line radius, road 14 m wide, vertices every 15°, 20 gates; bounds 214 m × 94 m. Gates and the start pose are data only until P1-05 and P1-07 use them.
- Collision: built in P1-06 (`sim/collision.ts`), pure and headless.
  - **Footprint:** the `vehicleLength` × `vehicleWidth` rectangle (4 × 2 m) centred between the axles, so it overhangs each axle by (length − wheelbase) / 2 = 0.75 m: from 0.75 m behind the rear axle (the state's position) to 3.25 m ahead of it. Corners are listed rear-right, front-right, front-left, rear-left; "right" is the side positive steering turns towards (+y at heading 0).
  - **On the road** means the whole footprint is strictly inside the outer boundary and outside the inner one. Any shared point with a boundary, including a flush edge, a single corner or a wall corner pushed into the car's side, is a crash. A footprint wholly off the road (in the infield, or past the outer wall) is a crash too, though no edges cross; so is a small inner loop wholly under the car.
  - **Swept check:** each step tests the convex hull of the footprint before and after the move against every boundary segment, plus the end pose's containment. The motion within a step is taken as a straight line with the heading turning evenly the short way; a step that turns more than `MAX_SWEEP_ROTATION` (0.05 rad) is split into equal slices.
    - Straight moves: the hull is exactly the area passed over, so the test is exact and no speed or timestep can tunnel through a wall.
    - Turning moves: points of the body follow arcs, which bulge outside the hull by at most `turnMargin` = reach × turn² / 8 (reach = 3.40 m, the body's farthest point from the rear axle). A boundary within that margin of a turning slice's hull also counts as a hit, so turning contacts are never missed. A straight-only hull test did miss one: Codex found a full-lock, top-speed tick on the stadium oval that clipped the inner wall by about 1 µm mid-step, now a regression test.
  - **Limitations:** the turning margin makes the check conservative: a turning car may be flagged up to about 0.2 mm before a true contact at the default tick (at most 0.0225 rad per tick), and up to about 1.1 mm for a full 0.05 rad slice. Contacts are exact floating-point comparisons, so "touching" means touching to within rounding. Boundaries are assumed simple and non-crossing (validated in P4-01). Every segment is looked at every tick (52 on the built-in track), with a bounding-box rejection before the detailed test; about 4 µs per car-step in an informal local measurement. A spatial index (P2-11) waits for a measured need.
  - **Response:** `stepCar` returns the car at its pose before the step (the last pose known to be clear, at most one step's travel short of the wall: 0.40 m at top speed and 1/60 s), speed 0, `crashed: true`. A crashed car ignores controls; manual restart is P1-08. `createCar` flags a car already crashed if its start pose is not on the road.
- Checkpoints: built in P1-07 (`sim/checkpoints.ts`), pure and headless. Only the **next** gate in order counts, crossed forwards; crossing gate 0 after all others completes a lap. This blocks reward from crossing the same gate back and forth.
  - **Reference point:** the rear axle, the vehicle state's `position`. Between ticks it moves in a straight line (the same motion the collision sweep uses), so a crossing on that segment is exact at any speed; the nose reaches a gate 3.25 m earlier.
  - **Forward:** a gate's a → b direction (inner boundary to outer) turned a quarter turn anticlockwise as seen on screen, (dy, −dx). Driving forwards keeps the infield on the left; on the built-in track that is the start direction.
  - **Crossing:** the move goes from behind the gate's line or exactly on it to strictly ahead of it, touching the gate segment (end points count). So a car that starts or rests on a gate earns one credit when it leaves it forwards; stopping on a line, moving backwards, moving along a line or passing beyond a gate's end earns nothing. A step can cross several gates (a very fast car or a long timestep): they count in order along the move, each only if it is next at that point.
  - **Laps and timing:** gate 0's first forward crossing starts timing (the start pose is just behind it); each later gate 0 crossing after gates 1 … n−1 in order completes a lap and starts the next. `LapProgress` records the tick count, next gate, gates passed, the current lap's start tick and completed laps as whole ticks; seconds = ticks × DT (`lapSeconds`), so timing never depends on the frame rate. A crossing is stamped with the tick that ends the step, at both ends of a lap, so lap times are consistently quantised to whole ticks: the true continuous-time duration can differ from the recorded one by less than one tick (1/60 s), because the two crossings can fall at different points within their ticks. Sub-tick interpolation is not used.
  - **Per car and pure:** each car has its own `LapProgress`; `advanceProgress` returns a new object and never changes its input.
  - **With collision:** `stepRacer` steps the car (`stepCar`) and then its progress using only the move the collision check accepted. A step rejected by a crash leaves the car where it was, so it credits no gate, even one the rejected move would have crossed; a crashed car earns nothing more while its ticks go on.

## Sensors and network inputs

Seven rays fanned across the car's front (−90°, −60°, −30°, 0°, 30°, 60°, 90° relative to heading by default), each with maximum length `RAY_LENGTH`. Inputs (all scaled to roughly [0, 1] or [−1, 1]):

| # | Input | Range |
|---|-------|-------|
| 0–6 | ray hit distance ÷ `RAY_LENGTH` (1 = nothing hit) | 0 to 1 |
| 7 | forward speed ÷ `MAX_SPEED` | 0 to 1 |
| 8 | signed angle from car heading to the next checkpoint's centre ÷ π | −1 (exclusive) to 1 |

**Network inputs contract** (built in P2-02, `src/ai/inputs.ts`; `INPUT_CONTRACT = "seven-rays-speed-heading-v1"`):

- **Builder:** `buildInputs(racer, track, physics, sensorConfig = DEFAULT_SENSOR_CONFIG)` returns a frozen array of 9 finite numbers. It is headless and pure: it reads the world and never changes it, and nothing is drawn. It does not touch `Observation` or the drivers; a neural driver will feed these inputs to the network in a later item.
- **Order and names:** `INPUT_NAMES` is `ray-90`, `ray-60`, `ray-30`, `ray0`, `ray30`, `ray60`, `ray90`, `speed`, `headingError`, matching MODEL_FORMAT's `architecture.inputs`. The ray names follow the configured angles (`inputNames(config)`).
- **Rays (0–6):** each ray's `normalised` distance from `castRays` (ray sensor contract below), in the config's angle order, in [0, 1], where 1 is clear.
- **Speed (7):** forward speed ÷ `physics.maxSpeed`, clamped to [0, 1]. The speed is never negative, and the clamp only guards rounding above the derived top speed.
- **Heading error (8):**
  - **Target:** the centre (midpoint of `a` and `b`) of `track.gates[progress.nextGate]`, the only gate that can count next.
  - **Reference point:** the rear axle (the vehicle state's `position`), the point checkpoints use for crossings. The target therefore moves to the following gate on exactly the tick the gate is credited. The sensor origin (body centre) is not used here.
  - **Value:** `wrapAngle(atan2(target − reference) − heading) / π`. Positive means the target is to the car's right (towards +y at heading 0), the side positive steering turns towards. Negative means left, and 0 means straight ahead.
  - **Wrapping:** the angle is wrapped into (−π, π], so the value is in (−1, 1]. A target exactly behind reads +1; one just left of behind reads close to −1.
  - **Degenerate case:** a reference point exactly on the target reads 0.
  - **Crashed cars:** inputs are still computed, from the pose where the car stopped.
- **Errors:** `buildInputs` throws a `RangeError` for:
  - a `maxSpeed` that is not finite or not above 0, or a non-finite speed;
  - a `nextGate` that is not an integer index into the gates, or a track with no gates;
  - anything the ray sensors reject (pose, wheelbase, sensor config).

**Ray sensor contract** (built in P2-01, `src/sensors/rays.ts`; part of `seven-rays-speed-heading-v1`):

- **Configuration:** `SensorConfig` is `{ origin: "body-centre", anglesDegrees, maxDistance }`. `maxDistance` is `RAY_LENGTH`. The default, `DEFAULT_SENSOR_CONFIG`, is the MODEL_FORMAT sensors block: the seven angles above and 50 m. `resolveSensorConfig` returns a frozen copy, or throws a `RangeError` naming the field when:
  - there are not exactly 7 angles;
  - an angle is non-finite, outside [−90, 90] or not strictly increasing;
  - `maxDistance` is not finite or not above 0;
  - the origin is unknown.

  `castRays` checks its config the same way.
- **Origin:** the body centre. That is the rear-axle reference plus `wheelbase / 2` along the heading, the centre of the collision footprint: 1.25 m ahead with the default physics. Saved models record it as `sensors.origin`, so changing it changes the input contract.
- **Angles:** degrees from the heading, positive towards +y, the car's right, as for steering. A ray's world angle is heading + angle.
- **Result:** for each ray, the distance to the nearest boundary point in [0, `maxDistance`], or `maxDistance` if none is in range; then normalised (distance ÷ `maxDistance`, 1 = clear), a hit flag and the end point. Results are never NaN or negative. `castRay` takes an angle rather than a vector, so the direction is always a unit vector; a non-finite origin or angle, or an invalid range, throws a `RangeError`. A non-finite pose or a wheelbase that is not above 0 also throws.
- **Edge rules:**
  - Touching counts, as in collision: an origin on a boundary reads 0 in every direction.
  - A hit exactly at `maxDistance` is a hit; farther is clear.
  - Hits behind the origin are ignored, and the nearest hit over both boundaries wins.
  - A ray through a shared vertex is found once and never slips between the two segments.
  - A parallel segment is hit only if collinear. The nearest overlapping point ahead counts (0 if the overlap contains the origin), and an overlap wholly behind is ignored.
  - Points within `LINE_TOLERANCE` (1e-12 m) of the ray's line count as on it, so a ±90° ray along a wall is not lost to rounding in cos(π/2).
  - An origin off the road still reports its nearest hit.
- **Debug layer:** `?debug=rays` draws, for the human car, a line from the origin to each ray's end, with a marker at each hit (`src/render/sensorView.ts`). It also publishes the rays as `data-rays` on the canvas for the browser tests. It is off by default. Sensors only read the world, so the simulation and the golden determinism file are unchanged.
- **Cost:** every boundary segment is tested for every ray. A spatial index is P2-11.

## Network

- Fully connected feedforward: 9 inputs → 12 hidden (`tanh`) → 3 outputs.
- Outputs: `steering = tanh(o0)`, `throttle = sigmoid(o1)`, `brake = sigmoid(o2)`.
- Parameter count: 9×12 + 12 + 12×3 + 3 = **159**.
- Weights are stored as one flat array in a documented order (see `docs/MODEL_FORMAT.md`), so evolution can work on genomes without knowing layer structure.
- "No-braking" experiments keep the same 9-12-3 shape and force `brake = 0`, so parameter counts match and only braking differs.

**Network contract** (built in P2-03, `src/ai/network.ts` and `src/ai/outputs.ts`):

- **Layout:** `LAYERS = [9, 12, 3]` and `PARAMETER_COUNT = 159`, in the MODEL_FORMAT order (`PARAMETER_ORDER`): for each layer, `weights[out][in]` row-major, then `biases[out]`.

  | Indices | Contents |
  |---|---|
  | 0–107 | W1: hidden `j` from input `i` at `9·j + i` |
  | 108–119 | b1 |
  | 120–155 | W2: output `k` from hidden `j` at `120 + 12·k + j` |
  | 156–158 | b2 |

  `weightIndex(layer, to, from)` and `biasIndex(layer, to)` give these positions.
- **Forward pass:** `evaluate(parameters, inputs)` returns new arrays: `hidden = tanh(W1·x + b1)` (12 values in [−1, 1]) and `raw = W2·hidden + b2` (3 linear values).
- **Controls:** `runNetwork(parameters, inputs, { brakeEnabled })` returns `Controls`:
  - `steering = tanh(o0)`, in [−1, 1];
  - `throttle = sigmoid(o1)`, in [0, 1];
  - `brake = sigmoid(o2)`, in [0, 1], or exactly 0 when `brakeEnabled` is false.

  The three outputs are independent. `sigmoid` is computed so it never overflows, reaching exactly 0 or 1 at the extremes.
- **Validation:** a `RangeError` is thrown for:
  - parameters that are not exactly 159 finite numbers (an array or a `Float64Array`);
  - inputs that are not exactly 9 finite numbers;
  - a non-boolean `brakeEnabled`;
  - a hidden or output sum that overflows to ±Infinity (huge weights or inputs).

  Results are never NaN.
- **No hidden state:** these are pure functions with no module-level mutable state. Arguments are never written.
- **Initialisation:** `initialParameters(rng)` returns a new `Float64Array` of 159 independent `rng.range(-1, 1)` draws, in parameter order. This is `INITIALISATION`, id `uniform-pm1-v1`.
  - It advances the generator by exactly 159 draws, so a seed reproduces the same network.
  - `range` is used rather than `gaussian` because its arithmetic is exact in every JavaScript engine.
  - P2-07 records this id in the training configuration. A2 (untrained) and A8/A9 (random-search) baselines use the same distribution.
- **Separation:** inference imports only `sim` types and `utils/rng`, never evolution or training. Lint enforces this, and a test checks the imports. The network drives cars only through the P2-05 trainer (see "Training loop"); there is no neural `Driver` object yet.

## Evolution

- Population of P genomes (start with P = 50, configurable).
- Each generation: evaluate every car on one selected training circuit under identical start conditions → sort by fitness → copy the top E unchanged (elitism) → fill the rest by tournament selection, crossover and Gaussian mutation. Multiple selectable circuits are required; training one evolutionary run across multiple circuits is optional R-06, not a primary-release prerequisite.
- Mutation rate, mutation scale, crossover type, population size, elitism count, max episode time and seed are all part of the experiment configuration.

**Genetic operators contract** (built in P2-04, `src/evolution/`; `EVOLUTION_OPERATORS = "tournament-uniform-gaussian-v1"`):

- **Genomes:** flat arrays of finite numbers, all the same length (at least 1) within a population. Evolution never reads the network layout. A network genome is its 159 parameters (P2-03), and evolved genomes pass `checkParameters`. Every genome evolution returns is a new `Float64Array`. Nothing passed in is written, and outputs never alias inputs or each other.
- **Config:** `resolveEvolutionConfig` returns a frozen copy of `{ populationSize, eliteCount, selection: { type: "tournament", size }, crossover: { type: "uniform", rate }, mutation: { rate, scale } }`, with the same field names as MODEL_FORMAT's `training.configuration`. It throws a `RangeError` naming the field for:
  - a population size that is not an integer from 2 to 100,000;
  - an elite count that is not an integer from 0 to the population size;
  - a tournament size that is not an integer from 1 to the population size;
  - rates outside [0, 1];
  - a negative or non-finite mutation scale;
  - any other operator type.
- **Fitness:** one finite number per genome, supplied by the caller (the episode fitness is P2-06, `training/fitness.ts`; evolution does not import it); higher is better. Wrong length, non-finite scores or missing scores (holes in a sparse array, checked index by index) throw a `RangeError`. Populations are checked the same way.
- **Ranking:** fitness descending, ties to the lower index, so results never depend on sort stability.
- **Elitism:** the top `eliteCount` genomes are copied unchanged, in rank order, into places 0 … E−1. They are never crossed or mutated.
- **Tournament selection:** `size` uniform draws with replacement (`rng.int(0, N)`); the fittest wins, ties to the lower index. Each remaining place picks parents A and B with two tournaments, and A may equal B.
- **Uniform crossover:** with probability `crossover.rate` (one `next()` per child), each gene comes from A when its `next()` draw is below ½, otherwise from B. Without crossover, the child is a copy of A. Every child gene is its parents' gene at the same position.
- **Gaussian mutation:** per gene, one `next()`. Below `mutation.rate`, `gaussian(0, scale)` is added. Rate 0 or scale 0 changes nothing. A gene that overflows throws a `RangeError`.
- **Generators:** `nextGeneration(population, fitness, config, { selection, crossover, mutation })` uses one generator per operator. `createEvolutionRngs(parent)` derives them with `createRng(parent.nextUint32())`, in that order. Crossover and mutation settings therefore never change which parents are selected, and mutation never shifts crossover. The same inputs and generator states always give the same generation. `gaussian` uses `Math.log` and `Math.cos`, so mutation is reproducible within one JavaScript engine (see Randomness).
- **Result:** `{ genomes, eliteSources, parents }`: the N new genomes, the source index of each elite, and parents A and B for each child.
- **Separation:** evolution imports only `utils/rng`. It never imports inference, training, persistence, rendering or the DOM. Lint enforces this, and a test checks the imports.

## Fitness

**Episode scoring contract** (built in P2-06, `src/training/fitness.ts`; `FITNESS_VERSION = 1`, recorded as `fitnessVersion`). The design was documented on [#17](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/17#issuecomment-6422048941) before coding.

- **Formula** (points):

  ```
  fitness = checkpointWeight × gatesPassed
          + partialProgressWeight × partialProgress                  (0 ≤ partialProgress ≤ 0.99)
          + Σ completed laps ( lapWeight + lapTimeBonusScale × min(maxLapTimeRatio, referenceLapSeconds / lapSeconds) )
          − (crashed ? collisionPenalty : 0)
  ```

  Defaults (MODEL_FORMAT's `fitness` block): 1000, 1000, 5000, 2000 × min(2, 30 s / lap time), penalty 500. `scoreEpisode` returns each term and the total. Distance and speed earn nothing.
- **Ordered progress:** `gatesPassed` and the lap ticks are P1-07's credits (only the next gate, forwards, through the gate, using the move collision accepted), including the first gate 0 crossing that starts lap timing. Lap seconds are whole ticks × the fixed timestep.
- **Partial progress (`partialProgressAt`):**
  - **Segment:** the fraction of the way along the segment from an anchor to the next gate's centre. The anchor is the start position before the first credit, then the previous gate's centre (gate n−1 before gate 0).
  - **Clamping:** the fraction is clamped to [0, 0.99].
  - **When it is 0:**
    - more than one road width (the longer of the two gates) from the segment;
    - strictly ahead of the next gate's line without having crossed it.
  - **High-water mark:** the episode keeps the largest value since the last gate credit. It resets only when a gate is credited, so an approach is earned once. Because the config requires `partialProgressWeight` ≤ `checkpointWeight` (the defaults are equal), an approach (at most 0.99 × `partialProgressWeight`) is always worth less than a crossing whenever crossings earn anything.
- **Termination (`recordTick`):** after each tick, the first match wins:
  1. **`completed`:** `maxLaps` laps done.
  2. **`crashed`:** the car touched a wall. The move that would have hit the wall is rejected by collision, so it credits nothing, and the penalty applies once.
  3. **`stalled`:** no new gate credit for `stallTicks`. Partial progress does not reset this timer.
  4. **`timeout`:** `maxEpisodeTicks` ticks have run.

  `resolveEpisodeRules` converts `maxEpisodeSeconds` (60), `stallSeconds` (5) and `maxLaps` (3) into ticks: ⌈seconds ÷ timestep⌉, with a 1e-9 tolerance, so 3600 and 300 ticks at 1/60 s. Recording after an outcome throws. The caller (the P2-05 trainer) steps each car with `stepRacer` and records it once per tick.
- **Validation:** `resolveFitnessConfig` and `resolveEpisodeRules` return frozen copies and throw a `RangeError` naming the field for:
  - a wrong `version`;
  - negative or non-finite weights;
  - a `partialProgressWeight` above `checkpointWeight`;
  - a non-positive reference lap, limit or timestep;
  - a limit whose tick count is not a safe integer (for example a denormal timestep, which would otherwise turn the stall and timeout limits into Infinity);
  - `maxLapTimeRatio` below 1;
  - a non-integer `maxLaps`.

  `startEpisode` needs fresh progress. `recordTick` rejects:
  - a racer that is not exactly one tick later;
  - a gate count or lap count that went down;
  - an undone crash;
  - a non-finite position or an invalid next gate.

  `scoreEpisode` throws a `RangeError` naming the term if any term, the lap-bonus sum or the total overflows to a non-finite value (very large finite weights), because evolution only accepts finite fitness.
- **Guards** (AI_EVALUATION.md §6):
  - Farming and oscillation earn one credit at most.
  - Idling, creeping, circling and wrong-way driving stall with at most the bounded approach.
  - Crashes are penalised and keep only the progress made before them.
  - No term grows with time alone, and lap-time bonuses need completed laps.
- **Limitation:** a degenerate track with overlapping gates can let a car complete "laps" by crossing back and forth. Scoring stays bounded by `maxLaps` and the lap-ratio cap; rejecting that geometry belongs to track validation (P4-01).
- **Separation:** fitness imports only `sim/`, never inference, evolution, rendering or the DOM (lint for the last two; a test checks the imports). It never steps the simulation.

## Training loop

**Population trainer** (built in P2-05, `src/training/trainer.ts`). The plan was documented on [#16](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/16#issuecomment-6425226371) before coding.

- **One simulation path:** each running car, each fixed tick, calls only existing functions, in this order:
  1. `buildInputs` (P2-02);
  2. `runNetwork` (P2-03, with `brakeEnabled`);
  3. `stepRacer` (physics, swept collision and gates, the same function `stepWorld` uses for the human car);
  4. `recordTick` (P2-06).

  At the end of a generation, `scoreEpisode` gives each car's fitness and `nextGeneration` (P2-04) builds the next population.
- **Cars (multi-car Option A):** each car is `{ genome, racer, episode }`, with nothing mutable shared.
  - Rays and collision test track boundaries only, so cars never see, block or hit each other. Every car starts on the track's start pose, overlapping the others.
  - A car's result depends only on its genome and the shared, immutable track, physics and configuration. It is bit-identical alone, in any population, in any order, and next to copies of itself.
- **Lifecycle:**
  1. **Start:** a generation starts one fresh car per genome (`startRacer` and `startEpisode`: start pose, at rest, tick 0).
  2. **Ticks:** each tick steps every car whose episode has no outcome, in index order. Finished cars are frozen.
  3. **End:** the generation ends when every car has an outcome, which happens within `maxEpisodeTicks`.
  4. **Scoring:** statistics are recorded:
     - each car's fitness;
     - best, mean and worst fitness;
     - the champion's index and a copy of its genome;
     - outcome counts and cars with a lap;
     - maximum gates passed;
     - the generation's length in ticks and the ticks summed over all cars.
  5. **Next generation:** the next population starts, with elites first and unchanged. Nothing carries over except genomes, so an elite scores exactly its previous fitness.
- **Configuration:**
  - `TrainingConfig` is the seed plus the evolution block, `fitness`, `maxEpisodeSeconds`, `stallSeconds`, `maxLaps` and `brakeEnabled`. These are MODEL_FORMAT names, and the defaults are its example (50 cars, seed 1). The track, physics and timestep are the environment.
  - Everything is validated through the existing resolvers. The seed must be an integer from 0 to 4,294,967,295.
- **Recorded:** `record()` returns the resolved configuration, a copy of the vehicle physics, the timestep, the sensor configuration and the per-generation statistics. It also returns the version references a champion replay needs:
  - `RNG_ALGORITHM`, `EVOLUTION_OPERATORS`, `INITIALISATION.id` and `PARAMETER_ORDER`;
  - `INPUT_CONTRACT`, `OUTPUT_CONTRACT` (`steering-throttle-brake-v1`, now in `ai/outputs.ts`) and `FITNESS_VERSION`;
  - the track's id and version.

  These are in memory only. Saving them is P2-07 and P3-05.
- **Randomness:** the trainer owns one run generator, `createRng(seed)`. Its first draw seeds the initial-population generator, which fills genomes in index order. Each generation transition takes exactly three more draws, through `createEvolutionRngs`. Episodes use no randomness, so stepping order and drawing cannot change any stream.
- **Headless:** `runGeneration` and `trainHeadless(config, environment, generations)` run in Node. `npm run demo:train` prints 50 generations with the default configuration, in about 80 s here.
- **Rendered (`?mode=train`, `ui/trainingPage.ts`):**
  - The page's frame loop calls `trainer.step()` once per fixed tick, at most `maxStepsPerFrame` per frame. Drawing (`drawCars`) only reads car state, so results match a headless run; a test drives the loop at several frame rates.
  - Running cars are blue, crashed cars red and other finished cars grey. One status line names the generation and how many cars are still running, and the manual controls and lap display are hidden.
  - The default page is still manual driving.
  - There is no dashboard, graph, speed control, saving or replay; those are P3-01 to P3-05.
- **Observed with the defaults:** 3 laps of the oval (about 1,474 m) cannot fit in 60 s at the 23.7 m/s top speed. So `completed` is unreachable on this track with these limits, and lapping cars end as `timeout`. This is a configuration fact, not a result.
- **Separation:** the trainer imports `ai`, `evolution`, `sensors`, `sim`, `utils` and `training` only. Lint forbids rendering, UI, persistence and the DOM, and a test checks the imports.

## Track splits

**Built-in splits and their boundaries** (built in P2-10, `src/training/trackSplits.ts`, `src/data/tracks/index.json`). The plan was documented on [#41](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/41#issuecomment-6427320313) before coding. The protocol is AI_EVALUATION.md §5.

- **Circuits:** one per split. All are anticlockwise, with the infield on the left and gate `a` on the inner boundary (P1-07).

  | Split | Track | Corners | Width | Lap | Gates |
  |---|---|---|---|---|---|
  | training | `stadium-oval` v1, unchanged | two 180° curves of radius 40 m | 14 m | 491 m | 20 |
  | validation | `rounded-rectangle` v1 | four 90° corners of radius 15 m | 12 m | 394 m | 14 |
  | held-out | `hairpin-chicane` v1 | right-left chicane (±30°, radius 25 m), left and right 180° hairpins (radius 12 m), four 90° corners (radius 16 m) | 11 m | 502 m | 18 |

  The new circuits' centre lines are straights and circular arcs. Arcs are sampled every 15°, and straights are split into pieces of at most 10 m. Both boundaries are offsets by half the width, gates sit on boundary vertices about 25 m apart, and the start pose is 6 m behind gate 0. The JSON is committed data.
- **Manifest:** format `self-driving-ai-evolution/track-splits`, version 1. Each entry has `id`, `version`, `split`, `file` and `contentHash`.
  - `contentHash` is `sha256:` followed by the SHA-256 (`utils/sha256.ts`) of `JSON.stringify(loadTrack(file))`. `loadTrack` fixes the field order, so formatting doesn't matter, but any content change does; change the version and the hash together.
  - A second, **geometry hash** covers only the boundaries, start and gates. It recognises the same circuit under another ID or name.
- **Loading:** `loadTrackSplits(manifest, files)` returns frozen splits in manifest order. `BUILT_IN_TRACK_SPLITS` is the built-in set. It throws `TrackSplitError` for:
  - a wrong format or version, or a malformed entry;
  - a duplicate ID or file;
  - an unknown or empty split;
  - a missing file, or a file that does not load;
  - an ID or version mismatch;
  - a stale content hash;
  - two entries with the same geometry.
- **Boundaries:** each one throws `TrackLeakageError` when crossed.
  - **Training:** `trainingTrack(id)`. The trainer also calls `assertTrainingTrack` on every track it is given. Every manifest entry the track matches, by ID or by geometry, is checked, and the track is rejected if any of them is a validation or held-out track. A renamed copy is caught, including one given the training oval's own ID. A track counts as `training` only when its geometry is a training circuit. Anything else is `unregistered`: a synthetic test track, or new geometry under a training ID. A run's version references record `trackHash` and `trackSplit`.
  - **Selection:** `validationTrack(id)` and `selectByValidation(results)`. The second chooses the model with the best mean score, ties to the first listed, and rejects any result whose track is not a validation track.
  - **Held-out:** `heldOutTrack(id, model)` takes only a model from `freezeModel(parameters, provenance)`. That model is a frozen copy whose `id` is the SHA-256 of its parameters and provenance. A non-frozen model, a forged ID or an altered model is refused.
- **Not included:** an experiment runner (P2-07, P2-08), a general track validator (P4-01) and more circuits (P4-04). The geometry hash is exact, so a moved, scaled or mirrored copy counts as a different circuit; held-out integrity also relies on review and on the experiment protocol. No network has been trained or evaluated on the validation or held-out circuits.
- **Separation:** `trackSplits.ts` imports only `sim`, `utils` and the track data. A test checks this.

## Drivers

Every car is controlled through one `Driver` interface (`decide(observation) → controls`). Implementations: `NeuralDriver`, `RandomDriver`, `RuleBasedDriver` and `HumanDriver`. This makes baselines, replay and human-vs-AI races use the same simulation path.

Built in P1-08 (`ai/drivers.ts`): the interface, an `Observation` holding the car (sensors join in Phase 2), and the human driver. `controlsFromInput` maps held buttons to controls: full steering towards the held side (both sides cancel), full throttle, full brake, in any combination; the physics limits the wheel angle at speed.

## Manual driving (P1-08)

- **One simulation path:** every fixed tick, `main.ts` applies a pending restart, asks the driver for controls and calls `stepWorld` (`sim/world.ts`), which steps the car through physics, collision and lap progress (`stepRacer`). Input never changes the world directly, and rendering only reads it.
- **World:** the track, physics, tick count, the racer (car and lap progress) and the best lap in ticks. `restartWorld` puts the car back on the start pose at rest, uncrashed, with fresh progress (no laps; timing waits for gate 0 again); the tick count and the session's best lap are kept. A restart requested by R or the Restart button is applied at the start of the next tick.
- **Input (`ui/controls/input.ts`):** keys and on-screen buttons record held "sources" per action, so several sources can hold one action and any actions can be held together.
  - Keyboard (by `KeyboardEvent.code`): ←/A and →/D steer, ↑/W accelerate, ↓/S and Space brake, R restarts once per press (not on auto-repeat). Bound keys' default action (scrolling) is prevented; Ctrl, Cmd and Alt shortcuts are left alone. Space on the focused Restart button is left to the browser, so it activates Restart as on any button instead of braking; anywhere else Space brakes.
  - Touch and mouse: each pointer on a hold button (Steer left, Steer right, Brake, Gas) holds its action, with pointer capture so it stays held if the finger slides off and is released wherever it lifts. `pointerup`, `pointercancel` and `lostpointercapture` release it; several fingers work at once; the long-press menu is blocked. Restart is an ordinary button (tap, click, or Enter/Space when focused). A tap or click leaves no focus on it, so Space brakes again straight after.
  - Safety release: losing window focus, `pagehide`, or the page becoming hidden releases everything, so nothing stays held after an app switch, lock screen or tab change. Pausing itself is the frame loop's (P1-02), which resumes without a catch-up jump.
- **Display:** the car is drawn on its collision footprint with a white wedge at the nose and a locator ring (a marker only; the whole track fits the screen, so on a phone the car is a few pixels long). The next gate is highlighted. `ui/hud.ts` computes the lap count, current, last and best lap times (whole ticks × DT), the next gate, speed and an event message: lap timing started, each checkpoint, each lap (marking a new best), a crash (kept until restart) and a restart; messages last 2 s.
- **Layout:** header with the lap display, the track canvas, and a row of 56 px buttons (at least 44 × 44 CSS px). The page cannot scroll or bounce (`overflow: hidden`, `overscroll-behavior: none`) and the track and controls set `touch-action: none`, so touches never scroll or zoom; short landscape screens get a tighter header, and screens 400 px wide or narrower get tighter spacing (buttons at least 48 × 56 CSS px) so all five controls fit on one row down to 320 px. A keyboard hint is shown only for fine pointers.

## Rendering and UI

- Canvas 2D, resized to the container with `devicePixelRatio` capped at 2 (`MAX_PIXEL_RATIO` in `src/render/viewport.ts`). The canvas is measured in CSS pixels and its drawing buffer is only reassigned when the size changes, because reassigning it clears the canvas. Simulation code never sees these pixel sizes.
- Layers: static track (cached to an offscreen canvas and redrawn only on resize or edit), cars, optional sensor rays and an optional champion decision overlay.
- Track fit (built in P1-04, `render/trackView.ts`): one uniform scale for both axes, the largest that fits the track bounds inside the canvas less a margin of 4% of the shorter side (at least 8 CSS px), centred. The track never stretches; the spare space goes to whichever direction does not limit the scale.
- Static track layer (built in P1-04, `render/trackLayer.ts`): background, road, boundaries, gates and start pose are drawn onto a separate canvas at the drawing-buffer size. Each frame only copies it with `drawImage`. It is redrawn only when the track or the viewport (CSS size, buffer size or pixel ratio) changes.
- During fast training draw only the best few cars, or none, and update the dashboard a few times per second.

## Performance plan

1. Measure first: FPS and the average simulation step time on the dashboard (debug panel).
2. Cache the static track layer.
3. Skip rendering in accelerated training.
4. Move training into a Web Worker only if measurements show the UI stutters (roadmap P5-06).

## Evaluation, replay and recovery boundaries

- P2-10 supplies versioned built-in track splits before the editor. P2-07 records raw episode/generation data and complete resolved configurations; the Phase 3 dashboard reads these records rather than defining metrics independently.
- P3-08 provides initial saved-model inspection and comparison in Phase 3. P5-05 adds repeated multi-track evaluation, spread and statistical comparisons.
- ST5 is simultaneous human-versus-AI racing with non-colliding cars, identical physics/start conditions and separate wall-collision/lap results. Car-car contact, overtaking and avoidance stay in R-01/R-02.
- A champion replay needs its frozen parameters, track version, simulation configuration and initial conditions. It cannot resume a whole evolutionary population.
- A generation-boundary training checkpoint additionally needs population genomes, champion, completed generation and next-generation index, metrics, resolved configuration, track versions and every PRNG stream's state, including a cached Gaussian sample if applicable. Version and validate this separate checkpoint format in P3-07; defer mid-episode snapshots. Compare resumed and uninterrupted runs at the same boundary.
- Use bounded training batches so UI events can run. Tab hiding pauses and clears elapsed-time accumulation; do not rely on a final background write, since iOS may terminate a tab without delivering it. Persist checkpoints at generation boundaries when enabled and offer file export if storage is unavailable.

## Open questions

- Which PRNG: mulberry32 (tiny) or sfc32 (better statistics)? Decide in P1-03 and document it.
- Whether the vehicle model needs lateral slip for braking to matter. Check this in P2-09 before the braking study.
