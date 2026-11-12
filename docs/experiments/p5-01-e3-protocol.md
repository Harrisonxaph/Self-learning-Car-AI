# P5-01 E3 protocol (plan step 5)

Status: **preregistration, written before any E3 seed runs and before any validation or held-out evaluation of any E3 agent.** This document and `experiments/manifests/p5-01-e3.json` go to Codex for review and to the owner for approval. **The E3 run (plan step 6) is a separate step. It needs the owner's explicit go-ahead naming the reviewed manifest hash (§2), and it opens the held-out boundary once.** After that approval, nothing in the manifest or in §3 changes.

Plan: `docs/plans/p5-01-plan.md` §4 (steps 5 and 6) and §7. Issue [#33](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/33). The rule-based driver (step 2, #151 line of work), its tuning (step 3) and the E3 machinery (steps 4a, 4b and 4c: the held-out gate, the E3 study kind and the `npm run e3` command line) are merged and **frozen at the commit below**.

## 1. What is frozen

**The manifest:** `experiments/manifests/p5-01-e3.json` (`id` `p5-01-e3`, label `confirmatory`). `tests/training/e3Manifest.test.ts` rebuilds it from the code's own resolvers and checks that it matches exactly, and checks that this document quotes the same commit and hashes.

| Item | Value | Where it comes from |
| --- | --- | --- |
| Question | "Does evolution beat a hand-written rule?" (AI_EVALUATION E3) | plan §1 |
| Agents | **A5** (evolved, brake on, ten independent training seeds) against **A3**, **A3-nb** and **A3-nb-same** (hand-written rule agents, each deterministic) | plan §3 |
| Rule agents | frozen by content hash in the manifest (`rules`): A3 `sha256:76b52c87…617e`, A3-nb `sha256:4fea22ca…9d9d`, A3-nb-same `sha256:94de7fed…25cc` (full values in the manifest). Constants are the tuning record's (`docs/experiments/p5-01-tuning.md`): A3 steerGain 4, frontClear 0.3, speedCap 1, brakeFront 0.3, brakeSpeed 0.6; A3-nb steerGain 4, frontClear 0.3, speedCap 0.75 (no brake); **A3-nb-same is A3's constants with only the brake masked, the only brake ablation** | plan §3 and step 3 |
| A5 configuration | **C1**: the trainer defaults, P = 50, **G = 100**, two elites, tournament 3, uniform crossover 0.7, mutation rate 0.1 and scale 0.2; 60 s episodes, 5 s stall limit, 3 laps, fitness version 1; the brake output is on (`brakeEnabled` true, recorded in each frozen model's provenance) | the same C1 as the P2-08 confirmatory and E4 manifests |
| A5 champion | the generation-99 champion by training fitness (`A5_SELECTION`), frozen with `freezeModel`; nothing is selected on validation or held-out data | plan §3 |
| Seeds | **n = 10, seeds 3001–3010**, in order; a block reserved in `study.ts` and not used by any other study (pilot 9001–9003, P2-08 1001–1020, E4 2001–2010) | plan §4 |
| Tracks | training `stadium-oval` (A5 evolves here; A3 and A3-nb were tuned here); validation `rounded-rectangle`; held-out **`hairpin-chicane`, `long-sweepers`, `technical-narrow`** (§1.1) | plan §4 and P4-04 |
| Split epoch | the manifest pins the split-manifest hash of epoch 2 (the P4-04 expansion: 2 training, 2 validation, 3 held-out circuits), `sha256:4a56521e…f91e`; the parser checks every listed circuit against that epoch | P4-04 |
| Metric | **ordered checkpoint progress**: gates credited in order ÷ gates per lap (in laps), per circuit | plan §4 |
| Primary contrast | per circuit, `d_s = progress(A5_s) − progress(A3)` for each training seed `s`; A3 is deterministic, so it contributes **one value per circuit**, and A5 contributes one value per seed | plan §4 |
| Secondary contrasts | the same for A3-nb and A3-nb-same (descriptive; only A3 against A3-nb-same is a brake ablation) | plan §3 |
| Bootstrap | the seed-cluster bootstrap of the mean difference: 10,000 resamples, seed **20261112**, 95%, percentile with nearest rank. The rule contributes no sampling variation, so only A5's seeds are resampled | plan §4 |
| Meaningful threshold δ | **0.25 lap**, fixed (the manifest parser rejects any other value) | plan §4 and E4 |
| Decision rule | `p5-01-e3-decision-v1` (`classifyE3` in `src/training/e3Study.ts`) | §3 |
| Code | `e82aa8bf9c5397a5dae4ebf31d5c6b59c1d7d0b8`, the merge of #164 (P4-04), which follows the merges of #161, #162 and #163: all of `src/`, `scripts/` and the study code are unchanged by this PR, which adds only the manifest, this protocol, its test and docs | `package.json` `engines` is `>=24 <25` |
| Authorisation | `issue-33#issuecomment-6801667981` ("I authorise all steps"), named in the manifest as the plan requires; **§2 still requires an explicit go-ahead for the opening** | plan §4 step 6 |
| Engine | **Node 24** (`package.json` `engines`, `.nvmrc`), one patch version for every record, replay and analysis: each record carries the engine, and replay and analysis refuse a record from another | plan §4; recorded in each record |

**The manifest's hashes:**
- **`manifestHash`:** `sha256:d72a73317a59f251aa86e804fe6f988340279c502a95ecd0cbf9e5d6f399c429`, the SHA-256 of its canonical JSON. Every E3 record carries it, and replay, the held-out gate's protocol and analysis refuse a record made for another manifest. The held-out gate's protocol hash **is** this hash, so the opening is bound to this exact study.
- **The committed file's SHA-256:** `fa537fb912d869b42c7e61a52a7583c4054f28de0c08e15c075dde0d2b257753`.

**What the code enforces for a confirmatory manifest** (`parseE3Manifest`): exactly seeds 3001–3010 in order, 100 generations, the C1 training configuration, the oval and the rounded rectangle, δ = 0.25, a frozen commit, at least one held-out circuit registered as held-out and hash-checked, an authorisation, the frozen rule identities, and every circuit belonging to the split epoch the manifest names. A manifest that names a frozen commit only accepts runs and records from a clean checkout of exactly that commit, **checked before the held-out gate is opened**.

### 1.1 Why all three held-out circuits (a decision for the owner)

E3's question is about a rule against an evolved driver, and a single circuit says little: `hairpin-chicane` alone would let one geometry decide it. The three held-out circuits differ on purpose (a hairpin and chicane circuit, a speed-dependent large-radius circuit with a 100 m straight, and an 8 m wide technical circuit with a 135° corner). **Each is reported separately, and nothing is pooled across circuits.** The cost is that the single E3 opening spends all three for E3: they stay held-out (they were never used for tuning or selection), but any later study (E5, E6) needs its **own preregistered protocol and its own opening**, and AI_EVALUATION §5 applies: "if held-out results drive a change, those tracks become validation tracks and new held-out tracks are made." The alternative, listing only `hairpin-chicane`, leaves the other two unlooked-at for E5 and E6 but makes E3 a one-circuit comparison. **The default here is all three; the owner may change it before approving the manifest.**

## 2. How the E3 run goes (step 6, not started)

This applies **only after** the owner approves the reviewed manifest and authorises the run. The run needs a **Node 24 environment**; the development container this protocol was written in has Node 22, so the run happens somewhere that has Node 24 (the owner's choice), and every record names its engine.

1. **A clean checkout of the frozen commit.**
   - `git worktree add --detach <run-dir> e82aa8bf9c5397a5dae4ebf31d5c6b59c1d7d0b8`, then `npm ci` in it.
   - The manifest, records, ledger and outputs stay **outside** that worktree, so it stays clean.
   - `npm run e3 -- run-seed` and `run-rules` refuse this manifest from a dirty worktree or from any other commit.
2. **Detached from the start.** The sequence is started by a logged, detached runner (for example `setsid nohup`), so a session limit cannot kill it. Each command's output goes to a log file.
3. **Training and validation only, first:**
   - for each seed `s` from 3001 to 3010 in order: `npm run e3 -- run-seed <manifest> --seed s --out <work>/seed-s.json`, then `npm run e3 -- replay <manifest> <work>/seed-s.json`, which must exit 0;
   - `npm run e3 -- run-rules <manifest> --out <work>/rules.json`, then its `replay`;
   - `npm run e3 -- analyse <manifest> --rules <work>/rules.json --out-dir <work>/validation/ <the ten seed records>`: the **validation-only** analysis (no `--held-out`). Nothing in this step touches a held-out circuit.
4. **The explicit go-ahead for the opening.** Claude reports the validation-only analysis to the owner and **does not run step 5 until the owner writes an explicit go-ahead on #33** (a relayed instruction or an `Owner decision:` comment) naming this manifest's hash. The earlier "I authorise all steps" is recorded in the manifest as the authorisation, but the opening is a one-way action, so it is confirmed again.
5. **The one opening:** `npm run e3 -- run-held-out <manifest> --rules <work>/rules.json --ledger <work>/ledger.json --out <work>/held-out.json --open-held-out <the ten seed records>`.
   - **No `--force`; it never overwrites.** The ledger lives outside the worktree and is the study's memory of the look: a claim is taken under an exclusive lock and written to disk **before** the gate gives any access, so a crash, a lost record or a restart cannot hand out a second look; a repeat is refused, and a corrupt ledger or a leftover lock is refused, never repaired or broken automatically.
   - If the claim succeeds but the record cannot be written, the command prints the complete record; it is saved from there, never recomputed through a new opening.
   - Then `npm run e3 -- replay <manifest> <work>/held-out.json <the ten seed records>`, which replays through a separate in-memory gate and must exit 0.
6. **One analysis:** `npm run e3 -- analyse <manifest> --rules <work>/rules.json --held-out <work>/held-out.json --out-dir <work>/final/ <the ten seed records>`. It writes `analysis.json` and `report.md`.
7. **Any failure stops the study.** That covers a run that fails, a record that does not replay identically, an analysis that refuses its records, and any infrastructure interruption (a killed process, a session limit, a full disk).
   - **It is reported to the owner before anything resumes.** Nothing restarts automatically.
   - Re-running a deterministic **training or validation** step needs the owner's written go-ahead. **A failure at or after the opening is never answered by opening again**: the ledger refuses it, and nothing in this protocol authorises a second look.
   - **No seed is substituted, skipped or re-run with changed settings.** Nothing is run on any other seed.

**Expected cost** (an estimate, not a measurement): about 2–3 minutes per seed for A5's 5,000 evaluations (the P2-08 confirmatory run took 220–279 s per 10,000), the same again for each replay, a few seconds for the rules and the 13 held-out evaluations per circuit, so about an hour in all. Unmeasured until the run.

## 3. Result and how it is reported (fixed now)

**The result is whatever `analyse` writes, unchanged.** **Where each figure lives.** `report.md` (the generated report) holds, for each of the four circuits (validation and the three held-out circuits) and each rule agent, only the mean of the ten differences `d_s`, its 95% bootstrap interval, the counts of seeds where A5 is above, tied with and below the rule, and the outcome label, plus the limits. **`analysis.json` holds the rest**: for each circuit, each agent's per-seed ordered progress, median, IQR, lap completions and crashes (A5's ten values; each rule agent's single value), and the full contrasts. Any figure quoted in `e3.md` is taken from one of those two files, and the results note says which. The **primary** statements are A5 against A3 on **each held-out circuit, separately**; validation is reported first and is descriptive.

Each contrast gets **exactly one** of three labels (`classifyE3`). The generated files carry them as the identifiers `a5-higher`, `rule-higher` and `no-clear-difference`; the results note (`e3.md`) renders each in these words:

| Condition | Reported as |
| --- | --- |
| interval lower bound above 0 **and** mean ≥ 0.25 lap | "A5 reached meaningfully more ordered progress than the rule on this circuit" |
| interval upper bound below 0 **and** mean ≤ −0.25 lap | "the rule reached meaningfully more ordered progress than A5 on this circuit" |
| anything else | "no clear difference: a predeclared meaningful advantage was not established on this circuit" |

The rows are exhaustive and mutually exclusive, and the comparison is exact. **A negative or "no clear difference" result is a valid outcome and is reported as plainly as a positive one.** The third row does not mean "no effect" or "equivalent".

**What is not decided here:** E3 gives four separate circuit-level statements. **No pooled claim, no "evolution beats rules" headline and no generalisation claim** is made from them. If the four disagree (for example A5 ahead on one circuit and behind on another) the report says so and stops there. A mention of "more than the rule" always names the circuit, the rule agent and the delta.

**Claims allowed:** the outcome wording above, per circuit, with the interval and n, for this A3 (a rule written by one person for this simulator and tuned on one training circuit), this A5 (C1, ten seeds) and these four circuits.

**Claims not allowed:**
- anything about rule-based driving in general, about other circuits, or about learning beyond these four circuits;
- any claim that a held-out result is a result about A5 "generalising" without these limits stated;
- any change to the rule, the circuits or the metric because of a result; any redesign needs the owner's approval and a version bump before a fresh study and is never chosen using held-out results;
- any statement that E3 completes Phase 5 or the roadmap's research claims; P5-01 is complete only through the steps and gates in the plan.

## 4. Known limitations (stated before the run)

- **A3 was tuned on the training circuit only**, over a predeclared grid of 72 variants for A3 and 18 for A3-nb (`docs/experiments/p5-01-tuning.md`). It is the best of that grid, not the best possible rule, and hand tuning on one circuit may not transfer. **A3-nb-same crashes on the training circuit** (5 checkpoints, no lap), which is a fact about that ablation, not a finding about braking.
- A3 is deterministic: its "uncertainty" is zero and A5's is across ten seeds, which is why the interval clusters on A5's seeds and does not treat A3 as a sample. Ten seeds and four circuits make an interval a guide, not proof (AI_EVALUATION §8).
- The held-out circuits were designed (P4-04) by the same person who wrote the agents, from criteria fixed beforehand and reviewed; they are "unseen" only because no result about them has been looked at. The design of `long-sweepers` and `technical-narrow` favours certain skills (speed-dependent racing line; tight right-hand kinks) and nothing here says the four circuits represent track design.
- The 60 s episode limit may bind on a circuit for both agents (E4's champions ended every training episode at the limit); whether it matters here is untested.
- Phase 2's training-track-only result is unchanged and E3 does not revise it.

## 4.1 Execution accounting

**A seed record does not store evaluation counts.** It stores A5's champion (generation 99, its index in the generation, the selection rule, the frozen model with its provenance) and its **training-circuit and validation-circuit episodes**; the search budget (P × G = 5,000 evaluations per seed, 50,000 in all) is fixed by the manifest's configuration, and the parser checks the recorded generation and champion index against it, but no per-seed evaluation or car-tick total is recorded. Replay re-runs the whole evolution and compares the champion and both episodes exactly, which is what shows the run did what the configuration says. The held-out record holds each frozen agent once per held-out circuit: 13 agents (ten A5 champions, A3, A3-nb, A3-nb-same) × 3 circuits = **39 evaluations**, and the parser checks that count, the order, each model identity and each episode. **Wall time and the engine:** the engine is in every record; wall times are not, so they come from the detached runner's log (§2), which the run keeps and the results note quotes. No car-tick total is predeclared or recorded.

## 5. What is committed afterwards

Under `experiments/results/p5-01/e3/`, in a separate results PR for Codex review and the owner's merge: the ten seed records, the rules record, the held-out record, the ledger (as evidence the opening was taken once), the runner's log, `analysis.json` and `report.md` exactly as `analyse` wrote them, and `e3.md` (the engine, the frozen commit, the run dates and each seed's wall time from the log, the figures quoted from `analysis.json` or `report.md` with the file named, the outcome label for each circuit, and the limits above). Records are small (a seed record holds A5's champion and two episodes), so they are committed as raw JSON; the owner may ask for gzip instead. P5-01's completion follows only from that merged results PR and the other AGENTS.md gates, and `docs/AI_EVALUATION.md`'s E3 entry is filled only from it.

## 6. Boundaries

- Seeds 3001–3010 only, and only after the owner approves the reviewed manifest and gives the explicit go-ahead in §2. No other seed is used.
- The held-out circuits are evaluated **once**, through the gate, for frozen agents only, and only after the validation-only analysis exists.
- No claim beyond §3. No device, Silverstone or editor work is part of this study.
- Nothing here changes physics, circuits, the trainer, the fitness, the rule agents or any earlier result.
