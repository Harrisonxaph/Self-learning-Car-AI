# P5-05 plan: model comparison dashboard

> **Status: plan only, for Codex review and the owner's merge. Implementation needs its own owner authorisation.**
> - **Authorisation:** the owner's "P5" (2026-11-14, a correction of an earlier "p6" typo: "Sorry it was a typo, I meant p5!"), read as starting Phase 5 with the next item whose dependencies are met and which needs no owner-run study. P5-05 (needs P4-05 and P3-08, both Complete) is independent of the E3 study; P5-01's run and P5-02/P5-04 wait on the owner's Node 24 environment and manifest-hash go-ahead (issue #33). This reading authorises a **plan only**. The owner may reorder or correct it.
> - **Scope:** the roadmap entry and issue #37. **Not** in scope: running evaluations from the comparison (the evaluate page does that), the held-out boundary (never touched), more than two models, a statistical test or confidence interval (section 4), saving or sharing a comparison, any ranking verdict, any claim about learning or generalisation.
> - **Lessons carried from P3-08, P4-05 and P5-03:** validate everything read (a damaged save is reported, never compared), a hostile entry is a message and never an exception, ranking only under matching conditions with every reason listed, no new storage and no format change, test through the whole page, state what is **not** claimed.

## 1. What P5-05 must deliver (ROADMAP, issue #37)

- **Description:** extend the P3-08 comparison to repeated multi-track evaluation: saved models side by side on shared evaluation tracks and seeds; refuse or warn when tracks, fitness version or physics differ.
- **Acceptance:** the comparison shows **lap completion, collisions, lap time and spread**; mismatched conditions are warned.
- **Tests:** unit: compatibility rules. E2E: compare two imported models.

## 2. What already exists (inspected at `main` `562d4b1`)

| Need | What exists | Where | Gap |
| --- | --- | --- | --- |
| Two validated models side by side, fitness ranked only under matching conditions, every reason listed | `compareModels`, `FITNESS_CAVEAT`, `renderComparison`, pair replay | `src/persistence/modelCompare.ts`, `src/ui/compareView.ts`, `src/training/pairReplay.ts` | shows only the **count** of evaluation entries (`evaluationPresent`), never their content |
| Recorded evaluations per model, per circuit | `EvaluationEntry` (rows for the nominal start and perturbed seeds 1 to 4, `summary` with `lapCompletion`, `collisionRate`, `meanFirstLapSeconds` and its sample size, `track` id, version, split and content hash, `configHash`, `fitnessVersion`, `timestepSeconds`, `frozenModelId`, `brakeEnabled`) | `src/persistence/evaluationEntry.ts` | no code reads two models' entries together |
| Recognise only valid entries of this app, keep the rest untouched | `recogniseEvaluations(evaluation, context)`, `validateEvaluationEntry`; context from `entryContext(model, custom)` (registry, `belongsTo`, saved custom tracks) | `evaluationEntry.ts`, `src/ui/modelEvaluation.ts` | reuse as is |
| Circuits evaluable | built-in training and validation circuits and the person's saved custom tracks; **held-out refused before any episode** | `modelEvaluation.ts` (`resolveCircuit`) | nothing to add: entries never name a held-out circuit |
| Which physics an entry was run under | **the model's own recorded physics** (`startEvaluationJob` uses `{ ...DEFAULT_VEHICLE_PHYSICS, ...configuration.physics }`); the entry records the timestep but **not** the physics | `modelEvaluation.ts` | physics comparability must come from the two models, not from the entries |
| Where the comparison lives | the Saved champions section on `?mode=train`: "Compare two saved champions" | `trainingPage.ts`, `compareView.ts` | one extra block under the existing table |

## 3. Design

- **`src/persistence/evaluationCompare.ts` (new, pure; imports only `evaluationEntry` and `modelFormat`).** `compareEvaluations(a, b, recognisedA, recognisedB) → EvaluationComparison`, given two validated models and each model's recognised entries (the caller runs `recogniseEvaluations` with `entryContext`, so hostile entries are already opaque). It never throws and never reads an entry the validator did not accept.
  - **One entry per circuit per model:** the **most recent** recognised entry per `track.id` (by `recordedAt`, ties by array position); the count of older entries ignored is reported, never silently dropped.
  - **Circuits compared:** the circuits **both** models have an entry for. A circuit only one model was evaluated on is listed as "evaluated on A only" or "B only", with no numbers for the missing side (never zero).
  - **Per-circuit compatibility** (every reason listed, as in P3-08): the same track id, version and content hash; the same `configHash` (episode limit, stall limit, laps, fitness version, timestep); the same recorded starts (seed, offsets, pose, so the same scenarios); and the **two models' vehicle physics equal** (taken from `compareModels`' physics reasons, because entries do not record physics). Brake setting differences are shown (a no-brake model is a different driver, not a different test) and do not block comparison.
  - **Shown per compatible circuit, both models side by side, with A minus B:** lap completion, collision rate (with the four outcome counts), mean first-lap seconds **with its sample size** (`null` and "no lap completed" when none; never zero), mean ordered progress, and **spread across the five starts**: the minimum, maximum and population standard deviation of first-lap seconds (over the starts that completed a lap, n shown) and of ordered progress (over all five). **Spread means variation of one deterministic model across its fixed start perturbations, not sampling uncertainty** (section 4).
  - **Incompatible circuits** are shown with both models' own recorded numbers labelled "not compared" and the reasons, and are **excluded from every aggregate**.
  - **Aggregate across the compatible circuits (exact rules; every aggregate shows its own circuit count and episode count):**
    - **Lap completion, collision rate and mean ordered progress** aggregate over **all** compatible circuits, for both models alike: the **unweighted mean of the per-circuit values** (each circuit counts once whatever its episode count; every circuit has the same five starts, so the episode counts are equal), shown as "mean over N circuits (5 starts each)". Shown only when N is at least 2; with N = 1 the single circuit's own row is the whole result and no aggregate row appears.
    - **Lap time never aggregates over a set that differs between the two models.** The aggregate lap time is shown only over the **paired set**: the compatible circuits on which **both** models completed at least one lap. Over that set each model's value is the unweighted mean of its per-circuit mean first-lap seconds, and A minus B is the difference of those two means, so the two are always taken over the **same circuits**. It is shown as "mean over M circuits where both completed a lap" with M, and **each model's total number of lap-time samples (episodes that completed a lap) on those circuits**. If M is 0 the aggregate lap time is **unavailable** ("no circuit where both models completed a lap") and says so; if M is 1 it is the single circuit's row and no aggregate row appears. A circuit where only one model completed a lap keeps its per-circuit row (that model's value, the other's "no lap completed") and is **named as excluded from the aggregate lap time**. A missing lap time is never treated as zero, never skipped on one side only, and never imputed.
    - **Spread is per circuit only and is never aggregated.** A mean of standard deviations is not a pooled spread, so no cross-circuit spread is shown. Per circuit the spread is the minimum, maximum and population standard deviation of first-lap seconds **over the starts that completed a lap, with n (0 to 5) shown** (unavailable when n is 0; the standard deviation shown as unavailable when n is 1), and of ordered progress over all five starts. The per-model sample counts differ in general and are always shown beside the values.
  - **No verdict.** Values and differences are shown; no "better", "winner" or ranking marker, even when everything matches (P3-08's fitness marker stays as it is, for training fitness only).
  - **Refuse or warn (the roadmap's wording):** warn in every mismatch case, listing the reasons, and **refuse** (a plain message, no table) only when the two models share no compatible circuit, or when either has no recognised evaluation. The message points to the Evaluate page.
- **UI (inside the existing Compare panel on `?mode=train`; no new page).** Below the P3-08 table: "Evaluations on shared circuits": a real `<table>` per circuit (scoped headers, "label, A, B, A minus B"), stacking at 320 px, with the reasons list and the one-line caveat. It is built through the same `UiFactory` as `compareView.ts`, so the same code runs against the page and against fakes in Node. It reads models through `store.load` and writes nothing.
- **No storage, format, simulation or study change.** `evaluationCompare.ts` imports no simulation, training or study module; nothing imports it except the view. A test scans for that. The held-out boundary is not touched: entries cannot name a held-out circuit (the validator refuses them) and the comparison runs no episode.

## 4. What is deliberately not claimed

An evaluation entry is **one deterministic model on one circuit from five fixed starts**. The five starts are scenario variation, not independent samples, and a model trained once is one training run: so spread here describes how stable that one model is under small start changes, **not** uncertainty about how well its method trains. No p-value, confidence interval or "significant" is shown or implied. Two saved champions are two runs of possibly different methods, so a difference between them is **not** evidence that one evolutionary setting is better, and says nothing about generalisation to held-out circuits (that is P5-04, through the preregistered study). Lap times are simulated seconds. Custom circuits are the person's own and are labelled as custom.

## 5. Tests

- **Unit (`tests/persistence/evaluationCompare.test.ts`):**
  - one-sided circuits (no numbers for the missing side, never zero) and no shared circuit (refused);
  - each incompatibility alone, with its reason: track version, track content hash, `configHash`, fitness version, timestep, recorded starts, vehicle physics (from the models);
  - several reasons at once, all listed; incompatible circuits excluded from every aggregate; the aggregate rows shown only for two or more compatible circuits;
  - **the aggregate lap time, analytically:** **disjoint completions** (A completes a lap only on X, B only on Y: M = 0, aggregate unavailable, both per-circuit rows kept and named as excluded), **one eligible circuit** (M = 1: no aggregate row, the circuit row stands), **no eligible circuit**, **several eligible circuits** with hand-computed means and A minus B over exactly the paired set, **asymmetric successful-start counts** (A completes a lap on 5 starts and B on 1 of the same circuit: each model's own n is shown and its mean uses only its own completed starts), and a check that no null is ever counted as zero or dropped from one side only;
  - the aggregate completion, collision and progress over all compatible circuits (including circuits where a model never completed), with the circuit count shown;
  - the most recent entry per circuit is used and the count of older ones reported;
  - invalid claims and other kinds never appear (the validator's refusals stay opaque); a hostile entry never throws;
  - the per-circuit spread arithmetic (min, max, population SD, n) against hand-computed rows, with n = 0 and n = 1 cases; `null` lap times stay `null`; a test that no cross-circuit spread value is produced;
  - no verdict wording anywhere in the output; no held-out, study or simulation import (source scan).
- **Page and view tests:** the new block renders through the fake factory; nothing is written to storage; a damaged save is a message.
- **E2E (`tests/e2e/training.spec.ts`):** compare two **imported** models that carry valid evaluation entries on one shared and one unshared circuit, see the matching table, the "A only" row and the warning for a physics difference. The fixture models are generated by a committed script from the real evaluator (so the entries validate), with a `--check` that regenerates and compares, as for the track files.
- **Mobile:** the owner's check of the 320 px stacking on the iPhone (owner-reported, not run by either agent); CI emulation is not physical Safari.

## 6. Decisions for the owner (defaults proposed; each routine unless changed)

1. **Spread statistic:** minimum, maximum and population standard deviation over the five starts, with n. (Alternative: range only.)
2. **Which entry:** the most recent per circuit, with the number of older entries shown. (Alternative: compare only when each model has exactly one.)
3. **Aggregate:** completion, collision and progress as the unweighted mean over all compatible circuits (N shown, at least 2); lap time only over the paired set of circuits where both models completed a lap (M shown, unavailable when M is 0); spread per circuit only. (Alternative: no aggregate at all, per-circuit rows only.)
4. **No verdict at all,** even under matching conditions. (Alternative: a per-metric "higher" marker like P3-08's fitness marker.)
5. **Refuse only when nothing is comparable,** warn otherwise. (Alternative: refuse on any mismatch.)
6. **Location:** under the existing Compare panel on `?mode=train`, not a new page.
7. **Steps** (each needs your authorisation): (1) the pure module with its unit tests; (2) the view, page wiring, the fixture script, E2E, documentation and roadmap. Approving this plan authorises neither.
