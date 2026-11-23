# feature-match-measure.worker.ts

## Purpose

The feature-match measuring worker, so measuring a pair never freezes the camera preview. It calls `serveMeasureWorker()` from `measure-worker-env.ts` with the page's method selection unchanged; that module wires `measure-worker-core.ts` to the real PNG decoder (`png-frame.ts`), this worker's WebGPU probe (`webgpu-probe.ts`), the methods built for the worker (`buildMethods(selection, deps, "worker")`) and `postMessage`. `measure-client.ts` is its page side; `measure-protocol.ts` holds the messages.

## Public API

None: a module worker entry, spawned with `new Worker(new URL("./feature-match-measure.worker.ts", import.meta.url), { type: "module" })`.

## Invariants

- The models are fetched once per worker (`memoFetch`), not once per pair.
- Messages are handled one after another on a promise chain; the client sends one at a time anyway.
- The worker spike's XFeat probe (`xfeat-probe.worker.ts`) runs the same wiring with XFeat as the only method.
- Its own dpdm cycle root in `scripts/test-timing/projects.mjs`: dpdm cannot follow a `new URL(...)` spawn.

## Tests

Not unit-tested (it needs a real worker); the core it runs is (`measure-worker-core.test.ts`), and `playwright-tests/feature-match-check.spec.js` runs it whole, in the photo test and in the worker spike.
