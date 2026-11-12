# cut-client.ts

**Purpose:** the page's side of the cut Worker.

## Public API

- `CutWorker`: the part of a `Worker` used, so tests can fake it.
- `CutFailed(phase, code, message, detail)`: a refused or failed cut; `code` is a `CutErrorCode`, `failed`, or `crashed`.
- `createCutClient(spawn): CutClient`.
  - `cut(picture | null, settings, onPhase?)`: cuts a new picture, or with null the last one again; resolves with the `SheetAnalysis`.
  - `close()`: rejects every held cut as aborted and ends the Worker.
- The real Worker is constructed by the page that uses the client (`new Worker(new URL("./character-cut.worker.ts", import.meta.url), { type: "module" })`), added with that page so no export sits unused.

## Invariants

- **Lazy:** the Worker is spawned on the first cut.
- **One at a time, latest wins:** while a cut runs, a newer request replaces an older waiting one, which rejects with an `AbortError`. A replaced request's new picture is carried over, so a slider moved before a picture's cut began still cuts that picture.
- **Correlated:** answers of another job, or that do not read, are ignored.
- **Crash:** the Worker's `error` event rejects every held cut with `CutFailed` code `crashed` and ends it; the next cut spawns a fresh Worker and sends it the last picture again (the new Worker has kept none).
- A `spawn` that throws rejects the cut with its error.

## Tests

`cut-client.test.ts` with a fake Worker.
