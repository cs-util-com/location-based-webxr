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
import {
  OSM_ATTRIBUTION,
  elapsedMs,
  joinedTimings,
} from "./osm-data-source.js";
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
import { operatorForUrl } from "./overpass-operators.js";
import { planEndpointOrder, type OperatorWeights } from "./endpoint-order.js";
import { InFlightRequests } from "./in-flight-requests.js";

/**
 * Default endpoint pool.
 *
 * **THE ORDER IS NO LONGER THE SELECTION RULE (M6, 2026-08-19).** It used to be:
 * `pickEndpoint` walked this list from the front and did not shuffle, so every
 * client tried entry 0 first — the herding that decision knowingly accepted, and
 * the 429 the twelfth testing session reported. Selection now happens in
 * `endpoint-order.ts`, as a weighted draw over OPERATORS
 * ({@link DEFAULT_OPERATOR_WEIGHTS}), and this list contributes two things to
 * it: which endpoints exist, and the order of an operator's own entries.
 *
 * The measurement below is kept because it is still the evidence for the
 * weights, and because the two facts it establishes about the pool's SHAPE —
 * which entries are the same instance — do not expire the way the timings do.
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
  /**
   * MONOTONIC clock for durations, deliberately separate from {@link now}.
   *
   * `now` is epoch milliseconds and is user-visible provenance — `fetchedAt`
   * renders as "OSM data from March 2026" — so it cannot be swapped for a
   * monotonic source. But `Date.now()` steps backwards on an NTP correction,
   * and a fetch measured in tens of seconds is exactly where that lands,
   * producing a negative `transportMs` inside a breakdown whose whole job is to
   * add up. Two clocks, each doing the one thing it is right for.
   */
  readonly monotonicNow?: () => number;
  readonly sleepImpl?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /**
   * Relative likelihood per OPERATOR in the per-tile endpoint draw.
   *
   * Defaults to {@link DEFAULT_OPERATOR_WEIGHTS}. Supply your own when you pass
   * a custom `endpoints` pool, or the operators in it fall back to the neutral
   * weight and the draw is uniform over them — which is exactly the behaviour
   * the 2026-07-28 measurement removed.
   */
  readonly operatorWeights?: OperatorWeights;
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

/**
 * Retries after the first attempt.
 *
 * **RAISED FROM 3 TO 4 ON 2026-08-19, and the old value made a pool entry
 * unreachable.** The loop is `attempt <= maxRetries`, so 3 gave attempts 0–3 —
 * four of the five endpoints. With the old `attempt % length` selection that
 * meant bare `overpass-api.de` was never asked by any request, in the shipped
 * configuration, silently. `endpoint-order.ts` now returns a permutation and
 * this reaches all of it.
 *
 * **WHAT IT COSTS, stated properly — an earlier version of this comment claimed
 * it cost nothing and was wrong three times over.** It said every attempt is
 * gated by the slot budget (it is not: `tryAcquire` runs once per TILE, in
 * `fetchTileUncached`, and all five attempts ride that one slot), that the
 * fifth attempt needs "four operators-worth of hosts" to refuse (the default
 * pool has THREE operators), and that the change was free (it is not).
 *
 * For a tile where everything refuses, against the default pool:
 *
 * - **requests to FOSSGIS go from 2 to 3.** The draw spends attempts 0–2 on
 *   three distinct operators, so the added attempts are the remaining FOSSGIS
 *   entries — i.e. the extra request goes to a quota already known to have said
 *   no.
 * - **backoff sleeps go from 1 to 2**, because attempts 3 and 4 both follow a
 *   refused operator. With `Retry-After` that is up to +30 s of wall clock.
 *
 * That is the price of making a pool entry reachable at all, and it is paid
 * only on the fully-refusing path — a permanent failure still escapes the loop
 * immediately, and any success ends it. It is recorded here rather than
 * defended, because the results doc's own finding is that 504s are the normal
 * path (25 % of attempts), so this is not a corner case. **The follow-up worth
 * taking:** once every distinct operator has refused, the remaining entries are
 * near-certainly futile, and stopping there would recover both the request and
 * the sleep.
 *
 * **The number is coupled to the DEFAULT pool's size**, and it travels: a
 * caller passing a single self-hosted endpoint inherits five attempts and four
 * sleeps against one host. Override `maxRetries` alongside `endpoints`.
 */
const DEFAULT_MAX_RETRIES = 4;

/**
 * How the pool's three operators are weighted in the per-tile draw.
 *
 * **FROM A MEASUREMENT, AND DELIBERATELY COARSER THAN IT.** The run is
 * `docs/overpass-sweep-2026-08-19-arealonly-res78.json` — 24 cells, the
 * `areal-only` form production actually sends, two resolutions, two rounds —
 * written up in
 * `GpsPlusSlamJs_Docs/docs/2026-08-19-0430-overpass-endpoint-and-resolution-remeasure-results.md`.
 * Successes only, median seconds:
 *
 * - **fossgis** — res 7: 27.7 (n=4), res 8: 21.6 (n=5). Answered **9 of 11**.
 * - **vk-maps** — res 7: 15.9 (n=1), res 8: 21.4 (n=2). Answered **3 of 4**.
 * - **private.coffee** — res 7: 59.9 (n=3), res 8: 179.3 (n=1). Answered
 *   **4 of 7**.
 *
 * **What the data supports, stated no more strongly than that.**
 * `private.coffee` IS separated, on both axes at once: 57 % availability, and
 * medians 2.2x (res 7) to 8.3x (res 8) FOSSGIS's, including one 179 s success.
 * That demotion is evidence-backed.
 *
 * **The 4:3 between the two fast operators is NOT.** Their res-8 medians differ
 * by 0.2 s; the availability gap is 9/11 against 3/4, which one flipped result
 * would erase; and FOSSGIS has more samples only because the benchmark's host
 * list carries three FOSSGIS URLs to VK's one, which is a property of the
 * inventory rather than of the operator. An earlier version of this comment
 * offered those last two as grounds — a reviewer was right that they are noise
 * and circularity respectively. **4:3 is a near-tie broken arbitrarily**, and it
 * is written down as arbitrary so nobody later "preserves" a ranking that was
 * never measured. 1:1 would be equally defensible; what matters is that neither
 * is anywhere near `private.coffee`.
 *
 * A weight computed as `1 / median` would be a precise function of noise —
 * `spatial/resolutions.ts` records the same work at 15.1 / 32.9 / 82.9 / 91.1 s
 * — so these are tiers, and `operator-weights-evidence.test.ts` guards only
 * what the run can settle: that a materially more RELIABLE operator is never
 * weighted below a less reliable one.
 *
 * **These expire.** The strict order they replaced was one sample per host from
 * one location at one time of day, and it lasted three weeks before a field
 * session reported the herding it caused. Re-run
 * `node scripts/benchmark-endpoints.mjs --matrix --forms areal-only
 * --resolutions 8,7 --repeats 2 --out <dated>.json` and revise.
 */
export const DEFAULT_OPERATOR_WEIGHTS: OperatorWeights = Object.freeze({
  fossgis: 4,
  "vk-maps": 3,
  "private.coffee": 1,
});

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
  /**
   * The distinct operators this pool can reach, in no particular order.
   *
   * Held because the slot budget's only refusal point runs BEFORE an endpoint
   * is drawn (see `fetchTileUncached`) and therefore has to be told which
   * quotas are even in play. Computed once: the pool is immutable.
   */
  private readonly poolOperators: readonly string[];
  private readonly fetchImpl: typeof fetch;
  private readonly maxConcurrent: number;
  private readonly maxRetries: number;
  private readonly timeoutSeconds: number;
  private readonly backoff: BackoffOptions;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly monotonicNow: () => number;
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
  private readonly operatorWeights: OperatorWeights;

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
    this.monotonicNow = resolved.monotonicNow;
    this.sleepImpl = resolved.sleepImpl;
    this.selectKeys = resolved.selectKeys;
    this.maxAttemptLog = resolved.maxAttemptLog;
    this.operatorWeights = resolved.operatorWeights;
    this.budget =
      resolved.budget ?? new OverpassSlotBudget({ now: () => this.now() });
    this.poolOperators = [...new Set(this.endpoints.map(operatorForUrl))];
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
    // THE POOL'S FIRST ENTRY, not a drawn one. This asks a host how many slots
    // it will give us, and the answer is only useful for the host most likely
    // to be asked for a tile — which the weights make the first entry, most of
    // the time. Drawing here would sample a different host than the fetch does
    // and correct the budget against a quota we may never spend.
    const endpoint = this.endpoints[0] as string;
    try {
      const response = await this.fetchImpl(statusUrlFor(endpoint), {
        headers: { "User-Agent": this.userAgent },
        ...(signal !== undefined ? { signal } : {}),
      });
      if (!response.ok) return undefined;
      const status = parseOverpassStatus(await response.text());
      this.budget.sync(status, operatorForUrl(endpoint));
      return status;
    } catch {
      return undefined;
    }
  }

  async fetchTile(tile: string, signal?: AbortSignal): Promise<OsmTileResult> {
    // READ BEFORE JOINING, because joining is what makes this caller a joiner.
    const joined = this.inFlight.has(tile);
    if (joined) this.stats.deduplicated++;
    const startedAt = this.monotonicNow();
    // The joined callers' signals are deliberately NOT the one the request runs
    // on — see `in-flight-requests.ts`. The movement trigger and an explicit
    // prefetch are the two callers most likely to collide here, and they have
    // different lifetimes.
    const result = await this.inFlight.join(
      tile,
      (dedupSignal) =>
        this.withConcurrencyLimit((slotWaitMs) =>
          this.fetchTileUncached(tile, slotWaitMs, dedupSignal),
        ),
      signal,
    );
    if (!joined) return result;
    return {
      ...result,
      timings: joinedTimings(elapsedMs(startedAt, this.monotonicNow())),
    };
  }

  private async fetchTileUncached(
    tile: string,
    slotWaitMs: number,
    signal?: AbortSignal,
  ): Promise<OsmTileResult> {
    // Take a slot BEFORE building anything. Refusing here is the whole point of
    // the budget: a request not sent cannot be rate-limited, and the caller is
    // far better placed than we are to decide between serving cache and waiting.
    // QUALIFIED BY THE POOL, and that qualification is the F2c fix at this
    // level. This runs once per tile, before any endpoint is drawn, so an
    // unqualified ask would refuse the tile whenever ANY operator held a
    // penalty — which is how one 429 from FOSSGIS used to stop the client
    // talking to VK for 35 s. Refusing only when every operator is blocked
    // keeps `RateLimitedError` meaning "there is nowhere to go", which is what
    // `CachingSource`'s stale-serve and `area-loader`'s prefetch back-off both
    // branch on.
    if (!this.budget.tryAcquire(this.poolOperators)) {
      this.stats.rateLimited++;
      throw new RateLimitedError(
        `Overpass slot budget exhausted for tile ${tile}`,
        this.budget.msUntilAvailable(this.poolOperators),
      );
    }
    try {
      return await this.fetchTileWithSlot(tile, slotWaitMs, signal);
    } finally {
      this.budget.release();
    }
  }

  private async fetchTileWithSlot(
    tile: string,
    slotWaitMs: number,
    signal?: AbortSignal,
  ): Promise<OsmTileResult> {
    const query = buildTileQuery(
      cellToBoundingBox(tile),
      this.timeoutSeconds,
      this.selectKeys,
    );

    let lastError: unknown;
    // TRANSPORT IS CLOCKED AROUND THE WHOLE LOOP, backoff sleeps included, and
    // `attempts` is reported next to it so the two readings that produce the
    // same number stay distinguishable: a big `transportMs` at one attempt is a
    // slow server, and the same figure at three attempts is mostly sleeping.
    const transportStart = this.monotonicNow();
    // Operators this tile has already had refused, so the backoff can tell
    // "wait for a quota to recover" from "ask somebody else". See
    // `shouldWaitBeforeRetry`.
    const refusedOperators = new Set<string>();
    // DRAWN ONCE FOR THIS TILE. See `planAttemptOrder`.
    const attemptOrder = this.planAttemptOrder();
    // attempt 0 is the initial try; 1..maxRetries are retries.
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      throwIfAborted(signal);
      // Walk the order drawn for this tile. The modulo is a backstop for a
      // `maxRetries` larger than the pool, not the selection rule — the rule is
      // in `endpoint-order.ts`, and the order it returns already guarantees
      // that the first attempts hit distinct operators.
      const endpoint = attemptOrder[attempt % attemptOrder.length] as string;
      // Recorded before the request rather than after it fails: every path out
      // of this iteration other than success is a refusal, and recording it in
      // one place beats three.
      refusedOperators.add(operatorForUrl(endpoint));
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
          return await this.toResult(tile, endpoint, response, {
            slotWaitMs,
            transportStart,
            attempts: attempt + 1,
          });
        }

        if (!RETRYABLE_STATUSES.has(response.status)) {
          throw new PermanentOverpassError(
            `Overpass ${endpoint} returned ${response.status} ${response.statusText}`,
          );
        }
        this.noteRateLimit(response, endpoint);
        lastError = new Error(
          `Overpass ${endpoint} returned ${response.status} ${response.statusText}`,
        );
        await this.waitBeforeRetry(
          attempt,
          response,
          signal,
          refusedOperators,
          attemptOrder,
        );
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
        await this.waitBeforeRetry(
          attempt,
          undefined,
          signal,
          refusedOperators,
          attemptOrder,
        );
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
  private noteRateLimit(response: Response, endpoint: string): void {
    if (response.status !== 429) return;
    const retryAfterMs = parseRetryAfterMs(
      response.headers.get("Retry-After"),
      this.now(),
    );
    // THE ENDPOINT IS PASSED IN, not read off `response.url`. Tests inject a
    // fake `fetchImpl` whose responses carry no url, and a silently
    // unattributed penalty would fall back to blocking the whole pool — the
    // bug, restored, in exactly the configuration that tests it.
    this.budget.penalise(
      retryAfterMs ?? DEFAULT_RATE_LIMIT_PENALTY_MS,
      operatorForUrl(endpoint),
    );
    this.stats.rateLimited++;
  }

  /**
   * Whether to sleep before the next attempt — or rotate to a fresh operator
   * and ask immediately.
   *
   * THE DEFECT THIS REMOVES (twelfth testing session, F2c). The loop rotates
   * endpoints on every attempt AND slept the full backoff between them, so a
   * 429 from `lz4.overpass-api.de` made the client wait for **FOSSGIS's** quota
   * to recover — honouring `Retry-After`, clamped at 30 s — and then ask
   * `maps.mail.ru`, a different operator whose quota was never the problem. The
   * owner measured a 429 followed by "another 30 seconds" before anything
   * appeared. The sleep bought nothing for the host about to be asked.
   *
   * So the rule is: **sleep only when the next attempt would return to an
   * operator that has already refused.** Backoff is preserved exactly where it
   * is meaningful — pressure on a quota — and dropped where it was only
   * latency.
   *
   * With the default pool and the M6 draw, the first three attempts go to three
   * DIFFERENT operators, so none of them waits; the first wait is before the
   * **fourth** attempt, which is the first that must revisit a refused quota.
   * (This paragraph said "the attempt after that — `z.overpass-api.de`" until
   * the M6 draw landed and made it false: under the old fixed walk the third
   * attempt was `z.`, FOSSGIS again. The test in the same commit had the new
   * behaviour right while this comment still described the old one.)
   *
   * IT ALSO CATCHES A PURE-WASTE SLEEP NOBODY REPORTED: the retryable-status
   * path had no `attempt >= maxRetries` guard, so the LAST attempt slept up to
   * 30 s and then fell out of the loop and threw. Nothing could ever use that
   * time. The first clause below covers it.
   */
  private shouldWaitBeforeRetry(
    attempt: number,
    refusedOperators: ReadonlySet<string>,
    attemptOrder: readonly string[],
  ): boolean {
    // Nothing follows this attempt, so there is nothing to wait for.
    if (attempt >= this.maxRetries) return false;
    const next = attemptOrder[(attempt + 1) % attemptOrder.length] as string;
    return refusedOperators.has(operatorForUrl(next));
  }

  /**
   * Waits before the next attempt — **or returns immediately**, when the next
   * attempt goes somewhere the backoff cannot help.
   *
   * The decision lives in {@link shouldWaitBeforeRetry} and is applied HERE
   * rather than at the two call sites, so "retry pacing" stays one concept in
   * one place and the loop keeps reading as `…; await waitBeforeRetry(…);`.
   */
  private async waitBeforeRetry(
    attempt: number,
    response: Response | undefined,
    signal: AbortSignal | undefined,
    refusedOperators: ReadonlySet<string>,
    attemptOrder: readonly string[],
  ): Promise<void> {
    if (!this.shouldWaitBeforeRetry(attempt, refusedOperators, attemptOrder)) {
      return;
    }
    const delay = nextDelayMs(
      attempt,
      response?.headers.get("Retry-After"),
      this.now(),
      { ...this.backoff, random: this.backoff.random ?? this.random },
    );
    await this.sleepImpl(delay, signal);
  }

  /**
   * Body to decoded payload, with the two costs told apart.
   *
   * **ITS OWN FRAME ON PURPOSE, and that is the whole reason this is not
   * inlined.** `response.json()` does both steps in one opaque call and its
   * intermediate string is engine-owned, collectable the instant parsing ends.
   * Splitting them means holding a ~21 MB body — up to ~42 MB as a JS string —
   * in a local, and inlined that local would stay reachable through
   * `parseOverpassJson` as well, on a phone, alongside both the decoded payload
   * and the constructed features. Returning drops the frame and the string with
   * it; a `text = undefined` line would say the same thing but is exactly the
   * kind of assignment a linter deletes.
   */
  private async readAndDecode(
    response: Response,
    transportStart: number,
  ): Promise<{
    readonly payload: unknown;
    readonly transportMs: number;
    readonly decodeMs: number;
  }> {
    const bodyText = await response.text();
    const transportMs = elapsedMs(transportStart, this.monotonicNow());
    const decodeStart = this.monotonicNow();
    const payload: unknown = JSON.parse(bodyText);
    return {
      payload,
      transportMs,
      decodeMs: elapsedMs(decodeStart, this.monotonicNow()),
    };
  }

  private async toResult(
    tile: string,
    endpoint: string,
    response: Response,
    clocks: {
      readonly slotWaitMs: number;
      readonly transportStart: number;
      readonly attempts: number;
    },
  ): Promise<OsmTileResult> {
    // READ AS TEXT, THEN PARSE, rather than `response.json()` — the one
    // production change the fetch/parse split costs. `.json()` does both in one
    // opaque step, and the two are the terms the click-path plan needs told
    // apart: V8 decoding ~21 MB of text is a different cost from
    // `parseOverpassJson` walking the elements, and a single number covering
    // both ranks them together and names neither.
    //
    // `JSON.parse` on an HTML error page throws exactly as `.json()` did; that
    // is a retryable-shaped failure, so let it propagate into the attempt
    // loop's catch. (The comment that used to name `.json()` here moved with
    // the code rather than being left describing a method that is gone.)
    const { payload, transportMs, decodeMs } = await this.readAndDecode(
      response,
      clocks.transportStart,
    );

    const parseStart = this.monotonicNow();
    const parsed = parseOverpassJson(payload);
    const parseMs = elapsedMs(parseStart, this.monotonicNow());

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
      timings: {
        servedBy: "network",
        slotWaitMs: clocks.slotWaitMs,
        transportMs,
        decodeMs,
        parseMs,
        attempts: clocks.attempts,
      },
    };
  }

  /**
   * The endpoints this tile will try, in order — drawn once per fetch.
   *
   * ONCE PER FETCH, NOT PER ATTEMPT, and that is what makes the sequence mean
   * anything: the draw decides an ORDER, and re-drawing between attempts would
   * let the same operator come up twice while another had never been tried.
   * `shouldWaitBeforeRetry` reads the same array to see where the next attempt
   * is going, so both must be looking at one decision.
   *
   * The design and the two versions it replaces are documented in
   * `endpoint-order.ts` — this is the seam, not the policy.
   */
  private planAttemptOrder(): readonly string[] {
    const order = planEndpointOrder(
      this.endpoints,
      this.operatorWeights,
      this.random,
    );
    // Spending an attempt on a quota that has already refused is the same
    // waste `shouldWaitBeforeRetry` removes one layer down, and here it is
    // cheaper to avoid: the penalty is known before the request is built.
    // `isBlocked`, NOT `availableFor`. The latter also reports zero when the
    // shared allocation is spent, which is the ordinary state during an area
    // load — two slots, two tiles in flight — and `planAttemptOrder` runs
    // AFTER this tile's own `tryAcquire` took one. Filtering on it therefore
    // emptied `live` under load and fell through to the unfiltered order, so
    // the skip did nothing precisely when it was needed. Found by the
    // milestone review.
    const live = order.filter(
      (endpoint) => !this.budget.isBlocked(operatorForUrl(endpoint)),
    );
    // NOT an empty order. `fetchTileUncached` only admits a tile when some
    // operator is free, so this is reachable only through a genuine race — a
    // shared budget penalised by another source between the acquire and the
    // draw. An empty order would turn that into a tile that silently makes zero
    // requests and reports "no data" rather than a rate limit.
    return live.length > 0 ? live : order;
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
  /**
   * @param task receives how long it waited for its slot, in ms.
   *   **Passed down rather than measured inside** because the wait is a real
   *   stage of the click the user is waiting through: folded into
   *   `transportMs` it reads as a slow server, and dropped it reads as time
   *   that never happened. The plan found it the same way it found the terrain
   *   join — by reading the handler, not from the stage list.
   */
  private async withConcurrencyLimit<T>(
    task: (slotWaitMs: number) => Promise<T>,
  ): Promise<T> {
    const queuedAt = this.monotonicNow();
    let slotWaitMs = 0;
    if (this.active >= this.maxConcurrent) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
      slotWaitMs = elapsedMs(queuedAt, this.monotonicNow());
      // No `active++` here: the slot arrived already counted.
    } else {
      this.active++;
    }
    try {
      return await task(slotWaitMs);
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
 * A monotonic millisecond clock, falling back where there is no `performance`.
 *
 * The fallback is for a runtime that has not defined the global — some test
 * environments, and older embedded ones. Durations are reported in whole
 * milliseconds, so the two clocks agree to well within the reporting
 * resolution; what matters is that a missing global cannot throw inside the
 * fetch path.
 */
function defaultMonotonicNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
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
    monotonicNow: defaultMonotonicNow,
    sleepImpl: sleep,
    maxAttemptLog: DEFAULT_MAX_ATTEMPT_LOG,
    operatorWeights: DEFAULT_OPERATOR_WEIGHTS,
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
