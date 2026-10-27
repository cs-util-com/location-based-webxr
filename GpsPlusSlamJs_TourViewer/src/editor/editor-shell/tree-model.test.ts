/**
 * Why these tests matter: the 3D view's tree is drawn from the store
 * alone - the tour document and `editorView` - so what a card says, which
 * card is selected and which is unfolded must follow from those and
 * nothing else. Titles come from a file anyone can write, so they stay
 * text; a station's card picture follows the format's rule (a photo of
 * that station, or an image of the tour, else its first photo); and a
 * layer the view cannot show has no chip.
 */
import { describe, expect, it } from "vitest";

import type {
  TourAsset,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";

import { initialEditorViewState } from "../editor-view.js";
import {
  buildTree,
  stationImagePath,
  treeFoldOf,
  type TreeInput,
} from "./tree-model.js";

const POSE = { position: [0, 0, 0], rotation: [0, 0, 0, 1] } as const;
const AT = "2026-10-22T10:00:00Z";

function station(
  id: string,
  extra: Partial<TourStation> = {},
  items: TourStation["blocks"] = [],
): TourStation {
  return {
    id,
    geo: { lat: 48.137, lon: 11.575, alt: 560, headingDeg: 0 },
    activateRadiusM: 50,
    foundRadiusM: 25,
    hint: "arrow",
    steps: [],
    blocks: items,
    ...extra,
  };
}

const PIN = {
  id: "pin-1",
  kind: "shortText",
  view: "pin",
  caption: "Fountain <b>1612</b>",
  createdAtIso: AT,
  pose: POSE,
} as const;
const PHOTO = {
  id: "photo-1",
  kind: "picture",
  view: "plane",
  image: "photo-1",
  widthM: 1,
  createdAtIso: AT,
  pose: POSE,
} as const;
const PHOTO_2 = {
  ...PHOTO,
  id: "photo-2",
  image: "photo-2",
  caption: "  The square in 1900  ",
};
const MODEL = {
  id: "model-1",
  kind: "model",
  view: "placed",
  asset: "horse",
  sizeM: 2.4,
  createdAtIso: AT,
  pose: POSE,
} as const;
const ASSETS: TourAsset[] = [
  { id: "cover", path: "content/cover.webp", kind: "image" },
  { id: "photo-1", path: "content/photo-1.jpg", kind: "image" },
  { id: "photo-2", path: "content/photo-2.jpg", kind: "image" },
  { id: "horse", path: "content/horse.glb", kind: "model" },
];

function input(over: Partial<TreeInput> = {}): TreeInput {
  return {
    stations: [
      station("a", { title: "Market Square", description: "  Old  " }, [
        PIN,
        PHOTO,
        PHOTO_2,
        MODEL,
      ]),
      station("b"),
    ],
    assets: ASSETS,
    codes: [{ id: "level-1", title: "Code 1", meta: "Printed code" }],
    view: initialEditorViewState,
    layers: ["codes", "names"],
    ...over,
  };
}

describe("buildTree", () => {
  it("draws a card per station, numbered, folded, with its items as text", () => {
    const tree = buildTree(
      input({
        view: { ...initialEditorViewState, openStations: ["a"] },
      }),
    );
    expect(tree.stationCount).toBe(2);
    expect(tree.cards.map((c) => [c.number, c.title, c.open])).toEqual([
      [1, "Market Square", true],
      [2, "Station 2", false],
    ]);
    const [a, b] = tree.cards;
    expect(a?.description).toBe("Old");
    expect(b?.description).toBeNull();
    expect(a?.selection).toBe("station:a");
    expect(a?.children.map((c) => [c.kind, c.title])).toEqual([
      ["pin", "Fountain <b>1612</b>"],
      // An untitled picture is named by its kind, as the inspector names it.
      ["photo", "Picture"],
      ["photo", "The square in 1900"],
      ["model", "3D model"],
    ]);
  });

  it("marks the selected card, and the card of a selected item as its context", () => {
    const station = buildTree(
      input({ view: { ...initialEditorViewState, selected: "station:b" } }),
    );
    expect(station.cards.map((c) => [c.selected, c.context])).toEqual([
      [false, false],
      [true, false],
    ]);
    const item = buildTree(
      input({ view: { ...initialEditorViewState, selected: "photo-2" } }),
    );
    expect(item.cards.map((c) => [c.selected, c.context])).toEqual([
      [false, true],
      [false, false],
    ]);
    expect(
      item.cards[0]?.children.filter((c) => c.selected).map((c) => c.id),
    ).toEqual(["photo-2"]);
    const code = buildTree(
      input({ view: { ...initialEditorViewState, selected: "level-1" } }),
    );
    expect(code.codes).toEqual([
      { id: "level-1", title: "Code 1", meta: "Printed code", selected: true },
    ]);
  });

  it("offers a chip for each layer the view can show, on unless hidden", () => {
    const tree = buildTree(
      input({
        view: { ...initialEditorViewState, hiddenLayers: ["names", "walk"] },
      }),
    );
    expect(tree.chips).toEqual([
      { layer: "codes", label: "Codes", on: true },
      { layer: "names", label: "Station names", on: false },
    ]);
  });

  it("carries the sections as the view holds them", () => {
    const tree = buildTree(
      input({
        view: {
          ...initialEditorViewState,
          openSections: { stations: false, codes: true, layers: false },
        },
      }),
    );
    expect(tree.sections).toEqual({
      stations: false,
      codes: true,
      layers: false,
    });
  });

  it("ignores an unfolded id the tour no longer has", () => {
    const tree = buildTree(
      input({
        view: { ...initialEditorViewState, openStations: ["gone", "b"] },
      }),
    );
    expect(treeFoldOf(tree).openStations).toEqual(["b"]);
  });
});

describe("stationImagePath", () => {
  // Why: the card picture follows the format's referent rule - a photo of
  // THAT station or an image asset of the tour - and otherwise the
  // station's first photo; a model asset or a missing id is no picture.
  it("names the station's chosen photo or the tour's image", () => {
    const items = [PIN, PHOTO, PHOTO_2];
    expect(
      stationImagePath(station("a", { image: "photo-2" }, items), ASSETS),
    ).toBe("content/photo-2.jpg");
    expect(
      stationImagePath(station("a", { image: "cover" }, items), ASSETS),
    ).toBe("content/cover.webp");
  });

  it("falls back to the first photo, and to none", () => {
    expect(stationImagePath(station("a", {}, [PIN, PHOTO_2]), ASSETS)).toBe(
      "content/photo-2.jpg",
    );
    expect(
      stationImagePath(station("a", { image: "horse" }, [PIN]), ASSETS),
    ).toBeNull();
    expect(
      stationImagePath(station("a", { image: "gone" }, [PHOTO]), ASSETS),
    ).toBe("content/photo-1.jpg");
    expect(stationImagePath(station("a"), ASSETS)).toBeNull();
  });
});
