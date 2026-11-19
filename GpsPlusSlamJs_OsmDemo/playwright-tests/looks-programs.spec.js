// @ts-check
/**
 * The colour-looks shader programs in a real WebGL 2 context: they compile
 * and link, and at a weight of 1 for one look they draw what that look's
 * fixed program draws. The unit tests in `gps-plus-slam-osm` check the
 * shader text only; nothing else compiles it before a phone does.
 *
 * Draws on an empty page (`looks-programs.html`) through
 * `looks-programs-harness.js`, so no demo boot and no network are involved.
 */

import { test, expect } from "./e2e-test.js";

/** The harness module's URL on the dev server. */
const HARNESS = "/playwright-tests/looks-programs-harness.js";

test.describe("the colour-looks programs in WebGL 2", () => {
  test("the land-use tint's looks program compiles, filters its class edges, and matches the fixed tint at a weight of 1", async ({
    page,
  }) => {
    // WHY THIS TEST MATTERS. The looks ground filters four class texels by
    // hand (a nearest class fetch drew 2 m blocks up close), and only a
    // driver says whether that GLSL compiles. At a weight of 1 it must draw
    // what the fixed tint draws ACROSS a magnified class edge, where the
    // fixed texture's linear filter makes a ramp: a nearest lookup would
    // show a step there (two shades in the row instead of many).
    //
    // TOLERANCE 3 of 255 per channel: the fixed texture is decoded from sRGB
    // and filtered by the GPU at its precision, the looks palette is decoded
    // by three.js on the CPU into floats; their rounding differs by a step or
    // two, and a real mismatch (a wrong row, an unfiltered edge, a colour
    // space decoded twice) is tens of steps.
    await page.goto("/playwright-tests/looks-programs.html");
    const result = await page.evaluate(async (url) => {
      /** @type {{ groundLooksCheck: () => { errors: string[], atWeightOne: number[], fixedShades: number, looksShades: number, mixDrawn: boolean } }} */
      const harness = await import(url);
      return harness.groundLooksCheck();
    }, HARNESS);
    expect(result.errors).toEqual([]);
    expect(result.atWeightOne).toHaveLength(2);
    for (const difference of result.atWeightOne) {
      expect(difference).toBeLessThanOrEqual(3);
    }
    // The fixed tint ramps across the edge, and so does the looks tint.
    expect(result.fixedShades).toBeGreaterThan(8);
    expect(result.looksShades).toBeGreaterThan(8);
    expect(result.mixDrawn).toBe(true);
  });

  test("the building and road looks programs compile and draw what the fixed build draws, at a weight of 1 and at a mix", async ({
    page,
  }) => {
    // WHY THIS TEST MATTERS. A time-of-day build draws its buildings and
    // roads from byte codes decoded in the shader (a 256 x 2 table, one row
    // per layer) and mixed by the trim weights. At a weight of 1 on one look
    // the frame must be the fixed build's of that look, or switching the
    // blend on changes the city; at a mix, the mean of the decoded colours.
    // A wrong decode row (linear against raw) is tens of steps off.
    //
    // TOLERANCE 1 of 255 per channel: both frames interpolate the same
    // decoded floats, one from the vertex buffer and one from the table.
    await page.goto("/playwright-tests/looks-programs.html");
    const result = await page.evaluate(async (url) => {
      /** @type {{ meshLooksCheck: () => { errors: string[], buildings: { atWeightOne: number[], atHalf: number, drawn: boolean }, roads: { atWeightOne: number[], atHalf: number, drawn: boolean } } }} */
      const harness = await import(url);
      return harness.meshLooksCheck();
    }, HARNESS);
    expect(result.errors).toEqual([]);
    for (const layer of [result.buildings, result.roads]) {
      expect(layer.atWeightOne).toHaveLength(2);
      for (const difference of layer.atWeightOne) {
        expect(difference).toBeLessThanOrEqual(1);
      }
      expect(layer.atHalf).toBeLessThanOrEqual(1);
      expect(layer.drawn).toBe(true);
    }
  });
});
