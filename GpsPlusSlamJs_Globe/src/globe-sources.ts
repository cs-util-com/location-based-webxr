/**
 * The globe's one imagery registry (globe plan 2026-09-26-0539 §7.7): every
 * source the globe can load, with what loads it and its credit. The globe
 * takes imagery only from here, so nothing can load without a credit. The
 * files are committed under `assets/` by `scripts/fetch-globe-assets.mjs`.
 *
 * @see globe-sources.ts.md
 */

/** The same shape as OsmDemo's attribution entries (phase 5 hands it over). */
export interface GlobeCredit {
  readonly short: string;
  readonly full: string;
  readonly href: string;
}

export type GlobeSourceId =
  "blue-marble" | "black-marble" | "water-mask" | "clouds";

export interface GlobeSource {
  readonly id: GlobeSourceId;
  /** A tile pyramid (`{z}/{x}/{y}` template) or one global map. */
  readonly kind: "tiles" | "equirect";
  /** Served by the design system at /globe-assets/. */
  readonly path: string;
  /** Tile levels committed (0 to levels - 1), for a pyramid. */
  readonly levels?: number;
  readonly projection?: "EPSG:4326";
  /** Colour data (sRGB) or a mask read as numbers (linear). */
  readonly colorSpace: "srgb" | "linear";
  readonly credit: GlobeCredit;
}

/** GIBS asks for this acknowledgement; the globe shows it in full. */
export const GIBS_ACKNOWLEDGEMENT =
  "We acknowledge the use of imagery provided by services from NASA's Global " +
  "Imagery Browse Services (GIBS), part of NASA's Earth Science Data and " +
  "Information System (ESDIS).";

export const GLOBE_SOURCES: readonly GlobeSource[] = [
  {
    id: "blue-marble",
    kind: "tiles",
    path: "/globe-assets/blue-marble-4326/{z}/{x}/{y}.jpg",
    levels: 5,
    projection: "EPSG:4326",
    colorSpace: "srgb",
    credit: {
      short: "NASA Blue Marble",
      full: "NASA Earth Observatory, Blue Marble: Next Generation, via NASA GIBS",
      href: "https://earthobservatory.nasa.gov/features/BlueMarble",
    },
  },
  {
    id: "black-marble",
    kind: "equirect",
    path: "/globe-assets/equirect/night-2016-2048.jpg",
    colorSpace: "srgb",
    credit: {
      short: "NASA Black Marble",
      full: "NASA Black Marble 2016 (VIIRS night lights), via NASA GIBS",
      href: "https://earthobservatory.nasa.gov/features/NightLights",
    },
  },
  {
    id: "water-mask",
    kind: "equirect",
    path: "/globe-assets/equirect/water-2048.png",
    colorSpace: "linear",
    credit: {
      short: "MODIS Water Mask",
      full: "MODIS Water Mask (MOD44W), via NASA GIBS",
      href: "https://nasa-gibs.github.io/gibs-api-docs/",
    },
  },
  {
    id: "clouds",
    kind: "equirect",
    path: "/globe-assets/equirect/clouds-2048.jpg",
    // A grey photo, read as cloud COVERAGE: a number, not a colour.
    colorSpace: "linear",
    credit: {
      short: "NASA Visible Earth",
      full: "NASA Visible Earth, Blue Marble clouds (R. Stöckli)",
      href: "https://visibleearth.nasa.gov/images/57747",
    },
  },
];

/** A source by id. @throws RangeError for an id the registry does not have. */
export function globeSource(id: GlobeSourceId): GlobeSource {
  const source = GLOBE_SOURCES.find((s) => s.id === id);
  if (!source) throw new RangeError(`no globe source "${id}"`);
  return source;
}
