/**
 * Why these tests matter: the picker must never offer to write a view the
 * tour format cannot store (Screen only and Captions are the visitor's own
 * choices today), must say why when a creator picks one, and must offer a
 * narration exactly when Captions lack one.
 */
import { describe, expect, it } from "vitest";

import { segmentRefusal, stepSegment, viewPickerModel } from "./view-picker.js";

describe("viewPickerModel", () => {
  it("presses Reading sign for a reading text and describes it", () => {
    const m = viewPickerModel({ view: "reading", hasNarration: false });
    expect(m.segments.map((s) => [s.id, s.pressed, s.dimmed])).toEqual([
      ["reading", true, false],
      ["silent", false, true],
      ["captions", false, true],
    ]);
    expect(m.description).toMatch(/^A sign stands at the station/);
    expect(m.description).not.toMatch(/listen/);
    expect(m.offerNarration).toBe(false);
  });

  it("mentions listening once the text has a narration", () => {
    const m = viewPickerModel({ view: "reading", hasNarration: true });
    expect(m.description).toMatch(/listen while the words light up/);
  });

  it("explains a dimmed choice, offering a narration only for Captions without one", () => {
    const noVoice = viewPickerModel({
      view: "reading",
      hasNarration: false,
      asked: "captions",
    });
    expect(noVoice.description).toMatch(/need a narration/);
    expect(noVoice.offerNarration).toBe(true);
    const voice = viewPickerModel({
      view: "reading",
      hasNarration: true,
      asked: "captions",
    });
    expect(voice.offerNarration).toBe(false);
    expect(voice.description).toMatch(/own choice/);
    const silent = viewPickerModel({
      view: "reading",
      hasNarration: false,
      asked: "silent",
    });
    expect(silent.offerNarration).toBe(false);
    expect(silent.description).toMatch(/Screen only/);
  });

  it("presses nothing for a stored lectern or card, and says so", () => {
    for (const view of ["lectern", "card"]) {
      const m = viewPickerModel({ view, hasNarration: false });
      expect(m.segments.some((s) => s.pressed)).toBe(false);
      expect(m.description).toMatch(/Choose Reading sign/);
    }
  });

  it("lets only Reading sign be chosen", () => {
    expect(segmentRefusal("reading", false)).toBeNull();
    expect(segmentRefusal("silent", true)).not.toBeNull();
    expect(segmentRefusal("captions", true)).not.toBeNull();
  });
});

describe("stepSegment", () => {
  it("moves along the segments and wraps round", () => {
    expect(stepSegment("reading", 1)).toBe("silent");
    expect(stepSegment("captions", 1)).toBe("reading");
    expect(stepSegment("reading", -1)).toBe("captions");
  });
});
