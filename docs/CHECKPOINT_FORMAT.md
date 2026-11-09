# Training checkpoint format v1

> Status: **implemented in P3-07** (`src/persistence/checkpointFormat.ts`, `src/persistence/checkpointStore.ts`, `src/ui/checkpointAdapter.ts`, `src/ui/checkpointSaver.ts`). Design: [`docs/plans/p3-07-plan.md`](plans/p3-07-plan.md).

A checkpoint is the state of **one training run at a generation boundary**, so the run can be resumed. It is a **different document from a saved champion** ([MODEL_FORMAT.md](MODEL_FORMAT.md)): a champion is one controller and **cannot resume evolution**. Each importer refuses the other's `format` by name, with a message that says which file it is.

Format name `self-driving-ai-evolution/checkpoint`, `schemaVersion` 1. There is no older schema, so **no migration exists and none is claimed**; a newer schema is refused as such.

## What a boundary holds

At the instant a generation has been scored and the next one started, the whole future of the run is determined by:

- the training configuration and the environment (vehicle physics, timestep, sensor layout), and the track (id, version, content hash);
- the **population**: the genomes of the generation about to run;
- the **run generator's state** (four unsigned 32-bit words). It is the only random state that persists between generations: the initial-population generator is used once, the per-transition generators (selection, crossover, mutation) are derived afresh from the run generator, and **nothing caches a draw** (`gaussian` consumes whole draws);
- the history of completed generations.

A **mid-generation** state is not saved. After a resume the interrupted generation is **re-run from its start**, which is exact because it is determined by the population.

## Fields

| Field | Meaning |
| --- | --- |
| `format`, `schemaVersion`, `id`, `createdAt`, `codeVersion`, `appVersion?`, `simulationVersion` | Identity and provenance. `id` uses the same plain characters as a model id. |
| `training.configuration` | The trainer's configuration, **validated by the trainer's own rules** (see "Validation"). |
| `training.environment` | `physics`, `timestepSeconds`, `sensors`. A resume requires them to equal this build's exactly. |
| `training.trackId`, `trackVersion`, `trackHash` | A registered training track with the manifest's version and content hash. |
| `training.rngStreams`, `training.rng` | The stream layout name (`RNG_STREAMS`) and `{ algorithm, words: [4 × uint32] }`. |
| `generationIndex` | Completed generations = the generation to run next (from 0). |
| `population` | `{ count, order, values: genome[count][159], negativeZeros? }`. |
| `history` | One entry per completed generation, in order: **full** or **compact**. |

### History: full and compact entries

`GenerationStats` holds each car's fitness (about 1 KB) and a champion genome (about 4 KB) per generation, so a complete record of a long run cannot fit browser storage. A checkpoint keeps:

- a **full** entry (`retained: true`: per-car `fitness`, `championIndex`, `champion`, and the aggregates) for the **last 20 generations and the best generation so far**;
- a **compact** entry (`retained: false`: `populationSize` and the aggregates the graph and dashboard read) for every other generation. A compact entry has **no** `fitness`, `champion` or `championIndex` field: that data is unavailable, never zero and never a copy. The validator refuses a compact entry that carries them.

The generation with the highest best fitness (the earliest on a tie) must be full. After a resume, `trainer.record().history` is the union of full and compact entries, `record().generations` holds only the full ones, and `record().complete` is `false` if any entry is compact. In the page, the graph and dashboard read the compact fields; the replay picker and Save say "champion not kept" for a compact generation and do not offer it.

### Negative zero

JSON writes `-0` as `0`. A genome parameter of `-0` (champion or population) is therefore listed in `negativeZeros` (population: `[genome, parameter]` pairs; champion: `championNegativeZeros` indices) and restored on reading, so a resumed run is bit for bit the same. Stored fitness values are display-only history; a `-0` there is written as `0`.

## Validation

`validateCheckpoint(value, { registry, resolveConfig })` reports **every** error, never throws, and checks bounds **before** walking any array (population 2 to 2,000; at most 20,000 generations). Numbers must be finite; indices must be consistent (`history.length === generationIndex`, `population.count` equals the configuration's population size, outcome counts add up to the population, the champion's fitness is the best fitness); the RNG algorithm and four words are checked; the track must be a registered training track with the manifest's version and hash.

**Configuration rules are not repeated here.** `persistence/` may not import `training/`, and `training/` stays headless and storage-free, so `resolveConfig` is an **injected adapter** supplied by the application layer (`ui/checkpointAdapter.ts`), wrapping `resolveTrainingConfig`, which remains the single authoritative rule set. No lint boundary changed.

## Size: one UTF-8 byte limit

`MAX_CHECKPOINT_BYTES` = **3 MiB in UTF-8 bytes** at every boundary: the text before it is parsed (file or storage), what is written to storage, and what Download offers. (Characters can be up to 3 bytes per UTF-16 code unit; length in code units is never used as a byte count.) A leading byte-order mark is accepted on import and never written. Download writes indented text when it fits and compact text otherwise; a state that does not fit or cannot be serialized gets a message and no file, the last good stored checkpoint is kept, and training continues.

## Storage and lifecycle

- **One slot**, `localStorage` key `sdae:checkpoint:v1`. A `setItem` that throws (quota, private window) changes nothing, so **a failed write keeps the previous checkpoint**. Saved champions (`sdae:model:*`) are never touched.
- **Saves** go through one `checkpointSaver`: periodic (every 5 generations or 30 seconds at a boundary, while training runs and is not paused), coalesced, **freshness-checked immediately before every write**, with hide-time (`visibilitychange` to hidden, `pagehide`) and lifecycle writes cancelling any pending one. Resume, Discard and Start fresh cancel pending writes. Tab-hide delivery is **not guaranteed** (iOS may end the page without any event), so periodic saves and Download checkpoint remain the safety nets.
- **A stored checkpoint is only offered**, with Resume and Discard. Nothing resumes automatically, and automatic saving stays off until the offer is answered, so an unanswered checkpoint is never overwritten.
- **Resume** requires this build to equal the checkpoint's environment and the page's training settings; otherwise the offer shows the reasons and only Discard.
- **Download checkpoint** is built from the run in memory, independent of storage. **Load checkpoint file** reads one file (its size is checked before it is read), validates it like stored data, and offers it; it replaces nothing until Resume.

## Equality contract (what a resume claims)

For a run resumed at a generation boundary, on the **same engine and build** (`codeVersion`; JavaScript engines are not required to agree on transcendental functions such as `Math.sin`, so no cross-engine equality is claimed):

1. the restored population, the run generator's state, and **every generation run after the resume** (full statistics, champion, outcomes) are deep-equal and bit for bit equal to the uninterrupted run;
2. the restored **history** is a stated projection: compact fields equal for every earlier generation, full statistics equal for the retained ones, and `fitness`/`champion` absent for the rest.

No claim is made that a resumed run learns, improves or generalises; a checkpoint reproduces the **same** run and says nothing about its quality.
