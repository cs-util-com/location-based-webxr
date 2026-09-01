/**
 * The Drive CORS proxy: streams a public Google Drive file through the
 * site's own origin so the browser-blocked keyless endpoint (403 on any
 * request carrying `Sec-Fetch-Site: cross-site`) becomes reachable from the
 * TourViewer. A worker's fetch carries no `Sec-Fetch-*` headers, so
 * upstream sees a plain client — the exact shape the 2026-08-26 spike
 * verified gets `206` + `content-range` on ranged reads.
 *
 * Abuse posture (owner decision, 2026-08-26): accept-as-bounded. The CORS
 * allowlist below restricts BROWSERS on foreign origins only; the actual
 * bound is the Workers free tier's hard request cap, which cannot convert
 * into money. Only Drive is reachable, by construction of the upstream URL.
 */

/** Injected in every test; the entry point passes the runtime's fetch. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const UPSTREAM_BASE = "https://drive.usercontent.google.com/download";

/** Loose on purpose: ids are opaque values (PR #357 review) and
 *  encodeURIComponent is the injection guard — only length, emptiness and
 *  path separators are worth refusing. */
const MAX_ID_LENGTH = 300;

/** Request headers that may cross the boundary toward Drive. Nothing else
 *  does — a viewer's cookies or auth must never leak upstream. */
const FORWARDED_REQUEST_HEADERS = [
  "range",
  "if-none-match",
  "if-modified-since",
] as const;

/** Response headers copied back; also the Expose list, so browser JS can
 *  actually read them (richer than GitHub raw, which omits the Expose
 *  header and forces the transport to limp around it). */
const FORWARDED_RESPONSE_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
] as const;

const EXPOSE_HEADERS =
  "Content-Type, Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified";

/** Dev servers only — production is same-origin with the worker and never
 *  needs CORS. Covers the repo's documented device-test flows too (vite
 *  `host: true` on the LAN, ngrok for HTTPS — milestone review, finding 2);
 *  widening this costs nothing, because CORS was never the abuse guard
 *  (it binds browsers alone — the free-tier request cap is the bound). */
const DEV_ORIGIN =
  /^(?:http:\/\/(?:localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})(?::\d+)?|https:\/\/[\w-]+\.ngrok-free\.app)$/;

export interface DriveProxyOptions {
  fetchImpl: FetchLike;
}

export async function handleDriveProxy(
  request: Request,
  options: DriveProxyOptions,
): Promise<Response> {
  const cors = corsHeaders(request);
  if (request.method === "OPTIONS") return preflight(cors);
  if (request.method !== "GET" && request.method !== "HEAD") {
    return jsonError(405, "only GET, HEAD and OPTIONS are supported", cors);
  }

  const id = new URL(request.url).searchParams.get("id");
  if (
    id === null ||
    id === "" ||
    id.length > MAX_ID_LENGTH ||
    id.includes("/")
  ) {
    return jsonError(
      400,
      "the id query parameter must be a Google Drive file id (non-empty, at most 300 characters, no slashes)",
      cors,
    );
  }

  const upstreamUrl = `${UPSTREAM_BASE}?id=${encodeURIComponent(id)}&export=download&confirm=t`;
  const upstreamHeaders = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) upstreamHeaders.set(name, value);
  }
  const upstream = await options.fetchImpl(upstreamUrl, {
    method: request.method,
    headers: upstreamHeaders,
  });

  const isHtml = (upstream.headers.get("content-type") ?? "").includes(
    "text/html",
  );
  // text/html on a SUCCESS is the virus-scan interstitial leaking past
  // confirm=t — never stream HTML into a zip parser. On an ERROR status it
  // is just Drive's HTML error page (bogus id → 404 page, non-public file →
  // sign-in page): the STATUS is the information, and it must pass through
  // unchanged — a 502 here would make a deleted Drive file unclassifiable
  // as 'missing' downstream and served from the local cache forever
  // (milestone review, finding 1).
  if (upstream.ok && isHtml) {
    return jsonError(
      502,
      "Drive answered with its virus-scan interstitial HTML page instead of the file",
      cors,
    );
  }

  const headers = new Headers(cors);
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  headers.set("access-control-expose-headers", EXPOSE_HEADERS);
  // HEAD must answer body-less WITH the explicit content-length: the
  // Workers runtime chunk-encodes streamed bodies and drops the length, and
  // the transport sizes the archive from this probe — a lost size silently
  // degrades every Drive tour to full-download (plan Rev 2, finding 3).
  // An error's HTML body is dropped too: the status carries the meaning,
  // and the page's markup is dead weight toward a zip parser.
  const isHeadRequest = request.method === "HEAD";
  const body = isHeadRequest || isHtml ? null : upstream.body;
  // When the HTML body is dropped on a GET, the upstream's content-length
  // must not ride along — announcing ~1500 bytes and sending 0 is a
  // malformed response the browser may surface as a network error, which
  // downstream misclassifies as 'cors' instead of the 404 it is (PR #369
  // review). HEAD keeps the length: body-less-with-length is its contract.
  if (isHtml && !isHeadRequest) headers.set("content-length", "0");
  return new Response(body, { status: upstream.status, headers });
}

/** CORS response headers for this request: the echoed dev origin, or none.
 *  `Vary: Origin` always, so caches never serve one origin's answer to
 *  another. Exported for the dispatcher's own JSON answers (the /api/* 404)
 *  — without CORS a dev-origin caller sees an opaque CORS failure instead
 *  of the readable error body (PR #369 review). */
export function corsHeaders(request: Request): Headers {
  const headers = new Headers({ vary: "Origin" });
  const origin = request.headers.get("origin");
  if (origin !== null && DEV_ORIGIN.test(origin)) {
    headers.set("access-control-allow-origin", origin);
  }
  return headers;
}

function preflight(cors: Headers): Response {
  const headers = new Headers(cors);
  headers.set("access-control-allow-methods", "GET, HEAD, OPTIONS");
  headers.set(
    "access-control-allow-headers",
    "Range, If-None-Match, If-Modified-Since",
  );
  headers.set("access-control-max-age", "86400");
  return new Response(null, { status: 204, headers });
}

function jsonError(status: number, message: string, cors: Headers): Response {
  const headers = new Headers(cors);
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify({ error: message }), { status, headers });
}
