/**
 * Where a tour uses a file: the station cards, story entries and free
 * items that name the asset, each with the selection that shows it and
 * the words that name it. The shelf's "Used in" popover and its delete
 * warning list these (`shelf-panel.ts`).
 *
 * @see asset-places.ts.md
 */
import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { tourBlockAssetIds } from "gps-plus-slam-app-framework/ar/tour-kinds";
import { tourFreeBlocks } from "gps-plus-slam-app-framework/ar/tour-station-pose";
import {
  tourStories,
  tourStoryBlocks,
} from "gps-plus-slam-app-framework/ar/tour-story";

import { objectTitle } from "../../object-describe.js";
import { stationTitle } from "../../station-run.js";
import { STATION_PREFIX } from "../editor-model.js";

export interface AssetPlace {
  /** What the editor selects to show the place. */
  readonly selection: string;
  /** "2 The old gate › The legend › Bells". */
  readonly label: string;
}

/** Every place in `stations` that uses the asset `assetId`, in document
 *  order: per station its card picture, its stories' entries, then its
 *  free items. A block naming the file twice is one place. */
export function assetPlaces(
  stations: readonly TourStation[],
  assetId: string,
): AssetPlace[] {
  const places: AssetPlace[] = [];
  const uses = (block: { readonly kind?: unknown }) =>
    tourBlockAssetIds(block).includes(assetId);
  stations.forEach((station, index) => {
    const head = `${String(index + 1)} ${stationTitle(station, index + 1)}`;
    if (station.image === assetId) {
      places.push({
        selection: `${STATION_PREFIX}${station.id}`,
        label: `${head} › station picture`,
      });
    }
    for (const story of tourStories(station)) {
      for (const block of tourStoryBlocks(story)) {
        if (!uses(block)) continue;
        const storyName =
          story.title.trim() === "" ? "Story" : story.title.trim();
        places.push({
          selection: block.id,
          label: `${head} › ${storyName} › ${objectTitle(block)}`,
        });
      }
    }
    for (const block of tourFreeBlocks(station)) {
      if (!uses(block)) continue;
      places.push({
        selection: block.id,
        label: `${head} › ${objectTitle(block)}`,
      });
    }
  });
  return places;
}
