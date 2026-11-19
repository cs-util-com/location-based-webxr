import {
  createEmptyTourManifest,
  serializeTourManifest,
  type TourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  TOUR_ID_PATTERN,
  TOUR_MANIFEST_ENTRY,
} from "gps-plus-slam-app-framework/ar/tour-archive";
import { packFilesAsZip } from "gps-plus-slam-app-framework/storage";
import { newTourId } from "./tour-file-key.js";

/**
 * An empty tour's manifest with a tour id of its own. The id is what keeps
 * two empty tours apart: without one, two byte-identical empty zips get one
 * content key, so the second would be offered the first one's draft.
 *
 * @throws RangeError when `mint` gives an id outside the manifest's id rule.
 */
export function newTourManifest(mint: () => string = newTourId): TourManifest {
  const tourId = mint();
  if (typeof tourId !== "string" || !TOUR_ID_PATTERN.test(tourId)) {
    throw new RangeError(`Not a valid tour id: ${String(tourId)}`);
  }
  return { ...createEmptyTourManifest(), tourId };
}

/**
 * The zip of a new, empty tour: only its `tour.json`, with a freshly
 * minted tour id. The start page's starter zip and the editor's new tour
 * are both this one packer.
 *
 * @throws RangeError as {@link newTourManifest} does.
 */
export function packNewTour(mint: () => string = newTourId): Promise<Blob> {
  return packFilesAsZip([
    {
      path: TOUR_MANIFEST_ENTRY,
      data: serializeTourManifest(newTourManifest(mint)),
    },
  ]);
}
