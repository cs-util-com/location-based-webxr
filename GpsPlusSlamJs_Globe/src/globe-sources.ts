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
  /**
   * A tile pyramid (`{z}/{x}/{y}` template), one global map, or the alpha
   * channel of another source's files (`path` is theirs).
   */
  readonly kind: "tiles" | "equirect" | "alpha";
  /** Served by the design system at /globe-assets/. */
  readonly path: string;
  /** Tile levels committed (0 to levels - 1), for a pyramid. */
  readonly levels?: number;
  readonly projection?: "EPSG:4326";
  /** Colour data (sRGB) or a mask read as numbers (linear). */
  readonly colorSpace: "srgb" | "linear";
  /**
   * A grey map, sent to the GPU as one channel (red), a quarter of the
   * memory (round-3 plan 2026-10-08-2345 M1).
   */
  readonly grey?: true;
  readonly credit: GlobeCredit;
}

/** GIBS asks for this acknowledgement; the globe shows it in full. */
export const GIBS_ACKNOWLEDGEMENT =
  "We acknowledge the use of imagery provided by services from NASA's Global " +
  "Imagery Browse Services (GIBS), part of NASA's Earth Science Data and " +
  "Information System (ESDIS).";

export const GLOBE_SOURCES: readonly GlobeSource[] = [
  {
    // WebP (round-4 plan 2026-09-28-2105 DEC-GL4-3/10), its alpha the water
    // mask (the next entry).
    id: "blue-marble",
    kind: "tiles",
    path: "/globe-assets/blue-marble-4326/{z}/{x}/{y}.webp",
    // Levels 0-5 (level 5: round-4 plan 2026-09-28-2105 DEC-GL4-3, about
    // 2.4 km a pixel at the equator).
    levels: 6,
    projection: "EPSG:4326",
    colorSpace: "srgb",
    credit: {
      short: "NASA Blue Marble",
      full: "NASA Earth Observatory, Blue Marble: Next Generation, via NASA GIBS",
      href: "https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/",
    },
  },
  {
    id: "black-marble",
    kind: "equirect",
    path: "/globe-assets/equirect/night-2016-2048.webp",
    colorSpace: "srgb",
    credit: {
      short: "NASA Black Marble",
      full: "NASA Black Marble 2016 (VIIRS night lights), via NASA GIBS",
      href: "https://science.nasa.gov/earth/earth-observatory/earth-at-night/",
    },
  },
  {
    // The imagery tiles' alpha, cut to the same tiles (DEC-GL4-6): 1 on
    // land, 0 on water. Lossless, and exactly where the imagery's coasts are.
    id: "water-mask",
    kind: "alpha",
    path: "/globe-assets/blue-marble-4326/{z}/{x}/{y}.webp",
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
    path: "/globe-assets/equirect/clouds-4096.webp",
    // A grey photo, read as cloud COVERAGE: a number, not a colour.
    colorSpace: "linear",
    grey: true,
    // The 2002 Blue Marble's clouds: Visible Earth's record (57747) now
    // redirects to a generic page, so the credit links the live page of
    // its successor by the same author (round-3 plan M1).
    credit: {
      short: "NASA Visible Earth",
      full: "NASA Visible Earth, Blue Marble clouds (R. Stöckli)",
      href: "https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/",
    },
  },
];

/** A source by id. @throws RangeError for an id the registry does not have. */
export function globeSource(id: GlobeSourceId): GlobeSource {
  const source = GLOBE_SOURCES.find((s) => s.id === id);
  if (!source) throw new RangeError(`no globe source "${id}"`);
  return source;
}
