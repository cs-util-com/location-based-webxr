/**
 * Why these tests matter: the 3D view's inspector shows the selection's
 * fields read-only, and what it says must be what the file holds - a
 * radius, a size, a print size - in the units the creator thinks in, so
 * a creator who checks a station before going out reads the truth. An
 * item's heading comes from its rotation, so a rotation turned by a
 * known angle must read back as that angle; and a selection the tour no
 * longer has shows no inspector rather than a stale one. Where a station
 * or a code stands is said as the 3D view frames it: metres east and
 * north of the tour's centre, its height and its heading.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

// Activates the licence an item's place in the world needs.
import "../../test-support/tour-of.js";

import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-manifest";

import {
  buildInspector,
  headingOfRotation,
  inspectorHint,
  ON_GROUND_M,
} from "./inspector-model.js";

const AT = "2026-10-22T10:00:00Z";

/** A unit quaternion turning by `deg` about the up axis (NUE: y up). */
function turn(deg: number): [number, number, number, number] {
  const half = (deg * Math.PI) / 360;
  return [0, Math.sin(half), 0, Math.cos(half)];
}

const STATIONS: TourStation[] = [
  {
    id: "a",
    title: "Market Square",
    description: " Where the market meets ",
    geo: { lat: 48.1371234, lon: 11.5754321, alt: 562.25, headingDeg: 30 },
    activateRadiusM: 50,
    foundRadiusM: 25,
    hint: "arrow",
    steps: [],
    blocks: [
      {
        id: "pin-1",
        kind: "shortText",
        view: "pin",
        caption: "Fountain, 1612",
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
        pose: { position: [0, 0, 0], rotation: turn(-90) },
      },
    ],
  } as unknown as TourStation,
  {
    id: "b",
    geo: { lat: 48.138, lon: 11.576, alt: 560, headingDeg: 0 },
    activateRadiusM: 60,
    foundRadiusM: 30,
    hint: "arrow",
    steps: [],
    blocks: [],
  } as unknown as TourStation,
];

const CODES = [
  {
    id: "level-1",
    title: "Code 1",
    meta: "Printed code, measured on site",
    geo: { lat: 48.1, lon: 11.5, alt: 561.5, headingDeg: 180 },
    printSizeM: 0.5,
  },
  {
    id: "level-2",
    title: "Code 2",
    meta: "Printed code, no position stored yet",
    geo: null,
    printSizeM: null,
  },
];

function inspect(selected: string | null, unlockedStations: string[] = []) {
  return buildInspector({
    selected,
    stations: STATIONS,
    assets: [],
    codes: CODES,
    unlockedStations,
  });
}

/** The position the inspector shows for `selected`. */
function positionOf(selected: string) {
  const model = inspect(selected);
  if (model === null || model.kind === "item" || model.position === null) {
    throw new Error(`no position for ${selected}`);
  }
  return model.position;
}

describe("buildInspector", () => {
  it("shows nothing without a selection, or for one the tour does not have", () => {
    expect(inspect(null)).toBeNull();
    expect(inspect("station:gone")).toBeNull();
    expect(inspect("gone")).toBeNull();
  });

  it("shows a station's fields as the file holds them", () => {
    expect(inspect("station:a")).toEqual({
      kind: "station",
      title: "Market Square",
      name: "Market Square",
      sub: "Station 1 of 2",
      place: { number: 1, count: 2 },
      description: "Where the market meets",
      imagePath: null,
      images: [],
      imageId: null,
      foundRadiusM: 25,
      activateRadiusM: 50,
      outside: 0,
      offGround: null,
      groundOffM: null,
      locked: true,
      story: [],
      position: {
        eastM: expect.any(Number),
        northM: expect.any(Number),
        altM: 562.25,
        headingDeg: 30,
      },
    });
    expect(inspect("station:b")).toMatchObject({
      title: "Station 2",
      sub: "Station 2 of 2",
      description: null,
    });
  });

  // Why: the prototype says a station's place as
  // metres east and north of the tour's origin - the 3D view's centre, the
  // middle of the stations - not as degrees. Two stations stand either
  // side of their middle, about 42 m east-west and 97 m north-south apart (a degree is about
  // 74.46 km of longitude and 111.19 km of latitude there).
  it("says where a station stands in metres east and north of the tour's centre", () => {
    const a = positionOf("station:a");
    const b = positionOf("station:b");
    expect(a.eastM).toBeCloseTo(-b.eastM, 2);
    expect(a.northM).toBeCloseTo(-b.northM, 2);
    expect(b.eastM - a.eastM).toBeCloseTo((11.576 - 11.5754321) * 74_460, 0);
    expect(b.northM - a.northM).toBeCloseTo((48.138 - 48.1371234) * 111_190, 0);
  });

  // A station's story shows blocks that do not stand in the world (a long
  // text, a character on its stage): the station's inspector lists them,
  // each by its kind and its name, in the station's order, so the creator
  // sees what the story carries though the 3D view draws none of it.
  it("lists the blocks the station's story shows, by kind and name", () => {
    const POSE = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
    const show = (id: string, block: string) => ({
      id,
      action: { kind: "show", block },
      advance: { mode: "tap" },
    });
    const storyStation = {
      ...STATIONS[1],
      steps: [show("s1", "intro"), show("s2", "guard")],
      blocks: [
        {
          id: "intro",
          kind: "longText",
          view: "card",
          title: "The siege",
          body: "In 1632...",
          pose: POSE,
        },
        {
          id: "guard",
          kind: "character",
          view: "stage",
          name: "",
          image: "cut",
          caption: "Halt!",
          pose: POSE,
        },
        {
          id: "unused",
          kind: "video",
          view: "card",
          video: "v",
          transcript: "x",
          pose: POSE,
        },
      ],
    } as unknown as TourStation;
    const model = buildInspector({
      selected: "station:b",
      stations: [STATIONS[0]!, storyStation],
      assets: [],
      codes: CODES,
    });
    expect(model?.kind === "station" && model.story).toEqual([
      { id: "intro", kind: "Long text", title: "The siege" },
      { id: "guard", kind: "Character", title: "Character" },
    ]);
  });

  it("shows an item's kind, its station, its offset and its size", () => {
    expect(inspect("pin-1")).toEqual({
      kind: "item",
      itemKind: "pin",
      title: "Fountain, 1612",
      sub: "Short text in Market Square",
      stationId: "a",
      text: "Fountain, 1612",
      sizeM: null,
      // B2c: its other text fields, by the format's caps.
      fields: [
        {
          name: "description",
          label: "Description",
          value: "",
          max: 160,
          prose: true,
          unit: "codePoints",
          required: false,
        },
      ],
      offset: { northM: 4, upM: 1.5, eastM: -2 },
      headingDeg: 0,
      groundOffM: null,
    });
    expect(inspect("model-1")).toMatchObject({
      itemKind: "model",
      title: "3D model",
      sub: "3D model in Market Square",
      sizeM: 2.4,
      fields: [{ name: "title", label: "Title", max: 80, prose: false }],
      headingDeg: 90,
    });
  });

  it("shows a code's print size and position, or that it has none", () => {
    expect(inspect("level-1")).toEqual({
      kind: "code",
      title: "Code 1",
      sub: "Printed code, measured on site",
      printSizeM: 0.5,
      position: {
        eastM: expect.any(Number),
        northM: expect.any(Number),
        altM: 561.5,
        headingDeg: 180,
      },
    });
    // The code stands about 4 km south-west of the stations' centre.
    const code = positionOf("level-1");
    expect(code.northM).toBeCloseTo((48.1 - 48.1375617) * 111_190, -1);
    expect(code.eastM).toBeCloseTo((11.5 - 11.57571605) * 74_460, -1);
    expect(inspect("level-2")).toMatchObject({
      printSizeM: null,
      position: null,
    });
  });
});

// Why this test matters: the bottom bar's hint is the only words that
// tell a creator how the selection's handles work (which one moves, which
// turns, which sizes), so each kind must name exactly the handles it has:
// a pin offering a "dot to resize" it does not have, or a code offering a
// drag it refuses, sends the creator looking for what is not there.
describe("inspectorHint", () => {
  // Why: the inspector's lock is the only place a station is unlocked, so
  // it must read the page's lock - locked by default - and the hint must
  // not invite a drag the lock refuses.
  it("shows a station locked until it is unlocked, and hints at its radius alone", () => {
    expect(inspect("station:a")).toMatchObject({ locked: true });
    const open = buildInspector({
      selected: "station:a",
      stations: STATIONS,
      assets: [],
      codes: CODES,
      unlockedStations: ["a"],
    });
    expect(open).toMatchObject({ locked: false });
    expect(inspectorHint(inspect("station:a"))).toBe(
      "Market Square - a white dot for the radius; its position is locked (unlock it under Position to move or turn it)",
    );
    expect(inspectorHint(open)).toBe(
      "Market Square - drag the middle to move (its items follow), a white dot for the radius, the round arrow to turn",
    );
  });

  it("names the handles each selection has, and how to select with none", () => {
    expect(inspectorHint(null)).toBe(
      "Click a station, an item or a code; drag to orbit, right-drag to pan, wheel to zoom; right-click the ground for a new station",
    );
    expect(inspectorHint(inspect("station:a", ["a"]))).toBe(
      "Market Square - drag the middle to move (its items follow), a white dot for the radius, the round arrow to turn",
    );
    expect(inspectorHint(inspect("pin-1"))).toBe(
      "Fountain, 1612 - drag the middle to move along the ground, the round arrow to turn",
    );
    expect(inspectorHint(inspect("model-1"))).toBe(
      "3D model - drag the middle to move along the ground, the round arrow to turn, a white dot to resize",
    );
    expect(inspectorHint(inspect("level-1"))).toBe(
      "Code 1 - read-only here; F frames it, Esc deselects",
    );
  });
});

describe("headingOfRotation", () => {
  // Why: a rotation turned by a known angle about up reads back as that
  // bearing (clockwise from north), within a hair, for every quarter and
  // in between; a rotation that is not a number reads as none.
  it("reads the bearing a turn about up gives", () => {
    for (const deg of [0, 45, 90, 135, 180, 270, 359]) {
      // A turn of -deg about up (counter-clockwise seen from above in
      // north-up-east) points north at a bearing of +deg.
      expect(headingOfRotation(turn(-deg))).toBeCloseTo(deg % 360, 6);
    }
    expect(headingOfRotation([Number.NaN, 0, 0, 1])).toBeNull();
  });

  // Why: an item tipped so that its forward points straight up or down
  // has no bearing at all; a number there would be the noise of a
  // near-zero atan2.
  it("gives no bearing for a forward turned straight up or down", () => {
    const s = Math.SQRT1_2;
    // A quarter turn about east turns north to up, and back to down.
    expect(headingOfRotation([0, 0, s, s])).toBeNull();
    expect(headingOfRotation([0, 0, -s, s])).toBeNull();
    // A hair short of straight up still has one.
    const a = (Math.PI / 2 - 1e-3) / 2;
    expect(headingOfRotation([0, 0, Math.sin(a), Math.cos(a)])).toBe(0);
  });
});

describe("buildInspector: the values the inspector edits", () => {
  const PHOTO_STATION = {
    id: "p",
    title: "Gate",
    image: "img-2",
    geo: { lat: 48.1371234, lon: 11.5754321, alt: 560, headingDeg: 0 },
    activateRadiusM: 20,
    foundRadiusM: 10,
    hint: "arrow",
    steps: [],
    blocks: [
      {
        id: "photo-1",
        kind: "picture",
        view: "plane",
        image: "photo-1",
        widthM: 1,
        caption: "North face",
        createdAtIso: AT,
        pose: { position: [3, 1.5, 4], rotation: [0, 0, 0, 1] },
      },
      {
        id: "pin-far",
        kind: "shortText",
        view: "pin",
        caption: "Far pin",
        createdAtIso: AT,
        pose: { position: [12, 0, 0], rotation: [0, 0, 0, 1] },
      },
    ],
  } as unknown as TourStation;
  /** The photo's own image asset: a captured photo's file. */
  const PHOTO_ASSET = {
    id: "photo-1",
    path: "content/photo-1.jpg",
    kind: "image" as const,
    width: 4,
    height: 3,
  };
  const ASSETS = [
    PHOTO_ASSET,
    {
      id: "img-2",
      path: "content/img-2.png",
      kind: "image" as const,
      width: 4,
      height: 3,
    },
    {
      id: "horse",
      path: "content/horse.glb",
      kind: "model" as const,
    },
  ];
  const at = (
    selected: string,
    more: Partial<Parameters<typeof buildInspector>[0]> = {},
  ) =>
    buildInspector({
      selected,
      stations: [PHOTO_STATION, ...STATIONS],
      assets: ASSETS,
      codes: CODES,
      ...more,
    });

  // Why: the title box shows what the creator typed, never the stand-in
  // the tree shows for an untitled station - typing into "Station 2"
  // would otherwise save that stand-in as a real title.
  it("gives a station's own name to edit, empty for an untitled one", () => {
    expect(at("station:p")).toMatchObject({ name: "Gate", title: "Gate" });
    expect(at("station:b")).toMatchObject({ name: "", title: "Station 3" });
  });

  // Why: the card picture may be one of the station's photos or an image
  // of the tour; the picker must offer exactly those (no model, no photo
  // of another station) and mark the one the card shows now.
  it("offers the station's photos and the tour's images for the card, the one shown marked", () => {
    expect(at("station:p")).toMatchObject({
      images: [
        { id: "photo-1", path: "content/photo-1.jpg", label: "North face" },
        { id: "img-2", path: "content/img-2.png", label: "Tour image" },
      ],
      imageId: "img-2",
    });
    // No card picture named: the first photo is the card's.
    expect(
      buildInspector({
        selected: "station:p",
        stations: [
          { ...PHOTO_STATION, image: undefined } as unknown as TourStation,
        ],
        assets: [PHOTO_ASSET],
        codes: [],
      }),
    ).toMatchObject({
      images: [{ id: "photo-1" }],
      imageId: "photo-1",
    });
    expect(at("station:b")).toMatchObject({
      images: [{ id: "img-2" }],
      imageId: null,
    });
  });

  // Why: a radius lowered under its items leaves them where they are; the
  // inspector is where the creator learns how many now stand outside.
  it("counts the items outside the circle", () => {
    expect(at("station:p")).toMatchObject({ outside: 1 });
    expect(
      at("station:p", {
        stations: [{ ...PHOTO_STATION, foundRadiusM: 4 }],
      }),
    ).toMatchObject({ outside: 2 });
    expect(at("station:b")).toMatchObject({ outside: 0 });
  });

  // Why: the 3D view's frame is fixed when it opens; after a station
  // moves, the mean of the stations moves too, so metres measured from it
  // would no longer be where the view draws the station.
  it("measures a position from the view's origin when it is given", () => {
    const origin = { lat: 48.1371234, lng: 11.5754321 };
    const station = at("station:p", { origin });
    if (station?.kind !== "station" || station.position === null) {
      throw new Error("no position");
    }
    expect(station.position.eastM).toBeCloseTo(0, 6);
    expect(station.position.northM).toBeCloseTo(0, 6);
  });

  // Why: "Put on the ground" and "Put items on the ground" are offered
  // only when something stands off the ground; with the ground not loaded
  // the inspector cannot know, and says so as null rather than 0.
  it("says how far the station and its items stand off the ground, or null before it has loaded", () => {
    const flat = (alt: number) => () => alt;
    expect(at("station:p", { groundAt: flat(560) })).toMatchObject({
      groundOffM: 0,
      offGround: 1,
    });
    expect(at("station:p", { groundAt: flat(559) })).toMatchObject({
      groundOffM: 1,
      offGround: 2,
    });
    expect(at("station:p")).toMatchObject({
      groundOffM: null,
      offGround: null,
    });
    const photo = at("photo-1", { groundAt: flat(560) });
    expect(photo).toMatchObject({ kind: "item", stationId: "p" });
    if (photo?.kind !== "item" || photo.groundOffM === null) {
      throw new Error("no ground");
    }
    expect(photo.groundOffM).toBeCloseTo(1.5, 3);
    expect(at("pin-far", { groundAt: flat(560) })).toMatchObject({
      groundOffM: expect.closeTo(0, 3),
    });
  });

  // Why: the readout draws the inspector again whenever its model
  // changes, and the ground under a station changes by centimetres while
  // finer tiles stream in. A model carrying the raw heights changed on
  // every tile, so the inspector was drawn again under a creator's
  // typing for differences it never shows: it shows tenths of a metre,
  // and "on the ground" within ON_GROUND_M.
  it("gives the heights off the ground as shown, so ground that changes by centimetres changes nothing (property)", () => {
    const tenth = (m: number) =>
      Math.abs(m) <= ON_GROUND_M ? 0 : Math.round(m * 10);
    // The height off the ground as the model computes it from `m`.
    const raw = (m: number) => 560 - (560 - m);
    fc.assert(
      fc.property(
        fc.double({ min: -40, max: 40, noNaN: true }),
        fc.double({ min: -0.004, max: 0.004, noNaN: true }),
        (offM, jitterM) => {
          const ground = (m: number) => () => 560 - m;
          const shown = at("station:p", { groundAt: ground(offM) });
          if (shown?.kind !== "station" || shown.groundOffM === null) {
            throw new Error("no ground");
          }
          const off = shown.groundOffM;
          expect(off).toBe(tenth(raw(offM)) / 10);
          expect(Math.abs(off - offM)).toBeLessThanOrEqual(0.05 + 1e-9);
          // A jitter that does not cross a shown tenth changes nothing;
          // one that does changes the model.
          const near = at("station:p", { groundAt: ground(offM + jitterM) });
          const crosses = tenth(raw(offM)) !== tenth(raw(offM + jitterM));
          expect(JSON.stringify(near) === JSON.stringify(shown)).toBe(!crosses);
        },
      ),
      { numRuns: 300 },
    );
  });

  // Why: a pin's text is its label and edited here; a photo's or a
  // model's caption is not (the session edits pins' text only), so its
  // title is not offered as a field.
  it("offers a pin's text to edit, and no caption of a photo or a model", () => {
    expect(at("pin-1")).toMatchObject({ text: "Fountain, 1612" });
    expect(at("photo-1")).toMatchObject({ text: null });
    expect(at("model-1")).toMatchObject({ text: null });
  });
});
