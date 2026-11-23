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

/** New ids for the station `id` of `state` and everything in it:
 *  `<id>2` for the station, `<child>2` for each child and each item. */
function stationCopy(state: TourDocumentState, id: string, after: string) {
  const station = tour(state).stations.find((s) => s.id === id);
  if (station === undefined) throw new Error(`no station ${id}`);
  return {
    stationId: id,
    newStationId: `${id}2`,
    newItemIds: Object.fromEntries(
      tourStationChildIds(station).map((c) => [c, `${c}2`]),
    ),
    createdAtIso: "2026-11-23T00:00:00.000Z",
    after,
  };
}

// Why: a Paste of copied stations (D3) puts each copy after the station
// selected, in the order copied, beside it, every item under a new id;
// the lot is ONE step one undo takes back exactly, and a copy that
// cannot be made (a taken id) makes none of them.
describe("a Paste of copied stations", () => {
  it("puts the copies after the target in the order copied, under new ids, as one step", () => {
    const start = opened();
    const after = reduce(
      start,
      act.stationsPasted({
        copies: [stationCopy(start, "a", "b"), stationCopy(start, "b", "a2")],
        what: "the paste of 2 stations",
      }),
    );
    const stations = tour(after).stations;
    expect(stations.map((s) => s.id)).toEqual(["a", "b", "a2", "b2"]);
    expect(childIds(after, "a2")).toEqual(
      expect.arrayContaining(["n2", "o2", "t2", "t-card2"]),
    );
    expect(childIds(after, "a")).toEqual(childIds(start, "a"));
    expect(after.past.length).toBe(start.past.length + 1);
    expect(after.past.at(-1)?.what).toBe("the paste of 2 stations");
    // Beside the target: the copy of a stands east of b, not of a.
    const geo = (id: string) => stations.find((s) => s.id === id)?.geo.lon;
    expect(geo("a2")).toBeGreaterThan(geo("b") ?? Infinity);
    expect(geo("b2")).toBeGreaterThan(geo("a2") ?? Infinity);
    expect(tour(reduce(after, act.undone()))).toEqual(tour(start));
  });

  it("makes none when one copy cannot be made, and none for an empty list", () => {
    const start = opened();
    const taken = { ...stationCopy(start, "b", "a2"), newStationId: "a" };
    for (const copies of [[stationCopy(start, "a", "b"), taken], []]) {
      expect(reduce(start, act.stationsPasted({ copies, what: "p" }))).toBe(
        start,
      );
    }
  });
});

// Why: a Paste of a copied story (D3) puts the copy after the selected
// story, or at the end of the target station's stories, in any station;
// its entries get new ids, the lot is one step, undone exactly.
describe("a Paste of copied stories", () => {
  const copy = (to: string, after: string | undefined, n: string) => ({
    story: "t",
    newIds: { t: `t${n}`, "t-card": `t-card${n}` },
    toStationId: to,
    ...(after === undefined ? {} : { after }),
  });

  it("puts each copy after the story named, or at the end of the station's stories, as one step", () => {
    const start = opened();
    const after = reduce(
      start,
      act.storiesPasted({
        copies: [
          copy("a", "t", "2"),
          copy("a", "t2", "3"),
          copy("b", undefined, "4"),
        ],
        what: "the paste of 3 stories",
      }),
    );
    // Stories are listed before the free notes (the writer's order).
    expect(childIds(after, "a")).toEqual([
      "t",
      "t-card",
      "t2",
      "t-card2",
      "t3",
      "t-card3",
      "n",
      "o",
    ]);
    expect(childIds(after, "b")).toEqual(
      expect.arrayContaining(["e", "t4", "t-card4"]),
    );
    expect(after.past.length).toBe(start.past.length + 1);
    expect(tour(reduce(after, act.undone()))).toEqual(tour(start));
  });

  it("makes none when a copy names a station or a story the tour lacks, or takes an id", () => {
    const start = opened();
    for (const copies of [
      [copy("a", "t", "2"), copy("nope", undefined, "3")],
      [{ ...copy("a", "t", "2"), story: "nope" }],
      [{ ...copy("b", undefined, "2"), newIds: { t: "e", "t-card": "x" } }],
      [],
    ]) {
      expect(reduce(start, act.storiesPasted({ copies, what: "p" }))).toBe(
        start,
      );
    }
  });

  // The property: any number of copies into either station keeps every
  // id unique, is one step, and is undone exactly.
  it("keeps ids unique and is one undoable step for any set of copies (property)", () => {
    const start = opened();
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom("a", "b"), { minLength: 1, maxLength: 4 }),
        (targets) => {
          const after = reduce(
            start,
            act.storiesPasted({
              copies: targets.map((to, i) =>
                copy(to, undefined, String(i + 2)),
              ),
              what: "p",
            }),
          );
          const all = tour(after).stations.flatMap((s) =>
            tourStationChildIds(s),
          );
          expect(new Set(all).size).toBe(all.length);
          expect(all.length).toBe(5 + 2 * targets.length);
          expect(after.past.length).toBe(start.past.length + 1);
          expect(tour(reduce(after, act.undone()))).toEqual(tour(start));
        },
      ),
    );
  });
});
