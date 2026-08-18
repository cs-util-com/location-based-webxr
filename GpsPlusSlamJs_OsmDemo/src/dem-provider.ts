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

/**
 * How long Mapterhorn gets before a tile degrades to "no data", ms.
 *
 * MEASURED, NOT CHOSEN BY FEEL (2026-08-19 session, §1 of the feedback doc).
 * On one home connection the four z13 tiles a terrain window needs took
 * **21.7 s** from Mapterhorn and **1.04 s** from AWS, and single tiles were
 * 4.5–7.5 s against 0.8–1.2 s. Crucially the slow responses carried
 * `cf-cache-status: HIT`, so this is delivery throughput rather than a cold
 * origin that would warm up.
 *
 * 3 s sits above AWS's whole four-tile budget with margin, and far below the
 * consumer's 15 s terrain gate — so a Mapterhorn tile that is merely having a
 * bad moment still wins, while one that is behaving as measured gets out of the
 * way in time for the fallback to serve and the gate never fires.
 *
 * **The cost of being wrong is asymmetric, which is why the number leans
 * short.** Too short only means coarser heights for that window, and the
 * upgrade path (planned as M3) reclaims them. Too long means the flat-ground
 * failure this constant exists to remove.
 */
export const PRIMARY_DEM_TIMEOUT_MS = 3_000;

/**
 * The same bound for the fallback, ms — larger, and NOT optional.
 *
 * The plan said "primary-only", and shipping it that way would have left the
 * identical hang open one provider to the right: AWS has no documented rate
 * limit and measured fast, but "measured fast today" is what was said about the
 * primary too, and a fallback that never answers hangs the batch exactly as a
 * primary that never answers did. A deadline whose whole point is that no
 * single source can stall the composition has to cover every source in it.
 *
 * Longer than the primary's because the roles differ: there is nothing behind
 * the fallback, so its deadline is a last resort against a hang rather than a
 * switch to something better. It is still comfortably inside the 15 s gate.
 */
export const FALLBACK_DEM_TIMEOUT_MS = 8_000;

export interface DemProviderOptions {
  /** Where tile bytes persist — the same blob store the OSM tiles use. */
  readonly store: OsmBlobStore;
  /** `browserPngDecoder()` in the worker; a synthetic decoder in tests. */
  readonly decodePng: PngDecoder;
  /** The network. Defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
  /** Overrides {@link PRIMARY_DEM_TIMEOUT_MS}. Tests use a few ms. */
  readonly primaryTimeoutMs?: number;
  /** Overrides {@link FALLBACK_DEM_TIMEOUT_MS}. Tests use a few ms. */
  readonly fallbackTimeoutMs?: number;
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
    new TerrariumProvider({
      ...shared,
      urlTemplate: MAPTERHORN_URL_TEMPLATE,
      requestTimeoutMs: options.primaryTimeoutMs ?? PRIMARY_DEM_TIMEOUT_MS,
    }),
    new TerrariumProvider({
      ...shared,
      requestTimeoutMs: options.fallbackTimeoutMs ?? FALLBACK_DEM_TIMEOUT_MS,
    }),
    { sourceId: DEM_SOURCE_ID },
  );
}
