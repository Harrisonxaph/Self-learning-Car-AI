# P4-02 plan: touch-friendly interactive track editor

> **Status: plan only, for Codex review and the owner's merge. Implementation needs its own owner authorisation.**
> - **Authorisation:** the owner's "Merged, continue with development on p4" (2026-11-11, after the P4-01 completion record merged), read as the next Phase 4 step and, as for earlier items, as authorising a **plan only**. P4-02 (the Phase 4 acceptance item) was the recommended first Phase 4 plan; the owner may reorder it. Its dependencies P4-01 and P1-08 are Complete.
> - **Scope:** the roadmap entry and issue #29: create and edit a track by touch and mouse (boundaries, start position, ordered checkpoints) with undo, snapping and live validation messages, and drive the result. **Not** in scope: saving, loading, importing or exporting custom tracks (P4-03), training or evaluating on custom tracks (P4-04 onwards), zoom and follow (P4-07), editing the built-in tracks, Silverstone (P4-06), any physics change, any claim about learning.
> - **Lessons carried from earlier phases:** validate everything the user can produce (a hostile or degenerate input is a message, never an exception); keep the editor's state pure and headless and the page a thin shell over it; test through the real page (pointer events in Chromium and WebKit, desktop, phone and tablet), not only the pure functions; keep layout checks passing; never infer owner device checks; state what is **not** claimed.

## 1. What P4-02 must deliver (ROADMAP, issue #29)

- **Description:** create and edit boundaries, start position and ordered checkpoints by touch and mouse, with undo, snapping and live validation messages.
- **Acceptance:** **Phase 4 acceptance (part): a user can build a valid track on an iPad and drive it.** All controls at least 44 px and keyboard accessible.
- **Tests:** unit for editor state operations; E2E that creates a simple track with pointer events; manual on iPad Safari.

## 2. What already exists (inspected at `main` after #156)

| Need | What exists | Where | Gap |
| --- | --- | --- | --- |
| A validator with readable errors | `validateTrack` (14 rules, stable rule ids, never throws), `loadValidatedTrack`, `docs/TRACK_FORMAT.md` | `src/sim/trackValidation.ts` | none: the editor uses it as it is |
| The driving direction contract | the outer boundary on the car's right (counter-clockwise on the screen), enforced by the validator | `checkpoints.ts`, `trackValidation.ts` | the editor must always produce it |
| Manual driving | `createWorld`, the frame loop, keyboard and touch controls, HUD | `src/main.ts`, `src/ui/controls`, `src/sim/world.ts` | `main.ts` builds one fixed track at load; it must accept a track |
| Drawing a track and fitting it to the screen | `drawTrack`, `fitBounds`, the cached track layer | `src/render/trackLayer.ts`, `trackView.ts` | an editing overlay (points, selection, error markers) |
| Page modes | `pageMode(search)`: `drive` (default) and `train` | `src/ui/pageMode.ts` | a third mode |

## 3. Design

- **Authoring by centre line and width (the main design decision).** Hand-placing two boundary polylines and matching gate end points by touch would be slow and would rarely satisfy the validator's rules (gates exactly on the boundaries, one lap in order, outer on the right). The built-in tracks were made as a centre line with boundaries offset by half the width and gates across the road, so the editor does the same: the user edits a **closed centre line** (control points) and a **road width**, and the editor **derives** the outer and inner boundaries, the ordered gates and the start pose. A track built this way satisfies most validator rules by construction; the validator still runs on every change, and what remains (a corner tighter than the road is wide, a narrow road, two parts of the loop too close) is shown as a live message at the place that causes it. Direct editing of individual boundary vertices is a possible later extension and is not in this plan.
- **`src/editor/trackEditor.ts` (new, pure, headless).** An immutable `EditorState`: control points, road width, gate spacing, start position along the line, name and id. Operations (each returns a new state or a refusal message, never throws): `addPoint`, `insertPointOnSegment`, `movePoint`, `deletePoint` (at least 3 remain), `setWidth`, `setGateSpacing`, `moveStart`, `reset`; `undo` and `redo` over a bounded history (depth 100, deterministic, a new operation clears redo); `snap(point, settings)` to a grid (0.5, 1 or 5 m; default 1 m) and to an existing point (to close the loop). Limits (control points 3 to 200; coordinates within a ±150 m working area so the whole track always fits the view) are checked before any geometry runs.
- **`buildTrack(state)` (pure).** Resamples the closed centre line smoothly (a closed Catmull-Rom spline through the control points, sampled about every 5 m, within the P4-01 cap of 2,000 points), **normalises the direction** so cars drive counter-clockwise on the screen with the outer boundary on the right (a loop drawn clockwise is reversed, and the editor says so), offsets by half the width on each side, places gates every `gateSpacing` metres with their inner end on the inner boundary and their outer end on the outer one, and puts the start behind gate 0 facing forward. The output is an ordinary track document that `validateTrack` and `loadTrack` accept; it carries an `id` of the form `custom-…` and registers in no split.
- **Live validation.** After every operation the editor builds the track and calls `validateTrack`. The page shows a one-line status ("Valid: ready to drive" or the first problem in plain words, with a count of the rest) and a list of the full messages, announced politely to screen readers. Each error rule maps to a location (a control point, a segment or the start) so the canvas can mark it. **Drive it** is enabled only for a valid track.
- **The page: `?mode=edit` (new page mode).** The default page and `?mode=train` are unchanged. The editor page has one canvas (the world fitted to the view, no zoom) and a toolbar of buttons at least 44 CSS px square, in the order: **Add**, **Move**, **Delete**, **Undo**, **Redo**, **Width −/+**, **Gates −/+**, **Snap** (cycles 0.5, 1, 5 m, off), **Drive it**. Pointer Events handle mouse, touch and pen alike: in Add mode a tap adds a point (a tap on the first point closes the loop); in Move mode a drag moves the nearest point within a 22 px touch radius (the pointer is captured, and `touch-action: none` on the canvas stops the page scrolling while editing, while the rest of the page still scrolls); in Delete mode a tap removes a point. The **start** is a labelled handle dragged along the centre line.
- **Keyboard.** The control points are also a list of focusable buttons ("Point 3 of 9, x, y"): the arrow keys move the selected point by the snap step, `Delete` removes it, `Enter` on the canvas adds a point at the view centre, `Ctrl/Cmd+Z` and `Ctrl/Cmd+Shift+Z` undo and redo. Focus is always visible and every tool has a text label and a tooltip.
- **Drive it.** The built track replaces the manual-driving world: `main.ts` is refactored so the track is a parameter (the cached track layer is rebuilt for the new track), the existing keyboard and touch controls and HUD are reused unchanged, and **Back to editing** returns to the editor with its state and history intact. A custom track is an **unregistered** track: it is in no training, validation or held-out split and is not saved, so the page says plainly that leaving it loses the track until P4-03 adds saving.
- **No new storage, no change to the format.** The editor produces a track in the existing format; nothing is written.

## 4. What is deliberately not claimed

A valid track is well-formed and drivable by the validator's rules; it is not interesting, fair or good for training, and no statement is made about learning or generalisation. Because the engine credits one driving direction, **every editor track is driven counter-clockwise on the screen**; a clockwise circuit cannot be described (the editor reverses what is drawn) and the page says so. Real iPad behaviour is established only by the owner's device checks, never inferred from the emulated CI projects.

## 5. Decisions for the owner (defaults proposed; each routine unless changed)

1. **Authoring by centre line and width**, with derived boundaries, gates and start, rather than direct boundary-vertex editing (a later extension).
2. **One driving direction** (counter-clockwise on the screen, outer boundary on the right); a clockwise drawing is reversed and the user is told.
3. **Grid snapping** 0.5, 1 or 5 m, default 1 m, plus snap to an existing point to close the loop.
4. **Limits:** 3 to 200 control points, a ±150 m working area, road width 8 to 30 m (default 12 m; the validator's own minimum, 4 m, stays), gate spacing 15 to 60 m (default 25 m), undo depth 100.
5. **`?mode=edit`** as a separate page mode; the default page is unchanged.
6. **Drive it** reuses the existing manual-driving controls and HUD; custom tracks are unregistered and not saved (P4-03 adds saving), with a visible notice.
7. **No zoom or pan** (P4-07); the working area always fits the view.
8. **Pointer Events** for all input, with `touch-action: none` on the canvas only.

## 6. Tests

- **Unit (`trackEditor`):** every operation (add, insert, move, delete down to 3 points, width and spacing within and beyond their limits, start movement), snapping (each grid size, snap to an existing point, off), undo and redo (order, bounded depth, redo cleared by a new operation, undo at the start is a no-op), immutability of earlier states, hostile input (NaN or infinite coordinates, huge counts, points outside the working area, a degenerate repeated point) returning refusal messages.
- **Unit (`buildTrack`):** a set of control-point fixtures (a circle, an oval, a rounded rectangle, an L-shaped concave loop, a long thin loop) each build a track that `validateTrack` accepts **and that a scripted gate-pursuit driver can complete a lap on through the real checkpoint engine**; a loop drawn clockwise is reversed and still valid; the output is deterministic; a corner tighter than the road is wide produces the `boundary-simple` message and a location; a too-narrow road and a too-small loop produce their messages; the track hashes and ids are stable.
- **Page wiring (Node, fakes):** pointer sequences (tap, drag, tap on the first point to close) produce the intended operations; the touch radius; Add, Move and Delete modes; the toolbar buttons call the operations; the status line and message list follow validity; **Drive it** is disabled for an invalid track and enabled for a valid one; **Back to editing** restores the state; keyboard operations.
- **E2E (Chromium and WebKit, desktop, phone and tablet):** build a simple track with pointer events, see "Valid", drive a short distance and see the car move and the lap display; a keyboard-only build; undo and redo; an invalid track (a corner too tight) shows its message and a disabled Drive it; **layout checks:** every control at least 44 CSS px, no horizontal scroll at 320 px, the page still scrolls outside the canvas, and `touch-action` is `none` on the canvas only.
- **Mutation checks** during implementation: weakening each operation, limit and mapping fails a test.
- Not tested here: a physical device (section 7).

## 7. Owner checks (iPhone and iPad, before a completion request)

1. On an iPad in Safari, open `?mode=edit`, draw a loop with a finger, move a point, delete a point, undo and redo: each response is immediate and the page does not scroll or zoom while drawing.
2. Widen the road until a corner becomes too tight: a readable message appears and Drive it is disabled; narrow it again and it is valid.
3. Press **Drive it** and drive the lap with the touch controls; press **Back to editing** and find the track as you left it.
4. On an iPhone in landscape the toolbar is usable with a thumb and nothing is clipped; a connected keyboard (if any) can build and edit a track.
5. Every control is easy to hit (44 px) and readable at default zoom.

## 8. Limits

The editor describes one family of tracks (a smooth closed centre line with a constant width): no pit lanes, no varying width, no crossings or figure-of-eight, and no sharp chicanes tighter than the road is wide. The spline passes exactly through the control points but its curvature between them is whatever the spline gives, so a corner can be tighter than the points suggest; the live message is how that is reported. The working area is a fixed ±150 m. A saved or shared track needs P4-03. ST1 to ST5, the held-out boundary and every study seed are untouched.
