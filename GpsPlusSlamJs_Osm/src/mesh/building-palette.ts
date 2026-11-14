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
 * not read under this palette (owner, Q3 of that plan). The class colours of
 * `feature-colours.ts` are what `buildCity`'s `palette: "class"` draws.
 *
 * Every tone is muted: the loudest, the first clay, has a chroma of 58 (max
 * minus min channel, 0-255), under the heat ramp's floor of 80, so the ramp
 * stays the loudest thing on screen (DEC-R4-5).
 *
 * @see building-palette.ts.md
 */

import type { OsmTags } from "../model/osm-feature.js";
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
}

/** Today's palette, the default scheme's. */
export const DEFAULT_PALETTE_COLOURS: PaletteColours = {
  honourColourTags: true,
  walls: WALL_TONES,
  pitchedRoofs: PITCHED_ROOF_TONES,
  flatRoofs: FLAT_ROOF_TONES,
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

/**
 * The seeded colours of a building: `key` is the building's own key, or its
 * outline's for a part; `pitched` picks the clay and slate roofs over the flat
 * greys. Tags first, as above. Never throws: a non-string key reads as "".
 */
export function seededBuildingColours(
  tags: OsmTags,
  outline: OsmTags | undefined,
  key: string,
  pitched: boolean,
  colours: PaletteColours = DEFAULT_PALETTE_COLOURS,
): BuildingColours {
  const seed = typeof key === "string" ? key : "";
  const honour = colours.honourColourTags;
  const taggedWall = honour
    ? (parseOsmColour(tags["building:colour"]) ??
      parseOsmColour(outline?.["building:colour"]))
    : undefined;
  const taggedRoof = honour ? roofColour(tags, outline) : undefined;
  const wall = taggedWall ?? pick(colours.walls, seed, "wall");
  const roof =
    taggedRoof ??
    (pitched
      ? pick(colours.pitchedRoofs, seed, "roof")
      : pick(colours.flatRoofs, seed, "lid"));
  return { wall, roof };
}

/** Every tone the palette can draw, for the chroma check. */
export function allPaletteColours(
  colours: PaletteColours = DEFAULT_PALETTE_COLOURS,
): Rgb[] {
  return [...colours.walls, ...colours.pitchedRoofs, ...colours.flatRoofs];
}
