# qr-size-from-depth.ts

## Purpose

Measure a QR's **printed physical size directly from the depth map** (Note 4 of
the [follow-up plan](../../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-15-1219-qr-tracking-generalization-overlay-and-north-followup.md)),
so the QR content/size are irrelevant and `qr.physicalSizeM` need not be hand-
authored. This is the **measuring stage** of the Note 3 size lifecycle.

## Public API

- `estimateQrSizeFromDepth(corners, interiorSamples, unprojector)` →
  `{ sizeM, quality } | null`. Unprojects the 4 corner `DepthPoint`s (TL,TR,BR,BL)
  via `createDepthUnprojector`, takes the **median of the 4 edge lengths** as
  `sizeM`, and scores `quality ∈ [0,1]` from edge agreement + diagonal ≈ `√2·edge`
  - planarity (c2 and the interior samples vs the plane through c0,c1,c3).
    Returns `null` when a corner can't be unprojected or the quad is degenerate.
    This is the **corner-only** path — now the measurer's _fallback_; it depends
    on the (noisy) corner depth reads.
- `estimateQrSizeFromDepthDense(cornerScreens, samples, unprojector)` →
  `{ sizeM, quality } | null` (WS-A, the **primary** path). Robustly fits the QR
  **plane** to many interior depth reads, then recovers the 4 corners by
  intersecting their pixel rays with that plane (a corner ray is obtained by
  unprojecting its screen point at two depths — no camera centre needed). Edge
  median → `sizeM`; `quality` from edge/diagonal agreement + the plane-fit RMS.
  Decouples "where depth exists" from "where the corners are", so a small/tilted
  QR is sized from its face. Needs ≥3 non-collinear usable reads, else `null`.
- `fitPlaneRobust(points)` → `{ point, normal, inlierCount, rms } | null`.
  **Least-Median-of-Squares** plane search over deterministic point triples
  (≈50% breakdown, no tuning threshold), a robust LMS scale → inlier band (with a
  5 mm absolute floor so a near-perfect plane keeps its clean points), then a
  **dominant-axis least-squares refit** on the inliers (the LMS normal picks the
  dependent axis, so no eigensolver). `null` for <3 points or a collinear set.
  PCA is deliberately avoided: one gross depth outlier can flip which axis PCA
  calls the normal.
  - **The triple sampler is an exact 32-bit LCG** (`Math.imul`), and each index
    comes from its HIGH bits. A plain `*` passes 2^53 and zeroes the low bits,
    so `rng % n` once returned one index for every `n` dividing 512 (no plane at
    16 or 32 reads) and three fixed points at 48 (no robustness at all). The
    measurer's lattice loses reads where depth is missing, so any count occurs.
- `createQrSizeAccumulator(options)` → `{ add(obs|null), current(), reset() }`.
  A robust running **median** over accepted observations, reporting a
  `QrSizeEstimate` with the lifecycle `status`. Options: `qualityThreshold`
  (0.8), `minSamples` (8), `maxSpreadM` (0.01 m), `maxSamples` (**unbounded by
  default** — WS-B lifelong refinement; set a finite value only for a bounded
  sliding window). `spreadM` is a robust confidence half-width (`1.4826·MAD/√N`)
  that TIGHTENS as samples accumulate, and `estimated` **latches** (it is a
  confidence signal, not terminal — a later noisy frame can't demote it).
- **Size value types** `QrSizeStatus` / `QrSizeEstimate` are defined here and
  imported by `state/qr-detected-slice.ts` (keeps `ar` free of any `state`
  import — the reverse direction would close a dependency cycle).

## Invariants & assumptions

- **Metric, angle-robust:** size comes from depth-unprojected 3D corners, so it
  is correct at any distance/viewing angle (no `solvePnP` scale assumption) —
  verified by the property test across random size/distance/yaw.
- **Quality is scale-free:** every error term is normalized by the mean edge, so
  the threshold is size-independent. A non-planar / non-square / noisy read
  scores low and is dropped by the accumulator's `qualityThreshold`.
- **Corner depth is noisiest** (edge/background discontinuity): interior samples
  only strengthen the planarity check; a single bad interior read is skipped, not
  fatal.
- **`estimated` gate:** `sampleCount ≥ minSamples` **and** `spreadM ≤ maxSpreadM`,
  then **latched** (WS-B): once reached it stays `estimated` while refinement
  continues. This is the gate that later promotes a measured size to drive
  size-dependent features (PnP solve, geo vote).
- **Lifelong refinement (WS-B):** the QR's physical size never changes, so the
  accumulator keeps the full session history by default and the median tightens
  the longer the QR is seen. The median is robust to a minority of late outliers
  (a burst can't pull it); `spreadM` reports the shrinking confidence.

## Examples

```ts
const acc = createQrSizeAccumulator();
const u = createDepthUnprojector(cameraPos, cameraRot, projectionMatrix);
const est = acc.add(estimateQrSizeFromDepth(corners, interior, u!));
if (est.status === 'estimated') buildCube(est.estimateM!);
```

## Tests

- `qr-size-from-depth.test.ts` — fronto-parallel recovery + quality≈1, a depth-
  pushed corner scores < 0.8, null on an unprojectable corner; accumulator
  lifecycle, spread gate, quality/null rejection, reset.
- `qr-size-from-depth.property.test.ts` — recovers the printed size for random
  size/distance/yaw (angle-robustness); a non-planar quad scores low. Dense path:
  recovers the size from interior reads for random size/distance/yaw, and stays
  accurate when a minority of interior reads are gross outliers.
- Dense unit cases: `fitPlaneRobust` (fronto, single gross outlier rejected,
  every point count from 4 to 64 fitted with a fifth of gross outliers
  rejected, collinear/too-few → null) and `estimateQrSizeFromDepthDense` (fronto from
  interior reads only, a tilted square the corner-only path would mis-size,
  outlier robustness, too-few-reads → null).
- WS-B lifelong cases: full history beyond 64 samples, the confidence half-width
  tightens as N grows, a late outlier burst can't move the median, and
  `estimated` is retained (not demoted) once reached.

## Related

- Composes [depth-unprojection.ts.md](../depth-unprojection.ts.md). Feeds the size
  lifecycle in [../../state/qr-detected-slice.ts.md](../../state/qr-detected-slice.ts.md)
  and the `resolveSizeM` seam of
  [qr-tracking-controller.ts.md](qr-tracking-controller.ts.md).
