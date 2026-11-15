# optimizer-client.ts

**Purpose:** the page's side of the asset optimizer's module Worker, as an `OptimizerHost`.

## Public API

- `OptimizerWorker`: the part of a `Worker` used (`postMessage`, `terminate`, `onmessage`, `onerror`), so tests can fake it.
- `createOptimizerHost(spawn)`: an `OptimizerHost` over Workers that `spawn` makes.
- `OPTIMIZER_SILENCE_MS`: 120 000 (2 minutes), how long a Worker holding runs may send nothing before it counts as crashed.
- `spawnOptimizerWorker()`: the device seam, `new Worker(new URL("./asset-optimizer.worker.ts", import.meta.url), { type: "module" })`; not unit-tested.

## Invariants

- **Lazy:** the Worker is spawned on the first `run`, so a build whose rows need no Worker never starts one.
- **Correlated:** each run gets a fresh job id; answers for an unknown job, or of no known type, are ignored. Progress is forwarded to the run's `control.progress`.
- **Validated:** an answer of a known type is read field by field. A `done` must carry a Blob, an extension the format allows for the run's kind (`tourMediaTypeOf`), and, when given, a width and height that are positive whole numbers; a `kept` or `failed` must carry its words. A model's `model` report is advisory: it is carried through only when its `textures` and `quantize` fields are all finite numbers and its `lod` report reads (finite counts, `skipped` a string or null, `automatic` a boolean, every slider stop of finite numbers), and dropped otherwise (the checked file still lands). One that does not read rejects its run with words (`the optimizer answered with ...`), so the job fails with Retry instead of hanging or handing a file every later save would refuse.
- **Transfer:** `run`'s optional `transfer` list is posted with the run, so a sound's sample buffers move to the Worker instead of being copied (they are detached on the page afterwards).
- **Abort:** an aborted signal posts `cancel` and rejects the run with an `AbortError`.
- **Crash:** the Worker's `error` event rejects every pending run with `OptimizerCrashed` and terminates it; the next run spawns a fresh Worker.
- **Watchdog:** while the Worker holds runs, any message from it (progress or an answer) and every new run restart a wait of `OPTIMIZER_SILENCE_MS`; when it runs out, every pending run rejects with `OptimizerCrashed` (words: `the optimizer stopped answering for 2 minutes`) and the Worker is terminated, as for an error event. Chrome does not reliably fire `error` for a Worker killed out of memory, so without it the card stayed "in progress" until the author stopped it. The shelf then tries the job once more like any crash and fails it with those words and Retry. The wait stops once no run is pending.
  - **The value:** the longest silent stretch of a sound run is one primitive's level-of-detail ordering and measurement (progress is reported per primitive). Its budget is 10 s a model on a desktop, met by the largest measured model, a 57 600-triangle skinned tube at 9.7 s (`model-lod.ts.md`, Cost); a phone takes several times that, about 50 s at five times; 2 minutes leaves more than twice that. Progress restarts the wait, so a long model that keeps reporting is never cut, and a single silent stretch of over 2 minutes on a phone would already be far past the budget. Not measured on a phone; if a real model's single primitive proves slower, raise the value rather than split the silence.
- **close():** every pending run rejects with an `AbortError`; the Worker is terminated.
- A `spawn` that throws rejects the run with its error.

## Tests

`optimizer-client.test.ts` with a fake Worker (fake timers for the watchdog): lazy spawn, a silent Worker counted as crashed after `OPTIMIZER_SILENCE_MS` while progress keeps it alive and a settled run leaves no watchdog, correlation and progress, failure words, abort, crash and respawn, close, malformed answers (extension of another kind or none allowed, a zero or fractional size, no Blob, kept or failed without words), a model report carried through, and one that does not read (or whose slider stop does not) dropped.
