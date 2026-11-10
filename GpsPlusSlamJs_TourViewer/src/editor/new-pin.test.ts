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
import { ADD_CHOICES, isAddable } from "../kinds/edit-kinds.js";
import {
  addNewCharacter,
  addNewItem,
  freePinSpot,
  KIND_ADD,
  newCharacter,
  newCharacterEntry,
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

// Why this test matters: what a kind starts as when added (at a station,
// and as a story entry) is its one row here; the add menu's addable kinds
// and these rows must be the same set, or a menu line adds nothing.
describe("KIND_ADD", () => {
  it("has one row, with an item and an entry, for every addable kind of the add menu", () => {
    const addable = ADD_CHOICES.filter(isAddable).map((c) => c.kind);
    expect(Object.keys(KIND_ADD)).toEqual(addable);
    for (const row of Object.values(KIND_ADD)) {
      expect(typeof row.item).toBe("function");
      expect(typeof row.entry).toBe("function");
    }
  });

  it("types each row's item maker by its kind", () => {
    // Why: a row whose maker makes another kind's item would add the wrong
    // thing from the menu; it must fail to compile, not at a visitor.
    // @ts-expect-error a long text's maker is no short text's
    const wrong: (typeof KIND_ADD)["shortText"]["item"] =
      KIND_ADD.longText.item;
    expect(wrong).toBe(KIND_ADD.longText.item);
  });
});

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
        kind: "shortText",
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
    const pin = newStoryEntry(story, "shortText", "p");
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

// Why this test matters: the add menu's Character stands the character the
// maker just made in the station; it must name the declaration (so his
// name and pictures follow it), stand clear of what is there, read back
// as the format reads it, and be refused in words for a gone station.
describe("newCharacter", () => {
  const rita = {
    id: "c1abc",
    name: "Ranger Rita",
    image: "rita1",
    frames: "rita4",
  };

  it("stands the declared character at the free spot, in the speak view", () => {
    const made = newCharacter({
      station: station([[4, 0]]),
      id: "n1",
      nowIso: AT,
      groundAt: () => 517,
      character: rita,
    });
    expect(made).toMatchObject({
      id: "n1",
      kind: "character",
      view: "speak",
      name: "Ranger Rita",
      image: "rita1",
      character: "c1abc",
      station: "s",
    });
    expect(made.geo.alt).toBe(517);
    expect(
      parseTourObject(JSON.parse(JSON.stringify(tourObjectRecord(made)))),
    ).toEqual(made);
  });

  it("is refused for a gone station, nothing placed", () => {
    const place = vi.fn(() => ({ kind: "placed" as const }));
    const out = addNewCharacter({
      stations: [station([])],
      stationId: "gone",
      character: rita,
      id: "n1",
      nowIso: AT,
      groundAt: () => null,
      place,
    });
    expect(out).toMatchObject({
      kind: "refused",
      reason: expect.stringMatching(/no longer/),
    });
    expect(place).not.toHaveBeenCalled();
  });

  it("hands the place's refusal on", () => {
    const out = addNewCharacter({
      stations: [station([])],
      stationId: "s",
      character: rita,
      id: "n1",
      nowIso: AT,
      groundAt: () => null,
      place: () => ({ kind: "refused", reason: "too far" }),
    });
    expect(out).toEqual({ kind: "refused", reason: "too far" });
  });

  // Why: a character in a story is a 3D character like a free one: the
  // view a free character starts in, at a place of his own in the
  // station's frame, moving on by a tap as every new story entry does.
  it("makes a story entry naming the declaration, standing at the given spot", () => {
    const entry = newCharacterEntry(rita, "e1", { northM: 4, eastM: -2 });
    expect(entry).toMatchObject({
      id: "e1",
      kind: "character",
      view: "speak",
      character: "c1abc",
      name: "Ranger Rita",
      image: "rita1",
      advance: { mode: "tap" },
      pose: { position: [4, 0, -2], rotation: [0, 0, 0, 1] },
    });
  });
});
