# `wrangler.toml`

## Purpose

Cloudflare Workers config used by the Cloudflare Git integration to deploy the
combined multi-app static site **plus the site worker**
(`GpsPlusSlamJs_SiteWorker/src/site-worker.ts` — the Drive CORS proxy and
asset dispatcher; see that package's README and the drive-proxy plan,
`gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-08-26-2145-drive-cors-proxy-worker-plan.md`).
Without this file, the deploy step (`npx wrangler versions upload`) fails with
**"Missing entry-point to Worker script or to assets directory"** because
Wrangler 4.x has no implicit default.

## Public API

Not applicable — declarative config consumed by Cloudflare's build pipeline.

## Invariants & assumptions

- `name` matches the Cloudflare Workers project (`gps-plus-slam`).
- `[assets].directory` points at the combined multi-app build output
  (`./dist-site`) produced by `pnpm run build:site`. The path is relative to
  this file (repo root). The build command must populate this directory before
  deploy. **The Cloudflare dashboard build command must be set to
  `pnpm run build:site`** (it previously was `pnpm run build:recorder`); the
  build command lives in the dashboard, not in this repo, so changing this file
  alone is not enough — without the dashboard change the `dist-site` directory
  would be empty and the deploy fails fast.
- The deployed URL map is: `/` → landing page, `/recorder/` → RecorderApp,
  `/starter/` → AnchorStarter, `/minimal/` → MinimalExample. See
  [2026-06-01-0424-multi-app-subpath-deployment-plan.md](../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-01-0424-multi-app-subpath-deployment-plan.md).
- `compatibility_date` is bumped to deploy date when Cloudflare APIs change.
- `main` points at the site worker's TypeScript entry — wrangler bundles it
  itself at deploy; the wrangler version this config is written against is
  pinned as a root devDependency (`package.json`, used by the integration's
  `npx wrangler` through the lockfile).
- `[assets] binding = "ASSETS"` is load-bearing: with `main` present, every
  request matching no static asset invokes the worker, and the dispatcher
  needs the binding to delegate those back to the assets — without it the
  site's 404 surface would become worker errors.
- `run_worker_first = ["/api/*"]` routes API paths to the worker BEFORE
  asset matching; everything else still serves assets first.
- Observability is mostly off; logs are persisted for post-deploy debugging.

## History

- Originally lived in the private `gps-plus-slam` repo.
- Deleted from both repos during the public-repo split (see
  `2026-03-30-separate-public-repo-plan.md` §4.3) under the assumption that
  Cloudflare's Git integration would auto-detect the assets directory. That
  assumption was wrong — `wrangler versions upload` (the deploy step run by
  the integration) requires explicit config, so this file was restored.

## Tests

Verified end-to-end by a successful Cloudflare deployment from a PR build.
No unit-test coverage applicable.
