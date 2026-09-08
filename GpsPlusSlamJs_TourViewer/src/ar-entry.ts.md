# ar-entry.ts

## Purpose

The AR entry (QR-pose plan M2): the one `enable()` both modes share, the
on-running runtime start (session → alignment → camera capture, via
`ar-mode.ts`), the session-end teardown, and the two renderers of the
entry's DOM (`#enter-ar` + `#ar-hint` from the controller state,
`#ar-status` from the session state through `tour-flow`). Its own module
since the flows plan M6.

## Public API

- `wireArEntry({ ctx, mode, arStore, arController, gpsHandler, seams, locationGate, dom, hooks }): ArEntry`
  - `mode` (`"creator" | "visitor"`, guided-setup plan DEC-N1) replaces the
    flows plan's `authorMode`; creator mode runs the author pipeline.
  - `locationGate` (from `visitor-screen.ts`, DEC-N2): while `pending()`,
    a tap requests the location and returns without starting a session;
    the button reads "Allow location" through `arButtonView`.
  - `ArEntry.renderArEntry()` re-renders the button from the controller
    state and the gate (the gate resolves asynchronously at boot).
  - A creator's session requests the WebXR `hit-test` feature and starts
    the reticle under the world group once the runtime is up
    (`ctx.reticle`, disposed on session end); every camera frame is kept
    as `ctx.latestFrame` for the photo capture (M4).
  - A visitor's session starts the scan gate (`hooks.startScanGate`)
    before the placement subscription; the session end cancels the escape
    clock, hides the escape button and disposes the placed content (M5).
  - A creator's session requests the WebXR `hit-test` feature and starts
    the reticle under the world group once the runtime is up
    (`ctx.reticle`, disposed on session end); every camera frame is kept
    as `ctx.latestFrame` for the photo capture (M4).
  - `ArEntryDom { arRoot; arStatus; arHint; enterArButton; sizeInput; errorBox }`
  - `ArEntry.renderArStatus()` - composes `#ar-status` from the session
    object; assigned to `hooks.renderArStatus` by `main.ts` so the other
    modules can call it without importing this one.
  - Subscribes the button renderer to the controller and binds the click.

## Invariants & assumptions

- Session-state fields it owns: `qrController` (nulled on end),
  `qrDebugView`, `cameraFrameCount`, `gpsSamplesAtSessionStart` (the mint
  gate's snapshot, taken at the runtime start), and the session-end reset
  of every viewer/placement/author field the dead session owned (the list
  in `onSessionEnd`, one line per field - a field missing there blends the
  dead session into the next one).
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
the hint hidden during a session, the unsupported state without fakes. The
pure pieces: `ar-mode.test.ts`, `tour-flow.test.ts`.
