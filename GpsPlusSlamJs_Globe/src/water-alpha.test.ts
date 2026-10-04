/**
 * The imagery tiles' water alpha (round-4 plan 2026-09-28-2105 DEC-GL4-6).
 *
 * Why this file matters: the glint follows this alpha. With the MODIS mask
 * alone the coast smoke still found the glint up to 41 levels bright 5 km
 * inland: along the Namib coast the mask marks the mixed pixel between sea
 * and sand as water (its luminance 100, the sea's 8-20), so a whole 4.5 km
 * texel of bright sand glinted. Water is therefore the mask AND the
 * imagery's own dark sea colour (the research's colour rule, measured on
 * GIBS renders: water's brightest channel 99th percentile 35, land's
 * median 79). And a GIBS style change must fail the fetch instead of
 * drawing a wrong coastline silently.
 */
import { describe, expect, it } from "vitest";

import { WATER_MAX_BRIGHTNESS, waterAlpha } from "./water-alpha.js";

const WATER_RGBA = [0, 255, 255, 255];
const LAND_RGBA = [0, 0, 0, 0];

/** A 1-row tile from pixel pairs: [mask RGBA, imagery RGB]. */
function tile(pixels: Array<[number[], number[]]>) {
  return {
    mask: Uint8Array.from(pixels.flatMap(([m]) => m)),
    imagery: Uint8Array.from(pixels.flatMap(([, c]) => c)),
    count: pixels.length,
  };
}

describe("waterAlpha", () => {
  it("is 0 where the mask says water and the imagery is dark sea", () => {
    const t = tile([[WATER_RGBA, [8, 12, 20]]]);
    expect([...waterAlpha(t.mask, t.imagery, t.count)]).toEqual([0]);
  });

  it("is 255 on the mask's land, whatever its colour", () => {
    const t = tile([
      [LAND_RGBA, [5, 8, 20]],
      [
        [0, 0, 0, 255],
        [200, 180, 150],
      ],
    ]);
    expect([...waterAlpha(t.mask, t.imagery, t.count)]).toEqual([255, 255]);
  });

  // The Namib coast's mixed pixel (tile 4/17/10, row 34): the mask says
  // water, the imagery shows it half sand.
  it("keeps a bright pixel inside the mask's water as land", () => {
    const t = tile([
      [WATER_RGBA, [20, 22, 30]],
      [WATER_RGBA, [120, 98, 70]],
      [LAND_RGBA, [160, 140, 110]],
    ]);
    expect([...waterAlpha(t.mask, t.imagery, t.count)]).toEqual([0, 255, 255]);
  });

  it("puts the limit on the brightest channel, exclusive", () => {
    const below = WATER_MAX_BRIGHTNESS - 1;
    const t = tile([
      [WATER_RGBA, [0, 0, below]],
      [WATER_RGBA, [0, 0, WATER_MAX_BRIGHTNESS]],
      [WATER_RGBA, [WATER_MAX_BRIGHTNESS, 0, 0]],
    ]);
    expect([...waterAlpha(t.mask, t.imagery, t.count)]).toEqual([0, 255, 255]);
  });

  it("refuses a mask pixel that is neither water nor land, naming it", () => {
    const t = tile([
      [WATER_RGBA, [8, 12, 20]],
      [
        [128, 128, 128, 255],
        [8, 12, 20],
      ],
    ]);
    expect(() => waterAlpha(t.mask, t.imagery, t.count)).toThrow(
      /mask pixel 1 is 128,128,128,255/,
    );
  });

  it("refuses buffers that do not hold the pixel count", () => {
    const t = tile([[WATER_RGBA, [8, 12, 20]]]);
    expect(() => waterAlpha(t.mask, t.imagery, 2)).toThrow(RangeError);
    expect(() => waterAlpha(t.mask.subarray(1), t.imagery, 1)).toThrow(
      RangeError,
    );
    expect(() => waterAlpha(t.mask, t.imagery, -1)).toThrow(RangeError);
    expect(() => waterAlpha(t.mask, t.imagery, 0.5)).toThrow(RangeError);
  });
});
