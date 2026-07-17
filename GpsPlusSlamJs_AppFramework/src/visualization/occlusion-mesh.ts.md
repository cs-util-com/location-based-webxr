# occlusion-mesh.ts

## Purpose

Reusable THREE adapter that turns the pure {@link meshOccupiedCells} output into
a **persistent depth-only occlusion mesh** of the occupancy grid: an invisible
`THREE.Mesh` that writes depth but no color, drawn before virtual content, so
real geometry the camera saw earlier hides virtual objects placed behind it
(including out-of-view surfaces a live depth occluder cannot remember). Lives in
the framework so every consumer app (AnchorStarter / MinimalExample / recorder)
can use it; the recorder owns only the off-by-default toggle + scene wiring. See
`GpsPlusSlamJs_Docs/docs/2026-06-13-0004-occupancy-mesh-options-plan.md` §4.

## Public API

- `new OcclusionMesh(arSpaceNode: THREE.Object3D, options?: OcclusionMeshOptions)`
  - `arSpaceNode` — the AR-odometry-NUE node that receives the alignment matrix (`arWorldGroup` live, `replaySceneState.arWorldGroup` in replay). The mesh is added to it on construction.
  - `options.greedy` — merge coplanar faces (default **true**; the occluder is invisible so coarser triangulation is free). Ignored when `mode` is set.
  - `options.mode` — mesher strategy (`'per-face' | 'greedy' | 'smooth' | 'corner-fit'`; F2/F2b 2026-06-30). Additive opt-in: **unset by default**, so existing behaviour (greedy cubes) is byte-for-byte unchanged. For `'smooth'`/`'corner-fit'`, pass `getCellPoint` to `update` so the geometry hugs the measured centroids (see `occupancy-mesher.ts.md` → "Modes"). Switching is a one-option change.
  - `options.renderOrder` — depth-only draw order (default **−1**, before virtual content ≥ 0).
- `update(cells: Iterable<GridCell>, cellSizeM: number, getCellPoint?: (cell) => Vector3 | null): void` — re-mesh from a fresh snapshot (pass `grid.getOccupiedCells(occupancy.minConfidence)`); disposes the previous geometry. `getCellPoint` (pass `grid.getCellPoint`) is consumed by the surface-hugging modes `'smooth'` and `'corner-fit'` (the cube modes ignore it).
- `getTriangleCount(): number` — triangles currently drawn.
- `getAabbs(): readonly Aabb[]` — the AABB list from the last `update` (physics-export hook).
- `getMesh(): THREE.Mesh` — the underlying depth-only `THREE.Mesh`, for a pointer-raycast layer to target the real occluder surface (2026-07-15 replay-harness Part B; `pointer-picking.ts`). `colorWrite:false` does not affect `THREE.Raycaster`. Treat as read-only — re-mesh via `update` / restyle via `setDebugStyle` instead of mutating it.
- `setVisible(visible: boolean): void` — show/hide the WHOLE occluder (depth mesh + active debug skins). Hiding stops the depth mesh writing depth, so a co-located visualizer (the occupancy cubes at the same surface) is no longer occluded by the otherwise-invisible occluder — used by a mesh-view controller to switch to a cubes-only view. Independent of `setDebugStyle` (a later style change re-adds skins visible; re-apply `setVisible` if needed).
- `setDebugStyle(style: OccluderDebugStyle): void` — select which **visible debug skin(s)** render the meshed surface so its shape/structure can be judged on-device (2026-07-02 debug-viz-styles plan):
  - `'off'` — no debug rendering (default).
  - `'matcap'` — the original shiny semi-transparent cyan matcap skin.
  - `'depth-shaded'` — the matcap material extended via `onBeforeCompile` with a **camera-distance fade** (bright cyan near → dark desaturated blue far) and a **white fresnel rim** on silhouettes, so overlapping near/far layers read as separate shells. Constants in `OCCLUDER_DEPTH_SHADE` (module constants, not user settings): `FADE_START_M 0.75`, `FADE_END_M 4.5`, `FADE_MIN_BRIGHTNESS 0.3`, `RIM_POWER 2.5`, `RIM_STRENGTH 0.6` — indoor-scale since the 2026-07-03 field pass (the original 1.5 → 10 m range kept a whole room in the "near" band, ≥ 94% brightness at 3 m, so depth-shaded looked identical to matcap on device; a perceptibility-pin test now requires fade ≤ 0.6 at 3 m). Tune in code.
  - `'wireframe'` — the raw triangulation as faint light-cyan GL lines (`MeshBasicMaterial({ wireframe: true })`, opacity 0.35, renderOrder 1 so lines overlay the shaded skin): triangle density, mesher seams, degenerate spots.
  - `'depth-shaded-wireframe'` — both skins composed.
  - **Additive:** every style adds/removes separate skin meshes sharing the occluder's geometry and **never touches the invisible depth-only mesh**, so occlusion is byte-for-byte unchanged whichever style is active. Backs the recorder's `occupancy.occluderDebugStyle` select. Idempotent; safe before `update` (no-op until geometry exists) and after `dispose`. Materials + the shared procedural matcap texture are lazily created and cached across style switches; released in `dispose`.
- `OCCLUDER_DEBUG_STYLES` / `OccluderDebugStyle` — the debug-skin values array (`['off','matcap','depth-shaded','wireframe','depth-shaded-wireframe'] as const`) and its union type. **Owned here** since the 2026-07-11 G-1 move (previously in the framework's `state/recording-options.ts`, now deleted): this module is the consumer; the array is exported so the recorder's `occluderDebugStyle` validator (`GpsPlusSlamJs_RecorderApp/src/state/recording-options.ts`) can enum-check persisted values.
- (The deprecated boolean `setDebugVisualization` wrapper was removed 2026-07-10, quality-review C-4 — it had no production callers; use `setDebugStyle('matcap' | 'off')`.)
- `OCCLUDER_DEPTH_SHADE` / `occluderDepthFade(distanceM)` / `occluderFresnelRim(cosViewAngle)` / `buildOccluderDepthShadeSnippet()` — the depth-shaded constants, the **pure TS mirrors** of the shader's fade/rim curves (unit-testable without a GPU — the `buildFullscreenOcclusionShader` GLSL-mirror precedent), and the exact injected GLSL snippet (exported so tests can pin it).
- `clear(): void` — empty the geometry; node stays attached (e.g. on store swap). Rebinds every active debug skin to the new empty geometry, like `update`/`swapGeometry`, so no stale debug surface lingers after a clear.
- `dispose(): void` — detach the mesh and all debug skins, free GPU resources (geometry, all cached debug materials + matcap texture); idempotent; `update` is a no-op afterwards.

## Invariants & assumptions

- **Depth-only material:** `MeshBasicMaterial({ colorWrite: false, depthWrite: true })`. This is what makes it occlude rather than render — a visible/transparent material would not write depth and would not occlude.
- **Debug skins are additive, never a material swap.** Every style adds separate skin meshes (shaded skin at renderOrder 0, wireframe at 1; both `transparent`, `depthWrite:false`) sharing the occluder's geometry — no style swaps the depth mesh's material. Rationale: a `transparent` material renders in three.js's transparent phase **after** opaque content regardless of `renderOrder`, so swapping the single mesh to a transparent one would stop it occluding opaque objects. Keeping the invisible depth mesh untouched guarantees occlusion is identical across all styles. The matcap texture is a tiny procedural shaded-sphere `DataTexture` (no scene lights, no asset, works headless), shared by the matcap and depth-shaded materials. Vertex normals (the mesher emits none) are computed only for the **matcap-based** styles — pure `'wireframe'` is unlit, so like `'off'` it keeps the remesh path normal-free.
- **Depth-shaded shader is injected, not hand-rolled.** `getDepthShadedMaterial` extends the stock matcap fragment shader via `onBeforeCompile`, inserting `buildOccluderDepthShadeSnippet()` before `#include <opaque_fragment>` (the point where `outgoingLight`, `normal`, `viewDir`/`vViewPosition` are all in scope), with a `customProgramCacheKey` so three.js never reuses the plain matcap program for it. The fade/rim math is mirrored by `occluderDepthFade`/`occluderFresnelRim` so tests pin the curves headless.
- **Basis:** the mesh's local matrix is `WEBXR_TO_NUE` (`matrixAutoUpdate = false`), identical to `OccupancyCubesVisualizer`, so raw-WebXR positions ride the parent's `alignment × WEBXR_TO_NUE` chain. Parenting at the scene root would leave it axis-swapped/unaligned.
- **`frustumCulled = false`** — the surface spans the whole room.
- **Full rebuild:** `update` re-meshes the entire snapshot and swaps the geometry. The chunked dirty-remesh perf layer (plan §7) is a follow-on; throttle `update` at the call site (the recorder reuses the cubes' `wireOccupancyGridSubscribers` cadence).
- **Greedy default + T-junctions:** greedy merge is on by default; its T-junctions are harmless for a depth-only occluder (see `occupancy-mesher.ts.md`).

## Examples

```ts
import { OcclusionMesh } from 'gps-plus-slam-app-framework/visualization';

const occluder = new OcclusionMesh(arWorldGroup); // greedy depth-only, renderOrder −1
// each refresh (throttled), from the same snapshot the cubes use:
occluder.update(grid.getOccupiedCells(occupancy.minConfidence), grid.cellSizeM);
// later:
occluder.dispose();
```

## Tests

- `occlusion-mesh.test.ts` — depth-only material (colorWrite false / depthWrite true), negative renderOrder, WEBXR_TO_NUE local matrix, empty-until-update, single-voxel → 12 tris, greedy slab reduction (12 vs 140 tris) with AABBs unchanged, `clear` empties but keeps node, `dispose` detaches + idempotent. **Debug styles (`setDebugStyle`):** per style the correct skin set is active and the depth mesh is untouched; wireframe material flags (wireframe / transparent / `depthWrite:false` / renderOrder 1) and normal-free geometry; depth-shaded uses a distinct matcap-based material; combined style composes both; switches idempotent; skins in sync across `update` / `applyMeshData` / `clear`; dispose disposes all skins + materials. **Depth-shaded material:** the injected GLSL snippet + placement (string-pinned), distinct `customProgramCacheKey`, endpoint tests of the `occluderDepthFade`/`occluderFresnelRim` mirrors, and the indoor **perceptibility pins** (fade engages ≤ 1 m, bottoms out ≤ 5 m, ≤ 0.6 brightness at 3 m — executable form of field finding F1, see `GpsPlusSlamJs_Docs/docs/2026-07-02-0800-occluder-debug-viz-styles-followups.md`). **Matcap skin:** the former wrapper suite now pins `setDebugStyle('matcap'|'off')` directly (the deprecated boolean wrapper was removed, C-4).
- `occlusion-mesh.property.test.ts` — random op sequences (style switches × `update`/`applyMeshData`/`clear`) hold the skin/occluder invariants after every step; fresh remeshes under `'off'`/`'wireframe'` stay normal-free; fade/rim mirrors bounded + monotonic over random inputs.
- Geometry counts rely on the proven `meshOccupiedCells` invariants (`occupancy-mesher.*.test.ts`); on-device occlusion correctness is the separate gate (plan §4).
