# measure-client.ts

## Purpose

The page's side of the feature-match measuring worker. `measure(job)` sends one pair, forwards its progress lines and resolves with its results. It follows the pattern of the character cut client: one FIFO and one pair in the worker at a time, so every queued pair is measured and none replaces another.

## Public API

- `createMeasureClient(spawn)` -> `MeasureClient { measure(job, onLine?), close() }`. `spawn` makes the worker; the page passes `new Worker(new URL("./feature-match-measure.worker.ts", import.meta.url), { type: "module" })`; the worker spike (`worker-spike.ts`) passes the same worker, and `xfeat-probe.worker.ts` for its XFeat probe.
- `MeasureWorker`: the part of a `Worker` the client uses (`postMessage`, `terminate`, `onmessage`, `onerror`), so a test can fake it.
- `WorkerCrashed`: the worker stopped (`onerror`: out of memory, a crash) while it held the request.
- `MeasureFailed`: the worker answered `failed` (a PNG it could not decode, a malformed request).

## Invariants and defensive measures

- The worker is spawned lazily on the first `measure`, and again after a crash.
- At most one request is in the worker; the next is posted only when the last answered.
- An answer is checked with `answerOf` and must name the running job id; a stale or malformed one is ignored.
- A crash rejects the running request and every waiting one with `WorkerCrashed` and drops the worker; the next `measure` spawns a fresh one.
- `close()` rejects every held request with an `AbortError` and terminates the worker.
- A `spawn` that throws rejects that request only; the next one is tried.

## Example

```ts
const client = createMeasureClient(() => new Worker(url, { type: "module" }));
const done = await client.measure(job, (line) => log(line));
```

## Tests

`measure-client.test.ts` (a fake worker): one pair at a time in order with its progress forwarded, malformed answers and answers for another job ignored, a failed pair rejected and the next one sent, a crash rejecting every held pair and a fresh worker spawned after, a spawn that throws rejecting one pair only, `close` rejecting the held pairs and ending the worker.
