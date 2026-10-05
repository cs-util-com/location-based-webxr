/**
 * What a visitor of a tour reads (scan-pass plan S1, S-D10): the entries
 * the published copy keeps, and the only ones a visitor's viewer touches.
 * Everything else in the archive is the creator's - the walk recording,
 * its unbaked frames, depth - and "Publish" leaves it out by default.
 *
 * @see tour-read-set.ts.md
 */

import { qrLevelIdFromEntryName } from "gps-plus-slam-app-framework/ar/qr/qr-level-archive";
import { TOUR_MANIFEST_ENTRY } from "gps-plus-slam-app-framework/ar/tour-archive";
import type { TourManifest } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { tourMediaTypeOfEntry } from "gps-plus-slam-app-framework/ar/tour-media";
import { signedManifestFilesOf } from "gps-plus-slam-app-framework/ar/tour-signed-manifest";

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

/** The entries a visitor never reads, in archive order: what a lean
 *  Publish removes. */
export function scanEntryNames(
  entryNames: readonly string[],
  manifest: TourManifest,
  wrap: string,
): string[] {
  const read = visitorEntryNames(entryNames, manifest, wrap);
  return entryNames.filter((name) => !read.has(name));
}

/** The entries a visitor's page shows: those in `visible`, or all of them
 *  for a tour without `tour.json` (`visible` null: no read set). */
export function entriesForVisitor<E extends { filename: string }>(
  entries: readonly E[],
  visible: ReadonlySet<string> | null,
): E[] {
  return visible === null
    ? [...entries]
    : entries.filter((e) => visible.has(e.filename));
}

/** True when a VISITOR's background download of the whole archive should
 *  stop: the tour carries entries no visitor reads (a copy that kept the
 *  walk). A creator's working copy is still cached whole. */
export function stopsVisitorDownload(
  mode: ViewerMode,
  entries: readonly { filename: string }[],
  visible: ReadonlySet<string> | null,
): boolean {
  return (
    mode === "visitor" &&
    visible !== null &&
    entries.some((e) => !visible.has(e.filename))
  );
}
