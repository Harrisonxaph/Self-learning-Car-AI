# P2-09 feasibility: braking versus coasting (scripted driver)

**Physical feasibility only.** This shows whether a scripted gate-pursuit driver gains from braking on the built-in training and validation tracks. It is not evidence that a network learns to brake (that is E4, and E5 on held-out tracks later). No held-out track was used.

Plan: `docs/experiments/p2-09-plan.md` §4. Driver: `gate-pursuit-v1`, steering look-ahead 8 m, brake only when over the speed target by more than 0.5 m/s. The two modes differ only in that brake. Episode rules: 60 s limit, 5 s stall limit, 3 laps maximum, a collision ends the episode, fitness version 1, step 0.01667 s. Deterministic: no seeds.

Grid: aLat 4, 5, 6, 7, 8 m/s², look-ahead 10, 20, 30, 40 m, vTop 16, 20, 23.7 m/s, run once per mode per track (240 episodes). This is the predeclared grid.

Results hash: `sha256:bedc67a8e1d9bea0ea669fa27c40281fa8a3bc8b39f72a06bfb681b0c62fcf47`

## stadium-oval (training)

| Mode | Variants | Crash-free first lap | Fastest crash-free first lap (s) | Its parameters | Outcomes |
| --- | --- | --- | --- | --- | --- |
| BRAKE | 60 | 56/60 (93.3%) | 25.867 | aLat 8, look-ahead 10 m, vTop 23.7 m/s | crashed 4, timeout 56 |
| COAST | 60 | 56/60 (93.3%) | 25.750 | aLat 8, look-ahead 10 m, vTop 23.7 m/s | crashed 4, timeout 56 |

Braking on this track: **not shown**: the best BRAKE lap is -0.117 s faster than the best COAST lap (negative means slower), and the required margin was 0.515 s.

## rounded-rectangle (validation)

| Mode | Variants | Crash-free first lap | Fastest crash-free first lap (s) | Its parameters | Outcomes |
| --- | --- | --- | --- | --- | --- |
| BRAKE | 60 | 6/60 (10.0%) | 24.633 | aLat 5, look-ahead 10 m, vTop 23.7 m/s | crashed 54, timeout 6 |
| COAST | 60 | 2/60 (3.3%) | 26.850 | aLat 5, look-ahead 10 m, vTop 16 m/s | crashed 58, timeout 2 |

Braking on this track: **useful, rule (ii)**: the best BRAKE lap is 2.217 s faster than the best COAST lap, and the required margin was 0.537 s.

## Acceptance A2

**Met:** braking is useful, by the predeclared rule, on at least one of the two tracks.

## Limitations

- One hand-written driver family and a finite grid: "not shown" means not shown for this driver, not that braking is useless.
- The crash-free share per mode is descriptive. Only the rule above decides.
- Nothing here is a learning result, and it says nothing about held-out tracks.
