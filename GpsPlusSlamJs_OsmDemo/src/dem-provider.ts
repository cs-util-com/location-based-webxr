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
/** @see PREFERRED_DEM_SOURCE_ID */
export const FAST_DEM_SOURCE_ID = "terrarium";

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
 * 3 s sits above AWS's whole four-tile budget with margin and far below the
 * consumer's 15 s terrain gate, so the fallback always has room to serve and
 * the gate never fires. That is what this number is chosen for.
 *
 * **BE HONEST ABOUT WHAT IT COSTS ON THE MEASURED CONNECTION, because an
 * earlier version of this comment was not.** It claimed "a Mapterhorn tile that
 * is merely having a bad moment still wins" — but every single measured
 * Mapterhorn tile above is over 3 s. On that link the primary does not
 * occasionally lose, it always loses: the session pays 3 s of dead time and
 * ~0.5–0.75 MB of abandoned download per new window, and then renders AWS's
 * coarser heights. Nothing negatively caches the timeout either — a tile that
 * times out is never stored and never remembered as slow — so that cost repeats
 * for every new window until `DEC-T8`'s adaptive behaviour exists.
 *
 * **Why 3 s is still right, given that.** The constant has to behave on links
 * this repo has never measured, not only on the one it was derived from. Where
 * Mapterhorn is healthy it wins and the LiDAR heights are kept; where it is as
 * slow as measured, a coarse answer in ~4 s beats an accurate one at 15 s or
 * never — which is precisely the complaint that started this work. Raising it
 * to let the measured link win would buy accuracy by reinstating the wait.
 *
 * **The real fix for the trade is the race (DEC-T2 / M3), not a better
 * constant**, because the race stops making it a choice: AWS answers
 * immediately and Mapterhorn upgrades the field when it lands. Until then the
 * asymmetry argument for leaning short holds, with one correction to its old
 * wording — see `dem-provider.ts.md` on the partial-window hazard, which is why
 * "too short only means coarser heights" is not unconditionally true.
 */
export const PRIMARY_DEM_TIMEOUT_MS = 30_000;

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

/**
 * RAISED FROM 3 s TO 30 s WHEN THE RACE LANDED, and the reason is that the
 * deadline's JOB changed rather than that the old number was wrong.
 *
 * Under `fallbackProvider` the primary's deadline was the only thing that made
 * the fallback reachable at all: the fallback is consulted only for positions
 * the primary returned `undefined` for, so a merely SLOW primary left no gap
 * and the composition waited for it however long it took. 3 s was chosen to cut
 * that short, and it fixed the 15 s stall.
 *
 * It also made the primary unwinnable. Measured 2026-08-19 from one machine,
 * every Mapterhorn tile took 3.0–21.7 s, so a 3 s cut-off meant the
 * LiDAR-derived heights were never served — the stall was traded for a
 * permanent loss of the better data.
 *
 * Under the race nothing waits for the primary: AWS publishes in ~1 s and
 * Mapterhorn is applied whenever it arrives. So the deadline is no longer a
 * latency control at all, only a last-resort guard against a request that never
 * settles and would otherwise hold an upgrade slot open for the life of the
 * page. 30 s sits comfortably above the measured worst case.
 *
 * **Keeping it at 3 s would have shipped a race that can never be won**, which
 * is the same no-op hazard the plan review flagged one layer up.
 */

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
      ...(options.onUpgrade === undefined
        ? {}
        : { onUpgrade: options.onUpgrade }),
    },
  );
}
