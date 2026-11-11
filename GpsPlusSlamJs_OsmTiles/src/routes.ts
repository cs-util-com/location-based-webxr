/**
 * The Worker's HTTP surface: open GETs of stored tiles and the manifest,
 * and the guarded fill endpoint that enqueues a missing tile.
 *
 * @see routes.ts.md
 */

import type { OsmTilesEnv, TileObjectHead } from "./bindings";
import {
  MANIFEST_KEY,
  msUntilNextUtcDay,
  readDaily,
  readFailure,
} from "./fill-state";
import { REFRESH_AGE_MS } from "./fill-tile";
import { parseTileCell, TILE_PREFIX, tileObjectKey } from "./tile-cell";

export interface RouteDeps {
  readonly env: OsmTilesEnv;
  readonly now: () => number;
}

/** Upstream requests a UTC day may spend when the var is unset or invalid. */
const DEFAULT_DAILY_UPSTREAM_CAP = 300;

/** Seconds a client should wait before looking for a queued tile. */
const FILL_RETRY_AFTER_S = 15;

/** Seconds a client should wait after the per-IP limit said no. */
const LIMIT_RETRY_AFTER_S = 60;

const TILE_PATH = new RegExp(`^/${TILE_PREFIX}([^/]+)\\.json\\.gz$`);
const FILL_PATH = /^\/fill\/v3\/([^/]+)$/;
const PREVIEW_ORIGIN = /^https:\/\/[a-z0-9-]+\.csutil\.workers\.dev$/;
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

const SERVICE_TEXT = `osm-tiles: OpenStreetMap data as static files, one per H3 resolution-7 cell.

GET  /osm/v3/<cell>.json.gz  the Overpass "out geom" JSON of that cell (gzip)
GET  /osm/v3/manifest.tsv    every stored cell: cell, data timestamp, stored bytes
POST /fill/v3/<cell>         ask for a missing cell to be filled (app origins only)

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

export function dailyUpstreamCap(env: OsmTilesEnv): number {
  const parsed = Number(env.DAILY_UPSTREAM_CAP);
  return Number.isInteger(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_DAILY_UPSTREAM_CAP;
}

function openHeaders(): Headers {
  return new Headers({
    "access-control-allow-origin": "*",
    "access-control-expose-headers":
      "X-Osm-Base, X-Filled-At, Last-Modified, ETag",
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
  headers.set("last-modified", object.uploaded.toUTCString());
  const base = object.customMetadata?.["osmBase"];
  if (base !== undefined) headers.set("x-osm-base", base);
  const filledAt = object.customMetadata?.["filledAt"];
  if (filledAt !== undefined) headers.set("x-filled-at", filledAt);
  return headers;
}

/**
 * A response whose body is the stored gzip, sent as is. Without
 * `encodeBody: "manual"` the Workers runtime compresses the body a second
 * time under the same header.
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
  return passThrough(object.body, 200, tileHeaders(object));
}

async function serveManifest(deps: RouteDeps): Promise<Response> {
  const object = await deps.env.TILES.get(MANIFEST_KEY);
  const headers = openHeaders();
  headers.set("content-type", "text/tab-separated-values; charset=utf-8");
  headers.set("cache-control", "public, max-age=300");
  return new Response(object === null ? "" : object.body, {
    status: 200,
    headers,
  });
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

async function handleFill(
  request: Request,
  rawCell: string,
  deps: RouteDeps,
): Promise<Response> {
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
  const limited = await deps.env.FILL_LIMITER?.limit({ key: ip });
  if (limited !== undefined && !limited.success) {
    return fillAnswer(429, { status: "limited" }, origin, LIMIT_RETRY_AFTER_S);
  }
  const now = deps.now();
  const url = `${new URL(request.url).origin}/${tileObjectKey(cell)}`;
  const existing = await deps.env.TILES.head(tileObjectKey(cell));
  if (existing !== null) {
    if (!isOld(existing, now))
      return fillAnswer(200, { status: "present", url }, origin);
    await deps.env.FILL_QUEUE.send({ cell, kind: "refresh", at: now });
    return fillAnswer(200, { status: "refreshing", url }, origin);
  }
  const failure = await readFailure(deps.env.TILES, cell);
  if (failure !== undefined && failure.retryAt > now) {
    const wait = Math.ceil((failure.retryAt - now) / 1000);
    return fillAnswer(503, { status: "backoff" }, origin, wait);
  }
  const daily = await readDaily(deps.env.TILES, now);
  if (daily.upstreamRequests >= dailyUpstreamCap(deps.env)) {
    const wait = Math.ceil(msUntilNextUtcDay(now) / 1000);
    return fillAnswer(503, { status: "cap" }, origin, wait);
  }
  await deps.env.FILL_QUEUE.send({ cell, kind: "fill", at: now });
  return fillAnswer(202, { status: "queued", url }, origin, FILL_RETRY_AFTER_S);
}

export async function handleRequest(
  request: Request,
  deps: RouteDeps,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  const fill = FILL_PATH.exec(path);
  if (fill !== null) {
    if (request.method !== "POST" && request.method !== "OPTIONS") {
      return new Response("method not allowed\n", { status: 405 });
    }
    return handleFill(request, fill[1] as string, deps);
  }
  const readable = request.method === "GET" || request.method === "HEAD";
  if (path === `/${MANIFEST_KEY}`) {
    return readable ? serveManifest(deps) : new Response(null, { status: 405 });
  }
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
