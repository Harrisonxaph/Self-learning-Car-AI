# Architecture

> Status: **mostly planned**. P1-01 adds only the project foundation: `src/main.ts`, `src/render/viewport.ts` (canvas sizing) and `src/render/placeholder.ts` (start-up screen). Everything else below is the target design for later tasks. Update this document when the code shows a better design.

## Goals that shape the design

- **Reproducible**: the same seed and configuration produce the same run in the same JavaScript engine.
- **Headless-capable**: simulation, sensors, inference and evolution run without a DOM, so they can be unit-tested in Node and trained faster than real time.
- **Observable**: every number the AI sees and every decision it makes can be shown on screen.
- **Small and beginner-readable**: plain TypeScript modules with pure functions where practical, and no framework until one is needed.

## Module layout

```
src/
  main.ts                 entry point: wires UI, loop and renderer
  sim/                    pure simulation, no DOM
    config.ts             fixed timestep, physics constants
    vehicle.ts            car state and physics step
    track.ts              track geometry types and helpers
    collision.ts          car–boundary intersection
    checkpoints.ts        ordered gates, lap counting, lap timing
    world.ts              steps every car once per tick
  sensors/
    rays.ts               7 ray casts → normalised distances
  ai/                     inference only, no evolution imports
    network.ts            feedforward net (9-12-3), forward pass
    inputs.ts             builds the 9-value input vector
    outputs.ts            maps raw outputs → steering, throttle, brake
    drivers.ts            Driver interface: neural, random, rule-based, human
  evolution/              genomes and genetic operators, no DOM
    genome.ts             flat Float64Array of weights and biases
    selection.ts          tournament selection
    crossover.ts          uniform or arithmetic crossover
    mutation.ts           Gaussian mutation with rate and scale
    population.ts         next-generation builder with elitism
  training/
    fitness.ts            fitness and termination rules (anti-exploitation)
    trainer.ts            generation loop; headless or rendered
    experiment.ts         experiment config, seeds, result records
    stats.ts              per-generation statistics
  persistence/
    modelFormat.ts        types and validation for saved models
    modelStore.ts         localStorage + JSON import/export
    trackStore.ts         custom track save/load
  render/                 Canvas 2D only; reads state, never mutates it
    renderer.ts
    layers/               track, cars, sensors, overlays
  ui/                     DOM controls, dashboard, editor
    controls/             touch and keyboard input
    dashboard/            stats, fitness graph
    editor/               track editor
  utils/
    rng.ts                seeded PRNG (e.g. mulberry32 or sfc32)
    math.ts               vectors, angles, segment intersection
  data/
    tracks/               built-in training, validation and held-out tracks (JSON)
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

- Fixed timestep `DT = 1/60 s` (in `sim/config.ts`).
- Rendered mode: an accumulator collects real elapsed time and runs `world.step(DT)` as many times as needed, capped (for example 5 steps per frame) so a slow device slows down instead of spiralling. Render once per animation frame and interpolate if needed.
- Headless/accelerated mode: run N ticks per batch (for example inside `setTimeout` slices or a Web Worker) without drawing, then hand a snapshot to the renderer every few hundred milliseconds.
- On `visibilitychange` to hidden, pause and drop the accumulated time so iOS Safari does not cause a large catch-up jump on return.

## Vehicle model

A simple kinematic-bicycle-style model is enough for this project:

- State: position, heading, forward speed (and optionally lateral velocity for a little slide).
- Controls per tick: `steering ∈ [-1, 1]`, `throttle ∈ [0, 1]`, `brake ∈ [0, 1]`.
- Acceleration = throttle × engine force − brake × brake force − drag × speed² − rolling resistance × speed.
- Bicycle-model yaw rate is zero at zero forward speed, so cars cannot pivot on the spot. Limit wheel angle as speed rises for stability; do not confuse wheel-angle limits with yaw rate.
- Speed never goes negative from braking (no reverse in the first version). Document any change.

All constants live in `sim/config.ts` and are recorded with every experiment and saved model.

## Track, collision and checkpoints

- A track is two closed polylines (inner and outer boundary), a start pose and an ordered list of checkpoint gates (segments across the road).
- Collision: test the car footprint against the drivable region, including containment and boundary contacts; use swept checks or sufficient deterministic substeps to prevent tunnelling at the configured maximum speed. Edge intersections alone miss an entirely off-road footprint. On collision the car stops and is marked crashed; manual mode exposes an explicit restart.
- Checkpoints: only the **next** gate in order counts, crossed in the forward direction. Crossing gate 0 after all others completes a lap. This blocks reward from crossing the same gate back and forth.

## Sensors and network inputs

Seven rays fanned across the car's front (for example −90°, −60°, −30°, 0°, 30°, 60°, 90° relative to heading), each with maximum length `RAY_LENGTH`. Inputs (all scaled to roughly [0, 1] or [−1, 1]):

| # | Input | Range |
|---|-------|-------|
| 0–6 | ray hit distance ÷ `RAY_LENGTH` (1 = nothing hit) | 0 to 1 |
| 7 | forward speed ÷ `MAX_SPEED` | 0 to 1 |
| 8 | signed angle from car heading to the next checkpoint's centre ÷ π | −1 to 1 |

## Network

- Fully connected feedforward: 9 inputs → 12 hidden (`tanh`) → 3 outputs.
- Outputs: `steering = tanh(o0)`, `throttle = sigmoid(o1)`, `brake = sigmoid(o2)`.
- Parameter count: 9×12 + 12 + 12×3 + 3 = **159**.
- Weights are stored as one flat array in a documented order (see `docs/MODEL_FORMAT.md`), so evolution can work on genomes without knowing layer structure.
- "No-braking" experiments keep the same 9-12-3 shape and force `brake = 0`, so parameter counts match and only braking differs.

## Evolution

- Population of P genomes (start with P = 50, configurable).
- Each generation: evaluate every car on one selected training circuit under identical start conditions → sort by fitness → copy the top E unchanged (elitism) → fill the rest by tournament selection, crossover and Gaussian mutation. Multiple selectable circuits are required; training one evolutionary run across multiple circuits is optional R-06, not a primary-release prerequisite.
- Mutation rate, mutation scale, crossover type, population size, elitism count, max episode time and seed are all part of the experiment configuration.

## Drivers

Every car is controlled through one `Driver` interface (`decide(observation) → controls`). Implementations: `NeuralDriver`, `RandomDriver`, `RuleBasedDriver` and `HumanDriver`. This makes baselines, replay and human-vs-AI races use the same simulation path.

## Rendering and UI

- Canvas 2D, resized to the container with `devicePixelRatio` capped at 2 (`MAX_PIXEL_RATIO` in `src/render/viewport.ts`). The canvas is measured in CSS pixels and its drawing buffer is only reassigned when the size changes, because reassigning it clears the canvas. Simulation code never sees these pixel sizes.
- Layers: static track (cached to an offscreen canvas and redrawn only on resize or edit), cars, optional sensor rays and an optional champion decision overlay.
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
