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
import type { TourManifest } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { tourMediaTypeOfEntry } from "gps-plus-slam-app-framework/ar/tour-media";
import { signedManifestFilesOf } from "gps-plus-slam-app-framework/ar/tour-signed-manifest";
import {
  LEGACY_SESSION_IMAGES_DIR,
  SESSION_IMAGES_DIR,
} from "gps-plus-slam-app-framework/storage/file-system-utils";

import type { ViewerMode } from "./mode.js";

/**
 * The entries of `entryNames` a visitor reads: `tour.json`, every code
 * level, the signed list and its signature, the content files the manifest
 * names (under `wrap`, the tour's folder), and the recorded photos it baked
 * spots for - or, for a tour without baked spots, every image, which is
 * what the photo ring shows.
 */
export function visitorEntryNames(
  entryNames: readonly string[],
  manifest: TourManifest,
  wrap: string,
): Set<string> {
  const named = new Set<string>([
    `${wrap}${TOUR_MANIFEST_ENTRY}`,
    ...signedManifestFilesOf(entryNames),
    ...manifest.objects.flatMap((o) =>
      o.kind === "photo" ? [`${wrap}${o.image}`] : [],
    ),
    ...manifest.assets.map((a) => `${wrap}${a.path}`),
    ...(manifest.captureSpots?.captures.map((c) => c.image) ?? []),
  ]);
  const ringPhotos = manifest.captureSpots === undefined;
  return new Set(
    entryNames.filter(
      (name) =>
        named.has(name) ||
        qrLevelIdFromEntryName(name) !== null ||
        (ringPhotos && tourMediaTypeOfEntry(name)?.kind === "image"),
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

/** An entry a recording writes: its `session.json`, its action stream,
 *  its frames. Depth samples travel inside the actions. */
function isRecordingEntry(name: string): boolean {
  return (
    name === "session.json" ||
    name.endsWith("/session.json") ||
    ACTION_ENTRY.test(name) ||
    RECORDED_FRAME.test(name)
  );
}

/**
 * The creator's walk in this archive, in archive order: the recording's own
 * entries (`session.json`, `actions/`, recorded frames) that a visitor
 * never reads - a baked photo, or a frame the photo ring shows, stays. What
 * a lean Finish removes and a visitor's page leaves out. Never a file the
 * recording did not write: a README, credits or a licence file stays.
 */
export function scanEntryNames(
  entryNames: readonly string[],
  manifest: TourManifest,
  wrap: string,
): string[] {
  // No action stream, no walk: a session.json or frame-named image of the
  // tour's own is then just a file.
  if (!entryNames.some((name) => ACTION_ENTRY.test(name))) return [];
  const read = visitorEntryNames(entryNames, manifest, wrap);
  return entryNames.filter((name) => isRecordingEntry(name) && !read.has(name));
}

/** The entries a visitor's page shows: all of them except the walk. */
export function entriesForVisitor<E extends { filename: string }>(
  entries: readonly E[],
  scan: ReadonlySet<string>,
): E[] {
  return entries.filter((e) => !scan.has(e.filename));
}

/** True when a VISITOR's background download of the whole archive should
 *  stop: the copy carries a walk (kept for a co-author). A creator's
 *  working copy is still cached whole. */
export function stopsVisitorDownload(
  mode: ViewerMode,
  scan: ReadonlySet<string>,
): boolean {
  return mode === "visitor" && scan.size > 0;
}
