# P5-01 step 3: tuning the rule-based driver on the training track

**A baseline is being fixed; this is not a learning result.** Candidates were scored on the training track only (`stadium-oval`), through the shared episode path with the trainer's own episode rules. No validation or held-out track was used, and none was needed to choose anything.

Plan: `docs/plans/p5-01-plan.md` §3 and §4. Algorithm `rule-based-v1`. Selection rule `checkpoints-then-laps-then-first-lap-then-grid-index-v1`: most ordered checkpoints, then most laps, then fastest first lap, then lowest grid index. Predeclared grid: yes (exactly the committed `TUNING_GRID`).

Results hash: `sha256:27451a5ff785dfcec49242b7416768c25bdda962018868dc01ff0819687fff51`

## Selected constants

| Agent | Constants | Outcome | Checkpoints | Laps | First lap (ticks) |
| --- | --- | --- | --- | --- | --- |
| A3 | steerGain 4, frontClear 0.3, speedCap 1, brakeFront 0.3, brakeSpeed 0.6 | timeout | 48 | 2 | 1529 (25.483 s) |
| A3-nb | steerGain 4, frontClear 0.3, speedCap 0.75 | timeout | 42 | 2 | 1699 (28.317 s) |
| A3-nb-same | steerGain 4, frontClear 0.3, speedCap 1, brakeFront 0.3, brakeSpeed 0.6 | crashed | 5 | 0 | none |

**A3-nb-same** is A3's selected constants with only the brake masked; it is derived, not tuned, and is the only brake ablation (plan §3). A3-nb was tuned separately over the same grid, so the tuned pair compares two tuned rules.

## A3: 72 variants

Outcomes: crashed 37, timeout 35. Completed at least one lap: 35/72.

## A3-nb: 18 variants

Outcomes: crashed 12, timeout 6. Completed at least one lap: 6/18.

## Limitations

- Hand tuning on a single training circuit may not transfer to other circuits; that is what E3 later asks, and nothing here predicts it.
- A finite predeclared grid: the selected constants are the best of this grid, not the best possible rule.
- Episodes are deterministic, so there are no seeds and no uncertainty estimate; the table is the whole result.
