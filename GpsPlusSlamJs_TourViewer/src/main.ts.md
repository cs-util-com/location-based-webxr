# main.ts

## Purpose

The composition root (flows plan M6, executing the simplification plan's
M-1): looks the DOM up once, creates the store, the AR controller and the
seams, creates the ONE explicit session object (DEC-T6) and the late-bound
hooks, and wires the five concerns in dependency order. No behaviour lives
here; the e2e suite drives the composed page.

## Public API

None (app entry point). The `data-testid` contract the e2e suite drives is
listed in `index.html.md`. The concerns and their modules:

- `print-panel.ts` - the print section (`wirePrintPanel`).
- `author-mode.ts` - the `?author=1` panel, minting (`wireAuthorMode`).
- `viewer-placement.ts` - the viewer pipeline and the photo placement
  (`createViewerPlacement`).
- `ar-entry.ts` - the AR entry, the runtime start/end, the status line
  renderer (`wireArEntry`).
- `archive-open.ts` - the open path, the gallery, the stats, the Storage
  section, the `?qr=` boot (`wireArchiveOpen`).
- `tour-viewer-session.ts` - the session object, the store factory and
  the hooks contract they share.

## Invariants & assumptions

- **Wiring order is dependency order:** print → author → viewer → AR entry
  → archive open. Each module hands its cross-module entry points to the
  `hooks` object (`renderArStatus`, `renderAuthorReadout`,
  `tryPlaceTour`, `startAuthorPipeline`, `startViewerPipeline`,
  `presentTourForPrint`), and callers read the hooks at call time - which
  is what keeps the modules free of import cycles (`check:cycles` is in
  the gate). A hook read before its owner is wired is the no-op from
  `createUnwiredHooks()`, never a throw.
- `?author=1` is read once at boot (switching = reload); `?nocache=1` or a
  browser without the Cache API means no cache store (the Storage section
  hides).
- The cache is `BoundedLocalCacheStore(CacheApiStore, 5)`; Drive links go
  through the site worker's proxy (`DRIVE_PROXY_BASE_URL`, absolute on
  purpose - production is same-origin, dev servers are on the worker's
  CORS allowlist).
- `#ar-status` and `#enter-ar` must stay DOM children of `#ar-root` (the
  DOM-overlay root; `tests/repo-config/hud-overlay-nesting.test.js`).
- The `?qr=` boot's rejection reaches the error box: a printed code is the
  one flow with no retry.

## Examples

`/?qr=https%3A%2F%2Fexample.com%2Ftour.zip` opens the archive on load;
pasting the same URL into the input does the same interactively.

## Tests

Driven end-to-end by `playwright-tests/*.spec.js` (streaming, fallback,
cache-hit revisit, clear cache, error paths, the faked-AR boot of both
modes, the print panel, the ready-triggered placement). The modules'
sidecars name the unit tests beneath each concern.
