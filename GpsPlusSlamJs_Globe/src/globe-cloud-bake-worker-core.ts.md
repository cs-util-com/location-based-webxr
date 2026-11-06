# globe-cloud-bake-worker-core.ts

Purpose: the near clouds' bakes off the main thread: the worker's side and the page's.

## Public API

- `createCloudBakeWorkerCore(post, bake?)`: the worker's message handler; each app's worker file hands it its `postMessage`. Exported as `gps-plus-slam-globe/cloud-bake-worker`.
- `CloudBakeWorker`: the part of a `Worker` the page needs.
- `requestCloudBakes(worker)`: one question, one answer, the worker ended, in success and in failure.

## Invariants

- The tiles are transferred, not copied.
- A failed bake rejects the promise; the caller keeps the old clouds and reports it once.
- Each app has its own worker shell, so a bundler sees a worker file of its own (`GpsPlusSlamJs_TourViewer/src/editor3d/globe-cloud-bake-worker.ts`, `GpsPlusSlamJs_DesignSystem/labs/globe/globe-cloud-bake-worker.js`).

## Example

```ts
const bakes = await requestCloudBakes(new Worker(url, { type: "module" }));
```

## Tests

`globe-cloud-bake-worker-core.test.ts`: the answer, its transfer list, a failure, the worker's end.
