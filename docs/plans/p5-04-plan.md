# P5-04 plan: the generalisation study (E6) and report

> **Status: plan only, for Codex review and the owner's decisions. Implementation and every study step need their own owner authorisation (section 4); this plan authorises none.**
> - **Authorisation:** the owner's "Continue development" (2026-11-15, recorded on [#36](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/36#issuecomment-6887144456)), read as authorising a **plan only** for the next unblocked Phase 5 item (P5-04's dependencies P4-04, P4-05 and P5-01 are Complete). It is **not** the explicit go-ahead for the E5 held-out opening, which is a separate, one-way decision on #34 and is untouched here. I will stop if this was not meant.
> - **Scope:** the roadmap entry and issue #36: run E6 ("do evolved drivers generalise?", AI_EVALUATION section 7) across A1, A2, A3, A4 and A5 on held-out circuits and publish a results page with its limitations. **Not** in scope: E5 (P5-02), any physics, circuit or trainer change, and any run.
> - **Lessons carried from P2-08, P2-09, P5-01 and P5-02:** predeclare everything before a result is seen; one opening per (model, circuit); a crash count identifies no floor; no pooled headline; never infer a result from a null; keep the held-out boundary closed until the owner authorises the look; and **check that the question and the measure match** (P5-02's first plan failed that check and had to be corrected after review).

## 1. What P5-04 must deliver (ROADMAP, issue #36, `docs/AI_EVALUATION.md`)

- **Claim to be tested (AI_EVALUATION section 1):** "The AI drives, not just memorises": *evolved drivers complete laps on **held-out** tracks they never trained on, at a rate clearly above baselines.*
- **E6 (section 7):** agents **A1, A2, A3, A4, A5**, held-out tracks, ten training seeds.
- **Acceptance:** an honest statement of whether the models generalise to unseen circuits, with data; the analysis reproducible from committed raw data; a results page in `docs/AI_EVALUATION.md` with limitations.

## 2. What already exists (inspected at `main` `3c7b198`)

| Need | What exists | Gap |
| --- | --- | --- |
| Frozen A4 and A5 champions, ten pairs | E4's committed records (seeds 2001-2010), pinned in the E5 manifest | none |
| The held-out gate with frozen identities | `heldOutAccess.ts`: network agents (A5), no-brake network agents (A4) and the rule agents (A3, A3-nb, A3-nb-same), each (model, circuit) once, five fixed starts through `evaluateStarts` | **no identity for A1, A7 (random-action drivers) or for an untrained-network A2** |
| Ten-seed A2 material | `baselines.ts`: A2 is the trainer's own generation 0 for a seed (a population of random networks) | **no single frozen "A2 representative" per seed** (a population is not one model) |
| A3 | the rule driver, tuned on the training track only (`p5-01-tuning.md`) | none |
| A study kind, parsers, replay, analysis and a command line for a held-out opening | E3 (A5 against rules) and E5 (A4 against A5) | **no E6 manifest, record or analysis** |
| Fresh held-out circuits | `hairpin-run`, `sweep-hook`, `hook-chicane` (#208), **reserved for the E5 opening** | see decision 1 |
| Data that already bears on E6 | **E3** (A5 against A3, A3-nb and A3-nb-same on the three E3 circuits, now spent) and **E5** (once opened: A4 and A5 on the three fresh circuits, five starts, with completion and crash counts) | E6 should reuse them, not repeat them |

## 3. Design (defaults proposed; each is a decision for the owner and Codex, section 7)

**3.1 The question and the measure.** The claim is about **lap completion** at a rate **clearly above baselines**. So the deciding endpoint is the **lap-completion rate** per agent class and circuit (the share of its episodes, over the five fixed starts, in which a lap was completed within the episode limit), compared with each baseline's by a predeclared meaningful difference (proposed **0.20**, one start in five, as E5's collision margin). **Ordered progress** (laps, the E3 and E4 measure) is kept as an additional **descriptive** endpoint and decides nothing. Nothing here says anything about braking (that is E5); A4 and A5 are both "evolved" classes in E6.

**3.2 The agents** (each frozen before the look, by content identity):
- **A5 and A4:** the ten E4 champions of each (seeds 2001-2010). **Their held-out evaluation is E5's** (the gate allows each (model, circuit) once); E6 **reads it from E5's record** and does not evaluate them again. If E5 has not been opened, E6 cannot be analysed (it depends on it).
- **A3:** the frozen rule (one deterministic value per circuit, as in E3). A3-nb and A3-nb-same stay E3's.
- **A2 (untrained network):** per seed, **one** frozen representative of the seed's generation 0, chosen by a **predeclared rule that uses no performance** (proposed: the **first genome** of that seed's generation-0 population, brake active, as every A5-style network), so it is "an untrained network" and not the best of a population (that is A9, outside E6).
- **A1 (random action) and A7 (correlated random action):** random drivers have no model; their identity is the driver kind, the action-stream derivation (`actionSeed`) and a **predeclared set of action seeds** (proposed 10, matching the ten training seeds). They need a frozen identity in the gate (section 4, step 2).

**3.3 The unit and the comparisons.** The training seed is the unit for the seed-based agents (A2, A4, A5) and the action seed for A1 and A7; A3 is deterministic. Per circuit, per evolved class (A5, A4) against each baseline (A1, A7, A2, A3): the mean difference in lap-completion rate with a **seed-cluster bootstrap** (10,000 resamples, the E3 to E5 settings, A3 contributing a single value with no sampling variation), labels `evolved-higher`, `baseline-higher`, `no-clear-difference` by the E3 and E5 rule (interval entirely beyond zero and the mean at least the margin). **No pooled headline across circuits and no pooled "evolved beats baselines" claim**; if the circuits disagree the report says so and stops. The A2 comparison for an evolved seed is **paired** by seed (the same initialisation stream).

**3.4 A floor is a possible and a reportable outcome.** If most agents of every class complete no lap on a circuit, E6 reports a **floor** on that circuit with the actual completion and progress distributions shown (never as the likeliest explanation of a weak result, and never prevented by editing a circuit); it then says nothing about generalisation there. Completion rates near zero for all classes are a valid finding.

**3.5 What E6 can and cannot say.** It can say, per circuit and for **these** champions, whether evolved drivers completed laps on a circuit they never trained on at a clearly higher rate than these baselines. It cannot say anything about other training configurations, seeds or circuits, about braking (E5), or about "learning" in general; "no clear difference" does not mean equivalence.

## 4. Steps (each needs its own owner authorisation; this plan authorises none)

1. **This plan** (documentation only).
2. **Gate extension:** frozen identities for the random drivers (A1, A7) and for an untrained-network A2 representative, with the E3 and E5 safeguards unchanged (supported names and bindings validated before any driver is built, each (model, circuit) once, the ordinary guards still refuse held-out circuits). Negative tests; no change to existing identities.
3. **E6 library:** the manifest (frozen commit, the E5 manifest hash, the agents' identities and seeds, the circuits, the margin and bootstrap, the decision rule), the held-out record (baselines only; A4 and A5 come from E5's record and are checked against its hash), strict parsers, replay, the analysis and the report; synthetic fixtures and analytical tests, including a floor on every agent.
4. **Command line** (the E5 pattern): `run-held-out` (explicit `--open-held-out`, file ledger, no `--force`), `replay`, `analyse`.
5. **Preregistration:** the E6 manifest and protocol, frozen (commit and `manifestHash`) **before** any E6 evaluation, for Codex review and the owner's approval.
6. **The run (a held-out opening).** A one-way action: it needs the owner's explicit go-ahead naming the `manifestHash`, in the recorded Node 24.22.1 environment, once, through the gate and a ledger outside the worktree.
7. **Results PR and the report:** records, ledger and analysis unchanged, the E6 entry and the generalisation results page in `docs/AI_EVALUATION.md` with limitations, then completion (the owner's).

## 5. Cost (estimates, not measurements)

Steps 2 to 5 are four reviewed pull requests of the size of #201, #202, #207 and #209 (each about an hour of review plus CI). The run itself is small: 10 A2 networks, 10 A1 and 10 A7 action seeds and one A3, five starts, three circuits is roughly 1,000 episodes of at most 60 simulated seconds. **E6 cannot complete before E5 has been opened, because it reads E5's record for A4 and A5.**

## 6. What is deliberately not claimed

- E6 is **not** a test of braking and does not revise E5, E3 or Phase 2; its results hold for these ten champions per class, this configuration (C1), these three circuits and these baselines.
- The fresh circuits are exposed by the E5 opening. Using them for E6 means **E5's results are known when E6 runs**; the protection is that **E6's design is frozen before E5 opens** (decision 1). If the owner prefers independence, decision 1's alternative buys it at the price of another circuit batch.
- The designer saw E3's results and the circuit geometry (disclosed already in the circuits plan); that stays true for any circuit batch.
- A lap-completion rate over five fixed starts is scenario variation of a deterministic agent, **not independent samples**; intervals are over the ten seeds only.

## 7. Decisions for the owner (defaults proposed; each routine unless changed)

1. **Which held-out circuits for E6.** *Default (recommended):* **the same three fresh circuits as E5**, with E6's design **preregistered before E5 opens**, so E5's result cannot shape E6; A4 and A5 are read from E5's record and only the baselines are newly evaluated. *Alternative:* a **second batch of fresh circuits** (a repeat of the circuits plan: specs, review, generation, epoch 5), which makes E6 independent of E5 but adds roughly three more reviewed pull requests. *Not recommended:* designing E6 after E5's result is known and reusing the circuits.
2. **Sequencing with E5.** *Default:* complete steps 2 to 5 (E6's preregistration) **before** the E5 opening is requested, so E5 and E6 are opened one after the other under frozen designs. *Alternative:* open E5 first (today's plan) and accept the weaker protection of decision 1's alternative, or an E6 on fresh circuits.
3. **The deciding measure:** lap-completion rate, with ordered progress descriptive (default), against progress as the decider (the superseded P5-02 rule, which failed review).
4. **The margin:** 0.20 (default), the A2 representative rule (the first genome of generation 0), 10 random-driver action seeds, and A3 as the only rule agent (A3-nb and A3-nb-same stay E3's).
5. **Is P5-04 to be done at all before the owner's other priorities** (P5-03's completion, P5-06): this plan is documentation only and delays nothing else.

## 8. Tests (for the later steps)

Identity tests for the new agents (the random drivers' action streams, the untrained representative, refusal of an unsupported name or binding); gate tests (once per (model, circuit), no listed-agent bypass); analysis against hand-computed cases (a floor, all agents completing, one baseline above the evolved class, ties, A3's single value); record round trip, corruption refusals and replay equality; the claims text (no pooled headline, no equivalence from a null). No test evaluates a model on a real held-out circuit.
