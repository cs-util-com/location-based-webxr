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
const FOLDER = { kind: "folder", id: "f" } as const;
const VIEWPOINT = { kind: "viewpoint", id: "p" } as const;

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
    moveFolder: vi.fn(() => outcome),
    editBlockField: vi.fn(() =>
      refuse
        ? { kind: "refused" as const, reason: "No." }
        : { kind: "edited" as const },
    ),
    scaleFolder: vi.fn(() =>
      refuse
        ? { kind: "refused" as const, reason: "No." }
        : { kind: "resized" as const },
    ),
    moveViewpoint: vi.fn(() =>
      refuse
        ? { kind: "refused" as const, reason: "No." }
        : { kind: "edited" as const },
    ),
  };
}

const asSession = (s: ReturnType<typeof fakeSession>) =>
  s as unknown as Pick<
    EditorSession,
    | "pose"
    | "moveStation"
    | "editStation"
    | "setExtent"
    | "moveFolder"
    | "scaleFolder"
    | "editBlockField"
    | "moveViewpoint"
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
    applyPlaceEdit(asSession(s), { kind: "pose", ref: FOLDER, geo: GEO }, "b");
    expect(s.moveFolder).toHaveBeenCalledWith("f", GEO);
    applyPlaceEdit(asSession(s), { kind: "extent", ref: FOLDER, value: 3 });
    expect(s.scaleFolder).toHaveBeenCalledWith("f", 3);
    applyPlaceEdit(asSession(s), { kind: "bend", ref: BLOCK, deg: -25 });
    expect(s.editBlockField).toHaveBeenCalledWith("p", "bendDeg", "-25");
    for (const call of [
      s.pose,
      s.moveStation,
      s.editStation,
      s.setExtent,
      s.moveFolder,
      s.scaleFolder,
      s.editBlockField,
    ]) {
      expect(call).toHaveBeenCalledTimes(1);
    }
  });

  // Why: a picture's viewpoint is dragged with the picture's handle, but
  // it is the viewpoint that moves (one session call, one undo step),
  // never the picture's own pose, and never with a station to join: the
  // viewpoint stands in its station's frame wherever it goes. It has no
  // dots, so a size edit for it is refused rather than resizing the
  // picture.
  it("moves a picture's viewpoint through its own call, and sizes none", () => {
    const s = fakeSession();
    expect(
      applyPlaceEdit(
        asSession(s),
        { kind: "pose", ref: VIEWPOINT, geo: GEO },
        "b",
      ),
    ).toEqual({ kind: "applied" });
    expect(s.moveViewpoint).toHaveBeenCalledTimes(1);
    expect(s.moveViewpoint).toHaveBeenCalledWith("p", GEO);
    expect(s.pose).not.toHaveBeenCalled();
    expect(
      applyPlaceEdit(asSession(s), {
        kind: "extent",
        ref: VIEWPOINT,
        value: 2,
      }),
    ).toMatchObject({ kind: "refused" });
    expect(s.setExtent).not.toHaveBeenCalled();
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

  // Why: a short text's point set in the 3D view (a pick or its handle)
  // must be judged by the same strict reader as the typed boxes, so it
  // travels as the field's text through the block's field edit; a
  // value the view rounded to the centimetre must reach it unchanged.
  it("writes a point through the block's field edit as three numbers", () => {
    const s = fakeSession();
    applyPlaceEdit(asSession(s), {
      kind: "point",
      ref: BLOCK,
      at: [2, 1.25, -19.6],
    });
    expect(s.editBlockField).toHaveBeenCalledWith(
      "p",
      "pointsTo",
      "2 1.25 -19.6",
    );
    expect(s.editBlockField).toHaveBeenCalledTimes(1);
    expect(s.pose).not.toHaveBeenCalled();
  });

  it("passes a refusal on with its words", () => {
    const s = fakeSession(true);
    const edits: readonly PlaceEdit[] = [
      { kind: "pose", ref: BLOCK, geo: GEO },
      { kind: "pose", ref: STATION, geo: GEO },
      { kind: "extent", ref: STATION, value: 9 },
      { kind: "extent", ref: MODEL, value: 2 },
      { kind: "pose", ref: FOLDER, geo: GEO },
      { kind: "extent", ref: FOLDER, value: 3 },
      { kind: "bend", ref: BLOCK, deg: 10 },
      { kind: "point", ref: BLOCK, at: [1, 0, 1] },
      { kind: "pose", ref: VIEWPOINT, geo: GEO },
    ];
    for (const edit of edits) {
      expect(applyPlaceEdit(asSession(s), edit)).toEqual({
        kind: "refused",
        reason: "No.",
      });
    }
  });
});
