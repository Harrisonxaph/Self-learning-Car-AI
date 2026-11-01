# P2-08 step 3 design: baselines, study records and analysis tooling

> Status: **design, written before any step 3 code.** It covers [plan](p2-08-plan.md) step 3 only, as the owner [authorised it on #19](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/19#issuecomment-6560607741). It builds **tooling**. The pilot (step 4) and the confirmatory study (step 5) are not authorised and are not run. No held-out track is used, and no learning is claimed. Where this design and the plan differ, the plan wins, and the difference is a bug to fix here.

## 1. Scope and PR split

Each PR is reviewed by Codex at its full head SHA, and each one is opened only after the one before it is approved.

| PR | Contents | Code |
|----|----------|------|
| A | This design (docs only) | none |
| B1 | **Done in #99** (merged at `aea1fdb`): A2 (the run's generation 0), A9 (its best), A8 (P × G samples on the continued stream), the shared selection rule, frozen selected models, training-track scoring and P × G accounting including elite re-evaluations. Its own design is [p2-08-baselines-design.md](p2-08-baselines-design.md) | `trainerStreams` in `trainer.ts`; `generateBaselines` in `src/training/baselines.ts` |
| B2 | The rest of the agents: A5's full run and frozen champion; A1/A7 study episodes (action seeds); frozen-model and A2 evaluation on the validation track (descriptive) | `src/training/baselines.ts` |
| C | Manifest and per-seed record formats, validation, same-engine replay, and `npm run study -- run \| replay` | `src/training/study.ts`, `scripts/study.mjs` |
| D | Deterministic analysis and Markdown report, and `npm run study -- analyse` | `src/training/studyAnalysis.ts` |

Where §2 describes A2, A9 and A8, #99's implementation and its design are authoritative. In #99, `generateBaselines` takes `{ training, generations, trackId }`, and A2 is evaluated by the trainer's own generation 0. B2 extends it without changing A2, A9 or A8.

**Not included:**
- the pilot or confirmatory manifests and runs, and any results;
- the held-out track;
- dashboards, persistence and Silverstone;
- A3, A4 and A6;
- any learning claim.

The only manifests committed are **mechanics** manifests for tests (§4).

## 2. Agents (PRs B1 and B2)

Every agent drives through the shared episode path from step 2 (`stepEpisode`: `buildInputs` → controls → `stepRacer` → `recordTick`). Training cars use the trainer, and every other agent uses `evaluateDriver`. Physics, sensors, start pose and episode rules are the same for every agent.

### 2.1 Seed ownership and streams

- **Training seed `s`:** owned by the trainer, which keeps its documented streams (`RNG_STREAMS = trainer-run-initial-then-3-per-transition-v1`):
  - `run = createRng(s)`;
  - `initial = createRng(run.nextUint32())`.
- **One source for these streams:** `trainerStreams(seed)` in `trainer.ts` (built in #99) returns `{ run, initial }`, and `createTrainer` uses it. A8 calls the same function, so the two can never drift apart. A test checks that the trainer's results are unchanged, using the step 2 pinned hashes.
- **A2 and A9:** generation 0 is the first P draws of `initialParameters(initial)`. Nothing else is drawn.
- **A8 (`A8_STREAM = 'p2-08-a8-continue-initial-v1'`):** a fresh `trainerStreams(s).initial`, continued for P × G genomes in order. A8's sample `i < P` is therefore exactly A5's generation-0 genome `i`.
- **A1 and A7 action seeds (`ACTION_SEED_DERIVATION = 'p2-08-sha256-first-32-bits-v1'`):**
  - `actionSeed(agent, s, e)` = the first 8 hex digits of `sha256Hex("p2-08|<agent>|<s>|<e>")`, read as a big-endian unsigned 32-bit integer;
  - `agent` is `A1` or `A7`, and `e = 0 … E − 1`;
  - the track is not part of the seed: the same `e` gives the same action seed on both tracks (common random numbers);
  - each episode's driver is created from its own seed and owns its generator (step 2).
- **No other randomness.** Episodes draw nothing. The bootstrap has its own generator (§5).

### 2.2 Agent definitions and selection

**Selection rule for A9, A8 and A5 (`SELECTION_RULE = 'highest-training-fitness-earliest-v1'`):** the highest training fitness, with ties going to the earliest-evaluated index. The same rule applies to all three, and it never reads validation or held-out results.

| Agent | Built as | Training-track episodes | Validation-track episodes |
|-------|----------|-------------------------|---------------------------|
| A1 | `createRandomDriver(actionSeed('A1', s, e))` | E | E |
| A7 | `createCorrelatedRandomDriver(actionSeed('A7', s, e), 30)` | E | E |
| A2 | the P generation-0 networks | P: taken from A5's generation 0, not re-run (a test checks they equal `evaluateDriver` on each network) | P |
| A9 | the best of A2 by the selection rule, frozen | its A2 episode (no extra run) | 1 |
| A8 | the best of P × G continued-stream samples, frozen | P × G (the selected model's is one of them) | 1 |
| A5 | the final generation's best by training fitness, frozen (P2-07's `best-training-fitness-final-generation`) | P × G training evaluations | 1 |

Notes on the table:
- **E (the A1/A7 episodes per training seed per track):** recorded in the manifest. Pilot and confirmatory manifests must have **E = P** (plan §3 and §7, AI_EVALUATION §7). Only mechanics manifests may set a smaller E, for fast tests (§4.1).
- **Frozen models:** `freezeModel(parameters, provenance)`. The provenance names the agent, seed, index or generation, selection rule, stream and training-track hash.
- **A5 champion check:** with at least one elite, the final champion's fitness is the highest over all generations. A test checks this. If the manifest allowed 0 elites, the check would be recorded rather than asserted, so the manifest requires eliteCount ≥ 1.

### 2.3 Budgets (recorded per seed)

- **A5 and A8:** exactly P × G training evaluations each.
- **A5's distinct genomes:** two separate numbers, both recorded, and neither is an evaluation count:
  - `maxDistinctGenomes = P × G − eliteCount × (G − 1)`, an **upper bound** (the field #99 already reports). Duplicate offspring can make the real count smaller: with crossover and mutation off, P = 3, G = 3 and one elite give a bound of 7 but at most 3 distinct genomes;
  - `actualDistinctGenomes`: the measured count of distinct genome hashes over every car of every generation.

  The evaluation count stays P × G.
- **Simulated car-ticks:** recorded for every agent and track. They are not equalised.
- **Counts:** a test checks that A8's evaluation count equals A5's.

### 2.4 Track boundaries

- **Training track:** `trainingTrack(trackId)`, and the trainer's `assertTrainingTrack`.
- **Validation track:** `createEvaluationSetup` on `validationTrack(id)`. It is used only for:
  - the frozen models' single episodes;
  - A1, A7 and A2's descriptive episodes.

  Nothing selects on validation in PR B1 or B2.
- **Held-out:** never touched. No code in `baselines.ts`, `study.ts`, `studyAnalysis.ts` or `scripts/study.mjs` calls `heldOutTrack` or `tracksIn`. A code-only source test checks this, and a runtime test checks that a manifest naming the held-out track is rejected.

## 3. Episode result shape

Every episode is stored raw, with:
- outcome, ticks, `gatesPassed`, `lapTicks`, `crashed`, `partialProgress`;
- the fitness breakdown (the P2-07 `CarResult` shape);
- `orderedProgress = gatesPassed / gates`.

A1 and A7 episodes also carry their action seed. A first-lap time is derived later from `lapTicks[0]` × timestep; it is never stored as 0 when there is no lap.

## 4. Manifests, records and replay (PR C)

### 4.1 Manifest (`self-driving-ai-evolution/p2-08-manifest` v1)

**Fields:**
- `id`, `label` (`mechanics` | `pilot` | `confirmatory`), `description`;
- `agents`: exactly `["A1","A7","A2","A9","A8","A5"]`;
- `seeds`;
- `configuration`: generations G, the complete resolved training settings (P2-07's rules, nested keys checked), episodes per track E, and A7's `holdTicks` (30);
- `streams`: `RNG_STREAMS`, `A8_STREAM`, `ACTION_SEED_DERIVATION`, `SELECTION_RULE`;
- `tracks`: training and validation IDs and content hashes, and the split-manifest hash;
- `metric`: `ordered-progress-gates-per-lap-v1`;
- `analysis`:
  - δ (≥ 0.25 lap);
  - the bootstrap settings: resamples 10,000, seed 20261028, level 0.95, percentile method (§5);
  - the Wilcoxon convention ID;
  - the decision rule ID;
- `code`: the commit the manifest was frozen at (`null` for mechanics manifests).

**Validation (`StudyManifestError`):**
- Unknown or missing fields are rejected at every level.
- `trainingTrack` and `validationTrack` must resolve to a training and a validation track. The held-out track, or any copy of it, is refused (`TrackLeakageError`).
- δ must be at least 0.25 (the pilot may only raise it).
- eliteCount must be at least 1.
- `pilot` and `confirmatory` manifests must have E equal to the population size P. A `mechanics` manifest may set E independently.

**Pilot and confirmatory separation, enforced on the seeds:**
- `pilot`: a non-empty subset of 9001–9003.
- `confirmatory`: exactly 1001–1010 or 1001–1020.
- `mechanics`: seeds outside 1001–1020 and 9001–9003. Tests use 7xxx seeds.

**The manifest hash** is `sha256:` + SHA-256 of its canonical JSON. Every record carries it.

### 4.2 Per-seed record (`self-driving-ai-evolution/p2-08-seed-record` v1)

**Fields:**
- `manifestHash`, `seed`, `recordedAt` (ignored on replay);
- `source` (revision, dirty, appVersion);
- `engine` (name, version, V8);
- `contracts`: P2-07's `currentContracts()`, plus the A1/A7 algorithm, `A8_STREAM`, `ACTION_SEED_DERIVATION`, `SELECTION_RULE` and the evaluation config;
- `budgets` (§2.3);
- `agents`: the raw episodes per agent and track (§2.2, §3), the frozen models (ID, all parameters, provenance) and the selected indices;
- `evaluations`: `{ validation: "descriptive", heldOut: "none" }`;
- `resultsHash`: a SHA-256 of the canonical JSON of `agents`.

**Expected size:** about 2 × 2,500 raw training episodes per seed at the defaults (A5 and A8), plus 2 × 2 × E for A1 and A7, plus about 2 × P for A2. The pilot (step 4) measures the real size.

### 4.3 Parsing and replay

**Parsing** checks everything before anything runs, as P2-07 does:
- `StudyRecordError` for a malformed or incomplete record, including counts and budgets that disagree with the manifest, and a stale `resultsHash`;
- `StudyCompatibilityError` for another engine, other contracts, or another manifest hash.

**Replay** re-runs the seed from the manifest and compares the canonical JSON, naming up to 20 differing paths. Each frozen model is re-evaluated alone and compared with its recorded episodes. Determinism is promised within one engine only.

### 4.4 Command line (`scripts/study.mjs`, like `scripts/experiment.mjs`)

- `npm run study -- run <manifest.json> --seed <s> --out <record.json> [--force]`
- `npm run study -- replay <manifest.json> <record.json>`
- `npm run study -- analyse <manifest.json> <record.json>… --out-dir <dir>` (PR D)

Exit codes: 0 for success or an identical replay, 1 for a replay that differs, 2 for invalid, incompatible or unreadable input. Tests run the command line only on mechanics manifests with tiny P, G and E.

## 5. Analysis and report (PR D)

The input is a manifest and one record per manifest seed. Every record is first parsed and **replayed**, so the analysis never reads a record that does not reproduce. It refuses missing, duplicate or extra seeds.

**Per seed s and track** (aggregated as in plan §7):
- A1, A7: the mean ordered progress over E episodes;
- A2: the mean over P networks;
- A9, A8, A5: the single episode.

Lap completion, collisions, outcome counts and first-lap times (with sample counts) are summarised per agent and track.

**A5 across generations** (plan §5, AI_EVALUATION §3 and §8): for each generation g, each seed's best and mean training fitness is taken from its recorded generation g. The records keep A5's episodes per generation, in population order. These values are summarised across seeds by the median and IQR (type 7). The report shows them as a table by generation. It is descriptive only: rising fitness is a training signal, never evidence of learning.

**Primary contrast:** `d_s = progress(A5, s) − progress(A8, s)` on the training track. The seed is the unit.
- **Mean and 95% percentile bootstrap:**
  - B = 10,000 resamples of the n seeds, with replacement;
  - each resample draws n indices with `rng.int(0, n)` from `createRng(20261028)`, in order;
  - the B resample means are sorted ascending, with the nearest-rank percentiles: lower = sorted[⌈0.025·B⌉ − 1] and upper = sorted[⌈0.975·B⌉ − 1].
- **Median and IQR:** linear-interpolation quantiles (type 7: position (n − 1)·q).
- **Exact Wilcoxon signed-rank (descriptive), as plan §6:**
  - zeros are dropped, and m is reported;
  - midranks are used for ties;
  - W is the sum of the signed midranks;
  - all 2^m sign assignments are enumerated, using doubled ranks as integers so sums are exact;
  - two-sided p = #{|W| ≥ |W_obs|} / 2^m, compared with a 1e-9 tolerance;
  - m = 0 gives p = 1 and "no non-zero differences".
- **Acceptance eligibility, checked before the decision rule.** `acceptanceEligible` is true only when:
  - the manifest's `label` is `confirmatory`;
  - its seeds are exactly 1001–1010 or exactly 1001–1020;
  - there is one replayed record for every one of those seeds, so the independent n is 10 or 20.

  The plan makes the pilot exploratory, never counted towards acceptance, and Phase 2 needs at least 10 independent training seeds. A `mechanics` or `pilot` analysis is therefore always **acceptance-ineligible**. It still computes every descriptive statistic, including `d_s`, the interval and the Wilcoxon test. Its decision is `"not evaluated: <label> analysis is acceptance-ineligible"`, never a claim.
- **Decision rule (`p2-08-decision-v1`).** It is applied only when `acceptanceEligible` is true, and every condition is required:
  1. the CI lower bound > 0;
  2. mean `d_s` ≥ δ;
  3. at least one A5 frozen model completes a valid lap on the training track;
  4. A1, A7, A2 and A9, lap completion and collisions are all present in the report.

  Otherwise the result is "negative or inconclusive". It is never relabelled.
- **What `analysis.json` and `report.md` both state at the top:** the manifest label, the independent n (the number of training seeds), `acceptanceEligible`, and the decision, with the reason it is "not evaluated" when the analysis is ineligible.
- **Secondary contrasts:** A5 − A8 on the **validation** track, and A5 − A9, A5 − A2, A5 − A1 and A5 − A7 on both tracks. Each is a paired per-seed difference, with the same seed-level bootstrap. They are described only, and never used for the decision or for any claim.
- **Pilot helper:** choosing a configuration (plan §8.4) by `selectByValidation` on validation progress means, with ties going to C0. It only reads validation episodes, and nothing is chosen in this PR.

**Outputs:** `analysis.json` (canonical JSON) and `report.md`.
- Both are deterministic: re-running reproduces them byte for byte. The report has no dates or timings.
- The report's wording follows plan §6:
  - the decision rule produces exactly one claim: "outperforms equal-budget random search" (A5 − A8 on the training track), and only for an acceptance-eligible confirmatory analysis in which all four conditions hold. A mechanics or pilot analysis never produces it, whatever its numbers. Otherwise the report says "negative or inconclusive". The other conditions require the remaining results to be reported, not that A5 beat them;
  - the A1/A7, A9, A2 and validation contrasts are reported as numbers (mean, interval, median and IQR), under a heading that says they are descriptive. The report never turns them into claims such as "beats random driving" or "improves on selection alone", because the decision rule does not test them;
  - nothing is ever stated as general driving ability.

**Tests use synthetic data only:**
- hand-computed paired differences, means, medians and IQRs;
- bootstrap bounds against an independent re-implementation, and determinism from the seed;
- Wilcoxon cases: all zero (p = 1), all positive (p = 2/2^m), a single non-zero difference, tied absolute values and mixed signs, against hand-computed values;
- every decision-rule branch, and that only the A5 − A8 claim phrase can appear, and only when all four conditions hold;
- eligibility: synthetic mechanics (n = 1, d = [1]) and pilot (n = 3, d = [1, 1, 1]) inputs that pass all four numerical conditions report `acceptanceEligible: false`, "not evaluated" and no claim, in both outputs. So do a confirmatory manifest with a missing seed and one with the wrong seed set. A complete 10-seed synthetic confirmatory cohort is the only case that can emit the claim;
- the A5 per-generation median and IQR, and the validation A5 − A8 contrast, on synthetic records;
- byte-identical reports.

No real study output exists or is produced.

## 6. Tests shared by PRs B to D

- **Determinism:** the same manifest and seed give an identical record, also in another order and alongside other seeds.
- **Stream pairing:** A8's first P samples equal A5's generation 0, and A9 is the best of them.
- **Budgets:** A8 evaluations = P × G = A5 evaluations.
- **Selection:** ties go to the earliest, and the same rule holds for A5, A8 and A9.
- **Records:** replay is identical, and an edited record is rejected (stale hash), detected as differing (consistent edit), or reported as incompatible (engine, contracts, manifest).
- **Boundaries:**
  - the held-out track is never referenced in code and is rejected at runtime;
  - validation is never used for selection;
  - pilot, confirmatory and mechanics seed ranges are enforced.
- **Mechanics seeds only:** every test uses seeds outside 1001–1020 and 9001–9003, and a test checks that.
