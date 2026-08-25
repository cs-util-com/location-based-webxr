# main.ts

## Purpose

The thin DOM shell: wires the `?qr=` launch dispatch, the paste-a-link form,
the streaming session, the live stats panel, the progressive image gallery,
the clear-cache action, and (M2) the AR entry — controller, store, and the
on-running runtime start, composed from `ar-mode.ts` / `author-mode-flag.ts`
/ `seams.ts`. All policy lives in the framework and the colocated view-model
modules; the e2e suite drives this file in a real browser.

## Public API

None (app entry point). Interesting seams for the e2e suite are the
`data-testid` attributes in `index.html`: `link-input`, `open-button`,
`clear-cache`, `stats`, `error`, `gallery`, `ar-status`, `enter-ar`.

## Invariants & assumptions

- **Async-UI rule:** an open disables the button and shows "Opening…" until
  the promise settles; failures land in the `role="alert"` error box with a
  cause-specific message — including the key-less Google Drive limitation,
  stated instead of implied.
- The gallery streams images SEQUENTIALLY, each appended as its bytes arrive
  — the visible proof of range streaming. A newer open supersedes an
  in-flight fill (checked per entry), and object URLs are revoked on
  teardown.
- The cache is `BoundedLocalCacheStore(CacheApiStore, 5)` where the Cache API
  exists, else no cache (the app still works, purely remote).
- **Clear-cache settles only once the store is durably empty:** the open
  session's warm (or recovery) download persists on completion, so the
  handler runs the session's self-sufficient `archive.evict()` — which
  awaits both in-flight writers — before `clear()`. "Cache cleared" therefore
  never precedes a background write that would silently repopulate the store
  (PR #358 review #1).
- Bare-name `?qr=` payloads resolve under `DEFAULT_ASSET_PREFIX`
  (the GeoTales raw-GitHub prefix the QR builder's docs use as the example).
- **AR entry (M2):** `?author=1` is read once at boot (switching = reload);
  `#ar-status` and `#enter-ar` must stay DOM children of `#ar-root` — the
  `initAR` container is the WebXR DOM-Overlay root, so only its subtree is
  visible in AR (enforced by the repo's `hud-overlay-nesting` guard). On
  `enable()` success the runtime start is all-or-nothing
  (`startTourArRuntime`); its failure surfaces in the error box and
  disables back to `ready`.

## Examples

`/?qr=https%3A%2F%2Fexample.com%2Ftour.zip` opens the archive on load;
pasting the same URL into the input does the same interactively.

## Tests

Driven end-to-end by `playwright-tests/*.spec.js` (streaming, fallback,
cache-hit revisit, error paths, and the faked-AR boot of both modes). The
logic beneath is unit-tested in `qr-launch-dispatch.test.ts`,
`tour-session.test.ts`, `stats-view.test.ts`, `ar-mode.test.ts`,
`author-mode-flag.test.ts`, `seams.test.ts`.
