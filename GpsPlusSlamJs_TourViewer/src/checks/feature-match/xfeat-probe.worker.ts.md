# xfeat-probe.worker.ts

## Purpose

The worker spike's XFeat probe (`worker-spike.ts`): does XFeat's runtime (LiteRT.js, `@litertjs/core`) start and run in a module worker on this device? It is the measuring worker's own wiring (`serveMeasureWorker` from `measure-worker-env.ts`) with XFeat as the only method, so it answers the same protocol and the page talks to it with the same client (`measure-client.ts`).

## Public API

None: a module worker entry, spawned with `new Worker(new URL("./xfeat-probe.worker.ts", import.meta.url), { type: "module" })`.

## Invariants

- Builds XFeat only (SIFT, ALIKED and SIFT + LightGlue off), whatever the request's methods say.
- The photo test's settings apply as in the measuring worker: one run, no warm-up, WebGPU where the worker has it, else WASM, the fp16 model file.
- A runtime that cannot start shows as the method's `error` in the `done` answer; a runtime that kills the worker shows as `WorkerCrashed` on the page.
- Its own dpdm cycle root in `scripts/test-timing/projects.mjs`.

## Tests

Not unit-tested (it needs a real worker); `playwright-tests/feature-match-check.spec.js` runs it in the worker spike test, where LiteRT's CDN is refused, so XFeat reports "could not start".
