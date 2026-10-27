/**
 * Why these tests matter: a value typed in the inspector becomes one edit
 * of the tour, and the wrong edit is worse than none - a typed east that
 * moved the station somewhere else, a heading typed as an absolute that
 * turned it by that much again, a radius typed with a comma that read as
 * nothing. These pin what each field writes: the station's own fields as
 * a station edit, a pin's text as its text, a place as a pose whose
 * metres read back as the ones typed, a heading as the turn from the one
 * it has now, and a value that is no number as a refusal in words.
 */
import { describe, expect, it } from "vitest";

import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { localPoseOf } from "gps-plus-slam-app-framework/ar/tour-station-pose";

// Activates the licence the station frame's geodesy needs.
import "../../test-support/tour-of.js";
import { eastNorthOf } from "../tour-origin.js";
import { groundEdit, inspectorEdit } from "./inspector-edits.js";

const AT = "2026-10-25T10:00:00Z";
const ORIGIN = { lat: 48.137, lng: 11.575 };

const STATIONS = [
  {
    id: "a",
    title: "Gate",
    geo: { lat: 48.1371, lon: 11.5751, alt: 520, headingDeg: 30 },
    activateRadiusM: 50,
    foundRadiusM: 25,
    hint: "arrow",
    steps: [],
    blocks: [
      {
        id: "pin-1",
        kind: "shortText",
        view: "pin",
        caption: "Fountain",
        createdAtIso: AT,
        pose: { position: [4, 1.5, -2], rotation: [0, 0, 0, 1] },
      },
      {
        id: "model-1",
        kind: "model",
        view: "placed",
        asset: "horse",
        sizeM: 2.4,
        createdAtIso: AT,
        pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
      },
    ],
  },
] as unknown as TourStation[];

function edit(selected: string, field: string, value: string) {
  return inspectorEdit({
    selected,
    stations: STATIONS,
    origin: ORIGIN,
    field,
    value,
  });
}

describe("inspectorEdit", () => {
  // Why (B2a review finding 6, design §3): the editor's text input is
  // where text becomes NFC; a decomposed title would be stored as typed.
  it("writes typed text in NFC", () => {
    const typed = `Caf${"e"}${String.fromCodePoint(0x301)}`;
    expect(edit("station:a", "title", typed)).toMatchObject({
      edit: { title: "Caf\u00e9" },
    });
    expect(edit("station:a", "description", typed)).toMatchObject({
      edit: { description: "Caf\u00e9" },
    });
  });

  it("writes a station's title, description and radius as a station edit", () => {
    expect(edit("station:a", "title", "  The gate ")).toEqual({
      kind: "station",
      stationId: "a",
      edit: { title: "  The gate " },
    });
    expect(edit("station:a", "description", "")).toEqual({
      kind: "station",
      stationId: "a",
      edit: { description: "" },
    });
    // A comma is a decimal point, as a European keyboard types it.
    expect(edit("station:a", "radius", " 12,5 ")).toEqual({
      kind: "station",
      stationId: "a",
      edit: { foundRadiusM: 12.5 },
    });
  });

  it("writes a pin's text as its text, and no caption of a model", () => {
    expect(edit("pin-1", "title", "Old fountain")).toEqual({
      kind: "text",
      id: "pin-1",
      text: "Old fountain",
    });
    expect(edit("model-1", "title", "Horse")).toEqual({ kind: "none" });
  });

  // Why: the typed metres must be where the 3D view then draws the
  // station, measured from the same origin; its height and turn stay.
  it("moves a station to the east and north typed, its height and heading kept", () => {
    const moved = edit("station:a", "east", "-10");
    if (moved.kind !== "scene" || moved.edit.kind !== "station-pose") {
      throw new Error(`not a pose: ${JSON.stringify(moved)}`);
    }
    const before = eastNorthOf(STATIONS[0]!.geo, ORIGIN);
    const after = eastNorthOf(moved.edit.geo, ORIGIN);
    expect(after?.eastM).toBeCloseTo(-10, 3);
    expect(after?.northM).toBeCloseTo(before?.northM ?? NaN, 3);
    expect(moved.edit.geo).toMatchObject({ alt: 520, headingDeg: 30 });
    const north = edit("station:a", "north", "7.25");
    if (north.kind !== "scene") throw new Error("not a pose");
    expect(
      eastNorthOf((north.edit as { geo: TourStation["geo"] }).geo, ORIGIN)
        ?.northM,
    ).toBeCloseTo(7.25, 3);
  });

  // Why: the field shows the heading the station has; typing 90 means
  // "face 90", so the edit is the turn from 30 to 90, not a turn of 90.
  it("turns a station and an item by the difference to the heading typed", () => {
    expect(edit("station:a", "heading", "90")).toEqual({
      kind: "turn",
      selection: "station:a",
      deg: 60,
    });
    expect(edit("pin-1", "heading", "-90")).toEqual({
      kind: "turn",
      selection: "pin-1",
      deg: -90,
    });
    // The short way round: 350 from 30 is a turn of -40.
    expect(edit("station:a", "heading", "350")).toMatchObject({ deg: -40 });
  });

  // Why: an item's offset is in its station's frame, as the inspector
  // shows it; the pose written must read back in that frame as the
  // numbers typed, the other two kept.
  it("puts an item at the offset and height typed in its station's frame", () => {
    for (const [field, value, want] of [
      ["east", "3", [4, 1.5, 3]],
      ["north", "-6", [-6, 1.5, -2]],
    ] as const) {
      const moved = edit("pin-1", field, value);
      if (moved.kind !== "scene" || moved.edit.kind !== "item-pose") {
        throw new Error(`not a pose: ${JSON.stringify(moved)}`);
      }
      const local = localPoseOf(moved.edit.geo, STATIONS[0]!.geo);
      for (const [i, w] of want.entries()) {
        expect(local.position[i]).toBeCloseTo(w, 3);
      }
    }
  });

  // Why: a height written as a whole new pose went through the station
  // frame and back, whose float32 maths moved the item sideways by up to
  // a micrometre; for an item outside a lowered circle that was a move
  // outward, and the station rule gave it a station of its own. A typed
  // height changes the item's altitude, and nothing else.
  it("writes a typed height as the item's altitude alone", () => {
    const lifted = edit("pin-1", "height", "0");
    expect(lifted).toEqual({
      kind: "height",
      id: "pin-1",
      alt: STATIONS[0]!.geo.alt + 0,
    });
    expect(edit("pin-1", "height", "3,25")).toEqual({
      kind: "height",
      id: "pin-1",
      alt: STATIONS[0]!.geo.alt + 3.25,
    });
  });

  it("writes a model's size, and refuses a size for anything else", () => {
    expect(edit("model-1", "size", "3")).toEqual({
      kind: "scene",
      edit: { kind: "size", id: "model-1", sizeM: 3 },
    });
    expect(edit("pin-1", "size", "3")).toEqual({ kind: "none" });
  });

  it("says a value that is no number in words, and does nothing for an unchanged one", () => {
    // Only plain decimals, with a point or one comma: no hex, binary or
    // octal, no exponent, no thousands separators.
    for (const bad of [
      "",
      "  ",
      "ten",
      "1e999",
      "1e3",
      "0x10",
      "0b11",
      "0o7",
      "Infinity",
      "NaN",
      "1,2,3",
      "1,000,5",
      "1.000,5",
      "1 000",
      "--1",
      ".",
      ",",
    ]) {
      expect(edit("station:a", "radius", bad)).toEqual({
        kind: "invalid",
        reason: "Type a number, like 12.5",
      });
    }
    for (const [typed, radius] of [
      ["12,5", 12.5],
      [" 12.5 ", 12.5],
      ["+3", 3],
      [",5", 0.5],
      ["7.", 7],
      // One comma is always the decimal point, by design: a lone
      // thousands separator cannot be told from it.
      ["1,000", 1],
    ] as const) {
      expect(edit("station:a", "radius", typed)).toMatchObject({
        edit: { foundRadiusM: radius },
      });
    }
    expect(edit("station:a", "heading", "-0,5")).toMatchObject({
      kind: "turn",
    });
    expect(edit("station:a", "radius", "25")).toEqual({ kind: "none" });
    expect(edit("station:a", "heading", "30")).toEqual({ kind: "none" });
    expect(edit("pin-1", "height", "1.5")).toEqual({ kind: "none" });
  });

  it("does nothing for a selection the tour lacks, a code, or a field it does not know", () => {
    expect(edit("station:gone", "title", "x")).toEqual({ kind: "none" });
    expect(edit("level-1", "title", "x")).toEqual({ kind: "none" });
    expect(edit("station:a", "colour", "red")).toEqual({ kind: "none" });
    expect(
      inspectorEdit({
        selected: "station:a",
        stations: STATIONS,
        origin: null,
        field: "east",
        value: "1",
      }),
    ).toEqual({ kind: "none" });
  });
});

describe("groundEdit", () => {
  const flat = (alt: number) => () => alt;
  const ground = (
    selected: string,
    which: "ground" | "ground-items",
    groundAt: (place: { lat: number; lon: number }) => number | null,
  ) => groundEdit({ selected, stations: STATIONS, which, groundAt });

  // Why: an item is put on the ground at the ground's height under its
  // own place, not under its station's anchor, and only once that ground
  // has loaded (null: wait).
  it("puts an item at the ground's height under it, once that has loaded", () => {
    expect(ground("pin-1", "ground", flat(500))).toEqual({
      kind: "ground-items",
      items: [{ id: "pin-1", alt: 500 }],
    });
    expect(ground("pin-1", "ground", () => null)).toBeNull();
  });

  it("puts a station's items that stand off the ground on it, as one edit", () => {
    // The anchor is at 520: the pin stands 1.5 m up, the model on it.
    expect(ground("station:a", "ground-items", flat(520))).toEqual({
      kind: "ground-items",
      items: [{ id: "pin-1", alt: 520 }],
    });
    expect(ground("station:a", "ground-items", flat(521.5))).toEqual({
      kind: "ground-items",
      items: [{ id: "model-1", alt: 521.5 }],
    });
    // The ground under one of them not loaded: wait for all.
    let calls = 0;
    expect(
      ground("station:a", "ground-items", () => {
        calls += 1;
        return calls === 1 ? 520 : null;
      }),
    ).toBeNull();
  });

  it("puts a station's anchor on the ground, its turn kept", () => {
    expect(ground("station:a", "ground", flat(518))).toEqual({
      kind: "scene",
      edit: {
        kind: "station-pose",
        id: "a",
        geo: { lat: 48.1371, lon: 11.5751, alt: 518, headingDeg: 30 },
      },
    });
  });

  it("writes nothing for what stands on the ground already, or a selection the tour lacks", () => {
    expect(ground("station:a", "ground", flat(520.03))).toEqual({
      kind: "none",
    });
    expect(ground("pin-1", "ground", flat(521.5))).toEqual({ kind: "none" });
    expect(ground("gone", "ground", flat(1))).toEqual({ kind: "none" });
    expect(ground("pin-1", "ground-items", flat(1))).toEqual({ kind: "none" });
  });
});
