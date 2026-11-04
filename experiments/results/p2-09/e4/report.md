# P2-09 E4 analysis: p2-09-e4

- **Label:** confirmatory
- **Independent n (training seeds):** 10
- **Outcome (p2-09-e4-decision-v1):** no-direction
- **Reported as:** no direction established: the interval spans zero

Ordered progress is gates credited ÷ gates per lap, for each agent's frozen champion. The seed is the independent unit, and A4 and A5 are paired by seed (the same generation-0 population). Nothing here is a claim of general driving ability, and no held-out track was evaluated.

## Primary measure (A5 − A4, training track)

| Contrast | Track | Mean | 95% bootstrap interval | Median | IQR | Wilcoxon m | Wilcoxon p (descriptive) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A5 - A4 | training | -0.0150 | [-0.0400, 0.0100] | -0.0250 | [-0.0500, 0.0000] | 7 | 0.4531 |

Per-seed differences: 0.0000, -0.0500, 0.0500, 0.0000, 0.0000, -0.0500, 0.0500, -0.0500, -0.0500, -0.0500.

Outcome conditions (δ = 0.2500 lap), shown whether or not the analysis is reportable:
- interval lower bound above 0: no
- interval upper bound below 0: no
- mean at least δ: no
- mean at most −δ: no

A label other than a meaningful advantage means only that a predeclared meaningful advantage was not established. It does not mean "no effect" or "equivalent": the below-threshold label says the evidence shows a direction smaller than 0.25 lap, and the no-direction label says the direction is uncertain.

## Validation track (A5 − A4, descriptive: it decides nothing)

| Contrast | Track | Mean | 95% bootstrap interval | Median | IQR | Wilcoxon m | Wilcoxon p |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A5 - A4 | validation | -0.0286 | [-0.0571, 0.0000] | 0.0000 | [-0.0536, 0.0000] | 3 | 0.2500 |

Per-seed differences: 0.0000, -0.1429, -0.0714, 0.0000, -0.0714, 0.0000, 0.0000, 0.0000, 0.0000, 0.0000.

## Agents by track (descriptive)

| Agent | Track | Progress mean | Median | IQR | Lap completion | Collisions | Completed / crashed / stalled / timeout | First lap (s, n) | Mean fitness |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A4 | training | 2.4800 | 2.4750 | [2.4500, 2.5000] | 100.00% (10/10) | 0.00% (0/10) | 0 / 0 / 0 / 10 | 24.6283 (10) | 65112.5061 |
| A4 | validation | 0.3000 | 0.2857 | [0.2857, 0.2857] | 0.00% (0/10) | 100.00% (10/10) | 0 / 10 / 0 / 0 | unavailable (0) | 4109.9905 |
| A5 | training | 2.4650 | 2.4500 | [2.4500, 2.4875] | 100.00% (10/10) | 0.00% (0/10) | 0 / 0 / 0 / 10 | 24.6800 (10) | 64939.8100 |
| A5 | validation | 0.2714 | 0.2857 | [0.2857, 0.2857] | 0.00% (0/10) | 100.00% (10/10) | 0 / 10 / 0 / 0 | unavailable (0) | 3800.5115 |

## First-lap time, paired by seed (A5 − A4, seconds; only seeds where both completed a lap)

| Track | Seeds (n of N) | Mean difference |
| --- | --- | --- |
| training | 10 of 10 | 0.0517 |
| validation | 0 of 10 | unavailable |

## Brake usage (share of champion ticks with brake above 0.05)

| Agent | Track | Brake ticks / ticks | Share |
| --- | --- | --- | --- |
| A4 | training | 0 / 36000 | 0.00% |
| A4 | validation | 0 / 4264 | 0.00% |
| A5 | training | 7243 / 36000 | 20.12% |
| A5 | validation | 305 / 3962 | 7.70% |

A4 has its brake output masked, so its share is exactly 0 (checked for every seed).

## Limitations

- One configuration (C1), one training track and the seeds of this study. Validation-track results are descriptive; no held-out track was evaluated.
- A result here is a statement about the training track only. It is not evidence that learned braking improves driving on unseen tracks (E5, in P5-02) and not evidence from the feasibility check, which concerned a scripted driver.
- The Wilcoxon p-values are descriptive and never replace the bootstrap interval rule.
