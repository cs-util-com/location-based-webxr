# measure-worker-env.ts

## Purpose

The browser half of a measuring worker. `serveMeasureWorker(pick?)` wires `measure-worker-core.ts` (`handleMeasure`) to the real PNG decoder (`png-frame.ts`), this worker's WebGPU probe (`webgpu-probe.ts`), the methods built for the worker (`buildMethods(pick(selection), deps, "worker")`) and `postMessage`, and starts answering the page's requests.

Two workers use it:

- `feature-match-measure.worker.ts`: the photo test's measuring worker, with the selection unchanged;
- `xfeat-probe.worker.ts`: the worker spike's XFeat probe, with XFeat as the only method.

## Public API

- `serveMeasureWorker(pick = identity)`: call once at the top of a module worker entry.

## Invariants and defensive measures

- The models are fetched once per worker (`memoFetch`), not once per pair, and the loaded methods (ALIKED's and LightGlue's ONNX sessions, sift.js, the probe's XFeat) are kept for the worker's life in `env.kept` (see `measure-worker-core.ts`). The page starts a new worker after a crash, so a crash also starts with fresh sessions.
- Messages are handled one after another on a promise chain; the client sends one at a time anyway. Each step is chained for both outcomes (`then(step, step)`), so a rejected step never blocks the messages after it.
- `pick` sees the selection after the core turned XFeat off, so only an explicit `pick` turns XFeat on.
- Runs only in a worker: it reads `self`, `fetch`, `navigator.gpu` and `performance` of the worker.

## Example

```ts
// feature-match-measure.worker.ts
serveMeasureWorker();
```

## Tests

Not unit-tested (it needs a real worker). The core it runs is (`measure-worker-core.test.ts`); `playwright-tests/feature-match-check.spec.js` runs both workers whole.
