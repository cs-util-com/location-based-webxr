/**
 * Why these tests matter: the 3D editor draws the open story's entries
 * (the story chosen in the tree, or one of its entries) where they stand,
 * so a creator sees a story's scene without playing it. Moving them must
 * wait until the story's edits can be saved: an entry that shows but is
 * not a placeable gets no gizmo, which is what keeps an unsaved move from
 * being offered. A card shows nowhere in the world, so it is not drawn.
 */
import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { itemGeoPose } from "gps-plus-slam-app-framework/ar/tour-station-pose";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import "../test-support/tour-of.js";
import { openStoryOf, placeableOf, storyEntries } from "./placeables.js";

function entry(
  id: string,
  view: "pin" | "card",
  position: [number, number, number],
) {
  return {
    id,
    kind: "shortText",
    view,
    caption: id,
    advance: { mode: "tap" },
    pose: { position, rotation: [0, 0, 0, 1] },
  };
}

const STATION = {
  id: "well",
  geo: { lat: 48.52, lon: 9.05, alt: 400, rotation: [0, 0, 0, 1] },
  foundRadiusM: 25,
  children: [
    {
      id: "free",
      kind: "shortText",
      view: "pin",
      caption: "free",
      pose: { position: [0, 0, 1], rotation: [0, 0, 0, 1] },
    },
    {
      id: "legend",
      kind: "folder",
      role: "story",
      title: "The legend",
      children: [
        entry("first", "pin", [2, 0, 0]),
        entry("told", "card", [0, 0, 0]),
        {
          id: "ask",
          kind: "choice",
          prompt: "On?",
          options: [{ label: "Yes" }],
        },
        entry("second", "pin", [0, 1, 3]),
      ],
    },
    {
      id: "other",
      kind: "folder",
      role: "story",
      title: "Another",
      children: [entry("elsewhere", "pin", [5, 0, 0])],
    },
    { id: "plain", kind: "folder", children: [] },
  ],
} as unknown as TourStation;
const TOUR = { stations: [STATION] };

describe("the open story's entries", () => {
  it("are its posed entries in its order, where they stand from the station", () => {
    const entries = storyEntries(STATION, "legend");
    expect(entries.map((e) => e.block.id)).toEqual(["first", "second"]);
    const second = entries[1];
    expect(second?.place).toMatchObject({
      ref: { kind: "block", id: "second" },
      selection: "second",
      stationId: "well",
      folderPath: [],
      inStation: { position: [0, 1, 3], rotation: [0, 0, 0, 1] },
      inheritedScale: 1,
    });
    expect(second?.place.geo).toEqual(
      itemGeoPose({ position: [0, 1, 3], rotation: [0, 0, 0, 1] }, STATION.geo),
    );
  });

  it("are none for a story the station lacks, a plain folder or a block", () => {
    expect(storyEntries(STATION, "missing")).toEqual([]);
    expect(storyEntries(STATION, "plain")).toEqual([]);
    expect(storyEntries(STATION, "free")).toEqual([]);
  });

  it("are no placeables: the gizmo offers none of them a handle", () => {
    for (const id of ["first", "told", "second", "elsewhere"]) {
      expect(placeableOf(TOUR, id)).toBeNull();
    }
    // The free block beside them still is one.
    expect(placeableOf(TOUR, "free")).not.toBeNull();
  });
});

describe("the open story", () => {
  it("is the story chosen in the tree", () => {
    expect(openStoryOf(TOUR, "story:legend")).toBe("legend");
    expect(openStoryOf(TOUR, "story:other")).toBe("other");
  });

  it("is the story of a chosen entry, a card or a choice as well", () => {
    expect(openStoryOf(TOUR, "first")).toBe("legend");
    expect(openStoryOf(TOUR, "told")).toBe("legend");
    expect(openStoryOf(TOUR, "ask")).toBe("legend");
    expect(openStoryOf(TOUR, "elsewhere")).toBe("other");
  });

  it("is none for anything else", () => {
    for (const selection of [
      null,
      "free",
      "station:well",
      "folder:plain",
      "story:plain",
      "story:missing",
      "story:first",
      "missing",
    ]) {
      expect(openStoryOf(TOUR, selection)).toBeNull();
    }
    expect(openStoryOf(null, "story:legend")).toBeNull();
  });

  it("names a story whose entries hold the chosen one, whatever is chosen", () => {
    const ids = [
      "free",
      "legend",
      "first",
      "told",
      "ask",
      "second",
      "other",
      "elsewhere",
      "plain",
      "well",
      "x",
    ];
    expect(() =>
      fc.assert(
        fc.property(
          fc.constantFrom(...ids),
          fc.constantFrom("", "story:", "folder:", "station:"),
          (id, prefix) => {
            const open = openStoryOf(TOUR, `${prefix}${id}`);
            const story = STATION.children.find((c) => c.id === open) as
              | { role?: string; children?: readonly { id: string }[] }
              | undefined;
            return (
              open === null ||
              (story?.role === "story" &&
                (prefix === "story:"
                  ? open === id
                  : prefix === "" &&
                    (story.children ?? []).some((c) => c.id === id)))
            );
          },
        ),
      ),
    ).not.toThrow();
  });
});
