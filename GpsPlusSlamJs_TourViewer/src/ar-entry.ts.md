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
    session end stops it.
  - `mode` (`"creator" | "visitor"`, guided-setup plan DEC-N1) replaces the
    flows plan's `authorMode`; creator mode runs the author pipeline.
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
    `?debug=1` keep the technical `arStatusLine`. `data-state` always
    carries `visitorStatus`'s state (the stable channel for tests and
    styling), and `arStatusLive` (the screen reader's live region) is
    written only when the visitor's sentence changes, never per camera
    frame (UI round 1, U1, review F14).
  - Subscribes the button renderer to the controller and binds the click:
    during a running session the click ENDS it ("Exit AR", UI round 1, U2),
    through the same teardown as the back gesture.

## Moved-code veto inputs (D20, M5c)

`renderArStatus` passes `ignoredCode: ctx.viewerIgnoredText` to the line;
`renderDebugReadout` passes the live checks' snapshot and the ignored
codes to the `?debug=1` block.

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
