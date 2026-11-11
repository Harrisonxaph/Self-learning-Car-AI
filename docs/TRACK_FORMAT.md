# Track format and validation

> Status: **P4-01 implements the validator** (`src/sim/trackValidation.ts`). The track editor (P4-02) and saving or loading custom tracks (P4-03) are not built. A track that passes is **well-formed and drivable by the rules below**; it says nothing about whether a model learns on it.

A track is one JSON document. Units are metres; x grows to the right and y downwards (the canvas), headings are radians from +x turning towards +y.

## Version 1

Version 1 **is the shape of the three built-in files** (`src/data/tracks/*.json`), so none of them changed and every content hash is the same.

```json
{
  "format": "self-driving-ai-evolution/track",
  "schemaVersion": 1,
  "split": "training",
  "id": "stadium-oval",
  "version": "1",
  "name": "Stadium oval",
  "outer": [{ "x": 60, "y": 47 }, "..."],
  "inner": [{ "x": 60, "y": 33 }, "..."],
  "start": { "position": { "x": -6, "y": 40 }, "heading": 0 },
  "gates": [{ "a": { "x": 0, "y": 33 }, "b": { "x": 0, "y": 47 } }, "..."]
}
```

- `format`, `schemaVersion` and `split` are **optional**. When present, `format` must be the string above, `schemaVersion` must be `1` (any other value is refused, so a later schema is not misread) and `split` must be `training`, `validation` or `held-out`. `loadTrack` drops these fields, so they never change a content hash.
- Boundaries are closed polylines: the last point joins back to the first, which is not repeated. Gates run in driving order from the inner boundary (`a`) to the outer boundary (`b`); gate 0 is the start/finish line.
- **The split of a built-in track is decided by the manifest** (`src/data/tracks/index.json`). A `split` label inside a built-in file must equal the manifest's, or the manifest fails to load, so a held-out track cannot relabel itself.

## Rules

`validateTrack(data, { physics?, minRoadWidth? })` returns `{ ok: true, track, warnings }` or `{ ok: false, errors, skipped }`. Every error is `{ rule, message }`: a stable rule id and one sentence that says what to change. All problems found are reported (the list is capped at 20 in `describeTrackErrors`, with "and N more"). It never throws. `loadValidatedTrack` returns the `Track` or throws `TrackFormatError` with the messages.

| Rule | Checks | Example message |
| --- | --- | --- |
| `shape` | the `loadTrack` shape errors; the optional fields above | `start must be an object.` |
| `identity` | `id` is 1 to 64 characters of lower-case letters, digits and hyphens; `version` at most 64 and `name` at most 80 characters | `The id "Bad Id" must be 1 to 64 characters: lower-case letters, digits and hyphens.` |
| `size` | at most 2,000 points per boundary, 200 gates, every coordinate within ±10,000 m; fewer than 3 boundary points. Checked **before** any pairwise work | `The outer boundary has 2001 points; the limit is 2000.` |
| `degenerate` | no edge shorter than 0.01 m (a shorter-than-0.1 m edge is only a warning) | `The outer boundary has an edge from point 3 (…) to point 4 (…) that is shorter than 0.01 m; remove or move one of the two points.` |
| `boundary-simple` | each boundary neither crosses nor touches itself, and no edge folds back over its neighbour | `The outer boundary crosses or touches itself: the edge from point 2 (…) meets the edge from point 4 (…).` |
| `boundaries-apart` | no outer edge touches an inner edge | `The outer edge from point 0 (…) touches the inner edge from point 0 (…); the boundaries must not meet.` |
| `inner-inside-outer` | the inner boundary lies inside the outer one (either winding order is accepted) | `The inner boundary is not inside the outer boundary (its first point (…) is outside).` |
| `road-width` | the closest the boundaries come is at least the minimum width: twice the vehicle's width by default (4 m for the default 2 m car), or `minRoadWidth` | `The road is only 3 m wide near (…); it must be at least 4 m (twice the car's width).` |
| `start-on-road` | the start position is inside the outer and outside the inner boundary, and the car's body there touches neither | `The start position (0, 0) is not on the road (…).` |
| `gate-count` | at least 3 gates | `gates must be an array of at least 3.` |
| `gate-spans-road` | each gate has length, its inner end lies on the inner boundary and its outer end on the outer one (within 1e-6 m), and it crosses no boundary between its ends | `Gate 5: its outer end (…) is 0.5 m from the outer boundary; it must lie on it, so the gate spans the whole road.` |
| `gates-apart` | no two gates touch | `Gates 5 and 6 touch each other; gates must be separate lines across the road.` |
| `gate-order` | the gates' outer ends run one way round the loop, exactly once, in the listed order | `The gates are not in driving order once around the loop: gate 5 does not follow gate 4.` |
| `start-heading` | the start faces within 45° of the driving direction at gate 0 (the way from gate 0 towards gate 1) and sits behind gate 0 | `The start faces 180° away from the driving direction at gate 0; it must be within 45°.` |

If a wall rule (`degenerate`, `boundary-simple`, `boundaries-apart`, `inner-inside-outer`) fails, the rules that need valid walls (`road-width`, `start-on-road`, `gate-spans-road`, `gate-order`, `start-heading`) are not run and are listed in `skipped`, rather than reporting meaningless follow-on errors. `gates-apart`, `gate-count`, `identity` and `size` always run.

**Warnings** (never errors): a boundary edge shorter than 0.1 m, and two neighbouring gates more than 60 m apart (a car could cut a corner between them).

## Limits

Boundaries are polylines, so a "smooth" curve is only as smooth as its points. The width check measures the distance between boundary edges, a conservative stand-in for the room a car needs while turning. The 45° start angle, the 60 m gate warning and the caps are conservative defaults, not physical limits. The validator does not judge whether a track is interesting, fair or hard, and it never touches the held-out evaluation boundary (`docs/AI_EVALUATION.md`).
