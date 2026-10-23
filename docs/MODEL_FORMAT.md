# Saved model format

> Status: **specification only**. Implementation is roadmap items P3-05 (ST1) and P3-06. Nothing reads or writes this format yet.

A saved model ("brain") is a single JSON document. The same document is used for localStorage, file export and file import.

## Version 1 example

This is synthetic format data, not an experiment or evidence of learning. The 159 zero parameters are a valid-sized illustrative genome; the configuration values illustrate a proposed contract and are not tuned settings or measured results. `training.configuration` must contain the runner's complete resolved settings when real models are saved; implementation P2-07 finalises those settings before P3-05 persists them.

```json
{
  "format": "self-driving-ai-evolution/model",
  "schemaVersion": 1,
  "id": "4f1c2b8e-1d2a-4c9b-9a0e-0d1f2e3a4b5c",
  "name": "Synthetic format example — not a trained champion",
  "createdAt": "2026-10-23T00:00:00.000Z",
  "appVersion": "0.0.0",
  "architecture": {
    "type": "feedforward",
    "layers": [
      9,
      12,
      3
    ],
    "hiddenActivation": "tanh",
    "outputActivations": [
      "tanh",
      "sigmoid",
      "sigmoid"
    ],
    "inputs": [
      "ray-90",
      "ray-60",
      "ray-30",
      "ray0",
      "ray30",
      "ray60",
      "ray90",
      "speed",
      "headingError"
    ],
    "outputs": [
      "steering",
      "throttle",
      "brake"
    ],
    "brakeEnabled": true
  },
  "parameters": {
    "order": "layer-major; per layer: weights[out][in] row-major, then biases[out]",
    "count": 159,
    "values": [
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ]
  },
  "training": {
    "generation": 0,
    "seed": 12345,
    "populationSize": 50,
    "eliteCount": 2,
    "selection": {
      "type": "tournament",
      "size": 3
    },
    "crossover": {
      "type": "uniform",
      "rate": 0.7
    },
    "mutation": {
      "rate": 0.1,
      "scale": 0.2
    },
    "maxEpisodeSeconds": 60,
    "fitnessVersion": 1,
    "trackIds": [
      "oval-01"
    ],
    "trackVersions": {
      "oval-01": "synthetic-v1"
    },
    "configuration": {
      "timestepSeconds": 0.016666666666666666,
      "prng": {
        "algorithm": "mulberry32",
        "version": 1
      },
      "populationSize": 50,
      "eliteCount": 2,
      "selection": {
        "type": "tournament",
        "size": 3
      },
      "crossover": {
        "type": "uniform",
        "rate": 0.7
      },
      "mutation": {
        "rate": 0.1,
        "scale": 0.2
      },
      "generations": 50,
      "maxEpisodeSeconds": 60,
      "stallSeconds": 5,
      "maxLaps": 3,
      "brakeEnabled": true,
      "physics": {
        "maxSpeed": 30,
        "wheelbase": 2.5,
        "engineAcceleration": 8,
        "brakeDeceleration": 12,
        "quadraticDrag": 0.01,
        "rollingResistance": 0.1,
        "vehicleLength": 4,
        "vehicleWidth": 2,
        "maxSteerRadians": 0.5
      },
      "sensors": {
        "anglesDegrees": [
          -90,
          -60,
          -30,
          0,
          30,
          60,
          90
        ],
        "maxDistance": 50
      },
      "fitness": {
        "version": 1,
        "checkpointWeight": 1000,
        "partialProgressWeight": 1000,
        "lapWeight": 5000,
        "collisionPenalty": 500,
        "lapTimeBonusScale": 2000,
        "referenceLapSeconds": 30
      },
      "inputContract": "seven-rays-speed-heading-v1",
      "outputContract": "steering-throttle-brake-v1"
    }
  },
  "fitness": 0,
  "evaluation": [],
  "codeVersion": "synthetic-example",
  "simulationVersion": 1
}
```

The example contains all 159 values. Arrays serialize to JSON without precision rounding; implementation may store a typed array internally.

## Required fields

| Field | Type | Rule |
|-------|------|------|
| `format` | string | Must equal `self-driving-ai-evolution/model`. |
| `schemaVersion` | integer | Version 1 reader accepts exactly 1; reject unknown versions before use. |
| `id` | string | UUID from `crypto.randomUUID()`, with an isolated fallback. ID generation must never consume a simulation/evolution PRNG stream. |
| `createdAt` | string | ISO 8601 UTC timestamp. |
| `codeVersion`, `simulationVersion` | string, positive integer | Source revision/build identifier and simulation contract version; recorded for reproducibility. |
| `architecture.layers` | integer[] | Currently must be `[9, 12, 3]`. |
| `architecture.*Activation(s)`, `inputs`, `outputs` | | Must match what the running app supports, or the model is rejected with a clear message. |
| `architecture.brakeEnabled` | boolean | `false` for no-braking models. Inference then forces brake = 0. |
| `parameters.count` | integer | Must equal the count computed from `layers`. |
| `parameters.values` | number[] | Length = `count`. Every value finite (no `NaN`, `Infinity` or `null`). |
| `training.generation` | integer ≥ 0 | |
| `training.trackIds`, `training.trackVersions` | nonempty string[], object | Track identifiers and content version/hash for every training track. |
| `training.configuration` | object | Required complete resolved configuration: physics/timestep, PRNG algorithm/version, sensors/normalisation and control contracts, population, selection, crossover, mutation, elitism, generation budget, fitness version/weights and termination settings. A hash alone is insufficient. Duplicated summary fields must agree with it. |
| `training.seed` | unsigned 32-bit integer or null | Required key. Seeded runs store the seed. Legacy unseeded data uses null with `training.seedUnavailableReason`; mark it non-reproducible. |
| `parameters.order` | string | Must match the layer-major ordering below; never infer a different ordering silently. |
| `fitness` | number | Finite. Fitness is only comparable when `fitnessVersion` and the tracks match. |

Optional: `name`, `appVersion`, derived configuration hashes and `evaluation` (omitted or empty until an evaluation run exists). All training settings are required inside `training.configuration`; top-level training summaries may be retained for display and must agree. Required metadata must be validated rather than silently defaulted. Each real evaluation entry includes protocol/configuration version, track ID/version and split, frozen model ID, evaluation seeds and starts, episode/outcome counts, metric definitions and summary statistics, plus a raw-results manifest reference where available. Absent completed laps yield null lap time with a zero sample count. Do not embed full histories or per-tick traces in a brain.

## Parameter order

For each layer transition `L → L+1` in order: all weights as `[outputIndex][inputIndex]` (row-major), then the biases for that layer's outputs. For 9-12-3 that is 108 weights + 12 biases + 36 weights + 3 biases = 159 values. A unit test pins this order with a hand-written network.

## Size

159 numbers written as full-precision JSON doubles come to about 3–4 KB per model. Store values at full precision (no rounding) so a reloaded model behaves identically. If the format is ever extended to keep a whole population, warn about localStorage quota (typically about 5 MB per origin) and prefer file export.

## Storage behaviour

- localStorage keys: `sdae:model:<id>` for each model, plus `sdae:models:index` for the list. Keep a small number of saves (for example 20) and ask before deleting.
- Wrap every localStorage access in `try/catch`. It can throw (Safari private mode, quota exceeded) or come back empty (cleared by the user, or evicted under browser storage policies; timing varies by browser, usage and storage pressure).
- **localStorage is a convenience, not permanent storage.** The UI must say so and offer "Export JSON" next to every save.

## Validation and corrupted data

On load or import:

1. Reject file imports or stored entries over the initial 1 MiB cap before JSON parsing; a future cap change is documented and tested.
2. Parse JSON inside `try/catch`. On failure, show "This file isn't a valid model" and change nothing.
3. Check `format` and `schemaVersion`.
4. Validate every required field and type, non-negative generation, timestamp, configuration, track versions, parameter order/count and finite numbers. JSON exponents can overflow to Infinity; reject them. Impose dimension/count bounds before allocating network arrays. Preserve the previous active model and valid saved entries if validation fails.
5. Reject unknown architectures with a message naming what was expected.
6. If a stored entry is corrupt, show it as "damaged" with a delete option. Never crash the app or silently drop other saves.

Validation lives in `src/persistence/modelFormat.ts` and is a pure function returning `{ ok: true, model } | { ok: false, errors: string[] }`.

## Compatibility

- `schemaVersion` changes when the JSON structure changes. Newer apps migrate older versions through explicit, tested migration functions (`v1 → v2`, …). Models with a version newer than the app supports are rejected with "made by a newer version".
- `fitnessVersion` changes whenever the fitness formula changes. Models with different fitness versions can still be loaded and driven, but the comparison view must not rank them by fitness. Rank them by evaluation metrics instead.
- The full `training.configuration.physics` and timestep are authoritative; an optional `physicsConfigHash` detects differences but never replaces the data. A model trained under compatible but different physics loads with a warning that its behaviour and old scores may differ; unsupported simulation/input/output contracts are rejected.

## Comparison

Phase 3 P3-08 compares saved metadata/configuration and compatible replays; Phase 5 P5-05 adds side-by-side repeated evaluations under the same track versions, starts, seeds and simulation conditions. Do not rank fitness across different fitness/configuration/track versions. Show missing results as unavailable. A mismatch warning is not permission to present unlike scores as a controlled comparison.

## Champion files versus resumable checkpoints

A brain stores one controller and its provenance. It can be inspected, replayed and evaluated; it does not reproduce the full evolutionary population or resume training exactly. P3-07 defines a separate versioned generation-boundary checkpoint with population genomes, champion, next-generation index, all PRNG stream states (including Gaussian sampler cache), configuration, track versions and metrics. Test uninterrupted-versus-resumed equivalence. Save periodically while active rather than relying on tab-hide delivery; unavailable/quota-limited storage must leave training usable and allow file export.

Newer-version files are rejected safely; older versions require an explicit tested migration before activation. No migration is claimed to exist in this documentation-only repository.
