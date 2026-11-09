import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  FLAT_ROOF_TONES,
  PITCHED_ROOF_TONES,
  WALL_TONES,
  allPaletteColours,
  seededBuildingColours,
} from "./building-palette.js";

const chroma = (rgb: number): number => {
  const c = [(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff];
  return Math.max(...c) - Math.min(...c);
};

/**
 * WHY (DEC-R4-5): the affordance heat ramp runs 80 to 216 levels of chroma
 * and must stay the loudest thing on screen, so every palette tone stays
 * below 80; the loudest, the first clay, is 58, the figure the sidecar
 * states. And for ANY key and tags without colours, the colours come from
 * the palette's own lists, deterministically.
 */
describe("building palette (properties)", () => {
  it("keeps every tone below the heat ramp's chroma floor, the loudest at 58", () => {
    const all = allPaletteColours();
    for (const rgb of all) expect(chroma(rgb)).toBeLessThan(80);
    expect(Math.max(...all.map(chroma))).toBe(58);
  });

  it("draws from the palette's lists for any key, the same for the same key", () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.boolean(),
        fc.dictionary(
          fc.constantFrom("building", "building:material", "height", "name"),
          fc.string(),
        ),
        (key, pitched, tags) => {
          const a = seededBuildingColours(tags, undefined, key, pitched);
          expect(WALL_TONES).toContain(a.wall);
          expect(pitched ? PITCHED_ROOF_TONES : FLAT_ROOF_TONES).toContain(
            a.roof,
          );
          expect(seededBuildingColours(tags, undefined, key, pitched)).toEqual(
            a,
          );
        },
      ),
      { numRuns: 500 },
    );
  });

  /**
   * WHY (M7 review NIT 6): a house's wall and roof tones must be picked
   * independently, or some wall tones would always come with some roofs and
   * a street would read as a few repeated pairs. FNV-1a alone, salted only at
   * the end of the string, kept the two picks correlated over sequential ids
   * (chi-square 140-230 here, against 74.7). Measured over 2000 sequential
   * ids, from three id ranges of each OSM type: the 6 x 7 wall-by-roof cells
   * (pitched) and the 6 x 4 cells (flat) stay below the chi-square
   * critical value at p = 0.001 against uniform cells (41 and 23 degrees of
   * freedom: 74.7 and 49.7). A fixed grid, not random ids: a random draw
   * would fail one run in a thousand by construction. Measured with the
   * finaliser 2026-11-08: at most 59.2 (pitched) and 29.8 (flat).
   */
  it("picks wall and roof independently over sequential ids (chi-square)", () => {
    const cases = ["way/", "node/", "relation/"].flatMap((prefix) =>
      [1, 1000, 123456].map((start) => ({ prefix, start })),
    );
    for (const { prefix, start } of cases) {
      for (const [pitched, roofs, bound] of [
        [true, PITCHED_ROOF_TONES, 74.7],
        [false, FLAT_ROOF_TONES, 49.7],
      ] as const) {
        const cells = new Map<string, number>();
        const n = 2000;
        for (let i = start; i < start + n; i++) {
          const c = seededBuildingColours({}, undefined, prefix + i, pitched);
          const cell = `${WALL_TONES.indexOf(c.wall)},${roofs.indexOf(c.roof)}`;
          cells.set(cell, (cells.get(cell) ?? 0) + 1);
        }
        const k = WALL_TONES.length * roofs.length;
        const e = n / k;
        let chi = 0;
        for (let w = 0; w < WALL_TONES.length; w++) {
          for (let r = 0; r < roofs.length; r++) {
            chi += ((cells.get(`${w},${r}`) ?? 0) - e) ** 2 / e;
          }
        }
        expect(chi, `${prefix}${start} pitched=${pitched}`).toBeLessThan(bound);
      }
    }
  });

  it("gives a part its outline's colours when it passes the outline's key", () => {
    fc.assert(
      fc.property(fc.string(), fc.boolean(), (key, pitched) => {
        const outline = seededBuildingColours({}, undefined, key, pitched);
        const part = seededBuildingColours(
          { "building:part": "yes" },
          { building: "church" },
          key,
          pitched,
        );
        expect(part).toEqual(outline);
      }),
    );
  });
});
