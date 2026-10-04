/**
 * Why this test matters: the water alpha is written into every committed
 * imagery tile. For any tile, it must be exactly "the mask says water AND
 * the pixel is darker than the limit", binary (0 or 255), and it may only
 * ever take water AWAY from the mask, never add it on the mask's land.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { WATER_MAX_BRIGHTNESS, waterAlpha } from "./water-alpha.js";

const pixel = fc.record({
  water: fc.boolean(),
  rgb: fc.tuple(
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
  ),
});

describe("waterAlpha for any tile", () => {
  it("is binary, and water only where the mask and the colour agree", () => {
    fc.assert(
      fc.property(fc.array(pixel, { minLength: 1, maxLength: 64 }), (px) => {
        const mask = Uint8Array.from(
          px.flatMap((p) => (p.water ? [0, 255, 255, 255] : [0, 0, 0, 0])),
        );
        const imagery = Uint8Array.from(px.flatMap((p) => p.rgb));
        const alpha = waterAlpha(mask, imagery, px.length);
        px.forEach((p, i) => {
          const water = p.water && Math.max(...p.rgb) < WATER_MAX_BRIGHTNESS;
          expect(alpha[i]).toBe(water ? 0 : 255);
        });
      }),
    );
  });
});
