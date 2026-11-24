# synthetic-planar-target

## Purpose

Test-only: synthetic scenes of a planar target (a QR code or a rectangular
image target) seen from known camera poses, in double precision. The pose,
size and vote tests for rectangles and the aspect-1 golden test build their
inputs here.

## Public API

- `SCENE_INTRINSICS`: the intrinsics every scene uses (fx = fy = 820, a
  1024 x 768 buffer).
- `targetPointsInWorld(local, target)`: a target's local points placed by
  its pose.
- `projectWorldPoints(world, camera, { intrinsics?, noisePx?, rand? })`: the
  pixels of world points, each moved by up to +-`noisePx`. Throws when a
  point is behind the camera (a broken scene, not a case to skip).
- `planarTargetEntries(local, target, cameras, { noisePx, jitterCm,
jitterDeg, seed, epoch })`: fused-window entries (`QrFusedEntry`) for a
  camera walk, with corner noise and the tracker's camera-pose error,
  seeded (`mulberry32`) so every run is the same.
- `DEPTH_PROJECTION`, `depthPointOf(world)`: a depth read of a camera-frame
  point (camera at the origin, -z forward), for the depth measurers.
- `quadLattice(quad, n)`: an `n x n` bilinear lattice across a quad.

## Invariants

- The object points are passed in (`buildObjectPoints(widthM, aspectRatio)`),
  so the helper never depends on how production code builds them; the
  golden test relies on that.
- Deterministic: the same options give the same entries.

## Tests

Exercised by `ar/qr/planar-target-rectangle.test.ts`,
`ar/qr/planar-target-rectangle.property.test.ts` and
`ar/qr/planar-target-aspect-one.golden.test.ts`.
