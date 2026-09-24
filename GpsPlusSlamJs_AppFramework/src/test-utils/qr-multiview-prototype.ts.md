# qr-multiview-prototype

## Purpose

PROTOTYPE, test-only: the joint multi-view QR pose solve, measured side by
side in its three formulations before M3a builds one for production (QR
near-frontal pose plan 2026-09-23-2314, M0 and §8).

## Public API

- `solveMultiView(views, starts, { sizeM, variant, robustScalePx?, maxIterations? })`
  - `views`: `{ corners (TL, TR, BR, BL), cameraWorld, intrinsics }` each.
  - `variant`: `rotSharedFixedT` (the code's world rotation shared; each
    view keeps the position of its own single-view solve), `rotSharedFreeT`
    (rotation shared, position free per view), `shared6` (one shared pose).
  - Damped Gauss-Newton on the corners' reprojection error with a robust loss
    (`robustScalePx`, default 1; `Infinity` = least squares), numeric Jacobian, in
    double precision; one solve per start, the lowest robust cost wins.
  - Returns `{ rotationWorld, positionWorld, costPx, views }`, or `null` for
    no views, no starts, a view without four corners, or no converging start.
- `realCandidateStarts(view, sizeM)` - the world poses of the view's REAL IPPE
  candidates (at most two); the invalid root (plan §6 finding 1) is left out
  by its larger depth.

## Invariants & assumptions

- Double precision throughout: the framework's `composePose` is Float32 and
  would drown a numeric Jacobian.
- Measured (plan §8b): `shared6` collapses under SLAM noise (p95 10-19 deg);
  the rotation-shared variants do not. M3a builds `rotSharedFixedT`.

## Tests

`qr-multiview-prototype.test.ts`: every variant recovers an exact pose from a
nearby start; starting from every view's real candidates ends on the truth,
not a mirror flip; a single view refines; one 25 px bad corner costs 0.05 deg
with the robust loss and ~2 deg without (mutation-checked); unusable input
returns null; at most two real candidates per view.
