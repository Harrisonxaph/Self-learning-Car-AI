# P3-05 plan: save and load a champion brain (localStorage)

> **Status: plan only, for Codex review and the owner's merge. Implementation needs its own owner authorisation.**
> - **Authorisation:** the [owner's "133 merged, continue with next development steps"](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/25), read as the next roadmap step. P3-05 is P0 (ST1) and is the next unfinished item after P3-04; its dependencies P2-03 and P2-07 are Complete. The owner may reorder or correct this reading.
> - **Scope:** the roadmap entry and issue #25, with `docs/MODEL_FORMAT.md` v1 as the contract. **Not** in scope: file export and import, the file size limit, migration hooks (P3-06), checkpoints (P3-07), model comparison (P3-08).

## 1. What P3-05 must deliver (ROADMAP, issue #25, MODEL_FORMAT.md)

- Save a champion with its full metadata to localStorage; list the saves; load a compatible one; handle storage failures with clear messages; warn that localStorage is not permanent.
- **Acceptance:** a saved-then-loaded model drives identically; a throwing or empty localStorage is handled with clear messages.
- **Tests:** unit (round trip, validation failures, storage exceptions) and an E2E that saves, reloads the page and loads.

## 2. What already exists (inspected at `main` `9c2a93f`)

| Need | What exists | Where | Gap |
| --- | --- | --- | --- |
| The champion genome and its fitness | `GenerationStats.champion` (159 numbers), `bestFitness`, `generation`; the page keeps them by reference (`TrainingSession.generations`, P3-04). | `src/training/trainer.ts`, `src/ui/trainingDashboard.ts` | none |
| The configuration and contracts | `TrainingRecord`: resolved `config`, `physics`, `timestepSeconds`, `sensors`, and `versions` (RNG algorithm, operator, initialisation, parameter order, input and output contracts, fitness version, track id, version, hash and split). | `src/training/trainer.ts` | the page must pass them on (they are in `trainer.record()`, which copies the whole history, so it is called once per save, never per frame) |
| Driving a loaded brain | `runNetwork(parameters, inputs, { brakeEnabled })`, `createNetworkDriver`, the champion replay (P3-04). | `src/ai/`, `src/training/championReplay.ts` | none |
| Format validation | **nothing**: `src/persistence/` does not exist; the format is specification only. | `docs/MODEL_FORMAT.md` | **the whole of it** |
| Build and app identifiers | `SIMULATION_VERSION`; no build or commit identifier in the bundle. | `src/sim/config.ts` | `codeVersion` and `appVersion` need a source (§5) |

## 3. Architecture

- **`src/persistence/modelFormat.ts` (new, pure, no DOM, no storage).**
  - `buildModel(input) → ModelDocument`: assembles the v1 document from a champion, its generation, the `TrainingRecord` and identifiers passed in (`id`, `createdAt`, `codeVersion`, `appVersion`, `name`). It never calls `Date` or `crypto` itself, so it is deterministic and testable.
  - `validateModel(value: unknown) → { ok: true, model } | { ok: false, errors: string[] }`, exactly as MODEL_FORMAT.md "Validation and corrupted data" specifies: `format` and `schemaVersion` first (a newer version is rejected as "made by a newer version"); every required field and type; finite numbers only (no `NaN`, `Infinity` or `null`, including values that overflow when parsed); dimension and count bounds checked **before** any array is allocated; `parameters.count` equals the count computed from `layers`; `parameters.order` equals `PARAMETER_ORDER`; `layers` is `[9, 12, 3]`; activations, input and output names and contracts match what this app supports; `sensors.origin` is `body-centre`; `anglesDegrees.length + 2` equals `layers[0]` and the ray names match the angles; `physics.maxSpeed` equals the terminal speed recomputed from the other physics fields within a tolerance; the training track is in the training split and its hash matches the manifest; duplicated top-level summary fields agree with `training.configuration`. Returns **all** errors it finds, in a fixed order, so messages are testable.
  - `modelParameters(model) → Float64Array`: the genome, only from a validated model.
  - `compatibility(model) → { drivable, warnings }`: loadable with a warning when the physics or timestep differ from this build's; rejected for unsupported contracts (MODEL_FORMAT.md "Compatibility"). The first version supports one architecture and one input and output contract.
- **`src/persistence/modelStore.ts` (new).** A store over an injected `Storage`-like object (`getItem`, `setItem`, `removeItem` **and the key enumeration `length` / `key(index)`**, which orphan recovery needs: a model whose index write failed is found by scanning the keys, independently of the index), so tests use fakes and the page passes `window.localStorage` obtained inside `try/catch` (reading the property itself can throw). Keys as specified: `sdae:model:<id>` per model and `sdae:models:index`.
  - `list()` returns entries with a status: `ok`, `damaged` (unparseable, invalid, or in the index but missing) or `orphan` (present but not in the index); it never throws and never drops another save.
  - `save(model)` writes the model first and the index second, so a failure between the two leaves an orphan that `list()` finds, not a lost index entry; it reports `{ ok: false, reason: 'unavailable' | 'quota' | 'full' | 'invalid', message }` rather than throwing.
  - `load(id)` re-validates the stored text (the 1 MiB cap is applied before parsing) and returns the model or the errors; it changes nothing on failure and keeps the previous active model.
  - `remove(id)`; **a cap of 20 saves**: saving a 21st returns `full` and offers deleting one; nothing is deleted without an explicit choice.
  - An empty or evicted store (`getItem` returns `null`, a missing index) is an ordinary empty list, not an error; a throwing store is reported as "browser storage is unavailable (for example private browsing)" and the rest of the app keeps working.
- **UI: inside the Champion replay block**, so no third panel competes for the side layout (the graph and the replay already share it, P3-04). A "Saved champions" section holds:
  - **Save this champion** for the generation chosen in the picker (a name field defaulting to "Generation N champion"), with a status sentence for the result;
  - the list (name, generation, fitness, saved time) with **Replay** (runs the loaded brain through the existing champion replay, from the saved parameters and with the saved `brakeEnabled`; it **never enters the trainer**) and **Delete** (two steps, in the page, not `window.confirm`);
  - damaged entries listed as "damaged" with only Delete;
  - the permanent notice: "Saved in this browser only. Browsers can clear it. Export arrives with P3-06."
  - Targets of at least 44 CSS px, labelled controls, status messages through one polite region, the same layout rules as the graph and replay panel (checked at the same sizes, with the font-stress cases).

## 3a. Replaying a saved champion under its own recorded setup (answers review finding 3)

Passing only a loaded genome into the page's existing replay would drive it under the **current** training setup, not the one it was saved with. So a separate replay setup is reconstructed from the validated document (`src/ui/savedReplay.ts`, outside `training/`, which may not import persistence): the model's recorded physics, timestep, episode limits, brake setting and training track go to `createTrainingSetup`, and `createChampionReplay` runs on that setup. The trainer and the page's live setup are not touched. A model scored under another fitness version still replays (fitness is not read while driving) with a warning. The sensor layout is the one thing the replay cannot vary in this version, so another layout is **refused** as not drivable instead of replayed wrongly. Tests: a model saved with different physics and timestep replays with those (the setup's physics and timestep equal the model's, not the build's) while the page's trainer keeps its own, and equals a reference replay built from the same document.

## 4. Metadata mapping (MODEL_FORMAT.md field → source)

| Field | Source | Note |
| --- | --- | --- |
| `parameters.*`, `fitness`, `training.generation` | `stats.champion`, `stats.bestFitness`, `stats.generation` | exact doubles, no rounding |
| `architecture.*` | the network constants (`LAYERS`, activations, `INPUT_NAMES`) and `config.brakeEnabled` | |
| `training.seed`, population, elitism, selection, crossover, mutation, episode limits, fitness block | `record.config` | |
| `training.configuration.physics`, `timestepSeconds`, `sensors`, `prng` | `record.physics`, `timestepSeconds`, `sensors`, `versions.rngAlgorithm` | `maxSpeed` is recomputed by the validator |
| `training.trackIds`, `trackVersions` | `versions.trackId`, `trackVersion` (plus the hash and split) | the training track must be in the training split |
| `simulationVersion` | `SIMULATION_VERSION` | |
| `id` | `crypto.randomUUID()` with an isolated fallback | **never** draws from a simulation or evolution PRNG stream (tested) |
| `createdAt` | the page's clock at save time | |
| `codeVersion`, `appVersion` | **a build identifier injected at build time** (§5) | |

## 5. Gaps in the specification the owner should see

1. **`training.configuration.generations`** is required by the example, but an interactive run has no generation budget. Proposal: the implementation PR amends MODEL_FORMAT.md to allow `generations: null` ("open-ended interactive run") and the validator accepts exactly that or a positive integer. This is a specification change and needs the owner's approval in the implementation authorisation.
2. **`codeVersion` and `appVersion`:** the bundle has no commit identifier. Proposal: `vite.config.ts` defines `__CODE_VERSION__` from `VERCEL_GIT_COMMIT_SHA` or `GITHUB_SHA`, else `"dev"`, and `appVersion` from `package.json`. Nothing about deployment or Vercel settings changes; it reads environment variables that the build already has.
3. **"Offer Export JSON next to every save"** (MODEL_FORMAT.md) cannot be met in P3-05 because export is P3-06. Proposal: P3-05 shows the permanence warning with "Export arrives with P3-06" and no button; the ROADMAP and TESTING record this as a known gap until P3-06. The owner may instead pull a minimal export into P3-05.
4. **What "load" does:** there is no driving mode for a loaded brain yet (Phase 4). Proposal: "load" means replaying it in the champion replay; it is what makes "drives identically" checkable in the app.

## 6. Tests

- **Signed zero and extreme numbers are separate from replay equivalence (answers review finding 2).** JSON cannot store `-0` (`JSON.stringify([-0])` is `[0]`), so `buildModel` **normalises `-0` to `0`** and a test shows a network with either drives identically on a replay. Extreme finite values (subnormals, the largest and smallest doubles) are round-tripped in a **separate** test that checks only that the parameters survive bit for bit; they are not replayed, because such weights can overflow the network's sums (which `network.ts` rejects). Replay-equivalence uses runnable genomes only.
- **Round trip drives identically (integration, seeded):** for several seeds and generations, `buildModel` → `JSON.stringify` → store → `load` → `validateModel` gives parameters bit-for-bit equal to the champion (checked with `Object.is` on every value, including `-0` and the smallest and largest doubles), and a replay of the loaded brain equals a replay of the original at **every tick** (decision and result state) and ends with the same outcome, fitness and lap times; its `runNetwork` outputs equal on a sweep of random inputs.
- **Seed (answers review finding 4):** `training.seed` is an unsigned 32-bit integer or `null`. Cases: missing, a string, negative, fractional, 2^32 (all rejected); 0 and 4,294,967,295 (accepted); `null` **with** a non-empty `seedUnavailableReason` (accepted, and listed as **not reproducible**); `null` without a reason, or with an empty one (rejected). The list shows a seedless save as "seed unavailable, not reproducible", and a seeded one as reproducible; the page itself always saves a seed.
- **Validation failures (unit), one case per rule:** not an object; wrong `format`; `schemaVersion` 0, 2 and non-integer ("made by a newer version" for 2); each required field missing or of the wrong type; `NaN`, `Infinity`, `-Infinity`, `null` and an overflowing exponent (`1e999`) in `parameters.values`; count 158 and 160; wrong `order`; `layers` other than `[9, 12, 3]`; unknown activations, inputs, outputs and contracts; `sensors.origin` other than `body-centre`; ray count and names mismatching the angles; `maxSpeed` not matching the physics; a track outside the training split or with a wrong hash; summary fields disagreeing with the configuration; negative generation; bad timestamp; an oversized text (over 1 MiB, rejected before parsing). Every failure leaves storage and the active model untouched.
- **Storage (unit, fakes):** `getItem`, `setItem` and `removeItem` throwing; a quota error on `setItem`; the `localStorage` property itself throwing; empty and `null` reads; a corrupt index; an index entry whose model is missing; a model not in the index; corrupt JSON in an entry; the 20-save cap; write order (model first, index second) with a failure injected between them; one damaged entry never hides or deletes the others.
- **Id generation:** consumes no draw from any PRNG (a stream's next value is unchanged by creating ids).
- **Page wiring (Node):** save, list, replay and delete through the real page with a fake store; the loaded brain never reaches the trainer (identical training statistics with and without saving and loading); a throwing store leaves training and the replay working and shows the message.
- **E2E (Chromium and WebKit, desktop, phone, tablet; fake clock):** save after a generation, reload the page, see the save listed, replay it; an empty and a throwing `localStorage` (injected before load) show the messages; layout with the saved list open at the P3-04 sizes and font-stress cases.
- Not tested: a physical device (§7).

## 7. Owner checks (iPhone and iPad, before a merge request)

1. Save a champion, close the tab, reopen the page, and the save is listed and replays as before.
2. In a Private tab, saving shows the "storage unavailable" message and training and replay keep working.
3. The permanence warning is visible and readable; the layout holds in portrait and landscape; targets are easy to tap.
4. Deleting needs two taps and removes only that save.

## 8. Limits

A saved brain is one controller and its provenance. It does not resume training or reproduce a population (P3-07). A reloaded brain replays on the training track under the recorded conditions; that is not an evaluation of generalisation, and no learning claim is made. localStorage is a convenience: browsers may clear it.
