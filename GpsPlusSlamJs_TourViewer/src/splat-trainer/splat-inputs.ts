/**
 * From a recording's captures to what Splat.js trains one window on: each
 * photo's camera in Splat.js's OpenCV world-to-camera form (in the raw
 * WebXR world, so the trained splat shares the recording's frame), seeds
 * from the walk's depth readings and a far background shell, both coloured
 * from the photos, and the window's job: which photos load, which are only
 * scored, how many steps and how long. Pure: photo colours come in through
 * a sampler the caller builds from the decoded photo.
 *
 * @see splat-inputs.ts.md
 */

import type { Quaternion, Vector3 } from "gps-plus-slam-app-framework/core";
import { createDepthUnprojector } from "gps-plus-slam-app-framework/ar/depth-unprojection";
import { rotateVectorByQuaternion } from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import type { DepthSample } from "gps-plus-slam-app-framework/state";
import type { PinholeIntrinsics } from "gps-plus-slam-app-framework/utils/pinhole-from-projection";

import type { SplatInputs } from "./recording-reader.js";
import type { SeedPoint, SplatCameraEntry } from "./splat-js.js";
import { requirePositive } from "./splat-math.js";
import type { TrainerSettings } from "./trainer-defaults.js";
import { iterationBudget } from "./training-budget.js";
import type { PlannedWindow } from "./window-plan.js";

/** A raw WebXR camera-to-world pose (the camera looks along its -z). */
export interface CameraPose {
  readonly position: Vector3;
  readonly rotation: Quaternion;
}

/** The colour (each channel 0 to 1) of a photo at pixel (u, v), continuous
 *  coordinates; null off the photo. */
export type ColourAt = (
  u: number,
  v: number,
) => readonly [number, number, number] | null;

/** One photo of a window's job. */
export interface WindowPhoto {
  /** The name Splat.js knows the photo by (unique within the job). */
  readonly name: string;
  /** The photo's entry in the recording zip. */
  readonly entry: string;
  /** False for a held-out photo: scored, never trained on. */
  readonly train: boolean;
  readonly camera: SplatCameraEntry;
  /** The photo's raw WebXR pose, for its shell points. */
  readonly pose: CameraPose;
  /** The depth samples taken with this photo (training photos only). */
  readonly depth: readonly DepthSample[];
  /** True when this photo grows background shell points. */
  readonly shell: boolean;
}

/** Everything the worker needs to train one window, apart from the photo
 *  bytes. Structured-clonable. */
export interface WindowJob {
  readonly photos: readonly WindowPhoto[];
  /** The held-out photos' names: Splat.js's test set. */
  readonly evalFrames: readonly string[];
  readonly maxIters: number;
  readonly deadlineMs: number;
  /** Time allowed to prepare the graphics card before the run fails (ms). */
  readonly prepareCapMs: number;
  /** The shell crop keeps splats within this distance of a training
   *  camera (m). */
  readonly keepM: number;
  readonly trainPositions: readonly Vector3[];
  readonly seedVoxelM: number;
  readonly shellVoxelM: number;
  readonly shellDistanceM: number;
  readonly shellGridPx: number;
  readonly etaMinIterations: number;
}

/** WebXR camera axes (y up, z back) to OpenCV (y down, z forward). */
const FLIP = [1, -1, -1] as const;

/** The camera of one photo: R = FLIP * R_c2w^T, t = -R * position. */
export function splatCamera(
  image: string,
  pose: CameraPose,
  K: PinholeIntrinsics,
  width: number,
  height: number,
): SplatCameraEntry {
  const [qx, qy, qz, qw] = pose.rotation;
  const inverse: Quaternion = [-qx, -qy, -qz, qw];
  // Row r of R_c2w^T is the world axis r seen from the camera, i.e. the
  // inverse rotation applied to the unit vectors, column by column.
  const cols = [
    rotateVectorByQuaternion(inverse, [1, 0, 0]),
    rotateVectorByQuaternion(inverse, [0, 1, 0]),
    rotateVectorByQuaternion(inverse, [0, 0, 1]),
  ];
  const R: number[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      R.push((FLIP[r] ?? 1) * (cols[c]?.[r] ?? 0));
    }
  }
  const t = [0, 1, 2].map(
    (r) =>
      -(
        (R[r * 3] ?? 0) * pose.position[0] +
        (R[r * 3 + 1] ?? 0) * pose.position[1] +
        (R[r * 3 + 2] ?? 0) * pose.position[2]
      ),
  );
  return {
    image,
    R_w2c_rowmajor: R,
    t_w2c: t,
    fx: K.fx,
    fy: K.fy,
    cx: K.cx,
    cy: K.cy,
    width,
    height,
  };
}

/**
 * Seeds from depth samples taken with one photo of `width` x `height`:
 * each reading at its unprojected world position, coloured by the photo
 * at the reading's pixel. Readings without depth, off the photo or that
 * the photo has no colour for are dropped; a sample without a usable
 * projection is skipped.
 */
export function depthSeeds(
  samples: readonly DepthSample[],
  width: number,
  height: number,
  colourAt: ColourAt,
): SeedPoint[] {
  const out: SeedPoint[] = [];
  for (const s of samples) {
    const un = createDepthUnprojector(
      s.cameraPos,
      s.cameraRot,
      s.projectionMatrix,
    );
    if (un === null) continue;
    for (const p of s.points) {
      const X = un.unproject(p);
      if (X === null) continue;
      const rgb = colourAt(p.screenX * width, p.screenY * height);
      if (rgb === null) continue;
      out.push({ X: [X[0], X[1], X[2]], rgb: [rgb[0], rgb[1], rgb[2]] });
    }
  }
  return out;
}

/**
 * A far background shell for one photo: one point per `gridPx` square at
 * `distanceM` along the square centre's ray, coloured by that pixel. It
 * gives sky and far facades something to start from where depth readings
 * never reach; the shell crop removes what the window does not keep.
 * Throws a RangeError for a distance or grid that is not positive.
 */
export function shellSeeds(
  pose: CameraPose,
  K: PinholeIntrinsics,
  width: number,
  height: number,
  opts: { readonly distanceM: number; readonly gridPx: number },
  colourAt: ColourAt,
): SeedPoint[] {
  requirePositive("distanceM", opts.distanceM);
  if (!(opts.gridPx >= 1)) {
    throw new RangeError(
      `gridPx must be at least 1, got ${String(opts.gridPx)}`,
    );
  }
  const g = opts.gridPx;
  const out: SeedPoint[] = [];
  for (let y0 = 0; y0 + g <= height; y0 += g) {
    for (let x0 = 0; x0 + g <= width; x0 += g) {
      const u = x0 + g / 2;
      const v = y0 + g / 2;
      const rgb = colourAt(u, v);
      if (rgb === null) continue;
      // The pixel's ray in the WebXR camera frame (y up, looking along -z).
      const ray: Vector3 = [(u - K.cx) / K.fx, -(v - K.cy) / K.fy, -1];
      const s = opts.distanceM / Math.hypot(...ray);
      const d = rotateVectorByQuaternion(pose.rotation, [
        ray[0] * s,
        ray[1] * s,
        ray[2] * s,
      ]);
      out.push({
        X: [
          d[0] + pose.position[0],
          d[1] + pose.position[1],
          d[2] + pose.position[2],
        ],
        rgb: [rgb[0], rgb[1], rgb[2]],
      });
    }
  }
  return out;
}

/** Points sharing a cube of side `voxelM` merged into their mean, in
 *  first-seen order. Throws a RangeError for a size that is not positive. */
export function voxelThin(
  points: readonly SeedPoint[],
  voxelM: number,
): SeedPoint[] {
  requirePositive("voxelM", voxelM);
  const acc = new Map<string, { n: number; s: number[] }>();
  for (const p of points) {
    const key = p.X.map((c) => Math.floor(c / voxelM)).join(",");
    let a = acc.get(key);
    if (a === undefined) {
      a = { n: 0, s: [0, 0, 0, 0, 0, 0] };
      acc.set(key, a);
    }
    a.n++;
    for (let k = 0; k < 3; k++) {
      a.s[k] = (a.s[k] ?? 0) + (p.X[k] ?? 0);
      a.s[k + 3] = (a.s[k + 3] ?? 0) + (p.rgb[k] ?? 0);
    }
  }
  return [...acc.values()].map(({ n, s }) => ({
    X: [(s[0] ?? 0) / n, (s[1] ?? 0) / n, (s[2] ?? 0) / n],
    rgb: [(s[3] ?? 0) / n, (s[4] ?? 0) / n, (s[5] ?? 0) / n],
  }));
}

/** The samples taken within `maxDtMs` of `capturedAt`; none for an
 *  untimed photo. */
export function depthNear(
  capturedAt: number | null,
  samples: readonly DepthSample[],
  maxDtMs: number,
): DepthSample[] {
  if (capturedAt === null) return [];
  return samples.filter((s) => Math.abs(s.timestamp - capturedAt) <= maxDtMs);
}

/** The name Splat.js knows frame `index` by. */
const photoName = (index: number): string =>
  `frame-${String(index).padStart(6, "0")}.jpg`;

/**
 * One window's job: its training photos and its held-out photos in frame
 * order, each with its camera; the depth samples and shell flag of the
 * training photos; the step budget for its training photo count; a
 * deadline of `deadlineS` and a preparation cap of `prepareCapS`, both
 * times `timeScale` (a scale that is not a positive number counts as 1);
 * and the shell crop's distance.
 */
export function planWindowJob(
  inputs: SplatInputs,
  planned: PlannedWindow,
  timeScale: number,
  settings: TrainerSettings,
): WindowJob {
  const { frameWidth: width, frameHeight: height } = inputs.census;
  const train = new Set(planned.window.train);
  const frames = [
    ...new Set([...planned.window.train, ...planned.window.holdouts]),
  ].sort((a, b) => a - b);
  let trainSeen = 0;
  const photos: WindowPhoto[] = [];
  for (const i of frames) {
    const c = inputs.captures[i];
    if (c === undefined) continue;
    const isTrain = train.has(i);
    const name = photoName(i);
    const shell = isTrain && trainSeen % settings.shellEveryPhoto === 0;
    if (isTrain) trainSeen++;
    photos.push({
      name,
      entry: c.entry,
      train: isTrain,
      camera: splatCamera(name, c, inputs.intrinsics, width, height),
      pose: { position: c.position, rotation: c.rotation },
      depth: isTrain
        ? depthNear(c.capturedAt, inputs.depthSamples, settings.depthMaxDtMs)
        : [],
      shell,
    });
  }
  const scale = Number.isFinite(timeScale) && timeScale > 0 ? timeScale : 1;
  const trainPhotos = photos.filter((p) => p.train);
  return {
    photos,
    evalFrames: photos.filter((p) => !p.train).map((p) => p.name),
    maxIters: iterationBudget(trainPhotos.length, settings),
    deadlineMs: settings.deadlineS * 1000 * scale,
    prepareCapMs: settings.prepareCapS * 1000 * scale,
    keepM: settings.keepFraction * settings.shellDistanceM,
    trainPositions: frames
      .filter((i) => train.has(i))
      .flatMap((i) => {
        const c = inputs.captures[i];
        return c === undefined ? [] : [c.position];
      }),
    seedVoxelM: settings.seedVoxelM,
    shellVoxelM: settings.shellVoxelM,
    shellDistanceM: settings.shellDistanceM,
    shellGridPx: settings.shellGridPx,
    etaMinIterations: settings.etaMinIterations,
  };
}
