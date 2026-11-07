/**
 * Why these tests matter: the rule that a move never makes a station has
 * to hold for any run of moves, answered or not, near a circle's edge or
 * far past it; and an item must never end in two stations or in none,
 * which is what a half-applied change of station would look like. The
 * spots sweep from inside the circle to past the format's bound.
 */
import fc from "fast-check";
import { tourFreeBlocks } from "gps-plus-slam-app-framework/ar/tour-station-pose";
import { describe, expect, it } from "vitest";

import { objectOf, spot, twoStations } from "./test-support/two-stations.js";
import {
  manifestToWrite,
  tourDocumentActions as act,
  tourDocumentReducer as reduce,
  type TourDocumentState,
} from "./tour-document.js";

interface Move {
  readonly id: string;
  readonly north: number;
  readonly east: number;
  readonly join: string | undefined;
  readonly settle: boolean;
}

const move: fc.Arbitrary<Move> = fc.record({
  id: fc.constantFrom("p", "q"),
  north: fc.oneof(
    fc.double({ min: -30, max: 130, noNaN: true }),
    fc.double({ min: -30_000, max: 30_000, noNaN: true }),
  ),
  east: fc.double({ min: -1000, max: 1000, noNaN: true }),
  join: fc.constantFrom(undefined, "a", "b", "gone"),
  settle: fc.boolean(),
});

function applied(
  state: TourDocumentState,
  { id, north, east, join, settle }: Move,
): TourDocumentState {
  const object = { ...objectOf(state, id), geo: spot(north, east) };
  return settle
    ? reduce(
        state,
        act.settleApplied({
          changes: [{ kind: "object", object }],
          codes: [],
          hand: null,
          what: "s",
        }),
      )
    : reduce(
        state,
        act.moved({
          object,
          what: "m",
          ...(join === undefined ? {} : { joinStation: join }),
        }),
      );
}

describe("a run of moves", () => {
  it("creates no station, and leaves every item in exactly one", () => {
    fc.assert(
      fc.property(fc.array(move, { maxLength: 24 }), (moves) => {
        let state = twoStations();
        for (const m of moves) state = applied(state, m);
        const stations = manifestToWrite(state)?.stations ?? [];
        // An emptied automatic station may go; none may come.
        expect(stations.every((s) => ["a", "b"].includes(s.id))).toBe(true);
        const items = stations.flatMap((s) =>
          tourFreeBlocks(s).map((block) => block.id),
        );
        expect([...items].sort()).toEqual(["p", "q"]);
      }),
    );
  });
});
