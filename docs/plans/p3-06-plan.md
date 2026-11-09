# P3-06 plan: import a champion from a JSON file, with validation, versioning and compatibility checks

> **Status: plan only, for Codex review and the owner's merge. Implementation needs its own owner authorisation.**
> - **Authorisation:** the owner's ["135 and 136 merged, continue as developer"](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/26), read as the next roadmap step (P3-06, P0, ST1; its dependency P3-05 is merged). The owner may reorder or correct this reading.
> - **Scope:** the roadmap entry and issue #26. **Already done in P3-05:** exporting a saved champion as a JSON download, the validator, the 1 MiB cap on stored text, and the "newer version" refusal. **This item adds:** importing a file, its size limit applied before reading, version checks and migration hooks for files, rejection without side effects, and the re-import test. **Not** in scope: checkpoints (P3-07), comparison (P3-08), sharing by link, drag and drop, importing several files at once.

## 1. What P3-06 must deliver (ROADMAP, issue #26, MODEL_FORMAT.md)

- Export a model as a `.json` download (done in P3-05) and **import from a file** with a size limit, schema validation, version checks and migration hooks.
- **Acceptance:** every invalid case in `docs/TESTING.md` is rejected **without side effects**; an exported file **re-imports identically**.
- **Tests:** unit (validator and migration) and an E2E that exports then imports, on Chromium and WebKit.

## 2. What already exists (inspected at `main` `5dbb99e`)

| Need | What exists | Where | Gap |
| --- | --- | --- | --- |
| Validation of a parsed document | `validateModel(value, registry)`: every error, hostile-value safe, nested ranges, version refusal | `src/persistence/modelFormat.ts` | none |
| Size cap, parse, validate, compatibility for a stored entry | `readModel` (private to the store): cap before `JSON.parse`, then validate | `src/persistence/modelStore.ts` | not reusable for a **file**, and no write path for an imported document |
| Saving a validated model | `store.save(model)`: validates, writes model then index, cap of 20, every failure a message | `modelStore.ts` | none |
| Export | `store.exportFile(id)`, `exportFilename`, `ui/download.ts` | P3-05 | none |
| Reading a user's file | nothing | — | **the whole of it** |
| Migration | nothing (`schemaVersion` 1 is the only version) | — | hooks, with no real migration to claim |

## 3. Architecture

- **`src/persistence/modelImport.ts` (new, pure, no DOM).** `importModelText(text, options) → ImportResult`:
  1. **Size:** `text.length` over `MAX_MODEL_BYTES` is refused **before `JSON.parse`** (the file's own `size` is checked by the UI before it is even read, see below).
  2. **Text:** a leading byte-order mark is stripped (some editors add one); nothing else is trimmed.
  3. **Parse** in `try/catch`; a failure is "This isn't a valid model file (it is not readable JSON)".
  4. **Migrate:** `migrateToCurrent(value, migrations)` (below).
  5. **Validate** with `validateModel`, then **compatibility** with `compatibility()`.
  6. Returns `{ ok: true, model, warnings, migratedFrom }` or `{ ok: false, errors }`. It writes nothing, so a refusal cannot have a side effect by construction, and the tests prove the store is byte-for-byte unchanged.
- **`src/persistence/migrations.ts` (new).** `migrateToCurrent(value, registry = MIGRATIONS)`: reads `schemaVersion`; a newer version is refused ("made by a newer version"); the current version passes through unchanged; an older version runs the **explicit, tested** migration functions `vN → vN+1` in order, each returning a new object and never mutating its input, and refuses if a step is missing or throws. **The real registry is empty** (version 1 is the first version), so no migration is claimed to exist; the hook is tested with a synthetic registry and a synthetic fixture, clearly labelled, as MODEL_FORMAT.md requires ("No migration is claimed to exist").
- **Store: `store.importModel(model)`** (a thin wrapper over `save`): handles the **id collision** policy (§5) and returns `{ ok, id, status: 'added' | 'already-saved' | 'saved-as-copy', indexed }` or a failure with the existing messages (unavailable, quota, full).
- **UI: inside the Saved champions section**, next to Save: an **Import JSON file** control (a labelled `<input type="file" accept=".json,application/json">`, one file; a visible button-sized label of at least 44 CSS px), a status sentence (the same polite region), and results:
  - the UI **checks `file.size` against the cap before reading** and refuses a large file without reading it; otherwise reads it with `file.text()` (errors from reading are a message);
  - on success: "Imported "<name>" (generation N)." plus any compatibility warnings, and the new row appears in the list (Replay, Download JSON, Delete as for any save);
  - on refusal: a short message with the first few errors and "and N more", **nothing written, the list and the active replay untouched**;
  - the file name is never used as a storage key or shown unescaped (text content only).
  - It reuses the injected storage, so a throwing or full store gives the existing messages.
- **Accessibility and layout:** the control is inside the existing panel (no new panel), so the layout rules and tests of P3-04 and P3-05 apply; the 44 px target, label association and the font-stress cases are re-checked with the import control present.

## 4. Why "exported file re-imports identically" is testable

`exportFile` writes `JSON.stringify(validatedModel, null, 2)`. Import reads it back through the same validator. So: export → import into a **fresh** store gives a document **deep-equal** to the original (parameters bit for bit), re-exporting it gives **byte-identical text**, and the replay of the imported champion equals the original's at every tick (the P3-05 `savedReplay` path). A **committed fixture** (`tests/fixtures/`, generated from a seeded run and labelled synthetic test data, not a result) is imported by the test, so a change to the format that breaks old files fails loudly.

## 5. Decisions for the owner (defaults proposed; each is routine unless the owner changes it)

1. **Id collisions.** A file whose `id` is already saved: **identical content** is a no-op ("already saved"); **different content** is saved **as a copy with a new id** and says so; it never overwrites. (Alternatives: refuse, or overwrite after asking. Never silently overwrite.)
2. **One file at a time**; choosing several is refused with a message.
3. **A model for another simulation version or sensor layout** may be imported (it validates) and listed as not drivable, exactly as in P3-05, so a copy can be kept.
4. **No real migration exists**, so none is claimed; the hook is tested synthetically.
5. **Cap of 20** applies to imports too (a full store refuses with the existing message).

## 6. Tests

- **Every invalid case rejected without side effects (unit, at the import boundary):** each case of the P3-05 validation matrix (not an object, wrong format, schema 0/2/fractional/newer, every required field, `NaN`/`Infinity`/`null`/overflowing exponent, counts 158 and 160, wrong order, layers, activations, sensors, physics, fitness, tracks, seed rules, hostile values in every position) **plus** the file-level cases: empty text, not JSON, JSON that is not an object, a BOM, trailing junk, oversized text (refused before parsing), a very deep structure, a huge array, and text with an invalid UTF-8 replacement character. For each: `ok: false`, a field-named message, and the **store's raw contents unchanged byte for byte** (a spy shows no write was attempted).
- **Migration (unit, synthetic):** newer refused; current passes untouched (same object semantics, input never mutated); a synthetic v0→v1 step runs, is pure, and a missing or throwing step refuses; steps run in order; the real registry is empty.
- **Re-import identically (integration, seeded):** export → import into a fresh store: deep-equal document, bit-for-bit parameters, byte-identical re-export, equal replays tick by tick, for several seeds and generations; the committed fixture imports.
- **Collision policy (unit and page):** identical is a no-op; different content becomes a copy with a new id and no overwrite; the cap, full store, throwing store and quota failures give the existing messages and write nothing more.
- **Page wiring (Node, fakes):** import from a fake `File`; size checked before reading (the reader is never called for an oversized file); a refusal leaves the list and an active replay untouched; training statistics are unchanged by importing.
- **E2E (Chromium and WebKit, desktop, phone, tablet):** save → Download JSON → delete → Import JSON file with the downloaded file → listed, replays; an invalid file and an oversized file give messages and change nothing; layout with the import control in the panel at the P3-05 sizes and font-stress cases.
- Not tested: a physical device (§7).

## 7. Owner checks (iPhone and iPad, before a merge request)

1. Save a champion, Download JSON, delete the save, then Import JSON file and choose the downloaded file from Files: it is listed and replays as before.
2. Choosing a file that is not a champion (a photo, a text file) shows a clear message and changes nothing.
3. Importing the same file twice says "already saved" and adds no duplicate.
4. The control is easy to tap in portrait and landscape and the panel still scrolls.

## 8. Limits

An imported brain is one controller and its provenance. It does not resume training (P3-07), and replaying it is not an evaluation of generalisation. A file is untrusted input: it is validated like stored data, never executed, and its name is never used as a key. localStorage remains a convenience, and Download JSON remains the way to keep a copy.
