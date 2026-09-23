# synthetic-qr-frame (test-only)

## Purpose

Renders a **real QR symbol** (node-qrcode modules) at a known 6-DoF pose through a GL projection matrix into an `RgbaImage`, and returns the exact pixel positions of its outer corners. It is the ground truth for every real-image QR test.

## Public API

- **`perspectiveProjection({ fovYDeg, aspect, near?, far?, offsetX?, offsetY? }): Matrix4`** - column-major GL perspective matrix (the `XRView.projectionMatrix` layout); `offsetX/offsetY` land in slots 8/9 as an off-centre principal point. Throws `RangeError` on invalid parameters.
- **`qrPoseFacingCamera({ distanceM, rollDeg?, tiltXDeg?, tiltYDeg?, offsetM? }): Pose`** - a code pose in the WebXR camera frame (+x right, +y up, -z forward). Identity rotation = upright and facing the camera. `rollDeg` is in-plane (counter-clockwise as seen by the camera); `tiltXDeg > 0` tips the top edge away.
- **`renderQrFrame(options): SyntheticQrFrame`** - `options`: `text`, `ecLevel` (default `Q`, as printed), `sizeM` (symbol side, quiet zone excluded), `qrPoseInCamera`, `projection`, `width`, `height`, `supersample` (NxN, default 3), `quietZoneFraction` (default the app's `QR_QUIET_ZONE_FRACTION`), `darkLevel`/`lightLevel`/`backgroundLevel` (16/240/128), `blurRadiusPx` (box, default 0), `noiseSigma` (Gaussian, default 0), `seed`.
  - Returns `image`, `truthCorners` (TL, TR, BR, BL in symbol order), `moduleCount`, `modulePx` (shortest projected edge / modules), `quietZoneModules`.
  - Throws `RangeError` for `sizeM <= 0`, non-integer or non-positive dimensions, `supersample < 1`, or a code not in front of the camera.

## Invariants & assumptions

- **Written from the GL definitions, not from `qr-pose.ts`.** Forward projection is clip -> NDC -> viewport (`px = (ndc.x + 1) * W / 2`, `py = (1 - ndc.y) * H / 2`); the inverse per pixel is a ray-plane intersection. Tests then solve with `intrinsicsFromProjection(P, W, H)`, so that function is inside the tested loop instead of sharing its convention with the ground truth.
- **Pixel convention:** pixel `(i, j)` covers `[i, i+1] x [j, j+1]`; its centre is `(i + 0.5, j + 0.5)`. Sub-samples sit at `(i + (s + 0.5) / N)`.
- **Corners are the outer symbol edge** - the square `buildObjectPoints(sizeM)` models (`qr-print-plan.ts` defines the printed size that way) and the edge zxing reports.
- The quiet zone is the app's print value (8 % of the side per edge), not the specification's four modules, so decode limits match real prints.
- Deterministic: the only randomness is `mulberry32(seed)` noise (reused from `elevation-offset-scenarios.ts`).
- Cost: O(width x height x supersample^2); ~0.1-0.3 s for 1024x768 at N=2 on a laptop. Keep gate tests to a handful of frames; the wide sweep is opt-in.
- Test-only: in `src/test-utils/`, not a tsdown entry, never imported by production code.

## Examples

```ts
const P = perspectiveProjection({ fovYDeg: 50, aspect: 1024 / 768 });
const pose = qrPoseFacingCamera({ distanceM: 0.6, tiltXDeg: 20, rollDeg: 90 });
const frame = renderQrFrame({
  text: url,
  sizeM: 0.16,
  qrPoseInCamera: pose,
  projection: P,
  width: 1024,
  height: 768,
});
```

## Tests

`synthetic-qr-frame.test.ts` checks the renderer against analytic geometry without zxing: frontal corner positions (`f * size / d`), finder-pattern centres dark, separator and quiet zone light, background grey, roll moves the TL corner as expected, seeded determinism, buffer shape, input validation.

## Related

- [zxing-node.ts.md](zxing-node.ts.md), [qr-zxing-pipeline.ts.md](qr-zxing-pipeline.ts.md)
- Plan: `GpsPlusSlamJs_Docs/docs/2026-09-23-0034-qr-capture-decode-perf-and-zxing-oracle-plan.md` (M1).
