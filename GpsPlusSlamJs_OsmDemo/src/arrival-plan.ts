/**
 * What OsmDemo loads when it opens at a position with its default settings:
 * the plan the globe's arrival prefetch warms (round-5 plan 2026-10-01-0945
 * §3.6, DEC-GL5-8). Pure; no network.
 *
 * Three things, each derived from the module OsmDemo itself uses, so the
 * plan cannot drift from the app without a test noticing
 * (`arrival-plan.test.ts` runs OsmDemo's real machinery beside it):
 * - **the position** OsmDemo reads from the hand-over URL: five decimals, as
 *   the globe's `handOverUrl` writes them (the chunk is computed from that,
 *   not from the unrounded target);
 * - **the Overpass tiles** of every scored ring: `fetchTilesForScoreWorkingSet`
 *   of the position's res-11 chunk, over `PROGRESSIVE_RADII`, as the refresh
 *   cycle runs them (1-3 res-7 tiles, about 21 MB each when cold);
 * - **the DEM tile URLs** a fresh terrain field requests for the window
 *   `main.ts` loads at arrival (`TERRAIN_EXTENT_M` through `terrainWindowFor`
 *   and `latticeWindow`), for both arms of the DEM race (Mapterhorn and AWS),
 *   whose cache key is the URL.
 *
 * @see arrival-plan.ts.md
 */

import {
  DEFAULT_TERRARIUM_ZOOM,
  PROGRESSIVE_RADII,
  SCORE_CHUNK_RES,
  fetchTilesForScoreWorkingSet,
  fromWorldPixel,
  toTilePixel,
  type LatLng,
} from "gps-plus-slam-osm";
import { latLngToCell } from "h3-js";

import { DEM_URL_TEMPLATES } from "./dem-provider.js";
import { TERRAIN_EXTENT_M } from "./heightfield.js";
import { latticeWindow } from "./terrain-field.js";
import { terrainWindowFor } from "./terrain-window.js";

/** The decimals the hand-over URL carries (`globe-handover.ts`, `url-state.ts`). */
const HANDOVER_DECIMALS = 5;

export interface ArrivalPlan {
  /** The position OsmDemo will open at, as it parses it from the URL. */
  readonly position: LatLng;
  /** The res-7 Overpass tiles of every ring, each once. */
  readonly overpassTiles: readonly string[];
  /** Every DEM tile URL of the arrival window, both sources, each once. */
  readonly demUrls: readonly string[];
}

/** Rounded and parsed back exactly as the hand-over URL carries it. */
function asHandedOver(value: number): number {
  return Number((value + 0).toFixed(HANDOVER_DECIMALS));
}

/**
 * The tile indices one axis of the lattice window touches, by the same
 * round trip the provider makes (`fromWorldPixel`, then `toTilePixel`). The
 * axes are separable: longitude depends only on x, latitude only on y.
 */
function tilesAlong(
  axis: "x" | "y",
  from: number,
  to: number,
  other: number,
  zoom: number,
): number[] {
  const tiles = new Set<number>();
  for (let v = from; v <= to; v++) {
    const pixel = axis === "x" ? { x: v, y: other } : { x: other, y: v };
    tiles.add(toTilePixel(fromWorldPixel(pixel, zoom), zoom)[axis]);
  }
  return [...tiles].sort((a, b) => a - b);
}

function demUrlsFor(position: LatLng): string[] {
  const zoom = DEFAULT_TERRARIUM_ZOOM;
  const window = terrainWindowFor({
    frameOrigin: position,
    centre: position,
    extentM: TERRAIN_EXTENT_M,
  });
  const { origin, reach } = latticeWindow(
    window.fetchCentre,
    window.fetchRadiusM,
    zoom,
  );
  const xs = tilesAlong(
    "x",
    origin.x - reach,
    origin.x + reach,
    origin.y,
    zoom,
  );
  const ys = tilesAlong(
    "y",
    origin.y - reach,
    origin.y + reach,
    origin.x,
    zoom,
  );
  const urls: string[] = [];
  for (const template of [
    DEM_URL_TEMPLATES.preferred,
    DEM_URL_TEMPLATES.fast,
  ]) {
    for (const x of xs) {
      for (const y of ys) {
        urls.push(
          template
            .replace("{z}", String(zoom))
            .replace("{x}", String(x))
            .replace("{y}", String(y)),
        );
      }
    }
  }
  return urls;
}

/**
 * The arrival plan for a target.
 *
 * RangeError for a target that is not a finite latitude in [-90, 90] and
 * longitude in [-180, 180].
 */
export function arrivalPlanFor(target: LatLng): ArrivalPlan {
  const { lat, lng } = target;
  if (
    !(Number.isFinite(lat) && Number.isFinite(lng)) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  ) {
    throw new RangeError(
      `arrivalPlanFor: target must be a latitude and longitude, got ${lat}, ${lng}`,
    );
  }
  const position = { lat: asHandedOver(lat), lng: asHandedOver(lng) };
  const chunk = latLngToCell(position.lat, position.lng, SCORE_CHUNK_RES);
  const overpassTiles = new Set<string>();
  for (const radius of PROGRESSIVE_RADII) {
    for (const tile of fetchTilesForScoreWorkingSet(chunk, radius)) {
      overpassTiles.add(tile);
    }
  }
  return {
    position,
    overpassTiles: [...overpassTiles],
    demUrls: demUrlsFor(position),
  };
}
