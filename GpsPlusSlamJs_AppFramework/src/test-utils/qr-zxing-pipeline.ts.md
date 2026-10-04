# qr-zxing-pipeline (test-only)

## Purpose

Drives a synthetic frame through a **real decoder and the production pose pipeline**, and scores each stage against the frame's known truth. Shared by the gate tests and the opt-in sweep.

## Public API

- **`zxingDetect(image, options?): Promise<QrDetection | null>`** - a `detect` function with the detection controller's signature, backed by zxing. Returns the first valid, non-empty result; corners are zxing's `position` in **symbol order** (TL, TR, BR, BL).
- **`measureZxingPipeline(frame, truth, options?): Promise<PipelineMeasurement>`** - decodes, compares corners with `frame.truthCorners`, solves with `solveQrPose` (`PlanarPnpSquare`, `intrinsicsFromProjection(truth.projection, W, H)`, identity camera pose), compares with `truth.qrPoseInCamera`.
  - `PipelineMeasurement`: `decoded`, `decodeMs`, `maxCornerErrPx`, `meanSignedErrX/Y` (detected - truth), `rotationErrDeg`, `positionErrCm`, `reprojectionErrPx`. Error fields are `null` where the stage did not run (not decoded, or the solve rejected the detection).
- **`rotationAngleDeg(a, b)`** - angle of the relative rotation between two unit quaternions.

## Invariants & assumptions

- A decode that returns different text from `truth.text` counts as **not decoded**.
- The identity camera pose makes `qrPoseWorld === qrPoseInCamera`, so pose errors are pure solve errors.
- `decodeMs` is wall-clock on the machine running the test (a laptop), never a phone number.
- Test-only; not a tsdown entry.

## Tests

Used by `../ar/qr/qr-zxing-oracle.test.ts` (gate) and `../ar/qr/qr-zxing.sweep.test.ts` (opt-in, `QR_SWEEP=1`). Mutation-checked 2026-09-23: rotating the adapter's corner order by one fails all five roll cases.

## Related

- [zxing-node.ts.md](zxing-node.ts.md), [synthetic-qr-frame.ts.md](synthetic-qr-frame.ts.md)
