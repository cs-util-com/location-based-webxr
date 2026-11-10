import { describe, expect, it } from "vitest";

import { CUT_SETTINGS } from "./cut-settings.js";
import { blankImage } from "./rgba-image.js";
import { analyzeSheet, checkPictureSize, CUT_PHASES } from "./sheet-analyze.js";
import { CutError } from "./sheet-cut.js";
import { syntheticSheet } from "./test-support/synthetic-sheet.js";

const S = CUT_SETTINGS;

// Why these tests matter: the page shows each phase as it runs and names
// the one that refused; the pipeline must report them in order and stop at
// the first refusal.
describe("analyzeSheet", () => {
  it("cuts a sheet into four checked frames and both talking variants", () => {
    const seen: string[] = [];
    const sheet = syntheticSheet({ width: 800, height: 520, noise: 2 });
    const r = analyzeSheet(sheet.image, S, (phase, state) => {
      seen.push(`${phase}:${state}`);
    });
    expect(r.frames).toHaveLength(4);
    expect(r.steadyFrames).toHaveLength(4);
    expect(r.mode).toBe("white");
    expect(r.gaps).toHaveLength(3);
    expect(r.size).toEqual({ w: 800, h: 520 });
    // The status line of "Adjust the cut" reports this count.
    expect(Number.isSafeInteger(r.specks) && r.specks >= 0).toBe(true);
    expect(seen).toEqual(
      ["background", "poses", "align", "check"].flatMap((p) => [
        `${p}:running`,
        `${p}:done`,
      ]),
    );
  });

  it("reports the refusing phase as failed and throws its CutError", () => {
    const seen: string[] = [];
    const img = blankImage(400, 200);
    img.data.fill(250);
    expect(() =>
      analyzeSheet(img, S, (phase, state) => seen.push(`${phase}:${state}`)),
    ).toThrow(CutError);
    expect(seen).toEqual(["background:running", "background:failed"]);
  });

  it("refuses three poses with the count", () => {
    const sheet = syntheticSheet({ width: 800, height: 520 });
    // Paint the fourth pose away.
    for (let y = 0; y < 520; y++) {
      for (let x = 600; x < 800; x++) {
        sheet.image.data.set([254, 254, 254, 255], (y * 800 + x) * 4);
      }
    }
    expect(() => analyzeSheet(sheet.image, S)).toThrow("Found only 3 poses");
  });

  it("lists the phases in order", () => {
    expect(CUT_PHASES.map((p) => p.id)).toEqual([
      "read",
      "background",
      "poses",
      "align",
      "check",
    ]);
  });
});

describe("checkPictureSize", () => {
  it("refuses too big and too small, accepts the rest", () => {
    expect(() => checkPictureSize(8000, 6000, S)).toThrow("too big");
    expect(() => checkPictureSize(200, 600, S)).toThrow("too small");
    expect(() => checkPictureSize(2528, 1696, S)).not.toThrow();
  });
});
