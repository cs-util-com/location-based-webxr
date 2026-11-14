/**
 * The slices of the Cloudflare bindings this Worker uses, declared here
 * rather than pulling `@cloudflare/workers-types` for a handful of methods.
 * They are also the test seam: the unit tests pass in-memory fakes.
 *
 * @see bindings.ts.md
 */

interface TileHttpMetadata {
  readonly contentType?: string;
  readonly contentEncoding?: string;
  readonly cacheControl?: string;
}

export interface TileObjectHead {
  readonly key: string;
  readonly size: number;
  readonly uploaded: Date;
  readonly httpEtag: string;
  readonly httpMetadata?: TileHttpMetadata;
  readonly customMetadata?: Record<string, string>;
}

export interface TileObjectBody extends TileObjectHead {
  readonly body: ReadableStream<Uint8Array>;
  text(): Promise<string>;
}

export interface TilePutOptions {
  readonly httpMetadata?: TileHttpMetadata;
  readonly customMetadata?: Record<string, string>;
}

/** The listing options this Worker uses (an `R2ListOptions` subset). */
export interface BucketListOptions {
  readonly prefix: string;
  readonly limit?: number;
  readonly cursor?: string;
  /** R2 returns custom metadata in a listing only when this names it. */
  readonly include?: readonly ("customMetadata" | "httpMetadata")[];
}

/** One listing page; `cursor` continues it while `truncated`. */
export interface BucketListing {
  readonly objects: readonly TileObjectHead[];
  readonly truncated: boolean;
  readonly cursor?: string;
}

/** R2 bucket subset. */
export interface TileBucket {
  head(key: string): Promise<TileObjectHead | null>;
  get(key: string): Promise<TileObjectBody | null>;
  put(
    key: string,
    value: ArrayBuffer | Uint8Array | string,
    options?: TilePutOptions,
  ): Promise<unknown>;
  delete(key: string): Promise<void>;
  list(options: BucketListOptions): Promise<BucketListing>;
}

/** What the fill and report endpoints enqueue for the serial consumer. */
export interface FillMessage {
  readonly cell: string;
  /**
   * `fill`: the tile is missing; `refresh`: it is older than the refresh
   * age; `verify`: a viewer reported the stored object bad; `replace`: a
   * viewer reported an object the verify cannot judge bad (it passed, or
   * its verify never finished), so it is refetched whatever its age.
   */
  readonly kind: "fill" | "refresh" | "verify" | "replace";
  /** Epoch ms of the request. */
  readonly at: number;
  /** `verify` only: the ETag of the object the viewer read. */
  readonly etag?: string;
}

/** Queue producer subset. */
export interface FillQueue {
  send(message: FillMessage): Promise<void>;
}

/** Rate Limiting binding subset (approximate, per location). */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface OsmTilesEnv {
  readonly TILES: TileBucket;
  readonly FILL_QUEUE: FillQueue;
  readonly FILL_LIMITER?: RateLimiter;
  /** Upstream requests per UTC day, all operators together (a string var). */
  readonly DAILY_UPSTREAM_CAP?: string;
  /**
   * Of DAILY_UPSTREAM_CAP, the requests replaces of reported tiles may send
   * per UTC day (a string var; a third of the upstream cap when unset).
   */
  readonly DAILY_REPLACE_CAP?: string;
  /** Queued or running fills at which the endpoint answers busy (a string var). */
  readonly MAX_PENDING_FILLS?: string;
  /** Verifies of reported tiles per UTC day (a string var). */
  readonly DAILY_VERIFY_CAP?: string;
  /** The real User-Agent the fill sends to the Overpass operators. */
  readonly USER_AGENT?: string;
}
