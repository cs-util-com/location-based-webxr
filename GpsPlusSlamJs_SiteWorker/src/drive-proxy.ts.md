# `drive-proxy.ts`

## Purpose

Streams a public Google Drive file through the site's origin so the
browser-blocked keyless Drive endpoint becomes reachable from the
TourViewer. Google 403s any request carrying `Sec-Fetch-Site: cross-site`
(every real browser fetch); a worker's fetch carries no `Sec-Fetch-*`
headers, so upstream sees a plain client — verified server-side 2026-08-26:
`206` + correct `content-range` on ranged reads, `416` out-of-bounds.

Plan and decision record:
`gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-08-26-2145-drive-cors-proxy-worker-plan.md`.

## Public API

- `handleDriveProxy(request, { fetchImpl }): Promise<Response>` — the whole
  proxy. `GET|HEAD /api/drive-proxy?id=<fileId>` proxies
  `drive.usercontent.google.com/download?id=…&export=download&confirm=t`;
  `OPTIONS` answers the dev-origin preflight locally. Error modes: `400`
  (id missing/over 300 chars/contains `/` — JSON body naming the id), `405`
  (other methods), `502` (upstream answered `text/html`, i.e. the
  virus-scan interstitial leaked past `confirm=t`). All other upstream
  statuses (`200/206/304/404/416`) pass through.
- `FetchLike` — the injected fetch shape; the entry point passes the
  runtime's `fetch`, every test injects a recorder.

## Invariants & assumptions

- **Only Drive is reachable**: the upstream URL is a constant base plus
  `encodeURIComponent(id)` — an id cannot smuggle parameters or hosts.
  Validation is deliberately loose beyond that (ids are opaque values,
  PR #357 review); the property test proves the encoding guard.
- **Request headers cross the boundary by allowlist only** (`Range`,
  `If-None-Match`, `If-Modified-Since`) — cookies/auth never leak upstream.
- **HEAD answers body-less with the upstream `content-length` set
  explicitly**: the Workers runtime chunk-encodes streamed bodies and drops
  the length, and the transport sizes archives from the HEAD probe — a lost
  size silently degrades Drive tours to full-download (plan Rev 2,
  review finding 3). The live check for this is in the plan's M-C
  checklist; no unit test can see a runtime-level rewrite.
- **CORS ≠ abuse guard**: the allowlist (`http://localhost[:port]`,
  `http://127.0.0.1[:port]`) exists for dev servers only; production is
  same-origin. The abuse bound is the Workers free tier's hard request cap
  (owner decision 2026-08-26: accept-as-bounded).
- `Vary: Origin` on every response, so caches never cross origins.

## Examples

```ts
const response = await handleDriveProxy(
  new Request("https://gps.csutil.com/api/drive-proxy?id=FILE_ID", {
    headers: { Range: "bytes=0-1023" },
  }),
  { fetchImpl: fetch },
);
// → 206, content-range copied, Access-Control-Expose-Headers set
```

## Tests

`drive-proxy.test.ts` (validation, forwarding both ways, HEAD sizing,
interstitial guard, CORS/preflight) and `drive-proxy.property.test.ts`
(the encodeURIComponent injection guard over arbitrary ids). All inject
`fetchImpl`; nothing touches the network.
