/**
 * The Overpass client.
 *
 * This is the only module in the package that touches the network, and it
 * carries every item of the plan's §5.3 "network discipline" list. That list is
 * not defensive polish: the public Overpass servers are donated infrastructure
 * with a global capacity of roughly 1,000,000 requests/day shared by every
 * OSM-based application in the world, and a library that ships to phones is a
 * per-user network dependency in the field.
 *
 * `fetch`, the clock, the sleeper and the RNG are all injected, so the entire
 * policy is tested offline and deterministically — no real timers, no real
 * requests, no flakes.
 *
 * @see overpass-source.ts.md
 */

import type { OsmDataSource, OsmTileResult } from "./osm-data-source.js";
import { OSM_ATTRIBUTION } from "./osm-data-source.js";
import { parseOverpassJson } from "../model/overpass-parser.js";
import {
  buildTileQuery,
  cellToBoundingBox,
  OVERPASS_SCHEMA_VERSION,
} from "./overpass-query.js";
import type { BackoffOptions } from "./backoff.js";
import {
  RETRYABLE_STATUSES,
  abortError,
  nextDelayMs,
  sleep,
} from "./backoff.js";

/**
 * Default endpoint pool.
 *
 * **These are NOT three independent quotas.** `z.` and `lz4.` are the two
 * backends that `overpass-api.de` itself load-balances across, so rotating
 * among them buys failover when one is in maintenance and nothing else. For
 * genuine headroom the pool needs an independently operated instance — and the
 * real answer to a quota problem is a self-hosted instance passed in via
 * `endpoints`.
 *
 * `overpass.kumi.systems` is included because it IS independently operated. It
 * is also the instance that answered when the main one returned 504 during this
 * package's development, which is the whole argument for a pool.
 */
export const DEFAULT_OVERPASS_ENDPOINTS: readonly string[] = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://z.overpass-api.de/api/interpreter",
];

export interface OverpassSourceOptions {
  /**
   * Identifies your application to the OSM servers. **Required** — this is an
   * OSM convention, and anonymous bulk clients get blocked. There is
   * deliberately no default: a shared default would make every consumer of this
   * library indistinguishable, so one bad actor would get everyone blocked.
   */
  readonly userAgent: string;
  readonly endpoints?: readonly string[];
  readonly fetchImpl?: typeof fetch;
  /** Max concurrent in-flight requests. The plan caps this at 2. */
  readonly maxConcurrent?: number;
  /** Retries after the first attempt. */
  readonly maxRetries?: number;
  readonly timeoutSeconds?: number;
  readonly backoff?: BackoffOptions;
  readonly random?: () => number;
  readonly now?: () => number;
  readonly sleepImpl?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const DEFAULT_MAX_CONCURRENT = 2;
const DEFAULT_MAX_RETRIES = 3;

/**
 * A failure that retrying cannot fix — a 400 because our query is malformed, a
 * 403 because we are blocked.
 *
 * This exists as a distinct type because the attempt loop's own `catch` would
 * otherwise swallow the "give up" throw and retry it anyway. That bug was real
 * and shipped for exactly as long as it took the "does NOT retry a
 * non-retryable status" test to run: a 400 was retried four times, quadrupling
 * the quota cost of every malformed query.
 */
export class PermanentOverpassError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentOverpassError";
  }
}

export class OverpassSource implements OsmDataSource {
  readonly attribution = OSM_ATTRIBUTION;
  readonly sourceId = "overpass";

  private readonly endpoints: readonly string[];
  private readonly fetchImpl: typeof fetch;
  private readonly maxConcurrent: number;
  private readonly maxRetries: number;
  private readonly timeoutSeconds: number;
  private readonly backoff: BackoffOptions;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly sleepImpl: (
    ms: number,
    signal?: AbortSignal,
  ) => Promise<void>;
  private readonly userAgent: string;

  /**
   * In-flight requests keyed by tile id.
   *
   * The plan calls this "the most likely source of a quota-burning bug", and it
   * is: the movement trigger and an explicit prefetch can ask for the same tile
   * in the same tick, and without this map that is two identical multi-megabyte
   * queries against donated infrastructure.
   */
  private readonly inFlight = new Map<string, Promise<OsmTileResult>>();

  /** Waiters for a concurrency slot. */
  private active = 0;
  private readonly queue: (() => void)[] = [];

  /** Observable counters, for the demo app's "how many queries did I make?". */
  readonly stats = { requests: 0, retries: 0, deduplicated: 0 };

  constructor(options: OverpassSourceOptions) {
    const endpoints = validateOptions(options);
    this.userAgent = options.userAgent;
    this.endpoints = endpoints;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.timeoutSeconds = options.timeoutSeconds ?? 60;
    this.backoff = options.backoff ?? {};
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
    this.sleepImpl = options.sleepImpl ?? sleep;
  }

  fetchTile(tile: string, signal?: AbortSignal): Promise<OsmTileResult> {
    const existing = this.inFlight.get(tile);
    if (existing !== undefined) {
      this.stats.deduplicated++;
      return existing;
    }
    const request = this.withConcurrencyLimit(() =>
      this.fetchTileUncached(tile, signal),
    ).finally(() => {
      this.inFlight.delete(tile);
    });
    this.inFlight.set(tile, request);
    return request;
  }

  private async fetchTileUncached(
    tile: string,
    signal?: AbortSignal,
  ): Promise<OsmTileResult> {
    const query = buildTileQuery(cellToBoundingBox(tile), this.timeoutSeconds);

    let lastError: unknown;
    // attempt 0 is the initial try; 1..maxRetries are retries.
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      throwIfAborted(signal);
      // Rotate on every attempt, starting at a random offset. Random start (as
      // the C# reference does) spreads load across the pool instead of every
      // client hammering endpoint 0 first.
      const endpoint = this.pickEndpoint(attempt);
      if (attempt > 0) {
        this.stats.retries++;
      }
      this.stats.requests++;

      try {
        const response = await this.fetchImpl(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
            // OSM convention: identify the application. Some instances reject
            // requests without it outright.
            "User-Agent": this.userAgent,
            Referer: this.userAgent,
          },
          body: new URLSearchParams({ data: query }).toString(),
          ...(signal !== undefined ? { signal } : {}),
        });

        if (response.ok) {
          return await this.toResult(tile, endpoint, response);
        }

        if (!RETRYABLE_STATUSES.has(response.status)) {
          throw new PermanentOverpassError(
            `Overpass ${endpoint} returned ${response.status} ${response.statusText}`,
          );
        }
        lastError = new Error(
          `Overpass ${endpoint} returned ${response.status} ${response.statusText}`,
        );
        await this.waitBeforeRetry(attempt, response, signal);
      } catch (error) {
        // Aborts and permanent failures must escape the loop rather than be
        // re-attempted. Both were previously caught here and retried: a 400
        // (our query is malformed) cost four requests instead of one, and an
        // abort kept working on an area the user had already left.
        if (isAbortError(error) || error instanceof PermanentOverpassError) {
          throw error;
        }
        lastError = error;
        if (attempt >= this.maxRetries) {
          break;
        }
        await this.waitBeforeRetry(attempt, undefined, signal);
      }
    }

    throw new Error(
      `Overpass fetch failed for tile ${tile} after ${this.maxRetries + 1} attempt(s): ${describe(lastError)}`,
    );
  }

  private async waitBeforeRetry(
    attempt: number,
    response: Response | undefined,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const delay = nextDelayMs(
      attempt,
      response?.headers.get("Retry-After"),
      this.now(),
      { ...this.backoff, random: this.backoff.random ?? this.random },
    );
    await this.sleepImpl(delay, signal);
  }

  private async toResult(
    tile: string,
    endpoint: string,
    response: Response,
  ): Promise<OsmTileResult> {
    // `.json()` on an HTML error page throws; that is a retryable-shaped
    // failure, so let it propagate into the attempt loop's catch.
    const payload: unknown = await response.json();
    const parsed = parseOverpassJson(payload);
    return {
      tile,
      features: parsed.features,
      fetchedAt: this.now(),
      sourceId: `${this.sourceId}:${hostOf(endpoint)}`,
      schemaVersion: OVERPASS_SCHEMA_VERSION,
      skipped: parsed.skipped,
      ...(parsed.osmBaseTimestamp !== undefined
        ? { osmBaseTimestamp: parsed.osmBaseTimestamp }
        : {}),
    };
  }

  private pickEndpoint(attempt: number): string {
    const start = Math.floor(this.random() * this.endpoints.length);
    return this.endpoints[(start + attempt) % this.endpoints.length]!;
  }

  /** Simple counting semaphore. */
  private async withConcurrencyLimit<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrent) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

/**
 * Validates constructor options and returns the resolved endpoint pool.
 *
 * Split out of the constructor purely to keep it under the complexity ratchet;
 * the guards themselves are the point, not an afterthought. Both are things a
 * consumer gets wrong once and then never again — but the first time, an
 * anonymous client can get an IP range blocked from a shared public service.
 */
function validateOptions(options: OverpassSourceOptions): readonly string[] {
  if (
    typeof options.userAgent !== "string" ||
    options.userAgent.trim() === ""
  ) {
    throw new Error(
      "OverpassSource requires a non-empty `userAgent` identifying your application (OSM convention).",
    );
  }
  const endpoints = options.endpoints ?? DEFAULT_OVERPASS_ENDPOINTS;
  if (endpoints.length === 0) {
    throw new Error("OverpassSource requires at least one endpoint.");
  }
  return endpoints;
}

function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw abortError();
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
