# occupancy-mesher.ts

## Purpose

Pure, dependency-free mesher that turns a snapshot of {@link OccupancyGrid}
occupied cells into a **face-culled voxel surface** (`positions` + `indices`,
raw-WebXR metres) plus a per-cell **AABB list**. The surface feeds the
persistent depth-only **occlusion** mesh and a **trimesh** physics collider; the
AABB list feeds a **compound box collider** (the better voxel-physics fit). See
`GpsPlusSlamJs_Docs/docs/2026-06-13-0004-occupancy-mesh-options-plan.md` (option B,
§3E, §8).

## Public API

- `meshOccupiedCells(cells: Iterable<GridCell>, cellSizeM: number, options?: MeshOccupiedCellsOptions): OccupancyMeshResult`
  - **Inputs:** `cells` — occupied cells, typically `grid.getOccupiedCells(occupancy.minConfidence)`; `cellSizeM` — cube edge length in metres; `options.mode` — the mesher strategy (see below); `options.getCellPoint` — per-cell measured centroid provider consumed by the surface-hugging modes `'smooth'` and `'corner-fit'`.
  - **Output:** `{ positions: Float32Array, indices: Uint32Array, aabbs: Aabb[] }`.
    - `positions`/`indices`: a triangle soup in raw-WebXR metres. Cube modes (`per-face`/`greedy`) emit 4 vertices per quad, **not** shared. `smooth` **welds** one vertex per surface cell (shared across quads).
    - `aabbs`: one `{ center, halfExtents }` per **unique** occupied cell (`center = cell · cellSizeM`, `halfExtents = cellSizeM/2`). The AABB list is **mode-independent**; `includeAabbs: false` skips building it (`aabbs` is then `[]`).
  - **Error modes:** throws `RangeError` if `cellSizeM` is non-finite or ≤ 0. Duplicate cells are de-duplicated; cells with a non-finite or non-integer coordinate are skipped defensively (the packed cell keys are only collision-safe for integer coordinates).
- `Aabb` — `{ center: [x,y,z], halfExtents: [hx,hy,hz] }`, raw-WebXR metres.
- `OccupancyMeshResult` — the typed-array bundle above (transferable to a Web Worker).
- `MeshMode` — `'per-face' | 'greedy' | 'smooth' | 'corner-fit'`.
- `MeshOccupiedCellsOptions` — `{ mode?: MeshMode; getCellPoint?; centroids?; includeAabbs? }`. Default mode `'per-face'`. (The deprecated `greedy` boolean shim was removed 2026-07-10, quality-review C-3 — use `{ mode: 'greedy' }`.) All modes stay simultaneously usable — none replaces another.
  - `centroids` (2026-07-17 perf loop, iteration 2) — pre-packed per-cell centroids for `'smooth'`, **aligned with the input `cells` order** (3 numbers per input cell, non-finite triple = "use the geometric centre"; NaN is the worker wire protocol's "no centroid" sentinel). This is the mesh-worker fast path: `runMeshRequest` receives exactly this array, so consuming it directly deletes the per-cell key-map + callback + tuple plumbing. When set, `'smooth'` ignores `getCellPoint`; other modes ignore `centroids` (`'corner-fit'` keeps the callback).
  - `includeAabbs` (default `true`) — `false` skips AABB construction; the worker path consumes only geometry, and the discarded list was ~2 allocations per cell per re-mesh.

## Modes

- **`'per-face'`** (default) — blocky, watertight, exact cell volume; the strict baseline. See "Invariants" below.
- **`'greedy'`** — fewest triangles, blocky; coplanar-face merge for memory. See "Greedy merge".
- **`'smooth'`** (standard **Naive Surface Nets / dual contouring**, rewritten 2026-06-30) — contours the occupied/empty boundary:
  - **Vertices:** one **welded** vertex per _boundary dual cell_ (a unit cube of 8 cells `b … b+1` that straddles the boundary), placed at the **mean of its occupied corners' `getCellPoint()`** (the measured surface points; geometric centres without a provider).
  - **Quads:** one per occupied↔empty **crossing** — the SAME set of boundary faces the cube mesher emits — so **coverage matches the cubes**.
  - **Why the rewrite:** the original version only meshed flat, fully-occupied, uniformly-exposed coplanar 2×2 patches, so on a real ragged depth surface it covered only **10–18 %** of the boundary ("barely any surfaces", reported on a recording) and missed 1-cell-wide features entirely. Dual contouring fixes coverage.
  - **Watertight** for closed (thick) regions (even-edge-cover holds, like the cubes). Over a **thin feature** (a one-cell floor) the top and bottom dual vertices average the same cells and **coincide**, so it reads as a single smooth sheet — the smoothest of the modes (and what visually distinguishes it from `'corner-fit'`, which keeps the cube's thickness).
  - **Single-corner nudge (`SINGLE_CORNER_NUDGE_K = 0.5`, 2026-07-02):** a dual cell with exactly ONE occupied corner is nudged from that corner's cell point toward the dual-cell centre (±0.25·cell per axis). Without it, features thin in **≥2 dimensions** (isolated voxels, the ends of a 1-cell line/pillar) collapsed onto a single point — full triangle count but **zero area**, invisible to the occluder. The nudge is a pure function of the dual cell, so welding, watertightness and the measured-offset invariant are unaffected. On a thin floor only the perimeter-corner vertices puff (±0.25·cell); the interior sheet stays exactly flat. **Known residual:** the `n === 2` shaft rings of a long 1×1×N feature still collapse (a shaft ring is locally indistinguishable from a flat floor edge); see `GpsPlusSlamJs_Docs/docs/2026-07-01-1455-smooth-mesher-single-corner-degeneracy-followup.md`.
  - **Triangle count ≈ cubes** (one quad per crossing), but **welded** (one shared vertex per dual cell ⇒ a much smaller vertex buffer). Hugs the measured surface; vertices sit within ~`cellSize` of the boundary.
- **`'corner-fit'`** (F2b 2026-06-30) — the per-face cube mesher with each shared lattice corner **nudged by the mean sub-cell offset** (`getCellPoint() − cellCentre`) of the occupied cells touching it (corner identified by its `(2x±1, 2y±1, 2z±1)` half-lattice key; vertices welded by that key). Surface-hugging like `'smooth'` but **watertight** — identical face topology to `'per-face'`, so the even-edge-cover invariant is preserved (`'smooth'` is exempt from it). **Displacing by the offset (not onto the absolute centroid) is deliberate (2026-06-30 fix):** moving a corner onto the centroid mean collapses a one-cell-thick floor (its top + bottom corners average the same cells → coincide → a flat sheet indistinguishable from `'smooth'`); the offset keeps the cube's thickness so `'corner-fit'` stays a distinct cube-like option. Tradeoffs: corners are 8-way averages, so geometry only _approaches_ the measured points; per-face O(surface-area) triangle cost; greedy merging does not apply (displaced corners are non-coplanar). Falls back to plain cubes without a `getCellPoint` provider.
  - **Net positioning of the four modes:** `'per-face'` (blocky, watertight, exact volume — the baseline) · `'greedy'` (fewest triangles, blocky) · `'corner-fit'` (surface-hugging **and** watertight, keeps cube thickness, per-face cost) · `'smooth'` (full coverage like the cubes but the smoothest — welded dual vertices on the measured surface; thin features collapse to a single sheet).

## Greedy merge (`{ mode: 'greedy' }`)

Minecraft-style greedy meshing: per face-normal axis + side, each slice's
exposed-face mask is merged into maximal rectangles (row-major, deterministic),
emitting one quad per rectangle. Cuts the triangle count substantially on flat
runs (e.g. a 5×5×1 slab: 70 quads → 6). The merged surface covers the **exact
same set of unit faces** as the default per-face output — proven by the
differential property test — so the occluded volume is identical; only the
triangulation is coarser.

- **AABBs unchanged:** greedy merges the render/occluder geometry only. A 3-D
  greedy **box** merge for fewer colliders (plan §3E) is a separate follow-on;
  the AABB list stays one box per cell.
- **T-junctions:** greedy quads of differing extents can meet at T-junctions
  (a long edge against two shorter ones), so the greedy surface is **not**
  edge-2-manifold and the per-face "even edge cover" watertight test does not
  apply to it. For a depth-only occluder this is harmless (coverage is identical
  and watertight in the area sense); a consumer that needs a welded, crack-free
  manifold (some trimesh colliders) should use the **default per-face** output
  or weld + T-junction-split downstream.

## Invariants & assumptions

- **Face culling:** a face is emitted **iff** its neighbour cell (±1 on one axis) is empty. Interior faces are dropped → triangle count scales with surface area, not volume.
- **Geometry:** cube for cell `c` spans `[c·s − s/2, c·s + s/2]` per axis, matching `OccupancyGrid.getCellCenter` (round-quantization, no half-cell offset). Faces use outward CCW winding.
- **Watertight:** for a closed voxel region the surface has no boundary — every edge is covered an **even** number of times (2 for manifold edges, 4 along the non-manifold edges that diagonal-touching voxels create). It is **not** guaranteed edge-2-manifold (diagonal contact is legal voxel data).
- **Deterministic:** output for a given input is stable; face/AABB counts are permutation-invariant in the input order.
- **Raw-WebXR space:** positions are in the same frame as the grid cells. The consumer parents the mesh under `arWorldGroup` (carrying `WEBXR_TO_NUE`) so it rides the alignment matrix, exactly like the cubes visualizer.
- **Snapshot, don't mesh the live grid:** the caller passes an immutable array snapshot; the mesher never holds a reference to the mutating grid.
- **Non-finite `getCellPoint` results are rejected** (PR #152 review): a NaN/±Infinity component in a measured centroid degrades that cell to its geometric position exactly like a `null` result — in `'smooth'` (welded dual vertices average centroids) and `'corner-fit'` (shared corners accumulate sub-cell offsets) a single poisoned centroid would otherwise spread NaN into every touching vertex. This also keeps `runMeshRequest`'s byte-identical parity with a direct mesh: the worker wire protocol packs "no centroid" as NaN, so the off-thread path already degrades such a centroid to the fallback.
- **`getCellPoint` receives a transient tuple** (PR #161 review): on the allocation-free hot paths the meshers pass a **reused scratch tuple** as the `cell` argument, so a provider must read the coordinates during the call and never retain the tuple (no caching it as a key, no async use) — copy it if needed. All in-repo providers (`OccupancyGrid.getCellPoint`, the worker's centroid-array lookup) only read the coordinates.
- **Cell coordinates must be within ±32 767** (≈ ±4.9 km at the 0.15 m default). Internally the mesher packs `(x,y,z)` into one **numeric** key (avoiding per-lookup string allocation in the hot loops); 17-bit fields keep the packed key — and the derived neighbour / dual-cell / `2·coord±1` corner keys — under 2^53. Cells outside the range are skipped (alongside non-finite cells). The builders' inner loops are allocation-free by design (2026-07-04 sweep): cube faces / greedy quads / dual-contouring corners push positions through reused axis-indexable scratch tuples, sign iteration uses numeric loops (no `[-1, 1]` literals), and surface nets memoizes `getCellPoint` per cell. Perf: ~34–50 % faster than the string-keyed version on a 25 k-cell grid (see `occupancy-mesher.bench.test.ts`, opt-in `BENCH=1`).
- **`'smooth'` fast path (2026-07-17 perf loop, iteration 2):** the occupied set is a flat open-addressed [`PackedKeyHash`](packed-key-hash.ts.md) whose value is each cell's ordinal in `uniqueCells` (all four builders test membership on it); the smooth builder resolves surface points EAGERLY into ordinal-aligned `Float64Array`s (from the `centroids` array or the `getCellPoint` callback), derives every neighbour/dual/corner key **incrementally** from the `cell-key.ts` per-axis strides instead of repacking, and writes geometry into growable typed arrays (no `number[]` intermediate + convert-at-end copy). Output is **byte-identical** to the pre-rewrite Map/Set implementation — pinned by the frozen-oracle property test. Measured on the production re-mesh path (`runMeshRequest`, smooth, 102 400 cells, devbox-win11, Node 24, median of 5 isolated runs): **331.3 → 101.2 ms, −69.5%**; the full refresh incl. main-thread pack is on the `pnpm bench` harness (`occlusion-remesh.bench.ts`: 320 → 169 ms mean @ 100k, 73 → 41 ms @ 25k cells).

## Examples

```ts
import {
  OccupancyGrid,
  meshOccupiedCells,
} from 'gps-plus-slam-app-framework/ar';

const cells = grid.getOccupiedCells(occupancy.minConfidence);
const { positions, indices, aabbs } = meshOccupiedCells(cells, grid.cellSizeM);

// → THREE depth-only occluder geometry (thin adapter; see the recorder wiring)
const geom = new THREE.BufferGeometry();
geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
geom.setIndex(new THREE.BufferAttribute(indices, 1));

// → developer's own physics: one box collider per AABB
for (const { center, halfExtents } of aabbs)
  physics.addBox(center, halfExtents);
```

## Tests

- `occupancy-mesher.test.ts` — exact-count fixtures: isolated voxel (6 faces / 12 tris), AABB placement, ±half-cell span, shared-face culling (10 faces), solid 2×2×2 (24 faces), enclosed-voxel drop (3×3×3 → 54 faces), de-dup, non-finite + non-integer skip, `cellSizeM` validation.
- `occupancy-mesher.property.test.ts` — invariants over arbitrary cell sets: face count = empty-6-neighbour sum, watertight (even edge cover, per-face path), in-range indices + finite positions, permutation invariance, one AABB per unique cell, **greedy covers the exact same unit faces as per-face culling** (with ≤ the triangle count), and the `'smooth'` properties with the single-corner nudge active: **non-zero total area for any connected occupied set**, the measured-offset invariant, and strict vertex welding.
- `occupancy-mesher.smooth.test.ts` — the dual-contouring `'smooth'` invariants: **full coverage** (triangle count == per-face) on a ragged floor and a 1-cell-wide frame the old 2×2 heuristic missed, **non-zero AREA for features thin in ≥2 dimensions** (isolated voxel / 4×1×1 line / 1×1×3 pillar — the permanent single-corner-nudge regression gate), `getCellPoint` consumed (a uniform sub-cell offset shifts every vertex by it), welded vertices, watertight on a closed (thick) region, AABBs mode-independent, and `'greedy'` output staying distinct from `'smooth'` (the residual assertion of the removed `greedy:true` shim test — the shim was dropped 2026-07-10, quality-review C-3).
- `occupancy-mesher.corner-fit.test.ts` — the `'corner-fit'` invariants: corners are nudged by the mean sub-cell offset (≠ geometric corner, ≠ absolute centroid), **does not collapse a one-cell-thick floor** (top/bottom corners stay ~a cube apart) and stays distinct from `'smooth'` (split assertion since the smooth nudge: smooth's non-corner floor vertices stay exactly flat, exactly the 8 perimeter-corner vertices puff by ±0.25·cell, overall yExtent ≤ 0.5·cell ≪ corner-fit's ~1·cell), **watertight** (index-based even-edge-cover = 0 — the property smooth gives up), identical triangle count to per-face (same face set), bounded deformation (within `cellSize` of the geometric corner), geometric fallback without a provider, AABBs per cell.
- `occupancy-mesher.perf.test.ts` — **deterministic, CI-safe large-scene perf/memory harness (F3, 2026-06-30)**. Builds a known ~20k-cell solid box slab via `../test-utils/synthetic-occupancy-grid.ts` and asserts exact triangle/vertex/byte budgets, watertightness, greedy ≤ per-face, and linear bytes-per-cell across a 4× scale-up. Wall-clock is logged (non-gating). Its `STRATEGIES` list is the side-by-side "compare at scale" bench every selectable mode (per-face, greedy, and — once they land — `'smooth'`/`'corner-fit'`) runs in.
- A complementary skip-if-missing RecorderApp integration probe meshes a _real_ recorded room (plan §8 "Test data strategy"); the F3 harness is the deterministic CI gate that probe could not be.
- `occupancy-mesher.bench.test.ts` — **opt-in performance benchmark** (`BENCH=1`, skipped in CI). Measures grid build + getOccupiedCells + each mesh mode (median of N runs) on a 25 k-cell synthetic grid, the tool used to drive the 2026-06-30 perf optimization (numeric packed keys, `getCellPoint` memoization, inlined per-face allocations). Wall-clock is a measurement, never an assertion.
- `occupancy-mesher-smooth-oracle.property.test.ts` — fast-check byte-equality of the `'smooth'` output (positions AND indices, exact bits) against a frozen copy of the pre-2026-07-17 Map/Set implementation, across random cell sets, cell sizes and centroid providers (absent / offset / sparse-null / NaN- and Infinity-poisoned), plus the `centroids`-array wire path ≡ the callback path and `includeAabbs: false` emptying only the AABB list.
- `occlusion-remesh.bench.ts` — the production re-mesh path (`packMeshRequest` + `runMeshRequest`, smooth) on the `pnpm bench` harness at the 25k/100k-cell regimes — the before/after instrument for mesher work.
