# P5-02 E5 protocol (plan step 5)

Status: **preregistration, written before any E5 evaluation.** No model has been evaluated on any fresh circuit, no ledger exists, and no E5 result exists. This document and `experiments/manifests/p5-02-e5.json` go to Codex for review and to the owner for approval. **The E5 opening (plan step 6) is a separate, one-way step. It needs the owner's explicit go-ahead naming the `manifestHash` below, on Node 24.22.1 (§2); nothing in this document or in the owner's approval of it starts the run.**

Plan: `docs/plans/p5-02-plan.md` (section 0 is the corrected design; sections 4 and 5), `docs/plans/p5-02-fresh-circuits-plan.md` and `docs/plans/p5-02-fresh-circuits-specs.md` (the fresh circuits). Issue [#34](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/34). The machinery this protocol freezes was built and reviewed before it: the A4 frozen identity (#201), the E5 library (#202), the epoch history (#205), the circuit specifications (#206), the command line and provenance check (#207) and the three fresh circuits with epoch 4 (#208). This pull request adds **only** the manifest, this document, a test and the documentation index: `src/`, `scripts/` and the study code are unchanged by it.

## 1. What is frozen

**The manifest:** `experiments/manifests/p5-02-e5.json` (`id` `p5-02-e5`, label `confirmatory`). `tests/training/e5Manifest.test.ts` rebuilds it from the code's own resolvers and checks that it matches exactly, that the real parser accepts it, and that this document quotes the same commit and hashes.

| Item | Value | Where it comes from |
| --- | --- | --- |
| Question | does learned braking improve lap time and/or collisions on circuits unseen by the training? (AI_EVALUATION E5) | plan section 0.2 |
| Design | **A**: the ten frozen **A4** (no brake) and **A5** (brake) champion pairs from E4, evaluated; **nothing is trained and nothing is selected** here | plan section 3 |
| Pairs | E4 seeds **2001–2010**, in order. Each pair is pinned by the content identity of its A4 and A5 frozen models and by the hash of its E4 results; the manifest records the E4 manifest hash `sha256:6abd4cb7d43661998169b43aad3f0632568fc3ab84d82358e8d5b6973ec950b0`. The champions are read from the committed E4 records (`experiments/results/p2-09/e4/`, read only) and reconstructed exactly; any mismatch with a pin stops the run before the ledger is created | plan section 3 |
| Training configuration | **C1** as E4 (P = 50, G = 100, 60 s episodes, 5 s stall limit, 3 laps, fitness version 1); every evaluation uses exactly the episode limits and scoring the champions were trained under | E4 |
| Held-out circuits | **`hairpin-run`** (`sha256:8aae2913…dc18`), **`sweep-hook`** (`sha256:0358b2c5…493b`), **`hook-chicane`** (`sha256:ea1076c0…fd40`): the three fresh circuits (#208), each carrying registered provenance (`introducedBy` "P5-02 step 2b", `designedBeforeAnyEvaluation` true). The three circuits E3 exposed are refused by the parser (they are validation circuits now) | plan `p5-02-fresh-circuits-plan.md` |
| Split epoch | the manifest pins the split-manifest hash of **epoch 4**, `sha256:681d603918e4db06b4c8434f9893275ae50477dd2c7735dc67a86be3dc4bfbc5` (3 training, 5 validation, 3 held-out circuits); the parser checks every listed circuit against that epoch | #208 |
| Starts | the evaluation protocol's **five fixed starts** per champion and circuit: the nominal start and the four perturbed starts of P4-05 (indices 0 to 4). They are scenario variation of one deterministic champion, **not independent samples** | plan section 0.2 |
| Evaluations | 10 pairs × 2 champions × 5 starts = **100 episodes per circuit, 300 in all**, each (model, circuit) pair taken **once** through the gate | plan section 4 |
| Collision endpoint | per pair, `c_s = crashRate(A5_s) − crashRate(A4_s)` over the five starts (negative favours the brake); meaningful difference **delta_c = 0.20** (one start in five) | plan section 0.2 |
| Lap-time endpoint | per pair, the mean first-lap time (simulated seconds) over the starts where **both** champions completed a lap; a pair is **eligible** only with at least one such start; at least **6 of the 10 pairs** must be eligible, otherwise the endpoint is reported `inconclusive` with the counts; meaningful difference **delta_t = 1.0 simulated second**. A missing time is never zero, never imputed and never dropped from one side only | plan section 0.2 |
| Bootstrap | seed-cluster bootstrap of the mean difference: 10,000 resamples, seed **20261114**, 95%, percentile with nearest rank; the ten seeds are the units | plan section 0.2 |
| Harm bound | an opposing endpoint counts as harmless only if its **whole interval** lies inside the harm margin (the same meaningful difference), never because it is merely non-significant | plan section 0.2 |
| Headline | exactly one per circuit: `a5-net-benefit`, `a4-net-benefit`, `a5-partial`, `a4-partial`, `mixed`, `no-clear-difference` or `inconclusive`; **no pooled headline** | plan section 0.2 |
| Descriptive only | ordered progress, crashes, lap completions and each champion's brake usage (a tick above a brake command of 0.05): they decide nothing | plan section 0.2 |
| Decision rule | `p5-02-e5-decision-v2` (`classifyE5Endpoint` and `e5Headline` in `src/training/e5Study.ts`) | plan section 0.2 |
| Code | `56d58e29260fb34994949f1d1ebdc3a312a6325f`, the merge of #208 (the fresh circuits), which follows the merges of #201, #202, #205, #206 and #207: all of `src/`, `scripts/` and the study code are unchanged by this PR | `package.json` `engines` is `>=24 <25` |
| Authorisation | `issue-34#issuecomment-6886405758` ("Continue development", read as authorising this preregistration step only); **§2 still requires an explicit go-ahead for the opening** | plan section 4 step 6 |
| Engine | **Node 24.22.1** (`v8 13.6.233.17-node.58`), the engine the E4 records were made on: the run rebuilds the champions through the E4 parser, which refuses any other engine (the read-only `validate` and `pins` commands work on any Node because they read the engine recorded in the E4 records). Each E5 record carries the engine, and replay and analysis refuse a record from another | E4 records |

**The numeric thresholds are final.** delta_c = 0.20, delta_t = 1.0 s, the 6-of-10 eligibility minimum and the harm margin were proposed in plan section 0.2 with the wording "proposed defaults, not yet owner-approved"; the owner accepted them as proposed ("Accept all as proposed (Recommended)", recorded on #34 comment 6883948447). That wording still appears in the plan and in a comment above `E5_ENDPOINTS` in `src/training/e5Study.ts`; **it is stale, the values are final, and this pull request does not change them or the code** (a comment-only correction can follow the run). They were fixed **before any fresh circuit existed** and nothing was evaluated to choose them: no development circuit was run for this protocol.

**The manifest's hashes:**
- **`manifestHash`:** `sha256:689aead26e69d6f770481e7e0d1b6f12bc2832f578c3902f11bd452eb0f0c8b6`, the SHA-256 of its canonical JSON. Every E5 record carries it, and replay, the held-out gate's protocol and analysis refuse a record made for another manifest. The held-out gate's protocol hash **is** this value.
- **The committed file's SHA-256:** `e7a39f6d1a6f8290868c731d463daa87664c9b8f4d712d0bf9b7314161155b45`.

**What the code enforces for a confirmatory manifest** (`parseE5Manifest`): exactly E4's seeds 2001–2010 in order with distinct frozen models, the C1 training configuration (a complete resolved block, no brake field), every listed circuit registered as held-out in the epoch the manifest names and hash-checked, none of the three E3-spent circuits, registered P5-02 provenance with `designedBeforeAnyEvaluation` true, the predeclared starts, endpoints, bootstrap, decision rule and brake threshold exactly, an authorisation, and a frozen commit. The pins are checked against the E4 records by `loadE5Pairs`, before the ledger is read.

### 1.1 Why all three fresh circuits (a decision for the owner)

A braking benefit that appears on one geometry says little. The three circuits differ on purpose (a hairpin run, two long large-radius sweepers into a hook, and a hook with a chicane; 9, 12 and 13 m wide) and each is reported **separately**; if they disagree the report says so and makes no pooled claim. The criteria were geometric proxies fixed before generation and reviewed (plan `p5-02-fresh-circuits-plan.md` section 3.2); they guarantee no speed change, terminal speed or lap time for any driver, the circuits are not calibrated for difficulty, and a **floor result is possible** (most champions making little progress and completing no lap). A floor result is reported as such, never prevented by editing a circuit.

## 2. How the E5 run goes (step 6, not started)

This applies **only after** the owner approves the reviewed manifest and gives an **explicit go-ahead naming the `manifestHash` above**. It is a one-way action: the held-out opening happens once. The run needs **Node 24.22.1**; the development container this protocol was written in has Node 22, so the run happens somewhere that has that engine (the owner's choice, as for E3), and every record names its engine.

1. **A clean checkout of the frozen commit.**
   - `git worktree add --detach <run-dir> 56d58e29260fb34994949f1d1ebdc3a312a6325f`, then `npm ci` in it.
   - The manifest, the E4 records, the ledger and the outputs stay **outside** the worktree where possible; the ledger **must** be outside it, so the worktree stays clean.
   - the run itself refuses a modified worktree and any other commit (the library's source-pin check), and the command line warns first about uncommitted or untracked changes.
2. **Read-only checks first** (they touch no held-out circuit and need no go-ahead):
   - `npm run e5 -- validate <manifest>`: prints the manifest hash and the held-out protocol hash; both must equal the values above.
   - `npm run e5 -- pins --e4-manifest experiments/manifests/p2-09-e4.json --e4-dir experiments/results/p2-09/e4`: the ten pairs and twenty identities must equal the manifest's pins.
3. **The explicit go-ahead.** Claude reports the read-only checks to the owner and **does not run step 4 until the owner writes an explicit go-ahead on #34** (a relayed instruction or an `Owner decision:` comment) naming this manifest's hash. The earlier "Continue development" authorises this preregistration only; **it cannot be pre-authorised and is not the go-ahead**.
4. **The one opening:** `npm run e5 -- run-held-out <manifest> --e4-manifest <e4-manifest> --e4-dir <e4-dir> --ledger <outside>/ledger.json --out <outside>/held-out.json --open-held-out`.
   - **No `--force`; it never overwrites.** The ledger is the study's memory of the look: a claim is taken under an exclusive lock and written to disk **before** the gate gives any access, so a crash, a lost record or a restart cannot hand out a second look; a repeat is refused.
   - If the claim succeeds but the record cannot be written, the command prints the complete record; it is saved from there, never recomputed through a new opening.
   - Then `npm run e5 -- replay <manifest> <outside>/held-out.json --e4-manifest <e4-manifest> --e4-dir <e4-dir>`, which replays through a separate in-memory gate and must exit 0.
5. **One analysis:** `npm run e5 -- analyse <manifest> <outside>/held-out.json --e4-manifest <e4-manifest> --e4-dir <e4-dir> --out-dir <outside>/final/`. It writes `analysis.json` and `report.md`.
6. **Any failure stops the study.** That covers a run that fails, a record that does not replay identically, an analysis that refuses its records, and any infrastructure interruption (a killed process, a session limit, a full disk).
   - **It is reported to the owner before anything resumes.** Nothing restarts automatically.
   - **A failure at or after the opening is never answered by opening again**: the ledger refuses it, and nothing in this protocol authorises a second look.
   - No pair is substituted, skipped or re-run with changed settings. Nothing is run on any other seed or circuit.

**Expected cost** (an estimate, not a measurement): 300 episodes of at most 60 simulated seconds, so a few minutes, plus the replay; nothing is trained.

## 3. Result and how it is reported (fixed now)

**The result is whatever `analyse` writes, unchanged.** Per circuit the report gives the collision endpoint's mean, interval and label (`favours-a5`, `favours-a4`, `no-clear-difference` or `inconclusive`), the lap-time endpoint's counts of eligible pairs and its own label, the excluded starts and pairs and why, each agent's completed laps, and then exactly one headline from §1. It also shows ordered progress, crashes, lap completions and brake usage, all descriptive.

- **"Learned braking helps"** may be stated only for a circuit whose headline is `a5-net-benefit`, for **these ten champion pairs on that circuit**. `a5-partial` supports only its endpoint-specific statement (for example "fewer collisions; lap-time effect unresolved"), never "helps".
- **"No clear difference" and `inconclusive` do not mean equivalence or no effect.** A negative or null result is a valid outcome and is reported as plainly as a positive one.
- **Two endpoints on three circuits are not corrected for multiplicity**; the intervals are pointwise, and the report says so.
- **No pooled headline.** If the circuits' headlines differ, the report says so and stops.
- **A possible floor** is mentioned only with the actual low-progress and lap-completion distribution shown, only as an untested possibility, never as the likeliest explanation: a crash count alone identifies no floor.

**Claims not allowed:** anything about braking in general, about other circuits, other training configurations or other seeds; any claim that a held-out result is a result about "generalising" without these limits stated; any change to the circuits, the endpoints or the thresholds because of a result; any statement that E5 completes P5-02, Phase 5 or the roadmap's research claims (P5-02 is complete only through the steps and gates in the plan, and the completion is the owner's).

## 4. Known limitations (stated before the run)

- **One configuration and one training circuit:** the champions were evolved under C1 on `stadium-oval` only, ten seeds; Phase 2's training-track-only result is unchanged and E5 does not revise it.
- **The fresh circuits were designed by the same person who wrote the agents**, who had seen E3's results (disclosed in the specifications document). They are "unseen" only because no result about them exists, not because they are invisible (the files are public). No model, rule or driver was run on them before the opening.
- **The criteria are proxies**, so a circuit may not exercise braking at all; the circuits are not calibrated for difficulty; the 60 s episode limit may bind for both agents.
- **The five starts are not independent samples**; the intervals are over the ten seeds only and, with ten seeds and three circuits, are a guide, not proof (AI_EVALUATION §8).
- **The lap-time endpoint is survivor-conditioned**: it describes only starts where both champions completed a lap, which can be few or none; it is `inconclusive` below six eligible pairs.
- The A4 and A5 champions of a seed share a training seed and differ in the brake binding (E4's design), so the pair is the unit; it is not a claim about what braking does to any other agent.

## 5. What is committed afterwards

Under `experiments/results/p5-02/e5/`, in a separate results PR for Codex review and the owner's merge: the held-out record, the ledger (as evidence the opening was taken once), the runner's log, `analysis.json` and `report.md`, **unchanged**, with a results note whose figures come only from those files; then the E5 entry in `docs/AI_EVALUATION.md`; then the completion record, which is the owner's.

## 6. Boundaries

- Only the ten E4 pairs, only these three circuits, and only after the owner approves the reviewed manifest and gives the explicit go-ahead in §2.
- The held-out circuits are evaluated **once**, through the gate, for frozen agents only.
- No claim beyond §3. No device, Silverstone, editor, P5-03, P5-04 (E6) or P5-06 work is part of this study.
- Nothing here changes physics, circuits, the trainer, the fitness, the agents or any earlier result.
