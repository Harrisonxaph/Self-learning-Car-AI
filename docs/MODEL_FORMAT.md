# Saved model format

> Status: **specification only**. Implementation is roadmap items P3-05 (ST1) and P3-06. Nothing reads or writes this format yet.

A saved model ("brain") is a single JSON document. The same document is used for localStorage, file export and file import.

## Version 1 example

```json
{
  "format": "self-driving-ai-evolution/model",
  "schemaVersion": 1,
  "id": "4f1c2b8e-1d2a-4c9b-9a0e-0d1f2e3a4b5c",
  "name": "Champion gen 42",
  "createdAt": "2026-11-02T14:05:31.000Z",
  "appVersion": "0.3.0",
  "architecture": {
    "type": "feedforward",
    "layers": [9, 12, 3],
    "hiddenActivation": "tanh",
    "outputActivations": ["tanh", "sigmoid", "sigmoid"],
    "inputs": ["ray-90", "ray-60", "ray-30", "ray0", "ray30", "ray60", "ray90", "speed", "headingError"],
    "outputs": ["steering", "throttle", "brake"],
    "brakeEnabled": true
  },
  "parameters": {
    "order": "layer-major; per layer: weights[out][in] row-major, then biases[out]",
    "count": 159,
    "values": [0.123, -0.456]
  },
  "training": {
    "generation": 42,
    "seed": 12345,
    "populationSize": 50,
    "eliteCount": 2,
    "selection": { "type": "tournament", "size": 3 },
    "crossover": { "type": "uniform", "rate": 0.7 },
    "mutation": { "rate": 0.1, "scale": 0.2 },
    "maxEpisodeSeconds": 60,
    "fitnessVersion": 1,
    "physicsConfigHash": "sha256:…",
    "trackIds": ["oval-01"]
  },
  "fitness": 18234.5,
  "evaluation": [
    {
      "trackId": "hairpin-heldout-01",
      "split": "heldout",
      "episodes": 10,
      "lapCompletionRate": 0.8,
      "collisionRate": 0.2,
      "meanLapTimeSeconds": 31.4,
      "checkpointProgress": 1.6
    }
  ]
}
```

(`parameters.values` is shortened here. A real file has exactly `count` numbers.)

## Required fields

| Field | Type | Rule |
|-------|------|------|
| `format` | string | Must equal `self-driving-ai-evolution/model`. |
| `schemaVersion` | integer | Must be ≥ 1. See compatibility below. |
| `id` | string | UUID from `crypto.randomUUID()`, with a seeded fallback. |
| `createdAt` | string | ISO 8601 UTC timestamp. |
| `architecture.layers` | integer[] | Currently must be `[9, 12, 3]`. |
| `architecture.*Activation(s)`, `inputs`, `outputs` | | Must match what the running app supports, or the model is rejected with a clear message. |
| `architecture.brakeEnabled` | boolean | `false` for no-braking models. Inference then forces brake = 0. |
| `parameters.count` | integer | Must equal the count computed from `layers`. |
| `parameters.values` | number[] | Length = `count`. Every value finite (no `NaN`, `Infinity` or `null`). |
| `training.generation` | integer ≥ 0 | |
| `training.trackIds` | string[] | Tracks used for training. |
| `fitness` | number | Finite. Fitness is only comparable when `fitnessVersion` and the tracks match. |

Optional: `name`, `appVersion`, `training.seed` (when the run was seeded, which it should be), the remaining training settings, and `evaluation` (empty until an evaluation run exists).

## Parameter order

For each layer transition `L → L+1` in order: all weights as `[outputIndex][inputIndex]` (row-major), then the biases for that layer's outputs. For 9-12-3 that is 108 weights + 12 biases + 36 weights + 3 biases = 159 values. A unit test pins this order with a hand-written network.

## Size

159 numbers written as full-precision JSON doubles come to about 3–4 KB per model. Store values at full precision (no rounding) so a reloaded model behaves identically. If the format is ever extended to keep a whole population, warn about localStorage quota (typically about 5 MB per origin) and prefer file export.

## Storage behaviour

- localStorage keys: `sdae:model:<id>` for each model, plus `sdae:models:index` for the list. Keep a small number of saves (for example 20) and ask before deleting.
- Wrap every localStorage access in `try/catch`. It can throw (Safari private mode, quota exceeded) or come back empty (cleared by the user, or evicted by iOS Safari after about 7 days without use under its storage policy).
- **localStorage is a convenience, not permanent storage.** The UI must say so and offer "Export JSON" next to every save.

## Validation and corrupted data

On load or import:

1. Parse JSON inside `try/catch`. On failure, show "This file isn't a valid model" and change nothing.
2. Check `format` and `schemaVersion`.
3. Validate every required field and type, the parameter count and finite numbers.
4. Reject unknown architectures with a message naming what was expected.
5. If a stored entry is corrupt, show it as "damaged" with a delete option. Never crash the app or silently drop other saves.
6. Limit import file size (for example 1 MB) before parsing.

Validation lives in `src/persistence/modelFormat.ts` and is a pure function returning `{ ok: true, model } | { ok: false, errors: string[] }`.

## Compatibility

- `schemaVersion` changes when the JSON structure changes. Newer apps migrate older versions through explicit, tested migration functions (`v1 → v2`, …). Models with a version newer than the app supports are rejected with "made by a newer version".
- `fitnessVersion` changes whenever the fitness formula changes. Models with different fitness versions can still be loaded and driven, but the comparison view must not rank them by fitness. Rank them by evaluation metrics instead.
- `physicsConfigHash` changes when physics constants change. A model trained under different physics loads with a warning that its behaviour may differ.

## Comparison

The model comparison view (P5-05) shows two or more models side by side using `evaluation` entries produced under the same evaluation seeds and tracks. It refuses to compare across different track sets without a warning.
