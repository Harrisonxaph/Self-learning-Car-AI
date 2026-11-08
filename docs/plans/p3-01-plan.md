# P3-01 plan: training dashboard metrics

> **Status: implemented and merged in [#124](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/124), authorised by the owner on #21. P3-01 stays In Review until the owner's device checks are recorded.**
> - **Authorisation:** [preparation of this plan only](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/21#issuecomment-6713504223), using the [owner-approved scope](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/21#issuecomment-6713339826). Both are relayed owner instructions on #21.
> - **Scope change (owner-approved):** fitness and the rates are shown for the **last completed generation** only. The current generation shows live counts. The ROADMAP entry and issue #21 are reconciled to this in the same PR as this plan.
> - **Design choices (owner, relayed):** the [four live counts and the crash-only collision rate](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/21#issuecomment-6713705745) in §4 are owner-specified, and the existing TESTING.md requirements are retained (§6). The owner's [criterion clarification](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/21#issuecomment-6713856759) (§6.1): P3-01 completion does not require the FPS and step-time instrumentation, which stays in P3-07.
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
- **`src/ui/trainingPage.ts`:** `trainer.step()` returns the `GenerationStats` of a generation when it ends (the page currently discards that return value). The page keeps the latest returned value in a local variable, and after each frame's ticks it calls the dashboard with `trainer.generation()` and that cached value. The dashboard path never calls `trainer.record()`, which copies the whole history array on every call. The page also exposes the same values as canvas data attributes for the E2E tests. **No change** to the trainer, fitness, evolution, records or simulation. That training output stays identical to a headless run is established by the extended harness in §5, which runs the real dashboard update; the existing check in `tests/training/trainer.test.ts` does not exercise the dashboard and is not claimed to cover it.
- **`index.html`:** a `<dl class="hud training-dashboard" hidden>` with two labelled groups, "This generation" and "Last completed generation". It is shown only in training mode. It is not an `aria-live` region, because its values change every frame. The existing status line stays the polite live region.
- **Cost of the dashboard path:** O(population) per rendered frame. `liveCounts` is one pass over the 50 cars, and `completedMetrics` reads the cached stats object in O(1). Because the dashboard never reads `trainer.record()`, its cost does not grow with the number of completed generations, and it adds no per-tick work (nothing runs in the simulation step). The claim covers the dashboard only: the page's existing per-frame `trainer.record().generations.length` read for the `completedGenerations` attribute (`src/ui/trainingPage.ts`, near line 70) is a pre-existing O(history) read that P3-01 leaves unchanged and does not claim to bound.
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
- **Non-interference (integration), `tests/training/trainer.test.ts` extended, or an equivalent page-level harness that drives `startTrainingPage` with a fake frame clock:** every rendered frame executes the real dashboard path, meaning `liveCounts`, `completedMetrics` on the cached stats, and the render into the DOM, with the inputs the page passes. The test compares the complete resulting `trainer.record()` (configuration, versions, every `GenerationStats` including the fitness arrays, outcomes and champion genomes) with the same seeded headless run, across several render schedules (for example 1, 3 and 7 ticks per frame, including a frame that spans a generation boundary). This is the check that the dashboard cannot change training results.
- **Existing tests:** the existing rendered-equals-headless check and the determinism and golden suites stay as regression checks. They do not call the dashboard, so they are **not** claimed to show non-interference. Lint boundary tests cover the new modules.

## 6. Mobile and accessibility acceptance

- **Emulated (CI):** the six Playwright projects in §5.
- **Owner device checks (iPhone 15 and iPad Pro, Safari, `?mode=train`), recorded in the PR or listed as outstanding:**
  1. The dashboard is readable without zoom, in portrait and landscape.
  2. It does not hide most of the track, and the cars stay visible.
  3. Values update as generations complete.
  4. After rotation and after an app switch, it still lines up and updates.
- **Accessibility:** text at the HUD's existing size, enough contrast, values in `<output>` elements with `<dt>` labels, no new controls (so no new touch targets), and no animation (`prefers-reduced-motion` is not affected).
- **TESTING.md requirements are retained** (owner instruction, [#21](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/21#issuecomment-6713705745)). How they apply to P3-01:
  - **Training view checks** (the P2-05 list in "Mobile and device checks", and the tab-switch or lock-screen check): apply unchanged. The dashboard changes the `?mode=train` layout, so the implementation PR asks for them again on iPhone and iPad with the dashboard visible, and records the results or lists them as outstanding. The four dashboard checks above are added to that section.
  - **Low-power check:** see §6.1. Its responsiveness part applies to P3-01. Its frame-rate and step-time figures belong to P3-07.

### 6.1 P3-01 completion criteria and performance checks (owner clarification, [#21](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/21#issuecomment-6713856759))

**The clarification.** P3-01 completion requires its mobile readability, responsiveness and regression checks. It does **not** require the FPS and simulation-step-time instrumentation, which stays assigned to P3-07 (debug panel with FPS and mean step time; acceptance: metrics visible on a named device and browser). P3-01 neither provides those readouts nor claims any FPS or step-time figure. The P3-07 requirement is unchanged and is restated in its ROADMAP entry.

**Performance checks that still apply to P3-01, and how each is measured:**

| # | Check | How it is measured or recorded | Where | Gate? |
| --- | --- | --- | --- | --- |
| 1 | The dashboard is updated at most once per rendered frame, never once per tick, and reads no training history | Unit test: drive the page loop with a spy on the dashboard update across a frame that runs several ticks, and assert one call per frame while the trainer advanced several ticks. In the same harness, spy on `trainer.record` and assert the dashboard path adds no call to it (the count with the dashboard enabled equals the count with it disabled), so its inputs are the live generation and the cached stats only | `tests/ui/trainingPage.test.ts` or `tests/ui/trainingDashboard.test.ts` | Yes (CI) |
| 2 | Unchanged values do not rewrite the DOM | Unit test: update twice with equal values and count DOM mutations (a `MutationObserver` in the DOM test environment, or counted writes) | `tests/ui/trainingDashboard.test.ts` | Yes (CI) |
| 3 | The dashboard does not change training results | The extended non-interference harness (§5) runs the real dashboard update each rendered frame and compares the full trainer record with the same seeded headless run across render schedules. The existing determinism, golden and rendered-equals-headless suites also keep passing as regression checks; they do not exercise the dashboard | `tests/training/trainer.test.ts` (extended) or a page-level harness, plus the existing suites | Yes (CI) |
| 4 | `?mode=train` keeps advancing generations with the dashboard visible, on all six emulated projects | E2E: the generation counter and the last-completed group change over a bounded wait. This shows functional responsiveness, not a frame rate | `tests/e2e/training.spec.ts` | Yes (CI) |
| 5 | The page stays responsive on a real iPhone and iPad with the dashboard visible, and in low-power mode | Owner observation, recorded per device: model, OS and browser, render mode, population, whether taps and rotation respond and generations keep advancing, and whether the track and cars stay visible. It is an observation, **not a measurement** | PR description or issue comment | Yes (recorded, or listed as outstanding if no device) |
| 6 | Dashboard update cost per frame | Informational only: a one-off measurement with `performance.now()` around the update call in the test harness, population 50, reporting the mean and p95 over a stated number of frames and naming the machine. It is not shipped and is not the P3-07 readout. It sets no threshold | Implementation PR description | No |

**What is not claimed.** No FPS or simulation-step-time figure is available to P3-01, so none is reported as passed. Where TESTING.md's low-power check asks for those figures, the implementation PR states "FPS and step time not measured (P3-07)". Check 6 is a harness timing of one function on named hardware, not a frame rate and not evidence that low-power devices are fast enough. Checks 1 to 4 run in CI, where WebKit and Chromium are emulation, not hardware, so they do not replace check 5.

**TESTING.md wording** changes in this PR so it does not contradict the clarification. See §8.

## 7. Out of scope

- Graphs or history (P3-02, ST2).
- Speed controls or headless mode in the page (P3-03).
- Replay (P3-04).
- Saving (P3-05, P3-06).
- Performance readouts (P3-07).
- Any change to training, fitness or evolution.

## 8. Implementation steps (each needs owner authorisation)

1. **This plan**, with the ROADMAP and #21 reconciled. Documentation only.
2. **Implementation PR (`feat/p3-01-dashboard`):** §3, §5 and §6.1, ARCHITECTURE.md and TESTING.md updates (the four dashboard device checks added to the training-view list), all required checks run, and Codex review. Owner device checks recorded or listed as outstanding (P3-01 stays In Review until they are recorded).

The plan PR (#122) itself makes the `docs/TESTING.md` wording change for the clarification (documentation only), so TESTING.md does not contradict it: the low-power line becomes "with the dashboard visible and the device in low-power mode, `?mode=train` stays responsive; frame rate and step time are read from the P3-07 debug panel once it exists, and are reported as not measured until then", and the closing sentence of "Mobile and device checks" says the responsiveness part applies from P3-01 and the readouts wait for P3-07.

## 9. Open questions for the owner

**Resolved by the owner** ([relayed on #21](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/21#issuecomment-6713705745)):

1. "Finished" means outcome `completed` or `timeout`. Running is outcome `null`, crashed is `crashed` and stalled is `stalled`. The four counts are mutually exclusive and sum to the population size. The collision rate counts crashes only.
2. The existing TESTING.md requirements are retained. They are not moved or waived without an explicit criterion change.

3. FPS and simulation-step-time readouts stay in P3-07. P3-01 completion requires its mobile readability, responsiveness and regression checks, not that instrumentation (§6.1). The owner authorised this as a focused criterion clarification in this PR ([relayed on #21](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/21#issuecomment-6713856759)), with Codex review before implementation.

**No decision is open for the owner in this plan.** The next owner gates are the merges of #121 and then this PR, and a separate authorisation to implement.
