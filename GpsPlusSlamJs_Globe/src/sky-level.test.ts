/**
 * The sky's level for the fill light (DEC-GL5-11; DEC-H3: one
 * implementation in the Globe package, read by the terrain lab and the
 * globe's own surface).
 *
 * Why this test matters: at a low sun the terrain relief's flat ground
 * read lighter than the globe (0.255 against 0.194 of a zenith sun at
 * 11.2 degrees) because only the relief had a sky fill. One formula, here,
 * now feeds both; these tests pin it (moved unchanged from the terrain
 * lab's terrain-sun.js, whose tests read it from here now) and its shader
 * twin.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SKY_FILL, SKY_LEVEL_GLSL, skyLevel } from "./sky-level.js";

const DEG = Math.PI / 180;

describe("skyLevel", () => {
  it("is the sun's height above the floor and the floor below it, while the sun is up", () => {
    expect(SKY_FILL).toEqual({ floor: 0.5, twilightDeg: 6 });
    expect(skyLevel(1)).toBe(1);
    expect(skyLevel(Math.sin(60 * DEG))).toBeCloseTo(Math.sin(60 * DEG), 12);
    expect(skyLevel(Math.sin(11.2 * DEG))).toBe(0.5);
    expect(skyLevel(0)).toBe(0.5);
  });

  it("fades the floor to 0 through the twilight below the horizon", () => {
    expect(skyLevel(-Math.sin(6 * DEG))).toBe(0);
    expect(skyLevel(-1)).toBe(0);
    const half = skyLevel(-Math.sin(3 * DEG));
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(0.5);
  });

  it("never falls as the sun rises", () => {
    let prev = skyLevel(-1);
    for (let z = -1; z <= 1; z += 0.001) {
      const v = skyLevel(z);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = v;
    }
  });

  it("refuses a non-finite height, a floor outside 0-1 or a twilight outside 0-90", () => {
    expect(() => skyLevel(Number.NaN)).toThrow(RangeError);
    expect(() => skyLevel(0, 1.5)).toThrow(RangeError);
    expect(() => skyLevel(0, 0.5, 0)).toThrow(RangeError);
  });
});

describe("SKY_LEVEL_GLSL", () => {
  // The shader's copy reads the same constants: the twilight's sine is
  // baked from SKY_FILL, the floor comes in as an argument.
  it("defines skyLevelOf(sunZ, floor) with the twilight from SKY_FILL", () => {
    expect(SKY_LEVEL_GLSL).toContain(
      "float skyLevelOf( float sunZ, float floorLevel )",
    );
    expect(SKY_LEVEL_GLSL).toContain(
      Math.sin(SKY_FILL.twilightDeg * DEG).toFixed(8),
    );
  });
});

// Why: pages without an import map load this module (the terrain lab's
// colour comparison page, through terrain-sun.js). When it borrowed the
// package's smoothstep from globe-camera.ts, it pulled in "three" through
// that module, the page failed to resolve it and never started (r766
// milestone run, 2026-10-04). Its whole relative import graph must stay
// free of bare imports.
describe("sky-level's imports", () => {
  it("reach no bare module, through every relative import", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const seen = new Set<string>();
    const bare: string[] = [];
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const source = readFileSync(join(here, file), "utf8");
      for (const m of source.matchAll(
        /^import(?!\s+type)[^"']*from\s*["']([^"']+)["']/gm,
      )) {
        const spec = m[1]!;
        if (spec.startsWith("./")) visit(spec.slice(2).replace(/\.js$/, ".ts"));
        else bare.push(`${file}: ${spec}`);
      }
    };
    visit("sky-level.ts");
    expect(bare).toEqual([]);
  });
});
