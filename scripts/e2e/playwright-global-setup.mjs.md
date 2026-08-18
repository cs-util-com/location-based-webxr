# `playwright-global-setup.mjs` — the shared e2e freshness gate

**Purpose.** One Playwright `globalSetup`, wired identically by every package
whose e2e suite may reuse an already-running dev server, so the staleness check
in [`dev-server-freshness.mjs`](dev-server-freshness.mjs.md) runs before any
spec does.

## Public API

- `export default async function globalSetup(config)` — Playwright's
  `globalSetup` contract. Takes the resolved `FullConfig`, returns nothing, and
  **throws** to abort the run when the dev server is stale or unreachable.
  Aborting is the point: a suite that runs against a stale bundle reports on
  code that is not the code under test.

## Who wires it

Seven packages, all with the identical relative path
`globalSetup: "../../scripts/e2e/playwright-global-setup.mjs"` — `OsmDemo`,
`RecorderApp`, `AnchorStarter`, `Landing`, `PhysicsDemo`, `QrTrackingDemo` and
`WayfindingHudDemo`. One file rather than seven copies, because a freshness rule
that drifts per package is the same as not having one.

## Invariants & assumptions

- **The webServer has already started or been reused by the time this runs**,
  and that ordering is **verified rather than assumed** — in Playwright 1.60
  (`lib/runner/index.js`) the `webServer` is pushed as a plugin, and plugin
  setup tasks are created *before* global-setup tasks. This is the useful order:
  the guard inspects the server the suite will actually use, not one it hopes
  for.
  - ⚠️ **A Playwright upgrade could invalidate this.** If plugin/global-setup
    ordering ever changes, the guard would inspect a server that has not
    started and report the wedged-server case below on every run.
- **"Nothing is listening" is NOT the ordinary no-server case here.** Because of
  that ordering, an absent server means the `webServer` **wedged** — so it is
  reported rather than passed over silently.
- **`process.cwd()` is the package directory, not the repo root.** pnpm runs
  package scripts with the package as cwd, and that is exactly what lets one
  shared file resolve each package's own linked libraries. Passing the repo root
  instead would make every package check the same tree.
- The base URL comes from `devServerUrlOf(config)` rather than from an env var,
  so it always matches the config the run is using.

## Examples

```js
// <package>/playwright-tests/playwright.config.js
export default defineConfig({
  globalSetup: "../../scripts/e2e/playwright-global-setup.mjs",
  webServer: { command: "pnpm dev", url: "http://127.0.0.1:5173", reuseExistingServer: true },
});
```

## Tests

No direct test, and that is a deliberate gap worth naming: this file is a
four-line adapter whose only logic is *which* arguments reach
`assertDevServerFresh`. The behaviour it delegates to is covered by
[`dev-server-freshness.test.mjs`](dev-server-freshness.mjs.md); the wiring is
covered by the fact that all seven suites fail loudly if the path is wrong.
Nothing in the `pnpm test` cascade enforces sidecar existence, so this file went
without one until the PR #316 review asked for it.
