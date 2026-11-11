import { describe, expect, it } from "vitest";

import { CUT_SETTINGS } from "./cut-settings.js";
import { blankImage, type RgbaImage } from "./rgba-image.js";
import {
  CutError,
  countError,
  cutBackground,
  diagnoseCount,
  findFigures,
  type FigureRun,
} from "./sheet-cut.js";
import { leaks, syntheticSheet } from "./test-support/synthetic-sheet.js";

const S = CUT_SETTINGS;

function refusal(run: () => unknown): CutError {
  try {
    run();
  } catch (err) {
    if (err instanceof CutError) {
      return err;
    }
    throw err;
  }
  throw new Error("expected a CutError");
}

function filled(
  w: number,
  h: number,
  colour: (x: number, y: number) => number[],
): RgbaImage {
  const img = blankImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      img.data.set(colour(x, y), (y * w + x) * 4);
    }
  }
  return img;
}

// Why these tests matter: the cut is the core of a character made from an
// image AI's picture; every refusal must name its step in words, and the
// flood fill must keep the light pixels inside a figure (eye whites) that a
// global colour key would punch out.
describe("cutBackground on a flat background", () => {
  const sheet = syntheticSheet({ width: 800, height: 520, noise: 2, seed: 3 });
  const cut = cutBackground(sheet.image, S);

  it("cuts the background away and keeps every figure pixel", () => {
    expect(cut.mode).toBe("white");
    expect(cut.bg).toEqual([254, 254, 254]);
    let lost = 0;
    sheet.truth.forEach((t, i) => {
      if (t === 1 && cut.alpha[i] === 0) {
        lost++;
      }
    });
    expect(lost).toBe(0);
    expect(leaks(cut.alpha, sheet.truth, 800).pixels).toBe(0);
  });

  it("keeps the eye whites inside the outline", () => {
    expect(sheet.eyes.length).toBeGreaterThan(0);
    expect(sheet.eyes.every((i) => cut.alpha[i] === 255)).toBe(true);
  });

  it("softens the edge and takes the background colour out of it", () => {
    // A dark block with a one-pixel grey ring, as an anti-aliased outline.
    const img = filled(300, 200, (x, y) => {
      const inBlock = x >= 100 && x < 200 && y >= 50 && y < 150;
      const inRing = x >= 99 && x < 201 && y >= 49 && y < 151;
      return inBlock
        ? [20, 20, 20, 255]
        : inRing
          ? [204, 204, 204, 255]
          : [254, 254, 254, 255];
    });
    const ring = 49 * 300 + 150;
    // The ramp alone: tolerance 28, no shadow pass (which would take this
    // colourless light grey as background, see the next test).
    const c = cutBackground(img, { ...S, whiteTol: 28, shadowOn: false });
    // Alpha (50 - 28 / 2) / 96 of 255; the white taken out of the grey.
    expect(c.alpha[ring]).toBe(96);
    expect(c.rgb[ring * 4]).toBe(121);
    expect(c.alpha[50 * 300 + 150]).toBe(255);
    // A wider ramp (edgeSoft) makes the same pixel more transparent.
    const wide = cutBackground(img, {
      ...S,
      whiteTol: 28,
      shadowOn: false,
      edgeSoft: 160,
    });
    expect(wide.alpha[ring]).toBe(57);
  });

  it("takes a light grey edge ring as background under the shadow pass", () => {
    // The price of the shadow pass: a colourless anti-aliasing pixel lighter
    // than the shadow floor goes with the background, so the outline keeps
    // only its darker edge pixels.
    const img = filled(300, 200, (x, y) => {
      const inBlock = x >= 100 && x < 200 && y >= 50 && y < 150;
      const inRing = x >= 99 && x < 201 && y >= 49 && y < 151;
      return inBlock
        ? [20, 20, 20, 255]
        : inRing
          ? [204, 204, 204, 255]
          : [254, 254, 254, 255];
    });
    const c = cutBackground(img, S);
    expect(c.alpha[49 * 300 + 150]).toBe(0);
    expect(c.alpha[50 * 300 + 150]).toBe(255);
  });
});

describe("cutBackground with real transparency", () => {
  it("reads the alpha and snaps near-opaque to opaque", () => {
    const sheet = syntheticSheet({
      width: 800,
      height: 520,
      transparent: true,
    });
    const cut = cutBackground(sheet.image, S);
    expect(cut.mode).toBe("alpha");
    const i = sheet.truth.indexOf(1);
    expect(cut.alpha[i]).toBe(255);
    expect(cut.alpha[0]).toBe(0);
  });

  it("drops alpha under the threshold", () => {
    const img = filled(300, 200, (x) => [0, 0, 0, x < 150 ? 20 : 200]);
    const cut = cutBackground(img, S);
    expect(cut.alpha[0]).toBe(0);
    expect(cut.alpha[299]).toBe(200);
  });
});

describe("cutBackground refusals", () => {
  it("names a painted checkerboard", () => {
    const img = filled(300, 200, (x, y) =>
      ((x >> 4) + (y >> 4)) % 2 === 0
        ? [255, 255, 255, 255]
        : [204, 204, 204, 255],
    );
    const err = refusal(() => cutBackground(img, S));
    expect(err.code).toBe("checkerboard");
    expect(err.phase).toBe("background");
  });

  it("refuses a busy background", () => {
    const img = filled(300, 200, (x, y) => [
      (x * 7) % 256,
      (y * 13) % 256,
      90,
      255,
    ]);
    expect(refusal(() => cutBackground(img, S)).code).toBe("busy");
  });

  it("refuses a picture with no figure", () => {
    const img = filled(300, 200, () => [250, 250, 250, 255]);
    expect(refusal(() => cutBackground(img, S)).code).toBe("empty");
  });
});

describe("findFigures", () => {
  it("finds four poses that sit off their quarters, with their feet", () => {
    const sheet = syntheticSheet({ width: 800, height: 520, noise: 2 });
    const cut = cutBackground(sheet.image, S);
    const f = findFigures(cut.alpha, 800, 520, S);
    expect(f.runs).toHaveLength(4);
    f.runs.forEach((r, i) => {
      expect(r.x0).toBeLessThan(sheet.centres[i]!);
      expect(r.x1).toBeGreaterThan(sheet.centres[i]!);
      expect(Math.abs(r.y1 - sheet.feet[i]!)).toBeLessThanOrEqual(1);
    });
    expect(f.gaps).toHaveLength(3);
    expect(f.gaps.every((g) => g >= f.minGap)).toBe(true);
  });

  it("drops a column group far smaller than a pose as a speck", () => {
    const sheet = syntheticSheet({ width: 800, height: 520 });
    const cut = cutBackground(sheet.image, S);
    const alpha = cut.alpha.slice();
    // A 3 x 3 dot in the empty top-left corner.
    for (let y = 10; y < 13; y++) {
      for (let x = 2; x < 5; x++) {
        alpha[y * 800 + x] = 255;
      }
    }
    expect(findFigures(alpha, 800, 520, S).runs).toHaveLength(4);
  });
});

describe("diagnoseCount and countError", () => {
  const run = (x0: number, x1: number): FigureRun => ({
    x0,
    x1,
    y0: 0,
    y1: 9,
    mass: 1,
  });

  it("names none, too many, touching and missing poses", () => {
    expect(diagnoseCount([]).code).toBe("empty");
    expect(
      diagnoseCount([
        run(0, 9),
        run(20, 29),
        run(40, 49),
        run(60, 69),
        run(80, 89),
      ]).code,
    ).toBe("extra");
    expect(diagnoseCount([run(0, 9), run(20, 49), run(60, 69)])).toEqual({
      code: "joined",
      joined: [1],
    });
    expect(diagnoseCount([run(0, 9), run(20, 29), run(40, 49)]).code).toBe(
      "missing",
    );
  });

  it("words the refusal and keeps the runs for the page to draw", () => {
    const err = countError(
      { runs: [run(0, 9), run(20, 49), run(60, 69)], gaps: [], minGap: 2 },
      100,
      50,
    );
    expect(err.message).toBe("Found 3 instead of 4: two poses touch");
    expect(err.phase).toBe("poses");
    expect(err.detail.runs).toHaveLength(3);
  });
});
