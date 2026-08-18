/**
 * The demo's DEM composition: Mapterhorn primary, AWS Terrarium fallback,
 * one caching fetch shared by both.
 *
 * WHY A FACTORY RATHER THAN INLINE WIRING IN THE WORKER. The worker's `init`
 * needs `navigator.storage` and `OffscreenCanvas`, so nothing constructed
 * there can be exercised by a unit test — and the one thing worth pinning
 * about this composition IS its construction: which source is asked first,
 * that the fallback fills only the primary's gaps, and that both share one
 * persistent tile cache. Extracting the wiring behind injected seams (`store`,
 * `decodePng`, `fetchImpl`) makes exactly that testable; the worker supplies
 * the browser-only pieces.
 *
 * WHY FALLBACK, NOT CONSENSUS. Mapterhorn is national LiDAR (with Copernicus
 * GLO-30 where none exists) against the AWS tiles' ~30 m SRTM/NED posting — a
 * strictly better source wherever it has data. `fallbackProvider`'s own header
 * carries the argument: a two-source median degenerates to their average and
 * throws the resolution advantage away, so precedence is the right shape here.
 *
 * WHY ONE `createCachingTileFetch` FOR BOTH. The cache keys are full request
 * URLs, so the two sources cannot collide — and one wrapper means one stats
 * object and one store namespace to reason about. The store itself is the same
 * OPFS-backed blob store the OSM tiles persist through: its keys are escaped
 * flat filenames, so `https://…` keys coexist with `osm/v2/…` keys the same
 * way `rules/v1/…` already does.
 *
 * @see dem-provider.ts.md
 */

import {
  MAPTERHORN_ATTRIBUTION,
  MAPTERHORN_URL_TEMPLATE,
  TERRARIUM_ATTRIBUTION,
  TerrariumProvider,
  createCachingTileFetch,
  fallbackProvider,
  type FallbackElevationProvider,
  type OsmBlobStore,
  type PngDecoder,
} from "gps-plus-slam-osm";

/**
 * What the AR readout shows beside the terrain height.
 *
 * COMPOSED, NOT PER-SAMPLE: the `ElevationProvider` seam returns heights with
 * no per-position provenance, so which of the two sources answered a given
 * post is not observable here. What IS observable is the aggregate — the
 * returned provider's `stats` counts positions per source, which is how the
 * HUD reports the primary's share. See the sidecar before inventing
 * per-sample tracking.
 */
export const DEM_SOURCE_ID = "mapterhorn+terrarium";

/**
 * The credit the map view must display while terrain is on screen.
 *
 * BOTH sources, unconditionally: the fallback can serve any tile the primary
 * lacks, and attribution keyed to "which source actually answered this
 * session" would be a claim nothing here can verify (see `DEM_SOURCE_ID`).
 * A constant rather than the composed provider's own `attribution` field,
 * because `TerrariumProvider` hardcodes the AWS credit whatever `urlTemplate`
 * it is given — the sidecar files that gap as library follow-up.
 */
export const DEM_ATTRIBUTION = `${MAPTERHORN_ATTRIBUTION} · ${TERRARIUM_ATTRIBUTION}`;

export interface DemProviderOptions {
  /** Where tile bytes persist — the same blob store the OSM tiles use. */
  readonly store: OsmBlobStore;
  /** `browserPngDecoder()` in the worker; a synthetic decoder in tests. */
  readonly decodePng: PngDecoder;
  /** The network. Defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

/**
 * Builds the composed provider the terrain field samples through.
 *
 * The primary's answers survive untouched; the fallback is consulted only for
 * positions the primary returned `undefined` — including every tile outside
 * Mapterhorn's coverage, which its server reports as a 404 the provider
 * degrades to `undefined` per position.
 *
 * The returned provider carries `fallbackProvider`'s `stats` surface —
 * positions served per source, accumulated for the provider's life. The
 * worker snapshots it into every `TerrainResult` so the HUD can say which
 * DEM actually served, not just which composition was asked.
 */
export function createDemProvider(
  options: DemProviderOptions,
): FallbackElevationProvider {
  const tileFetch = createCachingTileFetch({
    store: options.store,
    ...(options.fetchImpl === undefined
      ? {}
      : { fetchImpl: options.fetchImpl }),
  });
  const shared = { decodePng: options.decodePng, fetchImpl: tileFetch };
  return fallbackProvider(
    new TerrariumProvider({ ...shared, urlTemplate: MAPTERHORN_URL_TEMPLATE }),
    new TerrariumProvider(shared),
    { sourceId: DEM_SOURCE_ID },
  );
}
