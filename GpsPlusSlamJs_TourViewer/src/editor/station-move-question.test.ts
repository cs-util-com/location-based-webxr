/**
 * Why these tests matter: a move onto another station does not keep the
 * item's place in the world - a free item stands at the new station's
 * centre, a story's entries keep their offsets around it - so the editor
 * asks first, and the question must say exactly that: the author answers
 * it knowing the item needs placing again. A question that promised the
 * item stays where it stands would be answered wrongly.
 */
import { describe, expect, it } from "vitest";

import { stationMoveQuestion } from "./station-move-question.js";

describe("stationMoveQuestion", () => {
  it("says a free item or an entry stands at the other station's centre", () => {
    const q = stationMoveQuestion(
      { kind: "item", name: "The well" },
      "The mill",
    );
    expect(q).toContain('"The well"');
    expect(q).toContain('"The mill"');
    expect(q).toContain("centre of that station");
    expect(q).toContain("place it again");
    expect(q).toContain("undo");
  });

  it("says a story's entries keep their places around the other centre", () => {
    const q = stationMoveQuestion(
      { kind: "story", name: "Miller" },
      "The mill",
    );
    expect(q).toContain('the story "Miller"');
    expect(q).toContain("keep their places around the station's centre");
    expect(q).toContain("place them again");
  });

  it("names an unnamed item and station plainly rather than in empty quotes", () => {
    const q = stationMoveQuestion({ kind: "item", name: " " }, "");
    expect(q).not.toContain('""');
    expect(q).toContain("this item");
    expect(q).toContain("the other station");
  });
});
