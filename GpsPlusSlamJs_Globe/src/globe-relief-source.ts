/**
 * The relief's height sources (tour editor plan 2026-10-17-1816 §13, G1
 * step 2; G0 spikes Q1): what each source is (its tile size, its deepest
 * zoom, the zoom it covers the whole planet at, its credits), whether a
 * tile it answers 404 for is drawn from its nearest ancestor (Mapterhorn,
 * where its fine zooms do not exist), and the arithmetic from a vertex
 * spacing to the relief tree's level.
 *
 * - AWS Terrarium (Mapzen terrain tiles): 256 px, the globe's z12; biased
 *   +5 to +11 m in towns at z12 and z14 alike.
 * - Mapterhorn: 512 px Terrarium (WebP); national LiDAR where it exists
 *   (z13 and finer: 404 elsewhere, e.g. Morocco), Copernicus GLO-30 to
 *   z12 on land (no tile over the deep ocean finer than about z5); within
 *   0.5 m at 96-100 % of points on the spikes' eight sites, when drawn at
 *   about 6.5 m between vertices.
 *
 * URLs and attribution texts are the caller's (the Osm library's
 * `TERRARIUM_URL_TEMPLATE` / `MAPTERHORN_URL_TEMPLATE` and their
 * attributions: one home, DEC-H3); this module adds what the globe needs
 * to know about each source, and the credit lines of the sources BEHIND
 * one (Copernicus GLO-30 behind Mapterhorn), which have no other home.
 *
 * @see globe-relief-source.ts.md
 */
import {
  type ReliefCacheBudget,
  type ReliefDeviceClass,
  reliefCacheBudget,
} from "./globe-relief-cache.js";
import type { GlobeCredit } from "./globe-sources.js";

export const RELIEF_SOURCES = Object.freeze({
  awsTerrarium: Object.freeze({
    id: "aws-terrarium",
    maxZoom: 12,
    globalZoom: 12,
    tileDimension: 256,
    short: "Mapzen Terrain Tiles",
    href: "https://github.com/tilezen/joerd/blob/master/docs/attribution.md",
  }),
  mapterhorn: Object.freeze({
    id: "mapterhorn",
    maxZoom: 14,
    globalZoom: 12,
    tileDimension: 512,
    short: "Mapterhorn",
    href: "https://mapterhorn.com/attribution",
  }),
});

/**
 * The line of the source Mapterhorn draws from wherever no national model
 * exists (G1 review L1): Copernicus GLO-30, credited as its producers
 * word it in Mapterhorn's own attribution list
 * (download.mapterhorn.com/attribution.json, read 2026-10-18). The
 * national models (about 150) are listed on the page Mapterhorn's credit
 * links; which of them a view draws depends on where it is.
 */
const COPERNICUS_GLO30_CREDIT: GlobeCredit = Object.freeze({
  short: "Copernicus GLO-30",
  full: "Copernicus GLO-30: © DLR e.V. 2010-2014, Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA. All rights reserved.",
  href: "https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM",
});

/** The relief mesh: segments per tile edge (the library's `MESH_SIZE`). */
const RELIEF_MESH_SEGMENTS = 32;

/** The WGS84 equatorial radius (m): the Web Mercator tiling's. */
const EARTH_RADIUS_M = 6_378_137;

/** One relief source, as `reliefTerrainOptions` and the lab's readers use it. */
export interface GlobeReliefSource {
  readonly id: string;
  /** Terrarium-encoded tiles, `{z}`, `{x}` and `{y}`. */
  readonly url: string;
  /** The deepest zoom the relief loads from it. */
  readonly maxZoom: number;
  /**
   * The deepest zoom it covers the whole planet at: what a reader without
   * a fallback (the city, the landing's ground) reads.
   */
  readonly globalZoom: number;
  readonly tileDimension: number;
  readonly credit: GlobeCredit;
  /** The credit lines of the sources behind this one, shown with it. */
  readonly sourceCredits: readonly GlobeCredit[];
  /**
   * A tile this source answers 404 for is drawn from its nearest ancestor
   * in the same source, cropped and upsampled (`installReliefFallback`).
   */
  readonly ancestorFallback: boolean;
}

/** The caller's constants for a source: its URL and its attribution text. */
export interface ReliefSourceConstants {
  readonly url: string;
  readonly attribution: string;
}

/** True for a string carrying `{z}`, `{x}` and `{y}`. */
export const isTileTemplate = (url: unknown): url is string =>
  typeof url === "string" &&
  url.includes("{z}") &&
  url.includes("{x}") &&
  url.includes("{y}");

function checkConstants(c: ReliefSourceConstants, name: string): void {
  if (!isTileTemplate(c?.url)) {
    throw new RangeError(
      `${name} needs a {z}/{x}/{y} url template, got ${String(c?.url)}`,
    );
  }
  if (typeof c.attribution !== "string" || c.attribution.trim() === "") {
    throw new RangeError(`${name} needs its attribution text`);
  }
}

function describe(
  s: (typeof RELIEF_SOURCES)[keyof typeof RELIEF_SOURCES],
  c: ReliefSourceConstants,
  {
    sourceCredits,
    ancestorFallback,
  }: { sourceCredits: readonly GlobeCredit[]; ancestorFallback: boolean },
): GlobeReliefSource {
  return Object.freeze({
    id: s.id,
    url: c.url,
    maxZoom: s.maxZoom,
    globalZoom: s.globalZoom,
    tileDimension: s.tileDimension,
    credit: Object.freeze({
      short: s.short,
      full: c.attribution,
      href: s.href,
    }),
    sourceCredits: Object.freeze([...sourceCredits]),
    ancestorFallback,
  });
}

/** The AWS (Mapzen) Terrarium relief: the globe's default. */
export function awsTerrariumRelief(
  c: ReliefSourceConstants,
): GlobeReliefSource {
  checkConstants(c, "the AWS Terrarium relief");
  return describe(RELIEF_SOURCES.awsTerrarium, c, {
    sourceCredits: [],
    ancestorFallback: false,
  });
}

/**
 * The Mapterhorn relief, z14 where a national model exists; where it
 * answers 404 (z13 and finer outside national coverage, the deep ocean)
 * the tile is drawn from its nearest ancestor in Mapterhorn itself: one
 * pyramid, so no step between two sources (G1 review M2;
 * AWS at the same tile was +5 to +12 m off in towns, G0). Credited with
 * Copernicus GLO-30 beside its own line.
 */
export function mapterhornRelief(c: ReliefSourceConstants): GlobeReliefSource {
  checkConstants(c, "the Mapterhorn relief");
  return describe(RELIEF_SOURCES.mapterhorn, c, {
    sourceCredits: [COPERNICUS_GLO30_CREDIT],
    ancestorFallback: true,
  });
}

/** The credits a relief owes: its own, then the sources' behind it. */
export function reliefCredits(source: GlobeReliefSource): GlobeCredit[] {
  return [source.credit, ...source.sourceCredits];
}

/**
 * `createGlobeTerrain`'s options for a source on a `device`: its url,
 * zoom, tile size, fallback and the cache budget for its tile size
 * (`reliefCacheBudget`; G1 review M1: a 512 px source in the 256 px
 * budget stalls). RangeError for a missing or unknown device class.
 */
export function reliefTerrainOptions(
  source: GlobeReliefSource,
  device: ReliefDeviceClass,
): {
  url: string;
  maxZoom: number;
  tileDimension: number;
  ancestorFallback: boolean;
  device: ReliefDeviceClass;
  cache: ReliefCacheBudget;
} {
  return {
    url: source.url,
    maxZoom: source.maxZoom,
    tileDimension: source.tileDimension,
    ancestorFallback: source.ancestorFallback,
    device,
    cache: reliefCacheBudget(source.tileDimension, device),
  };
}

/**
 * Metres between the relief mesh's vertices at tree `level` and latitude
 * `lat` (radians): a Web Mercator tile's width there over the mesh's 32
 * segments. RangeError for a level that is not an integer >= 0 or a
 * latitude at or beyond a pole.
 */
export function vertexSpacingM(level: number, lat: number): number {
  if (!(Number.isInteger(level) && level >= 0)) {
    throw new RangeError(`a tree level is an integer >= 0, got ${level}`);
  }
  if (!(Number.isFinite(lat) && Math.abs(lat) < Math.PI / 2)) {
    throw new RangeError(`a latitude short of the poles, got ${lat}`);
  }
  return (
    (2 * Math.PI * EARTH_RADIUS_M * Math.cos(lat)) /
    2 ** level /
    RELIEF_MESH_SEGMENTS
  );
}

/**
 * The coarsest tree level whose vertices are at most `spacingM` apart at
 * latitude `lat` (radians): the `meshMaxLevel` that draws a source that
 * densely near the camera. RangeError for a spacing that is not finite
 * and > 0.
 */
export function meshLevelForSpacing(spacingM: number, lat: number): number {
  if (!(Number.isFinite(spacingM) && spacingM > 0)) {
    throw new RangeError(`a spacing is finite and > 0, got ${spacingM}`);
  }
  const level0 = vertexSpacingM(0, lat);
  let level = Math.max(0, Math.ceil(Math.log2(level0 / spacingM)));
  // Floating point at a power of two: settle on the exact boundary.
  while (level > 0 && vertexSpacingM(level - 1, lat) <= spacingM) level--;
  while (vertexSpacingM(level, lat) > spacingM) level++;
  return level;
}
