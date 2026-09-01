import { describe, expect, it } from "vitest";
import { handleDriveProxy, type FetchLike } from "./drive-proxy";

/**
 * Why these tests matter (drive-proxy plan, 2026-08-26): the worker is the
 * only piece of this repo that runs SERVER-side, deployed on merge, and a
 * defect here breaks every Drive-hosted tour at once. Each test pins one
 * clause of the proxy contract: what is forwarded upstream, what comes back
 * downstream, and what is refused. All network access is an injected
 * fetchImpl — no test touches the real Drive endpoint.
 */

const PROXY_URL = "https://gps.csutil.com/api/drive-proxy";

function upstreamResponse(
  status: number,
  headers: Record<string, string>,
  body: string | null = "PKzip-bytes",
): Response {
  return new Response(body, { status, headers });
}

/** A fetchImpl that records its call and returns a canned response. */
function recordingFetch(response: Response): {
  fetchImpl: FetchLike;
  calls: { url: string; init: RequestInit }[];
} {
  const calls: { url: string; init: RequestInit }[] = [];
  return {
    calls,
    fetchImpl: (url, init) => {
      calls.push({ url, init: init ?? {} });
      return Promise.resolve(response);
    },
  };
}

function request(
  params: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
): Request {
  return new Request(`${PROXY_URL}${params}`, init);
}

describe("handleDriveProxy — validation", () => {
  it("rejects a missing id with a 400 that NAMES the id, not a generic error", async () => {
    // The viewer maps this to a Drive-specific message (plan Rev 2,
    // review finding 12) — a bare 400 would surface as the generic
    // "cannot be opened as an archive" and hide the actual cause.
    const { fetchImpl, calls } = recordingFetch(upstreamResponse(200, {}));
    const response = await handleDriveProxy(request(""), { fetchImpl });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/id/i);
    expect(calls.length).toBe(0); // nothing reached upstream
  });

  it("rejects an id containing a slash — ids are opaque VALUES, never paths", async () => {
    const { fetchImpl, calls } = recordingFetch(upstreamResponse(200, {}));
    const response = await handleDriveProxy(request("?id=abc/def"), {
      fetchImpl,
    });
    expect(response.status).toBe(400);
    expect(calls.length).toBe(0);
  });

  it("rejects an id longer than 300 characters", async () => {
    const { fetchImpl, calls } = recordingFetch(upstreamResponse(200, {}));
    const response = await handleDriveProxy(request(`?id=${"a".repeat(301)}`), {
      fetchImpl,
    });
    expect(response.status).toBe(400);
    expect(calls.length).toBe(0);
  });

  it("answers 405 for methods other than GET/HEAD/OPTIONS", async () => {
    const { fetchImpl, calls } = recordingFetch(upstreamResponse(200, {}));
    const response = await handleDriveProxy(
      request("?id=file123", { method: "POST" }),
      { fetchImpl },
    );
    expect(response.status).toBe(405);
    expect(calls.length).toBe(0);
  });
});

describe("handleDriveProxy — upstream forwarding", () => {
  it("builds the keyless usercontent URL with the id percent-encoded", async () => {
    // encodeURIComponent is the injection guard: an id carrying `&`/`=`
    // must stay one opaque value (same rule share-link.ts applies, PR #357
    // review) instead of smuggling parameters into the upstream query.
    const { fetchImpl, calls } = recordingFetch(upstreamResponse(200, {}));
    await handleDriveProxy(request("?id=a%26b%3Dc"), { fetchImpl });
    expect(calls.length).toBe(1);
    expect(calls[0]?.url).toBe(
      "https://drive.usercontent.google.com/download?id=a%26b%3Dc&export=download&confirm=t",
    );
  });

  it("forwards Range, If-None-Match and If-Modified-Since — and nothing else", async () => {
    const { fetchImpl, calls } = recordingFetch(
      upstreamResponse(206, { "content-range": "bytes 0-99/1000" }),
    );
    await handleDriveProxy(
      request("?id=file123", {
        headers: {
          Range: "bytes=0-99",
          "If-None-Match": '"etag1"',
          "If-Modified-Since": "Mon, 24 Aug 2026 00:00:00 GMT",
          Cookie: "secret=1", // must NOT cross the boundary
        },
      }),
      { fetchImpl },
    );
    const sent = new Headers(calls[0]?.init.headers);
    expect(sent.get("range")).toBe("bytes=0-99");
    expect(sent.get("if-none-match")).toBe('"etag1"');
    expect(sent.get("if-modified-since")).toBe("Mon, 24 Aug 2026 00:00:00 GMT");
    expect(sent.get("cookie")).toBeNull();
  });
});

describe("handleDriveProxy — downstream response", () => {
  it("passes a 206 through with the range headers copied AND exposed", async () => {
    // Access-Control-Expose-Headers is what lets browser JS actually read
    // Content-Range/ETag — GitHub raw omits it and the transport limps
    // around that; the proxy must be the richer host, not another poor one.
    const upstream = upstreamResponse(206, {
      "content-length": "100",
      "content-range": "bytes 0-99/1000",
      "accept-ranges": "bytes",
      etag: '"etag1"',
      "last-modified": "Mon, 24 Aug 2026 00:00:00 GMT",
      "content-type": "application/octet-stream",
    });
    const { fetchImpl } = recordingFetch(upstream);
    const response = await handleDriveProxy(
      request("?id=file123", { headers: { Range: "bytes=0-99" } }),
      { fetchImpl },
    );
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-99/1000");
    expect(response.headers.get("content-length")).toBe("100");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("etag")).toBe('"etag1"');
    const exposed = response.headers.get("access-control-expose-headers");
    for (const name of [
      "Content-Length",
      "Content-Range",
      "Accept-Ranges",
      "ETag",
      "Last-Modified",
    ]) {
      expect(exposed).toContain(name);
    }
    expect(await response.text()).toBe("PKzip-bytes");
  });

  it("passes 304, 404 and 416 through unchanged", async () => {
    for (const status of [304, 404, 416]) {
      const { fetchImpl } = recordingFetch(upstreamResponse(status, {}, null));
      const response = await handleDriveProxy(request("?id=file123"), {
        fetchImpl,
      });
      expect(response.status).toBe(status);
    }
  });

  it("keeps an HTML-bodied error's STATUS — Drive's 404 page stays a 404", async () => {
    // Milestone review finding 1: Drive answers a bogus id with an HTML 404
    // page and a non-public file with an HTML sign-in page. The interstitial
    // guard must not convert those to 502 — downstream, only a literal
    // 404/410 classifies as 'missing', and a 502 reads as "host
    // unreachable", which serves a DELETED Drive file from the local cache
    // forever. The HTML body itself is dropped (the status is the
    // information; the markup is dead weight toward a zip parser).
    const { fetchImpl } = recordingFetch(
      upstreamResponse(
        404,
        { "content-type": "text/html; charset=utf-8" },
        "<html>Not found</html>",
      ),
    );
    const response = await handleDriveProxy(request("?id=gone123"), {
      fetchImpl,
    });
    expect(response.status).toBe(404);
    expect(response.body).toBeNull();
  });

  it("does not announce the dropped HTML body's length (PR #369 review)", async () => {
    // Drive's HTML 404 page carries its own content-length (~1500). The
    // body is dropped but the copied header used to ride along — a response
    // announcing 1500 bytes and sending 0 is malformed, and a browser
    // surfacing it as a network error downstream misclassifies the 404 as
    // 'cors'. The length must be zeroed with the body.
    const { fetchImpl } = recordingFetch(
      upstreamResponse(
        404,
        {
          "content-type": "text/html; charset=utf-8",
          "content-length": "1523",
        },
        "<html>Not found</html>",
      ),
    );
    const response = await handleDriveProxy(request("?id=gone123"), {
      fetchImpl,
    });
    expect(response.status).toBe(404);
    expect(response.body).toBeNull();
    expect(response.headers.get("content-length")).toBe("0");
  });

  it("answers HEAD with a body-less response that still carries content-length", async () => {
    // The transport takes the archive size from the HEAD probe, and the
    // Workers runtime chunk-encodes STREAMED bodies (dropping the length) —
    // a body-less Response with the header set explicitly is the one shape
    // that survives (plan Rev 2, review finding 3). A wrong/missing size
    // here silently degrades every Drive tour to full-download.
    const { fetchImpl } = recordingFetch(
      upstreamResponse(200, { "content-length": "12345" }, null),
    );
    const response = await handleDriveProxy(
      request("?id=file123", { method: "HEAD" }),
      { fetchImpl },
    );
    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
    expect(response.headers.get("content-length")).toBe("12345");
  });

  it("turns an upstream HTML page into a 502 naming the scan interstitial", async () => {
    // text/html from the download endpoint means the virus-scan warning
    // leaked past confirm=t — streaming it into a zip parser would produce
    // a baffling parse error; a 502 with a cause is debuggable.
    const { fetchImpl } = recordingFetch(
      upstreamResponse(
        200,
        { "content-type": "text/html; charset=utf-8" },
        "<html>Google Drive can't scan this file</html>",
      ),
    );
    const response = await handleDriveProxy(request("?id=file123"), {
      fetchImpl,
    });
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/scan|interstitial|html/i);
  });
});

describe("handleDriveProxy — CORS", () => {
  it("echoes Access-Control-Allow-Origin for localhost dev origins only", async () => {
    // Production is same-origin (the viewer deploys at /tour/ behind this
    // same worker) and needs no CORS; the allowlist exists solely for
    // `vite` dev servers. This is NOT the abuse guard — the free-tier
    // request cap is (plan Rev 2, owner decision).
    const cases: { origin: string; allowed: boolean }[] = [
      { origin: "http://localhost:5187", allowed: true },
      { origin: "http://127.0.0.1:4173", allowed: true },
      { origin: "http://localhost", allowed: true },
      // The documented on-device flows (milestone review finding 2): vite's
      // host:true exposes the dev server on the LAN, and ngrok fronts it
      // for HTTPS.
      { origin: "http://192.168.1.42:5187", allowed: true },
      { origin: "http://10.0.0.7:5187", allowed: true },
      { origin: "https://abc-123.ngrok-free.app", allowed: true },
      { origin: "https://evil.example", allowed: false },
      { origin: "http://localhost.evil.example", allowed: false },
      { origin: "https://gps.csutil.com.evil.example", allowed: false },
      { origin: "https://abc.ngrok-free.app.evil.example", allowed: false },
      { origin: "http://192.168.1.42.evil.example", allowed: false },
    ];
    for (const { origin, allowed } of cases) {
      const { fetchImpl } = recordingFetch(upstreamResponse(200, {}));
      const response = await handleDriveProxy(
        request("?id=file123", { headers: { Origin: origin } }),
        { fetchImpl },
      );
      expect(response.headers.get("access-control-allow-origin"), origin).toBe(
        allowed ? origin : null,
      );
      expect(response.headers.get("vary")).toBe("Origin");
    }
  });

  it("answers the OPTIONS preflight with Range in the allowed headers", async () => {
    // A dev-origin fetch carrying Range is a non-simple request — without
    // this preflight answer the browser never sends the real GET.
    const { fetchImpl, calls } = recordingFetch(upstreamResponse(200, {}));
    const response = await handleDriveProxy(
      request("?id=file123", {
        method: "OPTIONS",
        headers: { Origin: "http://localhost:5187" },
      }),
      { fetchImpl },
    );
    expect(response.status).toBe(204);
    expect(calls.length).toBe(0); // preflights never reach Drive
    expect(response.headers.get("access-control-allow-headers")).toMatch(
      /range/i,
    );
    expect(response.headers.get("access-control-allow-methods")).toMatch(/GET/);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:5187",
    );
  });
});
