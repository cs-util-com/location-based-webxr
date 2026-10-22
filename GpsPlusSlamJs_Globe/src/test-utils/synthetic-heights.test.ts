/**
 * Why these tests matter: the synthetic heights are the ground every
 * network-free relief suite reads, in a page (the labs) and in Node (the
 * apps' e2e encode the same surface with the workspace's Terrarium
 * encoder). A suite that asserts "the station stands on the ground" is only
 * as good as the agreement between the surface it computes and the tile the
 * page draws, so the surface, and the tile pixel each height belongs to,
 * are pinned here once.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  SYNTHETIC_HEIGHTS_URL,
  syntheticHeightM,
  syntheticPixelHeightM,
} from "./synthetic-heights.js";

describe("syntheticHeightM", () => {
  // Why: the labs' smokes assert heights against this surface by number;
  // a changed formula must fail here first, not as a far-off smoke.
  it("is the 1 km plateau with its two ridge waves", () => {
    expect(syntheticHeightM(0, 0)).toBe(1000);
    // sin(2 pi 0.125 / 0.5) = 1, sin(2 pi 0.1 / 0.4) = 1, second wave 0 at
    // lng 0.07 multiples only, so evaluated in full.
    const lat = 0.1;
    const lng = 0.125;
    const expected =
      1000 +
      900 +
      300 *
        Math.sin((2 * Math.PI * lng) / 0.07) *
        Math.cos((2 * Math.PI * lat) / 0.06);
    expect(syntheticHeightM(lat, lng)).toBeCloseTo(expected, 9);
    expect(SYNTHETIC_HEIGHTS_URL).toBe(
      "/globe-terrain-synthetic/{z}/{x}/{y}.png",
    );
  });

  // Why: a coast lowers the whole surface and clamps the sea at 0 (the
  // landing-ground smokes rest on it).
  it("is lowered by the sea level and never below the sea", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -85, max: 85, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        fc.double({ min: 0, max: 3000, noNaN: true }),
        (lat, lng, seaM) => {
          const h = syntheticHeightM(lat, lng, seaM);
          expect(h).toBeGreaterThanOrEqual(-seaM);
          expect(h).toBeCloseTo(
            Math.max(-seaM, syntheticHeightM(lat, lng) - seaM),
            6,
          );
        },
      ),
    );
  });
});

describe("syntheticPixelHeightM", () => {
  // Why: a Node-side tile must hold at each pixel the surface at that
  // pixel's centre, or an e2e reads a ground half a pixel off the page's.
  it("is the surface at the pixel's centre", () => {
    // Tile 0/0/0, 2 px: pixel (1, 0) centres at lng 90, the Mercator
    // latitude of y = 0.25.
    const lat = (Math.atan(Math.sinh(Math.PI / 2)) * 180) / Math.PI;
    expect(syntheticPixelHeightM({ z: 0, x: 0, y: 0 }, 1, 0, { size: 2 })).toBe(
      syntheticHeightM(lat, 90),
    );
  });

  it("refuses a tile or pixel outside the pyramid", () => {
    const bad: [{ z: number; x: number; y: number }, number, number][] = [
      [{ z: 1, x: 2, y: 0 }, 0, 0],
      [{ z: 1, x: 0, y: -1 }, 0, 0],
      [{ z: -1, x: 0, y: 0 }, 0, 0],
      [{ z: 2, x: 0, y: 0 }, 256, 0],
      [{ z: 2, x: 0, y: 0 }, 0, 0.5],
    ];
    for (const [tile, col, row] of bad) {
      expect(() => syntheticPixelHeightM(tile, col, row)).toThrow(RangeError);
    }
  });
});
