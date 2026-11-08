# optimizer-client.ts

**Purpose:** the page's side of the asset optimizer's module Worker, as an `OptimizerHost`.

## Public API

- `OptimizerWorker`: the part of a `Worker` used (`postMessage`, `terminate`, `onmessage`, `onerror`), so tests can fake it.
- `createOptimizerHost(spawn)`: an `OptimizerHost` over Workers that `spawn` makes.
- `spawnOptimizerWorker()`: the device seam, `new Worker(new URL("./asset-optimizer.worker.ts", import.meta.url), { type: "module" })`; not unit-tested.

## Invariants

- **Lazy:** the Worker is spawned on the first `run`, so a build whose rows need no Worker never starts one.
- **Correlated:** each run gets a fresh job id; answers for an unknown job, or of no known type, are ignored. Progress is forwarded to the run's `control.progress`.
- **Validated:** an answer of a known type is read field by field. A `done` must carry a Blob, an extension the format allows for the run's kind (`tourMediaTypeOf`), and, when given, a width and height that are positive whole numbers; a `kept` or `failed` must carry its words. One that does not read rejects its run with words (`the optimizer answered with ...`), so the job fails with Retry instead of hanging or handing a file every later save would refuse.
- **Abort:** an aborted signal posts `cancel` and rejects the run with an `AbortError`.
- **Crash:** the Worker's `error` event rejects every pending run with `OptimizerCrashed` and terminates it; the next run spawns a fresh Worker.
- **close():** every pending run rejects with an `AbortError`; the Worker is terminated.
- A `spawn` that throws rejects the run with its error.

## Tests

`optimizer-client.test.ts` with a fake Worker: lazy spawn, correlation and progress, failure words, abort, crash and respawn, close, malformed answers (extension of another kind or none allowed, a zero or fractional size, no Blob, kept or failed without words).
