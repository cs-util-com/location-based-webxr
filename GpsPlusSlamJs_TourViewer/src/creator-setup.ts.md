# creator-setup.ts

## Purpose

The creator's AR setup (guided-setup plan M3; `author-mode.ts` until
2026-09-08): the panel inside `#ar-root` that guides the creator through
measuring the hung code (the mint gate: a stable pose AND a GPS alignment
with at least `MIN_ALIGNMENT_SAMPLES` fixes since this session started),
keeps the measured level in the session, and on Finish rebuilds the hosted
zip in the browser (DEC-N6) with `qr/<id>.json` and `tour.json`, ends the
AR session and reveals the download at the END of step 4, where it is its
own tap (a download needs its own user gesture).

That download was step 5, and the "put it back where the old one is" copy
was step 6, until the flow rework (second testing session, F10): neither
is a setup step, they are what happens when step 4 finishes. This module
reveals `finishBlock` after a successful rebuild and `replaceHelp` once
the zip is actually saved, and `resetFinishStep` hides both again when the
tour they belong to closes.

The panel is a creator's for the whole page, but its CONTROLS are the AR
session's: on a desktop they were a row of greyed-out buttons under an "AR
not supported" button (F11). The status line is deliberately NOT gated -
it is where an entry REFUSED before any session starts (an empty printed
size) explains itself, and a gated one would leave a Start button that
does nothing and no explanation anywhere. With no session live the live
measuring readout is blank instead: "hold the phone on the printed code"
is an instruction for a situation a desktop creator is not in.

## Crash-safe authoring (second testing session, F13)

Everything measured and placed lives in page memory until Finish, and an AR
session on a phone can be killed by the OS at any moment. So each mint and
each placement is also written to an OPFS draft, keyed by the tour's url
(`authoring-draft.ts` holds the rules, `draft-persistence.ts` the on-disk
shape, and the framework's `opfs-draft-store.ts` the mechanics).

- **NOT the File System Access API.** F13 asked for write access to the
  hosted zip; the pickers do not exist on Chrome for Android, which is the
  only device the creator's AR session runs on. See the plan's §10.1.
- **The write is fire-and-forget.** The placement already happened in
  memory; a storage problem must never fail the tap that made it. A failed
  write says so ONCE, in the panel - a creator mid-walk cannot act on it
  more often than that.
- **A draft is OFFERED, never applied.** It can be days old and can be one
  the creator believes they discarded; restoring it silently would append
  content they did not ask for into a zip they are about to publish. Three
  answers: add it back, not now (kept), delete it (gone). "Not now" keeps
  it because a mis-tap must not become the loss this exists to prevent;
  "delete it" exists because a draft with no way out is offered forever.
- **Restoring brings the LEVEL and the SIZE back too**, not just the
  objects. The level is what makes Finish reachable without walking to the
  poster again; the size is rewritten from the framework default on every
  load, so without it a re-entry would solve against 16 cm for a poster
  printed at 20. A live measurement wins over a drafted one - it is newer.
- **A draft is deleted only on PROOF**: a re-opened tour whose `tour.json`
  already carries its ids. Not on the download tap - on Android that
  resolves true the moment a download starts, and the creator still has to
  upload the file by hand afterwards.
- The finish's append is **id-deduplicating**, because the serializer
  rejects duplicates: one already-hosted object would otherwise make every
  finish throw for as long as the draft was restored, with no escape inside
  the app.

## Public API

- `wireCreatorSetup({ ctx, mode, arStore, arController, seams, wizard, dom, openDraftStore? }): CreatorSetup`
  - `openDraftStore(key)` resolves this tour's draft namespace, or
    `undefined` where there is no persistence. Injected so the unit tests
    and the e2e can supply one without OPFS.
  - `CreatorSetupDom { panel; controls; finishBlock; replaceHelp; replaceHelpShare; sizeInput; printPanel; status; mintButton; finishButton; finishStatus; downloadButton; pinButton; pinLabel; pinSave; pinCancel; photoButton; draftOffer; draftOfferText; draftRestore; draftDismiss; draftDiscard }`
  - `arSessionLive(status)` - whether the controller's status means a
    session is up (`starting` / `running` / `stopping`). Exported because
    `main.ts` hands the same predicate to the wizard, which must not
    collapse step 4 while it is true.
    - `panel`, `status`, `controls`, `mintButton`, `finishButton` live
      inside `#ar-root` (the DOM overlay); `finishBlock`, `finishStatus`,
      `downloadButton` and `replaceHelp` sit at the end of step 4 but
      OUTSIDE `#ar-root` - the download is tapped after the session ends,
      so putting it over the camera would promise otherwise.
  - `CreatorSetup` members: `renderAuthorReadout`, `startAuthorPipeline`,
    `resetFinishStep` (a tour closed) and `presentDraftForTour` (a tour
    opened AND its manifest settled - "spent" is a question about that
    manifest, so it cannot be asked earlier).
  - `CreatorSetup.renderAuthorReadout()` - the measuring readout
    (`authorStatusLine`) joined with the setup hint once measured
    (`setupHint`); a persistent pipeline error (`ctx.authorErrorText`) has
    priority. No-op in visitor mode.
  - `CreatorSetup.startAuthorPipeline(): boolean` - validates the printed
    size (opening step 2 when it is unusable), creates the author tracking
    controller into `ctx.qrController`; false keeps AR unstarted.
- Both are properties (handed to the hooks object unbound).

## Invariants & assumptions

- **Mint:** reads the STABLE pose from the `qrDetected` slice, the
  alignment TARGET matrix and the zero; the level's identity is the async
  `qrCodeId` of the exact printed text, guarded by `ctx.mintGeneration` so
  a stale hash cannot install an older level. Until it lands the finish
  button stays off.
- **Finish** (`finishReadiness`): needs a measured level, an open tour AND
  a settled manifest load (pending or broken refuses, with the reason:
  finishing would overwrite a placement it could not read, M3 review #5);
  runs once at a time (`ctx.finishing`). While it runs the panel shows
  its progress with priority over the measuring readout, and a failure
  stays on the line until the next tap (`ctx.finishProgress`,
  `ctx.finishError`; store dispatches used to erase both). The
  continuation re-checks `ctx.session` after every await and ends the AR
  session only if it is still the one it started in
  (`ctx.arSessionGeneration`). An existing level for the same id (also in
  the tolerated wrapped shape) is replaced in place, never duplicated.
  The size note next to the button says what the rebuild will copy. Entries: the level at
  `qrLevelEntryName(id)` and `tour.json` from `ctx.tourManifest` (what the
  zip already carried, so a re-measure never drops placed content) or an
  empty manifest, plus each placed photo's bytes under
  `session.manifestWrap` (the session's own prefix, never re-derived).
  The input is the **newest bytes for this tour**: `ctx.rebuiltZip` when a
  previous finish produced one, else `session.readWholeArchive()` (the
  warmed copy, else range slices). On success `ctx.rebuiltZip` is set,
  `ctx.tourManifest` **advances to what was just written** and
  `ctx.placedObjects` is cleared, the AR session is ended through the
  controller (the framework's session-end path runs the app teardown) and
  step 4's finish block is revealed - AFTER the `disable()`, so it cannot
  appear over a session that is still compositing; on failure the reason
  stays in the panel and the button re-enables.
  - **Why the chaining and the advance go together** (PR #435 review):
    finishing ends the AR session but does NOT close the tour, so a
    creator can measure again, place more and finish again. Leaving the
    manifest at its pre-finish value silently dropped the first batch;
    advancing it while still rebuilding from the hosted zip would write a
    manifest naming photos the archive does not contain. Both halves are
    needed, and the e2e finishes twice in one open tour to hold them.
- **Hand-off:** `seams.shareOrDownloadZip` - the device share sheet where
  the browser can share FILES, else the framework's picker-or-anchor. The
  button's LABEL comes from `seams.canShareZip()`, read once at wire time,
  because a button reading "Download" on a phone that will open a share
  sheet names the wrong action before it is pressed. Two independent
  facts come back:
  - `delivered` reveals the replace instructions (the last thing to do,
    and only once there is a file to do it with); false - a dismissed
    picker, or a share sheet that handed nothing over - keeps the button
    live. Async-UI rule on both branches.
  - The reveal is ONE-WAY for `replaceHelp` and follows the last DELIVERED
    hand-off for `replaceHelpShare`. A creator who saved, tapped again and
    dismissed the picker keeps the step-6 instructions they earned; one who
    shared and then saved stops being told to go looking in another app.
    And the whole continuation is guarded on `ctx.openGeneration`, because
    a share sheet can stay up across a tour close - the reveal would
    otherwise land on the closed tour's panel and still be on screen when
    the next tour reached its finish (PR #440 review).
  - `route` picks the copy, and this is the half that matters: "the link
    and the printed code stay the same" is TRUE after a save over the
    hosted file and FALSE after a share, which normally creates a new file
    with a new id while the printed code still points at the old one. The
    share route therefore also reveals `#replace-help-share`, one extra
    sentence saying so. The four outcomes are pure functions
    (`finishHandoffStatus`, `finishIdleLabel`, `finishBusyLabel` in
    `qr-author-mode.ts`), tested there, because three of them cannot be
    reached in a headless browser.
    `resetFinishStep` (a hook, called when a tour closes) disables the
    button, clears the status and hides both blocks, so a re-opened tour
    never shows the previous one's dead download button.
- **Placement (M4, DEC-N9):** allowed only under the mint gate's own
  alignment floor for THIS session (a measured code, a matrix and at least
  `MIN_ALIGNMENT_SAMPLES` fixes since the session started - a level that
  survived a session end does not open it, M4 review #2), a running
  session and no rebuild in flight; re-checked at every tap. "Place a pin
  here" reads the hit-test reticle (a surface must be under it, else the
  panel says so), opens the overlay label input (with a Cancel), and Save
  mints a `pin` record from the reticle's GPS-world position
  (`content-placement.ts`; the reticle rides the lerped visual alignment,
  which converges within ~0.3 s of a correction - the one frame difference
  to the photo's target-matrix mint, accepted);
  "Capture a photo here" encodes the latest camera frame through
  `seams.encodeFrameJpeg` and mints a `photo` record from the camera's
  raw pose through the session alignment, keeping the JPEG for the
  rebuild. Each placement renders its own preview (`renderTourObjects`
  at the scene root; `ctx.placedPreviews`, one handle per object, so two
  placements cannot race each other's disposal and a photo is decoded
  once). The outcome of a placement is `ctx.placementNote`, shown with
  priority until the next tap. Placed objects survive a session end like
  the level; the finish step appends them to the manifest (at the wrapped
  path when the zip is wrapped) and writes the photos as
  `content/<id>.jpg`, then clears them - a re-opened tour or a re-measure
  must not append them again (M4 review #1). The entry assembly runs
  inside the finish's try, so a manifest the reader rejects fails the
  finish visibly instead of freezing the panel.
- The measured level survives a session end on purpose (finishing ends
  the session); a new measurement replaces it.
- Owns the session fields `lastDetectedText`, `activeSizeM`,
  `authorErrorText`, `mintedLevel`, `mintGeneration`, `finishing`,
  `rebuiltZip`, `placedObjects`, `placedPreviews`, `placementNote`; reads
  `gpsSamplesAtSessionStart`, `reticle`, `latestFrame` (written by
  `ar-entry.ts`), `session`, `currentLevels`, `tourManifest`.

## Examples

```ts
const setup = wireCreatorSetup({
  ctx,
  mode,
  arStore,
  arController,
  seams,
  wizard,
  dom,
});
hooks.renderAuthorReadout = setup.renderAuthorReadout;
hooks.startAuthorPipeline = setup.startAuthorPipeline;
```

## Tests

`playwright-tests/ar-mode.spec.js` - "the creator measures the code,
finishes, and downloads a rebuilt zip that carries the level and
tour.json" drives the composed flow under the fakes (the real controller,
slice, alignment solve, mint, rebuild; the download captured by the fake)
and reads the produced zip back in node, including a placed pin and a
captured photo (their records and the photo's bytes), the refused pin
without a surface, the dismissed-picker branch and the identity-hole
re-entry. The pure pieces are unit-tested in
`qr-author-mode.test.ts` (`authorStatusLine`, `setupHint`,
`finishReadiness`) and `tour-session.test.ts` (`archiveFileName`,
`readWholeArchive`, `loadTourManifest`).
