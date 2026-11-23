# measure-protocol.ts

## Purpose

The messages between the feature-match page and its measuring worker (`feature-match-measure.worker.ts`): one request per ready pair, progress lines, and the pair's results or why it failed. Both ends check what they receive, so a malformed message is dropped (or answered `failed`) instead of breaking the queue.

## Public API

- `WorkerMethods { sift, aliked, siftLightGlue }` (the type of `MeasureJob.methods`): the methods the worker runs. XFeat is not among them: its runtime cannot start in a module worker, so it stays a PC method.
- `MeasureJob { a, b, turn, methods, sizes, pair }`: the two shot PNGs as Blobs, the turn of a rotation pair (`TurnDegrees` or null; `turnOf` in `rotation-square.ts`), the methods, the long edges in pixels and the protocol key of the pair (for the run settings line).
- `MeasureRequest`: a job plus `type: "measure"` and a positive integer `job` id.
- `MeasureDone { results, frames { a, b }, settings, measureMs }`: the method results, the sizes of the frames measured (the squares for a rotation pair), the run settings line and the measuring time with load times left out.
- `MeasureAnswer`: `progress { job, line }`, `done { job, ...MeasureDone }` or `failed { job, message }`.
- `requestOf(data)` -> `MeasureRequest | null`: the worker's check (Blobs, a known turn, boolean methods, positive sizes, a string pair).
- `answerOf(data)` -> `MeasureAnswer | null`: the page's check (each result with an id, a label and a sizes list, positive frame sizes, a string settings line, a finite `measureMs`).

## Invariants

- Job ids are positive integers; an answer without one is never accepted.
- The validators never throw; they return null for anything they cannot read.

## Example

```ts
const answer = answerOf(event.data);
if (answer?.type === "done") {
  store(answer.results);
}
```

## Tests

`measure-protocol.test.ts`: a well-formed request with and without a turn, and each answer kind, accepted; a request or an answer with any one bad field refused.
