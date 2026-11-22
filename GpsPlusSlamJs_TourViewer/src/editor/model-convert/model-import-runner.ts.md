# model-import-runner.ts

**Purpose:** the page side of the model import: one drop's models shown as import rows on the shelf, converted one at a time in the converter's Worker, each handed to the delivery its drop named.

## Public API

- `createModelImportRunner({ store, host, settings? })`: a `ModelImportRunner`:
  - `start({ files, plan, deliver, release })`: queues the plan's imports (`importQueued`, ids `import:N`); returns their ids, none once closed. A plan with no import but held pictures releases them at once.
  - `retry(id)`: a failed import waits again (`importRetried`).
  - `remove(id)`: stops it if it converts (abort, then `host.close()` at once, before the next import can start in that Worker), drops its row; true when it was one not added, false for an unknown id or one whose model is being added (it can no longer be stopped).
  - `close()`: stops the conversion, drops every row, lets the Worker go, starts nothing afterwards.
- `ImportDelivery(file, { from, notes })`: adds the converted model; resolves `added { id }` (the shelf entry's id), `refused { reason }` or `stopped`.
- `createModelImportHost()`: the device seam, an `OptimizerHost` over `model-import.worker.ts` whose crash and silence words say "the converter" (not unit-tested).

## Invariants

- **One at a time, first in first out**, and none starts while an entry of kind model is optimizing or re-making its level of detail: the runner subscribes to the store and starts the next import when that ends.
- **The Worker goes after every conversion:** `host.close()` once the model is converted (before it is delivered, so the optimizer that may take it at once never runs beside the converter's Worker), or once the run failed, was refused or was stopped. Only the job that holds the Worker lets it go: a job stopped by `remove` or `close` closed it then, and its run settling later never closes the next job's Worker (the real host rejects every unsettled run on close, so that late close would fail the next model).
- **Outcomes:** converted and `added`: the row leaves (`importRemoved`), the entry gets `madeFrom { from, notes }`. `kept` (a refusal) or `refused`: failed with those words, no Retry. A crash (`OptimizerCrashed`): failed with `failure.crashed` and Retry; any other failure: `failure.broken` and Retry. Nothing is retried by itself.
- **The file:** the converted blob as `<name without extension>.glb`, type `model/gltf-binary`.
- **Held pictures:** a drop's group releases its held pictures, less those an added model carries (`conversion.used`, by file name), once each of its imports was added or removed; a failed import keeps them (its Retry may use them).
- **Being added is the runner's, not the store's:** while a converted model is delivered (`delivering`), the row still reads converting and `remove` returns false. It lasts one `addFile` (hashing and storing the model), no view shows it apart, and keeping it in the runner keeps the slice's import statuses to the ones a view draws (queued, converting, failed).
- Blobs are never state: each import's files live in the runner's table until it leaves.

## Tests

`model-import-runner.test.ts` with a fake host and a real store: delivery with notes, one at a time in order, waiting for the optimizer, refusal, crash with Retry and no automatic retry, remove while converting (the next model converts in a Worker of its own, the fake host rejecting held runs on close like the real one), a refused delivery, held pictures released once the models are done and held while a model failed, close; a property over random outcomes, removals and retries (never two conversions at once, entries only through the delivery).
