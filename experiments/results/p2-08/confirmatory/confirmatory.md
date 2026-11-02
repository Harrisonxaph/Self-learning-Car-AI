# P2-08 confirmatory study: results (plan step 5)

**Status:**
- **Preregistered and acceptance-eligible.** This was run under the [merged confirmatory protocol](../../../../docs/experiments/p2-08-confirmatory-protocol.md) and manifest (#109), with the owner's approval of the run and of gzip storage ([relayed instruction](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/19#issuecomment-6581307850)).
- **The result:** exactly as `analyse` wrote it to `analysis.json` and `report.md` in this folder.
- **Approvals:** these results still need Codex review and the owner's merge. Whether they meet Phase 2 acceptance, and whether P2-08 is Complete, are the owner's decisions. Neither is asserted here.

## Result

**Decision (`p2-08-decision-v1`): `supported`.**
**Claim:** "outperforms equal-budget random search".

The claim means only this: on the training track (`stadium-oval`), evolved A5 frozen models reached more ordered progress than A8, the best of an equal budget of random networks. It is **not** a claim of general driving ability. The held-out track was not evaluated, and on the validation track A5 did not outperform A8 (see below).

**Primary contrast:** `d_s = progress(A5) − progress(A8)` on the training track, in laps, for each of the 10 seeds.

| Measure | Value |
| --- | --- |
| Per-seed `d_s` (1001 → 1010) | 0.85, 0.45, 0.50, 0.45, 0.60, 0.85, 0.50, 0.75, 0.40, 0.55 |
| Mean | **0.590** |
| 95% bootstrap interval (10,000 resamples, seed 20261028) | **[0.495, 0.690]** |
| Median (IQR) | 0.525 (0.4625–0.7125) |
| Exact Wilcoxon (descriptive) | m = 10, p = 0.0020 |

**Decision conditions** (all four required):
1. the interval's lower bound (0.495) is above 0: **yes**;
2. the mean (0.590) is at least δ = 0.25: **yes**;
3. an A5 frozen model completes a valid lap on the training track: **yes**: 10/10 A5 training episodes completed at least one valid lap, with a mean first lap of 24.73 s;
4. A1, A7, A2 and A9 results, lap completion and collisions are reported: **yes**.

All ten seed differences are positive, and the smallest is 0.40 laps.

## Descriptive results (not tested, decide nothing)

**Training track, frozen models:**
- **A5:** 2.475 laps of progress on average; 10/10 episodes completed at least one lap; no collisions.
- **A8:** 1.885 laps of progress; 10/10 episodes completed at least one lap; mean first lap 32.28 s.
- **A9:** 0.445 laps of progress; 1/10 episodes completed at least one lap; 7/10 collisions.

These completion figures are proportions of episodes, not lap counts. One episode can complete several laps.

**Random and untrained floors** (500 episodes each):
- **A1:** 0/500 episodes completed a lap;
- **A7:** 0/500 episodes completed a lap;
- **A2:** 1/500 episodes completed at least one lap.

**Validation track (`rounded-rectangle`):**
- **A5:** crashed in 10/10 episodes, with 0.271 laps of progress on average.
- **A8:** crashed in 8/10 episodes; 2/10 episodes completed at least one lap; 0.664 laps of progress on average.
- **A5 − A8 on validation:** a mean of −0.393, interval [−0.929, 0.014], median 0, with m = 6.

So on this split, A5's training-track advantage **did not transfer**. The plan treats validation as descriptive, so this does not change the decision. It does limit what the result means. A5 is still ahead of A1, A7 and A2 on validation (by about 0.26–0.27 laps).

**Rising fitness:** A5's best training fitness by generation is in `report.md`. Rising fitness is a training signal on one track, not evidence of learning in general.

## Run

- **Code:** frozen commit `c14f36862c72463bd8eee5371d2a4ad7dad2adba`, run from a clean detached worktree with `npm ci`. `git status` was empty before and after.
- **Engine:** Node v24.22.1 (V8 13.6.233.17-node.58), one engine for every run, replay and analysis.
- **Manifest:** `experiments/manifests/p2-08-confirmatory.json`. Its file SHA-256 (`0913784b…a623`) was checked before running, and its `manifestHash` is `sha256:4ace8cf8…ccc0`.
- **Preconditions:** #109 merged at `026fb71`, the same tree as `971cda9`. That differs from the Codex-approved `ee71bb2` by one word in `docs/AI_EVALUATION.md`, and the manifest is identical. Main CI run 41473277051 passed both jobs before any seed ran.
- **Date:** 2026-11-02:
  - seeds 15:44–17:06 UTC;
  - analysis 17:44–18:23 UTC.
- **Outcome:** seeds 1001–1010 were run one at a time, in order, and each was replayed straight after. **All 10 runs exited 0, all 10 replays were identical, and `analyse` exited 0**, replaying all ten records again.
- **What was not done:** no seed was substituted, skipped or rerun, no setting was changed, and the held-out track was not used.
- **Interruption, disclosed:**
  - The first `analyse` was stopped by the session's 2-hour background limit, after about 38 minutes. That was not a refusal. It wrote no output, `--out-dir` stayed empty and the worktree stayed clean.
  - The identical command was then run once more, detached, on the same unchanged records. It completed in 39.4 min.
  - `analyse` is deterministic in its records, so this cannot change the result. It is recorded here and in the run log.
- **Procedural compliance, stated plainly:**
  - Protocol §2 step 5 and the owner's execution instruction say any failure stops the study and is reported.
  - The restart was **my own decision**, made at 17:44 UTC. The owner had given **no instruction to resume** beforehand.
  - I reported the interruption and the restart to the owner in the Claude Code session at that time, while the rerun was starting. It was not recorded on GitHub until this PR. There is no GitHub record of an owner decision on it.
  - My reasoning: the interruption was the execution environment's time limit, not one of the protocol's named failures (a failed run, a non-identical replay, or an analysis refusing its records). It produced no output.
  - Strictly, though, the prescribed `analyse` did not complete on its first attempt, and the study was not paused for an owner decision before it was resumed.
  - The numerical result cannot depend on the restart, because `analyse` is deterministic in its records. Codex reproduced `analysis.json` and `report.md` byte-for-byte. Whether the procedural deviation is acceptable is the owner's decision.
  - **Owner disposition (recorded after #110 merged):** [accepted as a procedural exception for this study only](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/19#issuecomment-6589544564). It sets no precedent for later protocols.

## Measurements

The wall time is for `run` and for the replay straight after it. Car-ticks are the executed ticks that `run` prints. The raw size and SHA-256 are for the uncompressed record. The committed file is that record compressed with `gzip -9 -n`, and `gunzip` restores the exact bytes.

| Seed | Run (s) | Replay (s) | Car-ticks | Raw bytes | Committed `.json.gz` bytes | SHA-256 of the uncompressed record |
| --- | --- | --- | --- | --- | --- | --- |
| 1001 | 278.7 | 266.3 | 16,008,367 | 7,252,517 | 732,616 | `3778067dcabfac35b6e81426998b5c8dacc1d542bda4e1238d87d507091f1676` |
| 1002 | 267.7 | 271.7 | 16,287,063 | 7,257,525 | 732,810 | `51e3e3d80926c5f2faf21aa407e8af6ec737d278d491b131baeb9c93f5281e96` |
| 1003 | 262.5 | 247.6 | 14,828,070 | 7,219,551 | 731,876 | `314af5daa393d0588e62f46d7be136d8df516c1ee57b2310d43edc4450d217df` |
| 1004 | 220.0 | 223.0 | 13,684,794 | 7,188,967 | 731,157 | `7ffec6daee4e813c4e9090162f5abdae64fc8d7bf51a91c1ad245fb7addafbd0` |
| 1005 | 230.4 | 236.8 | 14,249,207 | 7,205,636 | 730,640 | `d4fdf0f61385aa01dd9e733500ebc0f567fa78b3f1adc35918e695c9a03e3c59` |
| 1006 | 247.7 | 240.0 | 14,859,475 | 7,219,142 | 734,921 | `789466849a5f1d193675edc539ba51843fe10c395c2bd9677e574f4a7a318be7` |
| 1007 | 232.6 | 236.3 | 14,610,069 | 7,221,359 | 730,771 | `bd50d93e860f6261c07b81c4f0e59a383fd589ba96f9ef7d0e069b47c70c9640` |
| 1008 | 257.5 | 258.1 | 15,831,668 | 7,244,701 | 736,723 | `af51650679c2dca16d801256dce6f91b0ed44f92a85eb20d8c1283c2107b4d26` |
| 1009 | 230.0 | 229.7 | 13,894,843 | 7,194,912 | 731,097 | `dab26aebf27c3c0745335d1cd7749a6f67d643d0c62420025449e09431a67ded` |
| 1010 | 243.2 | 245.2 | 14,782,459 | 7,223,014 | 729,906 | `b3ef69babca0692b80042bbdcbfd009f110dc04dce93135a9b184f5ba88d2032` |

**Totals:**
- **Time:** runs 41.2 min, replays 40.9 min, and the completed `analyse` 39.4 min.
- **Car-ticks:** 149.0 million.
- **Storage:** 72.2 MB raw, or 7.3 MB as committed.

The pilot's projection was about 50 min of runs and 72 MB raw.

## Limitations

- **Track coverage:** the claim covers one training track only. The validation results run the other way for A5 against A8 (descriptive), and generalisation to unseen tracks is untested here. It is E6, a later held-out study.
- **Configuration:** one configuration (C1), chosen by a three-seed pilot. The pilot seeds are disjoint from 1001–1010.
- **Device evidence:** the runs were headless in Node. This is not device evidence.
