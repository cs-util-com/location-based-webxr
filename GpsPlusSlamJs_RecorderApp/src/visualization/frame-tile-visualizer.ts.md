# `frame-tile-visualizer.ts`

## Purpose

3D-scene visualizer for captured camera frames. Each entry surfaced
by the framework's `selectFrameTilesInWebXR` selector (one per
accepted `gpsData/add2dImage` action) becomes a textured plane in
the WebXR scene, anchored at the WebXR pose recorded at capture
time and sized to the frame's true aspect ratio. (Step 5.7a-2 deleted
the legacy `framesInScene` mirror — the selector is now the sole
source.)

Part of F3 of
[2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md).

## Public API

```ts
class FrameTileVisualizer {
  // `arSpaceNode` is the AR-odometry-NUE node that receives the alignment
  // matrix (`arWorldGroup` live / `replaySceneState.arWorldGroup` replay) —
  // NOT the scene root. The visualizer creates a child `WEBXR_TO_NUE` basis
  // node and parents tiles under it.
  constructor(
    arSpaceNode: THREE.Object3D,
    options?: { sizeMeters?: number; maxTiles?: number }
  );
  // `FrameTile` is a local alias for the framework's `ArImageCapture`
  // (the shape `selectFrameTilesInWebXR` produces).
  addTile(frame: FrameTile, texture: THREE.Texture): void;
  clear(): void; // remove all tiles, keep the basis node (reused after store-swap)
  dispose(): void; // clear() + detach the basis node from arSpaceNode
  getCount(): number;
}
```

- Option `onPlaced?(tile, capturedAt)`: called once per added tile, after its raw capture pose and aspect scale were written and the tile was parented and registered; `capturedAt` is the tile's own capture time (epoch-ms XR clock) or `undefined`. The RecorderApp passes the AR-space correction hook here (`ar/wire-ar-space-correction.ts`), so a tile placed after a relocalization from an image captured before it takes that jump.

## Design notes

- **AR-space node is injected** (no `getArWorldGroup()` call). Same P3
  rule as `syncGpsAnchoredMeshes`, `ref-point-visualizer`, and
  `OccupancyCubesVisualizer`.
- **`maxTiles` FIFO cap (Step 4 of the [2026-07-03 long-session fps plan](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-07-03-1344-long-session-fps-and-voxel-grid-scaling-plan.md)):**
  adding a tile over the cap removes + disposes the OLDEST (the `tiles` Map is
  insertion-ordered), bounding draw calls / GPU texture memory / scene-graph
  size on long live sessions while keeping the recent-path breadcrumb. `0`,
  omitted, or a non-finite/negative value = unlimited (legacy). **Live-only by
  wiring** (2026-07-03 interview): `main.ts` passes
  `frameTileDisplay.maxTiles`; the replay wiring passes no options so coverage
  auditing always sees the full recorded path.
- **Shared geometry** — one `PlaneGeometry(1, 1)` at module scope,
  reused by every tile. Per-tile size comes from `mesh.scale`.
- **Default plane size `DEFAULT_SIZE = 0.1` m** (halved from 0.2, D7,
  [2026-06-16-2053-team1-user-feedback.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-16-2053-team1-user-feedback.md)).
  The field tester read a tile spawning at the current pose as the camera
  "zooming in"; the smaller plane is less "in your face". **Plane size only —
  this does NOT reduce per-tile GPU texture memory.** The separate
  display-resolution divisor (Slice 4b) downscales the texture and is the part
  that cuts memory.
- **Aspect-correct sizing (Finding 1 / D1 of
  [2026-06-13-1311-frame-tile-rendering-bugs-user-feedback.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-13-1311-frame-tile-rendering-bugs-user-feedback.md)).**
  The shared geometry is square, so a non-square JPEG would be **stretched**
  if scaled uniformly. `addTile` instead scales **non-uniformly** from the
  frame's dimensions: the **longer** edge = `sizeMeters`, the shorter edge =
  `sizeMeters × shorter/longer` (`tileScaleXY`). Z scale is cosmetic (the plane
  lies in XY) and left at `sizeMeters`. This replaces the earlier — incorrect —
  claim that "texture aspect ratio is preserved by the texture's own
  coordinates": a `THREE.Texture` maps its `[0,1]` UVs across the whole plane,
  so nothing preserves aspect; the geometry footprint must carry it.
- **Dimension precedence: persisted → bitmap → square (DA-1 of
  [2026-06-14-0012-frame-tile-legacy-aspect-and-live-toggle-followup.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-14-0012-frame-tile-legacy-aspect-and-live-toggle-followup.md)).**
  `addTile` resolves each axis as `frame.width ?? bitmapDim(texture, 'width')`
  (likewise height). Persisted `width`/`height` (D1 capture metadata) win when
  present. **Legacy recordings predate those fields**, so the visualizer falls
  back to the decoded texture's `.image` dimensions — in production an
  `ImageBitmap` carrying the authoritative rendered pixel size — via the
  defensive `bitmapDim` helper. `bitmapDim` makes **no** `instanceof ImageBitmap`
  assumption (the `.image` may be `ImageBitmap` | `HTMLImageElement` |
  `HTMLCanvasElement` | a bare jsdom stub | `null`): it accepts only a finite,
  positive number per axis and otherwise returns `undefined`. When **neither**
  source yields usable dims, `tileScaleXY`'s final square fallback
  (`sizeMeters × sizeMeters`) catches it, so a tile can never collapse or
  distort. Finding A only makes the _visualizer_ self-sufficient for legacy
  data; it does not replace D1's persisted dimensions for non-visualizer
  consumers.
- **Per-tile material + texture** — captured frames cannot share a
  texture, so each tile owns its `MeshBasicMaterial({ map: texture })`.
  Materials and textures are disposed by `clear()` / `dispose()`. The
  shared geometry is never disposed (it lives for the module's
  lifetime, matching the resource model in `syncGpsAnchoredMeshes`).
- **Texture decoding lives outside this class.** `addTile` accepts a
  pre-built `THREE.Texture` so the class is jsdom-testable. F3.4's
  `wireFrameTileSubscribers` owns the `Blob → Texture` decode plus
  any broken-frame filtering.
- **Append-only by `imageFile` key.** A second `addTile` call with
  the same `imageFile` is a no-op, mirroring the slice's append-only
  semantics; frames are never re-published.
- **Coordinate space.** `selectFrameTilesInWebXR` emits **raw WebXR**
  poses (it runs `nueToWebXR` over the NUE-stored `odometryPath`). Those
  poses are applied as each tile's _local_ transform under an internal
  `WEBXR_TO_NUE` **basis node** (named `frame-tile-basis`,
  `matrixAutoUpdate = false`), which is itself a child of the injected
  AR-space node (`arWorldGroup`). So a tile's world pose =
  `alignment × WEBXR_TO_NUE × pose` — the camera's chain. This mirrors
  `webxr-session`'s `basisChangeNode` and `OccupancyCubesVisualizer`.
  - Parenting at the **scene root** instead (the pre-2026-06-13 bug)
    leaves tiles East/North axis-swapped (missing `WEBXR_TO_NUE`) and
    detached from the alignment matrix. The decisive regression guard is
    the world-pose test under a _non-trivial_ alignment in
    `frame-tile-visualizer.test.ts` — an identity fixture passes even
    with the bug present. See
    [2026-06-12-1628-frame-tile-visualizer-frame-check-followup.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-12-1628-frame-tile-visualizer-frame-check-followup.md)
    and the hit-test-reticle / occupancy-cube entries in lessons-learned.
