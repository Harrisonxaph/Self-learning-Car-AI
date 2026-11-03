# P2-09 E4 protocol (plan step 6)

Status: **preregistration, written before any E4 seed runs.** This document and `experiments/manifests/p2-09-e4.json` go to Codex for review and to the owner for approval. **The E4 run (plan step 7) needs the owner's separate authorisation and approval of the reviewed manifest, and the owner's reconfirmation of the storage format in §4.** Once that approval is given, nothing in the manifest or in §3 below changes. Preparation was [authorised by the owner](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/20#issuecomment-6615763036), after #117 merged and `main` CI passed. **No E4 seed (2001–2010) has been run.** Nothing in this PR runs a study.

## 1. What is frozen

**The manifest:** `experiments/manifests/p2-09-e4.json` (`id` `p2-09-e4`, label `confirmatory`). It is the plan's §5 study written out for the E4 study kind that [#117](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/117) merged. `tests/training/e4Manifest.test.ts` rebuilds it from the code's own resolvers and checks that it matches exactly.

| Plan item | Value | Where it comes from |
| --- | --- | --- |
| Question | "Does braking change behaviour on the training track?" (AI_EVALUATION E4) | plan §5 |
| Agents | **A4** (evolved with the brake output masked) and **A5** (evolved with it on) | plan §5 |
| Brake masks | **A4 `false`, A5 `true`**, fixed by the study kind (`E4_BRAKE`) and written into the manifest as `brake`. The shared training configuration has no `brakeEnabled`. Each frozen model carries its own value in `provenance.brakeEnabled`, so it is part of the model's identity, and it is replayed with exactly that value. | plan §3, option A |
| Configuration | **C1**: the trainer defaults, P = 50, **G = 100**, two elites, tournament 3, uniform crossover 0.7, mutation rate 0.1 and scale 0.2; 60 s episodes, 5 s stall limit, 3 laps, fitness version 1 | plan §5; the same C1 as the P2-08 confirmatory manifest |
| Seeds | **n = 10, seeds 2001–2010**, in order. The seeds are paired: for one seed, A4 and A5 start from the identical generation-0 population and then evolve **separately** | plan §5 and AI_EVALUATION §7 |
| Search budget | **P × G = 5,000 evaluations for each of A4 and A5 per seed**, so equal by construction (50,000 each over ten seeds). The record parser checks it. | plan §5 |
| Tracks | training `stadium-oval`, validation `rounded-rectangle`, with split hashes. The held-out track is never used. | plan §5 |
| Metric | ordered progress (gates credited ÷ gates per lap) of each agent's frozen champion on the **training track**, in laps | plan §5 |
| Primary measure | `d_s = progress(A5_s) − progress(A4_s)` for each seed `s` | plan §5 |
| Bootstrap | 10,000 resamples, seed **20261103**, 95%, percentile with nearest rank | plan §5 |
| Wilcoxon | exact signed-rank, zeros dropped, midranks; descriptive only | plan §5 |
| Meaningful threshold δ | **0.25 lap**, fixed (the manifest parser rejects any other value) | plan §5 |
| Decision rule | `p2-09-e4-decision-v1` (`training/e4Analysis.ts`) | plan §5 |
| Brake-usage threshold | a tick counts as braking when the brake command is above **0.05** | plan §5 |
| Code | `309606550957c01e9e199f7a06f676d62210add3`, the merge of #117 (E4 tooling, with Codex's independent technical approval of its head `c2b563a`, and `main` CI passed) | `src/`, `scripts/` and the study code are unchanged on `main` since; this PR adds only the manifest, this protocol, tests and docs |
| Engine | **Node v24.22.1**, the same for every seed, replay and analysis | plan §5; recorded in each record, and replay and analysis refuse a record from another engine |

**The manifest's hashes:**
- **`manifestHash`:** `sha256:6abd4cb7d43661998169b43aad3f0632568fc3ab84d82358e8d5b6973ec950b0`, the SHA-256 of its canonical JSON. Every E4 record carries this value, and `replay` and `analyse` refuse a record made for another manifest. The test pins it.
- **The committed file's SHA-256:** `6b26131552cd22c46dafd9feb21cc81e8162fe4cbcd1b9e1b0dfdacba2e5d698`.

**What the code enforces for a confirmatory manifest** (`parseE4Manifest`): exactly seeds 2001–2010 in order, 100 generations, the C1 training configuration, the oval and the rounded rectangle, δ = 0.25, a frozen commit, and the fixed per-agent brake setting. A held-out track is refused with `TrackLeakageError`. The tests check each of these without running a seed.

## 2. How the E4 run goes (step 7, not started)

This applies **only after** the owner approves the reviewed manifest and authorises the run. It follows the P2-08 confirmatory procedure, with plan §7's failure handling:

1. **A clean checkout of the frozen commit.**
   - Run `git worktree add --detach <run-dir> 309606550957c01e9e199f7a06f676d62210add3`, then `npm ci` in it.
   - The manifest, records and outputs stay **outside** that worktree, so it stays clean.
   - `npm run e4 -- run` refuses a confirmatory manifest from a dirty worktree, or from any other commit.
2. **One engine.** Node v24.22.1 runs every seed, replay and analysis.
3. **Detached from the start.** The sequence is started by a logged, detached runner (for example `setsid nohup`), so a session limit cannot kill it (plan §7, learned from #110). Each command's output goes to a log file.
4. **For each seed `s`, from 2001 to 2010 in order:**
   - `npm run e4 -- run <work>/p2-09-e4.json --seed s --out <work>/seed-s.json`;
   - then `npm run e4 -- replay <same manifest> <work>/seed-s.json`, which must exit 0.

   For each seed, note the run's wall time, the car-tick accounting that `run` prints (search, validation and verification ticks), the raw size, the gzip size and the SHA-256 of the uncompressed JSON.
5. **One analysis:** `npm run e4 -- analyse <manifest> <work>/seed-2001.json … <work>/seed-2010.json --out-dir <work>/`. It replays every record again, then writes `analysis.json` and `report.md`.
6. **Any failure stops the study.** That covers a run that fails, a record that does not replay identically, an analysis that refuses its records, **and any infrastructure interruption** (a killed process, a session limit, a full disk).
   - **It is reported to the owner before anything resumes.** Nothing restarts automatically.
   - Re-running a deterministic step needs the owner's written go-ahead, as a relayed instruction. #110's exception applied to that study only.
   - **No seed is substituted, skipped or re-run with changed settings.** Nothing is run on any other seed.

**Expected cost** (an estimate, not a measurement): the plan estimates about 4–5 minutes per seed, from the P2-08 confirmatory run (a comparable 10,000 evaluations per seed took 220–279 s), about the same again for replays, and one analysis; the whole study is about 2–2.5 hours, run one seed at a time. No E4-sized run has been made, so this is unmeasured until the study.

## 3. Result and how it is reported (fixed now)

**The result is whatever `analyse` writes, unchanged.** The primary contrast is the ten paired training-track differences `d_s`. The report gives the mean with its 95% percentile bootstrap interval, the median and IQR, and n. It gives **exactly one** of four labels, in these words:

| Condition | Reported as |
| --- | --- |
| interval lower bound above 0 **and** mean ≥ 0.25 lap | "A5 (braking) reached meaningfully more training-track progress than A4" |
| interval upper bound below 0 **and** mean ≤ −0.25 lap | "A4 (no braking) reached meaningfully more training-track progress than A5" |
| interval excludes 0 **but** \|mean\| < 0.25 lap | "A5 reached more training-track progress than A4, but the difference is below the predeclared 0.25-lap meaningful threshold" (or "A4 … than A5 …", by the sign) |
| interval includes 0 | "no direction established: the interval spans zero" |

The four rows are exhaustive and mutually exclusive, and the comparison is exact (the differences are whole numbers of gates, so a mean of exactly 0.25 lap counts as meaningful, and ten differences of exactly +0.20 lap give the third row, not the fourth).

**What the labels mean.** Every report states the actual mean, interval, median, IQR and n, whatever the label. **Neither of the last two rows means "no effect" or "equivalent".** They mean only that a predeclared meaningful advantage was not established. The third row says the evidence shows a direction smaller than the threshold; the fourth says the direction is uncertain. A result is never relabelled, and the study is never re-run with other seeds, tracks or settings to change it.

**Reported but not tested** (descriptive, both tracks, paired by seed):
- first-lap time, only for seeds where both agents completed a lap, with n;
- lap completion, collisions and terminal outcomes;
- **brake usage**, the share of each champion's ticks with brake above 0.05. A4's must be exactly 0, and the parser and the analysis both check it.
- the validation-track contrast, and the Wilcoxon p-values. Validation results never decide anything.

**Claims allowed:** only the outcome wording above, on the training track, plus descriptive validation results.

**Claims not allowed:**
- any held-out or generalisation claim;
- any claim that learned braking improves unseen-track driving (E5, in P5-02);
- any claim from the feasibility check about learned behaviour;
- any statement that E4 decides Phase 2 acceptance. It does not.

### The training-track feasibility limitation (carried forward)

The braking feasibility check (plan §4, [#116](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/116), acceptance A2) found:

| Track | Best BRAKE lap | Best COAST lap | Gain | Margin required | Braking |
| --- | --- | --- | --- | --- | --- |
| `stadium-oval` (training) | 25.867 s | 25.750 s | −0.117 s | 0.515 s | **not shown** |
| `rounded-rectangle` (validation) | 24.633 s | 26.850 s | +2.217 s | 0.537 s | useful, rule (ii) |

A2 was met **on the validation track only**. On the training track, which is the track E4's decision uses, a scripted driver that coasts did as well as one that brakes. So:
- **A null or below-threshold E4 result on the oval is a plausible outcome, and is not surprising.** It would not show that braking is useless: the check covers one hand-written driver family on a finite grid, and "not shown" means not shown for that driver.
- An A5 advantage that appears only on the validation track is a descriptive result. It cannot be turned into a result by choosing a different track or measure after the fact.
- **No track, physics or condition is changed because of a result.** Any redesign needs the owner's approval and a version bump before a fresh study, and is never chosen using held-out results.
- The feasibility check was physical feasibility of a scripted driver. It says nothing about what a network learns, and E4 does not rest on it.

## 4. Storage (owner's choice before the run)

The plan (§5) names gzip storage, as in the owner's P2-08 choice, and says **the owner reconfirms it when approving the run.** The plan estimates about 5–7 MB raw per record (A4 and A5 together keep every candidate of every generation), so about 50–70 MB raw for ten records.

**Proposed (to be reconfirmed):**
- Store each record compressed with `gzip -9 -n` as `seed-s.json.gz`, about 0.7 MB each.
- List the SHA-256 of each **uncompressed** record in the results summary. `gunzip` restores the exact bytes, so `resultsHash`, `replay` and `analyse` still apply (they read the uncompressed JSON).
- The sizes are the plan's estimates, not measurements; the run records the actual raw and gzip sizes and checksums.

The alternative is to commit the raw JSON. **The owner's choice is needed together with the approval to run.**

## 5. Execution accounting

The record keeps the equal search budget apart from the checks, and the run reports all of it:

| Quantity | Planned | Where it is recorded |
| --- | --- | --- |
| Search evaluations | 5,000 per agent per seed (P × G); 50,000 per agent, 100,000 in all | `budgets.planned.evolutionEvaluations` and `budgets.actual.evaluations` (A4 and A5 must each equal it) |
| Elite re-evaluations | 2 × 99 = 198 per agent per seed (inside the 5,000) | `budgets.actual.eliteReevaluations` |
| Distinct genomes | at most 5,000 − 198 per agent per seed | `budgets.diversity` |
| Validation episodes | one per agent per seed (20 in all) | `agents.<A>.validation` |
| Verification episodes | one per agent per seed (20 in all): each frozen champion driven alone once more on the training track, to count its brake usage and check that it reproduces itself | `budgets.actual.verificationEpisodes` |
| Car-ticks simulated | not predeclared (they depend on the evolved drivers); reported in full as **search + validation + verification** | `budgets.ticks.<A>.training`, `.validation` and `.verification`; `npm run e4 -- run` prints the total and its three parts |

The parser recomputes each of the three tick counts from the record's own episodes and rejects an edited total, and a test (`tests/training/e4Accounting.test.ts`) checks that they add up to every tick the simulator actually stepped. The study summary reports each seed's wall time, the three subtotals, the sizes and the checksums.

## 6. What is committed afterwards

Under `experiments/results/p2-09/e4/`, in a separate results PR for Codex review and the owner's merge:
- the ten records, in the storage format chosen in §4;
- `analysis.json` and `report.md`, exactly as `analyse` wrote them;
- `e4.md`, covering:
  - the engine, the frozen commit and the run dates;
  - every measurement, and the full execution accounting;
  - the outcome label and its conditions, quoted from `analysis.json`;
  - the training-track feasibility limitation above and the boundaries in §7.

P2-09's completion follows only from that merged results PR and the other AGENTS.md gates (plan §8 step 8), and Phase 2 is not Complete until P2-09 is. `docs/AI_EVALUATION.md`'s E4 entry is filled only from the merged results PR.

## 7. Boundaries

- Seeds 2001–2010 only, and only after the owner approves the reviewed manifest and authorises the run. No other seed is used.
- The validation track is descriptive only. The held-out track (`hairpin-chicane`) is never evaluated: that is E5, in P5-02, and needs its own preregistration.
- No claim beyond what §3 allows. No device, Silverstone or research-entry work is part of this study.
- Nothing here changes physics, tracks, the trainer, the fitness or the P2-08 results.
