# P5-01 plan: rule-based baseline driver (A3) and the E3 comparison

> **Status: plan only, for Codex review and the owner's merge. Implementation needs its own owner authorisation, and so does every study step (section 4).**
> - **Authorisation:** the owner's choice of P5-01 as the next plan-only item (2026-11-11, "P5-01 rule-based baseline driver (Recommended)", in answer to which ready item to plan), read as authorising a **plan only**. P5-01's dependencies (P2-02, P2-07, P2-10) are Complete.
> - **Scope:** the roadmap entry and issue #33: a documented, deterministic, hand-written driver (A3) and its no-braking variant, and the E3 comparison (A3 against A5). **Not** in scope: E5 (P5-02), E6 and the generalisation report (P5-04), any physics or track change, any learning claim beyond what a completed E3 supports.
> - **Lessons carried from P2-08, P2-09 and Phase 3:** predeclare everything before any result is seen; never tune on validation or held-out tracks; keep the held-out boundary closed until the owner authorises the run; state what is **not** claimed; test the pure parts first and run the study only in its own authorised step.

## 1. What P5-01 must deliver (ROADMAP, issue #33, `docs/AI_EVALUATION.md`)

- **Description:** a hand-written driver ("steer toward more free space, brake when the front ray is short at speed") plus a no-braking rule variant; run E3.
- **A3 (AI_EVALUATION §4):** "Steers towards the side with more free space (left rays vs right rays), throttles when the front ray is clear, and brakes when the front ray is short and speed is high. Hand-written, no learning."
- **E3 (§7):** "Does evolution beat a hand-written rule?" A3 against A5, on validation and held-out tracks, with 10 training seeds.
- **Acceptance:** the driver is documented and deterministic; results are recorded per AI_EVALUATION.md.
- **Test requirements:** unit tests of the driver's decisions for known sensor inputs.

## 2. What already exists (inspected at `main` `298202f`)

| Need | What exists | Where | Gap |
| --- | --- | --- | --- |
| A driver interface and the shared episode path | `EpisodeDriver`, `Observation` (the nine inputs), `evaluateDriver` | `src/ai/drivers.ts`, `src/training/evaluation.ts` | none |
| The inputs | seven normalised rays (-90 to 90 degrees, positive to the car's right, 1 means clear), normalised speed, heading error | `src/ai/inputs.ts`, `src/sensors/rays.ts` | none |
| Other baselines | A1, A7 random drivers; A2, A8, A9 generated from training | `src/ai/randomDrivers.ts`, `src/training/baselines.ts`, `agents.ts` | **A3 is missing** |
| A scripted driver | the P2-09 gate-pursuit driver | `src/ai/gatePursuitDriver.ts` | **not A3**: it follows the gate centre line with look-ahead steering and a curvature speed profile, which is far more information than the rays. It stays the P2-09 feasibility tool and is not reused as the baseline |
| Study machinery | records, reserved seed blocks, `analyse`, the held-out boundary (`trackSplits`) | `src/training/study.ts`, `e4Study.ts`, `trackSplits.ts` | an E3 manifest, protocol and analysis, in later steps |

## 3. Design

- **`src/ai/ruleBasedDriver.ts` (new, pure, headless).** `createRuleBasedDriver(params, { brakeEnabled })` returns an `EpisodeDriver` that reads **only the observation's inputs**: the seven rays and the speed. It ignores the heading-error input, so it uses no gate or centre-line information and is a fair "reads the same sensors" rule (decision 1 below). It is stateless; `reset()` does nothing; the same inputs always give the same controls.
- **The rule, in three lines** (parameters in brackets; all dimensionless, in the inputs' normalised units):
  1. **Steering:** `steering = clamp(steerGain * (right - left), -1, 1)`, where `right` and `left` are the mean normalised readings of the rays at +30, +60, +90 and -30, -60, -90 degrees (more free space on the right steers right, to the positive side).
  2. **Throttle:** full throttle when the front ray (0 degrees) is at least `frontClear`; otherwise `throttle = front / frontClear` (so it eases off as the road ahead closes); **and 0 while the speed input is above `speedCap`** (a speed exactly at `speedCap` is not above it). This is a **throttle cutoff, not a hard speed ceiling**: drag is the only thing that slows a car without the brake, and momentum can carry it above the cap. The implementation in #153 and its tests follow this wording exactly.
  3. **Brake (A3 only):** `brake = 1` when the front ray is below `brakeFront` **and** the speed input is above `brakeSpeed`, else 0. **A3-nb** is identical in every line except that its brake is always 0 **when it is given the same parameters**, so for a matching parameter set a difference between them is a difference the brake makes (the same design principle as P2-09). The one-difference unit test covers matching parameter sets only.
  Every output is clamped to the controls' ranges by the existing `clampControls`; non-finite inputs are refused with a `RangeError`, as the network driver does.
- **Parameters and how they are fixed.** Five numbers (`steerGain`, `frontClear`, `speedCap`, `brakeFront`, `brakeSpeed`). A rule written by hand has no fitness to optimise, but a weakly tuned baseline would flatter the evolved driver, so the plan **predeclares a small grid** (at most 100 variants, written into the plan's step-3 manifest before it is run) and selects **on the training track only** (`stadium-oval`), through `evaluateDriver` with the trainer's own episode rules: most ordered checkpoints, then most laps, then fastest first lap, then lowest grid index. **A3 and A3-nb are each tuned separately over the same grid**, so each is the best rule of its kind. Because separate tuning can change the steering and throttle constants as well as the brake ones, **the tuned pair is a pair of best-of-kind baselines, not a brake ablation**. The plan therefore reports **three** rule agents: **A3** (tuned), **A3-nb** (tuned separately) and **A3-nb-same** (A3's tuned constants with only the brake masked). Only A3 against A3-nb-same supports a statement about what the brake adds to this rule; A3 against the separately tuned A3-nb compares two tuned rules and is described as that. The grid, the winning constants and the full table of training scores are committed. **Validation and held-out tracks are never used to choose anything**, exactly as for the evolved agents. The winning constants are then frozen in `src/ai/ruleBasedDriver.ts` with an algorithm id (`rule-based-v1`).
- **Determinism and cost.** No randomness, no clock; each episode runs on the shared fixed-step path. The grid costs at most 200 training-track episodes.

## 4. Steps (each needs its own owner authorisation, as for P2-09)

1. **This plan** (documentation only).
2. **The driver and its unit tests** (`ruleBasedDriver.ts`, `docs/ARCHITECTURE.md` entry, no tuning run, no constants beyond clearly labelled placeholders that tests do not depend on). No study, no held-out access.
3. **Tuning on the training track** (a script and a committed record: the predeclared grid, the table of training-track scores, the selected constants for A3, A3-nb and the derived A3-nb-same, the frozen constants in the driver). Training track only.
4. **E3 machinery** (code, tests and documentation; **no study run and no held-out evaluation**). Review of this plan found that the existing pieces cannot run E3 as they stand: `createEvaluationSetup` deliberately refuses held-out tracks, and the existing study runners (P2-08, E4) implement no held-out evaluation, record or analysis. This step adds, **without weakening any existing training or evaluation guard** (`createEvaluationSetup` and `assertEvaluationTrack` keep refusing held-out tracks):
   - **Frozen identity** for every agent in E3: A5 champions through the existing `freezeModel`; the rule drivers through a frozen record of algorithm id, constants and source commit, with a content hash, so a result names exactly what was run.
   - **Controlled held-out access:** one explicit, narrow entry point (for example `heldOutEvaluation`, built on `heldOutTrack(id, frozenModel)`) that evaluates only frozen agents, only on the protocol's listed tracks, and **can be used once per protocol** (a record of the opening is written, and a second call without a new authorisation id is refused).
   - **Reproducible records and replay:** an E3 record (format, version, configuration, seeds, frozen agent identities, per-track and per-start results, contract versions, track hashes), a parser that refuses damaged records, and a replay that reproduces every episode from the record.
   - **The analysis** (per-track A5 and A3 results, the seed-cluster bootstrap on A5 minus A3, counts of seeds beating A3, lap completion and collisions) as a pure function with tests.
   - **Tests:** the access guard (no held-out data for an unfrozen agent, an unlisted track, or a second opening), record round trip and corruption refusals, replay equality, analysis against hand-computed fixtures, and a dry run on the **validation** track only. Mutation checks as before.
   The machinery is reviewed and then **frozen** (its source commit recorded) before step 5, the protocol.
5. **E3 protocol and manifest, predeclared** (`docs/experiments/p5-01-e3-protocol.md`): the question, the primary metric, the pairing, the analysis procedure, the reserved seed block, the listed tracks and **the frozen source and machinery commits**, written **before** any validation or held-out evaluation. Documentation only.
6. **Run E3** on the validation and held-out tracks. **This is the step that opens the held-out boundary, so it needs the owner's explicit authorisation** (given as "I authorise all steps" for the plan as first written; the added step 4 is read as part of the same authorisation and is flagged for the owner to correct), like P2-09's E4 run. It uses 10 new training seeds from a block reserved in the protocol (not 1001 to 1010 or 2001 to 2010) for A5, evaluated with the frozen A3, A3-nb and A3-nb-same. The held-out boundary is opened **once**.
7. **Record and completion** (results as recorded, `ROADMAP.md`, the owner's completion approval).

**Proposed E3 analysis (to be fixed in step 5, stated here so the owner can object early):** the primary metric is **ordered checkpoint progress** (as in Phase 2), per track. A3 is deterministic, so it contributes one value per track and start; A5 contributes one value per training seed. The comparison reports A5's median and interquartile range, the number of seeds on which A5 beats A3, and a seed-cluster bootstrap 95% interval for the A5 minus A3 difference; lap completion and collisions are reported alongside. A negative or "no clear difference" result is a valid outcome and is reported as such. The held-out tracks are used **only** in step 5, once.

## 5. What is deliberately not claimed

A3 is a baseline written by one person for this simulator and tuned on one training track; it is not "the best possible rule", and an evolved driver that beats it has beaten **this** rule, not rule-based driving in general. E3 compares agents on a handful of tracks and 10 seeds, so its p-values are a guide, not proof (AI_EVALUATION §8). Nothing in P5-01 says the AI has learned or generalised unless a completed E3 supports a stated, limited conclusion; steps 2 to 4 make no such claim at all. Phase 2's training-track-only result is unchanged.

## 6. Tests

- **Unit (`ruleBasedDriver`):** a table of known inputs with exact expected controls: clear road (full throttle, no steering), more room on the right (steer right) and on the left (steer left), symmetric (no steering), a short front ray at low speed (no brake) and at high speed (brake for A3, none for A3-nb), the throttle easing law, the speed cap, clamping, and each boundary (front exactly at `frontClear` and at `brakeFront`, speed exactly at `brakeSpeed`).
- **A3 against A3-nb, matching parameters only:** for every tested input, when both are built from the same constants, steering and throttle are identical and only the brake differs (the one-difference property). Separately tuned A3 and A3-nb are not tested for this, because they need not share constants.
- **Throttle cutoff:** a speed exactly at `speedCap` keeps the throttle law; just above it the throttle is 0; the test says nothing about a speed ceiling.
- **Determinism and robustness:** the same inputs give the same controls over repeated calls and fresh drivers; no state leaks across `reset()`; non-finite, missing or wrong-length inputs are refused with a `RangeError`; hostile observations never produce `NaN` controls.
- **Integration (step 3 only):** one scripted episode of the frozen driver on the training track through `evaluateDriver` to show the harness runs it; the tuning record's selection rule is checked by a unit test on synthetic scores.
- **Mutation checks** during implementation: weakening each rule line fails a test.
- Not tested here: any device, any validation or held-out track.

## 7. Decisions for the owner (defaults proposed; each routine unless changed)

1. **A3 reads the rays and speed only** and ignores the heading-error input (the gate direction), as AI_EVALUATION defines A3. The alternative, a rule that also uses the heading error, would be a stronger baseline but a different agent.
2. **A3 and A3-nb are tuned separately** on the training track over one predeclared grid (at most 100 variants), so each is a fair best-of-its-kind; **A3-nb-same** (A3's constants, brake masked) is reported as well and is the only brake ablation.
3. **Selection rule:** ordered checkpoints, then laps, then first-lap time, then grid index, on the training track only.
4. **E3's primary metric is ordered checkpoint progress**, per track, with the seed-cluster bootstrap on A5 minus A3 as in section 4.
5. **E3 uses a new reserved seed block** (proposed 3001 to 3010) and opens the held-out boundary only in step 6, once, through the controlled entry point built in step 4.
6. **The P2-09 gate-pursuit driver is not the baseline** and stays as it is.
7. **Each step is authorised separately**; approving this plan authorises none of them (the owner has since authorised all steps as first written; the added machinery step 4 is flagged above).

## 8. Limits

A deterministic rule is evaluated once per track and start, so its "uncertainty" is zero while A5's is across seeds; the comparison statistic accounts for that by clustering on A5's seeds, not by pretending A3 is a sample. Hand tuning on a single training circuit may not transfer to the validation and held-out circuits, which is the point of keeping them closed until step 5. ST1 to ST5, the held-out boundary, every existing study seed and the P2-08 and P2-09 records are untouched.
