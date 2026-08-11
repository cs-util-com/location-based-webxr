/**
 * Cache-first decorator around any `OsmDataSource`.
 *
 * A decorator rather than a feature of `OverpassSource` so that caching applies
 * uniformly to a fixture source, a self-hosted instance, or a future PMTiles
 * source, and so that "did this come from the network?" is answerable by
 * composition rather than by a flag.
 *
 * @see caching-source.ts.md
 */

import type { OsmDataSource, OsmTileResult } from "./osm-data-source.js";
import type { OsmBlobStore } from "./osm-blob-store.js";
import { OVERPASS_SCHEMA_VERSION } from "./overpass-query.js";
import { RateLimitedError } from "./overpass-source.js";
import { InFlightRequests } from "./in-flight-requests.js";

export interface CachingSourceOptions {
  /**
   * Overrides the schema version used in the cache key. Defaults to the
   * Overpass query's, which is the only schema that exists today.
   */
  readonly schemaVersion?: number;
  readonly now?: () => number;
  /**
   * Monotonic clock for `timings` durations. See `OverpassSource`'s option of
   * the same name for why this is separate from {@link now}.
   */
  readonly monotonicNow?: () => number;
}

export interface EnsureOptions {
  readonly signal?: AbortSignal;
  /**
   * Force a refetch when the cached tile is older than this.
   *
   * **The library never expires anything on its own.** OSM changes on a
   * timescale of months for the features that matter here, so cache-first and
   * stale-is-fine is the right default — but "indefinitely" is too strong for a
   * UI: an AR overlay showing a building demolished two years ago is a bug, not
   * acceptable staleness. Expiry is therefore the consumer's policy, expressed
   * per call, and `fetchedAt` is surfaced so they can decide.
   */
  readonly maxAgeMs?: number;
}

/**
 * Wraps a source so tiles are served from an `OsmBlobStore` when present.
 *
 * Deduplication of concurrent identical requests happens here too, so that a
 * cache miss racing with itself makes exactly one downstream call — the inner
 * source's own dedup only helps if the inner source has one.
 */
export class CachingSource implements OsmDataSource {
  readonly attribution: string;
  readonly sourceId: string;

  private readonly schemaVersion: number;
  private readonly now: () => number;
  private readonly monotonicNow: () => number;
  private readonly inFlight = new InFlightRequests<OsmTileResult>();

  readonly stats = {
    hits: 0,
    misses: 0,
    staleRefetches: 0,
    deduplicated: 0,
    /** Refetches a rate limit refused, answered from the stale copy instead. */
    staleOnRateLimit: 0,
  };

  constructor(
    private readonly inner: OsmDataSource,
    private readonly store: OsmBlobStore,
    options: CachingSourceOptions = {},
  ) {
    this.attribution = inner.attribution;
    this.sourceId = `cached(${inner.sourceId})`;
    this.schemaVersion = options.schemaVersion ?? OVERPASS_SCHEMA_VERSION;
    this.now = options.now ?? Date.now;
    this.monotonicNow =
      options.monotonicNow ??
      (() =>
        typeof performance === "undefined" ? Date.now() : performance.now());
  }

  /**
   * The cache key.
   *
   * **Keyed by the fixed H3 grid cell, never by the query's bounding box.**
   * This is the single most consequential caching decision in the package: a
   * walking user generates a slightly different bbox on every query, so a
   * bbox-keyed cache would never hit — the network cost would be unbounded and
   * the cache would look like it was working.
   *
   * The schema version is in the key so that narrowing or widening the query
   * never silently reuses non-equivalent entries.
   */
  cacheKey(tile: string): string {
    return `osm/v${this.schemaVersion}/${tile}`;
  }

  fetchTile(tile: string, signal?: AbortSignal): Promise<OsmTileResult> {
    return this.ensureTile(tile, {
      ...(signal !== undefined ? { signal } : {}),
    });
  }

  async ensureTile(
    tile: string,
    options: EnsureOptions = {},
  ): Promise<OsmTileResult> {
    // TIMED AROUND THE READ, not around the whole call, because `readCached`
    // runs on EVERY path — hit, miss and stale — and only on a hit is its cost
    // the whole delivery. `readCached` reports what it spent so a miss can
    // attribute the same read honestly rather than losing it.
    const read = await this.readCachedTimed(tile);
    const cached = read.result;
    if (cached !== undefined && !this.isStale(cached, options.maxAgeMs)) {
      this.stats.hits++;
      return {
        ...cached,
        timings: {
          servedBy: "cache",
          slotWaitMs: 0,
          transportMs: read.transportMs,
          decodeMs: read.decodeMs,
          // TRULY ZERO, not unmeasured. The blob already holds features, so
          // `parseOverpassJson` never runs on this path — which is a real and
          // useful fact about the warm click, and `servedBy` is what stops it
          // being read as "nobody looked".
          parseMs: 0,
          attempts: 0,
        },
      };
    }
    if (cached !== undefined) {
      this.stats.staleRefetches++;
    } else {
      this.stats.misses++;
    }

    if (this.inFlight.has(tile)) this.stats.deduplicated++;

    return this.inFlight.join(
      tile,
      (dedupSignal) => this.fetchAndStore(tile, cached, dedupSignal),
      options.signal,
    );
  }

  /**
   * The de-duplicated body: fetch, persist, and fall back to `cached`.
   *
   * `cached` is passed in rather than re-read because the caller has already
   * paid for the read, and because it must be the copy the STARTING caller
   * saw — a joiner arriving later must get the same answer as everyone else
   * sharing this request.
   */
  private fetchAndStore(
    tile: string,
    cached: OsmTileResult | undefined,
    signal: AbortSignal,
  ): Promise<OsmTileResult> {
    return this.inner
      .fetchTile(tile, signal)
      .then(async (result) => {
        // STRIPPED BEFORE PERSISTING, and this is the single most consequential
        // line in the file for the click-path breakdown. `timings` describes
        // one DELIVERY; a cached blob describes a TILE, and a tile has no fetch
        // duration. Left on, the originating network's `transportMs` would be
        // written into OPFS and handed back on every later hit forever — so the
        // warm path would report a 60 s fetch it never made, and parse, the
        // term the plan is hunting, would be measured on the wrong path.
        const { timings, ...persistable } = result;
        const storeStart = this.monotonicNow();
        await this.store.put(this.cacheKey(tile), JSON.stringify(persistable));
        const storeMs = this.monotonicNow() - storeStart;
        // THE WRITE IS ON THE CLICK PATH because it is awaited before the
        // caller gets its tile, so it is reported rather than absorbed. Only
        // when the inner source measured at all — a source without timings must
        // not acquire a partial object here, since absent and zero are
        // different facts everywhere else in this type.
        if (timings === undefined) return result;
        return { ...result, timings: { ...timings, storeMs } };
      })
      .catch((error: unknown) => {
        // A refused slot is not a data problem, and it is the ONE failure where
        // the cache holds the better answer: nothing is wrong upstream, the
        // data will be fetchable shortly, and a stale copy beats no copy.
        // Rethrowing here instead would make `loadTiles` file the tile as
        // `deferred` and the caller render nothing — while a usable copy sits
        // in the store, which is the opposite of what a cache is for.
        //
        // Deliberately narrow on both axes: only `RateLimitedError`, and only
        // with something cached. Any other error still propagates (a broken
        // source must not hide behind a stale render), and a rate limit with an
        // empty cache still rejects, because "not fetched yet" is a real answer
        // that the caller needs to be able to tell from "no data here".
        if (cached !== undefined && error instanceof RateLimitedError) {
          this.stats.staleOnRateLimit++;
          // ITS OWN `servedBy`, because this is neither a network fetch nor a
          // cache hit: the read already happened above, the fetch was refused,
          // and a breakdown that filed this under either would misattribute a
          // refusal as a cost. The read's own cost is not re-reported here —
          // it belongs to the attempt that made it.
          return {
            ...cached,
            timings: {
              servedBy: "stale-on-rate-limit",
              slotWaitMs: 0,
              transportMs: 0,
              decodeMs: 0,
              parseMs: 0,
              attempts: 0,
            },
          };
        }
        throw error;
      });
  }

  /** Every tile currently cached, as `FETCH_RES` (res-7) cell ids. */
  async listCachedTiles(): Promise<string[]> {
    const prefix = `osm/v${this.schemaVersion}/`;
    const keys = await this.store.keys();
    return keys
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length));
  }

  /**
   * Removes one tile from the cache.
   *
   * Eviction is the host application's problem, not the library's — only the
   * app knows its storage budget and which areas the user cares about. The
   * library therefore exposes the controls and never evicts on its own.
   */
  async evictTile(tile: string): Promise<void> {
    await this.store.delete(this.cacheKey(tile));
  }

  private isStale(
    result: OsmTileResult,
    maxAgeMs: number | undefined,
  ): boolean {
    if (maxAgeMs === undefined) {
      return false;
    }
    return this.now() - result.fetchedAt > maxAgeMs;
  }

  /**
   * Reads and validates a cached entry.
   *
   * A corrupt or truncated entry (interrupted write, quota eviction mid-write,
   * a storage backend that lied) is treated as a miss rather than allowed to
   * throw. The cost of being wrong is one refetch; the cost of throwing is a
   * permanently poisoned tile that no amount of retrying fixes.
   */
  private async readCachedTimed(tile: string): Promise<{
    readonly result: OsmTileResult | undefined;
    readonly transportMs: number;
    readonly decodeMs: number;
  }> {
    const none = { result: undefined, transportMs: 0, decodeMs: 0 };
    let raw: string | undefined;
    const readStart = this.monotonicNow();
    try {
      raw = await this.store.get(this.cacheKey(tile));
    } catch {
      return none;
    }
    // THE OPFS READ IS THIS PATH'S TRANSPORT. Same role as the HTTP round trip
    // on a miss: bytes in hand. Naming it the same thing is what lets a warm
    // click and a cold one be compared line by line.
    const transportMs = this.monotonicNow() - readStart;
    if (raw === undefined) {
      return { ...none, transportMs };
    }
    try {
      const decodeStart = this.monotonicNow();
      const parsed: unknown = JSON.parse(raw);
      const decodeMs = this.monotonicNow() - decodeStart;
      if (
        !isTileResult(parsed) ||
        parsed.schemaVersion !== this.schemaVersion
      ) {
        return { ...none, transportMs, decodeMs };
      }
      return { result: parsed, transportMs, decodeMs };
    } catch {
      return { ...none, transportMs };
    }
  }
}

function isTileResult(value: unknown): value is OsmTileResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<OsmTileResult>;
  return (
    typeof candidate.tile === "string" &&
    Array.isArray(candidate.features) &&
    typeof candidate.fetchedAt === "number" &&
    typeof candidate.sourceId === "string" &&
    typeof candidate.schemaVersion === "number"
  );
}
