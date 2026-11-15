# P5-02 E5 (confirmatory): brake against no brake on held-out circuits

Label confirmatory; 10 frozen champion pairs (seeds 2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010), 5 fixed starts per champion. Manifest `sha256:689aead26e69d6f770481e7e0d1b6f12bc2832f578c3902f11bd452eb0f0c8b6`. Decision rule p5-02-e5-decision-v2: collision (meaningful difference 0.2 in crash rate) and lap time (meaningful difference 1 s, at least 6 eligible pairs) decide; ordered progress is descriptive.

**Descriptive paired comparison of ten frozen A5 (brake) and A4 (no brake) champion pairs on the listed held-out circuits. A headline is a statement about these pairs on that circuit only: not about braking in general, other circuits or learning beyond them; "no clear difference" and "inconclusive" do not mean no effect or equivalence.**

## Headline per circuit (no pooled headline)

| Circuit | Collision (A5 − A4 crash rate): mean, 95% interval, label | Lap time (A5 − A4 s): eligible pairs, mean, 95% interval, label | Headline |
| --- | --- | --- | --- |
| hairpin-run | 0.000, 0.000 to 0.000, no-clear-difference | 0 of 10, n/a, not decided, inconclusive | inconclusive: No clear collision difference, and too few eligible pairs to decide lap time. |
| sweep-hook | 0.000, 0.000 to 0.000, no-clear-difference | 0 of 10, n/a, not decided, inconclusive | inconclusive: No clear collision difference, and too few eligible pairs to decide lap time. |
| hook-chicane | 0.000, 0.000 to 0.000, no-clear-difference | 0 of 10, n/a, not decided, inconclusive | inconclusive: No clear collision difference, and too few eligible pairs to decide lap time. |

The circuits give the same headline. There is still **no pooled headline**: each circuit is reported on its own.

## Counts (factual, descriptive; they decide nothing)

| Circuit | Agent | Crashed starts | Lap-completed starts | Progress median (laps) | Starts at or above one lap | Brake ticks / ticks | Champions that braked |
| --- | --- | --- | --- | --- | --- | --- | --- |
| hairpin-run | A4 | 50 of 50 | 0 | 0.091 | 0 | 0 / 16290 | 0 of 10 |
| hairpin-run | A5 | 50 of 50 | 0 | 0.136 | 0 | 1032 / 16682 | 4 of 10 |
| sweep-hook | A4 | 50 of 50 | 0 | 0.391 | 0 | 0 / 38753 | 0 of 10 |
| sweep-hook | A5 | 50 of 50 | 0 | 0.391 | 0 | 3861 / 36387 | 7 of 10 |
| hook-chicane | A4 | 50 of 50 | 0 | 0.217 | 0 | 0 / 23526 | 0 of 10 |
| hook-chicane | A5 | 50 of 50 | 0 | 0.217 | 0 | 3071 / 23056 | 6 of 10 |

### Lap time: matched starts, excluded starts and excluded pairs

| Circuit | Eligible pairs | Excluded pairs | Starts only A4 completed | Starts only A5 completed | Starts neither completed |
| --- | --- | --- | --- | --- | --- |
| hairpin-run | 0 of 10 | 2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010 | 0 | 0 | 50 |
| sweep-hook | 0 of 10 | 2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010 | 0 | 0 | 50 |
| hook-chicane | 0 of 10 | 2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010 | 0 | 0 | 50 |

## Reading the result

- Collision and lap time are the deciding endpoints; a lap-time decision uses only starts where both champions completed a lap and needs enough eligible pairs, otherwise it is `inconclusive` and is not replaced by another measure. A missing time is never zero and never dropped from one side only.
- A net benefit needs the other endpoint's harm excluded by its interval; one clear endpoint without that is `partial` and says which effect is unresolved.
- The champions are E4's ten pairs, so E5 is **not independent of E4's seeds**; the champions were chosen by training-circuit fitness. The five starts are scenario variation of one deterministic champion, not independent samples, and the intervals are over the ten seeds only. Intervals are pointwise per circuit; two endpoints on several circuits are not corrected for multiplicity.
- On hairpin-run both agents' median progress is below 0.25 lap and no start completed a lap (the counts above). A floor effect is a possibility that has not been tested here; the cause of a weak result is not established.
- On hook-chicane both agents' median progress is below 0.25 lap and no start completed a lap (the counts above). A floor effect is a possibility that has not been tested here; the cause of a weak result is not established.
