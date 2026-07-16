# occlusion-mesh-worker.ts

## Purpose

The **pure, transfer-friendly halves** of the occluder Web Worker offload (Phase 1 of `2026-07-01-0733-occluder-worker-and-chunked-remesh-plan.md`). Moving `meshOccupiedCells` off the main thread keeps the render smooth when a large-grid re-mesh takes 100s of ms. Framework-owned so any consumer needs only a ~10-line worker shell.

## Public API

- `packMeshRequest(id, cells, cellSizeM, mode, getCellPoint?) → { request, transfer }` — **main thread.** Packs the occupied-cell snapshot into `MeshWorkerRequest` (a flat `Int32Array` of cells; for the surface-hugging modes a parallel `Float64Array` of centroids, `NaN` = a cell whose `getCellPoint` was `null`). `cells` may be the tuple array or an already-flat `Int32Array` (Step 1.3 of the 2026-07-03 fps plan — `OccupancyGrid.getOccupiedCellsFlat`); a flat snapshot is used zero-copy, its buffer is transferred/DETACHED after posting (pass a fresh array), and a length not divisible by 3 throws `RangeError`. `transfer` is the buffer list for `postMessage`'s 2nd arg (zero-copy).
- `runMeshRequest(request) → { response, transfer }` — **worker.** Unpacks and runs `meshOccupiedCells` with `includeAabbs: false` (the response carries only geometry — the AABB list was ~2 discarded allocations per cell per re-mesh). For `'smooth'` the wire-format centroid array is handed to the mesher DIRECTLY (`options.centroids`, input-order aligned — the 2026-07-17 perf-loop fast path that deletes the per-cell key-map + callback + tuple plumbing); `'corner-fit'` still rebuilds the `getCellPoint` adapter from the parallel centroid array. Returns `{ id, positions, indices }` + its transfer list.
- `MeshWorkerRequest` / `MeshWorkerResponse` — the message shapes.

## Invariants & assumptions

- **Round-trip fidelity:** `runMeshRequest(packMeshRequest(…))` is **byte-identical** to a direct `meshOccupiedCells` — centroids are carried at **f64** (not f32) so the surface-hugging modes match exactly.
- **Centroids only for `smooth`/`corner-fit`** (the cube modes ignore `getCellPoint`, so no centroid buffer is packed for them → 1 transferable, not 2).
- **Transfer, don't copy:** the returned `transfer` arrays are the request/response backing buffers; after `postMessage(msg, transfer)` the sender's typed arrays are detached.
- Cell coords must be within the mesher's packable range (`|coord| ≤ 32767`) — the worker's centroid lookup uses the same 17-bit packed key.
- **`getCellPoint` receives a transient tuple** (PR #161 review): on the flat-snapshot path `packMeshRequest` passes a reused scratch tuple, so the provider must not retain the `cell` argument beyond the call (see `MeshOccupiedCellsOptions.getCellPoint` for the full contract).

## Tests

- `occlusion-mesh-worker.test.ts` — round-trip == direct mesh for all 4 modes; null-centroid → geometric fallback; the transfer list is the request's backing buffers.
