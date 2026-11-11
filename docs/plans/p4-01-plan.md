# P4-01 plan: track data format and validation

> **Status: plan only, for Codex review and the owner's merge. Implementation needs its own owner authorisation.**
> - **Authorisation:** the owner's "Let's close p3 and mark as complete and move to p4-01" (2026-11-11, after Phase 3 was completed in #149), read as the next roadmap step (P4-01, P1; its dependencies P1-04 and P1-07 are Complete) and, as for earlier items, as authorising a **plan only**. The owner may reorder or correct this reading.
> - **Scope:** the roadmap entry and issue #28. **Not** in scope: the track editor (P4-02), saving or loading custom tracks (P4-03), new circuits or split changes (P4-04, P4-06), a spatial index (P2-11), any user-facing control, any claim about learning or generalisation.
> - **Lessons carried from Phase 3:** validate everything that is read and report every problem (not only the first); a hostile value is a message, never an exception; keep every existing hash and fixture byte-identical; state what is **not** claimed; test through the real entry points (the three built-in tracks and the manifest loader), not only the pure function.

## 1. What P4-01 must deliver (ROADMAP, issue #28)

- **Description:** versioned track JSON (boundaries, start pose, ordered gates, split label) and a validator: closed, non-self-intersecting boundaries, start inside the road, at least 3 gates spanning the road, minimum road width.
- **Acceptance:** the built-in tracks pass; each invalid case returns a readable error.
- **Tests:** unit, one test per validation rule.

## 2. What already exists (inspected at `main` `298202f`)

| Need | What exists | Where | Gap |
| --- | --- | --- | --- |
| Track type and shape check | `Track`, `loadTrack` (strings, finite numbers, at least 3 points and 3 gates, no sparse holes), `TrackFormatError` | `src/sim/track.ts` | no geometry checks: `loadTrack` says so itself |
| Three built-in circuits | `stadium-oval`, `rounded-rectangle`, `hairpin-chicane` JSON files; manifest with split, version and content hash | `src/data/tracks/`, `src/training/trackSplits.ts` | the manifest checks shape, id, version and hash, not geometry |
| Geometry helpers | `segmentsTouch`, `vehicleFootprint`, `footprintHitsTrack`, `footprintReach` | `src/sim/collision.ts` | no polygon tests (simple, nested, distance) |
| Content hash | `sha256:` of `JSON.stringify(loadTrack(data))` | `trackSplits.ts` | must not change: `loadTrack` keeps only known fields, so optional new fields cannot alter a hash |
| Format document | none for tracks (models and checkpoints have `MODEL_FORMAT.md`, `CHECKPOINT_FORMAT.md`) | `docs/` | `docs/TRACK_FORMAT.md` |

The existing files have no `format`, `schemaVersion` or `split` field. **They are not edited**, because their content hashes are pinned by the manifest and by saved models.

## 3. Design

- **Format (`docs/TRACK_FORMAT.md`, new).** Version 1 **is the existing shape** (`id`, `version`, `name`, `outer`, `inner`, `start`, `gates`; metres, x right, y down, heading in radians), plus three **optional** fields a document may carry: `format: "self-driving-ai-evolution/track"`, `schemaVersion: 1` (a number; any other value is refused, so a later schema is not misread) and `split: "training" | "validation" | "held-out"` (the label). `loadTrack` is unchanged and drops these fields, so every hash stays the same (tested). Missing `format` and `schemaVersion` mean version 1, so the three built-ins stay valid as they are. For a built-in track the **manifest remains the authority for the split**: a `split` label inside a built-in file, if present, must equal the manifest's, or the manifest load fails (a held-out track cannot relabel itself).
- **`src/sim/trackValidation.ts` (new, pure, headless; imports `track.ts` and `collision.ts` only).** `validateTrack(data, options?) → { ok: true, track, warnings } | { ok: false, errors }`. Every error is `{ rule, message }` with a stable `rule` id and a plain sentence that names the item, its index and rounded coordinates, and says what to change. **All** failures are collected (capped at 20, then "and N more"), so an author fixes a track in one pass. It never throws, whatever it is given.
- **Rules** (each is one id, one message and one unit test):
  1. `shape`: the `loadTrack` errors, wrapped (also: `format` and `schemaVersion` as above, `split` a known value).
  2. `identity`: `id` is 1 to 64 characters of lower-case letters, digits and hyphens; `version` and `name` are non-empty and at most 64 and 80 characters.
  3. `size`: each boundary has 3 to 2,000 points and at most 200 gates; every coordinate is within ±10,000 m. The caps are checked **before** any pairwise work, so a hostile file cannot cost quadratic time.
  4. `degenerate`: no two consecutive points (including last to first) coincide, and no segment is shorter than 0.01 m.
  5. `boundary-simple` (outer and inner separately): the closed polygon does not cross or touch itself; neighbouring segments meet only at their shared point.
  6. `boundaries-apart`: no outer segment touches any inner segment.
  7. `inner-inside-outer`: the inner polygon lies strictly inside the outer one (one inner vertex inside, given rule 6), so the road is the band between them. Clockwise or counter-clockwise order is **accepted** for both.
  8. `road-width`: the smallest distance between the two boundaries is at least a minimum width, by default the default vehicle's footprint width plus a margin (the number is fixed in the implementation from `DEFAULT_VEHICLE_PHYSICS` and reported with the measured widths of the three built-ins; proposed margin: the footprint width again, so twice the car width). It can be given in `options`, so the check follows the vehicle in use.
  9. `start-on-road`: the start position is inside the road (inside outer, outside inner) and the starting footprint does not touch either boundary (`footprintHitsTrack`).
  10. `gate-count`: at least 3 gates (the existing minimum, now stated as a validation error with its own message).
  11. `gate-spans-road`: each gate's inner endpoint lies on the inner boundary and its outer endpoint on the outer boundary (within 1e-6 m), and the gate crosses no boundary segment elsewhere, so it spans the whole road and only the road.
  12. `gates-apart`: no two gates touch each other.
  13. `gate-order`: walking the outer boundary, the gates' outer endpoints appear in a single direction around the loop exactly once, so "ordered gates" really is one lap in order; **and every gate counts forwards in that same direction under the checkpoint engine's convention** (see "Driving direction" below). A circuit whose listed order disagrees with the gates' forward side is refused.
  14. `start-heading`: the start heading is within 45° of **gate 0's forward direction** (the engine's convention, not "towards gate 1"), and the start lies behind gate 0 on the side a car crosses it from.
  - **Warnings (do not fail):** a gate gap longer than a stated distance (a car could cut a corner between gates); a boundary segment shorter than 0.1 m. Warnings are listed, never errors.
- **Integration, no behaviour change for users.** `loadTrack` stays shape-only (it has callers in `main.ts`, the manifest and many tests). A new `loadValidatedTrack(data)` returns the `Track` or throws `TrackFormatError` with every message. The built-in manifest loader additionally validates each file, so a **broken built-in track fails at load with a readable message**; the three built-ins must pass with no edits. P4-02 and P4-03 will use `validateTrack` for live and import checks; nothing in P4-01 adds UI.
- **Driving direction (review of #150 and #151: accepted directions must earn checkpoint credit).** `src/sim/checkpoints.ts` credits a gate only when crossed forwards, and fixes forwards for a gate from its inner end `a` to its outer end `b` as `(dy, -dx)` of `b - a`: a car drives with the **outer boundary on its right** (counter-clockwise for the outer polygon on the screen, y down). The validator uses exactly this convention and **does not change checkpoint or lap semantics**. So a horizontally mirrored circuit, or a gate list reversed after gate 0, is **refused** (a car driving it would cross every gate backwards and earn nothing), while the **storage winding of the `outer` and `inner` arrays stays free** (reversing both point lists with the gates unchanged still validates and earns the same credit). Storage winding and driving direction are separate. To describe a circuit driven the other way round, mirror it so the outer boundary is on the right.
- **Cost.** Pairwise segment checks use bounding-box rejection and the size caps above (worst case about 4 million cheap box tests for two 2,000-point boundaries). A test bounds the time on a maximum-size valid track with a generous limit and asserts no exception.
- **Determinism.** No randomness, no clock, no change to `Track`, the hash or any simulation path; the existing golden and hash tests stay as they are.

## 4. What is deliberately not claimed

A track that passes is **well-formed and drivable by the rules above**, not interesting, fair or good for training. Passing validation says nothing about whether a model learns on it, and a track's split label is not evidence of how a model generalises (the held-out protocol in `docs/AI_EVALUATION.md` is unchanged). The 45° heading and gate-gap warnings are conservative defaults, not physical limits. Nothing about learning is stated.

## 5. Decisions for the owner (defaults proposed; each routine unless changed)

1. **Format version 1 is the existing shape**, with `format`, `schemaVersion` and `split` optional, so built-in files and every hash are untouched.
2. **Minimum road width** = twice the default vehicle's footprint width (configurable through `options`); the implementation reports the measured widths of the three built-ins and proposes a different number only if one of them fails.
3. **Caps:** 2,000 points per boundary, 200 gates, ±10,000 m, 64-character id.
4. **Boundary-array winding is not mandated** (either storage order is accepted); **the driving direction is fixed by the checkpoint engine** (outer boundary on the car's right) and the validator refuses circuits that disagree with it.
5. **The manifest stays the authority for built-in splits**; a conflicting `split` label in a file fails the manifest load.
6. **A built-in track that fails validation fails the load** (a readable error), rather than being skipped.
7. **No UI or storage** in P4-01; custom tracks arrive with P4-02 and P4-03.

## 6. Tests

- **Unit, one per rule (`tests/sim/trackValidation.test.ts`):** a valid fixture derived from `stadium-oval` passes; for each rule 1 to 14 a minimal mutation (a bent point that crosses an edge, an inner loop pushed outside, a pinched road, a start on the grass, a short or reversed gate set, a gate that stops short of a boundary, a start facing backwards, and so on) fails with that rule id and a message that names the item; each message is a readable sentence and is asserted for its index and key numbers.
- **All errors collected:** a track with several faults reports every rule once (capped list and the "and N more" tail tested).
- **Built-ins:** `stadium-oval`, `rounded-rectangle` and `hairpin-chicane` pass with no warnings that fail the build, and the manifest still loads with **identical content hashes and geometry hashes** (the existing `trackSplits` tests run unchanged); a mutated copy of a built-in file fails the manifest load with the validation message.
- **Format:** `format`, `schemaVersion` and `split` accepted when valid and refused when wrong; `loadTrack` output and hash unchanged by them; a built-in file labelled with a different split than the manifest fails.
- **Hostile input:** `null`, arrays, strings, `NaN`, `Infinity`, sparse arrays, huge arrays (the cap fires before pairwise work), a 12,000-level nested value, a getter that throws, a prototype-polluted object: always a refusal, never an exception.
- **Direction, through the real checkpoint code:** every accepted circuit (the three built-ins, a boundary-reversed copy and the maximum-size ring) is driven gate by gate through `advanceProgress` and must earn one full lap of ordered credit; a horizontally mirrored circuit and a gate list reversed after gate 0 (with a repositioned start) are refused and their intended crossing returns `null` from `forwardCrossing`. **Cost:** a maximum-size valid track validates within a generous time bound.
- **Mutation checks** during implementation: weakening each rule must fail its test.
- Not tested here: any device. P4-01 has no user-visible change.

## 7. Owner checks

None on a device: P4-01 adds no screen, control or stored data. The owner's review of the error wording (readable to a person building a track) is the useful check, and the implementation PR will list one example message per rule for that purpose.

## 8. Limits

Boundaries are polylines, so a "smooth" curve is only as smooth as its points; the width check measures the distance between boundary segments, a conservative stand-in for the room a car needs while turning. The validator does not decide whether a track is hard, and it does not touch the held-out boundary. ST1 to ST5, every study seed and the evaluation protocol are untouched.
