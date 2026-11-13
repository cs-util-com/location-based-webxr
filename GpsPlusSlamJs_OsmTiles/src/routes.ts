/**
 * The Worker's HTTP surface: open GETs of stored tiles, the guarded fill
 * endpoint that enqueues a missing tile, and the guarded report endpoint
 * that enqueues a verify of a tile a viewer found bad. There is
 * deliberately no list of stored tiles (see routes.ts.md, "No list of
 * stored tiles").
 *
 * @see routes.ts.md
 */

import type { FillMessage, OsmTilesEnv, TileObjectHead } from "./bindings";
import {
  clearPending,
  listPending,
  markPending,
  msUntilNextUtcDay,
  readDaily,
  readFailure,
  readVerifiedEtag,
  type PendingFill,
} from "./fill-state";
import { REFRESH_AGE_MS } from "./fill-tile";
import {
  FILL_PREFIX,
  parseTileCell,
  REPORT_PREFIX,
  TILE_PREFIX,
  tileObjectKey,
} from "./tile-cell";
import { strongEtag } from "./verify-tile";

export interface RouteDeps {
  readonly env: OsmTilesEnv;
  readonly now: () => number;
}

/** Upstream requests a UTC day may spend when the var is unset or invalid. */
const DEFAULT_DAILY_UPSTREAM_CAP = 300;

/**
 * Verifies of reported tiles a UTC day may run when the var is unset or
 * invalid. A verify costs CPU only (no upstream request); a dense tile's
 * inflate leans on the Free plan's burst budget, so the day is bounded.
 */
const DEFAULT_DAILY_VERIFY_CAP = 50;

/** Seconds a client should wait before looking for a queued tile. */
const FILL_RETRY_AFTER_S = 15;

/** Seconds a client should wait after the per-IP limit said no. */
const LIMIT_RETRY_AFTER_S = 60;

/**
 * Queued or running fills at which the endpoint answers busy, when the var
 * is unset or invalid. A fill takes 30-75 s (measured), so four ahead is
 * several minutes: past any viewer's wait, and enough to keep the store
 * filling in the background without a long queue.
 */
const DEFAULT_MAX_PENDING_FILLS = 4;

/** Seconds a client should wait after a busy answer. */
const BUSY_RETRY_AFTER_S = 60;

const TILE_PATH = new RegExp(`^/${TILE_PREFIX}([^/]+)\\.json\\.gz$`);
const FILL_PATH = new RegExp(`^/${FILL_PREFIX}([^/]+)$`);
const REPORT_PATH = new RegExp(`^/${REPORT_PREFIX}([^/]+)$`);
const PREVIEW_ORIGIN = /^https:\/\/[a-z0-9-]+\.csutil\.workers\.dev$/;
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

const SERVICE_TEXT = `osm-tiles: OpenStreetMap data as static files, one per H3 resolution-7 cell.

GET  /${TILE_PREFIX}<cell>.json.gz  the Overpass "out geom" JSON of that cell
POST /${FILL_PREFIX}<cell>         ask for a missing cell to be filled (app origins only)
POST /${REPORT_PREFIX}<cell>?etag=  report a stored cell as broken; the service
                                checks the stored file itself (app origins only)

Data (c) OpenStreetMap contributors, available under the Open Database
Licence (ODbL) 1.0: https://www.openstreetmap.org/copyright
The files are an unmodified copy of the public Overpass API's answer to one
fixed query per cell; the query and this service's source code are in
https://github.com/cs-util-com/location-based-webxr (GpsPlusSlamJs_OsmTiles).
`;

/**
 * The fill endpoint's origin allowlist. A hotlink guard only: an `Origin`
 * header is free for any script, so the real bounds are the per-IP limit
 * and the daily cap.
 */
export function isAllowedFillOrigin(origin: string): boolean {
  return (
    origin === "https://gps.csutil.com" ||
    PREVIEW_ORIGIN.test(origin) ||
    LOCAL_ORIGIN.test(origin)
  );
}

function nonNegativeInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return raw !== undefined &&
    raw !== "" &&
    Number.isInteger(parsed) &&
    parsed >= 0
    ? parsed
    : fallback;
}

export function dailyUpstreamCap(env: OsmTilesEnv): number {
  return nonNegativeInt(env.DAILY_UPSTREAM_CAP, DEFAULT_DAILY_UPSTREAM_CAP);
}

export function dailyVerifyCap(env: OsmTilesEnv): number {
  return nonNegativeInt(env.DAILY_VERIFY_CAP, DEFAULT_DAILY_VERIFY_CAP);
}

function maxPendingFills(env: OsmTilesEnv): number {
  return nonNegativeInt(env.MAX_PENDING_FILLS, DEFAULT_MAX_PENDING_FILLS);
}

/** The licence notice every stored tile carries, as there is no list to hold it. */
const LICENSE_LINK = '<https://www.openstreetmap.org/copyright>; rel="license"';
const DATA_LICENSE = "ODbL-1.0; (c) OpenStreetMap contributors";

function openHeaders(): Headers {
  return new Headers({
    "access-control-allow-origin": "*",
    "access-control-expose-headers": "X-Osm-Base, X-Data-License, Link, ETag",
  });
}

function notFound(): Response {
  const headers = openHeaders();
  headers.set("cache-control", "no-store");
  headers.set("content-type", "text/plain; charset=utf-8");
  return new Response("not found\n", { status: 404, headers });
}

function tileHeaders(object: TileObjectHead): Headers {
  const headers = openHeaders();
  const meta = object.httpMetadata;
  headers.set("content-type", meta?.contentType ?? "application/json");
  if (meta?.contentEncoding !== undefined) {
    headers.set("content-encoding", meta.contentEncoding);
  }
  headers.set("cache-control", meta?.cacheControl ?? "public, max-age=86400");
  headers.set("etag", object.httpEtag);
  headers.set("link", LICENSE_LINK);
  headers.set("x-data-license", DATA_LICENSE);
  const base = object.customMetadata?.["osmBase"];
  if (base !== undefined) headers.set("x-osm-base", base);
  return headers;
}

/**
 * A response whose body is the stored gzip, sent as is. Without
 * `encodeBody: "manual"` the Workers runtime compresses the body a second
 * time under the same header. An object stored uncompressed is sent as a
 * plain response instead, which the edge compresses per client.
 *
 * No Cache API in front of R2, measured: `caches.default` keeps such a body
 * as if it were plain content and gzips it again on every hit, so a client
 * decoding once received gzip instead of JSON. R2 alone answered the 3 MB
 * Cologne tile as fast as the cache did (1.5-2.0 s either way, one client).
 */
function passThrough(
  body: ReadableStream | null,
  status: number,
  headers: Headers,
): Response {
  const init = { status, headers, encodeBody: "manual" } as ResponseInit;
  return new Response(body, init);
}

async function serveTile(
  request: Request,
  rawCell: string,
  deps: RouteDeps,
): Promise<Response> {
  const cell = parseTileCell(rawCell);
  if (cell === undefined) return notFound();
  const head = request.method === "HEAD";
  const key = tileObjectKey(cell);
  if (head) {
    const object = await deps.env.TILES.head(key);
    if (object === null) return notFound();
    return new Response(null, { status: 200, headers: tileHeaders(object) });
  }
  const object = await deps.env.TILES.get(key);
  if (object === null) return notFound();
  const headers = tileHeaders(object);
  if (object.httpMetadata?.contentEncoding === undefined) {
    return new Response(object.body, { status: 200, headers });
  }
  return passThrough(object.body, 200, headers);
}

function fillCors(origin: string): Headers {
  return new Headers({ "access-control-allow-origin": origin, vary: "Origin" });
}

function fillAnswer(
  status: number,
  body: Record<string, unknown>,
  origin: string,
  retryAfterS?: number,
): Response {
  const headers = fillCors(origin);
  headers.set("content-type", "application/json");
  headers.set("cache-control", "no-store");
  if (retryAfterS !== undefined) {
    headers.set("retry-after", String(retryAfterS));
    headers.set("access-control-expose-headers", "Retry-After");
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function isOld(object: TileObjectHead, now: number): boolean {
  const base = Date.parse(object.customMetadata?.["osmBase"] ?? "");
  return Number.isFinite(base) && now - base >= REFRESH_AGE_MS;
}

/**
 * Marks the cell pending and sends the message; false when either failed,
 * with the marker removed again so it does not count as backlog.
 */
async function enqueue(
  message: FillMessage,
  deps: RouteDeps,
): Promise<boolean> {
  try {
    await markPending(deps.env.TILES, message.cell, message.at);
    await deps.env.FILL_QUEUE.send(message);
    return true;
  } catch (error) {
    console.log(
      JSON.stringify({
        enqueue: "failed",
        cell: message.cell,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    await clearPending(deps.env.TILES, message.cell).catch(() => undefined);
    return false;
  }
}

interface FillContext {
  readonly cell: string;
  readonly origin: string;
  readonly url: string;
  readonly now: number;
}

function unavailable(origin: string): Response {
  return fillAnswer(503, { status: "unavailable" }, origin, BUSY_RETRY_AFTER_S);
}

/** A stored tile: its URL, and one refresh queued when its data is old. */
async function answerStored(
  existing: TileObjectHead,
  ctx: FillContext,
  deps: RouteDeps,
): Promise<Response> {
  const present = fillAnswer(
    200,
    { status: "present", url: ctx.url },
    ctx.origin,
  );
  if (!isOld(existing, ctx.now)) return present;
  // A refresh is an upstream request like a fill: it waits out the cell's
  // failure backoff and the day's cap, and the old file serves meanwhile.
  const failure = await readFailure(deps.env.TILES, ctx.cell);
  if (failure !== undefined && failure.retryAt > ctx.now) return present;
  const daily = await readDaily(deps.env.TILES, ctx.now);
  if (daily.upstreamRequests >= dailyUpstreamCap(deps.env)) return present;
  const pending = await listPending(deps.env.TILES, ctx.now);
  const refreshing = fillAnswer(
    200,
    { status: "refreshing", url: ctx.url },
    ctx.origin,
  );
  if (pending.some((p) => p.cell === ctx.cell)) return refreshing;
  // A refresh is never worth a busy queue: the old file still serves.
  if (pending.length >= maxPendingFills(deps.env)) return present;
  const message = { cell: ctx.cell, kind: "refresh", at: ctx.now } as const;
  return (await enqueue(message, deps)) ? refreshing : unavailable(ctx.origin);
}

/** A missing tile: queued unless backoff, the cap or the backlog says no. */
async function answerMissing(
  ctx: FillContext,
  deps: RouteDeps,
): Promise<Response> {
  const { cell, origin, now } = ctx;
  // The failure record comes first: a running fill writes one before its
  // first attempt, and a killed fill leaves it behind with its marker. The
  // two cannot be told apart here, so a POST during a live fill answers
  // backoff too: that viewer races, as without the host, which is never
  // slower than waiting a minute on a fill that was killed. Clients treat
  // backoff as a fact about this cell only.
  const failure = await readFailure(deps.env.TILES, cell);
  if (failure !== undefined && failure.retryAt > now) {
    const wait = Math.ceil((failure.retryAt - now) / 1000);
    return fillAnswer(503, { status: "backoff" }, origin, wait);
  }
  const pending: PendingFill[] = await listPending(deps.env.TILES, now);
  const ahead = pending.filter((p) => p.cell !== cell).length;
  const queued = { status: "queued", url: ctx.url, ahead };
  if (ahead < pending.length) {
    return fillAnswer(202, queued, origin, FILL_RETRY_AFTER_S);
  }
  const daily = await readDaily(deps.env.TILES, now);
  if (daily.upstreamRequests >= dailyUpstreamCap(deps.env)) {
    const wait = Math.ceil(msUntilNextUtcDay(now) / 1000);
    return fillAnswer(503, { status: "cap" }, origin, wait);
  }
  if (ahead >= maxPendingFills(deps.env)) {
    return fillAnswer(
      503,
      { status: "busy", ahead },
      origin,
      BUSY_RETRY_AFTER_S,
    );
  }
  const message = { cell, kind: "fill", at: now } as const;
  if (!(await enqueue(message, deps))) return unavailable(origin);
  return fillAnswer(202, queued, origin, FILL_RETRY_AFTER_S);
}

/**
 * The guards both POST endpoints share, in order: the origin allowlist
 * (403), the preflight, cell validation (400) and the per-IP limit under
 * `limitKey(ip)` (429). Returns the answer to send, or the checked cell.
 */
async function guardPost(
  request: Request,
  rawCell: string,
  deps: RouteDeps,
  limitKey: (ip: string) => string,
): Promise<Response | { cell: string; origin: string }> {
  const origin = request.headers.get("origin") ?? "";
  if (!isAllowedFillOrigin(origin)) {
    return new Response("origin not allowed\n", { status: 403 });
  }
  if (request.method === "OPTIONS") {
    const headers = fillCors(origin);
    headers.set("access-control-allow-methods", "POST, OPTIONS");
    headers.set("access-control-max-age", "86400");
    return new Response(null, { status: 204, headers });
  }
  const cell = parseTileCell(rawCell);
  if (cell === undefined) {
    return fillAnswer(400, { status: "invalid-cell" }, origin);
  }
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const limited = await deps.env.FILL_LIMITER?.limit({ key: limitKey(ip) });
  if (limited !== undefined && !limited.success) {
    return fillAnswer(429, { status: "limited" }, origin, LIMIT_RETRY_AFTER_S);
  }
  return { cell, origin };
}

async function handleFill(
  request: Request,
  rawCell: string,
  deps: RouteDeps,
): Promise<Response> {
  const guard = await guardPost(request, rawCell, deps, (ip) => ip);
  if (guard instanceof Response) return guard;
  const { cell, origin } = guard;
  const ctx: FillContext = {
    cell,
    origin,
    url: `${new URL(request.url).origin}/${tileObjectKey(cell)}`,
    now: deps.now(),
  };
  const existing = await deps.env.TILES.head(tileObjectKey(cell));
  return existing === null
    ? answerMissing(ctx, deps)
    : answerStored(existing, ctx, deps);
}

/**
 * A viewer found the stored tile bad (not JSON, no elements, a remark).
 * The report only ever queues a verify of the object it names; the serial
 * consumer judges the stored bytes and deletes only a bad tile, so a forged
 * report can cost CPU (bounded per IP and per day) but never a good tile
 * or an upstream request.
 */
async function handleReport(
  request: Request,
  rawCell: string,
  deps: RouteDeps,
): Promise<Response> {
  const guard = await guardPost(request, rawCell, deps, (ip) => `report:${ip}`);
  if (guard instanceof Response) return guard;
  const { cell, origin } = guard;
  const named = new URL(request.url).searchParams.get("etag");
  if (named === null || named === "") {
    return fillAnswer(400, { status: "invalid-etag" }, origin);
  }
  const existing = await deps.env.TILES.head(tileObjectKey(cell));
  if (existing === null) return fillAnswer(200, { status: "missing" }, origin);
  if (strongEtag(named) !== existing.httpEtag) {
    return fillAnswer(200, { status: "stale" }, origin);
  }
  if ((await readVerifiedEtag(deps.env.TILES, cell)) === existing.httpEtag) {
    return fillAnswer(200, { status: "verified" }, origin);
  }
  const now = deps.now();
  const daily = await readDaily(deps.env.TILES, now);
  if (daily.verifies >= dailyVerifyCap(deps.env)) {
    const wait = Math.ceil(msUntilNextUtcDay(now) / 1000);
    return fillAnswer(503, { status: "cap" }, origin, wait);
  }
  try {
    await deps.env.FILL_QUEUE.send({
      cell,
      kind: "verify",
      at: now,
      etag: existing.httpEtag,
    });
  } catch (error) {
    console.log(
      JSON.stringify({
        report: "enqueue-failed",
        cell,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return unavailable(origin);
  }
  return fillAnswer(202, { status: "checking" }, origin);
}

/** The POST endpoints: their handler for a matching path, else undefined. */
function postEndpoint(
  path: string,
): { handle: typeof handleFill; rawCell: string } | undefined {
  const fill = FILL_PATH.exec(path);
  if (fill !== null) return { handle: handleFill, rawCell: fill[1] as string };
  const report = REPORT_PATH.exec(path);
  if (report !== null) {
    return { handle: handleReport, rawCell: report[1] as string };
  }
  return undefined;
}

export async function handleRequest(
  request: Request,
  deps: RouteDeps,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  const endpoint = postEndpoint(path);
  if (endpoint !== undefined) {
    if (request.method !== "POST" && request.method !== "OPTIONS") {
      return new Response("method not allowed\n", { status: 405 });
    }
    return endpoint.handle(request, endpoint.rawCell, deps);
  }
  const readable = request.method === "GET" || request.method === "HEAD";
  const tile = TILE_PATH.exec(path);
  if (tile !== null) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: openHeaders() });
    }
    if (!readable) return new Response("method not allowed\n", { status: 405 });
    return serveTile(request, tile[1] as string, deps);
  }
  if (path === "/" && readable) {
    return new Response(SERVICE_TEXT, {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return notFound();
}
