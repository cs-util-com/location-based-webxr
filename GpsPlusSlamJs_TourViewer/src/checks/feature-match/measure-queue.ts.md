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

- On every store notification whose state is a new object (an unchanged or refused dispatch, such as most motion readings, is skipped by identity): if `nextMeasureKey` names a pair, dispatch `queueStarted(key)` and measure it when the store accepted it.
- The context of a measurement is `beside-camera` when the camera runs at its start, else `idle`; `hidden` is whether the page was hidden at any moment of it.
- The job carries the ticked worker methods, the sizes from the options and the turn of a rotation pair (`turnOf`).
- A result whose methods all failed to load is `resultFailed` (not persisted, so a reload tries again). A result with some failed to load is `resultStored` with `persisted: false` and "k could not load" in its text.
- The matches JSON (`matchesInfo` with the shot files, context, hidden flag, settings, methods and sizes) goes in with `resultStored`. For a rotation pair it also carries `square`: both centre crops (`centreCrop` of the shot photos' sizes) and the turn, since its keypoints are in the squares' pixels.
- A photo that cannot be read is `resultFailed` ("not measured: a photo could not be read (...)"). `WorkerCrashed` is `workerCrashed` (counted; the queue stops at `MAX_CRASHES`). Any other error is `resultFailed`.
- **A WebGPU failure restarts the worker, never drops a pair.** Only the worker methods (ALIKED and SIFT + LightGlue) are looked at, and only those not off. A WebGPU failure is a method on WebGPU that fails a size (a lost device, or an error the device keeps giving), or fails to load although it loaded at least once before in this run, in any worker (a device lost between pairs, or in the new worker after a restart or a crash). A first load failing (a download) is none, and a failed size on WASM is an ordinary result. A pair with a WebGPU failure is stored as usual with what did answer, for this load only (`persisted: false`). While a worker method still on runs on WebGPU in that pair, its text says "; the worker restarts after <methods> failed on WebGPU (<first error>)" and the queue calls `client.close()` so the next pair gets a fresh worker and device; this holds when the failing method itself was just turned off, for the other one.
- **Each failing method still on counts the restart and is retried.** It stays retried until a pair where it does not fail on WebGPU, or until it is turned off.
- **A method is off for the run** when it fails a size while retried (a failed load while retried may be the new worker's download: it restarts again and stays retried), or when it has a WebGPU failure after `MAX_RESTARTS` (3) restarts made for it in this run, whatever happened in between. It is logged ("<method> is off for this run: ..."), its box is left out of later jobs (its WASM twin is not tried instead), and every later pair with the box ticked carries a placeholder for it: its id, label and the backend it failed on, the error "off for this run: ...", so the pair is kept for this load only and "1 could not load". The other methods go on and the queue does not stop.
- The worker's health (the methods that loaded once in this run, the restarts per method, the retried methods, the methods off) lives beside the client in the queue, not in the store: it lasts as long as the queue (this page load), and every pair it touches is stored for this load only. A crash does not reset it.
- **Assumption, not verified on a phone:** that ONNX Runtime in the same worker keeps reusing a lost GPU device (so only a new worker recovers). If it recovers on its own, a restart costs one model load.
- Log lines name the pair id first; every outcome (the result or failure text) is logged too, so the run zip's log says what the phone measured. An outcome for a pair no longer in the plan (retaken, the run resized or started over) is logged as "discarded, the pair is no longer in the plan" instead, since the store drops it.

## Invariants

- At most one pair measures: the store refuses `queueStarted` while one runs.
- The guard is ended on every path (`finally`).
- A result for a pair retaken meanwhile is dropped by the store (its key went stale) and frees the queue.
- A WebGPU error is not a crash: it never counts toward `MAX_CRASHES` and never throws away the methods that answered.

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

- `measure-queue.test.ts` (the harness in `src/test-support/measure-queue-harness.ts`): each ready pair measured once in run order after the restore, a pair measured with the camera off flagged idle and a hidden page flagged, a photo that cannot be read failing for this load only (both outcomes logged), methods that could not all load kept for this load only, a crash counted and the stop after two in a row, a pair whose WebGPU method failed a size kept with a worker restart (a WASM size error kept without one), a restart for a failed load only of a method that loaded before (fed by the real worker core, so the results are shaped as on the phone), a restart for a method that loaded earlier in the run failing its load in a new worker (after a restart for another method, and after a crash), a method off for the run after failing a size right after its restart (that pair kept for this load only, later pairs carrying it on the backend it failed on, the queue going on), a method kept on when its load fails right after its restart, a restart again after a good pair in between, a method off after three restarts with good pairs in between, a restart still made for the other WebGPU method when one is turned off, a result for a pair retaken meanwhile logged as discarded, nothing started once stopped, no choice of the next pair on a notification whose state did not change, and a rotation pair's matches carrying both crops and the turn while a real pair's carry none.
- `measure-queue.property.test.ts`: random shots, retakes (each step a new photo id), speed runs, the restore and worker answers (done, failed, crash) against a model; each call's key is derived from the job itself (its photos, legacy key and turn) and must name one ready pair of the plan: nothing starts before the restore or during a speed run, never two pairs in the worker, no result key measured twice, the stop after two crashes in a row, and otherwise every ready pair gets a result.
