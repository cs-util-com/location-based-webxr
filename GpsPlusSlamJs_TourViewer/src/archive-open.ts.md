# archive-open.ts

## Purpose

The open path: the paste-a-link form and the `?qr=` boot, the streaming
session's lifetime (open, teardown), the live stats panel, the progressive
gallery, and the Storage section's clear-cache control. Transport policy is
the framework's (`openRemoteArchive`) and `tour-session.ts`'s; this is the
DOM glue, its own module since the flows plan M6.

## Public API

- `wireArchiveOpen({ ctx, dom, cacheStore, corsProxyBaseUrl, hooks }): ArchiveOpen`
  - `ArchiveOpenDom { form; linkInput; openButton; openFileButton; fileInput; fileAdvice; openFileAdviceButton; fileStatus; statsPanel; statsHeadline; statsDetail; errorBox; gallery; storagePanel; clearCacheButton }`
    - **The advice (tour kit plan K0).** A failed open whose cause
      `offersFileOpen` (a host that blocks browsers, `cors`) shows
      `fileAdvice` - its button opens the same picker - under the error
      that says "download the file and open it here"; every new open hides
      it again. `offline` gets its own sentence and no button.
    - **Open a file (tour kit plan K0).** `openFileButton` clicks the
      hidden `fileInput`; a pick runs the same open path as a link with a
      `file` source (`openTourFile`). The input's value is cleared on
      every pick, so the same file can be picked again after a failure.
      The file button shares the in-progress state of every open button
      (async-UI rule, both outcomes tested). A file-opened tour is named
      in `fileStatus`, gets no streaming stats (nothing streams), is
      labelled by its file name, goes to `hooks.presentLocalTour(origin)`
      instead of the print prefill (it has no link), and its draft is
      keyed by the session's content key (`tour-file-key.ts`).
    - Step 4's paste form (F12) is gone: step 4 opens the tour its printed
      code names (`scanOpen`, scan-to-open plan §2), writing the link of
      record into `linkInput` first, so the page keeps one link of record
      and one open path.
    - The open button carries the in-progress state and restores
      `OPEN_BUTTON_LABEL`, for a scan-started open too.
  - `cacheStore: BoundedLocalCacheStore | undefined` - undefined = no local
    copies (`?nocache=1`, no Cache API); the Storage section then hides.
  - `ArchiveOpen.boot()` - the `?qr=` launch (bare-name payloads resolve
    under the GeoTales raw-GitHub prefix); the caller catches into the
    error box. The only returned entry point (M6 review #6): the
    interactive open is the form listener, and both run the module-private
    `openUrl` - tear down the previous session (which also clears
    `levelByText`), open, render stats, stream the gallery, call
    `hooks.tryPlaceTour()` and `hooks.presentTourForPrint(url, origin)` -
    the origin says which form submitted, so an open started in step 4
    does not answer by collapsing step 4 - load the
    levels (with a `.catch`). It resolves an `OpenOutcome` (`opened`,
    `superseded`, or `failed` with the reject cause) and keeps a real
    in-flight flag; a successful open sets `ctx.tourLabel`.
  - `ArchiveOpen.scanOpen` - step 4's scan-to-open (`scan-open.ts`)
    over this open path: it writes the link of record, opens with origin
    `measure-step`, and re-renders the creator panel when it settles.

## Invariants & assumptions

- **The signature lines** (tour kit plan K1, K-D2): after a successful
  open, `#tour-trust` shows who signed the tour or that nobody did, the
  trust-on-first-use warnings for its sources (the normalised link, and the
  printed code when a scan or a `?qr=` boot named it) and its links to
  other series (`tour-trust-view.ts`). A file has no link source. Hidden
  again at the start of the next open.
- **A late integrity failure** (tour kit plan K1, §8 D3; a tier-2 read or
  the tier-3 whole-archive check, `tour-integrity.ts`) tears the tour down
  with the same `teardownSession` a tour switch uses - its content goes,
  in AR too - and says why on the page and in the AR status line
  (`ctx.contentError`; the error box is outside the overlay). A failure
  from a session that is no longer open changes nothing; one found before
  the page held the session is handled at the end of the open
  (`reportEarlyFailure`).

- Session-state fields it owns: `session`, `currentLevels`,
  `openGeneration`; a successful open re-derives the scan gate for a
  running session (`hooks.startScanGate`) and its level load's outcome
  reaches the gate either way (`hooks.reconsiderScanGate(levels)` or
  `"unavailable"` on a failed read, M5 review #1);
  `teardownSession` clears tour state ONLY when a tour was open at its
  start (scan-to-open plan §9 #1): with none, nothing tour-scoped exists,
  and the creator's pre-open work (a measured level, placements, the
  print-size check) is kept for the tour about to open. When a tour closes,
  it drops the creator's placed objects, their deletions
  (`deletedObjectIds`, authoring plan 2026-09-28-0953 M4) and previews,
  resets the gate (`hooks.resetScanGate`), the seven
  viewer QR/line fields (a lock, its vote count, an unknown or unusable
  code and a failed image placement describe the CLOSING tour - PR #434
  review), the fused pose's visitor-hint evaluation and `?debug=1` counts
  (the counts emptied in place: the pipeline outlives the switch - PR #508
  review), ends the closing tour's code votes (`endTourCodeVotes`,
  authoring plan M2b: the keep-alive's hold stops, so the closing tour's
  code does not keep voting into the next tour's alignment, and every
  code's vote budget starts again, so a reopened tour's gate waits for a
  real vote - M2b review #6) and the placement fields the
  closing tour owned (`imagePlanes`, `imagePlanesLoading`,
  `planesRunGeneration` bump, `placementAttempted`, `joinDeclined`,
  `placement`) and the QR controller's level cache, and a failed
  finish (`finishError`, which keeps Save off - scan-to-open plan §9 #8).
  The measured level goes with the tour, and so does its
  `codeMeasurement` (the settle's raw inputs, authoring plan 2026-09-28-0953
  M2c) - a closing tour's measurement must never be re-minted into the next
  tour's level.
- **Async-UI rule:** the open button shows "Opening…" BEFORE the first
  await (PR #357 review) and restores only for the generation that owns
  it; the teardown runs INSIDE the try (PR #365 review).
- The gallery streams SEQUENTIALLY; a newer open supersedes an in-flight
  fill per entry; object URLs are revoked on teardown.
- **Clear-cache settles once the store is durably empty, without waiting
  for the warm download** (flows plan M2): `size()` is read FIRST (the open
  session's eviction drops its own copy from the index - review #3), then
  `archive.evict()` (aborts the warm, awaits only a recovery write), then
  `clear()`. Label: "Clearing…" → `clearCacheLabel(count)` → "Clear cache"
  after 2 s; a click during the transient clears the revert timer.
- A rejecting level parse says so in the error box and leaves the
  placement path alive (flows plan review #8).

## Examples

```ts
const archive = wireArchiveOpen({
  ctx,
  dom,
  cacheStore,
  corsProxyBaseUrl: DRIVE_PROXY_BASE_URL,
  hooks,
});
archive.boot().catch((err) => {
  errorBox.textContent = describeOpenError(err);
});
```

## Tests

`playwright-tests/streaming.spec.js` (range streaming, the 200 fallback,
the cached revisit, the changed-ETag refetch, clear cache, clear cache
during a held warm, the hidden Storage section under `?nocache=1`),
`launch-and-errors.spec.js` (the `?qr=` boot, both async-UI states, the
error paths), `open-file.spec.js` (the real file chooser: a zip opened from
the device, and a non-zip refused with the button restored).
`archive-open-file.test.ts` (K0) drives the file button and picker over
stand-ins: the in-progress state on both outcomes, the file named, the
local hook instead of the print prefill, the content key reaching the
draft, and a closed picker doing nothing. `archive-open.test.ts` drives the real submit handler through
a failed open: the tour switch clears the fused-pose hint state. The logic
beneath: `tour-session.test.ts`,
`stats-view.test.ts`, `open-errors.test.ts`, `tour-flow.test.ts`
(`clearCacheLabel`).
