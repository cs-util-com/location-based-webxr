/**
 * Why these tests matter: the inspector's Add pin puts a new pin into the
 * selected station with no gesture, so where it lands is the code's
 * choice. It must land inside the station's circle (or visitors never see
 * it), clear of the items already there (or it hides behind one), on the
 * ground where the ground is known, and in the station it was added to -
 * never seated by the station rule into another one.
 */
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { localPoseOf } from "gps-plus-slam-app-framework/ar/tour-station-pose";

// Activates the licence the station frame's geodesy needs.
import "../test-support/tour-of.js";
import {
  addNewItem,
  freePinSpot,
  newLongText,
  newPin,
  newStoryEntry,
} from "./new-pin.js";
import {
  parseTourObject,
  tourObjectRecord,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { stationContent } from "../test-support/station-content.js";

const AT = "2026-10-25T10:00:00Z";

function station(
  items: readonly [north: number, east: number][],
  foundRadiusM = 25,
): TourStation {
  return {
    id: "s",
    title: "Gate",
    geo: { lat: 48.1371, lon: 11.5751, alt: 520, headingDeg: 40 },
    activateRadiusM: 2 * foundRadiusM,
    foundRadiusM,
    hint: "arrow",
    ...stationContent(
      items.map(([north, east], i) => ({
        id: `pin-${String(i)}`,
        kind: "shortText",
        view: "pin",
        caption: `Pin ${String(i)}`,
        createdAtIso: AT,
        pose: { position: [north, 0, east], rotation: [0, 0, 0, 1] },
      })),
    ),
  } as unknown as TourStation;
}

describe("freePinSpot", () => {
  it("starts 4 m north of an empty station's anchor", () => {
    expect(freePinSpot(station([]))).toEqual({ northM: 4, eastM: 0 });
  });

  it("keeps clear of the items already there", () => {
    const spot = freePinSpot(station([[4, 0]]));
    expect(Math.hypot(spot.northM - 4, spot.eastM)).toBeGreaterThan(2.2);
  });

  it("stays inside a small station's circle", () => {
    const spot = freePinSpot(station([], 2));
    expect(Math.hypot(spot.northM, spot.eastM)).toBeLessThanOrEqual(2);
  });

  it("lands inside the circle, clear of every item where there is room (property)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.double({ min: -12, max: 12, noNaN: true }),
            fc.double({ min: -12, max: 12, noNaN: true }),
          ),
          { maxLength: 6 },
        ),
        fc.double({ min: 2, max: 60, noNaN: true }),
        (items, radiusM) => {
          const spot = freePinSpot(station(items, radiusM));
          expect(Math.hypot(spot.northM, spot.eastM)).toBeLessThanOrEqual(
            radiusM + 1e-9,
          );
        },
      ),
    );
  });
});

describe("newPin", () => {
  it("is a pin of the station, at the free spot in its frame, on the ground there", () => {
    const s = station([]);
    const pin = newPin({
      station: s,
      id: "new1",
      nowIso: AT,
      groundAt: () => 518.5,
    });
    expect(pin).toMatchObject({
      id: "new1",
      kind: "shortText",
      view: "pin",
      caption: "New pin 1",
      createdAtIso: AT,
      station: "s",
    });
    expect(pin.geo.alt).toBeCloseTo(518.5, 6);
    const local = localPoseOf(pin.geo, s.geo);
    expect(local.position[0]).toBeCloseTo(4, 3);
    expect(local.position[2]).toBeCloseTo(0, 3);
  });

  it("stands at the anchor's height where the ground has not loaded, and counts the pins for its name", () => {
    const pin = newPin({
      station: station([[4, 0]]),
      id: "new2",
      nowIso: AT,
      groundAt: () => null,
    });
    expect(pin.geo.alt).toBeCloseTo(520, 6);
    expect(pin.caption).toBe("New pin 2");
  });
});

// Why: the tree's "+" adds a long text in place as it adds a pin: the same
// free spot and ground, its own name, and a text the file format takes (a
// long text's title and body are both required, so an empty body would
// be a tour the format refuses).
describe("addNewItem", () => {
  const base = {
    stationId: "s",
    id: "n1",
    nowIso: AT,
    groundAt: () => null,
  };

  // Why: the station an add was pressed for can be gone by the time it
  // runs (an undo, a delete); the add must say so, not do nothing.
  it("refuses with words, placing nothing, for a station no longer in the tour", () => {
    const place = vi.fn(() => ({ kind: "placed" as const }));
    expect(
      addNewItem({
        ...base,
        stations: [station([])],
        stationId: "gone",
        kind: "pin",
        place,
      }),
    ).toEqual({
      kind: "refused",
      reason: "That station is no longer in this tour - nothing was added.",
    });
    expect(place).not.toHaveBeenCalled();
  });

  // Why: the tour's own refusal (the item would not fit its station)
  // reaches the creator in its own words, and nothing counts as added.
  it("passes the tour's refusal on", () => {
    const refusal = { kind: "refused" as const, reason: "It cannot go there." };
    expect(
      addNewItem({
        ...base,
        stations: [station([])],
        kind: "longText",
        place: () => refusal,
      }),
    ).toEqual(refusal);
  });

  it("places the new item of the kind asked for in its station", () => {
    const place = vi.fn(() => ({ kind: "placed" as const }));
    const outcome = addNewItem({
      ...base,
      stations: [station([])],
      kind: "longText",
      place,
    });
    expect(outcome).toMatchObject({
      kind: "added",
      item: { id: "n1", kind: "longText", station: "s" },
    });
    expect(place).toHaveBeenCalledWith(
      outcome.kind === "added" ? outcome.item : null,
    );
  });
});

describe("newLongText", () => {
  it("is a reading sign of the station at the free spot, on the ground, named by its number", () => {
    const s = station([[4, 0]]);
    const text = newLongText({
      station: s,
      id: "long1",
      nowIso: AT,
      groundAt: () => 518.5,
    });
    expect(text).toMatchObject({
      id: "long1",
      kind: "longText",
      view: "reading",
      title: "New long text 1",
      createdAtIso: AT,
      station: "s",
    });
    expect(text.body.trim()).not.toBe("");
    expect(text.geo.alt).toBeCloseTo(518.5, 6);
    const local = localPoseOf(text.geo, s.geo);
    const spot = freePinSpot(s);
    expect(local.position[0]).toBeCloseTo(spot.northM, 3);
    expect(local.position[2]).toBeCloseTo(spot.eastM, 3);
  });

  it("is an object the tour format reads back unchanged", () => {
    const text = newLongText({
      station: station([]),
      id: "long1",
      nowIso: AT,
      groundAt: () => null,
    });
    expect(
      parseTourObject(JSON.parse(JSON.stringify(tourObjectRecord(text)))),
    ).toEqual(text);
  });
});

// Why: a story's entry is shown in the card while the story runs, so it
// stands at the station's own origin and moves on by a tap; the number in
// its text counts its own kind, or two new entries would read the same.
describe("newStoryEntry", () => {
  it("makes a card that moves on by a tap, numbered within its kind", () => {
    const story = { children: [{ kind: "shortText" }] } as never;
    const pin = newStoryEntry(story, "pin", "p");
    expect(pin).toMatchObject({
      id: "p",
      kind: "shortText",
      view: "card",
      caption: "New pin 2",
      advance: { mode: "tap" },
    });
    expect(newStoryEntry(story, "longText", "t")).toMatchObject({
      kind: "longText",
      view: "card",
      title: "New long text 1",
      advance: { mode: "tap" },
    });
  });
});
