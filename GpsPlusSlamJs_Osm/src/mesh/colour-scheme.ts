/**
 * A city colour scheme: every colour `buildCity` paints, in one value (OSM
 * demo colour schemes plan 2026-11-10-0841 section 4.1). A consumer passes
 * one as `CityOptions.colours`; without one the city is drawn in
 * `DEFAULT_CITY_COLOUR_SCHEME`, which is built FROM the existing colour
 * tables (not a copy of them), so a city without a scheme is byte-identical
 * to one built before schemes existed (`colour-identity.test.ts`).
 *
 * COLOUR SPACE, the trap a scheme author meets (city objects plan
 * 2026-11-07-2315 section 7): every colour here is written as sRGB hex, but
 * the layers land in their buffers by two different rules. Building chunks
 * (walls, roofs, barriers) are converted to linear light; ROAD chunks stay
 * raw bytes / 255, so a road hex renders lighter than the same hex on a wall,
 * exactly as today's road colours do. Trees go through three's colour
 * management (converted). `colour-scheme.test.ts` pins both rules.
 *
 * @see colour-scheme.ts.md
 */

import type { BarrierKind } from "./barriers.js";
import {
  DEFAULT_BARRIER_COLOURS,
  type BarrierColours,
} from "./barrier-colours.js";
import {
  DEFAULT_PALETTE_COLOURS,
  type PaletteColours,
} from "./building-palette.js";
import {
  DEFAULT_ROAD_COLOURS,
  type RoadColours,
  type Rgb,
} from "./feature-colours.js";
import {
  DEFAULT_GROUND_RGB,
  DEFAULT_LAND_USE_RGB,
  type GroundClass,
} from "./ground-tint.js";
import { TREE_PALETTE, type TreeKey } from "./trees.js";

/**
 * Every colour of a city. No field is optional: a scheme lists every colour,
 * so a missing entry is a validation error rather than a silent fallback to
 * the default (which would leave a scheme half switched). Write one by
 * spreading the default and overriding.
 */
export interface CityColourScheme
  extends PaletteColours, RoadColours, BarrierColours {
  /**
   * Keep `building:colour` / `roof:colour` tags, and mix a barrier's
   * `colour` tag in (owner D7). False paints over them.
   */
  readonly honourColourTags: boolean;
  /** Car roads take a `surface` colour before their class colour. */
  readonly roadsBySurface: boolean;
  /**
   * The neutral ground: the texels of the land-use tint no class paints,
   * the blend target of every class, and the ground material with the tint
   * off (one owner for both states).
   */
  readonly ground: Rgb;
  /** Seeded wall tones (`WALL_TONES` in the default). */
  readonly walls: readonly Rgb[];
  /** Seeded pitched roof tones (`PITCHED_ROOF_TONES`). */
  readonly pitchedRoofs: readonly Rgb[];
  /** Seeded flat roof tones (`FLAT_ROOF_TONES`). */
  readonly flatRoofs: readonly Rgb[];
  /** Per `highway` class. */
  readonly roads: ReadonlyMap<string, Rgb>;
  /** Per `surface` value. */
  readonly roadSurfaces: ReadonlyMap<string, Rgb>;
  readonly sidewalk: Rgb;
  /** A road class nothing names. */
  readonly defaultRoad: Rgb;
  readonly barriers: ReadonlyMap<BarrierKind, Rgb>;
  readonly barrierMaterials: ReadonlyMap<string, Rgb>;
  /** Tree crowns, keyed `leafType/leafCycle` plus `unknown`. */
  readonly trees: ReadonlyMap<TreeKey, Rgb>;
  /** The land-use tint's class colours. */
  readonly landUse: ReadonlyMap<GroundClass, Rgb>;
}

/** Today's colours, built from the tables that own them. */
export const DEFAULT_CITY_COLOUR_SCHEME: CityColourScheme = Object.freeze({
  ...DEFAULT_PALETTE_COLOURS,
  ...DEFAULT_ROAD_COLOURS,
  ...DEFAULT_BARRIER_COLOURS,
  honourColourTags: true,
  ground: DEFAULT_GROUND_RGB,
  trees: TREE_PALETTE,
  landUse: DEFAULT_LAND_USE_RGB,
});

const BOOLEAN_FIELDS = ["honourColourTags", "roadsBySurface"] as const;
const COLOUR_FIELDS = [
  "ground",
  "sidewalk",
  "defaultRoad",
  "markings",
] as const;
const LIST_FIELDS = ["walls", "pitchedRoofs", "flatRoofs"] as const;
const MAP_FIELDS = [
  "roads",
  "roadSurfaces",
  "barriers",
  "barrierMaterials",
  "trees",
  "landUse",
] as const;

function isRgb(value: unknown): value is Rgb {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 0xffffff
  );
}

function rgbText(value: unknown): string {
  return typeof value === "number" ? String(value) : typeof value;
}

/**
 * The scheme, checked: an object with every field of
 * `DEFAULT_CITY_COLOUR_SCHEME`, booleans as booleans, every colour an
 * integer in 0..0xffffff, every tone list non-empty, and every map a `Map`
 * holding exactly the default's keys (a missing key is a colour the scheme
 * forgot; an extra one is a typo that would never be read). Throws
 * `RangeError` naming the first problem; returns the value unchanged.
 */
export function validateCityColourScheme(scheme: unknown): CityColourScheme {
  if (typeof scheme !== "object" || scheme === null) {
    throw new RangeError("colour scheme must be an object");
  }
  const s = scheme as Record<string, unknown>;
  for (const field of BOOLEAN_FIELDS) {
    if (typeof s[field] !== "boolean") {
      throw new RangeError(`colour scheme ${field} must be a boolean`);
    }
  }
  for (const field of COLOUR_FIELDS) {
    if (!isRgb(s[field])) {
      throw new RangeError(
        `colour scheme ${field} must be a colour 0..0xffffff, got ${rgbText(s[field])}`,
      );
    }
  }
  for (const field of LIST_FIELDS) validateList(field, s[field]);
  for (const field of MAP_FIELDS) validateMap(field, s[field]);
  return scheme as CityColourScheme;
}

function validateList(field: string, list: unknown): void {
  if (!Array.isArray(list) || list.length === 0) {
    throw new RangeError(`colour scheme ${field} must be a non-empty list`);
  }
  list.forEach((value: unknown, i) => {
    if (!isRgb(value)) {
      throw new RangeError(
        `colour scheme ${field}[${i}] must be a colour, got ${rgbText(value)}`,
      );
    }
  });
}

function validateMap(field: (typeof MAP_FIELDS)[number], map: unknown): void {
  if (!(map instanceof Map)) {
    throw new RangeError(`colour scheme ${field} must be a Map`);
  }
  const expected = DEFAULT_CITY_COLOUR_SCHEME[field] as ReadonlyMap<
    string,
    Rgb
  >;
  for (const key of expected.keys()) {
    if (!map.has(key)) {
      throw new RangeError(`colour scheme ${field} lacks "${key}"`);
    }
  }
  for (const [key, value] of map as Map<unknown, unknown>) {
    if (typeof key !== "string" || !expected.has(key)) {
      throw new RangeError(
        `colour scheme ${field} has an unknown key "${String(key)}"`,
      );
    }
    if (!isRgb(value)) {
      throw new RangeError(
        `colour scheme ${field} "${key}" must be a colour, got ${rgbText(value)}`,
      );
    }
  }
}
