/**
 * The tour document's bake at open: a creator's page opens a tour with its
 * recording's photos already in its stations, so every station exists from
 * the open on and the Finish assigns nothing. It reads the recording (I/O)
 * and seats its photos by the station rule (`withWalkPhotos` of
 * `tour-content.ts`). Both creator pages call it when they open a tour
 * (`archive-open.ts` on the phone, `editor/editor-open.ts` on the
 * desktop); a save never bakes.
 *
 * @see tour-document-bake.ts.md
 */

import type { TourManifest } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { TourIntegrityError } from "gps-plus-slam-app-framework/ar/tour-signed-manifest";
import { ArchiveLimitError } from "gps-plus-slam-app-framework/storage";
import {
  bakeCaptureSpots,
  type CaptureBakeOptions,
  type CaptureBakeSource,
} from "./capture-bake.js";
import {
  type CaptureSpotsInWorld,
  withWalkPhotos,
  worldCaptureSpots,
} from "./tour-content.js";

/** The tour as the photo-spot rule reads it. */
type CaptureSpotTour = CaptureBakeSource & { readonly hasRecording: boolean };

/** The photos' spots of an open: the spots, or why the photos could not
 *  be placed (`notPlaced`); neither when there are none to speak of. */
export interface RebuildPhotoSpots {
  readonly spots?: CaptureSpotsInWorld;
  readonly notPlaced?: string;
  /** `notPlaced` is a read of the recording that failed (not a cap, an
   *  integrity check or a bake's decline): another try may work. */
  readonly readFailed?: true;
}

/**
 * Whether the keep-the-walk switch starts ticked for a tour whose open
 * decided `photos`: when the photos could not be placed. A Finish leaves
 * the walk out unless kept, and a visitor shows baked photos only, so a
 * lean copy of such a tour would hold neither the photos nor the walk a
 * later open could bake them from. The creator can untick it. Both
 * creator pages read it (the phone's Finish, the desktop's Save).
 */
export function keepsWalkByDefault(photos: RebuildPhotoSpots): boolean {
  return photos.notPlaced !== undefined;
}

/**
 * The recorded photos' spots: the
 * tour's own when it carries them, else baked from its recording, else
 * none - a visitor then sees no recorded photo, and `notPlaced` says why,
 * unless the walk places nothing at all (the bake's `placesNothing`, no
 * reason: there are no photos to speak of). A recording that cannot be
 * read or joined is a reason; a cap's refusal and a failed integrity check
 * throw, as every read's does (`walkAtOpen` makes them a reason too).
 */
export async function captureSpotsForRebuild(
  tour: CaptureSpotTour,
  manifest: TourManifest,
  options: CaptureBakeOptions = {},
): Promise<RebuildPhotoSpots> {
  const own = worldCaptureSpots(manifest);
  if (own !== undefined) return { spots: own };
  if (!tour.hasRecording) return {};
  try {
    const bake = await bakeCaptureSpots(tour, options);
    if (bake.kind === "baked") return { spots: bake.spots };
    return bake.placesNothing === true ? {} : { notPlaced: bake.reason };
  } catch (err) {
    if (err instanceof ArchiveLimitError) throw err;
    if (err instanceof TourIntegrityError) throw err;
    return {
      notPlaced: `reading the recording failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
      readFailed: true,
    };
  }
}

/** The creator's bake of the open recording's walk, as the page shows it:
 *  running (the replay's progress), or what it decided. */
export type WalkBake =
  | { readonly kind: "baking"; readonly done: number; readonly total: number }
  | { readonly kind: "decided"; readonly photos: RebuildPhotoSpots };

/** A tour as a creator's page opens it, with its walk baked. */
export interface WalkAtOpen {
  /** The tour with the walk's photos in its stations (`withWalkPhotos`),
   *  or as it was when they were not placed. */
  readonly manifest: TourManifest;
  /** What the bake decided: what the page and a save say
   *  (`notPlaced`). */
  readonly photos: RebuildPhotoSpots;
}

/**
 * The bake at open: a creator's page opens a tour with its recording's
 * photos already in its stations, so every station exists from the open
 * on and the Finish assigns nothing. The bake is a deterministic replay of
 * the file, so it runs once per open, never at a save. It never fails the
 * open: a recording that cannot be read, a cap's refusal or a failed
 * integrity check (which the session reports on its own) is the reason the
 * tour opens without its walk photos.
 */
export async function walkAtOpen(
  tour: CaptureSpotTour,
  manifest: TourManifest,
  options: CaptureBakeOptions = {},
): Promise<WalkAtOpen> {
  let photos: RebuildPhotoSpots;
  try {
    photos = await captureSpotsForRebuild(tour, manifest, options);
  } catch (err) {
    photos = {
      notPlaced: `reading the recording failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
  return {
    manifest:
      photos.spots === undefined
        ? manifest
        : withWalkPhotos(manifest, photos.spots),
    photos,
  };
}
