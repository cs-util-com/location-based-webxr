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
  OVERPASS_SELECT_KEYS,
} from "./overpass-query.js";
import type { BackoffOptions } from "./backoff.js";
import {
  RETRYABLE_STATUSES,
  abortError,
  nextDelayMs,
  parseRetryAfterMs,
  sleep,
} from "./backoff.js";
import type { OverpassStatus } from "./overpass-status.js";
import { parseOverpassStatus } from "./overpass-status.js";
import { OverpassSlotBudget } from "./slot-budget.js";

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
  /**
   * Override the OSM keys selected on (default {@link OVERPASS_SELECT_KEYS}).
   *
   * For a self-hosted or otherwise generous instance that can afford a wider
   * filter. **Only widen.** Every key removed is scoring signal that can never
   * arrive, and its absence reads as "nothing is mapped here".
   */
  readonly selectKeys?: readonly string[];
  /**
   * Shared slot budget. Supply one when several sources talk to the same
   * instance, since the allocation is per client IP and not per object.
   */
  readonly budget?: OverpassSlotBudget;
  /** Max concurrent in-flight requests. The plan caps this at 2. */
  readonly maxConcurrent?: number;
  /** Retries after the first attempt. */
  readonly maxRetries?: number;
  readonly timeoutSeconds?: number;
  readonly backoff?: BackoffOptions;
  readonly random?: () => number;
  readonly now?: () => number;
  readonly sleepImpl?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Cap on `stats.attempts`. See {@link OverpassStats}. */
  readonly maxAttemptLog?: number;
}

/**
 * One dispatched request's outcome.
 *
 * Exists because the first real end-to-end fetch took FOUR requests to land one
 * tile with `rateLimited === 0` — so three attempts failed on something else,
 * and a retry COUNT could not say what. The on-device walk is expensive to
 * repeat; this is what makes one walk conclusive rather than suggestive.
 */
export interface OverpassAttempt {
  /** HTTP status, or undefined for a transport failure that never got one. */
  readonly status?: number;
  readonly endpoint: string;
  /** Message of a transport-level failure, when there was one. */
  readonly error?: string;
  readonly at: number;
}

export interface OverpassStats {
  requests: number;
  retries: number;
  deduplicated: number;
  rateLimited: number;
  /** The most recent attempts, oldest first. Bounded — see `maxAttemptLog`. */
  attempts: OverpassAttempt[];
}

/** Matches the measured `Rate limit: 2` on the public instances. */
const DEFAULT_MAX_CONCURRENT = 2;
const DEFAULT_MAX_RETRIES = 3;

/**
 * Default `[timeout:]`. See `overpass-query.ts` — high on purpose, because
 * Overpass charges only the execution time actually used.
 */
const DEFAULT_TIMEOUT_SECONDS = 180;

/**
 * Penalty applied on a 429 that carries no `Retry-After`.
 *
 * Measured recovery on the public instances is ~30 s; erring slightly long
 * costs a little latency, erring short costs another 429 and, repeated, an IP
 * block.
 */
const DEFAULT_RATE_LIMIT_PENALTY_MS = 35_000;

/**
 * How many attempt records to keep.
 *
 * Bounded because a walking user fetches for hours, and an unbounded diagnostic
 * array is a slow memory leak in the one component that has to survive a long
 * field session. The RECENT attempts are what matter — a failure being
 * diagnosed is nearly always the latest one.
 */
const DEFAULT_MAX_ATTEMPT_LOG = 50;

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

/**
 * The client's own slot allocation is spent — no request was dispatched.
 *
 * Distinct from every other failure because the correct response is different:
 * nothing is wrong, the data will be fetchable shortly, and the caller should
 * serve whatever it already has. `CachingSource` turns this into "serve cache,
 * queue the fetch"; the explicit prefetch API surfaces it, because "download
 * this area for offline use" must be able to say it cannot right now.
 *
 * Measured recovery on the public instances is ~30 s, not hours.
 */
export class RateLimitedError extends Error {
  constructor(
    message: string,
    /** Milliseconds until a slot is expected to be free. May be 0 if unknown. */
    readonly retryAfterMs: number,
  ) {
    super(message);
    this.name = "RateLimitedError";
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
  readonly stats: OverpassStats = {
    requests: 0,
    retries: 0,
    deduplicated: 0,
    rateLimited: 0,
    attempts: [],
  };

  /**
   * The client's own slot accounting.
   *
   * Public so a consumer can read `available` / `msUntilAvailable()` for a UI,
   * and so several sources against one instance can share an allocation — the
   * limit is per client IP, not per object.
   */
  readonly budget: OverpassSlotBudget;

  private readonly selectKeys: readonly string[];
  private readonly maxAttemptLog: number;

  constructor(options: OverpassSourceOptions) {
    const resolved = { ...defaultOptions(), ...stripUndefined(options) };
    validateOptions(options);

    // Straight from `options`: it is the one REQUIRED field, so it has no
    // default to merge over and the merged type would make it optional.
    this.userAgent = options.userAgent;
    this.endpoints = resolved.endpoints;
    this.fetchImpl = resolved.fetchImpl;
    this.maxConcurrent = resolved.maxConcurrent;
    this.maxRetries = resolved.maxRetries;
    this.timeoutSeconds = resolved.timeoutSeconds;
    this.backoff = resolved.backoff;
    this.random = resolved.random;
    this.now = resolved.now;
    this.sleepImpl = resolved.sleepImpl;
    this.selectKeys = resolved.selectKeys;
    this.maxAttemptLog = resolved.maxAttemptLog;
    this.budget =
      resolved.budget ?? new OverpassSlotBudget({ now: () => this.now() });
  }

  /**
   * Re-syncs the slot budget from `/api/status`.
   *
   * Costs no slot. Worth calling on start-up and after a 429, but **not** as a
   * pre-flight check before each request: measured 2026-07-28, `/api/status`
   * lags actual consumption badly enough that it reported a full allocation
   * free while concurrent queries were being 429'd. The local budget is the
   * authority; this only corrects it.
   *
   * Failures are swallowed: a status endpoint that is down or has changed shape
   * must not stop us fetching tiles, it only means we fly on local accounting.
   */
  async syncBudget(signal?: AbortSignal): Promise<OverpassStatus | undefined> {
    const endpoint = this.pickEndpoint(0);
    try {
      const response = await this.fetchImpl(statusUrlFor(endpoint), {
        headers: { "User-Agent": this.userAgent },
        ...(signal !== undefined ? { signal } : {}),
      });
      if (!response.ok) return undefined;
      const status = parseOverpassStatus(await response.text());
      this.budget.sync(status);
      return status;
    } catch {
      return undefined;
    }
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
    // Take a slot BEFORE building anything. Refusing here is the whole point of
    // the budget: a request not sent cannot be rate-limited, and the caller is
    // far better placed than we are to decide between serving cache and waiting.
    if (!this.budget.tryAcquire()) {
      this.stats.rateLimited++;
      throw new RateLimitedError(
        `Overpass slot budget exhausted for tile ${tile}`,
        this.budget.msUntilAvailable(),
      );
    }
    try {
      return await this.fetchTileWithSlot(tile, signal);
    } finally {
      this.budget.release();
    }
  }

  private async fetchTileWithSlot(
    tile: string,
    signal?: AbortSignal,
  ): Promise<OsmTileResult> {
    const query = buildTileQuery(
      cellToBoundingBox(tile),
      this.timeoutSeconds,
      this.selectKeys,
    );

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
        const response = await this.dispatch(endpoint, query, signal);
        this.recordAttempt({
          endpoint,
          status: response.status,
          at: this.now(),
        });

        if (response.ok) {
          return await this.toResult(tile, endpoint, response);
        }

        if (!RETRYABLE_STATUSES.has(response.status)) {
          throw new PermanentOverpassError(
            `Overpass ${endpoint} returned ${response.status} ${response.statusText}`,
          );
        }
        this.noteRateLimit(response);
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
        // A transport failure (DNS, reset connection) never produced a status.
        // Recorded WITHOUT one rather than omitted: dropping it would make the
        // log claim fewer requests than were really made, which is the one
        // direction of error that under-reports quota use.
        if (!(error instanceof PermanentOverpassError)) {
          this.recordAttempt({
            endpoint,
            error: describe(error),
            at: this.now(),
          });
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

  /** Appends to the bounded attempt log. */
  private recordAttempt(attempt: OverpassAttempt): void {
    this.stats.attempts.push(attempt);
    if (this.stats.attempts.length > this.maxAttemptLog) {
      // Drop the OLDEST: a failure being diagnosed is nearly always the latest.
      this.stats.attempts.splice(
        0,
        this.stats.attempts.length - this.maxAttemptLog,
      );
    }
  }

  private dispatch(
    endpoint: string,
    query: string,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    return this.fetchImpl(endpoint, {
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
  }

  /**
   * Feeds a 429 into the shared budget.
   *
   * The server's own recovery time beats our backoff curve, and it must apply
   * to EVERY subsequent request rather than only to this one's retry —
   * otherwise a second tile fetched in the same tick walks straight into the
   * same wall and earns a second strike.
   */
  private noteRateLimit(response: Response): void {
    if (response.status !== 429) return;
    const retryAfterMs = parseRetryAfterMs(
      response.headers.get("Retry-After"),
      this.now(),
    );
    this.budget.penalise(retryAfterMs ?? DEFAULT_RATE_LIMIT_PENALTY_MS);
    this.stats.rateLimited++;
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
function validateOptions(options: OverpassSourceOptions): void {
  if (
    typeof options.userAgent !== "string" ||
    options.userAgent.trim() === ""
  ) {
    throw new Error(
      "OverpassSource requires a non-empty `userAgent` identifying your application (OSM convention).",
    );
  }
  if (options.endpoints !== undefined && options.endpoints.length === 0) {
    throw new Error("OverpassSource requires at least one endpoint.");
  }
}

/**
 * Every default in one place, so the constructor is an assignment list rather
 * than a wall of `??` — which is both easier to read and easier to keep in step
 * with the sidecar's documented defaults.
 */
function defaultOptions() {
  return {
    endpoints: DEFAULT_OVERPASS_ENDPOINTS,
    fetchImpl: globalThis.fetch.bind(globalThis),
    maxConcurrent: DEFAULT_MAX_CONCURRENT,
    maxRetries: DEFAULT_MAX_RETRIES,
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    backoff: {} as BackoffOptions,
    random: Math.random,
    now: Date.now,
    sleepImpl: sleep,
    maxAttemptLog: DEFAULT_MAX_ATTEMPT_LOG,
    selectKeys: OVERPASS_SELECT_KEYS,
    budget: undefined as OverpassSlotBudget | undefined,
  };
}

/**
 * Drops explicitly-`undefined` keys before spreading over the defaults.
 *
 * Without this, `{ maxRetries: undefined }` — which is exactly what an options
 * object built from optional config produces — would overwrite the default with
 * `undefined` and turn a retry count into `NaN` comparisons.
 */
function stripUndefined<T extends object>(source: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

/**
 * `.../api/interpreter` → `.../api/status` on the same instance.
 *
 * Derived rather than configured separately, so a consumer pointing at a
 * self-hosted instance cannot end up reading one server's budget while querying
 * another's — which would be worse than not checking at all.
 */
function statusUrlFor(endpoint: string): string {
  return endpoint.replace(/\/api\/interpreter\/?$/, "/api/status");
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
