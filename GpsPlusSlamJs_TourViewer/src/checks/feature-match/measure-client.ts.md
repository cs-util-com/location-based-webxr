# measure-client.ts

## Purpose

The page's side of the feature-match measuring worker. `measure(job)` sends one pair, forwards its progress lines and resolves with its results. It follows the pattern of the character cut client: one FIFO and one pair in the worker at a time, so every queued pair is measured and none replaces another.

## Public API

- `createMeasureClient(spawn)` -> `MeasureClient { measure(job, onLine?), close() }`. `spawn` makes the worker; the page passes `new Worker(new URL("./feature-match-measure.worker.ts", import.meta.url), { type: "module" })`.
- `MeasureWorker`: the part of a `Worker` the client uses (`postMessage`, `terminate`, `onmessage`, `onerror`), so a test can fake it.
- `WorkerCrashed`: the worker stopped (`onerror`: out of memory, a crash) while it held the request, or it did not answer within `MEASURE_TIMEOUT_MS` ("timed out").
- `MeasureFailed`: the worker answered `failed` (a PNG it could not decode, a malformed request), or its answer naming the running pair was malformed ("malformed answer").
- `MEASURE_TIMEOUT_MS`: how long one pair may stay in the worker, 10 min.

## Invariants and defensive measures

- The worker is spawned lazily on the first `measure`, and again after a crash.
- At most one request is in the worker; the next is posted only when the last answered.
- An answer is checked with `answerOf` and must name the running job id; one for another job is ignored. A malformed message that names the running job rejects that pair with `MeasureFailed("malformed answer")` and the next pair is sent, so the queue never waits for an answer that cannot come.
- A crash rejects the running request and every waiting one with `WorkerCrashed` and drops the worker; the next `measure` spawns a fresh one. The worker's `error` event is handled here, so its default is cancelled (`preventDefault`) and the page's error log does not report it again.
- **The timeout.** A pair the worker does not answer within `MEASURE_TIMEOUT_MS` counts as a crash: every held request rejects with `WorkerCrashed("timed out")` and the worker is terminated, so a hung worker (a GPU call that never returns, a lost message) cannot stall the queue for good; the queue's crash rule (`MAX_CRASHES` in a row) then applies. The timer is per pair and is cleared by the pair's answer.
  - Why 10 min: the first pair also downloads the models, about 66 MB with the default methods (SIFT, ALIKED + LightGlue). 10 min covers that at about 0.9 Mbit/s (66 MB x 8 / 600 s), plus a slow phone's measuring of the first pair.
  - The parameter swept (by arithmetic, not measured on a phone): 5 min would fail the first pair on any line below about 1.8 Mbit/s, which a phone on weak mobile data reaches, and two such pairs in a row would stop the queue; 20 min would hold a truly hung worker for 20 min, longer than a whole capture round of 13 shots, so the tester would reach the end view with nothing measured. 10 min is the value between; only a line slower than about 0.9 Mbit/s turns the verdict, and then the pairs go to the PC as for any crash.
- `close()` rejects every held request with an `AbortError` and terminates the worker; the next `measure` spawns a fresh one. The queue uses it to restart a worker whose GPU device was lost.
- A `spawn` that throws rejects that request only; the next one is tried.

## Example

```ts
const client = createMeasureClient(() => new Worker(url, { type: "module" }));
const done = await client.measure(job, (line) => log(line));
```

## Tests

`measure-client.test.ts` (a fake worker): one pair at a time in order with its progress forwarded, answers for another job and noise ignored, a malformed answer naming the running pair failing it and the next one sent, a failed pair rejected and the next one sent, a crash rejecting every held pair and a fresh worker spawned after, the worker's error event cancelled, the timeout counting as a crash (not one tick early, and not for a pair that answered), the timeout at least 10 min, a spawn that throws rejecting one pair only, `close` rejecting the held pairs and ending the worker.
