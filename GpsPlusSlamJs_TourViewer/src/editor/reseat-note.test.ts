/**
 * Why these tests matter: an item moved out of its station's circle is
 * seated anew by the station rule - into the station whose circle it
 * reached, or into a new station of its own - and that changes where
 * visitors see it. The page used to say nothing, so a nudge of an item
 * outside a lowered circle split content off silently. These pin that a
 * re-seat is found and named (the item, the station, whether the rule
 * made it), and that a move that keeps the station says nothing.
 */
import { describe, expect, it } from "vitest";

import type {
  TourObject,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { calcGpsCoords } from "gps-plus-slam-app-framework/core";

// Activates the licence the geodesy below needs (as every v3 tour test).
import "../test-support/v3-tour.js";
import {
  documentObjects,
  initialTourDocumentState,
  tourDocumentActions as act,
  tourDocumentReducer as reduce,
  type TourDocumentState,
} from "../tour-document.js";
import { reseatOf } from "./reseat-note.js";

/** A point `north` m north of (48.6, 9.1), at 400 m. */
function spot(north: number): TourObject["geo"] {
  const g = calcGpsCoords({ lat: 48.6, lon: 9.1 }, [north, 0, 0]);
  return { lat: g.lat, lon: g.lon, alt: 400, rotation: [0, 0, 0, 1] };
}

function station(id: string, north: number, title?: string): TourStation {
  const { lat, lon, alt } = spot(north);
  return {
    id,
    ...(title === undefined ? {} : { title }),
    geo: { lat, lon, alt, rotation: [0, 0, 0, 1] },
    activateRadiusM: 20,
    foundRadiusM: 10,
    hint: "arrow",
    steps: [],
    items: [],
  };
}

/** Stations s (at 0) and "Market" (at 100 m north), a pin p of s at 5 m. */
function tour(): TourDocumentState {
  const opened = reduce(
    initialTourDocumentState,
    act.opened({
      manifest: {
        version: 3,
        minor: 0,
        order: "fixed",
        assets: [],
        stations: [station("s", 0), station("m", 100, "Market")],
      },
    }),
  );
  return reduce(
    opened,
    act.placed({
      object: {
        id: "p",
        kind: "pin",
        label: "Look\nup",
        createdAtIso: "2026-10-26T00:00:00.000Z",
        geo: spot(5),
        station: "s",
      },
      what: "p",
      newStationId: "unused",
    }),
  );
}

function moveTo(state: TourDocumentState, north: number) {
  const pin = documentObjects(state).find((o) => o.object.id === "p")?.object;
  if (pin === undefined) throw new Error("no pin");
  return reduce(
    state,
    act.moved({
      object: { ...pin, geo: spot(north) },
      what: "m",
      newStationId: "made",
    }),
  );
}

describe("reseatOf", () => {
  it("says nothing for a move that keeps the station, or no change", () => {
    const before = tour();
    expect(reseatOf(before, moveTo(before, 8), "p")).toBeNull();
    expect(reseatOf(before, before, "p")).toBeNull();
    expect(reseatOf(before, moveTo(before, 8), "gone")).toBeNull();
  });

  it("names the station whose circle the item reached", () => {
    const before = tour();
    expect(reseatOf(before, moveTo(before, 97), "p")).toEqual({
      stationId: "m",
      made: false,
      said: '"Look up" is now in Market',
    });
  });

  it("names a station the rule made for it, by its place in the tour", () => {
    const before = tour();
    expect(reseatOf(before, moveTo(before, 40), "p")).toEqual({
      stationId: "made",
      made: true,
      said: '"Look up" left its station\'s circle: it is now in a station of its own, Station 2',
    });
  });
});
