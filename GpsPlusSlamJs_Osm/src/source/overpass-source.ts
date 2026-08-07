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
import { InFlightRequests } from "./in-flight-requests.js";

/**
 * Default endpoint pool, in PREFERENCE ORDER — `pickEndpoint` walks it from the
 * front and does not shuffle.
 *
 * Ordered from a measurement, not a guess. All six known free global instances
 * were timed on one identical res-7 Cologne tile on 2026-07-28 21:43 UTC
 * (`scripts/benchmark-endpoints.mjs`; results in
 * `GpsPlusSlamJs_Docs/docs/2026-07-28-2344-overpass-endpoint-benchmark-results.md`):
 *
 * - `lz4.overpass-api.de` — 200 OK, 27.6 s
 * - `maps.mail.ru` (VK Maps) — 200 OK, 22.9 s
 * - `z.overpass-api.de` — 200 OK, 36.1 s
 * - `overpass.private.coffee` — 200 OK, 110.4 s
 * - `overpass.kumi.systems` — 200 OK, 96.8 s
 * - `overpass-api.de` — **504 Gateway Timeout** after 8.3 s
 *
 * **`overpass.kumi.systems` and `overpass.private.coffee` are the same
 * instance** — byte-identical payloads (66,348,574 B), differing from every
 * other host's (67,973,393 B), confirming the OSM wiki's "Private.coffee
 * (formerly overpass.kumi.systems)". Only the canonical name is listed; keeping
 * both would inflate the apparent pool without adding an operator.
 *
 * **`z.` and `lz4.` are NOT independent quotas** — byte-identical to each other,
 * they are the backends `overpass-api.de` load-balances across. So this pool is
 * three operators, not four entries' worth of headroom, and **the real answer to
 * a quota problem is still a self-hosted instance passed in via `endpoints`.**
 *
 * The FOSSGIS **main** entry is last because it is the only host that failed the
 * query outright; a host that cannot serve it is worse than a slow one that can.
 * Its 8.3 s 504 matches the signature of the key-regex form
 * (`capture-script-query.test.ts`), suggesting a front-end timeout shorter than
 * this query needs rather than a data problem — which is why its own backends
 * answer fine. It stays in the pool: one failure is not grounds for removal.
 *
 * **This order has a shelf life.** It is one sample per host, from one location,
 * at one time of day. Re-run the script rather than trusting it indefinitely.
 */
export const DEFAULT_OVERPASS_ENDPOINTS: readonly string[] = [
  "https://lz4.overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://z.overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

export interface OverpassSourceOptions {
  /**
   * Identifies your application to the OSM servers. **Required** — this is an
   * OSM convention, and anonymous bulk clients get blocked. There is
   * deliberately no default: a shared default would make every consumer of this
   * library indistinguishable, so one bad actor would get everyone blocked.
   *
   * **Node only, in practice.** `User-Agent` is a forbidden request header per
   * the fetch spec, so a browser drops it silently and sends its own instead —
   * no error, no warning, nothing to see in devtools. This package ships to
   * phones, so that is the common case. The option is still required and still
   * correct (it works under Node/`undici`, and being unable to identify
   * yourself is not a reason to stop trying), but do not go looking for the
   * header on the wire in a browser build.
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
 * serve whatever it already has. `CachingSource` therefore answers it from the
 * stale copy when it has one, and only propagates it when it has nothing — so
 * this reaching a caller really does mean "no data yet", not "data withheld".
 * There is deliberately no retry queue behind that: the caller already knows
 * when to come back from `retryAfterMs`, and a queue the caller cannot see
 * would refetch areas they have since walked away from.
 *
 * The explicit prefetch API surfaces it instead, because "download this area
 * for offline use" must be able to say it cannot right now.
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
  private readonly inFlight = new InFlightRequests<OsmTileResult>();

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
    if (this.inFlight.has(tile)) this.stats.deduplicated++;
    // The joined callers' signals are deliberately NOT the one the request runs
    // on — see `in-flight-requests.ts`. The movement trigger and an explicit
    // prefetch are the two callers most likely to collide here, and they have
    // different lifetimes.
    return this.inFlight.join(
      tile,
      (dedupSignal) =>
        this.withConcurrencyLimit(() =>
          this.fetchTileUncached(tile, dedupSignal),
        ),
      signal,
    );
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

      // Whether THIS dispatch already produced a recorded attempt. The catch
      // below must not add a second record for the same request: a 200 whose
      // body is an HTML error page is recorded here with its status, then
      // `toResult`'s .json() throws and lands in the catch. Recording again
      // would make attempts.length exceed stats.requests and overstate quota
      // use — and an instance answering 200 with an error page is exactly the
      // case this log exists to diagnose.
      let recorded = false;

      try {
        const response = await this.dispatch(endpoint, query, signal);
        this.recordAttempt({
          endpoint,
          status: response.status,
          at: this.now(),
        });
        recorded = true;

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
        //
        // Only when the dispatch itself failed. The previous guard here tested
        // `!(error instanceof PermanentOverpassError)`, which was dead code -
        // the block above already rethrew every one of those - while the case
        // it needed to exclude (a response recorded with its status whose BODY
        // then failed to parse) went unguarded.
        if (!recorded) {
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
        //
        // Both of these are forbidden request headers, so a BROWSER drops them
        // silently and sends its own UA plus whatever `Referrer-Policy`
        // produces. Kept because they do work under Node/`undici`, and setting
        // them costs nothing where they do not — but the mitigation above only
        // applies off-browser, which is the opposite of this package's main
        // target. See `OverpassSourceOptions.userAgent`.
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

  /**
   * The endpoint for `attempt`, walking the pool IN ORDER from the front.
   *
   * Deliberately not randomised any more. The previous version started at a
   * random offset to spread load "instead of every client hammering endpoint 0
   * first" — a real property, given up knowingly, because it also made the pool
   * order decorative: every client drew uniformly, so the slowest instance
   * served its full share of traffic. Measured 2026-07-28, that share was 4.2x
   * slower than the fastest host on an identical res-7 tile, which is the
   * difference between a usable demo and one that looks broken.
   *
   * The cost is herding: every client now tries `endpoints[0]` first. That is
   * acceptable only because the pool is ordered with a FOSSGIS backend in
   * front, and it is the reason the list must stay short and be re-measured
   * rather than treated as settled.
   */
  private pickEndpoint(attempt: number): string {
    return this.endpoints[attempt % this.endpoints.length]!;
  }

  /**
   * Counting semaphore that HANDS THE SLOT OVER rather than releasing it.
   *
   * The distinction is the whole correctness argument. A waiter resumes in a
   * continuation, one microtask after it is woken, so a semaphore that does
   * `active--; queue.shift()?.()` leaves a window in which `active` reads one
   * below the cap while a woken waiter is already committed to running. A
   * caller arriving in that window takes the slot, the waiter then takes it
   * too, and the cap is exceeded — against donated infrastructure that answers
   * that with a 429, which this class treats as an expensive event.
   *
   * So a releaser with someone queued never decrements: it passes its own slot
   * on, already counted, and only the last one out turns the light off.
   */
  private async withConcurrencyLimit<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrent) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
      // No `active++` here: the slot arrived already counted.
    } else {
      this.active++;
    }
    try {
      return await task();
    } finally {
      const next = this.queue.shift();
      if (next === undefined) this.active--;
      else next();
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
