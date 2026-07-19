/**
 * Occupancy Grid → Mesh (face-culled voxel surface + AABB list)
 *
 * Pure, dependency-free mesher for the sparse {@link OccupancyGrid}. Turns a
 * snapshot of occupied cells into:
 *  - a **face-culled** triangle surface (`positions` + `indices`, raw-WebXR
 *    metres) — only the faces whose neighbour cell is empty are emitted, so
 *    cost scales with the surface area of the occupied set, not its volume.
 *    This is the geometry the depth-only **occlusion** mesh and a **trimesh**
 *    physics collider consume.
 *  - an **AABB list** (one box per occupied cell) — the natural input for a
 *    **compound box collider**, the better voxel-physics fit (§3E of the plan).
 *
 * No THREE, no DOM, no Redux — the caller snapshots `getOccupiedCells(floor)`
 * and feeds the result here; a thin adapter wraps the typed arrays into a
 * `THREE.BufferGeometry` (and the output is transferable to a Web Worker).
 * Greedy quad/box merging is a separate follow-on optimisation.
 *
 * Design notes (see 2026-06-13-0004-occupancy-mesh-options-plan.md, option B):
 * - Vertices are NOT shared between faces (4 verts/face). Simpler and keeps
 *   per-face winding trivially correct; the occluder/collider don't need a
 *   welded vertex buffer. A closed voxel surface is still watertight (every
 *   edge is covered an even number of times — see the property tests).
 * - Faces use outward CCW winding so a trimesh collider has consistent normals
 *   and the surface back-face culls correctly if ever rendered visibly.
 * - Cell centre is `cell · cellSizeM` (matching {@link OccupancyGrid.getCellCenter},
 *   round-quantization — NOT a half-cell offset), so a cube for cell `c` spans
 *   `[c·s − s/2, c·s + s/2]` per axis.
 *
 * @see occupancy-mesher.ts.md for detailed documentation
 */

import type { Vector3 } from 'gps-plus-slam-js';
import type { GridCell } from './bresenham3d';
import {
  CELL_KEY_STRIDE_X,
  CELL_KEY_STRIDE_Y,
  HALF_LATTICE_CELL_KEY_LIMIT,
  packCellKey as cellKey,
} from './cell-key';
import { PackedKeyHash } from './packed-key-hash';

/**
 * An axis-aligned bounding box for one occupied cell (or, after greedy merge, a
 * run of cells), in raw-WebXR metres. The neutral form a developer adapts into
 * their physics engine's box collider — the framework adds no engine dependency.
 */
export interface Aabb {
  readonly center: readonly [number, number, number];
  readonly halfExtents: readonly [number, number, number];
}

/**
 * Output of {@link meshOccupiedCells}: a non-indexed-friendly triangle soup
 * (`positions`/`indices`, raw-WebXR metres) plus the per-cell AABB list. Typed
 * arrays so the result is cheap to hand to `THREE.BufferGeometry` or transfer
 * to a Web Worker.
 */
export interface OccupancyMeshResult {
  /** Flat `[x0,y0,z0, x1,y1,z1, …]` vertex positions, 4 verts per emitted quad. */
  readonly positions: Float32Array;
  /** Triangle indices into `positions` (2 triangles / 6 indices per quad). */
  readonly indices: Uint32Array;
  /** One AABB per unique occupied cell. */
  readonly aabbs: readonly Aabb[];
}

/**
 * Selectable mesher strategy (2026-06-30 occluder-tuning session). All modes are
 * simultaneously usable — none replaces another — so they can be perf/quality
 * compared and a consumer can pick per use-case:
 * - `'per-face'` — blocky, watertight, exact cell volume; the strict baseline.
 * - `'greedy'` — fewest triangles, blocky; coplanar-face merge for memory.
 * - `'smooth'` — standard surface nets (dual contouring): one welded vertex per
 *   boundary dual cell at the mean of its occupied corners' `getCellPoint`, with
 *   one quad per occupied↔empty crossing — so coverage matches the cubes.
 *   Continuous, hugs the measured surface, watertight for closed regions; a thin
 *   feature (the floor) collapses to a single smooth sheet (the smoothest mode),
 *   with only its single-occupied-corner dual vertices nudged apart so features
 *   thin in ≥2 dimensions keep a non-zero area (see SINGLE_CORNER_NUDGE_K).
 *   Uses `getCellPoint` to hug the surface (falls back to geometric centres).
 *
 * - `'corner-fit'` — the per-face cube mesher with each shared lattice corner
 *   nudged by the mean sub-cell offset (`getCellPoint − cellCentre`) of the cells
 *   touching it. Surface-hugging like `'smooth'` but **watertight** (identical
 *   face topology to `'per-face'`) and cube-thickness-preserving, at the per-face
 *   triangle cost. The "improve the cubes" path; needs `getCellPoint` (falls back
 *   to plain cubes without it).
 */
export type MeshMode = 'per-face' | 'greedy' | 'smooth' | 'corner-fit';

/** Options for {@link meshOccupiedCells}. */
export interface MeshOccupiedCellsOptions {
  /**
   * The mesher strategy. Default `'per-face'`. (The deprecated boolean
   * `greedy` shim was removed 2026-07-10, quality-review C-3 — it had zero
   * production callers; use `{ mode: 'greedy' }`.)
   *
   * Note: every mode still returns one `aabbs` box per cell (a 3-D greedy box
   * merge for fewer colliders is a separate follow-on — see the plan §3E).
   */
  readonly mode?: MeshMode;
  /**
   * Per-cell measured surface point (the `OccupancyGrid.getCellPoint` bound
   * method). Consumed by the surface-hugging modes `'smooth'` (dual vertex at the
   * mean of its occupied corners' centroids) and `'corner-fit'` (corners nudged
   * by the mean sub-cell offset) instead of the lattice centre. Ignored by
   * `'per-face'`/`'greedy'`. When absent, both fall back to geometric positions.
   * A `null` or non-finite result degrades that cell to its geometric position
   * too — a NaN/Infinity centroid must not poison welded vertices (and NaN is
   * the worker wire protocol's "no centroid" sentinel, so both paths agree).
   *
   * **Contract:** the `cell` tuple is only valid for the duration of the call —
   * the meshers pass a reused scratch tuple on their allocation-free hot paths
   * (PR #161 review), so implementations must read the coordinates and must NOT
   * retain the tuple (no caching it as a key, no async use). Copy it if needed.
   */
  readonly getCellPoint?: (cell: GridCell) => Vector3 | null;
  /**
   * Pre-packed per-cell centroids for `'smooth'`, aligned with the **input
   * `cells` order** (3 numbers per input cell; a non-finite triple — the
   * worker wire protocol packs NaN for "no centroid" — falls back to that
   * cell's geometric centre, exactly like a null/non-finite `getCellPoint`
   * result). This is the mesh-worker fast path (2026-07-17 perf loop,
   * iteration 2): `runMeshRequest` receives exactly this array over the wire,
   * so consuming it directly deletes the per-cell key-map + callback + tuple
   * plumbing from the hottest re-mesh loop. When set, `'smooth'` ignores
   * `getCellPoint`; other modes ignore `centroids` entirely (`'corner-fit'`
   * still needs the callback).
   */
  readonly centroids?: Float64Array | null;
  /**
   * Set `false` to skip building the per-cell AABB list (`result.aabbs` is
   * then empty). The occlusion-mesh worker path consumes only
   * positions/indices, and at the ~100k-cell regime the discarded AABB
   * objects (~2 allocations per cell, every re-mesh) were pure GC pressure
   * (2026-07-17 perf loop, iteration 2). Default `true`.
   */
  readonly includeAabbs?: boolean;
}

/** Resolve the effective mesher mode from the options. */
function resolveMode(options: MeshOccupiedCellsOptions | undefined): MeshMode {
  return options?.mode ?? 'per-face';
}

/** A coordinate-axis index into a {@link GridCell} / position triple. */
type Axis = 0 | 1 | 2;

/**
 * Right-handed cyclic axis assignment per face-normal axis `d`: `(d, u, v)`
 * with `eu × ev = ed`, so a `(uMin,vMin)→(uMax,vMin)→(uMax,vMax)→(uMin,vMax)`
 * quad has the `+d` outward normal (and the reverse order has `−d`). Used by the
 * greedy mesher to keep merged-quad winding consistent with the per-face path.
 */
const GREEDY_DIRS: readonly { d: Axis; u: Axis; v: Axis }[] = [
  { d: 0, u: 1, v: 2 },
  { d: 1, u: 2, v: 0 },
  { d: 2, u: 0, v: 1 },
];

/** Unit-cube face: a neighbour offset (cull test) + 4 outward-CCW corner signs. */
interface FaceSpec {
  /** Neighbour cell offset; the face is emitted iff that neighbour is empty. */
  readonly neighbour: readonly [number, number, number];
  /** Four corners as ±1 signs (×halfCell), already in outward-CCW order. */
  readonly corners: readonly [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
  ];
}

/**
 * The six cube faces with outward (CCW-from-outside) winding. Corner signs are
 * ±1 multipliers of the half-cell extent. Triangulated as (0,1,2)+(0,2,3).
 */
const FACES: readonly FaceSpec[] = [
  // +X
  {
    neighbour: [1, 0, 0],
    corners: [
      [1, -1, -1],
      [1, 1, -1],
      [1, 1, 1],
      [1, -1, 1],
    ],
  },
  // -X
  {
    neighbour: [-1, 0, 0],
    corners: [
      [-1, -1, -1],
      [-1, -1, 1],
      [-1, 1, 1],
      [-1, 1, -1],
    ],
  },
  // +Y
  {
    neighbour: [0, 1, 0],
    corners: [
      [-1, 1, -1],
      [-1, 1, 1],
      [1, 1, 1],
      [1, 1, -1],
    ],
  },
  // -Y
  {
    neighbour: [0, -1, 0],
    corners: [
      [-1, -1, -1],
      [1, -1, -1],
      [1, -1, 1],
      [-1, -1, 1],
    ],
  },
  // +Z
  {
    neighbour: [0, 0, 1],
    corners: [
      [-1, -1, 1],
      [1, -1, 1],
      [1, 1, 1],
      [-1, 1, 1],
    ],
  },
  // -Z
  {
    neighbour: [0, 0, -1],
    corners: [
      [-1, -1, -1],
      [-1, 1, -1],
      [1, 1, -1],
      [1, -1, -1],
    ],
  },
];

// Numeric cell key — the shared packed-key implementation (`cell-key.ts`, one
// packer for grid + meshers + worker since the 2026-07-04 consolidation),
// avoiding the per-lookup string allocation that dominated the mesher hot
// loops (millions of neighbour tests + vertex-weld lookups). The mesher uses
// the tighter HALF_LATTICE tier (±32 767): it also keys DERIVED coordinates —
// neighbours (±1), dual-cell bases (−1) and corner-fit half-lattice keys
// (`2·coord ± 1`) — which must stay inside the same 17-bit field. At 0.15 m
// cells the limit spans ±4.9 km — far beyond any real scene;
// `meshOccupiedCells` skips cells outside it (alongside the non-finite skip),
// guaranteeing every internal key is packable and collision-free.

/** Finite, integer, and within the packable key range on every axis.
 *  `Number.isInteger` subsumes the finiteness check (NaN/±Infinity are not
 *  integers) and rejects fractional coordinates, which the packed-key algebra
 *  cannot key safely (neighbour ±1 and half-lattice `2·coord ± 1` keys only
 *  coincide for integer cells). */
function isPackableCell(cell: GridCell): boolean {
  for (let i = 0; i < 3; i++) {
    const c = cell[i]!;
    if (!Number.isInteger(c) || Math.abs(c) > HALF_LATTICE_CELL_KEY_LIMIT) {
      return false;
    }
  }
  return true;
}

/** True iff all three components are finite. A non-finite measured centroid
 *  from `getCellPoint` (an upstream tracking/accumulation glitch) must degrade
 *  to the geometric fallback exactly like a `null` one — otherwise it poisons
 *  every welded vertex / shared corner that averages it, and it also breaks
 *  `runMeshRequest`'s byte-identical parity with a direct mesh (the worker wire
 *  protocol packs "no centroid" as NaN, so NaN already falls back off-thread). */
function isFiniteVector3(v: Vector3): boolean {
  return (
    Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2])
  );
}

/**
 * Mesh a snapshot of occupied cells into a face-culled surface + AABB list.
 *
 * Only faces whose neighbour cell is **not** in the occupied set are emitted
 * (interior faces are dropped), so the triangle count scales with the surface
 * area of the occupied set. Duplicate cells in `cells` are de-duplicated;
 * cells with a non-finite or non-integer coordinate are skipped defensively (a
 * tracking glitch upstream must not poison the mesh, and the packed cell keys
 * are only collision-safe for integer coordinates).
 *
 * @param cells     occupied cells (e.g. `grid.getOccupiedCells(minConfidence)`).
 * @param cellSizeM cube edge length in metres (must be a positive finite number).
 * @returns positions/indices (raw-WebXR metres) + one AABB per unique cell.
 */
export function meshOccupiedCells(
  cells: Iterable<GridCell>,
  cellSizeM: number,
  options?: MeshOccupiedCellsOptions
): OccupancyMeshResult {
  if (!Number.isFinite(cellSizeM) || cellSizeM <= 0) {
    throw new RangeError(
      `cellSizeM must be a positive number, got ${cellSizeM}`
    );
  }
  const half = cellSizeM / 2;

  const mode = resolveMode(options);
  // Input-order-aligned centroids are a smooth-only fast path (see the option
  // docs); tracking each unique cell's input index costs a parallel array, so
  // it is only recorded when actually consumed.
  const centroids = mode === 'smooth' ? (options?.centroids ?? null) : null;

  // Snapshot into a PackedKeyHash for O(1) neighbour tests (2026-07-17 perf
  // loop iteration 2 — flat typed-array table instead of a Set; the value is
  // the cell's ordinal in `uniqueCells`, which the smooth builder uses to
  // index its eagerly-resolved centroid arrays). De-duplicates and drops
  // non-integer / out-of-range cells; insertion order kept for deterministic
  // AABB / face emission.
  const occupied = new PackedKeyHash(Array.isArray(cells) ? cells.length : 64);
  const uniqueCells: GridCell[] = [];
  const inputIndices: number[] | null = centroids ? [] : null;
  let inputIndex = -1;
  for (const cell of cells) {
    inputIndex++;
    if (!isPackableCell(cell)) {
      continue;
    }
    const key = cellKey(cell[0], cell[1], cell[2]);
    if (occupied.has(key)) {
      continue;
    }
    occupied.set(key, uniqueCells.length);
    uniqueCells.push(cell);
    inputIndices?.push(inputIndex);
  }

  // Every cell's halfExtents is identical (`[half, half, half]`); share one
  // frozen instance instead of allocating it per cell (the `Aabb` contract is
  // readonly, so sharing is safe). Halves the AABB-list allocations.
  // `includeAabbs: false` (the worker path, which consumes only geometry)
  // skips the list entirely — ~2 discarded allocations per cell per re-mesh.
  const sharedHalfExtents: readonly [number, number, number] = Object.freeze([
    half,
    half,
    half,
  ]);
  const aabbs: Aabb[] =
    options?.includeAabbs === false
      ? []
      : uniqueCells.map(([x, y, z]) => ({
          center: [x * cellSizeM, y * cellSizeM, z * cellSizeM],
          halfExtents: sharedHalfExtents,
        }));

  if (mode === 'smooth') {
    // The smooth builder produces typed arrays directly (no number[]
    // intermediate — the geometry is millions of entries at the corpus
    // regime and the convert-at-the-end copy was measurable).
    const points = centroids
      ? resolveCellPointsFromCentroids(
          uniqueCells,
          inputIndices!,
          centroids,
          cellSizeM
        )
      : resolveCellPoints(uniqueCells, cellSizeM, options?.getCellPoint);
    const geometry = buildSmooth(occupied, uniqueCells, cellSizeM, points);
    return { positions: geometry.positions, indices: geometry.indices, aabbs };
  }

  const positions: number[] = [];
  const indices: number[] = [];
  if (mode === 'greedy') {
    buildGreedy(occupied, uniqueCells, cellSizeM, positions, indices);
  } else if (mode === 'corner-fit') {
    buildCornerFit(
      occupied,
      uniqueCells,
      cellSizeM,
      options?.getCellPoint,
      positions,
      indices
    );
  } else {
    buildCulled(occupied, uniqueCells, cellSizeM, positions, indices);
  }

  return {
    // `new Float32Array(arr)` is the idiomatic (and faster) construction from a
    // plain number[]; `.from` adds general-iterable + map-fn overhead for the
    // same bytes.
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    aabbs,
  };
}

/** Push a quad (4 corners, already ordered) as two triangles. */
/** Per-face culling: emit each exposed unit face as its own quad. */
function buildCulled(
  occupied: PackedKeyHash,
  uniqueCells: readonly GridCell[],
  cellSizeM: number,
  positions: number[],
  indices: number[]
): void {
  const half = cellSizeM / 2;
  for (const [x, y, z] of uniqueCells) {
    const cx = x * cellSizeM;
    const cy = y * cellSizeM;
    const cz = z * cellSizeM;
    for (const face of FACES) {
      const nx = x + face.neighbour[0];
      const ny = y + face.neighbour[1];
      const nz = z + face.neighbour[2];
      if (occupied.has(cellKey(nx, ny, nz))) {
        continue; // shared interior face — cull it
      }
      // Push the 4 corners directly (no per-face `.map()` array + sub-array
      // allocations — this is the per-cell hot path).
      const base = positions.length / 3;
      const corners = face.corners;
      for (let i = 0; i < 4; i++) {
        const c = corners[i]!;
        positions.push(cx + c[0] * half, cy + c[1] * half, cz + c[2] * half);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
}

/**
 * 'smooth' mode — **standard Naive Surface Nets (dual contouring)** over the
 * occupancy field, consuming the per-cell measured centroids the cube meshers
 * discard.
 *
 * Treats occupancy as a binary field sampled at integer cell coordinates and
 * contours the occupied/empty boundary:
 *  - **Vertices** — one welded vertex per "dual cell" (a unit cube whose 8
 *    corners are the cells `b … b+1`) that **straddles** the boundary (≥1
 *    occupied AND ≥1 empty corner), placed at the **mean of its occupied
 *    corners' `getCellPoint()`** (the measured surface points; the corners'
 *    geometric centres without a provider). Welding by dual-cell key makes the
 *    surface crack-free.
 *  - **Quads** — one per occupied↔empty **crossing**: for every occupied-cell
 *    face whose neighbour is empty (the SAME set the cube mesher emits), a quad
 *    joins the 4 dual cells sharing that edge, wound to face the empty side.
 *
 * Because there is one quad per crossing, **coverage matches the cubes** — unlike
 * the previous 2×2-fully-occupied-patch heuristic, which only meshed flat solid
 * blocks and so missed 80–90 % of a real, ragged depth surface (the reported
 * "barely any surfaces" bug; 2026-06-30 rewrite). The result is smooth (welded
 * vertices pulled onto the measured surface) and watertight for closed regions;
 * over a thin feature (a one-cell floor) the top and bottom dual vertices average
 * the same cells and coincide, so it reads as a single smooth sheet — the
 * smoothest of the modes. Exception: a dual cell with exactly ONE occupied
 * corner is nudged toward its dual-cell centre ({@link SINGLE_CORNER_NUDGE_K}),
 * so features thin in ≥2 dimensions (isolated voxels, line/pillar ends) keep a
 * non-zero area instead of collapsing onto a single point; on a thin floor this
 * puffs only the perimeter-corner vertices by ±0.25·cell.
 */
/**
 * 'smooth' single-occupied-corner fallback strength: a dual cell with exactly
 * one occupied corner places its vertex ON that corner's cell point, so every
 * dual cell around a feature thin in ≥2 dimensions (an isolated voxel, the end
 * of a 1-cell line/pillar) coincided with its neighbours → all-degenerate
 * (zero-area) triangles → thin features were invisible to the occluder despite
 * a full per-face triangle count. Nudging the `n === 1` vertex toward the
 * dual-cell centre by this fraction of the corner→centre distance (0.5 ⇒
 * ±0.25·cell per axis) keeps it a pure function of the dual cell, so welding /
 * watertightness and the measured-offset invariant are preserved. Trade-off
 * (accepted 2026-07-02): the `n === 1` perimeter corners of a thin floor (and
 * of a solid box) puff by ±0.25·cell — imperceptible for AR occlusion. Known
 * residual: the `n === 2` shaft rings of a long 1×1×N feature still collapse
 * (locally indistinguishable from a thin floor's intentionally-flat edges).
 * 0.25 was rejected as too close to imperceptibly-non-zero; 1.0 discards the
 * measured centroid exactly where data is sparsest. See
 * 2026-07-01-1455-smooth-mesher-single-corner-degeneracy-followup.md.
 */
const SINGLE_CORNER_NUDGE_K = 0.5;

/**
 * Resolve every unique cell's surface point (measured centroid via
 * `getCellPoint`, or the geometric centre when the provider is absent /
 * returns null / returns a non-finite triple) EAGERLY into ordinal-aligned
 * typed arrays — `buildSmooth`'s dual-vertex loop then reads points by the
 * ordinal stored in the occupied hash, with no per-key memo Map. The lazy
 * memo this replaces resolved the same points for every surface cell anyway
 * (interior cells of a solid are the only extra work, and reconstruction
 * grids are shells).
 */
function resolveCellPoints(
  uniqueCells: readonly GridCell[],
  cellSizeM: number,
  getCellPoint: ((cell: GridCell) => Vector3 | null) | undefined
): { px: Float64Array; py: Float64Array; pz: Float64Array } {
  const n = uniqueCells.length;
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  const pz = new Float64Array(n);
  const scratch: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const cell = uniqueCells[i]!;
    const x = cell[0];
    const y = cell[1];
    const z = cell[2];
    let wx = x * cellSizeM;
    let wy = y * cellSizeM;
    let wz = z * cellSizeM;
    if (getCellPoint) {
      scratch[0] = x;
      scratch[1] = y;
      scratch[2] = z;
      const cp = getCellPoint(scratch);
      if (cp && isFiniteVector3(cp)) {
        wx = cp[0];
        wy = cp[1];
        wz = cp[2];
      }
    }
    px[i] = wx;
    py[i] = wy;
    pz[i] = wz;
  }
  return { px, py, pz };
}

/**
 * The `centroids`-array twin of {@link resolveCellPoints} (the mesh-worker
 * fast path): centroids arrive input-order-aligned over the wire, so each
 * unique cell's point is `centroids[inputIndices[i]·3 …]` when that triple is
 * finite, else the geometric centre — the exact fallback rule of the callback
 * path (NaN is the wire's "no centroid" sentinel; a non-finite value from a
 * poisoned provider must also degrade, never propagate).
 */
function resolveCellPointsFromCentroids(
  uniqueCells: readonly GridCell[],
  inputIndices: readonly number[],
  centroids: Float64Array,
  cellSizeM: number
): { px: Float64Array; py: Float64Array; pz: Float64Array } {
  const n = uniqueCells.length;
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  const pz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const j = inputIndices[i]! * 3;
    const cx = centroids[j]!;
    const cy = centroids[j + 1]!;
    const cz = centroids[j + 2]!;
    if (Number.isFinite(cx) && Number.isFinite(cy) && Number.isFinite(cz)) {
      px[i] = cx;
      py[i] = cy;
      pz[i] = cz;
    } else {
      const cell = uniqueCells[i]!;
      px[i] = cell[0] * cellSizeM;
      py[i] = cell[1] * cellSizeM;
      pz[i] = cell[2] * cellSizeM;
    }
  }
  return { px, py, pz };
}

/** Ordinal-aligned resolved surface points (see {@link resolveCellPoints}). */
interface CellPoints {
  readonly px: Float64Array;
  readonly py: Float64Array;
  readonly pz: Float64Array;
}

/** Growth step for the smooth builder's typed output buffers. */
function grownCopy<T extends Float32Array | Uint32Array>(
  buffer: T,
  Ctor: new (length: number) => T
): T {
  const grown = new Ctor(buffer.length * 2);
  grown.set(buffer);
  return grown;
}

function buildSmooth(
  occupied: PackedKeyHash,
  uniqueCells: readonly GridCell[],
  cellSizeM: number,
  points: CellPoints
): { positions: Float32Array; indices: Uint32Array } {
  // PERFORMANCE (2026-07-17 perf loop, iteration 2): this builder runs on
  // every occluder re-mesh at the 200 ms reconstruction cadence and profiled
  // ~65% inside Map/Set operations. It therefore works entirely on the flat
  // `occupied` PackedKeyHash (whose value is the cell's ORDINAL in
  // `uniqueCells`) plus the ordinal-aligned resolved points, derives every
  // neighbour/dual/corner key INCREMENTALLY from the per-axis key strides —
  // no per-lookup repacking, no per-cell tuples — and writes its geometry
  // into growable typed arrays (no number[] intermediate + convert-at-end
  // copy over millions of entries). Output is byte-identical to the previous
  // Map/Set implementation (pinned by the frozen-oracle property test);
  // measured −69% on the production re-mesh path (runMeshRequest) at 100k
  // cells (devbox-win11, numbers in the sidecar).
  const n = uniqueCells.length;
  const { px, py, pz } = points;
  let positions = new Float32Array(4096 * 3);
  let posLen = 0;
  let indices = new Uint32Array(8192 * 3);
  let idxLen = 0;

  // One welded vertex per boundary dual cell (key = its min-corner cell `b`),
  // created lazily and positioned at the mean of its OCCUPIED corner cells'
  // measured surface points. The 8 corner keys are `dkey + dx·Sx + dy·Sy + dz`.
  const vertexIndex = new PackedKeyHash(n * 2);
  const nudge = cellSizeM * SINGLE_CORNER_NUDGE_K;
  const dualVertex = (dkey: number): number => {
    const existing = vertexIndex.get(dkey);
    if (existing !== -1) {
      return existing;
    }
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let count = 0;
    // Local offset of the (last seen) occupied corner within the dual cell —
    // only consumed when count === 1, where it identifies THE single corner.
    let odx = 0;
    let ody = 0;
    let odz = 0;
    for (let dx = 0; dx <= 1; dx++) {
      for (let dy = 0; dy <= 1; dy++) {
        for (let dz = 0; dz <= 1; dz++) {
          const ord = occupied.get(
            dkey + dx * CELL_KEY_STRIDE_X + dy * CELL_KEY_STRIDE_Y + dz
          );
          if (ord === -1) {
            continue;
          }
          sx += px[ord]!;
          sy += py[ord]!;
          sz += pz[ord]!;
          count += 1;
          odx = dx;
          ody = dy;
          odz = dz;
        }
      }
    }
    // count ≥ 1: a dual vertex is only requested for a boundary dual cell, which
    // by construction has at least one occupied corner (the crossing's solid side).
    let vx = sx / count;
    let vy = sy / count;
    let vz = sz / count;
    if (count === 1) {
      // Single-corner fallback: pull the vertex off the lone cell point toward
      // the dual-cell centre so neighbouring dual vertices no longer coincide
      // (see SINGLE_CORNER_NUDGE_K above for the full rationale/trade-off).
      vx += (0.5 - odx) * nudge;
      vy += (0.5 - ody) * nudge;
      vz += (0.5 - odz) * nudge;
    }
    if (posLen + 3 > positions.length) {
      positions = grownCopy(positions, Float32Array);
    }
    const idx = posLen / 3;
    positions[posLen] = vx;
    positions[posLen + 1] = vy;
    positions[posLen + 2] = vz;
    posLen += 3;
    vertexIndex.set(dkey, idx);
    return idx;
  };

  // One quad per occupied↔empty crossing (== the cube mesher's exposed faces).
  // For an occupied cell C with an empty neighbour along d·sgn, the four dual
  // cells sharing the (C, neighbour) edge have `base_d = (sgn>0 ? C_d : C_d−1)`
  // and `base_{u,v} ∈ {C−1, C}` — all derived from C's key via the axis
  // strides: neighbour = cKey ± S[d]; dual cell A = cKey (− S[d] for the −sgn
  // face) − S[u] − S[v]; B/C/D add S[u]/S[v] back. Winding faces the empty side.
  const STRIDES: readonly [number, number, number] = [
    CELL_KEY_STRIDE_X,
    CELL_KEY_STRIDE_Y,
    1,
  ];
  for (const cell of uniqueCells) {
    const cKey = cellKey(cell[0], cell[1], cell[2]);
    for (const { d, u, v } of GREEDY_DIRS) {
      const sd = STRIDES[d];
      const su = STRIDES[u];
      const sv = STRIDES[v];
      for (let sgn = 1; sgn >= -1; sgn -= 2) {
        // crossing iff the neighbour along d·sgn is empty
        if (occupied.has(cKey + sgn * sd)) {
          continue; // interior face — no crossing here
        }
        // The four dual cells sharing this edge, at (u,v) base offsets A(0,0)
        // B(1,0) C(1,1) D(0,1).
        const keyA = (sgn > 0 ? cKey : cKey - sd) - su - sv;
        const iA = dualVertex(keyA);
        const iB = dualVertex(keyA + su);
        const iC = dualVertex(keyA + su + sv);
        const iD = dualVertex(keyA + sv);
        if (idxLen + 6 > indices.length) {
          indices = grownCopy(indices, Uint32Array);
        }
        // +d faces CCW as A→B→C→D; −d reverses to A→D→C→B.
        indices[idxLen] = iA;
        indices[idxLen + 3] = iA;
        indices[idxLen + 4] = iC;
        if (sgn > 0) {
          indices[idxLen + 1] = iB;
          indices[idxLen + 2] = iC;
          indices[idxLen + 5] = iD;
        } else {
          indices[idxLen + 1] = iD;
          indices[idxLen + 2] = iC;
          indices[idxLen + 5] = iB;
        }
        idxLen += 6;
      }
    }
  }
  return {
    positions: positions.slice(0, posLen),
    indices: indices.slice(0, idxLen),
  };
}

/**
 * 'corner-fit' mode — the per-face cube mesher with **displaced shared corners**.
 *
 * Keeps {@link buildCulled}'s exact face topology (same exposed faces), but each
 * lattice corner — identified by its integer half-lattice key `(2x±1, 2y±1,
 * 2z±1)` so every cell sharing it produces the SAME key — is **nudged by the mean
 * sub-cell offset** (`getCellPoint() − cellCentre`) of the occupied cells
 * touching it. Vertices are welded by corner key, so adjacent faces reference the
 * identical displaced position: seams stay coincident ⇒ the surface deforms to
 * hug the measured points yet stays **watertight** (the even-edge-cover invariant
 * `'smooth'` gives up). Without a `getCellPoint` provider every corner falls back
 * to the geometric corner `key · cellSize/2`, i.e. plain cubes.
 *
 * Why the **offset**, not the absolute centroid mean (2026-06-30 fix): moving a
 * corner onto the absolute mean collapsed thin features — a one-cell-thick floor's
 * top and bottom corners average the SAME cells, so they coincided into a flat
 * sheet visually indistinguishable from `'smooth'`. Adding the offset to each
 * corner's OWN geometric position keeps the cube's thickness, so `'corner-fit'`
 * stays a distinct, cube-like, watertight option.
 *
 * Tradeoffs vs `'smooth'`: watertight and exact-cube topology, but corners are
 * 8-way averages (so geometry only *approaches* the measured points, never lands
 * on them) and the per-face O(surface-area) triangle cost is unchanged. Greedy
 * merging does not apply (displaced corners are non-coplanar).
 */
function buildCornerFit(
  occupied: PackedKeyHash,
  uniqueCells: readonly GridCell[],
  cellSizeM: number,
  getCellPoint: ((cell: GridCell) => Vector3 | null) | undefined,
  positions: number[],
  indices: number[]
): void {
  const half = cellSizeM / 2;
  // Pass 1: accumulate the mean **sub-cell offset** (getCellPoint − cellCentre)
  // per shared corner (half-lattice key). Displacing by the offset — NOT onto the
  // absolute centroid — is what keeps a thin (one-cell) feature from collapsing:
  // a 1-cell floor's top and bottom corners average the same cells, so the
  // absolute-centroid mean made them coincide (a flat sheet indistinguishable
  // from surface nets). Adding the offset to each corner's own geometric position
  // preserves the cube's thickness while still hugging the measured surface.
  const cornerSum = new Map<
    number,
    { x: number; y: number; z: number; n: number }
  >();
  const addCornerOffset = (
    key: number,
    ox: number,
    oy: number,
    oz: number
  ): void => {
    let acc = cornerSum.get(key);
    if (!acc) {
      acc = { x: 0, y: 0, z: 0, n: 0 };
      cornerSum.set(key, acc);
    }
    acc.x += ox;
    acc.y += oy;
    acc.z += oz;
    acc.n += 1;
  };
  for (const cell of uniqueCells) {
    const cp = getCellPoint ? getCellPoint(cell) : null;
    if (!cp || !isFiniteVector3(cp)) {
      continue;
    }
    // Offset of the measured centroid from this cell's geometric centre.
    const ox = cp[0] - cell[0] * cellSizeM;
    const oy = cp[1] - cell[1] * cellSizeM;
    const oz = cp[2] - cell[2] * cellSizeM;
    // Numeric sign loops (−1, +1): allocation-free per cell, unlike iterating
    // fresh `[-1, 1]` array literals (7 arrays per contributing cell).
    for (let sx = -1; sx <= 1; sx += 2) {
      for (let sy = -1; sy <= 1; sy += 2) {
        for (let sz = -1; sz <= 1; sz += 2) {
          addCornerOffset(
            cellKey(2 * cell[0] + sx, 2 * cell[1] + sy, 2 * cell[2] + sz),
            ox,
            oy,
            oz
          );
        }
      }
    }
  }

  // Welded vertex per corner key (lazy) — geometric corner + mean offset, or the
  // bare geometric corner when no cell contributed an offset (plain cubes).
  const vertexIndex = new Map<number, number>();
  const cornerVertex = (kx: number, ky: number, kz: number): number => {
    const key = cellKey(kx, ky, kz);
    const existing = vertexIndex.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const acc = cornerSum.get(key);
    // geometric corner = key · half; nudge it by the mean sub-cell offset.
    const px = kx * half + (acc ? acc.x / acc.n : 0);
    const py = ky * half + (acc ? acc.y / acc.n : 0);
    const pz = kz * half + (acc ? acc.z / acc.n : 0);
    const idx = positions.length / 3;
    positions.push(px, py, pz);
    vertexIndex.set(key, idx);
    return idx;
  };

  // Pass 2: identical culling to buildCulled; emit each exposed face as a
  // welded quad over its four (displaced) corner vertices.
  for (const [x, y, z] of uniqueCells) {
    for (const face of FACES) {
      const nx = x + face.neighbour[0];
      const ny = y + face.neighbour[1];
      const nz = z + face.neighbour[2];
      if (occupied.has(cellKey(nx, ny, nz))) {
        continue; // shared interior face — cull it
      }
      // Look up the 4 (displaced) corner vertices directly — no per-face `.map()`
      // allocation. Standard quad winding: triangles (0,1,2)+(0,2,3).
      const corners = face.corners;
      const x2 = 2 * x;
      const y2 = 2 * y;
      const z2 = 2 * z;
      const c0 = corners[0];
      const c1 = corners[1];
      const c2 = corners[2];
      const c3 = corners[3];
      const v0 = cornerVertex(x2 + c0[0], y2 + c0[1], z2 + c0[2]);
      const v1 = cornerVertex(x2 + c1[0], y2 + c1[1], z2 + c1[2]);
      const v2 = cornerVertex(x2 + c2[0], y2 + c2[1], z2 + c2[2]);
      const v3 = cornerVertex(x2 + c3[0], y2 + c3[1], z2 + c3[2]);
      indices.push(v0, v1, v2, v0, v2, v3);
    }
  }
}

/**
 * Greedy meshing: for each face-normal axis and side, sweep slices and merge
 * adjacent coplanar exposed faces into maximal rectangles, emitting one quad
 * per rectangle. The covered unit faces are identical to {@link buildCulled};
 * only the triangle count drops.
 */
function buildGreedy(
  occupied: PackedKeyHash,
  uniqueCells: readonly GridCell[],
  cellSizeM: number,
  positions: number[],
  indices: number[]
): void {
  const half = cellSizeM / 2;
  // Reused neighbour scratch — written and read immediately per cell, so the
  // exposure probe allocates nothing (6 probes per cell across axes × signs).
  const neighbour: [number, number, number] = [0, 0, 0];
  for (const { d, u, v } of GREEDY_DIRS) {
    for (let sign = 1; sign >= -1; sign -= 2) {
      // Group exposed (iu,iv) cells by slice index k = cell[d].
      const slices = new Map<number, Map<number, readonly [number, number]>>();
      for (const cell of uniqueCells) {
        neighbour[0] = cell[0];
        neighbour[1] = cell[1];
        neighbour[2] = cell[2];
        neighbour[d] += sign;
        if (occupied.has(cellKey(neighbour[0], neighbour[1], neighbour[2]))) {
          continue; // interior face on this side
        }
        const k = cell[d];
        const iu = cell[u];
        const iv = cell[v];
        let slice = slices.get(k);
        if (!slice) {
          slice = new Map();
          slices.set(k, slice);
        }
        slice.set(cellKey(iu, iv, 0), [iu, iv]);
      }
      for (const [k, slice] of [...slices.entries()].sort(
        (a, b) => a[0] - b[0]
      )) {
        greedyMergeSlice(
          slice,
          half,
          cellSizeM,
          d,
          u,
          v,
          k,
          sign,
          positions,
          indices
        );
      }
    }
  }
}

/** Greedy-merge one slice's exposed (iu,iv) mask into maximal rectangles. */
function greedyMergeSlice(
  slice: ReadonlyMap<number, readonly [number, number]>,
  half: number,
  cellSizeM: number,
  d: Axis,
  u: Axis,
  v: Axis,
  k: number,
  sign: number,
  positions: number[],
  indices: number[]
): void {
  const has = (iu: number, iv: number): boolean =>
    slice.has(cellKey(iu, iv, 0));
  const used = new Set<number>();
  const isUsed = (iu: number, iv: number): boolean =>
    used.has(cellKey(iu, iv, 0));
  // Reused corner scratch (axis-indexable) — the quad emission below mutates
  // only its u/v components between pushes, so rectangles allocate nothing.
  const p: [number, number, number] = [0, 0, 0];
  // Deterministic order: by iv (outer) then iu (inner), both ascending.
  const cells = [...slice.values()].sort((a, b) =>
    a[1] !== b[1] ? a[1] - b[1] : a[0] - b[0]
  );
  for (const [iu, iv] of cells) {
    if (isUsed(iu, iv)) {
      continue;
    }
    // Grow width along +u while cells exist and are unused.
    let w = 1;
    while (has(iu + w, iv) && !isUsed(iu + w, iv)) {
      w++;
    }
    // Grow height along +v while every cell of the next row is present/unused.
    let h = 1;
    let canGrow = true;
    while (canGrow) {
      for (let du = 0; du < w; du++) {
        if (has(iu + du, iv + h) && !isUsed(iu + du, iv + h)) {
          continue;
        }
        canGrow = false;
        break;
      }
      if (canGrow) {
        h++;
      }
    }
    for (let dv = 0; dv < h; dv++) {
      for (let du = 0; du < w; du++) {
        used.add(cellKey(iu + du, iv + dv, 0));
      }
    }
    const plane = k * cellSizeM + sign * half;
    const uMin = iu * cellSizeM - half;
    const uMax = (iu + w - 1) * cellSizeM + half;
    const vMin = iv * cellSizeM - half;
    const vMax = (iv + h - 1) * cellSizeM + half;
    // Emit the quad's 4 corners directly via the scratch (winding as before:
    // +d side CCW (uMin,vMin)→(uMax,vMin)→(uMax,vMax)→(uMin,vMax); −d reversed),
    // then the two triangles (0,1,2)+(0,2,3) over them.
    const base = positions.length / 3;
    p[d] = plane;
    p[u] = uMin;
    p[v] = vMin;
    positions.push(p[0], p[1], p[2]);
    if (sign > 0) {
      p[u] = uMax;
      positions.push(p[0], p[1], p[2]);
      p[v] = vMax;
      positions.push(p[0], p[1], p[2]);
      p[u] = uMin;
      positions.push(p[0], p[1], p[2]);
    } else {
      p[v] = vMax;
      positions.push(p[0], p[1], p[2]);
      p[u] = uMax;
      positions.push(p[0], p[1], p[2]);
      p[v] = vMin;
      positions.push(p[0], p[1], p[2]);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}
