# webgpu-probe.ts

## Purpose

Whether WebGPU can run here. `navigator.gpu` alone is not enough: a browser may offer it with no adapter. The page (`bench-engine.ts`) and the measuring worker each ask their own, as a dedicated worker has its own `navigator.gpu`.

## Public API

- `GpuProbeLike { requestAdapter() }`: the part of `navigator.gpu` used.
- `webGpuProbe(gpu)` -> `() => Promise<boolean>`: asks for an adapter on the first call and keeps the answer.

## Invariants

- `gpu` is read on the first call, not when the probe is made.
- True only for a non-null adapter; no `navigator.gpu`, a null adapter or a throw is false.
- One adapter request per probe, however many calls.

## Example

```ts
const hasWebGpu = webGpuProbe(() => navigator.gpu);
if (await hasWebGpu()) {
  /* offer the webgpu backend */
}
```

## Tests

`webgpu-probe.test.ts`: true only for an adapter and asked once; false without `navigator.gpu`, without an adapter or on a throw.
