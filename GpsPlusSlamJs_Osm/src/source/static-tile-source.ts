/**
 * A static tile host in front of the direct Overpass race.
 *
 * The host stores each fetch tile's Overpass answer as a file, filled the
 * first time anyone asks. This source reads that file; when it is missing it
 * asks the host to fill it and waits a bounded time, but only for a tile
 * someone waits on and only when no other fill is ahead of it. On any
 * refusal, error or timeout it hands the tile to the `fallback` source (the
 * race) at once and stops asking for fills for a while; stored files are
 * still read. The two never run for one tile at the same time.
 *
 * @see static-tile-source.ts.md
 */

import type {
  FetchTileOptions,
  OsmDataSource,
  OsmTileResult,
} from "./osm-data-source.js";
import { OSM_ATTRIBUTION, elapsedMs } from "./osm-data-source.js";
import { parseOverpassJson } from "../model/overpass-parser.js";
import { OVERPASS_SCHEMA_VERSION } from "./overpass-query.js";
import { abortError, sleep } from "./backoff.js";

/**
 * The project's own tile host (the `osm-tiles` Worker). Nothing uses it
 * unless a consumer passes it as `staticTiles.baseUrl`; it lives here so an
 * app and its test fixtures name the same host.
 */
export const OSM_TILES_BASE_URL = "https://osm-tiles.csutil.workers.dev";

export interface StaticTileSourceOptions {
  /** The host's origin, e.g. `https://osm-tiles.example.workers.dev`. */
  readonly baseUrl: string;
  /** Where a tile goes when the host cannot serve it (the direct race). */
  readonly fallback: OsmDataSource;
  readonly fetchImpl?: typeof fetch;
  /** Epoch milliseconds (provenance and the refusal memory). */
  readonly now?: () => number;
  readonly sleepImpl?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Between looks for a queued tile. Default 4 s. */
  readonly pollIntervalMs?: number;
  /**
   * The longest a queued tile is waited for before the race. Default 60 s
   * (a cold tile took 36-56 s to fill when measured).
   */
  readonly maxWaitMs?: number;
  /** How long no fill is asked for after the host said no. Default 10 min. */
  readonly refusalMemoryMs?: number;
  /**
   * A stored tile whose data is older than this is served and the host is
   * asked, once per tile, to refresh it. Default 30 days.
   */
  readonly refreshAfterMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 4_000;
const DEFAULT_MAX_WAIT_MS = 60_000;
const DEFAULT_REFUSAL_MEMORY_MS = 10 * 60_000;
const DEFAULT_REFRESH_AFTER_MS = 30 * 86_400_000;

/** The host could not serve this tile; the reason is for the log only. */
class HostDeclined extends Error {
  override readonly name = "HostDeclined";
}

/**
 * The host is fine but this tile is not worth waiting for here (not stored
 * on a read-only look, or other fills queued ahead): the race, with no
 * refusal remembered.
 */
class HostSkipped extends Error {
  override readonly name = "HostSkipped";
}

/** How many fills the host says are ahead of a queued one; 0 when unsaid. */
async function fillsAhead(response: Response): Promise<number> {
  try {
    const body: unknown = await response.json();
    const ahead =
      typeof body === "object" && body !== null
        ? (body as { ahead?: unknown }).ahead
        : undefined;
    return typeof ahead === "number" && Number.isFinite(ahead) ? ahead : 0;
  } catch {
    return 0;
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function requireBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RangeError(`StaticTileSource: invalid baseUrl ${raw}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new RangeError(`StaticTileSource: baseUrl must be http(s): ${raw}`);
  }
  return url.origin;
}

function requireMs(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`StaticTileSource: ${name} must be >= 0`);
  }
  return value;
}

/** When the host fetched the data (its `X-Filled-At`), if it says. */
function filledAt(response: Response): number | undefined {
  const at = Date.parse(response.headers.get("x-filled-at") ?? "");
  return Number.isFinite(at) ? at : undefined;
}

export class StaticTileSource implements OsmDataSource {
  readonly attribution = OSM_ATTRIBUTION;
  readonly sourceId: string;

  private readonly origin: string;
  private readonly fallback: OsmDataSource;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleepImpl: (
    ms: number,
    signal?: AbortSignal,
  ) => Promise<void>;
  private readonly pollIntervalMs: number;
  private readonly maxWaitMs: number;
  private readonly refusalMemoryMs: number;
  private readonly refreshAfterMs: number;
  /** Until when no fill is asked for (epoch ms); 0 while the host is trusted. */
  private refusedUntil = 0;
  /** Tiles whose refresh was already asked for in this session. */
  private readonly refreshAsked = new Set<string>();

  constructor(options: StaticTileSourceOptions) {
    this.origin = requireBaseUrl(options.baseUrl);
    this.sourceId = `static:${new URL(this.origin).host}`;
    this.fallback = options.fallback;
    this.fetchImpl =
      options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.now = options.now ?? (() => Date.now());
    this.sleepImpl = options.sleepImpl ?? sleep;
    this.pollIntervalMs = requireMs(
      "pollIntervalMs",
      options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    );
    this.maxWaitMs = requireMs(
      "maxWaitMs",
      options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS,
    );
    this.refusalMemoryMs = requireMs(
      "refusalMemoryMs",
      options.refusalMemoryMs ?? DEFAULT_REFUSAL_MEMORY_MS,
    );
    this.refreshAfterMs = requireMs(
      "refreshAfterMs",
      options.refreshAfterMs ?? DEFAULT_REFRESH_AFTER_MS,
    );
  }

  async fetchTile(
    tile: string,
    options?: FetchTileOptions,
  ): Promise<OsmTileResult> {
    if (options?.signal?.aborted === true) throw abortError();
    // A speculative fetch (a ring warm) has nobody waiting on it, and a
    // refused host is not asked for fills; both still read stored files,
    // which cost the host nothing to serve.
    const readOnly =
      options?.speculative === true || this.now() < this.refusedUntil;
    try {
      return await this.fromHost(tile, options?.signal, readOnly);
    } catch (error) {
      return this.afterHostFailed(error, tile, options);
    }
  }

  /** An abort rethrown; any other failure: the race, at once. */
  private afterHostFailed(
    error: unknown,
    tile: string,
    options: FetchTileOptions | undefined,
  ): Promise<OsmTileResult> {
    if (isAbort(error) || options?.signal?.aborted === true) throw error;
    if (!(error instanceof HostSkipped)) {
      this.refusedUntil = this.now() + this.refusalMemoryMs;
    }
    return this.fallback.fetchTile(tile, options);
  }

  private tileUrl(tile: string): string {
    return `${this.origin}/osm/v${OVERPASS_SCHEMA_VERSION}/${tile}.json.gz`;
  }

  private fillUrl(tile: string): string {
    return `${this.origin}/fill/v${OVERPASS_SCHEMA_VERSION}/${tile}`;
  }

  private async fromHost(
    tile: string,
    signal: AbortSignal | undefined,
    readOnly: boolean,
  ): Promise<OsmTileResult> {
    const started = this.now();
    const first = await this.read(tile, signal, started);
    if (first !== undefined) return first;
    if (readOnly) throw new HostSkipped(`tile ${tile} not stored`);
    if ((await this.askForFill(tile, signal)) === "present") {
      const ready = await this.read(tile, signal, started);
      if (ready !== undefined) return ready;
      throw new HostDeclined(`tile ${tile} announced but missing`);
    }
    return this.waitForFill(tile, signal, started);
  }

  /** `present` (200), `queued` (202, nothing ahead); a throw otherwise. */
  private async askForFill(
    tile: string,
    signal: AbortSignal | undefined,
  ): Promise<"present" | "queued"> {
    const fill = await this.fetchImpl(this.fillUrl(tile), {
      method: "POST",
      ...(signal === undefined ? {} : { signal }),
    });
    if (fill.status === 202) {
      const ahead = await fillsAhead(fill);
      // Each fill ahead takes 30-75 s, so the bounded wait would run out:
      // the race now, and the host fills the tile for whoever comes later.
      if (ahead > 0) throw new HostSkipped(`${ahead} fills ahead of ${tile}`);
      return "queued";
    }
    await fill.body?.cancel();
    if (fill.status === 200) return "present";
    throw new HostDeclined(`fill answered ${fill.status}`);
  }

  /** Looks again for a queued tile until the bounded wait is spent. */
  private async waitForFill(
    tile: string,
    signal: AbortSignal | undefined,
    started: number,
  ): Promise<OsmTileResult> {
    while (this.now() - started + this.pollIntervalMs <= this.maxWaitMs) {
      await this.sleepImpl(this.pollIntervalMs, signal);
      const polled = await this.read(tile, signal, started);
      if (polled !== undefined) return polled;
    }
    throw new HostDeclined(
      `tile ${tile} not filled within ${this.maxWaitMs} ms`,
    );
  }

  /** The stored tile, `undefined` on a 404, a throw on anything else. */
  private async read(
    tile: string,
    signal: AbortSignal | undefined,
    started: number,
  ): Promise<OsmTileResult | undefined> {
    const response = await this.fetchImpl(this.tileUrl(tile), {
      ...(signal === undefined ? {} : { signal }),
    });
    if (response.status === 404) {
      await response.body?.cancel();
      return undefined;
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new HostDeclined(`tile answered ${response.status}`);
    }
    // The host stores gzip with `Content-Encoding: gzip`, so the browser has
    // already decoded it: the text is the Overpass answer as sent.
    const text = await response.text();
    const transportMs = elapsedMs(started, this.now());
    const decodeStart = this.now();
    const payload: unknown = JSON.parse(text);
    const decodeMs = elapsedMs(decodeStart, this.now());
    const parseStart = this.now();
    const parsed = parseOverpassJson(payload);
    this.refreshIfOld(tile, parsed.osmBaseTimestamp);
    return {
      tile,
      features: parsed.features,
      fetchedAt: filledAt(response) ?? this.now(),
      sourceId: this.sourceId,
      schemaVersion: OVERPASS_SCHEMA_VERSION,
      skipped: parsed.skipped,
      ...(parsed.osmBaseTimestamp !== undefined
        ? { osmBaseTimestamp: parsed.osmBaseTimestamp }
        : {}),
      timings: {
        servedBy: "network",
        slotWaitMs: 0,
        transportMs,
        decodeMs,
        parseMs: elapsedMs(parseStart, this.now()),
        attempts: 1,
      },
    };
  }

  /**
   * Asks the host, once per tile and without waiting, to refetch a stored
   * tile whose data is old; the old file is served meanwhile. Skipped while
   * the host refuses fills; a failed ask is ignored.
   */
  private refreshIfOld(tile: string, osmBase: string | undefined): void {
    const base = Date.parse(osmBase ?? "");
    if (!Number.isFinite(base)) return;
    if (this.now() - base <= this.refreshAfterMs) return;
    if (this.now() < this.refusedUntil || this.refreshAsked.has(tile)) return;
    this.refreshAsked.add(tile);
    this.fetchImpl(this.fillUrl(tile), { method: "POST" }).then(
      (response) => response.body?.cancel(),
      () => undefined,
    );
  }
}
