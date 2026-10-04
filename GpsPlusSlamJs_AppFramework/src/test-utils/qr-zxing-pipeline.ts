/**
 * Real-decoder QR pipeline harness: zxing-wasm corners -> the production pose
 * pipeline (`solveQrPose` + `PlanarPnpSquare` + `intrinsicsFromProjection`),
 * scored against a synthetic frame's known truth.
 *
 * Test-only; shared by the gate tests (`ar/qr/qr-zxing-oracle.test.ts`) and
 * the opt-in sweep (`ar/qr/qr-zxing.sweep.test.ts`). See qr-zxing-pipeline.ts.md.
 */

import type { Matrix4, Quaternion } from 'gps-plus-slam-js';
import type { ReaderOptions } from 'zxing-wasm/reader';
import type { QrDetection, RgbaImage } from '../ar/qr/qr-frontend';
import {
  intrinsicsFromProjection,
  solveQrPose,
  type Point2,
  type Pose,
} from '../ar/qr/qr-pose';
import { PlanarPnpSquare } from '../ar/qr/planar-pnp';
import type { SyntheticQrFrame } from './synthetic-qr-frame';
import { readQrCodes } from './zxing-node';

/**
 * A `detect` function with the detection controller's signature, backed by
 * zxing. Corners are zxing's `position` in symbol order (TL, TR, BR, BL):
 * symbol-relative, so they follow the code's own orientation, not the image's.
 */
export async function zxingDetect(
  image: RgbaImage,
  options: ReaderOptions = {}
): Promise<QrDetection | null> {
  const results = await readQrCodes(image, options);
  const first = results.find((r) => r.isValid && r.text.length > 0);
  if (!first) return null;
  const p = first.position;
  return {
    text: first.text,
    corners: [
      { x: p.topLeft.x, y: p.topLeft.y },
      { x: p.topRight.x, y: p.topRight.y },
      { x: p.bottomRight.x, y: p.bottomRight.y },
      { x: p.bottomLeft.x, y: p.bottomLeft.y },
    ],
  };
}

/** Angle of the relative rotation between two unit quaternions, degrees. */
export function rotationAngleDeg(a: Quaternion, b: Quaternion): number {
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
}

/** The truth a synthetic frame was rendered from. */
export interface PipelineTruth {
  text: string;
  sizeM: number;
  qrPoseInCamera: Pose;
  projection: Matrix4;
}

/** One frame's outcome. Error fields are `null` where the stage did not run. */
export interface PipelineMeasurement {
  /** zxing returned the rendered text. */
  decoded: boolean;
  decodeMs: number;
  /** Largest corner distance to truth, px. */
  maxCornerErrPx: number | null;
  /** Mean signed corner error (detected - truth) per axis, px. */
  meanSignedErrX: number | null;
  meanSignedErrY: number | null;
  /** `solveQrPose` accepted the detection; errors vs the truth pose. */
  rotationErrDeg: number | null;
  positionErrCm: number | null;
  reprojectionErrPx: number | null;
}

const IDENTITY_CAMERA: Pose = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
const SOLVER = new PlanarPnpSquare();

/** Decode `frame` with zxing, solve the pose, and score both against `truth`. */
export async function measureZxingPipeline(
  frame: SyntheticQrFrame,
  truth: PipelineTruth,
  options: ReaderOptions = {}
): Promise<PipelineMeasurement> {
  const t0 = performance.now();
  const detection = await zxingDetect(frame.image, options);
  const decodeMs = performance.now() - t0;
  if (!detection || detection.text !== truth.text) {
    return {
      decoded: false,
      decodeMs,
      maxCornerErrPx: null,
      meanSignedErrX: null,
      meanSignedErrY: null,
      rotationErrDeg: null,
      positionErrCm: null,
      reprojectionErrPx: null,
    };
  }
  let maxErr = 0;
  let sumX = 0;
  let sumY = 0;
  detection.corners.forEach((c: Point2, k: number) => {
    const t = frame.truthCorners[k]!;
    maxErr = Math.max(maxErr, Math.hypot(c.x - t.x, c.y - t.y));
    sumX += c.x - t.x;
    sumY += c.y - t.y;
  });
  const solution = solveQrPose({
    imagePoints: detection.corners,
    sizeM: truth.sizeM,
    intrinsics: intrinsicsFromProjection(
      truth.projection,
      frame.image.width,
      frame.image.height
    ),
    cameraPose: IDENTITY_CAMERA,
    solver: SOLVER,
  });
  const solved = solution?.qrPoseInCamera;
  const tp = truth.qrPoseInCamera.position;
  return {
    decoded: true,
    decodeMs,
    maxCornerErrPx: maxErr,
    meanSignedErrX: sumX / 4,
    meanSignedErrY: sumY / 4,
    rotationErrDeg: solved
      ? rotationAngleDeg(solved.rotation, truth.qrPoseInCamera.rotation)
      : null,
    positionErrCm: solved
      ? 100 *
        Math.hypot(
          solved.position[0] - tp[0],
          solved.position[1] - tp[1],
          solved.position[2] - tp[2]
        )
      : null,
    reprojectionErrPx: solution?.reprojectionErrorPx ?? null,
  };
}
