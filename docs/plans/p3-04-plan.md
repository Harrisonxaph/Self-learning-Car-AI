# P3-04 plan: champion replay with sensor and decision overlay

> **Status: plan only, for Codex review and the owner's merge. Implementation needs its own owner authorisation.**
> - **Authorisation:** [the owner's "Continue with development plan"](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/24#issuecomment-6724621274), read as the next roadmap step (P3-04), starting with this plan. The owner may reorder (P3-05 is P0 and also unblocked) or correct this reading.
> - **Scope:** the roadmap entry and issue #24. No saving (P3-05, P3-06), no model comparison (P3-08), no step-time or FPS work (P3-07).

## 1. What P3-04 must deliver (ROADMAP, issue #24)

- Replay the best car of any recorded generation on its track, showing the rays, the 9 network inputs and the steering, throttle and brake outputs each tick.
- **Acceptance:** the replay is identical to the original evaluation (same events and lap time), and the inputs and outputs shown match the inference values.
- **Tests:** an integration test of replay determinism, and an E2E test of the replay controls.

## 2. What already exists (inspected at `main` `db26c68`)

| Need | What exists | Where | Gap |
| --- | --- | --- | --- |
| The champion of every generation | `GenerationStats.champion` (a copy of the genome, 159 numbers) and `championIndex`, kept for each completed generation. | `src/training/trainer.ts:128` | none: nothing new needs to be stored |
| One car's episode, one tick at a time | `startCar` / `stepCar` / `stepEpisode`, the single path shared by the trainer and the headless evaluations. `evaluateGenome` runs one genome alone. | `src/training/trainer.ts:236`, `src/training/episodeStep.ts` | none |
| Inputs and outputs | `buildInputs` (9 inputs) and `runNetwork` (steering, throttle, brake), called inside `stepCar`. | `src/ai/inputs.ts:81`, `src/ai/network.ts:115` | the values are used but not exposed per tick |
| Ray drawing | `drawSensors`, used by the manual-driving `?debug=rays` layer. | `src/render/sensorView.ts:26` | reusable as is |
| Events and lap time | `Episode` outcome, `lapTicks` in the racer's progress; `lapSeconds` converts ticks. | `src/sim/checkpoints.ts`, `src/training/fitness.ts` | none |
| Page | `?mode=train` with the controls, dashboard and collapsible graph. | `src/ui/trainingPage.ts` | no replay |

## 3. Architecture

- **`src/training/championReplay.ts` (new, headless, no DOM).** `createChampionReplay(genome, setup)` returns an object with `step()`, which advances one fixed tick through the same `stepEpisode` as the trainer and returns a **tick frame**: `{ tick, racer, episode, inputs, controls, readings }`. The inputs and controls are **captured inside the `decide` callback that drives the physics**, so what is shown is by construction the very values that drove the car, not a recomputation. The ray `readings` (for drawing) come from `castRays` on the same racer state, read only. A finished episode is returned unchanged, as in `stepCar`. It adds no randomness and changes no trainer code.
- **`src/ui/trainingSession`** (the existing dashboard session in `trainingDashboard.ts`) already receives each `GenerationStats`; it also keeps a reference to each (no copy, so no growth beyond the champion arrays the trainer already holds) so the page can look a champion up by generation number without calling `trainer.record()`, which copies the whole history.
- **`src/ui/championReplay` (new view model + rendering).** A collapsible "Champion replay" block under the graph, closed by default, like the graph:
  - a **generation** number field (1 to the number of completed generations, default the latest), a **Replay / Stop** button and **Back to training**;
  - while a replay is open, training is paused (the trainer is not stepped, exactly like the existing pause) and **only the replayed car is drawn, with its rays and hit markers**, on the same track layer; Back to training resumes the run unchanged;
  - the 9 inputs listed by `INPUT_NAMES` and the 3 outputs, as labelled text with a small bar each, tick and elapsed simulated time, and at the end the outcome, gates passed and lap time(s) in seconds;
  - the replay is real time at 1× on the fixed-step clock and can be restarted; hidden-tab auto-pause applies as everywhere else.
- **Accessibility and mobile:** targets of at least 44 CSS px, labelled controls, the values are plain text and **not** a live region (updates would be read out every frame); one polite sentence announces the replay outcome. The block is collapsed by default so the track keeps its space, and a layout test covers it open in portrait and short landscape (the graph's rules are the model).
- **Cost:** one car and one set of rays per frame during a replay, with the trainer idle, so cheaper than training. No work when closed.

## 4. Why a solo replay equals the original evaluation

Cars in a generation are independent (Option A: no interaction, each with its own racer and episode), and `stepCar` reads only the car and the setup. So the champion alone, from the same start pose and the same genome, takes exactly the same path as in the population. This is **tested**, not assumed (§5).

## 5. Tests

- **Determinism (integration, seeded):** for several seeds and generations, the replay of `stats.champion` ends with an episode equal to `evaluateGenome(champion)`; its fitness equals the recorded `bestFitness`; its ticks, outcome, gates passed and lap ticks equal the champion car's in the population run.
- **Tick by tick:** run a generation in the trainer, recording the champion car's racer state at every tick; the replay's racer state matches at every tick, not only the end.
- **Inputs and outputs match inference:** at every replay tick, the captured inputs equal a fresh `buildInputs` on that state, and the captured controls equal a fresh `runNetwork` on those inputs; the ray readings agree with inputs 0 to 6.
- **Mutation-style checks:** a replay that uses another genome, skips a tick, or recomputes inputs from a different state, fails.
- **Page wiring (Node, fake DOM and frames):** opening replay pauses training and does not change the trained statistics afterwards (identical to a run without a replay); the generation field is clamped; Stop and Back to training restore the run; the draw shows one car.
- **E2E (Chromium and WebKit, desktop, phone, tablet; fake clock):** replay controls work after the first generation completes; the readouts change as the replay runs; the outcome appears; the layout holds open in portrait and landscape.
- Not tested: a physical device (owner checks below).

## 6. Owner checks (iPhone and iPad, before a merge request)

1. The block opens and closes with a tap, is readable without zoom in both orientations, and the track stays usable.
2. Replaying the latest generation shows a single car with its rays, inputs and outputs updating, and ends with an outcome.
3. Picking an earlier generation works; Back to training resumes the run.
4. Rotation and an app switch mid-replay leave the page working.

## 7. Routine design choices (owner may change any)

Training pauses while a replay is open; replay is 1× only with Restart (no scrubbing); the generation is chosen by number; the layout and labels as above; only the final-generation-style champion definition already recorded (`best-training-fitness`, ties to the lower index) is replayed.

## 8. Limits

A replay shows what a champion did on the **training track** under the training conditions. It is not an evaluation of generalisation, makes no claim that a network "learned" anything, and uses no saved model (P3-05).
