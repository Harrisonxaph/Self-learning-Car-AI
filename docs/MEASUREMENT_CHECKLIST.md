# Owner measurement checklist: the reference phone (P4-06 step 4 and P4-07)

One sitting on your reference iPhone settles **both** remaining measurement items, because their prescribed workloads overlap:

- **P2-11's performance budget** (the P4-06 step 4 baseline, [#56](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/56) and [#57](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/57)): Silverstone, a population of 50, 7 rays plus collision per car per tick. Rendered at 1×, a p95 **simulation update** of at most **8 ms** per frame at 60 ticks/s. Headless, at least **600 ticks/s**.
- **P4-07's draw-time budget** ([#58](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/58), `docs/plans/p4-07-plan.md` section 6): the same phone and workload, the training page with its usual cars, camera at zoom 1.5, 4 and the maximum, in zoom and in follow mode, in portrait and landscape. A p95 **camera draw time** of at most **4 ms** over at least 600 frames, and no long task above 50 ms during a 10 s gesture.

The overlap is **Session A** below: Silverstone, 50 cars, Normal (1×) speed. One readout, `?debug=drawtime`, reports the draw time (P4-07) and, since this step, the simulation update time per frame (P2-11) over the **same** 600-frame window, so one reading answers both. Everything else in this list is either only P4-07 (the zoom and follow grid) or only P2-11 (the update figure and, later, the in-page headless benchmark).

Nothing here has been measured on a phone. The desktop figures at the end are from a development container and are for comparison only: the budget names your phone.

## 0. The owner's three decisions (made 2026-11-13; they change what this checklist asks)

Relayed owner instruction (Claude Code, 2026-11-13), the owner's reply to the three decisions put to them, verbatim: "1. Approve the reasoning now / 2.approve small follow up / 3.waive it". Read against the numbered questions in the step 4 summary (the headless figure on a phone; whether the desktop result is already enough; input responsiveness): I will stop if this was not meant.

1. **P2-11's trigger: the architectural reason is approved now** (from the desktop result: Silverstone with 50 cars at about 57 ticks/s against the 600 budget; see section 9). The phone's P2-11 figures are therefore **confirmatory**, not the trigger. P2-11 is triggered but is not implemented: it starts as a plan-only PR, and P4-06 stays In Progress and cannot be Complete until P2-11 is Complete and the budget is met (ROADMAP, P4-06 acceptance). Approving the reasoning is not approval to implement the index.
2. **The headless figure on a phone: the small follow-up is approved.** An opt-in in-page headless benchmark (its own PR, to come after this one) will report the phone's headless ticks per second directly, so the Max-speed tick rate (Session B) is **not** the headless figure and is recorded as a context reading only. Until that PR merges, the headless budget has no phone figure and this checklist does not claim one.
3. **Input responsiveness (the pinch-to-frame time in the P4-07 plan) is waived** by the owner and recorded as waived, not as passed or measured. It is not part of what P4-07's remaining measurement shows.

## 1. Before you start

- Use the deployed site after this PR is merged (the address you used before: `https://self-learning-car-ai.vercel.app`), so the build is the one with the update figures. The readout's last line names the build.
- Record in #56, #57 and #58 **before** measuring: iPhone model, iOS version, Safari (not an in-app browser), the build shown in the readout, and whether Low Power Mode is on (**turn it off**, and keep the same state for every reading).
- Close other tabs and apps. Plug in or have good charge; a hot phone throttles, so note it if the phone feels warm and let it cool between sessions.
- Take a screenshot of each reading (the readout is at the bottom of the screen and stays put).
- **A reading is valid only when the readout shows `Frames 600/600`** (and `frames 600/600` on the update line). Changing the speed, pausing, changing the cars-drawn choice or starting a replay **restarts the window**, on purpose, so each workload collects its own 600 frames. **Zoom and follow do not restart it: reload the page between zoom levels** so each reading is a fresh window.

## 2. Session A: Silverstone, Normal speed, 50 cars (both budgets)

Address: `/?mode=train&circuit=silverstone&debug=drawtime,fps` (both readouts together).

1. Open the address. The camera starts at the fit view (zoom 1). Leave speed at **Normal**. Do not touch the camera.
2. Wait until the draw-time readout shows `Frames 600/600` and the update line shows `frames 600/600`. About 10 to 20 seconds.
3. Read and record:
   - **Camera draw time** p50, p95, max, and the verdict line against 4 ms (P4-07).
   - **Simulation update per frame** p50, p95, max, and the **P2-11 budget** verdict against 8 ms (P2-11).
   - The `?debug=fps` line: frames per second, ticks per second and the mean step time (context: at Normal speed ticks/s should sit near 60 if the phone keeps up).
   - Frame gaps over 50 ms and draws over 50 ms (Safari cannot report long tasks; these are the stand-in, and the readout says "not reported by this browser").
4. **Take the reading twice:** once at the start, and once again about two minutes later, after a few generations. The update time depends on how many cars are still running, so the first window and a later one can differ; record both.
5. Do it in **portrait** and again in **landscape** (reload after rotating).

## 3. Session B: Silverstone, Maximum speed (P4-07's Max mode; the tick rate is context only)

Address: `/?mode=train&circuit=silverstone&debug=drawtime,fps`. Press **Max**.

1. Let it run 30 seconds, then read the `?debug=fps` ticks per second and frames per second. Record both. (At Max, many ticks run per frame, so the update-per-frame figure is large by design and the 8 ms budget does **not** apply to it. The readout says "1x speed only".)
2. The draw readout at Max draws about ten cars (the cars-drawn cap at Max): record its p95 against 4 ms with `Frames 600/600`.
3. Per decision 0.2, the ticks-per-second figure here is context only; the phone's headless figure comes from the approved in-page benchmark.

## 4. Session C: P4-07's zoom and follow grid (P4-07 only)

Address: `/?mode=train&circuit=silverstone&debug=drawtime`. For **each** of zoom about **1.5**, about **4** and the **maximum**, in **zoom** mode and **follow** mode, in **portrait** and **landscape**, **reload, then**:

1. Use the camera buttons to reach the zoom. The readout's context line shows the actual zoom (for example `zoom 4.00x free` or `following`); record what it shows, not the one you aimed for.
2. During the window, do a **10 second gesture** (pinch and pan in zoom mode; let the camera follow in follow mode).
3. When `Frames 600/600`, record draw p50, p95, max, frame gaps and draws over 50 ms.

That is 12 readings; take the ones you want and say which you skipped.

## 5. Session D: champion replay (P4-07; optional)

On Silverstone, run until at least one generation has finished (use Max), then open **Champion replay**, choose generation 1 and Start. The readout then names `champion replay · 1 car drawn with its sensor rays`. A replay ends when the car crashes or stalls, and a random early champion may end well before 600 frames; if the readout never reaches `Frames 600/600`, record "replay shorter than the window" rather than a figure.

## 6. What to write down, and where

Paste a table like this into #56, #57 and #58 (one table, three comments, so each issue holds its own evidence):

| Session | Orientation | Zoom (as shown) | Mode | Frames | Draw p50 / p95 / max (ms) | Update p50 / p95 / max (ms) | Ticks/s (fps readout) | Frame gaps >50 ms | Draws >50 ms | Verdicts shown |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

plus the device block from section 1 and your decision from section 0. Attach the screenshots.

## 7. What each result means (stated now so it cannot be bent later)

- **P4-07:** draw p95 at most 4 ms in every reading you took, and no draw or gap over 50 ms during the 10 s gesture, passes the plan's criterion for the readings taken. A p95 over 4 ms means the plan's fallback (the transformed cache, then culling) is measured next. It is your decision to call P4-07 Complete; waived readings are recorded as waived.
- **P2-11:** it is **already triggered** by the approved architectural reason (decision 0.1). The phone's update p95 (at most 8 ms at Normal speed) and, once the in-page benchmark exists, headless rate (at least 600) are the baseline the index is later measured against, before and after, under the same workload; P4-06 stays In Progress until P2-11 is Complete and the budget is met (ROADMAP, P4-06 acceptance).
- A pass on a phone is a statement about one phone, one build and one workload on the day, nothing more.

## 8. What this checklist cannot measure (so nobody reads more into it)

- **Input responsiveness** (the time from a pinch to the frame that shows it) is in the P4-07 plan's measures but is not instrumented; the owner **waived** it (decision 0.3), so it is recorded as waived.
- **Long tasks:** Safari has no Long Tasks API; the frame-gap and slow-draw counts are proxies that catch the same stalls, not the same numbers.
- **The headless budget on a phone** has no figure yet: the in-page benchmark the owner approved (decision 0.2) is a separate PR. The Node benchmark (`npm run bench`) runs headless but on a computer, not on the phone.
- **Heat and battery state** change timings; one reading is not a distribution. The two-minutes-later reading in Session A is the only repeat asked for.
- Nothing here says anything about learning. The cars are a seeded training run; no model is saved or judged.

## 9. Desktop reference (comparison only, never the phone's result)

Measured with `npm run bench` (`scripts/bench.mjs`, `src/training/benchmark.ts`), the real trainer, population 50, seed 1, brute-force collision and rays, 10 timed generations after 2 warm-up generations. Machine: an Intel Xeon at 2.10 GHz, 4 logical cores, a shared development container, Node v22.22.0, `main` at `60f0574` with these changes uncommitted. Timings come from one machine in one container and vary run to run; the simulated work (the car-tick count) is deterministic.

| Circuit | Boundary segments | Mean running cars | Car-ticks (deterministic) | Wall time, three runs (s) | Car-ticks/s | Ticks/s at the full population of 50 (budget: 600) |
| --- | ---: | ---: | ---: | --- | ---: | --- |
| stadium-oval | 52 | 10.8 | 234,983 | 3.92, 3.87, 3.83 | about 60,000 to 61,300 | 1,199.5, 1,215.2, 1,225.5 |
| silverstone | 2,356 | 7.7 | 855,978 | 299.3, 296.0, 292.8 | about 2,860 to 2,920 | **57.2, 57.8, 58.5** |

How to read it: "ticks/s at the full population" is the car-tick rate divided by 50, the rate if every car stayed running, which is conservative (see `src/training/benchmark.ts`). Per car-tick, Silverstone costs about 21 times the oval here (45 times the boundary segments), as brute-force collision and ray queries would predict. **This is a desktop container figure, not your phone's, and it is not by itself the P2-11 trigger** (section 0.2). It also means a 50-car Silverstone generation takes about 30 seconds of one core here, so training on Silverstone on a phone will be far slower than on the oval.

Reproduce it: `npm run bench -- --generations 10 --warmup 2 --out bench.json` (about five minutes for Silverstone). The car-tick counts must match the table exactly; the timings will differ on another machine.
