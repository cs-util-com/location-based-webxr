# `site-worker.ts`

## Purpose

The Cloudflare worker entry point in front of the static multi-app site: a
route dispatcher that handles `/api/*` (today only the Drive proxy) and
delegates every other request to the static assets, byte-identical to the
assets-only deployment it replaced.

## Public API

- `routeRequest(request, env, fetchImpl?)` — the dispatcher:
  `/api/drive-proxy` → `handleDriveProxy`; any other `/api/*` → JSON `404`
  (never the site's HTML 404 — the prefix is reserved for worker routes);
  everything else → `env.ASSETS.fetch(request)` verbatim.
- `SiteWorkerEnv` — the minimal env shape (`ASSETS` binding); declared
  locally instead of pulling `@cloudflare/workers-types` for one method.
- default export — the `{ fetch }` handler wrangler deploys
  (`wrangler.toml` `main`).

## Invariants & assumptions

- **With `main` present, Cloudflare invokes the worker for EVERY request
  matching no static asset** — not only `run_worker_first` routes. The
  assets delegation is therefore load-bearing for the whole site's 404
  surface (plan Rev 2, review finding 1), and its test asserts the SAME
  request object goes in and the SAME response object comes out.
- `run_worker_first = ["/api/*"]` in `wrangler.toml` sends API routes here
  before asset matching; the `/S/` QR short-link rewrite joins this
  dispatcher when it is built (0932 follow-up 6).
- The dispatcher stays pure: routing only, no header or body rewriting.

## Examples

```ts
const response = await routeRequest(
  new Request("https://gps.csutil.com/tour/"),
  env,
); // === await env.ASSETS.fetch(request)
```

## Tests

`site-worker.test.ts` — asset delegation (several representative paths),
proxy dispatch, unknown-API-route JSON 404.
