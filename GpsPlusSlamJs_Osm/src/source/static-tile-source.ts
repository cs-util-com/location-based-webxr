/**
 * A static tile host in front of the direct Overpass race.
 *
 * The host stores each fetch tile's Overpass answer as a file, filled the
 * first time anyone asks. This source reads that file; when it is missing it
 * asks the host to fill it and waits a bounded time, but only for a tile
 * someone waits on and only when no other fill is ahead of it. On any
 * refusal, error or timeout it hands the tile to the `fallback` source (the
 * race) at once and stops asking for fills for a while; stored files are
 * still read. The two never run for one tile at the same time. A stored file
 * that is not a complete Overpass answer goes to the race too, and is
 * reported to the host once.
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
import { composeSignals } from "./compose-signals.js";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  isPartialOverpassAnswer,
} from "./overpass-source.js";

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
  /**
   * The longest one request to the host may take, body included, before the
   * tile goes to the race. Default: the race's own per-request deadline
   * (`DEFAULT_REQUEST_TIMEOUT_MS`, 45 s), so the host never gives up on a
   * download the race would still be waiting for.
   */
  readonly requestTimeoutMs?: number;
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
 * on a read-only look, other fills queued ahead, or the cell in fill
 * backoff): the race, with no refusal remembered.
 */
class HostSkipped extends Error {
  override readonly name = "HostSkipped";
}

/**
 * The stored file is not a complete Overpass answer (not JSON, no `elements`
 * array, or a top-level `remark`, Overpass's mark of a partial answer). The
 * host is fine; this one file is bad: the race, with no refusal remembered.
 */
class BadStoredTile extends Error {
  override readonly name = "BadStoredTile";
}

/** Releases a body nobody reads; a rejected cancel() changes nothing. */
async function discardBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

/** The parsed stored answer, or the refusal when it is not a complete one. */
function checkStored(text: string, tile: string): object | BadStoredTile {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return new BadStoredTile(`tile ${tile} is not JSON`);
  }
  if (typeof payload !== "object" || payload === null) {
    return new BadStoredTile(`tile ${tile} is not a JSON object`);
  }
  if (!Array.isArray((payload as { elements?: unknown }).elements)) {
    return new BadStoredTile(`tile ${tile} has no elements array`);
  }
  if (isPartialOverpassAnswer(payload)) {
    return new BadStoredTile(`tile ${tile} is a partial answer (remark)`);
  }
  return payload;
}

/** The fill answer's JSON fields; empty when the body is not a JSON object. */
async function fillBody(
  response: Response,
): Promise<{ status?: unknown; ahead?: unknown }> {
  try {
    const body: unknown = await response.json();
    return typeof body === "object" && body !== null ? body : {};
  } catch {
    return {};
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

function requirePositiveMs(name: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`StaticTileSource: ${name} must be > 0`);
  }
  return value;
}

/** The data's age from its `osm_base`, if the answer carries a valid one. */
function osmBaseMs(osmBase: string | undefined): number | undefined {
  const at = Date.parse(osmBase ?? "");
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
  private readonly requestTimeoutMs: number;
  /** Until when no fill is asked for (epoch ms); 0 while the host is trusted. */
  private refusedUntil = 0;
  /** Tiles whose refresh was already asked for in this session. */
  private readonly refreshAsked = new Set<string>();
  /** Tiles already reported bad in this session. */
  private readonly reported = new Set<string>();

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
    this.requestTimeoutMs = requirePositiveMs(
      "requestTimeoutMs",
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
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
    const speculative = options?.speculative === true;
    const readOnly = speculative || this.now() < this.refusedUntil;
    try {
      return await this.fromHost(tile, options?.signal, readOnly, speculative);
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
    if (!(error instanceof HostSkipped || error instanceof BadStoredTile)) {
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

  private reportUrl(tile: string, etag: string): string {
    return `${this.origin}/report/v${OVERPASS_SCHEMA_VERSION}/${tile}?etag=${encodeURIComponent(etag)}`;
  }

  /**
   * One request to the host under the time limit; the caller's signal, when
   * given, still aborts it. The limit covers the body read too.
   */
  private request(
    url: string,
    signal: AbortSignal | undefined,
    init: { readonly method?: "POST"; readonly cache?: RequestCache } = {},
  ): Promise<Response> {
    const limited = composeSignals(
      signal,
      AbortSignal.timeout(this.requestTimeoutMs),
    );
    return this.fetchImpl(url, {
      ...(init.method === undefined ? {} : { method: init.method }),
      ...(init.cache === undefined ? {} : { cache: init.cache }),
      ...(limited === undefined ? {} : { signal: limited }),
    });
  }

  private async fromHost(
    tile: string,
    signal: AbortSignal | undefined,
    readOnly: boolean,
    speculative: boolean,
  ): Promise<OsmTileResult> {
    const started = this.now();
    const first = await this.read(tile, signal, started, speculative);
    if (first !== undefined) return first;
    if (readOnly) throw new HostSkipped(`tile ${tile} not stored`);
    if ((await this.askForFill(tile, signal)) === "present") {
      const ready = await this.read(tile, signal, started, speculative);
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
    const fill = await this.request(this.fillUrl(tile), signal, {
      method: "POST",
    });
    if (fill.status === 200) {
      await discardBody(fill);
      return "present";
    }
    const { status, ahead } = await fillBody(fill);
    if (fill.status === 202) {
      // Each fill ahead takes 30-75 s, so the bounded wait would run out:
      // the race now, and the host fills the tile for whoever comes later.
      if (typeof ahead === "number" && ahead > 0) {
        throw new HostSkipped(`${ahead} fills ahead of ${tile}`);
      }
      return "queued";
    }
    // Backoff concerns this one cell (its fill failed, was killed or is
    // running), so other tiles may still be filled.
    if (fill.status === 503 && status === "backoff") {
      throw new HostSkipped(`tile ${tile} in fill backoff`);
    }
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
      const polled = await this.read(tile, signal, started, false);
      if (polled !== undefined) return polled;
    }
    throw new HostDeclined(
      `tile ${tile} not filled within ${this.maxWaitMs} ms`,
    );
  }

  /**
   * The stored tile, `undefined` on a 404, a throw on anything else.
   * `started` is when the tile was first asked for: the time before this read
   * (the wait for the host's fill) is reported as `slotWaitMs`, and only this
   * read's own round trip as `transportMs`.
   */
  private async read(
    tile: string,
    signal: AbortSignal | undefined,
    started: number,
    speculative: boolean,
  ): Promise<OsmTileResult | undefined> {
    const readStart = this.now();
    let stored = await this.readStored(tile, signal);
    if (stored === undefined) return undefined;
    let transportMs = elapsedMs(readStart, this.now());
    let decodeStart = this.now();
    let checked = checkStored(stored.text, tile);
    if (checked instanceof BadStoredTile) {
      // The browser may hold an older copy in its HTTP cache than the host
      // now stores (the host replaces bad tiles): read once more past that
      // cache before calling the tile bad or reporting it.
      stored = await this.readStored(tile, signal, "no-cache");
      if (stored === undefined) return undefined;
      transportMs = elapsedMs(readStart, this.now());
      decodeStart = this.now();
      checked = checkStored(stored.text, tile);
      if (checked instanceof BadStoredTile) {
        // A speculative read asks the host for nothing, a report included.
        if (!speculative) this.reportBad(tile, stored.etag);
        throw checked;
      }
    }
    const payload = checked;
    const decodeMs = elapsedMs(decodeStart, this.now());
    const parseStart = this.now();
    const parsed = parseOverpassJson(payload);
    if (!speculative) this.refreshIfOld(tile, parsed.osmBaseTimestamp);
    return {
      tile,
      features: parsed.features,
      fetchedAt: osmBaseMs(parsed.osmBaseTimestamp) ?? this.now(),
      sourceId: this.sourceId,
      schemaVersion: OVERPASS_SCHEMA_VERSION,
      skipped: parsed.skipped,
      ...(parsed.osmBaseTimestamp !== undefined
        ? { osmBaseTimestamp: parsed.osmBaseTimestamp }
        : {}),
      timings: {
        servedBy: "network",
        slotWaitMs: elapsedMs(started, readStart),
        transportMs,
        decodeMs,
        parseMs: elapsedMs(parseStart, this.now()),
        attempts: 1,
      },
    };
  }

  /**
   * The stored file's text and ETag, `undefined` on a 404, a throw on any
   * other status. A body-read failure (a `TypeError` from `text()`) is a
   * host failure, like a network drop: the two cannot be told apart here.
   */
  private async readStored(
    tile: string,
    signal: AbortSignal | undefined,
    cache?: RequestCache,
  ): Promise<
    { readonly text: string; readonly etag: string | null } | undefined
  > {
    const response = await this.request(
      this.tileUrl(tile),
      signal,
      cache === undefined ? {} : { cache },
    );
    if (response.status === 404) {
      await discardBody(response);
      return undefined;
    }
    if (response.status !== 200) {
      await discardBody(response);
      throw new HostDeclined(`tile answered ${response.status}`);
    }
    // The host sends `Content-Encoding` (gzip from the operator, or the
    // edge's own compression of a raw file), so the browser has already
    // decoded it: the text is the Overpass answer as sent.
    return { text: await response.text(), etag: response.headers.get("etag") };
  }

  /**
   * Asks the host, once per tile and without waiting, to refetch a stored
   * tile whose data is old; the old file is served meanwhile. Skipped while
   * the host refuses fills and for speculative reads (nobody waits on them,
   * so they ask the host for nothing); a failed ask is ignored.
   */
  private refreshIfOld(tile: string, osmBase: string | undefined): void {
    const base = Date.parse(osmBase ?? "");
    if (!Number.isFinite(base)) return;
    if (this.now() - base <= this.refreshAfterMs) return;
    if (this.now() < this.refusedUntil || this.refreshAsked.has(tile)) return;
    this.refreshAsked.add(tile);
    this.request(this.fillUrl(tile), undefined, { method: "POST" }).then(
      discardBody,
      () => undefined,
    );
  }

  /**
   * Tells the host, once per tile per session and without waiting, that its
   * stored file is bad. The host checks the file itself before deleting
   * anything, so the report names the object read (its ETag); without one
   * there is nothing to name and nothing is sent. A failed report is ignored.
   */
  private reportBad(tile: string, etag: string | null): void {
    if (etag === null || etag === "" || this.reported.has(tile)) return;
    this.reported.add(tile);
    this.request(this.reportUrl(tile, etag), undefined, {
      method: "POST",
    }).then(discardBody, () => undefined);
  }
}
