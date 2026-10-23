# AI evaluation protocol

> Status: **protocol only, no results**. No simulator or training code exists yet (verified 2026-10-23). Every results table below is empty on purpose. Do not fill it in until the experiment has actually run, and record its seeds and configuration when you do.

This document explains how we tell genuine learned driving apart from luck, memorising one track, or exploiting the reward.

## 1. Claims we want to be able to make (and what each needs)

| Claim | Minimum evidence |
|-------|------------------|
| "Training improves driving on the training track" | Evolved drivers beat random and untrained baselines on lap completion and checkpoint progress over ≥ 10 independent training seeds (E1–E3). |
| "The AI drives, not just memorises" | Evolved drivers complete laps on **held-out** tracks they never trained on, at a rate clearly above baselines (E6). |
| "Learned braking helps" | With-braking drivers beat no-braking drivers on lap time and/or collision rate on held-out tracks, with all other settings matched (E4, E5). |
| "Model A is better than model B" | Both evaluated on the same track set, start conditions and evaluation seeds, with a summary statistic and spread for each. |

**Higher fitness on its own never counts as evidence of better general driving.** Fitness is a training signal tuned to one track and can be gamed.

## 2. Agents compared

| ID | Agent | Description |
|----|-------|-------------|
| A1 | Random action | Controls sampled uniformly each tick (steering −1 to 1, throttle 0 to 1, brake 0 to 1) from the seeded RNG. |
| A2 | Untrained network | 9-12-3 network with random initial weights, never evolved. This is the "generation 0" baseline. |
| A3 | Rule-based | Steers towards the side with more free space (left rays vs right rays), throttles when the front ray is clear, and brakes when the front ray is short and speed is high. Hand-written, no learning. |
| A4 | Evolved, no braking | 9-12-3 network, brake output forced to 0 during training and evaluation. |
| A5 | Evolved, with braking | 9-12-3 network, all three outputs active. |
| A6 | Human | Recorded human laps (Phase 5). These are reported separately as context, not as a statistical baseline. |
| A7 | Correlated random action | Like A1, but each sampled action is held for a fixed recorded interval (default 0.5 s) before resampling. A fairer "random driving" floor than per-tick noise, which mostly jitters in place. |
| A8 | Equal-budget random search | Sample as many random 9-12-3 networks as the evolutionary run evaluates (population × generations, same initialisation distribution and training seed list), keep the best on the training track, then select and evaluate it exactly like A5. Separates learning by evolution from picking the luckiest of many random networks. |
| A9 | Best of initial population | The best member of the evolutionary run's own generation 0 (same seed, before any selection, crossover or mutation), selected on the training track and then frozen and evaluated exactly like A5. Separates gains from evolutionary updates from simply picking the best of P random networks. |

A4 and A5 share population size, generations, mutation settings, fitness function, physics constants and training seeds. Only the brake mask differs.

The standard evolved driver is A5, with braking enabled; it is the primary evolved-neural-network cohort, not an additional independent treatment. A4/A5 comparisons train separate populations with matched budgets and paired seed lists; masking the brake of an already trained A5 is a separate inference ablation and must not be presented as no-brake training. The required comparisons use random A1, rule-based A3, standard evolved A5 and the no-brake/with-brake A4/A5 ablation; A2 provides an additional untrained control. A7, A8 and A9 are required Phase 2 baselines: A1 and A7 set the random-driving floor, A9 shows what selection alone achieves from the initial population, and A8 is the comparison Phase 2 acceptance is judged against, because the evolved champion is itself the best of many evaluations. Baseline winners are selected without access to held-out data. Claims distinguish "beats random driving" (A1/A7), "improves on selection alone" (A9) and "outperforms random search" (A8).

## 3. Metrics

Measured per evaluation episode and then summarised:

| Metric | Definition |
|--------|------------|
| Lap completion % | Episodes that complete at least one full lap ÷ episodes. |
| Checkpoint progress | Ordered checkpoints reached ÷ checkpoints per lap (can exceed 1 over several laps). Out-of-order crossings are ignored. |
| Collision rate | Episodes ending in a wall collision ÷ episodes. |
| Average lap time | Primary: mean simulated seconds for the first completed lap of each successful episode; report n and completion percentage. An all-completed-laps summary may be reported separately as a secondary measure. |
| Best fitness | Highest fitness in the population for that generation (training track). |
| Mean population fitness | Mean fitness across the population for that generation. |
| Performance across generations | The metrics above, plotted per generation for the champion and for the population. |
| Unseen-track success | Lap completion % and checkpoint progress on held-out tracks. |

Lap time is measured in **simulation time** (ticks × DT), not wall-clock time, so device speed does not matter.

Use a fixed, recorded episode duration for all agents, ending early only on the same documented collision/stagnation/lap-cap rules. Report counts for every terminal outcome. Timeouts and failures remain in the completion and collision denominators; collision rate alone cannot distinguish safe driving from idling. Report lap-time sample count together with completion percentage, and use the first completed lap per episode for the primary time comparison so fast drivers do not receive extra statistical weight. If no laps complete, lap time is unavailable, never zero. Multiply completion and collision fractions by 100 when displaying percentages.

## 4. Controlled conditions

- Fixed timestep and physics constants. Record the config hash with every result.
- Identical start pose for every car in an evaluation episode.
- Fixed maximum episode length (for example 60 simulated seconds or 3 laps, whichever comes first).
- Seeded RNG for initial weights, selection, crossover, mutation and any evaluation noise.
- Every comparison runs over the **same list of evaluation seeds**.
- Determinism is only guaranteed within one JavaScript engine because `Math.sin`, `Math.cos` and similar functions can differ slightly between engines. Run each statistical comparison in a single engine (headless Node) and record its version.

## 5. Track splits

| Split | Use | Rule |
|-------|-----|------|
| Training | Fitness during evolution | May be tuned freely. |
| Validation | Choosing hyperparameters and the champion checkpoint | Look at results, but never train on them. |
| Held-out test | Final generalisation claims only | Not used for tuning. Results reported once per agreed experiment. If held-out results drive a change, those tracks become validation tracks and new held-out tracks are made. |

Held-out tracks should vary corner geometry (hairpins, chicanes, long sweepers, mirrored layouts and different widths) so that one memorised steering sequence cannot complete them. P2-10 provides at least one built-in circuit per split before early experiments; P4-04 expands the set. Track IDs, content versions/hashes and split membership are recorded in the planned `src/data/tracks/index.json` and copied into each experiment manifest. The editor is not required for these fixtures. Training a run over multiple circuits remains optional R-06.

Choose hyperparameters and the saved champion using training/validation data, then freeze the model identifier and analysis protocol before opening the held-out results. Keep held-out tracks out of interim dashboards and automatic champion selection. Record start perturbations if used. Repeating identical deterministic episodes with the same start and model does not create independent trials: uncertainty comes primarily from independent training runs, and from genuine recorded scenario variation where present.

## 6. Preventing reward exploitation

The fitness function (P2-06) must include and test these guards:

| Exploit | Guard |
|---------|-------|
| Crossing one checkpoint back and forth | Only the next checkpoint in order counts, and only when crossed in the forward direction. |
| Idling or creeping | Episode ends if no new checkpoint is reached within a stall timeout (for example 5 simulated seconds). Speed by itself earns nothing. |
| Driving in circles | No reward for distance travelled, only for ordered checkpoint progress. The stall timeout also ends loops. |
| Driving backwards | Heading-error input and ordered gates mean backwards travel gains nothing. Optionally end the episode after sustained wrong-way driving. |
| Edge-of-gate cheese / clipping | Gates span the full road width. Collision is checked every tick, and fast cars use swept checks so they cannot tunnel through walls. |
| Exploiting episode length | Fixed maximum time, and a lap-time bonus only for completed laps. |

Suggested starting fitness (to be tuned only on training and validation tracks):

```
fitness = 1000 × checkpointsReached
        + 1000 × fractionOfWayToNextCheckpoint
        + 5000 × lapsCompleted
        + lapTimeBonus (only for completed laps, e.g. 2000 × referenceLapTime / lapTime)
        − (crashed ? 500 : 0)
```

Each guard needs a unit test that scripts the exploit (for example a car oscillating across gate 3) and asserts that repeated farming without new valid progress cannot accumulate fitness.

The suggested partial-progress term is an absolute, bounded episode value, not a sum paid every tick. Compute progress along the current ordered track segment, clamp it to [0, 1), and never accumulate repeated credit for approaching, reversing or circling near a gate. Reset it only after a valid next-gate crossing. Check wall collision and gate validity consistently within a swept tick so crossing outside the road earns no credit. Tests must distinguish legitimate new ordered progress from repeat farming; an initial bounded approach can increase fitness, while repeated oscillation without a new valid gate cannot accumulate it. Test start/finish wrapping, overlapping gates, reverse crossings and high-speed corner cuts.

## 7. Experiments

Each experiment records: experiment ID, git commit, config (population, generations, mutation rate and scale, crossover, elitism, physics constants, sensor layout, fitness weights, max episode time), training seeds, evaluation seeds, track IDs per split, engine and version, date, and raw per-episode results (JSON in `experiments/results/`).

Also record PRNG algorithm/version, simulation version, track content versions, control/normalisation settings, completed evaluation count, total simulated-tick budget, termination rules, selected frozen model IDs and validation-selection rule. Store raw episode outcomes before aggregation; keep large artifacts outside champion JSON and link them by manifest/hash.

| ID | Question | Agents | Tracks | Seeds | Depends on |
|----|----------|--------|--------|-------|------------|
| E1 | Do random agents ever finish laps? (sets the floor) | A1, A7, A2 | training | 10 eval seeds × population | P2-08 |
| E2 | Does evolution improve on generation 0, random driving and equal-budget random search? | A1, A7, A2, A9, A8 vs A5 across generations | training and validation | 10 training seeds | P2-08, P2-10 |
| E3 | Does evolution beat a hand-written rule? | A3 vs A5 | validation, held-out | 10 training seeds | P5-01 |
| E4 | Does braking change behaviour on the training track? | A4 vs A5 | training and validation | 10 paired training seeds | P2-09, P2-10 |
| E5 | Does learned braking improve lap time or collisions on unseen tracks? | A4 vs A5 | held-out | 10 paired training seeds | P5-02 |
| E6 | Do evolved drivers generalise? | A1, A2, A3, A4, A5 | held-out | 10 training seeds | P5-04 |

## 8. Statistical summaries

- Report median and interquartile range across training seeds, plus mean with a 95% bootstrap confidence interval (10,000 resamples, seeded).
- For paired comparisons such as A4 vs A5 with the same seeds, report the per-seed difference and a Wilcoxon signed-rank test. For unpaired comparisons use a Mann-Whitney U test. Always report n.
- Choose the hypotheses and metric for an experiment **before** running it on held-out tracks.
- With 10 seeds, treat p-values as a guide, not proof. Say "no clear difference" when that is what the data shows.
- Plots: champion and mean fitness per generation (median line with IQR band across seeds), and lap completion % per agent per track.

- Aggregate episodes within each independent training seed before computing cross-seed confidence intervals or significance tests. Pair A4/A5 differences by training seed; do not treat every car, tick, generation or repeated identical episode as an independent sample. Bootstrap training-seed clusters and report effect sizes and per-track results.
- Predeclare the primary metric, minimum meaningful improvement and analysis procedure in the experiment manifest before evaluation. For Phase 2, use ordered checkpoint progress as the primary metric, require the 95% seed-cluster bootstrap interval for the A5 − A8 (equal-budget random search) difference to exclude zero in the positive direction, pairing A5 and A8 by training seed and evaluation scenario (track × start); report A1/A7 as floors and A9 alongside, and report lap completion/collision alongside it; at least one valid evolved lap must be observed. Define a meaningful effect threshold on training/validation data before the confirmatory run. Fitness-only gains fail this gate.
- Negative or inconclusive results are valid experiment outputs. They do not satisfy Phase 2's demonstrable-improvement acceptance; keep that phase unaccepted and plan a follow-up rather than relabel the result. Phase 5 asks whether braking/generalisation help, so an honest supported negative conclusion can satisfy that study's reporting criteria.

## 9. Results

No experiments have been run. Results will be added here with links to their raw data files.

| Experiment | Date | Commit | Result summary | Raw data |
|------------|------|--------|----------------|----------|
| — | — | — | — | — |

## 10. Known limitations (to revisit)

- A 2D kinematic model with no tyre slip may make braking unnecessary if releasing the throttle plus drag slows the car enough. P2-09 must check that the default tracks have corners where braking is physically useful. Otherwise E4 and E5 cannot show a benefit.
- Seven forward rays cannot see behind the car or around blind corners.
- Results apply to this simulator, not to real vehicles.
