# `colmap-serializers.ts`

## Purpose

Pure string builders for the three COLMAP `sparse/0/` model files. No I/O, no
state — they take already-converted records and return file text. Part of the
COLMAP/3DGS export
([2026-06-13-1205-colmap-export-plan.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-13-1205-colmap-export-plan.md)
§5, Iter 2).

## Public API

- `serializeCamerasTxt(width, height, intrinsics, cameraId = 1): string`
  - One `PINHOLE` line: `CAMERA_ID PINHOLE W H fx fy cx cy`. `W`/`H` are the
    JPEG frame's pixel dimensions.
- `serializeImagesTxt(images: ColmapImageRecord[], cameraId = 1): string`
  - Two lines per image: `IMAGE_ID QW QX QY QZ TX TY TZ CAMERA_ID NAME`, then an
    **empty** keypoint line (COLMAP's mandatory 2nd line; empty because there
    are no detected 2D features — plan Q1/§2.2).
- `serializePoints3DTxt(points: ColmapPoint3DRecord[]): string`
  - One line per point: `POINT3D_ID X Y Z R G B ERROR`, **empty track**. RGB is
    rounded + clamped to integer 0–255.

Records: `ColmapImageRecord { imageId, pose: ColmapPose, name }`,
`ColmapPoint3DRecord { pointId, xyz: Vector3, rgb, error }`.

## Invariants & assumptions

- **World frame = raw WebXR world.** The Iter-1 pose conversion changes only the
  camera frame, so `points3D` XYZ are passed in raw-WebXR world coords with NO
  further transform and are already registered with the camera extrinsics.
  (This corrects the plan's earlier §5 wording about converting points "with the
  same transform as cameras" — with this camera convention that would
  _misregister_ them.) The contributor supplies each point as the **exact
  per-cell surface centroid** (`OccupancyGrid.getCellPoint`, follow-up Item A),
  not the 15 cm-lattice center — the serializer is agnostic to which.
- `qvec` is written in COLMAP order `[qw qx qy qz]` (already produced that way by
  `webxrToColmapPose`).
- Tracks and keypoint lines are intentionally empty — valid for 3DGS-init
  loaders, not for vanilla COLMAP mapper/triangulator (plan Q1).
- Numbers: floats via `String` (compact, `-0`→`0`); ids/dimensions rounded;
  color channels rounded + clamped to 0–255; a non-finite channel writes `0`
  (`+Infinity` → 255) instead of the literal `NaN` it used to emit, which no
  COLMAP reader parses (fixed 2026-09-04).
- Comment (`#`) headers mirror COLMAP's writer; parsers skip them.

## Examples

```ts
serializeCamerasTxt(1280, 960, { fx: 1000, fy: 1100, cx: 640, cy: 480 });
// "...\n1 PINHOLE 1280 960 1000 1100 640 480\n"

serializePoints3DTxt([
  { pointId: 1, xyz: [1.5, -2, 3], rgb: [10, 20, 30], error: 1 },
]);
// "...\n1 1.5 -2 3 10 20 30 1\n"
```

## Tests

- `colmap-serializers.test.ts` — exact line shapes for all three files: single
  PINHOLE line, per-image pose + empty keypoint line, `qvec` ordering, per-point
  line with empty track, RGB round/clamp, empty point set, and the `# Number
of …` counts.
