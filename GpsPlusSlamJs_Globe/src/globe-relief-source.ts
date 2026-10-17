/**
 * The relief's height sources (tour editor plan 2026-10-17-1816 §13, G1
 * step 2; G0 spikes Q1): what each source is (its tile size, its deepest
 * zoom, the zoom it covers the whole planet at, its credit), the fallback
 * that keeps Mapterhorn usable where its fine zooms do not exist, and the
 * arithmetic from a vertex spacing to the relief tree's level.
 *
 * - AWS Terrarium (Mapzen terrain tiles): 256 px, the globe's z12; biased
 *   +5 to +11 m in towns at z12 and z14 alike.
 * - Mapterhorn: 512 px Terrarium (WebP); national LiDAR where it exists
 *   (z13 and finer: 404 elsewhere, e.g. Morocco), Copernicus GLO-30 to
 *   z12 everywhere; within 0.5 m at 96-100 % of points on the spikes'
 *   eight sites, when drawn at about 6.5 m between vertices.
 *
 * URLs and attribution texts are the caller's (the Osm library's
 * `TERRARIUM_URL_TEMPLATE` / `MAPTERHORN_URL_TEMPLATE` and their
 * attributions: one home, DEC-H3); this module adds what the globe needs
 * to know about each source.
 *
 * @see globe-relief-source.ts.md
 */
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

/** The relief mesh: segments per tile edge (the library's `MESH_SIZE`). */
export const RELIEF_MESH_SEGMENTS = 32;

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
  /**
   * Asked at the same tile where this source answers 404, its heights
   * resampled to this source's tile size; null for none.
   */
  readonly fallback: GlobeReliefSource | null;
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
  fallback: GlobeReliefSource | null,
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
    fallback,
  });
}

/** The AWS (Mapzen) Terrarium relief: the globe's default. */
export function awsTerrariumRelief(
  c: ReliefSourceConstants,
): GlobeReliefSource {
  checkConstants(c, "the AWS Terrarium relief");
  return describe(RELIEF_SOURCES.awsTerrarium, c, null);
}

/**
 * The Mapterhorn relief, z14 where a national model exists; `fallback`
 * (the AWS relief, or null to keep the parent tile) where it answers 404.
 * RangeError for a fallback that has a fallback of its own.
 */
export function mapterhornRelief(
  c: ReliefSourceConstants,
  fallback: GlobeReliefSource | null,
): GlobeReliefSource {
  checkConstants(c, "the Mapterhorn relief");
  if (fallback !== null && fallback.fallback !== null) {
    throw new RangeError(
      "a fallback source must not have a fallback of its own",
    );
  }
  return describe(RELIEF_SOURCES.mapterhorn, c, fallback);
}

/** The credits a relief owes: its own, then its fallback's (it may draw). */
export function reliefCredits(source: GlobeReliefSource): GlobeCredit[] {
  return source.fallback
    ? [source.credit, source.fallback.credit]
    : [source.credit];
}

/** `createGlobeTerrain`'s options for a source. */
export function reliefTerrainOptions(source: GlobeReliefSource): {
  url: string;
  maxZoom: number;
  tileDimension: number;
  fallbackUrl: string | undefined;
} {
  return {
    url: source.url,
    maxZoom: source.maxZoom,
    tileDimension: source.tileDimension,
    fallbackUrl: source.fallback?.url,
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
