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

export interface CachingSourceOptions {
  /**
   * Overrides the schema version used in the cache key. Defaults to the
   * Overpass query's, which is the only schema that exists today.
   */
  readonly schemaVersion?: number;
  readonly now?: () => number;
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
  private readonly inFlight = new Map<string, Promise<OsmTileResult>>();

  readonly stats = { hits: 0, misses: 0, staleRefetches: 0, deduplicated: 0 };

  constructor(
    private readonly inner: OsmDataSource,
    private readonly store: OsmBlobStore,
    options: CachingSourceOptions = {},
  ) {
    this.attribution = inner.attribution;
    this.sourceId = `cached(${inner.sourceId})`;
    this.schemaVersion = options.schemaVersion ?? OVERPASS_SCHEMA_VERSION;
    this.now = options.now ?? Date.now;
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
    const cached = await this.readCached(tile);
    if (cached !== undefined && !this.isStale(cached, options.maxAgeMs)) {
      this.stats.hits++;
      return cached;
    }
    if (cached !== undefined) {
      this.stats.staleRefetches++;
    } else {
      this.stats.misses++;
    }

    const existing = this.inFlight.get(tile);
    if (existing !== undefined) {
      this.stats.deduplicated++;
      return existing;
    }

    const request = this.inner
      .fetchTile(tile, options.signal)
      .then(async (result) => {
        await this.store.put(this.cacheKey(tile), JSON.stringify(result));
        return result;
      })
      .finally(() => {
        this.inFlight.delete(tile);
      });

    this.inFlight.set(tile, request);
    return request;
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
  private async readCached(tile: string): Promise<OsmTileResult | undefined> {
    let raw: string | undefined;
    try {
      raw = await this.store.get(this.cacheKey(tile));
    } catch {
      return undefined;
    }
    if (raw === undefined) {
      return undefined;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        !isTileResult(parsed) ||
        parsed.schemaVersion !== this.schemaVersion
      ) {
        return undefined;
      }
      return parsed;
    } catch {
      return undefined;
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
