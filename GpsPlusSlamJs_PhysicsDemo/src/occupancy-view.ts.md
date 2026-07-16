# occupancy-view.ts

## Purpose

The demo's single reconstructed mesh, used for BOTH the visual occlusion AND the
physics collider (user feedback: same framework building block). Owns an
`OccupancyGrid` fed by a store's `recordDepthSample` stream (via the framework's
`subscribeReplayOccupancy`) driving ONE `OcclusionMesh`. Used by both the desktop
(with `startReplaySession`'s own occupancy disabled) and live-AR paths.

## Public API

- **`createOccupancyView(arWorldGroup, store, options?): OccupancyView`** —
  `options` = `{ cellSizeM=DEFAULT_OCCUPANCY_CELL_SIZE_M (0.18),
minObservations=DEFAULT_OCCUPANCY_MIN_OBSERVATIONS (3), meshMode='smooth',
debugStyle='depth-shaded-wireframe' }`. The voxel size + noise floor come from the
  framework constants so the demo shares the RecorderApp's tuning. The 18 cm voxel
  is the speed lever; the noise floor stays at 3 to keep floaters (= phantom
  colliders) low (2026-07-16 cellSize × noise corpus sweep).
- **`OccupancyView`**:
  - `getMesh(): THREE.Mesh` — the CURRENT occluder's mesh (a stable handle across
    `setMeshMode` recreation), whose trimesh feeds the physics collider.
  - `setMeshMode(mode)` — `MeshMode` (`'smooth'` Surface nets / `'greedy'` Cubes /
    `'corner-fit'`). Since the mode is an `OcclusionMesh` CONSTRUCTION option, this
    **recreates** the occluder and re-meshes from the persisted grid.
  - `setDebugStyle(style)` — live `OccluderDebugStyle` skin switch.
  - `dispose()`.

## Invariants & assumptions

- **One occluder = occlusion + physics.** The depth-only occluder always writes
  depth (occlusion is on in every shader, incl. `'off'`); its geometry buffer
  (raw-WebXR) is the physics trimesh — so the two never diverge.
- **Confidence-guarded carving at the noise floor** (2026-07-16 synthetic-scene
  investigation): the grid is built with
  `carveConfidenceThreshold = minObservations`, so any voxel solid enough to be
  meshed can no longer be erased by a single deeper depth reading — the
  collider/occluder stays stable instead of churning at silhouette edges.
- **Grid persists across mode changes** — `setMeshMode` disposes/rebuilds only the
  occluder and re-meshes from the existing grid, so no depth data is lost.
- No cube visualizer — "Cubes (blocky)" is the `'greedy'` mesher mode of the
  occluder, not a separate instanced mesh.

## Tests

- `occupancy-view.test.ts` (real framework objects + fake store) — each depth
  sample folds into the grid and re-meshes the occluder; defaults to Surface nets +
  the combined shader; `setDebugStyle` switches live; `setMeshMode` yields a NEW
  `getMesh()` handle and re-meshes; the confidence guard keeps an established
  cell against a deeper reading (identity-projection rays); dispose detaches.
