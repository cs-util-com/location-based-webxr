/**
 * Why these tests matter: each placement edit - a gesture of the 3D view,
 * a key hold, a typed place - becomes exactly one call of the editor
 * session, so exactly one undo step, and a refusal (the format's bounds,
 * an item gone meanwhile) must reach the creator in its own words rather
 * than vanish. A move of a block that went to the station call (or the
 * other way round) would move the wrong thing.
 */
import { describe, expect, it, vi } from "vitest";

import type { EditorSession } from "../editor/editor-session.js";
import { applyPlaceEdit, type PlaceEdit } from "./place-edits.js";

const GEO = { lat: 1, lon: 2, alt: 3, headingDeg: 4 };
const BLOCK = { kind: "block", id: "p" } as const;
const MODEL = { kind: "block", id: "m" } as const;
const STATION = { kind: "station", id: "st" } as const;

function fakeSession(refuse = false) {
  const outcome = refuse
    ? { kind: "refused" as const, reason: "No." }
    : { kind: "moved" as const };
  return {
    pose: vi.fn(() => outcome),
    moveStation: vi.fn(() => outcome),
    editStation: vi.fn(() =>
      refuse
        ? { kind: "refused" as const, reason: "No." }
        : { kind: "edited" as const },
    ),
    setExtent: vi.fn(() =>
      refuse
        ? { kind: "refused" as const, reason: "No." }
        : { kind: "resized" as const },
    ),
  };
}

const asSession = (s: ReturnType<typeof fakeSession>) =>
  s as unknown as Pick<
    EditorSession,
    "pose" | "moveStation" | "editStation" | "setExtent"
  >;

describe("a placement edit", () => {
  it("goes to the one session call it stands for, once", () => {
    const s = fakeSession();
    expect(
      applyPlaceEdit(asSession(s), { kind: "pose", ref: BLOCK, geo: GEO }),
    ).toEqual({ kind: "applied" });
    expect(s.pose).toHaveBeenCalledWith("p", GEO, {});
    applyPlaceEdit(asSession(s), { kind: "pose", ref: STATION, geo: GEO });
    expect(s.moveStation).toHaveBeenCalledWith("st", GEO);
    applyPlaceEdit(asSession(s), { kind: "extent", ref: STATION, value: 9 });
    expect(s.editStation).toHaveBeenCalledWith("st", { foundRadiusM: 9 });
    applyPlaceEdit(asSession(s), { kind: "extent", ref: MODEL, value: 2 });
    expect(s.setExtent).toHaveBeenCalledWith("m", 2);
    for (const call of [s.pose, s.moveStation, s.editStation, s.setExtent]) {
      expect(call).toHaveBeenCalledTimes(1);
    }
  });

  // Why: the creator's answer to "join the station it now stands in?"
  // travels with a block's move, and only with it.
  it("hands a block's move the station it joins", () => {
    const s = fakeSession();
    applyPlaceEdit(asSession(s), { kind: "pose", ref: BLOCK, geo: GEO }, "b");
    expect(s.pose).toHaveBeenCalledWith("p", GEO, { joinStation: "b" });
    applyPlaceEdit(asSession(s), { kind: "pose", ref: STATION, geo: GEO }, "b");
    expect(s.moveStation).toHaveBeenCalledWith("st", GEO);
  });

  it("passes a refusal on with its words", () => {
    const s = fakeSession(true);
    const edits: readonly PlaceEdit[] = [
      { kind: "pose", ref: BLOCK, geo: GEO },
      { kind: "pose", ref: STATION, geo: GEO },
      { kind: "extent", ref: STATION, value: 9 },
      { kind: "extent", ref: MODEL, value: 2 },
    ];
    for (const edit of edits) {
      expect(applyPlaceEdit(asSession(s), edit)).toEqual({
        kind: "refused",
        reason: "No.",
      });
    }
  });
});
