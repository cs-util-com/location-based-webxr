# `ar-depth-pipeline.ts`

## Purpose

The AR session's depth capture: one `OccupancyGrid` with the framework's
recommended production settings, fed **directly** from the framework depth
sampler's callback — no Redux hop — plus the `clear()` hook the
tracking-reset hygiene rule needs.

## Public API

- `AR_DEPTH_SAMPLER_CONFIG` — what `ar-mode.ts` passes to `startDepthCapture`:
  the framework's **reconstruction cadence**
  (`DEFAULT_RECONSTRUCTION_DEPTH_INTERVAL_MS` = 200 ms ×
  `DEFAULT_RECONSTRUCTION_DEPTH_GRID_SIZE` = 24², ~2880 points/s), with
  `rgb: false` because nothing here reads voxel colours and the RGB path costs
  a GPU-stall blit per sample. NOT the library fallback (16² @ 1 Hz), which
  builds the grid 8× slower and the floor estimate with it.
- `createArDepthPipeline(): ArDepthPipeline` — one per AR session.
  - `grid` — the session's `OccupancyGrid`, **raw WebXR frame** (X=East,
    Y=Up, Z=South), read by `ar-elevation-auto.ts`'s floor path.
  - `fold(sample)` — folds one `DepthSample`. **Never throws**: it runs inside
    the XR frame callback via the framework's sampler, and a throw there would
    take the session's render down; a malformed sample is dropped (the stream
    is ~5 Hz, losing one costs nothing).
  - `clear()` — empties the grid.

## Invariants & assumptions

- **The grid settings are explicit, and that is the module's reason to
  exist.** The `OccupancyGrid` constructor default (0.15 m cells, no carve
  threshold) is LAXER than the framework-recommended production settings
  (`DEFAULT_OCCUPANCY_CELL_SIZE_M` = 0.16,
  `DEFAULT_OCCUPANCY_MIN_OBSERVATIONS` = 2). The floor estimator's corpus
  constants were measured on the 0.16 m / ≥2 grid, so a lax grid silently
  shifts every downstream confidence number. `carveConfidenceThreshold` is
  tied to the same ≥2 noise floor the queries use (mirroring the Recorder's
  wiring): a voxel solid enough to count cannot be erased by one deeper
  reading.
- **Direct wiring, no store hop** (plan §2.6): the Recorder routes samples
  through `recording/recordDepthSample` because it persists them; this demo
  records nothing, so folding in the capture callback avoids dev-mode
  serializable/immutable store checks on 576-point payloads at ~5 Hz.
- **`clear()` is wired to `odometryTrackingRestarted`** — `ar-mode.ts` calls
  it in the SAME callback that dispatches the action. After a reset the
  odometry frame the cells were measured in no longer exists; stale cells
  produce a plausible-looking, WRONG floor inside the estimator's acceptance
  band.
- One pipeline per session, dropped with the session handle. Grid cells are
  odometry-frame state and must never survive into a later session.
- Deep framework subpaths (`/ar/occupancy-grid`, `/ar/depth-sampler`), never
  the `/ar` barrel: `ar-mode.test.ts` mocks the barrel wholesale and this
  module must keep the REAL grid there (the barrel also pulls in Leaflet via
  the root export — the `ar-mode.ts` reason).

## Field-session items (M5) — what no headless gate can see

- **Depth planes**: the depth-texture near/far override is NOT in play
  (cold-review F1 — three.js applies `depthNear`/`depthFar` from a texture
  only in **gpu-optimized** depth sessions, and the framework pins
  `usagePreference: ['cpu-optimized']` in `permission-checker.ts`; three
  never writes near/far back to the app camera either, so the old per-frame
  re-assertion guard was unreachable and has been removed). The field check
  is simply: with depth sensing on, confirm no clip/fog anomaly — the far
  fog wall sits at 1000 m and the city does not clip at 200 m.
- **Real depth quality**: the synthetic tests use exact unprojections; real
  ARCore depth is noisy, and the fold + floor cadence budget (plan §2.6 perf
  gate) needs an on-device number.
- Headless e2e cannot enter AR at all, so the whole capture path is
  unit-tested (`ar-depth-pipeline.test.ts`, `ar-mode.depth-wiring.test.ts`)
  and field-verified, never e2e-verified.

## Examples

```ts
const pipeline = createArDepthPipeline();
// initAR(..., { depth: { onCaptured: pipeline.fold } });
// startDepthCapture(AR_DEPTH_SAMPLER_CONFIG);
// on odometryTrackingRestarted: pipeline.clear();
const estimate = estimateFloor(pipeline.grid, cameraPosAr);
```

## Tests

`ar-depth-pipeline.test.ts` — explicit grid settings (asserted against the
framework exports, not literals), the reconstruction-cadence config, fold,
clear, and the never-throws contract. The wiring into the session lifecycle
is pinned in `ar-mode.depth-wiring.test.ts`; the full fold → floor → offset
chain in `ar-mode.test.ts`.
