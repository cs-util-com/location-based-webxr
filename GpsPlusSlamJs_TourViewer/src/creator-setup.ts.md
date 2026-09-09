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

## Public API

- `wireCreatorSetup({ ctx, mode, arStore, arController, seams, wizard, dom }): CreatorSetup`
  - `CreatorSetupDom { panel; controls; finishBlock; replaceHelp; sizeInput; printPanel; status; mintButton; finishButton; finishStatus; downloadButton; pinButton; pinLabel; pinSave; photoButton }`
  - `arSessionLive(status)` - whether the controller's status means a
    session is up (`starting` / `running` / `stopping`). Exported because
    `main.ts` hands the same predicate to the wizard, which must not
    collapse step 4 while it is true.
    - `panel`, `status`, `controls`, `mintButton`, `finishButton` live
      inside `#ar-root` (the DOM overlay); `finishBlock`, `finishStatus`,
      `downloadButton` and `replaceHelp` sit at the end of step 4 but
      OUTSIDE `#ar-root` - the download is tapped after the session ends,
      so putting it over the camera would promise otherwise.
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
- **Download:** `seams.downloadZip` (the framework's picker-or-anchor);
  `true` reveals the replace instructions (the last thing to do, and only
  once there is a file to do it with), `false` (a dismissed picker) keeps
  the button live and says "not saved". Async-UI rule on both branches.
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
