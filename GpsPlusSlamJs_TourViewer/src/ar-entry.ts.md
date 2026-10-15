# ar-entry.ts

## Purpose

The AR entry (QR-pose plan M2): the one `enable()` both modes share, the
on-running runtime start (session → alignment → camera capture, via
`ar-mode.ts`), the session-end teardown, and the two renderers of the
entry's DOM (`#enter-ar` + `#ar-hint` from the controller state,
`#ar-status` from the session state through `tour-flow`). Its own module
since the flows plan M6.

## Public API

- `wireArEntry({ ctx, mode, arStore, arController, gpsHandler, seams, locationGate, dom, hooks, recording? }): ArEntry`
  - `recording` (a creator's, `recording-panel.ts`; authoring recording plan
    2026-09-28-0953, M1a): asked at each entry, BEFORE the session is
    requested, whether this entry records - that starts the recording when
    the creator opted in, so its `startSession` is the first action it holds.
    A recorded entry asks for depth (decision D4): `onDepthSample` goes into
    `buildArEnableConfig` and each sample is dispatched as-is as
    `recording/recordDepthSample` (the Recorder's way); once the runtime runs,
    `seams.startDepthCapture(RECORDING_DEPTH)` starts the sampler, and the
    session end stops it. A creator's entry with the mesh cursor
    (`deps.meshCursor`, polish round M5; `main.ts` sets it for every
    creator unless `?mesh=0`, the default since 2026-10-15) that is not
    recorded asks for depth at `MESH_DEPTH` the
    same way (a recorded one keeps `RECORDING_DEPTH`: the recording's byte
    estimate assumes it), starts `seams.startMeshSurface` under the world
    group, hands the reticle its `pick`, puts its frame time and triangles in
    the `?debug=1` block, starts it again from nothing when tracking
    restarts at a new origin (`onTrackingRestarted`, follow-up F11), and
    frees it at the session end. The readout's
    "recording" stays a recorded entry's only.
  - `mode` (`"creator" | "visitor"`, guided-setup plan DEC-N1) replaces the
    flows plan's `authorMode`; creator mode runs the author pipeline. The
    pipeline starts before the session is requested, so a start that fails
    (a declined permission prompt) disposes it (`endQrPipeline`): no session
    end would, and a retry built another on top (2026-10-07).
  - `locationGate` (from `visitor-screen.ts`, DEC-N2): while `pending()`,
    a tap requests the location and returns without starting a session;
    the button reads "Allow location" through `arButtonView`.
  - `ArEntry.renderArEntry()` re-renders the button from the controller
    state and the gate (the gate resolves asynchronously at boot).
  - A creator's session requests the WebXR `hit-test` feature and starts
    the reticle under the world group once the runtime is up
    (`ctx.reticle`, disposed on session end), whose XR `select` - a tap in
    AR that the overlay did not cancel - calls `hooks.selectInView(tap)`
    with where the tap pointed (the driver's target ray, or null; M4
    review #4)
    (authoring plan 2026-09-28-0953 M4); every camera frame (a
    `CapturedCameraFrame`: pixels plus the pose and time of its capture) is
    kept as `ctx.latestFrame` for the photo capture (M4) and offered to the
    QR controller.
  - Every session starts the scan gate (`hooks.startScanGate`; a
    creator's is `not-required/creator`, a visitor's holds placement back)
    before the visitor's placement subscription; the session end cancels
    the escape clock, hides the escape button and disposes the placed
    content (M5).
  - `ArEntryDom { arRoot; arStatus; arHint; enterArButton; escapeButton; sizeInput; errorBox; arDebug?; arStatusLive? }`
  - `ArEntry.renderArStatus()` - composes `#ar-status` from the session
    object; assigned to `hooks.renderArStatus` by `main.ts` so the other
    modules can call it without importing this one. A VISITOR without
    `?debug=1` reads `visitorStatus`'s one plain sentence; the creator and
    `?debug=1` keep the technical `arStatusLine`. `data-state` carries `visitorStatus`'s state for a visitor (none for a creator, whose session it would mislead), `data-gate` the scan gate as one word for both (`passed-code` proves the code passed it); `arStatusLive` (the screen reader's live region) is written only when its text changes: the visitor's sentence, and a creator's line outside a session (a failed start with its cause), never per camera frame (UI round 1, U1, review F14; U1 milestone review #8, #9).
  - Subscribes the button renderer to the controller and binds the click:
    - during a running session the click ENDS it ("Exit AR", UI round 1,
      U2), through the same teardown as the back gesture;
    - except a creator's "Done" (polish round M3, Q-Done): it asks
      `hooks.finishFromAr()` first (which starts a finish only when there
      is something to write - M3 review #4), and when a finish started,
      the finish ends the session itself once the zip is written; while a
      code is being measured it stays and says "tap Done again" (PR #598
      review: the finish waits for the measurement); with no
      finish to run, while one runs ("Saving…", still tappable - M3 review
      #1), or after a failed one ("Close AR"), it just leaves. The draft
      keeps every change either way;
    - on a VISITOR's phone without AR the click copies `location.href`
      through `seams.copyText` ("Copying…" disabled, then "Link copied"; a
      failure restores "Copy link" and puts the address-bar advice in
      `errorBox`) - the owner's V4, polish round M4a. The copy is the
      framework's `copyWithFeedback` (follow-up F7, DEC-H3), which runs it
      inside a promise chain (a missing clipboard throws synchronously); it owns the
      button's label until it settles (a render meanwhile does not hand it
      back), and a working copy clears an earlier failure's advice (M4
      milestone review #1).
  - `renderArStatus` also renders the visitor's scan card (`dom.scanCard`,
    `dom.scanCardLine`, optional; the owner's S1, polish round M4b): shown
    while `scanCardShown` holds, carrying the visitor's sentence, with the
    status line hidden meanwhile (kept under `?debug=1`, whose technical
    line the card does not carry); the live region is unchanged.
  - The render also writes `data-ar-state` (the controller status, for
    the page CSS: V4 steps the round button down on `unsupported`) and
    `data-step` (`visitorStep`: "1 of 2" / "2 of 2", removed otherwise)
    on the button - with an `aria-label` "<label>, step 1 of 2" while it
    shows, since generated content would be read run into the label; the
    marker counts the two taps of one start and is dropped once that
    start runs (M4 review #6, #11) - and hides the hint for a visitor's `unsupported` state
    (it would describe a session that cannot start).

## Moved-code veto inputs (D20, M5c)

`renderArStatus` passes `ignoredCode: ctx.viewerIgnoredText` to the line;
`renderDebugReadout` passes the live checks' snapshot and the ignored
codes to the `?debug=1` block, the session's GPS quality from device
fixes only (median accuracy, extent through the framework's
`createGpsExtentTracker`, fix count; recomputed only when the GPS list
changed, since the block re-renders per frame; polish round C4) and
whether this entry records (the depth sampler runs only for a recorded
entry; C7).

## Invariants & assumptions

- Session-state fields it owns: `qrController` (disposed and nulled on
  end via `endQrPipeline`, so a lock in flight cannot land in the next
  session - plan §61),
  `qrDebugView`, `cameraFrameCount`, `gpsSamplesAtSessionStart` (the mint
  gate's snapshot, taken at the runtime start), and the session-end reset
  of every viewer/placement/author field the dead session owned (the list
  in `onSessionEnd`, one line per field - a field missing there blends the
  dead session into the next one).
- **The visitor's stations (tour kit plan K4):** every camera frame and
  every store dispatch of a visitor session calls `hooks.tickStations()`
  (next to `tryPlaceTour`); the session end calls `hooks.stopStations()`
  (the story stops, the HUD goes, the progress stays); a visitor's tap on
  `#enter-ar` calls `hooks.unlockStationAudio()` FIRST, synchronously,
  before any await - a phone lets the stories' audio element play later
  only if it played inside a gesture.
- **A creator's session end settles the visit FIRST** (authoring plan
  2026-09-28-0953 §3.2, M2c): `hooks.endAuthorVisit()` runs before the
  generation bump and before `endTourArRuntime`, whose
  `teardownArSessionState` resets the alignment the settle reads
  (`ar-entry.test.ts` pins the order against `endSession` and
  `resetGpsSessionData`). A visitor's never calls it. Once the runtime runs
  and the reticle exists, `hooks.beginAuthorVisit()` shows the earlier
  visits' objects.
- `#ar-status` and `#enter-ar` must stay DOM children of `#ar-root` (the
  DOM-overlay root; `tests/repo-config/hud-overlay-nesting.test.js`). The
  hint is hidden while a session is starting/running/stopping.
- The printed-size input is disabled during a session ONLY in author mode
  (DEC-F2).
- A refused author pipeline keeps AR unstarted; the viewer pipeline is
  best-effort (no detector = plain AR, still placing photos).
- The tracking store rides into `initAR` (`trackingStore: arStore`) so the
  tracking-quality phase is fed (flows plan M4).
- On `running`, viewer mode installs the placement subscription
  (`ctx.placementUnsubscribe`) and attempts once; author mode renders the
  readout instead.
- The runtime start is all-or-nothing (`startTourArRuntime`); its failure
  surfaces in the error box and disables back to `ready`.

- **Codes-only start (QR-first M1b-1):** a visitor whose location gate
  reports `codesOnly()` (the location was declined) starts AR with
  `location: "none"` - no location permission, no GPS watch, so no compass
  watch either (the coordinator starts it at the first fix) - and marks the
  session (`ctx.codesOnly`, set before the viewer pipeline and its gate
  start). The status input carries it (`codesOnly`), and the debug hold
  line reads the device-fix count (`deviceFixes`). Before such a start the
  gate's `recheck()` runs (M1b-1 review #3); when it leaves the gate
  pending (a dismissed prompt offered again) the tap is not a start.

## Examples

```ts
const arEntry = wireArEntry({
  ctx,
  mode,
  locationGate: visitor.locationGate,
  arStore,
  arController,
  gpsHandler,
  seams,
  dom,
  hooks,
});
hooks.renderArStatus = arEntry.renderArStatus;
```

## Tests

`playwright-tests/ar-mode.spec.js` - both modes booting to running, the
frame count in the status line, the system session end + clean re-entry,
the hint hidden during a session, the unsupported state without fakes.
`ar-entry.test.ts` drives the real `wireArEntry` through "Enter AR" and the
session-end callback it hands the AR controller: the QR controller is
disposed and the fused pose source dropped (QR near-frontal pose plan §64
#4 - the call site had no test). The status line reads the visitor hint
from `ctx.viewerLastEvaluation` (never re-evaluating: the render runs per
camera frame) and the code keep-alive's phase from `ctx.viewerKeepAlive` at
`Date.now()` (a cheap read that counts the hold down) and, with `?debug=1`, writes the QR readout into
`dom.arDebug` (plan §66; `qr-debug-readout.ts`), headed by the running
controller's own status (`ctx.qrController?.status`); the session end clears the
hint's evaluation and keeps the counts. A recorded entry (the
"depth for a recorded entry" block) requests depth, starts the sampler at
the recording's rate, dispatches each sample into the store, and stops it at
the session end; an unrecorded one asks for none. The pure pieces: `ar-mode.test.ts`,
`tour-flow.test.ts`.

- The runtime start also snapshots `ctx.frameEpochAtSessionStart` (code
  book plan M6 v5.1), next to `gpsSamplesAtSessionStart`
  (`ar-entry.test.ts`, "snapshots the odometry frame's epoch").
