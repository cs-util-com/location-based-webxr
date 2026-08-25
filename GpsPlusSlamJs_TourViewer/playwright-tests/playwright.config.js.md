# playwright.config.js

## Purpose

E2e configuration for the tour viewer: Chromium against the vite dev server
(port 5187, allocated in `../docs/dev-server-ports.md`) plus the local
archive server (`archive-server.mjs`, port 5197) that serves a generated test
zip both range-honoring and range-ignoring — so streaming, fallback, cache
and error behavior are proven with zero cloud dependencies.

## Public API

Consumed by `pnpm run test:e2e` (via the repo's timed-stage wrapper). The
`webServer` array starts both servers; `/health` gates the archive server's
readiness.

## Invariants & assumptions

- Shares the workspace `playwright-global-setup.mjs` dev-server freshness
  guard: a dev server older than the last framework build is refused (a
  stale server 404s content-hashed imports and every spec times out looking
  like a code defect).
- The archive server builds its zip in memory at startup — no committed
  fixture (the repo caps tracked files at 2 MiB, and a generated archive
  cannot rot out of sync with the specs).

## Tests

`streaming.spec.js` — range streaming with per-page partial-fetch
accounting, the 200-fallback, the cached second visit (zero archive GETs),
the changed-ETag eviction/refetch (the authoring-loop revalidation, driven
via the server's `/flip` route), clear-cache, and clear-cache-during-warm
(the held warm download must not repopulate a cleared store, driven via
`/warm-gate`). `launch-and-errors.spec.js`
— the `?qr=` boot path, the async-UI in-progress/final states for success
and failure, and the no-console-errors smoke. `ar-mode.spec.js` — the M2 AR
foundation booting both modes through the fake seams (`ar-fakes.js`), the
session-end teardown + re-entry, the M3 author flow (scripted detect/solve
through the REAL controller/slice/stability/alignment/mint to an exported
level the parser accepts), the M4 viewer loop (budgeted votes into the real store, the negative-cache
unknown-code state, the image ring), plus the honest unsupported state
without fakes.
