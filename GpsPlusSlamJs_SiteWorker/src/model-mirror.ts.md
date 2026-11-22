# model-mirror.ts

## Purpose

A same-origin mirror for pinned model files whose host sends no CORS headers (GitHub release downloads), so the Tour Viewer's feature matching check page can fetch them from the site's own origin. It serves only an allowlist; it is not a general proxy.

## Public API

- `MODEL_MIRROR_PREFIX` (`/api/model/`): the route prefix, the file name follows it.
- `MIRRORED_MODELS`: name to `{ upstream, bytes }`. Today one entry, `sift-lightglue.onnx`, COLMAP's 3.13.0 release asset (45,806,253 bytes, BSD-3 licensed release; the LightGlue weights are Apache-2.0).
- `handleModelMirror(request, fetchImpl): Promise<Response>`:
  - 404 for a name not in the allowlist, without any upstream request;
  - 405 (with `allow: GET, HEAD`) for any other method;
  - 502 when the upstream is unreachable, answers non-2xx, or sends a `content-length` other than the pinned size (the body is cancelled);
  - else 200 with the upstream body streamed, `content-type: application/octet-stream`, the pinned `content-length` and `cache-control: public, max-age=31536000, immutable`; HEAD gets no body.

## Invariants and assumptions

- The upstream URL is never built from the request: the name only selects an entry of the allowlist (`Object.hasOwn`, so `__proto__` and the like are just unknown names).
- The upstream fetch asks Cloudflare to cache it (`cf.cacheEverything`, one year), so a test session does not pull the 46 MB file from GitHub on every load.
- The size check is a cheap guard against a changed release asset; the page checks the sha256 itself before it creates a session.
- Why a route and not a static asset: Cloudflare static assets are limited to 25 MiB per file, and the model is 46 MB.

## Example

```ts
if (pathname.startsWith(MODEL_MIRROR_PREFIX)) {
  return handleModelMirror(request, fetch);
}
```

## Tests

`model-mirror.test.ts`: the streamed immutable download, HEAD without a body, 405 and a wrong upstream size, an upstream failure as 502, and a property that no name outside the allowlist reaches the upstream. `site-worker.test.ts` checks the route is wired.
