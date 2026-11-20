# `colmap-conversions.ts`

## Purpose

Pure math turning the recorder's persisted **WebXR** data into the conventions
COLMAP's `sparse/0/` text files expect. The single tested seam owning the
axis/sign conventions for the COLMAP export (mirrors `depth-unprojection.ts`).

Part of the COLMAP/3DGS export — see
[2026-06-13-1205-colmap-export-plan.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-13-1205-colmap-export-plan.md)
§2.3 (Iter 1).

## Public API

- `webxrToColmapPose(position: Vector3, rotation: Quaternion): ColmapPose`
  - Input: a **raw-WebXR** camera pose (camera-to-world; −Z forward, +Y up).
    In the export this is the per-frame pose after `selectFrameTilesInWebXR`'s
    NUE→WebXR conversion.
  - Output: `{ qvec: [qw, qx, qy, qz], tvec: [tx, ty, tz] }` — the COLMAP
    **world-to-camera** extrinsic (+Z forward, +Y down) expressed in the
    **flipped COLMAP world** (Y-down gravity), such that
    `X_cam = R(qvec)·X_world + tvec` for `X_world` in that flipped world.
  - Never throws; assumes a (near-)unit input quaternion.
- `webxrToColmapWorldPoint(point: Vector3): Vector3`
  - The world basis change `G = diag(1,−1,−1)` (negate Y,Z) applied to a 3D
    point. The SAME `G` that `webxrToColmapPose` folds into the extrinsics, so
    points and cameras stay registered. This is the **upside-down fix**
    (follow-up Item B): viewers treat the COLMAP world as Y-down gravity, so the
    flip makes the reconstruction load **upright** (det = +1 → no mirroring).
- The intrinsics, `pinholeFromProjection`, moved to the framework
  (`gps-plus-slam-app-framework/utils/pinhole-from-projection`), shared with
  the Tour Viewer's splat trainer reader; the COLMAP contributor imports it
  from there.

## Derivations

Pose: WebXR is camera-to-world; COLMAP is world-to-camera. The camera frames
differ by negating Y and Z (`WEBXR_TO_COLMAP_CAM = diag(1,−1,−1)`, a proper
180°-about-X rotation, det = +1). So
`worldToCam = (camToWorld · WEBXR_TO_COLMAP_CAM)⁻¹`. We then re-express the
extrinsic in the flipped COLMAP world by post-multiplying the world basis change
`WEBXR_TO_COLMAP_WORLD = diag(1,−1,−1)`: `worldToCam · G` (which leaves `tvec`
unchanged and only rotates `R`). The quaternion + translation are read off via
`THREE.Matrix4.decompose` (rigid → unit scale, clean quat).

World flip (upside-down fix, follow-up Item B): COLMAP/3DGS viewers (Lichtfeld
Studio, gsplat, Nerfstudio) treat the COLMAP world as **Y-down gravity** while
our world is WebXR **Y-up**, so without a flip the reconstruction loads
upside-down (internally consistent — not mirrored, not mis-scaled). The SAME
`G = diag(1,−1,−1)` is applied to points (`webxrToColmapWorldPoint`) and folded
into the camera extrinsics here, so registration is preserved: a surface point
still projects to the pixel its camera saw. `G` is a proper rotation (det = +1),
so it is upright **without** mirroring. For identity camera pose the camera flip
and the world flip cancel → the extrinsic is identity.

## Invariants & assumptions

- `qvec` is unit length (asserted in the property test).
- The basis change is a proper rotation, so no sign folds into the quaternion.
- `Quaternion` input is `[x,y,z,w]`; COLMAP `qvec` output is `[w,x,y,z]` — the
  reordering is the most common foot-gun, kept explicit via the `ColmapQuat`
  type.

## Examples

```ts
const { qvec, tvec } = webxrToColmapPose([0, 0, 0], [0, 0, 0, 1]);
// qvec ≈ [1, 0, 0, 0] (identity: camera flip cancels world flip), tvec ≈ [0,0,0]

webxrToColmapWorldPoint([1, 2, 3]); // → [1, -2, -3] (negate Y,Z)
```

## Tests

- `colmap-conversions.property.test.ts` — pose registration: the extrinsic
  applied to the **flipped** world point reproduces the physical point's COLMAP
  camera coords (= basis-changed WebXR view coords), proving cameras + points
  stay registered after the world flip (500 runs over random poses); the world
  flip negates exactly Y,Z and preserves pairwise distances (proper rotation, no
  mirror/scale).
- `colmap-conversions.test.ts` — hand-verifiable fixtures (identity → identity
  extrinsic, point ahead → +Z, point above → −Y, a non-trivial rotated pose, all
  feeding flipped world points).
