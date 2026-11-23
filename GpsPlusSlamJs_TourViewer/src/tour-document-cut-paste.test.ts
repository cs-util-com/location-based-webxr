/**
 * Why these tests matter: a Paste of a cut moves everything cut onto
 * another station as ONE step (`childrenMoved`), through the move rule
 * the tree's drag takes (`childMoveChange`). A cut keeps ids (answers and
 * links still name them), takes each item out of its old station, and
 * one undo gives the tour back exactly; a move the rule refuses refuses
 * the lot, so a paste is never half made.
 */
import {
  parseTourManifest,
  serializeTourManifest,
  type TourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { tourStationChildIds } from "gps-plus-slam-app-framework/ar/tour-story";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  playableStory,
  stationContent,
} from "./test-support/station-content.js";
import { tourOf } from "./test-support/tour-of.js";
import {
  initialTourDocumentState,
  manifestToWrite,
  tourDocumentActions as act,
  tourDocumentReducer as reduce,
  type TourDocumentState,
} from "./tour-document.js";

function pin(id: string) {
  return {
    id,
    kind: "shortText",
    view: "pin",
    caption: id,
    createdAtIso: "2026-11-02T00:00:00.000Z",
    pose: { position: [1, 0, 1], rotation: [0, 0, 0, 1] },
  } as const;
}

/** Station a: notes n and o, story t (entry t-card); station b: note e. */
function opened(): TourDocumentState {
  const wire = tourOf([], {
    stations: ["a", "b"].map((id, i) => ({
      id,
      title: id,
      geo: {
        lat: 48.52,
        lon: 9.05 + i * 0.002,
        alt: 400,
        rotation: [0, 0, 0, 1],
      },
      activateRadiusM: 40,
      foundRadiusM: 20,
      hint: "arrow",
      ...stationContent(
        id === "a" ? [pin("n"), pin("o"), playableStory("t")] : [pin("e")],
      ),
    })),
  });
  return reduce(
    initialTourDocumentState,
    act.opened({
      manifest: parseTourManifest(JSON.parse(serializeTourManifest(wire))),
    }),
  );
}

const onto = (station: string) => ({ place: "station", station }) as const;

function tour(state: TourDocumentState): TourManifest {
  const manifest = manifestToWrite(state);
  if (manifest === null) throw new Error("no tour");
  return manifest;
}

function childIds(state: TourDocumentState, station: string): string[] {
  const found = tour(state).stations.find((s) => s.id === station);
  return found === undefined ? [] : tourStationChildIds(found);
}

describe("a Paste of a cut", () => {
  it("moves every cut item onto the station as one step, keeping ids, and one undo gives the tour back", () => {
    const start = opened();
    const after = reduce(
      start,
      act.childrenMoved({
        moves: [
          { id: "n", to: onto("b") },
          { id: "t", to: onto("b") },
        ],
        what: "the move of 2 items",
      }),
    );
    expect(after.past.length).toBe(start.past.length + 1);
    expect(after.past.at(-1)?.what).toBe("the move of 2 items");
    expect(childIds(after, "b")).toEqual(
      expect.arrayContaining(["e", "n", "t", "t-card"]),
    );
    expect(childIds(after, "a")).toEqual(["o"]);
    expect(tour(reduce(after, act.undone()))).toEqual(tour(start));
  });

  it("refuses the lot when one move is refused, and an empty list", () => {
    const start = opened();
    for (const moves of [
      [
        { id: "n", to: onto("b") },
        { id: "gone", to: onto("b") },
      ],
      [{ id: "e", to: onto("b") }],
      [],
    ]) {
      expect(reduce(start, act.childrenMoved({ moves, what: "move" }))).toBe(
        start,
      );
    }
  });

  // The property over any set of a's children: every id is in the tour
  // once, now in b; a holds what was not moved; one step, undone exactly.
  it("keeps every id once, moved or not, as one undoable step (property)", () => {
    const start = opened();
    fc.assert(
      fc.property(fc.subarray(["n", "o", "t"], { minLength: 1 }), (ids) => {
        const after = reduce(
          start,
          act.childrenMoved({
            moves: ids.map((id) => ({ id, to: onto("b") })),
            what: "cut",
          }),
        );
        const all = [...childIds(after, "a"), ...childIds(after, "b")];
        expect([...all].sort()).toEqual(["e", "n", "o", "t", "t-card"].sort());
        for (const id of ids) expect(childIds(after, "b")).toContain(id);
        expect(after.past.length).toBe(start.past.length + 1);
        expect(tour(reduce(after, act.undone()))).toEqual(tour(start));
      }),
    );
  });
});
