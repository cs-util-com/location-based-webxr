import { describe, expect, it } from "vitest";

import { CUT_SETTINGS, type CutSettings } from "./cut-settings.js";
import { cutBackground, findFigures } from "./sheet-cut.js";
import {
  leaks,
  syntheticSheet,
  type SheetSpec,
} from "./test-support/synthetic-sheet.js";

const W = 800;
const H = 520;

interface Outcome {
  readonly leaked: number;
  readonly feetOff: number;
  readonly eyesLost: number;
  readonly figureLost: number;
  readonly poses: number;
}

function outcome(spec: Partial<SheetSpec>, s: CutSettings): Outcome {
  const sheet = syntheticSheet({ width: W, height: H, ...spec });
  const cut = cutBackground(sheet.image, s);
  const f = findFigures(cut.alpha, W, H, s);
  let figureLost = 0;
  sheet.truth.forEach((t, i) => {
    if (t === 1 && cut.alpha[i] === 0) {
      figureLost++;
    }
  });
  return {
    leaked: leaks(cut.alpha, sheet.truth, W).pixels,
    feetOff: Math.max(
      ...f.runs.map((r, i) => Math.abs(r.y1 - (sheet.feet[i] ?? -99))),
    ),
    eyesLost: sheet.eyes.filter((i) => cut.alpha[i] !== 255).length,
    figureLost,
    poses: f.runs.length,
  };
}

const CLEAN: Outcome = {
  leaked: 0,
  feetOff: 0,
  eyesLost: 0,
  figureLost: 0,
  poses: 4,
};

/** Feet within one pixel of the truth count as on the ground. */
function rounded(o: Outcome): Outcome {
  return { ...o, feetOff: o.feetOff <= 1 ? 0 : o.feetOff };
}

// Why these tests matter: image AIs often draw a soft grey ground shadow
// under each pose. A cut that keeps it moves every pose's feet down onto the
// shadow (the character then floats above the ground in AR) and leaves grey
// smears and specks around the feet. These sheets reproduce that with known
// truth; the shadow must go while the eye whites, enclosed by the outline,
// stay.
describe("ground shadows under the poses", () => {
  for (const shadowCore of [190, 205, 220, 235, 245]) {
    for (const noise of [0, 4, 8]) {
      it(`a shadow of grey ${shadowCore} with noise ${noise} is cut away`, () => {
        expect(
          rounded(
            outcome(
              { shadowCore, noise, seed: shadowCore + noise },
              CUT_SETTINGS,
            ),
          ),
        ).toEqual(CLEAN);
      });
    }
  }
});

// Why these tests matter: the shadow pass treats light, colourless pixels
// as background; it must not eat a figure that has an outline, whatever its
// colour, nor change a sheet without any shadow.
describe("figures the shadow pass must keep", () => {
  it("a sheet without a shadow is unchanged", () => {
    expect(rounded(outcome({ noise: 4 }, CUT_SETTINGS))).toEqual(CLEAN);
  });

  for (const grey of [150, 190, 230]) {
    it(`an outlined grey figure (${grey}) above a shadow stays whole`, () => {
      expect(
        rounded(
          outcome(
            { fill: [grey, grey, grey], shadowCore: 210, noise: 4 },
            CUT_SETTINGS,
          ),
        ),
      ).toEqual(CLEAN);
    });
  }

  it("a pale figure without an outline but with colour stays whole", () => {
    expect(
      rounded(
        outcome(
          { fill: [240, 196, 150], outline: 0, shadowCore: 220, noise: 2 },
          CUT_SETTINGS,
        ),
      ),
    ).toEqual(CLEAN);
  });
});

// Why this test matters: the island filter removes leftover specks around
// the feet; it must count what it removed so the page can say so, and it
// must leave a small detail that belongs to a pose (an eye, a button)
// alone because that sits inside the figure, not apart from it.
describe("the island filter", () => {
  it("drops lone specks in the background and reports them", () => {
    const sheet = syntheticSheet({ width: W, height: H, noise: 2 });
    const d = sheet.image.data;
    // Three dark 4 x 4 specks in the empty sky.
    for (const [sx, sy] of [
      [30, 20],
      [400, 15],
      [700, 30],
    ] as const) {
      for (let y = sy; y < sy + 4; y++) {
        for (let x = sx; x < sx + 4; x++) {
          d.set([40, 40, 40], (y * W + x) * 4);
        }
      }
    }
    const cut = cutBackground(sheet.image, CUT_SETTINGS);
    expect(cut.specks).toBe(3);
    expect(leaks(cut.alpha, sheet.truth, W).pixels).toBe(0);
    const off = cutBackground(sheet.image, { ...CUT_SETTINGS, islandMin: 0 });
    expect(off.specks).toBe(0);
    expect(leaks(off.alpha, sheet.truth, W).pixels).toBe(48);
  });
});
