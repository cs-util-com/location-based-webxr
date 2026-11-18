/**
 * Why these tests matter: the 3D editor draws the open story's entries
 * (the story chosen in the tree, or one of its entries) where they stand,
 * so a creator sees a story's scene without playing it, and moves an entry
 * there by its disc: the move is written back into its story (one undo
 * step), so its placeable names it as a story entry, never as a free
 * block. A card shows nowhere in the world, so it is neither drawn nor
 * given a handle.
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
      ref: { kind: "storyEntry", id: "second" },
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

  // Why: an entry is moved by its disc alone - it neither turns, lifts
  // nor sizes in 3D (its facing and size are its step's own fields) - and
  // its move must reach the story's save path, so its ref names it as a
  // story entry. A card, a choice and a quiz stand nowhere: no handle.
  it("are placeables moved by the disc alone, named as story entries", () => {
    const first = placeableOf(TOUR, "first");
    expect(first).toMatchObject({
      ref: { kind: "storyEntry", id: "first" },
      selection: "first",
      stationId: "well",
      folderPath: [],
      local: { position: [2, 0, 0], rotation: [0, 0, 0, 1] },
      inStation: { position: [2, 0, 0], rotation: [0, 0, 0, 1] },
      turns: false,
      lifts: false,
      extent: null,
      locked: false,
      members: ["first"],
      group: false,
    });
    expect(first).not.toHaveProperty("bendDeg");
    expect(first?.geo).toEqual(
      itemGeoPose({ position: [2, 0, 0], rotation: [0, 0, 0, 1] }, STATION.geo),
    );
    expect(placeableOf(TOUR, "elsewhere")?.ref).toEqual({
      kind: "storyEntry",
      id: "elsewhere",
    });
    for (const id of ["told", "ask", "legend", "story:legend"]) {
      expect(placeableOf(TOUR, id)).toBeNull();
    }
    // The free block beside them is still a free block.
    expect(placeableOf(TOUR, "free")?.ref).toEqual({
      kind: "block",
      id: "free",
    });
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
