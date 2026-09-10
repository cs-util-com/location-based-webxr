# `drive-proxy-url.ts`

**Purpose.** Decide which Drive CORS proxy the running page should call:
its own origin's, or production's.

## Public API

- `driveProxyBaseUrl(hostname: string) → string`
  - **In:** `location.hostname`.
  - **Out:** `RELATIVE_DRIVE_PROXY_PATH` (`/api/drive-proxy`) on any
    deployment - production and every branch preview - and
    `PRODUCTION_DRIVE_PROXY_URL` on a development host.
  - **Error modes:** none. An unrecognised host resolves to the relative
    path, which is the safe default: a deployment that is wrongly treated
    as dev would call production cross-origin and be refused, whereas a
    dev host wrongly treated as a deployment fails loudly and locally.
- `PRODUCTION_DRIVE_PROXY_URL`, `RELATIVE_DRIVE_PROXY_PATH` - exported so
  tests and callers name the two outcomes instead of repeating strings.

## Invariants & assumptions

- **Every deployment of the site serves the site worker**, so `/api/*` is
  same-origin wherever the app is deployed. This is what makes the
  relative path correct for previews as well as production.
- **Development hosts have no `/api`** - vite serves the app alone - so
  they must use the absolute URL, and they are exactly the hosts the
  worker's CORS allowlist admits.
- The dev-host test **mirrors the worker's own `DEV_ORIGIN`** regex
  (`GpsPlusSlamJs_SiteWorker/src/drive-proxy.ts`). The two live in
  different packages on purpose - deriving one from the other would cross
  a repo boundary for four hostname shapes - so they are written to be
  read side by side. If they ever disagree, the symptom is the refusal
  this module exists to prevent.
- Hostname only: the port does not affect CORS admission here, and the
  scheme is not this module's judgement to make.

## Why it exists

Second testing session, 2026-09-09, finding F3. The proxy base was one
hard-coded absolute URL. That serves production (same-origin anyway) and
dev (on the allowlist) but **not a branch preview**, which is neither - so
every test build reported "The host refused the browser access" for any
Drive-hosted tour, with a message that blames the file host.

The alternative fix - adding `*.workers.dev` to the worker's allowlist -
was rejected: it admits every Worker anyone deploys on that shared
domain, to fix a problem caused by calling the wrong origin in the first
place.

## Examples

```ts
driveProxyBaseUrl("r663-gps-plus-slam.csutil.workers.dev"); // "/api/drive-proxy"
driveProxyBaseUrl("gps.csutil.com"); // "/api/drive-proxy"
driveProxyBaseUrl("localhost"); // "https://gps.csutil.com/api/drive-proxy"
```

## Tests

`drive-proxy-url.test.ts` - the preview case by name (the one that was
broken), production, each dev-host shape, and lookalike hosts
(`localhost.evil.example` and friends) that must not be mistaken for dev,
since that misclassification reproduces the original bug.
