import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { loadSite } from "../test-utils/load-fixtures.js";
import { parseOverpassJson } from "../model/overpass-parser.js";
import type { OsmFeature } from "../model/osm-feature.js";
import type { Bbox } from "../spatial/clip.js";
import { decodeLookColours, type MeshChunk } from "./chunk-meshes.js";
import { buildCity, type City, type CityOptions } from "./city.js";
import {
  DEFAULT_CITY_COLOUR_SCHEME,
  type CityColourScheme,
} from "./colour-scheme.js";
import { enuFrameAt, type EnuFrame } from "./enu.js";

/**
 * WHY THIS TEST MATTERS. A city built with `looks` carries every look's
 * colours from ONE geometry pass, and a renderer that cross-fades the looks
 * shows, at a weight of 1 for one look, exactly what that look's own fixed
 * build would draw. That is only true if every colour rule of a scheme
 * (colour tags, material walls, the tower rule, the lightness jitter, roads
 * by surface, the tone list lengths, barrier and tree palettes, the land use)
 * gives the same answer in the K pass as in the fixed one. So this builds
 * each look on its own and compares it with the `looks` build vertex for
 * vertex, tree for tree and texel for texel; nothing here is a hand-picked
 * colour, so no rule can be missed by the test author.
 */

/** Every colour of a map moved by `delta` (xor), keys unchanged. */
function remapped<K>(
  map: ReadonlyMap<K, number>,
  delta: number,
): ReadonlyMap<K, number> {
  return new Map([...map].map(([key, rgb]) => [key, rgb ^ delta]));
}

/** A list of `n` tones derived from `base`, so list lengths differ per look. */
function tones(base: readonly number[], n: number, delta: number): number[] {
  return Array.from(
    { length: n },
    (_, i) =>
      (base[i % base.length] ?? 0) ^ ((delta + i * 0x030201) & 0x3f3f3f),
  );
}

/**
 * A look that differs from the default in every rule the default leaves off,
 * as the low-sun looks do: material walls on, a tower rule, a jitter, roads
 * by class, colour tags ignored, other list lengths and every table moved.
 */
function ruleLook(
  delta: number,
  lengths: { walls: number; towers: number; roofs: number },
  rules: {
    honourColourTags: boolean;
    roadsBySurface: boolean;
    honourMaterialTags: boolean;
    towerFromM: number;
    wallJitterL: number;
  },
): CityColourScheme {
  const d = DEFAULT_CITY_COLOUR_SCHEME;
  return {
    ...d,
    ...rules,
    ground: d.ground ^ delta,
    walls: tones(d.walls, lengths.walls, delta),
    towerWalls: tones(d.walls, lengths.towers, delta ^ 0x111111),
    pitchedRoofs: tones(d.pitchedRoofs, lengths.roofs, delta),
    flatRoofs: tones(d.flatRoofs, lengths.roofs + 1, delta),
    materialWalls: new Map([
      ["brick", 0x9a5b44 ^ delta],
      ["stone", 0xb0a898 ^ delta],
      ["glass", 0x7f9db0 ^ delta],
      ["concrete", 0xa0a0a0 ^ delta],
      ["plaster", 0xd8cfc0 ^ delta],
    ]),
    roads: remapped(d.roads, delta),
    roadSurfaces: remapped(d.roadSurfaces, delta ^ 0x020202),
    sidewalk: d.sidewalk ^ delta,
    defaultRoad: d.defaultRoad ^ delta,
    markings: d.markings ^ delta,
    barriers: remapped(d.barriers, delta),
    barrierMaterials: remapped(d.barrierMaterials, delta),
    trees: remapped(d.trees, delta),
    landUse: remapped(d.landUse, delta),
  };
}

/** Today's look and three looks that each switch a different set of rules. */
const URBAN_LIKE = ruleLook(
  0x101010,
  { walls: 13, towers: 7, roofs: 5 },
  {
    honourColourTags: true,
    roadsBySurface: false,
    honourMaterialTags: true,
    towerFromM: 40,
    wallJitterL: 3,
  },
);
const DUSK_LIKE = ruleLook(
  0x0c1824,
  { walls: 20, towers: 4, roofs: 3 },
  {
    honourColourTags: false,
    roadsBySurface: false,
    honourMaterialTags: true,
    towerFromM: 25,
    wallJitterL: 6,
  },
);
const BLUE_LIKE = ruleLook(
  0x201008,
  { walls: 12, towers: 12, roofs: 6 },
  {
    honourColourTags: true,
    roadsBySurface: true,
    honourMaterialTags: false,
    towerFromM: Infinity,
    wallJitterL: 0,
  },
);
const FOUR_LOOKS = [
  DEFAULT_CITY_COLOUR_SCHEME,
  URBAN_LIKE,
  DUSK_LIKE,
  BLUE_LIKE,
] as const;

interface Site {
  readonly features: readonly OsmFeature[];
  readonly frame: EnuFrame;
  readonly window: Bbox;
}

function site(id: string): Site {
  const s = loadSite(id);
  return {
    features: parseOverpassJson(s.payload).features,
    frame: enuFrameAt(s.centre),
    window: s.bbox,
  };
}

/** What every build here shares: the demo's layers, the colours aside. */
function options(
  s: Site,
  extra: Partial<CityOptions>,
  inventedRoofs: boolean,
): CityOptions {
  return {
    window: s.window,
    roads: true,
    cosmeticTrees: true,
    groundTint: true,
    inventedRoofs,
    ...extra,
  };
}

/** Byte equality of two Float32Arrays (exact, NaN-safe, fast). */
function sameFloats(a: Float32Array, b: Float32Array): boolean {
  return Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(
    Buffer.from(b.buffer, b.byteOffset, b.byteLength),
  );
}

/**
 * The first difference between look `k` of a `looks` layer and the fixed
 * build's layer, or undefined when they agree vertex for vertex.
 */
function chunkMismatch(
  looks: readonly MeshChunk[],
  fixed: readonly MeshChunk[],
  k: number,
  decode: "linear" | "raw",
): string | undefined {
  if (looks.length !== fixed.length) {
    return `chunk count ${looks.length} against ${fixed.length}`;
  }
  for (let c = 0; c < looks.length; c++) {
    const found = chunkPairMismatch(looks[c]!, fixed[c]!, k, decode);
    if (found !== undefined) return `chunk ${c}: ${found}`;
  }
  return undefined;
}

/** The first difference between one looks chunk and its fixed chunk. */
function chunkPairMismatch(
  a: MeshChunk,
  b: MeshChunk,
  k: number,
  decode: "linear" | "raw",
): string | undefined {
  if (a.key !== b.key) return `key ${a.key} against ${b.key}`;
  const codes = a.lookColours?.[k];
  if (codes === undefined || b.colors === undefined) {
    return `${a.key} lacks look ${k} or fixed colours`;
  }
  if (!sameFloats(decodeLookColours(codes, decode), b.colors)) {
    return `${a.key} look ${k} differs from its fixed build`;
  }
  if (k === 0 && (a.colors === undefined || !sameFloats(a.colors, b.colors))) {
    return `${a.key} colors are not look 0's`;
  }
  return undefined;
}

/** Every tree's look-`k` colour against the fixed build's colour. */
function treeMismatch(looks: City, fixed: City, k: number): string | undefined {
  const a = [...looks.trees, ...looks.cosmeticTrees];
  const b = [...fixed.trees, ...fixed.cosmeticTrees];
  if (a.length !== b.length)
    return `tree count ${a.length} against ${b.length}`;
  for (let i = 0; i < a.length; i++) {
    const colour = a[i]!.lookColours?.[k];
    if (a[i]!.feature !== b[i]!.feature || colour !== b[i]!.colour) {
      return `tree ${i} (${b[i]!.feature}) look ${k}: ${colour} against ${b[i]!.colour}`;
    }
    if (k === 0 && a[i]!.colour !== b[i]!.colour) {
      return `tree ${i} colour is not look 0's`;
    }
  }
  return undefined;
}

/** The land use: the same classes, and look `k`'s palette is the fixed one. */
function tintMismatch(looks: City, fixed: City, k: number): string | undefined {
  const a = looks.groundTint;
  const b = fixed.groundTint;
  if (a === undefined || b === undefined) return "a ground tint is missing";
  if (!Buffer.from(a.classes).equals(Buffer.from(b.classes))) {
    return "the class rasters differ";
  }
  const palette = a.lookPalettes?.[k];
  if (palette === undefined) return `no palette for look ${k}`;
  if (palette.join(",") !== b.palette.join(",")) {
    return `look ${k}'s land-use palette differs from its fixed build`;
  }
  if (k === 0 && a.palette.join(",") !== b.palette.join(",")) {
    return "the palette is not look 0's";
  }
  return undefined;
}

/** Every mismatch of look `k` against its fixed build, empty when none. */
function mismatches(looks: City, fixed: City, k: number): string[] {
  return [
    chunkMismatch(looks.buildings, fixed.buildings, k, "linear"),
    chunkMismatch(looks.roads, fixed.roads, k, "raw"),
    treeMismatch(looks, fixed, k),
    tintMismatch(looks, fixed, k),
  ].filter((m): m is string => m !== undefined);
}

function expectLooksMatchFixedBuilds(
  s: Site,
  looks: readonly CityColourScheme[],
  inventedRoofs: boolean,
): void {
  const k4 = buildCity(
    s.features,
    { frame: s.frame },
    options(s, { looks }, inventedRoofs),
  );
  looks.forEach((look, k) => {
    const fixed = buildCity(
      s.features,
      { frame: s.frame },
      options(s, { colours: look }, inventedRoofs),
    );
    expect(mismatches(k4, fixed, k)).toEqual([]);
  });
  // And no layer is missing its K buffers (an empty city proves nothing).
  for (const chunk of [...k4.buildings, ...k4.roads]) {
    expect(chunk.lookColours).toHaveLength(looks.length);
  }
}

const SITES = [
  "heidelberg-altstadt",
  "lucerne-meggen",
  "nyc-park-slope",
  "berlin-alexanderplatz",
  "woodland-hinterzarten",
  "cologne-cathedral",
  "london-tower-bridge",
  "london-westminster",
  "manhattan-midtown",
  "sylt-westerland",
  "tokyo-shinjuku",
  "lucerne-reuss",
] as const;

describe("a looks build gives each look exactly its fixed build's colours", () => {
  // Invented roofs off: they are geometry, not colour, and cost most of a
  // build; one site below runs with them on, since a pitched roof picks other
  // tones than a flat lid.
  for (const id of SITES) {
    it(`${id}, four rule-varying looks`, () => {
      expectLooksMatchFixedBuilds(site(id), FOUR_LOOKS, false);
    });
  }

  it("cologne-cathedral with invented roofs", () => {
    expectLooksMatchFixedBuilds(site("cologne-cathedral"), FOUR_LOOKS, true);
  }, 60_000);

  // The order of the looks is the caller's: look 0 need not be the default.
  it("london-tower-bridge with a non-default look first and a repeated look", () => {
    expectLooksMatchFixedBuilds(
      site("london-tower-bridge"),
      [DUSK_LIKE, DEFAULT_CITY_COLOUR_SCHEME, DUSK_LIKE],
      false,
    );
  });
});

describe("a looks build over random looks (property)", () => {
  // WHY A PROPERTY on top of the fixed four: the rule knobs and the list
  // lengths are drawn at random, so a combination nobody wrote down (a jitter
  // with colour tags ignored, a one-tone tower list) is covered too. A small
  // site keeps each run cheap.
  const small = site("sylt-westerland");
  const look = fc
    .record({
      delta: fc.integer({ min: 0, max: 0x3f3f3f }),
      walls: fc.integer({ min: 1, max: 24 }),
      towers: fc.integer({ min: 1, max: 12 }),
      roofs: fc.integer({ min: 1, max: 8 }),
      honourColourTags: fc.boolean(),
      roadsBySurface: fc.boolean(),
      honourMaterialTags: fc.boolean(),
      towerFromM: fc.oneof(
        fc.constant(Infinity),
        fc.double({ min: 3, max: 80, noNaN: true }),
      ),
      wallJitterL: fc.double({ min: 0, max: 20, noNaN: true }),
    })
    .map((r) =>
      ruleLook(
        r.delta,
        { walls: r.walls, towers: r.towers, roofs: r.roofs },
        {
          honourColourTags: r.honourColourTags,
          roadsBySurface: r.roadsBySurface,
          honourMaterialTags: r.honourMaterialTags,
          towerFromM: r.towerFromM,
          wallJitterL: r.wallJitterL,
        },
      ),
    );

  it("every look of 1 to 4 equals its fixed build", () => {
    fc.assert(
      fc.property(fc.array(look, { minLength: 1, maxLength: 4 }), (looks) => {
        expectLooksMatchFixedBuilds(small, looks, false);
      }),
      { numRuns: 8 },
    );
  }, 120_000);
});

describe("a build without looks carries no look data", () => {
  // WHY: the Globe and every other caller pay nothing for the option they
  // do not use (no attribute, no buffer, no field), which the byte digests of
  // colour-identity.test.ts cannot see.
  it("adds no field to chunks, trees or the tint", () => {
    const s = site("heidelberg-altstadt");
    const city = buildCity(
      s.features,
      { frame: s.frame },
      options(s, {}, false),
    );
    for (const chunk of [...city.buildings, ...city.roads]) {
      expect("lookColours" in chunk).toBe(false);
    }
    for (const tree of [...city.trees, ...city.cosmeticTrees]) {
      expect("lookColours" in tree).toBe(false);
    }
    expect(city.groundTint).toBeDefined();
    expect("lookPalettes" in city.groundTint!).toBe(false);
  });
});
