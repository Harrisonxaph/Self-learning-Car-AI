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
- **Genome diversity:** record these separately:
  - `maxDistinctGenomes = P × G − eliteCount × (G − 1)`: the **upper bound** after subtracting guaranteed elite re-evaluations (the same field name #99 already reports);
  - `actualDistinctGenomes`: the number of unique genome hashes actually observed across all evaluated generations;
  - `evaluations = P × G`: every episode evaluation, including repeated genomes.

  Duplicate offspring can make the actual distinct count lower than the bound. For example, with P = 3, G = 3 and one elite, there are 9 evaluations and an upper bound of 7 distinct genomes, but potentially only 3 actual distinct genomes if all offspring copy existing genomes.
- **Simulated car-ticks:** recorded for every agent and track. They are not equalised.
- **Counts:** a test checks that A8's evaluation count equals A5's.

### 2.4 Track boundaries

- **Training track:** `trainingTrack(trackId)`, and the trainer's `assertTrainingTrack`.
- **Validation track:** `createEvaluationSetup` on `validationTrack(id)`. It is used only for:
  - the frozen models' single episodes;
  - A1, A7 and A2's descriptive episodes.

  Nothing selects on validation in PR B1 or B2.
- **Held-out:** never touched. No code in `baselines.ts`, `agents.ts`, `study.ts`, `studyAnalysis.ts` or `scripts/study.mjs` calls `heldOutTrack` or `tracksIn`. A code-only source test checks this, and a runtime test checks that a manifest naming the held-out track is rejected.

### 2.5 B2 implementation notes (written before the B2 code)

- **Module:** `src/training/agents.ts`, not `baselines.ts`. `baselines.ts` (B1) is kept training-track only, and its source test forbids `validationTrack`. `agents.ts` is the one module allowed to call `validationTrack`. It still never calls `heldOutTrack`, `tracksIn` or `selectByValidation`, and a code-only source test checks this.
- **API:** `generateAgents(config, seed)`, where `config` is #99's `BaselineConfig` plus:
  - `validationTrackId`: must resolve with `validationTrack`;
  - `episodesPerTrack` (E): an integer from 1 to 10,000;
  - `holdTicks`: A7's hold, an integer of at least 1. The default is 30, and the step 2 driver constant is reused.

  Unknown fields are rejected by path, and eliteCount must be at least 1 (§2.2). E = P is enforced by the manifest (PR C), not here, so mechanics tests can use a small E.
- **Composition:** one `createTrainer` run for G generations is A5. Its generation 0 is evaluated **once**, and A2, A9 and A8 are built from those finished cars by B1's `baselinesFromGeneration0`. This is the same construction `generateBaselines` uses on its own, so B1's standalone results are unchanged. It adds:
  - **A5:** every car of every generation is kept in population order (`A5.generations[g][i]`). The champion is `selectBest` over the final generation, and must equal the trainer's own `championIndex` (otherwise an error). It is frozen with provenance: agent, seed, generation G − 1, index, `best-training-fitness-final-generation`, track ID and hash. A2 is A5's generation 0 itself, not a second run: a test counts one trainer and G generations per combined run. `baselinesFromGeneration0` rejects anything other than the run's finished generation 0 for the same seed, including another seed's initial genomes.
  - **Genome diversity:** `evaluations = P × G` and `maxDistinctGenomes` (from B1's budgets), and `actualDistinctGenomes` (distinct genome IDs over all A5 cars), kept separate.
  - **A1/A7:** E episodes per track, with `actionSeed('A1' | 'A7', s, e)`, the same seed on both tracks. Each episode creates a fresh driver from its own seed and runs `evaluateDriver` on that track's `createEvaluationSetup`, which uses the training configuration's own episode limits and fitness.
  - **Validation (descriptive):** each of A2's P networks, and the frozen A9, A8 and A5 models, evaluated once each with `createNetworkDriver(parameters, { brakeEnabled })`. These results are reported only. Nothing reads them to select.
  - **Ticks:** per agent and track.
- **Not in B2:** manifests, records, replay, the study command and the analysis (PRs C and D).

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

### 4.5 C1 implementation notes (written before the C1 code)

PR C is split into **C1** (`src/training/study.ts`: formats, strict parsing, compatibility and replay, as a library) and **C2** (`scripts/study.mjs`: the `run` and `replay` command line). C1 adds no command and runs nothing by itself.

- **Manifest field shapes:**
  - `configuration` is `{ generations, episodesPerTrack, holdTicks, training }`. `training` must be the complete resolved training settings (every key, nested keys exact) and must equal what the trainer's resolvers produce from it.
  - `streams` is `{ rngStreams, a8Stream, actionSeedDerivation, selectionRule, a5Selection }`.
  - `tracks` is `{ training: { id, contentHash }, validation: { id, contentHash }, splitManifestHash }`.
  - `analysis.bootstrap` is exactly `{ resamples: 10000, seed: 20261028, level: 0.95, method: "percentile-nearest-rank-v1" }`. `analysis.wilcoxon` is `"exact-signed-rank-drop-zeros-midranks-v1"`, and `analysis.decisionRule` is `"p2-08-decision-v1"`.
  - `code` is `{ revision }`: a 40-hex commit, or `null` for mechanics manifests only.
- **Label rules on top of §4.1:**
  - pilot and confirmatory manifests also need `holdTicks` = 30 and a code revision;
  - mechanics manifests may set E, `holdTicks` and P freely, and have at most 1,000 seeds.
- **Record `agents`**, the raw results:
  - `A1`, `A7`: `{ training, validation }`. Each is E episodes carrying their `actionSeed`. `A7` also records `holdTicks`.
  - `A2`: `{ candidates, validation }`. `candidates` is P × `{ index, genomeId, training }`, and `validation` is P episodes.
  - `A9`: `{ index, model, validation }`.
  - `A8`: `{ stream, samples, index, model, validation }`. `samples` is P × G candidates.
  - `A5`: `{ generations, generation, index, selection, model, validation }`. `generations` is G arrays of P candidates, so the generation boundaries are kept.
  - Every model is `{ id, parameters, provenance }`.
- **Record `budgets`**, three separate parts:
  - `planned`: P × G for evolution and for A8, E per track, `maxEpisodeTicks`;
  - `actual`: the evaluations really counted (A5, A8, A2) and the elite re-evaluations;
  - `diversity`: `evaluations`, `maxDistinctGenomes` (the bound) and `actualDistinctGenomes`.

  They also hold `ticks` per agent and track.
- **Checks on what the record means, beyond its shape:**
  - every count against the manifest;
  - candidate indices, and genome IDs in `sha256:` form;
  - A2 = A5's generation 0, and A8's first P = A2;
  - every selection recomputed with `selectBest` from training fitness only;
  - each model's genome ID equals its candidate's, its frozen ID is recomputed with `freezeModel`, and its provenance equals the expected values;
  - every action seed recomputed;
  - ordered progress = gates ÷ the track's gates;
  - episode ticks ≤ `maxEpisodeTicks`;
  - every budget and tick sum recomputed;
  - `resultsHash`.
- **Replay:** it re-runs `generateAgents` from the manifest for the record's seed, compares the canonical JSON of `agents` (up to 20 differing paths), and re-evaluates the A9, A8 and A5 models alone on both tracks against their recorded episodes.

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
