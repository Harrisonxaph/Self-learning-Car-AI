# P2-08 exploratory pilot: results (plan step 4)

**Status: exploratory and acceptance-ineligible.** This pilot never counts towards Phase 2 acceptance. Each of the three analyses has the decision `not evaluated: pilot analysis is acceptance-ineligible` and no claim. Nothing here is evidence of learning, of improvement, or of outperforming random search. The numbers below exist only to apply the decisions fixed in advance in [the pilot protocol](../../../../docs/experiments/p2-08-pilot-protocol.md) §3.

## Run

- **Frozen code:** `c14f36862c72463bd8eee5371d2a4ad7dad2adba`, run from a clean detached worktree (`git status` empty before and after the runs) with `npm ci`.
- **Manifests:** `experiments/manifests/p2-08-pilot-c0.json`, `-c1.json` and `-c2.json`, as merged in #107.
- **Engine:** Node v24.22.1 (V8 13.6.233.17-node.58), one engine for every run, replay and analysis.
- **Date:** 2026-11-02, 12:44–14:08 UTC, run in the order C0, C2, C1, one process at a time on one cloud container.
- **Procedure:** as in protocol §2:
  - each seed was run, then replayed (`replay`);
  - each candidate was then analysed (`analyse`, which replays every record again).
- **Outcome:** all nine runs exited 0, all nine replays exited 0 (identical), and all three analyses exited 0. No seed was substituted or rerun.
- **Seeds:** pilot seeds 9001–9003 only. No confirmatory seed (1001–1020) was run.
- **Held-out track:** not evaluated.

## Measurements

The wall time covers the `run` command only. Car-ticks are the executed ticks that `run` prints. The raw size and SHA-256 are for the uncompressed record. The committed file is that record compressed with `gzip -9 -n`. Running `gunzip` on it restores the exact bytes, so the record's `resultsHash` and `npm run study -- replay` still apply.

| Candidate | Seed | Run (s) | Car-ticks | Raw bytes | Committed `.json.gz` bytes | SHA-256 of the uncompressed record |
| --- | --- | --- | --- | --- | --- | --- |
| C0 | 9001 | 115.5 | 5,316,484 | 3,642,262 | 362,095 | `3b08052c60706c95b952948ba3390db7bd596d47b99362ec3c78e2403774ee98` |
| C0 | 9002 | 141.6 | 6,767,880 | 3,671,505 | 369,435 | `1e1f1cca631b6df177f1bc211ecfd2a56573321ba02b3e57d5f4bce7c8dfe0e6` |
| C0 | 9003 | 148.5 | 6,860,974 | 3,669,764 | 374,063 | `7627bdcf4fa0660fa2541bd2d908ad1284238db726fe58c61401757d961fb6be` |
| C1 | 9001 | 268.3 | 12,169,853 | 7,158,035 | 724,175 | `7d40b4e8bf4846a0de974e0bcdd61e419694cc72fe33b8bd11027808319a4951` |
| C1 | 9002 | 322.8 | 14,239,966 | 7,204,360 | 733,695 | `01fc1b1dc5064087a9af54968b99b339e3f26ec33a4d763f8e02fcc82059a22e` |
| C1 | 9003 | 317.3 | 14,728,507 | 7,209,788 | 739,169 | `80b17110f884f84c66b36cf4be0f8f088925c1d36b1b393f5b08e015012f3321` |
| C2 | 9001 | 108.7 | 5,081,299 | 3,629,808 | 363,153 | `3e4c6b00adfeeba65e908edee7cefc739cf10f30356099cd473fda81e9bc9b64` |
| C2 | 9002 | 116.6 | 5,392,796 | 3,627,877 | 363,442 | `9a51e5ca4bac5105c8f5eb6a24c4870474e4d0c04f764b451804165110caf986` |
| C2 | 9003 | 121.9 | 5,614,754 | 3,640,860 | 366,644 | `323db40b9ac9d989c48ebc239344fc3ca06faf3b1bb44c41fcedffbcfc9f8e9c` |

**Other timings:**
- a replay took about as long as its run, for example 4.6–5.6 min for each C1 record;
- `analyse`, which replays all three records, took 6–7 min for each G = 50 candidate and 15.9 min for C1;
- in total, the nine runs took 27.7 min, and the whole pilot took 84 min.

Each candidate's `analysis.json` and `report.md` are in `c0/`, `c1/` and `c2/`, exactly as `analyse` wrote them.

## Decisions fixed in advance (protocol §3)

These were computed with `node scripts/pilotSummary.mjs . experiments/results/p2-08/pilot`. The script reads the records and analyses committed here, using the merged step 3 library (`training/analysis.ts` and `trackSplits.ts`, unchanged since the frozen commit).

### 1. Configuration choice: **C1**

This is `selectByValidation` in the order C0, C1, C2. Its input is each candidate's A5 frozen-model **validation-track** gates per seed (9001, 9002, 9003), with 14 gates per lap. Training-track results were not used.

| Candidate | A5 validation gates | Mean (laps) |
| --- | --- | --- |
| C0 | 4, 3, 4 | 0.2619 |
| C1 | 6, 3, 4 | 0.3095 |
| C2 | 3, 4, 4 | 0.2619 |

C1 has the highest mean, so the tie rule is not needed. The mean difference is 2 gates in total across three seeds, so the choice is fixed by the rule, not by a clear margin.

### 2. Confirmatory n: **10 (seeds 1001–1010)**

The input is C1's three training-track differences `d_s = progress(A5) − progress(A8)`, taken from `c1/analysis.json`:
- the values are 0.7, 0.8 and 0.4 laps;
- the sample sd (n − 1) is 0.2082;
- the projected half-width at n = 10 is 1.96 × 0.2082 / √10 = **0.1290**.

That is not greater than δ = 0.25, so the rule gives n = 10. This is the planning rule only. The confirmatory analysis uses the predeclared bootstrap.

### 3. δ: **stays 0.25**

### 4. Lap check (descriptive): **yes**

All three of C1's A5 training episodes completed a valid lap within the 60 s limit, so the lap completion rate is 3/3. The mean first-lap time was 24.41 s. By comparison, C1's A8 completed 3/3 with a mean of 32.23 s.

## Confirmatory projection (C1, n = 10)

This is a planning estimate from the C1 pilot means, for one process on this kind of container. It is not a commitment.

- **Runs:** 10 × 303 s ≈ 50 min, about 137 million car-ticks in all.
- **Replays:** one per record after it is run, about 50 min.
- **`analyse`:** replays all ten records, about 53 min.
- **Total:** about 2.5–3 h, run sequentially.
- **Storage:** about 72 MB of raw records, or about 7.3 MB with gzip as committed here.

## Observations, descriptive only

- **Training versus validation:** for C1, A5's training-track progress has a mean of 2.52 laps, but its validation-track progress has a mean of only 0.31. Every A5 and A8 validation episode crashed in every candidate. In C1, A5 − A8 on validation is 0.02 laps.
- **The A5 − A8 training difference:** it was 0.55 laps for C0, 0.63 for C1 and 0.55 for C2. These are three-seed pilot values and are not tested.
- **What this does not show:** these numbers do not support any claim. The confirmatory study (plan step 5) needs its own manifest and protocol, Codex review and the owner's approval before any confirmatory seed runs.
