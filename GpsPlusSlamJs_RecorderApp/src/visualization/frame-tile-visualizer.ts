/**
 * Frame-tile visualizer — renders captured camera frames as textured
 * 3D planes anchored at their capture pose. Each entry surfaced by
 * `selectFrameTilesInWebXR` becomes one `THREE.Mesh` (shared
 * `PlaneGeometry`, per-tile `MeshBasicMaterial` with the frame's image
 * as its texture).
 *
 * Part of F3 of
 * [2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md):
 * gives the operator a visible 3D breadcrumb of what the camera
 * already captured along the recording path so they can spot bad
 * tracking quality during live recording and audit coverage during
 * replay.
 *
 * Coordinate space: `selectFrameTilesInWebXR` converts the library's
 * NUE-stored `odometryPath.points` to **raw WebXR**. Those poses must
 * therefore ride the camera's `alignment × WEBXR_TO_NUE` chain, so the
 * visualizer parents every tile under an internal basis node that holds
 * the constant `WEBXR_TO_NUE` matrix (mirroring `webxr-session`'s
 * `basisChangeNode`), itself a child of the injected **AR-space node**
 * (`arWorldGroup`, which receives the alignment matrix). Parenting at
 * the scene root instead leaves tiles East/North axis-swapped and
 * detached from alignment — see
 * `GpsPlusSlamJs_Docs/docs/2026-06-12-1628-frame-tile-visualizer-frame-check-followup.md`
 * and the hit-test-reticle / occupancy-cube entries in lessons-learned.
 * (Step 5.7a-2 deleted the legacy `framesInScene` slice +
 * `add-2d-image-listener` mirror — the selector is now the sole source.)
 *
 * The AR-space node is injected explicitly (no `getArWorldGroup()` call)
 * so the class stays unit-testable and obeys the P3 rule used by
 * `syncGpsAnchoredMeshes`, `ref-point-visualizer`, and
 * `OccupancyCubesVisualizer`.
 *
 * Texture decoding is **out of scope** for this class — callers
 * (`wireFrameTileSubscribers`, F3.4) own blob → `THREE.Texture`
 * decoding so the visualizer can be exercised in jsdom without
 * `createImageBitmap`.
 */

import * as THREE from 'three';
import type { ArImageCapture } from 'gps-plus-slam-app-framework/core';
// Deep subpath on purpose (same rationale as occupancy-cubes-visualizer):
// the /ar barrel eagerly evaluates heavy module-level deps; webxr-nue-basis
// depends only on three.
import { WEBXR_TO_NUE } from 'gps-plus-slam-app-framework/ar/webxr-nue-basis';

/**
 * Pose-carrying frame descriptor consumed by the visualizer. Matches
 * the shape produced by `selectFrameTilesInWebXR` (one
 * `ArImageCapture` per captured frame). Previously imported from the
 * recorder-local `framesInScene` slice, which was deleted in Step
 * 5.7a-2 of the slice-collapse plan; the selector is now the sole
 * source.
 */
type FrameTile = ArImageCapture;

/** 1 m × 1 m base plane — scaled per tile (F3.4 may pass an option). */
const SHARED_GEOMETRY = new THREE.PlaneGeometry(1, 1);

export interface FrameTileVisualizerOptions {
  /**
   * Length of the tile's **longer** edge in meters. The shared unit
   * `PlaneGeometry(1, 1)` is scaled **non-uniformly** to the frame's
   * `width`/`height` aspect ratio so the tile footprint matches the true
   * image shape (the longer edge equals this value, the shorter edge is
   * `sizeMeters × shorter/longer`). Frames without persisted dimensions
   * (legacy recordings) fall back to a square `sizeMeters × sizeMeters`
   * tile. Defaults to 0.1 m (10 cm) — halved from 0.2 (D7, 2026-06-16 user
   * feedback) so the floating captured-frame tiles are "less in your face"
   * (the field tester read a tile spawning at the pose as the camera "zooming
   * in"). Plane-size only — this does NOT reduce per-tile texture memory; the
   * separate display-resolution divisor (Slice 4b) does.
   */
  readonly sizeMeters?: number;
  /**
   * FIFO cap on rendered tiles (Step 4 of the 2026-07-03 long-session fps
   * plan): adding a tile over the cap removes + disposes the OLDEST, bounding
   * draw calls / GPU texture memory / scene-graph size for arbitrarily long
   * sessions while keeping the recent-path breadcrumb. `0`, omitted, or any
   * non-finite/negative value = unlimited (the legacy behaviour) — the replay
   * wiring relies on that to keep full-path coverage auditing uncapped
   * (live-only cap, 2026-07-03 interview decision; the live wiring passes
   * `frameTileDisplay.maxTiles`).
   */
  readonly maxTiles?: number;
}

const DEFAULT_SIZE = 0.1;
const NAME_PREFIX = 'frame-tile';
/** Name of the internal `WEBXR_TO_NUE` basis node tiles hang off. */
const BASIS_NODE_NAME = 'frame-tile-basis';

export class FrameTileVisualizer {
  private readonly arSpaceNode: THREE.Object3D;
  private readonly sizeMeters: number;
  /** FIFO tile cap; `Infinity` = unlimited (see the option's docs). */
  private readonly maxTiles: number;
  /** Insertion-ordered (JS `Map` guarantee) — the FIFO the cap evicts from. */
  private readonly tiles = new Map<string, THREE.Mesh>();
  /**
   * Static basis-change node carrying the constant `WEBXR_TO_NUE` matrix,
   * parented under the AR-space node. Tiles (raw WebXR poses) are added
   * here so each tile's world pose = `alignment × WEBXR_TO_NUE × pose`,
   * the same chain as the camera (mirrors `webxr-session`'s
   * `basisChangeNode`).
   */
  private readonly basisNode: THREE.Group;
  private disposed = false;

  /**
   * @param arSpaceNode - the node whose local space is AR-odometry NUE
   *   and which receives the alignment matrix (`arWorldGroup` live,
   *   `replaySceneState.arWorldGroup` in replay) — NOT the scene root.
   */
  constructor(
    arSpaceNode: THREE.Object3D,
    options: FrameTileVisualizerOptions = {}
  ) {
    this.arSpaceNode = arSpaceNode;
    this.sizeMeters = options.sizeMeters ?? DEFAULT_SIZE;
    // 0 / negative / non-finite ⇒ unlimited (defensive: a corrupt cap must
    // never evict everything or throw — it just degrades to legacy behaviour).
    const cap = options.maxTiles ?? 0;
    this.maxTiles =
      Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : Infinity;

    this.basisNode = new THREE.Group();
    this.basisNode.name = BASIS_NODE_NAME;
    // matrixAutoUpdate=false so three never overwrites the basis matrix
    // from position/quaternion/scale decomposition.
    this.basisNode.matrixAutoUpdate = false;
    this.basisNode.matrix.copy(WEBXR_TO_NUE);
    this.arSpaceNode.add(this.basisNode);
  }

  /**
   * Add a textured tile for `frame`. Keyed by `frame.imageFile`; a
   * second call with the same `imageFile` is a no-op (append-only
   * mirror of the slice — frames are never re-published). The pose is
   * applied as the tile's *local* transform under the basis node; the
   * basis node supplies the WebXR→NUE conversion.
   */
  addTile(frame: FrameTile, texture: THREE.Texture): void {
    if (this.disposed) return;
    if (this.tiles.has(frame.imageFile)) return;
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide,
      transparent: false,
      depthWrite: true,
      depthTest: true,
    });
    const mesh = new THREE.Mesh(SHARED_GEOMETRY, material);
    // Non-uniform scale to the frame's aspect ratio so a non-square JPEG is
    // not stretched onto a square plane (Finding 1 / D1). The longer edge is
    // sizeMeters. Dimension precedence (DA-1, 2026-06-14 follow-up):
    // persisted frame.width/height → decoded texture.image dimensions →
    // square. The bitmap fallback closes the legacy-recording gap (records
    // predating the persisted fields) without a schema change; persisted dims
    // stay authoritative where present.
    const width = frame.width ?? bitmapDim(texture, 'width');
    const height = frame.height ?? bitmapDim(texture, 'height');
    const { x: scaleX, y: scaleY } = tileScaleXY(
      this.sizeMeters,
      width,
      height
    );
    mesh.scale.set(scaleX, scaleY, this.sizeMeters);
    mesh.name = `${NAME_PREFIX}-${frame.imageFile}`;
    mesh.position.set(frame.position[0], frame.position[1], frame.position[2]);
    mesh.quaternion.set(
      frame.rotation[0],
      frame.rotation[1],
      frame.rotation[2],
      frame.rotation[3]
    );
    this.basisNode.add(mesh);
    this.tiles.set(frame.imageFile, mesh);
    // FIFO cap (Step 4, 2026-07-03 fps plan): evict oldest-first so draw
    // calls / GPU textures stay bounded while the recent path keeps its
    // breadcrumb. `while` (not `if`) so a lowered cap on a reused instance
    // still converges.
    while (this.tiles.size > this.maxTiles) {
      const oldest = this.tiles.entries().next().value;
      if (!oldest) break; // unreachable: size > cap ≥ 1 implies an entry
      const [key, oldMesh] = oldest;
      this.basisNode.remove(oldMesh);
      disposeTileMaterial(oldMesh);
      this.tiles.delete(key);
    }
  }

  /**
   * Remove every tile and dispose its per-tile texture + material,
   * keeping the basis node so the visualizer can be reused after a
   * store-swap (the wirer calls `clear()` then keeps adding tiles). The
   * shared geometry is *not* disposed: it lives for the lifetime of the
   * module (matching the resource model in `syncGpsAnchoredMeshes`).
   */
  clear(): void {
    for (const mesh of this.tiles.values()) {
      this.basisNode.remove(mesh);
      disposeTileMaterial(mesh);
    }
    this.tiles.clear();
  }

  /**
   * End-of-life teardown: clear all tiles and detach the basis node from
   * the AR-space node so re-entering AR doesn't leak an empty group each
   * cycle. Mirrors `OccupancyCubesVisualizer.dispose()`.
   */
  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.arSpaceNode.remove(this.basisNode);
    this.disposed = true;
  }

  getCount(): number {
    return this.tiles.size;
  }
}

/**
 * Per-tile X/Y scale for the shared unit plane so the tile reproduces the
 * source image's aspect ratio. The longer edge is `sizeMeters`; the shorter
 * edge is scaled down by the aspect ratio. Falls back to a square
 * (`sizeMeters × sizeMeters`) when dimensions are missing or non-positive
 * (legacy recordings / degenerate input) so a tile can never collapse or
 * distort. Z is handled by the caller (the plane lies in XY; Z scale is
 * cosmetic).
 */
function tileScaleXY(
  sizeMeters: number,
  width: number | undefined,
  height: number | undefined
): { x: number; y: number } {
  if (!width || !height || width <= 0 || height <= 0) {
    return { x: sizeMeters, y: sizeMeters };
  }
  const aspect = width / height;
  return aspect >= 1
    ? { x: sizeMeters, y: sizeMeters / aspect } // landscape: width is the long edge
    : { x: sizeMeters * aspect, y: sizeMeters }; // portrait: height is the long edge
}

/**
 * Read a positive, finite pixel dimension from a decoded texture's `.image`
 * (DA-1 legacy fallback). In production the texture wraps an `ImageBitmap`
 * whose `.width`/`.height` are the authoritative rendered pixel dimensions —
 * the data Finding A falls back to for legacy recordings that predate the
 * persisted `width`/`height` fields. The `.image` shape is **not** guaranteed
 * (`ImageBitmap` | `HTMLImageElement` | `HTMLCanvasElement` | a bare jsdom
 * stub | `null`), so read defensively: never assume `instanceof ImageBitmap`,
 * and return `undefined` when the axis is absent, non-finite, or non-positive
 * so the caller falls through to the square (`tileScaleXY`'s last resort).
 */
function bitmapDim(
  texture: THREE.Texture,
  axis: 'width' | 'height'
): number | undefined {
  const image = texture.image as
    { width?: unknown; height?: unknown } | null | undefined;
  if (!image) return undefined;
  const value = image[axis];
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function disposeTileMaterial(mesh: THREE.Mesh): void {
  const material = mesh.material as THREE.MeshBasicMaterial;
  if (material.map) {
    material.map.dispose();
  }
  material.dispose();
}
