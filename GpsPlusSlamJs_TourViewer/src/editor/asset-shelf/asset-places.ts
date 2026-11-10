/**
 * Where a tour uses a file, as the shelf names it: the station cards,
 * story entries and free items `fileUsesAll` found using the asset, each
 * with the selection that shows it and the words that name it, then the
 * characters drawn with it and the tour's cover. The shelf's "Used in"
 * popover and its delete warning list these (`shelf-panel.ts`); the walk
 * of which places use a file is the document's (`fileUsesAll`), so the
 * list always has the card's count of entries.
 *
 * @see asset-places.ts.md
 */
import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { tourFreeBlocks } from "gps-plus-slam-app-framework/ar/tour-station-pose";
import {
  tourStories,
  tourStoryBlocks,
} from "gps-plus-slam-app-framework/ar/tour-story";

import { objectTitle } from "../../object-describe.js";
import { stationTitle } from "../../station-run.js";
import type { FileUses } from "../../tour-document.js";
import { STATION_PREFIX } from "../editor-model.js";

/** The selection of the tour's cover: the page opens the tour's details. */
export const TOUR_COVER_SELECTION = "tour:cover";

export interface AssetPlace {
  /** What the editor selects to show the place; none for a character,
   *  whose declaration has no row of its own. */
  readonly selection?: string;
  /** "2 The old gate › The legend › Bells". */
  readonly label: string;
}

/** Every place of `uses` (`fileUsesOf`), named by `stations` (the tour
 *  as the next write carries it): per station in tour order its card
 *  picture, its stories' entries, then its free items; then each
 *  character drawn with the file, then the cover. */
export function assetPlaces(
  stations: readonly TourStation[],
  uses: FileUses,
): AssetPlace[] {
  const places: AssetPlace[] = [];
  const blocks = new Set(
    [...uses.own, ...uses.mentions, ...uses.inline].map((b) => b.id),
  );
  const cards = new Set(uses.cards);
  stations.forEach((station, index) => {
    const head = `${String(index + 1)} ${stationTitle(station, index + 1)}`;
    if (cards.has(station.id)) {
      places.push({
        selection: `${STATION_PREFIX}${station.id}`,
        label: `${head} › station picture`,
      });
    }
    for (const story of tourStories(station)) {
      for (const block of tourStoryBlocks(story)) {
        if (!blocks.has(block.id)) continue;
        const storyName =
          story.title.trim() === "" ? "Story" : story.title.trim();
        places.push({
          selection: block.id,
          label: `${head} › ${storyName} › ${objectTitle(block)}`,
        });
      }
    }
    for (const block of tourFreeBlocks(station)) {
      if (!blocks.has(block.id)) continue;
      places.push({
        selection: block.id,
        label: `${head} › ${objectTitle(block)}`,
      });
    }
  });
  for (const name of uses.characters) {
    places.push({ label: `Character "${name}"` });
  }
  if (uses.cover) {
    places.push({ selection: TOUR_COVER_SELECTION, label: "The tour's cover" });
  }
  return places;
}
