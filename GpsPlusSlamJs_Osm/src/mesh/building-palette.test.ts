import { describe, expect, it } from "vitest";

import {
  FLAT_ROOF_TONES,
  PITCHED_ROOF_TONES,
  WALL_TONES,
  seededBuildingColours,
} from "./building-palette.js";

/**
 * WHY THESE TESTS MATTER (city objects plan 2026-11-07-2315 M7). The owner
 * chose V2's look: untagged buildings in warm seeded tones, not the class
 * colours. A palette fails quietly: every house the same tone, a part striped
 * against its outline, a material tag overriding the palette against the
 * owner's Q3, a tagged colour lost. None throws, so each is asserted.
 */
describe("seededBuildingColours", () => {
  it("keeps V2's tones: six walls, five clay and two slate roofs, four flat greys", () => {
    expect(WALL_TONES).toHaveLength(6);
    expect(PITCHED_ROOF_TONES).toHaveLength(7);
    expect(FLAT_ROOF_TONES).toHaveLength(4);
  });

  it("is the same colour for the same key, every time", () => {
    const a = seededBuildingColours(
      { building: "house" },
      undefined,
      "way/7",
      true,
    );
    const b = seededBuildingColours(
      { building: "house" },
      undefined,
      "way/7",
      true,
    );
    expect(a).toEqual(b);
  });

  it("spreads keys over every tone", () => {
    const walls = new Set<number>();
    const pitched = new Set<number>();
    const flat = new Set<number>();
    for (let i = 0; i < 400; i++) {
      walls.add(seededBuildingColours({}, undefined, `way/${i}`, true).wall);
      pitched.add(seededBuildingColours({}, undefined, `way/${i}`, true).roof);
      flat.add(seededBuildingColours({}, undefined, `way/${i}`, false).roof);
    }
    expect([...walls].sort()).toEqual([...WALL_TONES].sort());
    expect([...pitched].sort()).toEqual([...PITCHED_ROOF_TONES].sort());
    expect([...flat].sort()).toEqual([...FLAT_ROOF_TONES].sort());
  });

  it("picks the roof list by the roof's shape", () => {
    for (let i = 0; i < 50; i++) {
      const key = `way/${i}`;
      expect(PITCHED_ROOF_TONES).toContain(
        seededBuildingColours({}, undefined, key, true).roof,
      );
      expect(FLAT_ROOF_TONES).toContain(
        seededBuildingColours({}, undefined, key, false).roof,
      );
    }
  });

  it("lets building:colour and roof:colour win, the part's then its outline's", () => {
    const own = seededBuildingColours(
      { "building:colour": "#112233", "roof:colour": "#445566" },
      { "building:colour": "#ffffff", "roof:colour": "#000000" },
      "way/1",
      true,
    );
    expect(own).toEqual({ wall: 0x112233, roof: 0x445566 });
    const outline = seededBuildingColours(
      {},
      { "building:colour": "red", "roof:colour": "#000000" },
      "way/1",
      false,
    );
    expect(outline).toEqual({ wall: 0xff0000, roof: 0x000000 });
  });

  it("ignores building:material under the palette (owner Q3)", () => {
    const plain = seededBuildingColours({}, undefined, "way/9", true);
    const brick = seededBuildingColours(
      { "building:material": "brick" },
      undefined,
      "way/9",
      true,
    );
    expect(brick).toEqual(plain);
  });

  it("ignores a colour tag that does not parse", () => {
    const plain = seededBuildingColours({}, undefined, "way/3", true);
    expect(
      seededBuildingColours(
        { "building:colour": "#gggggg", "roof:colour": "constructor" },
        undefined,
        "way/3",
        true,
      ),
    ).toEqual(plain);
  });

  it("never throws on a key that is not a string", () => {
    expect(() =>
      seededBuildingColours(
        {},
        undefined,
        undefined as unknown as string,
        true,
      ),
    ).not.toThrow();
  });
});
