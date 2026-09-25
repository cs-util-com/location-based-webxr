# Publishing a tour so the viewer can range-read it

Component 6 fetches whatever URL is in `?tour=` and follows redirects. All
provider knowledge lives in **one pure layer**
(the framework's `gps-plus-slam-app-framework/storage#normalizeShareUrl`, C7):
a pasted share _page_ link from Dropbox / Google Drive / OneDrive / GitHub is
rewritten to that provider's raw download URL before any network I/O; anything
unrecognized (direct URLs, proxy URLs) passes through untouched, and the
transport below is provider-agnostic. What normalization **cannot** fix is
which URL supports **HTTP Range + CORS** — that stays a hosting concern,
documented here. The single hard requirement is CORS: the download URL must return
`Access-Control-Allow-Origin` for the app's origin, or the browser blocks the
cross-origin read regardless of whether the server supports ranges.

The loader sources the archive **size from a HEAD `Content-Length`** (a
CORS-safelisted header every host exposes), and **falls back to the 206's
`Content-Range`** when HEAD gives none (the proxy path) — so a host only needs to
answer a `Range` GET with `206`, plus either HEAD `Content-Length` or an exposed
`Content-Range`.

## GitHub raw (recommended — no CORS setup)

`raw.githubusercontent.com/<user>/<repo>/<branch>/path/tour.zip`

- Empirically probed: `206` + `accept-ranges: bytes` + `access-control-allow-origin: *`;
  size via HEAD `content-length`. Works with this loader **as-is**, from localhost
  and production alike — no proxy, no config.
- Caveats: **100 MB per-file hard limit** (a media-heavy tour can exceed it), Git
  is not a binary CDN, and it is not an "everyday cloud storage" service in the
  §2.5.6 sense — great for testing/small tours, not the intended authoring story.

## Dropbox (needs a proxy — see below)

Dropbox is an "everyday cloud storage" target (§2.5.6) and supports Range, **but
its direct-download hosts generally do not send `Access-Control-Allow-Origin`**,
so a browser blocks the cross-origin read even though `curl` succeeds. To use
Dropbox you must front it with a CORS proxy — see
"Making Dropbox … work via a proxy" below.

1. Upload `tour.zip`; "Copy link" → `https://www.dropbox.com/scl/fi/…/tour.zip?rlkey=…&dl=0`.
2. Paste it as-is — the loader's share-link layer rewrites it to the
   `dl.dropboxusercontent.com` raw form automatically (no manual `dl=1` edit
   needed).
3. Confirm CORS is the only blocker (headers present under `curl`, blocked in
   the browser): `curl -s -D - -o /dev/null -H "Origin: https://example.com" -H "Range: bytes=0-0" "<url>"` —
   if there is **no** `access-control-allow-origin` line, you need the proxy.
4. Route it through the proxy and use the proxy URL as the `?tour=` value.

## Google Drive (works key-less via the proxy)

Paste the share link as-is. The share-link layer rewrites it to
`drive.usercontent.google.com/download?id=…&export=download&confirm=t`, which
serves `206` + `Accept-Ranges: bytes` with the size from a HEAD
`Content-Length`; `confirm=t` skips Google's "can't scan for viruses" HTML
interstitial on larger files. In dev the demo auto-routes it through the
built-in proxy; in prod allowlist `drive.usercontent.google.com` in the Worker.

- **Why the proxy is still needed (probed 2026-07):** the endpoint _advertises_
  `Access-Control-Allow-Origin: *` to plain clients (curl, Node), but answers
  **403** to any request carrying `Sec-Fetch-Site: cross-site` — a header every
  real browser attaches to a cross-origin fetch and a page cannot remove. So
  browser-direct reads are blocked no matter what; the proxy's server-side
  fetch sends no `Sec-Fetch` headers and passes.
- Hard requirement: share the file as **"Anyone with the link"** — a
  `usp=drive_link` share defaults to _Restricted_, whose anonymous fetch
  redirects to a Google sign-in page (HTML instead of bytes → the proxy's loud
  `502`).
- The proxy-free alternative is a `googleDriveApiKey` (in
  `OpenRemoteTourOptions`), which rewrites to the official
  `drive/v3 … alt=media` endpoint (public files only).

## OneDrive (recommended "everyday cloud" — no proxy, no key)

Paste the share link as-is. New-style links (`1drv.ms/u/c/<cid>/<shareId>…`,
i.e. accounts migrated to the SharePoint backend) are rewritten to
`my.microsoftpersonalcontent.com/personal/<cid>/_layouts/15/download.aspx?share=<shareId>`,
which (empirically probed 2026-07) serves `206` + `Accept-Ranges: bytes` +
`Access-Control-Allow-Origin: *` **anonymously, even to browser-shaped
requests** (unlike Google's usercontent host, no `Sec-Fetch` blocking), with
the size from a CORS-exposed HEAD `Content-Length`. Full Range + CORS, no
proxy, no key — this is the first §2.5.6 "everyday cloud storage" provider
that works with zero infrastructure.

- Legacy (pre-migration) share links fall back to the shares-API
  (`api.onedrive.com/v1.0/shares/u!<base64url>/root/content`), which
  302-redirects to a temporary download URL; note the legacy API answers `401`
  for migrated accounts — the new-style rewrite above is what avoids that.
- Both forms are undocumented/unofficial and could change; re-probe before a
  graded demo.

## Others (not wired for the demo)

- **Box** — not recognized by the share-link layer; supply a direct download URL
  yourself.

## Making Dropbox (or any no-CORS host) work via a proxy

Dropbox's direct-download hosts support Range but generally **do not send
`Access-Control-Allow-Origin`**, so a browser blocks the read (see the CORS note
above). `curl` passing is not proof — only a browser enforces CORS. To keep
Dropbox as the author's storage, put a thin CORS-adding proxy in front of it. The
loader is provider-agnostic and follows redirects, so a proxy URL drops in as the
`?tour=` value with **no app code change** — the proxy's only jobs are to add the
CORS headers Dropbox omits, **expose `Content-Range`** (the loader sizes the
archive from it when HEAD gives no `Content-Length`), and forward the `Range`
header so 206 reads pass through.

### Dev — built in (Vite)

`vite.config.ts` ships a dev-only proxy at **`/tour-proxy?u=<encoded url>`**
(host-allowlisted to the Dropbox content host / GitHub raw / jsDelivr). Because
the browser talks to same-origin `localhost`, there is no CORS at all. The `u=`
target runs through the same share-link normalization as a direct `?tour=` URL,
so an encoded Dropbox share-page link works as-is; anything normalization can't
rewrite to an allowlisted raw host (e.g. a folder link) gets a loud `403`
rather than an HTML page reaching zip.js as "corrupt". Paste this into the
demo's URL box (dev only):

```
/tour-proxy?u=https%3A%2F%2Fwww.dropbox.com%2Fscl%2Ffi%2F…%2Ftour.zip%3Frlkey%3D…%26dl%3D0
```

Verified: a `Range` request through it returns `206 Partial Content` +
`Content-Range`, streamed straight from the upstream host.

### Prod — Cloudflare Worker (Hono)

Same `?u=` interface, so the demo URL shape is identical to dev. `hono/cors`
handles the CORS/preflight/expose-headers; the handler allowlists hosts (so it is
not an open relay) and forwards Range + follows redirects.

```ts
import { Hono } from "hono";
import { cors } from "hono/cors";

// Copy the dependency-free `normalizeShareUrl` from
// GpsPlusSlamJs_AppFramework/src/storage/share-link.ts next to this file: a
// pasted share *page* link then works through the Worker too. Share-page
// hosts (www.dropbox.com) are deliberately NOT allowlisted — anything
// normalization couldn't rewrite (e.g. a folder link) 403s loudly instead of
// streaming an HTML preview page into zip.js as "corrupt".
import { normalizeShareUrl } from "./share-link";

const ALLOWED_HOSTS = new Set([
  "dl.dropboxusercontent.com",
  // Key-less Google Drive: 403s browser requests (Sec-Fetch-Site), so it
  // must come through here, where fetch sends no Sec-Fetch headers.
  "drive.usercontent.google.com",
]);

const app = new Hono();

app.use(
  "/*",
  cors({
    origin: ["https://your-viewer.example"], // your app origin(s)
    allowMethods: ["GET", "HEAD"],
    // Content-Range is what the loader reads to size the archive (item 1).
    exposeHeaders: ["Content-Range", "Accept-Ranges", "Content-Length"],
  }),
);

app.on(["GET", "HEAD"], "/", async (c) => {
  const target = c.req.query("u");
  if (!target) return c.text("missing ?u=", 400);

  let url: URL;
  try {
    url = new URL(normalizeShareUrl(target));
  } catch {
    return c.text("bad url", 400);
  }
  if (!ALLOWED_HOSTS.has(url.hostname)) return c.text("host not allowed", 403);

  const range = c.req.header("Range");
  const upstream = await fetch(url, {
    method: c.req.method,
    headers: range ? { Range: range } : {},
    redirect: "follow", // Dropbox 302s www → dl.dropboxusercontent.com
  });

  // A tour.zip is never HTML: an HTML final response is a login page (file
  // not shared publicly) or a virus-scan interstitial — fail loudly instead
  // of letting it reach zip.js as a mystery "corrupt".
  if ((upstream.headers.get("content-type") ?? "").startsWith("text/html")) {
    return c.text(
      "upstream answered with an HTML page, not the file — check sharing settings",
      502,
    );
  }

  const headers = new Headers();
  // Never let the browser cache proxied responses: the same URL serves both
  // 206 range reads and the 200 full warm download, and a cached partial
  // answered for a later range read reaches zip.js as garbage ("not a
  // readable zip"). The dev Vite proxy sets the same header for the same
  // reason.
  headers.set("Cache-Control", "no-store");
  for (const h of [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
  ]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
});

export default app;
```

Deploy with `wrangler deploy` (a `hono` dependency + a `wrangler.toml`). The
`?tour=` value then becomes
`https://your-worker.workers.dev/?u=<encoded dropbox dl=1 url>`.

**Operational notes:** every range read _and_ the background full-download flow
through the Worker, so for large tours mind your Worker's request/egress limits
(fine for small tours). Restrict `origin` to your real app origins rather than
`*` to double as abuse control. If Dropbox serves an HTML interstitial (rate limit
/ very large file), the bytes reach zip.js and surface as `TourLoadError("corrupt")`.

## The fallback (any host)

If a link serves the whole file on a `Range` request (answers `200`, not `206`),
the tour **still works** — the loader ingests that full body and reads it locally
(C5). You only lose the instant-first-asset benefit. A CORS-_blocked_ link is the
one unrecoverable case (it defeats both the range path and the full-body
fallback), surfaced as `TourLoadError("cors")`.
