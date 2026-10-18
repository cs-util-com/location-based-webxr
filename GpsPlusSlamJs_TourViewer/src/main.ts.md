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
- `mode.ts` - the mode from the launch URL (`viewerModeFromSearch`).
- `wizard.ts` - the creator's guided setup: the six steps, the starter zip,
  the "open as a visitor" link (`wireWizard`).
- `setup-stage.ts` - the L5 station row and map (`wireSetupStage`, creator
  only, wired after the visitor screen so its hidden states are final).
- `host-picker.ts` - step 1's host tiles (`wireHostPicker`, creator only;
  Continue opens the link step and focuses the field).
- `link-check.ts` - the PDF's re-check of an unverified link, bound here
  to `openRemoteArchive` with the Drive proxy.
- `visitor-screen.ts` - the visitor's consent screen and the location
  gate (`wireVisitorScreen`), with `codesUsable` read from the open tour's
  levels (`tourCodesUsable`: any lockable level, false once the levels'
  read failed; M1b-1 review #2, r857 review #4) and `needsNoGps` from its
  `tour.json` (Q-QF-1; `tourChanged()` from `presentTourInfo` and from
  `presentTourLevels`, r857 review #5).
- `location-permission.ts` - wraps the AR controller's location request
  (`locationPermissionWithoutFix`) so a granted permission with no fix yet
  starts AR (M1b-1 review #1).
- `creator-setup.ts` - the creator's AR setup panel: measuring, finish
  (the zip rebuild), the download (`wireCreatorSetup`); `main.ts` builds
  the object list's DOM view (`createObjectListView` over `#object-list`,
  authoring plan 2026-09-28-0953 M4) and hands it in, and binds
  `hooks.selectInView`.
- `viewer-placement.ts` - the viewer pipeline and the photo placement
  (`createViewerPlacement`).
- `ar-entry.ts` - the AR entry, the runtime start/end, the status line
  renderer (`wireArEntry`).
- `visitor-stations.ts` - the visitor's stations and their stories (tour
  kit plan K4, `wireVisitorStations`), wired after the viewer placement;
  `main.ts` binds `hooks.tickStations` (the visitor's stations, then the
  creator's open station, `CreatorSetup.tickStations`; each does nothing in
  the other mode), `stationCodeLocked`, `unlockStationAudio` and
  `stopStations`.
- `archive-open.ts` - the open path, the gallery, the stats, the Storage
  section, the `?qr=` boot (`wireArchiveOpen`), and step 4's scan-to-open,
  which the setup panel reaches through a local late binding (the panel is
  wired before the open path).
- `have-tour.ts` - the creator page's "You already have a tour?" box on a
  phone (`wireHaveTour`, tour editor plan 2026-10-17-1816 W1), wired for a
  creator only, after the open path, over `ArchiveOpen.openFile` /
  `openLink`; "Play it" is `visitorLaunchHref` (keeps `?debug=1`) and
  "Continue setting it up" scrolls `#setup-card` into view. The computer's
  half gets its line from `have-tour.ts`'s `editorPitch(window)`:
  what the editor's Save does in this browser (PR #637 review).
- `tour-viewer-session.ts` - the session object, the store factory and
  the hooks contract they share.
- `recording-switch.ts` - the visitor's hidden switch (QR-first plan M1c):
  five taps on `#visitor-title` within three seconds reload the page with
  `debug=1&record=1`; with `record=1` (and debug) the recording box starts
  ticked, through its own `change` event.
- `authoring-recording.ts` / `recording-panel.ts` - the troubleshooting
  recording (authoring recording plan 2026-09-28-0953, M1a; a visitor's with
  `?debug=1` since M1b, tagged `tour-viewing`, its `tourViewing/*` log from
  `createViewingLog` handed to the viewer placement only where the panel is
  wired): `?debug=1` is read once, before the recording is created;
  the recording is created BEFORE the store, which is built with its backend
  and gate; the panel (a creator's, or a `?debug=1` visitor's; `main.ts`
  unhides `#recording-block` for exactly those) is wired before the AR entry, which
  asks it at each entry, and is re-rendered on every controller state change
  and store dispatch (failed writes are counted as they happen). Save flushes
  the store's write queue and hands the zip to `seams.shareOrDownloadZip`, as
  the tour zip does; the page url goes into `session.json` without its query,
  and the framework's `getBuildInfo` stamps it. The panel's `arHasRun` is
  `ctx.arSessionGeneration > 0` or a live controller status (the switch locks
  once an unrecorded session has run), and its `estimateStorage` is
  `navigator.storage.estimate` where the browser has one.
- `recording-folders.ts` / `recording-housekeeping.ts` /
  `recording-offer.ts` - the recordings across page lives (M1b): the
  recording takes its folder's Web Lock
  (`holdRecordingFolder(navigator.locks, …)`) before the folder exists and
  holds it for the page's life; where the panel is wired, the page calls
  `wireRecordingHousekeeping` (`recording-housekeeping.ts`) once at boot -
  it lists the folders, leaves the held ones alone, deletes what the cleanup
  bound names, and offers the unsaved ones (`wizard.revealStep("measure")`
  makes the offer visible), then marks `#recording-block`
  `data-housekeeping="done"`. The orphan's `session.json` is stamped like a
  live save's (query-free page url, `getBuildInfo`) and falls back to the
  page's own tag (`recordingTag`: `tour-viewing` on a visitor's page, M1b
  review #7); its hand-off goes through `seams.shareOrDownloadZip`, and one
  `createSaveGuard()` is shared by "Save the recording" and the offer.

- `summary-panel.ts` (authoring plan 2026-09-28-0953 M3b) - the summary
  after Finish over `#summary`, handed to the creator setup as `summary`.
  Its map is `() => import("./summary-map-view.js")`: the ONLY way the
  page reaches Leaflet, so a visitor never downloads it
  (`summary-map-lazy.test.ts`). Its "Start creating" clicks `#enter-ar`,
  inside the creator's own tap.

## Invariants & assumptions

- **The page must boot without `localStorage`.** The wizard's step store is
  read through `stepStoreOrUndefined()` (a try/catch around the getter):
  with site data blocked the getter throws, and a throw at this top level
  would blank the page for a visitor who had just scanned a code. Without
  a store there is no step persistence and nothing else changes. The last
  opened link is prefilled into `#link` for a creator when the input is
  empty, and `#link-status` labels it as the last tour's link (polish
  round M2, A3).
- **The gallery shows only with `?debug=1`, for a creator** (polish round
  M2): it is a transport demo, still filled (the e2e counts its images),
  never shown to a visitor.

- **Wiring order is dependency order:** print → wizard → visitor screen →
  author → viewer → AR entry → archive open. Each module hands its
  cross-module entry points to the `hooks` object (`renderArStatus`,
  `renderArEntry`, `renderAuthorReadout`,
  `tryPlaceTour`, `startAuthorPipeline`, `startViewerPipeline`,
  `presentTourForPrint`, and `presentLocalTour` - a FILE-opened tour, tour
  kit plan K0: the print step keeps asking for a link and a creator's
  wizard opens step 3, or stays in step 5, without remembering a link;
  and `presentUnverifiedLink` - step 2's link printed unverified;
  and `presentTourCodes` - the print step re-reads the codes, when the
  tour's arrive and whenever the creator setup's set of codes changes
  (follow-up F16);
  and `presentTourInfo` - for a visitor, `visitor-start.ts`'s page
  (with `URL.createObjectURL` and `pictureProblem` for the cover) and the
  contact line under `#error` (`tour-contact.ts`, also re-rendered by a
  `MutationObserver` on the error box: W2 of the tour editor plan
  2026-10-17-1816); for a creator, step 3's "Tour name" field
  (`tour-name-field.ts`), whose `typed()` is the Finish's `tourTitle`),
  and callers read the hooks at call time - which
  is what keeps the modules free of import cycles (`check:cycles` is in
  the gate). A hook read before its owner is wired is the no-op from
  `createUnwiredHooks()`, never a throw.
- The mode (`?qr=` present = visitor, else creator; DEC-N1) is read once
  at boot (switching = reload); `?nocache=1` or a
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

- **`?debug=1`** (the framework's `debugUiEnabledFromSearch`) is read once
  at boot into `ctx.debug`: it unhides `#ar-debug` and is passed to the
  wizard, whose visitor link carries it on (QR near-frontal pose plan §66).

## Tests

Driven end-to-end by `playwright-tests/*.spec.js` (streaming, fallback,
cache-hit revisit, clear cache, error paths, the faked-AR boot of both
modes, the print panel, the ready-triggered placement). The modules'
sidecars name the unit tests beneath each concern.

## Leaving with an unsaved tour file (UI round 1, U2)

`hooks.confirmLeaveTour` asks `setup.leaveQuestion()` (`finish-guard.ts`)
before another tour replaces the open one while the creator's rebuilt file
was not saved, and a `beforeunload` handler asks the browser's own question
before the page goes (partial on Android; the draft survives the rest).
