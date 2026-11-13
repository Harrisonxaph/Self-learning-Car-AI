# Owner measurement checklist: the reference phone (P4-06 step 4 and P4-07)

One sitting on your reference iPhone covers the **overlap** of the two remaining measurement items' prescribed workloads, and it is enough to give P2-11 its baseline. **It does not by itself complete P4-07's draw-time measurement:** the plan prescribes more conditions than the overlap session covers, and they stay **mandatory and outstanding** (section 4) until each is measured, or the owner records a waiver or an explicit criterion change for it. The input-responsiveness waiver (section 0.3) waives that one measure only.

- **P2-11's performance budget** (the P4-06 step 4 baseline, [#56](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/56) and [#57](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/57)): Silverstone, a population of 50, 7 rays plus collision per car per tick. Rendered at 1×, a p95 **simulation update** of at most **8 ms** per frame at 60 ticks/s. Headless, at least **600 ticks/s**.
- **P4-07's draw-time budget** ([#58](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/58), `docs/plans/p4-07-plan.md` section 6, line 59): the same reference phone, a track whose boundary has the **maximum the format allows (2,000 points per boundary)** as a stand-in for Silverstone (written when P4-06 was not built), the training page with its usual drawn cars (**50, and Max mode's ten**) **and the champion replay**, camera at **zoom 1.5, 4 and the maximum**, in **zoom and in follow mode**, in **portrait and landscape**, with a p95 **camera draw time** of at most **4 ms** over at least 600 frames and no long task above 50 ms during a 10 s gesture.

The overlap is the **update-time reading** and the draw reading taken together: one readout, `?debug=drawtime`, reports the camera draw time (P4-07) and, since this step, the simulation update time per frame (P2-11) over the **same** 600-frame window. Every P4-07 reading taken on Silverstone with 50 cars at Normal speed therefore also gives the P2-11 update figure, so you never repeat a measurement for the second item. Everything else is either only P4-07 (the rest of the prescribed grid, Max mode, the replay and the maximum-size geometry) or only P2-11 (the headless benchmark, Session B2).

Nothing here has been measured on a phone. The desktop figures at the end are from a development container and are for comparison only: the budget names your phone.

## 0. The owner's three decisions (made 2026-11-13; they change what this checklist asks)

Relayed owner instruction (Claude Code, 2026-11-13), the owner's reply to the three decisions put to them, verbatim: "1. Approve the reasoning now / 2.approve small follow up / 3.waive it". Read against the numbered questions in the step 4 summary (the headless figure on a phone; whether the desktop result is already enough; input responsiveness): I will stop if this was not meant.

1. **P2-11's trigger: the architectural reason is approved now** (from the desktop result: Silverstone with 50 cars at about 57 ticks/s against the 600 budget; see section 9). The phone's P2-11 figures are therefore **confirmatory**, not the trigger. P2-11 is triggered but is not implemented: it starts as a plan-only PR, and P4-06 stays In Progress and cannot be Complete until P2-11 is Complete and the budget is met (ROADMAP, P4-06 acceptance). Approving the reasoning is not approval to implement the index.
2. **The headless figure on a phone: the small follow-up is approved and built** (its own PR, after the one that added this checklist). The page `?mode=bench` runs the real trainer with no drawing and reports the phone's headless ticks per second directly (Session B2), so the Max-speed tick rate (Session B) is **not** the headless figure and is recorded as a context reading only.
3. **Input responsiveness (the pinch-to-frame time in the P4-07 plan) is waived** by the owner and recorded as waived, not as passed or measured. It is not part of what P4-07's remaining measurement shows.

**What the decisions above do not do, and what is still open (the owner's to decide and record):** the waiver in 3 covers input responsiveness only. Every other prescribed P4-07 condition stays **required** until measured or until the owner records a waiver or an explicit criterion change for it. Two choices are open, and until they are recorded the conditions are outstanding, not optional:

- **Geometry.** The plan names a maximum-size stand-in (2,000 points per boundary) because Silverstone did not exist yet. Silverstone has 1,178 points per boundary (2,356 segments), fewer than the stand-in, so a pass on Silverstone does **not** show a pass on the plan's worst case. **(a)** Record an explicit criterion change that Silverstone, now built, replaces the stand-in; or **(b)** keep the maximum-size workload, for which the training page has **no way to run one today** (it offers only the built-in training circuits): that needs a small measurement-only follow-up, which I will build only if you ask.
- **Coverage.** The plan's grid is zoom 1.5, 4 and maximum, in zoom and follow mode, in portrait and landscape, for the 50-car workload, Max mode's ten cars and the champion replay (section 4). If you want a smaller grid, record that as an explicit criterion change; I will not treat it as optional.

### 0b. The owner's phone-test acceptance, the evidence on record and the two P4-07 criterion changes (recorded 2026-11-13)

Relayed owner instructions (Claude Code, 2026-11-13), the owner's words, verbatim. First: "Phone tests have been confirmed and accepted by me. I am happy with both the other points". The "other points" are the two choices put to them: "whether Silverstone replaces the 2,000-point stand-in geometry, and whether a smaller grid is acceptable". Asked which items they approve as Complete, which phone tests the acceptance covers, and whether the reading of the two choices below was right, they answered: "Recording device testing"; "Recording testing"; "Yes, that reading". Then, after an audit of the evidence below put the question of which cells the accepted grid is: "Push correction. The fit-view readings are what I'm accepting." I will stop if any of this was not meant.

**The measurements are on record.** The owner supplied them to Codex, which transcribed them in its comments on [#56](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/56#issuecomment-6865038582), [#57](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/57#issuecomment-6865038901) and [#58](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/58#issuecomment-6865039241) (an earlier version of this section said no figures were supplied; that was true of what the owner told Claude Code directly, and was incomplete). Build identities were checked against Vercel: **before** `957a148` (brute force), **after** `623425b` (the #188 merge, index integrated).

| Headless (`?mode=bench`, Silverstone, population 50, seed 1) | Car-ticks | Compute | Ticks/s at the full population (budget 600) |
| --- | ---: | ---: | ---: |
| Before, ~19:55 | 60,014 | 28.36 s | **42.3** |
| After, ~19:55 | 60,014 | 0.32 s | **3,798** |
| After, ~20:04 (recording) | 60,014 | 0.32 s | **3,786** |

| Rendered, after build, Normal 1x, 50 drawn, fit view (zoom 1.00) | Update p95 (budget 8 ms) | Draw p95 | Frame gaps over 50 ms | Draws over 50 ms |
| --- | ---: | ---: | ---: | ---: |
| Portrait (~20:04) | 1 ms | 1 ms | 0 | 0 |
| Landscape | 1 ms | 1 ms | **1** | 0 |

**Limits that stay on record:** the device is "an iPhone" from the page's user-agent (iOS 18_7 as observed); model, Low Power Mode and thermal state were not confirmed. Each reading is a single reading, not a distribution. Alive cars vary within a window (portrait showed 50 running, landscape 1). The only **before** rendered reading (update p95 120 ms) drew 25 cars, so the rendered before and after comparison is **not matched** (no 50-drawn before reading, no before landscape); the headless comparison is matched (identical work). The landscape frame gap is unexplained and its timing relative to any gesture is unknown; Safari has no Long Tasks API, so gaps and slow draws are proxies. The screenshots and the 4.5 s portrait recording are not attached to GitHub. No learning or generalisation claim.

**The owner's two P4-07 criterion changes:**
1. **Geometry:** Silverstone, now built, replaces the 2,000-point maximum-size stand-in as the P4-07 workload. No maximum-size workload is built.
2. **Coverage:** the accepted P4-07 draw-time evidence is **the fit-view readings above** (Silverstone, 50 cars drawn, Normal speed, zoom 1.00, portrait and landscape), in place of the plan's grid (zoom 1.5, about 4 and the maximum, in zoom and follow mode, Max mode's ten cars, the champion replay, and the 10 s gesture). Those cells were **not taken**, and the owner's acceptance removes them from the criterion; section 4 is no longer the completion test.

**Update (2026-11-13, later): the owner then instructed "Mark P2-11, P4-06 and P4-07 Complete"; the completion record is in `docs/ROADMAP.md`, and the paragraph below describes this section as first written.** **What this record does not do:** it marks **nothing Complete**. The owner chose to record the testing, so P2-11 stays Not Started (triggered), P4-06 stays In Progress and P4-07 stays In Review until the owner approves each explicitly, as for P4-02 to P4-05 (`docs/ROADMAP.md`, 2026-11-12). Open and the owner's: Silverstone's 420 s episode limit against the roughly 494 s scripted lap (P4-06); the landscape frame gap; a physical tablet check of Silverstone's display (no iPad model is recorded).

## 1. Before you start

- Use the deployed site after this PR is merged (the address you used before: `https://self-learning-car-ai.vercel.app`), so the build is the one with the update figures. The readout's last line names the build.
- Record in #56, #57 and #58 **before** measuring: iPhone model, iOS version, Safari (not an in-app browser), the build shown in the readout, and whether Low Power Mode is on (**turn it off**, and keep the same state for every reading).
- Close other tabs and apps. Plug in or have good charge; a hot phone throttles, so note it if the phone feels warm and let it cool between sessions.
- Take a screenshot of each reading (the readout is at the bottom of the screen and stays put).
- **A reading is valid only when the readout shows `Frames 600/600`** (and `frames 600/600` on the update line). Changing the speed, pausing, changing the cars-drawn choice or starting a replay **restarts the window**, on purpose, so each workload collects its own 600 frames. **Zoom and follow do not restart it: reload the page between zoom levels** so each reading is a fresh window.

## 1b. Before and after the spatial index (P2-11 step 5)

The spatial index (P2-11) is used by the simulation from the merge of its integration PR (#188, main at `623425b`). The readings in this checklist are therefore **after** readings from that merge onward. For the **before** readings use the deployment of main at `957a148` (the index merged but not used: brute force; it already has the update-time readout and `?mode=bench`), and take the same readings under the same workload, same phone state and same Low Power Mode setting on each. Desktop figures: section 9. A phone reading from the old build is the only honest "before"; nothing here predicts it.

## 2. Session A: Silverstone, Normal speed, 50 cars (the P2-11 baseline, and partial P4-07 evidence)

Address: `/?mode=train&circuit=silverstone&debug=drawtime,fps` (both readouts together).

What this session is and is not: it **fully answers P2-11's update-time budget** for its workload, and it gives a P4-07 draw reading **at the fit view (zoom 1.00)**, which is **not** one of the plan's prescribed zoom levels (1.5, 4, maximum), so it is partial P4-07 evidence only. Its readings are valid and are **not repeated** in section 4.

1. Open the address. The camera starts at the fit view (zoom 1). Leave speed at **Normal**. Do not touch the camera.
2. Wait until the draw-time readout shows `Frames 600/600` and the update line shows `frames 600/600`. About 10 to 20 seconds.
3. Read and record:
   - **Camera draw time** p50, p95, max, and the verdict line against 4 ms (P4-07, fit view only).
   - **Simulation update per frame** p50, p95, max, and the **P2-11 budget** verdict against 8 ms (P2-11).
   - The `?debug=fps` line: frames per second, ticks per second and the mean step time (context: at Normal speed ticks/s should sit near 60 if the phone keeps up).
   - Frame gaps over 50 ms and draws over 50 ms (Safari cannot report long tasks; these are the stand-in, and the readout says "not reported by this browser").
4. **Take the reading twice:** once at the start, and once again about two minutes later, after a few generations. The update time depends on how many cars are still running, so the first window and a later one can differ; record both.
5. Do it in **portrait** and again in **landscape** (reload after rotating).

## 3. Session B: Silverstone, Maximum speed (P4-07's Max mode at the fit view; the tick rate is context only)

Address: `/?mode=train&circuit=silverstone&debug=drawtime,fps`. Press **Max**.

1. Let it run 30 seconds, then read the `?debug=fps` ticks per second and frames per second. Record both. (At Max, many ticks run per frame, so the update-per-frame figure is large by design and the 8 ms budget does **not** apply to it. The readout says "1x speed only".)
2. The draw readout at Max draws about ten cars (the cars-drawn cap at Max): record its p95 against 4 ms with `Frames 600/600`. This is the Max-mode workload at the fit view, partial evidence like Session A; the prescribed zoom levels for it are in section 4.
3. The ticks-per-second figure here is context only; the phone's headless figure is the approved in-page benchmark's (decision 0.2).

## 3b. Session B2: the headless benchmark on the phone (P2-11's headless budget)

Address: `/?mode=bench` (Silverstone by default; `&circuit=stadium-oval` or `&circuit=kidney-loop` for comparison). The page runs the real training simulation with **no drawing**, a population of 50, seed 1, for 60,000 measured car-ticks after 5,000 untimed warm-up car-ticks, in short slices so the page stays responsive, and shows a table when it finishes.

1. **Check the work first (about 10 seconds):** open `/?mode=bench&carticks=1000`, press Run. The Work row must say **1,043 car-ticks measured** for Silverstone (**1,046** for the stadium oval) with 21 ticks. Those counts are the same on every machine; if they differ, tell me, because then the phone is not running the same work and the figure means nothing.
2. Open `/?mode=bench`, press **Run**, keep the page **in front and the screen on** until it finishes (the page stops the run if it leaves the foreground, and says so; nothing is reported then). A slow phone may take a few minutes; **Cancel** reports nothing.
3. Read the table: **Ticks per second at the full population of 50** (the headless budget is 600 and the row says at least or below), **Car-ticks per second**, **Compute time**, and the Build and Browser rows.
4. Take it **twice** (reload between runs), and note whether the phone felt warm. Screenshot each table.

The Node equivalent, for comparison on the same work: `npm run bench -- --car-ticks 60000` (section 9).

## 4. Session C: the prescribed P4-07 coverage (mandatory for completion; outstanding until done)

> **Superseded by the owner's criterion change (section 0b, 2026-11-13):** the accepted P4-07 draw-time evidence is the fit-view readings, so the cells below are **not required** for completion. They are kept as the original plan and as a method if anyone wants more evidence.

This is the plan's condition set, written out so nothing is left to memory. **You choose the order, and you can spread it over several sittings.** What you cannot do is treat P4-07's measurement as complete while any cell below is missing, unless you record a waiver or an explicit criterion change for that cell (as you did for input responsiveness).

**The matrix.** Every combination of: **workload** (W1: training, 50 cars drawn, Normal speed; W2: training, Max mode, about ten cars drawn; W3: champion replay) × **zoom** (about 1.5, about 4, the maximum) × **camera mode** (zoom, follow) × **orientation** (portrait, landscape) = **36 cells per geometry**. Geometry G1 is Silverstone; G2 is the maximum-size stand-in, which is **outstanding** until you decide (section 0, Geometry).

**How to take a cell.** Address `/?mode=train&circuit=silverstone&debug=drawtime` (add `,fps` if you want the rate). **Reload, then** set the workload (W1: leave Normal; W2: press Max; W3: after at least one generation has finished, open **Champion replay**, choose generation 1 and Start), use the camera buttons to reach the zoom (the readout's context line shows the actual zoom, for example `zoom 4.00x free` or `following`: record what it shows, not what you aimed for), do a **10 second gesture** during the window (pinch and pan in zoom mode; let the camera follow in follow mode), and when it shows `Frames 600/600` record draw p50, p95, max, frame gaps and draws over 50 ms. Reload between cells so each is a fresh window (zoom and follow do not restart it).

**The overlap, so nothing is repeated.** Each **W1 cell on Silverstone** also gives the P2-11 update p95 (the update line, same window), so those 12 readings serve both items and Session A does not need to be redone. W2 and W3 cells are P4-07 only.

**W3 caveat.** A replay ends when the car crashes or stalls, and a random early champion may end well before 600 frames; if the readout cannot reach `Frames 600/600` for a W3 cell, **that cell cannot be measured as the plan specifies**. Record "replay shorter than the window", not a figure, and decide (a longer-lived champion, or an explicit criterion change); it is not optional by default.

**Coverage tracker** (paste into #58 and update it as cells are taken; a cell is "not taken", "taken: p95 x ms, pass or over", "waived by the owner (with the comment link)" or "cannot be measured (reason)"):

| Geometry | Workload | Zoom | Mode | Portrait | Landscape |
| --- | --- | --- | --- | --- | --- |
| G1 Silverstone | W1 | 1.5 | zoom | not taken | not taken |
| ... | ... | ... | ... | ... | ... |

(one row per workload × zoom × mode: 18 rows for G1, 18 more for G2 if G2 is kept).

## 5. A suggested order (the order is optional; the coverage in section 4 is not)

1. Session A, in both orientations (the P2-11 update baseline, fast).
2. The W1 cells of section 4 on Silverstone (each also gives the P2-11 update figure again at the prescribed zooms).
3. Session B, then the W2 cells.
4. The W3 cells.
5. Anything the owner decides about geometry or the grid (section 0), recorded as a comment before the measuring, so no reading is judged against a changed rule afterwards.

## 6. What to write down, and where

Paste a table like this into #56, #57 and #58 (one table, three comments, so each issue holds its own evidence):

| Session | Orientation | Zoom (as shown) | Mode | Frames | Draw p50 / p95 / max (ms) | Update p50 / p95 / max (ms) | Ticks/s (fps readout) | Frame gaps >50 ms | Draws >50 ms | Verdicts shown |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

and, for Session B2, a second table: circuit, car-ticks measured, compute time, car-ticks per second, **ticks per second at the full population**, the budget wording shown, run 1 or 2, build, browser.

plus the device block from section 1, your decisions from section 0 and the coverage tracker from section 4. Attach the screenshots.

## 7. What each result means (stated now so it cannot be bent later)

- **P4-07:** the plan's criterion is met only when **every prescribed cell** in section 4 (for every geometry the owner keeps) has a draw p95 of at most 4 ms **and** no draw or frame gap over 50 ms during its 10 s gesture, with each missing cell either measured or covered by an owner-recorded waiver or criterion change. Until then the readings taken are **partial evidence** (Sessions A and B, and any section 4 cells): they show how the phone did on those workloads and nothing about the others. A p95 over 4 ms in any cell means the plan's fallback (the transformed cache, then culling) is measured next. It is the owner's decision to call P4-07 Complete; P4-07 stays In Review until then.
- **P2-11:** it is **already triggered** by the approved architectural reason (decision 0.1). The phone's update p95 (at most 8 ms at Normal speed, Session A) and headless rate (at least 600, Session B2) are the baseline the index is later measured against, before and after, under the same workload; P4-06 stays In Progress until P2-11 is Complete and the budget is met (ROADMAP, P4-06 acceptance).
- A pass on a phone is a statement about one phone, one build and one workload on the day, nothing more.

## 8. What this checklist cannot measure (so nobody reads more into it)

- **Input responsiveness** (the time from a pinch to the frame that shows it) is in the P4-07 plan's measures but is not instrumented; the owner **waived** it (decision 0.3), so it is recorded as waived.
- **Long tasks:** Safari has no Long Tasks API; the frame-gap and slow-draw counts are proxies that catch the same stalls, not the same numbers.
- **The headless budget on a phone** is the Session B2 page's figure: the real simulation with no drawing, but inside a browser tab, in slices, with the page's own timer scheduling between them (only time inside slices counts). It is a browser figure, not a bare-engine figure, and one reading is not a distribution. The Node benchmark (`npm run bench`) runs headless on a computer, not on the phone.
- **Heat and battery state** change timings; one reading is not a distribution. The two-minutes-later reading in Session A is the only repeat asked for; the coverage in section 4 is cells, not repeats.
- Nothing here says anything about learning. The cars are a seeded training run; no model is saved or judged.

## 9. Desktop reference (comparison only, never the phone's result)

**After the spatial index (P2-11 step 4), same container, `npm run bench -- --car-ticks 60000`, three runs:** Silverstone 2,086; 2,088; 1,933 ticks/s at the full population (the tables below are the brute-force figures before it: about 57 to 61), the oval 2,364; 1,943; 2,285; the car-tick counts are unchanged (60,014 and 60,046). Desktop figures only; see `docs/plans/p2-11-plan.md` section 4c.

Measured with `npm run bench` (`scripts/bench.mjs`, `src/training/benchmark.ts`), the real trainer, population 50, seed 1, brute-force collision and rays, 10 timed generations after 2 warm-up generations. Machine: an Intel Xeon at 2.10 GHz, 4 logical cores, a shared development container, Node v22.22.0, `main` at `60f0574` with these changes uncommitted. Timings come from one machine in one container and vary run to run; the simulated work (the car-tick count) is deterministic.

| Circuit | Boundary segments | Mean running cars | Car-ticks (deterministic) | Wall time, three runs (s) | Car-ticks/s | Ticks/s at the full population of 50 (budget: 600) |
| --- | ---: | ---: | ---: | --- | ---: | --- |
| stadium-oval | 52 | 10.8 | 234,983 | 3.92, 3.87, 3.83 | about 60,000 to 61,300 | 1,199.5, 1,215.2, 1,225.5 |
| silverstone | 2,356 | 7.7 | 855,978 | 299.3, 296.0, 292.8 | about 2,860 to 2,920 | **57.2, 57.8, 58.5** |

How to read it: "ticks/s at the full population" is the car-tick rate divided by 50, the rate if every car stayed running, which is conservative (see `src/training/benchmark.ts`). Per car-tick, Silverstone costs about 21 times the oval here (45 times the boundary segments), as brute-force collision and ray queries would predict. **This is a desktop container figure, not your phone's, and it is not by itself the P2-11 trigger** (section 0.2). It also means a 50-car Silverstone generation takes about 30 seconds of one core here, so training on Silverstone on a phone will be far slower than on the oval.

Reproduce it: `npm run bench -- --generations 10 --warmup 2 --out bench.json` (about five minutes for Silverstone). The car-tick counts must match the table exactly; the timings will differ on another machine.

**The same work as the phone page (Session B2)**, `npm run bench -- --car-ticks 60000` (population 50, seed 1, 5,000 warm-up car-ticks), three runs on the same container:

| Circuit | Car-ticks measured (deterministic) | Mean running cars | Compute time (s) | Car-ticks/s | Ticks/s at the full population (budget: 600) |
| --- | ---: | ---: | --- | --- | --- |
| stadium-oval | 60,046 | 29.8 | 0.96, 1.00, 0.93 | 62,409; 60,064; 64,282 | 1,248.2; 1,201.3; 1,285.6 |
| silverstone | 60,014 | 31.7 | 22.27, 21.09, 21.55 | 2,695; 2,846; 2,785 | **53.9; 56.9; 55.7** |

This fixed-work run starts from generation 0 (so more cars are still running early on) and so reads slightly differently from the generation-based figures above; both say Silverstone is about ten times short of the budget on this machine.
