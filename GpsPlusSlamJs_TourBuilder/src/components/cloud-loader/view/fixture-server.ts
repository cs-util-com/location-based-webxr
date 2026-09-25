/**
 * A local HTTP fixture server that serves a real `packTour` zip under
 * path-selected behaviours (C9). It exists so every §2.5.6 network branch —
 * honouring Range, refusing it, 404, 416, a truncated file, a CORS/connection
 * failure — is exercised deterministically with no cloud provider involved.
 *
 * Node's `fetch` (undici) performs real 206/Content-Range/redirect handling, so
 * these tests catch the header mistakes that actually bite in production. The
 * one thing Node cannot reproduce is *browser* CORS enforcement, so `/no-cors`
 * approximates it by dropping the connection (C10) — the real CORS block is
 * proven in the manual browser demo.
 *
 * @see plans/2026-07-24-cloud-loader-plan.md (C9, C10)
 */

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

import { packTour } from "../../packaging/core/pack-tour.js";
import type { Tour } from "../../../store/types.js";

export interface FixtureServer {
  /** Origin like `http://127.0.0.1:53421`. */
  readonly origin: string;
  /** The exact bytes served (so tests can assert asset slices). */
  readonly zip: Uint8Array;
  /** Number of HTTP requests seen whose path starts with `pathPrefix` (default: all). */
  requestCount(pathPrefix?: string): number;
  close(): Promise<void>;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": "Content-Range, Accept-Ranges",
};

interface ServeZipOptions {
  /** `false` → ignore Range and answer 200 with the whole body. */
  honorRange: boolean;
  /** `false` → the HEAD omits Content-Length, forcing the loader to recover
   *  the size from the 206 Content-Range (the proxy path). */
  sendHeadContentLength: boolean;
  /** `false` → the 206 omits Content-Range too, so no size is recoverable at
   *  all and the loader must degrade to a plain full download. */
  sendContentRange: boolean;
}

/** Serve a zip body honouring (or, for `no-ranges`, ignoring) the Range header. */
function serveZip(
  req: IncomingMessage,
  res: ServerResponse,
  body: Uint8Array,
  opts: ServeZipOptions,
): void {
  if (req.method === "HEAD") {
    res
      .writeHead(200, {
        ...CORS,
        "Accept-Ranges": "bytes",
        ...(opts.sendHeadContentLength
          ? { "Content-Length": String(body.length) }
          : {}),
      })
      .end();
    return;
  }

  const range = opts.honorRange
    ? parseRange(req.headers.range, body.length)
    : null;
  if (!range) {
    res
      .writeHead(200, { ...CORS, "Content-Length": String(body.length) })
      .end(Buffer.from(body));
    return;
  }

  const slice = body.subarray(range.start, range.end + 1);
  res
    .writeHead(206, {
      ...CORS,
      "Accept-Ranges": "bytes",
      ...(opts.sendContentRange
        ? {
            "Content-Range": `bytes ${range.start}-${range.end}/${body.length}`,
          }
        : {}),
      "Content-Length": String(slice.length),
    })
    .end(Buffer.from(slice));
}

/** Parse a single `bytes=start-end` range against a known total size. */
function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d+)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const start = Number(m[1]);
  const end = m[2] === "" ? size - 1 : Number(m[2]);
  if (start > end || start >= size) return null; // unsatisfiable
  return { start, end };
}

/**
 * Build the zip once, then start a server that serves it in several modes.
 *
 * `extraZips` registers caller-crafted archives under their own mode name
 * (e.g. `"bad-assets"` → served range-capably at `/bad-assets/...`), so tests
 * can exercise malformed-tour branches without a second server.
 */
export async function startFixtureServer(
  tour: Tour,
  assetFiles: Map<string, File>,
  extraZips: Map<string, Uint8Array> = new Map(),
): Promise<FixtureServer> {
  const blob = await packTour(tour, assetFiles);
  const zip = new Uint8Array(await blob.arrayBuffer());
  const requests: string[] = [];

  const server: Server = createServer((req, res) => {
    const url = req.url ?? "/";
    requests.push(url);
    const mode = url.split("/")[1] ?? "";

    // Approximate a browser CORS block / network failure (C10).
    if (mode === "no-cors") {
      req.socket.destroy();
      return;
    }
    if (mode === "missing") {
      res.writeHead(404).end();
      return;
    }
    // An empty archive: the `bytes=0-0` probe is unsatisfiable → 416.
    if (mode === "empty") {
      if (req.method === "HEAD") {
        res.writeHead(200, { ...CORS, "Content-Length": "0" }).end();
      } else {
        res.writeHead(416, CORS).end();
      }
      return;
    }

    const body =
      extraZips.get(mode) ??
      (mode === "corrupt" ? new Uint8Array([1, 2, 3, 4, 5]) : zip);
    // `no-head-len`: HEAD omits Content-Length → size must come from Content-Range.
    // `no-size`: no Content-Length *and* no Content-Range → no size anywhere,
    // forcing the plain-full-download degrade.
    serveZip(req, res, body, {
      honorRange: mode !== "no-ranges",
      sendHeadContentLength: mode !== "no-head-len" && mode !== "no-size",
      sendContentRange: mode !== "no-size",
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    origin: `http://127.0.0.1:${port}`,
    zip,
    requestCount: (prefix) =>
      prefix === undefined
        ? requests.length
        : requests.filter((u) => u.startsWith(prefix)).length,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
