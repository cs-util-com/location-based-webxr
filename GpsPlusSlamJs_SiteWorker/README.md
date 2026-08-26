# GpsPlusSlamJs_SiteWorker

The Cloudflare Worker deployed in front of the static multi-app site
(`wrangler.toml` at the repo root: `main` points here, the git integration
deploys on merge). Two jobs:

- **`/api/drive-proxy?id=<fileId>`** — streams a public Google Drive file
  with Range support through the site's origin, because Google's keyless
  download endpoint 403s real browser fetches (`Sec-Fetch-Site` sniffing)
  while serving plain clients fine. See `src/drive-proxy.ts.md`.
- **Everything else** — delegated verbatim to the static assets, so the
  site behaves exactly as the previous assets-only deployment.
  See `src/site-worker.ts.md`.

Plan and decisions:
`gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-08-26-2145-drive-cors-proxy-worker-plan.md`.

## Develop & test

```bash
pnpm test        # format + typecheck + unit (the package gate)
pnpm run test:unit
```

No build step: wrangler bundles `src/site-worker.ts` itself at deploy
(the wrangler version is pinned as a root devDependency). The local
simulator (`wrangler dev`) is deliberately not set up — its `workerd`
binary download is disallowed in `pnpm-workspace.yaml`; the handler is a
pure function and everything is unit-tested with an injected fetch.
