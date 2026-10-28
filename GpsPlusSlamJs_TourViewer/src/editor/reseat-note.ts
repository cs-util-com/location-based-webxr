/**
 * Whether a write gave an item another station, and the line the page
 * says about it (pure). The station rule seats an item moved out of its
 * station's circle anew: into the station whose circle it reached, or
 * into a station of its own where it stands. That changes what visitors
 * see where, so it is never left unsaid.
 *
 * @see reseat-note.ts.md
 */
import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";

import { stationTitle } from "../station-run.js";
import {
  documentObjects,
  manifestToWrite,
  type TourDocumentState,
} from "../tour-document.js";

/** An item a write gave another station. */
export interface Reseat {
  /** The station it belongs to now. */
  readonly stationId: string;
  /** That station did not exist before the write: the rule made it. */
  readonly made: boolean;
  /** What the page says. */
  readonly said: string;
}

const KIND_WORD: Readonly<Record<TourObject["kind"], string>> = {
  shortText: "The pin",
  picture: "The photo",
  model: "The 3D model",
};

/** An item as the line names it: a pin's text, a picture's caption or a
 *  model's title, shortened, else what it is. */
function itemName(object: TourObject): string {
  const text = object.kind === "model" ? object.title : object.caption;
  const label = (text ?? "").replace(/\s+/g, " ").trim();
  if (label === "") return KIND_WORD[object.kind];
  const chars = [...label];
  return `"${chars.length > 40 ? `${chars.slice(0, 39).join("")}…` : label}"`;
}

function stationOf(
  state: TourDocumentState,
  id: string,
): TourObject | undefined {
  return documentObjects(state).find((o) => o.object.id === id)?.object;
}

/**
 * The station the item `id` belongs to after a write (`before` to
 * `after`) when that is another one than before it, with the line that
 * says so; null when it kept its station, or is in neither state.
 */
export function reseatOf(
  before: TourDocumentState,
  after: TourDocumentState,
  id: string,
): Reseat | null {
  if (before === after) return null;
  const was = stationOf(before, id);
  const now = stationOf(after, id);
  if (
    was?.station === undefined ||
    now?.station === undefined ||
    was.station === now.station
  ) {
    return null;
  }
  const stationId = now.station;
  const stations = manifestToWrite(after)?.stations ?? [];
  const index = stations.findIndex((s) => s.id === stationId);
  const station = stations[index];
  const name =
    station === undefined
      ? "another station"
      : stationTitle(station, index + 1);
  const made = !before.stations.some((f) => f.id === stationId);
  return {
    stationId,
    made,
    said: made
      ? `${itemName(now)} left its station's circle: it is now in a station of its own, ${name}`
      : `${itemName(now)} is now in ${name}`,
  };
}
