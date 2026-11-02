# P2-08 confirmatory protocol (plan step 5)

Status: **preregistration, written before any confirmatory seed runs.** This document and `experiments/manifests/p2-08-confirmatory.json` go to Codex for review and to the owner for approval. **The confirmatory run needs the owner's separate approval of the reviewed manifest.** Once that approval is given, nothing in the manifest or in §3 below changes. Preparation was [authorised by the owner](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/19#issuecomment-6580274602). No confirmatory seed (1001–1020) has been run.

## 1. What is frozen

**The manifest:** `experiments/manifests/p2-08-confirmatory.json` (`id` `p2-08-confirmatory`, label `confirmatory`). It is the pilot's chosen candidate, C1 (`experiments/manifests/p2-08-pilot-c1.json`). Only the `id`, `label`, `description` and `seeds` differ, and `tests/training/confirmatoryManifest.test.ts` checks that.

It applies each of the pilot's predeclared decisions ([`experiments/results/p2-08/pilot/pilot.md`](../../experiments/results/p2-08/pilot/pilot.md), merged in #108 after [Codex technical approval](https://github.com/Harrisonxaph/Self-learning-Car-AI/pull/108#pullrequestreview-5738332902)):

| Plan §8 item | Value | Where it comes from |
| --- | --- | --- |
| Configuration | C1: trainer defaults, P = 50, **G = 100**, two elites, tournament 3, uniform crossover 0.7, mutation rate 0.1 and scale 0.2; 60 s episodes, 5 s stall limit, 3 laps, fitness version 1 | `selectByValidation` over C0, C1 and C2 on A5 validation gates |
| n and seeds | **n = 10, seeds 1001–1010**, in order | the projected half-width at n = 10 is 0.1290 ≤ δ |
| δ | **0.25 lap** | not raised (no predeclared rule to raise it) |
| Budgets | E = P = 50 episodes per track for A1/A7, and P × G = 5,000 evaluations for each of A5 and A8 | plan §3 |
| A7 hold | 30 ticks | plan §2 |
| Agents | A1, A7, A2, A9, A8 and A5 | plan §2 |
| Tracks | training `stadium-oval`, validation `rounded-rectangle`, with split hashes; the held-out track is never used | plan §4 |
| Metric | ordered progress (gates credited ÷ gates per lap) | plan §5 |
| Bootstrap | 10,000 resamples, seed 20261028, 95% | plan §6 |
| Wilcoxon | exact, zeros dropped, midranks; descriptive only | plan §6 |
| Decision rule | `p2-08-decision-v1` | plan §6 and `training/analysis.ts` |
| Code | `c14f36862c72463bd8eee5371d2a4ad7dad2adba` | the commit that ran the pilot; `src/` and the study scripts are unchanged on `main` since |

**The manifest's hashes:**
- **`manifestHash`:** `sha256:4ace8cf8c14b828d51953fc61cd2ec0b48a0a880fa439cf8cc006915bbd3ccc0`, the SHA-256 of its canonical JSON. Every confirmatory record carries this value, and `replay` and `analyse` refuse a record made for another manifest. The test pins it.
- **The committed file's SHA-256:** `0913784b93c01f0c27d887426b103afbce8c51737b3669c1acf3845a0c82a623`.

**Eligibility:** with label `confirmatory` and seeds exactly 1001–1010, `acceptanceEligibility` returns eligible. The test checks this. It is the only kind of analysis that can produce the claim "outperforms equal-budget random search".

## 2. How the confirmatory run goes

This applies **only after the owner approves the reviewed manifest.** It follows the pilot procedure (pilot protocol §2):

1. **A clean checkout of the frozen commit.**
   - Run `git worktree add --detach <run-dir> c14f36862c72463bd8eee5371d2a4ad7dad2adba`, then `npm ci` in it.
   - The manifest, records and outputs stay **outside** that worktree, so it stays clean.
   - `run` refuses a confirmatory manifest from a dirty worktree, or from any other commit.
2. **One engine.** The same Node version, v24.22.1 (the pilot's), runs every seed, replay and analysis. It is recorded in each record.
3. **For each seed `s`, from 1001 to 1010 in order:**
   - `npm run study -- run <work>/p2-08-confirmatory.json --seed s --out <work>/seed-s.json`;
   - then `npm run study -- replay <same manifest> <work>/seed-s.json`, which must exit 0.

   For each seed, the run's wall time, car-ticks, raw size, gzip size and SHA-256 are noted.
4. **One analysis:** `npm run study -- analyse <manifest> <work>/seed-1001.json … <work>/seed-1010.json --out-dir <work>/`. It replays every record again, then writes `analysis.json` and `report.md`.
5. **Any failure stops the study.** That covers a run that fails, a record that does not replay identically, and an analysis that refuses its records. The failure is reported to the owner.
   - No seed is substituted, skipped or rerun with different settings.
   - Nothing is run on seeds 1011–1020.

**Expected cost:** from the pilot's C1 measurements, about 50 min of runs, about 50 min of replays and about 53 min of analysis. That is about 2.5–3 h, run one at a time.

## 3. Result and how it is reported (fixed now)

**The result is whatever `analyse` writes, unchanged.** The decision (`p2-08-decision-v1`, plan §6) is computed on the ten training-track differences `d_s = progress(A5) − progress(A8)`. It requires all four conditions:
1. the 95% bootstrap interval for mean `d_s` lies entirely above 0;
2. the mean of `d_s` is at least δ = 0.25;
3. at least one A5 frozen model completes a valid lap on the training track;
4. A1, A7, A2 and A9 results, lap completion and collisions are all reported.

**What each outcome means:**
- **`supported`:** the only claim available is "outperforms equal-budget random search" (A5 against A8, ordered progress on the training track). It is not a claim of general driving ability.
- **`negative or inconclusive`:** the result is reported as such. Phase 2 acceptance stays unmet, and a follow-up is planned. It is never relabelled, and the study is never rerun with other seeds or settings to change it.

**Reported but not tested:** the secondary contrasts (A5 − A9, A5 − A2, A5 − A1, A5 − A7), every validation-track result and the Wilcoxon p-values are descriptive only. They decide nothing.

**Validation in the pilot:** in every pilot candidate, both A5 and A8 crashed in every validation episode. This is expected to show up again in the descriptive validation results. It does not enter the decision.

## 4. Storage (owner's choice before the run)

Plan §9 asks the owner to choose the storage format before the confirmatory run if the records would be large, for example over 20 MB. The pilot measured a C1 record at about 7.2 MB, so ten records come to about 72 MB raw.

**Recommendation:** the same as the pilot. Store each record compressed with `gzip -9 -n` as `seed-s.json.gz`, about 0.73 MB each and about 7.3 MB in total. List the SHA-256 of each uncompressed record in the results summary. `gunzip` restores the exact bytes, so `resultsHash`, `replay` and `analyse` still apply.

The alternative is to commit the raw JSON. **The owner's choice is needed together with the approval to run.**

## 5. What is committed afterwards

Under `experiments/results/p2-08/confirmatory/`, in a separate results PR for Codex review and the owner's merge:
- the ten records, in the storage format chosen in §4;
- `analysis.json` and `report.md`, exactly as `analyse` wrote them;
- `confirmatory.md`, covering:
  - the engine, the frozen commit and the run dates;
  - every measurement;
  - the decision result and its conditions, quoted from `analysis.json`;
  - the boundaries in §6.

P2-08's completion, and any Phase 2 acceptance, follows only from that merged results PR (plan §10 step 5). `docs/AI_EVALUATION.md`'s E1/E2 tables are filled only from it.

## 6. Boundaries

- Confirmatory seeds 1001–1010 only, and only after the owner approves the run. The pilot seeds and pilot manifests are not reused or changed.
- The validation track is descriptive only. The held-out track (`hairpin-chicane`) is never evaluated.
- No claim beyond what §3 allows. No device, Silverstone or research-entry work is part of this study.
