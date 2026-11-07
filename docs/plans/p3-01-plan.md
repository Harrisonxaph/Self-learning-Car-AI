# P3-01 plan: training dashboard metrics

> **Status: plan only. Implementation is not authorised.**
> - **Authorisation:** [preparation of this plan only](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/21#issuecomment-6713504223), using the [owner-approved scope](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/21#issuecomment-6713339826). Both are relayed owner instructions on #21.
> - **Scope change (owner-approved):** fitness and the rates are shown for the **last completed generation** only. The current generation shows live counts. The ROADMAP entry and issue #21 are reconciled to this in the same PR as this plan.
> - **Design choices (owner, relayed):** the [four live counts and the crash-only collision rate](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/21#issuecomment-6713705745) in §4 are owner-specified, and the existing TESTING.md requirements are retained (§6). Nothing is moved or waived without an explicit criterion change.
> - **Review:** this plan needs Codex review and the owner's merge. Implementation needs its own owner authorisation.

## 1. What P3-01 must deliver (ROADMAP, issue #21, as reconciled)

- **Current generation (live):** the generation number and counts of running, crashed, stalled and finished cars.
- **Last completed generation:** best fitness, mean fitness, crash rate and lap-completion rate, with stalls shown separately from crashes.
- **Acceptance:** the last-completed values match the trainer's recorded `GenerationStats`, and the panel is readable on iPhone.
- **Tests:** a unit test for the stats aggregation, and an E2E test that the dashboard updates during training.

## 2. What already exists (inspected at `main` `0ed3811`)

| Need | What exists | Where | Gap |
| --- | --- | --- | --- |
| Recorded per-generation stats | `GenerationStats`: `generation`, `bestFitness`, `meanFitness`, `worstFitness`, `outcomes` (completed, crashed, stalled, timeout), `carsWithLap`, `maxGatesPassed`. Returned by `trainer.step()` when a generation ends, and kept in `trainer.record().generations`. | `src/training/trainer.ts:128` | none |
| Live per-car state | `trainer.generation()` gives `index`, `tick` and the cars, each with `episode.outcome` (`null` while running). | `src/training/trainer.ts:119`, `src/training/fitness.ts:102` | none |
| Training page | `?mode=train` runs the trainer under the frame loop and writes one status line (`trainingStatus`) and canvas data attributes. | `src/ui/trainingPage.ts` | **yes**: no metrics panel |
| Panel styling | The manual-driving HUD is a `<dl class="hud">`. It is hidden in training mode. | `index.html:13` | reuse the style |
| Tests | `trainingStatus` unit test; E2E `?mode=train` advances generations in six Chromium/WebKit desktop, phone and tablet projects. | `tests/ui/trainingPage.test.ts`, `tests/e2e/training.spec.ts` | extend both |

## 3. Architecture

- **`src/training/generationMetrics.ts` (new, headless, no DOM).** Two pure functions:
  - `liveCounts(generation: Generation)` returns `{ generation, running, crashed, stalled, finished, population }`.
  - `completedMetrics(stats: GenerationStats | null, population: number)` returns `null` before the first completed generation. Otherwise it returns `{ generation, bestFitness, meanFitness, crashRate, lapCompletionRate, stalled, stallRate }`.

  The module lives in `training` so it can be tested headless. The `training → ui/render` boundary already forbids DOM imports there.
- **`src/ui/trainingDashboard.ts` (new).** It only formats and renders: number formatting, the placeholder before the first generation, and writing `<output>` elements. It changes text only when a value changes, like the status line. It reads the trainer and never drives it.
- **`src/ui/trainingPage.ts`:** after each frame's ticks, calls the dashboard with `trainer.generation()` and the last entry of `trainer.record().generations`. It also exposes the same values as canvas data attributes for the E2E tests. **No change** to the trainer, fitness, evolution, records or simulation, so training output stays identical to a headless run (the existing check in `tests/training/trainer.test.ts` keeps covering this).
- **`index.html`:** a `<dl class="hud training-dashboard" hidden>` with two labelled groups, "This generation" and "Last completed generation". It is shown only in training mode. It is not an `aria-live` region, because its values change every frame. The existing status line stays the polite live region.
- **Cost:** O(population) per rendered frame (50 cars) and no allocation per tick. Nothing runs in the simulation step.
- **ARCHITECTURE.md:** updated in the implementation PR (the module list and "Rendered (`?mode=train`)").

## 4. Metric definitions

P is the population size (`generation.cars.length`; 50 by default).

**Current generation (live; changes during the generation):**

| Metric | Definition |
| --- | --- |
| Generation | `generation.index + 1` (shown from 1, as the status line does) |
| Running | cars with `episode.outcome === null` |
| Crashed | cars with outcome `crashed` |
| Stalled | cars with outcome `stalled` |
| Finished | cars with outcome `completed` or `timeout` (ended without crash or stall) |

These four definitions are the owner's ([relayed on #21](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/21#issuecomment-6713705745)). Every car's `episode.outcome` is exactly one of `null`, `crashed`, `stalled`, `completed` or `timeout`, so the four counts are mutually exclusive and always sum to P (tested). Running fitness is **not** shown for the current generation, because it is incomplete until the generation ends.

**Last completed generation (from `GenerationStats`, unchanged):**

| Metric | Definition | Display |
| --- | --- | --- |
| Generation | `stats.generation + 1` | integer |
| Best fitness | `stats.bestFitness` | 2 decimals |
| Mean fitness | `stats.meanFitness` | 2 decimals |
| Crash rate (the collision rate) | `stats.outcomes.crashed / P`: crashes only, stalls excluded | % to 1 decimal, with the count (e.g. "62.0% (31/50)") |
| Stalls | `stats.outcomes.stalled`, with `stalled / P` | separate row, count and % |
| Lap-completion rate | `stats.carsWithLap / P` (cars that completed at least one valid lap) | % to 1 decimal, with the count |

Before the first generation completes, every last-completed value shows "—", with the note "No generation completed yet".

**Wording:** labels say "fitness", "crashed" and "completed a lap". The panel makes no learning, skill or improvement claim, and has no trend arrows (AGENTS.md "Scientific honesty", AI_EVALUATION.md). Graphs and history are P3-02 (ST2).

## 5. Tests (added in the implementation PR)

- **Unit, `tests/training/generationMetrics.test.ts`:**
  - `liveCounts` on hand-built generations covering every outcome: the counts partition P, and stalled is never counted as crashed.
  - `completedMetrics(null)` returns `null`.
  - **Matches the recorded stats** (the acceptance criterion): a seeded small trainer run (small P and episode limits) for several generations. For each `GenerationStats` returned by `step()`, `completedMetrics` equals values recomputed independently from that generation's per-car finished episodes (`trainer.finished()`). Best and mean fitness are compared exactly with the recorded stats.
  - Determinism: same seed, same metrics.
- **Unit, `tests/ui/trainingDashboard.test.ts`:** formatting (decimals, percentage with count, the placeholder), and that unchanged values do not rewrite the DOM.
- **E2E, `tests/e2e/training.spec.ts` (all six projects):**
  - On `?mode=train` the dashboard is visible and the manual HUD is hidden.
  - The live counts sum to 50 and running falls during generation 1.
  - The last-completed group shows "—" until the first generation completes, then shows generation 1 values that equal the data attributes the page exposes from `GenerationStats`. After a later generation they update.
  - On the phone and tablet projects, the panel is inside the viewport in portrait and landscape, without page scroll.
- **Existing tests:** the rendered-equals-headless check and the full suites keep passing. Lint boundary tests cover the new modules.

## 6. Mobile and accessibility acceptance

- **Emulated (CI):** the six Playwright projects in §5.
- **Owner device checks (iPhone 15 and iPad Pro, Safari, `?mode=train`), recorded in the PR or listed as outstanding:**
  1. The dashboard is readable without zoom, in portrait and landscape.
  2. It does not hide most of the track, and the cars stay visible.
  3. Values update as generations complete.
  4. After rotation and after an app switch, it still lines up and updates.
- **Accessibility:** text at the HUD's existing size, enough contrast, values in `<output>` elements with `<dt>` labels, no new controls (so no new touch targets), and no animation (`prefers-reduced-motion` is not affected).
- **TESTING.md requirements are retained, and nothing is moved or waived** (owner instruction, [#21](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/21#issuecomment-6713705745)). How they apply to P3-01:
  - **Training view checks** (the P2-05 list in "Mobile and device checks", and the tab-switch or lock-screen check): apply unchanged. The dashboard changes the `?mode=train` layout, so the implementation PR asks for them again on iPhone and iPad with the dashboard visible, and records the results or lists them as outstanding. The four dashboard checks above are added to that section.
  - **Low-power check** ("frame rate and step time on the dashboard stay usable"): TESTING.md says it waits for the dashboard, so P3-01 is the first change where it can apply. The "stay usable" part applies: with the dashboard visible on a device in low-power mode, the owner records whether `?mode=train` stays responsive. The "frame rate and step time **on the dashboard**" part cannot be met by P3-01 as scoped, because the approved scope has no such readouts. That part is recorded as **outstanding, neither passed nor waived**, and P3-01 stays In Review while it is outstanding (AGENTS.md gate 3 allows an outstanding check to be recorded). Closing it needs an explicit owner criterion change (§9).
  - **Informational measurement, not a gate:** the implementation PR reports the measured dashboard update cost per frame, labelled informational. It sets no threshold and does not stand in for the low-power check.

## 7. Out of scope

- Graphs or history (P3-02, ST2).
- Speed controls or headless mode in the page (P3-03).
- Replay (P3-04).
- Saving (P3-05, P3-06).
- Performance readouts (P3-07).
- Any change to training, fitness or evolution.

## 8. Implementation steps (each needs owner authorisation)

1. **This plan**, with the ROADMAP and #21 reconciled. Documentation only.
2. **Implementation PR (`feat/p3-01-dashboard`):** §3 and §5, ARCHITECTURE.md and TESTING.md updates, all required checks run, and Codex review. Owner device checks recorded or listed as outstanding (P3-01 stays In Review until they are recorded).

## 9. Open questions for the owner

**Resolved by the owner** ([relayed on #21](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/21#issuecomment-6713705745)):

1. "Finished" means outcome `completed` or `timeout`. Running is outcome `null`, crashed is `crashed` and stalled is `stalled`. The four counts are mutually exclusive and sum to the population size. The collision rate counts crashes only.
2. The existing TESTING.md requirements are retained. They are not moved or waived without an explicit criterion change.

**Decision still open for the owner (needed before P3-01 can be marked Complete, not before implementation starts):** the readout part of the low-power check (§6) cannot be met by P3-01's approved scope. Options:
- (a) leave it outstanding until P3-07 supplies frame-rate and step-time readouts (this plan assumes (a));
- (b) an explicit criterion change that adds the readouts to P3-01;
- (c) an explicit criterion change to the check's wording in TESTING.md.

This plan changes none of the three. It also does not change TESTING.md itself.
