# measure-queue.ts

## Purpose

The measuring queue of the photo test: it watches the store and hands the next ready pair to the measuring worker, one at a time, while the tester goes on shooting. Pairs the phone measures need no PC pass; pairs it does not measure (not reached, failed, crashed) go to the PC in the run zip as before.

The store decides (`nextMeasureKey`, `queueStarted` in `feature-match-slice.ts`): the queue status is store state. This module only holds resources: it reads the two photos, waits for the worker and dispatches what came back.

## Public API

- `startMeasureQueue(deps)` -> `stop()`. `deps`:
  - `store { getState, dispatch, subscribe }`;
  - `readPhoto(id)`: a photo's PNG (`fm.readPhoto` of the store);
  - `client`: the `measure` of `measure-client.ts`;
  - `putMatches(key, json, action)`: puts the matches JSON into the results side table and dispatches `action` in the same step;
  - `guard()`: holds the screen awake and watches the page while a pair measures (`guardRun` of `run-guard.ts`); its `wasHidden()` and `end()` are used;
  - `log(line)`.
- `stop()`: no pair starts afterwards; one in the worker still answers into the store.

## Behaviour

- On every store change: if `nextMeasureKey` names a pair, dispatch `queueStarted(key)` and measure it when the store accepted it.
- The context of a measurement is `beside-camera` when the camera runs at its start, else `idle`; `hidden` is whether the page was hidden at any moment of it.
- The job carries the ticked worker methods, the sizes from the options and the turn of a rotation pair (`turnOf`).
- A result whose methods all failed to load is `resultFailed` (not persisted, so a reload tries again). A result with some failed to load is `resultStored` with `persisted: false` and "k could not load" in its text.
- The matches JSON (`matchesInfo` with the shot files, context, hidden flag, settings, methods and sizes) goes in with `resultStored`.
- A photo that cannot be read is `resultFailed` ("not measured: a photo could not be read (...)"). `WorkerCrashed` is `workerCrashed` (counted; the queue stops at `MAX_CRASHES`). Any other error is `resultFailed`.
- Log lines name the pair id first; every outcome (the result or failure text) is logged too, so the run zip's log says what the phone measured.

## Invariants

- At most one pair measures: the store refuses `queueStarted` while one runs.
- The guard is ended on every path (`finally`).
- A result for a pair retaken meanwhile is dropped by the store (its key went stale) and frees the queue.

## Example

```ts
const stop = startMeasureQueue({
  store,
  readPhoto: fm.readPhoto,
  client,
  putMatches,
  guard,
  log,
});
window.addEventListener("pagehide", stop);
```

## Tests

- `measure-queue.test.ts` (the harness in `src/test-support/measure-queue-harness.ts`): each ready pair measured once in run order after the restore, a pair measured with the camera off flagged idle and a hidden page flagged, a photo that cannot be read failing for this load only (both outcomes logged), methods that could not all load kept for this load only, a crash counted and the stop after two in a row, nothing started once stopped.
- `measure-queue.property.test.ts`: random shots, retakes, speed runs, the restore and worker answers (done, failed, crash) against a model: nothing starts before the restore or during a speed run, never two pairs in the worker, no result key measured twice, the stop after two crashes in a row, and otherwise every ready pair gets a result.
