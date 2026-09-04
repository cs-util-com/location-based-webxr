/**
 * COLMAP `sparse/0/` Text Serializers
 *
 * Pure string builders for the three COLMAP model files (export plan Iter 2,
 * gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-13-1205-colmap-export-plan.md §5):
 *  - `cameras.txt` — one shared `PINHOLE` camera.
 *  - `images.txt`  — two lines per image: the world-to-camera pose, then an
 *    EMPTY keypoint line (we have no 2D feature detections — plan Q1/§2.2).
 *  - `points3D.txt`— one line per occupancy-grid voxel center (XYZ + RGB),
 *    with an EMPTY track (no 2D↔3D correspondences exist).
 *
 * Coordinate frame: these serializers are pure string builders — they write
 * whatever XYZ/extrinsics they are handed, untouched. The world basis change
 * that makes the export load upright (follow-up Item B: COLMAP/3DGS viewers want
 * Y-down gravity, our world is WebXR Y-up) is applied UPSTREAM and identically
 * to both — `webxrToColmapWorldPoint` for `points3D` and `webxrToColmapPose` for
 * the camera extrinsics — so the values arriving here are already in the COLMAP
 * world frame and stay registered. See colmap-conversions.ts(.md).
 *
 * The emitted files target 3DGS-initialization loaders (gsplat / Nerfstudio /
 * Inria), which read only intrinsics + extrinsics + seed XYZ/RGB and ignore the
 * (empty) tracks. Comment headers mirror COLMAP's own writer for readability;
 * COLMAP/3DGS parsers skip `#` lines.
 */

import type { Vector3 } from 'gps-plus-slam-app-framework/core';
import type { ColmapPose, PinholeIntrinsics } from './colmap-conversions';

/**
 * An sRGB triple (0–255 per channel). Structurally matches the framework's
 * `RgbTuple` (which is not on its public export surface) and
 * `OccupancyGrid.getCellColor()`'s return, kept local to avoid coupling to an
 * internal type.
 */
type Rgb = readonly [number, number, number];

/** One row of `images.txt` (the keypoint line is always emitted empty). */
export interface ColmapImageRecord {
  readonly imageId: number;
  readonly pose: ColmapPose;
  /** Bare image filename, e.g. `frame-000001.jpg` (resolved via `image_path`). */
  readonly name: string;
}

/** One row of `points3D.txt` (the track is always emitted empty). */
export interface ColmapPoint3DRecord {
  readonly pointId: number;
  /**
   * Point position already in the COLMAP world frame (raw WebXR run through the
   * `webxrToColmapWorldPoint` basis change — negated Y,Z — so it stays
   * registered with the camera extrinsics and loads upright).
   */
  readonly xyz: Vector3;
  readonly rgb: Rgb;
  /** Reprojection error placeholder (no real tracks → a constant). */
  readonly error: number;
}

/**
 * Serialize the single shared PINHOLE camera.
 *
 * @param width  - JPEG frame width in pixels (after any `resolutionDivisor`).
 * @param height - JPEG frame height in pixels.
 * @param intrinsics - `{ fx, fy, cx, cy }` from `pinholeFromProjection`.
 * @param cameraId - COLMAP camera id (default 1).
 */
export function serializeCamerasTxt(
  width: number,
  height: number,
  intrinsics: PinholeIntrinsics,
  cameraId = 1
): string {
  const { fx, fy, cx, cy } = intrinsics;
  const header = [
    '# Camera list with one line of data per camera:',
    '#   CAMERA_ID, MODEL, WIDTH, HEIGHT, PARAMS[]',
    '# Number of cameras: 1',
  ];
  const line = `${cameraId} PINHOLE ${fmtInt(width)} ${fmtInt(height)} ${fmt(fx)} ${fmt(fy)} ${fmt(cx)} ${fmt(cy)}`;
  return [...header, line, ''].join('\n');
}

/**
 * Serialize `images.txt`. Each image contributes two lines: the pose line
 * (`IMAGE_ID QW QX QY QZ TX TY TZ CAMERA_ID NAME`) followed by an empty
 * keypoint line (COLMAP's mandatory second line, empty because there are no
 * detected 2D features).
 *
 * @param images - per-frame pose records.
 * @param cameraId - the shared camera id every image references (default 1).
 */
export function serializeImagesTxt(
  images: readonly ColmapImageRecord[],
  cameraId = 1
): string {
  const header = [
    '# Image list with two lines of data per image:',
    '#   IMAGE_ID, QW, QX, QY, QZ, TX, TY, TZ, CAMERA_ID, NAME',
    '#   POINTS2D[] as (X, Y, POINT3D_ID)',
    `# Number of images: ${images.length}, mean observations per image: 0`,
  ];
  const lines: string[] = [...header];
  for (const img of images) {
    const [qw, qx, qy, qz] = img.pose.qvec;
    const [tx, ty, tz] = img.pose.tvec;
    lines.push(
      `${fmtInt(img.imageId)} ${fmt(qw)} ${fmt(qx)} ${fmt(qy)} ${fmt(qz)} ${fmt(tx)} ${fmt(ty)} ${fmt(tz)} ${fmtInt(cameraId)} ${img.name}`
    );
    lines.push(''); // empty keypoint line (no 2D features)
  }
  return lines.join('\n') + '\n';
}

/**
 * Serialize `points3D.txt`. Each point is one line
 * `POINT3D_ID X Y Z R G B ERROR` with an empty track (no observations).
 */
export function serializePoints3DTxt(
  points: readonly ColmapPoint3DRecord[]
): string {
  const header = [
    '# 3D point list with one line of data per point:',
    '#   POINT3D_ID, X, Y, Z, R, G, B, ERROR, TRACK[] as (IMAGE_ID, POINT2D_IDX)',
    `# Number of points: ${points.length}, mean track length: 0`,
  ];
  const lines: string[] = [...header];
  for (const p of points) {
    const [x, y, z] = p.xyz;
    const [r, g, b] = p.rgb;
    lines.push(
      `${fmtInt(p.pointId)} ${fmt(x)} ${fmt(y)} ${fmt(z)} ${clampByte(r)} ${clampByte(g)} ${clampByte(b)} ${fmt(p.error)}`
    );
  }
  return lines.join('\n') + '\n';
}

/** Format a float compactly, normalizing -0 to 0. */
function fmt(n: number): string {
  return String(n + 0);
}

/** Format an integer field (rounds defensively). */
function fmtInt(n: number): string {
  return String(Math.round(n));
}

/** Round + clamp a color channel to an integer 0–255. */
function clampByte(n: number): number {
  // Math.round(NaN) is NaN and min/max propagate it, so a non-finite channel
  // used to reach the file as the text "NaN" (simplify loop, 2026-09-04).
  if (!Number.isFinite(n)) return n > 0 ? 255 : 0;
  return Math.min(255, Math.max(0, Math.round(n)));
}
