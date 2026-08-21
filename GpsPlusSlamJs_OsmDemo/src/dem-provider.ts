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
  racingProvider,
  type LatLng,
  type OsmBlobStore,
  type PngDecoder,
  type RacingElevationProvider,
} from "gps-plus-slam-osm";

import type { AttributionEntry } from "./attribution-view.js";

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
 * The two ends of the race, as `RacingProviderStats.servedBy` reports them.
 *
 * NAMED EXPLICITLY because both ends are `TerrariumProvider` instances that
 * differ only by `urlTemplate`. Both reported `sourceId: "terrarium"` until
 * 2026-08-19, which made `servedBy` unable to distinguish them — i.e. unable to
 * say the one thing it exists to say.
 */
export const PREFERRED_DEM_SOURCE_ID = "mapterhorn";
/**
 * @see PREFERRED_DEM_SOURCE_ID
 *
 * NOT "terrarium": both sources serve Terrarium-ENCODED tiles, so that name
 * describes the format and says nothing about which service answered — on a
 * readout whose entire purpose is naming the service.
 */
export const FAST_DEM_SOURCE_ID = "aws-open-data";

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
export const DEM_ATTRIBUTION_ENTRIES: readonly AttributionEntry[] = [
  { short: "Mapterhorn", full: MAPTERHORN_ATTRIBUTION },
  { short: "Mapzen/AWS", full: TERRARIUM_ATTRIBUTION },
];

/**
 * Bound on ONE Mapterhorn tile request, ms — an anti-hang guard, nothing more.
 *
 * RAISED FROM 3 s TO 30 s WHEN THE RACE LANDED, because the deadline's JOB
 * changed rather than because the old number was wrong.
 *
 * Under `fallbackProvider` this was the only thing that made the fallback
 * reachable at all: the fallback is consulted only for positions the primary
 * returned `undefined` for, so a merely SLOW primary left no gap and the
 * composition waited for it however long it took. 3 s cut that short and
 * fixed the reported 15 s stall.
 *
 * It also made the primary unwinnable. Measured 2026-08-19 from one machine,
 * every Mapterhorn tile took 3.0-21.7 s — so a 3 s cut-off meant the
 * LiDAR-derived heights were never served, and the stall was traded for a
 * permanent loss of the better data.
 *
 * Under the race nothing waits for this. AWS publishes in ~1 s and Mapterhorn
 * is applied whenever it arrives, so the only thing left to prevent is a
 * request that never settles holding an upgrade slot open for the life of the
 * page. 30 s clears the measured worst case with room.
 *
 * **It is NOT what keeps the terrain gate from firing** — see
 * {@link PUBLISH_DEADLINE_MS}, which is. An earlier version of this file said
 * the fast source's deadline alone did that, which was false: a fast source
 * answering "no coverage" leaves the batch waiting on THIS deadline.
 */
export const PRIMARY_DEM_TIMEOUT_MS = 30_000;

/**
 * The same bound for the fast source, ms — NOT optional.
 *
 * "Larger" until 2026-08-19, and it is not any more: the preferred source's
 * bound went from 3 s to 30 s with the race, so this 8 s is now the SMALLER of
 * the two. The asymmetry survived, inverted — see {@link PRIMARY_DEM_TIMEOUT_MS}
 * — because the roles inverted with it: this one bounds a request the user is
 * waiting on, that one bounds a request nobody is.
 *
 * The plan said "primary-only", and shipping it that way would have left the
 * identical hang open one provider to the right: AWS has no documented rate
 * limit and measured fast, but "measured fast today" is what was said about the
 * primary too, and a fallback that never answers hangs the batch exactly as a
 * primary that never answers did. A deadline whose whole point is that no
 * single source can stall the composition has to cover every source in it.
 *
 * SHORTER than the primary's, and the reason is the roles, not the numbers: a
 * user is waiting on this request, so its deadline is a promise about how long
 * the screen can stay empty; nobody is waiting on the primary's, so that one is
 * only a last resort against a hang. It is comfortably inside the 15 s gate.
 *
 * (This paragraph said "Longer than the primary's" until 2026-08-20 — a
 * pre-race sentence that survived the edit which inverted the two bounds, and
 * so contradicted the correction eighteen lines above it. Found in review of
 * PR #330.)
 */
export const FALLBACK_DEM_TIMEOUT_MS = 8_000;

/**
 * Hard bound on how long the composed provider may take to PUBLISH, ms.
 *
 * THE ONE THAT KEEPS THE TERRAIN GATE FROM FIRING, and it did not exist in
 * the first version of the race. The per-source deadlines do not bound the
 * composition: `racingProvider` waits for a usable answer from EITHER arm and
 * gives up only when BOTH are spent, so a fast source that answers "no
 * coverage" at 8 s leaves the batch waiting on the preferred arm until ITS
 * 30 s deadline. Against a 15 s gate that re-creates the reported bug — the
 * gate fires, the mesh is built flat, and there is no elevation.
 *
 * 12 s: above the fallback's own 8 s so a slow-but-answering AWS is not cut
 * off, and below `TERRAIN_WAIT_TIMEOUT_MS` with enough margin for the OPFS
 * reads, four WebP decodes and the geoid pass that all sit outside these
 * budgets. Asserted against the gate's value in `dem-provider.test.ts`, so
 * raising either has to confront the other.
 *
 * Expiring publishes an absence and **keeps the upgrade**: the preferred
 * source's late answer arrives as an upgrade instead of as the first answer,
 * rather than being discarded.
 */
export const PUBLISH_DEADLINE_MS = 12_000;

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
  /** Overrides {@link PUBLISH_DEADLINE_MS}. Tests use a few ms. */
  readonly publishTimeoutMs?: number;
  /**
   * Called when Mapterhorn's heights land after AWS's were already published.
   *
   * **Late binding is expected and is why this is a callback rather than a
   * return value.** The worker builds this provider during `init`, BEFORE the
   * terrain field that consumes the upgrade exists, so the natural wiring is a
   * closure over a `let` assigned immediately afterwards.
   */
  readonly onUpgrade?: (
    positions: readonly LatLng[],
    heights: readonly (number | undefined)[],
  ) => void;
}

/**
 * Builds the composed provider the terrain field samples through.
 *
 * BOTH SOURCES ARE ASKED AT ONCE and whichever answers first is published;
 * when Mapterhorn lands afterwards its heights replace AWS's in place. This
 * replaced `fallbackProvider`, under which the fallback was consulted only for
 * positions the primary left `undefined` — so a merely slow primary produced no
 * gap and the fallback was unreachable rather than broken, which is what made
 * the demo wait 15 s and then show no elevation at all.
 *
 * The returned provider carries `racingProvider`'s `stats` surface, whose
 * `servedBy` names the source the CURRENT field came from. It is deliberately
 * not the old primary-vs-fallback ratio: that partition only meant something
 * because `fallbackProvider` guaranteed the two sources answered disjoint
 * positions, and a race makes both answer every position.
 */
export function createDemProvider(
  options: DemProviderOptions,
): RacingElevationProvider {
  const tileFetch = createCachingTileFetch({
    store: options.store,
    ...(options.fetchImpl === undefined
      ? {}
      : { fetchImpl: options.fetchImpl }),
  });
  const shared = { decodePng: options.decodePng, fetchImpl: tileFetch };
  return racingProvider(
    new TerrariumProvider({
      ...shared,
      urlTemplate: MAPTERHORN_URL_TEMPLATE,
      requestTimeoutMs: options.primaryTimeoutMs ?? PRIMARY_DEM_TIMEOUT_MS,
      sourceId: PREFERRED_DEM_SOURCE_ID,
    }),
    new TerrariumProvider({
      ...shared,
      requestTimeoutMs: options.fallbackTimeoutMs ?? FALLBACK_DEM_TIMEOUT_MS,
      sourceId: FAST_DEM_SOURCE_ID,
    }),
    {
      sourceId: DEM_SOURCE_ID,
      publishTimeoutMs: options.publishTimeoutMs ?? PUBLISH_DEADLINE_MS,
      ...(options.onUpgrade === undefined
        ? {}
        : { onUpgrade: options.onUpgrade }),
    },
  );
}
