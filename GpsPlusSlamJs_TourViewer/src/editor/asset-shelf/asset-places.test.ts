/**
 * Why these tests matter: the shelf's delete warning lists these places
 * before a file is taken out of a tour, and its "Used in" list jumps to
 * them. A place left out is a field the creator did not know they would
 * empty; a wrong selection jumps to the wrong row. They must cover the
 * station picture, story entries and free items, in document order, each
 * block once, and agree with the count the shelf shows.
 */
import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { describe, expect, it } from "vitest";

import { stationContent, storyOf } from "../../test-support/station-content.js";
import type { FileUses } from "../../tour-document.js";
import { assetPlaces, TOUR_COVER_SELECTION } from "./asset-places.js";

const POSE = { position: [0, 0, 0], rotation: [0, 0, 0, 1] } as const;

const sound = (id: string, audio: string, title?: string) =>
  ({
    id,
    kind: "audio",
    view: "card",
    audio,
    transcript: "t",
    pose: POSE,
    ...(title === undefined ? {} : { title }),
  }) as const;

function station(
  id: string,
  content: Parameters<typeof stationContent>[0],
  extra: Partial<TourStation> = {},
): TourStation {
  return {
    id,
    geo: { lat: 48.52, lon: 9.05, alt: 340, rotation: [0, 0, 0, 1] },
    activateRadiusM: 50,
    foundRadiusM: 25,
    hint: "arrow",
    ...stationContent(content),
    ...extra,
  };
}

/** The uses `fileUsesOf` would find: the blocks by id, the cards by
 *  station id. */
const uses = (
  blocks: readonly string[],
  extra: Partial<FileUses> = {},
): FileUses => ({
  own: blocks.map((id) => ({ id }) as never),
  mentions: [],
  inline: [],
  cards: [],
  characters: [],
  cover: false,
  ...extra,
});

describe("assetPlaces", () => {
  // An untitled item is named by its kind, as everywhere in the editor
  // (`objectTitle`).
  it("lists the station picture, story entries and free items, in order", () => {
    const stations = [
      station("a", [sound("other", "x")], { title: "Column" }),
      station(
        "b",
        [
          storyOf("st", [sound("s1", "bells", "Bells")], "The legend"),
          { ...sound("free", "bells"), view: "pin" } as never,
        ],
        { title: "The old gate", image: "bells" },
      ),
    ];
    expect(
      assetPlaces(stations, uses(["s1", "free"], { cards: ["b"] })),
    ).toEqual([
      {
        selection: "station:b",
        label: "2 The old gate › station picture",
      },
      { selection: "s1", label: "2 The old gate › The legend › Bells" },
      { selection: "free", label: "2 The old gate › Audio" },
    ]);
  });

  it("names an untitled station by its number and an untitled story as a story", () => {
    const stations = [station("a", [storyOf("st", [sound("s1", "f")], " ")])];
    expect(assetPlaces(stations, uses(["s1"]))).toEqual([
      { selection: "s1", label: "1 Station 1 › Story › Audio" },
    ]);
  });

  it("is empty for a file nothing uses", () => {
    expect(assetPlaces([station("a", [sound("s", "x")])], uses([]))).toEqual(
      [],
    );
    expect(assetPlaces([], uses([]))).toEqual([]);
  });

  // Why: a character drawn with the file and the tour's cover are places
  // too; left out, the delete warning would hide them and the list would
  // be shorter than the card's "Used in" count.
  it("lists the characters drawn with the file and the cover after the stations", () => {
    const stations = [station("a", [sound("s1", "f")])];
    expect(
      assetPlaces(
        stations,
        uses(["s1"], { characters: ["The miller"], cover: true }),
      ),
    ).toEqual([
      { selection: "s1", label: "1 Station 1 › Audio" },
      { label: 'Character "The miller"' },
      { selection: TOUR_COVER_SELECTION, label: "The tour's cover" },
    ]);
  });
});
