# P5-02 step 2b-2, part 1: the specifications of the three fresh held-out circuits (for Codex review and the owner's approval BEFORE generation)

> **Status: specifications only. No circuit file, spec file, registry entry or label is created or changed by this document. Generation (step 2b-2, part 2) needs Codex's formal review and the owner's approval of these exact specifications first.**
> - **Authorisation:** the owner's "Let's aim to close p5 today, start with p5-02 and continue development in full" and the owner's answers to two direct questions, recorded verbatim on [#34](https://github.com/Harrisonxaph/Self-learning-Car-AI/issues/34#issuecomment-6883948447): the E5 numeric defaults **"Accept all as proposed (Recommended)"** and the fresh-circuit criteria of the merged plan ([`p5-02-fresh-circuits-plan.md`](p5-02-fresh-circuits-plan.md) section 3.2) **"Approve as proposed (Recommended)"**. The criteria are therefore the owner's; **the geometry below is mine and is what is submitted for review.**
> - **Scope:** three half-lap specifications in the committed generator's format (`scripts/makeTracks.mjs`), the checks that show they meet the approved criteria, and a full account of how they were made. **Not** in scope: generating or registering anything, evaluating any model on any of them (not even a sanity run), or any claim about braking.

## 1. How these were designed, disclosed

- **Designer:** Claude Code, which has seen E3's results and the geometry of every registered circuit; that exposure cannot be undone and is disclosed here and will be in the E5 report. The three specs were written **from the approved criteria alone**: a tight corner (a centre-line arc of radius at most 30 m turning at least 90 degrees), a fast run (a centre-line run of at least 150 m that is straight or of arcs of radius at least 70 m), 8 to 14 m wide, 400 to 650 m long, and three different corner characters.
- **No model, rule or human driver was involved at any point.** The only computation was the committed generator run **in memory on the draft specs** (nothing written to the repository) to check validity, lap length, gate count, that the nominal start and the four perturbed starts of the evaluation protocol are clear of the walls, and that the circuits are not matched by the existing registered-circuit protection (`classifyCustomTrack`). Those are geometric checks.
- **Iteration, stated plainly:** the third circuit's first layout (opening straight, right-left chicane, 120-degree hook, a 40 m straight, a large-radius R70 arc) came out at **711 m, over the 650 m bound**. I then changed it, each time only to bring the lap under the bound: removing the 40 m straight (671 m), shortening the large-radius arc to R40 (661 m), trying R30, R25 and R20 for that arc (657, 655 and 654 m, still over), and finally moving the 120-degree hook to directly after the opening straight with a 75 m straight (544 m), which I then lengthened to 80 m so the seam run stays above 150 m (564 m, the final layout). The first two circuits were not revised after their first layout. No change was made for any model's, rule's or human driver's behaviour, and none involved running one.
- **Geometry specified before generation, then fixed:** after approval, a spec may change only to fix a **validity** failure (the validator, a wall-touching start, the length or width bounds), recorded in the generation step's record; never for how any model, rule or human drives a circuit.

## 2. The specifications

Format as `src/data/tracks/specs/*.spec.json` (a half lap from the bottom of the symmetry axis, heading east, to the top of it; the other half is its mirror image; one parameter, here the length of the last straight, is solved by bisection so the half ends on the axis; the generator offsets by half the width, places gates about 25 m apart, puts the start 6 m behind gate 0). The solved lengths and lap data below are what the generator gave for these drafts, to be re-derived exactly by the committed generator at generation.

### 2.1 `hairpin-run` (Hairpin run): a long straight into a hairpin and two gentle opposite bends

```json
{
  "id": "hairpin-run",
  "version": "1",
  "name": "Hairpin run",
  "width": 9,
  "half": [
    { "type": "straight", "length": 80 },
    { "type": "arc", "turn": "left", "radius": 28, "degrees": 150 },
    { "type": "arc", "turn": "right", "radius": 45, "degrees": 40 },
    { "type": "arc", "turn": "left", "radius": 60, "degrees": 70 },
    { "type": "straight", "length": 40 }
  ],
  "solve": { "segment": 4, "field": "length", "range": [0, 400] }
}
```

### 2.2 `sweep-hook` (Sweep hook): two long large-radius sweepers into a tight hook and a right-hand release

```json
{
  "id": "sweep-hook",
  "version": "1",
  "name": "Sweep hook",
  "width": 12,
  "half": [
    { "type": "arc", "turn": "left", "radius": 100, "degrees": 60 },
    { "type": "arc", "turn": "left", "radius": 80, "degrees": 60 },
    { "type": "arc", "turn": "left", "radius": 26, "degrees": 100 },
    { "type": "arc", "turn": "right", "radius": 40, "degrees": 40 },
    { "type": "straight", "length": 30 }
  ],
  "solve": { "segment": 4, "field": "length", "range": [0, 400] }
}
```

### 2.3 `hook-chicane` (Hook chicane): a straight into a 120-degree hook, then a right-left chicane and a medium bend

```json
{
  "id": "hook-chicane",
  "version": "1",
  "name": "Hook chicane",
  "width": 13,
  "half": [
    { "type": "straight", "length": 80 },
    { "type": "arc", "turn": "left", "radius": 25, "degrees": 120 },
    { "type": "arc", "turn": "right", "radius": 30, "degrees": 45 },
    { "type": "arc", "turn": "left", "radius": 30, "degrees": 45 },
    { "type": "arc", "turn": "left", "radius": 40, "degrees": 60 },
    { "type": "straight", "length": 20 }
  ],
  "solve": { "segment": 5, "field": "length", "range": [0, 400] }
}
```

(The net turning of each half is 180 degrees to the left: 150 - 40 + 70, 60 + 60 + 100 - 40 and 120 - 45 + 45 + 60, so the lap closes. The solved lengths `solve.field` takes are not part of the spec; the `length` shown on that segment is only the starting value.)

## 3. Checks against the approved criteria (geometry only, on the in-memory drafts)

| Criterion (plan section 3.2) | `hairpin-run` | `sweep-hook` | `hook-chicane` |
| --- | --- | --- | --- |
| Closed, counter-clockwise, passes `validateTrack` | yes, 0 warnings | yes, 0 warnings | yes, 0 warnings |
| Width 8 to 14 m | 9 m | 12 m | 13 m |
| Lap 400 to 650 m | 551 m | 565 m | 564 m |
| Gates (about 25 m apart) | 22 | 23 | 23 |
| **Tight corner**: a centre-line arc of radius at most 30 m turning at least 90 degrees | R28 for 150 degrees | R26 for 100 degrees | R25 for 120 degrees |
| **Fast run**: a centre-line run of at least 150 m, straight or arcs of radius at least 70 m (counted across the axis seam, where the first or last segment of the half joins its mirror) | 160 m (the 80 m opening straight, doubled at the seam) | 188 m interior (R100 then R80 arcs), 377 m across the seam | 160 m (the 80 m opening straight, doubled at the seam) |
| Solved closing straight | 17.83 m | 21.66 m | 61.02 m |
| Nominal start and the four perturbed starts clear of the walls (no model) | yes | yes | yes |
| Not matched by `classifyCustomTrack` (by ID, identical geometry or road fingerprint) | `{ok: true}` | `{ok: true}` | `{ok: true}` |

These are **geometric proxies** as the plan states: they guarantee no particular speed change, terminal speed or lap time for any driver, and the circuits are not calibrated for difficulty. A weak or floor result on them is possible and will be reported as such, never prevented by editing the circuits.

## 4. How they differ

- From each other: `hairpin-run` has a long opening straight, one hairpin (150 degrees at R28) and gentle opposite bends, and is the narrowest (9 m); `sweep-hook` has no straight beyond the closing one, two long large-radius sweepers into a 100-degree hook and a right-hand release, 12 m wide; `hook-chicane` has a 120-degree hook directly after a straight and then a right-left chicane, and is the widest (13 m).
- From the registered circuits: none is a mirror, rotation or uniform scaling of any registered circuit (the existing protection compares identical geometry and road fingerprint, and the generator's output for these specs matches none). The step-2b-2 tests add the guard the plan describes (a direction-reversed turning-angle profile) **only for what the existing protection lacks**, and report which case it adds. Sharing a corner class with an earlier circuit (for example `technical-narrow`'s 135-degree corner) is not copying: the specs differ in every segment and in width.

## 5. What happens after approval (step 2b-2, part 2; nothing here does it)

1. Codex's formal review of these specs and the owner's approval of the exact specs.
2. Then, in one pull request on top of the merged epoch history (#205): the three spec files in `src/data/tracks/specs/`, the generated track files (`node scripts/makeTracks.mjs`, then `--check`), their manifest entries with provenance (`introducedBy: "P5-02 step 2b"`, `designCriteria` pointing at this document, `designedBeforeAnyEvaluation: true`) and `held-out`, **epoch 4** (the previous circuits with the three spent circuits labelled `validation`, the three fresh circuits `held-out`), the criteria and similarity tests, the enforcement tests for every circuit (including that custom and imported copies of every built-in circuit stay generically refused), the updated documentation, and a test that a circuit's provenance forbids it from E5 if it was examined before.
3. No model is evaluated on any fresh circuit at any point before the one E5 opening.

## 6. Decisions for the owner

1. **Approve these exact three specifications for generation** (default: yes), or return changes (a changed spec is re-checked against the criteria and re-reviewed before generation).
2. The names and IDs (`hairpin-run`, `sweep-hook`, `hook-chicane`) become permanent registry IDs.
