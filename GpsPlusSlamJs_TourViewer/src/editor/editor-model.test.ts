/**
 * Why these tests matter: the editor's rail and map are drawn from this
 * model (M6 E1). A code must carry the same name as on the phone (the
 * plan review's #1: zip order, `codeLabel`), a note the same title as in
 * the phone's list (#3, `object-describe.ts`), and every photo a visitor
 * sees - placed ones and the walk's recorded ones (#9) - must be listed.
 * A position nobody can draw must not reach the map.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  createEmptyTourManifest,
  type TourManifest,
  type TourObject,
  type TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import {
  buildEditorModel,
  filterItems,
  ON_CODE_M,
  photoSource,
  type EditorModel,
} from "./editor-model.js";
import { createTourViewerStore } from "../tour-viewer-session.js";

// The distance lines use the licensed library's geo maths.
beforeAll(() => {
  createTourViewerStore();
});

const AT = { lat: 48.52, lon: 9.053, alt: 340 };

function level(northM: number | null): QrLevel {
  return {
    version: 1,
    qr:
      northM === null
        ? {}
        : {
            geo: {
              lat: AT.lat + northM / 111_320,
              lon: AT.lon,
              alt: AT.alt,
              headingDeg: 0,
            },
          },
  };
}

function pin(id: string, label: string, lat = AT.lat): TourObject {
  return {
    id,
    kind: "pin",
    label,
    createdAtIso: "2026-10-13T00:00:00.000Z",
    geo: { ...AT, lat, headingDeg: 0 },
  };
}

function photo(id: string, label?: string): TourObject {
  return {
    id,
    kind: "photo",
    image: `content/${id}.jpg`,
    imageWidth: 4,
    imageHeight: 3,
    createdAtIso: "2026-10-13T00:00:00.000Z",
    geo: { ...AT, rotation: [0, 0, 0, 1] },
    ...(label === undefined ? {} : { label }),
  };
}

function manifest(over: Partial<TourManifest> = {}): TourManifest {
  return { ...createEmptyTourManifest(), ...over };
}

/** A station at `geo`, turned like north. */
function stationAt(id: string, geo: QrGeoPose, title?: string): TourStation {
  return {
    id,
    ...(title === undefined ? {} : { title }),
    geo,
    activateRadiusM: 30,
    foundRadiusM: 5,
    hint: "arrow",
    steps: [],
    items: [],
  };
}

/** The items besides the stations. */
function notStations(m: EditorModel) {
  return m.items.filter((i) => i.kind !== "station");
}

describe("buildEditorModel", () => {
  it("numbers the codes in the zip's order, as the phone does, and lists one without a position", () => {
    const m = buildEditorModel({
      manifest: manifest(),
      objects: [],
      levels: new Map([
        ["b-id", level(5)],
        ["a-id", level(null)],
      ]),
      fileName: "tour.zip",
    });
    const codes = m.items.filter((i) => i.kind === "code");
    expect(codes.map((c) => [c.id, c.title, c.number])).toEqual([
      ["b-id", "Code 1", 1],
      ["a-id", "Code 2", 2],
    ]);
    expect(codes[0]?.meta).toBe("Printed code, measured on site");
    expect(codes[1]?.at).toBeNull();
    expect(codes[1]?.meta).toBe("Printed code, no position stored yet");
    // Only what has a position frames the map.
    expect(m.fitPoints).toHaveLength(1);
  });

  it("calls a single code 'The code', as the phone's summary does", () => {
    const m = buildEditorModel({
      manifest: manifest(),
      objects: [],
      levels: new Map([["only", level(0)]]),
      fileName: "tour.zip",
    });
    expect(m.items[0]?.title).toBe("The code");
  });

  it("names notes as the phone's list does and says how far each is from a code", () => {
    const m = buildEditorModel({
      manifest: manifest(),
      objects: [pin("p", "The town hall"), photo("f", "  ")],
      levels: new Map([["c", level(4)]]),
      fileName: "tour.zip",
    });
    const [p, f] = m.items.filter((i) => i.kind !== "code");
    expect(p).toMatchObject({
      title: "The town hall",
      meta: "Text note · 4 m from the code",
    });
    expect(f).toMatchObject({
      title: "Photo",
      meta: "Photo note · 4 m from the code",
      image: "content/f.jpg",
    });
    expect(m.counts).toEqual({ code: 1, pin: 1, photo: 1, station: 0 });
  });

  // (A test that a file's capture spots gave no item and counted as no
  // photo stood here: the walk's camera captures were once listed as
  // "Recorded photo" items. The field that carried them is gone from the
  // format, so nothing can list them; the debug layer draws the frames.)

  it("lists the story's stations at their own positions (version 3, D9)", () => {
    // Why: a story tour (the committed sample) may carry no pins or photos
    // at all - only stations; an editor that ignored them opened it as an
    // empty map. Since version 3 every station has a spot of its own: none
    // is drawn at a code any more.
    const north = { ...AT, lat: AT.lat + 4 / 111_320, headingDeg: 0 };
    const m = buildEditorModel({
      manifest: manifest({
        stations: [
          stationAt("column", { ...AT, headingDeg: 0 }, "The column"),
          stationAt("gate", north),
        ],
      }),
      objects: [],
      levels: new Map([["c", level(4)]]),
      fileName: "tour.zip",
    });
    const stations = m.items.filter((i) => i.kind === "station");
    expect(stations.map((x) => [x.id, x.title, x.meta])).toEqual([
      ["station:column", "The column", "Station 1"],
      ["station:gate", "Station 2", "Station 2"],
    ]);
    expect(stations[1]?.at).toEqual({ lat: north.lat, lng: north.lon });
    expect(m.counts.station).toBe(2);
  });

  it("marks a station standing at a code's point, so the map draws it beside the code (PR #609 review)", () => {
    // Why: a station and a code drawn at the same point with the same size
    // hide one under the other, and only the rail could reach the station.
    // Version 3 has no code link (D9), but a creator still puts stations
    // at codes; within ON_CODE_M of a code's measured point is "at it".
    const atCode = { ...AT, lat: AT.lat + 4 / 111_320, headingDeg: 0 };
    const near = { ...atCode, lat: atCode.lat + 0.9 * (ON_CODE_M / 111_320) };
    const apart = { ...atCode, lat: atCode.lat + 1.1 * (ON_CODE_M / 111_320) };
    const m = buildEditorModel({
      manifest: manifest({
        stations: [
          stationAt("at", atCode),
          stationAt("near", near),
          stationAt("apart", apart),
          stationAt("alone", { ...AT, headingDeg: 0 }),
        ],
      }),
      objects: [],
      levels: new Map([["c", level(4)]]),
      fileName: "tour.zip",
    });
    const stations = m.items.filter((i) => i.kind === "station");
    expect(stations.map((x) => [x.id, x.onCode])).toEqual([
      ["station:at", true],
      ["station:near", true],
      ["station:apart", undefined],
      ["station:alone", undefined],
    ]);
    // It keeps its own point: only the drawing moves beside the code.
    expect(stations[1]?.at).toEqual({ lat: near.lat, lng: near.lon });
  });

  it("keeps a note whose position cannot be drawn in the list, off the map (E1 review #9)", () => {
    // Why: dropped from the list too, it could never be found - nor, from
    // E2 on, deleted.
    const m = buildEditorModel({
      manifest: manifest(),
      objects: [pin("bad", "Nowhere", 123)],
      levels: new Map(),
      fileName: "tour.zip",
    });
    expect(m.items).toEqual([
      expect.objectContaining({
        id: "bad",
        at: null,
        meta: "Text note · no position",
      }),
    ]);
    expect(m.fitPoints).toEqual([]);
  });

  // Why: this 2D editor knows pins and photos only; a placed 3D model
  // (format minor 1) is listed nowhere here rather than as a mislabelled
  // note. The tour keeps it untouched; the 3D editor is where it shows.
  it("lists no placed 3D model, and counts none as a pin or a photo", () => {
    const m = buildEditorModel({
      manifest: manifest(),
      objects: [
        pin("p", "The town hall"),
        {
          id: "m",
          kind: "model",
          asset: "statue",
          sizeM: 3,
          createdAtIso: "2026-10-19T00:00:00.000Z",
          geo: { ...AT, headingDeg: 0 },
        },
      ],
      levels: new Map(),
      fileName: "tour.zip",
    });
    expect(m.items.map((i) => i.id)).toEqual(["p"]);
    expect(m.counts).toEqual({ code: 0, pin: 1, photo: 0, station: 0 });
  });

  it("titles the tour with its own name, else the file's", () => {
    const named = buildEditorModel({
      manifest: manifest({ title: "Altstadt walk" }),
      objects: [],
      levels: new Map(),
      fileName: "tour.zip",
    });
    expect(named.title).toBe("Altstadt walk");
    const unnamed = buildEditorModel({
      manifest: manifest({ title: "   " }),
      objects: [],
      levels: new Map(),
      fileName: "tour.zip",
    });
    expect(unnamed.title).toBe("tour.zip");
  });
});

describe("filterItems", () => {
  // Built inside each test: the store the geo maths needs exists only
  // once beforeAll has run.
  const model = () =>
    buildEditorModel({
      manifest: manifest(),
      objects: [pin("p", "The Town Hall"), pin("q", "Fountain")],
      levels: new Map(),
      fileName: "tour.zip",
    });

  it("finds by title or second line, ignoring case and blanks", () => {
    expect(filterItems(model().items, "  town ").map((i) => i.id)).toEqual([
      "p",
    ]);
    expect(filterItems(model().items, "text note")).toHaveLength(2);
  });

  it("shows everything for an empty search", () => {
    expect(filterItems(model().items, "")).toHaveLength(2);
  });
});

describe("photoSource (E1 review #1)", () => {
  // Why: a placed photo's image is a content path inside the tour's
  // folder, read through it (`loadContentEntry`). (A recorded photo's was
  // the archive's own entry name, and joining the folder to both read it
  // from the wrong path; no item is a recorded photo now, so every photo
  // source is content.)
  it("reads a placed photo as content", () => {
    const m = buildEditorModel({
      manifest: manifest(),
      objects: [photo("f")],
      levels: new Map(),
      fileName: "tour.zip",
    });
    expect(photoSource(notStations(m)[0]!)).toBe("content/f.jpg");
  });

  it("is null for an item without a photo", () => {
    const m = buildEditorModel({
      manifest: manifest(),
      objects: [pin("p", "x")],
      levels: new Map(),
      fileName: "tour.zip",
    });
    expect(photoSource(m.items[0]!)).toBeNull();
  });
});
