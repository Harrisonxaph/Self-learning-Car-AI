# P2-08 plan: random baselines and the controlled improvement study (E1, E2)

> Status: **proposed plan only.** Nothing here is implemented, and no pilot or confirmatory run has been made. Implementation, the pilot and the confirmatory study each need the owner's explicit authorization ([#19](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/19)) and Codex review. No learning claim is made or implied.

This plan turns [AI_EVALUATION.md](../AI_EVALUATION.md) §2, §3, §5, §7 and §8 into concrete settings for P2-08: agents A1, A7, A2, A9, A8 and A5, experiments E1 and E2, on the built-in tracks from P2-10, recorded and replayed with the P2-07 runner. Where AI_EVALUATION leaves a choice open, this plan proposes one and says so; Codex and the owner can change any of it before the confirmatory manifest is frozen.

## 1. Questions and claims

- **E1 (floor):** do random agents (A1, A7) or untrained networks (A2) make ordered progress or finish laps on the training track?
- **E2 (improvement):** does evolution (A5) reach more ordered progress on the training track than generation 0 (A2), the best of generation 0 (A9), random driving (A1, A7) and, above all, **equal-budget random search (A8)**?

Phase 2 acceptance is judged on the A5 − A8 contrast only (§6). The other contrasts are reported but are not acceptance tests. The study is about optimisation on the training track. It is **not** a generalisation study: the held-out track is not used (§4), and generalisation is E6 (P5-04).

## 2. Agents

All agents drive through the same simulation path as the trainer (`buildInputs` → controls → `stepRacer` → `recordTick`), with the same physics, timestep, sensors, start pose and episode rules (§5). Only the source of the controls differs.

| ID | Agent | Definition in this plan | Parameters |
|----|-------|-------------------------|------------|
| A1 | Random action | Each tick: steering uniform in [−1, 1), throttle and brake uniform in [0, 1), from a seeded generator. | No network. |
| A7 | Correlated random action | Like A1, but each sampled action is held for 30 ticks (0.5 s at 1/60 s) before resampling. The hold length is recorded. | No network. |
| A2 | Untrained networks | The P networks of A5's own generation 0 (same training seed), never evolved, each evaluated once. Reported as the seed's population mean and distribution. | `uniform-pm1-v1` initialisation. |
| A9 | Best of generation 0 | The single best generation-0 network by training fitness (ties to the lower index), frozen. | One of the A2 networks. |
| A8 | Equal-budget random search | P × G networks drawn from the same initialisation distribution, each evaluated once on the training track; the best by training fitness (ties to the earliest) is frozen. | See §3 for the stream and budget. |
| A5 | Evolution (with braking) | The P2-05 trainer for G generations; the final generation's training-fitness champion is frozen. With at least one elite this is also the best of every generation evaluated (a test will check this). | The recorded P2-07 configuration. |

Selection rule for every model-based agent: **highest training fitness** (P2-06, `fitnessVersion` 1), ties to the earliest evaluated. The same rule for A5, A8 and A9 keeps the comparison symmetric. No agent's model is chosen using validation or held-out results in the confirmatory study.

## 3. Seeds, streams and fair budgets

- **Training seeds (confirmatory):** 10 seeds, `1001` to `1010`, fixed now. They are unsigned 32-bit integers, distinct from the pilot seeds and from every seed already used in tests or demos.
- **Pilot seeds:** `9001` to `9003`. Pilot results never enter the confirmatory analysis.
- **A5 and A2/A9:** the P2-07 trainer's documented streams (`RNG_STREAMS = trainer-run-initial-then-3-per-transition-v1`): `run = createRng(seed)`, `initial = createRng(run.nextUint32())`, generation 0 is P genomes drawn from `initial`.
- **A8:** the same `initial` generator, **continued** for P × G genomes. A8's first P networks are therefore exactly A5's generation 0. This pairs A8 with A5 by seed, makes A9 the best of A8's first block, and means any A5 − A8 difference comes from what happens after generation 0. The stream layout gets its own recorded identifier.
- **A1 and A7 action seeds:** for agent `a`, training seed `s` and episode `e`, the first 32 bits of `sha256("p2-08|<a>|<s>|<e>")` (`utils/sha256.ts`). They are independent of the trainer's streams, and the derivation is recorded in every record. There are E = 10 episodes per training seed per track; they are averaged within the seed (§7).
- **Budget:**
  - The budget unit is the **episode evaluation**, as AI_EVALUATION §2 defines A8. A5 uses P × G evaluations; A8 gets exactly P × G.
  - A5 re-evaluates its elites each generation, and deterministic re-evaluation adds no information. So A5 sees at most P × G − eliteCount × (G − 1) distinct genomes, while A8 sees P × G. This gives A8 a small advantage, which makes the A5 − A8 test conservative. Both counts are recorded.
  - The simulated car-ticks used by each agent are recorded as a secondary budget. They are not equalised, because episodes end at different times.
- **Default configuration (to be confirmed by the pilot, §8):** the MODEL_FORMAT/P2-05 defaults:
  - P = 50 cars, 2 elites, tournament 3, uniform crossover 0.7, mutation 0.1/0.2, braking on;
  - 60 s episodes, 5 s stall, 3-lap cap;
  - G = 50 generations, so 2,500 evaluations per seed for A5 and for A8.

## 4. Track boundaries

- **Training:** `stadium-oval` (training split) is the only track any agent trains or is selected on. This uses `trainingTrack` and the trainer's `assertTrainingTrack` from P2-10.
- **Validation:** `rounded-rectangle` is used only:
  - in the **pilot**, to choose between at most three predeclared configurations (§8), through `selectByValidation`;
  - in the **confirmatory** study, as a **secondary**, descriptive endpoint: each frozen model and A1/A7 is evaluated once on it. No confirmatory decision uses it.
- **Held-out:** `hairpin-chicane` is **not touched.** No P2-08 code calls `heldOutTrack`, a source test will check that, and no held-out result is produced or looked at. The frozen model IDs from the confirmatory study are recorded so E6 can later evaluate them on the held-out track without retraining.

## 5. Episode rules and metrics

- **Episodes:** the same recorded P2-06 rules for every agent: 60 s maximum, 5 s stall, 3-lap cap, crash ends the episode. The simulator has one deterministic start pose per track and no start perturbation. So a deterministic agent (A2, A9, A8, A5) has exactly **one** episode per track; repeating it adds no information (AI_EVALUATION §5). Only A1 and A7 have more than one episode per track (E = 10).
- **Primary metric: ordered progress** = gates credited ÷ gates per lap (`gatesPassed / track.gates.length`, P1-07 credits, including the first crossing of gate 0). It can exceed 1 over several laps.
- **Secondary metrics** (AI_EVALUATION §3):
  - lap completion (at least one lap);
  - collision rate;
  - counts of every outcome (completed, crashed, stalled, timeout);
  - first-lap time in simulated seconds with its sample count (unavailable, never zero, when there is no lap);
  - fitness;
  - simulated ticks used;
  - per-generation best and mean fitness for A5 (median and IQR across seeds).

## 6. Primary analysis and decision rule

- **Primary contrast:** for each training seed `s`, `d_s = progress(A5, s) − progress(A8, s)` on the training track, with both frozen models' single deterministic episodes. The seed is the independent unit; nothing is counted per car, tick or generation.
- **Uncertainty:**
  - the mean of the 10 `d_s`, with a 95% percentile bootstrap interval from 10,000 resamples of the seeds;
  - the bootstrap uses its own sfc32 generator with seed `20261028`, which is recorded;
  - the median and IQR of `d_s`;
  - an exact two-sided Wilcoxon signed-rank test, reported as a guide only.
- **Meaningful effect threshold:** **δ = 0.25 lap**, which is 5 of the oval's 20 gates. It is fixed here, before any pilot, as the smallest improvement worth calling meaningful. The pilot may **raise** δ but never lower it.
- **Decision rule.** Every condition must hold for the study to support Phase 2 acceptance:
  1. the 95% interval for mean `d_s` lies entirely above 0;
  2. mean `d_s` ≥ δ;
  3. at least one A5 frozen model completes a valid lap on the training track;
  4. A1, A7, A2 and A9 results, lap completion and collisions are all reported.

  If any condition fails, the result is reported as negative or inconclusive. Phase 2 then stays unaccepted, and a follow-up is planned. The result is never relabelled.
- **Secondary contrasts:** A5 − A9, A5 − A2 (seed mean), A5 − A1 and A5 − A7 (seed means of 10 episodes), on the training track, plus every contrast on the validation track. They use the same bootstrap and are described, not tested. They are not used for acceptance or claims.
- **Wording of results:**
  - "beats random driving" refers to A1/A7;
  - "improves on selection alone" refers to A9;
  - "outperforms equal-budget random search" refers to A8 and is the only acceptance claim.
  - None of these is a claim of general driving ability.

## 7. Aggregation

- **A1/A7:** the mean over the E = 10 episodes within each training seed. **A2:** the mean over the P generation-0 networks within each seed. These seed-level values enter the cross-seed analysis, never the individual episodes.
- **Paired by seed:** A5, A8, A9 and A2 share the seed's generation 0, and A1/A7 use seed-specific action seeds. Every contrast is paired by training seed.

## 8. Pilot calibration (separate from the confirmatory study)

The pilot is **exploratory**, uses seeds `9001` to `9003`, and its results never count towards acceptance. It is recorded under `experiments/results/p2-08/pilot/` with the label `pilot` in every record.

**Purposes:**
1. Check that every agent, the A8 stream, the budgets, replay and the analysis run end to end and reproduce.
2. Measure the runtime and record size of a full seed.
3. Estimate the spread of `d_s`. The estimate can only **raise** δ or the number of seeds: if the projected 95% interval half-width at n = 10 exceeds δ, the confirmatory study uses 20 seeds (`1001` to `1020`) instead.
4. Choose one configuration from at most three predeclared candidates, by mean validation-track ordered progress of each candidate's A5 models (`selectByValidation`, ties to C0):
   - C0: the defaults with G = 50;
   - C1: the defaults with G = 100;
   - C2: the defaults with mutation scale 0.5 and G = 50.

   A8's budget follows the chosen configuration.
5. Confirm that a valid lap is possible within 60 s on the oval. A lap is about 491 m, and the top speed is about 23.7 m/s, so a lap takes at least about 21 s.

**What the pilot does not do:** it touches no held-out track, and it uses no confirmatory seed.

**After the pilot,** a **confirmatory manifest** (§9) records:
- the chosen configuration, δ and n;
- the seeds, agents and metric;
- the decision rule and bootstrap seed;
- the code commit.

The manifest is reviewed by Codex and approved by the owner **before** any confirmatory run. After that, nothing in it changes.

## 9. Records, replay and artifacts

- **Manifests (preregistration):** `experiments/manifests/p2-08-pilot.json` and `experiments/manifests/p2-08-confirmatory.json`. Each holds:
  - the questions, agents, seeds and stream derivations;
  - the configuration, budgets, tracks and split hashes;
  - the metric definitions, δ, n, decision rule and bootstrap seed;
  - the code commit.

  Every result record carries its manifest's SHA-256.
- **Training records:** a P2-07 experiment record (`npm run experiment`) for each A5 seed, holding raw per-car outcomes for every generation and the frozen champion.
- **Baseline and evaluation records:** a new versioned record format holds:
  - A8's raw episode for every sample, the A8 stream identifier and the selected model;
  - A2's raw per-network episodes and A9's selection;
  - A1/A7's raw per-episode outcomes with their action seeds;
  - every frozen model's training and validation episodes.

  Each record is covered by a `resultsHash`, rejects malformed, incomplete or incompatible input like P2-07 records, and can be replayed to identical results in the same engine.
- **Analysis output:** a deterministic analysis command that first replays every record, then writes `analysis.json` and a Markdown report. Re-running it reproduces both byte for byte.
- **Location:** `experiments/results/p2-08/pilot/` and `experiments/results/p2-08/confirmatory/` (P2-08's test requirement).
- **Size:** about 0.5 to 1 MB per seed per agent is expected from the P2-07 record of the example run (42 KB for 2 × 3 × 8 cars). The pilot measures the real size. If the confirmatory set would be large (for example over 20 MB), the owner chooses before the confirmatory run between committing it and committing compressed records with their hashes.
- **Engine:** one Node version for the whole study, recorded. Records from another engine are rejected on replay (AI_EVALUATION §4).

## 10. Implementation steps (each needs its own authorization)

1. **Prerequisite:** fix #89's open P3: reject unknown keys inside nested configuration blocks. A typo there would currently be dropped silently, which matters once configurations drive a study.
2. **Drivers and evaluation harness:**
   - `RandomDriver` (A1) and `CorrelatedRandomDriver` (A7) behind the existing `Driver` interface;
   - a headless `evaluateDriver` that uses the same per-tick path as the trainer.
3. **Baselines and study runner:**
   - A2/A9 from generation 0;
   - A8 equal-budget random search on the continued stream;
   - frozen-model evaluation on the training and validation tracks;
   - manifest and record formats;
   - `npm run study -- run | replay | analyse`.
4. **Pilot** (§8): run, record and report as exploratory, then the confirmatory-manifest PR.
5. **Confirmatory run:** a results PR with records, replay evidence and the report. P2-08 completion follows only from that PR.

**Tests planned for steps 2 and 3:**
- **Determinism:** A1/A7 are deterministic from their action seeds; A7 holds each action for exactly 30 ticks.
- **Stream pairing:** A8's first P samples equal A5's generation 0, and A9 equals the best of them.
- **Budgets:** A8's evaluation count equals P × G.
- **A5 champion:** the final-generation champion is the best of every generation.
- **Selection rules:** ties go to the earliest.
- **Boundaries:**
  - no held-out access, checked in source and at runtime;
  - validation is used only where §4 allows.
- **Records:** replay and rejection, as for P2-07.
- **Analysis:** checked against hand-computed paired differences, bootstrap intervals and signed-rank values on synthetic data; the bootstrap is deterministic from its seed.

**Runtime estimate** (to be measured in the pilot): `npm run demo:train` runs 50 generations of 50 cars in about 80 s, so A5 plus A8 take about 3 minutes per seed. The 10-seed confirmatory study should take about 30 minutes in Node.

## 11. Limitations stated in advance

- **Tracks:** one training track and one validation track. The study measures optimisation on the oval, not general driving. Generalisation is E6, on the held-out track, later.
- **No scenario variation:** one deterministic start pose per track. Uncertainty comes only from independent training seeds (n = 10, or 20 if the pilot requires it).
- **Configuration:** braking stays enabled. The no-brake comparison (A4) is P2-09. The fitness weights are untuned P2-06 defaults.
- **Selection by training fitness:** the primary metric correlates with fitness, so the study asks which search finds better training-track drivers for the same budget.
- **Determinism:** results are deterministic within one JavaScript engine only.
- **Scope:** nothing here changes the device-evidence limits recorded for P2-01 and P2-05, P1-10's enforcement gate, the stretch targets ST1–ST5, or the Silverstone restrictions. Silverstone stays planning-only.
