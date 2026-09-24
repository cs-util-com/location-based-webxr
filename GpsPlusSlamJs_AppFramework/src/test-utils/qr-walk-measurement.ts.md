# qr-walk-measurement

## Purpose

Test-only: one synthetic walk, measured (QR near-frontal pose plan
2026-09-23-2314, M0). Each step is rendered, decoded with zxing, and scored:
today's raw per-frame pose, today's windowed stable pose, and the multi-view
prototype's variants, all against the truth.

## Public API

- `measureWalk(options): Promise<WalkRow[]>` - `options` are
  `synthetic-qr-walk`'s `WalkOptions` plus `noiseSigma`, `seed`,
  `blurRadiusPx?`, `capture?` (default the owner's folded phone, 439x1024,
  fovY 64 assumed), `window?` (default 8), `robustScalePx?`, `variants?`, and
  `slamNoise?` (`{ rotationDeg, translationM }`: Gaussian noise on the camera
  poses the SOLVERS are given; the image is always rendered from the truth).
- `WalkRow`: `step`, `window`, `rayDeg`, `reachedDeg` (the largest TRUE ray
  angle in the window, the done bar's binning variable), `errRawDeg` (NaN
  when the solve was rejected), `errStableDeg`, `errFusedDeg` per variant.

## Invariants & assumptions

- Frames zxing cannot decode are skipped, not scored.
- Every method is scored on the SAME window of views: the stable pose
  averages the raw poses of exactly those views (a rejected solve is simply
  absent), and the sweep counts a row only when every method produced an
  estimate (milestone review 2026-09-24, finding 7).
- Starts for the joint solve: every window view's real candidates, one per
  orientation within 2 deg.
- Deterministic: the image noise and the SLAM noise are seeded
  (`mulberry32` from `elevation-offset-scenarios.ts`).

## Tests

`qr-walk-measurement.test.ts`: a clean oblique walk scores every method near
the truth with the right window and reached angle; SLAM noise reaches the
solvers but not the binning; nothing decodes at 12 m. The sweep that uses it:
`ar/qr/qr-zxing.sweep.test.ts` ("walks").
