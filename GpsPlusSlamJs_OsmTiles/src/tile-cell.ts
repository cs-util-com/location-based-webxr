/**
 * The one client input that becomes a storage key and an Overpass query:
 * the H3 cell in the URL, validated before anything is built from it.
 *
 * @see tile-cell.ts.md
 */

import { getResolution, isValidCell } from "h3-js";
import { OVERPASS_SCHEMA_VERSION } from "gps-plus-slam-osm/source/overpass-query";

/** The fetch resolution every client asks for (res 7, the library's). */
export const TILE_RESOLUTION = 7;

/** Lower-case hex, exactly the 15 characters of an H3 cell index. */
const CANONICAL_CELL = /^[0-9a-f]{15}$/;

/**
 * The cell, when `raw` is a canonical (lower-case) valid H3 cell at the
 * fetch resolution; otherwise undefined. Upper case is refused rather than
 * folded, so one tile can never be stored under two keys.
 */
export function parseTileCell(raw: string): string | undefined {
  if (!CANONICAL_CELL.test(raw)) return undefined;
  if (!isValidCell(raw)) return undefined;
  if (getResolution(raw) !== TILE_RESOLUTION) return undefined;
  return raw;
}

/** The query schema the stored tiles and every host path are versioned by. */
export const TILE_SCHEMA_VERSION = OVERPASS_SCHEMA_VERSION;

/** The path segment and R2 key prefix of this schema's tiles. */
export const TILE_PREFIX = `osm/v${TILE_SCHEMA_VERSION}/`;

/** The path prefix of this schema's fill requests. */
export const FILL_PREFIX = `fill/v${TILE_SCHEMA_VERSION}/`;

/** The path prefix of this schema's bad-tile reports. */
export const REPORT_PREFIX = `report/v${TILE_SCHEMA_VERSION}/`;

/** R2 key (and URL path without the leading slash) of a validated cell. */
export function tileObjectKey(cell: string): string {
  return `${TILE_PREFIX}${cell}.json.gz`;
}
