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
- **Clear-cache settles once the store is durably empty, without waiting
  for the warm download** (flows plan M2, 2026-09-07): the handler reads
  `cacheStore.size()` FIRST (the open session's eviction drops its own copy
  from the index, so a count taken later reads 0 for the single-tour case -
  review #3), then runs the session's `archive.evict()` - which now ABORTS
  the warm and awaits only a recovery write - then `clear()`. The label goes
  "Clearing…" → `clearCacheLabel(count)` ("Cache cleared - N stored tours
  removed") → "Clear cache" after 2 s; a click during the transient clears
  the revert timer so it cannot capture the confirmation as the idle label.
  "Cache cleared" never precedes a background write that would repopulate
  the store (PR #358 review #1) - the evicted latch, not the wait,
  guarantees it. The button lives in the collapsed `#storage-panel`
  `<details>` with the sentence that explains the cache; the whole section
  hides without a cache store.
- Bare-name `?qr=` payloads resolve under `DEFAULT_ASSET_PREFIX`
  (the GeoTales raw-GitHub prefix the QR builder's docs use as the example).
- **Author panel (M3):** exists only under `?author=1`, and lives INSIDE
  `#ar-root` so it stays visible while the AR session composites the DOM
  overlay. The printed size is captured once per AR entry (changing it =
  exit + re-enter); the mint gate follows the store (stability + alignment)
  via `authorStatusLine`; the export offers copy + a `qr/<id>.json`
  download. The store carries the opt-in `qrDetected` reducer for both
  modes.
- **Print a code (owner request 2026-08-26; on the page for everyone since
  the flows plan M3, DEC-F2):** `#print-panel` is a `<details>` OUTSIDE
  `#ar-root`, collapsed with an empty tour and opened + prefilled by
  `openUrl` in both modes (the `?qr=` boot included) without clobbering a
  typed link. It owns the printed-size and code-number inputs; author mode
  reads the size from there (one input, two consumers) and disables it
  during a session ONLY in author mode. The measured launch URL renders as
  a QR at the TRUE physical size on paper (print CSS cm at 100% scale; the
  canvas carries the symbol only, the quiet zone is CSS padding); the
  print button opens the details first, because a collapsed one prints a
  blank page. See the framework's `qr-print-plan.ts.md` for the size
  contract.
- **Viewer pipeline (M4):** the default mode relocalizes against the open
  tour: the detected code's `qr/<id>.json` resolves live from
  `loadQrLevels()`, budgeted synthetic votes flow into `recordGpsEvent`,
  the glue marker rides detections in BOTH modes, and the first voted lock
  places the image ring (scene root, raw NUE) — all torn down with the AR
  session and on tour close.
- **The AR status line is composed by `tour-flow.ts`** (flows plan M1,
  2026-09-07): `renderArStatus` only assembles the input - mode, controller
  status, camera frames, the open tour (`hasRecording`, level count), the
  viewer pipeline's QR inputs, the `PlacementState` and the placement error
  - and writes `arStatusLine(...)` into `#ar-status`. Every placement
    outcome is a tagged state (`placing`/`placed`/`declined`), never a
    free-form string composed here; the copy and its rules (the no-codes
    line for an open tour with zero levels) are pinned by `tour-flow.test.ts`.
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
