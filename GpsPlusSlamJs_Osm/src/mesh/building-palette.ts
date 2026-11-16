/**
 * The seeded palette every building without a colour tag takes (city objects
 * plan 2026-11-07-2315 M7, the owner's choice of the V2 city look).
 *
 * Walls in six warm plaster and sandstone tones, pitched roofs in five clay
 * tones and two slate greys, flat roofs in four bitumen and gravel greys. Each
 * building picks one of each from its own key, so the same house is the same
 * colour on every device and every reload; a `building:part` passes its
 * outline's key, so a cathedral stays one building.
 *
 * Colour tags win: `building:colour` (the part's, then its outline's) for the
 * walls, `roof:colour` (the same order) for the roof. `building:material` is
 * not read under the default palette (Q3 of that plan). The class colours of
 * `feature-colours.ts` are what `buildCity`'s `palette: "class"` draws.
 *
 * A colour scheme may add three wall rules (city look exploration
 * 2026-11-15, direction B), all off in the default: a material tag picks a
 * tone from `materialWalls`, a building at or above `towerFromM` draws from
 * `towerWalls`, and `wallJitterL` shifts the picked wall's CIE L* by a
 * seeded amount per building. The order is colour tag, material, tower list,
 * walls; the jitter is applied last, to whichever tone won.
 *
 * Every tone is muted: the loudest, the first clay, has a chroma of 58 (max
 * minus min channel, 0-255), under the heat ramp's floor of 80, so the ramp
 * stays the loudest thing on screen (DEC-R4-5).
 *
 * @see building-palette.ts.md
 */

import type { OsmTags } from "../model/osm-feature.js";
import { labToRgb, rgbToLab } from "./cielab.js";
import { parseOsmColour, roofColour, type Rgb } from "./feature-colours.js";
import { mixedUnit } from "./stable-jitter.js";

/** Which colours `buildCity` gives untagged buildings. */
export type BuildingPalette = "seeded" | "class";

/** Wall tones: sandstone and plaster. */
export const WALL_TONES: readonly Rgb[] = [
  0xdccfba, 0xd6c8b2, 0xd0c5b3, 0xddcdb2, 0xcbbfae, 0xd8c5a8,
];

/** Pitched roof tones: five clay, then two slate greys. */
export const PITCHED_ROOF_TONES: readonly Rgb[] = [
  0x8c6152, 0x7c5a4e, 0x96705f, 0x86604f, 0x7f6a60, 0x6b625e, 0x5c5a5c,
];

/** Flat roof tones: bitumen and gravel greys, not clay. */
export const FLAT_ROOF_TONES: readonly Rgb[] = [
  0x8a8782, 0x7a7772, 0x97938c, 0x6f6d6a,
];

/**
 * The colours `seededBuildingColours` reads (a colour scheme's building
 * part, `colour-scheme.ts`). `honourColourTags` false paints every building
 * from the tone lists, whatever its `building:colour` / `roof:colour` say.
 */
export interface PaletteColours {
  readonly honourColourTags: boolean;
  readonly walls: readonly Rgb[];
  readonly pitchedRoofs: readonly Rgb[];
  readonly flatRoofs: readonly Rgb[];
  /** Wall tones of a building at or above `towerFromM`. */
  readonly towerWalls: readonly Rgb[];
  /**
   * The height in metres (the tallest volume of the building) from which
   * its walls come from `towerWalls`; infinite turns the rule off.
   */
  readonly towerFromM: number;
  /** Read `building:material` (the part's, then its outline's). */
  readonly honourMaterialTags: boolean;
  /**
   * A wall tone per `building:material` value, keyed lower case; a value
   * the map does not name falls through to the tower list and the walls.
   */
  readonly materialWalls: ReadonlyMap<string, Rgb>;
  /**
   * The largest seeded shift of a wall's CIE L*, either way, per building;
   * 0 leaves every tone byte for byte as picked.
   */
  readonly wallJitterL: number;
}

/** Today's palette, the default scheme's. */
export const DEFAULT_PALETTE_COLOURS: PaletteColours = {
  honourColourTags: true,
  walls: WALL_TONES,
  pitchedRoofs: PITCHED_ROOF_TONES,
  flatRoofs: FLAT_ROOF_TONES,
  towerWalls: WALL_TONES,
  towerFromM: Number.POSITIVE_INFINITY,
  honourMaterialTags: false,
  materialWalls: new Map(),
  wallJitterL: 0,
};

/** The wall and roof colour of one building volume. */
export interface BuildingColours {
  readonly wall: Rgb;
  readonly roof: Rgb;
}

/** One entry of `list`, picked by `key` and `salt`. */
function pick(list: readonly Rgb[], key: string, salt: string): Rgb {
  const i = Math.min(
    list.length - 1,
    Math.floor(mixedUnit(key, salt) * list.length),
  );
  return list[i] ?? (list[0] as Rgb);
}

/** A `building:material` value as a `materialWalls` key: the first of a
 * `;` list, trimmed, lower case; undefined when absent or empty. */
function materialKey(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const first = (value.split(";")[0] ?? "").trim().toLowerCase();
  return first === "" ? undefined : first;
}

/** The material tag's wall tone, the part's tag before its outline's. */
function materialWall(
  tags: OsmTags,
  outline: OsmTags | undefined,
  colours: PaletteColours,
): Rgb | undefined {
  for (const value of [
    tags["building:material"],
    outline?.["building:material"],
  ]) {
    const k = materialKey(value);
    const tone = k === undefined ? undefined : colours.materialWalls.get(k);
    if (tone !== undefined) return tone;
  }
  return undefined;
}

/**
 * `tone` with its CIE L* shifted by up to `jitterL` either way, seeded by
 * `key`. A jitter of 0 (or anything not above 0) returns `tone` itself, so
 * the default never takes the Lab round trip.
 */
function jitterLightness(tone: Rgb, key: string, jitterL: number): Rgb {
  if (!(jitterL > 0)) return tone;
  const lab = rgbToLab(tone);
  const shift = (2 * mixedUnit(key, "wallL") - 1) * jitterL;
  return labToRgb({ ...lab, l: Math.min(100, Math.max(0, lab.l + shift)) });
}

/**
 * The wall of a building no colour tag paints: its material's tone when the
 * scheme reads materials and names it, else a pick from the tower list (at or
 * above `towerFromM`; a height that is absent or not finite is no tower) or
 * from the walls.
 */
function untaggedWall(
  tags: OsmTags,
  outline: OsmTags | undefined,
  seed: string,
  colours: PaletteColours,
  heightM: number | undefined,
): Rgb {
  const material = colours.honourMaterialTags
    ? materialWall(tags, outline, colours)
    : undefined;
  if (material !== undefined) return material;
  const tower =
    heightM !== undefined &&
    Number.isFinite(heightM) &&
    heightM >= colours.towerFromM;
  return pick(tower ? colours.towerWalls : colours.walls, seed, "wall");
}

/**
 * The seeded colours of a building: `key` is the building's own key, or its
 * outline's for a part; `pitched` picks the clay and slate roofs over the flat
 * greys; `heightM` is the building's height for the tower rule (absent or not
 * finite: not a tower). Tags first, as above. Never throws: a non-string key
 * reads as "".
 */
export function seededBuildingColours(
  tags: OsmTags,
  outline: OsmTags | undefined,
  key: string,
  pitched: boolean,
  colours: PaletteColours = DEFAULT_PALETTE_COLOURS,
  heightM?: number,
): BuildingColours {
  const seed = typeof key === "string" ? key : "";
  const honour = colours.honourColourTags;
  const taggedWall = honour
    ? (parseOsmColour(tags["building:colour"]) ??
      parseOsmColour(outline?.["building:colour"]))
    : undefined;
  const taggedRoof = honour ? roofColour(tags, outline) : undefined;
  const picked =
    taggedWall ?? untaggedWall(tags, outline, seed, colours, heightM);
  const wall = jitterLightness(picked, seed, colours.wallJitterL);
  const roof =
    taggedRoof ??
    (pitched
      ? pick(colours.pitchedRoofs, seed, "roof")
      : pick(colours.flatRoofs, seed, "lid"));
  return { wall, roof };
}

/**
 * Every tone the palette can pick, for the chroma check: walls, tower walls,
 * material walls and both roof lists, before any lightness jitter.
 */
export function allPaletteColours(
  colours: PaletteColours = DEFAULT_PALETTE_COLOURS,
): Rgb[] {
  return [
    ...colours.walls,
    ...colours.towerWalls,
    ...colours.materialWalls.values(),
    ...colours.pitchedRoofs,
    ...colours.flatRoofs,
  ];
}
