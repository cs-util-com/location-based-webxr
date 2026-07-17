/**
 * AR-Space Occupancy Grid
 *
 * TS port of the Unity voxel grid (`PointCloudData.cs`): folds the
 * persisted depth-sample stream (`recording/recordDepthSample`) into a
 * sparse 3D grid of occupied cells in raw WebXR space, with free-space
 * carving along each camera→point ray. Plain in-memory class — no THREE,
 * no DOM, no Redux; it is fed by store subscribers (the action stream is
 * the persisted source of truth, the grid is derived state).
 *
 * Deliberate deviations from the Unity original (2026-06-11 port plan):
 * - Cells hold an OBSERVATION COUNT (WebXR exposes no per-pixel
 *   confidence; the count is the noise-suppression analogue), not a render
 *   buffer index.
 * - Carving is skipped when camera and point share a cell, and the
 *   endpoint cell itself is never carved — Unity's carve-then-re-add would
 *   reset the count.
 * - `getCellCenter` is `cell · cellSizeM`, the true center under
 *   round-quantization (Unity's `CellToWorldPos` adds a spurious half
 *   cell).
 *
 * @see occupancy-grid.ts.md for detailed documentation
 */

import type { Vector3 } from 'gps-plus-slam-js';
import type { DepthSample, RgbTuple } from '../types/ar-types';
import { createDepthUnprojector } from './depth-unprojection';
import { bresenham3d, type GridCell } from './bresenham3d';
import {
  CELL_KEY_LIMIT,
  CELL_KEY_STRIDE_X,
  CELL_KEY_STRIDE_Y,
  cellCoordsInKeyRange,
  cellKey,
  packCellKey,
  unpackCellCoord,
  unpackCellKey,
} from './cell-key';

export interface OccupancyGridOptions {
  /** Edge length of a cubic grid cell in meters. Default 0.15 (Unity parity). */
  readonly cellSizeM?: number;
  /**
   * Dominant-axis steps before a ray's endpoint at which free-space
   * carving stops, to respect depth noise. Default 2 (Unity parity).
   */
  readonly carveStopCells?: number;
  /**
   * Confidence-guarded carving (2026-07-16 synthetic-scene investigation):
   * when set, a carve ray reaching a cell whose observation count is at or
   * above this threshold DECAYS the cell (count − 1, measured point/color
   * means preserved) and stops the trace — an established surface can no
   * longer be erased by a single deeper reading (silhouette-grazing churn
   * under a perfect sensor, or a noisy/bled too-far endpoint sweeping
   * through a confirmed wall into the occluded background), while REPEATED
   * contradicting rays still drain and eventually delete confidently-wrong
   * cells (the 2026-07-16-1547 fossilization field regression: a HARD block
   * made noise meshes immortal — mesh built while the grid was uncertain
   * could never be un-built by better data). Once below the threshold, the
   * legacy delete applies. Default undefined = legacy unguarded carving.
   * Must be a positive safe integer when set.
   */
  readonly carveConfidenceThreshold?: number;
}

/**
 * Recommended reconstruction defaults for apps that build AND render an occupancy
 * mesh (the Recorder, the PhysicsDemo). These are the single framework-level source
 * of truth so every consumer inherits the same tuning — change them here and both
 * apps follow.
 *
 * They are DELIBERATELY separate from {@link OccupancyGrid}'s constructor fallback
 * (`cellSizeM ?? 0.15`, Unity parity): that primitive fallback stays 0.15 because a
 * pile of low-level tests build `new OccupancyGrid()` with no args and assume 0.15
 * quantization. Both apps always pass an explicit `cellSizeM`, so the app-facing
 * recommended default and the primitive fallback can differ without conflict.
 *
 * Tuning (2026-07-16 EVENING, maintainer's on-device framerate/mesh trade-off
 * pass — supersedes the same-day corpus-sweep values 0.18/3): voxel 16 cm,
 * noise floor 2. The sweep's argument for floor 3 (floaters = phantom
 * colliders: mc 3 ≈ 1.9% vs mc 2 ≈ 3.5%) was measured under LEGACY carving;
 * with the decay carve guard the floater gap largely disappears (real
 * pillar-orbit A/B: guarded mc 2 isolates 2.12% vs guarded mc 3 2.19%), so
 * the faster floor is affordable now. `0.16` stays within
 * `OCCUPANCY_CONSTRAINTS.cellSizeM.max` (0.20); `2` within `minConfidence`
 * 1–10. History: 2026-07-16-0557 corpus sweep (0.18/3),
 * 2026-07-15-1640 device-impression change (0.18/2). See the recorder's
 * recording-options.ts.md for the full tuning timeline.
 */
export const DEFAULT_OCCUPANCY_CELL_SIZE_M = 0.16;

/**
 * Recommended occupancy noise floor — the minimum observation count before a cell
 * is rendered/meshed (the Recorder's `minConfidence`, the demo's `minObservations`,
 * and — since the decay guard — both apps' `carveConfidenceThreshold`).
 * See {@link DEFAULT_OCCUPANCY_CELL_SIZE_M} for the rationale and the tuning note.
 */
export const DEFAULT_OCCUPANCY_MIN_OBSERVATIONS = 2;

/**
 * Per-cell state, deliberately FLAT (Step 3.1 of the 2026-07-03 long-session
 * fps plan): one plain object with eight scalar fields instead of the former
 * `{ cell, posSum: [..], colorSum: [..] }` shape (~5 heap objects per cell,
 * ~201 B/cell measured in the 2026-06-30 Round 5). The cell coordinates are
 * NOT stored — `cellKey` is bijective, so every tuple a public API returns is
 * recovered via {@link unpackCellKey}. At ~100k cells after a 5-minute walk
 * this roughly halves the grid's long-lived heap and, more importantly, the
 * old-generation GC mark workload that reads as creeping jank.
 */
interface CellRecord {
  /** Number of depth points observed in this cell. */
  count: number;
  /**
   * Per-axis sums of the EXACT unprojected points (raw WebXR) observed in
   * this cell. `sum / count` is the running-average surface point — what the
   * COLMAP export and the debug cubes draw, instead of the 15 cm-lattice
   * `getCellCenter` (COLMAP export follow-up, Item A). Every observation has
   * a position, so the divisor is `count` (unlike the color sums).
   */
  posSumX: number;
  posSumY: number;
  posSumZ: number;
  /**
   * Number of observations that carried a color (≤ count — color-less
   * observations from old recordings or with the rgb option off must not
   * dilute the average toward black, Iter 8).
   */
  colorCount: number;
  /** Per-channel sums of the colored observations (running average). */
  colorSumR: number;
  colorSumG: number;
  colorSumB: number;
}

/**
 * Highest `minConfidence` a consumer can ask for (mirrors
 * `OCCUPANCY_CONSTRAINTS.minConfidence.max`). Once a cell's count exceeds this,
 * further observations can no longer change ANY consumer's occupied set, so they
 * do not bump {@link OccupancyGrid.getRevision} — letting a settled scene skip
 * redundant re-meshing.
 */
const MAX_RELEVANT_COUNT = 10;

export class OccupancyGrid {
  readonly cellSizeM: number;
  readonly carveStopCells: number;
  /**
   * Carve-blocking observation-count threshold, or undefined for legacy
   * unguarded carving (see {@link OccupancyGridOptions}). Public + always
   * present on instances so consumers built against a newer source can
   * feature-detect the guard on an installed build at runtime.
   */
  readonly carveConfidenceThreshold: number | undefined;
  private readonly cells = new Map<number, CellRecord>();
  /**
   * Chunk index (Step 2 of the 2026-07-03 long-session fps plan): cell keys
   * grouped by {@link CHUNK_EDGE_CELLS}³ chunk, maintained incrementally on
   * add/carve/clear (O(1) per mutation). Lets {@link getOccupiedCellsWithin}
   * visit only the chunks a query sphere touches — cost independent of total
   * explored area. Empty chunk sets are dropped.
   */
  private readonly chunks = new Map<number, Set<number>>();
  /**
   * Per-chunk dirty revision, bumped whenever a mutation inside the chunk
   * could change some consumer's occupied set (same semantics as the global
   * {@link revision}). This is the bookkeeping a future dirty-chunk remesh
   * needs (2026-07-01 worker plan, Phase-2 sketch) — landed with the index so
   * that plan becomes a consumer-side change only. Entries survive a chunk
   * emptying (a consumer must still see "changed"); reset by {@link clear}.
   */
  private readonly chunkRevisions = new Map<number, number>();
  /**
   * Monotonic counter bumped whenever the **occupied set** (at any
   * `minConfidence ≤ MAX_RELEVANT_COUNT`) could have changed: a cell added, a
   * cell removed by carving, a cell's count rising while still `≤
   * MAX_RELEVANT_COUNT` (a possible threshold crossing), or `clear`. Re-observing
   * an already-settled cell (count `> MAX_RELEVANT_COUNT`) does NOT bump it, so a
   * consumer can cheaply skip a full re-derive (cube refresh / occluder re-mesh)
   * when the revision is unchanged — the dominant idle-time saving over a long
   * session (see `2026-06-30-0829-occluder-tuning-followups.md`).
   */
  private revision = 0;
  /**
   * Memo of the last {@link getOccupiedCells} walk (Step 1.2 of the
   * 2026-07-03 long-session fps plan): with cubes + occluder both on, every
   * throttled refresh triggers two identical full-grid walks with the same
   * minConfidence floor — the second is answered from here. Valid only while
   * `revision` is unchanged, so it is only used for floors the revision
   * counter actually tracks (≤ {@link MAX_RELEVANT_COUNT}).
   */
  private snapshotCache: {
    revision: number;
    minObservations: number;
    cells: GridCell[];
  } | null = null;

  constructor(options?: OccupancyGridOptions) {
    const cellSizeM = options?.cellSizeM ?? 0.15;
    const carveStopCells = options?.carveStopCells ?? 2;
    if (!Number.isFinite(cellSizeM) || cellSizeM <= 0) {
      throw new RangeError(
        `cellSizeM must be a positive number, got ${cellSizeM}`
      );
    }
    if (!Number.isSafeInteger(carveStopCells) || carveStopCells < 0) {
      throw new RangeError(
        `carveStopCells must be a non-negative integer, got ${carveStopCells}`
      );
    }
    this.cellSizeM = cellSizeM;
    this.carveStopCells = carveStopCells;
    this.carveConfidenceThreshold = validateCarveConfidenceThreshold(
      options?.carveConfidenceThreshold
    );
  }

  /** Number of occupied cells. */
  get size(): number {
    return this.cells.size;
  }

  /**
   * A monotonic version that changes only when the occupied set (at any
   * `minConfidence ≤ 10`) could have changed. A consumer caches the value it
   * last meshed/rendered and skips its full re-derive when it is unchanged — so
   * a settled scene (already-observed cells being re-observed) costs nothing.
   * See {@link revision}.
   */
  getRevision(): number {
    return this.revision;
  }

  /**
   * Fold one depth sample into the grid: unproject each point, carve free
   * space from the camera cell to the point cell, then count the point's
   * cell as occupied. Points that cannot be unprojected (no
   * projectionMatrix on old recordings, invalid depth/coords) are skipped.
   *
   * Carving and incrementing run as two separate passes over the sample's
   * points: all rays are carved first, then every endpoint is incremented.
   * A single interleaved pass would be order-dependent — a deeper point's
   * carve could erase the endpoint a nearer point added earlier in the same
   * sample. Splitting the passes makes the result deterministic and lets an
   * endpoint observed within a sample survive other rays in that same
   * sample. (Deeper-carves-nearer still applies ACROSS samples: a later
   * sample's ray carves an earlier sample's endpoint as before.)
   *
   * @returns the number of points actually added.
   */
  addSample(sample: DepthSample): number {
    if (!isFiniteTriple(sample.cameraPos)) {
      return 0;
    }
    // Projection inverse and camera pose are sample-invariant — build the
    // unprojector once and reuse it for every point (null when the sample has
    // no usable projection matrix, e.g. pre-intrinsics recordings).
    const unprojector = createDepthUnprojector(
      sample.cameraPos,
      sample.cameraRot,
      sample.projectionMatrix
    );
    if (!unprojector) {
      return 0;
    }
    const cameraCell = this.cellForPosition(sample.cameraPos);
    // An out-of-envelope camera cell cannot be carved FROM safely: the packed
    // keys of the walk's out-of-range prefix alias unrelated in-range cells
    // (base-2^17 encoding), so an unguarded carve would DELETE real records
    // ~131 072 cells away. Skip carving for such a sample (endpoints are still
    // recorded — they have their own range check below); a camera ±9.83 km
    // from the session origin never occurs in a WebXR local space anyway.
    const cameraInRange = cellInKeyRange(cameraCell);
    // Pass 1: carve free space along every ray, collecting endpoint cells
    // (with the observing point's color, if any — Iter 8).
    //
    // Carve dedupe (Step 3.2 of the 2026-07-03 fps plan): many of a sample's
    // ≤1024 points quantize to the SAME endpoint cell (adjacent depth pixels
    // a few metres out share a 15 cm voxel). Without the confidence guard,
    // repeating a (cameraCell, endpointCell) carve within one sample is an
    // exact no-op (all carving happens before any increment, and deleting an
    // already-deleted key changes nothing, not even the revision), so carving
    // once per UNIQUE endpoint cell is byte-identical grid state at a
    // fraction of the bresenham+Map work (~2–5× at gridSize 32). WITH the
    // guard the dedupe is additionally semantic: an established cell decays
    // at most once per contradicting ray per sample, not once per duplicate
    // depth pixel.
    const carvedEndpointKeys = new Set<number>();
    const endpoints: Array<{ cell: GridCell; world: Vector3; rgb?: RgbTuple }> =
      [];
    for (const point of sample.points) {
      const world = unprojector.unproject(point);
      if (!world) {
        continue;
      }
      const cell = this.cellForPosition(world);
      // Defensive: a corrupt projection can unproject to an absurd point whose
      // cell falls outside the packable key range. Skip it (it cannot be a real
      // ≤few-metre depth reading) rather than store a colliding key.
      if (!cellInKeyRange(cell)) {
        continue;
      }
      if (cameraInRange && !cellsEqual(cameraCell, cell)) {
        const key = cellKey(cell);
        if (!carvedEndpointKeys.has(key)) {
          carvedEndpointKeys.add(key);
          this.carve(cameraCell, cell);
        }
      }
      endpoints.push({ cell, world, rgb: point.rgb });
    }
    // Pass 2: count endpoints occupied, after all carving for this sample.
    for (const endpoint of endpoints) {
      this.increment(endpoint.cell, endpoint.world, endpoint.rgb);
    }
    return endpoints.length;
  }

  /**
   * Occupied cells observed at least `minObservations` times (default 1).
   *
   * The result is a **shared immutable snapshot**: a repeated call with the
   * same floor on an unchanged grid returns the SAME array instance (the
   * memo above), so callers must never mutate it. Floors above
   * {@link MAX_RELEVANT_COUNT} bypass the memo — the revision counter does
   * not track their threshold crossings, so a cached result could go stale.
   */
  getOccupiedCells(minObservations = 1): GridCell[] {
    const cache = this.snapshotCache;
    if (
      cache &&
      cache.revision === this.revision &&
      cache.minObservations === minObservations
    ) {
      return cache.cells;
    }
    const result: GridCell[] = [];
    for (const [key, record] of this.cells) {
      if (record.count >= minObservations) {
        result.push(unpackCellKey(key));
      }
    }
    if (minObservations <= MAX_RELEVANT_COUNT) {
      this.snapshotCache = {
        revision: this.revision,
        minObservations,
        cells: result,
      };
    }
    return result;
  }

  /**
   * Flat `[x0,y0,z0, x1,y1,z1, …]` variant of {@link getOccupiedCells} for the
   * mesh-worker pack path (Step 1.3 of the 2026-07-03 long-session fps plan):
   * `packMeshRequest` ships the snapshot to the worker as a transferable
   * Int32Array, so handing it over flat deletes the tuple-array intermediate
   * it used to re-flatten. Same cells, same order as the tuple API.
   *
   * Unlike {@link getOccupiedCells} this returns a **fresh array every call**
   * — the pack path TRANSFERS the buffer to the worker (detaching it), so a
   * shared/cached array would be destroyed under the grid. When the tuple
   * memo is warm (the cubes refresh just snapshotted the same floor) the
   * fresh array is flattened from it in O(matching cells) without a re-walk.
   */
  getOccupiedCellsFlat(minObservations = 1): Int32Array {
    const cache = this.snapshotCache;
    if (
      cache &&
      cache.revision === this.revision &&
      cache.minObservations === minObservations
    ) {
      const cells = cache.cells;
      const flat = new Int32Array(cells.length * 3);
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i]!;
        flat[i * 3] = c[0];
        flat[i * 3 + 1] = c[1];
        flat[i * 3 + 2] = c[2];
      }
      return flat;
    }
    // Cold path: one Map walk into a worst-case-sized buffer, trimmed at the
    // end (a slice copy of the used prefix beats a second counting walk).
    // Coordinates come straight from the key — no tuple intermediate at all.
    const flat = new Int32Array(this.cells.size * 3);
    let used = 0;
    for (const [key, record] of this.cells) {
      if (record.count >= minObservations) {
        flat[used] = unpackCellCoord(key, 0);
        flat[used + 1] = unpackCellCoord(key, 1);
        flat[used + 2] = unpackCellCoord(key, 2);
        used += 3;
      }
    }
    return used === flat.length ? flat : flat.slice(0, used);
  }

  /**
   * Occupied cells (≥ `minObservations`) whose **centers** lie within
   * `radiusM` of `centerPos` — the viewer-local window that keeps consumer
   * refresh cost independent of total explored area (Step 2 of the
   * 2026-07-03 long-session fps plan). Walks only the chunks whose
   * cell-center AABB intersects the query sphere; chunks entirely inside it
   * skip the per-cell distance test. Result set ≡ the brute-force radius
   * filter of {@link getOccupiedCells} (property-tested; iteration order may
   * differ). Fresh array per call (no memo — the camera moves every frame).
   *
   * @throws RangeError for a non-finite or non-positive `radiusM` (a
   *   windowed query without a window is an upstream bug). A non-finite
   *   `centerPos` (tracking glitch) returns `[]` instead — mirrors
   *   {@link raycast}'s non-finite policy.
   */
  getOccupiedCellsWithin(
    centerPos: Vector3,
    radiusM: number,
    minObservations = 1
  ): GridCell[] {
    const result: GridCell[] = [];
    this.forEachOccupiedCellWithin(
      centerPos,
      radiusM,
      minObservations,
      (x, y, z) => {
        result.push([x, y, z]);
      }
    );
    return result;
  }

  /**
   * Flat `[x0,y0,z0, …]` variant of {@link getOccupiedCellsWithin} for the
   * mesh-worker pack path (same contract as {@link getOccupiedCellsFlat}:
   * fresh array every call — packing transfers/detaches the buffer).
   */
  getOccupiedCellsWithinFlat(
    centerPos: Vector3,
    radiusM: number,
    minObservations = 1
  ): Int32Array {
    const coords: number[] = [];
    this.forEachOccupiedCellWithin(
      centerPos,
      radiusM,
      minObservations,
      (x, y, z) => {
        coords.push(x, y, z);
      }
    );
    return Int32Array.from(coords);
  }

  /**
   * Per-chunk dirty revision (see the field docs): 0 for a never-touched
   * chunk. `chunk` is in chunk coordinates (`floor(cell / 16)` per axis).
   */
  getChunkRevision(chunk: GridCell): number {
    return (
      this.chunkRevisions.get(chunkKeyOf(chunk[0], chunk[1], chunk[2])) ?? 0
    );
  }

  /** Shared sphere-window walk behind the tuple and flat queries. */
  private forEachOccupiedCellWithin(
    centerPos: Vector3,
    radiusM: number,
    minObservations: number,
    visit: (x: number, y: number, z: number) => void
  ): void {
    if (!Number.isFinite(radiusM) || radiusM <= 0) {
      throw new RangeError(
        `radiusM must be a positive finite number, got ${radiusM}`
      );
    }
    if (!isFiniteTriple(centerPos)) {
      return;
    }
    const cs = this.cellSizeM;
    const r2 = radiusM * radiusM;
    // fp-safety margins for the CHUNK shortcuts only: skip a chunk only when
    // it is clearly beyond the sphere, and skip the per-cell test only when
    // the chunk is clearly inside — boundary chunks always get the exact
    // per-cell test, which uses the same arithmetic as the brute-force
    // reference so the results are identical.
    const skipBeyond = (radiusM + cs * 1e-9) ** 2;
    const wholeInsideR2 = (radiusM - cs * 1e-9) ** 2;
    for (const [chunkKey, cellKeys] of this.chunks) {
      // AABB of the chunk's CELL CENTERS in meters: [b·cs, (b+15)·cs] per axis.
      const bx = unpackChunkCoord(chunkKey, 0) * CHUNK_EDGE_CELLS * cs;
      const by = unpackChunkCoord(chunkKey, 1) * CHUNK_EDGE_CELLS * cs;
      const bz = unpackChunkCoord(chunkKey, 2) * CHUNK_EDGE_CELLS * cs;
      const extent = (CHUNK_EDGE_CELLS - 1) * cs;
      let dMin2 = 0;
      let dMax2 = 0;
      for (let axis = 0; axis < 3; axis++) {
        const lo = axis === 0 ? bx : axis === 1 ? by : bz;
        const hi = lo + extent;
        const v = centerPos[axis]!;
        const below = lo - v;
        const above = v - hi;
        const dMin = Math.max(below, above, 0);
        dMin2 += dMin * dMin;
        const dMax = Math.max(Math.abs(v - lo), Math.abs(hi - v));
        dMax2 += dMax * dMax;
      }
      if (dMin2 > skipBeyond) {
        continue; // clearly outside the sphere
      }
      const wholeInside = dMax2 <= wholeInsideR2;
      for (const key of cellKeys) {
        const record = this.cells.get(key);
        // Defensive: the index and the cell map are updated together, so a
        // missing record would be an internal inconsistency — skip it rather
        // than crash a render tick.
        if (!record || record.count < minObservations) {
          continue;
        }
        const x = unpackCellCoord(key, 0);
        const y = unpackCellCoord(key, 1);
        const z = unpackCellCoord(key, 2);
        if (!wholeInside) {
          const dx = x * cs - centerPos[0];
          const dy = y * cs - centerPos[1];
          const dz = z * cs - centerPos[2];
          if (dx * dx + dy * dy + dz * dz > r2) {
            continue;
          }
        }
        visit(x, y, z);
      }
    }
  }

  /** Quantize a raw-WebXR position to its grid cell (round per axis). */
  cellForPosition(pos: Vector3): GridCell {
    // `+ 0` normalizes Math.round's -0 so cell coordinates compare cleanly
    return [
      Math.round(pos[0] / this.cellSizeM) + 0,
      Math.round(pos[1] / this.cellSizeM) + 0,
      Math.round(pos[2] / this.cellSizeM) + 0,
    ];
  }

  /** Center of a cell in raw WebXR space (round-consistent: cell · cellSizeM). */
  getCellCenter(cell: GridCell): Vector3 {
    return [
      cell[0] * this.cellSizeM,
      cell[1] * this.cellSizeM,
      cell[2] * this.cellSizeM,
    ];
  }

  /**
   * Running-average of the EXACT unprojected surface points observed in this
   * cell (raw WebXR space), or null for an unknown cell. Unlike
   * {@link getCellCenter} (the geometric 15 cm-lattice center) this hugs the
   * real measured surface and noise-averages across viewpoints — used by the
   * COLMAP `points3D` export and the debug cubes (follow-up Item A). Being a
   * centroid of points that fell in the cell, it always lies within
   * `cellSizeM/2` of the cell center per axis.
   */
  getCellPoint(cell: GridCell): Vector3 | null {
    // Out-of-envelope cells alias in-range packed keys (±65 535/axis, ≈±9.83 km
    // at the default cell size) — answer null, never another cell's data.
    if (!cellInKeyRange(cell)) {
      return null;
    }
    const record = this.cells.get(cellKey(cell));
    if (!record || record.count === 0) {
      return null;
    }
    return [
      record.posSumX / record.count,
      record.posSumY / record.count,
      record.posSumZ / record.count,
    ];
  }

  /**
   * Running-average color of the cell's colored observations (Iter 8), or
   * null when the cell is unknown or was only ever observed without color
   * (rgb option off / pre-Iter-8 recordings) — consumers fall back to
   * height-based coloring. Channels are rounded and clamped to 0–255.
   */
  getCellColor(cell: GridCell): RgbTuple | null {
    // Same envelope guard as getCellPoint — aliased keys must not leak colors.
    if (!cellInKeyRange(cell)) {
      return null;
    }
    const record = this.cells.get(cellKey(cell));
    if (!record || record.colorCount === 0) {
      return null;
    }
    const average = (sum: number): number =>
      Math.min(255, Math.max(0, Math.round(sum / record.colorCount)));
    return [
      average(record.colorSumR),
      average(record.colorSumG),
      average(record.colorSumB),
    ];
  }

  /**
   * Walk the grid from `startPos` to `endPos` and return the center of the
   * first cell occupied at least `minObservations` times, or null.
   * Port of Unity's `TryRaycast` (hook for cursor/floor-detection parity).
   */
  raycast(
    startPos: Vector3,
    endPos: Vector3,
    minObservations = 1
  ): Vector3 | null {
    if (!isFiniteTriple(startPos) || !isFiniteTriple(endPos)) {
      return null;
    }
    const startCell = this.cellForPosition(startPos);
    const endCell = this.cellForPosition(endPos);
    // Envelope guard: with an out-of-range endpoint the walk's packed keys
    // alias unrelated in-range cells, so a "hit" would report bogus geometry.
    // (Between two in-range cells every bresenham cell is in range — the walk
    // stays inside their bounding box.)
    if (!cellInKeyRange(startCell) || !cellInKeyRange(endCell)) {
      return null;
    }
    let hit: GridCell | null = null;
    bresenham3d(startCell, endCell, (cell) => {
      const record = this.cells.get(cellKey(cell));
      if (record && record.count >= minObservations) {
        hit = cell;
        return false; // ray can stop at the first hit
      }
      return true;
    });
    return hit ? this.getCellCenter(hit) : null;
  }

  /** Remove all occupied cells (e.g. on store swap / new session). */
  clear(): void {
    if (this.cells.size > 0) {
      this.revision++;
    }
    this.cells.clear();
    this.chunks.clear();
    this.chunkRevisions.clear();
  }

  /**
   * Delete occupied cells along the camera→point ray (the space was seen
   * through, so it must be free), stopping `carveStopCells` dominant-axis
   * steps before the endpoint. The endpoint cell itself is additionally
   * protected so a current observation is never erased (relevant for
   * carveStopCells = 0 and for the unconditional start-cell visit).
   *
   * With `carveConfidenceThreshold` set, the trace additionally stops at the
   * first cell whose count has reached the threshold, DECAYING it by one
   * observation (means preserved) — soft contradiction instead of deletion,
   * so nothing behind an established surface is carved but repeated
   * contradictions still un-build it (see the option docs). Note this makes
   * a repeated identical carve NOT a no-op — the per-sample unique-endpoint
   * dedupe in `addSample` is therefore semantically load-bearing under the
   * guard (one decay per contradicting ray per sample).
   *
   * PERFORMANCE — fused walk (2026-07-17 perf loop, iteration 1): this is
   * the framework's hottest non-render loop (hundreds of rays per depth
   * sample at the 200 ms reconstruction cadence), and the generic
   * `bresenham3d(callback)` shape dominated the fold profile: a fresh
   * `[x, y, z]` tuple + callback dispatch + full `cellKey` repack +
   * `cellsEqual` per visited cell. The Bresenham walk (identical integer
   * stepping, `bresenham3d` stays the reference — see the fold-oracle
   * property test) is therefore fused in here with two key tricks:
   *
   * - The packed cell key is maintained INCREMENTALLY: stepping one cell
   *   along an axis moves the key by that axis' constant field stride
   *   (base-2^17 positional packing), replacing the 3-term repack.
   * - The endpoint guard compares packed keys (`key === endpointKey`).
   *   Every walked cell lies inside the camera→point AABB whose corners the
   *   caller range-checked, so packing is bijective on the whole walk and
   *   the compare is exactly `cellsEqual` — and key aliasing is impossible.
   *
   * The cell tuple is materialized only on an actual delete/decay hit (rare
   * per trace, handled in {@link carveCellAt}). Measured on the
   * occupancy-fold bench (devbox-win11, Node 24, 50 samples × 576 pts,
   * production config): 37.05 → 25.71 ms median of 5, −30.6%.
   * Input safety: cameraCell/pointCell are integer cells from
   * `cellForPosition` (finite-checked upstream) and both range-checked by
   * `addSample`, so dm ≤ 2·CELL_KEY_LIMIT « MAX_TRACE_STEPS and the generic
   * tracer's integer/span guards are structurally satisfied here.
   */
  private carve(cameraCell: GridCell, pointCell: GridCell): void {
    const threshold = this.carveConfidenceThreshold;
    const stopDistance = this.carveStopCells;
    let x = cameraCell[0];
    let y = cameraCell[1];
    let z = cameraCell[2];
    const ex = pointCell[0];
    const ey = pointCell[1];
    const ez = pointCell[2];
    const dx = Math.abs(ex - x);
    const dy = Math.abs(ey - y);
    const dz = Math.abs(ez - z);
    // Math.sign instead of the reference's `a < b ? 1 : -1`: a zero-delta
    // axis has d· = 0, so its error term never goes negative and the step is
    // never taken — sign 0 and −1 are indistinguishable there (oracle-tested).
    const sx = Math.sign(ex - x);
    const sy = Math.sign(ey - y);
    const sz = Math.sign(ez - z);
    const keyStepX = sx * CELL_KEY_STRIDE_X;
    const keyStepY = sy * CELL_KEY_STRIDE_Y;
    const keyStepZ = sz; // z is the least-significant field (stride 1)
    const endpointKey = packCellKey(ex, ey, ez);
    let key = packCellKey(x, y, z);
    const dm = Math.max(dx, dy, dz);
    let i = dm;
    let errX = Math.floor(dm / 2);
    let errY = errX;
    let errZ = errX;
    for (;;) {
      if (key !== endpointKey && !this.carveCellAt(x, y, z, key, threshold)) {
        return; // established surface — contradicted softly, trace stops
      }
      if (i-- <= stopDistance) {
        return;
      }
      errX -= dx;
      if (errX < 0) {
        errX += dm;
        x += sx;
        key += keyStepX;
      }
      errY -= dy;
      if (errY < 0) {
        errY += dm;
        y += sy;
        key += keyStepY;
      }
      errZ -= dz;
      if (errZ < 0) {
        errZ += dm;
        z += sz;
        key += keyStepZ;
      }
    }
  }

  /**
   * Per-cell action of the fused carve walk (extracted so both it and the
   * walk stay under the lint complexity budget; a monomorphic private-method
   * call per visited cell measured within noise of the fully-inlined form).
   *
   * @returns `false` when the trace must stop: the cell is an established
   *   surface (count ≥ threshold) that was decayed instead of deleted.
   */
  private carveCellAt(
    x: number,
    y: number,
    z: number,
    key: number,
    threshold: number | undefined
  ): boolean {
    const record = this.cells.get(key);
    if (record === undefined) {
      return true; // nothing to carve here, keep tracing
    }
    if (threshold !== undefined && record.count >= threshold) {
      this.decayCell([x, y, z], key, record);
      return false; // established surface — contradict softly, stop
    }
    // A carve removes a cell from the occupied set → a meaningful change
    // (the record exists, so the delete always succeeds).
    this.cells.delete(key);
    this.revision++;
    this.unindexCell([x, y, z], key);
    return true;
  }

  /**
   * Soft contradiction of an established cell (confidence-guarded carving):
   * remove one observation while preserving the measured point/color MEANS
   * (sums are scaled with the count — decrementing the divisor alone would
   * silently shift `getCellPoint`/`getCellColor`). Deletes outright when the
   * count would reach 0 (threshold 1). Bumps revisions like any mutation
   * that can change a consumer's occupied set (counts above
   * MAX_RELEVANT_COUNT cannot cross any selectable floor, so those decays
   * stay revision-silent).
   */
  private decayCell(cell: GridCell, key: number, record: CellRecord): void {
    const newCount = record.count - 1;
    if (newCount <= 0) {
      if (this.cells.delete(key)) {
        this.revision++;
        this.unindexCell(cell, key);
      }
      return;
    }
    const scale = newCount / record.count;
    record.count = newCount;
    record.posSumX *= scale;
    record.posSumY *= scale;
    record.posSumZ *= scale;
    // Keep the colorCount ≤ count invariant; scaling sums and count by the
    // same factor preserves the per-channel means exactly.
    if (record.colorCount > newCount) {
      const colorScale = newCount / record.colorCount;
      record.colorSumR *= colorScale;
      record.colorSumG *= colorScale;
      record.colorSumB *= colorScale;
      record.colorCount = newCount;
    }
    if (newCount <= MAX_RELEVANT_COUNT) {
      this.revision++;
      this.bumpChunkRevision(
        chunkKeyOf(
          Math.floor(cell[0] / CHUNK_EDGE_CELLS),
          Math.floor(cell[1] / CHUNK_EDGE_CELLS),
          Math.floor(cell[2] / CHUNK_EDGE_CELLS)
        )
      );
    }
  }

  /** Add a newly-occupied cell to its chunk's index set. */
  private indexCell(cell: GridCell, key: number): void {
    const ck = chunkKeyOf(
      Math.floor(cell[0] / CHUNK_EDGE_CELLS),
      Math.floor(cell[1] / CHUNK_EDGE_CELLS),
      Math.floor(cell[2] / CHUNK_EDGE_CELLS)
    );
    let set = this.chunks.get(ck);
    if (!set) {
      set = new Set<number>();
      this.chunks.set(ck, set);
    }
    set.add(key);
  }

  /** Remove a carved cell from its chunk (dropping an emptied chunk set). */
  private unindexCell(cell: GridCell, key: number): void {
    const ck = chunkKeyOf(
      Math.floor(cell[0] / CHUNK_EDGE_CELLS),
      Math.floor(cell[1] / CHUNK_EDGE_CELLS),
      Math.floor(cell[2] / CHUNK_EDGE_CELLS)
    );
    const set = this.chunks.get(ck);
    if (set) {
      set.delete(key);
      if (set.size === 0) {
        this.chunks.delete(ck);
      }
    }
    this.bumpChunkRevision(ck);
  }

  /** Mirror of the global revision bump, scoped to one chunk. */
  private bumpChunkRevision(chunkKey: number): void {
    this.chunkRevisions.set(
      chunkKey,
      (this.chunkRevisions.get(chunkKey) ?? 0) + 1
    );
  }

  private increment(cell: GridCell, world: Vector3, rgb?: RgbTuple): void {
    const key = cellKey(cell);
    let record = this.cells.get(key);
    if (!record) {
      record = {
        count: 0,
        posSumX: 0,
        posSumY: 0,
        posSumZ: 0,
        colorCount: 0,
        colorSumR: 0,
        colorSumG: 0,
        colorSumB: 0,
      };
      this.cells.set(key, record);
      this.indexCell(cell, key);
    }
    record.count++;
    // Bump the revision while the cell could still cross some consumer's
    // minConfidence threshold (count ≤ 10 = the max selectable). Once it is past
    // that, re-observing it can change no occupied set, so it stays "settled" and
    // costs no re-mesh — the key long-session idle saving.
    if (record.count <= MAX_RELEVANT_COUNT) {
      this.revision++;
      this.bumpChunkRevision(
        chunkKeyOf(
          Math.floor(cell[0] / CHUNK_EDGE_CELLS),
          Math.floor(cell[1] / CHUNK_EDGE_CELLS),
          Math.floor(cell[2] / CHUNK_EDGE_CELLS)
        )
      );
    }
    // Every observation carries a finite position (the unprojector guarantees
    // it), so it always feeds the running-average surface point.
    record.posSumX += world[0];
    record.posSumY += world[1];
    record.posSumZ += world[2];
    // Only finite triples enter the average — bad persisted data degrades
    // to a color-less observation instead of poisoning the cell.
    if (rgb && isFiniteTriple(rgb)) {
      record.colorCount++;
      record.colorSumR += rgb[0];
      record.colorSumG += rgb[1];
      record.colorSumB += rgb[2];
    }
  }
}

// Numeric cell key — the shared packed-key implementation (cell-key.ts, one
// packer for grid + meshers + worker since the 2026-07-04 consolidation).
// `|coord|` must be `≤ CELL_KEY_LIMIT` (±65 535 ≈ ±9.8 km at the 0.15 m
// default — far beyond any real session); `addSample` skips points whose cell
// falls outside it, so every stored key is packable and collision-free. The
// pack/unpack pair stays re-exported here (public grid API since Step 3.1 of
// the 2026-07-03 fps plan, property-tested as exact inverses).
export { cellKey, unpackCellKey } from './cell-key';

function cellInKeyRange(cell: GridCell): boolean {
  return cellCoordsInKeyRange(cell, CELL_KEY_LIMIT);
}

// --- Chunk index (Step 2 of the 2026-07-03 long-session fps plan) ---
// Chunks are CHUNK_EDGE_CELLS³ cell groups (16³ = 2.4 m at the 0.15 m default,
// per the plan's sizing note). With |cell| ≤ 65 535, chunk coordinates are
// within ±4096, so three 13-bit fields pack into one safe-integer key using
// the same scheme as `cellKey`.
const CHUNK_EDGE_CELLS = 16;
const CHUNK_KEY_OFFSET = 4096; // 2^12
const CHUNK_KEY_FIELD = 8192; // 2^13
const CHUNK_KEY_FIELD_SQ = CHUNK_KEY_FIELD * CHUNK_KEY_FIELD; // 2^26

function chunkKeyOf(cx: number, cy: number, cz: number): number {
  return (
    (cx + CHUNK_KEY_OFFSET) * CHUNK_KEY_FIELD_SQ +
    (cy + CHUNK_KEY_OFFSET) * CHUNK_KEY_FIELD +
    (cz + CHUNK_KEY_OFFSET)
  );
}

/** Inverse of {@link chunkKeyOf} for one axis (0 = x, 1 = y, 2 = z). */
function unpackChunkCoord(key: number, axis: 0 | 1 | 2): number {
  if (axis === 0) {
    return Math.floor(key / CHUNK_KEY_FIELD_SQ) - CHUNK_KEY_OFFSET;
  }
  if (axis === 1) {
    return (
      (Math.floor(key / CHUNK_KEY_FIELD) % CHUNK_KEY_FIELD) - CHUNK_KEY_OFFSET
    );
  }
  return (key % CHUNK_KEY_FIELD) - CHUNK_KEY_OFFSET;
}

function cellsEqual(a: GridCell, b: GridCell): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/** Constructor guard for {@link OccupancyGridOptions.carveConfidenceThreshold}. */
function validateCarveConfidenceThreshold(
  threshold: number | undefined
): number | undefined {
  if (
    threshold !== undefined &&
    (!Number.isSafeInteger(threshold) || threshold < 1)
  ) {
    throw new RangeError(
      `carveConfidenceThreshold must be a positive integer when set, got ${threshold}`
    );
  }
  return threshold;
}

function isFiniteTriple(v: Vector3): boolean {
  return (
    Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2])
  );
}
