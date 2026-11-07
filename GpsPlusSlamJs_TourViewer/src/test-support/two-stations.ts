/**
 * A tour of two stations 100 m apart, A (holding the pin "p") and B
 * (holding the pin "q"), each of radius 25 m, for tests of what a move
 * does: A at the origin, B 100 m north.
 */
import type {
  TourManifest,
  TourObject,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { calcGpsCoords } from "gps-plus-slam-app-framework/core";

// Activates the licence the geodesy below needs (as every v3 tour test).
import "./tour-of.js";
import {
  documentObjects,
  initialTourDocumentState,
  tourDocumentActions as act,
  tourDocumentReducer as reduce,
  type TourDocumentState,
} from "../tour-document.js";
import { stationContent } from "./station-content.js";

const RADIUS_M = 25;
/** How far north of A station B stands (m). */
export const B_NORTH_M = 100;

/** A point `north` m north and `east` m east of A, at 400 m. */
export function spot(north: number, east = 0): TourObject["geo"] {
  const g = calcGpsCoords({ lat: 48.6, lon: 9.1 }, [north, 0, east]);
  return { lat: g.lat, lon: g.lon, alt: 400, rotation: [0, 0, 0, 1] };
}

function station(id: string, title: string, north: number): TourStation {
  const { lat, lon, alt } = spot(north);
  return {
    id,
    title,
    geo: { lat, lon, alt, rotation: [0, 0, 0, 1] },
    activateRadiusM: 2 * RADIUS_M,
    foundRadiusM: RADIUS_M,
    hint: "arrow",
    ...stationContent([]),
  };
}

function pin(id: string, geo: TourObject["geo"], home: string): TourObject {
  return {
    id,
    kind: "shortText",
    view: "pin",
    caption: id,
    createdAtIso: "2026-11-07T00:00:00.000Z",
    geo,
    station: home,
  };
}

/** The two stations as a manifest (their pins are placed on top). */
function twoStationManifest(): TourManifest {
  return {
    version: 5,
    minor: 0,
    order: "fixed",
    assets: [],
    stations: [station("a", "Gate", 0), station("b", "Tower", B_NORTH_M)],
  };
}

/** The tour with "p" in A at `north` m (and `east`), "q" at B's anchor. */
export function twoStations(north = 0, east = 0): TourDocumentState {
  let state = reduce(
    initialTourDocumentState,
    act.opened({ manifest: twoStationManifest() }),
  );
  for (const object of [
    pin("p", spot(north, east), "a"),
    pin("q", spot(B_NORTH_M), "b"),
  ]) {
    state = reduce(state, act.placed({ object, what: "placed" }));
  }
  return state;
}

/** The object `id` of `state`. */
export function objectOf(state: TourDocumentState, id: string): TourObject {
  const found = documentObjects(state).find((o) => o.object.id === id);
  if (found === undefined) throw new Error(`no object ${id}`);
  return found.object;
}
