# P2-09 plan: braking toggle, braking feasibility check and E4 (A4 vs A5)

> **Status: plan merged (#112, #113). P2-09 is In Progress: steps 2–5 are merged (#114, #115, #116, #117) and step 6 (the frozen E4 manifest and protocol, no study run) is authorised and in review.**
> - **Owner decisions:** persistence **option A** was chosen and [step 2 authorised](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/20#issuecomment-6591922425). Step 2 is merged in #114 (`src/training/frozenModelBrake.ts`). [Step 3 only was then authorised](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/20#issuecomment-6603831373): the feasibility driver and harness (`src/ai/gatePursuitDriver.ts`, `src/training/feasibility.ts`, `scripts/feasibility.mjs`), merged in #115. **Step 4 (the feasibility run) was then authorised and run once**: its record is in `experiments/results/p2-09/feasibility/` (merged in #116), acceptance A2 **met** on the validation track by rule (ii) and not shown on the training track; physical feasibility of a scripted driver only. [E4 authorisation was then given](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/20#issuecomment-6607887038), and was read as **step 5 only**: the E4 tooling (`src/training/e4Agents.ts`, `e4Study.ts`, `e4Analysis.ts`, `scripts/e4.mjs`), with no study run, merged in #117. [Step 6 only was then authorised](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/20#issuecomment-6615763036), conditional on #117 merging and `main` CI passing (both met): the frozen manifest `experiments/manifests/p2-09-e4.json` and the protocol [`p2-09-e4-protocol.md`](p2-09-e4-protocol.md), in review. Steps 7–8 are not authorised.
> - **Authorisation:** this plan was [authorised as documentation only](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/20#issuecomment-6591090802). It follows [Codex's assessment on #20](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/20#issuecomment-6590499057).
> - **Not done:** steps 2–5 are merged (step 4: acceptance A2 met on the validation track, not shown on the training track) and step 6, the frozen E4 manifest and protocol, is written and in review. Steps 7–8 are not done: no seed in 2001–2010 has run and no E4 result exists. Each step in §8 needs its own owner authorisation, Codex review and owner merge.
> - **Not changed:** no physics or track change is proposed.
> - **E5 is out of scope.** It covers the held-out braking benefit and belongs to P5-02.

## 1. What P2-09 must deliver (ROADMAP, issue #20)

- **The toggle:** a brake-enabled or no-brake training switch. The brake is masked and the network keeps the same 9-12-3 shape.
- **Acceptance:**
  - **(A1)** The toggle is recorded in the experiment configuration and in saved models.
  - **(A2)** A feasibility note: a scripted driver is faster, or crashes less, with braking on at least one track. Otherwise the limitation is reported, and any physics or track redesign is approved and versioned before a fresh study. Held-out results are never used to tune conditions.
- **Tests:**
  - **(T1)** Unit: the mask forces brake = 0.
  - **(T2)** Integration: paired no-brake and brake runs with the same seed.
- **Run E4:** A4 (evolved, no braking) against A5 (evolved, with braking), on the training and validation tracks, with 10 paired training seeds (AI_EVALUATION.md §7).

## 2. Audit of what already exists (inspected at `main` `6de4611`)

| Requirement | What exists | Where | Gap |
| --- | --- | --- | --- |
| Mask | `outputsToControls(raw, brakeEnabled)` forces brake = 0 when `false`. `runNetwork` and `createNetworkDriver` require and pass `{ brakeEnabled }`. | `src/ai/outputs.ts:25–38`, `src/ai/network.ts:113–117`, `src/ai/drivers.ts:35–41` | none |
| T1 | The masked output is checked; masked training evaluation equals a network whose brake output is exactly 0. | `tests/ai/outputs.test.ts:50`, `tests/training/trainer.test.ts:289` | none. Both are reused and not duplicated. |
| Config (A1, part 1) | `brakeEnabled` is a validated training-config field, default `true`. It is resolved into P2-07 experiment records and P2-08 study manifests (`configuration.training.brakeEnabled`). | `src/training/trainer.ts:58,73,191`, `tests/training/experiment.test.ts:113–117`, `src/training/study.ts:613` | none for configuration |
| Saved models (A1, part 2) | Frozen models are `{ id, parameters, provenance }`. The `id` hashes the parameters and provenance (`freezeModel`, `src/training/trackSplits.ts:268`). Provenance today holds agent, seed, generation, index, selection, track ID and hash, **but not `brakeEnabled`**. `MODEL_FORMAT.md` defines `architecture.brakeEnabled` for standalone saved models, which do not exist until P3-05 and P3-06. | `src/training/agents.ts:173`, `src/training/baselines.ts:229,255`, `src/training/experiment.ts:495`, `docs/MODEL_FORMAT.md:326` | **yes** (§3) |
| T2 | none. No test trains brake-on and brake-off from the same seed and compares them. | — | **yes** (§6) |
| Scripted driver | `pursuit(car, targetSpeed)`: pure pursuit 8 m ahead on the oval's analytic centre line, full throttle below the target speed, and brake 0.5 above target + 1 m/s. It is used by `lapDemo.test.ts` (3 crash-free laps at 12 m/s, each > 38 s). | `tests/sim/ovalDriver.ts:28–44`, `tests/sim/lapDemo.test.ts` | **yes** (§4): it is oval-only (no centre line for `rounded-rectangle`), test-only, and has no coasting variant. It is not the A3 baseline (P5-01) and does not show braking is useful. |
| E4 tooling | The P2-08 study tooling handles manifests, records, replay, frozen-model evaluation, the bootstrap and the exact Wilcoxon test. Its manifest labels, agent set (A1, A7, A2, A9, A8, A5) and analysis (A5 − A8) are fixed. | `src/training/study.ts`, `src/training/analysis.ts`, `scripts/study.mjs` | **yes** (§5): an A4/A5 study kind and a paired A5 − A4 analysis |

**Relevant physics** (`DEFAULT_VEHICLE_PHYSICS`, unchanged):
- engine 8 m/s², brake 12 m/s²;
- rolling resistance 0.1/s, with quadratic drag making the terminal speed about 23.7 m/s;
- maximum lateral acceleration 8 m/s².

Coasting at 20 m/s already slows the car by roughly 6 m/s², so whether braking is *useful* is a real question. The check in §4 answers it, rather than this plan assuming it.

## 3. Persistence and configuration (A1)

**Recommended (option A): put the brake mask into the frozen model's identity, for new models only.** It has two parts, matching implementation steps 2 and 5.

**Part 1 (step 2): an independent model identity and mask contract,** with no new record kind.
- **The convention:** a frozen model may carry `provenance.brakeEnabled` (boolean). Being part of the provenance, it enters the model `id`.
- **Two helpers:**
  - `modelBrakeEnabled(model)` returns that value. It rejects a model whose `provenance.brakeEnabled` is missing or not a boolean, naming the path.
  - `createFrozenModelDriver(model)` drives the model with exactly that value.
- **Tests:**
  - the same parameters with `brakeEnabled` true and false give different IDs;
  - a model with the key missing or not a boolean is rejected with a named path;
  - a `false` model drives exactly like T1's zero-brake network, and a `true` model exactly like `createNetworkDriver(parameters, { brakeEnabled: true })`;
  - the existing P2-07 and P2-08 record tests and committed records still pass unchanged. Their models do not carry the key, their formats and IDs are untouched, and the helpers are not applied to them.

**Part 2 (step 5): per-agent binding in the E4 record kind.**
- **Per-agent configuration:** an E4 manifest has one shared training configuration *without* `brakeEnabled`, plus a fixed per-agent effective setting: **A4 → `false`, A5 → `true`**. The study kind fixes these, and they are not free parameters.
- **Validation:** the record parser, model-identity checks and replay all use the agent's own value:
  - an A4 model must have `provenance.brakeEnabled === false`;
  - an A5 model must have `true`;
  - each is replayed with its own value.
- **What is rejected, with the path named:**
  - an A4 model carrying `true`, or an A5 model carrying `false`;
  - a model moved into the other agent's slot;
  - a manifest whose shared training configuration contains `brakeEnabled`;
  - a manifest whose per-agent settings differ from A4 = `false`, A5 = `true`.

  Each of these has its own test in step 5.

**The P3 contract:** this plan records it for P3-05/P3-06. A model saved from such a record writes `architecture.brakeEnabled = provenance.brakeEnabled`, and loading rejects a mismatch. The plan does not implement P3-05/P3-06, and does not make them a P2-09 prerequisite.

**Alternative (option B): explicitly defer "saved models" to P3-05/P3-06.**
- This needs an owner-approved change to P2-09's acceptance wording, recorded in ROADMAP and #20.
- A1 would then be met by configuration recording alone. The acceptance criterion is not changed silently.

**The owner chooses A or B** when approving step 2. This plan recommends A.

## 4. Braking-versus-coasting feasibility check (A2)

**Purpose:** physical feasibility only. It shows whether *a scripted driver* gains from braking on the built-in non-held-out tracks. It is **not** evidence that a network learns to brake. That is E4 here, and E5 later.

**Driver** (step 3): `GatePursuitDriver`, generalised from `tests/sim/ovalDriver.ts`:
- **Steering:** pure pursuit as in `pursuit()`, with an 8 m look-ahead, but along the polyline through the **gate midpoints** of any track. That works on `stadium-oval` and `rounded-rectangle` without hand-written centre lines.
- **Speed target:** `v*(s) = min(vTop, sqrt(aLat × R(s + L)))`, where `R` is the polyline's radius of curvature at look-ahead distance `L`, from three consecutive midpoints.
- **Throttle:** 1 when `speed < v*`, otherwise 0. This is identical in both modes.
- **The one difference between modes:** when `speed > v* + 0.5 m/s`,
  - **BRAKE** sets brake = 1;
  - **COAST** sets brake = 0, so the car slows by drag and rolling resistance only.

  Steering, throttle, the target profile and every parameter are the same.
- **Interface:** the driver runs behind the existing `EpisodeDriver` interface through `evaluateDriver`, the shared episode path. Tracks come only from `trainingTrack` or `validationTrack`, so `heldOutTrack` cannot be reached.

**Grid** (predeclared, identical for both modes): `aLat` ∈ {4, 5, 6, 7, 8} m/s², `L` ∈ {10, 20, 30, 40} m and `vTop` ∈ {16, 20, 23.7} m/s. That is 60 variants per mode per track, on `stadium-oval` (training) and `rounded-rectangle` (validation): 240 episodes in all.

**Episode rules:** the trainer's own, with fitness version 1: 60 s limit, 5 s stall limit, 3 laps maximum, and a collision ends the episode. Episodes are deterministic, so no seeds are needed. Each variant runs once.

**Measures per episode:** first-lap time (s, if any), laps completed, collision (yes or no), ordered progress, and the terminal outcome.

**Decision**, per track:
- Let **B\*** be the BRAKE variant with the fastest crash-free first lap, and **C\*** the same for COAST.
- **Braking is useful on that track** if either:
  - (i) at least one BRAKE variant completes a crash-free lap and no COAST variant does; or
  - (ii) both exist, and `t(B*) ≤ t(C*) − max(0.5 s, 0.02 × t(C*))`.
- "Crashes less" is reported **descriptively**: the share of grid variants with a crash-free lap, for each mode.

**Acceptance (A2):** braking is useful on at least one of the two tracks.
- **If neither track shows it:** the limitation is reported in the results PR, and **the work stops** for the owner's decision. Physics and tracks are not changed. Any redesign needs owner approval and a version bump before a fresh study, and is never chosen using held-out results.
- E4 does not start until A2 is met, or until the owner explicitly decides how to proceed.

**Output:** `experiments/results/p2-09/feasibility/`, holding:
- a JSON record of all 240 episodes, with driver parameters, track IDs and hashes, engine and commit;
- `feasibility.md`.

The record is about 0.1 MB, so it is stored raw. A re-run reproduces it byte-for-byte. The check is a deterministic tool run, so it needs no pilot or manifest beyond the frozen grid above.

## 5. E4: the paired A4/A5 study (training and validation only)

**Question:** "Does braking change behaviour on the training track?" (AI_EVALUATION E4). The answer is either direction, or no clear difference. **Nothing in E4 decides Phase 2 acceptance.** Held-out tracks are never evaluated; that is E5, in P5-02.

**Agents:**
- **A4:** evolved with `brakeEnabled: false`.
- **A5:** evolved with `brakeEnabled: true`.
- **What is shared:** the configuration (the trainer defaults with G = 100, the P2-08 C1 configuration from #109), the physics, the fitness and the training seeds.
- **The pairing:** for the same seed, both start from the identical generation-0 population, because the trainer's initial stream depends only on the seed (`trainerStreams`, `src/training/trainer.ts:316`). They then evolve separately. Only the brake mask differs.
- **No ablation shortcut:** masking a trained A5 is not used as A4 (AI_EVALUATION §2).

**Seeds:** **2001–2010**, a new reserved range. It is disjoint from P2-08's 9001–9003 and 1001–1020, and the mechanics-manifest guard will reject it (step 5).
- **No pilot:** the configuration is fixed (C1), and AI_EVALUATION §7 fixes n = 10.
- **Pairing check:** the step 5 tests check that A4 and A5 share generation 0 for each seed.

**Budget per seed:** P × G = 50 × 100 = 5,000 training evaluations for each of A4 and A5. Each frozen champion then runs one deterministic episode on each track.
- **Runtime:** estimated from the P2-08 confirmatory run (a comparable 10,000 evaluations per seed took 220–279 s) at about 4–5 min per seed. With replay and one analysis, the whole study takes about 2–2.5 h.
- **Storage:** about 5–7 MB raw per record, or about 0.7 MB gzip.

**Primary measure:** for each seed s, `d_s = progress(A5_s) − progress(A4_s)`, the ordered progress of the frozen champions on the **training track**, in laps.

**Statistics:** as in P2-08 and AI_EVALUATION §8:
- the mean of `d_s`, with a 95% percentile bootstrap interval (10,000 resamples, seed `20261103`);
- the median and IQR;
- the exact Wilcoxon signed-rank test (zeros dropped, midranks, descriptive only).

**Outcome wording:**

| Condition | Reported as |
| --- | --- |
| interval lower bound > 0 **and** mean ≥ 0.25 lap | "A5 (braking) reached meaningfully more training-track progress than A4" |
| interval upper bound < 0 **and** mean ≤ −0.25 lap | "A4 (no braking) reached meaningfully more training-track progress than A5" |
| interval excludes 0 **but** \|mean\| < 0.25 lap | "A5 (or A4, by sign) reached more training-track progress, but the difference is below the predeclared 0.25-lap meaningful threshold" |
| interval includes 0 | "no direction established: the interval spans zero" |

The four rows are exhaustive and mutually exclusive. If the interval excludes 0, its bounds share the sign of the mean.

Every report states the actual mean, interval, median, IQR and n, whatever the label. **Neither of the last two rows** means "no effect" or "equivalent". They mean only that a predeclared meaningful advantage was not established. One says the evidence shows a direction below the threshold; the other says the direction is uncertain.

**Secondary measures (descriptive, both tracks, paired by seed):**
- first-lap time (only seeds where both laps complete, with n);
- lap completion;
- collision;
- terminal outcomes;
- **brake usage**, the share of A5's ticks with brake > 0.05. A4 must be exactly 0, which is checked.

Validation results never decide anything.

**Claims allowed:** only the outcome wording above, on the training track, plus descriptive validation results. **Not allowed:**
- any held-out or generalisation claim;
- any claim that learned braking improves unseen-track driving (E5);
- any claim from the feasibility check (§4) about learned behaviour.

**Manifest:** a frozen E4 manifest, step 6. It is reviewed by Codex and approved by the owner before any seed in 2001–2010 runs. It names:
- the code commit, the engine (Node v24.22.1) and the seeds;
- the configuration with `brakeEnabled` per agent;
- the metric, the thresholds, the bootstrap seed and the storage format.

**Storage:** gzip records (`gzip -9 -n`) with the SHA-256 of each uncompressed record, under `experiments/results/p2-09/e4/`, as in the owner's P2-08 choice. The owner reconfirms this when approving the run.

## 6. Tests (added in their implementation steps, not now)

- **T1:** already met (§2), so no new test is needed.
- **T2:** a paired integration test, in step 5, with a mechanics manifest on non-reserved seeds and a small P and G. For the same seed, A4 and A5:
  - share generation 0;
  - differ only in `brakeEnabled` in their configurations and provenance;
  - and A4 never applies the brake: its brake command is 0 on every tick.

  Both records parse and replay identically.
- **Persistence:** part 1's tests in step 2, and part 2's per-agent binding and cross-agent rejection tests in step 5 (§3).
- **Feasibility driver (step 3):**
  - it is deterministic;
  - BRAKE and COAST give identical steering and throttle on every tick until the first over-speed tick;
  - COAST never brakes;
  - it refuses held-out tracks;
  - the gate-midpoint polyline and curvature match hand-computed values on the oval's straights and arcs.
- **E4 analysis (step 5):** hand-computed paired differences, bootstrap and Wilcoxon checks on synthetic data, the four outcome labels, and the A4 brake-usage = 0 check. Synthetic cases cover each label, including ten differences of exactly +0.20, which must give "below the predeclared 0.25-lap meaningful threshold", not "no direction".

## 7. Failure handling (all runs: feasibility and E4)

- **Run detached from the start.** Runs use a logged runner (for example `setsid nohup`), so a session limit cannot kill them. This learns from #110.
- **What stops the work:** a failed run, a record that does not replay identically, an analysis that refuses its records, **or any infrastructure interruption**, such as a killed process, a session limit or a full disk.
- **What happens then:** the work is reported to the owner before anything resumes. Nothing restarts automatically. Re-running a deterministic step needs the owner's written go-ahead, as a relayed instruction. #110's exception was for that study only.
- **No substitution:** no seed is substituted, skipped or re-run with changed settings. The feasibility grid is not changed after any result is seen.

## 8. Implementation steps (each needs its own owner authorisation)

1. **This plan.** Documentation only.
2. **Persistence (A1):** option A part 1 (the model identity and mask contract and its tests, §3) or option B. No new record kind and no study run. Part 2 is integrated in step 5.
3. **Feasibility driver and harness:**
   - `GatePursuitDriver`, BRAKE and COAST modes;
   - `npm run feasibility` writing the record in §4;
   - unit tests.

   No feasibility run.
4. **Feasibility run and results PR (A2):** on the training and validation tracks only. Stop if braking is not useful (§4).
5. **E4 tooling:**
   - an A4/A5 study kind (manifest, record, replay and frozen-model evaluation, reusing the P2-08 code);
   - the reserved seeds 2001–2010;
   - the per-agent `brakeEnabled` binding (A4 = `false`, A5 = `true`) and its cross-agent rejection tests. This is option A part 2 (§3). Under option B, only the per-agent configuration and its tests apply;
   - the paired A5 − A4 analysis with the four outcome labels (§5), and the brake-usage measure;
   - T2.

   No study is run.
6. **E4 manifest and protocol:** frozen and preregistered, for Codex review and the owner's approval.
7. **E4 run and results PR.**
8. **P2-09 completion record.** P2-09 is marked Complete only when every AGENTS.md gate is evidenced.

Steps 2 and 3 are independent. Step 4 needs step 3. Steps 5–7 need steps 2 and 4, or an owner decision under §4.

## 9. Limitations stated in advance

- **The feasibility check:** it uses one hand-written driver family and a finite grid. A negative result means "not shown for this driver", not "braking is useless".
- **E4's scope:** one configuration (C1), one training track and 10 seeds. The P2-08 validation results suggest weak transfer, so E4's validation results are descriptive only.
- **What carries forward:** none of this informs held-out evaluation. E5 in P5-02 needs its own preregistration.
