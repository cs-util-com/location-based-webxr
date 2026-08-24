/**
 * The `OsmDataSource` seam — the single most important abstraction in the
 * package, because it is what keeps the Overpass decision reversible.
 *
 * Everything downstream (caching, indexing, scoring, regions) consumes only
 * this interface. Swapping in a self-hosted Overpass instance, a PMTiles build,
 * or a pre-baked server index is therefore a configuration change rather than a
 * rewrite — which is the escape hatch the plan relies on if the public Overpass
 * quota ever becomes the binding constraint.
 *
 * @see osm-data-source.ts.md
 */

import type { OsmFeature } from "../model/osm-feature.js";
import type { SkippedElement } from "../model/overpass-parser.js";

/**
 * Where the wall clock went producing ONE DELIVERY of a tile.
 *
 * **A delivery, never the tile.** The same tile handed to three callers is
 * three deliveries with three different costs, and conflating them is not a
 * rounding error — it is the difference between "the cache is fast" and "the
 * cache is as slow as the fetch that filled it". Two consequences that are easy
 * to get wrong and are therefore enforced by tests:
 *
 * - **`CachingSource` strips this before persisting.** `store.put` serialises
 *   the whole result, so a `timings` left on it would be written into OPFS and
 *   replayed on every later hit — the warm path would report the original
 *   network's `transportMs` forever.
 * - **A joiner gets its own.** `InFlightRequests` gives N callers one delivery;
 *   a caller that waited 200 ms on someone else's 60 s fetch did not spend 60 s.
 *
 * **Optional on `OsmTileResult`, and absent is not zero.** A source that does
 * not measure (a fixture, a test double, a future PMTiles reader) omits the
 * field entirely. A consumer must be able to tell "nobody measured this" from
 * "this cost nothing", because the second is a real and common answer — see
 * `parseMs` on a cache hit.
 *
 * @see osm-data-source.ts.md
 */
export interface OsmTileTimings {
  /**
   * Which path produced this delivery.
   *
   * Four values rather than the obvious two: a joiner and a stale-on-rate-limit
   * answer are neither a network fetch nor a cache hit, and reporting either as
   * one of those makes the breakdown lie about which stage owns the wait.
   */
  readonly servedBy: "network" | "cache" | "joined" | "stale-on-rate-limit";
  /**
   * Time queued behind `maxConcurrent` before any work began.
   *
   * Its own field because it is a real, unenumerated stage on the click path:
   * folded into `transportMs` it reads as a slow server, and dropped entirely it
   * reads as time that never existed.
   */
  readonly slotWaitMs: number;
  /**
   * Bytes in hand — the HTTP round trip, or the OPFS `store.get`.
   *
   * **Includes retry backoff when `attempts > 1`**, which is why `attempts` is
   * reported next to it: a large `transportMs` at one attempt is a slow server,
   * and the same number at three attempts is mostly sleeping.
   */
  readonly transportMs: number;
  /** `JSON.parse` of those bytes. */
  readonly decodeMs: number;
  /**
   * `parseOverpassJson` — features out of the decoded payload.
   *
   * **Genuinely 0 on a cache hit**, because the cached blob already holds
   * features and the parser never runs. That is a fact about the warm path
   * worth reading, not a missing measurement; `servedBy` is what distinguishes
   * them, and an unmeasured source omits the whole object instead.
   */
  readonly parseMs: number;
  /** Network attempts made. 1 means no retry. */
  readonly attempts: number;
  /** The cache WRITE, present only when one happened — it is `await`ed. */
  readonly storeMs?: number;
  /**
   * A JOINER's whole wall wait, present only when `servedBy === "joined"`.
   *
   * **Its own field rather than `transportMs`, which is what the first
   * implementation did and was wrong.** A joiner's wait spans somebody else's
   * transport AND decode AND parse; filing it under "bytes in hand" would
   * charge another caller's parse time to the network stage — the wrong
   * direction for a plan whose prediction is "parse dominates, not network".
   * The other duration fields are 0 for a joiner, so the sum is
   * `joinedMs + probeMs`.
   *
   * **It does not itself cover the joiner's own cache probe** — `CachingSource`
   * pays that before it discovers there is a request to join, and the join
   * clock starts after. **That probe is now carried in {@link probeMs} on the
   * joined path too**, so the reconciliation closes rather than landing in the
   * click-level residual (r504 review). Until 2026-08-12 it was dropped, and
   * this docstring said so at length; the sentence is kept in corrected form
   * because "the sum closes" has been overstated here once before.
   */
  readonly joinedMs?: number;
  /**
   * The cache READ that preceded this delivery and did NOT serve it.
   *
   * Present on a miss, on a stale hit, **and on a join** — every path where
   * `readCached` has already paid a full `store.get` plus `JSON.parse`. On a
   * large blob that is the second largest term on the warm-miss path, and
   * without this field it belongs to no stage at all.
   */
  readonly probeMs?: number;
}

/**
 * The result of loading one fetch tile (`FETCH_RES`, res 7 as of 2026-07-28).
 *
 * **Structured-cloneable**, like everything else that can cross a worker
 * boundary: plain objects and arrays only.
 */
export interface OsmTileResult {
  /** The `FETCH_RES` H3 cell this result is for. */
  readonly tile: string;
  readonly features: readonly OsmFeature[];
  /**
   * Epoch milliseconds at which this data was retrieved from its origin.
   *
   * Provenance for the "stale-is-fine" contract: it survives caching (a cached
   * tile keeps the timestamp of its original fetch, NOT of the cache read), so
   * a consumer can show "OSM data from March 2026" or force a refresh. The
   * library never expires anything on its own — that policy is the consumer's.
   */
  readonly fetchedAt: number;
  /** e.g. `"overpass:overpass-api.de"` or `"fixture:cologne-park"`. */
  readonly sourceId: string;
  /**
   * The query schema this tile was produced under. Part of the cache key, so
   * that narrowing or widening the query never silently reuses old entries.
   */
  readonly schemaVersion: number;
  /** Elements the parser rejected, with reasons. Never silently discarded. */
  readonly skipped: readonly SkippedElement[];
  /** Overpass's `osm3s.timestamp_osm_base`, when the source supplies one. */
  readonly osmBaseTimestamp?: string;
  /**
   * What THIS delivery cost, when the source measures. See {@link OsmTileTimings}
   * — in particular, why it must never be persisted and why absent differs from
   * zero.
   */
  readonly timings?: OsmTileTimings;
}

/**
 * A duration from two clock readings, floored at zero.
 *
 * **The floor is the point, and a property test is why it exists.** The two-
 * clock design above argues that a monotonic source is needed because
 * `Date.now()` can step backwards; that argument was shipped as a comment with
 * nothing enforcing it, and a run over adversarial clock sequences promptly
 * produced `transportMs: -1`.
 *
 * A negative duration is worse than a merely wrong one. The whole breakdown is
 * checked by summing the stages against a wall clock, and a negative makes that
 * sum close by CANCELLING — so the reconciliation gate goes quiet at exactly
 * the moment it should be shouting. Clamping turns a clock glitch into a
 * visibly-too-small stage, which the residual then reports as unattributed
 * time: wrong, but wrong in the direction that gets noticed.
 */
export function elapsedMs(from: number, to: number): number {
  return Math.max(0, to - from);
}

/**
 * What a dedup JOINER's delivery cost — shared by every source that dedups.
 *
 * **Here rather than in one source, because the first implementation put it in
 * `OverpassSource` alone and that made it unreachable.** `CachingSource` runs
 * its own `InFlightRequests` and dedups FIRST, so in the demo's wiring the
 * inner Overpass client sees exactly one caller and its joiner branch never
 * runs. Two colliding refresh passes were both told the click cost a full
 * network fetch — verbatim the overstatement this whole field exists to
 * prevent. Any source that owns an `InFlightRequests` owes its joiners this.
 */
export function joinedTimings(joinedMs: number): OsmTileTimings {
  return {
    servedBy: "joined",
    slotWaitMs: 0,
    transportMs: 0,
    decodeMs: 0,
    parseMs: 0,
    attempts: 0,
    joinedMs,
  };
}

export interface OsmDataSource {
  /**
   * Human-readable attribution that consumers MUST render.
   *
   * OSM data is ODbL; displaying this is a licence obligation, not a courtesy.
   * It lives on the source rather than as a module constant because a
   * self-hosted or blended source may owe different credit.
   */
  readonly attribution: string;

  /** Stable identifier for this source, recorded on every result. */
  readonly sourceId: string;

  /**
   * Fetches every OSM feature intersecting the given fetch tile.
   *
   * @param tile - a `FETCH_RES` H3 cell id (res 7 as of 2026-07-28).
   * @param signal - aborts in-flight work when the user leaves the area.
   * @throws when the tile genuinely cannot be produced. Callers that must
   *   survive (the movement trigger) catch; callers that want to know (an
   *   explicit prefetch) propagate.
   */
  fetchTile(tile: string, signal?: AbortSignal): Promise<OsmTileResult>;
}

/** The attribution every OSM-derived source owes at minimum. */
export const OSM_ATTRIBUTION = "© OpenStreetMap contributors";
