# archive-open.ts

## Purpose

The open path: the paste-a-link form and the `?qr=` boot, the streaming
session's lifetime (open, teardown), the live stats panel, the progressive
gallery, and the Storage section's clear-cache control. Transport policy is
the framework's (`openRemoteArchive`) and `tour-session.ts`'s; this is the
DOM glue, its own module since the flows plan M6.

## Public API

- `wireArchiveOpen({ ctx, dom, cacheStore, corsProxyBaseUrl, hooks, mode }): ArchiveOpen`
  - `ArchiveOpenDom { form; linkInput; openButton; openFileButton; fileInput; fileAdvice; openFileAdviceButton; fileStatus; statsPanel; statsHeadline; statsDetail; errorBox; linkStatus; gallery; readiness?; storagePanel; clearCacheButton }`
    - `readiness` carries `data-tour-open`: `opening` while an open runs,
      `settled` once that open's manifest and levels continuations have
      run (and the gallery's fill, while shown) - never set by an older
      open after a newer one began - and `failed` for an open that failed
      (follow-up F14; the e2e's "the tour is open").
    - **Step 2's link check (polish round M2, A13/A16).** A submit, a paste
      (deferred a turn, since the value lands after the event) or a
      `change` with a new link runs the open and writes its outcome to
      `linkStatus` (`link-check.ts`): "Checking the link…", then found or
      failed. A failure whose cause `printsUnverified` for the host the link points
      to (`hostOfLink`, M0c review: not the tile kept from step 1;
      `offline`, or `missing` on an own server) calls `hooks.presentUnverifiedLink(url)`, so the print
      step carries the link marked unverified and the creator gives it
      once - and clears the error box, whose "that file does not exist"
      contradicted the line's "that is fine for now" (PRs #584/#585). A
      cancelled open hides the line; a superseded one leaves it to the
      newer check. The same link is not checked twice by paste and
      `change`, nor by "Check link" while its check still runs (PR #585:
      the field's `change` fires on the button's blur); once settled, the
      button re-checks.
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
    error box. Step 2's interactive open is the form listener, not a
    returned handle (M6 review #6); beside `boot` the page gets
    `scanOpen`, `openLink` and `openFile` (below). All of them run the
    module-private `openTour` (`openUrl` for a link) - tear down the previous session (which also clears
    `levelByText`), open, render stats, stream the gallery, call
    `hooks.tryPlaceTour()` and `hooks.presentTourForPrint(url, origin)` -
    the origin says which form submitted, so an open started in step 4
    does not answer by collapsing step 4 - load the
    levels (with a `.catch`). Once the manifest settles,
    `hooks.presentTourInfo({ manifest, loadImage })` gets it (`manifest`
    null for a zip without `tour.json`) with a loader that reads an
    archive path from the open zip, and `null` when the session is torn
    down (the visitor's start page, polish round M4a). It resolves an `OpenOutcome` (`opened`,
    `superseded`, or `failed` with the reject cause) and keeps a real
    in-flight flag; a successful open sets `ctx.tourLabel`.
  - `ArchiveOpen.openLink(url)` / `ArchiveOpen.openFile(file)` - the
    "You already have a tour?" box on a phone (`have-tour.ts`, tour editor
    plan 2026-10-17-1816, W1) opens through this same path: `openLink`
    opens the link, and only once it opened writes it into `linkInput` as
    the link of record with step 2's "found" line; a link that did not
    open leaves step 2 alone - never the unverified hand-off to printing,
    which a bad link pasted into the box used to trigger (PR #637 review)
    - and the error box keeps the open's own words for the box. `openFile`
      runs the file open. Both resolve the `OpenOutcome`, so the box can ask its question
      only once the tour is really open.
  - `ArchiveOpen.scanOpen` - step 4's scan-to-open (`scan-open.ts`)
    over this open path: it writes the link of record, opens with origin
    `measure-step`, and re-renders the creator panel when it settles.

## Invariants & assumptions

- **The signature lines** (tour kit plan K1, K-D2): after a successful
  open, `#tour-trust` shows who signed the tour or that nobody did, the
  trust-on-first-use warnings for its sources (the link as `linkTrustKey`
  reads it - a URL without its fragment, query kept - and the
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
  `"unavailable"` on a failed read, M5 review #1), and the visitor screen
  either way (`hooks.presentTourLevels()`, r857 review #5); a failed read
  sets `ctx.levelsUnreadable` (no code of this tour can place it, r857
  review #4);
  `teardownSession` clears tour state ONLY when a tour was open at its
  start (scan-to-open plan §9 #1): with none, nothing tour-scoped exists,
  and the creator's pre-open work (a measured level, placements, the
  print-size check) is kept for the tour about to open. When a tour closes,
  it stops the visitor's stations (`hooks.stopStations`, tour kit plan
  K4: the story and the HUD; the next tour's stations start a new run),
  closes the tour document (`ctx.tourDocument.close()`: the creator's
  placed objects, their deletions - authoring plan 2026-09-28-0953 M4 - and
  their pictures and AR placements) and drops the previews,
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
  closing tour owned (`stationContent`, disposed with every station's
  parts, `imagePlanes`, `placementAttempted`, `placement`) and the QR controller's level cache (the compass wait it
  also ended, r857 review #9, is gone since r863), `levelsUnreadable`,
  and a failed
  finish (`finishError`, which keeps Save off - scan-to-open plan §9 #8),
  and `walkBake` (the next open bakes its own walk; a decline kept
  across a switch would be said of, and read by the Finish of, the next
  tour).
  The measured level goes with the tour, and so does its measurement (the
  settle's raw inputs, authoring plan 2026-09-28-0953 M2c) - a closing
  tour's measurement must never be re-minted into the next tour's level:
  `hooks.resetFinishStep` empties both (the creator's code module, code
  book plan M5d-2), and `mintGeneration` is bumped so a mint hash in
  flight lands on nothing.
- **Async-UI rule:** the open button shows "Opening…" BEFORE the first
  await (PR #357 review) and restores only for the generation that owns
  it; the teardown runs INSIDE the try (PR #365 review).
- Each gallery picture is measured from its header before its `<img>`
  decodes it (`image-cap.ts` `pictureProblem`, tour kit K4 review R2): one
  over the tour pixel cap, or one whose size cannot be read, shows as
  "failed to load".
- **The stats panel shows only with `?debug=1`** (polish round M2: a
  transport demo, not a creator's step; the gallery likewise, hidden by
  `main.ts`). A visitor's transfer numbers could also stall below 100 %
  once the whole-file download stops, and read as stuck (UI round 1, U1,
  review F11). The trust line is hidden when
  it has no line for the audience (`trustLines`).
- The gallery fills ONLY while it is shown (a `?debug=1` creator,
  follow-up F14): hidden, it used to read, decode and keep a URL for every
  photo on every open, for nothing.
- The gallery streams SEQUENTIALLY; a newer open supersedes an in-flight
  fill per entry; object URLs are revoked on teardown.
- **A creator's recording is a tour from the moment it opens.** A zip
  without `tour.json` opens the creator's tour document on an empty
  manifest (an unnamed tour), not as "no tour", so every object placed in
  it belongs to a station of the document at once; a visitor's opens as
  "no tour" (null). The gallery, the scan entries and the tour info still
  read the file's own (null) manifest. Tests: `archive-open-file.test.ts`
  ("a recording without tour.json").
- **The bake at open** (creator only): a tour carrying a recording and no
  baked photo spots is baked before it settles (`walkAtOpen` of
  `tour-document-bake.ts`), and the document opens on the baked tour - the
  walk's photos already in stations, joined to the tour's own or in new
  `walk-N` ones by the station rule. While it runs `ctx.walkBake` is
  `{ kind: "baking", done, total }` (the status line says so,
  `walkBakeLine`), `tourManifestStatus` stays "pending" (the Finish, the
  draft offer and the AR placement wait), and work placed meanwhile is
  carried into the opened tour by the rule. Then `walkBake` holds what it
  decided (`{ kind: "decided", photos }`: the Finish reads
  `notPlaced`; a decline is said on the status
  line). The bake never fails the open. A tour without a recording, or
  with its photos already baked, settles at once (`photos: {}`). A
  visitor's open never bakes. Tests: `archive-open-file.test.ts` ("a
  creator's recording is baked when it opens").
- **The gallery waits for `tour.json` and leaves out the creator's walk**
  (scan-pass plan S1, `tour-read-set.ts`): the settle sets
  `ctx.scanEntries` (empty without a manifest, as before) and then fills
  the gallery; a broken manifest fills it unfiltered. A copy that kept the
  walk therefore never decodes its frames; every other file still shows.
- **A visitor's page stops the background download of a copy that kept
  the walk, and of a tour not finished yet** (`stopsVisitorDownload`,
  visitor mode only, judged on the file's own manifest at the settle; a
  zip without `tour.json` is such a tour, so a creator's recording hosted
  before its first Finish is not fetched whole by every visitor):
  `archive.dispose()` aborts the warm, and the tour reads its entries by
  range instead. The costs, for that copy only: tier 3 (the whole-archive
  check), the offline copy, and - because dispose aborts the archive's
  one controller - the recovery download for a host that stops honouring
  ranges mid-session (S1 milestone review #5). Tests:
  `archive-open-file.test.ts` ("stops a visitor's download of a
  recording without tour.json").
- **Another tour asks before replacing one with an unsaved rebuilt file**
  (UI round 1, U2): `openTour` returns `{ kind: "cancelled" }` when
  `hooks.confirmLeaveTour()` is false.
- **The manifest is marked pending BEFORE the open's placement trigger**
  (S1 milestone review #4): a tour opened into a running AR session would
  otherwise be judged before its `tour.json` (with the baked photo spots)
  was read, and declined for the whole session.
  `archive-open-order.test.ts` pins the order.
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
draft, and a closed picker doing nothing; its "step 2's link check" block
covers the unverified hand-off on `missing`, none on `cors`, and the
auto-check on paste and change, once per link; its `openLink` / `openFile`
block pins the outcome each returns, the link of record `openLink` writes,
and that a link that did not open (offline, missing) is never handed on. `archive-open.test.ts` drives the real submit handler through
a failed open: the tour switch clears the fused-pose hint state, the
failed levels read and the voted-lock count (r857 review #9). Its "the levels' settle reaches the visitor
screen" block (in `archive-open-file.test.ts`) holds `presentTourLevels`
on a read and on a failed read, and `levelsUnreadable`. The logic
beneath: `tour-session.test.ts`,
`stats-view.test.ts`, `open-errors.test.ts`, `tour-flow.test.ts`
(`clearCacheLabel`).
