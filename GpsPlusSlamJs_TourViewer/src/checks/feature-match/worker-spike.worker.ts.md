# worker-spike.worker.ts

## Purpose

The throwaway worker spike's module Worker: answers the page's requests with `worker-spike-cells.ts`, in the context `"worker"`, so the methods load their runtimes and models inside a dedicated worker exactly as the background queue's worker will.

## Protocol

- `SpikeAsk`: `{ kind: "facts" }` (WebGPU adapter and thread line), `{ kind: "cell", cell }` (a `CellRequest`), `{ kind: "png", png, rgba, width, height }` (the PNG round trip).
- On the wire each request carries an `id`; the answer is `{ id, result }` or `{ id, error }`, and a cell's progress lines arrive as `{ id, line }` before it.
- The page sends the next request only after the last answered.

## Tests

None (throwaway, needs a real Worker); exercised by the spike runs.
