/**
 * Why these tests matter: each gesture of the 3D view becomes exactly one
 * call of the editor session - so exactly one undo step - and a refusal
 * (the format's bounds, an item gone meanwhile) must reach the creator in
 * its own words rather than vanish. A move of an item that went to the
 * station call (or the other way round) would move the wrong thing.
 */
import { describe, expect, it, vi } from "vitest";

import type { EditorSession } from "./editor-session.js";
import { applySceneEdit } from "./scene-edits.js";

const GEO = { lat: 1, lon: 2, alt: 3, headingDeg: 4 };

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
    resizeModel: vi.fn(() =>
      refuse
        ? { kind: "refused" as const, reason: "No." }
        : { kind: "resized" as const },
    ),
  };
}

const asSession = (s: ReturnType<typeof fakeSession>) =>
  s as unknown as Pick<
    EditorSession,
    "pose" | "moveStation" | "editStation" | "resizeModel"
  >;

describe("a scene edit", () => {
  it("goes to the one session call it stands for, once", () => {
    const s = fakeSession();
    expect(
      applySceneEdit(asSession(s), { kind: "item-pose", id: "p", geo: GEO }),
    ).toEqual({ kind: "applied" });
    expect(s.pose).toHaveBeenCalledWith("p", GEO);
    applySceneEdit(asSession(s), { kind: "station-pose", id: "st", geo: GEO });
    expect(s.moveStation).toHaveBeenCalledWith("st", GEO);
    applySceneEdit(asSession(s), { kind: "radius", id: "st", foundRadiusM: 9 });
    expect(s.editStation).toHaveBeenCalledWith("st", { foundRadiusM: 9 });
    applySceneEdit(asSession(s), { kind: "size", id: "m", sizeM: 2 });
    expect(s.resizeModel).toHaveBeenCalledWith("m", 2);
    for (const call of [s.pose, s.moveStation, s.editStation, s.resizeModel]) {
      expect(call).toHaveBeenCalledTimes(1);
    }
  });

  it("passes a refusal on with its words", () => {
    const s = fakeSession(true);
    for (const edit of [
      { kind: "item-pose", id: "p", geo: GEO },
      { kind: "station-pose", id: "st", geo: GEO },
      { kind: "radius", id: "st", foundRadiusM: 9 },
      { kind: "size", id: "m", sizeM: 2 },
    ] as const) {
      expect(applySceneEdit(asSession(s), edit)).toEqual({
        kind: "refused",
        reason: "No.",
      });
    }
  });
});
