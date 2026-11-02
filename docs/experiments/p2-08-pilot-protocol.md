# P2-08 pilot protocol (plan step 4)

Status: **written before any pilot seed runs**. This document and the three manifests are reviewed by Codex before the pilot is executed. The pilot is exploratory. Its results never count towards Phase 2 acceptance, and nothing in it is evidence of learning.

## 1. What is frozen

**The manifests.** Three manifests, one per predeclared candidate (plan §8.4), are in `experiments/manifests/`:
- `p2-08-pilot-c0.json`: C0, the trainer defaults with G = 50;
- `p2-08-pilot-c1.json`: C1, the defaults with G = 100;
- `p2-08-pilot-c2.json`: C2, the defaults with mutation scale 0.5 and G = 50.

Plan §9 names a single `p2-08-pilot.json`. Three files are used instead because each candidate needs its own manifest, with its own `manifestHash`, for its records and analysis.

**What every manifest has:**
- label `pilot` and seeds `[9001, 9002, 9003]`;
- E = P = 50 and A7 hold 30;
- training track `stadium-oval` and validation track `rounded-rectangle`;
- δ = 0.25;
- the bootstrap `{10000, 20261028, 0.95}`;
- code revision `c14f36862c72463bd8eee5371d2a4ad7dad2adba`, the `main` commit containing all of step 3 (#99–#106).

Apart from the stated difference, every setting is the trainer default: P = 50, two elites, tournament size 3, uniform crossover at 0.7, and mutation rate 0.1 with scale 0.2 (0.5 for C2). Episodes are limited to 60 s, with a 5 s stall limit and 3 laps, under fitness version 1. `tests/training/pilotManifests.test.ts` rebuilds each manifest from the trainer's resolvers and requires exact equality.

## 2. How the pilot runs

1. **A clean checkout of the frozen commit.** Run `git worktree add --detach <run-dir> c14f36862c72463bd8eee5371d2a4ad7dad2adba`, then `npm ci` in it. The manifests, records and outputs live **outside** that worktree (`<work>`), so it stays clean. The `run` command refuses a pilot manifest anywhere else (C2 frozen-revision guard).
2. **One engine.** One Node 24 version for all nine runs and every replay. It is recorded in each record.
3. **For each candidate `cK` and each seed `s` in 9001, 9002 and 9003:**
   - `npm run study -- run <work>/manifests/p2-08-pilot-cK.json --seed s --out <work>/cK/seed-s.json`;
   - then `npm run study -- replay <same manifest> <work>/cK/seed-s.json`, which must exit 0.

   The wall-clock time of each run, the record size and the gzip size are noted.
4. **For each candidate:** `npm run study -- analyse <manifest> <work>/cK/seed-*.json --out-dir <work>/cK/`. That is three analyses, each acceptance-ineligible, with the decision `not evaluated: pilot analysis is acceptance-ineligible`.
5. **If any run fails, does not replay identically, or any analysis refuses its records,** the pilot stops and the failure is reported to the owner. No seed is substituted and nothing is rerun with different settings.

## 3. Decisions fixed in advance

All of the following are computed from the committed records with the merged step 3 tooling. None is tuned afterwards.

1. **Configuration choice** (plan §8.4):
   - `selectByValidation` over C0, C1 and C2, in that order. Each candidate's input is its A5 frozen models' **validation-track** gate counts for the three seeds, with the validation track's gates per lap.
   - The highest mean wins, and C0 wins ties.
   - Training-track results are not used for the choice, and no held-out track is touched.
2. **n for the confirmatory study** (plan §8.3):
   - For the **chosen** candidate, take the three pilot training-track differences `d_s = progress(A5) − progress(A8)` in laps, from its `analysis.json`.
   - Let `sd` be their sample standard deviation (n − 1 denominator).
   - The projected 95% interval half-width at n = 10 is `1.96 × sd / √10`.
   - If it is greater than δ = 0.25, the confirmatory study uses seeds 1001–1020 (n = 20); otherwise 1001–1010 (n = 10).
   - This normal-approximation projection is a planning rule only. The confirmatory analysis itself uses the predeclared bootstrap.
3. **δ:** stays at 0.25. The plan allows the pilot only to **raise** δ, and no rule for raising it is predeclared, so it is not raised.
4. **Lap check** (plan §8.5): report, descriptively, whether any of the chosen candidate's A5 training episodes completed a valid lap within the 60 s limit, with its first-lap time.
5. **Measurements:**
   - per-seed wall time;
   - the executed car-ticks the `run` command prints;
   - the record size, raw and gzip;
   - a projection of the confirmatory study's runtime and storage at the chosen n.

The confirmatory manifest itself is step 5. It is written after the pilot, and reviewed by Codex and approved by the owner before any confirmatory seed runs.

## 4. What is committed afterwards

Under `experiments/results/p2-08/pilot/`, in a separate PR after the runs:
- **for each candidate:** `cK/analysis.json` and `cK/report.md`, exactly as written by `analyse`, plus the three seed records;
- **`pilot.md`:**
  - the engine, the frozen commit and the run dates;
  - every measurement;
  - the configuration choice and the n decision, each with its inputs;
  - the lap check;
  - a statement that the pilot is exploratory, acceptance-ineligible and makes no claim.

**Record storage needs the owner's choice.** A seed record at G = 2 is about 0.17 MB. At G = 50 it is estimated at about 4 MB, and at G = 100 about 8 MB, so the nine records come to roughly 50 MB raw. Plan §9 leaves storage of large records to the owner. The recommendation is gzip-compressed records (`seed-s.json.gz`, expected to be about a tenth of the size), with the SHA-256 of each uncompressed record listed in `pilot.md`. The record's own `resultsHash` and replay still apply after `gunzip`. The alternative is to commit the raw JSON. **Chosen:** gzip records, with the SHA-256 of each uncompressed record ([relayed owner instruction, 2026-11-02](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/19#issuecomment-6579857037)).

## 5. Boundaries

- Pilot seeds 9001–9003 only. No confirmatory seed (1001–1020) is run.
- The validation track is used only for the descriptive results and for the configuration choice, as plan §8.4 requires. The held-out track is never evaluated.
- No learning, improvement or acceptance claim is made. The analyses are `not evaluated`, and `pilot.md` reports numbers only.
