// @ts-check
/**
 * Local archive server for the e2e suite: builds one test zip IN MEMORY at
 * startup (no committed fixture — the repo caps tracked files at 2 MiB and a
 * generated archive can never rot out of sync with the specs) and serves it
 * on two routes:
 *
 * - `/ranges-ok/tour.zip`  — honors `Range` with 206 slices (plus HEAD with
 *   Content-Length/ETag, and a 200 full body for range-less GETs, which is
 *   what the background warm-download issues).
 * - `/no-ranges/tour.zip`  — IGNORES `Range` and streams the whole body with
 *   200, the "host without range support" the fallback path exists for.
 * - `/flippable/tour.zip` — 200 full body with a SETTABLE ETag (`/flip`),
 *   the "author overwrote the archive at the same URL" host the
 *   revalidation spec drives.
 * - `/slow-warm/tour.zip` — ranges like `ranges-ok`, but a range-less GET
 *   (the background warm download) is HELD while the warm gate is closed
 *   (`/warm-gate?state=hold` / `?state=release`) — the deterministic
 *   in-flight-warm window the clear-cache-during-warm spec needs.
 *
 * CORS: the app origin (the vite port) differs from this server's,
 * and `Range` is not a CORS-safelisted request header, so the preflight
 * OPTIONS must allow it and `Content-Range`/`ETag` must be exposed.
 */

import { createServer } from "node:http";
import {
  TextReader,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipWriter,
} from "@zip.js/zip.js";

const port = Number(process.argv[2] ?? "5197");

/** 1×1 red PNG — a real decodable image, 67 bytes. */
const TINY_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (c) => c.codePointAt(0),
);

async function buildZip() {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { level: 0 });
  await writer.add("session.json", new TextReader('{"kind":"e2e-tour"}'));
  for (let i = 0; i < 8; i += 1) {
    await writer.add(
      `images/frame-${String(i)}.png`,
      new Uint8ArrayReader(TINY_PNG.slice()),
    );
  }
  // Padding entry so the archive is comfortably larger than what a
  // metadata+images session needs — the partial-fetch assertion depends on
  // the gap being wide.
  await writer.add("padding.bin", new TextReader("p".repeat(200_000)));
  return writer.close();
}

const zipBytes = await buildZip();
const ETAG = '"e2e-tour-v1"';

/**
 * The `/flippable/tour.zip` route's ETag version — settable via
 * `/flip?etag=<v>` (explicit set, not a toggle, so a retried spec stays
 * deterministic). Only the revalidation spec uses this route, so the global
 * state cannot leak into parallel siblings.
 */
let flippableEtagVersion = "v1";

/**
 * The `/slow-warm` route's warm gate: while held, range-less GETs (the warm
 * download) queue instead of answering; `release` answers everything queued
 * and lets later ones straight through. Explicit hold/release (never a
 * toggle) keeps a retried spec deterministic, and `release` is idempotent so
 * ordering between the release call and the queued request cannot deadlock.
 * Only the clear-cache-during-warm spec drives this route, so the global
 * state cannot leak into parallel siblings.
 */
let warmGate = { released: true, waiters: [] };

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "range,if-none-match,if-modified-since",
  "access-control-expose-headers": "content-range,content-length,etag",
};

/** The utility routes: preflight + health. True if handled. */
function handleUtilityRoute(req, res, pathname) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS).end();
    return true;
  }
  if (pathname === "/health") {
    res.writeHead(200, CORS_HEADERS).end("ok");
    return true;
  }
  return false;
}

/** `/flip?etag=v2` — change what the flippable route reports as its ETag. */
function handleFlip(res, url) {
  flippableEtagVersion = url.searchParams.get("etag") ?? "v1";
  res.writeHead(200, CORS_HEADERS).end(flippableEtagVersion);
}

/** `/warm-gate?state=hold|release` — control the `/slow-warm` warm gate. */
function handleWarmGate(res, url) {
  const state = url.searchParams.get("state");
  if (state === "hold") {
    warmGate = { released: false, waiters: [] };
  } else {
    warmGate.released = true;
    for (const answer of warmGate.waiters) answer();
    warmGate.waiters = [];
  }
  res.writeHead(200, CORS_HEADERS).end(warmGate.released ? "released" : "held");
}

/** Serve the archive: HEAD metadata, 206 slices (ranges-ok), or a 200 body. */
function handleArchive(req, res, mode) {
  const baseHeaders = {
    ...CORS_HEADERS,
    etag: mode === "flippable" ? `"e2e-tour-${flippableEtagVersion}"` : ETAG,
    "last-modified": "Mon, 24 Aug 2026 12:00:00 GMT",
  };
  if (req.method === "HEAD") {
    res
      .writeHead(200, {
        ...baseHeaders,
        "content-length": String(zipBytes.length),
      })
      .end();
    return;
  }
  const range = req.headers.range;
  const rangeMatch =
    (mode === "ranges-ok" || mode === "slow-warm") && typeof range === "string"
      ? /^bytes=(\d+)-(\d+)$/.exec(range)
      : null;
  if (rangeMatch !== null) {
    const start = Number(rangeMatch[1]);
    const end = Math.min(Number(rangeMatch[2]), zipBytes.length - 1);
    const slice = zipBytes.slice(start, end + 1);
    res
      .writeHead(206, {
        ...baseHeaders,
        "content-range": `bytes ${String(start)}-${String(end)}/${String(zipBytes.length)}`,
        "content-length": String(slice.length),
      })
      .end(Buffer.from(slice));
    return;
  }
  const answer = () => {
    res
      .writeHead(200, {
        ...baseHeaders,
        "content-length": String(zipBytes.length),
      })
      .end(Buffer.from(zipBytes));
  };
  if (mode === "slow-warm" && !warmGate.released) {
    warmGate.waiters.push(answer); // held until /warm-gate?state=release
    return;
  }
  answer();
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${String(port)}`);
  if (handleUtilityRoute(req, res, url.pathname)) return;
  if (url.pathname === "/flip") {
    handleFlip(res, url);
    return;
  }
  if (url.pathname === "/warm-gate") {
    handleWarmGate(res, url);
    return;
  }
  const match = /^\/(ranges-ok|no-ranges|flippable|slow-warm)\/tour\.zip$/.exec(
    url.pathname,
  );
  if (match === null) {
    res.writeHead(404, CORS_HEADERS).end();
    return;
  }
  handleArchive(req, res, match[1]);
}).listen(port, () => {
  console.log(`archive-server on http://127.0.0.1:${String(port)}`);
});
