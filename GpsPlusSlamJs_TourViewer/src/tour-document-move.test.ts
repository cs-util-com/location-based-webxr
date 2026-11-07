/**
 * Why these tests matter: a move never changes an item's station by
 * itself. Dropping an item out of its circle used to start a new station
 * or join the one it reached, which took content away from where the
 * creator had it and made stations nobody asked for. Now it stays where
 * it was dropped and the Problems tab says so; only a confirmed answer
 * (`joinStation`) or the explicit "Move to a new station" (`newStation`)
 * changes its station, and a spot beyond the format's bound is refused.
 */
import { describe, expect, it } from "vitest";

import {
  B_NORTH_M,
  objectOf,
  spot,
  twoStations,
} from "./test-support/two-stations.js";
import {
  manifestToWrite,
  tourDocumentActions as act,
  tourDocumentReducer as reduce,
  type TourDocumentState,
} from "./tour-document.js";

function moved(
  state: TourDocumentState,
  north: number,
  east = 0,
  extra: { readonly joinStation?: string } = {},
): TourDocumentState {
  return reduce(
    state,
    act.moved({
      object: { ...objectOf(state, "p"), geo: spot(north, east) },
      what: "the move",
      ...extra,
    }),
  );
}

const stationIds = (state: TourDocumentState) =>
  manifestToWrite(state)?.stations.map((s) => s.id);

describe("moved: an item keeps its station", () => {
  // Sweeps the distance past the circle: 30 m is just out, 9 km is near
  // the format's bound; no distance within the bound starts a station.
  it.each([30, 60, 500, 9000])(
    "dropped %d m east, on free ground, it stays in its station where it was dropped",
    (east) => {
      const after = moved(twoStations(), 0, east);
      expect(objectOf(after, "p").station).toBe("a");
      expect(objectOf(after, "p").geo).toEqual(spot(0, east));
      expect(stationIds(after)).toEqual(["a", "b"]);
    },
  );

  it("dropped in another station's circle without an answer, it stays in its own", () => {
    const after = moved(twoStations(), B_NORTH_M);
    expect(objectOf(after, "p").station).toBe("a");
    expect(objectOf(after, "p").geo).toEqual(spot(B_NORTH_M));
  });

  // Why: the desktop drag and the phone's AR move used to differ here;
  // the map path silently re-seated, the phone refused.
  it("a spot beyond what a station can carry changes nothing", () => {
    const before = twoStations();
    const after = moved(before, 0, 20_000);
    expect(after).toBe(before);
  });

  // Why: a settle moves items by the noise of a visit; it must never
  // change a station or make one, whatever the noise.
  it("a settle's move of an item out of its circle keeps its station", () => {
    const before = twoStations();
    const object = { ...objectOf(before, "p"), geo: spot(30) };
    const after = reduce(
      before,
      act.settleApplied({
        changes: [{ kind: "object", object }],
        codes: [],
        hand: null,
        what: "the settle",
      }),
    );
    expect(objectOf(after, "p")).toMatchObject({ station: "a", geo: spot(30) });
    expect(stationIds(after)).toEqual(["a", "b"]);
  });
});

describe("moved with joinStation: the answered change of station", () => {
  it("changes the station at the dropped spot, as one undo step", () => {
    const before = twoStations();
    const after = moved(before, B_NORTH_M - 5, 0, { joinStation: "b" });
    expect(objectOf(after, "p").station).toBe("b");
    expect(objectOf(after, "p").geo).toEqual(spot(B_NORTH_M - 5));
    expect(after.past.length).toBe(before.past.length + 1);
    const undone = reduce(after, act.undone());
    expect(objectOf(undone, "p").station).toBe("a");
    expect(objectOf(undone, "p").geo).toEqual(spot(0));
  });

  it("names no station the tour lacks: changes nothing", () => {
    const before = twoStations();
    expect(moved(before, B_NORTH_M, 0, { joinStation: "gone" })).toBe(before);
  });
});

describe("moved with newStation: the explicit way out", () => {
  it("still starts a station where the item stands", () => {
    const before = moved(twoStations(), 40);
    const after = reduce(
      before,
      act.moved({
        object: objectOf(before, "p"),
        newStation: true,
        newStationId: "own",
        what: "split",
      }),
    );
    expect(objectOf(after, "p").station).toBe("own");
    expect(stationIds(after)).toContain("own");
  });
});
