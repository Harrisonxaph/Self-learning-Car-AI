# P5-04 E6 protocol (plan step 5)

Status: **preregistration, written before any E6 evaluation.** No model, random driver or rule has been evaluated for E6 on any held-out circuit, no E6 ledger exists, and no E6 result exists. This document and `experiments/manifests/p5-04-e6.json` go to Codex for review and to the owner for approval. **The E6 opening (plan step 6) is a separate, one-way step. It needs the owner's explicit go-ahead naming the `manifestHash` below**, on [#36](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/36), in the recorded Node 24.22.1 environment, once.

**E6 is exploratory and descriptive, and this document says so first.** The owner chose the shared-circuit option (recorded on #36, comment 6894760720) **after the E5 opening had happened**, so E5's results on these three circuits were known when E6 was designed (every champion crashed on every start and no champion completed a lap). The plan's protection, "E6's design frozen before E5 opens", is therefore **not available**; this manifest's label is `exploratory`, never `confirmatory`, and the code refuses a confirmatory label. E6 claims nothing about learning or braking and nothing about circuits other than these three.

Plan: `docs/plans/p5-04-plan.md`. The machinery this protocol freezes was built and reviewed before it: the A2, A1 and A7 frozen identities in the gate (#213), the pure statistics (#214), the study library (#215) and the command line (#216).

## 1. What is frozen

**The manifest:** `experiments/manifests/p5-04-e6.json` (`id` `p5-04-e6`, label `exploratory`). `tests/training/e6Manifest.test.ts` rebuilds it from the code's own resolvers and checks that it matches exactly, that the real parser accepts it, and that this document quotes the same commit and hashes.

| Item | Value | Where it comes from |
| --- | --- | --- |
| Question | do the ten evolved A5 and A4 champions complete laps on circuits they never trained on at a rate clearly above untrained networks (A2), random-action drivers (A1, A7) and the rule A3? (AI_EVALUATION E6) | plan section 3 |
| Manifest | `experiments/manifests/p5-04-e6.json`, file SHA-256 `68d13dc58218e266b732cc534d2f44d14a697fe1057c7c591147fd0349d787a7`; **`manifestHash` `sha256:4db9a3d9fccd98a1b970c9e3e05121b9b9e503b9bcdfad2186194dcb5335ccff`**, which is also the held-out protocol hash | `npm run e6 -- validate` |
| A4 and A5 | **read, not evaluated:** the ten E4 champion pairs (seeds 2001 to 2010) as already evaluated once by E5. The manifest pins the E5 manifest hash `sha256:689aead26e69d6f770481e7e0d1b6f12bc2832f578c3902f11bd452eb0f0c8b6` and the E5 record's `resultsHash` `sha256:1a5664c1ab2e3d53f0b3377cc65df69dc18d615240e182c928196512c2f9c260`; the record is parsed by the strict E5 parser against the E5 manifest and the E4 records, and kept as a private, frozen, manifest-bound snapshot | plan section 3.2 |
| A2 | per training seed 2001 to 2010, **one** frozen network: the **first genome** of that seed's generation 0 (the trainer's own initial stream), brake active; no performance is used to choose it | plan section 3.2 |
| A1, A7 | the random-action drivers (A1 a new action every tick, A7 each action held 30 ticks) with **predeclared action seeds 5001 to 5010**, unrelated to the training seeds | plan section 3.2 |
| A3 | the frozen rule (one deterministic value per circuit) | plan section 3.2 |
| Held-out circuits | **`hairpin-run`**, **`sweep-hook`**, **`hook-chicane`** (the same three as E5, epoch 4, split-manifest hash `sha256:681d603918e4db06b4c8434f9893275ae50477dd2c7735dc67a86be3dc4bfbc5`); the training configuration is E5's (C1), whose episode limits and scoring every evaluation uses | decision "shared circuits, descriptive" |
| Evaluations | 31 new agents (10 A2, 10 A1, 10 A7, A3) × 3 circuits = **93 agent-circuit evaluations of five fixed starts, 465 episodes**, each (agent, circuit) pair taken **once** through the gate; A4 and A5 are not in the gate's protocol | plan sections 3.2 and 5 |
| Deciding endpoint | the **lap-completion rate** per unit: the share of its five starts in which a lap was completed; meaningful difference **0.20** (one start in five) | plan section 3.1 |
| Inference | per circuit, per evolved class (A5, A4) against each baseline: the mean difference in **integer completed-start counts** (divided by five only for reporting); **A2 paired by training-seed label**, **A1 and A7 independent cohorts**, **A3 a constant**; percentile bootstrap, 10,000 resamples, **seed 20261115**, 95%, nearest rank; labels `evolved-higher`, `baseline-higher`, `no-clear-difference` from the interval and the margin only | plan section 3.3 |
| Descriptive only | ordered progress, the Wilcoxon (paired) and exact Mann-Whitney U (independent) summaries, the counts of units by completed starts, and a **floor annotation** (more than half the units of every class completing no lap): none decides anything and a floor never vetoes an endpoint | plan sections 3.3 and 3.4 |
| Multiplicity | 24 contrasts with **pointwise 95% intervals and no multiplicity adjustment**; a circuit-level statement for a class needs **all four** of its baseline contrasts `evolved-higher`; **no pooled headline** | plan section 3.3 |
| Decision rule | `p5-04-e6-decision-v1` (`src/training/e6Analysis.ts`) | |
| Code | `0d467bffbe2a4ff3a85700e152cee2c199e07bff`, the merge of #216 (the command line), which follows the merges of #213, #214 and #215: all of `src/` and `scripts/` are unchanged by this PR | `package.json` `engines` is `>=24 <25` |
| Authorisation | `issue-36#issuecomment-6899115006` ("Continue development", read as authorising this preregistration step only); **section 2 still requires an explicit go-ahead for the opening** | plan section 4 step 6 |
| Engine | **Node 24.22.1** (`v8 13.6.233.17-node.58`), the engine E5's record was made on: the run parses E5's record and the E4 records, which refuse another engine, and refuses to open the gate under another. Each E6 record carries its engine; replay and analysis refuse a record from another | E5 record |

## 2. How the opening would happen (not started)

This applies **only after** the owner approves the reviewed manifest and gives an **explicit go-ahead naming the `manifestHash` above**. It is a one-way action: the held-out opening happens once.

1. **A clean checkout of the frozen commit.** `git worktree add --detach <run-dir> 0d467bffbe2a4ff3a85700e152cee2c199e07bff`, then `npm ci` in it. The manifest file, which was added after that commit, is copied in or referenced from outside the worktree with its SHA-256 checked. The ledger **must** be outside the worktree, and so should the outputs. The run refuses a modified worktree and any other commit (the library's source-pin check).
2. **Read-only checks first** (they touch no held-out circuit and need no go-ahead): `npm run e6 -- validate <manifest>` must print the manifest hash above, and `npm run e6 -- pins` must equal the manifest's baseline pins.
3. **The explicit go-ahead.** Claude reports the read-only checks to the owner and **does not run step 4 until the owner writes an explicit go-ahead on #36** (a relayed instruction or an `Owner decision:` comment) naming this manifest's hash. The earlier "Continue development" authorises this preregistration only; **it cannot be pre-authorised and is not the go-ahead**.
4. **The one opening:** `npm run e6 -- run-held-out <manifest> --e5-manifest experiments/manifests/p5-02-e5.json --e5-record experiments/results/p5-02/e5/held-out.json --e4-manifest experiments/manifests/p2-09-e4.json --e4-dir experiments/results/p2-09/e4 --ledger <outside>/ledger.json --out <outside>/held-out.json --open-held-out`. **No `--force`; it never overwrites.** The claim is written under a lock before any access, so a repeat is refused; if the record cannot be written the command prints it and it is saved from there. Then `npm run e6 -- replay <manifest> <outside>/held-out.json <the same inputs>`, which must exit 0.
5. **One analysis:** create the output folder first (`mkdir <outside>/final`; E5's first analysis attempt failed on a missing folder), then `npm run e6 -- analyse <manifest> <outside>/held-out.json <the same inputs> --out-dir <outside>/final/`.
6. **Any failure stops the study and is reported to the owner before anything resumes, including a refused or failed analysis.** Nothing restarts automatically, and a failure at or after the opening is never answered by opening again: the ledger refuses it. Nothing is substituted, skipped or re-run with changed settings.

**Expected cost** (an estimate): 465 episodes of at most 60 simulated seconds, so a few minutes, plus the replay.

## 3. Result and how it is reported (fixed now)

**The result is whatever `analyse` writes, unchanged.** Per circuit the report gives each contrast's counts, difference and interval, its label and its descriptive test, the class statements, and the floor annotation where it applies. It is reported as **exploratory and descriptive**. There is no pooled headline and, if the circuits disagree, that is the result.

## 4. Limits stated before the run

- **Exploratory:** E5's results on these circuits were known (every champion crashed on every start, no lap completed), so the design was not frozen blind. Because of that saturation, the evolved cohorts' completion rate is already zero on all three circuits; the E6 contrasts can therefore separate the baselines from a rate of zero at best, and a contrast with a rate of zero on both sides is `no-clear-difference`, which is **not** equivalence.
- The champions come from one configuration (C1) on one training circuit; the circuits are geometric proxies designed by the person who wrote the agents after seeing E3 (disclosed); the five starts are not independent samples; intervals are over ten seeds only and pointwise with no multiplicity adjustment.
- A2 is an untrained network and A1, A7 and A3 are simple baselines: a result says nothing about stronger baselines.
- E6 is not a test of braking, makes no claim about learning, and does not revise E3, E4 or E5.
