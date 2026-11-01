# P2-08 step 3: baseline generation and selection (A2, A9, A8)

> Status: **design, committed before the code in the same PR.** It covers part of [plan](p2-08-plan.md) step 3, under the owner's [step 3 tooling authorization](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/19#issuecomment-6560607741), limited for this PR to baseline generation and selection. It adds no manifests, persistent records, study command, statistics, dashboards or persistence. It runs no pilot or confirmatory study, uses no held-out track and claims no learning. The overall step 3 design is proposed separately in #98.

## 1. What this PR builds

`src/training/baselines.ts`, with `generateBaselines(config, seed)` for one training seed:

| Agent | Definition | Training-track evaluations |
|-------|------------|---------------------------|
| A2 | The evolutionary run's own generation 0: the P genomes `createTrainer` starts with, evaluated by the trainer itself | P (generation 0 of the run) |
| A9 | The best A2 candidate by the selection rule, copied and frozen | none extra: its A2 episode |
| A8 | P × G random networks: the trainer's generation-0 stream continued, each evaluated once | P × G |

**Selection rule** (`SELECTION_RULE = 'highest-training-fitness-earliest-v1'`): `selectBest(fitness)` returns the index of the highest training fitness, and the earliest-evaluated candidate wins ties. It never sees validation or held-out results. It is the same rule the trainer's champion uses (`rankByFitness`), and a test checks they agree.

**Scoring:** every candidate is scored on the **training track only**, through the shared episode path (`stepEpisode`: `buildInputs` → `runNetwork` → `stepRacer` → `recordTick`). A2 is scored by the trainer's own generation (`runGeneration`), and A8 by `evaluateGenome`. Fitness is `scoreEpisode` (P2-06, `fitnessVersion` 1), and ordered progress is `gatesPassed / gates`.

**Out of scope here:**
- validation-track and frozen-model evaluation;
- A1/A7 study episodes;
- A5's full run and champion;
- manifests, records, replay, the study command and the analysis.

## 2. Configuration validation

`BaselineConfig` is `{ training, generations, trackId }`:
- `training`: any `TrainingConfig` fields except `seed`, over `DEFAULT_TRAINING_CONFIG`. As in P2-07, a field that is set replaces the default whole, and nested blocks are never merged. The trainer's own resolvers validate the result, with the seed supplied separately. Unknown fields are rejected at the top level and inside the nested `selection`, `crossover`, `mutation` and `fitness` blocks, by path, using the same rule as P2-07 experiment configs (allowed keys taken from `DEFAULT_TRAINING_CONFIG`).
- `generations` (G): an integer from 1 to 10,000, the P2-07 limit.
- `trackId`: resolved with `trainingTrack` and checked again by the trainer's `assertTrainingTrack`. Validation and held-out tracks throw `TrackLeakageError`.
- `seed`: an unsigned 32-bit integer. The function does not police which seeds a study may use (that is the manifest's job, later). Tests use only mechanics seeds (7xxx), outside the pilot (9001–9003) and confirmatory (1001–1020) sets.
- Unknown top-level fields and a non-object config throw `RangeError` (`BaselineConfigError` is not needed: the existing resolvers already throw `RangeError`).

## 3. RNG ownership

- **The training seed belongs to the trainer.** `trainerStreams(seed)` (new, in `trainer.ts`) is now the only place its streams are derived:
  - `run = createRng(seed)`;
  - `initial = createRng(run.nextUint32())`.

  `createTrainer` uses it, and its results are unchanged: the step 2 pinned hashes still pass.
- **A2** is the trainer's generation 0: P calls of `initialParameters(initial)`, in index order. `generateBaselines` runs one generation of a fresh trainer and does not draw anything itself.
- **A8** (`A8_STREAM = 'p2-08-a8-continue-initial-v1'`) takes a **fresh** `trainerStreams(seed).initial` and draws P × G genomes from it in order. It never shares a generator object with the trainer, so running either cannot shift the other. Because the stream restarts from the same seed, A8's sample `i < P` is the same genome as A2's candidate `i`.
- `run`'s later draws (selection, crossover and mutation) are never used by A2, A9 or A8.
- Episodes draw nothing. No module-level generator, no `Math.random` and no `Date`.

## 4. Generation indexing and candidate identity

- **Generation indexing:** generation 0 is the initial population, and generation g is built by the g-th transition. A2 is generation 0 only. A8 has no generations: its samples are numbered `i = 0 … P × G − 1` in draw order. For reading convenience, sample `i` is in block `floor(i / P)` at position `i mod P`. Block b is not A5's generation b; only block 0 coincides with generation 0.
- **Candidate identity:** every candidate records:
  - `index` (A2: its population index in generation 0; A8: its sample number);
  - `genomeId`: `sha256:` + SHA-256 of the JSON array of its 159 parameters in parameter order, so identical genomes have identical IDs whatever their source;
  - its raw training episode result.
- **Selected models:** A9 and A8 are copied and frozen with `freezeModel(parameters, provenance)`. Their IDs commit to both parameters and provenance:
  - **A9:** agent A9, seed, generation 0, index, selection rule, track ID and track content hash;
  - **A8:** agent A8, seed, sample index, stream, selection rule, track ID and track content hash.

  A frozen model's parameters are a copy: changing the trainer's genome or another candidate cannot change it, and the model cannot be changed itself.

## 5. Budget accounting

The unit is one **episode evaluation** on the training track (AI_EVALUATION §2, plan §3).

- **Evolution side (A5's run):** P × G evaluations, counting every car of every generation. That **includes the elites re-evaluated** in generations 1 to G − 1 (eliteCount × (G − 1) re-evaluations of genomes already seen). Distinct genomes are therefore at most P × G − eliteCount × (G − 1). `generateBaselines` reports these counts:
  - `evolution.evaluations = P × G`;
  - `evolution.eliteReevaluations = eliteCount × (G − 1)`;
  - `evolution.maxDistinctGenomes`.
- **A8:** exactly P × G evaluations of P × G freshly drawn genomes. The selected model's episode is one of them, and nothing is re-run.
- **A2/A9:** P evaluations, which are the evolution side's generation 0. They are not extra, and they are counted inside the P × G.
- **Simulated car-ticks** are reported for A2 and A8 (summed episode ticks). They are not equalised.
- **Tests:** a full G-generation trainer run performs exactly P × G evaluations, with elites re-evaluated to their previous fitness. A8's counts equal P × G.

## 6. Tests

All tests use small configurations and mechanics seeds only.

- **Stream pairing:**
  - A2 equals the trainer's generation 0;
  - A8's first P genome IDs and episodes equal A2's;
  - later A8 samples equal draws P to P × G − 1 of a fresh `initial` stream;
  - `trainerStreams` leaves `run` exactly one draw in;
  - running A8 does not change a trainer's results.
- **Selection and ties:**
  - `selectBest` on hand cases (ties, single, negative) and against `rankByFitness` on random cases;
  - A9 is the best of A2, and A8's pick is the best of its samples;
  - a constructed tie selects the earliest.
- **Budgets:** the counts above, and the full-run evaluation count including the elite re-evaluations.
- **Immutability:**
  - the frozen models and their parameters cannot be changed;
  - changing a returned candidate or a trainer genome does not change a model;
  - the config passed in is not changed.
- **Isolation and determinism:** identical results for the same config and seed, also after other seeds and in another order, and different results for another seed.
- **Invalid inputs:**
  - unknown top-level and nested fields;
  - bad generations (0, 1.5, 10,001);
  - bad seeds;
  - the validation or held-out track;
  - invalid training settings, which keep the trainer's own errors.
- **Boundaries:** the code never references `heldOutTrack`, `validationTrack`, `selectByValidation`, `tracksIn`, `Math.random` or `Date`.
