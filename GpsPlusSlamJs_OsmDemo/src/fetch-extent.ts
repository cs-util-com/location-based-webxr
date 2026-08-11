/**
 * How much ground one Overpass fetch actually covers.
 *
 * WHY THIS IS ITS OWN MODULE. "One res-7 tile" is the unit the whole plan is
 * written in, and it is an abstraction until someone sees it drawn over a city.
 * Two numbers make the picture legible, and neither is obvious:
 *
 * 1. **The query covers the tile's BOUNDING BOX, not the hexagon.**
 *    `buildTileQuery` takes `cellToBoundingBox(tile)`, because Overpass has no
 *    hexagon primitive. So the red box on the map is the honest answer to "what
 *    did we download", and it is strictly larger than the tile the index keys
 *    on.
 * 2. **The gap between them is redundant TRANSFER, not discarded data.**
 *    Nothing filters the response to the hexagon — `acceptTile` merges every
 *    feature and scoring bbox-tests against the CHUNK — so the corners are
 *    indexed and used. What the 1.39× costs is that neighbouring tiles' bboxes
 *    overlap, so shared ground is downloaded once per tile covering it.
 *
 * A res-7 fetch measures **~21 MB at a ~20 s median** (2026-08-01 matrix sweep,
 * `areal-only`). Seeing the box is worth it — it makes the unit the plan is
 * written in concrete — but it is still not an argument for a smaller
 * `FETCH_RES`, and the reason has CHANGED rather than merely being re-measured:
 *
 * - **The old reason (superseded).** Under the pre-F32 `nwr` form the payload
 *   barely tracked area — res 9 is 49x less ground and still returned 38.7 MB —
 *   so shrinking the tile bought almost nothing. That figure and the ~68 MB /
 *   ~23–110 s it sat beside are both retracted; they describe a query this app
 *   has not issued since 2026-08-03.
 * - **The current reason.** Areal-only restored proportionality (res 7 → res 9
 *   is 21x), so a smaller tile now WOULD be smaller. It is still the wrong move:
 *   `FETCH_RES` was raised 8 → 7 deliberately, to spend bytes on rarer requests,
 *   and that trade is about request count rather than payload.
 *
 * The arithmetic lives here rather than in `map-view.ts` so it can be tested
 * without a DOM — the view is Leaflet wiring and has no unit tests, which is the
 * same gap the `?lat=&lng=` guard and the click race both fell into.
 *
 * @see fetch-extent.ts.md
 */

import { cellArea, cellToBoundary } from "h3-js";

/** Metres per degree of latitude. Constant to well within this purpose. */
const METRES_PER_DEG_LAT = 111_320;

export interface Bounds {
  readonly south: number;
  readonly north: number;
  readonly west: number;
  readonly east: number;
}

/** The bounding box of an H3 cell — what Overpass is actually asked for. */
export function tileBounds(tile: string): Bounds {
  const boundary = cellToBoundary(tile);
  const lats = boundary.map(([lat]) => lat);
  const lngs = boundary.map(([, lng]) => lng);
  return {
    south: Math.min(...lats),
    north: Math.max(...lats),
    west: Math.min(...lngs),
    east: Math.max(...lngs),
  };
}

export interface ExtentSummary {
  /** Bounding-box width at its mid-latitude, km. */
  readonly widthKm: number;
  /** Bounding-box height, km. */
  readonly heightKm: number;
  /** Bounding-box area, km². */
  readonly boxAreaKm2: number;
  /** The hexagon's true area, km². */
  readonly hexAreaKm2: number;
  /** `boxAreaKm2 / hexAreaKm2` — how much more ground is fetched than indexed. */
  readonly overFetch: number;
}

/**
 * Measures one fetch tile.
 *
 * Equirectangular, with longitude scaled by the mid-latitude cosine. At a
 * ~2.8 km hexagon the error is far below anything this display is used for, and
 * the alternative — a geodesic area — would imply a precision the picture does
 * not have. The HEX area is exact regardless: it comes from H3 itself rather
 * than from this approximation.
 */
export function summariseExtent(tile: string): ExtentSummary {
  const bounds = tileBounds(tile);
  const midLat = (bounds.south + bounds.north) / 2;
  const heightKm = ((bounds.north - bounds.south) * METRES_PER_DEG_LAT) / 1000;
  const widthKm =
    ((bounds.east - bounds.west) *
      METRES_PER_DEG_LAT *
      Math.cos((midLat * Math.PI) / 180)) /
    1000;
  const boxAreaKm2 = widthKm * heightKm;
  const hexAreaKm2 = cellArea(tile, "km2");
  return {
    widthKm,
    heightKm,
    boxAreaKm2,
    hexAreaKm2,
    // Guard the degenerate case rather than emitting Infinity into a label: a
    // zero-area cell cannot happen for a valid index, but a NaN in the status
    // line would be blamed on the scoring rather than on this.
    overFetch: hexAreaKm2 > 0 ? boxAreaKm2 / hexAreaKm2 : 0,
  };
}

/**
 * The extent in words, for the status line.
 *
 * Says BOX explicitly. A bare "2.8 km" invites the reader to assume it is the
 * hexagon, which is the misreading this whole display exists to prevent.
 */
export function describeExtent(tiles: readonly string[]): string {
  if (tiles.length === 0) return "no tiles loaded";
  const summaries = tiles.map(summariseExtent);
  const boxArea = summaries.reduce((sum, s) => sum + s.boxAreaKm2, 0);
  const first = summaries[0];
  if (first === undefined) return "no tiles loaded";
  const each =
    `${round(first.widthKm)} x ${round(first.heightKm)} km box per tile ` +
    `(${round(first.overFetch, 2)}x the hexagon it indexes)`;
  return tiles.length === 1
    ? `fetched ${round(boxArea)} km²: ${each}`
    : `fetched ${round(boxArea)} km² across ${tiles.length} tiles: ${each}`;
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
