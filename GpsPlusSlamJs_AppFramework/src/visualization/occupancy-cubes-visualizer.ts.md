# occupancy-cubes-visualizer.ts

## Purpose

Renders the AR-space occupancy grid as one `THREE.InstancedMesh` of debug cubes — the TS equivalent of the Unity debug cubes in `ArCursorOnDepthSurface.cs`. Refreshed by `wireOccupancyGridSubscribers` at the depth-sample interval (`depth.intervalMs`, default 1000 ms; was a fixed ~1 Hz before Issue A); draws every occupied cell while under the instance cap. **Over the cap**, draws the cells **nearest the viewer** when `refresh` is given a `viewerPose` (Issue B1), falling back to a random subset when no pose is supplied or it is non-finite. Per-cell **camera RGB color** when the grid carries one (Iter 8 voxel coloring); height-based ramp as the fallback.

Plan: `GpsPlusSlamJs_Docs/docs/2026-06-11-2134-depth-occupancy-grid-port-plan.md` §3/Iter 5; AR-space reparenting + cube size in Iter 7; RGB coloring in Iter 8. Refresh cadence + viewer-local over-cap selection: `GpsPlusSlamJs_Docs/docs/2026-06-22-2251-occupancy-cubes-rendering-cadence-and-locality-plan.md` (Issues A + B1).

## Public API

- **`new OccupancyCubesVisualizer(arSpaceNode, options?)`** — `arSpaceNode` is the node that receives the alignment matrix (`arWorldGroup` live, `replaySceneState.arWorldGroup` in replay), injected (never `getArWorldGroup()` inside the class). Options: `maxInstances` (default 2000), `minObservations` (default 1, forwarded to `getOccupiedCells` as the noise filter), `cubeSizeM` (rendered cube edge length, default 0.025 — deliberately much smaller than the 0.15 m grid cell so voxels stay readable; field-tuned down from the initial 0.1 after on-device review), `rng` (default `Math.random`; injected for deterministic tests).
- **`refresh(grid: OccupancyGridSource, viewerPose?: ViewerPose): void`** — redraw from the grid (cubes at the exact per-cell point `getCellPoint(cell)` when the grid provides one, else the lattice `getCellCenter`; follow-up Item A), scaled to `cubeSizeM`. Over the cap: **nearest-N to `viewerPose.cameraPos`** (Issue B1) when a finite pose is supplied; otherwise an unbiased partial Fisher–Yates random subset. Each chosen cell's draw position is computed once (the ranking needs it before the draw loop) and carried through.
- **`ViewerPose`** — `{ cameraPos: [x,y,z]; cameraRot?: [x,y,z,w] }`, **raw WebXR** (the same frame as the cells, so no basis change is needed for distances). `cameraRot` is carried for the deferred B2 FOV pass and is unused by B1.
- **`pickNearestSubset(items, count, eye, positionOf, maxRadius?)`** — pure helper (exported for property tests): returns the `min(count, n)` items nearest `eye` by squared distance to `positionOf(item)`, each paired with its position. Stable order on ties; `count ≤ 0` → empty. `maxRadius` (Step 1.1 of the [2026-07-03 long-session fps plan](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-07-03-1344-long-session-fps-and-voxel-grid-scaling-plan.md)) drops items beyond it **before** scoring/sorting — behaviour-preserving whenever the count-th nearest lies within the radius; fewer-than-count survivors are returned as-is (distant cubes vanish by design). Omitted / non-finite = unbounded.
- **`OccupancyCubesVisualizerOptions.overCapRadiusM`** — viewer-local window for the over-cap selection, default **10 m** (at 15 cm voxels and cap 2000 a 10 m sphere is generous). Non-finite / ≤ 0 opts out (legacy unbounded nearest-N).
- **`setVisible(visible: boolean): void`** — show/hide all cubes live (flips the instanced mesh's `visible`); O(1), no re-mesh, cubes are kept (a later `refresh` repopulates). The live mesh-view toggle a consumer's mesh-view controller drives.
- **`clear(): void`** — hides all cubes (count 0); the mesh stays for the next refresh (store-swap path).
- **`dispose(): void`** — removes the mesh from its parent and disposes instance buffers, geometry, material. `refresh` after dispose is a safe no-op.
- **`getCount(): number`** — cubes currently drawn.
- **`OccupancyGridSource`** — the read surface required of the grid (`getOccupiedCells`, `getCellCenter`, `getCellColor`, optional `getCellPoint`, and optional `getOccupiedCellsWithin`); structurally satisfied by the framework's `OccupancyGrid`. When `getOccupiedCellsWithin` is present AND a finite pose is supplied AND `overCapRadiusM` is bounded, `refresh` snapshots through the chunk-indexed window (Step 2 of the 2026-07-03 fps plan) — the O(total-cells) `getOccupiedCells` walk then never runs; older grid doubles, a missing pose, or an opted-out radius fall back to the full snapshot.

## Invariants & Assumptions

1. One `InstancedMesh` for all cubes — per-refresh cost is O(drawn cells), no per-cell scene objects.
2. **Coordinate chain:** the grid's cells/centers are **raw WebXR** coordinates, but `arSpaceNode`'s local space is AR-odometry **NUE** — so the mesh node itself carries the constant `WEBXR_TO_NUE` basis change as its local matrix (`matrixAutoUpdate = false`), mirroring `webxr-session.ts`'s `basisChangeNode` for the camera. Cube world pose = `alignment × WEBXR_TO_NUE × cellCenter`, the same chain as the camera. Parenting at the scene root (the original Iter 5 mistake) leaves the cubes East/North-swapped and detached from the alignment — see the hit-test-reticle entry in `GpsPlusSlamJs_Docs/docs/lessons-learned.md`.
3. `frustumCulled = false` — instances spread across the room; per-mesh culling would blink them out.
4. Coloring (Iter 8): `grid.getCellColor(cell)` (0–255 averaged camera color, normalized to 0–1 via `setRGB`) when non-null; otherwise the HSL height ramp blue (≤ −1 m) → red (≥ 3 m) over cell height (raw WebXR Y; Up is Y in both frames). The fallback keeps rgb-off recordings and pre-Iter-8 replays rendering exactly as before.
5. Defensive: out-of-range injected `rng` values skip a pick instead of crashing; a **non-finite** `viewerPose.cameraPos` (tracking glitch) falls back to the random subset rather than ranking by `NaN`.
6. **Viewer-local over-cap selection (Issue B1)** with a **radius pre-filter** (Step 1.1, 2026-07-03 fps plan): over cap, cells beyond `overCapRadiusM` are dropped before scoring, so the scored-object allocation + sort are O(K) / O(K log K) over the neighbourhood instead of over every cell ever seen (~40k minConfidence-passing cells after a 5-min walk in the 2026-07-02 corpus — the linear fps-decline term). Position computation still touches all occupied cells once (the distance test needs it). Consequence: over cap, fewer than `maxInstances` cubes may be drawn when the within-radius set is small — distant cubes vanish by design (plan §Risks). Known tradeoff unchanged: the nearest-N set shifts as the user moves, so boundary cubes pop in/out between repaints — acceptable (arguably desirable) for a debug view; no hysteresis in v1.

## Examples

```ts
const visualizer = new OccupancyCubesVisualizer(arWorldGroup, {
  maxInstances: 2000,
});
visualizer.refresh(grid); // typically via wireOccupancyGridSubscribers
visualizer.dispose(); // on AR session teardown
```

## Tests

- `occupancy-cubes-visualizer.test.ts` — empty mesh parented under the AR-space node on construction, `WEBXR_TO_NUE` as the mesh local matrix, per-cell instance matrices (center + 0.025 m default scale + `cubeSizeM` override), world pose under a **non-trivial** alignment matrix (rides `alignment × WEBXR_TO_NUE`; identity fixtures would hide a missing basis change), `minObservations` forwarding, deterministic over-cap subset via injected rng, **over-cap nearest-N with a supplied pose (near cluster kept, far cells dropped), pose ignored while under cap, and non-finite-pose fallback to random (Issue B1)**, **radius pre-filter (Step 1.1): beyond-radius cells vanish even with cap room, and `overCapRadiusM: 0` opts back into unbounded nearest-N**, per-cell RGB vs height-ramp fallback (Iter 8), height-color ordering, clear-keeps-mesh, dispose releases resources + no-op refresh afterwards.
- `occupancy-cubes-visualizer.property.test.ts` — property tests for `pickNearestSubset`: result size = `min(count, n)`, the nearest-N partition (every kept cell ≤ every dropped cell by distance), each result carries its own `positionOf` value, determinism for a fixed eye, `count ≤ 0` → empty, and the **radius pre-filter contract** (behaviour-preserving when the count-th nearest fits in R; no returned cell beyond R; exactly the within-R set when fewer than count survive; omitted/`Infinity` = legacy).
