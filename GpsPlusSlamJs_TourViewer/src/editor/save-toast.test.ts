/**
 * Why these tests matter (r901 review #1): a lean download of a file the
 * page cannot write leaves the walk recording in the opened file only, and
 * "Save the debug data" reads it from there - lazily, at the click. A toast
 * that says "put it in place of the old file" first leads the creator to
 * overwrite the one copy of the walk before saving it. These pin the order
 * (the debug-data step before the put-in-place step) and that the toast
 * offers the save itself, so the right next step is one click away.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { FINISH_LABELS } from "../qr-author-mode.js";
import { savedToastWords } from "./save-toast.js";

describe("savedToastWords", () => {
  it("puts the debug-data step first after a lean download, and offers it as the toast's action", () => {
    const words = savedToastWords({
      inPlace: false,
      name: "castle.zip",
      leftOut: 3,
    });
    expect(words.offerDebugSave).toBe(true);
    expect(words.text).toMatch(/^Saved as castle\.zip\./);
    expect(words.text).toContain("leaves out the debug data");
    expect(words.text).toContain("3 files");
    const debugStep = words.text.indexOf("Save the debug data first");
    const putInPlace = words.text.indexOf("put it in place of the old file");
    expect(debugStep).toBeGreaterThan(0);
    expect(putInPlace).toBeGreaterThan(debugStep);
    expect(words.text).toContain("before you put this copy in place");
  });

  it("keeps the plain instruction for a download that left nothing out", () => {
    expect(
      savedToastWords({ inPlace: false, name: "castle.zip", leftOut: 0 }),
    ).toEqual({
      text: "Saved as castle.zip. Put it in place of the old file, under the same name, so the printed codes keep opening it.",
      offerDebugSave: false,
    });
  });

  it("says where an in-place save went, and offers nothing: the opened file is the one written", () => {
    expect(
      savedToastWords({ inPlace: true, name: "castle.zip", leftOut: 0 }),
    ).toEqual({ text: "Saved to castle.zip.", offerDebugSave: false });
    // A write over the opened file that left something out cannot offer
    // to read it back from that file: it is gone from there.
    expect(
      savedToastWords({ inPlace: true, name: "castle.zip", leftOut: 2 }),
    ).toEqual({
      text: `Saved to castle.zip. ${FINISH_LABELS.scanLeftOut(2)}`,
      offerDebugSave: false,
    });
  });

  it("offers the save exactly when a download left files out, and then always says it first", () => {
    // Why: the rule is a law over every count, not the three above.
    fc.assert(
      fc.property(fc.boolean(), fc.nat({ max: 10_000 }), (inPlace, leftOut) => {
        const words = savedToastWords({
          inPlace,
          name: "t.zip",
          leftOut,
        });
        expect(words.offerDebugSave).toBe(!inPlace && leftOut > 0);
        const first = words.text.indexOf("Save the debug data first");
        const putInPlace = words.text.indexOf("put it in place");
        expect(
          !words.offerDebugSave || (first >= 0 && first < putInPlace),
        ).toBe(true);
      }),
    );
  });
});
