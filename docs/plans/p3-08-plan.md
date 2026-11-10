# P3-08 plan: initial saved-model comparison

> **Status: plan only, for Codex review and the owner's merge. Implementation needs its own owner authorisation.**
> - **Authorisation:** the owner's "Continue with development" (2026-11-10, after #142 merged), read as the next roadmap step (P3-08, P1; its dependencies P3-04 and P3-06 are merged). The owner may reorder or correct this reading.
> - **Scope:** the roadmap entry and issue #42. **Not** in scope: repeated multi-track statistical comparison and evaluation runs (P5-05), more than two models, saving or sharing a comparison, any ranking beyond what the rules below allow, any claim about learning or generalisation.
> - **Lessons carried from P3-05 to P3-07 reviews:** validate everything that is read (a damaged save is reported, never compared), guard every call so a hostile entry is a message and never an exception, state what is **not** claimed, test through the whole path (the page, not only the pure function), keep the saved-list layout checks passing, and never present unlike scores as a controlled comparison.

## 1. What P3-08 must deliver (ROADMAP, issue #42, MODEL_FORMAT.md)

- **Acceptance:** two saved models can be inspected **side by side** using architecture, configuration, seed, generation, training track and version, and recorded metrics. **Compatible models can be replayed under the same conditions; incompatible fitness values are not ranked.** P5-05 adds repeated multi-track statistical comparisons.
- **Tests:** unit for comparison compatibility and missing evaluations; E2E that compares two imported models and shows a mismatch warning.
- **MODEL_FORMAT.md already says** (the comparison rules this plan implements): models with different fitness versions "can still be loaded and driven, but the comparison view must not rank them by fitness"; do not rank fitness across different fitness, configuration or track versions; **show missing results as unavailable**; "a mismatch warning is not permission to present unlike scores as a controlled comparison."

## 2. What already exists (inspected at `main` `b40b652`)

| Need | What exists | Where | Gap |
| --- | --- | --- | --- |
| Validated models and the list | `validateModel`, `compatibility`, `store.list/load`, import (P3-06) | `persistence/modelFormat.ts`, `modelStore.ts` | none |
| Every field to compare | architecture, `training.configuration` (population, operators, limits, timestep, physics, fitness weights and version, sensors), `training.seed`, `training.generation`, `trackIds/Versions/Hashes`, `simulationVersion`, `fitness`, optional `evaluation` | `ModelDocument` | no comparison logic |
| Replay one saved model under its own conditions | `setupForModel`, `replayForModel` | `ui/savedReplay.ts` | no replay of two models together |
| Draw cars | `drawCars` takes a list of cars | `render/raceView.ts` | two coloured cars in one replay |

## 3. Design

- **`src/persistence/modelCompare.ts` (new, pure; imports only `modelFormat`).** `compareModels(a, b) → Comparison` for two **validated** models:
  - `rows`: grouped, labelled rows `{ group, label, a, b, state }` with `state` one of `same`, `different`, `unavailable` (a value one model lacks, for example a null seed with its reason, or no `evaluation`). Groups: **Identity** (name, generation shown from 1, saved date, code and app version), **Architecture** (layers, activations, brake mask), **Training** (seed or "unavailable: <reason>", population, elite count, selection, crossover, mutation, episode limits, timestep, vehicle physics, sensors), **Task** (training track id, version, content hash; simulation version), **Scoring** (fitness version and each weight), **Recorded metrics** (fitness, `evaluation`: "no evaluation recorded" until P5).
  - `fitness`: `{ comparable: boolean, reasons: string[] }`. Comparable **only if** both models have the same fitness version and weights, the same simulation version, the same training track id, version and hash, and the same episode limits, timestep and vehicle physics. Every difference found is listed as a reason (the list is complete, not the first). Fitness is a **single training-run score on the training track**, so even when comparable it is described as "scored the same way", never as "better" or "generalises".
  - `sharedReplay`: `{ ok: true } | { ok: false, reasons }`: both models drivable (`compatibility`), and the same simulation version, track (id, version, hash), vehicle physics, timestep, and episode limits. Differing brake masks or architectures-that-run are **not** a reason (they are the controllers being compared); a different physics, timestep or track is, and the comparison then offers no combined replay and says why (no "closest conditions" fallback).
  - `warnings`: plain sentences for the table's header (for example "These two were scored under different fitness versions, so their fitness values are shown but not ranked.").
  - Hostile-safe: it never throws; given anything that is not a validated model it returns a refusal.
- **Pair replay (`src/training/pairReplay.ts`, headless).** Two `ChampionReplay` objects built with each model's own setup (identical by `sharedReplay`) stepped in lockstep. Cars are independent (rays and collision read the track only), so **each car's path equals its solo replay tick for tick** (tested). It reports, per car, outcome, gates, laps and the time of its end; the pair ends when both have ended or the shared episode limit is reached.
- **UI (inside the Saved champions section; no new panel).** A **Compare** control: two selects (A and B) filled from the valid saves (a damaged entry is not offered), a Compare button, a **table** (real `<table>` with `scope` headers so a screen reader reads "label, A, B"; at 320 px the cells stack as label then two lines, with no horizontal scroll), the warnings above it, and **Replay both together** enabled only when `sharedReplay.ok`, otherwise a sentence with the reasons. The replay draws both cars in two distinct colours **plus a text label A and B** (colour is not the only cue) and shows each car's outcome as text when it ends. It reuses the champion replay's rules: training waits meanwhile, 1×, **Back to training**, an overflowing network stops the replay with a message, and the layout checks of P3-04 to P3-07 are re-run with the section present.
- **No new storage and no format change.** The comparison is view-only state. It reads saves through `store.load`, so nothing is written.

## 4. What is deliberately not claimed

Fitness is the score of one training generation's champion; it is not an evaluation. A comparable pair shares scoring and conditions, so their fitness numbers can be read side by side, but the table says in one line that this is a **training score on the training track, not evidence of general driving ability**. Missing results (`evaluation`, an unavailable seed) are shown as unavailable, never as zero. The comparison makes **no statement about learning**. P5-05 owns repeated evaluations under the same starts and seeds.

## 5. Decisions for the owner (defaults proposed; each routine unless changed)

1. **Two models only**, A and B, chosen from the saved list.
2. **Fitness is always shown** as numbers side by side; a "higher" marker appears **only** when `comparable`; otherwise "not ranked" with every reason.
3. **Combined replay** is simultaneous on one canvas (two cars, two colours and labels) when conditions are equal, and **refused with reasons** when not; no fallback to sequential replays under unlike conditions.
4. **Metrics shown:** fitness, generation, seed, saved date, and `evaluation` as unavailable until P5.
5. A model this build **cannot drive** (another simulation version or sensor layout) can still be inspected in the table but not replayed.

## 6. Tests

- **Unit (`modelCompare`):** identical models are comparable with no reasons; **each single difference** (fitness version, each weight, simulation version, track id, track version, track hash, episode limits, timestep, each physics field) makes fitness not comparable and appears in the reasons, and the reasons list is complete when several differ; a different brake mask or population alone does not block `sharedReplay` but does appear as a difference; unavailable seed and missing `evaluation` show as unavailable; symmetry (swapping A and B swaps the columns and keeps the verdict); hostile input (not an object, a model with a hostile extra field, a deeply nested one) returns a refusal and never throws; no claim words ("better", "improved") appear in any generated text (a test scans the strings).
- **Unit (`pairReplay`):** each car equals its solo replay at every tick for several seeds and generations; the pair ends correctly when one ends early; a throwing network is reported for that car and the other continues or the pair stops with a message (decided in the implementation, and tested).
- **Page wiring (Node, fakes):** only valid saves are offered; Compare renders the table and warnings; mismatched models show the warning, "not ranked" and a refused combined replay with reasons; comparable models enable the combined replay; a damaged save is never offered; storage unchanged; training statistics unchanged.
- **E2E (Chromium and WebKit, desktop, phone, tablet):** save two champions of one run (comparable) and replay both together; **import a second file that differs** (a tampered timestep or fitness version, written by the test and clearly labelled synthetic) and see the **mismatch warning**, "not ranked", and the refused combined replay; layout and 44 px targets with the section open at the P3-05 to P3-07 sizes and font-stress cases.
- Not tested here: a physical device (section 7).

## 7. Owner checks (iPhone and iPad, before a merge request)

1. Save two champions from one run, choose them as A and B, tap Compare: the table is readable, scrolls inside the panel, and says the fitness values are scored the same way; Replay both together shows two labelled cars.
2. Import a differing model file (for example one saved under another fitness version) and compare: a mismatch warning appears, fitness is shown but "not ranked", and the combined replay explains why it is unavailable.
3. The Compare controls are easy to tap in portrait and landscape, and the page still scrolls.

## 8. Limits

A comparison of two saved controllers is a description and a replay, not a measurement of which generalises better. Browser storage is a convenience (Download JSON remains the way to keep a copy). ST1 to ST5, the held-out evaluation boundaries and every study seed are untouched.
