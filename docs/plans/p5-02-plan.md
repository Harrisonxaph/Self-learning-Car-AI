# P5-02 plan: learned braking comparative study (E5, ST4)

> **Status: plan only, for Codex review and the owner's merge. Implementation and every study step need their own owner authorisation.**
> - **Authorisation:** the owner's "Continue development" (2026-11-14, after #199 merged), read as the next ready item (P5-02's dependencies P2-09, P4-04 and P5-01 are Complete) and, as for earlier items, as authorising a **plan only**. The owner may reorder or correct this reading. The other open items are P5-04 (the same held-out boundary, planned separately), P5-06 (a performance item that must first record its device, workload and budget in issue #38) and P5-03's completion decision, which is the owner's.
> - **Scope:** the roadmap entry and issue #34 (E5, ST4): paired no-brake against brake training, evaluated on **held-out** circuits, with lap-time and collision comparisons and statistics, and a written conclusion that may be "no clear difference". **Not** in scope: any claim about general driving, a new simulator, new agents, changing the brake feasibility result of P2-09, or opening the held-out boundary before the owner says so.
> - **Lessons carried from P2-09 (E4), P5-01 (E3) and the E3 result:** predeclare everything before any result is seen; never tune on held-out circuits; one controlled held-out opening recorded in a ledger outside the worktree; the result is whatever `analyse` writes; no pooled headline; a negative or "no clear difference" result is a valid outcome and is reported as plainly as a positive one.

## 1. What P5-02 must deliver (ROADMAP, issue #34, AI_EVALUATION E5)

- **Description:** run E5: paired no-brake against brake training over 10 seeds, evaluated on held-out tracks, with lap-time and collision comparisons and statistics.
- **Acceptance:** a written conclusion on whether learned braking helps, supported by committed data, including a "no clear difference" outcome if that is the result.
- **Tests:** experiment files and the analysis script committed; the analysis script unit-tested.

## 2. What already exists (inspected at `main` `9d5b0b9`)

| Need | What exists | Where | Gap |
| --- | --- | --- | --- |
| Paired A4 (brake masked) and A5 (brake on) champions, 10 seeds | E4: seeds 2001 to 2010, configuration C1 (P = 50, G = 100), each seed record holds **both agents' frozen champions** (`agents.A4.model`, `agents.A5.model`) with their generation, selection and a search budget of 5,000 evaluations each; committed as gzip with SHA-256 | `experiments/results/p2-09/e4/`, `src/training/e4Study.ts`, `e4Agents.ts` | E4 evaluated them on the training and validation circuits only (`heldOut: none`) |
| The E4 result on the training circuit | `no-direction`: A5 minus A4 mean -0.015 lap, interval [-0.040, +0.010], both agents at about 2.5 laps | `docs/AI_EVALUATION.md` section 9 | nothing: E5 asks the same question on unseen circuits |
| A controlled, once-only held-out access | the gate and its caller-supplied opening ledger; the file-backed ledger with an exclusive lock; the E3 command line (`npm run e3`) with `run-held-out`, `replay`, `analyse` | `src/training/heldOutAccess.ts`, `scripts/e3.mjs`, `scripts/ledgerFile.mjs` | the gate freezes **rule agents and A5 champions only**; it has no identity for an **A4** champion (brake masked, `provenance.agent = 'A4'`) |
| A seed-cluster bootstrap, a decision rule with three labels, a no-pooled-claim report | E3's analysis and report | `src/training/e3Study.ts` | a paired A5 minus A4 contrast per held-out circuit, and its own decision rule version |
| Three held-out circuits | `hairpin-chicane`, `long-sweepers`, `technical-narrow` | `src/training/trackSplits.ts`, epoch 2 | already looked at once by E3 (section 5) |

## 3. Design

**The question.** E4 found no direction on the training circuit. E5 asks whether the brake output makes a measurable difference on circuits the agents did not train on. It is a **paired** comparison: for each seed the two agents started from the identical generation-0 population and evolved separately, so the pair is the unit.

**Two designs (decision 1 for the owner).**
- **Design A (proposed default): evaluate E4's ten frozen A4 and A5 champions on the held-out circuits.** No new training. The champions come unchanged from the committed E4 records (checked by their frozen identity and the record hashes), so E5 is a **held-out evaluation of an already-reviewed, already-recorded population**: 20 champions on each held-out circuit, one nominal-start evaluation each (the agents are deterministic), so 60 evaluations for three circuits. A few minutes of compute and no training run.
- **Design B: new seeds, trained afresh** (a new reserved block, proposed 4001 to 4010, the E4 machinery at C1): about 10 seeds at roughly 4 minutes per seed per agent plus replays, so roughly one to two hours, and a new manifest, records and reserved-seed rules. More independent of E4, at a real cost, and it spends nothing the held-out look has not already spent.
- **Why A is the default:** it adds no new training, is fully checkable from committed data, and keeps E5 a pure held-out question. **Its cost, stated:** the pairs are E4's, so E5 is **not independent of E4's seeds** (it tests the same ten pairs on new circuits), and the champions were chosen by training-circuit fitness, which is the point of asking about transfer.

**Primary measure.** Per held-out circuit, `d_s = progress(A5_s) - progress(A4_s)` with **ordered progress** (gates per lap) of each frozen champion, paired by seed, and the same meaningful threshold **delta = 0.25 lap**, a seed-cluster bootstrap with the E3 and E4 settings, and a new decision rule `p5-02-e5-decision-v1` with the E3 three labels (`a5-higher`, `a4-higher`, `no-clear-difference`) and the E3 wording. **No pooled headline across circuits** (E3's rule): if the circuits disagree, the report says so and stops.

**Why ordered progress, and an honest disclosure.** Lap time is missing for any agent that crashes, and E3 showed that nearly every agent crashes early on these circuits (A5's median progress was 0.04 to 1.0 laps), so lap time alone would be unavailable for most pairs. The choice of progress as the primary measure is therefore **informed by what E3 showed about these circuits**; it is stated here, before any E5 evaluation, and not chosen after seeing E5 results.

**Secondary, descriptive, decide nothing:** collisions (crash counts per agent and circuit, which the roadmap asks for); lap completions; **first-lap time only over the pairs where both agents completed a lap**, with each agent's own sample count and the excluded pairs named (the rule P5-05 settled: a missing time is never zero and never dropped from one side only); the brake-usage of each champion on each circuit (the E4 threshold, a tick counts as braking above a brake command of 0.05) so the report can say whether A5 used the brake at all on unseen circuits.

**Intervals are pointwise per circuit, not a simultaneous guarantee** across the three circuits (Codex's note on E3); the report states this limit.

## 4. Machinery and steps (each needs its own owner authorisation)

1. **This plan** (documentation only).
2. **Gate extension:** a frozen identity for an **A4** champion (brake masked, `agent = 'A4'`), reconstructed exactly as frozen, with the E3 safeguards unchanged (supported agent names and brake bindings validated before any driver is built; the ordinary evaluation guards still refuse held-out circuits). Negative tests; no change to E3's identities or to the ordinary guards.
3. **E5 records and analysis (library):** an E5 manifest (frozen source commit, the E4 record hashes it reads, the held-out circuits, delta, bootstrap, decision rule), a held-out record, strict parsers, replay, the paired analysis with its decision rule, and the report; tests with synthetic held-out fixtures and mechanics-labelled records, analytical cases (including pairs where one or both crash, and pairs with no completed lap).
4. **Command line:** the E3 pattern (`run-held-out` with the file ledger and an explicit `--open-held-out`, `replay`, `analyse`); no `--force`.
5. **Preregistration:** a protocol and manifest committed and **frozen** (the source commit, the manifest hash) before any E5 evaluation, for Codex review and the owner's approval.
6. **The run (the held-out opening).** **A one-way action**, so it needs the owner's explicit go-ahead naming the manifest's `manifestHash`, in a Node 24 environment (the owner's choice, as for E3), once, through the controlled gate and a ledger outside the worktree; any failure stops the study and a second look is refused.
7. **Results PR** (records, ledger, analysis and report unchanged, a results note whose figures come only from those files) for Codex review and the owner's merge; then the E5 entry in `docs/AI_EVALUATION.md`, then completion.

## 5. What is deliberately not claimed, and the limits

- **The held-out circuits have already been looked at once** (E3, for different agents). They are "unseen" for these agents only in the sense that no E5 agent was trained or tuned on them; E3's results were known when this plan was written, and that disclosure is part of the record. A second study on the same three circuits spends further of their unseenness; P5-04 would spend more.
- E5 supports a statement about **these ten champion pairs on these three circuits** and this metric. It does not support a statement about braking in general, other circuits, other configurations, or learning beyond them.
- A "no clear difference" label does **not** mean "no effect" or "equivalent". It is the likeliest result if both agents crash early on every circuit (a floor effect); that would be reported plainly as such.
- A1 to A3 baselines are not part of E5 (A3 and the rules were E3's; E6 is P5-04).

## 6. Decisions for the owner (defaults proposed; each routine unless changed)

1. **Design:** A (E4's ten champion pairs, no new training) or B (new seeds 4001 to 4010). Default **A**.
2. **Held-out circuits:** all three (`hairpin-chicane`, `long-sweepers`, `technical-narrow`), as for E3. Alternative: a subset, which spends less of the boundary and answers less.
3. **Primary measure and threshold:** ordered progress, delta 0.25 lap, the E3 and E4 bootstrap settings, a new `p5-02-e5-decision-v1` rule with the three E3 labels, no pooled headline. Alternative: the roadmap's wording of lap time and collisions as co-primary (not proposed: lap time is mostly unavailable).
4. **Secondary measures:** collisions, lap completions, paired first-lap time with sample counts, brake usage; descriptive only.
5. **Environment and opening:** a Node 24 environment of the owner's choice (the Claude Code container with a pinned Node 24 from npm, as for E3, is the proposed default) and the explicit go-ahead naming `manifestHash` before the one opening.
6. **Steps:** each of steps 2 to 7 is authorised separately; approving this plan authorises none of them.
