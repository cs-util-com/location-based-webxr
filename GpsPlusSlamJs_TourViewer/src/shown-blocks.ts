/**
 * Which blocks stand in a station's world for the visitor (station blocks
 * plan B2b step 2, owner decision B-Q4): its FREE blocks, drawn from the
 * start, plus every STORY block with a world view (a `pin`, a `plane`, a
 * model in a world view) the story reached. A reached world block appears
 * when it is reached and stays for the rest of the visit: it is kept with the station's walk
 * state, the lifetime of `done` (`visitor-walk-slice.ts`), so the story's
 * end, a stop and a new AR session keep it; a new walk (another tour, or
 * the same tour started anew) starts without it.
 *
 * Never here: a `card` (the story panel's, closed on the next step) and a
 * `stage` figure or model (the stage's one figure, `scene-stage.ts`).
 *
 * Pure.
 *
 * @see shown-blocks.ts.md
 */

import type {
  TourBlock,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { TOUR_WORLD_VIEWS } from "gps-plus-slam-app-framework/ar/tour-blocks";
import { tourFreeBlocks } from "gps-plus-slam-app-framework/ar/tour-station-pose";
import {
  isTourStoryBlock,
  tourStationStoryBlocks,
  type TourStoryChild,
} from "gps-plus-slam-app-framework/ar/tour-story";

/** Whether `block` stands in the world (a pin, a plane, a model in a
 *  world view). */
export function isWorldBlock(block: TourBlock): boolean {
  return TOUR_WORLD_VIEWS.has(block.view);
}

/** The world block `child` of a story is, or null: a block with a world
 *  view. */
export function worldBlockReachedBy(child: TourStoryChild): TourBlock | null {
  return isTourStoryBlock(child) && isWorldBlock(child) ? child : null;
}

/** The station's story blocks with a world view among `reached` (block
 *  ids the story reached), in the order they were reached; an id that
 *  names no such block of the station is left out. */
export function reachedWorldBlocks(
  station: Pick<TourStation, "children">,
  reached: readonly string[],
): TourBlock[] {
  const byId = new Map(tourStationStoryBlocks(station).map((b) => [b.id, b]));
  const out: TourBlock[] = [];
  const seen = new Set<string>();
  for (const id of reached) {
    const block = byId.get(id);
    if (block === undefined || seen.has(id)) continue;
    if (!isWorldBlock(block)) continue;
    seen.add(id);
    out.push(block);
  }
  return out;
}

/** Every block standing in the station's world: its free world blocks,
 *  then the reached story world blocks (`reachedWorldBlocks`). */
export function presentWorldBlocks(
  station: Pick<TourStation, "children">,
  reached: readonly string[],
): TourBlock[] {
  return [
    ...tourFreeBlocks(station).filter(isWorldBlock),
    ...reachedWorldBlocks(station, reached),
  ];
}

/** Whether any story block of the station has a world view: such a
 *  station has world content even with no free block. */
export function hasStoryWorldBlocks(
  station: Pick<TourStation, "children">,
): boolean {
  return tourStationStoryBlocks(station).some(isWorldBlock);
}
