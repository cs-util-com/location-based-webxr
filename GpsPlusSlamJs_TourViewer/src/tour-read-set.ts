/**
 * What a visitor of a tour reads, and the creator's walk a visitor never
 * reads (scan-pass plan S1, S-D10): the walk recording's own files minus
 * the photos a visitor sees. The Finish leaves the walk out of the
 * published copy by default, and a visitor's page leaves it out too.
 *
 * @see tour-read-set.ts.md
 */

import { qrLevelIdFromEntryName } from "gps-plus-slam-app-framework/ar/qr/qr-level-archive";
import { TOUR_MANIFEST_ENTRY } from "gps-plus-slam-app-framework/ar/tour-archive";
import {
  tourItems,
  type TourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { signedManifestFilesOf } from "gps-plus-slam-app-framework/ar/tour-signed-manifest";
import {
  LEGACY_SESSION_IMAGES_DIR,
  SESSION_IMAGES_DIR,
} from "gps-plus-slam-app-framework/storage/file-system-utils";

import type { ViewerMode } from "./mode.js";
import { tourUnfinished } from "./tour-unfinished.js";

/**
 * The entries of `entryNames` a visitor reads: `tour.json`, every code
 * level, the signed list and its signature, the content files the manifest
 * names (under `wrap`, the tour's folder), and the recorded photos it baked
 * spots for. Nothing else: a visitor never shows the zip's other images.
 */
export function visitorEntryNames(
  entryNames: readonly string[],
  manifest: TourManifest,
  wrap: string,
): Set<string> {
  const named = new Set<string>([
    `${wrap}${TOUR_MANIFEST_ENTRY}`,
    ...signedManifestFilesOf(entryNames),
    ...tourItems(manifest).flatMap((o) =>
      o.kind === "photo" ? [`${wrap}${o.image}`] : [],
    ),
    ...manifest.assets.map((a) => `${wrap}${a.path}`),
    ...(manifest.captureSpots?.captures.map((c) => c.image) ?? []),
  ]);
  return new Set(
    entryNames.filter(
      (name) => named.has(name) || qrLevelIdFromEntryName(name) !== null,
    ),
  );
}

/** A recorded frame: `frame-NNNNNN.<ext>` in the recording's images
 *  folder (`images/`, or `frames/` in legacy recordings). */
const RECORDED_FRAME = new RegExp(
  String.raw`(^|/)(${SESSION_IMAGES_DIR}|${LEGACY_SESSION_IMAGES_DIR})/frame-\d+\.[A-Za-z0-9]+$`,
);

/** The recording's action stream: the walk itself. */
const ACTION_ENTRY = /(^|\/)actions\//;

/**
 * The folders the Recorder's zip contributors add beside the recording:
 * the COLMAP export (`sparse/`: the occupancy point cloud and every frame's
 * camera pose) and the reference points (`refPoints/`: timestamped GPS
 * points). Both are the scan. `recorder-walk-folders.test.ts` reads the
 * Recorder's contributors and fails when one is added without a decision.
 */
const RECORDER_SCAN_FOLDER = /(^|\/)(sparse|refPoints)\//;

/** An entry a recording writes: its `session.json`, its action stream,
 *  its frames, and the Recorder's scan folders. Depth samples travel
 *  inside the actions. */
function isRecordingEntry(name: string): boolean {
  return (
    name === "session.json" ||
    name.endsWith("/session.json") ||
    ACTION_ENTRY.test(name) ||
    RECORDED_FRAME.test(name) ||
    RECORDER_SCAN_FOLDER.test(name)
  );
}

/**
 * The walk recording's own entries in this archive, in archive order -
 * every one, the frames a visitor sees included: what makes the walk a
 * complete recording in a file of its own (the editor's "Move the walk
 * out", the M4b milestone review #8). None without an action stream.
 */
export function recordingEntryNames(entryNames: readonly string[]): string[] {
  // No action stream, no walk: a session.json or frame-named image of the
  // tour's own is then just a file.
  if (!entryNames.some((name) => ACTION_ENTRY.test(name))) return [];
  return entryNames.filter(isRecordingEntry);
}

/**
 * The creator's walk in this archive, in archive order: the recording's own
 * entries (`session.json`, `actions/`, recorded frames) that a visitor
 * never reads - a baked photo stays. What
 * a lean Finish removes and a visitor's page leaves out. Never a file the
 * recording did not write: a README, credits or a licence file stays.
 */
export function scanEntryNames(
  entryNames: readonly string[],
  manifest: TourManifest,
  wrap: string,
): string[] {
  const recording = recordingEntryNames(entryNames);
  if (recording.length === 0) return [];
  const read = visitorEntryNames(entryNames, manifest, wrap);
  return recording.filter((name) => !read.has(name));
}

/** The entries a visitor's page shows: all of them except the walk. */
export function entriesForVisitor<E extends { filename: string }>(
  entries: readonly E[],
  scan: ReadonlySet<string>,
): E[] {
  return entries.filter((e) => !scan.has(e.filename));
}

/**
 * True when a VISITOR's background download of the whole archive should
 * stop: a tour not finished yet (`tour-unfinished.ts`: no `tour.json`,
 * `manifest` null, or no station), of which a visitor reads nothing; or a
 * copy that carries a walk (kept for a co-author, or never left out),
 * which no visitor reads - a visitor shows baked photos only. A finished
 * copy without a walk is all visitor content, and stopping would only lose
 * the offline copy. A creator's working copy is still cached whole.
 */
export function stopsVisitorDownload(
  mode: ViewerMode,
  manifest: TourManifest | null,
  scan: ReadonlySet<string>,
): boolean {
  return mode === "visitor" && (tourUnfinished(manifest) || scan.size > 0);
}
