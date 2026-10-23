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

A4 and A5 share population size, generations, mutation settings, fitness function, physics constants and training seeds. Only the brake mask differs.

## 3. Metrics

Measured per evaluation episode and then summarised:

| Metric | Definition |
|--------|------------|
| Lap completion % | Episodes that complete at least one full lap ÷ episodes. |
| Checkpoint progress | Ordered checkpoints reached ÷ checkpoints per lap (can exceed 1 over several laps). Out-of-order crossings are ignored. |
| Collision rate | Episodes ending in a wall collision ÷ episodes. |
| Average lap time | Mean simulated seconds per completed lap (only episodes that completed a lap; always report n). |
| Best fitness | Highest fitness in the population for that generation (training track). |
| Mean population fitness | Mean fitness across the population for that generation. |
| Performance across generations | The metrics above, plotted per generation for the champion and for the population. |
| Unseen-track success | Lap completion % and checkpoint progress on held-out tracks. |

Lap time is measured in **simulation time** (ticks × DT), not wall-clock time, so device speed does not matter.

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

Held-out tracks should vary corner geometry (hairpins, chicanes, long sweepers, mirrored layouts and different widths) so that one memorised steering sequence cannot complete them. Track IDs and their split are listed in `src/data/tracks/index.json` once P4-04 exists.

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

Each guard needs a unit test that scripts the exploit (for example a car oscillating across gate 3) and asserts that fitness does not grow.

## 7. Experiments

Each experiment records: experiment ID, git commit, config (population, generations, mutation rate and scale, crossover, elitism, physics constants, sensor layout, fitness weights, max episode time), training seeds, evaluation seeds, track IDs per split, engine and version, date, and raw per-episode results (JSON in `experiments/results/`).

| ID | Question | Agents | Tracks | Seeds | Depends on |
|----|----------|--------|--------|-------|------------|
| E1 | Do random agents ever finish laps? (sets the floor) | A1, A2 | training | 10 eval seeds × population | P2-08 |
| E2 | Does evolution improve on generation 0? | A2 vs A5 across generations | training (validation once P4-04 exists) | 10 training seeds | P2-08 |
| E3 | Does evolution beat a hand-written rule? | A3 vs A5 | validation, held-out | 10 training seeds | P5-01 |
| E4 | Does braking change behaviour on the training track? | A4 vs A5 | training (validation once P4-04 exists) | 10 paired training seeds | P2-09 |
| E5 | Does learned braking improve lap time or collisions on unseen tracks? | A4 vs A5 | held-out | 10 paired training seeds | P5-02 |
| E6 | Do evolved drivers generalise? | A1, A2, A3, A4, A5 | held-out | 10 training seeds | P5-04 |

## 8. Statistical summaries

- Report median and interquartile range across training seeds, plus mean with a 95% bootstrap confidence interval (10,000 resamples, seeded).
- For paired comparisons such as A4 vs A5 with the same seeds, report the per-seed difference and a Wilcoxon signed-rank test. For unpaired comparisons use a Mann-Whitney U test. Always report n.
- Choose the hypotheses and metric for an experiment **before** running it on held-out tracks.
- With 10 seeds, treat p-values as a guide, not proof. Say "no clear difference" when that is what the data shows.
- Plots: champion and mean fitness per generation (median line with IQR band across seeds), and lap completion % per agent per track.

## 9. Results

No experiments have been run. Results will be added here with links to their raw data files.

| Experiment | Date | Commit | Result summary | Raw data |
|------------|------|--------|----------------|----------|
| — | — | — | — | — |

## 10. Known limitations (to revisit)

- A 2D kinematic model with no tyre slip may make braking unnecessary if releasing the throttle plus drag slows the car enough. P2-09 must check that the default tracks have corners where braking is physically useful. Otherwise E4 and E5 cannot show a benefit.
- Seven forward rays cannot see behind the car or around blind corners.
- Results apply to this simulator, not to real vehicles.
