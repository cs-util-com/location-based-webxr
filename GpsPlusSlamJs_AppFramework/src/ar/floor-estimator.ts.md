# AR Floor Estimator

## Purpose

Pure column-histogram + least-squares-plane floor estimator over the sparse `OccupancyGrid`: given the grid and the camera position, it answers "where is the floor under the viewer, how confident are we, and how is it tilted?" — entirely in the RAW WebXR (local-floor) frame. No THREE, no DOM, no Redux; callers invoke it per tick (the grid updates at the ~1 Hz depth-sample cadence, so a 1 Hz call rate matches the data) and gate on `confidence`.

## Public API

- **`estimateFloor(grid, cameraPos, options?) → FloorEstimate | null`**
  - `grid` — an `OccupancyGrid` (any cell size; the defaults were validated on the framework-recommended 0.16 m / ≥2-observation configuration).
  - `cameraPos` — `readonly [x, y, z]`, **raw WebXR**. This is the same shape and frame as the cube visualizer's `ViewerPose.cameraPos` (`occupancy-cubes-visualizer.ts`), so a caller holding a `ViewerPose` passes `viewerPose.cameraPos` straight through.
  - Returns `null` when no estimate exists: empty/too-sparse grid, no band with enough support, every candidate cell above the exclusion line, or a **non-finite `cameraPos`** (tracking glitch — mirrors the grid's non-finite policy).
  - Throws `RangeError` for malformed **options** (non-positive/non-finite `queryRadiusM`, negative/non-finite `minBelowCameraM`, non-positive-integer `minSupportCells`/`bandCells`/`minObservations`) — a bad configuration is an upstream bug, not a data condition, and validation runs before any grid access.
- **`FloorEstimatorOptions`** — `queryRadiusM` (3), `minBelowCameraM` (0.4), `minSupportCells` (6), `bandCells` (2), `minObservations` (`DEFAULT_OCCUPANCY_MIN_OBSERVATIONS`, 2). Defaults are the corpus-validated constants (see Invariants).
- **`FloorEstimate`** — `floorYar` (plane-fit floor height at the camera's XZ, raw AR frame), `heightAboveFloorM` (`cameraY − floorYar`), `slopeX`/`slopeZ` (plane gradient dy/dx, dy/dz), `confidence` (0..1), `clamped` (true when the extrapolation clamp capped `floorYar` at the exclusion line — see Invariants), `support` (cells in the winning band), `planeResidualM` (RMS residual of the plane fit), `hits` (the band's measured points, for downstream per-hit sampling).
- **`FloorHit`** — `{ x, y, z }`, the measured surface point of one supporting cell (sub-cell `getCellPoint` mean; geometric cell center as defensive fallback), raw AR frame.
- **Constants** — `DEFAULT_FLOOR_QUERY_RADIUS_M` (3), `DEFAULT_FLOOR_MIN_BELOW_CAMERA_M` (0.4), `DEFAULT_FLOOR_MIN_SUPPORT_CELLS` (6), `DEFAULT_FLOOR_BAND_CELLS` (2), `PLAUSIBLE_HEIGHT_MIN_M` (0.5), `PLAUSIBLE_HEIGHT_MAX_M` (2.5).

## Algorithm

1. **Window**: `grid.getOccupiedCellsWithin(cameraPos, queryRadiusM, minObservations)` — the chunk-indexed viewer-local query, so cost is independent of total explored area.
2. **Column histogram**: candidate cells whose center sits at least `minBelowCameraM` below the camera are bucketed by integer cell-y; scanning bottom-up, the LOWEST band `bandCells` tall with ≥ `minSupportCells` members wins. Lowest-first is what makes an elevated surface (table, ledge) lose to the true floor whenever the floor has enough support.
3. **Heights**: one point per supporting cell via `getCellPoint` (running-average of the exact unprojected surface points — sub-cell accurate) with `getCellCenter` as the defensive fallback.
4. **Plane fit**: least-squares `y = a + b·x + c·z` over the band's points, solved on centered coordinates (2×2 covariance system) for conditioning. Degenerate support (< 3 points, or a collinear/spot XZ footprint by relative-determinant test) falls back to the mean height with zero slopes. `floorYar` is the plane **evaluated at the camera's own XZ** — on a slope this is the whole point of fitting a plane instead of averaging the band.

## Invariants & assumptions

- **Raw-AR-frame contract**: `cameraPos`, `floorYar`, and every `FloorHit` are in the raw WebXR (local-floor) frame — the same frame the grid, `getCellPoint`, and `ViewerPose` use. No NUE conversion anywhere.
- **Corpus-measured defaults**: measured for THIS production module by the corpus cross-validation (`GpsPlusSlamJs_Investigation`, `floor-estimator-production-crossval`) on 90 usable real recordings (deduped by basename across corpus sources; 0.16 m cells, ≥2 observations): an estimate lands on ~every 1 Hz tick, the median per-recording ACCEPT RATE (share of a recording's estimates with camera height inside [0.5, 2.5] m) is **0.90**, and the median over per-recording MEDIAN camera heights is **1.67 m**. The plausibility band is that measured envelope, not a guess. (The spike prototype's figures — 0.95 accept, 1.72 m — used the band-MEAN height; the plane fit at the camera's XZ shifts both statistics slightly.)
- **The floor is never inside the exclusion zone**: `floorYar ≤ cameraY − minBelowCameraM` always (property-tested). Every candidate cell is below the line by construction; the one way the plane could cross it — a steep one-sided extrapolation to the camera's XZ — is clamped to the line. In that clamped case (only there) `floorYar ≠ a + b·x + c·z`, the estimate carries `clamped: true`, and the confidence is multiplied by the hard clamp crush (×0.2) on top of the sub-plausible-height decay — the height decay alone would leave ~0.5 for the 0.4 m clamped height, far too trusting for an extrapolation into the exclusion zone.
- **Implausible estimates are reported, never hidden**: a height outside [0.5, 2.5] m returns normally with crushed confidence. The estimator reports; callers gate. Hiding would leave a consumer unable to distinguish "no data" from "data that looks wrong".
- **Confidence model** (product of three [0, 1] terms):
  - _Support saturation_ — `min(1, support / 20)`: 6 cells is the floor to exist at all, but a band needs ~20 before it deserves full trust; below that a small noise blob can be the "floor".
  - _Residual penalty_ — full credit up to 0.08 m RMS (≈ half a cell of quantization/sensor noise), exponential decay (scale 0.08 m) beyond. This term exists because a band-bounded spread cannot see noise the band excluded: band membership clips heights into a `bandCells`-tall slab, so any raw spread statistic over the band is small by construction even in a scene where the "floor" is noise. The plane residual at least distinguishes structure inside the slab — a true sloped floor fits a plane with ~zero residual, while incoherent clutter filling the same slab does not.
  - _Height plausibility_ — full credit inside [0.5, 2.5] m, exponential decay (scale 0.15 m) with distance outside. Monotonic by construction (unit-tested at both edges).
  - _Extrapolation-clamp crush_ — ×0.2 when `clamped` is true (a fourth multiplicative term, 1 otherwise). See the exclusion-zone invariant above for why the crush is hard.
- **NaN-free**: for arbitrary finite inputs the result is `null` or has all-finite fields with `confidence ∈ [0, 1]` (property-tested). The grid only ever stores finite points, so no internal arithmetic can produce non-finite values from a finite camera.
- **Re-observation stability**: re-adding the same samples (static scene, the 1 Hz steady state) grows the grid revision but leaves the estimate invariant up to floating-point ordering (property-tested at 1e-9).
- **Allocation behavior**: one windowed-query snapshot, one bucket map, and one hits array per call — no per-cell closures in hot loops. Clarity first; it is a ~1 Hz path, not a per-frame one.

## Compatibility

- **`GpsAnchorOptions.floorY?: () => number | null`** (`visualization/gps-anchor.ts`): this estimator is shaped to back that reserved seam — `null` for "no estimate" matches the seam's contract, and a host adapts it as e.g. `() => { const e = estimateFloor(grid, camPos()); return e && e.confidence >= 0.5 ? e.floorYar : null; }`. Note the seam is **not yet consulted** by `GpsAnchor` (floor-Y correction is a deferred port sub-step), and `floorYar` is a **raw-WebXR** y: when GpsAnchor wires the seam it must consume the value in that frame (or convert), since anchored objects live under the aligned `arWorldGroup`.
- **`ViewerPose`** (`visualization/occupancy-cubes-visualizer.ts`): `cameraPos` here is deliberately the same `readonly [x, y, z]` raw-WebXR shape, so one viewer-pose plumbing serves both consumers.

## Examples

```ts
import { OccupancyGrid, estimateFloor } from 'gps-plus-slam-app-framework/ar';

const grid = new OccupancyGrid({
  cellSizeM: 0.16,
  carveConfidenceThreshold: 2,
});
// ... fold depth samples via grid.addSample(sample) ...

const estimate = estimateFloor(grid, cameraPos); // corpus defaults
if (estimate && estimate.confidence >= 0.5) {
  const floorY = estimate.floorYar; // raw WebXR y under the camera
  const height = estimate.heightAboveFloorM; // ~1.7 m for a held phone
  // estimate.hits: per-cell measured floor points for downstream sampling
}
```

## Tests

- `floor-estimator.test.ts` — end-to-end through the real fold pipeline (synthetic `DepthSample`s → `addSample` → estimate): flat-floor recovery (cm-level height, ~zero slopes, high confidence, `clamped: false`), 12° slope recovery (gradient + height at the camera XZ from the lowest strip), 5-cell deep-noise cluster losing on the support threshold, 6-cell cluster winning with exactly `minSupportCells` but crushed confidence, one-sided steep support clamped to the exclusion line (`clamped: true`, hard-crushed confidence), empty grid → `null`, all-cells-above-camera → `null`, plausibility-band edge monotonicity on both sides, the default `minObservations = 2` noise floor, non-finite camera → `null`, and strict option validation.
- `floor-estimator.property.test.ts` — fast-check invariants: the floor never above `cameraY − minBelowCameraM`, NaN-freedom + `confidence ∈ [0, 1]` for arbitrary finite scenes and query cameras, and re-add invariance with revision growth.
- Fixtures come from `../test-utils/synthetic-depth-samples.ts` (exact-world-point samples through the real projection path).
