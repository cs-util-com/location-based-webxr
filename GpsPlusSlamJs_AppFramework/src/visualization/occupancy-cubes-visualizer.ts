/**
 * Occupancy-cubes visualizer — renders the AR-space occupancy grid as one
 * `THREE.InstancedMesh` of cubes (2026-06-11 depth occupancy-grid port
 * plan §3/Iter 5). The TS equivalent of the Unity debug cubes in
 * `ArCursorOnDepthSurface.cs`: refreshed by `wireOccupancyGridSubscribers`
 * at the depth-sample interval (`depth.intervalMs`; was a fixed ~1 Hz
 * before Issue A), drawing all occupied cells when under the instance cap
 * and, above it, the cells nearest the viewer when a pose is supplied
 * (Issue B1) — otherwise a random subset (the original "randomly picking
 * points every second" behavior; no geometry-shader point billboard is
 * ported, WebGL has none).
 *
 * Coloring: height-based per-instance color (HSL ramp over the cell's Y)
 * until per-point RGB capture lands (plan §5).
 *
 * Coordinate space: the grid's cells are **raw WebXR** coordinates, but
 * the AR-space node (`arWorldGroup`) they must ride lives in AR-odometry
 * NUE. The mesh therefore carries the constant `WEBXR_TO_NUE` basis
 * change as its own local matrix — the same role `basisChangeNode` plays
 * for the camera — so every cube's world pose follows the camera's
 * `alignment × WEBXR_TO_NUE` chain (see the hit-test-reticle entry in
 * `GpsPlusSlamJs_Docs/docs/lessons-learned.md`). Parenting the mesh at
 * the scene root instead leaves the cubes axis-swapped and unaligned.
 *
 * The parent node is injected explicitly (no `getArWorldGroup()` call)
 * so the class stays unit-testable — same P3 rule as
 * `FrameTileVisualizer`.
 */

import * as THREE from 'three';
// Deep module imports (not the ../ar barrel): the barrel eagerly evaluates
// enable-gps-ar's module-level deps, which breaks tests that partially mock
// webxr-session / permission-checker. bresenham3d and webxr-nue-basis depend
// only on three (mirrors occlusion-mesh.ts, the sibling occupancy visualizer).
import type { GridCell } from '../ar/bresenham3d.js';
import { WEBXR_TO_NUE } from '../ar/webxr-nue-basis.js';

/** The read surface of the framework's `OccupancyGrid` this class draws. */
export interface OccupancyGridSource {
  getOccupiedCells(minObservations?: number): readonly GridCell[];
  /**
   * Viewer-local window over the occupied set (Step 2 of the 2026-07-03
   * long-session fps plan — backed by the grid's chunk index, so the cost is
   * bounded by the neighbourhood, not the session). Optional so older grid
   * doubles still satisfy the interface; when present AND a finite pose is
   * supplied AND `overCapRadiusM` is bounded, `refresh` snapshots through it
   * instead of the O(total-cells) `getOccupiedCells` walk.
   */
  getOccupiedCellsWithin?(
    centerPos: readonly [number, number, number],
    radiusM: number,
    minObservations?: number
  ): readonly GridCell[];
  getCellCenter(cell: GridCell): readonly [number, number, number];
  /**
   * Per-cell average of the EXACT unprojected surface points (follow-up
   * Item A), or null when unavailable. Optional so older grid doubles still
   * satisfy the interface; when present, cubes are drawn here (hugging the
   * real surface) instead of at the lattice `getCellCenter`.
   */
  getCellPoint?(cell: GridCell): readonly [number, number, number] | null;
  /**
   * Per-cell average camera color (0–255 per channel, Iter 8), or null
   * when the cell carries no color — the cube then falls back to the
   * height ramp.
   */
  getCellColor(cell: GridCell): readonly [number, number, number] | null;
}

/**
 * Where the viewer is, for viewer-local over-cap cube selection (Issue B
 * of the 2026-06-22 cube cadence/locality plan). Raw WebXR — the **same
 * frame** as `getCellPoint`/`getCellCenter`, so distances are computed in
 * one consistent space with no basis change.
 */
export interface ViewerPose {
  /** Camera position [x, y, z], raw WebXR. */
  readonly cameraPos: readonly [number, number, number];
  /**
   * Camera rotation [x, y, z, w], raw WebXR. Carried for the **deferred**
   * B2 in-front-of-viewer FOV pass; B1 (nearest-N) does not read it.
   */
  readonly cameraRot?: readonly [number, number, number, number];
}

export interface OccupancyCubesVisualizerOptions {
  /** Maximum rendered cubes (InstancedMesh capacity). Default 2000. */
  readonly maxInstances?: number;
  /**
   * Minimum observation count for a cell to be drawn (noise filter,
   * forwarded to `getOccupiedCells`). Default 1 — tuned in Iter 6.
   */
  readonly minObservations?: number;
  /**
   * Rendered edge length of each debug cube in meters. Deliberately
   * much smaller than the grid cell (0.15 m) so individual voxels stay
   * readable instead of fusing into a solid wall. Default 0.025
   * (field-tuned: 0.1 still read as too bulky on device).
   */
  readonly cubeSizeM?: number;
  /**
   * Random source for the over-cap subset selection. Injected so tests
   * are deterministic. Default `Math.random`.
   */
  readonly rng?: () => number;
  /**
   * Radius (meters, raw WebXR) of the viewer-local window used by the
   * over-cap nearest-N selection (Step 1.1 of the 2026-07-03 long-session
   * fps plan): cells beyond it are dropped before scoring/sorting, bounding
   * the per-refresh cost by the neighbourhood instead of the whole session.
   * At 15 cm voxels and the 2000-instance cap a 10 m sphere is already
   * generous. Non-finite / non-positive = unbounded (legacy). Default 10.
   */
  readonly overCapRadiusM?: number;
}

const DEFAULT_MAX_INSTANCES = 2000;
const DEFAULT_OVER_CAP_RADIUS_M = 10;
const DEFAULT_CUBE_SIZE_M = 0.025;
const MESH_NAME = 'occupancy-cubes';

/** Height range mapped onto the color ramp (meters, raw WebXR Y). */
const COLOR_Y_MIN = -1;
const COLOR_Y_MAX = 3;

export class OccupancyCubesVisualizer {
  private readonly arSpaceNode: THREE.Object3D;
  private readonly minObservations: number;
  private readonly cubeSizeM: number;
  private readonly rng: () => number;
  private readonly overCapRadiusM: number;
  private readonly mesh: THREE.InstancedMesh;
  private readonly geometry: THREE.BoxGeometry;
  private readonly material: THREE.MeshBasicMaterial;
  private disposed = false;

  /**
   * @param arSpaceNode - the node whose local space is AR-odometry NUE
   *   and which receives the alignment matrix (`arWorldGroup` live,
   *   `replaySceneState.arWorldGroup` in replay) — NOT the scene root.
   */
  constructor(
    arSpaceNode: THREE.Object3D,
    options: OccupancyCubesVisualizerOptions = {}
  ) {
    this.arSpaceNode = arSpaceNode;
    this.minObservations = options.minObservations ?? 1;
    this.cubeSizeM = options.cubeSizeM ?? DEFAULT_CUBE_SIZE_M;
    this.rng = options.rng ?? Math.random;
    // Non-positive / non-finite opts out of the radius bound (legacy).
    const radius = options.overCapRadiusM ?? DEFAULT_OVER_CAP_RADIUS_M;
    this.overCapRadiusM =
      Number.isFinite(radius) && radius > 0 ? radius : Infinity;
    const maxInstances = options.maxInstances ?? DEFAULT_MAX_INSTANCES;

    this.geometry = new THREE.BoxGeometry(1, 1, 1);
    this.material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.7,
    });
    this.mesh = new THREE.InstancedMesh(
      this.geometry,
      this.material,
      maxInstances
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.name = MESH_NAME;
    this.mesh.count = 0;
    this.mesh.frustumCulled = false; // instances spread across the room
    // Instances stay raw WebXR; the mesh node itself converts to the
    // parent's NUE frame (mirrors webxr-session's basisChangeNode).
    this.mesh.matrixAutoUpdate = false;
    this.mesh.matrix.copy(WEBXR_TO_NUE);
    this.arSpaceNode.add(this.mesh);
  }

  /** Number of cubes currently drawn. */
  getCount(): number {
    return this.mesh.count;
  }

  /**
   * Show or hide the cubes live without discarding them — the cheap
   * mesh-view toggle (a later `refresh` still repopulates them). Flips the
   * instanced mesh's `visible` flag; O(1), no re-mesh.
   */
  setVisible(visible: boolean): void {
    this.mesh.visible = visible;
  }

  /**
   * Redraw from the grid: every sufficiently-observed cell when under the
   * instance cap. Over cap, draw the cells **nearest the viewer** when a
   * `viewerPose` is supplied (Issue B1 — keeps the local neighbourhood
   * dense instead of a room-wide random scatter); fall back to the legacy
   * random subset when no pose is given or the pose is non-finite (a
   * tracking glitch), so older callers and deterministic tests are
   * unchanged.
   *
   * Each chosen cell's draw position is computed exactly once (via
   * `getCellPoint` ?? `getCellCenter`) and carried through to the draw
   * loop — the over-cap ranking needs it one step earlier than the legacy
   * code did.
   */
  refresh(grid: OccupancyGridSource, viewerPose?: ViewerPose): void {
    if (this.disposed) return;
    // Step 2 (2026-07-03 fps plan): snapshot only the viewer's neighbourhood
    // via the chunk-indexed windowed query when the grid offers it — the
    // O(total-cells) walk then never runs. Falls back to the full snapshot
    // for older grids, a missing/non-finite pose, or an opted-out radius.
    const hasFinitePose =
      viewerPose !== undefined && isFiniteVec3(viewerPose.cameraPos);
    const occupied =
      grid.getOccupiedCellsWithin &&
      hasFinitePose &&
      Number.isFinite(this.overCapRadiusM)
        ? grid.getOccupiedCellsWithin(
            viewerPose.cameraPos,
            this.overCapRadiusM,
            this.minObservations
          )
        : grid.getOccupiedCells(this.minObservations);
    const capacity = this.mesh.instanceMatrix.count;
    // Draw at the exact per-cell surface point when available (Item A),
    // falling back to the lattice center for grids without it.
    const positionOf = (cell: GridCell): readonly [number, number, number] =>
      grid.getCellPoint?.(cell) ?? grid.getCellCenter(cell);

    let drawn: PlacedCell[];
    if (occupied.length <= capacity) {
      drawn = occupied.map((cell) => ({ cell, pos: positionOf(cell) }));
    } else if (viewerPose && isFiniteVec3(viewerPose.cameraPos)) {
      drawn = pickNearestSubset(
        occupied,
        capacity,
        viewerPose.cameraPos,
        positionOf,
        this.overCapRadiusM
      ).map(({ item, pos }) => ({ cell: item, pos }));
    } else {
      drawn = pickRandomSubset(occupied, capacity, this.rng).map((cell) => ({
        cell,
        pos: positionOf(cell),
      }));
    }

    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    for (let i = 0; i < drawn.length; i++) {
      const placed = drawn[i];
      if (placed === undefined) continue;
      const [x, y, z] = placed.pos;
      matrix.makeScale(this.cubeSizeM, this.cubeSizeM, this.cubeSizeM);
      matrix.setPosition(x, y, z);
      this.mesh.setMatrixAt(i, matrix);
      // Iter 8: real camera color when the cell has one; height ramp for
      // color-less cells (rgb option off, pre-Iter-8 recordings).
      const rgb = grid.getCellColor(placed.cell);
      this.mesh.setColorAt(
        i,
        rgb
          ? color.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255)
          : heightColor(color, y)
      );
    }
    this.mesh.count = drawn.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  /** Hide all cubes (e.g. on store swap); the mesh stays in the scene. */
  clear(): void {
    this.mesh.count = 0;
  }

  /** Remove the mesh from its parent and release GPU resources. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.arSpaceNode.remove(this.mesh);
    this.mesh.dispose(); // releases the instance buffers
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** Map cell height to a stable HSL ramp (blue floor → red ceiling). */
function heightColor(target: THREE.Color, y: number): THREE.Color {
  const t = Math.min(
    1,
    Math.max(0, (y - COLOR_Y_MIN) / (COLOR_Y_MAX - COLOR_Y_MIN))
  );
  // 0.66 (blue) down to 0 (red)
  return target.setHSL(0.66 * (1 - t), 1, 0.5);
}

/** A cell paired with its already-computed draw position (raw WebXR). */
interface PlacedCell {
  readonly cell: GridCell;
  readonly pos: readonly [number, number, number];
}

/** True when every component of a 3-vector is a finite number. */
function isFiniteVec3(v: readonly [number, number, number]): boolean {
  return (
    Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2])
  );
}

/**
 * Pick the `count` items nearest `eye`, ranked by squared distance to each
 * item's draw position. Pure and deterministic: positions come from
 * `positionOf` (computed exactly once per item) and are carried through on
 * the result so the draw loop never re-fetches them. Ties keep input order
 * (stable sort). Exported for the property tests in
 * `occupancy-cubes-visualizer.property.test.ts`.
 *
 * Squared distance is sufficient — `sqrt` is monotonic, so it never changes
 * the ranking, and skipping it avoids `count` square roots per repaint.
 *
 * `maxRadius` (Step 1.1 of the 2026-07-03 long-session fps plan) drops items
 * farther than that from `eye` BEFORE scoring/sorting, shrinking the sort
 * from O(N log N) over every cell ever seen to O(K log K) over the local
 * neighbourhood — the linear-in-session-length term behind the long-walk fps
 * decline. Behaviour-preserving whenever the count-th nearest item lies
 * within the radius (property-tested); when fewer than `count` items survive
 * the filter, only those are returned — distant cubes vanish by design (plan
 * §Risks). Omitted / non-finite radius = unbounded (legacy behaviour).
 */
export function pickNearestSubset<T>(
  items: readonly T[],
  count: number,
  eye: readonly [number, number, number],
  positionOf: (item: T) => readonly [number, number, number],
  maxRadius?: number
): Array<{ item: T; pos: readonly [number, number, number] }> {
  const maxD2 =
    maxRadius !== undefined && Number.isFinite(maxRadius)
      ? maxRadius * maxRadius
      : Infinity;
  const scored: Array<{
    item: T;
    pos: readonly [number, number, number];
    d2: number;
  }> = [];
  for (const item of items) {
    const pos = positionOf(item);
    const dx = pos[0] - eye[0];
    const dy = pos[1] - eye[1];
    const dz = pos[2] - eye[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 <= maxD2) {
      scored.push({ item, pos, d2 });
    }
  }
  // Stable ascending sort by squared distance over the (radius-bounded) set.
  scored.sort((a, b) => a.d2 - b.d2);
  return scored
    .slice(0, Math.max(0, count))
    .map(({ item, pos }) => ({ item, pos }));
}

/**
 * Pick `count` distinct elements via partial Fisher–Yates on a copy —
 * O(count), unbiased for an unbiased rng, deterministic for injected rngs.
 */
function pickRandomSubset<T>(
  items: readonly T[],
  count: number,
  rng: () => number
): T[] {
  const pool = [...items];
  const result: T[] = [];
  const limit = Math.min(count, pool.length);
  for (let i = 0; i < limit; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    const a = pool[i];
    const b = pool[j];
    if (a === undefined || b === undefined) continue; // rng out of [0,1)
    pool[i] = b;
    pool[j] = a;
    result.push(b);
  }
  return result;
}
