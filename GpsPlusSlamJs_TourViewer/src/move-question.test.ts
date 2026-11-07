/**
 * Why these tests matter: the question is what stands between a drop and
 * a change of station, on the desktop, the phone and in AR, so when it is
 * asked is the rule: only when a move takes an item INTO another station's
 * circle. Asked on a lift or a turn, on a spot the item already shared
 * with that circle, or on a settle, it would nag; not asked on a real
 * crossing, the item would stay somewhere it does not belong, unsaid.
 */
import { describe, expect, it, vi } from "vitest";

import { askMove, moveNote, moveQuestion } from "./move-question.js";
import {
  B_NORTH_M,
  objectOf,
  spot,
  twoStations,
} from "./test-support/two-stations.js";
import {
  tourDocumentActions as act,
  tourDocumentReducer as reduce,
} from "./tour-document.js";

describe("moveQuestion", () => {
  const state = twoStations();

  it("asks nothing inside its own circle, or on free ground", () => {
    expect(moveQuestion(state, "p", spot(10))).toBeNull();
    expect(moveQuestion(state, "p", spot(50))).toBeNull();
  });

  it("names both stations for a spot in another's circle", () => {
    const asked = moveQuestion(state, "p", spot(B_NORTH_M - 5));
    expect(asked?.stationId).toBe("b");
    expect(asked?.text).toContain('"p"');
    expect(asked?.text).toContain("Gate");
    expect(asked?.text).toContain("Tower");
    expect(asked?.declined).toContain("Gate");
  });

  it("asks nothing for a spot its own circle holds too", () => {
    const overlapping = reduce(
      twoStations(),
      act.stationEdited({
        stationId: "a",
        edit: { foundRadiusM: 90 },
        what: "radius",
      }),
    );
    expect(moveQuestion(overlapping, "p", spot(85))).toBeNull();
  });

  // Why: an answered No leaves the item in the other circle; moving it
  // about in there must not ask again and again.
  it("asks nothing for a circle that already held the item", () => {
    const declined = twoStations(B_NORTH_M - 5);
    expect(moveQuestion(declined, "p", spot(B_NORTH_M - 3))).toBeNull();
  });

  it("asks nothing for a lift or a turn on the same spot", () => {
    const declined = twoStations(B_NORTH_M - 5);
    const object = objectOf(declined, "p");
    expect(
      moveQuestion(declined, "p", { ...object.geo, alt: object.geo.alt + 1 }),
    ).toBeNull();
  });

  // Why: "it stays where you dropped it" would be false for a spot its
  // own station cannot carry; the refusal comes after the answer.
  it("says so when its own station cannot carry the spot", () => {
    const far = reduce(
      twoStations(),
      act.stationMoved({ stationId: "b", geo: spot(20_000), what: "m" }),
    );
    const asked = moveQuestion(far, "p", spot(20_000));
    expect(asked?.stationId).toBe("b");
    expect(asked?.declined).toContain("too far");
  });

  it("asks nothing for an id the tour lacks", () => {
    expect(moveQuestion(state, "nope", spot(100))).toBeNull();
  });
});

describe("askMove", () => {
  const state = twoStations();

  it("does not ask when there is nothing to ask", () => {
    const ask = vi.fn(() => true);
    expect(askMove(state, "p", spot(50), ask)).toBeUndefined();
    expect(ask).not.toHaveBeenCalled();
  });

  it("gives the station on a yes and nothing on a no, the question naming both ways", () => {
    const yes = vi.fn((_: string) => true);
    expect(askMove(state, "p", spot(B_NORTH_M), yes)).toBe("b");
    expect(yes.mock.calls[0]?.[0]).toContain("Tower");
    expect(yes.mock.calls[0]?.[0]).toContain("Otherwise it stays in Gate");
    expect(askMove(state, "p", spot(B_NORTH_M), () => false)).toBeUndefined();
  });
});

describe("moveNote", () => {
  const before = twoStations();
  const after = (north: number, joinStation?: string) =>
    reduce(
      before,
      act.moved({
        object: { ...objectOf(before, "p"), geo: spot(north) },
        what: "m",
        ...(joinStation === undefined ? {} : { joinStation }),
      }),
    );

  it("says a changed station by name", () => {
    expect(moveNote(before, after(B_NORTH_M, "b"), "p")).toBe(
      '"p" is now in Tower',
    );
  });

  it("says an item stands outside its circle", () => {
    expect(moveNote(before, after(50), "p")).toBe(
      '"p" stays in Gate, outside its circle',
    );
  });

  it("says nothing for a move inside, or for one that changed nothing", () => {
    expect(moveNote(before, after(5), "p")).toBeNull();
    expect(moveNote(before, before, "p")).toBeNull();
  });

  it("says nothing for a lift of an item already outside", () => {
    const out = twoStations(50);
    const object = objectOf(out, "p");
    const lifted = reduce(
      out,
      act.moved({
        object: { ...object, geo: { ...object.geo, alt: object.geo.alt + 1 } },
        what: "lift",
      }),
    );
    expect(moveNote(out, lifted, "p")).toBeNull();
  });
});
