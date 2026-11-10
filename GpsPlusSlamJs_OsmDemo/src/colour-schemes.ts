/**
 * The OSM demo's colour schemes (colour schemes plan 2026-11-10-0841): one
 * table, read by the page (ground, plates, trim, the dropdown) and by the
 * worker (the city's colours, D1).
 *
 * WHY THE NAME CROSSES THE WORKER BOUNDARY, NOT THE SCHEME. A name is small,
 * makes the build key deterministic, and the worker can never be handed an
 * unvalidated scheme: it looks the name up in this same table.
 *
 * WHY THE PAGE COLOURS FOLLOW THE DRAWN MESH, NOT THE CHOICE. The page applies
 * the colours of the scheme a mesh was BUILT with (`TransferableMesh.colourScheme`),
 * so the ground and the plates never change before the buildings they belong
 * with, and AR (which always builds the default, D9) gets the default page
 * colours without a second rule.
 *
 * @see colour-schemes.ts.md
 */

import {
  DEFAULT_CITY_COLOUR_SCHEME,
  validateCityColourScheme,
  type CityColourScheme,
} from "gps-plus-slam-osm";

import {
  ARCHITECT,
  BLUEPRINT,
  CONTRAST,
  MAP,
  MEDITERRANEAN,
  MONO,
  NIGHT,
  NORDIC,
  PASTEL,
} from "./colour-scheme-looks.js";
import {
  DEFAULT_GROUND_SLOPE_COLOURS,
  validateGroundSlopeColours,
  type GroundSlopeColours,
} from "./ground-slope-colours.js";
import { PLATE_COLOUR } from "./surface-colours.js";

/** The colours the page applies itself, without a rebuild. */
interface GroundColours {
  /** The slope treatment's colours (linear). */
  readonly slope: GroundSlopeColours;
  /** The landuse plates, sRGB `0xrrggbb`; lighter than the ground. */
  readonly plates: number;
}

/** One entry of the table. */
export interface ColourScheme {
  /** The dropdown's label, in English like the other selects. */
  readonly label: string;
  /** Everything the worker colours (buildings, roofs, roads, barriers, trees, land use, the ground). */
  readonly city: CityColourScheme;
  readonly ground: GroundColours;
  /**
   * Multiplied into the surface gain of buildings and roads (D4), in
   * [{@link MIN_BRIGHTNESS_TRIM}, {@link MAX_BRIGHTNESS_TRIM}].
   */
  readonly brightnessTrim: number;
}

export const MIN_BRIGHTNESS_TRIM = 0.5;
export const MAX_BRIGHTNESS_TRIM = 2;

/** `0xrrggbb`: an integer in [0, 0xffffff]. */
function isRgbHex(value: unknown): value is number {
  return (
    Number.isInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= 0xffffff
  );
}

/**
 * Refuses a malformed entry: `TypeError` for a missing label or city scheme,
 * `RangeError` for a colour or trim out of range. Returns the entry.
 */
export function validateColourScheme(scheme: ColourScheme): ColourScheme {
  if (typeof scheme.label !== "string" || scheme.label.trim() === "") {
    throw new TypeError("a colour scheme needs a label");
  }
  validateCityColourScheme(scheme.city);
  validateGroundSlopeColours(scheme.ground.slope);
  if (!isRgbHex(scheme.ground.plates)) {
    throw new RangeError(
      `${scheme.label}: plates colour ${String(scheme.ground.plates)} is not 0xrrggbb`,
    );
  }
  const trim = scheme.brightnessTrim;
  if (
    !Number.isFinite(trim) ||
    trim < MIN_BRIGHTNESS_TRIM ||
    trim > MAX_BRIGHTNESS_TRIM
  ) {
    throw new RangeError(
      `${scheme.label}: brightness trim ${String(trim)} is outside ${MIN_BRIGHTNESS_TRIM}-${MAX_BRIGHTNESS_TRIM}`,
    );
  }
  return scheme;
}

/** Today's look: every colour as it was before the schemes (D8). */
const TODAY: ColourScheme = {
  label: "Today",
  city: DEFAULT_CITY_COLOUR_SCHEME,
  ground: { slope: DEFAULT_GROUND_SLOPE_COLOURS, plates: PLATE_COLOUR },
  brightnessTrim: 1,
};

/**
 * The table, in dropdown order. Validated when this module loads, so a broken
 * entry fails every page and every test at once rather than at the switch.
 */
export const COLOUR_SCHEMES = Object.freeze({
  today: TODAY,
  architect: ARCHITECT,
  blueprint: BLUEPRINT,
  mediterranean: MEDITERRANEAN,
  nordic: NORDIC,
  pastel: PASTEL,
  map: MAP,
  night: NIGHT,
  mono: MONO,
  contrast: CONTRAST,
} satisfies Record<string, ColourScheme>);

export type ColourSchemeName = keyof typeof COLOUR_SCHEMES;

export const DEFAULT_COLOUR_SCHEME: ColourSchemeName = "today";

/** The names in dropdown order. */
export const COLOUR_SCHEME_NAMES: readonly ColourSchemeName[] = Object.freeze(
  Object.keys(COLOUR_SCHEMES) as ColourSchemeName[],
);

for (const name of COLOUR_SCHEME_NAMES) {
  validateColourScheme(COLOUR_SCHEMES[name]);
}

/** Whether `value` names a scheme in the table (own keys only). */
export function isColourSchemeName(value: unknown): value is ColourSchemeName {
  return typeof value === "string" && Object.hasOwn(COLOUR_SCHEMES, value);
}

/** The entry for a name; an unknown or absent name gives the default's. */
export function colourSchemeOf(name: string | undefined): ColourScheme {
  return COLOUR_SCHEMES[
    isColourSchemeName(name) ? name : DEFAULT_COLOUR_SCHEME
  ];
}

/**
 * The `?scheme=` value that names `name` in a link: `null` (no parameter)
 * for the default, so a link carries a scheme only when it is not today's.
 */
export function schemeLinkValue(name: ColourSchemeName): string | null {
  return name === DEFAULT_COLOUR_SCHEME ? null : name;
}

/**
 * A name from a link (`?scheme=`): absent gives the default silently, an
 * unknown name gives the default with one warning, as `?grade=` does.
 */
export function resolveColourScheme(
  name: string | null,
  // eslint-disable-next-line no-console -- the one report of a mistyped link
  warn: (message: string) => void = console.warn,
): ColourSchemeName {
  if (name === null) return DEFAULT_COLOUR_SCHEME;
  if (isColourSchemeName(name)) return name;
  warn(
    `unknown colour scheme "${name}", using "${DEFAULT_COLOUR_SCHEME}" (known: ${COLOUR_SCHEME_NAMES.join(", ")})`,
  );
  return DEFAULT_COLOUR_SCHEME;
}
