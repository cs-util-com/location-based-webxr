/**
 * OpenTopoData point queries — the fallback, and deliberately a reluctant one.
 *
 * WHY IT IS HERE AT ALL. §7's raster path depends on an open-data S3 bucket
 * with no SLA. If that bucket goes away, "no elevation anywhere" is a worse
 * answer than "elevation for region centroids", so a point provider earns its
 * place as a fallback.
 *
 * WHY IT MUST NOT BE THE PRIMARY, stated in numbers because the temptation is
 * real and the arithmetic is decisive: the public endpoint allows **100
 * locations per request, 1 request per second, 1,000 requests per day** — a
 * hard ceiling of 100,000 points/day for every user of this library combined.
 * One res-7 fetch tile holds ~117,649 res-13 cells. Pointing this at an
 * affordance grid would exhaust the global daily quota with a single tile and
 * would be an abuse of donated infrastructure besides.
 *
 * So it is rate-limited HERE, in the client, rather than discovered by being
 * refused. `maxPointsPerRun` is the guard that turns "we queried too much" from
 * a 429 into a local, visible refusal.
 *
 * @see opentopodata-provider.ts.md
 */

import type { LatLng } from "../model/osm-feature.js";
import type { ElevationProvider } from "./elevation-provider.js";

export const OPENTOPODATA_ATTRIBUTION =
  "Elevation data © OpenTopoData contributors (SRTM / ASTER / EU-DEM)";

/** The documented public limits. Not guesses — see the module comment. */
export const OPENTOPODATA_MAX_LOCATIONS_PER_REQUEST = 100;
export const OPENTOPODATA_MIN_REQUEST_INTERVAL_MS = 1000;

export interface OpenTopoDataOptions {
  readonly fetchImpl?: typeof fetch;
  /** e.g. `https://api.opentopodata.org/v1/srtm30m`. */
  readonly endpoint?: string;
  /**
   * Hard local cap per `elevationAt` call.
   *
   * Default 100 — ONE request. Raising it is a deliberate act; the default
   * refuses to be the thing that quietly spends a shared daily quota.
   */
  readonly maxPointsPerRun?: number;
  readonly now?: () => number;
  readonly sleepImpl?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export class TooManyElevationPointsError extends Error {
  constructor(
    readonly requested: number,
    readonly allowed: number,
  ) {
    super(
      `Refusing to query ${requested} elevation points; the local cap is ${allowed}. ` +
        "OpenTopoData allows 1,000 requests/day GLOBALLY — use a raster provider " +
        "for grids and keep this for centroids.",
    );
    this.name = "TooManyElevationPointsError";
  }
}

/**
 * Point-query elevation, batched and self-throttled.
 */
export class OpenTopoDataProvider implements ElevationProvider {
  readonly attribution = OPENTOPODATA_ATTRIBUTION;
  readonly sourceId = "opentopodata";

  private readonly fetchImpl: typeof fetch;
  private readonly endpoint: string;
  private readonly maxPointsPerRun: number;
  private readonly now: () => number;
  private readonly sleepImpl: (
    ms: number,
    signal?: AbortSignal,
  ) => Promise<void>;

  /**
   * The earliest time the next request may be sent — a reservation, not a log.
   *
   * A "last request at" timestamp cannot express a slot that has been CLAIMED
   * but not yet used, which is the state every waiting concurrent caller is in.
   * See `throttle`.
   */
  private nextSlotAt = Number.NEGATIVE_INFINITY;

  readonly stats = { requests: 0, points: 0, throttleWaitsMs: 0 };

  constructor(options: OpenTopoDataOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.endpoint =
      options.endpoint ?? "https://api.opentopodata.org/v1/srtm30m";
    this.maxPointsPerRun =
      options.maxPointsPerRun ?? OPENTOPODATA_MAX_LOCATIONS_PER_REQUEST;
    this.now = options.now ?? (() => Date.now());
    this.sleepImpl =
      options.sleepImpl ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async elevationAt(
    positions: readonly LatLng[],
    signal?: AbortSignal,
  ): Promise<readonly (number | undefined)[]> {
    if (positions.length === 0) return [];
    if (positions.length > this.maxPointsPerRun) {
      // A LOCAL refusal, not a remote one. Discovering this limit by being
      // rate-limited would mean the quota was already spent.
      throw new TooManyElevationPointsError(
        positions.length,
        this.maxPointsPerRun,
      );
    }

    const out: (number | undefined)[] = [];
    for (
      let i = 0;
      i < positions.length;
      i += OPENTOPODATA_MAX_LOCATIONS_PER_REQUEST
    ) {
      const batch = positions.slice(
        i,
        i + OPENTOPODATA_MAX_LOCATIONS_PER_REQUEST,
      );
      out.push(...(await this.queryBatch(batch, signal)));
    }
    return out;
  }

  private async queryBatch(
    batch: readonly LatLng[],
    signal?: AbortSignal,
  ): Promise<(number | undefined)[]> {
    await this.throttle(signal);

    const locations = batch.map((p) => `${p.lat},${p.lng}`).join("|");
    const url = `${this.endpoint}?locations=${encodeURIComponent(locations)}`;

    try {
      this.stats.requests++;
      this.stats.points += batch.length;

      const response = await this.fetchImpl(url, signal ? { signal } : {});
      if (!response.ok) return batch.map(() => undefined);

      const body = (await response.json()) as unknown;
      return readResults(body, batch.length);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      return batch.map(() => undefined);
    }
  }

  /**
   * Reserves this caller's send slot, then waits for it.
   *
   * THE RESERVATION HAPPENS BEFORE THE AWAIT, and that ordering is the whole
   * point. The previous version read the last request time, computed a wait, and
   * only recorded the request AFTER sleeping — a read-modify-write across an
   * await. Sequential callers were fine, because the first had already written
   * by the time the second read. Overlapping callers all read the same value,
   * computed the same wait, slept it in parallel and fired together: N
   * concurrent `elevationAt` calls meant N requests inside one second, against a
   * documented 1 req/s limit on donated infrastructure. `maxPointsPerRun` cannot
   * catch that — each call is independently under the cap. Raised on #270.
   *
   * `nextSlotAt` is a monotonic chain rather than a "last request" timestamp, so
   * a slot is consumed by the caller that claimed it whether or not the request
   * it was claimed for succeeded. Handing an abandoned slot back would need a
   * queue, and the failure it would prevent — one wasted second — is cheaper
   * than the one it would risk.
   */
  private async throttle(signal?: AbortSignal): Promise<void> {
    const at = Math.max(this.now(), this.nextSlotAt);
    this.nextSlotAt = at + OPENTOPODATA_MIN_REQUEST_INTERVAL_MS;
    const wait = at - this.now();
    if (wait <= 0) return;
    this.stats.throttleWaitsMs += wait;
    await this.sleepImpl(wait, signal);
  }
}

/**
 * Reads `{ results: [{ elevation }] }`, defensively.
 *
 * `elevation` is `null` for points outside the dataset — which is a real answer
 * meaning "no data", not an error, and must not become `0`.
 */
function readResults(body: unknown, expected: number): (number | undefined)[] {
  const out: (number | undefined)[] = Array.from(
    { length: expected },
    () => undefined,
  );
  if (typeof body !== "object" || body === null) return out;

  const results: unknown = (body as { results?: unknown }).results;
  if (!Array.isArray(results)) return out;

  for (let i = 0; i < expected; i++) {
    const entry: unknown = (results as unknown[])[i];
    if (typeof entry !== "object" || entry === null) continue;
    const value = (entry as { elevation?: unknown }).elevation;
    if (typeof value === "number" && Number.isFinite(value)) out[i] = value;
  }
  return out;
}
