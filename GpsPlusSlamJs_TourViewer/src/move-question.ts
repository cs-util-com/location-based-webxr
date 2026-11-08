/**
 * What a move asks and says (pure), one rule for the desktop, the phone and
 * AR: a moved item keeps its station unless the creator agrees otherwise,
 * so a move INTO another station's circle asks whether it should change,
 * and a move out of its own circle says where it stands now. The tour
 * document does as it is told (`moved`, `joinStation`); this is only what
 * the pages ask and say.
 *
 * @see move-question.ts.md
 */
import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";

import { KIND_EDIT } from "./kinds/edit-kinds.js";
import { objectOwnText } from "./object-describe.js";
import { stationTitle } from "./station-run.js";
import { stationHolding } from "./station-assign.js";
import {
  documentObjects,
  manifestToWrite,
  objectFits,
  type TourDocumentState,
} from "./tour-document.js";
import { truncated } from "./truncated.js";

/** Whether a dropped item should change to the station `stationId`. */
export interface MoveQuestion {
  readonly stationId: string;
  /** The question, naming both stations. */
  readonly text: string;
  /** What declining means, in words. */
  readonly declined: string;
}

/** An item as a line names it: its own text (`objectOwnText`), shortened,
 *  else what it is. */
function itemName(object: TourObject): string {
  const label = (objectOwnText(object) ?? "").replace(/\s+/g, " ").trim();
  if (label === "") return `The ${KIND_EDIT[object.kind].thing}`;
  return `"${truncated(label, 40)}"`;
}

function objectIn(
  state: TourDocumentState,
  id: string,
): TourObject | undefined {
  return documentObjects(state).find((o) => o.object.id === id)?.object;
}

/** The station `id`'s title as the tour lists it. */
function titleOf(state: TourDocumentState, id: string): string {
  const stations = manifestToWrite(state)?.stations ?? [];
  const index = stations.findIndex((s) => s.id === id);
  const station = stations[index];
  return station === undefined
    ? "another station"
    : stationTitle(station, index + 1);
}

function frameOf(
  state: TourDocumentState,
  id: string,
): TourDocumentState["stations"] {
  return state.stations.filter((s) => s.id === id);
}

/**
 * What to ask before the item `id` goes to `geo`, or null when there is
 * nothing to ask: the spot is in its own station's circle, in no other's,
 * or in the circle of a station that already held the item where it
 * stood (radii overlap, or an earlier No left it there). Which also means
 * a lift or a turn never asks. Null for an id the tour lacks.
 */
export function moveQuestion(
  state: TourDocumentState,
  id: string,
  geo: TourObject["geo"],
): MoveQuestion | null {
  const object = objectIn(state, id);
  const home = object?.station;
  if (object === undefined || home === undefined) return null;
  if (stationHolding(frameOf(state, home), geo) !== null) return null;
  const others = state.stations.filter(
    (s) => s.id !== home && stationHolding([s], object.geo) === null,
  );
  const stationId = stationHolding(others, geo);
  if (stationId === null) return null;
  const from = titleOf(state, home);
  const to = titleOf(state, stationId);
  return {
    stationId,
    text: `Change ${itemName(object)} from ${from} to ${to}?`,
    declined: objectFits(state, { ...object, geo })
      ? `Otherwise it stays in ${from}, where you dropped it, outside its circle.`
      : `Otherwise it stays where it was: that spot is too far from ${from}.`,
  };
}

/**
 * The creator's answer to a drop, by `ask` (a blocking yes or no, the
 * page's): the station it should change to, or undefined when it keeps
 * its own, asked or not.
 */
export function askMove(
  state: TourDocumentState,
  id: string,
  geo: TourObject["geo"],
  ask: (message: string) => boolean,
): string | undefined {
  const asked = moveQuestion(state, id, geo);
  if (asked === null) return undefined;
  return ask(`${asked.text}\n\n${asked.declined}`)
    ? asked.stationId
    : undefined;
}

/**
 * What to say after a write (`before` to `after`) moved the item `id`:
 * the station it changed to, or that it stands outside its circle after
 * a move along the ground. Null when there is nothing to say.
 */
export function moveNote(
  before: TourDocumentState,
  after: TourDocumentState,
  id: string,
): string | null {
  if (before === after) return null;
  const was = objectIn(before, id);
  const now = objectIn(after, id);
  const home = now?.station;
  if (was === undefined || now === undefined || home === undefined) return null;
  if (was.station !== home) {
    return `${itemName(now)} is now in ${titleOf(after, home)}`;
  }
  const along = was.geo.lat !== now.geo.lat || was.geo.lon !== now.geo.lon;
  if (!along || stationHolding(frameOf(after, home), now.geo) !== null) {
    return null;
  }
  return `${itemName(now)} stays in ${titleOf(after, home)}, outside its circle`;
}
