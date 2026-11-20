/**
 * TEST ONLY: a recorder-shaped zip built in memory from a synthetic walk,
 * so the splat trainer's reader is tested without a binary fixture and
 * without any real recording. A straight walk along +x at eye height,
 * looking ahead and slightly down, turning a little further right at every
 * capture (so no two captures share a rotation); one depth sample per
 * capture on the sampler's grid (written packed, as the Recorder writes
 * it), whose lens fits the photos' shape; tiny placeholder photos that are
 * not decodable images.
 */
import type {
  Matrix4,
  Quaternion,
  Vector3,
} from "gps-plus-slam-app-framework/core";
import type {
  DepthPoint,
  DepthSample,
} from "gps-plus-slam-app-framework/state";
import {
  packFilesAsZip,
  type ZipEntryInput,
} from "gps-plus-slam-app-framework/storage";
import { packDepthAction } from "gps-plus-slam-app-framework/storage/depth-sample-codec";
import { lookAtPose } from "gps-plus-slam-app-framework/test-utils/synthetic-qr-walk";

import {
  actionEntries,
  photoEntryName,
} from "../checks/splat-scene/splat-scene-zip.js";

/** A JPEG's start and end markers: enough bytes to be a photo entry. */
const PLACEHOLDER_PHOTO = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

export interface SyntheticRecordingOptions {
  /** Camera captures along the walk (default 6). */
  readonly frames?: number;
  /** Metres between consecutive captures (default 0.5). */
  readonly spacingM?: number;
  /** Milliseconds between consecutive captures (default 1000); a negative
   *  value makes the capture times run against the recorded order. */
  readonly intervalMs?: number;
  /** `session.json` `odomCoordVersion`; `undefined` leaves the field out,
   *  `"no-session"` leaves `session.json` out (default 5). */
  readonly era?: unknown;
  /** A folder every entry is wrapped in, with its slash (default none). */
  readonly folder?: string;
  /** The photo size the capture at `index` records; null records none
   *  (default 64 x 48 for every capture). */
  readonly frameSizeAt?: (
    index: number,
  ) => { readonly width: number; readonly height: number } | null;
  /** Depth samples written at all (default true). */
  readonly depth?: boolean;
  /** Depth samples written packed, as the Recorder writes them (default true). */
  readonly packDepth?: boolean;
  /** The projection of the depth sample at `index`; null writes the
   *  sample without one (default `SYNTHETIC_PROJECTION` for every sample). */
  readonly projectionAt?: (index: number) => Matrix4 | null;
  /** Depth samples written (unpacked) with camera positions that are not
   *  numbers, their lens intact (default false). */
  readonly brokenDepthPose?: boolean;
  /** Capture indices whose photo the zip does not carry. */
  readonly missingPhotos?: readonly number[];
  /** An action type written once in the middle of the walk. */
  readonly midWalkActionType?: string;
  /** Extra entries written beside the recording. */
  readonly extraEntries?: readonly ZipEntryInput[];
}

export interface SyntheticRecording {
  readonly file: File;
  /** The poses the captures recorded, raw WebXR, in walk order. */
  readonly poses: readonly { position: Vector3; rotation: Quaternion }[];
  /** The capture times, epoch milliseconds. */
  readonly capturedAt: readonly number[];
  /** Each capture's photo entry name, as the zip carries it. */
  readonly photoEntries: readonly string[];
  /** The depth samples as dispatched (points unpacked). */
  readonly depthSamples: readonly DepthSample[];
}

/** The sampler's grid side for the synthetic samples. */
export const SYNTHETIC_DEPTH_GRID = 4;
/** The photo size every capture records by default. */
export const SYNTHETIC_FRAME_SIZE = { width: 64, height: 48 } as const;

/**
 * A perspective projection (column-major, float32 values as a device
 * records them) whose frustum has the default photos' aspect, so their
 * pixels come out square: about 69 degrees vertical field of view, near
 * 0.1 m, far 100 m, centred.
 */
export const SYNTHETIC_PROJECTION: Matrix4 = (() => {
  const f = 1 / Math.tan(0.6);
  const aspect = SYNTHETIC_FRAME_SIZE.width / SYNTHETIC_FRAME_SIZE.height;
  const near = 0.1;
  const far = 100;
  const m = new Array<number>(16).fill(0);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m.map(Math.fround) as unknown as Matrix4;
})();
/** The walk's first capture time. */
const SYNTHETIC_T0_MS = 1_700_000_000_000;
/** The File's last-modified time. */
export const SYNTHETIC_LAST_MODIFIED = 1_700_000_100_000;

/** A full g x g depth grid at the sampler's positions, float32 depths. */
function gridPoints(g: number, frame: number): DepthPoint[] {
  const points: DepthPoint[] = [];
  for (let row = 0; row < g; row++) {
    for (let col = 0; col < g; col++) {
      points.push({
        screenX: (col + 1) / (g + 1),
        screenY: (row + 1) / (g + 1),
        depthM: Math.fround(2 + 0.25 * row + 0.01 * frame),
      });
    }
  }
  return points;
}

/** Build the synthetic recording's zip. */
export async function buildSyntheticRecording(
  options: SyntheticRecordingOptions = {},
): Promise<SyntheticRecording> {
  const frames = options.frames ?? 6;
  const spacingM = options.spacingM ?? 0.5;
  const intervalMs = options.intervalMs ?? 1000;
  const folder = options.folder ?? "";
  const missing = new Set(options.missingPhotos ?? []);
  const era = "era" in options ? options.era : 5;

  const entries: ZipEntryInput[] = [];
  const actions: unknown[] = [];
  const poses: { position: Vector3; rotation: Quaternion }[] = [];
  const capturedAt: number[] = [];
  const photoEntries: string[] = [];
  const depthSamples: DepthSample[] = [];

  for (let i = 0; i < frames; i++) {
    const eye: [number, number, number] = [i * spacingM, 1.5, 0];
    const pose = lookAtPose(eye, [eye[0] + 0.3 * i, 1, -3]);
    const position = pose.position;
    const rotation = pose.rotation;
    const time = SYNTHETIC_T0_MS + i * intervalMs;
    if (options.depth ?? true) {
      const projection =
        options.projectionAt === undefined
          ? SYNTHETIC_PROJECTION
          : options.projectionAt(i);
      const sample: DepthSample = {
        timestamp: time,
        cameraPos:
          options.brokenDepthPose === true
            ? (["x", "y", "z"] as unknown as Vector3)
            : position,
        cameraRot: rotation,
        points: gridPoints(SYNTHETIC_DEPTH_GRID, i),
        ...(projection === null ? {} : { projectionMatrix: projection }),
      };
      depthSamples.push(sample);
      const action = { type: "recording/recordDepthSample", payload: sample };
      actions.push(
        (options.packDepth ?? true) && options.brokenDepthPose !== true
          ? packDepthAction(action)
          : action,
      );
    }
    if (
      options.midWalkActionType !== undefined &&
      i === Math.floor(frames / 2)
    ) {
      actions.push({ type: options.midWalkActionType, payload: {} });
    }
    const frameSize =
      options.frameSizeAt === undefined
        ? SYNTHETIC_FRAME_SIZE
        : options.frameSizeAt(i);
    const imageFile = photoEntryName(i);
    actions.push({
      type: "gpsData/add2dImage",
      payload: {
        imageFile,
        position,
        rotation,
        screenRotation: 0,
        capturedAt: time,
        ...(frameSize === null ? {} : frameSize),
      },
    });
    poses.push({ position, rotation });
    capturedAt.push(time);
    photoEntries.push(`${folder}${imageFile}`);
    if (!missing.has(i)) {
      entries.push({ path: `${folder}${imageFile}`, data: PLACEHOLDER_PHOTO });
    }
  }

  if (era !== "no-session") {
    entries.push({
      path: `${folder}session.json`,
      data: JSON.stringify(era === undefined ? {} : { odomCoordVersion: era }),
    });
  }
  entries.push(...actionEntries(actions, folder));
  entries.push(...(options.extraEntries ?? []));

  const blob = await packFilesAsZip(entries);
  const file = new File([blob], "synthetic-recording.zip", {
    type: "application/zip",
    lastModified: SYNTHETIC_LAST_MODIFIED,
  });
  return { file, poses, capturedAt, photoEntries, depthSamples };
}
