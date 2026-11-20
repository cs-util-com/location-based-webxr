/**
 * Writes a walk through the synthetic splat scene as a recorder-shaped
 * zip: `session.json`, one action file per recorded action (a packed
 * depth sample and a photo capture per frame, as the Recorder writes
 * them) and the frames' photos under `images/`. Works in a browser and
 * in node: the photos come in as bytes.
 *
 * @see splat-scene-zip.ts.md
 */
import type { DepthSample } from "gps-plus-slam-app-framework/state";
import {
  packFilesAsZip,
  type ZipEntryInput,
} from "gps-plus-slam-app-framework/storage";
import {
  DEPTH_SAMPLE_ACTION_TYPE,
  packDepthAction,
} from "gps-plus-slam-app-framework/storage/depth-sample-codec";

import {
  CAPTURE_ACTION,
  NEWEST_KNOWN_ODOM_COORD_VERSION,
} from "../../capture-geo-join.js";

/** One frame of the walk: its photo and the depth measured with it. */
export interface SceneFrame {
  /** The photo, JPEG bytes. */
  readonly jpeg: Uint8Array;
  /** The depth sample, whose pose and time are the photo's too. */
  readonly depth: DepthSample;
}

/**
 * The zip of `frames`, photos of `width` x `height`, named `name`. Throws
 * a RangeError for no frames or a size that is not a positive integer.
 */
export async function zipSceneWalk(
  frames: readonly SceneFrame[],
  width: number,
  height: number,
  name = "synthetic-scene.zip",
): Promise<File> {
  if (frames.length === 0) throw new RangeError("A walk needs a frame");
  for (const [label, v] of [
    ["width", width],
    ["height", height],
  ] as const) {
    if (!Number.isInteger(v) || v < 1) {
      throw new RangeError(
        `${label} must be a positive integer, got ${String(v)}`,
      );
    }
  }
  const entries: ZipEntryInput[] = [
    {
      path: "session.json",
      data: JSON.stringify({
        odomCoordVersion: NEWEST_KNOWN_ODOM_COORD_VERSION,
      }),
    },
  ];
  const actions: unknown[] = [];
  frames.forEach((frame, i) => {
    const imageFile = photoEntryName(i);
    actions.push(
      packDepthAction({ type: DEPTH_SAMPLE_ACTION_TYPE, payload: frame.depth }),
    );
    actions.push({
      type: CAPTURE_ACTION,
      payload: {
        imageFile,
        position: frame.depth.cameraPos,
        rotation: frame.depth.cameraRot,
        screenRotation: 0,
        capturedAt: frame.depth.timestamp,
        width,
        height,
      },
    });
    entries.push({ path: imageFile, data: frame.jpeg });
  });
  entries.push(...actionEntries(actions));
  const blob = await packFilesAsZip(entries);
  return new File([blob], name, { type: "application/zip" });
}

/** The zip entry name of the photo of capture `index` (0-based), as the
 *  Recorder names it: `images/frame-000001.jpg` for the first. */
export function photoEntryName(index: number): string {
  return `images/frame-${pad6(index + 1)}.jpg`;
}

/** One zip entry per recorded action, `actions/000001.json` on, in
 *  order, as the Recorder writes them, inside `folder` (with its slash). */
export function actionEntries(
  actions: readonly unknown[],
  folder = "",
): ZipEntryInput[] {
  return actions.map((action, i) => ({
    path: `${folder}actions/${pad6(i + 1)}.json`,
    data: JSON.stringify(action),
  }));
}

function pad6(n: number): string {
  return String(n).padStart(6, "0");
}
