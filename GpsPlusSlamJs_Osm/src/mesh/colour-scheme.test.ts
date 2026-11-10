import { describe, expect, it } from "vitest";

import { loadSite } from "../test-utils/load-fixtures.js";
import { parseOverpassJson } from "../model/overpass-parser.js";
import { barrierColour } from "./barrier-colours.js";
import { seededBuildingColours } from "./building-palette.js";
import { buildCity } from "./city.js";
import {
  DEFAULT_CITY_COLOUR_SCHEME,
  validateCityColourScheme,
  type CityColourScheme,
} from "./colour-scheme.js";
import { enuFrameAt } from "./enu.js";
import { roadColour } from "./feature-colours.js";
import { srgbToLinear } from "./srgb.js";

/** Every key of a map set to one colour. */
function fill<K>(map: ReadonlyMap<K, number>, colour: number): Map<K, number> {
  return new Map([...map.keys()].map((k) => [k, colour]));
}

/** A scheme whose every layer is one flat colour, tags painted over. */
function flatScheme(c: {
  wall: number;
  pitched: number;
  flat: number;
  road: number;
}): CityColourScheme {
  const d = DEFAULT_CITY_COLOUR_SCHEME;
  return {
    ...d,
    honourColourTags: false,
    walls: [c.wall],
    pitchedRoofs: [c.pitched],
    flatRoofs: [c.flat],
    roads: fill(d.roads, c.road),
    roadSurfaces: fill(d.roadSurfaces, c.road),
    sidewalk: c.road,
    defaultRoad: c.road,
    barriers: fill(d.barriers, c.wall),
    barrierMaterials: fill(d.barrierMaterials, c.wall),
  };
}

const heidelberg = loadSite("heidelberg-altstadt");
const heidelbergFeatures = parseOverpassJson(heidelberg.payload).features;
const heidelbergGround = { frame: enuFrameAt(heidelberg.centre) };

describe("DEFAULT_CITY_COLOUR_SCHEME", () => {
  // WHY: the default is the scheme every consumer without one draws in; it
  // must itself pass the validation a demo's schemes pass, or the rule
  // "a scheme lists every colour" would be one the default breaks.
  it("validates", () => {
    expect(validateCityColourScheme(DEFAULT_CITY_COLOUR_SCHEME)).toBe(
      DEFAULT_CITY_COLOUR_SCHEME,
    );
  });

  // WHY: the default is built from the tables that own today's colours, not a
  // copy; a copy would drift from the tables the existing tests pin.
  it("is today's ground and land use", () => {
    expect(DEFAULT_CITY_COLOUR_SCHEME.ground).toBe(0x6b7280);
    expect(DEFAULT_CITY_COLOUR_SCHEME.landUse.get("park")).toBe(0x7a866c);
    expect(DEFAULT_CITY_COLOUR_SCHEME.landUse.size).toBe(25);
    expect(DEFAULT_CITY_COLOUR_SCHEME.roadsBySurface).toBe(true);
    expect(DEFAULT_CITY_COLOUR_SCHEME.honourColourTags).toBe(true);
  });
});

describe("validateCityColourScheme", () => {
  const d = DEFAULT_CITY_COLOUR_SCHEME;
  // WHY: each case is a way a hand-written scheme goes wrong; a scheme that
  // passed with any of them would draw NaN, black or the default's colour
  // where its author meant their own.
  it.each([
    ["not an object", null],
    ["a string", "today"],
    ["a non-boolean flag", { ...d, honourColourTags: 1 }],
    ["a colour out of range", { ...d, ground: 0x1000000 }],
    ["a negative colour", { ...d, sidewalk: -1 }],
    ["a fractional colour", { ...d, defaultRoad: 1.5 }],
    ["an empty tone list", { ...d, walls: [] }],
    ["a bad tone", { ...d, flatRoofs: [0x111111, Number.NaN] }],
    ["a plain object for a map", { ...d, roads: { residential: 0 } }],
    [
      "a missing map key",
      { ...d, landUse: new Map([...d.landUse].filter(([k]) => k !== "park")) },
    ],
    ["an unknown map key", { ...d, trees: new Map([...d.trees, ["oak", 0]]) }],
    [
      "a bad map colour",
      { ...d, barriers: new Map([...d.barriers, ["hedge", 0x1000000]]) },
    ],
  ])("refuses %s", (_name, scheme) => {
    expect(() => validateCityColourScheme(scheme)).toThrow(RangeError);
  });

  // WHY: `buildCity` is the boundary; a bad scheme must stop the build there
  // rather than draw a half-switched city.
  it("is applied at the buildCity boundary", () => {
    expect(() =>
      buildCity([], heidelbergGround, {
        window: heidelberg.bbox,
        colours: { ...d, walls: [] },
      }),
    ).toThrow(RangeError);
  });
});

describe("a scheme's colours land in the buffers by the layer's rule", () => {
  // WHY: building chunks are converted to linear light and road chunks stay
  // raw (city plan section 7). A scheme author picking one hex for both gets
  // a lighter road; this pins that the two rules hold for a scheme's colours
  // exactly as for today's, so the trap is a documented fact, not a surprise.
  const colours = {
    wall: 0x806040,
    pitched: 0x604020,
    flat: 0x404040,
    road: 0x808080,
  };
  const city = buildCity(heidelbergFeatures, heidelbergGround, {
    window: heidelberg.bbox,
    roads: true,
    colours: flatScheme(colours),
  });

  it("converts building, roof and barrier colours to linear", () => {
    const allowed = [colours.wall, colours.pitched, colours.flat].map((c) =>
      [16, 8, 0].map((s) => srgbToLinear(((c >> s) & 0xff) / 255)),
    );
    let vertices = 0;
    for (const chunk of city.buildings) {
      const c = chunk.colors ?? new Float32Array(0);
      for (let i = 0; i < c.length; i += 3) {
        const hit = allowed.some((rgb) =>
          rgb.every((v, k) => Math.abs((c[i + k] ?? -1) - v) < 1e-6),
        );
        expect(hit).toBe(true);
        vertices++;
      }
    }
    expect(vertices).toBeGreaterThan(1000);
  });

  it("writes road colours raw", () => {
    const raw = [0x80 / 255, 0x80 / 255, 0x80 / 255];
    let vertices = 0;
    for (const chunk of city.roads) {
      const c = chunk.colors ?? new Float32Array(0);
      for (let i = 0; i < c.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          expect(c[i + k]).toBeCloseTo(raw[k] ?? -1, 6);
        }
        vertices++;
      }
    }
    expect(vertices).toBeGreaterThan(1000);
  });

  // WHY: trees follow the scheme too (D1: a switch needs the rebuild for
  // them), keyed by class, with the per-tree lightness jitter kept.
  it("colours trees from the scheme's palette", () => {
    const trees = fill(DEFAULT_CITY_COLOUR_SCHEME.trees, 0x204060);
    const built = buildCity(heidelbergFeatures, heidelbergGround, {
      window: heidelberg.bbox,
      colours: { ...DEFAULT_CITY_COLOUR_SCHEME, trees },
    });
    const all = [...built.trees, ...built.cosmeticTrees];
    expect(all.length).toBeGreaterThan(10);
    for (const t of all) {
      // Blue is the largest channel of 0x204060 at any jitter.
      expect(t.colour & 0xff).toBeGreaterThan((t.colour >> 16) & 0xff);
    }
  });
});

describe("honourColourTags (owner D7)", () => {
  const tagged = {
    building: "house",
    "building:colour": "#ff0000",
    "roof:colour": "#00ff00",
  };
  const over = flatScheme({
    wall: 0x111111,
    pitched: 0x222222,
    flat: 0x333333,
    road: 0,
  });

  // WHY: a realistic scheme keeps a mapper's colour, a stylised one paints
  // over it; both halves of the flag are the decision.
  it("keeps building and roof colour tags when true", () => {
    expect(seededBuildingColours(tagged, undefined, "way/1", true)).toEqual({
      wall: 0xff0000,
      roof: 0x00ff00,
    });
  });

  it("paints over them when false", () => {
    expect(
      seededBuildingColours(tagged, undefined, "way/1", true, over),
    ).toEqual({
      wall: 0x111111,
      roof: 0x222222,
    });
    expect(
      seededBuildingColours(tagged, undefined, "way/1", false, over).roof,
    ).toBe(0x333333);
  });

  // WHY: the session extended D7 to a barrier's colour tag (plan 4.1); a
  // stylised scheme mixes no tagged colour in, but still colours by material.
  it("covers a barrier's colour tag, not its material", () => {
    const wall = { barrier: "wall", colour: "#ff0000" };
    expect(barrierColour(wall)).not.toBe(barrierColour({ barrier: "wall" }));
    expect(barrierColour(wall, over)).toBe(0x111111);
    const brick = new Map(over.barrierMaterials).set("brick", 0x445566);
    expect(
      barrierColour(
        { barrier: "wall", material: "brick", colour: "red" },
        { ...over, barrierMaterials: brick },
      ),
    ).toBe(0x445566);
  });
});

describe("roadsBySurface", () => {
  // WHY: Heidelberg is heavily surface-tagged (sett, asphalt, paving stones),
  // so a scheme that colours roads by class (Map) would draw almost nothing
  // by class while surface beats class. False must let the class win for car
  // roads, and pedestrian classes keep their class either way.
  const residential = heidelbergFeatures.filter(
    (f) => f.tags["highway"] === "residential" && f.tags["surface"] === "sett",
  );
  const byClass: CityColourScheme = {
    ...DEFAULT_CITY_COLOUR_SCHEME,
    roadsBySurface: false,
    roads: new Map(DEFAULT_CITY_COLOUR_SCHEME.roads).set(
      "residential",
      0xffee00,
    ),
  };

  it("finds sett-tagged residential ways at Heidelberg", () => {
    expect(residential.length).toBeGreaterThan(3);
  });

  it("colours them by surface by default and by class when false", () => {
    for (const way of residential) {
      expect(roadColour(way.tags)).toBe(
        DEFAULT_CITY_COLOUR_SCHEME.roadSurfaces.get("sett"),
      );
      expect(roadColour(way.tags, byClass)).toBe(0xffee00);
    }
  });

  it("keeps a pedestrian class first either way", () => {
    const footway = { highway: "footway", surface: "asphalt" };
    expect(roadColour(footway, byClass)).toBe(roadColour(footway));
  });
});
