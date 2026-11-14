# P5-01 E3 (confirmatory): evolved A5 against the hand-written rule agents

Label confirmatory; 10 independent seeds. Manifest `sha256:d72a73317a59f251aa86e804fe6f988340279c502a95ecd0cbf9e5d6f399c429`. Metric ordered-progress-gates-per-lap-v1; predeclared meaningful difference 0.25; seeds 3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009, 3010.

**Descriptive comparison of an evolved driver against a hand-written rule on the listed circuits; it supports no statement about learning or generalisation beyond them, and "no clear difference" is a valid outcome.**

## rounded-rectangle (validation)

| Rule agent | A5 − rule (mean) | 95% interval | A5 higher / tied / rule higher | Outcome |
| --- | --- | --- | --- | --- |
| A3 | 0.029 | -0.043 to 0.136 | 1 / 6 / 3 | no-clear-difference |
| A3-nb | 0.029 | -0.043 to 0.136 | 1 / 6 / 3 | no-clear-difference |
| A3-nb-same | 0.029 | -0.043 to 0.136 | 1 / 6 / 3 | no-clear-difference |

## Limits

- The rule agents are deterministic, so each contributes one value per circuit; the interval is over A5's training seeds.
- A3-nb was tuned separately from A3; only A3 against A3-nb-same is a brake ablation.
- 10 independent seeds and a few circuits: an interval is a guide, not proof.
