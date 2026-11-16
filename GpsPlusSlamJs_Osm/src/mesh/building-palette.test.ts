import { describe, expect, it } from "vitest";

import {
  DEFAULT_PALETTE_COLOURS,
  FLAT_ROOF_TONES,
  PITCHED_ROOF_TONES,
  WALL_TONES,
  seededBuildingColours,
  type PaletteColours,
} from "./building-palette.js";
import { rgbToLab } from "./cielab.js";

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

/**
 * WHY THESE TESTS MATTER (city look exploration 2026-11-15, direction B). A
 * scheme may tell towers from walk-ups, read `building:material` and jitter
 * each building's lightness. The order of those rules is the design: a
 * mapper's colour beats a material, a material beats the height, the height
 * beats the plain list, and the jitter comes last. A wrong order draws a
 * plausible city in the wrong colours, so each step is asserted on its own,
 * with one-tone lists so the winning rule is visible in the result.
 */
describe("seededBuildingColours under scheme rules", () => {
  const RULES: PaletteColours = {
    ...DEFAULT_PALETTE_COLOURS,
    honourColourTags: true,
    walls: [0x111111],
    towerWalls: [0x222222],
    towerFromM: 40,
    honourMaterialTags: true,
    materialWalls: new Map([
      ["brick", 0x333333],
      ["glass", 0x444444],
    ]),
    wallJitterL: 0,
  };
  const wall = (
    tags: Record<string, string>,
    heightM: number,
    colours: PaletteColours = RULES,
    outline?: Record<string, string>,
  ): number =>
    seededBuildingColours(tags, outline, "way/5", false, colours, heightM).wall;

  it("keeps the default free of every new rule", () => {
    // Why: the default is what every app without a scheme draws; its golden
    // digests (`colour-identity.test.ts`) hold only while these stay off.
    expect(DEFAULT_PALETTE_COLOURS.towerWalls).toBe(WALL_TONES);
    expect(DEFAULT_PALETTE_COLOURS.towerFromM).toBe(Number.POSITIVE_INFINITY);
    expect(DEFAULT_PALETTE_COLOURS.honourMaterialTags).toBe(false);
    expect(DEFAULT_PALETTE_COLOURS.materialWalls.size).toBe(0);
    expect(DEFAULT_PALETTE_COLOURS.wallJitterL).toBe(0);
    for (let i = 0; i < 50; i++) {
      const key = `way/${i}`;
      const plain = seededBuildingColours({}, undefined, key, true);
      expect(
        seededBuildingColours(
          { "building:material": "glass" },
          undefined,
          key,
          true,
          DEFAULT_PALETTE_COLOURS,
          400,
        ),
      ).toEqual(plain);
    }
  });

  it("draws the tower list at and above towerFromM, the walls below it", () => {
    expect(wall({}, 39.9)).toBe(0x111111);
    expect(wall({}, 40)).toBe(0x222222);
    expect(wall({}, 250)).toBe(0x222222);
  });

  it("treats a missing or unreadable height as no tower", () => {
    expect(
      seededBuildingColours({}, undefined, "way/5", false, RULES).wall,
    ).toBe(0x111111);
    expect(wall({}, Number.NaN)).toBe(0x111111);
    expect(wall({}, Number.POSITIVE_INFINITY)).toBe(0x111111);
  });

  it("lets a material tag beat the height, the part's then its outline's", () => {
    expect(wall({ "building:material": "brick" }, 250)).toBe(0x333333);
    expect(wall({}, 10, RULES, { "building:material": "glass" })).toBe(
      0x444444,
    );
    expect(
      wall({ "building:material": "brick" }, 10, RULES, {
        "building:material": "glass",
      }),
    ).toBe(0x333333);
  });

  it("reads a material tag as OSM writes it: case, spaces, the first of a list", () => {
    expect(wall({ "building:material": " Glass " }, 10)).toBe(0x444444);
    expect(wall({ "building:material": "brick;concrete" }, 10)).toBe(0x333333);
  });

  it("falls through a material the scheme does not name", () => {
    expect(wall({ "building:material": "adobe" }, 10)).toBe(0x111111);
    expect(wall({ "building:material": "adobe" }, 60)).toBe(0x222222);
  });

  it("ignores material tags when honourMaterialTags is false", () => {
    const off = { ...RULES, honourMaterialTags: false };
    expect(wall({ "building:material": "brick" }, 10, off)).toBe(0x111111);
  });

  it("lets a colour tag beat a material tag", () => {
    expect(
      wall({ "building:colour": "#abcdef", "building:material": "brick" }, 60),
    ).toBe(0xabcdef);
  });

  it("leaves the roof to its own rules", () => {
    const tagged = seededBuildingColours(
      { "building:material": "brick" },
      undefined,
      "way/5",
      false,
      { ...RULES, wallJitterL: 5 },
      250,
    );
    expect(tagged.roof).toBe(
      seededBuildingColours({}, undefined, "way/5", false, RULES).roof,
    );
  });

  it("jitters the picked wall's lightness, whichever rule picked it", () => {
    // Why: one material maps to one tone, so a block of 100 glass towers
    // would be one flat colour without the jitter; it must reach the
    // material, tower and plain picks alike, and use most of its range.
    const jittered = { ...RULES, wallJitterL: 3 };
    for (const [tags, heightM, base] of [
      [{}, 10, 0x111111],
      [{}, 60, 0x222222],
      [{ "building:material": "brick" }, 10, 0x333333],
    ] as const) {
      const shifts = new Set<number>();
      let largest = 0;
      for (let i = 0; i < 200; i++) {
        const got = seededBuildingColours(
          tags,
          undefined,
          `way/${i}`,
          false,
          jittered,
          heightM,
        ).wall;
        const d = rgbToLab(got).l - rgbToLab(base).l;
        shifts.add(Math.round(d * 10));
        largest = Math.max(largest, Math.abs(d));
      }
      expect(shifts.size).toBeGreaterThan(10);
      expect(largest).toBeGreaterThan(2);
    }
  });

  it("jitters a colour tag too, as the last step", () => {
    const tag = { "building:colour": "#808080" };
    const keys = Array.from({ length: 50 }, (_, i) => `way/${i}`);
    const walls = new Set(
      keys.map(
        (key) =>
          seededBuildingColours(tag, undefined, key, false, {
            ...RULES,
            wallJitterL: 3,
          }).wall,
      ),
    );
    expect(walls.size).toBeGreaterThan(5);
  });
});
