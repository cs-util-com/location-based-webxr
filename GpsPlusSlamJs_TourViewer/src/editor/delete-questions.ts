/**
 * The questions the 3D editor asks before deleting a station or a story
 * (pure): what goes with it, in words, so a yes is given knowing it.
 *
 * @see delete-questions.ts.md
 */
import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { tourFreeBlocks } from "gps-plus-slam-app-framework/ar/tour-station-pose";
import { tourStories } from "gps-plus-slam-app-framework/ar/tour-story";

import { stationTitle } from "../station-run.js";
import {
  manifestToWrite,
  tourDocumentActions,
  tourDocumentReducer,
  type TourDocumentState,
} from "../tour-document.js";

/** `parts` as one list: "a", "a and b", "a, b and c". */
function joined(parts: readonly string[]): string {
  if (parts.length < 2) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1] ?? ""}`;
}

/** The question before a station's delete: what goes with it, by name for
 *  its stories, by count for its free items. */
export function stationDeleteQuestion(
  station: TourStation,
  title: string,
): string {
  const stories = tourStories(station);
  const free = tourFreeBlocks(station).length;
  const n = stories.length + free;
  const parts = [
    ...stories.map((s) => `the story "${s.title}"`),
    ...(free === 0
      ? []
      : [free === 1 ? "1 free item" : `${String(free)} free items`]),
  ];
  const goes =
    n === 0
      ? "It has no content."
      : `Its ${n === 1 ? "item goes" : `${String(n)} items go`} with it: ${joined(parts)}.`;
  return `Delete the station "${title}"? ${goes} You can undo this.`;
}

/**
 * The question before the delete of the story `storyId` in `state`: its
 * entries by count, and its station by name when the delete takes that too
 * (an automatic station the story alone kept: the document's own rule,
 * run on `state` without changing it, says whether it does). Null for a
 * story the tour does not carry.
 */
export function storyDeleteQuestion(
  state: TourDocumentState,
  storyId: string,
): string | null {
  const stations = manifestToWrite(state)?.stations ?? [];
  const index = stations.findIndex((s) =>
    tourStories(s).some((t) => t.id === storyId),
  );
  const station = stations[index];
  const story =
    station === undefined
      ? undefined
      : tourStories(station).find((t) => t.id === storyId);
  if (station === undefined || story === undefined) return null;
  const n = story.children.length;
  const entries =
    n === 0 ? "" : n === 1 ? "its entry" : `its ${String(n)} entries`;
  const after = tourDocumentReducer(
    state,
    tourDocumentActions.storyDeleted({ story: storyId, what: "" }),
  );
  const stationGoes = !(manifestToWrite(after)?.stations ?? []).some(
    (s) => s.id === station.id,
  );
  const goneStation = stationGoes
    ? `its station "${stationTitle(station, index + 1)}", which holds nothing else,`
    : "";
  const parts = [entries, goneStation].filter((p) => p !== "");
  // One thing goes (an entry, or the station alone); else they go.
  const verb = parts.length === 1 && n <= 1 ? "goes" : "go";
  const list = joined(parts);
  const goes =
    list === ""
      ? "It has no entries."
      : `${list.charAt(0).toUpperCase()}${list.slice(1)} ${verb} with it.`;
  return `Delete the story "${story.title}"? ${goes} You can undo this.`;
}
