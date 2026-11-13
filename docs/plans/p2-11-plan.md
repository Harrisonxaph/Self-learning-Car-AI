# P2-11 plan: a spatial index for boundary collision and ray queries

> **Status: plan merged (#184); step 2, the profile, merged (#185, section 4a); step 3, the index and its equivalence suite, merged (#187, section 4b); step 4, the integration, is in review on `feat/p2-11-integrate` (section 4c). Step 5, the phone before and after, and the budget decision are the owner's.**
> - **Scope:** the roadmap entry and issue #56: a deterministic uniform-grid index over track boundary segments so collision checks and ray casts only test nearby segments, **without changing any result**. Not in scope: any change to the sensors' contract, the network inputs, the model format, experiment records, track hashes or the manifest; reducing the number of rays or cars; a Web Worker; typed-array rewrites of the simulation; any claim about learning.
> - **What this plan is not:** a prediction that the budget will be met. Section 6 says what is known, what is not, and what happens if the phone still misses after the index.

## 1. Why, and the evidence so far

The roadmap's performance budget for P2-11 (the owner's reference phone, Silverstone, a population of 50, 7 rays plus collision per car per tick): rendered at 1x, a **p95 simulation update of at most 8 ms** per frame at 60 ticks/s; headless, **at least 600 ticks/s** (10 times real time).

- **Desktop, brute force (development container, not the phone; PR #182 and the Node benchmark `npm run bench`):** Silverstone with a population of 50 ran at **57.2, 57.8 and 58.5 ticks/s** at the full population (generation-based, three runs) and **53.9, 56.9 and 55.7** (fixed work, `--car-ticks 60000`), against 600. The stadium oval ran at about 1,200. Per car-tick Silverstone costs about 21 times the oval (2,356 against 52 boundary segments). The car-tick counts are deterministic (855,978 and 234,983; 60,014 and 60,046).
- **Phone:** no figure yet. The owner's reference-phone readings (the update p95 in the draw-time readout, and the in-page headless benchmark `?mode=bench`, PR #183) are **confirmatory**: the architectural reason is already approved.
- **The cost model, as a hypothesis to be profiled first (step 1):** every query scans every segment. Per car per tick: **7 rays × N segments** (`sensors/rays.ts` `castRay`), the **collision sweep** (`sim/collision.ts` `shapeTouchesBoundary`: a bounding-box test of all N segments, then the exact test on the survivors, once per sweep slice), and **`pointOnRoad`** (one even-odd point-in-polygon test per boundary loop, so every segment once, at the end of each sweep). That is about 9 N cheap operations per car-tick (7 N for the rays, N for the sweep's bounding-box pass, N for `pointOnRoad`), which at N = 2,356 matches the measured ~350 microseconds per car-tick in order of magnitude. The profile in step 1 must confirm the split before anything is built; the index design below covers all three, but the split decides what is worth doing first.

## 2. The contract: nothing may change

The index is an optimisation. Its acceptance is **bit-identical results**, tested, not "close":

- Every ray distance, hit flag and end point, every collision verdict (`footprintHitsTrack`, `sweepHitsTrack`), and `pointOnRoad`, equal the brute-force result for the same inputs, **as the same IEEE-754 values** (compared with `Object.is`), on all test tracks and on seeded random query sets.
- Therefore the **exact existing per-segment routines are reused unchanged** (`raySegment`, `segmentNearConvex`, the even-odd crossing expression). The index only chooses **which segments to hand them**; it never recomputes a result another way. A result that is a minimum or a boolean "any" over segments, or a parity count, does not depend on the order candidates are visited, so a candidate set that is a **superset of every segment that could change the result** gives the identical value.
- The index is **derived from the track geometry only**. It is never stored in a model, a checkpoint, an experiment record, the manifest or any hash. Track hashes, geometry hashes, epochs, the saved-model and checkpoint formats and every golden or determinism test are unchanged.
- It is built deterministically (no randomness, no object-key iteration order, no dependence on query order), and a built index is immutable.

## 3. Design

- **Where it lives:** `src/sim/trackIndex.ts` (pure, headless): `buildTrackIndex(track)` returns an immutable grid; a `WeakMap<Track, TrackIndex>` cache keyed by the track object builds it on first use (a track is immutable once loaded, and a custom track is a new object each load). The three call sites ask the cache; passing a track needs no API change for callers.
- **The grid:** a uniform grid over the union of both boundaries' bounds. Cell edge: a deterministic function of the track's own geometry and fixed constants (proposed: a small multiple of the mean segment length, clamped to a fixed range, with a fixed cap on the number of cells). The exact rule is **chosen by measurement in step 2** (candidate counts per query on Silverstone and the oval) and then written into the plan's record; it is not chosen by the sensor configuration (the range is a model setting and varies). Each segment is registered in **every cell its bounding box overlaps** (conservative: extra candidates are harmless, missing ones are not).
- **Rays:** walk the cells along the ray from the origin out to `maxDistance` (an Amanatides and Woo traversal), gather the segment ids in those cells (deduplicated with a per-query stamp), and evaluate the unchanged `raySegment` on each; the nearest wins and the existing `nearest <= maxDistance` rule applies. The traversal is **conservative by a margin** (the ray's footprint is widened by a fixed epsilon far above float error and far below a cell) so that the cases the exact routine treats specially are all still candidates: an origin lying on a segment (distance 0), a segment within `LINE_TOLERANCE` of the ray's line (collinear and along-the-wall cases), a shared vertex, and a hit at exactly `maxDistance`.
- **Collision sweep:** the candidates are the segments in the cells overlapping the hull's bounding box, widened by the turn margin plus the epsilon; then the unchanged bounding-box test and `segmentNearConvex`. A boundary loop wholly inside the hull is still caught, because all of its segments lie in those cells.
- **`pointOnRoad`:** the even-odd crossing test along +x from the point needs only the segments that straddle the point's y and lie at or to the right of it: those in the grid row of the point from its column onward (widened by the epsilon). The unchanged crossing expression is evaluated on them. This is included because by this cost model it is about a ninth of the work, and a hot loop that scans every segment once per tick is worth removing once the rays are.
- **Memory and build cost:** bounded by the cell cap; built once per track object; reported by the benchmark (the build time is measured, not assumed).

## 4. Steps (each its own PR, each needing the owner's explicit authorisation)

1. **This plan** (documentation only).
2. **Profile (measure first).** A profiling mode in the Node benchmark (or a script) splits the per-car-tick cost between the ray casts, the sweep, `pointOnRoad` and the rest on Silverstone and the oval, with the machine described, and records the figures. It changes no simulation code. The index design above is revised if the split says so (for example if the sweep is negligible).
3. **The index and its equivalence suite, not integrated.** `trackIndex.ts` and tests only: the grid rule chosen and recorded from candidate counts; the three query functions written to return candidate ids; the equivalence suites below pass against brute force. Nothing calls it yet.
4. **Integration.** The three call sites use the index through the cache. The entire existing suite, the golden and determinism tests and the seeded bit-identical checks pass unchanged; `npm run bench -- --car-ticks 60000` reports **exactly the same car-tick counts** as before (the work is identical) with the new time. Desktop before and after figures go into the PR.
5. **The phone: before and after, and the decision.** The owner runs the same readings before (already in the checklist) and after on the reference phone: the update p95 at 1x and the headless rate from `?mode=bench`, under the same workload, and the figures go to #56 and #57. P2-11 is Complete only when the budget is met (roadmap acceptance); see section 6 for what happens if it is not.

### 4a. Step 2 result: the profile (2026-11-13; development container, not the phone)

Authorised by the owner's "Let's action p2-11, then following on from that once it's close we will finish p4 in full" (relayed owner instruction, Claude Code, 2026-11-13, recorded verbatim; read as authorising **steps 2 to 4** of this plan in order, each as its own PR, with step 5 (the phone readings) and every owner decision still the owner's; I will stop if this was not meant). Tooling only: `npm run profile` (`scripts/profile.mjs`, the pure aggregator `src/training/profileSummary.ts`, `tests/training/profileSummary.test.ts`) runs the same fixed-work job as `npm run bench -- --car-ticks 60000` (5,000 untimed warm-up, population 50, seed 1) under the V8 sampling profiler (100 microsecond interval, started after the warm-up) and splits self time by function into the plan's groups. **No simulation code changed.** Machine: Intel Xeon @ 2.10 GHz, 4 logical cores, Linux x64, Node 22.22.0, commit 34a9c7f.

| group (self time) | Silverstone, 2,356 segments | Silverstone, inlining off | stadium oval, 52 segments |
| --- | ---: | ---: | ---: |
| rays (`castRay`, `castRays`, `raySegment`) | 79.9% | 82.8% | 49.1% |
| sweep (`shapeTouchesBoundary`, `sweepHitsTrack`, `segmentNearConvex`, hull and helpers) | 9.2% | 5.8% | 9.6% |
| `pointOnRoad` and `inPolygon` | 7.5% | 4.6% | 4.5% |
| network and inputs | 2.2% | 2.1% | 25.4% |
| physics, gates, training harness, other | 1.2% | 4.7% | 11.4% |

(Sampled time on Silverstone 23.9 s, 60,014 car-ticks, against about 22 s unprofiled; the shares are what matter. "Inlining off" is `--no-inlining`, a V8 flag that stops a small function's time being credited to its caller; it shows how far that moves the split.)

What this says, and does not:

- **The hypothesis holds in order of magnitude.** Section 1 predicted about 78% rays, 11% sweep and 11% `pointOnRoad` from the operation counts; measured, rays are 80 to 83%, the sweep 6 to 9% and `pointOnRoad` 5 to 7.5%. On the oval the segments are so few that the network and inputs take a quarter of the time, which is why it runs about 21 times faster per car-tick.
- **The rays are the work.** An index for the rays alone removes most of the cost; but if it makes them nearly free, the sweep and `pointOnRoad` (about 14 to 17% together) become most of what is left, so reaching a 10-fold speed-up needs all three indexed. That supports decision 1 below (include the sweep and `pointOnRoad`); it does not show they are enough. The rays' own bound is about 5 times if nothing else changes (1 / (1 - 0.8)), which is below the 10 times the desktop figure needs, so a ray index that is only as good as that bound would still miss the headless budget on this container.
- **Not changed by this profile:** the design in section 3. No part of it is dropped; the ray traversal is built first in step 3 because it dominates.
- **Limits:** one container; a sampling profiler adds overhead and attributes inlined code to the caller (hence the second column); self time by function, not by line; the phone's split may differ. No claim about learning.

### 4b. Step 3 result: the index and its equivalence suite, not integrated (2026-11-13; development container, not the phone)

Authorised by the same relayed owner instruction as step 2 (recorded in section 4a): "Let's action p2-11, then following on from that once it's close we will finish p4 in full", read as authorising steps 2 to 4 in order. **Nothing calls the index yet; the simulation is unchanged.**

**What was added:**
- `src/sim/trackIndex.ts`: the grid (`buildTrackIndex`, `trackIndexFor` with a `WeakMap` cache), the indexed collision and road queries (`shapeTouchesBoundaryIndexed`, `footprintHitsTrackIndexed`, `sweepHitsTrackIndexed`, `pointOnRoadIndexed`) and the candidate collectors.
- `src/sensors/rayIndex.ts`: `castRayIndexed` and `castRaysIndexed`. **Deviation from section 3's "where it lives":** the ray queries are here, not in `src/sim`, because `docs/ARCHITECTURE.md` and the lint rules forbid `src/sim` importing `src/sensors`; both files hand the same exact routines their candidates.
- **Five `export` keywords, no other change to existing code:** `raySegment` (`src/sensors/rays.ts`) and `inPolygon`, `segmentNearConvex`, `pointOnRoad`, `shapeTouchesBoundary` (`src/sim/collision.ts`), so the index reuses the exact routines instead of copying them and the tests can call the brute-force versions. (Step 4 will route the call sites through the index and can then drop the duplicated slice loop in `sweepHitsTrackIndexed`.)
- `scripts/index-measure.mjs` (`npm run index:measure`): candidate counts and query times by cell factor.

**The cell rule, chosen from the measurement:** the cell edge is `CELL_EDGE_FACTOR` (2) times the mean segment length, at least 1 m, doubled until the grid has at most 262,144 cells and at most 4,000,000 (segment, cell) registrations (so building is bounded for any valid track; the 2,000-point synthetic track hits the cell cap and uses 2.2 m cells; the sizing loop stops at a single cell and has an attempt limit, and a non-finite or non-positive factor or an unmeasurable extent is rejected up front, after Codex found that a NaN factor looped forever). Measured on this container (`npm run index:measure`, 1,500 cars across the checkpoint gates, so on the road; microseconds per call, brute force / indexed):

| track (segments) | factor | cell edge | candidates per ray / footprint / road test | seven-ray reading | one tick's sweep |
| --- | ---: | ---: | --- | --- | --- |
| Silverstone (2,356) | 1 | 5.0 m | 4.1 / 1.9 / 7.3 | 264 / 4.9 | 56 / 3.1 |
| Silverstone | **2** | 10.0 m | 7.4 / 4.1 / 12.6 | 300 / 4.9 | 67 / 2.5 |
| Silverstone | 4 | 20.0 m | 13.8 / 9.1 / 23.3 | 266 / 6.0 | 57 / 1.9 |
| Silverstone | 8 | 40.0 m | 24.8 / 17.5 / 43.1 | 280 / 5.1 | 62 / 3.4 |
| Silverstone | 12 | 60.0 m | 34.4 / 26.1 / 62.4 | 240 / 5.9 | 43 / 2.0 |
| synthetic, 2,000 points (4,000) | **2** | 2.2 m | 6.2 / 1.9 / 11.2 | 579 / 5.6 | 127 / 2.8 |
| stadium oval (52) | **2** | 37.7 m | 8.9 / 6.7 / 13.3 | 8.1 / 3.7 | 2.4 / 3.1 |

Factors 1 to 8 are within noise of each other on time, and candidate counts grow with the factor, so the smallest factor with a modest cell count (2) was kept; it also has 4,083 registrations for Silverstone's 2,356 segments and builds in about 1 ms (7 ms for the 2,000-point track).

**What this does and does not show.** On Silverstone the query functions are about **50 to 60 times** faster for a seven-ray reading (about 300 microseconds to about 5) and about **25 times** faster for a tick's sweep (about 60 to about 2.5), and about **100 times** and **40 times** on the 2,000-point track; on the 52-segment oval the gain is small (the oval is not slow). These are **microbenchmarks of the query functions on one container**: they are not the simulation (the network, the physics and the trainer are unchanged and now a larger share), not the owner's phone, and they do not say the budget is met. Using only the step 2 profile (the rays, the sweep and `pointOnRoad` are about 97% of a Silverstone car-tick, the other 3% about 10 microseconds) the arithmetic would put the whole car-tick at roughly 20 microseconds and the headless rate on this container above the 600 ticks/s budget; that is a **hypothesis for step 4 to measure** with `npm run bench -- --car-ticks 60000` (the car-tick counts must be exactly unchanged), then the owner's phone in step 5. Section 6's risk stands: if the phone misses, the owner decides.

**The equivalence acceptance is met for this step:** `tests/sim/trackIndex.test.ts` (69 tests) checks every query against brute force with `Object.is` on the five built-in circuits (training and validation only), the 2,000-point synthetic track (also translated to (-3200, 7100) and (1e5, -1e5)), Silverstone translated, and six small synthetic tracks; about 420,000 seeded random ray queries, plus road tests, footprints and sweeps (straight, turning and sharply turning), shape tests with margins, and the adversarial cases listed in section 5; plus a direct test that the candidate list contains every segment that could change a result. See `docs/TESTING.md`.

### 4c. Step 4 result: the index is integrated (2026-11-13; development container, not the phone)

Authorised by the same relayed owner instruction as steps 2 and 3 (section 4a): "Let's action p2-11, then following on from that once it's close we will finish p4 in full", read as authorising steps 2 to 4 in order. **No caller changed:** every call site reaches the index through three public functions, and each now asks the track's cached index (`trackIndexOrNull`) and falls back to brute force for a track that cannot be indexed.
- `src/sensors/rays.ts`: `castRays` uses the index; `castRaysBruteForce` (the previous body, unchanged) is kept as the reference; `castRaysIndexed` and `castRayIndexed` are here now (the former `src/sensors/rayIndex.ts` is removed). Inside `castRaysIndexed` the per-ray argument checks, which `castRays` has already made, are skipped.
- `src/sim/collision.ts`: `footprintHitsTrack` and `sweepHitsTrack` use the index; `footprintHitsTrackBruteForce`, `sweepHitsTrackBruteForce`, `shapeTouchesBoundary` and `pointOnRoad` are the reference. The sweep's slice loop exists once (`sweepSlices`), run with brute force or with the index, so the two cannot drift. The indexed shape, footprint and sweep functions moved here from `trackIndex.ts` because collision now imports the index (the index must not import collision).
- `src/sim/trackIndex.ts`: the grid, the cache (`trackIndexOrNull`, which remembers an unindexable track as such), the candidate collectors and the road test.
- `src/training/profileSummary.ts`: a `track-index` group, so a profile after integration shows the index's own cost.

**Acceptance, met:** the whole existing suite passes unchanged, including the golden and determinism tests (134 files, 3,457 tests); `npm run bench -- --car-ticks 60000` reports **exactly the same car-tick counts as before** (60,014 on Silverstone, 60,046 on the oval; the in-page pinned counts 1,043 and 1,046 are covered by `tests/training/benchmarkJob.test.ts`); and new tests in `tests/sim/trackIndex.test.ts` show the public functions equal their brute-force references and that whole `stepCar` trajectories (24 cars per circuit, random controls, up to 500 ticks, until a crash) are bit-identical to a stepper built on the brute-force sweep, every tick.

**Desktop before and after (same container, `npm run bench -- --car-ticks 60000`, population 50, seed 1, three runs each; "before" is main at `957a148` where the index was built but unused):**

| Circuit | Car-ticks | Before: car-ticks/s | Before: ticks/s at the full population | After: car-ticks/s | After: ticks/s at the full population (budget 600) |
| --- | ---: | --- | --- | --- | --- |
| silverstone | 60,014 | 3,011; 2,867; 3,060 | 60.2; 57.3; 61.2 | 104,316; 104,421; 96,655 | **2,086; 2,088; 1,933** |
| stadium-oval | 60,046 | 49,074; 70,530; 68,860 | 981; 1,411; 1,377 | 118,183; 97,158; 114,246 | 2,364; 1,943; 2,285 |

Silverstone is about **33 times** faster per car-tick and now about **3 times above the headless budget on this container**; the oval is about 1.7 to 2.4 times faster (it was never slow, and the network now dominates it). **This is not the phone.** The budget is the owner's reference phone, which is slower than this container by an unknown factor, and the update-time budget (p95 of 8 ms at 1x) is also the phone's to show; step 5 decides, and section 6's rule applies if the phone misses.

**Where the time goes after the integration** (`npm run profile -- --car-ticks 200000`, same container): Silverstone: network and inputs 40.9%, rays 14.6%, track index (the grid walk and candidate collection) 13.0%, sweep 11.8%, road test 6.0%, training harness 5.8%, physics 3.4%. The index's own overhead is about an eighth of the time and the segment work (rays, sweep, road test) is about a third, down from about 97% before. A further speed-up, if the phone needs one, would now come from the network and the ray walk, not from segment tests; that is outside this plan and would be the owner's decision.

**Step 5 for the owner:** the build to call "before" on the phone is the deployment of main at `957a148` (the index merged but not used, so brute force; it also has the in-page benchmark and the update-time readout), and "after" is main at `623425b` (the #188 merge) or any later build; the readout's last line names the build. The same two readings under the same workload on each: the update p95 at 1x from `?debug=drawtime`, and the headless rate from `?mode=bench` (`docs/MEASUREMENT_CHECKLIST.md` sessions A and B2). No claim is made about the phone until you have measured it.

## 5. Tests (written with the plan, so the acceptance cannot drift)

- **Equivalence (the core):** for every built-in training and validation circuit, for a synthetic circuit with the format's maximum 2,000 points per boundary, and for small synthetic tracks, the indexed ray distances, hit flags and end points, collision verdicts (footprint and sweep, including sharp-turn slicing) and `pointOnRoad` are bit-identical (`Object.is`) to brute force over **seeded random** queries (hundreds of thousands: origins on and off the road, random headings, ranges, poses and sweeps) and over **adversarial** cases: an origin on a segment, on a vertex and on a cell boundary; a ray along a wall (the ±90 degree case), through a shared vertex, collinear with a segment, parallel to one; a hit at exactly `maxDistance`; a segment spanning many cells, wholly inside one cell and exactly on a cell edge; negative coordinates and bounds that fall exactly on a cell boundary; a point on the polygon's y-row of a vertex.
- **Held-out boundary:** the equivalence suites use training and validation geometry and generated synthetic tracks only; no held-out circuit is read except through the guarded helpers the existing tests already use, and the existing leakage tests still pass.
- **Determinism:** two builds of one track are identical; results do not depend on query order or on cache state; a custom track loaded twice gives the same results.
- **Unchanged contracts:** golden, determinism, model-format, checkpoint-format, experiment-record, manifest and epoch tests pass unchanged; the index appears in none of them.
- **Benchmark:** the same car-tick counts before and after (identical work), with before and after timings; a test that the index build is bounded by the cell cap.

## 6. Risks and what is not known

- **The budget may still be missed.** On the desktop container, the budget needs about a 10-fold speed-up (57 against 600 ticks/s), and a phone is slower than a desktop. A grid should remove most of the per-segment work, but **how much is not known until it is built and measured**, and the headless budget is the demanding one. If the budget is missed after the index, **I will report it and the owner decides**: further optimisation (typed arrays, fewer queries per tick), a revised budget, or accepting a slower Silverstone. None of those is in this plan.
- **Bit-identical is stricter than "fast enough".** If an adversarial case cannot be made identical with a conservative candidate set, the answer is a larger candidate set, never a different calculation.
- **Cell-size sensitivity:** too small and rays cross many cells; too large and cells hold many segments. The rule is chosen on measured candidate counts for the two circuits and the 2,000-point synthetic track, and could be wrong for a very different custom track; it must stay correct (only slower) for any valid track.
- **`pointOnRoad` equivalence is the subtlest.** The crossing test's floating-point expression can place a crossing a rounding error outside the segment's bounding box; the epsilon widening exists for that, and the adversarial cases target it.
- **Evidence limits:** the desktop figures are one container; the phone is the owner's reference. No claim here is about learning.

## 7. Decisions for the owner (each recommended, none assumed)

1. **Include `pointOnRoad` and the sweep in the index, not only the rays.** Recommended: yes (the profile in step 2 can confirm or drop either before step 4).
2. **A synthetic 2,000-point-per-boundary track generator in the tests** (no product surface, no new circuit). Recommended: yes; it is the stress case for the index and the same worst case the P4-07 plan names. It does **not** by itself resolve the open P4-07 geometry decision (running such a track on the training page for the draw-time measurement is a separate, unrequested follow-up).
3. **Staging as the four PRs above**, each authorised in order (the precedent is "Continue development" after a plan merges, recorded verbatim).
4. **If the phone still misses after the index**, report and decide then (section 6); I will not start further optimisation work on my own.
