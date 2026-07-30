/**
 * H3 Geo-Anchor Proximity Matching
 *
 * Generic utility for matching GPS positions to known geo-anchored points
 * using H3 hexagonal grid indices. Uses gridDisk(cell, 1) to create a ~65m
 * safe zone that absorbs GPS jitter of 3-10m.
 *
 * Renamed from `ref-points/h3-ref-point.ts` in Iter 4 to drop recorder-only
 * naming. The math is unchanged; only the public type/function names were
 * generalised so the framework can serve any geo-anchored consumer.
 *
 * @see gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-03-08-ref-point-naming-investigation.md §6
 */

import {
  latLngToCell,
  gridDisk,
  cellToParent,
  isValidCell,
  getResolution,
} from 'h3-js';

/** H3 resolution 11: ~25m edge, ~65m gridDisk safe zone */
export const H3_RESOLUTION = 11;

/**
 * A known geo-anchored point with its H3 cell index and GPS coordinates,
 * used for proximity matching. GPS coordinates are needed to rank
 * multiple candidates by distance when their gridDisk zones overlap.
 */
export interface KnownGeoAnchor {
  readonly h3Index: string;
  readonly displayName?: string;
  readonly lat: number;
  readonly lon: number;
}

/**
 * Compute the H3 resolution-11 index for a GPS position.
 */
export function gpsToH3(lat: number, lng: number): string {
  return latLngToCell(lat, lng, H3_RESOLUTION);
}

/** Minimal GPS coordinate shape (Leaflet convention: `lng`, not `lon`). */
interface LatLngLike {
  readonly lat: number;
  readonly lng: number;
}

/**
 * Reduce a recorded GPS path to the deduplicated set of res-11 H3 cells it
 * crossed — the per-tour "coverage index" stored in `SessionMetadata.h3Cells`.
 *
 * Cells are returned in first-seen (chronological) order and deduplicated, so a
 * tour that dwells in one ~25 m cell contributes a single cell. This keeps the
 * stored index small (see the metadata-size risk in the map-browser feedback
 * doc, §7). Non-finite coordinates are skipped defensively — bad sensor data
 * must not poison the index or throw inside `latLngToCell`.
 */
export function gpsPathToCoverageCells(path: readonly LatLngLike[]): string[] {
  const seen = new Set<string>();
  const cells: string[] = [];
  for (const p of path) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) {
      continue;
    }
    const cell = gpsToH3(p.lat, p.lng);
    if (!seen.has(cell)) {
      seen.add(cell);
      cells.push(cell);
    }
  }
  return cells;
}

/**
 * Coarsen res-11 coverage cells to a target resolution for map zoom-clustering.
 *
 * Uses h3-js `cellToParent` — the ONLY correct way to coarsen an H3 cell. NEVER
 * truncate the hex-string id: resolution is encoded in the high bits with
 * trailing `f` padding, so slicing yields INVALID cells, not parents (verified;
 * see the D1 gotcha in
 * docs/2026-06-14-1048-map-centric-recording-browser-and-h3-index-user-feedback.md).
 *
 * `targetRes` is clamped to `[0, H3_RESOLUTION]` because `cellToParent` throws
 * when asked for a FINER resolution than the cell, and res 11 is the finest
 * data stored — so the highest map zooms render the stored cells unclustered
 * (`cellToParent(cell, 11) === cell`). A non-finite `targetRes` (e.g. a bad
 * zoom→res mapping) degrades to unclustered output rather than throwing.
 * Invalid input cells (corrupt/legacy metadata) are skipped defensively, as are
 * valid cells coarser than `res` (which have no parent at the finer target res
 * and would otherwise throw "incompatible resolutions").
 *
 * Output is deduplicated in first-seen order: sibling cells under one parent
 * collapse to a single tile.
 */
export function clusterCellsByZoom(
  cells: readonly string[],
  targetRes: number
): string[] {
  const res = Number.isFinite(targetRes)
    ? Math.max(0, Math.min(H3_RESOLUTION, Math.floor(targetRes)))
    : H3_RESOLUTION;
  const seen = new Set<string>();
  const parents: string[] = [];
  for (const cell of cells) {
    if (!isValidCell(cell)) {
      continue;
    }
    // A valid cell coarser than `res` (e.g. legacy/future metadata storing
    // non-res-11 cells) has no parent at the finer `res`; cellToParent would
    // throw ("incompatible resolutions"). isValidCell does not catch this, so
    // skip such cells defensively rather than crash the view render.
    if (getResolution(cell) < res) {
      continue;
    }
    const parent = cellToParent(cell, res);
    if (!seen.has(parent)) {
      seen.add(parent);
      parents.push(parent);
    }
  }
  return parents;
}

/**
 * Approximate distance in metres using equirectangular projection.
 * Accurate to < 0.1% for distances under 1 km at mid-latitudes,
 * which is sufficient for ranking ref point candidates within a
 * gridDisk safe zone (~65–130 m).
 */
export function approxDistanceMetres(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  // Normalise longitude delta to (-180, 180] so points straddling the ±180°
  // antimeridian (or lon values offset by whole turns) yield the short-way
  // distance instead of a spurious ~40,000 km wrap.
  let dLonDeg = lon2 - lon1;
  dLonDeg -= 360 * Math.floor((dLonDeg + 180) / 360);
  const dLon = (dLonDeg * Math.PI) / 180;
  const cosLat = Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
  const x = dLon * cosLat;
  return R * Math.sqrt(dLat * dLat + x * x);
}

/**
 * Find the known geo-anchor closest to the given GPS position,
 * provided it falls within the gridDisk safe zone.
 *
 * The safe zone is the center cell plus its 6 neighbors (~65m radius),
 * which absorbs GPS jitter of 3-10m while keeping anchors >130m apart
 * distinguishable.
 *
 * When multiple anchors have overlapping safe zones (65–130 m apart),
 * the closest one by equirectangular distance is returned.
 */
export function findNearbyGeoAnchor(
  lat: number,
  lng: number,
  knownAnchors: readonly KnownGeoAnchor[]
): KnownGeoAnchor | undefined {
  if (knownAnchors.length === 0) {
    return undefined;
  }
  const currentCell = latLngToCell(lat, lng, H3_RESOLUTION);
  const safeZone = gridDisk(currentCell, 1);

  const candidates = knownAnchors.filter((rp) => safeZone.includes(rp.h3Index));

  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];

  // Multiple matches — return the closest by approximate distance
  return candidates.reduce((closest, rp) => {
    const distRp = approxDistanceMetres(lat, lng, rp.lat, rp.lon);
    const distClosest = approxDistanceMetres(
      lat,
      lng,
      closest.lat,
      closest.lon
    );
    return distRp < distClosest ? rp : closest;
  });
}

/**
 * Check whether two H3 indices refer to the same physical location
 * (i.e., one falls within the other's gridDisk safe zone).
 * This is the canonical cross-session matching check.
 */
export function h3CellsMatch(h3a: string, h3b: string): boolean {
  if (h3a === h3b) {
    return true;
  }
  const diskA = gridDisk(h3a, 1);
  return diskA.includes(h3b);
}

/** H3 resolution-11 indices are 15-character lowercase hex strings. */
const H3_INDEX_PATTERN = /^[0-9a-f]{15}$/;

/**
 * Check whether a string looks like a valid H3 resolution-11 index.
 * Used to distinguish H3 IDs from legacy user-typed string IDs.
 */
export function isH3Index(id: string): boolean {
  return H3_INDEX_PATTERN.test(id);
}
