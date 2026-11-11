/**
 * The nine colour schemes beside today's look (colour schemes plan
 * 2026-11-10-0841, section 4.5, D5): drafts the owner rates on the phone and
 * the session tunes. Each is a spread of the default with its overrides, so a
 * field nobody overrides stays today's.
 *
 * WHY THE MAPS ARE REBUILT FROM THE DEFAULT'S KEYS. The library's validator
 * refuses a map that lacks one of the default's keys or adds an unknown one,
 * so every map here is the default's map with each value replaced
 * (`recolour`), never a hand-written list that could miss a road class.
 *
 * WHAT THE TESTS DEMAND (not their taste): every entry validates; buildings,
 * roads and ground keep a minimum lightness distance; plates stay lighter
 * than the ground. Only the default keeps DEC-R4-5 (D8).
 *
 * @see colour-scheme-looks.ts.md
 */

import {
  DEFAULT_CITY_COLOUR_SCHEME,
  type CityColourScheme,
} from "gps-plus-slam-osm";

import type { ColourScheme } from "./colour-schemes.js";
import { DEFAULT_GROUND_SLOPE_COLOURS } from "./ground-slope-colours.js";

const D = DEFAULT_CITY_COLOUR_SCHEME;

/** `map` with every value replaced by `pick(key, value)`. */
function recolour<K extends string>(
  map: ReadonlyMap<K, number>,
  pick: (key: K, value: number) => number,
): ReadonlyMap<K, number> {
  return new Map([...map].map(([key, value]) => [key, pick(key, value)]));
}

/** Road classes by the role a map gives them. */
const MAJOR_ROADS = new Set([
  "motorway",
  "motorway_link",
  "trunk",
  "trunk_link",
  "primary",
  "primary_link",
]);
const MIDDLE_ROADS = new Set([
  "secondary",
  "secondary_link",
  "tertiary",
  "tertiary_link",
]);
/** Classes a car does not use: paths, steps, tracks, platforms. */
const PATH_ROADS = new Set([
  "pedestrian",
  "footway",
  "path",
  "steps",
  "cycleway",
  "platform",
  "track",
  "bridleway",
]);

interface RoadTones {
  readonly major: number;
  /** `primary` and its link, when they differ from the other major roads. */
  readonly primary?: number;
  readonly middle: number;
  readonly minor: number;
  readonly paths: number;
  readonly sidewalk: number;
  /** The zebra paint, drawn raw on the car roads. */
  readonly markings: number;
  /** Surface colours read only when `roadsBySurface` is true; absent keeps today's. */
  readonly surfaces?: number;
}

function roadsOf(
  tones: RoadTones,
): Pick<
  CityColourScheme,
  "roads" | "roadSurfaces" | "sidewalk" | "defaultRoad" | "markings"
> {
  const roleOf = (key: string): number => {
    if (tones.primary !== undefined && key.startsWith("primary")) {
      return tones.primary;
    }
    if (MAJOR_ROADS.has(key)) return tones.major;
    if (MIDDLE_ROADS.has(key)) return tones.middle;
    if (PATH_ROADS.has(key)) return tones.paths;
    return tones.minor;
  };
  const surfaces = tones.surfaces;
  return {
    roads: recolour(D.roads, roleOf),
    roadSurfaces:
      surfaces === undefined
        ? D.roadSurfaces
        : recolour(D.roadSurfaces, () => surfaces),
    sidewalk: tones.sidewalk,
    defaultRoad: tones.minor,
    markings: tones.markings,
  };
}

/** Land-use classes by the colour group they take. */
const GREEN_CLASSES = new Set([
  "meadow",
  "grass",
  "park",
  "orchard",
  "allotments",
  "cemetery",
  "pitch",
  "playground",
  "sport",
  "court",
]);
const WOOD_CLASSES = new Set(["wood", "scrub", "wetland"]);
const FIELD_CLASSES = new Set(["farmland", "farmyard"]);

interface LandTones {
  readonly built: number;
  readonly green: number;
  readonly wood: number;
  readonly field: number;
  readonly water: number;
  readonly sand: number;
}

function landUseOf(tones: LandTones): CityColourScheme["landUse"] {
  return recolour(D.landUse, (key) => {
    if (key === "water") return tones.water;
    if (key === "sand") return tones.sand;
    if (GREEN_CLASSES.has(key)) return tones.green;
    if (WOOD_CLASSES.has(key)) return tones.wood;
    if (FIELD_CLASSES.has(key)) return tones.field;
    return tones.built;
  });
}

function treesOf(broad: number, needle: number): CityColourScheme["trees"] {
  return recolour(D.trees, (key) =>
    key.startsWith("needleleaved") ? needle : broad,
  );
}

function barriersOf(
  wall: number,
  hedge: number,
): Pick<CityColourScheme, "barriers" | "barrierMaterials"> {
  return {
    barriers: recolour(D.barriers, (key) => (key === "hedge" ? hedge : wall)),
    barrierMaterials: recolour(D.barrierMaterials, () => wall),
  };
}

/** The default's slope colours: no scheme retunes the slope treatment yet. */
const SLOPE = DEFAULT_GROUND_SLOPE_COLOURS;

/** Ivory model with pale grey roofs, from the V3 lab's tuned colours. */
export const ARCHITECT: ColourScheme = {
  label: "Architect's model",
  city: {
    ...D,
    honourColourTags: false,
    roadsBySurface: false,
    ground: 0xaaa498,
    walls: [0xf1eee7, 0xe8e4db, 0xeadfc9, 0xe0ded8, 0xebdfc8, 0xe6e1d5],
    pitchedRoofs: [0xd8d6d0, 0xcfccc6, 0xc8c5bf],
    flatRoofs: [0xdcdad5, 0xd2d0cb],
    ...roadsOf({
      major: 0xccc7bd,
      middle: 0xccc7bd,
      minor: 0xccc7bd,
      paths: 0xc2baa9,
      sidewalk: 0xd2cdc3,
      markings: 0xfdfcf8,
      surfaces: 0xccc7bd,
    }),
    ...barriersOf(0xd8d4cc, 0xb4bfa8),
    trees: treesOf(0xbcc6b0, 0xaebba3),
    landUse: landUseOf({
      built: 0xaea89c,
      green: 0xb4bfa8,
      wood: 0xa6b29a,
      field: 0xbcb6a0,
      water: 0x9aa8b4,
      sand: 0xc4bba4,
    }),
  },
  ground: { slope: SLOPE, plates: 0xbcb7ac },
  brightnessTrim: 0.9,
};

/** Pale blue drawing on deep navy paper. */
export const BLUEPRINT: ColourScheme = {
  label: "Blueprint",
  city: {
    ...D,
    honourColourTags: false,
    roadsBySurface: false,
    ground: 0x1f3352,
    walls: [0xa9c4e0, 0xb7cfe6, 0x9fbcd9],
    pitchedRoofs: [0x8fadcf, 0x86a4c6],
    flatRoofs: [0x9ab6d4],
    ...roadsOf({
      major: 0xf2f6fa,
      middle: 0xe2ecf6,
      minor: 0xd2e2f2,
      paths: 0x7f9cc0,
      sidewalk: 0xc4d6ea,
      markings: 0x2c4a72,
      surfaces: 0xd2e2f2,
    }),
    ...barriersOf(0x8fadcf, 0x4e6276),
    trees: treesOf(0x5b6f84, 0x4e6276),
    landUse: landUseOf({
      built: 0x243a5c,
      green: 0x2f4a5e,
      wood: 0x2a4256,
      field: 0x30465e,
      water: 0x14243c,
      sand: 0x3a4a66,
    }),
  },
  ground: { slope: SLOPE, plates: 0x2c4670 },
  brightnessTrim: 1,
};

/** Ochre, sand and whitewash under terracotta; tags honoured. */
export const MEDITERRANEAN: ColourScheme = {
  label: "Mediterranean",
  city: {
    ...D,
    ground: 0x9a8a6c,
    walls: [0xe8c98f, 0xdcb37a, 0xf2e6cf, 0xf5efe2, 0xe0c39a, 0xd9a86c],
    pitchedRoofs: [0xb8603e, 0xa9573a, 0xc4714a, 0x9e4f35],
    flatRoofs: [0xd8cbb4, 0xcfc0a5],
    ...roadsOf({
      major: 0xc9b79c,
      middle: 0xc2b096,
      minor: 0xbba98f,
      paths: 0xd0b98f,
      sidewalk: 0xd2c3a8,
      markings: 0xf6efe2,
    }),
    trees: treesOf(0x6f7a45, 0x5d6a3c),
    landUse: landUseOf({
      built: 0xa3927a,
      green: 0xb3a46a,
      wood: 0x6f7a45,
      field: 0xbfae74,
      water: 0x3fa7b0,
      sand: 0xd8c595,
    }),
  },
  ground: { slope: SLOPE, plates: 0xb3a58c },
  brightnessTrim: 1,
};

/** Cool greys with wood-red accents under dark slate; tags honoured. */
export const NORDIC: ColourScheme = {
  label: "Nordic",
  city: {
    ...D,
    ground: 0x5d6a5e,
    walls: [0xc9ccce, 0xb8bcc0, 0xd6d8d8, 0x9c4a3c, 0xa65a46, 0xe2e2de],
    pitchedRoofs: [0x4a5058, 0x3f454c, 0x555b62],
    flatRoofs: [0x6b7076, 0x5f6469],
    ...roadsOf({
      major: 0x8a95a2,
      middle: 0x838e9b,
      minor: 0x7c8794,
      paths: 0x8f8a7e,
      sidewalk: 0x969ca4,
      markings: 0xe6eaee,
    }),
    trees: treesOf(0x2f4a36, 0x264030),
    landUse: landUseOf({
      built: 0x667068,
      green: 0x5f7458,
      wood: 0x34503a,
      field: 0x7c8460,
      water: 0x2a4560,
      sand: 0xa8a48e,
    }),
  },
  ground: { slope: SLOPE, plates: 0x7a857c },
  brightnessTrim: 1,
};

/** Soft pink, mint, lavender and butter walls. */
export const PASTEL: ColourScheme = {
  label: "Pastel",
  city: {
    ...D,
    honourColourTags: false,
    roadsBySurface: false,
    ground: 0x93a397,
    walls: [0xf4c6cf, 0xc4ead6, 0xd8cdf0, 0xf6e7a8, 0xf8d9c0, 0xcfe4f2],
    pitchedRoofs: [0xe9dfe6, 0xdcd6e8, 0xe6e0d0],
    flatRoofs: [0xeceae6, 0xe2e0dc],
    ...roadsOf({
      major: 0xc2c0cc,
      middle: 0xc2c0cc,
      minor: 0xc2c0cc,
      paths: 0xd6c3b0,
      sidewalk: 0xd2d0da,
      markings: 0x8e88a8,
      surfaces: 0xc2c0cc,
    }),
    ...barriersOf(0xe6dcd6, 0x9cc7a0),
    trees: treesOf(0x9cc7a0, 0x8fbf95),
    landUse: landUseOf({
      built: 0x9ea89f,
      green: 0xb5d6b0,
      wood: 0x8fbf95,
      field: 0xd8e2b0,
      water: 0xa9cbe6,
      sand: 0xeee0b8,
    }),
  },
  ground: { slope: SLOPE, plates: 0xaab8ad },
  brightnessTrim: 1,
};

/** A generic printed road map: roads by class, never by surface. */
export const MAP: ColourScheme = {
  label: "Road map",
  city: {
    ...D,
    honourColourTags: false,
    roadsBySurface: false,
    ground: 0xb8b0a0,
    walls: [0xa4968a, 0x9c8e82, 0xac9e92],
    pitchedRoofs: [0x9a8c80, 0x928478],
    flatRoofs: [0xa09286],
    ...roadsOf({
      major: 0xe8743b,
      primary: 0xf2a65a,
      middle: 0xf7e08a,
      minor: 0xffffff,
      paths: 0xa9744b,
      sidewalk: 0xeeeeee,
      markings: 0x555555,
      surfaces: 0xffffff,
    }),
    ...barriersOf(0x8c8278, 0x88b878),
    trees: treesOf(0x88b878, 0x78a868),
    landUse: landUseOf({
      built: 0xc0b8a8,
      green: 0xb8d8a0,
      wood: 0x9cc490,
      field: 0xe6e2b0,
      water: 0x9ccbe8,
      sand: 0xf0e2b4,
    }),
  },
  ground: { slope: SLOPE, plates: 0xc8c0b2 },
  brightnessTrim: 1,
};

/** Charcoal buildings on near-black ground; trimmed up so it reads at noon. */
export const NIGHT: ColourScheme = {
  label: "Night",
  city: {
    ...D,
    honourColourTags: false,
    roadsBySurface: false,
    ground: 0x101214,
    walls: [0x3a3c40, 0x34363a, 0x404247],
    pitchedRoofs: [0x2c2e32, 0x26282c],
    flatRoofs: [0x303236],
    ...roadsOf({
      major: 0xb8bcc2,
      middle: 0xaeb2b8,
      minor: 0xa4a8ae,
      paths: 0x7a7e84,
      sidewalk: 0x6a6e74,
      markings: 0xeef0f4,
      surfaces: 0xa4a8ae,
    }),
    ...barriersOf(0x3a3c40, 0x1e3524),
    trees: treesOf(0x1e3524, 0x18301f),
    landUse: landUseOf({
      built: 0x16181c,
      green: 0x16261a,
      wood: 0x12201a,
      field: 0x1c2418,
      water: 0x0a1220,
      sand: 0x2a2820,
    }),
  },
  ground: { slope: SLOPE, plates: 0x22252a },
  brightnessTrim: 1.4,
};

/** Greys only, for judging form and shading. */
export const MONO: ColourScheme = {
  label: "Monochrome",
  city: {
    ...D,
    honourColourTags: false,
    roadsBySurface: false,
    ground: 0x6e6e6e,
    walls: [0xd0d0d0, 0xc4c4c4, 0xdadada],
    pitchedRoofs: [0x8a8a8a, 0x7c7c7c, 0x969696],
    flatRoofs: [0x9a9a9a, 0x8c8c8c],
    ...roadsOf({
      major: 0xb0b0b0,
      middle: 0xa8a8a8,
      minor: 0xa0a0a0,
      paths: 0x909090,
      sidewalk: 0xb8b8b8,
      markings: 0xf0f0f0,
      surfaces: 0xa0a0a0,
    }),
    ...barriersOf(0xa8a8a8, 0x5a5a5a),
    trees: treesOf(0x5a5a5a, 0x505050),
    landUse: landUseOf({
      built: 0x727272,
      green: 0x666666,
      wood: 0x5a5a5a,
      field: 0x7a7a7a,
      water: 0x4a4a4a,
      sand: 0x8a8a8a,
    }),
  },
  ground: { slope: SLOPE, plates: 0x868686 },
  brightnessTrim: 1,
};

/**
 * Large lightness steps; the hues live on the blue-orange axis, which the
 * common red-green deficiencies keep apart, and vegetation differs from the
 * ground by lightness rather than by hue alone.
 */
export const CONTRAST: ColourScheme = {
  label: "High contrast",
  city: {
    ...D,
    honourColourTags: false,
    roadsBySurface: false,
    ground: 0x8c8270,
    walls: [0xf2f2f2, 0xe8e8e8],
    pitchedRoofs: [0xe08a2c, 0xd47f22],
    flatRoofs: [0xb0b0b0],
    ...roadsOf({
      major: 0x101010,
      middle: 0x262626,
      minor: 0x3a3a3a,
      paths: 0xe6a23c,
      sidewalk: 0x5a5a5a,
      markings: 0xffffff,
      surfaces: 0x3a3a3a,
    }),
    ...barriersOf(0xd8d8d8, 0x1d5c3c),
    trees: treesOf(0x1d5c3c, 0x164a30),
    landUse: landUseOf({
      built: 0x9a9080,
      green: 0x2f6b4a,
      wood: 0x1d5c3c,
      field: 0xc8b070,
      water: 0x2166ac,
      sand: 0xe6d7a8,
    }),
  },
  ground: { slope: SLOPE, plates: 0xa79d8a },
  brightnessTrim: 1,
};
