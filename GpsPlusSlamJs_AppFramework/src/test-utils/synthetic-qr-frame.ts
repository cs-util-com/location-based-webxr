/**
 * Synthetic QR camera frames: renders a real QR symbol (node-qrcode modules)
 * at a known pose through a GL projection matrix into an `RgbaImage`, and
 * returns the exact pixel positions of the symbol's outer corners.
 *
 * Test-only. It is the ground truth for the zxing oracle and the end-to-end
 * pose tests, so it is written from the GL definitions (clip -> NDC ->
 * viewport), NOT from `qr-pose.ts`'s intrinsics helpers: sharing their
 * convention would let a convention bug confirm itself.
 * See synthetic-qr-frame.ts.md.
 */

import QRCode from 'qrcode';
import type { Matrix4, Quaternion, Vector3 } from 'gps-plus-slam-js';
import type { Point2, Pose } from '../ar/qr/qr-pose';
import type { RgbaImage } from '../ar/qr/qr-frontend';
import { QR_QUIET_ZONE_FRACTION } from '../utils/qr-payload/qr-quiet-zone';
import { gaussOf, mulberry32 } from './elevation-offset-scenarios';

/** Options for {@link perspectiveProjection}. */
export interface PerspectiveOptions {
  fovYDeg: number;
  aspect: number;
  near?: number;
  far?: number;
  /** Principal-point offset in NDC units (column-major slot 8). */
  offsetX?: number;
  /** Principal-point offset in NDC units (column-major slot 9). */
  offsetY?: number;
}

/**
 * Column-major GL perspective matrix (the `XRView.projectionMatrix` layout).
 * `offsetX/offsetY` shift the principal point, as an off-centre AR camera does.
 */
export function perspectiveProjection(options: PerspectiveOptions): Matrix4 {
  const {
    fovYDeg,
    aspect,
    near = 0.05,
    far = 100,
    offsetX = 0,
    offsetY = 0,
  } = options;
  if (!(fovYDeg > 0 && fovYDeg < 180) || !(aspect > 0) || !(far > near)) {
    throw new RangeError('synthetic-qr-frame: invalid perspective parameters');
  }
  const f = 1 / Math.tan(((fovYDeg / 2) * Math.PI) / 180);
  // prettier-ignore
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    offsetX, offsetY, (far + near) / (near - far), -1,
    0, 0, (2 * far * near) / (near - far), 0,
  ];
}

/** Options for {@link qrPoseFacingCamera}. */
export interface FacingPoseOptions {
  distanceM: number;
  /** In-plane rotation about the code's normal, degrees (CCW as seen by the camera). */
  rollDeg?: number;
  /** Tilt about the camera's x axis, degrees (top edge away from the camera for > 0). */
  tiltXDeg?: number;
  /** Tilt about the camera's y axis, degrees. */
  tiltYDeg?: number;
  /** Lateral offset of the code centre in the camera frame, metres. */
  offsetM?: readonly [number, number];
}

/**
 * A QR pose in the WebXR camera frame (+x right, +y up, -z forward). The
 * identity rotation faces the camera upright: the code's +z (out of the
 * printed face) points back at the viewer.
 */
export function qrPoseFacingCamera(options: FacingPoseOptions): Pose {
  const {
    distanceM,
    rollDeg = 0,
    tiltXDeg = 0,
    tiltYDeg = 0,
    offsetM = [0, 0],
  } = options;
  const roll = axisAngle([0, 0, 1], rollDeg);
  const tiltX = axisAngle([1, 0, 0], -tiltXDeg);
  const tiltY = axisAngle([0, 1, 0], tiltYDeg);
  const rotation = mulQuat(tiltY, mulQuat(tiltX, roll));
  return { position: [offsetM[0], offsetM[1], -distanceM], rotation };
}

/** Options for {@link renderQrFrame}. */
export interface SyntheticQrFrameOptions {
  text: string;
  /** Error-correction level; the app prints `Q`. */
  ecLevel?: 'L' | 'M' | 'Q' | 'H';
  /** Printed symbol side, metres, quiet zone EXCLUDED (the solver's `sizeM`). */
  sizeM: number;
  qrPoseInCamera: Pose;
  projection: Matrix4;
  width: number;
  height: number;
  /** NxN sub-samples per pixel (anti-aliasing). Default 3. */
  supersample?: number;
  /** Quiet zone per edge as a fraction of the symbol side. Default: the app's print value. */
  quietZoneFraction?: number;
  darkLevel?: number;
  lightLevel?: number;
  backgroundLevel?: number;
  /** Separable box-blur radius in whole pixels. Default 0. */
  blurRadiusPx?: number;
  /** Gaussian pixel noise sigma, grey levels. Default 0. */
  noiseSigma?: number;
  seed?: number;
}

/** Result of {@link renderQrFrame}. */
export interface SyntheticQrFrame {
  image: RgbaImage;
  /** Outer symbol corners (quiet zone excluded), TL, TR, BR, BL in symbol order. */
  truthCorners: [Point2, Point2, Point2, Point2];
  /** Modules per side (QR version 1 = 21). */
  moduleCount: number;
  /** Shortest projected symbol edge divided by the module count, pixels. */
  modulePx: number;
  /** Quiet-zone width per edge, in modules. */
  quietZoneModules: number;
}

/**
 * Render the frame. Pixel convention (GL viewport): continuous pixel x spans
 * [0, width] left to right, y spans [0, height] top to bottom, so pixel (i, j)
 * covers [i, i+1] x [j, j+1] and its centre is (i + 0.5, j + 0.5).
 * Throws `RangeError` on non-positive sizes or a code not in front of the camera.
 */
export function renderQrFrame(
  options: SyntheticQrFrameOptions
): SyntheticQrFrame {
  validateFrameOptions(options);
  const { text, ecLevel = 'Q', width, height, supersample = 3 } = options;
  const modules = QRCode.create(text, {
    errorCorrectionLevel: ecLevel,
  }).modules;
  const shade = createShader(modules, options);
  const camera = createCamera(options);

  const gray = new Float32Array(width * height);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      gray[j * width + i] = samplePixel(i, j, supersample, camera, shade);
    }
  }
  const radius = options.blurRadiusPx ?? 0;
  const blurred = radius > 0 ? boxBlur(gray, width, height, radius) : gray;
  return {
    image: { data: toRgba(blurred, options), width, height },
    ...symbolGeometry(camera, options, modules.size),
  };
}

/** Where the symbol's outer corners land, and its module size in pixels. */
function symbolGeometry(
  camera: SyntheticCamera,
  options: SyntheticQrFrameOptions,
  n: number
): Omit<SyntheticQrFrame, 'image'> {
  const half = options.sizeM / 2;
  const truthCorners: [Point2, Point2, Point2, Point2] = [
    camera.project(-half, half),
    camera.project(half, half),
    camera.project(half, -half),
    camera.project(-half, -half),
  ];
  let minEdge = Infinity;
  for (let k = 0; k < 4; k++) {
    const a = truthCorners[k]!;
    const b = truthCorners[(k + 1) % 4]!;
    minEdge = Math.min(minEdge, Math.hypot(b.x - a.x, b.y - a.y));
  }
  return {
    truthCorners,
    moduleCount: n,
    modulePx: minEdge / n,
    quietZoneModules: (options.quietZoneFraction ?? QR_QUIET_ZONE_FRACTION) * n,
  };
}

function validateFrameOptions(options: SyntheticQrFrameOptions): void {
  const { sizeM, width, height, supersample = 3, qrPoseInCamera } = options;
  if (!(sizeM > 0) || !Number.isFinite(sizeM)) {
    throw new RangeError(`synthetic-qr-frame: sizeM must be > 0, got ${sizeM}`);
  }
  if (![width, height].every((d) => Number.isInteger(d) && d > 0)) {
    throw new RangeError(
      'synthetic-qr-frame: width and height must be positive integers'
    );
  }
  if (!Number.isInteger(supersample) || supersample < 1) {
    throw new RangeError(
      'synthetic-qr-frame: supersample must be an integer >= 1'
    );
  }
  if (!(qrPoseInCamera.position[2] < 0)) {
    throw new RangeError(
      'synthetic-qr-frame: the code must be in front of the camera (z < 0)'
    );
  }
}

type Shader = (lx: number, ly: number) => number;

/** Grey level at a point of the code's plane, in the code's local frame (m). */
function createShader(
  modules: { size: number; get(row: number, col: number): number },
  options: SyntheticQrFrameOptions
): Shader {
  const {
    sizeM,
    quietZoneFraction = QR_QUIET_ZONE_FRACTION,
    darkLevel = 16,
    lightLevel = 240,
    backgroundLevel = 128,
  } = options;
  const n = modules.size;
  const half = sizeM / 2;
  const outer = half + quietZoneFraction * sizeM;
  return (lx, ly) => {
    const col = Math.floor(((lx + half) / sizeM) * n);
    const row = Math.floor(((half - ly) / sizeM) * n);
    if (col >= 0 && col < n && row >= 0 && row < n) {
      return modules.get(row, col) ? darkLevel : lightLevel;
    }
    const inQuietZone = Math.abs(lx) <= outer && Math.abs(ly) <= outer;
    return inQuietZone ? lightLevel : backgroundLevel;
  };
}

interface SyntheticCamera {
  /** Grey level seen through continuous pixel (px, py). */
  shadeAt(px: number, py: number, shade: Shader): number;
  /** Pixel of the point (x, y, 0) in the code's local frame. */
  project(x: number, y: number): Point2;
}

/** GL camera through `projection`, looking at the code plane at `qrPoseInCamera`. */
function createCamera(options: SyntheticQrFrameOptions): SyntheticCamera {
  const {
    qrPoseInCamera,
    projection: P,
    width,
    height,
    backgroundLevel = 128,
  } = options;
  const c = qrPoseInCamera.position;
  const r = rotationMatrix(qrPoseInCamera.rotation);
  // Face normal (code +z) in the camera frame, and n.c for the plane equation.
  const [nx, ny, nz] = [r[2], r[5], r[8]];
  const nDotC = nx * c[0] + ny * c[1] + nz * c[2];
  const [p0, p5, p8, p9] = [P[0], P[5], P[8], P[9]];
  return {
    shadeAt(px, py, shade) {
      // Ray (dx, dy, -1) from the camera origin through the pixel.
      const dx = ((2 * px) / width - 1 + p8) / p0;
      const dy = (1 - (2 * py) / height + p9) / p5;
      const nDotD = nx * dx + ny * dy - nz;
      if (!(nDotD < 0)) return backgroundLevel; // parallel, or the back face
      const t = nDotC / nDotD;
      const rx = t * dx - c[0];
      const ry = t * dy - c[1];
      const rz = -t - c[2];
      // Into the code's local frame: R^T * (p - c).
      return shade(
        r[0] * rx + r[3] * ry + r[6] * rz,
        r[1] * rx + r[4] * ry + r[7] * rz
      );
    },
    project(lx, ly) {
      const x = r[0] * lx + r[1] * ly + c[0];
      const y = r[3] * lx + r[4] * ly + c[1];
      const z = r[6] * lx + r[7] * ly + c[2];
      const ndcX = (p0 * x + p8 * z) / -z;
      const ndcY = (p5 * y + p9 * z) / -z;
      return { x: ((ndcX + 1) * width) / 2, y: ((1 - ndcY) * height) / 2 };
    },
  };
}

/** Mean grey level over NxN sub-samples of pixel (i, j). */
function samplePixel(
  i: number,
  j: number,
  supersample: number,
  camera: SyntheticCamera,
  shade: Shader
): number {
  const step = 1 / supersample;
  let acc = 0;
  for (let sy = 0; sy < supersample; sy++) {
    for (let sx = 0; sx < supersample; sx++) {
      acc += camera.shadeAt(
        i + (sx + 0.5) * step,
        j + (sy + 0.5) * step,
        shade
      );
    }
  }
  return acc / (supersample * supersample);
}

/** Grey -> opaque RGBA, with optional seeded Gaussian noise. */
function toRgba(
  gray: Float32Array,
  options: SyntheticQrFrameOptions
): Uint8ClampedArray {
  const { noiseSigma = 0, seed = 1 } = options;
  const data = new Uint8ClampedArray(gray.length * 4);
  const rng = mulberry32(seed);
  for (let k = 0; k < gray.length; k++) {
    const noise = noiseSigma > 0 ? gaussOf(rng) * noiseSigma : 0;
    const v = Math.round((gray[k] ?? 0) + noise);
    data[k * 4] = v;
    data[k * 4 + 1] = v;
    data[k * 4 + 2] = v;
    data[k * 4 + 3] = 255;
  }
  return data;
}

/** Row-major 3x3 rotation matrix of a unit quaternion [x, y, z, w]. */
type Mat3 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

function rotationMatrix(q: Quaternion): Mat3 {
  const [x, y, z, w] = q;
  // prettier-ignore
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
}

function axisAngle(axis: Vector3, deg: number): Quaternion {
  const h = (deg * Math.PI) / 360;
  const s = Math.sin(h);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(h)];
}

function mulQuat(a: Quaternion, b: Quaternion): Quaternion {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** Separable box blur with clamped edges. */
function boxBlur(
  src: Float32Array,
  width: number,
  height: number,
  r: number
): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const norm = 1 / (2 * r + 1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) {
        const xx = Math.min(width - 1, Math.max(0, x + k));
        s += src[y * width + xx] ?? 0;
      }
      tmp[y * width + x] = s * norm;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) {
        const yy = Math.min(height - 1, Math.max(0, y + k));
        s += tmp[yy * width + x] ?? 0;
      }
      out[y * width + x] = s * norm;
    }
  }
  return out;
}
