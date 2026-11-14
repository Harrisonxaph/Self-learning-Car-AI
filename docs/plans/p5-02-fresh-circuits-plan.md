# P5-02 step 2b plan: fresh held-out circuits and the split-registry change (E5, ST4)

> **Status: plan only, for Codex review and the owner's merge. Creating or registering any circuit, changing the split registry, and every later E5 step need their own owner authorisation.**
> - **Authorisation:** the owner's "Continue development" (2026-11-14, after #202 merged), recorded on [#34](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/34#issuecomment-6883051343) and read as authorising **this plan only**. Codex's review of the plan correction states that this phrase does not authorise generation. The owner may reorder or correct this reading.
> - **Scope:** step 2b of the corrected P5-02 plan ([`p5-02-plan.md`](p5-02-plan.md) sections 0.1 and 0.4): the written criteria for fresh held-out circuits, how the registry records the three spent circuits as validation without breaking any recorded result, and the tests and reviews that must pass. **Not** in scope: any evaluation of any model on a fresh circuit, the E5 manifest freeze, the command line, the held-out opening, the numeric defaults of E5 (still proposed, not owner-approved), or any claim about braking.
> - **Lessons carried:** a held-out circuit is unexamined only if no result about it exists before the one look; the designer's knowledge cannot be removed, only disclosed and bounded by criteria fixed first; old records must keep their meaning (P4-04's append-only epochs); enforcement is tested for every circuit; nothing is adjusted for any model's performance.

## 1. What step 2b must deliver (plan section 0.1)

- The three circuits E3 exposed (`hairpin-chicane`, `long-sweepers`, `technical-narrow`) are recorded as **validation** circuits (development evidence for E5), following `docs/AI_EVALUATION.md`: "If held-out results drive a change, those tracks become validation tracks and new held-out tracks are made."
- **Fresh held-out circuits** exist, created **before any model is evaluated on them**, from written criteria fixed first, registered as held-out with recorded provenance and content hashes.
- **Every recorded result keeps its meaning:** E3's committed records, ledger and analysis, and every older record that names a split-manifest hash, still parse, replay and verify exactly as recorded.

## 2. What exists (inspected at `main` `1a2c3ca`)

| Need | What exists | Where | The hazard or gap |
| --- | --- | --- | --- |
| Which circuits belong to which split | `index.json` gives each circuit a `split`; `SPLIT_EPOCHS` is an append-only registry of **circuit-ID lists** (epoch 1: three circuits; epoch 2 adds four; epoch 3 adds Silverstone) | `src/data/tracks/index.json`, `src/training/trackSplits.ts` | the epochs list IDs only |
| The recorded split-manifest hash | `manifestRecord(splits, epoch)` hashes each epoch's circuits as `{id, version, split, contentHash}` **recomputed from today's entries** (the `split` is today's); a record is accepted only if its hash equals one epoch's | `src/training/experiment.ts` (`manifestRecord`, `manifestEpochOf`) | **changing a circuit's `split` today changes the hash of every epoch that lists it, so every old record would be refused.** E4 and the P2-08 records name epoch 1; **E3's manifest names epoch 2** (checked); epoch 1 and 2 both list `hairpin-chicane` as held-out |
| E3's held-out machinery | `parseE3Manifest`, `runE3HeldOut`, `replayE3HeldOutRecord` and `createHeldOutGate` take a registry argument that defaults to the built-in one and require every listed circuit to be **registered as held-out** | `src/training/e3Study.ts`, `heldOutAccess.ts`, `scripts/e3.mjs` | after reclassification the default registry no longer lists the three as held-out, so **E3's replay and parse would fail** unless they use the registry as it was at E3's recorded epoch |
| Enforcement by split | `assertTrainingTrack`, `createEvaluationSetup` (refuses held-out, including relabelled copies by geometry), `heldOutTrack`, `selectByValidation`, `classifyCustomTrack`, the evaluate and train pages | `trackSplits.ts`, `evaluation.ts`, `src/ui`, `src/tracks` | these read today's split, which is what we want for new work (the three become evaluable validation circuits, the fresh ones are refused) |
| Generation | a committed deterministic generator (`scripts/makeTracks.mjs`) from half-lap specs of straights and arcs, with `--check`; the validator `validateTrack`; per-entry `provenance` in the manifest | `scripts/makeTracks.mjs`, `src/data/tracks/specs/` | reusable as is for the fresh circuits |
| Present counts | training: `stadium-oval`, `kidney-loop`, `silverstone`; validation: `rounded-rectangle`, `s-sweepers`; held-out: the three spent circuits | `index.json` | P4-04's invariant (at least 2 training, 2 validation, 3 held-out) must still hold afterwards |
| References to the three IDs | `src` 2 files, `tests` about 28, 10 and 11 files, `docs` about 11, 7 and 7 files | repository search | the blast radius is mostly tests and documentation; each must be reviewed, none silently reworded |

## 3. Design

### 3.1 The registry change keeps history: per-epoch split labels

- **Each epoch records its own split labels.** `SplitEpoch` gains the split of each of its circuits as that epoch defined it (explicit, frozen, append-only), and `manifestRecord(splits, epoch)` uses the **epoch's labels** instead of today's `split`. Epochs 1 to 3 are written with the labels they have today (`hairpin-chicane`, `long-sweepers`, `technical-narrow` held-out), so their hashes do not change; a test **pins the three existing epoch hashes as literal values** computed before the change, including `sha256:3cb594e2…` (epoch 1, E4 and P2-08) and `sha256:4a56521e…` (epoch 2, E3).
- **Epoch 4** (append-only; introduced by P5-02 step 2b) lists epoch 3's circuits plus the fresh ones, with the three spent circuits labelled **validation** and the fresh circuits **held-out**. After it, the registry's current labels are epoch 4's: training 3, validation 5, held-out 3 (the fresh ones).
- **A registry view as of an epoch** (`splitsAsOf(epoch)`): the built-in tracks with that epoch's labels. **E3's parse, run and replay paths take the view of the epoch their manifest names** (epoch 2), so E3's committed records still verify and replay exactly, through the same gate code. Nothing re-opens E3's protocol: its ledger entry stays, and the latest registry refuses the three circuits as held-out anyway. New work (E5, the pages, enforcement) uses the latest epoch.
- This is a **behaviour-preserving refactor first (step 2b-1)**, with the registry data unchanged, so it can be reviewed and merged on its own before any circuit exists.

### 3.2 Criteria for the fresh circuits (written now, fixed before generation; defaults for the owner)

- **Count: three** (as E3), so E5 can report three circuits and P4-04's held-out invariant keeps holding.
- **Format:** closed, driven counter-clockwise like every circuit here, passing `validateTrack`, **8 to 14 m wide and 400 to 650 m long** (a bound chosen with the 60 s episode in mind; it is a geometric proxy and **does not guarantee that any driver completes a lap in that time**), made of straights and arcs by the committed generator.
- **Independent of the spent and registered circuits:** none may be identical to, or a mirror, rotation or uniform scaling of, any registered circuit, and the three differ from each other in corner class. **The existing protection is reused first:** `classifyCustomTrack`/`findRegistered` already refuse a track that matches a built-in circuit by ID, by identical geometry or by road fingerprint, and a test confirms the fresh circuits are not matched by any registered circuit's fingerprint. Step 2b-2 adds a further guard (the direction-reversed turning-angle profile) **only for what that protection lacks**, and says which case it adds.
- **Corner classes: geometry-only proxies, proposed bounds, not measured driving feasibility (hypothesis-neutral).** Each circuit must contain **a tight corner**, proposed as a centre-line arc of **radius at most 30 m turning through at least 90 degrees** (an arc of at least about 47 m), and **a fast stretch**, proposed as a continuous centre-line run of **at least 150 m** that is straight or made of arcs of radius at least 70 m. These are **proxies for corner and straight character, defined on the centre line before generation**. They do **not** guarantee any particular speed change for any driver: `src/sim/vehicle.ts` limits the curvature of the car's actual trajectory, not its speed from a centre-line radius, a path inside an 8 to 14 m road can cut a bend gentler than its centre line, and a 150 m stretch does not guarantee terminal speed. For orientation only, the default physics' steady-state terminal speed is about 23.7 m/s and a centre-line-following car at the 8 m/s^2 lateral limit would be held to about 15.5 m/s on a 30 m radius; these are **centre-line-following estimates, not circuit-wide speed limits**, and no claim rests on them. The criterion asks that the two kinds of geometry **exist**, not how any driver copes with them, so it neither favours nor defeats braking. The exact extents are a decision for the owner and Codex before generation.
- **No starting trouble:** the nominal start and the four perturbed starts of the evaluation protocol are clear of the walls (a geometric check, no model), because the gate refuses a circuit whose perturbed start touches a wall.
- **Geometry specified before anything is evaluated, then not adjusted for any model.** The specs are written from these criteria and reviewed (Codex) and approved (owner) **before generation**. After generation a spec may change only to fix a **validity** failure (the validator, a wall-touching start, the length or width bounds), recorded in the step's record; never for how any model, rule or human drives it.
- **Selection is by hand from the criteria** (default), as in P4-04. Alternative (decision 3): a seeded sampler over fixed parameter ranges, which removes designer discretion at the cost of a new generator.

### 3.3 Provenance and what "unexamined" means

- Each fresh circuit's manifest entry carries `provenance` with `introducedBy: 'P5-02 step 2b'`, `designCriteria` (this document's section 3.2) and `designedBeforeAnyEvaluation: true`. The E5 manifest parser will require that provenance for a confirmatory held-out circuit (a library follow-up under its own authorisation).
- **What is and is not claimed:** the fresh circuits are unexamined in the sense that **no result about them exists** when E5 opens them. The designer has seen E3's results and the spent circuits' geometry, which cannot be undone and is disclosed here and in the E5 report. The circuit files are public in the repository, so "unexamined" means no result, not no visibility; the boundary that holds is that **no model, tuning or selection ever runs on them before the one opening** (enforced by the existing tests and the gate).
- **No evaluation in step 2b, not even a sanity run.** Checks are geometric (the validator, lengths, widths, starts, the corner-class criterion, the similarity guard, deterministic regeneration with `--check`). Whether any agent can complete a fresh circuit is found out only by the E5 opening, and a "floor" result there is reported as such, never prevented by editing the circuits.

### 3.4 Enforcement and compatibility, tested

- **Old records unchanged:** the three epoch hashes are pinned literally; E3's committed seed, rules and held-out records, ledger and analysis parse, replay (through the epoch-2 view) and re-analyse **byte-identically**; E4 and the P2-08 records still verify through epoch 1; opening E3's protocol again is refused.
- **New enforcement for every circuit:** the three spent circuits are accepted by the evaluator and by `selectByValidation` and refused by `heldOutTrack` and the E5 manifest parser (already); the fresh circuits are refused by the trainer and the evaluator (also as relabelled copies), accepted only by `heldOutTrack` for frozen models, and appear on no page.
- **Source-scan tests** that name the restricted accessors and the spent-circuit list are updated, not weakened; every existing test that named the three circuits as held-out is reviewed one by one and either moved to the epoch-2 view or restated for validation, with the reason in the pull request.
- **Counts:** at least 2 training, 2 validation and 3 held-out (it will be 3, 5 and 3).
- **Reclassification effect on pages and on custom tracks:** the evaluate page lists the **built-in** versions of the three circuits as validation circuits; the training page still offers training circuits only. **Custom and imported copies of every built-in circuit, including the three reclassified circuits and the fresh ones, stay refused with the same generic message** (`classifyCustomTrack` and the check in `modelEvaluation`), revealing no matched circuit or split; classification is **not** weakened and gains **no** new custom-copy category. Only the built-in entries become evaluable validation circuits. A test asserts the generic refusal for a copy of each of the three reclassified circuits, of a fresh circuit and of an existing validation circuit (identical message, no split named).

## 4. Steps (each needs its own owner authorisation; this plan authorises none)

1. **This plan** (documentation only).
2. **Step 2b-1, the epoch history (code, no data change):** per-epoch split labels, the pinned epoch hashes, `splitsAsOf`, E3's paths on the epoch-2 view, the tests above for old records; no circuit and no label changes.
3. **Step 2b-2, the fresh circuits and epoch 4:** the specs (reviewed and approved before generation), the generated files, the manifest entries and provenance, epoch 4 with the reclassification, the similarity and corner-class guards, the updated tests and documentation. Opening nothing.
4. Then the E5 library follow-ups (a manifest check for the provenance), the command line, the preregistration and freeze, the opening and the results, as in the corrected plan.

## 5. What is deliberately not claimed, and the limits

- A fresh circuit is **not** shown to be easier, harder or fairer than the spent ones, and none is calibrated against any model; E5 may find a floor.
- The criteria bound the designer's discretion but do not remove it; the designer knew E3's results.
- Three circuits cannot cover track design (P4-04's limit stands); E5 would support a statement about these ten champion pairs on these three circuits only.
- Reclassifying the spent circuits as validation does not make results on them held-out evidence, and any use of them as development evidence for E5 (thresholds, mechanics) is recorded and happens before the analysis-design freeze.
- Nothing here changes E3's recorded result or its claim, and nothing claims learning or braking.

## 6. Decisions for the owner (defaults proposed; each routine unless changed)

1. **Number of fresh circuits:** three (default).
2. **Format bounds and corner-class proxies:** 8 to 14 m wide, 400 to 650 m long, at least one centre-line arc of radius at most 30 m turning at least 90 degrees and one centre-line run of at least 150 m that is straight or of arcs of radius at least 70 m (default). These are geometric proxies and guarantee no speed change or lap time for any driver. Alternative: different bounds.
3. **How the geometry is chosen:** by hand from the criteria, reviewed before generation (default); or a seeded sampler over fixed ranges.
4. **What the spent circuits become:** `validation` in epoch 4 (default, as `AI_EVALUATION.md` states); a new split kind (for example `development`) is possible but more invasive and not proposed.
5. **Epoch history by per-epoch split labels** (default) and E3 replaying through the epoch-2 view; alternative: freeze E3's records as unverifiable history (not proposed: it would lose the committed result's reproducibility).
6. **Steps:** 2b-1 and 2b-2 are authorised separately; approving this plan authorises neither. The numeric defaults of E5 itself (section 0.5 of the corrected plan) remain open.
