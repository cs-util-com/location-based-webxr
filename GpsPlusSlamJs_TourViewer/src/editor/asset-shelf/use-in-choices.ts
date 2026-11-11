/**
 * Where a file on the asset shelf may be used ("Use in..." on a shelf row,
 * the phone's way to do what a drop does on a desktop): as a new item at a
 * station, as a new entry at the end of a story, or as the file of an item
 * of its kind made from another file. Pure: the choices as data, and the
 * target a chosen key names.
 *
 * @see use-in-choices.ts.md
 */
import type {
  TourAssetKind,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  tourStationBlocks,
  tourStories,
} from "gps-plus-slam-app-framework/ar/tour-story";

import { blockFileId, blockFileKind } from "../../block-file.js";
import { isStoryOnly } from "../../kinds/edit-kinds.js";
import { objectTitle } from "../../object-describe.js";
import { stationTitle } from "../../station-run.js";
import type { FileAddTarget } from "../add-file-item.js";
import { fileAddKindOfAsset } from "../file-drop.js";

/** One choice: its key (`useInTarget` reads it), its words, its icon. */
export interface UseInChoice {
  readonly key: string;
  readonly label: string;
  readonly icon: "station" | "story" | "swap";
}

/** A group of choices under its heading. */
export interface UseInGroup {
  readonly head: string;
  readonly choices: readonly UseInChoice[];
}

/** What a chosen key names: an add's target, or an item whose file the
 *  file becomes. */
export type UseInTarget =
  FileAddTarget | { readonly kind: "item"; readonly id: string };

/**
 * The choices for the file `asset` (its id and kind) in `stations`: a new
 * item in each station (none for a kind that plays in a story only, a
 * video), a new entry in each story, and each item of its kind made from
 * another file. Empty groups are left out; a kind no item is made from
 * has none.
 */
export function useInChoices(
  asset: { readonly id: string; readonly kind: TourAssetKind },
  stations: readonly TourStation[],
): UseInGroup[] {
  const kind = fileAddKindOfAsset(asset.kind);
  if (kind === null) return [];
  const word =
    kind === "model" ? "3D model" : kind === "audio" ? "sound" : kind;
  const groups: UseInGroup[] = [];
  if (!isStoryOnly(kind)) {
    groups.push({
      head: `A new ${word} in a station`,
      choices: stations.map((station, index) => ({
        key: `station:${station.id}`,
        label: stationTitle(station, index + 1),
        icon: "station",
      })),
    });
  }
  const stories = stations.flatMap((station, index) =>
    tourStories(station).map((story) => ({
      key: `story:${story.id}`,
      label: `${story.title} - ${stationTitle(station, index + 1)}`,
      icon: "story" as const,
    })),
  );
  groups.push({ head: "A new entry at the end of a story", choices: stories });
  const others = stations.flatMap((station, index) =>
    tourStationBlocks(station)
      .filter((block) => {
        const id = blockFileId(block);
        return (
          blockFileKind(block) === asset.kind && id !== null && id !== asset.id
        );
      })
      .map((block) => ({
        key: `item:${block.id}`,
        label: `${objectTitle(block)} - ${stationTitle(station, index + 1)}`,
        icon: "swap" as const,
      })),
  );
  groups.push({ head: "Replace the file of", choices: others });
  return groups.filter((g) => g.choices.length > 0);
}

/** The target `key` names (`UseInChoice.key`); null for none. */
export function useInTarget(key: string): UseInTarget | null {
  const colon = key.indexOf(":");
  const what = key.slice(0, colon);
  const id = key.slice(colon + 1);
  if (colon < 0 || id === "") return null;
  if (what === "station") return { kind: "station", stationId: id };
  if (what === "story") return { kind: "story", storyId: id };
  if (what === "item") return { kind: "item", id };
  return null;
}
